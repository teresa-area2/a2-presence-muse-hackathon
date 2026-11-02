import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import sync from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';
import {createTextboxMuseBridge} from '../src/textbox-muse-bridge.mjs';import {TextboxPresence} from '../src/textbox-presence.mjs';import {MuseDelivery,requestDeliveryFacts,readOwnedPreHooks} from '../src/muse-delivery.mjs';
const PRE='plugin:area2-presence-boundary:hook:pre-llm',POST='plugin:area2-presence-boundary:hook:post-llm',cap={enabled:true,trusted_definition_hash:'sha256:'+'a'.repeat(64)};
const sid='10000000-0000-4000-8000-000000000001',tid='10000000-0000-4000-8000-000000000002';
const payload=()=>({keyAreas:[1,2],keyTypes:['an','sp'],pressTimes:[10,20],releaseTimes:[15,25],length:2,sessionID:'synthetic',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
const guidance='VERBATIM_SYNTHETIC_GUIDANCE_PRIVATE';
const selection=()=>({status:'selected',guidance,controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'},reading_id:'reading-1',age_ms:10,renderer:'coding-instructions.3'});
function fakeExecute(calls,{invalid=false,auth=false}={}){return(binary,args,options)=>{calls.push({binary,args,options});assert.equal(options.env.OPEN_PRESENCE_AUTH_CLIENT_SECRET,undefined);assert.equal(options.env.NPM_TOKEN,undefined);const config=options.env.XDG_CONFIG_HOME;assert.ok(!sync.existsSync(path.join(config,'muse/auth.json')));if(args[1]==='validate')return Buffer.from(JSON.stringify({valid:!invalid,diagnostics:[]}));if(args[1]==='approve'&&args[2].endsWith('post-llm')){sync.writeFileSync(path.join(config,'muse/settings.json'),JSON.stringify({schema_version:1,runtime_capabilities:{[PRE]:cap,[POST]:cap}}),{mode:0o600});if(auth)sync.writeFileSync(path.join(config,'muse/auth.json'),'PRIVATE_AUTH');}return Buffer.from('{}');};}
async function fixture(t,{presence={selectForRequest:selection},executeOptions={},experimentalCollaboration=true,presentationGuidance=false}={}){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'textbox-hook-test-'))),workspace=path.join(root,'repo');await fs.mkdir(workspace,{mode:0o700});const calls=[],bridge=await createTextboxMuseBridge({presence,presentationGuidance,...(experimentalCollaboration===null?{}:{experimentalCollaboration}),environment:{HOME:os.homedir(),PATH:process.env.PATH,OPEN_PRESENCE_AUTH_CLIENT_SECRET:'DO_NOT_INHERIT',NPM_TOKEN:'DO_NOT_INHERIT'},execute:fakeExecute(calls,executeOptions)});t.after(async()=>{await bridge.close();await fs.rm(root,{recursive:true,force:true});});return{root,workspace,calls,bridge,prepare:()=>bridge.prepareBoundary({workspace,binary:'/fake/muse'})};}
async function runHook(f,event='PreLLMCall',extra={}){const file=path.join(f.workspace,'.muse/presence-boundary-plugin/hooks',event==='PreLLMCall'?'muse-pre-boundary.mjs':'muse-post-boundary.mjs');const incoming={hook_event_name:event,cwd:f.workspace,session_id:sid,turn_id:tid,request_id:'request-1',messages:[{text:'PRIVATE_PROMPT_SENTINEL'}],...extra};const child=spawn(process.execPath,[file,'--workspace',f.workspace,'--socket',f.bridge.socket,'--event',event],{stdio:['pipe','pipe','pipe']});let out='',error='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>error+=x);child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(incoming));const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});assert.equal(exit,0);assert.equal(error,'');return JSON.parse(out);}

test('supported plugin setup uses private auth-free metadata commands and reviewed capability hashes',async t=>{const f=await fixture(t);const approved=f.prepare();assert.deepEqual(approved.capability_override,cap);assert.deepEqual(approved.post_capability_override,cap);assert.deepEqual(f.calls.map(c=>c.args[1]),['validate','install','approve','approve']);assert.ok(f.calls.every(c=>c.options.cwd===f.workspace&&c.options.env.MUSE_NO_AUTO_UPDATE==='1'));const s=await fs.stat(f.bridge.socket),d=await fs.stat(path.dirname(f.bridge.socket));assert.equal(s.mode&0o777,0o600);assert.equal(d.mode&0o777,0o700);const plugin=JSON.parse(await fs.readFile(path.join(f.workspace,'.muse/presence-boundary-plugin/.muse-plugin/plugin.json'),'utf8'));assert.deepEqual(plugin.capabilities.hooks.map(h=>[h.id,h.event]),[['pre-llm','PreLLMCall'],['post-llm','PostLLMCall']]);assert.ok(plugin.capabilities.hooks.every(h=>h.command[0]===process.execPath&&!h.command.includes('production')));assert.throws(()=>f.prepare(),/workspace_invalid/);});

test('actual Node pre hooks replace initial/follow-up guidance and compatible audit contains no content',async t=>{let value=selection(),reads=0;const recorded=[];const f=await fixture(t,{presence:{selectForRequest:()=>{reads++;return value;},recordSelection:(source,x)=>recorded.push({source,id:x.reading_id})}});f.prepare();const first=(await runHook(f)).hookSpecificOutput.additionalContext;assert.ok(first.endsWith(guidance));assert.match(first,/supersedes earlier Presence/);value={...selection(),guidance:'NEW_SYNTHETIC_GUIDANCE',reading_id:'reading-2'};const second=(await runHook(f,'PreLLMCall',{request_id:'request-2'})).hookSpecificOutput.additionalContext;assert.ok(second.endsWith('NEW_SYNTHETIC_GUIDANCE'));assert.ok(!second.includes(guidance));const hooks=await readOwnedPreHooks(f.workspace,sid,tid);assert.equal(hooks.length,2);assert.equal(hooks[1].eligible,true);assert.equal(hooks[1].digest,createHash('sha256').update(value.guidance).digest('hex'));const facts=requestDeliveryFacts({input:[{role:'user',content:'TASK'},{role:'developer',content:second}]},createHash('sha256').update('TASK').digest('hex'));assert.ok(facts.guidance_hashes.includes(hooks[1].digest));assert.deepEqual(recorded,[{source:'hook',id:'reading-1'},{source:'hook',id:'reading-2'}]);assert.equal(reads,2);const audit=await fs.readFile(path.join(f.workspace,'.presence/hook-events.jsonl'),'utf8');assert.ok(!audit.includes(guidance)&&!audit.includes('PRIVATE_PROMPT')&&!audit.includes('NEW_SYNTHETIC_GUIDANCE'));assert.equal((await fs.stat(path.join(f.workspace,'.presence/hook-events.jsonl'))).mode&0o777,0o600);});

test('real Node hooks retain last valid guidance through a pause and fall back on withdrawal or ended session',async t=>{let at=0;const presence=new TextboxPresence({now:()=>at,monotonicNow:()=>at,client:{capture:async()=>({status:'usable',guidance,controls:selection().controls,generated_at:'2026-10-28T12:00:00Z',received_at:'2026-10-28T12:00:00Z',renderer:'coding-instructions.3'})}});presence.open('synthetic');presence.setConsent(true);await presence.capture(payload());const f=await fixture(t,{presence});f.prepare();assert.ok((await runHook(f)).hookSpecificOutput.additionalContext.endsWith(guidance));at=180001;const retained=presence.selectForRequest();assert.equal(retained.reading_freshness,'last_known');assert.equal(retained.age_ms,180001);assert.ok((await runHook(f)).hookSpecificOutput.additionalContext.endsWith(guidance));for(const action of[()=>presence.setConsent(false),()=>presence.clear()]){action();const context=(await runHook(f)).hookSpecificOutput.additionalContext;assert.match(context,/Presence unavailable or ineligible:/);assert.match(context,/do not reuse earlier guidance/);assert.ok(!context.includes(guidance));const facts=requestDeliveryFacts({input:[{role:'developer',content:context}]},'irrelevant');assert.equal(facts.fallback,true);}});

test('foreign cwd and wrong events never consult source; post hook is observation only',async t=>{let reads=0;const f=await fixture(t,{presence:{selectForRequest:()=>{reads++;return selection();}}});f.prepare();const a=await runHook(f,'PreLLMCall',{cwd:f.root});assert.match(a.hookSpecificOutput.additionalContext,/do not reuse earlier guidance/);await runHook(f,'PreLLMCall',{hook_event_name:'PostLLMCall'});assert.equal(reads,0);assert.deepEqual(await runHook(f,'PostLLMCall',{response_id:'response-1',status:'ok'}),{});assert.equal(reads,0);const audit=JSON.parse((await fs.readFile(path.join(f.workspace,'.presence/hook-events.jsonl'),'utf8')).trim());assert.equal(audit.event,'PostLLMCall');assert.equal(audit.response_id,'response-1');assert.equal(audit.provider_status,'successful');assert.equal(audit.guidance_sha256,undefined);});

test('closed bridge cleans its owned socket; remaining hook emits replacement fallback',async t=>{const f=await fixture(t);f.prepare();await f.bridge.close();await f.bridge.close();await assert.rejects(fs.stat(path.dirname(f.bridge.socket)),/ENOENT/);assert.match((await runHook(f)).hookSpecificOutput.additionalContext,/do not reuse earlier guidance/);assert.throws(()=>f.prepare(),/configuration_invalid/);});

test('validation or auth contamination refuses setup and removes only owned plugin/config',async t=>{for(const executeOptions of[{invalid:true},{auth:true}]){const f=await fixture(t,{executeOptions});assert.throws(()=>f.prepare(),/setup_failed/);await assert.rejects(fs.stat(path.join(f.workspace,'.muse/presence-boundary-plugin')),/ENOENT/);await assert.rejects(fs.stat(path.join(f.workspace,'.presence/textbox-muse-approval-config')),/ENOENT/);}});

test('oversized stdin and local protocol frames fail closed without reading or persisting content',async t=>{let reads=0;const f=await fixture(t,{presence:{selectForRequest:()=>{reads++;return selection();}}});f.prepare();const result=await runHook(f,'PreLLMCall',{messages:'PRIVATE_OVERSIZED_'+'.'.repeat(1024*1024)});assert.match(result.hookSpecificOutput.additionalContext,/do not reuse earlier guidance/);
 await new Promise((resolve,reject)=>{const client=net.createConnection(f.bridge.socket);client.on('error',()=>{});client.on('connect',()=>client.write('x'.repeat(4097)));client.on('close',resolve);client.setTimeout(1500,()=>{client.destroy();reject(Error('local_frame_timeout'));});});assert.equal(reads,0);await assert.rejects(fs.stat(path.join(f.workspace,'.presence/hook-events.jsonl')),/ENOENT/);
 const allowed=await runHook(f);assert.ok(allowed.hookSpecificOutput.additionalContext.endsWith(guidance));assert.equal(reads,1);
});

test('actual hook processes correlate policy replacement, retained guidance and explicit fallback across four requests',async t=>{
 let at=0,result={status:'usable',guidance,controls:selection().controls,generated_at:'2026-10-30T08:00:00Z',received_at:'2026-10-30T08:00:00Z',renderer:'coding-instructions.3'};
 const presence=new TextboxPresence({now:()=>at,monotonicNow:()=>at,client:{capture:async()=>result}});presence.open('synthetic');presence.setConsent(true);await presence.capture(payload());
 const f=await fixture(t,{presence});f.prepare();const delivery=new MuseDelivery({arm:'with',workspace:f.workspace});delivery.begin('CODING TASK');delivery.bind(sid,tid);
 const observe=async()=>{const context=(await runHook(f)).hookSpecificOutput.additionalContext;delivery.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:context},{role:'user',content:'CODING TASK'}]})+'\n'));};
 await observe();at=30000;result={...result,guidance:'NEW_PRIVATE_POLICY',controls:{...result.controls,response_extent:'full'},generated_at:'2026-10-30T08:00:30Z'};await presence.capture(payload());await observe();at+=180001;await observe();assert.equal(presence.selectForRequest().reading_freshness,'last_known');presence.setConsent(false);await observe();delivery.publicFinal();await delivery.finishTurn();
 const out=delivery.snapshot();assert.equal(out.status,'mixed_observed');assert.equal(out.hook_linkage,'read_marker_matched');assert.equal(out.response_linkage,'unverified');
 assert.deepEqual(out.request_attribution.map(x=>[x.status,x.controls?.response_extent??null]),[['guidance_observed','terse'],['guidance_observed','full'],['guidance_observed','full'],['fallback_observed',null]]);
 assert.equal(new Set(out.request_attribution.map(x=>x.read_id)).size,4);assert.notEqual(out.request_attribution[0].reading_id,out.request_attribution[1].reading_id);
 assert.ok(!JSON.stringify(out).includes('PRIVATE_POLICY'));assert.ok(!JSON.stringify(out).includes(guidance));await delivery.settled();
});

