// Development-only protocol replay. No Muse executable, OP client, credential,
// physical input, live UI or inference is involved. Public answers are fixtures.
import fs from 'node:fs/promises';
import sync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {TextboxPresence} from '../src/textbox-presence.mjs';
import {createTextboxMuseBridge} from '../src/textbox-muse-bridge.mjs';
import {MuseDelivery,readOwnedPreHooks} from '../src/muse-delivery.mjs';
import {readOwnedPostHooks} from '../src/muse-response-trace.mjs';
import {runCommentaryReplay} from './replay-commentary.mjs';
import {SCENARIO_IDS,runScenario,recordSyntheticDispatches} from './simulate-textbox.mjs';

const PRE='plugin:area2-presence-boundary:hook:pre-llm',POST='plugin:area2-presence-boundary:hook:post-llm';
const CAP={enabled:true,trusted_definition_hash:'sha256:'+'a'.repeat(64)};
const SCOPE='10000000-0000-4000-8000-000000000001',BASELINE='10000000-0000-4000-8000-000000000002';
const TURN_A='10000000-0000-4000-8000-000000000003',TURN_B='10000000-0000-4000-8000-000000000004',TURN_C='10000000-0000-4000-8000-000000000005';
const A=Object.freeze({response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'});
const B=Object.freeze({response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'});
const fail=()=>{throw Error('presence_replay_failed');};
const fixedLabels=()=>({synthetic:true,model_runtime:'protocol_fixture',op_service_calls:0,provider_calls:0});
const exists=async target=>{try{await fs.lstat(target);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
function fixtureInstaller(_binary,args,{env}){
 if(args[1]==='validate')return Buffer.from('{"valid":true,"diagnostics":[]}');
 if(args[1]==='approve'&&args[2].endsWith('post-llm'))sync.writeFileSync(path.join(env.XDG_CONFIG_HOME,'muse/settings.json'),JSON.stringify({schema_version:1,runtime_capabilities:{[PRE]:CAP,[POST]:CAP}}),{mode:0o600});
 return Buffer.from('{}');
}
async function safeScenario(id,delivery,baseline,workspace,turnId){
 const pre=await readOwnedPreHooks(workspace,SCOPE,turnId),post=await readOwnedPostHooks(workspace,SCOPE,turnId);
 const value=delivery.snapshot(),base=baseline.snapshot(),final=value.response_attribution.finals[0];
 return{id,turn_ordinal:value.turn_ordinal,status:value.status,hook_linkage:value.hook_linkage,response_linkage:value.response_linkage,
  requests:value.request_attribution.map(row=>({ordinal:row.ordinal,status:row.status,controls:row.controls?{response_extent:row.controls.response_extent,unsolicited_update:row.controls.unsolicited_update,conversation_style:row.controls.conversation_style}:null})),
  final:final?{status:final.status,request_ordinal:final.request_ordinal,presence:final.presence}:null,
  baseline:base.status,baseline_hook_linkage:base.hook_linkage,usage_status:delivery.usage.snapshot().status,usage_coverage:delivery.usage.snapshot().coverage,
  hook_records:{pre:pre.length,post:post.length}};
}

export async function runPresenceReplay(){
 if(arguments.length!==0)fail();
 const generated=await recordSyntheticDispatches([{action:'tap',count:2},{action:'advance',ms:30000},{action:'tap',count:2},{action:'advance',ms:30000}]);
 if(generated.synthetic!==true||generated.inference!=='stub'||generated.payload_origin!=='generated_not_sdk'||generated.dispatches?.length!==2||generated.dispatches[0].at_ms!==30000||generated.dispatches[1].at_ms!==60000||generated.dispatches[0].fixture_capture?.length!==2||generated.dispatches[1].fixture_capture?.length!==4)fail();
 const consumed=[];
 const base=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(base,`a2-presence-replay-${process.pid}-`));
 await fs.chmod(root,0o700);const owner=await fs.lstat(root),children=new Set();
 let bridge,presence,withDelivery,baselineDelivery,report,socketDirectory;
 const cleanup={workspaces_removed:false,bridge_removed:false,hook_children_exited:false};
 try{
  const workspace=path.join(root,'with'),baseline=path.join(root,'without'),home=path.join(root,'home');
  for(const folder of [workspace,baseline,home])await fs.mkdir(folder,{mode:0o700});
  await fs.mkdir(path.join(baseline,'.presence'),{mode:0o700});
  const node=await fs.realpath(process.execPath),environment={HOME:home,PATH:path.dirname(node),LANG:'C',TZ:'UTC'};
  let at=generated.dispatches[0].at_ms,receipt=0;
  presence=new TextboxPresence({now:()=>at,monotonicNow:()=>at,makeId:()=>`20000000-0000-4000-8000-${String(++receipt).padStart(12,'0')}`,client:{capture:async value=>{const expected=generated.dispatches[consumed.length]?.fixture_capture;if(!isDeepStrictEqual(value,expected))fail();consumed.push(value.length);return({status:'usable',guidance:receipt===0?'DECLARED_SYNTHETIC_GUIDANCE_A':'DECLARED_SYNTHETIC_GUIDANCE_B',controls:receipt===0?A:B,generated_at:new Date(at).toISOString(),received_at:new Date(at).toISOString(),renderer:'coding-instructions.3'});}}});
  presence.open('protocol-fixture');presence.setConsent(true);await presence.capture(generated.dispatches[0].fixture_capture,{observationEndedAtMs:generated.dispatches[0].at_ms});
  bridge=await createTextboxMuseBridge({presence,node,environment,execute:fixtureInstaller});socketDirectory=path.dirname(bridge.socket);
  bridge.prepareBoundary({workspace,binary:path.join(root,'not-an-executable-muse-fixture')});
  withDelivery=new MuseDelivery({arm:'with',workspace});baselineDelivery=new MuseDelivery({arm:'without',workspace:baseline});
  async function hook(event,turn,request,response,step){
   const name=event==='PreLLMCall'?'muse-pre-boundary.mjs':'muse-post-boundary.mjs';
   const script=path.join(workspace,'.muse/presence-boundary-plugin/hooks',name);
   const input={hook_event_name:event,cwd:workspace,session_id:SCOPE,turn_id:turn,request_id:request,attempt:0,step,...(event==='PostLLMCall'?{response_id:response,status:'successful'}:{})};
   const child=spawn(node,[script,'--workspace',workspace,'--socket',bridge.socket,'--event',event],{cwd:workspace,env:environment,detached:true,stdio:['pipe','pipe','pipe']});children.add(child);
   let output='',stderr='',failed=false,timer,killTimer;
   const kill=signal=>{if(child.pid)try{process.kill(-child.pid,signal);}catch{}};
   const stop=()=>{failed=true;kill('SIGTERM');if(!killTimer)killTimer=setTimeout(()=>kill('SIGKILL'),100);};
   try{
    const ended=new Promise(resolve=>{child.once('error',()=>{failed=true;resolve(null);});child.once('close',resolve);});
    timer=setTimeout(stop,3000);
    child.stdout.on('data',chunk=>{if(Buffer.byteLength(output)+chunk.length>65536)return stop();output+=chunk.toString('utf8');});
    child.stderr.on('data',chunk=>{if(Buffer.byteLength(stderr)+chunk.length>4096)return stop();stderr+=chunk.toString('utf8');});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
    const code=await ended;if(failed||code!==0||stderr)fail();
    let result;try{result=JSON.parse(output);}catch{fail();}
    return result;
   }finally{clearTimeout(timer);clearTimeout(killTimer);if(child.exitCode===null&&child.signalCode===null)kill('SIGKILL');children.delete(child);}
  }
  function feedRequest(delivery,prompt,context){delivery.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[...(context?[{role:'developer',content:context}]:[]),{role:'user',content:prompt}]})+'\n'));}
  function feedResponse(delivery,response,text){
   const output=text===null?[{type:'function_call',name:'fixture_read',call_id:'fixture-call',arguments:'{}'}]:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}];
   delivery.feed(Buffer.from('SSE RESPONSE: '+JSON.stringify({type:'response.completed',response:{id:response,status:'completed',output,usage:{input_tokens:10,output_tokens:3,input_tokens_details:{cached_tokens:0}}}})+'\n'));
  }
  let ordinal=0;
  async function generation(prompt,turn,step,text){
   const request=`fixture-request-${++ordinal}`,response=`fixture-response-${ordinal}`;
   const pre=await hook('PreLLMCall',turn,request,response,step),context=pre?.hookSpecificOutput?.additionalContext;
   if(typeof context!=='string')fail();
   feedRequest(withDelivery,prompt,context);feedRequest(baselineDelivery,prompt,null);
   feedResponse(withDelivery,response,text);feedResponse(baselineDelivery,`baseline-response-${ordinal}`,text);
   await hook('PostLLMCall',turn,request,response,step);
   if(text!==null){withDelivery.publicFinal({text,truncated:false});baselineDelivery.publicFinal({text,truncated:false});}
  }
  async function finish(){await withDelivery.finishTurn();await baselineDelivery.finishTurn();await withDelivery.settled();await baselineDelivery.settled();}
  const prompt='Protocol fixture: read the synthetic coding task and propose a plan.';
  for(const [delivery,session] of [[withDelivery,SCOPE],[baselineDelivery,BASELINE]]){delivery.begin(prompt);delivery.bind(session,TURN_A);}
  await generation(prompt,TURN_A,1,null);
  at=generated.dispatches[1].at_ms;await presence.capture(generated.dispatches[1].fixture_capture,{observationEndedAtMs:generated.dispatches[1].at_ms});
  if(consumed.length!==2||consumed[0]!==2||consumed[1]!==4)fail();
  await generation(prompt,TURN_A,2,'Protocol fixture completion for the first turn.');await finish();
  const first=await safeScenario('same_turn_policy_change',withDelivery,baselineDelivery,workspace,TURN_A);
  at=180001;
  const followup='Protocol fixture: explain the result and its limitations.';
  for(const [delivery,session] of [[withDelivery,SCOPE],[baselineDelivery,BASELINE]]){delivery.begin(followup);delivery.bind(session,TURN_B);}
  await generation(followup,TURN_B,1,'Protocol fixture completion for the follow-up turn.');await finish();
  const second=await safeScenario('follow_up_retained_guidance',withDelivery,baselineDelivery,workspace,TURN_B);
  const retained=presence.selectForRequest();if(retained.status!=='selected'||retained.reading_freshness!=='last_known'||retained.age_ms!==120001)fail();
  presence.setConsent(false);
  const withdrawn='Protocol fixture: proceed normally after consent withdrawal.';
  for(const [delivery,session] of [[withDelivery,SCOPE],[baselineDelivery,BASELINE]]){delivery.begin(withdrawn);delivery.bind(session,TURN_C);}
  await generation(withdrawn,TURN_C,1,'Protocol fixture completion after consent withdrawal.');await finish();
  const third=await safeScenario('revoked_fallback',withDelivery,baselineDelivery,workspace,TURN_C);
  if((await fs.readdir(path.join(baseline,'.presence'))).length!==0||first.requests.length!==2||first.requests[0].controls?.response_extent!=='terse'||first.requests[1].controls?.response_extent!=='full'||first.final?.request_ordinal!==2||second.requests[0]?.status!=='guidance_observed'||second.requests[0]?.controls?.response_extent!=='full'||third.requests[0]?.status!=='fallback_observed'||third.final?.presence!=='fallback'||[first,second,third].some(row=>row.baseline!=='baseline_isolated'||row.response_linkage!=='public_final_matched'))fail();
  const typingReports=[];for(const id of SCENARIO_IDS){const value=await runScenario(id);typingReports.push({scenario:value.scenario,ok:value.ok,counts:{...value.counts},dispatchLengths:[...value.dispatchLengths],dispatchTimes:[...value.dispatchTimes],timersPending:value.timersPending,closed:value.closed,bufferClosed:value.bufferClosed});}
  report={...fixedLabels(),capture_handoff:{mode:'synthetic_record_replay',generated_lengths:generated.dispatches.map(row=>row.fixture_capture.length),consumed_lengths:[...consumed],dispatch_times:generated.dispatches.map(row=>row.at_ms)},typing:{synthetic:true,inference:'stub',payload_origin:'simulated_events_not_sdk_capture',calibration:'not_tested',reports:typingReports},commentary:runCommentaryReplay(),policy_source:'declared_fixture',calibration:'not_tested',behavior:'not_measured',human_effort:'not_measured',live_benefit:'not_measured',scenarios:[first,second,third],results:{ok:true,same_turn_replacement:true,follow_up_retained_guidance:true,revoked_fallback:true,baseline_isolated:true,public_final_linked:true}};
 }finally{
  for(const child of children){if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('close',resolve);});}
  cleanup.hook_children_exited=children.size===0;children.clear();
  await withDelivery?.settled();await baselineDelivery?.settled();withDelivery?.close();baselineDelivery?.close();presence?.clear();
  if(bridge){await bridge.close();cleanup.bridge_removed=!await exists(socketDirectory);}else cleanup.bridge_removed=true;
  const current=await fs.lstat(root).catch(()=>null);
  if(current?.isDirectory()&&!current.isSymbolicLink()&&current.ino===owner.ino&&current.dev===owner.dev)await fs.rm(root,{recursive:true,force:true});
  cleanup.workspaces_removed=!await exists(root);
 }
 if(!report||Object.values(cleanup).some(value=>value!==true))fail();
 return{...report,cleanup};
}

let directEntry=false;try{directEntry=!!process.argv[1]&&pathToFileURL(sync.realpathSync(process.argv[1])).href===import.meta.url;}catch{}
if(directEntry)(async()=>{if(process.argv.length!==2)fail();process.stdout.write(JSON.stringify(await runPresenceReplay())+'\n');})().catch(()=>{process.stdout.write(JSON.stringify({...fixedLabels(),results:{ok:false},error:'presence_replay_failed'})+'\n');process.exitCode=1;});
