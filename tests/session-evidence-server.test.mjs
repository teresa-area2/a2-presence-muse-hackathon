import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import os from'node:os';import path from'node:path';import{EventEmitter}from'node:events';import{createStructuredServer}from'../structured-server.mjs';import{createEvidenceStore}from'../src/evidence-store.mjs';
const ROOT=path.resolve('.');
class Pair extends EventEmitter{constructor(){super();this.status='ready';this.stops=0;this.arms=Object.fromEntries(['without','with'].map(n=>[n,{status:'ready',messages:[],approvals:[],usage:{status:'not_observed'}}]));}snapshot(){return{status:this.status,comparison:{matched_context:true},arms:this.arms};}async submit(text,target='both'){for(const n of target==='both'?['without','with']:[target]){this.arms[n].messages.push({author:'You',text,phase:'sent'},{author:'Muse',text:'PRIVATE_REPLY_SENTINEL',phase:'finalAnswer'});this.arms[n].usage={status:'observed',model_calls:1,input_tokens:10,output_tokens:2,cache_read_tokens:4};}this.emit('status');return{status:'started'};}async decide(){return{status:'accepted'};}async stop(){this.stops++;this.status='closed';for(const a of Object.values(this.arms))a.status='closed';this.emit('status');}}
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'session-evidence-')),store=await createEvidenceStore({directory,metadata:{task_id:'PROJECT-07',evidence_mode:'fixture'},debounceMs:0,...options.storeOptions});let p;
 const observer=new EventEmitter();observer.snapshot=()=>({source:{eligible:true,renderer:'coding-instructions.3',read_at:new Date().toISOString(),received_at:new Date().toISOString(),controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'},capture:{state:'collecting'},guidance:'PRIVATE_CAPSULE_SENTINEL'}});
 const server=createStructuredServer({root:ROOT,labRoot:ROOT,createPair:async()=>p=new Pair(),observer,evidenceStore:store,fixture:true,checkpointMs:options.checkpointMs??60000});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,config=await(await fetch(base+'/api/config')).json();
 const state=async()=>(await(await fetch(base+'/api/config')).json()).state;
 const post=async(route,body={})=>{if(['submit','decide','human-review'].includes(route)&&!Object.hasOwn(body,'generation'))body={...body,generation:(await state()).session_generation};return fetch(base+'/api/'+route,{method:'POST',headers:{origin:base,'content-type':'application/json','x-terminal-token':config.token},body:JSON.stringify(body)});};
 const exported=(generation=1,headers={})=>fetch(base+'/api/evidence?generation='+generation,{headers:{'x-terminal-token':config.token,...headers}});
 t.after(async()=>{await server.shutdown().catch(()=>{});await fs.rm(directory,{recursive:true,force:true});});return{server,store,directory,base,config,state,post,exported,pair:()=>p};
}
test('automatic capture persists actions, self-reports and safe history; export equals disk',async t=>{
 const f=await fixture(t);assert.equal((await f.post('start')).status,200);await f.post('submit',{text:'PRIVATE_PROMPT_SENTINEL',actor:'participant'});await f.post('human-review',{arm:'with',action:'feedback',effort:2,interruptions:0});const response=await f.exported();assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment; filename="presence-comparison-/);const doc=await response.json(),file=path.join(f.directory,doc.run_id+'.json');assert.deepEqual(doc,JSON.parse(await fs.readFile(file,'utf8')));assert.equal(doc.measurement.actions.participant.submissions,1);assert.equal(doc.measurement.actions.participant.arms.with.messages,1);assert.equal(doc.measurement.review.arms.with.effort_rating,2);assert.equal(doc.measurement.review.arms.with.interruption_count,0);assert.equal(doc.arms.with.public_output.final_words,1);assert.equal(doc.presence.controls.response_extent,'terse');assert.ok(doc.policy_history.length>0);assert.ok(!JSON.stringify(doc).includes('PRIVATE'));assert.ok(!JSON.stringify(doc).includes(f.config.token));assert.equal(doc.metadata.evidence_mode,'fixture');assert.equal((await f.state()).evidence.status,'saved');
});
test('export rejects foreign origin/site, missing token and stale/duplicate generation',async t=>{
 const f=await fixture(t);await f.post('start');assert.equal((await f.exported(1,{origin:'https://foreign.test'})).status,403);assert.equal((await f.exported(1,{'sec-fetch-site':'cross-site'})).status,403);assert.equal((await f.exported(1,{'x-terminal-token':'bad'})).status,403);assert.equal((await f.exported(2)).status,409);assert.equal((await f.exported('1&generation=1')).status,409);assert.equal((await f.exported('1&path=/private')).status,409);assert.equal((await fetch(f.base+'/api/evidence',{headers:{'x-terminal-token':f.config.token}})).status,409);
});
test('reopening preserves prior reports and late old acknowledgements cannot pollute a new run',async t=>{
 const f=await fixture(t);await f.post('start');const old=(await f.state()).evidence.run_id;let release,entered;f.pair().submit=()=>new Promise(r=>{release=r;entered=true;});const pending=f.post('submit',{text:'old request',actor:'participant'});while(!entered)await new Promise(r=>setTimeout(r,1));await f.post('stop');await f.post('start');release({status:'started'});await pending;const doc=await(await f.exported(2)).json();assert.notEqual(doc.run_id,old);assert.equal(doc.measurement.actions.participant.submissions,0);const previous=JSON.parse(await fs.readFile(path.join(f.directory,old+'.json'),'utf8'));assert.equal(previous.measurement.actions.participant.submissions,1);assert.equal(previous.pair.status,'closed');assert.equal((await f.exported(1)).status,409);
});
test('initial save failure stops prepared pair; later save failure is visible without re-dispatch',async t=>{
 let fail=true;const f=await fixture(t,{storeOptions:{write:async()=>{if(fail)throw Error('PRIVATE_DISK_FAILURE');}}});assert.equal((await f.post('start')).status,409);assert.equal(f.pair().status,'closed');assert.ok(f.pair().stops>=1);assert.equal((await f.state()).session_generation,0);fail=false;await f.post('start');fail=true;const result=await(await f.post('submit',{text:'work once',actor:'participant'})).json();assert.equal(result.outcome.status,'started');assert.equal(result.state.evidence.status,'unavailable');assert.equal(result.state.measurement.actions.participant.submissions,1);assert.equal((await f.exported()).status,503);assert.equal((await f.post('stop')).status,200);assert.equal(f.pair().status,'closed');
});
test('periodic checkpoints and shutdown persist a stopped snapshot',async t=>{
 const f=await fixture(t,{checkpointMs:100});await f.post('start');const first=await f.state(),id=first.evidence.run_id;const until=Date.now()+2000;while(Date.now()<until){if((await f.state()).evidence.revision>first.evidence.revision)break;await new Promise(r=>setTimeout(r,25));}assert.ok((await f.state()).evidence.revision>first.evidence.revision);await f.server.shutdown();const doc=JSON.parse(await fs.readFile(path.join(f.directory,id+'.json'),'utf8'));assert.equal(doc.pair.status,'closed');assert.equal(doc.quality.state,'not_verified');
});

test('shutdown waits for initial checkpoint and finalizes the cancelled prepared pair before closing storage',async t=>{
 let entered,release,writes=0;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const f=await fixture(t,{storeOptions:{write:async()=>{if(++writes===1){entered();await gate;}}}});
 const starting=f.post('start');await started;const closing=f.server.shutdown();release();assert.equal((await starting).status,409);await closing;const run=[...f.store.runs.values()][0];assert.equal((await f.store.export(run.id)).pair.status,'closed');assert.equal(f.pair().status,'closed');
});

test('shutdown waits for admitted send and approval acknowledgements before its final save',async t=>{
 const f=await fixture(t);await f.post('start');const id=(await f.state()).evidence.run_id;let releaseSend,releaseDecision,entered=0;
 f.pair().submit=()=>{entered++;return new Promise(resolve=>{releaseSend=resolve;});};f.pair().decide=()=>{entered++;return new Promise(resolve=>{releaseDecision=resolve;});};
 const sending=f.post('submit',{generation:1,text:'PRIVATE_LATE_MESSAGE',actor:'participant'}),deciding=f.post('decide',{generation:1,arm:'with',approvalId:'private-id',requirementId:{approvalId:'private-id',sourceIndex:0},choiceId:'allow',reviewToken:'a'.repeat(64),actor:'participant'});
 while(entered<2)await new Promise(r=>setTimeout(r,1));let finished=false;const closing=f.server.shutdown().then(()=>{finished=true;});
 while(f.pair().status!=='closed')await new Promise(r=>setTimeout(r,1));assert.equal(finished,false);assert.equal((await f.post('submit',{generation:1,text:'do not dispatch',actor:'participant'})).status,409);
 releaseSend({status:'started'});releaseDecision({status:'accepted'});assert.equal((await sending).status,200);assert.equal((await deciding).status,200);await closing;
 const doc=JSON.parse(await fs.readFile(path.join(f.directory,id+'.json'),'utf8'));assert.equal(doc.pair.status,'closed');assert.equal(doc.measurement.actions.participant.submissions,1);assert.equal(doc.measurement.actions.participant.arms.with.approval_decisions,1);assert.ok(!JSON.stringify(doc).includes('PRIVATE_LATE_MESSAGE'));
});

const testLedgerId='00000000-0000-4000-8000-000000000001';
function testLedger({id=testLedgerId,generation=1,events=[],omitted=0}={}){return{schema_version:1,source:'current_browser_tab',ledger_id:id,session_generation:generation,events,events_omitted:omitted,rejected_events:0};}
const ledgerEvent=(n,extra={})=>({window_id:1,sample_id:n,sample_kind:'interim',phase:'sample',at_ms:1700000000000+n,reason:null,status:'captured',...extra});
test('capture ledgers are persisted privately with client-reported provenance and export equals disk',async t=>{
 const f=await fixture(t);await f.post('start');assert.equal(f.config.textbox_presence.capture_event_logging_supported,true);const ledger=testLedger({events:[ledgerEvent(1,{raw:'PRIVATE_KEY_TIMES',capsule:'PRIVATE_CAPSULE'}),ledgerEvent(2)]});ledger.private_text='PRIVATE_MESSAGE';
 const response=await f.post('capture-events',{generation:1,ledger});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,accepted_total:2});const report=await(await f.exported()).json();
 assert.equal(report.browser_capture_logs.provenance,'client_reported_unverified');assert.equal(report.browser_capture_logs.ledgers.length,1);assert.equal(report.browser_capture_logs.ledgers[0].events.length,2);assert.ok(!JSON.stringify(report).includes('PRIVATE_'));
 assert.deepEqual(report,JSON.parse(await fs.readFile(path.join(f.directory,report.run_id+'.json'),'utf8')));
});
test('capture endpoint enforces origin/token, generation, bounds and valid event schema',async t=>{
 const f=await fixture(t);await f.post('start');const send=(body,headers={})=>fetch(f.base+'/api/capture-events',{method:'POST',headers:{origin:f.base,'content-type':'application/json','x-terminal-token':f.config.token,...headers},body:JSON.stringify(body)});
 const valid={generation:1,ledger:testLedger({events:[ledgerEvent(1)]})};assert.equal((await send(valid,{origin:'https://foreign.test'})).status,403);assert.equal((await send(valid,{'x-terminal-token':'bad'})).status,403);assert.equal((await send({...valid,generation:2})).status,409);assert.equal((await send({generation:1,ledger:testLedger({events:[ledgerEvent(1,{phase:'PRIVATE'})]})})).status,400);assert.equal((await send({generation:1,ledger:testLedger({events:Array.from({length:201},(_,i)=>ledgerEvent(i+1))})})).status,400);
 assert.equal((await send({...valid,extra:'PRIVATE'})).status,400);assert.equal((await send({generation:1,ledger:{...valid.ledger,padding:'x'.repeat(70000)}})).status,413);
});
test('ledger updates are monotonic, idempotent and isolated between bounded tabs',async t=>{
 const f=await fixture(t);await f.post('start');const post=ledger=>f.post('capture-events',{generation:1,ledger});const a=testLedger({events:[ledgerEvent(1)]}),b=testLedger({id:'00000000-0000-4000-8000-000000000002',events:[ledgerEvent(2)]});
 assert.equal((await post(a)).status,200);assert.equal((await post(b)).status,200);assert.equal((await post(a)).status,200);assert.equal((await post({...a,events:[ledgerEvent(1,{status:'ready'})]})).status,409);
 const newer={...a,events:[ledgerEvent(1),ledgerEvent(3)]};assert.equal((await post(newer)).status,200);assert.equal((await post(a)).status,409);const report=await(await f.exported()).json();assert.equal(report.browser_capture_logs.ledgers.length,2);assert.equal(report.browser_capture_logs.ledgers[0].events.length,2);
 for(let i=3;i<=16;i++)assert.equal((await post(testLedger({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,events:[ledgerEvent(i)]}))).status,200);
 assert.equal((await post(testLedger({id:'00000000-0000-4000-8000-000000000017',events:[ledgerEvent(17)]}))).status,409);
});
test('same-generation final ledger after Stop is saved; old generation is rejected after reopen',async t=>{
 const f=await fixture(t);await f.post('start');const old=(await f.state()).evidence.run_id;await f.post('stop');assert.equal((await f.post('capture-events',{generation:1,ledger:testLedger({events:[ledgerEvent(1)]})})).status,200);await f.post('start');assert.equal((await f.post('capture-events',{generation:1,ledger:testLedger({events:[ledgerEvent(1),ledgerEvent(2)]})})).status,409);const previous=JSON.parse(await fs.readFile(path.join(f.directory,old+'.json'),'utf8'));assert.equal(previous.browser_capture_logs.ledgers[0].events.length,1);assert.equal((await(await f.exported(2)).json()).browser_capture_logs.ledgers.length,0);
});
test('failed evidence writes do not acknowledge durable capture events',async t=>{
 let fail=false;const f=await fixture(t,{storeOptions:{write:async()=>{if(fail)throw Error('PRIVATE_FAILURE');}}});await f.post('start');fail=true;const response=await f.post('capture-events',{generation:1,ledger:testLedger({events:[ledgerEvent(1)]})});assert.equal(response.status,503);const result=await response.json();assert.equal(result.error,'capture_evidence_save_failed');assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('bounded ledger rollover preserves overlap, rejects divergent history and records exact omissions',async t=>{
 const f=await fixture(t);await f.post('start');const send=ledger=>f.post('capture-events',{generation:1,ledger});const initial=testLedger({events:Array.from({length:200},(_,i)=>ledgerEvent(i+1))});assert.equal((await send(initial)).status,200);
 const rolled=testLedger({omitted:1,events:Array.from({length:200},(_,i)=>ledgerEvent(i+2))});const response=await send(rolled);assert.equal(response.status,200);assert.equal((await response.json()).accepted_total,201);
 const corrupted=testLedger({omitted:2,events:Array.from({length:200},(_,i)=>ledgerEvent(i+3))});corrupted.events[0].status='unavailable';assert.equal((await send(corrupted)).status,409);
 const doc=await(await f.exported()).json(),saved=doc.browser_capture_logs.ledgers[0];assert.equal(saved.events_omitted,1);assert.equal(saved.events.length,200);assert.equal(saved.events[0].sample_id,2);
});
test('capture ledger duplicate after a failed write retries persistence before acknowledging',async t=>{
 let fail=false;const f=await fixture(t,{storeOptions:{write:async()=>{if(fail)throw Error('PRIVATE_DISK_FAILURE');}}});await f.post('start');const ledger=testLedger({events:[ledgerEvent(1)]});fail=true;assert.equal((await f.post('capture-events',{generation:1,ledger})).status,503);fail=false;const response=await f.post('capture-events',{generation:1,ledger});assert.equal(response.status,200);assert.equal((await response.json()).accepted_total,1);
});
test('concurrent same-tab snapshots cannot overwrite a newer durable checkpoint',async t=>{
 let hold=false,release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const f=await fixture(t,{storeOptions:{write:async(owner,id,body)=>{if(hold){hold=false;entered();await gate;}await fs.writeFile(path.join(owner.directory,id+'.json'),body,{mode:0o600});}}});await f.post('start');hold=true;
 const first=f.post('capture-events',{generation:1,ledger:testLedger({events:[ledgerEvent(1)]})});await started;
 const second=f.post('capture-events',{generation:1,ledger:testLedger({events:[ledgerEvent(1),ledgerEvent(2)]})});release();const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(x=>x.status),[200,200]);
 const doc=await(await f.exported()).json();assert.equal(doc.browser_capture_logs.ledgers[0].events.length,2);const disk=JSON.parse(await fs.readFile(path.join(f.directory,doc.run_id+'.json'),'utf8'));assert.equal(disk.browser_capture_logs.ledgers[0].events.length,2);
});
test('accepted and duplicate OP outcomes remain distinguishable as client-reported metadata',async t=>{
 const f=await fixture(t);await f.post('start');const events=[ledgerEvent(1,{phase:'outcome',status:'accepted'}),ledgerEvent(2,{phase:'outcome',status:'duplicate'})];const response=await f.post('capture-events',{generation:1,ledger:testLedger({events})});assert.equal(response.status,200);const doc=await(await f.exported()).json();assert.deepEqual(doc.browser_capture_logs.ledgers[0].events.map(x=>x.status),['accepted','duplicate']);assert.equal(doc.browser_capture_logs.provenance,'client_reported_unverified');
});

test('sixteen full worst-case sanitized ledgers fit below half the evidence capacity',()=>{
 const event={window_id:Number.MAX_SAFE_INTEGER,sample_id:Number.MAX_SAFE_INTEGER,sample_kind:'interim',phase:'outcome',at_ms:8640000000000000,reason:'connection_lost',status:'observation_expired'};
 const ledgers=Array.from({length:16},(_,i)=>testLedger({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,events:Array.from({length:200},()=>({...event})),omitted:Number.MAX_SAFE_INTEGER-200}));
 const byteLength=Buffer.byteLength(JSON.stringify({provenance:'client_reported_unverified',persistence:'local_checkpoint',ledgers}));assert.ok(byteLength<1024*1024,`16 ledgers occupy ${byteLength} bytes`);
});