test('packaged native hook translates categorical A-B-A into a bounded stable contract and withdraws it on fallback',async t=>{
 let value=selection();const f=await fixture(t,{presence:{selectForRequest:()=>value}});f.prepare();
 const contexts=[];for(const c of[
 {response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'},
 {response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'},
 {response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'}
 ]){value={...selection(),controls:c};contexts.push((await runHook(f)).hookSpecificOutput.additionalContext);}
 const contract=context=>{const start=context.indexOf('Muse collaboration v1:\n'),end=context.indexOf('Server guidance (verbatim):\n');assert.ok(start>=0&&end>start,'eligible structured controls must produce a Muse contract');return context.slice(start,end)};
 const [a,b,c]=contexts.map(contract);assert.equal(a,c);assert.notEqual(a,b);assert.ok(Buffer.byteLength(a)<=384);assert.ok(Buffer.byteLength(b)<=384);
 assert.match(a,/omit|skip/i);assert.match(a,/risks|checks/i);assert.match(b,/alternative|trade.off/i);assert.match(b,/question/i);
 for(const context of contexts)assert.ok(context.endsWith(guidance),'verbatim guidance and its digest stay intact');
 const helper=path.join(f.workspace,'.muse/presence-boundary-plugin/hooks/muse-collaboration-contract.mjs');assert.equal((await fs.stat(helper)).mode&0o777,0o600);
 const source=new URL('../scripts/muse-collaboration-contract.mjs',import.meta.url);assert.equal(createHash('sha256').update(await fs.readFile(helper)).digest('hex'),createHash('sha256').update(await fs.readFile(source)).digest('hex'));
 value={status:'fallback'};const fallback=(await runHook(f)).hookSpecificOutput.additionalContext;assert.match(fallback,/ordinary behavior/);assert.ok(!fallback.includes('Muse collaboration v1:'));assert.ok(!fallback.includes(guidance));
});

test('compiled contract proof binds the exact current instructions to audited controls and withdraws on fallback',async t=>{
 let value={...selection(),reading_id:'40000000-0000-4000-8000-000000000001'};const f=await fixture(t,{presence:{selectForRequest:()=>value}});f.prepare();const d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('CONTRACT TASK');d.bind(sid,tid);
 const observe=async()=>{const context=(await runHook(f)).hookSpecificOutput.additionalContext;d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:context},{role:'user',content:'CONTRACT TASK'}]})+'\n'));return context;};
 await observe();value={...value,controls:{response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'}};await observe();value={status:'fallback'};await observe();await d.finishTurn();await d.settled();
 const rows=d.snapshot().request_attribution;assert.deepEqual(rows.map(r=>r.collaboration_contract?.status),['matched','matched','withdrawn']);assert.ok(rows.slice(0,2).every(r=>r.collaboration_contract.added_utf8_bytes>0&&r.collaboration_contract.added_utf8_bytes<=384));assert.equal(rows[2].collaboration_contract.added_utf8_bytes,0);assert.ok(!JSON.stringify(d.snapshot()).includes(guidance));
 const {createEvidenceStore}=await import('../src/evidence-store.mjs'),store=await createEvidenceStore({directory:path.join(f.root,'evidence'),debounceMs:0}),id=store.begin(1);try{store.capture(id,{status:'ready',arms:{with:{status:'ready',delivery:d.snapshot()},without:{status:'ready'}}});await store.flush(id);const exported=await store.export(id);assert.deepEqual(exported.arms.with.delivery.request_attribution.map(r=>r.collaboration_contract.status),['matched','matched','withdrawn']);assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root,'evidence',id+'.json'),'utf8')),exported);assert.ok(!JSON.stringify(exported).includes(guidance));}finally{await store.close();}
 value=selection();const next='10000000-0000-4000-8000-000000000003',context=(await runHook(f,'PreLLMCall',{turn_id:next})).hookSpecificOutput.additionalContext,wrong=context.replace('omit optional walkthrough','invent extra steps'),d2=new MuseDelivery({arm:'with',workspace:f.workspace});d2.begin('FORGED CONTRACT');d2.bind(sid,next);d2.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:wrong},{role:'user',content:'FORGED CONTRACT'}]})+'\n'));await d2.finishTurn();await d2.settled();assert.equal(d2.snapshot().status,'guidance_observed');assert.equal(d2.snapshot().request_attribution[0].collaboration_contract.status,'unverified');
});

