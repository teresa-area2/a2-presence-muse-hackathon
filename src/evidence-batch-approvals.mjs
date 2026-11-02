// Equal, explicit benchmark permissions. Presence never selects this policy.
import path from 'node:path';import fs from 'node:fs/promises';
export const EVIDENCE_APPROVAL_POLICY=Object.freeze({version:3,mode:'fixture-scoped',duration:'once',grants:['listed task-file reads','literal quoted-heredoc writes to source/public tests, optionally followed by one same-file readback','native read/write access to those files','exact node --test for public project tests in the admitted worktree'],excludes:['other program execution','network','installation','persistent grants','subagents','hidden state','frozen acceptance files','paths outside the benchmark worktree'],checks:'separate frozen sandbox verifier; native public-test execution is not CI qualification',actor:'benchmark_policy_not_participant'});
const clean=p=>typeof p==='string'&&p.length<=180&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..'||x.startsWith('.'))&&/^[A-Za-z0-9_./-]+$/.test(p);
function permitted(name,{sourceFile,readFiles},write){return clean(name)&&(name===sourceFile||/^test\/[A-Za-z0-9_-]+\.test\.mjs$/.test(name)||!write&&readFiles.includes(name));}
async function confined(workspace,name,write){let cursor=workspace;for(const part of name.split('/')){cursor=path.join(cursor,part);const st=await fs.lstat(cursor).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(st?.isSymbolicLink())return false;if(!st)return write&&cursor===path.join(workspace,name);if(cursor!==path.join(workspace,name)&&!st.isDirectory())return false;}return true;}
async function publicTestsConfined({workspace,sourceFile,readFiles,excludedFiles}){
 try{
  for(const name of new Set([sourceFile,...readFiles]))if(!clean(name)||excludedFiles.includes(name)||!await confined(workspace,name,false)||!(await fs.lstat(path.join(workspace,name))).isFile())return false;
  // Frozen checks belong only to the verifier overlay. Refuse any copy or link
  // inside the agent workspace before Node's default test discovery can see it.
  for(const name of excludedFiles){
   if(!clean(name))return false;let cursor=workspace;
   for(const part of name.split('/')){cursor=path.join(cursor,part);const st=await fs.lstat(cursor).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!st)break;if(st.isSymbolicLink()||cursor===path.join(workspace,name)||!st.isDirectory())return false;}
  }
  const directory=path.join(workspace,'test'),info=await fs.lstat(directory);if(info.isSymbolicLink()||!info.isDirectory())return false;
  const entries=await fs.readdir(directory,{withFileTypes:true});return entries.length>0&&entries.every(entry=>entry.isFile()&&/^test\/[A-Za-z0-9_-]+\.test\.mjs$/.test('test/'+entry.name)&&!excludedFiles.includes('test/'+entry.name));
 }catch{return false;}
}
export async function benchmarkApprovalDecision(raw,{workspace,sourceFile,readFiles,excludedFiles=[],sessionId,turnId}={}){
 const pause=reason=>({action:'pause',reason});
 if(!Array.isArray(readFiles)||!Array.isArray(excludedFiles)||!clean(sourceFile)||typeof sessionId!=='string'||!sessionId||typeof turnId!=='string'||!turnId)return pause('unqualified_policy_scope');
 if(!raw||typeof raw.approvalId!=='string'||!raw.approvalId||raw.sessionId!==sessionId||raw.turnId!==turnId||raw.subagentOrigin||raw.currentRequirementId?.approvalId!==raw.approvalId||!Number.isSafeInteger(raw.currentRequirementId.sourceIndex)||raw.currentRequirementId.sourceIndex<0)return pause('unqualified_native_scope');
 const choice=Array.isArray(raw.availableChoices)?raw.availableChoices.filter(c=>c.scope==='once'&&c.decision==='approved'):null;if(choice?.length!==1||typeof choice[0].choiceId!=='string'||!choice[0].choiceId)return pause('unqualified_native_choice');
 if(!path.isAbsolute(workspace??'')||await fs.realpath(workspace)!==workspace)return pause('unqualified_workspace');
 const subject=raw.subject;let files=[],write=false;
 if(subject?.kind==='fileAccess'){
  if(!['read','write'].includes(subject.access))return pause('unsupported_access');write=subject.access==='write';files=[subject.path];
 }else if(subject?.kind==='shell'){
  if(subject.workspaceRoot!==workspace||typeof subject.command!=='string'||subject.command.length>12000||(subject.stages?.length??0)>2)return pause('unqualified_shell_scope');
  const command=subject.command;
  const heredoc=command.match(/^cat > ([A-Za-z0-9_./-]+) <<'([A-Z_][A-Z_0-9]{0,31})'\n([\s\S]*)\n\2(?:\n(cat \1))?\n?$/)||command.match(/^cat <<'([A-Z_][A-Z_0-9]{0,31})' > ([A-Za-z0-9_./-]+)\n([\s\S]*)\n\1(?:\n(cat \2))?\n?$/);
  // Only the exact write-plus-same-file-readback grammar may have two stages.
  if((subject.stages?.length??0)>(heredoc?.[4]?2:1))return pause('unqualified_shell_scope');
  if(command==='node --test'){
   if(!await publicTestsConfined({workspace,sourceFile,readFiles,excludedFiles}))return pause('outside_reviewed_public_test_scope');
   return{action:'approve',kind:'public_test',decision:{approvalId:raw.approvalId,requirementId:{...raw.currentRequirementId},choiceId:choice[0].choiceId}};
  }
  if(heredoc){const reverse=command.startsWith('cat <<'),delimiter=heredoc[reverse?1:2];files=[heredoc[reverse?2:1]];write=true;if(heredoc[3].split('\n').includes(delimiter))return pause('ambiguous_heredoc');}
  else if(command==='pwd'||command==='ls'||command==='ls -la')return{action:'approve',kind:'inspection',decision:{approvalId:raw.approvalId,requirementId:{...raw.currentRequirementId},choiceId:choice[0].choiceId}};
  else if(/^cat [A-Za-z0-9_./ -]+$/.test(command))files=command.slice(4).split(' ');
  else return pause('outside_reviewed_command_policy');
 }else return pause('unsupported_native_subject');
 if(files.length<1||files.length>8)return pause('unqualified_files');
 for(const name of files)if(excludedFiles.includes(name)||!permitted(name,{sourceFile,readFiles},write)||!await confined(workspace,name,write))return pause('outside_reviewed_file_scope');
 return{action:'approve',kind:write?'literal_task_edit':'task_read',decision:{approvalId:raw.approvalId,requirementId:{...raw.currentRequirementId},choiceId:choice[0].choiceId}};
}
export const EVIDENCE_WORKSPACE_INSTRUCTIONS='Benchmark permissions apply equally to both agents. Read TASK.md and CONTRACT.md. You may run exactly node --test for public project tests; distinguish checks you actually ran from supplied results. The harness separately checks public and frozen contracts immediately after implementation. If checks fail, it sends feedback from your own artifact for at most one repair and recheck. Agent test claims do not qualify harness CI. The reviewed command scope also permits pwd, ls, cat with listed task files, native file read/write of task source/public tests, and literal writes such as cat > src/example.mjs <<\'EOF\' followed by literal file content and EOF on its own line. The only permitted compound is that literal write immediately followed by cat of the same file on the next line. Other commands require a human decision. No networking, installation, persistent grants or edits to hidden state. Use your normal tools and judgment within this scope.';
