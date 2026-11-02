import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createOpenPresenceClient,loadPrivateOpConfig} from '../src/op-service-client.mjs';
import {TextboxPresence} from '../src/textbox-presence.mjs';
const cutoffAt='2026-11-15T00:00:00.000Z',cutoff=Date.parse(cutoffAt);
const payload=()=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:'synthetic-cutoff',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
const capsule=()=>({generated_at:'2026-11-14T23:59:59.000Z',controls:{response_extent:'standard',unsolicited_update:'send',conversation_style:'conversational'},instructions:{version:'coding-instructions.3',llm:{preamble:'SYNTHETIC_CUTOFF_GUIDANCE'}}});
const response=value=>new Response(JSON.stringify(value));
function fixture({at=cutoff-1000,withCutoff=true,fetcher=null,resolve=null}={}){
 let now=at;const calls=[];
 const client=createOpenPresenceClient({environment:'dev',client_id:'SYNTHETIC_ID',client_secret:'SYNTHETIC_SECRET',...(withCutoff?{client_cutoff_at:cutoffAt}:{}),now:()=>now,resolveCodingInstructions:resolve??(c=>({status:'usable',capsule:c})),fetcher:async(url,request)=>{calls.push(url.endsWith('/token')?'auth':'capture');return fetcher?fetcher(url,request,()=>{now=cutoff;}):response(url.endsWith('/token')?{access_token:'SYNTHETIC_TOKEN',expires_in:3600}:{status:'success',results:{a2_open:capsule()}});}});
 return{client,calls,setNow:x=>now=x,now:()=>now};
}
test('client cutoff denies exact/after boundary before any auth or capture dispatch',async()=>{
 for(const at of[cutoff,cutoff+1]){const f=fixture({at});assert.equal((await f.client.capture(payload())).status,'access_rejected');assert.deepEqual(f.calls,[]);}
 const before=fixture({at:cutoff-1});assert.equal((await before.client.capture(payload())).status,'usable');assert.deepEqual(before.calls,['auth','capture']);
});
test('cached token cannot authorize another capture at cutoff, even after clock rollback',async()=>{
 const f=fixture();assert.equal((await f.client.capture(payload())).status,'usable');f.setNow(cutoff);assert.equal((await f.client.capture(payload())).status,'access_rejected');assert.deepEqual(f.calls,['auth','capture']);f.setNow(cutoff-1000);assert.equal((await f.client.capture(payload())).status,'access_rejected');assert.deepEqual(f.calls,['auth','capture']);assert.equal(f.client.accessStatus(),'expired');
});
test('cutoff during Auth prevents the subsequent capture',async()=>{
 const f=fixture({fetcher:async(url,_r,expire)=>{assert.ok(url.endsWith('/token'));expire();return response({access_token:'SYNTHETIC_TOKEN',expires_in:3600});}});assert.equal((await f.client.capture(payload())).status,'access_rejected');assert.deepEqual(f.calls,['auth']);
});
test('cutoff in the pre-dispatch callback prevents capture dispatch',async()=>{
 const f=fixture();assert.equal((await f.client.capture(payload(),{onDispatch:()=>f.setNow(cutoff)})).status,'access_rejected');assert.deepEqual(f.calls,['auth']);
});
test('capture response and validator crossing cutoff cannot promote a policy',async()=>{
 for(const stage of['response','validation']){
  let f;f=fixture({resolve:c=>{if(stage==='validation')f.setNow(cutoff);return{status:'usable',capsule:c};},fetcher:async(url,_r,expire)=>{if(url.endsWith('/token'))return response({access_token:'SYNTHETIC_TOKEN',expires_in:3600});if(stage==='response')expire();return response({status:'success',results:{a2_open:capsule()}});}});
  assert.equal((await f.client.capture(payload())).status,'access_rejected',stage);assert.equal(f.client.accessStatus(),'expired');assert.equal(f.client.diagnostics().validation,null);assert.deepEqual(f.calls,['auth','capture']);
 }
});
test('retained OP guidance expires at cutoff without capture, and ordinary coding cache reads continue',async()=>{
 const f=fixture(),p=new TextboxPresence({client:f.client,now:f.now,monotonicNow:f.now});p.open('synthetic');p.setConsent(true);await p.capture(payload());assert.equal(p.selectForRequest().status,'selected');const history=p.snapshot().readings;
 f.setNow(cutoff);assert.equal(p.sourceSnapshot().source.eligible,false);assert.equal(p.selectForRequest().status,'fallback');assert.equal(p.snapshot().selected,false);assert.equal(p.session,'synthetic');assert.equal(p.consent,true);assert.deepEqual(p.snapshot().readings,history);assert.deepEqual(f.calls,['auth','capture']);f.setNow(cutoff-1000);assert.equal(p.selectForRequest().status,'fallback');
});
test('late usable result cannot reactivate expired cache, including an already-pending refresh',async()=>{
 let release,clock=cutoff-1000;const client={dispatch_reporting:true,accessStatus:()=>clock>=cutoff?'expired':'active',capture:async()=>new Promise(r=>release=r)};const p=new TextboxPresence({client,now:()=>clock,monotonicNow:()=>clock});p.open('synthetic');p.setConsent(true);const pending=p.capture(payload());clock=cutoff;assert.equal(p.selectForRequest().status,'fallback');release({status:'usable',guidance:'SYNTHETIC_LATE_POLICY',controls:capsule().controls,generated_at:cutoffAt,received_at:cutoffAt,renderer:'coding-instructions.3'});await pending;assert.equal(p.selectForRequest().status,'fallback');assert.equal(p.readingCount,0);assert.equal(p.session,'synthetic');
});
test('existing config and retained guidance without cutoff preserve their active-session semantics',async()=>{
 const f=fixture({withCutoff:false}),p=new TextboxPresence({client:f.client,now:f.now,monotonicNow:f.now});p.open('ordinary');p.setConsent(true);await p.capture(payload());f.setNow(cutoff+600000);assert.equal(p.selectForRequest().status,'selected');assert.equal(p.selectForRequest().reading_freshness,'last_known');assert.equal((await f.client.capture(payload())).status,'usable');assert.deepEqual(f.calls,['auth','capture','capture']);
});
test('optional cutoff config is validated without weakening legacy field/permission checks',async t=>{
 const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'op-cutoff-test-'))),repoRoot=path.join(parent,'repo'),file=path.join(parent,'config.json');await fs.mkdir(repoRoot);t.after(()=>fs.rm(parent,{recursive:true,force:true}));const base={environment:'dev',client_id:'SYNTHETIC_ID',client_secret:'SYNTHETIC_SECRET'};
 await fs.writeFile(file,JSON.stringify({...base,client_cutoff_at:cutoffAt}),{mode:0o600});assert.equal((await loadPrivateOpConfig(file,{repoRoot})).client_cutoff_at,cutoffAt);
 for(const value of[null,0,'not-a-date','2026-11-15','2026-02-30T00:00:00.000Z','2026-11-15T00:00:00+00:00']){await fs.writeFile(file,JSON.stringify({...base,client_cutoff_at:value}));await assert.rejects(loadPrivateOpConfig(file,{repoRoot}),/op_config_invalid/);assert.throws(()=>createOpenPresenceClient({...base,client_cutoff_at:value,resolveCodingInstructions:()=>({status:'invalid'})}),/op_client_invalid/);}
 await fs.writeFile(file,JSON.stringify(base));assert.deepEqual(await loadPrivateOpConfig(file,{repoRoot}),base);
});