test('fallback contract withdrawal cannot be claimed for retained or malformed instructions in the current refresh',async t=>{
 const {compileMuseCollaboration}=await import('../scripts/muse-collaboration-contract.mjs');let value={status:'fallback'};const f=await fixture(t,{presence:{selectForRequest:()=>value}});f.prepare();
 for(const [i,tail]of ['\n'+compileMuseCollaboration(selection().controls).text,'\nMuse collaboration v999: retained',' inline Muse collaboration v1: retained','\n  muse  collaboration v1: retained'].entries()){
  const turn='20000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),context=(await runHook(f,'PreLLMCall',{turn_id:turn})).hookSpecificOutput.additionalContext,d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('FALLBACK CHECK');d.bind(sid,turn);d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:context+tail},{role:'user',content:'FALLBACK CHECK'}]})+'\n'));await d.finishTurn();await d.settled();assert.equal(d.snapshot().status,'fallback_observed');assert.equal(d.snapshot().request_attribution[0].collaboration_contract.status,'unverified');
 }
});

test('duplicate whole current refresh fails closed while an older distinct refresh stays historical',async t=>{
 const f=await fixture(t);f.prepare();const older=(await runHook(f,'PreLLMCall',{turn_id:'30000000-0000-4000-8000-000000000001'})).hookSpecificOutput.additionalContext;
 for(const duplicate of [true,false]){
  const turn=duplicate?'30000000-0000-4000-8000-000000000002':'30000000-0000-4000-8000-000000000003',current=(await runHook(f,'PreLLMCall',{turn_id:turn})).hookSpecificOutput.additionalContext,body=(duplicate?current:older)+'\n\n'+current,d=new MuseDelivery({arm:'with',workspace:f.workspace});
  d.begin('CURRENT REQUEST');d.bind(sid,turn);d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:body},{role:'user',content:'CURRENT REQUEST'}]})+'\n'));await d.finishTurn();await d.settled();
  assert.equal(d.snapshot().status,duplicate?'unverified':'guidance_observed');assert.equal(d.snapshot().request_attribution[0].collaboration_contract.status,duplicate?'unverified':'matched');
 }
});

