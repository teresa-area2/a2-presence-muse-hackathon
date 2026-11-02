// Lifecycle and typed-boundary fixtures only; none are native-model evidence.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {EVIDENCE_USER_TURNS} from '../src/evidence-batch-native.mjs';
import {describeEvidenceAnswer} from '../src/evidence-batch-runner.mjs';
import {fixture} from './helpers/evidence-native-fixture.mjs';

test('first-pass implementation saves exact proofs/checks/artifacts without an extra model turn',async t=>{const f=await fixture(t);await f.adapter.prepare(f.context);const result=await f.adapter.runCell(f.cell,f.context);assert.equal(result.status,'completed');assert.equal(result.cleanup_confirmed,true);assert.deepEqual(f.prompts,[EVIDENCE_USER_TURNS[0]]);assert.equal(result.turns.length,1);assert.equal(result.workflow.code_quality,'passed');assert.equal(result.turns[0].response_presentation.with.headings,1);assert.equal(result.native_generations_reserved,4);assert.equal(result.source_script_coverage,'complete');assert.ok(f.logs.indexOf('stop-end')<f.logs.indexOf('worktrees'));assert.equal((await fs.readdir(path.join(f.root,'sessions'))).length,0);await fs.access(path.join(f.context.directory,'artifacts/with/src/save.mjs'));});
test('a request trace without public-final linkage cannot qualify delivery',async t=>{const f=await fixture(t,{missingLink:true});await f.adapter.prepare(f.context);const result=await f.adapter.runCell(f.cell,f.context);assert.equal(result.status,'failed');assert.equal(result.reason,'evidence_delivery_unqualified');assert.equal(f.prompts.length,1);});
test('partial startup with unconfirmed owned exits stops qualification and retains the workspace',async t=>{const f=await fixture(t,{failure:'startup_cleanup_unconfirmed'});await f.adapter.prepare(f.context);const result=await f.adapter.runCell(f.cell,f.context);assert.equal(result.cleanup_confirmed,false);assert.equal(result.status,'failed');assert.equal(f.prompts.length,0);assert.ok(!f.logs.includes('worktrees'));});
test('failed evidence closure still attempts bridge/config cleanup',async t=>{const f=await fixture(t,{storeFailure:true});await f.adapter.prepare(f.context);const result=await f.adapter.runCell(f.cell,f.context);assert.equal(result.cleanup_confirmed,false);assert.ok(f.logs.includes('bridge'));assert.ok(f.logs.includes('configs'));});
test('concurrent cancellation and finalization await the same owned close before artifact cleanup',async t=>{const f=await fixture(t,{hang:true});await f.adapter.prepare(f.context);const pending=f.adapter.runCell(f.cell,f.context);while(!f.prompts.length)await new Promise(r=>setTimeout(r,1));f.abort.abort();await Promise.all([f.adapter.close(),pending]);assert.equal(f.logs.filter(x=>x==='stop-start').length,1);assert.ok(f.logs.indexOf('stop-end')<f.logs.indexOf('worktrees'));});
test('descriptive formatting counts ignore Markdown-like syntax inside fenced code',()=>{assert.deepEqual(describeEvidenceAnswer('# Summary\n- One\n2. Two\n```js\n# not a heading\n- not a bullet\n```'),{words:16,bullets:2,headings:1,code_blocks:1,interpretation:'descriptive_only'});assert.equal(describeEvidenceAnswer(''),null);});

test('cancellation during bridge acquisition closes the late socket and auth reference',async t=>{const f=await fixture(t,{holdBridge:true});await f.adapter.prepare(f.context);const pending=f.adapter.runCell(f.cell,f.context);await f.bridgeEntered;f.abort.abort();await f.adapter.close();f.releaseBridge();const result=await pending;assert.ok(f.logs.includes('bridge'));assert.ok(f.logs.includes('configs'));assert.equal(result.status,'interrupted');assert.equal(f.prompts.length,0);});

test('blocked turns retain request trajectory, decision reason and final post-stop usage',async t=>{
 const f=await fixture(t,{stopApproval:true,lateUsage:true});await f.adapter.prepare(f.context);const result=await f.adapter.runCell(f.cell,f.context);
 assert.equal(result.status,'blocked');assert.equal(result.cleanup_confirmed,true);assert.equal(result.turns.length,1);assert.equal(result.turns[0].completed,false);
 assert.equal(result.request_trajectory.requests_observed,4);assert.deepEqual(result.request_trajectory.observed_sequence,['full','terse']);
 assert.equal(result.arms.with.status,'closed');assert.equal(result.arms.with.usage.model_calls,4);assert.equal(result.arms.with.usage.input_tokens,1600);
 assert.equal(result.turns[0].usage_snapshot.with.model_calls,4);assert.equal(result.turns[0].response_presentation.with,null);
 assert.equal(result.automated_decisions[0].status,'not_granted');assert.equal(result.automated_decisions[0].reason,'outside_reviewed_command_policy');
 assert.match(result.automated_decisions[0].command_sha256,/^[a-f0-9]{64}$/);assert.equal(result.code_checks,null);
});

