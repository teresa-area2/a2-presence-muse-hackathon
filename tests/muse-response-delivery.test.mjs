import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MuseDelivery} from '../src/muse-delivery.mjs';
import {museDeliveryView} from '../web/muse-delivery-view.mjs';
import {StructuredArm} from '../src/structured-arm.mjs';
import {projectEvidence} from '../src/evidence-projection.mjs';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const sha=x=>createHash('sha256').update(x).digest('hex');
const session='10000000-0000-4000-8000-000000000001',turn='20000000-0000-4000-8000-000000000001',read='30000000-0000-4000-8000-000000000001',reading='40000000-0000-4000-8000-000000000001';
const controls={response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'};
function fixture({fallback=false,post=true,readResponseHooks=null}={}){
 const pre={event:'PreLLMCall',session_id:session,turn_id:turn,request_id:'request-a',read_id:read,reading_id:fallback?null:reading,eligible:!fallback,digest:fallback?null:sha('SYNTHETIC_POLICY'),controls:fallback?null:controls,read_at:new Date(Date.now()-1000).toISOString(),step:0,attempt:0};
 const after={event:'PostLLMCall',session_id:session,turn_id:turn,request_id:'request-a',response_id:'response-a',provider_status:'successful',step:0,attempt:0};
 const d=new MuseDelivery({arm:'with',workspace:'/owned',readHooks:async()=>[pre],readResponseHooks:readResponseHooks??(async()=>post?[after]:[])});
 const context='Automatic Presence refresh immediately before this model generation\nPresence read: '+read+'\n'+(fallback?'Presence unavailable or ineligible: unavailable. do not reuse earlier guidance':'Server guidance (verbatim):\nSYNTHETIC_POLICY');
 d.begin('task');d.bind(session,turn);d.feed(Buffer.from('REQUEST: '+JSON.stringify({model:'muse-spark-1.3',input:[{role:'developer',content:context},{role:'user',content:'task'}]})+'\n'));
 return d;
}
function response(d,{id='response-a',answer='SYNTHETIC_PUBLIC_ANSWER',reasoning='SYNTHETIC_HIDDEN_REASONING'}={}){d.feed(Buffer.from('SSE RESPONSE: '+JSON.stringify({type:'response.completed',response:{id,status:'completed',output:[{type:'reasoning',summary:[{text:reasoning}]},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer}]}],usage:{input_tokens:8,output_tokens:3}}})+'\n'));}
test('exact scoped request, provider completion and displayed answer establish final linkage without retaining text',async()=>{
 const d=fixture();response(d);d.publicFinal({text:'SYNTHETIC_PUBLIC_ANSWER',truncated:false});await d.finishTurn();const out=d.snapshot();
 assert.equal(out.status,'guidance_observed');assert.equal(out.response_linkage,'public_final_matched');assert.equal(out.response_attribution.linked_finals,1);assert.equal(out.response_attribution.finals[0].request_ordinal,1);assert.equal(out.response_attribution.finals[0].presence,'guidance');
 for(const value of ['SYNTHETIC_PUBLIC_ANSWER','SYNTHETIC_HIDDEN_REASONING','response-a','request-a',sha('SYNTHETIC_PUBLIC_ANSWER')])assert.ok(!JSON.stringify(out).includes(value));
});
test('ordinary fallback can be tied to an answer without claiming guidance or behavior',async()=>{
 const d=fixture({fallback:true});response(d);d.publicFinal({text:'SYNTHETIC_PUBLIC_ANSWER',truncated:false});await d.finishTurn();const out=d.snapshot();assert.equal(out.status,'fallback_observed');assert.equal(out.response_linkage,'public_final_matched');assert.equal(out.response_attribution.finals[0].presence,'fallback');assert.equal(out.behavior,'not_measured');
});
test('missing post evidence, truncated public text or a private reasoning match cannot qualify',async()=>{
 for(const variant of ['missing-post','truncated','reasoning-only']){const d=fixture({post:variant!=='missing-post'});response(d);d.publicFinal({text:variant==='reasoning-only'?'SYNTHETIC_HIDDEN_REASONING':'SYNTHETIC_PUBLIC_ANSWER',truncated:variant==='truncated'});await d.finishTurn();assert.equal(d.snapshot().response_linkage,'unverified',variant);}
});
test('two provider answers with identical public text remain ambiguous',async()=>{
 const d=fixture();response(d);response(d,{id:'response-b'});d.publicFinal({text:'SYNTHETIC_PUBLIC_ANSWER',truncated:false});await d.finishTurn();assert.equal(d.snapshot().response_linkage,'unverified');
});

