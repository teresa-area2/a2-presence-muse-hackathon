import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {approvalNativeFixture} from './helpers/approval-native-fixture.mjs';import {createStructuredServer} from '../structured-server.mjs';import {createEvidenceStore} from '../src/evidence-store.mjs';import {mountSessionPane} from '../web/session-panes.mjs';import {interruptionSettlement,canDecideCurrent,approvalFingerprint} from '../web/session-controls.mjs';
import {projectEvidence} from '../src/evidence-projection.mjs';
class Element{
 constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.attrs={};this.events={};this._text='';this.scrollTop=0;this.scrollHeight=500;this.clientHeight=500;}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 append(...nodes){for(const n of nodes)this.insertBefore(n,null);}insertBefore(n,before){n.remove();const i=before===null?this.children.length:this.children.indexOf(before);if(i<0)throw Error('missing');this.children.splice(i,0,n);n.parentNode=this;return n;}remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}replaceChildren(...nodes){for(const n of this.children)n.parentNode=null;this.children=[];this._text='';this.append(...nodes);}setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(k,fn){this.events[k]=fn;}click(){if(!this.disabled)this.events.click?.({stopPropagation(){}});}focus(){}
}
function dom(){const d={createElement:tag=>new Element(tag,d),createDocumentFragment:()=>new Element('fragment',d),createTextNode:text=>{const n=new Element('#text',d);n.textContent=text;return n;}};return d;}
const walk=(n,fn)=>[...(fn(n)?[n]:[]),...n.children.flatMap(x=>walk(x,fn))];
async function fixture(t){
 const native=approvalNativeFixture(),root=fileURLToPath(new URL('../',import.meta.url)),directory=await fs.mkdtemp(path.join(os.tmpdir(),'approval-journey-')),store=await createEvidenceStore({directory,debounceMs:0,metadata:{evidence_mode:'fixture'}});
 const server=createStructuredServer({root,labRoot:root,createPair:async()=>native.pair,evidenceStore:store,checkpointMs:60000});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,c=await(await fetch(base+'/api/config')).json();
 const post=(route,payload)=>fetch(base+'/api/'+route,{method:'POST',headers:{origin:base,'content-type':'application/json','x-terminal-token':c.token},body:JSON.stringify(route==='start'?payload:{generation:1,...payload})});assert.equal((await post('start',{})).status,200);
 const state=async()=>(await(await fetch(base+'/api/config')).json()).state;
 let action;function pane(arm){const d=dom(),container=new Element('div',d),view=mountSessionPane({container,arm,onDecide:(name,a,choiceId,options={})=>{action=post('decide',{arm:name,approvalId:a.approvalId,requirementId:a.requirementId,choiceId,reviewToken:a.review_token,...options,actor:'participant'});},onInterrupt:(name,binding)=>{action=post('interrupt',{target:name,expectedTurns:{[name]:binding.turnId},actor:'participant',generation:binding.generation});}});return{container,view,async render(options={}){view.render(await state(),{connected:true,pendingDecisions:new Map(),...options});},buttons:()=>walk(container,n=>n.tag==='button'),pres:()=>walk(container,n=>n.tag==='pre')};}
 t.after(async()=>{await server.shutdown();await fs.rm(directory,{recursive:true,force:true});});return{...native,server,post,state,pane,lastAction:()=>action,exported:async()=>{const r=await fetch(base+'/api/evidence?generation=1',{headers:{'x-terminal-token':c.token}});return r.json();}};
}
test('native file-access frame traverses exact UI, token-bound HTTP decision and native resolution for either arm',async t=>{
 for(const arm of ['without','with'])await t.test(arm,async t=>{
  const f=await fixture(t),pathText=' reports/  <script>.txt ',origin='printf " two  spaces "\ncat note.txt',preview='Read this path\n\tonce only';f.request(arm,{kind:'fileAccess',path:pathText,access:'write',toolName:'write_file',origin:{kind:'shellCommand',command:origin}},{protectedWrite:true,availableChoices:[{choiceId:'yes',label:'Allow once',decision:'approved',scope:'once',rulePreview:preview}]});
  const p=f.pane(arm);await p.render();const displayed=p.pres().map(x=>x.textContent);assert.ok(displayed.includes(pathText));assert.ok(displayed.includes(JSON.stringify(pathText)));assert.match(p.container.textContent,/Workspace-relative path/);assert.ok(displayed.includes(origin));assert.ok(displayed.includes(preview));assert.match(p.container.textContent,/Protected-file write/);assert.match(p.container.textContent,/Reported trigger \(untrusted\)/);assert.equal(walk(p.container,n=>n.tag==='script').length,0);assert.ok(!p.buttons().some(x=>x.textContent==='Remember'));
  p.buttons().find(x=>x.textContent==='Allow once').click();assert.equal((await f.lastAction()).status,200);assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,1);const sent=f.frames.find(x=>x.method==='approval/decide');assert.equal(sent.arm,arm);assert.equal(sent.params.choiceId,'yes');assert.deepEqual(sent.params.requirementId,{approvalId:'approval-'+arm,sourceIndex:0});
  await p.render();assert.equal(p.buttons().find(x=>x.textContent==='Allow once').disabled,true);assert.match(p.container.textContent,/pending or unconfirmed/);assert.equal((await f.state()).arms[arm].approval_decision_pending,true);
  f.notify(arm,'approval/resolved',{sessionId:f.sessions[arm].client.sessionId,turnId:f.sessions[arm].client.activeTurnId,approvalId:'approval-'+arm,resolvedBy:'user'});await p.render();assert.equal(p.buttons().filter(x=>x.textContent==='Allow once').length,0);assert.equal((await f.state()).arms[arm].approval_decision_pending,false);
 });
});
test('same-requirement command change between display and click is refused before a native decision',async t=>{
 const f=await fixture(t),p=f.request('with',{kind:'shell',command:'node --test',stages:[]}),pane=f.pane('with');await pane.render();
 f.notify('with','approval/updated',{sessionId:p.sessionId,approvalId:p.approvalId,currentRequirementId:p.currentRequirementId,subject:{kind:'shell',command:'pwd',stages:[]},change:{kind:'reviewStarted'}});
 pane.buttons().find(x=>x.textContent==='Allow once').click();const result=await f.lastAction();assert.equal(result.status,409);assert.equal((await result.json()).delivery,'not_started');assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,0);await pane.render();assert.ok(pane.pres().some(x=>x.textContent==='pwd'));
});
test('unsupported long requests recover only the affected native turn and require a cancelled terminal',async t=>{
 for(const arm of ['without','with'])await t.test(arm,async t=>{
  const f=await fixture(t),other=arm==='with'?'without':'with',command='SENSITIVE_COMMAND_'+ 'x'.repeat(256*1024+1);f.request(arm,{kind:'shell',command,stages:[]});const pane=f.pane(arm);await pane.render();assert.match(pane.container.textContent,/complete-review size limit/);assert.ok(!pane.container.textContent.includes(command));assert.equal(pane.buttons().filter(x=>/Allow|Reject/.test(x.textContent)).length,0);
  await pane.render({connected:false});assert.equal(pane.buttons().find(x=>x.textContent==='Interrupt this agent').disabled,true);await pane.render();pane.buttons().find(x=>x.textContent==='Interrupt this agent').click();const ack=await(await f.lastAction()).json();assert.equal(ack.outcome.status,'accepted');let state=await f.state();assert.equal(state.arms[arm].interrupt_pending,true);assert.equal(state.arms[other].status,'running');assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,0);assert.equal(f.frames.filter(x=>x.method==='turn/interrupt').length,1);
  const attempt={generation:1,expectedTurns:{[arm]:'turn-'+arm}};assert.equal(interruptionSettlement(state,attempt),'pending');await pane.render();assert.match(pane.container.textContent,/Waiting for Muse to end/);f.complete(arm);state=await f.state();assert.equal(interruptionSettlement(state,attempt),'ended');assert.equal(state.arms[arm].last_turn_terminal,'cancelled');assert.equal(state.arms[other].status,'running');
  const e=await f.exported(),diag=e.arms[arm].approval_diagnostics;assert.equal(diag.events[0].reason,'subject_too_large');assert.ok(!JSON.stringify(e).includes('SENSITIVE_COMMAND'));assert.ok(!JSON.stringify(diag).includes('approvalId'));assert.ok(!JSON.stringify(diag).includes('command'));
 });
});
test('unknown types have no decision; missing token and stale generation never dispatch; disconnection disables exact view',async t=>{
 const f=await fixture(t);f.request('with',{kind:'tool',toolName:'fetch'});const p=f.pane('with');await p.render();assert.match(p.container.textContent,/all details needed/);assert.equal(p.buttons().filter(x=>x.textContent==='Allow once').length,0);
 const invalid=await f.post('decide',{arm:'with',approvalId:'approval-with',requirementId:{approvalId:'approval-with',sourceIndex:0},choiceId:'once',actor:'participant'});assert.equal(invalid.status,409);assert.equal((await invalid.json()).delivery,'not_started');assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,0);
 const s=await f.state();assert.equal(canDecideCurrent({state:s,arm:'with',approval:s.arms.with.approvals[0],choiceId:'once',connected:false,pending:false}),false);assert.equal(approvalFingerprint(s.arms.with.approvals[0]),null);
});
test('a documented multi-stage request shows the full command and the exact current stage argument boundaries',async t=>{
 const f=await fixture(t),id='approval-with',requirement=i=>({approvalId:id,sourceIndex:i}),command="printf done && node --test ''",stages=[{position:1,totalStages:2,requirementId:requirement(0),argv:['printf','done'],argvComplete:true,resolution:{kind:'knownSafe'}},{position:2,totalStages:2,requirementId:requirement(1),argv:['node','--test',''],argvComplete:false,resolution:{kind:'unresolved'}}];
 f.request('with',{kind:'shell',command,workspaceRoot:'/synthetic/  project ',stages},{currentRequirementId:requirement(1)});const pane=f.pane('with');await pane.render();const pre=pane.pres().map(x=>x.textContent);assert.ok(pre.includes(command));assert.ok(pre.includes('/synthetic/  project '));assert.ok(pre.includes('["node","--test",""]'));assert.match(pane.container.textContent,/stage 2 of 2/);assert.match(pane.container.textContent,/parse is partial/);
 pane.buttons().find(x=>x.textContent==='Allow once').click();assert.equal((await f.lastAction()).status,200);assert.deepEqual(f.frames.find(x=>x.method==='approval/decide').params.requirementId,requirement(1));
});
test('exact bound-length commands remain complete; oversized and ambiguous choices never acquire decision controls',async t=>{
 const f=await fixture(t),command='x'.repeat(12000);f.request('without',{kind:'shell',command});const pane=f.pane('without');await pane.render();assert.ok(pane.pres().some(x=>x.textContent===command));assert.equal(pane.buttons().find(x=>x.textContent==='Allow once').disabled,false);
 f.request('with',{kind:'fileAccess',path:'private-plan.txt',access:'read',toolName:'read_file'},{availableChoices:[{choiceId:'same',label:'Allow once',decision:'approved',scope:'once'},{choiceId:'same',label:'Reject',decision:'denied',scope:'once'}]});const right=f.pane('with');await right.render();assert.match(right.container.textContent,/ambiguous decision/);assert.equal(right.buttons().filter(x=>x.textContent==='Allow once').length,0);assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,0);
});
test('a retired recovery control cannot interrupt a later turn or the sibling arm',async t=>{
 const f=await fixture(t);f.request('with',{kind:'process',toolName:'control_process',target:'synthetic'});const p=f.pane('with');await p.render();const old=p.buttons().find(x=>x.textContent==='Interrupt this agent');await f.post('interrupt',{target:'with',expectedTurns:{with:'turn-with'},actor:'participant'});f.complete('with');await p.render();old.click();assert.equal(f.lastAction(),undefined);assert.equal(f.frames.filter(x=>x.method==='turn/interrupt').length,1);assert.equal((await f.state()).arms.without.status,'running');
});
test('diagnostic checkpoints keep only bounded reason/time/ordinal and preserve unknown omission counts',()=>{
 const events=Array.from({length:90},(_,i)=>({at:'2026-11-02T14:00:00.000Z',reason:i===89?'PRIVATE_REASON':'subject_too_large',turn_ordinal:2,command:'SECRET_COMMAND',path:'/PRIVATE/PATH',credentials:'SECRET'}));
 const projected=projectEvidence({arms:{with:{approval_diagnostics:{events,events_omitted:7,raw:'SECRET'},approval_decision_pending:true}}});const d=projected.arms.with.approval_diagnostics;
 assert.equal(d.events.length,63);assert.equal(d.events_omitted,7);assert.equal(d.projection_omitted,26);assert.equal(d.rejected_events,1);for(const e of d.events)assert.deepEqual(Object.keys(e).sort(),['at','reason','turn_ordinal']);assert.ok(!JSON.stringify(d).includes('SECRET'));assert.ok(!JSON.stringify(d).includes('PRIVATE'));
 assert.equal(projectEvidence({arms:{with:{approval_diagnostics:{}}}}).arms.with.approval_diagnostics.events_omitted,null);
});


