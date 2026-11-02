import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {compileEvidenceBatch} from '../src/evidence-batch-plan.mjs';
import {describeEvidenceTrajectoryRequests, executeEvidenceBatch, simulatedEvidenceAdapter, summarizeEvidenceBatch} from '../src/evidence-batch-runner.mjs';

const spec = {schema_version:1,model_ids:['muse-spark-1.3'],task_ids:['save-conflicts'],trajectory_ids:['steady'],repetitions:2,seed:'runner',limits:{per_arm_generations:4,max_total_generations:16,batch_timeout_ms:1000}};
const plan = () => compileEvidenceBatch(spec,{sourceCommit:'a'.repeat(40)});
async function fixture(t) { const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'evidence-runner-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));return path.join(root,'batch'); }
const arm = calls => ({model:{status:'observed',observed_models:['muse-spark-1.3']},usage:{status:'observed',coverage:'observed',model_calls:calls,input_tokens:100,output_tokens:20,cache_read_tokens:0}});
const native = extra => ({execution:'native',status:'completed',model_id:'muse-spark-1.3',arms:{without:arm(3),with:arm(4)},...extra});

test('simulation retains every matrix row but contributes no real samples or resources',async t=>{
 const directory=await fixture(t), summary=await executeEvidenceBatch({plan:plan(),outputDirectory:directory,adapter:simulatedEvidenceAdapter(),preparedManifest:{review:'offline'}});
 assert.equal(summary.real_model_pairs_observed,0);assert.equal(summary.simulated_pairs,2);assert.equal(summary.resources.with.input_tokens.observed_total,0);assert.equal(summary.cleanup_confirmed,true);
 const saved=JSON.parse(await fs.readFile(path.join(directory,'results.json')));assert.equal(saved.records.length,2);assert.equal(saved.records[0].provider_calls,0);assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'prepared-manifest.json'))),{review:'offline'});
 await assert.rejects(executeEvidenceBatch({plan:plan(),outputDirectory:directory,adapter:simulatedEvidenceAdapter()}),{code:'EEXIST'});
});

test('partial failed native cells retain known spend and mark missing sides unknown',()=>{
 const summary=summarizeEvidenceBatch([native({status:'failed',arms:{without:arm(5),with:null}}),native(),native({status:'not_started',arms:null})],{execution:'native',plannedPairs:3});
 assert.equal(summary.resources.without.model_calls.observed_total,8);assert.equal(summary.resources.with.model_calls.observed_total,4);assert.equal(summary.resources.with.model_calls.unknown_pairs,1);assert.equal(summary.resources.without.model_calls.known_pairs,2);
 assert.equal(summary.real_model_pairs_observed,1);assert.equal(summary.paired_resource_deltas.model_calls.pairs,1);assert.equal(summary.paired_resource_deltas.model_calls.median_with_minus_without,1);
});

test('stale or failed checks do not qualify code quality; answers remain unreviewed',()=>{
 const check=current=>({arms:Object.fromEntries(['without','with'].map(a=>[a,{latest:{current,status:current?'passed':'stale',summary:{state:'passed'}}}]))});
 const summary=summarizeEvidenceBatch([native({code_checks:check(false)}),native({code_checks:check(true)}),native({status:'failed',code_checks:check(true)})],{execution:'native',plannedPairs:3});
 assert.equal(summary.code_checks_passed_both,1);assert.equal(summary.real_model_pairs_observed,3);assert.equal(summary.completed_real_model_pairs,2);assert.equal(summary.answer_quality,'unreviewed');assert.equal(summary.human_benefit,'not_measured');
});

test('blocked approvals retain the row and leave all later cells unstarted, without retry',async t=>{
 let calls=0,closed=0;const directory=await fixture(t);
 const summary=await executeEvidenceBatch({plan:plan(),outputDirectory:directory,adapter:{async runCell(){calls++;return{status:'blocked',reason:'approval_outside_benchmark_scope',cleanup_confirmed:true};},async close(){closed++;}}});
 assert.equal(calls,1);assert.equal(closed,1);assert.deepEqual(summary.status_counts,{blocked:1,not_started:1});assert.equal(summary.stop_reason,'approval_outside_benchmark_scope');
});

test('deadline closes an uncooperative prepare and finishes with cleanup unconfirmed',async t=>{
 let closed=0,calls=0;const directory=await fixture(t),started=performance.now();
 const summary=await executeEvidenceBatch({plan:plan(),outputDirectory:directory,cleanupGraceMs:25,adapter:{prepare:()=>new Promise(()=>{}),async runCell(){calls++;},async close(){closed++;}}});
 assert.equal(closed,1);assert.equal(calls,0);assert.equal(summary.cleanup_confirmed,false);assert.equal(summary.stop_reason,'batch_deadline');assert.deepEqual(summary.status_counts,{not_started:2});assert.ok(performance.now()-started<2000);
});

