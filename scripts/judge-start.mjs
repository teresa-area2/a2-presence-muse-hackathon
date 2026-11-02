import path from'node:path';import{fileURLToPath}from'node:url';import{assertJudgePlatform,judgePlatformMessage}from'../src/judge-platform.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));let privateAccess,app;
const controller=new AbortController(),abort=()=>controller.abort();
// Do not exit midway through setup: let each owned async operation settle, then
// close its resources in finally, even if interruption arrives before listen.
process.on('SIGINT',abort);process.on('SIGTERM',abort);process.on('SIGHUP',abort);
const check=()=>{if(controller.signal.aborted)throw Error('judge_cancelled');};
try{
 assertJudgePlatform();
 const [major,minor]=process.versions.node.split('.').map(Number);if(major!==22||minor<12)throw Error('judge_node_22_12_required');
 const {readJudgeAccess,prepareJudgeAccess,judgeArguments}=await import('../src/judge-access.mjs');
 const options=judgeArguments(process.argv.slice(2)),port=options.port??8930;
 if(options.consent){const bundle=await readJudgeAccess(options.access??path.join(root,'judge-access/temporary-credentials.json'),{purpose:'start'});check();privateAccess=await prepareJudgeAccess(bundle,{repoRoot:root});check();}
 const {buildStructuredLauncher,canonicalWorkspaceEnvironment}=await import('../structured-live.mjs'),{prepareCodingTaskProfiles}=await import('../src/coding-task-profiles.mjs');
 check();const environment=canonicalWorkspaceEnvironment({...process.env,...privateAccess?.environment,A2_MUSE_PRESENCE_SOURCE:'textbox',A2_MUSE_OP_LIVE:options.consent?'1':'0',A2_MUSE_CAPTURE_AUTHORIZED:options.consent?'1':'0'});
 const taskProfiles=await prepareCodingTaskProfiles({sourceRoot:root,localRoot:path.join(root,'.local'),environment});check();app=await buildStructuredLauncher({environment,taskProfiles,keepWorkspaceOpen:true,presentationGuidance:true,presentationVersion:3});check();
 await new Promise((resolve,reject)=>app.server.listen(port,'127.0.0.1',resolve).once('error',reject));check();app.reconcile();
 console.log('Judge workspace: http://127.0.0.1:'+app.server.address().port+'/');console.log(options.consent?'Live textbox Presence enabled by your explicit typing-metadata consent.':'Live Presence is off. Restart with --consent-typing after reading docs/JUDGE-QUICKSTART.md.');console.log('Open sessions starts no model turn. Send uses your own Muse entitlement. Ctrl-C closes this workspace.');
 await new Promise(resolve=>{if(controller.signal.aborted)resolve();else controller.signal.addEventListener('abort',resolve,{once:true});});
}catch(e){if(e.message!=='judge_cancelled'){console.error(judgePlatformMessage(e)??(e.code==='EADDRINUSE'?'judge_port_in_use_use_existing_workspace_or_choose_another_port':/^judge_[a-z0-9_]+$/.test(e.message)?e.message:'judge_start_failed_see_docs'));process.exitCode=1;}}
finally{let failed=false;try{await app?.close();}catch{failed=true;}try{await privateAccess?.cleanup();}catch{failed=true;}process.off('SIGINT',abort);process.off('SIGTERM',abort);process.off('SIGHUP',abort);if(failed){console.error('judge_cleanup_unconfirmed');process.exitCode=1;}}