test('positive contract proof rejects malformed extra markers outside the canonical block',async t=>{
 const f=await fixture(t);f.prepare();const context=(await runHook(f)).hookSpecificOutput.additionalContext,d=new MuseDelivery({arm:'with',workspace:f.workspace});
 const injected=context.replace('Muse collaboration v1:',' inline muse  collaboration v999: conflicting instructions\nMuse collaboration v1:');d.begin('DUPLICATE POLICY');d.bind(sid,tid);d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:injected},{role:'user',content:'DUPLICATE POLICY'}]})+'\n'));await d.finishTurn();await d.settled();assert.equal(d.snapshot().request_attribution[0].collaboration_contract.status,'unverified');
});

test('missing packaged compiler emits ordinary replacement fallback without a module-load crash',async t=>{
 const f=await fixture(t);f.prepare();await fs.unlink(path.join(f.workspace,'.muse/presence-boundary-plugin/hooks/muse-collaboration-contract.mjs'));const context=(await runHook(f)).hookSpecificOutput.additionalContext;assert.match(context,/Use ordinary behavior; do not reuse earlier guidance/);assert.ok(!context.includes('Muse collaboration v1:'));assert.ok(!context.includes(guidance));assert.deepEqual(await runHook(f,'PostLLMCall'),{});
});