test('absolute file paths are labeled without rewriting; action effect comes from decision rather than host label or ID',async t=>{
 const f=await fixture(t),target='/synthetic/private/note.txt';f.request('with',{kind:'fileAccess',path:target,access:'read',toolName:'read_file'},{availableChoices:[{choiceId:'deny-looking-id',label:'Deny',decision:'approved',scope:'once'}]});const p=f.pane('with');await p.render();assert.match(p.container.textContent,/Absolute path/);assert.ok(p.pres().some(x=>x.textContent===target));assert.ok(p.pres().some(x=>x.textContent==='Muse option: Deny'));const allow=p.buttons().find(x=>x.textContent==='Allow once');assert.ok(allow);assert.equal(allow.title,'Approve this request once');allow.click();assert.equal((await f.lastAction()).status,200);assert.equal(f.frames.find(x=>x.method==='approval/decide').params.choiceId,'deny-looking-id');
});
test('local recovery preparation blocks decisions on that arm before server acknowledgement while sibling stays reviewable',async t=>{
 const f=await fixture(t);f.request('with',{kind:'process',toolName:'control',target:'synthetic'});f.request('with',{kind:'shell',command:'node --test'},{approvalId:'second',currentRequirementId:{approvalId:'second',sourceIndex:0}});f.request('without',{kind:'shell',command:'pwd'});const right=f.pane('with'),left=f.pane('without');await right.render({pendingRecovery:true});await left.render();assert.equal((await f.state()).arms.with.interrupt_pending,false);assert.equal(right.buttons().find(x=>x.textContent==='Allow once').disabled,true);right.buttons().find(x=>x.textContent==='Allow once').click();assert.equal(f.lastAction(),undefined);assert.equal(left.buttons().find(x=>x.textContent==='Allow once').disabled,false);left.buttons().find(x=>x.textContent==='Allow once').click();assert.equal((await f.lastAction()).status,200);assert.deepEqual(f.frames.filter(x=>x.method==='approval/decide').map(x=>x.arm),['without']);
});

