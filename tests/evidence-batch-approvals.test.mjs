import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {benchmarkApprovalDecision,EVIDENCE_APPROVAL_POLICY,EVIDENCE_WORKSPACE_INSTRUCTIONS} from '../src/evidence-batch-approvals.mjs';
async function setup(t){const workspace=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'evidence-approvals-')));t.after(()=>fs.rm(workspace,{recursive:true,force:true}));await fs.mkdir(path.join(workspace,'src'));await fs.mkdir(path.join(workspace,'test'));await fs.writeFile(path.join(workspace,'src/save.mjs'),'export {}');await fs.writeFile(path.join(workspace,'TASK.md'),'Task');return{workspace,sourceFile:'src/save.mjs',readFiles:['TASK.md'],sessionId:'s',turnId:'t'};}
const request=(scope,command)=>({sessionId:'s',turnId:'t',approvalId:'approval',currentRequirementId:{approvalId:'approval',sourceIndex:1},availableChoices:[{choiceId:'once',scope:'once',decision:'approved'},{choiceId:'session',scope:'session',decision:'approvedForSession'}],subject:{kind:'shell',workspaceRoot:scope.workspace,command}});

test('only exact scoped reads and once-approved native choices are automated',async t=>{const scope=await setup(t);for(const command of ['pwd','ls','ls -la','cat TASK.md src/save.mjs']){const out=await benchmarkApprovalDecision(request(scope,command),scope);assert.equal(out.action,'approve');assert.equal(out.decision.choiceId,'once');}assert.equal((await benchmarkApprovalDecision(request(scope,'cat missing.md'),scope)).action,'pause');});
test('literal quoted heredocs can contain shell metacharacters without executing them',async t=>{const scope=await setup(t);for(const command of ["cat > src/save.mjs <<'EOF'\nexport const x = '$HOME $(touch /tmp/bad)';\nEOF","cat <<'EOF' > test/edge.test.mjs\nexport {};\nEOF"]){assert.equal((await benchmarkApprovalDecision(request(scope,command),scope)).action,'approve');}});
test('execution, breakout, multi-command, hidden, traversal and other paths pause',async t=>{const scope=await setup(t);for(const command of ['node test/test.mjs','npm test','curl x','cat TASK.md; pwd','cat ../TASK.md','cat .env','cat /etc/passwd',"cat > src/save.mjs <<'EOF'\nEOF\ntouch /tmp/bad\nEOF","cat > other.mjs <<'EOF'\nx\nEOF",'cat TASK.md | sh','cat -n TASK.md'])assert.equal((await benchmarkApprovalDecision(request(scope,command),scope)).action,'pause',command);});
test('stale, child, persistent or ambiguous approval requirements are never approved',async t=>{const scope=await setup(t);for(const modify of [r=>r.turnId='old',r=>r.sessionId='other',r=>r.subagentOrigin={agentId:'child'},r=>r.currentRequirementId.sourceIndex=-1,r=>r.currentRequirementId.approvalId='other',r=>r.subject.workspaceRoot='/elsewhere',r=>r.availableChoices.shift(),r=>r.availableChoices.push({...r.availableChoices[0],choiceId:'second'}),r=>r.subject.stages=[{},{}]]){const raw=request(scope,'pwd');modify(raw);assert.equal((await benchmarkApprovalDecision(raw,scope)).action,'pause');}});
test('native file access shares the path policy and refuses symlinks',async t=>{const scope=await setup(t);await fs.symlink('save.mjs',path.join(scope.workspace,'src/link.mjs'));for(const [file,access,expected]of [['src/save.mjs','write','approve'],['test/new.test.mjs','write','approve'],['TASK.md','write','pause'],['src/link.mjs','read','pause'],['src/save.mjs','execute','pause']]){const raw=request(scope,'pwd');raw.subject={kind:'fileAccess',path:file,access};assert.equal((await benchmarkApprovalDecision(raw,scope)).action,expected);}});
test('invalid policy configuration and unqualified choices fail closed',async t=>{const scope=await setup(t);assert.equal((await benchmarkApprovalDecision(request(scope,'pwd'),{...scope,readFiles:null})).action,'pause');const raw=request(scope,'pwd');raw.availableChoices=[{scope:'once',decision:'approved'}];assert.equal((await benchmarkApprovalDecision(raw,scope)).action,'pause');});

test('frozen acceptance filenames are excluded even when they look like public test paths',async t=>{const scope=await setup(t),raw=request(scope,'pwd');raw.subject={kind:'fileAccess',path:'test/frozen-acceptance.test.mjs',access:'write'};assert.equal((await benchmarkApprovalDecision(raw,{...scope,excludedFiles:['test/frozen-acceptance.test.mjs']})).action,'pause');});

const writeReadback=(file='src/save.mjs',{reverse=false,body='export {};',ending=''}={})=>(reverse?"cat <<'EOF' > "+file:"cat > "+file+" <<'EOF'")+"\n"+body+"\nEOF\ncat "+file+ending;