test('unqualified compact wording is disabled by default without disabling real Presence guidance or fallback',async t=>{
 for(const experimentalCollaboration of [null,false]){
  let value=selection();const f=await fixture(t,{experimentalCollaboration,presence:{selectForRequest:()=>value}});f.prepare();
  // Ordinary With Presence must not need or load the experimental companion.
  await fs.unlink(path.join(f.workspace,'.muse/presence-boundary-plugin/hooks/muse-collaboration-contract.mjs'));
  const d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('DEFAULT GUIDANCE');d.bind(sid,tid);
  const observe=async context=>{d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:context},{role:'user',content:'DEFAULT GUIDANCE'}]})+'\n'));await d.settled();};
  const first=(await runHook(f)).hookSpecificOutput.additionalContext;
  assert.ok(first.endsWith('Server guidance (verbatim):\n'+guidance));assert.ok(!first.includes('Muse collaboration'));await observe(first);
  value={...value,controls:{response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'},guidance:'CHANGED_SERVER_GUIDANCE'};
  const second=(await runHook(f)).hookSpecificOutput.additionalContext;assert.ok(second.endsWith('CHANGED_SERVER_GUIDANCE'));assert.ok(!second.includes(guidance));await observe(second);
  const hooks=await readOwnedPreHooks(f.workspace,sid,tid);assert.ok(hooks.every(h=>h.collaboration_version===undefined));
  await d.finishTurn();await d.settled();assert.equal(d.snapshot().status,'guidance_observed');assert.equal(d.snapshot().request_attribution[0].collaboration_contract,undefined);
  value={status:'fallback'};const fallback=(await runHook(f)).hookSpecificOutput.additionalContext;assert.match(fallback,/ordinary behavior/);assert.ok(!fallback.includes('CHANGED_SERVER_GUIDANCE'));
 }
});