test('Windows-looking filenames stay workspace-relative on the supported POSIX native hosts',async t=>{
 const f=await fixture(t),target=String.raw`C:\name`;f.request('with',{kind:'fileAccess',path:target,access:'read',toolName:'read_file'});const p=f.pane('with');await p.render();assert.match(p.container.textContent,/Workspace-relative path/);assert.ok(!p.container.textContent.includes('Absolute path'));assert.ok(p.pres().some(x=>x.textContent===target));
});


test('all native approval types traverse the real JSONL client, complete card and exact decision in either arm',async t=>{
 const subjects=[{kind:'shell',command:'printf example'},{kind:'fileAccess',path:'src/note.txt',access:'write',toolName:'tool'},{kind:'network',host:'example.test',port:443,protocol:'https',toolName:'tool'},{kind:'unixSocket',path:'/tmp/example.sock',toolName:'tool'},{kind:'process',target:'synthetic process',access:'control',toolName:'tool'},{kind:'tool',toolName:'tool'},{kind:'futureAction',toolName:'tool',newField:'native extension'}];
 for(const arm of ['without','with'])for(const subject of subjects)await t.test(arm+':'+subject.kind,async t=>{
  const f=await fixture(t);f.request(arm,subject,{toolName:'tool',rawArgs:'{"action":"synthetic"}',subagentOrigin:{childRunId:'child-run',childSessionId:'child-session',subagentId:'child-agent'}});
  const pane=f.pane(arm);await pane.render();const approval=(await f.state()).arms[arm].approvals[0];assert.equal(approval.status,'review');assert.ok(pane.pres().some(n=>n.textContent===approval.subject_display));assert.match(pane.container.textContent,/Requested by a child agent/);
  const button=pane.buttons().find(n=>n.textContent==='Allow once');assert.ok(button);button.click();assert.equal((await f.lastAction()).status,200);const wire=f.frames.filter(x=>x.method==='approval/decide');assert.equal(wire.length,1);assert.equal(wire[0].params.sessionId,f.sessions[arm].client.sessionId);assert.equal(wire[0].params.choiceId,'once');assert.deepEqual(wire[0].params.requirementId,approval.requirementId);
 });
});
test('explicit session, persistent and future choices keep native IDs and clearly show their scopes',async t=>{
 for(const choice of [{choiceId:'host session / Ω',label:'Allow session',decision:'approvedForSession',scope:'session'},{choiceId:'policy',label:'Remember this rule',decision:'approvedPolicyAmendment',scope:'localPersistent',rulePreview:'Exact native grant'}, {choiceId:'opaque',label:'Native future option',decision:'futureDecision',scope:'futureScope',extraNativeField:'Show this too'}])await t.test(choice.scope,async t=>{
  const f=await fixture(t);f.request('with',{kind:'network',host:'example.test',toolName:'fetch'},{availableChoices:[choice]});const pane=f.pane('with');await pane.render();assert.ok(pane.container.textContent.includes(choice.scope==='session'?'Rest of this session':choice.scope==='localPersistent'?'Saved in local policy':'Native scope: futureScope'));
  if(choice.extraNativeField)assert.ok(pane.container.textContent.includes('Show this too'));pane.buttons()[0].click();assert.equal((await f.lastAction()).status,200);const wire=f.frames.find(x=>x.method==='approval/decide');assert.equal(wire.params.choiceId,choice.choiceId);assert.equal(Object.hasOwn(wire.params,'feedback'),false);
 });
});
test('optional denial feedback reaches Muse exactly and never the evidence checkpoint',async t=>{
 const f=await fixture(t);f.request('with',{kind:'tool',toolName:'tool'},{toolName:'tool',rawArgs:'{"local":"PRIVATE_TOOL_ARGUMENTS"}',availableChoices:[{choiceId:'deny',label:'Reject',decision:'denied',scope:'once',acceptsFeedback:true}]});const pane=f.pane('with');await pane.render();const input=walk(pane.container,n=>n.tag==='textarea')[0];assert.ok(input);input.value='PRIVATE_FEEDBACK: use the project folder';pane.buttons().find(x=>x.textContent==='Reject').click();assert.equal((await f.lastAction()).status,200);const wire=f.frames.find(x=>x.method==='approval/decide');assert.equal(wire.params.feedback,input.value);const e=JSON.stringify(await f.exported());assert.ok(!e.includes('PRIVATE_TOOL_ARGUMENTS'));assert.ok(!e.includes('PRIVATE_FEEDBACK'));
});
test('feedback on a choice that does not accept it is rejected before dispatch or pending lock',async t=>{
 const f=await fixture(t);f.request('with',{kind:'shell',command:'pwd'});const a=(await f.state()).arms.with.approvals[0];const response=await f.post('decide',{arm:'with',approvalId:a.approvalId,requirementId:a.requirementId,choiceId:'once',reviewToken:a.review_token,feedback:'Not permitted',actor:'participant'});assert.equal(response.status,409);assert.equal((await response.json()).delivery,'not_started');assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,0);assert.equal((await f.state()).arms.with.approval_decision_pending,false);
});
test('CUA card shows masked data and never sensitive raw input; changed hidden input invalidates the old decision',async t=>{
 const f=await fixture(t),facts={windowTitle:'Synthetic browser',page:{host:'example.test',hostAscii:'example.test'},steps:[{step:1,kind:'verb:type',action:'type into',label:'Access token',roleWord:'field',effect:'Sends credential to this page'}],data:[{kind:'secret',secretKind:'token',mask:{prefix:'test_',last4:'1234',chars:36}}]};
 const p=f.request('with',{kind:'tool',toolName:'computer'},{toolName:'computer',rawArgs:'PRIVATE_CUA_INPUT',cuaCardFacts:facts,availableChoices:[{choiceId:'once',label:'Allow once',decision:'approved',scope:'once'}]});const pane=f.pane('with');await pane.render();assert.match(pane.container.textContent,/test_/);assert.match(pane.container.textContent,/1234/);assert.ok(!pane.container.textContent.includes('PRIVATE_CUA_INPUT'));assert.match(pane.container.textContent,/Sensitive input values are omitted/);
 f.notify('with','approval/updated',{sessionId:p.sessionId,approvalId:p.approvalId,currentRequirementId:p.currentRequirementId,rawArgs:'CHANGED_PRIVATE_CUA_INPUT',change:{kind:'reviewCompleted'}});pane.buttons().find(x=>x.textContent==='Allow once').click();assert.equal((await f.lastAction()).status,409);assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,0);
});
test('large native commands stay complete and excess simultaneous review cards queue then appear',async t=>{
 const f=await fixture(t),command='echo '+ 'x'.repeat(110000);for(let i=0;i<6;i++)f.request('with',{kind:'shell',command},{approvalId:'large-'+i,currentRequirementId:{approvalId:'large-'+i,sourceIndex:0}});
 let state=await f.state(),approvals=state.arms.with.approvals;assert.ok(approvals.some(a=>a.reason==='review_queued'));assert.ok(approvals.filter(a=>a.status==='review').every(a=>a.command===command));assert.ok(Buffer.byteLength(JSON.stringify(approvals))<1024*1024+2048);
 const first=approvals.find(a=>a.status==='review');f.notify('with','approval/resolved',{sessionId:f.sessions.with.client.sessionId,turnId:f.sessions.with.client.activeTurnId,approvalId:first.approvalId,resolvedBy:'user'});const next=(await f.state()).arms.with.approvals;assert.ok(next.filter(a=>a.status==='review').length>=approvals.filter(a=>a.status==='review').length);assert.ok(next.some(a=>a.status==='review'&&a.approvalId==='large-4'));
});


