import {installNativeApprovalAdapter} from './native-approval-adapter.mjs';
import {MuseDelivery} from './muse-delivery.mjs';
// Construct owned Muse sessions only after caller has prepared and validated
// both isolated workspaces. No model turn is sent by this function.
import path from 'node:path';import {openMemoryMuseSession,humanSandboxPosture} from './memory-muse-session.mjs';import {SessionUsage} from './session-usage.mjs';import {StructuredPair,confirmOwnedExit} from './structured-pair.mjs';import {nativeControls} from './native-controls.mjs';import {terminalEnvironment} from './terminal-env.mjs';import {readTerminalHookSettings} from './terminal-settings.mjs';
import {DEFAULT_COMPARISON_MODEL,requireComparisonModel} from './comparison-model.mjs';
const names=['without','with'];
export async function createStructuredPair({components:c,workspaces,environment,armEnvironments=null,prepareBoundary,signal=null,observeDelivery=true,sharedQualityInstructions=null,presenceBridge=null,model=DEFAULT_COMPARISON_MODEL,nativeQuestions=false}){
 if(typeof nativeQuestions!=='boolean'||!c?.msp||!c?.events||!c?.factory||typeof c.museEnvironment!=='function'||!workspaces||!names.every(n=>path.isAbsolute(workspaces[n]))||typeof prepareBoundary!=='function'||!environment||(armEnvironments!==null&&(!armEnvironments||!names.every(n=>armEnvironments[n]&&typeof armEnvironments[n]==='object'))))throw Error('structured_factory_invalid');
 model=requireComparisonModel(model);environment=terminalEnvironment(environment);const owned=[],buffers=new Map();let broker=null,pair=null,brokerClose=null,startupError=null;
 const closeBroker=()=>{if(!brokerClose)brokerClose=Promise.resolve().then(()=>broker?.close());return brokerClose;};const checkCancelled=()=>{if(signal?.aborted)throw Error('opening_cancelled');};
 try{
  checkCancelled();broker=presenceBridge??await c.startMuseWarmBroker({python:c.python,probe:c.probe,state:c.state});if(presenceBridge&&(!path.isAbsolute(broker.socket)||typeof broker.prepareBoundary!=='function'||typeof broker.close!=='function'))throw Error('textbox_bridge_invalid');checkCancelled();const sessions={};
  for(const name of names){
   checkCancelled();const workspace=workspaces[name],selected=armEnvironments?terminalEnvironment(armEnvironments[name]):environment,armEnvironment=c.museEnvironment(workspace,selected);if(observeDelivery)armEnvironment.MUSE_TRANSPORT_TRACE='1';const argv=c.msp.museServeCommand({workspace,arm:name,binary:c.binary,probe:presenceBridge?process.execPath:c.probe,state:presenceBridge?broker.socket:c.state,environment:armEnvironment,read:readTerminalHookSettings,model,provider:'meta',preset:'miniswe',baselineOnly:false,...(name==='with'?{brokerSocket:broker.socket}:{}),prepareBoundary:presenceBridge?options=>broker.prepareBoundary(options):prepareBoundary});checkCancelled();
   if(nativeQuestions){for(let i=argv.length-1;i>=0;i--)if(argv[i]==='--disable-request-user-input')argv.splice(i,1);}
   // Disable optional foreign personal context equally; task/workspace instructions remain available.
   argv.push('--no-session-log',...nativeControls(c.factory.MUSE_SESSION_CONTROLS),'--sandbox-network','restricted','--trust-workspace');
   for(const key of ['context.foreign_personal_rules','context.foreign_personal_skills']){
    const expected=key+'=false',prior=argv.flatMap((value,index)=>(value==='-c'||value==='--config')&&argv[index+1]?.startsWith(key+'=')?[argv[index+1]]:[]);
    if(prior.length>1||prior.some(value=>value!==expected))throw Error('foreign_personal_context_unqualified');
    // Muse rejects duplicate settings, even identical values from batch wrappers.
    if(!prior.length)argv.push('-c',expected);
   }
   const client=c.msp.spawnMuseMsp({workspace,argv,environment:armEnvironment});owned.push(client);installNativeApprovalAdapter(client);const delivery=observeDelivery?new MuseDelivery({arm:name,workspace,qualityInstructions:sharedQualityInstructions,onChange:()=>pair?.emit('status',pair.snapshot())}):null;if(delivery&&client.child?.stderr){client.child.stderr.on('data',chunk=>delivery.feed(chunk));client.child.stderr.on('end',()=>delivery.close());}else if(delivery)delivery.fail();const early=[];buffers.set(name,early);
   const collect=(event,request)=>{if(early.length>=256){startupError='startup_event_capacity';client.abort(startupError);return;}early.push({event,request});};
   const notification=e=>collect(e,false),request=e=>collect(e,true),closed=()=>{startupError='startup_connection_closed';};client.on('notification',notification);client.on('request',request);client.on('closed',closed);
   const s=await openMemoryMuseSession({client,workspace,makeId:c.msp.uuid7,modelId:model,nativeQuestions});if(startupError)throw Error(startupError);checkCancelled();
   sessions[name]={client,workspace,delivery,requestedModel:model,ledger:new c.events.MusePublicEvents({arm:name,sessionId:s.sessionId,evidenceMode:'live'}),usage:new SessionUsage(s.sessionId),notification,request,closed};
  }
  // Synchronous listener handoff: no event loop turn can be lost in between.
  if(startupError||owned.some(client=>client.closed||client.stopping))throw Error('startup_connection_closed');
  for(const name of names){const s=sessions[name];s.client.off('notification',s.notification);s.client.off('request',s.request);s.client.off('closed',s.closed);}
  pair=new StructuredPair({sessions,makeId:c.msp.uuid7,cleanup:closeBroker,nativeQuestions});
  for(const name of names){for(const item of buffers.get(name)){if(item.event?.method==='session/started'&&!item.request){const s=item.event.params?.session;if(s?.sessionId!==sessions[name].client.sessionId||s.workspaceRoot!==workspaces[name]||s.path||s.parentSessionId||s.forkedFrom||s.sideFrom||s.spawnedBy||s.approvalMode?.mode!=='onRequest'||!humanSandboxPosture(s.permissionState))throw Error('startup_event_unqualified');continue;}pair.arms[name].incoming(item.event,item.request);}if(pair.arms[name].state==='failed')throw Error('startup_event_unqualified');}
  if(pair.state!=='ready'||owned.some(client=>client.closed||client.stopping))throw Error('startup_event_unqualified');return pair;
 }catch(error){
  if(pair){await pair.stop();if(pair.error==='cleanup_unconfirmed')throw Error('startup_cleanup_unconfirmed');}else {const stopped=await Promise.allSettled(owned.map(client=>client.stop(client.activeTurnId))),checks=await Promise.allSettled(owned.map(confirmOwnedExit));if(stopped.some(x=>x.status==='rejected')||checks.some(x=>x.status==='rejected'||x.value!==true))throw Error('startup_cleanup_unconfirmed');try{await closeBroker();}catch{throw Error('startup_cleanup_unconfirmed');}}
  throw error;
 }
}