test('v2 packaged hooks vary A-B-A presentation hints, preserve OP verbatim, and withdraw hints on ineligible',async t=>{
 const {compileMusePresentation,MUSE_PRESENTATION_MAX_BYTES}=await import('../scripts/muse-presentation-guidance.mjs');
 let value=selection();const f=await fixture(t,{presentationGuidance:true,experimentalCollaboration:false,presence:{selectForRequest:()=>value}});f.prepare();
 const a={response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'},b={response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'},contexts=[],delivery=new MuseDelivery({arm:'with',workspace:f.workspace});let step=0;delivery.begin('PRESENTATION TASK');delivery.bind(sid,tid);
 for(const controls of[a,b,a]){value={...selection(),controls,reading_id:'40000000-0000-4000-8000-'+String(++step).padStart(12,'0')};const context=(await runHook(f)).hookSpecificOutput.additionalContext,expected=compileMusePresentation(controls);contexts.push(context);delivery.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:context},{role:'user',content:'PRESENTATION TASK'}]})+'\n'));assert.ok(context.includes(expected.text+'\nServer guidance (verbatim):\n'+guidance));assert.ok(Buffer.byteLength(expected.text+'\n')<=MUSE_PRESENTATION_MAX_BYTES);assert.ok(context.endsWith(guidance));}
 const block=c=>c.slice(c.indexOf('Muse collaboration v2:'),c.indexOf('Server guidance (verbatim):'));
 assert.equal(block(contexts[0]),block(contexts[2]));assert.notEqual(block(contexts[0]),block(contexts[1]));
 const audit=(await fs.readFile(path.join(f.workspace,'.presence/hook-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(audit.every(r=>r.adapter_revision==='textbox-generation-boundary.5'&&r.collaboration_version===2));assert.equal(new Set(audit.map(r=>r.read_id)).size,3);assert.ok(audit.every(r=>!Object.hasOwn(r,'presentation_helper_sha256')));assert.ok(!JSON.stringify(audit).includes(guidance));
 const packaged=path.join(f.workspace,'.muse/presence-boundary-plugin/hooks/muse-presentation-guidance.mjs');assert.equal((await fs.stat(packaged)).mode&0o777,0o600);assert.deepEqual(await fs.readFile(packaged),await fs.readFile(new URL('../scripts/muse-presentation-guidance.mjs',import.meta.url)));
 value={status:'fallback'};const fallback=(await runHook(f)).hookSpecificOutput.additionalContext;assert.match(fallback,/Earlier Muse presentation hints are withdrawn/);assert.match(fallback,/Use ordinary behavior; do not reuse earlier guidance/);assert.ok(!fallback.includes('Muse collaboration v2:'));assert.ok(!fallback.includes(guidance));
 delivery.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:fallback},{role:'user',content:'PRESENTATION TASK'}]})+'\n'));await delivery.finishTurn();await delivery.settled();const rows=delivery.snapshot().request_attribution;assert.deepEqual(rows.map(r=>r.collaboration_contract.status),['matched','matched','matched','withdrawn']);assert.ok(rows.every(r=>r.collaboration_contract.version===2));
 const {projectEvidence}=await import('../src/evidence-projection.mjs'),exported=projectEvidence({arms:{with:{delivery:delivery.snapshot()}}});assert.deepEqual(exported.arms.with.delivery.request_attribution.map(r=>r.collaboration_contract.status),['matched','matched','matched','withdrawn']);assert.ok(!JSON.stringify(exported).includes(guidance));assert.ok(!JSON.stringify(exported).includes('Muse collaboration v2:'));
});

test('v2 packaged hook keeps every control combination within the exact 384-byte presentation bound',async t=>{
 let value=selection();const f=await fixture(t,{presentationGuidance:true,experimentalCollaboration:false,presence:{selectForRequest:()=>value}});f.prepare();let largest=0;
 for(const response_extent of['terse','standard','full'])for(const unsolicited_update of['send','defer'])for(const conversation_style of['conversational','self_contained']){
  value={...selection(),controls:{response_extent,unsolicited_update,conversation_style}};const context=(await runHook(f)).hookSpecificOutput.additionalContext,start=context.indexOf('Muse collaboration v2:\n'),end=context.indexOf('Server guidance (verbatim):\n');assert.ok(start>=0&&end>start);const bytes=Buffer.byteLength(context.slice(start,end));assert.ok(bytes<=384);largest=Math.max(largest,bytes);assert.ok(context.endsWith(guidance));
 }
 assert.ok(largest>0);
});