test('proof requires completed coverage and survives safe export and the existing tooltip',async()=>{
 const d=fixture();response(d);d.publicFinal({text:'SYNTHETIC_PUBLIC_ANSWER',truncated:false});await d.settled();assert.equal(d.snapshot().response_linkage,'unverified','an in-progress stream cannot establish final coverage');await d.finishTurn();const raw=d.snapshot();
 const projected=projectEvidence({status:'ready',arms:{with:{status:'ready',delivery:raw},without:{status:'ready'}}}).arms.with.delivery;
 assert.equal(projected.response_linkage,'public_final_matched');assert.equal(projected.response_attribution.linked_finals,1);assert.match(museDeliveryView(projected).detail,/displayed final answer matches a provider completion/);assert.match(museDeliveryView(projected).detail,/Behavioral effects are measured separately/);
 const forged=structuredClone(raw);forged.response_attribution.finals[0].request_ordinal=2;
 assert.equal(projectEvidence({arms:{with:{delivery:forged}}}).arms.with.delivery.response_linkage,'unverified');
});
test('real owned pre/post audit files feed the same correlation without a custom reader',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'response-delivery-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'.presence'),{mode:0o700});
 const pre={event:'PreLLMCall',session_id:session,turn_id:turn,request_id:'request-a',read_id:read,reading_id:reading,eligible:true,guidance_sha256:sha('SYNTHETIC_POLICY'),controls,read_at:new Date(Date.now()-1000).toISOString(),step:0,attempt:0};
 const post={event:'PostLLMCall',session_id:session,turn_id:turn,request_id:'request-a',response_id:'response-a',provider_status:'successful',step:0,attempt:0};
 await fs.writeFile(path.join(root,'.presence/hook-events.jsonl'),JSON.stringify(pre)+'\n'+JSON.stringify(post)+'\n',{mode:0o600});
 const d=new MuseDelivery({arm:'with',workspace:root});d.begin('task');d.bind(session,turn);d.feed(Buffer.from('REQUEST: '+JSON.stringify({input:[{role:'developer',content:'Automatic Presence refresh immediately before this model generation\nPresence read: '+read+'\nServer guidance (verbatim):\nSYNTHETIC_POLICY'},{role:'user',content:'task'}]})+'\n'));response(d);d.publicFinal({text:'SYNTHETIC_PUBLIC_ANSWER',truncated:false});await d.finishTurn();assert.equal(d.snapshot().response_linkage,'public_final_matched');
});
test('structured session event wiring supplies the exact public final payload',()=>{
 const finals=[],payload={text:'SYNTHETIC_PUBLIC_ANSWER',truncated:false,cut_off:false};
 const client={sessionId:session,turnIds:new Set(),approvals:new Map(),closed:false,stopping:false};
 const arm=new StructuredArm({client,ledger:{bindTurn(){},accept(){return[{type:'public_message',payload:{...payload,message_phase:'finalAnswer'}}];}},usage:{},delivery:{bind(){},publicFinal:value=>finals.push(value)},onFatal:reason=>assert.fail(reason)});
 arm.prepare();arm.bindTurn(turn);arm.incoming({method:'item/completed',params:{sessionId:session,item:{kind:'agentMessage',turnId:turn}}});assert.deepEqual(finals,[{...payload,message_phase:'finalAnswer'}]);
});

test('a stale failed post read cannot erase a newer completed proof; the latest transient failure can recover',async()=>{
 const pending=[],post={session_id:session,turn_id:turn,request_id:'request-a',response_id:'response-a',provider_status:'successful',step:0,attempt:0};
 const d=fixture({readResponseHooks:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});await d.settled();response(d);await d.settled();d.publicFinal({text:'SYNTHETIC_PUBLIC_ANSWER',truncated:false});
 const old=d.finishTurn();await new Promise(r=>setImmediate(r));const newer=d.refresh(d.current);await new Promise(r=>setImmediate(r));assert.equal(pending.length,2);
 pending[1].resolve([post]);await newer;assert.equal(d.snapshot().response_linkage,'public_final_matched');pending[0].reject(Error('synthetic stale read failure'));await old;assert.equal(d.snapshot().response_linkage,'public_final_matched');
 const failure=d.refresh(d.current);await new Promise(r=>setImmediate(r));pending[2].reject(Error('synthetic current transient failure'));await failure;assert.equal(d.snapshot().response_linkage,'unverified');
 const recovery=d.refresh(d.current);await new Promise(r=>setImmediate(r));pending[3].resolve([post]);await recovery;assert.equal(d.snapshot().response_linkage,'public_final_matched');
});
test('a linkage flag without a complete consistent proof never changes the tooltip claim',async()=>{
 const d=fixture();response(d);d.publicFinal({text:'SYNTHETIC_PUBLIC_ANSWER',truncated:false});await d.finishTurn();const raw=d.snapshot();
 for(const mutate of [x=>delete x.response_attribution,x=>x.turn_completed=false,x=>x.public_finals=0,x=>x.response_attribution.finals[0].request_ordinal=2,x=>x.response_attribution.finals[0].presence='fallback',x=>x.response_attribution.linked_finals=2]){const invalid=structuredClone(raw);mutate(invalid);assert.doesNotMatch(museDeliveryView(invalid).detail,/displayed final answer matches/);}
});
