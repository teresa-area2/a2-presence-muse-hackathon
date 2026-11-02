import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {bindDesktopCipher} from '../web/cipher-batching.mjs';
import {mountTextboxPresence} from '../web/textbox-presence-client.mjs';
import {TextboxPresence} from '../src/textbox-presence.mjs';
import {createOpenPresenceClient} from '../src/op-service-client.mjs';
import {createTextboxMuseBridge} from '../src/textbox-muse-bridge.mjs';

// The installed core is real; events, HTTP responses, credentials and guidance
// are entirely synthetic. No browser/React mount, model or production API is used.
const require=createRequire(new URL('../integrations/cipher-textbox/package.json',import.meta.url));
const {KeystrokeManager}=require('@area2-ai/a2-cipher-core');
const pre='plugin:area2-presence-boundary:hook:pre-llm';
const post='plugin:area2-presence-boundary:hook:post-llm';
const capability={enabled:true,trusted_definition_hash:'sha256:'+'a'.repeat(64)};
const controls={response_extent:'standard',unsolicited_update:'send',conversation_style:'conversational'};
const labels=['SYNTHETIC_FIRST_GUIDANCE','SYNTHETIC_FOLLOWUP_GUIDANCE'];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function eventually(predicate){for(let i=0;i<100;i++){if(predicate())return;await settle();}assert.fail('offline integration did not reach the expected state');}

function mockPluginOperations(_binary,args,options){
 if(args[1]==='validate')return Buffer.from(JSON.stringify({valid:true,diagnostics:[]}));
 if(args[1]==='approve'&&args[2].endsWith('post-llm')){
  const settings=path.join(options.env.XDG_CONFIG_HOME,'muse/settings.json');
  fsSync.writeFileSync(settings,JSON.stringify({schema_version:1,runtime_capabilities:{[pre]:capability,[post]:capability}}),{mode:0o600});
 }
 return Buffer.from('{}');
}

async function callHook({workspace,hookWorkspace=workspace,socket,request='request-1'}){
 const script=path.join(workspace,'.muse/presence-boundary-plugin/hooks/muse-pre-boundary.mjs');
 const child=spawn(process.execPath,[script,'--workspace',workspace,'--socket',socket,'--event','PreLLMCall'],{
  stdio:['pipe','pipe','pipe'],env:{HOME:os.tmpdir(),PATH:process.env.PATH??'/usr/bin:/bin'}
 });
 let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
 child.stdin.on('error',()=>{});
 child.stdin.end(JSON.stringify({hook_event_name:'PreLLMCall',cwd:hookWorkspace,request_id:request,
  session_id:'10000000-0000-4000-8000-000000000001',turn_id:'10000000-0000-4000-8000-000000000002'}));
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(exit,0);assert.equal(errors,'');
 return JSON.parse(output).hookSpecificOutput.additionalContext;
}

function response(value){return new Response(JSON.stringify(value),{status:200});}