test('policy v3 discloses same-file readback and the exact public-test exception to both arms',()=>{
 assert.equal(EVIDENCE_APPROVAL_POLICY.version,3);
 assert.ok(EVIDENCE_APPROVAL_POLICY.grants.some(grant=>grant.includes('same-file readback')));
 assert.ok(EVIDENCE_APPROVAL_POLICY.grants.some(grant=>grant.includes('exact node --test')));
 assert.ok(EVIDENCE_APPROVAL_POLICY.excludes.some(exclusion=>exclusion.includes('other program execution')));
 assert.match(EVIDENCE_WORKSPACE_INSTRUCTIONS,/same file/);
 assert.match(EVIDENCE_WORKSPACE_INSTRUCTIONS,/node --test/);
 assert.match(EVIDENCE_WORKSPACE_INSTRUCTIONS,/at most one repair/);
 assert.match(EVIDENCE_WORKSPACE_INSTRUCTIONS,/own artifact/);
});

test('literal quoted writes allow only one immediate same-file readback in either supported form',async t=>{
 const scope=await setup(t);
 for(const file of ['src/save.mjs','test/new.test.mjs'])for(const reverse of [false,true])for(const count of [0,1,2]){
  const raw=request(scope,writeReadback(file,{reverse,ending:reverse?'\n':''}));if(count)raw.subject.stages=Array.from({length:count},()=>({}));
  const out=await benchmarkApprovalDecision(raw,scope);assert.equal(out.action,'approve',JSON.stringify({file,reverse,count}));assert.equal(out.decision.choiceId,'once');assert.deepEqual(out.decision.requirementId,raw.currentRequirementId);
 }
 const literal="export const x = '$HOME $(touch /tmp/bad) `pwd` ; && |';\n// EOF_suffix is ordinary content";
 for(const reverse of [false,true])assert.equal((await benchmarkApprovalDecision(request(scope,writeReadback('src/save.mjs',{reverse,body:literal})),scope)).action,'approve');
});

test('readback cannot introduce another path, flags, stages, delimiter breakout or trailing commands',async t=>{
 const scope=await setup(t);
 await fs.writeFile(path.join(scope.workspace,'test/readback.test.mjs'),'export {};');
 assert.equal((await benchmarkApprovalDecision(request(scope,'cat test/readback.test.mjs'),scope)).action,'approve');
 for(const reverse of [false,true]){
  const command=writeReadback('src/save.mjs',{reverse});
  for(const invalid of [
   command.replace(/cat src\/save\.mjs$/,'cat TASK.md'),
   command.replace(/cat src\/save\.mjs$/,'cat test/readback.test.mjs'),
   command.replace(/cat src\/save\.mjs$/,'cat src/save.mjs test/new.test.mjs'),
   command.replace(/cat src\/save\.mjs$/,'cat -n src/save.mjs'),
   command.replace(/cat src\/save\.mjs$/,'cat ./src/save.mjs'),
   command+'\npwd',command+'; pwd',command+' && pwd',command+' | sh',command+' > test/new.test.mjs',
   command.replace('\nEOF\ncat','\nEOF\npwd\nEOF\ncat'),
   command.replace('\nEOF\ncat','\nEOF\n\ncat'),
   command.replace("<<'EOF'",'<<EOF'),
  ])assert.equal((await benchmarkApprovalDecision(request(scope,invalid),scope)).action,'pause',invalid);
  const third=request(scope,command);third.subject.stages=[{},{},{}];assert.equal((await benchmarkApprovalDecision(third,scope)).action,'pause');
  const single=request(scope,command.slice(0,command.lastIndexOf('\ncat ')));single.subject.stages=[{},{}];assert.equal((await benchmarkApprovalDecision(single,scope)).action,'pause');
 }
});

test('composed readback retains native scope and once-only approval requirements',async t=>{
 const scope=await setup(t);
 for(const modify of [r=>r.turnId='old',r=>r.sessionId='old',r=>r.subagentOrigin={agentId:'child'},r=>r.subject.workspaceRoot='/elsewhere',r=>r.currentRequirementId.approvalId='other',r=>r.currentRequirementId.sourceIndex=-1,r=>r.availableChoices=[r.availableChoices[1]],r=>r.availableChoices[0].scope='session',r=>r.availableChoices.push({...r.availableChoices[0],choiceId:'duplicate'})]){
  const raw=request(scope,writeReadback());raw.subject.stages=[{},{}];modify(raw);assert.equal((await benchmarkApprovalDecision(raw,scope)).action,'pause');
 }
});