test('cancellation closes a running pair and retains its partial usage',async t=>{
 const cancel=new AbortController(),directory=await fixture(t);let finish,closed=0;
 const adapter={async runCell(){queueMicrotask(()=>cancel.abort());return new Promise(resolve=>{finish=resolve;});},async close(){closed++;finish?.(native({status:'interrupted',cleanup_confirmed:true,arms:{without:arm(2),with:null}}));}};
 const summary=await executeEvidenceBatch({plan:plan(),outputDirectory:directory,adapter,execution:'native',authorizedPlanId:plan().plan_id,signal:cancel.signal,cleanupGraceMs:50});
 assert.equal(closed,1);assert.equal(summary.resources.without.model_calls.observed_total,2);assert.equal(summary.resources.with.model_calls.unknown_pairs,1);assert.deepEqual(summary.status_counts,{interrupted:1,not_started:1});
});

test('initial evidence write failure still closes the adapter and leaves all cells unstarted',async t=>{
 let closed=0;const directory=await fixture(t);const summary=await executeEvidenceBatch({plan:plan(),outputDirectory:directory,preparedManifest:{invalid:1n},adapter:{async runCell(){assert.fail('must not dispatch');},async close(){closed++;}}});
 assert.equal(closed,1);assert.equal(summary.recorded_pairs,2);assert.deepEqual(summary.status_counts,{not_started:2});assert.equal(summary.stop_reason,'batch_preparation_failed');
});

test('native dispatch needs the exact authorized plan; changed plans never call prepare',async t=>{
 let prepared=0;const adapter={async prepare(){prepared++;},async runCell(){},async close(){}};const directory=await fixture(t);
 await assert.rejects(executeEvidenceBatch({plan:plan(),outputDirectory:directory,adapter,execution:'native'}),/not_authorized/);
 await assert.rejects(executeEvidenceBatch({plan:{...plan(),plan_id:'0'.repeat(64)},outputDirectory:directory,adapter}),/plan_changed/);assert.equal(prepared,0);
});

test('uncooperative operation and close share one cleanup grace interval',async t=>{
 const directory=await fixture(t),cancel=new AbortController();let entered;const ready=new Promise(resolve=>{entered=resolve;});
 const pending=executeEvidenceBatch({plan:plan(),outputDirectory:directory,signal:cancel.signal,cleanupGraceMs:200,adapter:{prepare(){entered();return new Promise(()=>{});},async runCell(){assert.fail('not admitted');},close:()=>new Promise(()=>{})}});
 await ready;const started=performance.now();cancel.abort();const summary=await pending;assert.equal(summary.cleanup_confirmed,false);assert.equal(summary.stop_reason,'cancelled');assert.ok(performance.now()-started<350,'two serial grace periods would require at least400ms');
});

test('candidate simulations preserve experimental labels without claiming native bridge coverage',async t=>{const directory=await fixture(t),candidate=compileEvidenceBatch({...spec,guidance_variant:'contextual-v2'},{sourceCommit:'a'.repeat(40)});await executeEvidenceBatch({plan:candidate,outputDirectory:directory,adapter:simulatedEvidenceAdapter()});const records=JSON.parse(await fs.readFile(path.join(directory,'results.json'))).records;assert.equal(records[0].trajectory.guidance_variant,'contextual-v2');assert.equal(records[0].trajectory.quality_status,'quality_failed_not_promoted');assert.equal(records[0].native_bridge_exercised,false);});

test('partial response coverage stays an observed subtotal with unknown remainder and no paired delta',()=>{
 const record=native({status:'blocked'});record.arms.with.usage.coverage='partial_or_unconfirmed';
 const summary=summarizeEvidenceBatch([record],{execution:'native',plannedPairs:1});
 const resource=summary.resources.with.input_tokens;
 assert.equal(resource.observed_total,100);assert.equal(resource.known_pairs,1);assert.equal(resource.complete_pairs,0);assert.equal(resource.partial_or_unconfirmed_pairs,1);assert.equal(resource.has_unknown_remainder,true);
 assert.equal(summary.resources.without.input_tokens.complete_pairs,1);assert.equal(summary.resources.without.input_tokens.has_unknown_remainder,false);
 assert.equal(summary.paired_resource_deltas.input_tokens.pairs,0);assert.equal(summary.paired_resource_deltas.input_tokens.median_with_minus_without,null);assert.equal(summary.paired_resource_deltas.input_tokens.excluded_incomplete_coverage_pairs,1);
});