test('missing or modified v2 helper preserves eligible OP and explicitly withdraws earlier presentation hints',async t=>{
 for(const change of['missing','syntax','valid_but_modified']){
  const f=await fixture(t,{presentationGuidance:true,experimentalCollaboration:false,presence:{selectForRequest:()=>({...selection(),reading_id:'50000000-0000-4000-8000-000000000001'})}});f.prepare();const helper=path.join(f.workspace,'.muse/presence-boundary-plugin/hooks/muse-presentation-guidance.mjs');
  if(change==='missing')await fs.unlink(helper);else await fs.writeFile(helper,change==='syntax'?'not valid JavaScript !':`export const MUSE_PRESENTATION_VERSION=2,MUSE_PRESENTATION_MAX_BYTES=384;export function compileMusePresentation(){const text=['Muse collaboration v2:','Unexpected replacement'].join(String.fromCharCode(10));return{version:2,text,utf8_bytes:Buffer.byteLength(text)}}`);
  if(change==='valid_but_modified'){const modified=await import(new URL('file://'+helper));assert.match(modified.compileMusePresentation().text,/^Muse collaboration v2:/);}
  const context=(await runHook(f)).hookSpecificOutput.additionalContext;assert.ok(context.endsWith('Server guidance (verbatim):\n'+guidance),change);assert.match(context,/withdraw earlier Muse presentation hints/);assert.ok(!context.includes('Muse collaboration v2:'),change);assert.ok(!context.includes('Presence unavailable or ineligible:'),change);const d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('MISSING PRESENTATION');d.bind(sid,tid);d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:context},{role:'user',content:'MISSING PRESENTATION'}]})+'\n'));await d.finishTurn();await d.settled();assert.equal(d.snapshot().status,'guidance_observed');assert.deepEqual(d.snapshot().request_attribution[0].collaboration_contract,{version:2,status:'unverified',added_utf8_bytes:null});assert.deepEqual(await runHook(f,'PostLLMCall'),{});
 }
});

test('default and v1 output bytes stay exact, and neither packages the v2 companion',async t=>{
 const prefix='Automatic Presence refresh immediately before this model generation, including final-answer generation. The highest Presence sequence for this turn supersedes earlier Presence context, regardless of block order. Correctness, requested substance, explicit user intent and required approvals take precedence. Do not claim tests or execution without evidence.\n';
 const {compileMuseCollaboration}=await import('../scripts/muse-collaboration-contract.mjs');
 for(const experimentalCollaboration of[false,true]){
  let value=selection();const f=await fixture(t,{experimentalCollaboration,presence:{selectForRequest:()=>value}});f.prepare();await assert.rejects(fs.stat(path.join(f.workspace,'.muse/presence-boundary-plugin/hooks/muse-presentation-guidance.mjs')),/ENOENT/);
  const context=(await runHook(f)).hookSpecificOutput.additionalContext,match=/Presence read: ([a-f0-9-]{36})\n/.exec(context);assert.ok(match);assert.equal(context,prefix+'Presence turn: '+tid+'\nPresence sequence: 1\n'+match[0]+(experimentalCollaboration?compileMuseCollaboration(value.controls).text+'\n':'')+'Server guidance (verbatim):\n'+guidance);
  value={status:'fallback'};const fallback=(await runHook(f)).hookSpecificOutput.additionalContext,read=/Presence read: [a-f0-9-]{36}\n/.exec(fallback);assert.equal(fallback,prefix+'Presence turn: '+tid+'\nPresence sequence: 2\n'+read[0]+'Presence unavailable or ineligible: textbox guidance unavailable. Use ordinary behavior; do not reuse earlier guidance.');
 }
});

test('presentation v2 must be an explicit boolean and cannot combine with the failed compact v1 mode',async()=>{
 for(const options of[{presentationGuidance:'yes'},{presentationGuidance:true,experimentalCollaboration:true}])await assert.rejects(createTextboxMuseBridge({presence:{selectForRequest:selection},...options}),/textbox_bridge_invalid/);
});


