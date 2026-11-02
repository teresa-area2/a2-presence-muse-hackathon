import test from'node:test';import assert from'node:assert/strict';import{createMechanismSync,projectMechanismMetrics,projectMechanismLedger,projectObserverReports}from'../web/session-evidence.mjs';
const id='11111111-1111-4111-8111-111111111111';const metrics=(extra={})=>({schema_version:1,held_current:1,held_total:1,released_manual:0,released_automatic:0,history_resets:0,coverage:'observed',...extra});
test('closed numeric metrics reject contradictory counters and discard private extras',()=>{
 const safe=projectMechanismMetrics({...metrics(),private:'SECRET'});assert.ok(!JSON.stringify(safe).includes('SECRET'));
 for(const value of [metrics({held_current:2}),metrics({released_manual:1}),metrics({held_current:0}),metrics({held_total:NaN})])assert.equal(projectMechanismMetrics(value),null);
 assert.equal(projectMechanismMetrics(metrics({held_current:0,coverage:'partial'})).held_total,1);
 assert.equal(projectMechanismLedger({ledger_id:id,session_generation:1,revision:1,metrics:metrics()},2),null);
 assert.deepEqual(projectObserverReports([{id,session_generation:1,status:'completed',sentences:['PRIVATE']}],1),[],'unregistered strings never enter observer reports');
});
test('repeat renders coalesce; only current-generation counters are sent and acknowledged',async()=>{
 const sent=[];let release;
 const sync=createMechanismSync({id,send:body=>{sent.push(structuredClone(body));return new Promise(r=>{release=()=>r({ok:true,generation:body.generation,accepted_revision:body.ledger.revision});});}});
 sync.setConnected(true);sync.observe(metrics(),1);await Promise.resolve();sync.observe(metrics(),1);assert.equal(sent.length,1);
 sync.observe(metrics({held_current:0,released_manual:1}),1);release();await new Promise(r=>setImmediate(r));assert.equal(sent.length,2);assert.equal(sent[1].ledger.revision,2);release();await sync.flush();assert.equal(sync.status(),'saved');
 sync.observe(metrics({held_current:0,held_total:0}),2);await Promise.resolve();assert.equal(sent[2].ledger.revision,1);assert.equal(sent[2].generation,2);release();await sync.flush();sync.close();
});
test('failed persistence never reports saved and explicit flush can retry the same metadata',async()=>{
 let attempts=0;const sync=createMechanismSync({id,send:async body=>{if(++attempts===1)throw Error('disk failed');return{ok:true,generation:body.generation,accepted_revision:body.ledger.revision};}});sync.observe(metrics(),1);sync.setConnected(true);await new Promise(r=>setImmediate(r));assert.equal(sync.status(),'failed');await sync.flush();assert.equal(attempts,2);assert.equal(sync.status(),'saved');sync.close();
});

test('display-only changes are synced even when aggregate hold counters do not change',async()=>{
 const {presentationFixture}=await import('./helpers/presentation-fixture.mjs');
 const sent=[],sync=createMechanismSync({id,send:async body=>{sent.push(structuredClone(body));return{ok:true,generation:body.generation,accepted_revision:body.ledger.revision}}});
 sync.setConnected(true);const p=presentationFixture();sync.observe(metrics({held_current:2,held_total:2}),1,p);await sync.flush();
 const q=structuredClone(p);q.arms.with.revision++;q.arms.with.coverage='partial';
 sync.observe(metrics({held_current:2,held_total:2}),1,q);await sync.flush();
 assert.equal(sent.length,2);assert.equal(sent[1].ledger.revision,2);assert.deepEqual(sent[1].ledger.presentation,q);
 const bad=structuredClone(q);bad.arms.with.events[0].text='PRIVATE';
 sync.observe(metrics({held_current:2,held_total:2}),1,bad);assert.equal(sync.status(),'failed');assert.equal(sent.length,2);sync.close();
});

test('decision explanations use validated metadata only and name actual release causes',async()=>{
 const {presentationDecisionLines}=await import('../web/session-evidence.mjs'),{presentationFixture}=await import('./helpers/presentation-fixture.mjs'),p=presentationFixture();
 const lines=presentationDecisionLines(p,1);assert.equal(lines.length,3);assert.match(lines[0],/Message 1 held.*updates deferred/);assert.match(lines[2],/Message 3 shown.*essential/);
 assert.deepEqual(presentationDecisionLines(p,2),[]);
 const bad=structuredClone(p);bad.arms.with.events[0].text='<script>PRIVATE</script>';assert.deepEqual(presentationDecisionLines(bad,1),[]);
});

test('failure of an older in-flight upload does not strand a newer revision or generation',async()=>{
 for(const nextGeneration of [1,2]){
  let rejectOld;const sent=[],sync=createMechanismSync({id,send:body=>{sent.push(structuredClone(body));return sent.length===1?new Promise((_,reject)=>{rejectOld=reject}):Promise.resolve({ok:true,generation:body.generation,accepted_revision:body.ledger.revision});}});
  sync.setConnected(true);sync.observe(metrics(),1);await Promise.resolve();sync.observe(metrics({held_current:0,released_manual:1}),nextGeneration);
  rejectOld(Error('old upload failed'));await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
  assert.equal(sent.length,2);assert.equal(sent[1].generation,nextGeneration);assert.equal(sync.status(),'saved');sync.close();
 }
});
