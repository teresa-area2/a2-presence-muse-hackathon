import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import os from'node:os';import path from'node:path';import{EventEmitter}from'node:events';
import{createStructuredServer}from'../structured-server.mjs';import{createEvidenceStore}from'../src/evidence-store.mjs';
const ID='11111111-1111-4111-8111-111111111111',READ='22222222-2222-4222-8222-222222222222';const controls={response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'};
const metrics=(extra={})=>({schema_version:1,held_current:2,held_total:2,released_manual:0,released_automatic:0,history_resets:0,coverage:'observed',...extra});
const ledger=(extra={})=>({schema_version:1,ledger_id:ID,session_generation:1,revision:1,metrics:metrics(),...extra});
class Pair extends EventEmitter{
 constructor(){super();this.status='ready';this.submissions=0;this.decisions=0;this.arms=Object.fromEntries(['with','without'].map(arm=>[arm,{status:'ready',messages:[{author:'Muse',phase:'finalAnswer',text:'PRIVATE_PUBLIC_RESPONSE'}],approvals:[],usage:{status:'observed',model_calls:1,input_tokens:100,output_tokens:20},delivery:arm==='without'?{status:'baseline_isolated',requests_observed:1}:{status:'guidance_observed',turn_ordinal:1,requests_observed:1,hook_linkage:'read_marker_matched',request_attribution:[{ordinal:1,status:'guidance_observed',read_id:READ,reading_id:ID,controls}]}}]));}
 snapshot(){return{status:this.status,arms:this.arms,comparison:{matched_context:true}};}
 async submit(){this.submissions++;return{status:'started'};}async decide(){this.decisions++;return{status:'accepted'};}async stop(){this.status='closed';for(const arm of Object.values(this.arms))arm.status='closed';this.emit('status');}
}
async function fixture(t,{explain,write}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'presence-observer-')),store=await createEvidenceStore({directory,debounceMs:0,...(write?{write}:{})});let pair,calls=0,input;
 const observer=new EventEmitter();observer.snapshot=()=>({source:{eligible:true,renderer:'coding-instructions.3',controls,read_at:new Date().toISOString(),received_at:new Date().toISOString(),capture:{state:'fixture'},capsule:'PRIVATE_CAPSULE'}});
 const server=createStructuredServer({root:path.resolve('.'),labRoot:path.resolve('.'),createPair:async()=>pair=new Pair(),observer,evidenceStore:store,fixture:true,explainPresence:async(evidence,options)=>{calls++;input=evidence;if(explain)return explain(evidence,options);return{fact_ids:['source_current','delivery_correlated','browser_updates'],sentences:['PRIVATE_MODEL_PROSE'],usage:{status:'observed',model_calls:1,input_tokens:40,output_tokens:5,elapsed_ms:12}};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,cfg=await(await fetch(base+'/api/config')).json();
 const state=async()=>(await(await fetch(base+'/api/config')).json()).state;
 const post=(route,body={},headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{origin:base,'content-type':'application/json','x-terminal-token':cfg.token,...headers},body:JSON.stringify(body)});
 const exported=(generation=1)=>fetch(base+'/api/evidence?generation='+generation,{headers:{'x-terminal-token':cfg.token}});
 const waitReport=async()=>{for(let i=0;i<150;i++){const s=await state();if(s.presence_observer.reports.length)return s;await new Promise(r=>setTimeout(r,10));}throw Error('observer_fixture_timeout');};
 t.after(async()=>{await server.shutdown().catch(()=>{});await fs.rm(directory,{recursive:true,force:true});});
 return{directory,store,base,cfg,server,state,post,exported,waitReport,pair:()=>pair,calls:()=>calls,input:()=>input};
}
test('no model on load/start; explicit observer uses saved metadata and remains separate from coding arms',async t=>{
 const f=await fixture(t);assert.equal(f.cfg.presence_observer.enabled,true);assert.equal(f.calls(),0);await f.post('start');assert.equal(f.calls(),0);
 assert.equal((await f.post('observer/metrics',{generation:1,ledger:ledger({private:'PRIVATE_LEDGER'})})).status,200);
 const before=structuredClone(f.pair().snapshot()),response=await f.post('observer/explain',{generation:1,ledger_id:ID});assert.equal(response.status,202);const state=await f.waitReport();
 assert.equal(f.calls(),1);assert.deepEqual(f.pair().snapshot(),before);assert.equal(f.pair().submissions,0);assert.equal(f.pair().decisions,0);assert.ok(!JSON.stringify(f.input()).includes('PRIVATE'));
 const report=state.presence_observer.reports[0];assert.equal(report.status,'completed');assert.equal(report.usage.scope,'presence_observer');assert.equal(report.usage.input_tokens,40);assert.ok(report.fact_ids.includes('benefit_unverified'));assert.deepEqual(report.evidence_scope,{with_turn:1,without_turn:null,mechanism_ledger_id:ID,mechanism_revision:1});
 const doc=await(await f.exported()).json();assert.equal(doc.observer_reports.length,1);assert.equal(doc.browser_mechanisms.ledgers[0].metrics.held_total,2);assert.ok(!JSON.stringify(doc).includes('PRIVATE'));
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory,doc.run_id+'.json'),'utf8')),doc);
});
test('per-tab counters are durable, nonadditive and cannot rewind or cross generations',async t=>{
 const f=await fixture(t);await f.post('start');const send=value=>f.post('observer/metrics',{generation:1,ledger:value});
 assert.equal((await send(ledger())).status,200);assert.equal((await send(ledger())).status,200);
 assert.equal((await send(ledger({revision:2,metrics:metrics({held_current:0,released_manual:2})}))).status,200);
 assert.equal((await send(ledger())).status,409);assert.equal((await send(ledger({revision:3,metrics:metrics({held_total:1,held_current:1})}))).status,409);
 const other='33333333-3333-4333-8333-333333333333';assert.equal((await send(ledger({ledger_id:other}))).status,200);
 const doc=await(await f.exported()).json();assert.equal(doc.browser_mechanisms.ledgers.length,2);assert.equal(doc.browser_mechanisms.scope,'separate_browser_projections_not_additive');assert.ok(!('total'in doc.browser_mechanisms));
 await f.post('stop');await f.post('start');assert.equal((await send(ledger())).status,409);assert.equal((await(await f.exported(2)).json()).browser_mechanisms.ledgers.length,0);
});
test('wrong origin/token, missing or contradictory metrics, busy arms and approvals cannot dispatch observer',async t=>{
 const f=await fixture(t);await f.post('start');assert.equal((await f.post('observer/explain',{generation:1,ledger_id:ID})).status,409);
 assert.equal((await f.post('observer/metrics',{generation:1,ledger:ledger({metrics:metrics({held_current:9})})})).status,400);
 assert.equal((await f.post('observer/metrics',{generation:1,ledger:ledger()},{origin:'https://foreign.invalid'})).status,403);
 assert.equal((await f.post('observer/metrics',{generation:1,ledger:ledger()},{'x-terminal-token':'invalid'})).status,403);
 await f.post('observer/metrics',{generation:1,ledger:ledger()});
 for(const change of [{status:'running'},{status:'ready',approvals:[{}]}]){Object.assign(f.pair().arms.with,change);assert.equal((await f.post('observer/explain',{generation:1,ledger_id:ID})).status,409);}
 assert.equal(f.calls(),0);
});
test('one in-flight observer, cancellation on Stop, no report leaking into the next pair',async t=>{
 let aborted=false;const f=await fixture(t,{explain:(_,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('PRIVATE_NATIVE_ERROR'));},{once:true}))});
 await f.post('start');await f.post('observer/metrics',{generation:1,ledger:ledger()});assert.equal((await f.post('observer/explain',{generation:1,ledger_id:ID})).status,202);
 assert.equal((await f.post('observer/explain',{generation:1,ledger_id:ID})).status,409);assert.equal(f.calls(),1);assert.equal(f.server.isQuiescent(),false);
 await f.post('stop');assert.equal(aborted,true);const state=await f.waitReport();assert.equal(state.presence_observer.reports[0].status,'cancelled');
 await f.post('start');assert.equal((await f.state()).presence_observer.reports.length,0);assert.equal((await f.post('observer/explain',{generation:1,ledger_id:ID})).status,409);
});
test('failed evidence flush prevents spending even if in-memory metrics exist',async t=>{
 let fail=false;const f=await fixture(t,{write:async()=>{if(fail)throw Error('PRIVATE_DISK');}});await f.post('start');fail=true;
 assert.equal((await f.post('observer/metrics',{generation:1,ledger:ledger()})).status,503);assert.equal((await f.post('observer/explain',{generation:1,ledger_id:ID})).status,503);assert.equal(f.calls(),0);
});
test('late success after cancellation preserves known spend while discarding explanation text',async t=>{
 let release;const f=await fixture(t,{explain:()=>new Promise(r=>{release=r;})});await f.post('start');await f.post('observer/metrics',{generation:1,ledger:ledger()});await f.post('observer/explain',{generation:1,ledger_id:ID});await f.post('stop');
 release({fact_ids:['source_current'],usage:{status:'observed',model_calls:1,input_tokens:40,output_tokens:5,elapsed_ms:12}});const state=await f.waitReport(),report=state.presence_observer.reports[0];assert.equal(report.status,'cancelled');assert.deepEqual(report.sentences,[]);assert.equal(report.usage.input_tokens,40);assert.equal(state.presence_observer.totals.usage.model_calls,1);assert.equal(state.presence_observer.totals.cancelled,1);
});
test('report retention is bounded while total observer usage survives additional explicit calls',async t=>{
 const f=await fixture(t);await f.post('start');await f.post('observer/metrics',{generation:1,ledger:ledger()});
 for(let n=1;n<=8;n++){assert.equal((await f.post('observer/explain',{generation:1,ledger_id:ID})).status,202);for(let i=0;i<100;i++){const s=await f.state();if(s.presence_observer.reports.length===n&&s.presence_observer.status!=='running')break;await new Promise(r=>setTimeout(r,5));}}
 assert.equal((await f.post('observer/explain',{generation:1,ledger_id:ID})).status,202);for(let i=0;i<100;i++){if((await f.state()).presence_observer.totals?.reports===9)break;await new Promise(r=>setTimeout(r,5));}
 const view=(await f.state()).presence_observer;assert.equal(f.calls(),9);assert.equal(view.reports.length,8);assert.equal(view.reports_omitted,1);assert.equal(view.totals.reports,9);assert.equal(view.totals.usage.input_tokens,360);
 const doc=await(await f.exported()).json();assert.equal(doc.observer_reports_omitted,1);assert.equal(doc.observer_totals.usage.model_calls,9);
});
test('Stop during evidence flush cancels the dispatch intent before a Muse job exists',async t=>{
 let block=false,release,blocked;const entered=new Promise(r=>{blocked=r;});
 const f=await fixture(t,{write:async()=>{if(block){block=false;blocked();await new Promise(r=>{release=r;});}}});await f.post('start');await f.post('observer/metrics',{generation:1,ledger:ledger()});
 block=true;const observer=f.post('observer/explain',{generation:1,ledger_id:ID});await entered;const stop=f.post('stop');for(let i=0;i<50;i++){if(f.pair().status==='closed')break;await new Promise(r=>setTimeout(r,5));}release();
 assert.equal((await observer).status,409);assert.equal((await stop).status,200);assert.equal(f.calls(),0);
});
test('shutdown during evidence flush cannot launch an observer after shutdown begins',async t=>{
 let block=false,release,blocked;const entered=new Promise(r=>{blocked=r;});
 const f=await fixture(t,{write:async()=>{if(block){block=false;blocked();await new Promise(r=>{release=r;});}}});await f.post('start');await f.post('observer/metrics',{generation:1,ledger:ledger()});
 block=true;const observer=f.post('observer/explain',{generation:1,ledger_id:ID});await entered;const shutdown=f.server.shutdown();release();assert.equal((await observer).status,409);await shutdown;assert.equal(f.calls(),0);
});