test('absent coverage is not silently upgraded to complete for numeric native usage',()=>{
 const record=native();delete record.arms.with.usage.coverage;
 const summary=summarizeEvidenceBatch([record],{execution:'native',plannedPairs:1});
 assert.equal(summary.resources.with.model_calls.observed_total,4);assert.equal(summary.resources.with.model_calls.has_unknown_remainder,true);assert.equal(summary.paired_resource_deltas.model_calls.pairs,0);
});

const trajectoryRows=sequence=>sequence.map(value=>value==='fallback'?{status:'fallback_observed',controls:null}:{status:'guidance_observed',controls:{response_extent:value,unsolicited_update:value==='terse'?'defer':'send',conversation_style:value==='terse'?'self_contained':'conversational'}});
const trajectoryTurns=sequence=>[{delivery:{with:{request_attribution:trajectoryRows(sequence)}}}];

test('trajectory qualification requires the exact compressed sequence, with no unexpected suffix',()=>{
 for(const [id,sequence,extra]of [['steady',['standard'],'full'],['change-during-work',['full','terse'],'full'],['fallback-return',['full','terse','fallback','full'],'terse']]){
  assert.equal(describeEvidenceTrajectoryRequests(id,trajectoryTurns(sequence)).status,'observed');
  const doubled=sequence.flatMap(value=>[value,value]);const valid=describeEvidenceTrajectoryRequests(id,trajectoryTurns(doubled));assert.equal(valid.status,'observed');assert.deepEqual(valid.observed_sequence,sequence);assert.equal(valid.requests_observed,doubled.length);
  assert.equal(describeEvidenceTrajectoryRequests(id,trajectoryTurns([...sequence,extra])).status,'partial_or_unverified',id);
 }
});

test('missing, out-of-order, unclassified and unknown trajectories cannot qualify',()=>{
 for(const [id,sequence]of [['steady',['standard']],['change-during-work',['full','terse']],['fallback-return',['full','terse','fallback','full']]]){
  assert.equal(describeEvidenceTrajectoryRequests(id,trajectoryTurns(sequence.slice(0,-1))).status,'partial_or_unverified');
  const unclassified=trajectoryTurns(sequence);unclassified[0].delivery.with.request_attribution.push({status:'unavailable'});const result=describeEvidenceTrajectoryRequests(id,unclassified);assert.equal(result.status,'partial_or_unverified');assert.equal(result.unclassified_requests,1);
 }
 assert.equal(describeEvidenceTrajectoryRequests('fallback-return',trajectoryTurns(['terse','full','fallback','full'])).status,'partial_or_unverified');
 assert.equal(describeEvidenceTrajectoryRequests('unknown',trajectoryTurns(['full','terse','fallback','full'])).status,'partial_or_unverified');
});

test('exact trajectory matching compresses consecutive frames across user-turn boundaries',()=>{
 const turns=[{delivery:{with:{request_attribution:trajectoryRows(['full','terse'])}}},{delivery:{with:{request_attribution:trajectoryRows(['terse','fallback','fallback','full','full'])}}}];
 const result=describeEvidenceTrajectoryRequests('fallback-return',turns);assert.equal(result.status,'observed');assert.deepEqual(result.observed_sequence,['full','terse','fallback','full']);assert.equal(result.requests_observed,7);
});

test('workflow summary retains failed repair and incomplete attempts without resumming per-turn usage',()=>{
 const checked=status=>({status,current:true,summary:{state:status}}),record=native({status:'failed'});
 record.cleanup_confirmed=true;record.workflow={schema_version:1,status:'failed',stage:'finished',initial_checks:{without:checked('failed'),with:checked('passed')},repair_dispatch:{without:'started',with:'not_started'},rechecks:{without:checked('failed')},final_checks:{without:checked('failed'),with:checked('passed')}};
 record.turns=[{usage_snapshot:{with:{input_tokens:999999},without:{input_tokens:999999}}}];
 const s=summarizeEvidenceBatch([record],{execution:'native',plannedPairs:1});
 assert.equal(s.workflow_results.initial_check_passed_arms,1);assert.equal(s.workflow_results.repair_turns_started,1);assert.equal(s.workflow_results.final_checked_passed_arms,1);assert.equal(s.workflow_results.failed_after_recheck_arms,1);
 assert.equal(s.resources.with.input_tokens.observed_total,record.arms.with.usage.input_tokens);assert.equal(s.code_checks_passed_both,0);
 record.workflow.status='incomplete';record.workflow.stage='repair';record.workflow.final_checks=null;
 const partial=summarizeEvidenceBatch([record],{execution:'native',plannedPairs:1});assert.equal(partial.workflow_results.incomplete_pairs,1);assert.equal(partial.workflow_results.final_checked_passed_arms,0);assert.equal(partial.workflow_results.repair_turns_started,1);
});