test('interrupted pair preserves native tool failure metadata arriving during owned stop, without raw content',async t=>{
 const f=await fixture(t,{stopApproval:true,toolEvents:true});await f.adapter.prepare(f.context);const result=await f.adapter.runCell(f.cell,f.context);
 assert.equal(result.tool_outcomes.with.rows.length,1);
 assert.equal(result.tool_outcomes.with.rows[0].status,'failed');
 assert.deepEqual(result.tool_outcomes.with.rows[0].diagnostic_hints,['path_not_found']);
 assert.equal(result.tool_outcomes.without.rows[0].tool,'bash');
 assert.ok(!JSON.stringify(result.tool_outcomes).includes('PRIVATE'));
 const saved=JSON.parse(await fs.readFile(path.join(f.context.directory,'tool-outcomes.json')));
 assert.deepEqual(saved.arms,result.tool_outcomes);
 assert.equal(result.stop_diagnostics.arms.with.guard_reserved,2);
 assert.equal(result.cleanup_confirmed,true);
 assert.ok(Object.values(f.nativeClients).every(client=>client.listenerCount('notification')===0));
});

test('tool-log persistence failure remains a failed qualification with unknown diagnostic coverage',async t=>{
 const f=await fixture(t,{toolEvents:true});await fs.mkdir(path.join(f.context.directory,'tool-outcomes.json'));
 await f.adapter.prepare(f.context);const result=await f.adapter.runCell(f.cell,f.context);
 assert.equal(result.status,'failed');assert.equal(result.reason,'evidence_tool_log_unavailable');
 assert.equal(result.cleanup_confirmed,false);assert.equal(result.tool_outcomes.with.observer_failed,true);
 assert.equal(result.tool_outcomes.with.coverage,'partial_or_unverified');
 assert.ok(f.logs.includes('configs'));assert.ok(Object.values(f.nativeClients).every(client=>client.listenerCount('notification')===0));
});

test('independent check occurs immediately after implementation, before any review or repair turn',async t=>{
 const f=await fixture(t);await f.adapter.prepare(f.context);await f.adapter.runCell(f.cell,f.context);
 assert.equal(f.logs.find(x=>x.startsWith('ci-after-turns:')),'ci-after-turns:1');
});

test('failed arms receive only their own checked feedback and retain distinct before/after artifacts',async t=>{
 const f=await fixture(t,{initialCI:{without:'failed',with:'failed'}});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
 assert.equal(r.status,'completed');assert.deepEqual(r.workflow.repair_attempts,{without:1,with:1});assert.equal(r.turns.length,2);
 assert.deepEqual(f.submitted.map(x=>x.target),['both','without','with']);
 for(const arm of ['without','with']){const initial=r.workflow.initial_checks[arm],final=r.workflow.final_checks[arm],prompt=f.submitted.find(x=>x.target===arm).prompt;
  assert.match(prompt,new RegExp(initial.summary.artifact_sha256));assert.ok(!prompt.includes(r.workflow.initial_checks[arm==='with'?'without':'with'].summary.artifact_sha256));assert.notEqual(initial.summary.artifact_sha256,final.summary.artifact_sha256);
  const before=JSON.parse(await fs.readFile(path.join(f.context.directory,initial.artifact_record)));assert.equal(before.sha256,initial.summary.artifact_sha256);
 }
 assert.deepEqual(f.logs.filter(x=>x.startsWith('ci-after-turns:')),['ci-after-turns:1','ci-after-turns:3']);
});

test('one-sided repair does not duplicate the other arm request or consume its extra model turn',async t=>{
 for(const failed of ['without','with']){
  const f=await fixture(t,{initialCI:{without:failed==='without'?'failed':'passed',with:failed==='with'?'failed':'passed'}});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
  assert.equal(r.status,'completed');assert.equal(r.turns.length,2);assert.deepEqual(r.turns[1].selected_arms,[failed]);
  assert.equal(r.turns[1].delivery[failed==='with'?'without':'with'],null);
  assert.equal(r.request_trajectory.requests_observed,failed==='with'?6:3);
  assert.equal(r.arms[failed==='with'?'without':'with'].usage.model_calls,1);assert.equal(r.workflow.repair_attempts[failed],1);
 }
});