test('native script arguments remain complete and actionable through JSONL, projection, pane and HTTP',async t=>{
 const cases=[
  {name:'multiline JavaScript',command:"node -e 'console.log(1)\nconsole.log(2)'",argv:['node','-e','console.log(1)\nconsole.log(2)'],complete:true},
  {name:'tab in script argument',command:"node -e 'const x = 1;\tconsole.log(x)'",argv:['node','-e','const x = 1;\tconsole.log(x)'],complete:true},
  {name:'argument over the former 4096 limit',command:'node -e '+ 'x'.repeat(5000),argv:['node','-e','x'.repeat(5000)],complete:true},
  {name:'more than 64 arguments',command:'printf '+Array.from({length:70},(_,i)=>'arg'+i).join(' '),argv:['printf',...Array.from({length:70},(_,i)=>'arg'+i)],complete:true},
  {name:'unparsed multiline shell fragment',command:'if true; then\n  printf done\nfi',argv:['if true; then\n  printf done\nfi'],complete:false},
  {name:'escaped Unicode in parsed arguments',command:"printf $'\\u202e\\u2028'",argv:['printf','\u202e\u2028'],complete:true},
  {name:'DEL and C1 in parsed arguments',command:'printf "$VALUE"',argv:['printf','\u007f\u0085\u009b'],complete:true},
 ];
 for(const row of cases)await t.test(row.name,async t=>{
  const f=await fixture(t),id='approval-with',requirementId={approvalId:id,sourceIndex:0},stages=[{position:1,totalStages:1,requirementId,argv:row.argv,argvComplete:row.complete,resolution:{kind:'unresolved'}}];
  f.request('with',{kind:'shell',command:row.command,stages});const state=await f.state(),approval=state.arms.with.approvals[0];assert.equal(approval.status,'review',row.name);assert.ok(approvalFingerprint(approval));assert.deepEqual(approval.subject.stage.argv,row.argv);
  const pane=f.pane('with');await pane.render();assert.ok(pane.pres().some(p=>p.textContent===row.command));const args=pane.pres().find(p=>{try{return Array.isArray(JSON.parse(p.textContent));}catch{return false;}});assert.ok(args);assert.deepEqual(JSON.parse(args.textContent),row.argv);assert.ok(!/[\u007f-\u009f\u202e\u2028]/u.test(args.textContent));
  const allow=pane.buttons().find(b=>b.textContent==='Allow once');assert.ok(allow&&!allow.disabled);assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,0);allow.click();assert.equal((await f.lastAction()).status,200);const decisions=f.frames.filter(x=>x.method==='approval/decide');assert.equal(decisions.length,1);assert.equal(decisions[0].arm,'with');assert.deepEqual(decisions[0].params.requirementId,requirementId);assert.equal(decisions[0].params.choiceId,'once');
 });
});
test('native prefix and diagnostic strings use the same complete escaped review budget',async t=>{
 const f=await fixture(t),id='approval-with',requirement=i=>({approvalId:id,sourceIndex:i}),argv=['node','-e','console.log(1)\nconsole.log(2)'],stages=[
  {position:1,totalStages:3,requirementId:requirement(0),argv:['true'],argvComplete:true,resolution:{kind:'policyAllow',diagnostic:''}},
  {position:2,totalStages:3,requirementId:requirement(1),argv,argvComplete:true,resolution:{kind:'policyAmendment',argvPrefix:argv}},
  {position:3,totalStages:3,requirementId:requirement(2),argv,argvComplete:true,resolution:{kind:'unresolved'},suggestedPrefix:{argvPrefix:argv,label:''}},
 ];
 f.request('with',{kind:'shell',command:'true && node -e "synthetic" && node -e "synthetic"',stages},{currentRequirementId:requirement(2)});const approval=(await f.state()).arms.with.approvals[0];assert.equal(approval.status,'review');assert.deepEqual(JSON.parse(approval.subject_display).stages,stages);const pane=f.pane('with');await pane.render();assert.ok(pane.buttons().find(b=>b.textContent==='Allow once'&&!b.disabled));
});
test('complete long file-access shell trigger is reviewable rather than rejected by the old 12000 limit',async t=>{
 const f=await fixture(t),command='printf '+ 'x'.repeat(13000);f.request('with',{kind:'fileAccess',path:'sample.txt',access:'write',toolName:'bash',origin:{kind:'shellCommand',command}});const pane=f.pane('with');await pane.render();assert.ok(pane.pres().some(p=>p.textContent===command));const allow=pane.buttons().find(b=>b.textContent==='Allow once');assert.ok(allow&&!allow.disabled);
});

