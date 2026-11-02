import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createEvidenceStore}from'../src/evidence-store.mjs';
const state=(n=0)=>({status:'ready',comparison:{matched_context:true},arms:{with:{messages:[{author:'You',phase:'sent',text:'PRIVATE_SENTINEL'},{author:'Muse',phase:'finalAnswer',text:'two words'}],usage:{status:'observed',input_tokens:n,output_tokens:2,model_calls:1}}},presence:{source:{eligible:true,controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'},capture:{state:'collecting'},guidance:'PRIVATE_SENTINEL'}}});
async function fixture(t,options={}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'evidence-store-')),directory=path.join(root,'reports'),store=await createEvidenceStore({directory,metadata:{task_id:'PROJECT-07',evidence_mode:'fixture',secret:'PRIVATE_SENTINEL'},debounceMs:0,...options});t.after(async()=>{await store.close().catch(()=>{});await fs.rm(root,{recursive:true,force:true});});return{store,directory,root};}
test('atomic private report equals export, strips secrets, and survives a new store process context',async t=>{
 const {store,directory}=await fixture(t),id=store.begin(1);store.capture(id,state(30));await store.flush(id);const doc=await store.export(id),disk=JSON.parse(await fs.readFile(path.join(directory,id+'.json'),'utf8'));
 assert.deepEqual(doc,disk);assert.equal(doc.arms.with.public_output.final_words,2);assert.ok(!JSON.stringify(doc).includes('PRIVATE_SENTINEL'));assert.equal((await fs.stat(directory)).mode&0o777,0o700);assert.equal((await fs.stat(path.join(directory,id+'.json'))).mode&0o777,0o600);assert.equal(doc.quality.state,'not_verified');
 await store.close();const restarted=await createEvidenceStore({directory});const other=restarted.begin(1);assert.notEqual(other,id);restarted.capture(other,state(2));await restarted.flush(other);await restarted.close();assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,id+'.json'),'utf8')),disk);
});
test('overlapping writes serialize and preserve newest revision with separate generations',async t=>{
 let entered,release;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),writes=[];const{store}=await fixture(t,{write:async(_owner,id,body)=>{writes.push({id,doc:JSON.parse(body)});if(writes.length===1){entered();await gate;}}});
 const a=store.begin(1),b=store.begin(2);store.capture(a,state(1));const flushing=store.flush(a);await started;store.capture(a,state(9));store.capture(b,state(3));release();await flushing;await store.flush(b);assert.equal((await store.export(a)).arms.with.usage.input_tokens,9);assert.equal((await store.export(b)).arms.with.usage.input_tokens,3);assert.equal(writes.filter(x=>x.id===a).at(-1).doc.revision,2);
});
test('write failure stays visible and export refuses stale success; later capture can recover',async t=>{
 let fail=true;const{store}=await fixture(t,{write:async()=>{if(fail)throw Error('PRIVATE_DISK_PATH');}}),id=store.begin(1);store.capture(id,state());await assert.rejects(store.flush(id),/evidence_save_failed/);assert.equal(store.status(id).status,'unavailable');assert.ok(!JSON.stringify(store.status(id)).includes('PRIVATE_DISK_PATH'));await assert.rejects(store.export(id),/evidence_save_failed/);fail=false;store.capture(id,state(5));await store.flush(id);assert.equal(store.status(id).status,'saved');
});
test('close revokes capture admission before waiting and save timestamp is commit time',async t=>{
 let at=1000,release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const{store}=await fixture(t,{now:()=>at,write:async()=>{entered();await gate;}}),id=store.begin(1);store.capture(id,state());const closing=store.close();await started;assert.throws(()=>store.capture(id,state(3)),/evidence_run_invalid/);assert.throws(()=>store.begin(2),/evidence_run_invalid/);at=3000;release();await closing;assert.equal(store.status(id).last_saved_at,'1970-01-01T00:00:03.000Z');assert.equal((await store.export(id)).recorded_at,'1970-01-01T00:00:01.000Z');
});
test('bounded policy history records changes without retaining source text',async t=>{
 const{store}=await fixture(t),id=store.begin(1);for(let i=0;i<205;i++){const s=state();s.presence.source.controls.response_extent=i%2?'full':'terse';store.capture(id,s);}await store.flush(id);const doc=await store.export(id);assert.equal(doc.policy_history.length,200);assert.equal(doc.history_omitted.policy,5);assert.ok(!JSON.stringify(doc.policy_history).includes('PRIVATE_SENTINEL'));
});
test('refuses symlink report roots and existing symlink report targets',async t=>{
 const{store,directory,root}=await fixture(t),id=store.begin(1),foreign=path.join(root,'foreign');await fs.writeFile(foreign,'unchanged');await fs.symlink(foreign,path.join(directory,id+'.json'));store.capture(id,state());await assert.rejects(store.flush(id));assert.equal(await fs.readFile(foreign,'utf8'),'unchanged');const link=path.join(root,'link');await fs.symlink(directory,link);await assert.rejects(createEvidenceStore({directory:link}),/unsafe/);
});
test('request histories stay bounded without repeating full attribution tables in delivery history',async t=>{
 const {store}=await fixture(t),id=store.begin(1),s=state();
 const reading='20000000-0000-4000-8000-000000000001';
 for(let turn=1;turn<=205;turn++){
  const rows=Array.from({length:64},(_,i)=>({ordinal:i+1,status:'guidance_observed',read_id:'10000000-0000-4000-8000-'+String((turn-1)*64+i+1).padStart(12,'0'),reading_id:reading,controls:{response_extent:'full',unsolicited_update:'defer',conversation_style:'conversational'},receipt_age_seconds:1}));
  s.arms.with.delivery={status:'guidance_observed',turn_ordinal:turn,requests_observed:64,hook_linkage:'read_marker_matched',request_attribution:rows};store.capture(id,s);
 }
 await store.flush(id);const doc=await store.export(id);assert.equal(doc.request_history.length,200);assert.equal(doc.history_omitted.requests,12920);assert.equal(doc.arms.with.delivery.request_attribution.length,64);assert.ok(doc.delivery_history.every(x=>!Object.hasOwn(x,'request_attribution')));assert.ok(Buffer.byteLength(JSON.stringify(doc,null,2))<2*1024*1024);
 // A stale snapshot cannot reinsert evicted requests or inflate omission counts.
 s.arms.with.delivery={...s.arms.with.delivery,turn_ordinal:1,request_attribution:[{...s.arms.with.delivery.request_attribution[0],ordinal:1}]};store.capture(id,s);await store.flush(id);const after=await store.export(id);assert.equal(after.request_history.length,200);assert.equal(after.history_omitted.requests,12920);
});
test('request evidence updates once per occurrence and stays separate across run generations',async t=>{
 let now=1000;const {store}=await fixture(t,{now:()=>now}),id=store.begin(1),s=state(),read='10000000-0000-4000-8000-000000000001',reading='20000000-0000-4000-8000-000000000001';
 const row={ordinal:1,status:'unverified',read_id:read,reading_id:null,controls:null,receipt_age_seconds:null};s.arms.with.delivery={status:'unverified',turn_ordinal:1,requests_observed:1,request_attribution:[row]};store.capture(id,s);now=2000;store.capture(id,s);
 row.status='guidance_observed';row.reading_id=reading;row.controls={response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'};now=3000;store.capture(id,s);await store.flush(id);const report=await store.export(id);
 assert.equal(report.request_history.length,1);assert.equal(report.request_history[0].status,'guidance_observed');assert.equal(report.request_history[0].first_observed_at,'1970-01-01T00:00:01.000Z');assert.equal(report.request_history[0].updated_at,'1970-01-01T00:00:03.000Z');assert.equal(report.history_omitted.requests,0);
 const next=store.begin(2);store.capture(next,state());await store.flush(next);assert.deepEqual((await store.export(next)).request_history,[]);
});

test('combined maximum display and capture metadata fits the unchanged compact2MiB checkpoint cap',async t=>{
 const {maximumPresentation}=await import('./helpers/presentation-fixture.mjs'),{store,directory}=await fixture(t),id=store.begin(1),s=state(),max=Number.MAX_SAFE_INTEGER;
 s.browser_mechanisms=Array.from({length:16},(_,i)=>({schema_version:1,source:'browser_projection',ledger_id:'10000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),session_generation:1,revision:max,metrics:{schema_version:1,held_current:0,held_total:max,released_manual:max,released_automatic:0,history_resets:max,coverage:'partial'},presentation:maximumPresentation()}));
 s.browser_capture_logs=Array.from({length:16},(_,i)=>({schema_version:1,source:'current_browser_tab',ledger_id:'20000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),session_generation:1,events_omitted:max-200,rejected_events:0,events:Array.from({length:200},()=>({window_id:max,sample_id:max,sample_kind:'interim',phase:'dispatch',at_ms:8640000000000000,reason:'connection_lost',status:'observation_expired'}))}));
 store.capture(id,s);await store.flush(id);const saved=await fs.readFile(path.join(directory,id+'.json'),'utf8'),doc=JSON.parse(saved);
 assert.ok(Buffer.byteLength(saved)<2*1024*1024);assert.equal(doc.browser_mechanisms.ledgers.length,16);assert.equal(doc.browser_capture_logs.ledgers.length,16);
 assert.equal(doc.browser_mechanisms.ledgers[0].presentation.arms.with.events.length,100);assert.deepEqual(doc,await store.export(id));
 assert.ok(!saved.includes('PRIVATE_SENTINEL'));
});
