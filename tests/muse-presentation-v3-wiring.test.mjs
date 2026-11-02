import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import sync from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import {createTextboxMuseBridge} from '../src/textbox-muse-bridge.mjs';import {TextboxPresence} from '../src/textbox-presence.mjs';import {MuseDelivery,requestDeliveryFacts,readOwnedPreHooks} from '../src/muse-delivery.mjs';
const PRE='plugin:area2-presence-boundary:hook:pre-llm',POST='plugin:area2-presence-boundary:hook:post-llm',cap={enabled:true,trusted_definition_hash:'sha256:'+'a'.repeat(64)};
const sid='10000000-0000-4000-8000-000000000001',tid='10000000-0000-4000-8000-000000000002';
const payload=()=>({keyAreas:[1,2],keyTypes:['an','sp'],pressTimes:[10,20],releaseTimes:[15,25],length:2,sessionID:'synthetic',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
const guidance='VERBATIM_SYNTHETIC_GUIDANCE_PRIVATE';
const selection=()=>({status:'selected',guidance,controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'},reading_id:'reading-1',age_ms:10,renderer:'coding-instructions.3'});
function fakeExecute(calls,{invalid=false,auth=false}={}){return(binary,args,options)=>{calls.push({binary,args,options});assert.equal(options.env.OPEN_PRESENCE_AUTH_CLIENT_SECRET,undefined);assert.equal(options.env.NPM_TOKEN,undefined);const config=options.env.XDG_CONFIG_HOME;assert.ok(!sync.existsSync(path.join(config,'muse/auth.json')));if(args[1]==='validate')return Buffer.from(JSON.stringify({valid:!invalid,diagnostics:[]}));if(args[1]==='approve'&&args[2].endsWith('post-llm')){sync.writeFileSync(path.join(config,'muse/settings.json'),JSON.stringify({schema_version:1,runtime_capabilities:{[PRE]:cap,[POST]:cap}}),{mode:0o600});if(auth)sync.writeFileSync(path.join(config,'muse/auth.json'),'PRIVATE_AUTH');}return Buffer.from('{}');};}
async function fixture(t,{presence={selectForRequest:selection},executeOptions={},experimentalCollaboration=true,presentationGuidance=false,presentationVersion=2}={}){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'textbox-hook-test-'))),workspace=path.join(root,'repo');await fs.mkdir(workspace,{mode:0o700});const calls=[],bridge=await createTextboxMuseBridge({presence,presentationGuidance,presentationVersion,...(experimentalCollaboration===null?{}:{experimentalCollaboration}),environment:{HOME:os.homedir(),PATH:process.env.PATH,OPEN_PRESENCE_AUTH_CLIENT_SECRET:'DO_NOT_INHERIT',NPM_TOKEN:'DO_NOT_INHERIT'},execute:fakeExecute(calls,executeOptions)});t.after(async()=>{await bridge.close();await fs.rm(root,{recursive:true,force:true});});return{root,workspace,calls,bridge,prepare:()=>bridge.prepareBoundary({workspace,binary:'/fake/muse'})};}
async function runHook(f,event='PreLLMCall',extra={},socket=f.bridge.socket){const file=path.join(f.workspace,'.muse/presence-boundary-plugin/hooks',event==='PreLLMCall'?'muse-pre-boundary.mjs':'muse-post-boundary.mjs');const incoming={hook_event_name:event,cwd:f.workspace,session_id:sid,turn_id:tid,request_id:'request-1',messages:[{text:'PRIVATE_PROMPT_SENTINEL'}],...extra};const child=spawn(process.execPath,[file,'--workspace',f.workspace,'--socket',socket,'--event',event],{stdio:['pipe','pipe','pipe']});let out='',error='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>error+=x);child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(incoming));const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});assert.equal(exit,0);assert.equal(error,'');return JSON.parse(out);}


test('explicit v3 emits and attributes fresh policies while preserving fallback and baseline',async t=>{
 let value=selection();const f=await fixture(t,{presentationGuidance:true,presentationVersion:3,experimentalCollaboration:false,presence:{selectForRequest:()=>value}});f.prepare();
 const d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('DIAGRAM TASK');d.bind(sid,tid);let index=0;
 for(const c of [selection().controls,selection().controls,{response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'},selection().controls,null]){
  value=c?{...selection(),controls:c,reading_id:'reading-'+(++index)}:{status:'fallback'};
  const x=(await runHook(f,'PreLLMCall',{request_id:'r'+index})).hookSpecificOutput.additionalContext;
  if(c){assert.match(x,/Muse collaboration v3:\n/);assert.ok(x.endsWith('Server guidance (verbatim):\n'+guidance));const start=x.indexOf('Muse collaboration v3:\n'),end=x.indexOf('Server guidance (verbatim):\n');assert.ok(Buffer.byteLength(x.slice(start,end))<=384);}
  else{assert.match(x,/Earlier Muse presentation hints are withdrawn/);assert.match(x,/do not reuse earlier guidance/);assert.doesNotMatch(x,/Muse collaboration v3:/);}
  d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:x},{role:'user',content:'DIAGRAM TASK'}]})+'\n'));
 }
 await d.finishTurn();await d.settled();const rows=d.snapshot().request_attribution;assert.equal(rows.length,5);assert.deepEqual(rows.map(r=>r.collaboration_contract?.status),['matched','matched','matched','matched','withdrawn']);assert.ok(rows.every(r=>r.collaboration_contract.version===3));
 const {projectEvidence}=await import('../src/evidence-projection.mjs'),out=projectEvidence({arms:{with:{delivery:d.snapshot()}}});assert.deepEqual(out.arms.with.delivery.request_attribution.map(r=>r.collaboration_contract?.version),[3,3,3,3,3]);assert.ok(!JSON.stringify(out).includes(guidance));
 const baseline=path.join(f.root,'baseline');await fs.mkdir(baseline,{mode:0o700});await fs.mkdir(path.join(baseline,'.presence'),{mode:0o700});const without=new MuseDelivery({arm:'without',workspace:baseline});without.begin('DIAGRAM TASK');without.bind(sid,tid);without.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'user',content:'DIAGRAM TASK'}]})+'\n'));await without.finishTurn();await without.settled();assert.equal(without.snapshot().status,'baseline_isolated');
});
test('v3 selector rejects invalid or disabled configurations',async()=>{for(const options of [{presentationGuidance:false,presentationVersion:3},{presentationGuidance:true,presentationVersion:4},{presentationGuidance:true,presentationVersion:'3'}]){let bridge,error;try{bridge=await createTextboxMuseBridge({presence:{selectForRequest:selection},...options});}catch(e){error=e;}finally{await bridge?.close();}assert.match(error?.message??'',/textbox_bridge_invalid/);}});