test('real pre-hook output carries monotonic owned-workspace sequence across late changes, fallback and follow-up',async t=>{
 let index=0;const f=await fixture(t,{experimentalCollaboration:false,presence:{selectForRequest:()=>{index++;return index===14?{status:'fallback'}:{...selection(),guidance:index<11?'EARLY_FIXTURE':'LATE_FIXTURE',reading_id:'reading-'+index};}}});f.prepare();
 const ids=[];
 for(let n=1;n<=20;n++){
  const turn=n===20?'20000000-0000-4000-8000-000000000020':tid,context=(await runHook(f,'PreLLMCall',{turn_id:turn,request_id:'request-'+n})).hookSpecificOutput.additionalContext;
  assert.match(context,new RegExp('Presence turn: '+turn+'\\nPresence sequence: '+n+'\\nPresence read: '));assert.match(context,/highest Presence sequence/);
  ids.push(/Presence read: ([a-f0-9-]{36})/.exec(context)[1]);
  if(n===14)assert.match(context,/do not reuse earlier guidance/);else assert.ok(context.endsWith(n<11?'EARLY_FIXTURE':'LATE_FIXTURE'));
 }
 assert.equal(new Set(ids).size,20);
 const rows=(await fs.readFile(path.join(f.workspace,'.presence/hook-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(rows.map(r=>r.read_sequence),Array.from({length:20},(_,i)=>i+1));assert.ok(rows.every(r=>r.adapter_revision==='textbox-generation-boundary.5'));
 assert.ok(!JSON.stringify(rows).includes('LATE_FIXTURE'));
});

test('sequence belongs to its workspace and a response hook does not advance it',async t=>{
 const f=await fixture(t,{experimentalCollaboration:false});f.prepare();const other=path.join(f.root,'other');await fs.mkdir(other,{mode:0o700});f.bridge.prepareBoundary({workspace:other,binary:'/fake/muse'});
 const get=async fixture=>Number(/Presence sequence: ([0-9]+)/.exec((await runHook(fixture)).hookSpecificOutput.additionalContext)?.[1]);
 assert.equal(await get(f),1);await runHook(f,'PostLLMCall');assert.equal(await get(f),2);assert.equal(await get({...f,workspace:other}),1);assert.equal(await get(f),3);
});

test('unknown pre-hook native scope falls back without consulting Presence',async t=>{
 let reads=0;const f=await fixture(t,{presence:{selectForRequest:()=>{reads++;return selection();}}});f.prepare();
 for(const extra of [{turn_id:'invalid'},{session_id:'invalid'}]){const context=(await runHook(f,'PreLLMCall',extra)).hookSpecificOutput.additionalContext;assert.match(context,/do not reuse earlier guidance/);assert.ok(!context.includes(guidance));}
 assert.equal(reads,0);
});


test('real hook output stays attributable through twenty lexically ordered generations, late policy changes and fallback',async t=>{
 let value=selection();const f=await fixture(t,{experimentalCollaboration:false,presence:{selectForRequest:()=>value}});f.prepare();
 const d=new MuseDelivery({arm:'with',workspace:f.workspace});d.begin('TRIP BILL CODING');d.bind(sid,tid);const contexts=[],expected=[];
 for(let step=0;step<20;step++){
  value=step===13?{status:'fallback'}:{...selection(),guidance:'POLICY_FIXTURE_'+step,reading_id:'reading-'+step,controls:{response_extent:step<10?'full':'terse',unsolicited_update:step<10?'send':'defer',conversation_style:step<10?'conversational':'self_contained'}};
  const context=(await runHook(f,'PreLLMCall',{request_id:'request-'+step})).hookSpecificOutput.additionalContext;contexts.push(context);
  const input=Array.from({length:contexts.length},(_,i)=>i).sort((a,b)=>String(a).localeCompare(String(b))).map(i=>({role:'developer',content:contexts[i]}));input.push({role:'user',content:'TRIP BILL CODING'});
  d.feed(Buffer.from('REQUEST: '+JSON.stringify({model:'muse-spark-1.3',input})+'\n'));await d.settled();expected.push(step===13?'fallback_observed':'guidance_observed');
 }
 await d.finishTurn();await d.settled();const proof=d.snapshot();assert.deepEqual(proof.request_attribution.map(r=>r.status),expected);assert.equal(proof.requests_observed,20);assert.equal(proof.hook_linkage,'read_marker_matched');assert.equal(proof.request_attribution[10].controls.response_extent,'terse');assert.equal(proof.request_attribution[19].reading_id,'reading-19');assert.ok(!JSON.stringify(proof).includes('POLICY_FIXTURE_'));
});
