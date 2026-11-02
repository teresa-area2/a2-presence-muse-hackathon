import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {EventEmitter} from 'node:events';import {createStructuredServer} from '../structured-server.mjs';
async function fixture(t){
 let status='ready',failOpen=false,sendCalls=0,decideCalls=0;const p=new EventEmitter();p.snapshot=()=>({status,arms:Object.fromEntries(['without','with'].map(arm=>[arm,{status:status==='closed'?'closed':'ready',usage:{status:'observed',model_calls:2,input_tokens:10,output_tokens:2,cache_read_tokens:8}}]))});
 p.submit=async()=>{sendCalls++;return {status:'started'};};p.decide=async()=>{decideCalls++;return {status:'accepted'};};p.stop=async()=>{status='closed';p.emit('status');};
 const server=createStructuredServer({root:path.resolve('.'),labRoot:path.resolve('.'),createPair:async()=>{if(failOpen)throw Error('fixture_failed');status='ready';return p;},fixture:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeStreams();await new Promise(r=>server.close(r));});
 const base='http://127.0.0.1:'+server.address().port,config=await (await fetch(base+'/api/config')).json(),post=async(route,body={},headers={})=>{if(['submit','decide','human-review'].includes(route)&&!Object.hasOwn(body,'generation'))body={...body,generation:(await (await fetch(base+'/api/config')).json()).state.session_generation};return fetch(base+'/api/'+route,{method:'POST',headers:{origin:base,'content-type':'application/json','x-terminal-token':config.token,...headers},body:JSON.stringify(body)});},state=async()=>(await (await fetch(base+'/api/config')).json()).state;
 return {p,post,state,base,failOpen:()=>{failOpen=true;},counts:()=>({sendCalls,decideCalls})};
}
test('measured routes require local origin/token and strict generation/field validation',async t=>{
 const f=await fixture(t);await f.post('start');const action={arm:'with',action:'feedback',effort:2,generation:1};
 assert.equal((await f.post('human-review',action,{'x-terminal-token':'bad'})).status,403);assert.equal((await f.post('human-review',action,{origin:'https://example.test'})).status,403);
 assert.equal((await f.post('human-review',{...action,generation:0})).status,409);assert.equal((await f.post('human-review',{...action,generation:undefined})).status,409);assert.equal((await f.post('human-review',{...action,text:'private'})).status,400);
 assert.equal((await f.post('human-review',action)).status,200);assert.equal((await f.state()).measurement.review.arms.with.effort_rating,2);
 for(const actor of [null,'human']){const response=await f.post('submit',{text:'do not send',actor,generation:1});assert.equal(response.status,409);assert.equal((await response.json()).delivery,'not_started');}
 assert.equal(f.counts().sendCalls,0);
});
test('every dispatch and review requires the current integer generation even for unattributed callers',async t=>{
 const f=await fixture(t);await f.post('start');
 const payloads={submit:{text:'must not dispatch'},decide:{arm:'with',approvalId:'a',requirementId:{approvalId:'a',sourceIndex:0},choiceId:'allow'},'human-review':{arm:'with',action:'feedback',effort:4}};
 for(const [route,body] of Object.entries(payloads))for(const generation of [undefined,null,'1',1.5,0,-1,2]){
  const response=await f.post(route,{...body,generation});assert.equal(response.status,409,route+' generation '+String(generation));const out=await response.json();assert.equal(out.error,'measurement_generation_mismatch');assert.equal(out.delivery,'not_started');
 }
 for(const actor of ['participant','coordinator'])for(const route of ['submit','decide']){
  const response=await f.post(route,{...payloads[route],actor,generation:undefined});assert.equal(response.status,409);assert.equal((await response.json()).delivery,'not_started');
 }
 assert.deepEqual(f.counts(),{sendCalls:0,decideCalls:0});assert.equal((await f.state()).measurement.review.arms.with.effort_rating,null);
});
test('HTTP actor separation, unknown/partial outcomes, native approval acknowledgements and usage remain honest',async t=>{
 const f=await fixture(t);await f.post('start');await f.post('submit',{text:'shared',actor:'participant',generation:1});await f.post('submit',{text:'single',target:'with',actor:'coordinator'});await f.post('submit',{text:'script'});
 const decision={arm:'with',approvalId:'a',requirementId:{approvalId:'a',sourceIndex:0},choiceId:'allow',reviewToken:'a'.repeat(64),actor:'participant',generation:1};await f.post('decide',decision);await f.post('decide',decision);
 let s=await f.state();assert.equal(s.measurement.actions.participant.submissions,1);assert.equal(s.measurement.actions.participant.shared_submissions,1);assert.equal(s.measurement.actions.participant.arms.with.approval_decisions,1);assert.equal(s.measurement.actions.coordinator.arms.with.messages,1);assert.equal(s.measurement.actions.unattributed.submissions,1);assert.equal(s.measurement.review.arms.with.interruption_count,null);
 f.p.submit=async()=>({status:'partial_or_unconfirmed',arms:{without:{status:'started'},with:{status:'unknown'}}});await f.post('submit',{text:'PARTIAL_PRIVATE_TEXT',actor:'participant'});
 f.p.submit=async()=>({status:'partial_or_unconfirmed',arms:{without:{status:'unknown'},with:{status:'unknown'}}});await f.post('submit',{text:'UNKNOWN',actor:'participant'});
 f.p.submit=async()=>{throw Error('pair_not_ready');};assert.equal((await f.post('submit',{text:'failed',actor:'participant'})).status,409);
 s=await f.state();assert.equal(s.measurement.actions.participant.submissions,1);assert.equal(s.measurement.actions.participant.partial_submissions,1);assert.equal(s.measurement.actions.participant.partial_characters,20);assert.equal(s.measurement.actions.participant.shared_submissions,1);assert.equal(s.measurement.actions.participant.arms.without.messages,2);assert.equal(s.measurement.actions.participant.arms.with.messages,1);assert.equal(s.measurement.actions.participant.unconfirmed_submissions,1);assert.equal(s.measurement.actions.participant.unconfirmed_characters,7);assert.equal(s.measurement.actions.participant.characters,6);
 assert.deepEqual(s.arms.with.usage,{status:'observed',model_calls:2,input_tokens:10,output_tokens:2,cache_read_tokens:8});assert.ok(!('usage' in s.measurement));assert.ok(!JSON.stringify(s.measurement).includes('PARTIAL_PRIVATE_TEXT'));
});
test('only successful reopening resets the pair; stale assessments cannot reach a new generation',async t=>{
 const f=await fixture(t);await f.post('start');await f.post('submit',{text:'one',actor:'participant'});await f.post('human-review',{arm:'with',action:'feedback',effort:4,generation:1});await f.post('stop');await f.post('start');let s=await f.state();assert.equal(s.session_generation,2);assert.equal(s.measurement.actions.participant.submissions,0);assert.equal(s.measurement.review.arms.with.effort_rating,null);
 assert.equal((await f.post('human-review',{arm:'with',action:'feedback',effort:5,generation:1})).status,409);await f.post('human-review',{arm:'with',action:'feedback',effort:3,generation:2});await f.post('stop');f.failOpen();assert.equal((await f.post('start')).status,409);s=await f.state();assert.equal(s.session_generation,2);assert.equal(s.measurement.review.arms.with.effort_rating,3);
});
test('a delayed old pair acknowledgement cannot be charged to the newly opened pair',async t=>{
 const f=await fixture(t);await f.post('start');let release,entered;f.p.submit=()=>new Promise(r=>{release=r;entered=true;});const sending=f.post('submit',{text:'old',actor:'participant',generation:1});while(!entered)await new Promise(r=>setTimeout(r,1));await f.post('stop');await f.post('start');release({status:'started'});assert.equal((await sending).status,200);const s=await f.state();assert.equal(s.session_generation,2);assert.equal(s.measurement.actions.participant.submissions,0);
});