test('failed repair remains a failed cell and cannot create a third model turn',async t=>{
 const f=await fixture(t,{initialCI:{without:'failed',with:'failed'},repairCI:{without:'failed',with:'passed'}});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
 assert.equal(r.status,'failed');assert.equal(r.reason,'evidence_quality_checks_failed');assert.equal(r.workflow.code_quality,'failed');assert.equal(f.submitted.length,3);
});

test('cap/cancellation during repair preserves the initial check and actual dispatch evidence',async t=>{
 const f=await fixture(t,{initialCI:{without:'passed',with:'failed'},hangRepair:true});await f.adapter.prepare(f.context);const pending=f.adapter.runCell(f.cell,f.context);
 while(f.submitted.length<2)await new Promise(resolve=>setTimeout(resolve,1));f.abort.abort();const r=await pending;
 assert.equal(r.status,'interrupted');assert.equal(r.workflow.initial_checks.with.status,'failed');assert.equal(r.workflow.repair_attempts.with,1);assert.equal(r.workflow.repair_dispatch.with,'started');
 assert.equal(r.turns.at(-1).stage,'repair');assert.equal(r.turns.at(-1).completed,false);assert.equal(r.workflow.rechecks,null);assert.equal(r.cleanup_confirmed,true);
});

test('unavailable checks stay unknown, preserve their receipt and cannot dispatch a repair',async t=>{
 const f=await fixture(t,{initialCI:{without:'unavailable',with:'failed'}});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
 assert.equal(r.status,'failed');assert.equal(r.reason,'evidence_check_unqualified');assert.equal(r.workflow.initial_checks.without.status,'unavailable');assert.equal(f.submitted.length,1);assert.equal(r.workflow.code_quality,'unverified');
});

test('a source mutation during owned shutdown invalidates the formerly passing final check',async t=>{
 const f=await fixture(t,{mutateOnStop:true});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
 assert.equal(r.status,'failed');assert.equal(r.reason,'evidence_final_artifact_changed');assert.equal(r.workflow.code_quality,'unverified');assert.equal(r.workflow.status,'incomplete');assert.equal(r.cleanup_confirmed,false);
});

test('cancellation between two repair dispatches retains the first started receipt and excludes the unsent arm',async t=>{
 const f=await fixture(t,{initialCI:{without:'failed',with:'failed'},cancelBetweenRepairs:true});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
 assert.equal(r.status,'interrupted');assert.deepEqual(f.submitted.map(x=>x.target),['both','without']);
 assert.deepEqual(r.workflow.repair_attempts,{without:1,with:0});assert.equal(r.workflow.repair_dispatch.without,'started');assert.equal(r.workflow.repair_dispatch.with,'not_started');
 assert.equal(r.turns.at(-1).dispatch_receipts.without.status,'started');assert.equal(r.turns.at(-1).delivery.with,null);
});

test('a completed baseline turn without a public final cannot reach checked qualification',async t=>{
 const f=await fixture(t,{withoutFinalMissing:true});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
 assert.equal(r.status,'failed');assert.equal(r.reason,'evidence_model_or_isolation_unqualified');assert.equal(r.code_checks,null);assert.equal(r.workflow.code_quality,'unverified');
});

test('a repair without a current public final cannot borrow implementation presentation counts',async t=>{
 const f=await fixture(t,{initialCI:{without:'failed',with:'passed'},withoutRepairFinalMissing:true});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
 assert.equal(r.status,'failed');assert.equal(r.reason,'evidence_model_or_isolation_unqualified');assert.equal(r.turns[0].response_presentation.without.headings,1);
 assert.equal(r.turns[1].response_presentation.without,null);assert.equal(r.workflow.rechecks,null);assert.equal(r.workflow.code_quality,'unverified');
});

test('a stale implementation ordinal cannot qualify a completed repair',async t=>{
 const f=await fixture(t,{initialCI:{without:'failed',with:'passed'},withoutRepairStaleOrdinal:true});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
 assert.equal(r.status,'failed');assert.equal(r.reason,'evidence_model_or_isolation_unqualified');assert.equal(r.turns[1].delivery.without,null);
 assert.equal(r.turns[1].response_presentation.without,null);assert.equal(r.workflow.rechecks,null);assert.equal(r.workflow.code_quality,'unverified');
});