test('composed readback retains frozen-file and symlink confinement',async t=>{
 const scope=await setup(t);
 const frozen='test/frozen-acceptance.test.mjs';assert.equal((await benchmarkApprovalDecision(request(scope,writeReadback(frozen)),{...scope,excludedFiles:[frozen]})).action,'pause');
 for(const file of ['TASK.md','../src/save.mjs','.hidden','/tmp/save.mjs'])assert.equal((await benchmarkApprovalDecision(request(scope,writeReadback(file)),scope)).action,'pause',file);
 await fs.symlink('save.mjs',path.join(scope.workspace,'src/link.mjs'));
 const linked={...scope,sourceFile:'src/link.mjs'};assert.equal((await benchmarkApprovalDecision(request(linked,writeReadback(linked.sourceFile)),linked)).action,'pause');
 await fs.symlink('../test',path.join(scope.workspace,'src/linkdir'));
 const parentLink={...scope,sourceFile:'src/linkdir/save.mjs'};assert.equal((await benchmarkApprovalDecision(request(parentLink,writeReadback(parentLink.sourceFile)),parentLink)).action,'pause');
});

async function publicTestSetup(t){
 const scope=await setup(t);for(const name of ['behavior','smoke'])await fs.writeFile(path.join(scope.workspace,'test',name+'.test.mjs'),'export {};');
 return{...scope,readFiles:[...scope.readFiles,'test/behavior.test.mjs','test/smoke.test.mjs'],excludedFiles:['test/frozen-acceptance.test.mjs','test/qualification-contract.test.mjs']};
}

test('exact public node --test is once-approved in its admitted worktree with at most one native stage',async t=>{
 const scope=await publicTestSetup(t);
 for(const stages of [undefined,[{}]]){
  const raw=request(scope,'node --test');if(stages)raw.subject.stages=stages;
  const out=await benchmarkApprovalDecision(raw,scope);assert.equal(out.action,'approve');assert.equal(out.kind,'public_test');assert.equal(out.decision.choiceId,'once');assert.deepEqual(out.decision.requirementId,raw.currentRequirementId);
 }
});

test('public-test permission rejects every additional argument, environment prefix and compound',async t=>{
 const scope=await publicTestSetup(t);
 for(const command of ['npm test','node -e ""','node --test test/behavior.test.mjs','node --test --test-reporter=tap','node --test ',' node --test','node  --test','node --test\n','NODE_OPTIONS=--inspect node --test','env node --test','/usr/bin/node --test','node --test; pwd','node --test && pwd','node --test | cat','node --test\npwd','cd . && node --test','node --test > out','node --test # comment'])assert.equal((await benchmarkApprovalDecision(request(scope,command),scope)).action,'pause',command);
 for(const count of [2,3]){const raw=request(scope,'node --test');raw.subject.stages=Array.from({length:count},()=>({}));assert.equal((await benchmarkApprovalDecision(raw,scope)).action,'pause');}
});

test('public-test permission retains native session, turn, workspace and once-choice boundaries',async t=>{
 const scope=await publicTestSetup(t);
 for(const modify of [r=>r.turnId='old',r=>r.sessionId='other',r=>r.subagentOrigin={agentId:'child'},r=>r.currentRequirementId.sourceIndex=-1,r=>r.currentRequirementId.approvalId='other',r=>r.subject.workspaceRoot='/elsewhere',r=>r.availableChoices.shift(),r=>r.availableChoices[0].scope='session',r=>r.availableChoices.push({...r.availableChoices[0],choiceId:'second'})]){const raw=request(scope,'node --test');modify(raw);assert.equal((await benchmarkApprovalDecision(raw,scope)).action,'pause');}
});

test('public-test discovery rejects symlinked source, test roots and public test files',async t=>{
 const source=await publicTestSetup(t);await fs.rename(path.join(source.workspace,'src/save.mjs'),path.join(source.workspace,'src/real.mjs'));await fs.symlink('real.mjs',path.join(source.workspace,'src/save.mjs'));assert.equal((await benchmarkApprovalDecision(request(source,'node --test'),source)).action,'pause');
 const directory=await publicTestSetup(t);await fs.rename(path.join(directory.workspace,'test'),path.join(directory.workspace,'real-test'));await fs.symlink('real-test',path.join(directory.workspace,'test'));assert.equal((await benchmarkApprovalDecision(request(directory,'node --test'),directory)).action,'pause');
 const file=await publicTestSetup(t);await fs.symlink('behavior.test.mjs',path.join(file.workspace,'test/link.test.mjs'));assert.equal((await benchmarkApprovalDecision(request(file,'node --test'),file)).action,'pause');
});

test('public-test discovery rejects frozen or unreviewed test entries inside the agent worktree',async t=>{
 const frozen=await publicTestSetup(t);await fs.writeFile(path.join(frozen.workspace,frozen.excludedFiles[0]),'export {};');assert.equal((await benchmarkApprovalDecision(request(frozen,'node --test'),frozen)).action,'pause');
 const nested=await publicTestSetup(t);await fs.mkdir(path.join(nested.workspace,'test/nested'));assert.equal((await benchmarkApprovalDecision(request(nested,'node --test'),nested)).action,'pause');
 const missing=await setup(t);assert.equal((await benchmarkApprovalDecision(request(missing,'node --test'),missing)).action,'pause');
});
