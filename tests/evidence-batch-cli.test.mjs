import {runEvidenceBatchCli} from '../scripts/evidence-batch.mjs';import {createHash} from 'node:crypto';import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {describeEvidenceTrajectoryRequests} from '../src/evidence-batch-runner.mjs';
const execute=promisify(execFile),ROOT=fileURLToPath(new URL('../',import.meta.url));
async function cli(args){return execute(process.execPath,['--experimental-strip-types','scripts/evidence-batch.mjs',...args],{cwd:ROOT,env:{...process.env,A2_LAB_MUSE:'/not-a-real-muse',A2_OP_API_KEY:'never-use-test-sentinel'},timeout:15000,maxBuffer:32768});}

test('prepared twelve-pair batch simulates credential-free, with no native dispatch or real sample inflation',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'evidence-cli-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const manifest=path.join(root,'plan.json');
 const preparation=JSON.parse((await cli(['plan','--spec','experiments/evidence-batch.example.json','--out',manifest])).stdout);assert.equal(preparation.dispatched,false);assert.equal(preparation.pairs,12);
 const frozen=JSON.parse(await fs.readFile(manifest));assert.equal(frozen.resource_authority,'not_granted_by_preparation');assert.equal(frozen.approval_policy.duration,'once');assert.ok(frozen.engine_source['src/native-controls.mjs']);assert.ok(frozen.engine_source['src/evidence-batch-native.mjs']);const policyFixture='tests/fixtures/coding-instructions-3-matrix.json';assert.equal(frozen.engine_source[policyFixture],createHash('sha256').update(await fs.readFile(path.join(ROOT,policyFixture))).digest('hex'));assert.ok(frozen.user_turns[0].includes('Other commands require a human decision'));
 assert.equal(frozen.workflow_policy.max_repair_turns_per_arm,1);assert.equal(frozen.workflow_policy.repair_targets,'failed_arms_only');assert.equal(frozen.approval_policy.version,3);assert.ok(frozen.engine_source['src/evidence-coding-workflow.mjs']);assert.equal(frozen.feedback_template.function,'buildCIFeedback');
 const run=JSON.parse((await cli(['simulate','--manifest',manifest,'--out',path.join(root,'offline')])).stdout);assert.equal(run.summary.real_model_pairs_observed,0);assert.equal(run.summary.simulated_pairs,12);assert.equal(run.summary.op_calls,0);assert.equal(run.summary.cleanup_confirmed,true);
 await assert.rejects(cli(['run','--manifest',manifest,'--out',path.join(root,'unauthorized')]),e=>e.stderr.includes('evidence_batch_not_authorized'));
 const modified=structuredClone(frozen);modified.engine_source[policyFixture]='0'.repeat(64);await fs.writeFile(manifest,JSON.stringify(modified));await assert.rejects(cli(['simulate','--manifest',manifest,'--out',path.join(root,'changed-guidance')]),e=>e.stderr.includes('evidence_manifest_or_source_changed'));
 frozen.approval_policy.duration='session';await fs.writeFile(manifest,JSON.stringify(frozen));await assert.rejects(cli(['simulate','--manifest',manifest,'--out',path.join(root,'changed')]),e=>e.stderr.includes('evidence_manifest_or_source_changed'));
});

test('trajectory completion requires attributed outgoing policies, not just hook positions',()=>{
 const turns=extent=>[{delivery:{with:{request_attribution:extent.map(value=>value==='fallback'?{status:'fallback_observed'}:{status:'guidance_observed',controls:{response_extent:value,unsolicited_update:value==='terse'?'defer':'send',conversation_style:value==='terse'?'self_contained':'conversational'}})}}}];
 assert.equal(describeEvidenceTrajectoryRequests('fallback-return',turns(['full'])).status,'partial_or_unverified');
 assert.equal(describeEvidenceTrajectoryRequests('fallback-return',turns(['full','terse','fallback','fallback','full'])).status,'observed');
 assert.equal(describeEvidenceTrajectoryRequests('change-during-work',turns(['full','full','terse'])).status,'observed');
 const wrongUpdates=turns(['full','terse']);wrongUpdates[0].delivery.with.request_attribution[1].controls.unsolicited_update='send';assert.equal(describeEvidenceTrajectoryRequests('change-during-work',wrongUpdates).status,'partial_or_unverified');
 const wrongStyle=turns(['standard']);wrongStyle[0].delivery.with.request_attribution[0].controls.conversation_style='self_contained';assert.equal(describeEvidenceTrajectoryRequests('steady',wrongStyle).status,'partial_or_unverified');
 const unknown=[{delivery:{with:{request_attribution:[{status:'unavailable'}]}}}];assert.equal(describeEvidenceTrajectoryRequests('steady',unknown).unclassified_requests,1);
});

async function approvalFixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'evidence-cli-authority-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const manifest=path.join(root,'plan.json');await cli(['plan','--spec','experiments/evidence-batch.example.json','--out',manifest]);
 const digest=createHash('sha256').update(await fs.readFile(manifest)).digest('hex');return{root,manifest,digest};
}

test('digit-bearing approval flag reaches digest rejection and never creates native output on a wrong digest',async t=>{
 const f=await approvalFixture(t),output=path.join(f.root,'must-not-start');
 await assert.rejects(runEvidenceBatchCli(['run','--manifest',f.manifest,'--approved-manifest-sha256','0'.repeat(64),'--out',output]),/evidence_batch_not_authorized/);
 assert.equal(await fs.stat(output).catch(()=>null),null);
});

test('exact approval digest reaches exclusive output guard before any native preparation or dispatch',async t=>{
 const f=await approvalFixture(t),output=path.join(f.root,'already-owned');await fs.mkdir(output);await fs.writeFile(path.join(output,'marker'),'preserve');
 // Native adapter construction is inert. EEXIST precedes adapter.prepare and
 // component/auth loading, so this exercises the authorized CLI without a model.
 await assert.rejects(runEvidenceBatchCli(['run','--manifest',f.manifest,'--approved-manifest-sha256',f.digest,'--out',output]),{code:'EEXIST'});
 assert.deepEqual(await fs.readdir(output),['marker']);assert.equal(await fs.readFile(path.join(output,'marker'),'utf8'),'preserve');
});

test('unknown digit-bearing options and duplicate approval flags remain invalid',async()=>{
 for(const argv of [
  ['run','--manifest','unused','--out','unused','--unknown2','x'],
  ['run','--manifest','unused','--out','unused','--approved-manifest-sha256','a','--approved-manifest-sha256','b'],
 ])await assert.rejects(runEvidenceBatchCli(argv),/evidence_cli_arguments_invalid/);
});
