import test from 'node:test';import assert from 'node:assert/strict';
import {executeEvidenceCodingWorkflow} from '../src/evidence-coding-workflow.mjs';
const ARMS=['without','with'],PLAN='e'.repeat(64);
const counts=pass=>({tests:1,pass:pass?1:0,fail:pass?0:1,skipped:0,cancelled:0,todo:0});
export const report=(arm,state='failed',stage='initial')=>({id:stage+'-'+arm,current:true,status:state,summary:{schema_version:1,state,exit_code:state==='passed'?0:1,public_tests:counts(state==='passed'),frozen_tests:counts(state==='passed'),cases:[{name:'public contract',result:state}],artifact_sha256:(stage==='initial'?(arm==='with'?'a':'b'):(arm==='with'?'c':'d')).repeat(64),trusted_plan_hash:PLAN}});
function fixture({initial={without:'failed',with:'failed'},final={without:'passed',with:'passed'}}={}){
 const order=[],snapshots=[];let dispatched=[];
 const options={expectedPlanHash:PLAN,checkpoint:async state=>snapshots.push(state),
  implement:async()=>order.push('implement'),
  check:async arms=>{order.push('check');return Object.fromEntries(arms.map(a=>[a,report(a,initial[a])]));},
  prepareFeedback:async(arms,reports)=>{order.push('feedback');return{metadata:Object.fromEntries(arms.map(a=>[a,{check_id:reports[a].id,artifact_sha256:reports[a].summary.artifact_sha256,trusted_plan_hash:PLAN,prompt_sha256:'f'.repeat(64)}]))};},
  repair:async(prepared,arms)=>{order.push('dispatch');dispatched=[...arms];return{status:'started',arms:Object.fromEntries(arms.map(a=>[a,{status:'started'}]))};},
  awaitRepair:async()=>order.push('repair_finished'),
  recheck:async arms=>{order.push('recheck');return Object.fromEntries(arms.map(a=>[a,report(a,final[a],'recheck')]));},
  validateFinal:async()=>{order.push('final_binding');return true;},
 };
 return{options,order,snapshots,dispatched:()=>dispatched};
}
test('failed implementations receive one own-check repair and the common recheck before passing',async()=>{
 const f=fixture(),r=await executeEvidenceCodingWorkflow(f.options);
 assert.deepEqual(f.order,['implement','check','feedback','dispatch','repair_finished','recheck','final_binding']);
 assert.equal(r.status,'passed');assert.deepEqual(r.repair_attempts,{without:1,with:1});
 for(const arm of ARMS){assert.equal(r.initial_checks[arm].status,'failed');assert.equal(r.rechecks[arm].status,'passed');assert.equal(r.feedback[arm].artifact_sha256,r.initial_checks[arm].summary.artifact_sha256);assert.notEqual(r.final_checks[arm].summary.artifact_sha256,r.initial_checks[arm].summary.artifact_sha256);}
 assert.equal(r.answer_quality,'unreviewed');assert.equal(r.human_benefit,'not_measured');
});
test('only failed arms consume a repair turn; first-pass checked result is retained',async()=>{
 const f=fixture({initial:{without:'passed',with:'failed'}}),r=await executeEvidenceCodingWorkflow(f.options);
 assert.deepEqual(f.dispatched(),['with']);assert.deepEqual(r.repair_attempts,{without:0,with:1});
 assert.deepEqual(Object.keys(r.rechecks),['with']);assert.equal(r.final_checks.without.id,'initial-without');
 assert.equal(r.feedback.without,undefined);assert.equal(r.status,'passed');
});
test('first-pass success needs no model review turn or duplicate test execution',async()=>{
 const f=fixture({initial:{without:'passed',with:'passed'}}),r=await executeEvidenceCodingWorkflow(f.options);
 assert.deepEqual(f.order,['implement','check','final_binding']);assert.equal(r.feedback,null);assert.equal(r.rechecks,null);
 assert.equal(r.status,'passed');assert.deepEqual(r.repair_attempts,{without:0,with:0});
});
test('a failed recheck stays failed without another repair loop',async()=>{
 const f=fixture({final:{without:'failed',with:'passed'}}),r=await executeEvidenceCodingWorkflow(f.options);
 assert.equal(r.code_quality,'failed');assert.equal(r.status,'failed');assert.equal(f.order.filter(x=>x==='dispatch').length,1);assert.equal(r.final_checks.without.status,'failed');
});
test('stale, unavailable, malformed and wrong-plan initial checks cannot create feedback',async()=>{
 for(const corrupt of [r=>r.current=false,r=>r.status='unavailable',r=>r.summary.trusted_plan_hash='0'.repeat(64),r=>r.summary.public_tests.pass=99,r=>r.summary.artifact_sha256='bad']){
  const f=fixture();f.options.check=async()=>{const r=report('without');corrupt(r);return{without:r,with:report('with')};};
  await assert.rejects(executeEvidenceCodingWorkflow(f.options),e=>e.message==='evidence_check_unqualified'&&e.workflow.feedback===null);
  assert.ok(!f.order.includes('dispatch'));
 }
});
test('a feedback/artifact mixup is refused before the lease is committed or dispatched',async()=>{
 const f=fixture(),prepare=f.options.prepareFeedback;f.options.prepareFeedback=async(...args)=>{const p=await prepare(...args);p.metadata.with.artifact_sha256=p.metadata.without.artifact_sha256;return p;};
 await assert.rejects(executeEvidenceCodingWorkflow(f.options),/evidence_feedback_unqualified/);assert.ok(!f.order.includes('dispatch'));
});
test('interruption during repair retains initial checks and actual started receipts',async()=>{
 const f=fixture();f.options.awaitRepair=async()=>{throw Error('evidence_batch_deadline');};
 await assert.rejects(executeEvidenceCodingWorkflow(f.options),e=>{
  assert.equal(e.workflow.stage,'repair');assert.equal(e.workflow.status,'incomplete');assert.equal(e.workflow.initial_checks.with.status,'failed');
  assert.equal(e.workflow.feedback.with.check_id,'initial-with');assert.equal(e.workflow.repair_dispatch.with,'started');assert.equal(e.workflow.repair_attempts.with,1);assert.equal(e.workflow.rechecks,null);return true;
 });assert.ok(!f.order.includes('recheck'));
});
test('partial repair dispatch preserves its actual receipts and never rechecks a nonexistent completion',async()=>{
 const f=fixture();f.options.repair=async()=>({status:'partial_or_unconfirmed',arms:{without:{status:'started'},with:{status:'unknown'}}});
 await assert.rejects(executeEvidenceCodingWorkflow(f.options),e=>e.message==='evidence_repair_dispatch_unconfirmed'&&e.workflow.repair_attempts.without===1&&e.workflow.repair_attempts.with===0&&e.workflow.repair_dispatch.with==='unknown');
 assert.ok(!f.order.includes('recheck'));
});
test('final artifact binding rejects passing tests on bytes that are no longer current',async()=>{
 const f=fixture();f.options.validateFinal=async()=>false;
 await assert.rejects(executeEvidenceCodingWorkflow(f.options),e=>e.message==='evidence_final_artifact_unqualified'&&e.workflow.code_quality==='unverified');
});
test('checkpoint copies cannot mutate the authoritative workflow state',async()=>{
 const f=fixture();f.options.checkpoint=async state=>{if(state.initial_checks)state.initial_checks.with.status='passed';};
 const r=await executeEvidenceCodingWorkflow(f.options);assert.equal(r.initial_checks.with.status,'failed');assert.equal(r.final_checks.with.status,'passed');
});