test('real Cipher core windows flow through fake OP into the scoped hook, including follow-up and fallback',async t=>{
 let clock=Date.parse('2026-10-28T12:00:00Z'),version=0,auths=0,captures=0,releaseResponse;
 const fakeFetch=async(url,request)=>{
  if(url==='https://auth.area2-ai.com/token'){auths++;return response({access_token:'SYNTHETIC_TOKEN',expires_in:300});}
  assert.equal(url,'https://api-dev.area2-ai.com/v2/capture');captures++;
  const envelope=JSON.parse(request.body),keys=Object.keys(envelope.payload);
  assert.equal(envelope.open_presence_schema,'open_presence.controls.v0.4');
  assert.equal(envelope.user_mode,'internal');
  assert.equal(envelope.payload.signal_type,'keystroke-mech');
  assert.equal(envelope.payload.length,2,'only paired events from this window');
  assert.equal(keys.includes('appContext'),false);assert.equal(keys.includes('emojis'),false);
  assert.equal(keys.includes('prompt'),false);
  // Keep no capture body or timing arrays after this synchronous check.
  const index=captures-1,generated_at=new Date(clock).toISOString();
  const capsule={generated_at,controls,instructions:{version:'coding-instructions.3',llm:{preamble:labels[index]}}};
  return await new Promise(resolve=>{releaseResponse=()=>resolve(response({status:'success',results:{a2_open:capsule}}));});
 };
 const client=createOpenPresenceClient({environment:'dev',client_id:'SYNTHETIC_ID',client_secret:'SYNTHETIC_SECRET',
  resolveCodingInstructions:capsule=>({status:'usable',capsule}),fetcher:fakeFetch,now:()=>clock});
 let nextId=0;
 const presence=new TextboxPresence({client,now:()=>clock,monotonicNow:()=>clock,makeId:()=>`synthetic-reading-${++nextId}`});
 presence.open('synthetic-test-session');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cipher-op-integration-')));
 t.after(async()=>{await fs.rm(root,{recursive:true,force:true});});
 const workspace=path.join(root,'with'),baseline=path.join(root,'without');
 await fs.mkdir(workspace,{mode:0o700});await fs.mkdir(baseline,{mode:0o700});
 const bridge=await createTextboxMuseBridge({presence,environment:{HOME:root,PATH:process.env.PATH??'/usr/bin:/bin'},execute:mockPluginOperations});
 t.after(async()=>{await bridge.close();});
 bridge.prepareBoundary({workspace,binary:'/fake/muse'});

 const events=new Map(),element={tagName:'TEXTAREA',parentElement:{},
  addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 Object.defineProperty(element,'value',{get(){throw Error('capture must not inspect message text');}});
 const manager=new KeystrokeManager();let finalized=0,mounts=0;
 const sdkCapture={handleProcessKeydown:key=>manager.processKeydown(key),handleProcessKeyup:key=>manager.processKeyup(key),
  handleEndTypingSession:()=>{finalized++;const data=manager.endTypingSession();manager.resetTypingData();return data.startUnixTime?{...data,appContext:'SYNTHETIC_APP',emojis:['SYNTHETIC_CONTENT']}:undefined;}};
 let widget;
 const snapshot=()=>({status:'ready',session_generation:1,version:++version,textbox:{...presence.snapshot(),session_authorized:true}});
 const postRoute=async(route,body)=>{
  assert.equal(body.generation,1);
  if(route==='presence/consent')presence.setConsent(body.allowed);
  else if(route==='presence/capture')await presence.capture(body.capture);
  else throw Error('unexpected route');
  return{state:snapshot()};
 };
 widget=mountTextboxPresence(element,{config:{enabled:true,live_enabled:true,session_authorized:true},post:postRoute,
  now:()=>clock,onState:state=>widget.render(state,{connected:true}),
  loadCollector:async()=>({mountCipherTextarea:async(target,options)=>{mounts++;return bindDesktopCipher({element:target,capture:sdkCapture,...options});}})});
 t.after(()=>widget.close());
 widget.render(snapshot(),{connected:true});
 await settle();await settle();
 assert.equal(presence.consent,true);assert.equal(mounts,1);
 const key=letter=>{events.get('keydown')({isTrusted:true,key:letter,code:'Key'+letter.toUpperCase()});events.get('keyup')({isTrusted:true,key:letter,code:'Key'+letter.toUpperCase()});};
 const nativeHook=extra=>callHook({workspace,socket:bridge.socket,...extra});

 // First window: mouse blur then Send must finalize only once.
 events.get('focus')();key('a');key('b');
 events.get('blur')();const first=widget.finish();await eventually(()=>captures===1);
 assert.equal(finalized,1);assert.equal(captures,1);assert.equal(auths,1);
 const beforeFirst=await nativeHook();assert.match(beforeFirst,/Presence unavailable or ineligible:/);
 releaseResponse();await first;await eventually(()=>presence.selectForRequest().reading_id==='synthetic-reading-1');
 const firstSelection=presence.selectForRequest();assert.equal(firstSelection.reading_id,'synthetic-reading-1');
 const initial=await nativeHook();assert.ok(initial.endsWith(labels[0]));

 // The isolated baseline workspace cannot read this Presence boundary.
 const readsBeforeBaseline=presence.selections.length;
 const baselineResult=await nativeHook({hookWorkspace:baseline});
 assert.match(baselineResult,/Presence unavailable or ineligible:/);
 assert.equal(baselineResult.includes(labels[0]),false);
 assert.equal(presence.selections.length,readsBeforeBaseline);

 // Follow-up window: release Enter after the event that triggers Send, and
 // repeat blur/finish. The earlier valid reading remains usable during refresh.
 clock+=30000;key('c');key('d');
 events.get('keydown')({isTrusted:true,key:'Enter',code:'Enter'});
 events.get('keyup')({isTrusted:true,key:'Enter',code:'Enter'});
 events.get('blur')();const duplicate=widget.finish();await eventually(()=>captures===2);
 assert.equal(finalized,2);assert.equal(captures,2);assert.equal(auths,1);
 assert.equal(presence.selectForRequest().reading_id,firstSelection.reading_id);
 assert.ok((await nativeHook({request:'pending-followup'})).endsWith(labels[0]));
 releaseResponse();await duplicate;await eventually(()=>presence.selectForRequest().reading_id==='synthetic-reading-2');
 const followupSelection=presence.selectForRequest();
 assert.equal(followupSelection.reading_id,'synthetic-reading-2');
 const followup=await nativeHook({request:'followup'});
 assert.ok(followup.endsWith(labels[1]));assert.equal(followup.includes(labels[0]),false);

 clock+=120001;
 const retained=await nativeHook({request:'after-review'});assert.ok(retained.endsWith(labels[1]));
 const afterReview=presence.selectForRequest();assert.equal(afterReview.reading_id,followupSelection.reading_id);
 assert.equal(afterReview.age_ms,120001);assert.equal(afterReview.reading_freshness,'last_known');
 const baselineReads=presence.selections.length,baselineAfterReview=await nativeHook({hookWorkspace:baseline});
 assert.match(baselineAfterReview,/Presence unavailable or ineligible:/);assert.ok(!baselineAfterReview.includes(labels[1]));
 assert.equal(presence.selections.length,baselineReads);assert.equal(captures,2);
 presence.setConsent(false);
 const revoked=await nativeHook({request:'revoked'});assert.match(revoked,/Presence unavailable or ineligible:/);
 assert.equal(revoked.includes(labels[1]),false);
 assert.equal(captures,2,'no automatic retry or extra OP capture');
});

test('real Cipher core preserves completed input around a shortcut in one focus window',async()=>{
 const events=new Map(),element={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const manager=new KeystrokeManager();let count=null;
 const binding=bindDesktopCipher({element,capture:{handleProcessKeydown:key=>manager.processKeydown(key),handleProcessKeyup:key=>manager.processKeyup(key),handleEndTypingSession(){const value=manager.endTypingSession();manager.resetTypingData();return value;}},onBatch:async value=>{count=value.length;}});
 const emit=(name,e)=>events.get(name)({isTrusted:true,metaKey:false,ctrlKey:false,...e});
 const key=(letter)=>{emit('keydown',{key:letter,code:'Key'+letter.toUpperCase()});emit('keyup',{key:letter,code:'Key'+letter.toUpperCase()});};
 binding.setEnabled(true);key('a');key('b');
 emit('keydown',{key:'Meta',code:'MetaLeft',metaKey:true});emit('keydown',{key:'ArrowLeft',code:'ArrowLeft',metaKey:true});emit('keyup',{key:'ArrowLeft',code:'ArrowLeft',metaKey:true});emit('keyup',{key:'Meta',code:'MetaLeft'});
 key('c');key('d');await binding.finish();assert.equal(count,4);binding.close();
});