test('changed script arguments revoke the old review token without sending a stale decision',async t=>{
 const f=await fixture(t),id='approval-with',requirementId={approvalId:id,sourceIndex:0},subject={kind:'shell',command:"node -e 'console.log(1)\nconsole.log(2)'",stages:[{position:1,totalStages:1,requirementId,argv:['node','-e','console.log(1)\nconsole.log(2)'],argvComplete:true,resolution:{kind:'unresolved'}}]};
 const native=f.request('with',subject),old=(await f.state()).arms.with.approvals[0];assert.equal(old.status,'review');const changed=structuredClone(subject);changed.stages[0].argv[2]+='\nconsole.log(3)';changed.command="node -e 'console.log(1)\nconsole.log(2)\nconsole.log(3)'";f.notify('with','approval/updated',{sessionId:native.sessionId,turnId:native.turnId,approvalId:id,subject:changed});const fresh=(await f.state()).arms.with.approvals[0];assert.equal(fresh.status,'review');assert.notEqual(fresh.review_token,old.review_token);
 const response=await f.post('decide',{arm:'with',approvalId:id,requirementId,choiceId:'once',reviewToken:old.review_token,actor:'participant'});assert.equal(response.status,409);assert.equal((await response.json()).delivery,'not_started');assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,0);
});
test('argument review retains field/view bounds and refuses forged stage identity',async t=>{
 for(const kind of ['non-string','field-budget','view-budget','foreign-stage'])await t.test(kind,async t=>{
  const f=await fixture(t),id='approval-with',requirementId={approvalId:id,sourceIndex:0},stage={position:1,totalStages:1,requirementId,argv:['node','-e','ok'],argvComplete:true,resolution:{kind:'unresolved'}};
  if(kind==='non-string')stage.argv.push(1);if(kind==='field-budget')stage.argv[2]='x'.repeat(256*1024+1);if(kind==='view-budget')stage.argv=Array.from({length:10},()=>'x'.repeat(60000));if(kind==='foreign-stage')stage.requirementId={approvalId:'foreign',sourceIndex:0};
  f.request('with',{kind:'shell',command:'node -e synthetic',stages:[stage]});const approval=(await f.state()).arms.with.approvals[0];assert.equal(approval.status,'unsupported');const pane=f.pane('with');await pane.render();assert.ok(!pane.buttons().some(b=>b.textContent==='Allow once'));assert.equal(f.frames.filter(x=>x.method==='approval/decide').length,0);
 });
});