test('v3 hook packages the selected helper and preserves version 2 bytes',async t=>{
 const v2=await import('../scripts/muse-presentation-guidance.mjs'),v3=await import('../scripts/muse-presentation-guidance-v3.mjs');const texts=[];
 let value=selection();const f=await fixture(t,{presentationGuidance:true,presentationVersion:3,experimentalCollaboration:false,presence:{selectForRequest:()=>value}});f.prepare();
 assert.deepEqual(await fs.readFile(path.join(f.workspace,'.muse/presence-boundary-plugin/hooks/muse-presentation-guidance.mjs')),await fs.readFile(new URL('../scripts/muse-presentation-guidance-v3.mjs',import.meta.url)));
 for(const response_extent of ['terse','standard','full'])for(const unsolicited_update of ['send','defer'])for(const conversation_style of ['conversational','self_contained']){
  const controls={response_extent,unsolicited_update,conversation_style};value={...selection(),controls};texts.push(v2.compileMusePresentation(controls).text);const expected=v3.compileMusePresentation(controls),context=(await runHook(f)).hookSpecificOutput.additionalContext;
  assert.equal(expected.version,3);assert.ok(expected.utf8_bytes+1<=384);assert.ok(context.includes(expected.text+'\nServer guidance (verbatim):\n'+guidance));
 }
 assert.equal(createHash('sha256').update(JSON.stringify(texts)).digest('hex'),'8d69bb9ea98e81512d6a1ace1c1462bcdd4bed31e07670f0216b71971960e36e');
});