test('display decision export equals saved data; divergent or removed history is rejected',async t=>{
 const {presentationFixture}=await import('./helpers/presentation-fixture.mjs'),f=await fixture(t);await f.post('start');
 const presentation=presentationFixture(),first=ledger({presentation});
 assert.equal((await f.post('observer/metrics',{generation:1,ledger:first})).status,200);
 const doc=await(await f.exported()).json();assert.deepEqual(doc.browser_mechanisms.ledgers[0].presentation,presentation);
 assert.equal(doc.browser_mechanisms.provenance,'client_reported_presentation');
 const disk=JSON.parse(await fs.readFile(path.join(f.directory,doc.run_id+'.json'),'utf8'));assert.deepEqual(disk.browser_mechanisms,doc.browser_mechanisms);
 const changed=structuredClone(first);changed.revision=2;changed.presentation.arms.with.revision++;changed.presentation.arms.with.events[0].ordinal=99;
 assert.equal((await f.post('observer/metrics',{generation:1,ledger:changed})).status,409);
 assert.equal((await f.post('observer/metrics',{generation:1,ledger:ledger({revision:2})})).status,409);
 const privateValue=structuredClone(first);privateValue.presentation.arms.with.events[0].text='PRIVATE';privateValue.revision=2;
 assert.equal((await f.post('observer/metrics',{generation:1,ledger:privateValue})).status,400);
 assert.equal(f.calls(),0);
});
test('bounded presentation metadata above the old24KB request cap is accepted without model calls',async t=>{
 const {maximumPresentation}=await import('./helpers/presentation-fixture.mjs'),f=await fixture(t);await f.post('start');
 const value=ledger({metrics:metrics({held_current:0,held_total:0}),presentation:maximumPresentation()});
 const body={generation:1,ledger:value};assert.ok(Buffer.byteLength(JSON.stringify(body))>24000);assert.ok(Buffer.byteLength(JSON.stringify(body))<65536);
 assert.equal((await f.post('observer/metrics',body)).status,200);
 assert.equal((await(await f.exported()).json()).browser_mechanisms.ledgers[0].presentation.arms.with.events.length,100);assert.equal(f.calls(),0);
});

test('a delayed old-generation save cannot acknowledge the new pair generation',async t=>{
 const f=await fixture(t);await f.post('start');const original=f.store.flush.bind(f.store);let resume,held=false,block=true;
 f.store.flush=async id=>{const out=await original(id);if(block){block=false;held=true;await new Promise(r=>{resume=r});}return out;};
 const old=f.post('observer/metrics',{generation:1,ledger:ledger()});
 for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,5));assert.equal(held,true);
 try{assert.equal((await f.post('stop')).status,200);assert.equal((await f.post('start')).status,200);}finally{resume();}
 const response=await old;assert.equal(response.status,409);assert.equal((await f.state()).session_generation,2);
});