test('cutoff while reading Auth/capture bodies is checked after the awaited read',async()=>{
 for(const stage of['auth','capture']){
  const f=fixture({fetcher:async(url,_r,expire)=>{
   const auth=url.endsWith('/token'),body=auth?{access_token:'SYNTHETIC_TOKEN',expires_in:3600}:{status:'success',results:{a2_open:capsule()}};
   if((auth?'auth':'capture')!==stage)return response(body);
   return new Response(new ReadableStream({pull(controller){expire();controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close();}}));
  }});
  assert.equal((await f.client.capture(payload())).status,'access_rejected');assert.deepEqual(f.calls,stage==='auth'?['auth']:['auth','capture']);assert.equal(f.client.diagnostics().validation,null);
 }
});
test('an invalid cutoff clock fails closed and cannot revive after a later valid reading',async()=>{
 const f=fixture();f.setNow(NaN);assert.equal((await f.client.capture(payload())).status,'access_rejected');f.setNow(cutoff-1000);assert.equal((await f.client.capture(payload())).status,'access_rejected');assert.deepEqual(f.calls,[]);
});

test('selection crossing cutoff after its initial access check falls back without another fetch',async()=>{
 let advancing=false,reads=0,fetches=0;const now=()=>advancing?(reads++===0?cutoff-1:cutoff):cutoff-1000;
 const client=createOpenPresenceClient({environment:'dev',client_id:'SYNTHETIC_ID',client_secret:'SYNTHETIC_SECRET',client_cutoff_at:cutoffAt,now,resolveCodingInstructions:c=>({status:'usable',capsule:c}),fetcher:async url=>{fetches++;return response(url.endsWith('/token')?{access_token:'SYNTHETIC_TOKEN',expires_in:3600}:{status:'success',results:{a2_open:capsule()}});}});
 const p=new TextboxPresence({client,now,monotonicNow:()=>1});p.open('synthetic');p.setConsent(true);await p.capture(payload());assert.equal(p.selectForRequest().status,'selected');const history=p.readings.slice(),before=fetches;
 advancing=true;const selected=p.selectForRequest();assert.equal(selected.status,'fallback');assert.equal(p.selection,null);assert.deepEqual(p.readings,history);assert.equal(fetches,before);assert.equal(p.session,'synthetic');assert.equal(p.consent,true);
});