test('missing, modified and wrong-version helpers preserve current OP and mark hints unverified',async t=>{
 for(const change of ['missing','modified','wrong_version']){
  const f=await fixture(t,{presentationGuidance:true,presentationVersion:3,experimentalCollaboration:false});f.prepare();const helper=path.join(f.workspace,'.muse/presence-boundary-plugin/hooks/muse-presentation-guidance.mjs');
  if(change==='missing')await fs.unlink(helper);else if(change==='modified')await fs.writeFile(helper,'not valid JavaScript !');else await fs.copyFile(new URL('../scripts/muse-presentation-guidance.mjs',import.meta.url),helper);
  let context;
  if(change==='wrong_version'){
   // Same hash as the substituted v2 helper but a declared v3 response: this
   // exercises version checking independently of the integrity mismatch.
   const socket=path.join(f.root,'version-socket'),helperHash=createHash('sha256').update(await fs.readFile(helper)).digest('hex'),server=net.createServer(c=>{c.once('data',()=>c.end(JSON.stringify({status:'selected',read_id:'30000000-0000-4000-8000-000000000001',read_sequence:1,collaboration_version:3,presentation_helper_sha256:helperHash,guidance,controls:selection().controls})+'\n'));});
   await new Promise((resolve,reject)=>server.once('error',reject).listen(socket,resolve));await fs.chmod(socket,0o600);try{context=(await runHook(f,'PreLLMCall',{},socket)).hookSpecificOutput.additionalContext;}finally{await new Promise(resolve=>server.close(resolve));}
  }else context=(await runHook(f)).hookSpecificOutput.additionalContext;
  assert.ok(context.endsWith('Server guidance (verbatim):\n'+guidance),change);assert.match(context,/withdraw earlier Muse presentation hints/);assert.doesNotMatch(context,/Muse collaboration v[23]:/);assert.doesNotMatch(context,/Presence unavailable or ineligible:/);
  if(change!=='wrong_version'){const d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('MISSING');d.bind(sid,tid);d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:context},{role:'user',content:'MISSING'}]})+'\n'));await d.finishTurn();await d.settled();assert.equal(d.snapshot().status,'guidance_observed');assert.deepEqual(d.snapshot().request_attribution[0].collaboration_contract,{version:3,status:'unverified',added_utf8_bytes:null});}
 }
});

test('v3 audit cannot certify forged v2 or unknown presentation text',async t=>{
 for(const alter of [x=>x.replace('Muse collaboration v3:','Muse collaboration v2:'),x=>x.replace('Muse collaboration v3:','Muse collaboration v999:'),x=>x.replace('Muse collaboration v3:','Muse collaboration v3:\nINJECTED')]){
  const f=await fixture(t,{presentationGuidance:true,presentationVersion:3,experimentalCollaboration:false});f.prepare();const context=alter((await runHook(f)).hookSpecificOutput.additionalContext),d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('FORGED');d.bind(sid,tid);d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:context},{role:'user',content:'FORGED'}]})+'\n'));await d.finishTurn();await d.settled();assert.equal(d.snapshot().status,'guidance_observed');assert.deepEqual(d.snapshot().request_attribution[0].collaboration_contract,{version:3,status:'unverified',added_utf8_bytes:null});
 }
});

test('launcher rejects v3 when guidance is disabled and rejects unknown versions',async()=>{const {buildStructuredLauncher}=await import('../structured-live.mjs');for(const options of [{presentationVersion:3},{presentationGuidance:false,presentationVersion:3},{presentationGuidance:true,presentationVersion:4},{presentationGuidance:true,presentationVersion:'3'}])await assert.rejects(buildStructuredLauncher(options),/presentation_guidance_invalid/);});

test('v3 evidence is retained by the observer without relabeling unknown versions',async()=>{const {observerState,NOW}=await import('./helpers/observer-state.mjs'),{buildObserverExperience}=await import('../src/observer-comparison.mjs');const state=observerState(),row=state.arms.with.delivery.request_attribution[0];row.collaboration_contract.version=3;assert.match(buildObserverExperience(state,{now:NOW}).link,/hints v3 matched/);row.collaboration_contract.version=99;assert.match(buildObserverExperience(state,{now:NOW}).link,/hint delivery is unverified/);});

test('explicit v3 fails before setup when Presence source cannot supply the v3 hook',async()=>{const {buildStructuredLauncher}=await import('../structured-live.mjs');for(const environment of [{},{A2_MUSE_PRESENCE_SOURCE:'desktop'}])await assert.rejects(buildStructuredLauncher({environment,presentationGuidance:true,presentationVersion:3}),/presentation_source_unsupported/);});

test('launcher fingerprints the statically imported v3 helper independent of selected mode',async()=>{const source=await fs.readFile(new URL('../structured-live.mjs',import.meta.url),'utf8');assert.match(source,/'scripts\/muse-presentation-guidance\.mjs','scripts\/muse-presentation-guidance-v3\.mjs'/);});

test('v3 withdrawal supersedes accumulated hints while a native table remains valid unmeasured behavior',async t=>{
 let value={...selection(),controls:{response_extent:'full',unsolicited_update:'defer',conversation_style:'conversational'}};
 const f=await fixture(t,{presentationGuidance:true,presentationVersion:3,experimentalCollaboration:false,presence:{selectForRequest:()=>value}});f.prepare();
 const d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('Compare the code paths');d.bind(sid,tid);
 const prior=(await runHook(f,'PreLLMCall',{request_id:'flow-request'})).hookSpecificOutput.additionalContext;
 const request=context=>d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:context},{role:'user',content:'Compare the code paths'}]})+'\n'));
 const completion=(id,answer)=>d.feed(Buffer.from('SSE RESPONSE: '+JSON.stringify({type:'response.completed',response:{id,status:'completed',usage:{input_tokens:12,output_tokens:4,input_tokens_details:{cached_tokens:0}},output:answer===null?[]:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer}]}]}})+'\n'));
 request(prior);completion('flow-response',null);
 await runHook(f,'PostLLMCall',{request_id:'flow-request',response_id:'flow-response',status:'ok'});
 value={status:'fallback'};
 const current=(await runHook(f,'PreLLMCall',{request_id:'withdraw-request'})).hookSpecificOutput.additionalContext;
 assert.match(current,/Earlier Muse presentation hints are withdrawn/);
 assert.doesNotMatch(current,/Muse collaboration v3:/);
 // Native history may contain earlier hints. The current sequence, not visual
 // structure in a later answer, establishes which guidance was withdrawn.
 request(prior+'\n\n'+current);
 const answer='| Path | Result |\n|---|---|\n| Hit | Cached value |';
 completion('withdraw-response',answer);
 await runHook(f,'PostLLMCall',{request_id:'withdraw-request',response_id:'withdraw-response',status:'ok'});
 d.publicFinal({text:answer,truncated:false});await d.finishTurn();await d.settled();
 const out=d.snapshot();
 assert.deepEqual(out.request_attribution.map(r=>r.collaboration_contract.status),['matched','withdrawn']);
 assert.equal(out.hook_linkage,'read_marker_matched');assert.equal(out.response_linkage,'public_final_matched');
 assert.equal(out.response_attribution.finals[0].presence,'fallback');assert.equal(out.behavior,'not_measured');
 assert.equal(out.request_attribution[1].controls,null);
 const {projectEvidence}=await import('../src/evidence-projection.mjs'),exported=JSON.stringify(projectEvidence({arms:{with:{delivery:out}}}));
 assert.ok(!exported.includes(guidance));assert.ok(!exported.includes(answer));
});

test('v3 cannot certify withdrawn hints when the current refresh still contains the old contract',async t=>{
 const f=await fixture(t,{presentationGuidance:true,presentationVersion:3,experimentalCollaboration:false,presence:{selectForRequest:()=>({status:'fallback'})}});f.prepare();
 const current=(await runHook(f)).hookSpecificOutput.additionalContext;
 const {compileMusePresentation}=await import('../scripts/muse-presentation-guidance-v3.mjs');
 const old=compileMusePresentation({response_extent:'full',unsolicited_update:'defer',conversation_style:'conversational'}).text;
 const malformed=current.replace('Earlier Muse presentation hints are withdrawn.',old+'\nEarlier Muse presentation hints are withdrawn.');
 const d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('Withdraw');d.bind(sid,tid);
 d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:malformed},{role:'user',content:'Withdraw'}]})+'\n'));
 await d.finishTurn();await d.settled();
 assert.equal(d.snapshot().request_attribution[0].collaboration_contract.status,'unverified');
 assert.equal(d.snapshot().response_linkage,'unverified');
});

test('a v3 request after a missing hook invocation never inherits prior fresh-read proof',async t=>{
 const f=await fixture(t,{presentationGuidance:true,presentationVersion:3,experimentalCollaboration:false});f.prepare();
 const prior=(await runHook(f)).hookSpecificOutput.additionalContext;
 const d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('Missing hook');d.bind(sid,tid);
 for(let i=0;i<2;i++)d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:prior},{role:'user',content:'Missing hook'}]})+'\n'));
 await d.finishTurn();await d.settled();
 assert.equal(d.snapshot().status,'ambiguous');assert.equal(d.snapshot().hook_linkage,'unverified');assert.equal(d.snapshot().response_linkage,'unverified');
 assert.ok(d.snapshot().request_attribution.every(r=>r.collaboration_contract.status==='unverified'));
});
