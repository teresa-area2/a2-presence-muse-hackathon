// Real local worktrees, artifact binding and sandboxed verifier; SCRIPTED agents,
// not model/provider behavior or inferred human benefit.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {fixture} from './helpers/evidence-native-fixture.mjs';
test('sandbox workflow repairs from qualified CI or stops safely when Linux isolation is unavailable',async t=>{
 const f=await fixture(t,{sandboxCI:true});await f.adapter.prepare(f.context);const r=await f.adapter.runCell(f.cell,f.context);
 // Linux distributions/containers may deny unprivileged namespaces. That is
 // an explicit unavailable result, never permission to run tests on the host.
 // Keep every original repair assertion below for a qualified sandbox.
 if(process.platform==='linux'&&['without','with'].every(a=>r.workflow?.initial_checks?.[a]?.status==='unavailable')){
  assert.equal(r.reason,'evidence_check_unqualified');assert.equal(r.status,'failed');
  assert.equal(r.workflow.status,'incomplete');assert.equal(r.workflow.stage,'independent_check');assert.equal(r.workflow.code_quality,'unverified');
  assert.equal(r.workflow.feedback,null);assert.equal(r.workflow.rechecks,null);assert.equal(r.workflow.final_checks,null);
  assert.deepEqual(r.workflow.repair_arms,[]);assert.deepEqual(r.workflow.repair_attempts,{without:0,with:0});
  for(const arm of ['without','with']){const check=r.workflow.initial_checks[arm];assert.equal(check.summary.state,'unavailable');assert.equal(check.summary.public_tests,null);assert.equal(check.summary.frozen_tests,null);assert.equal(check.feedback_available,false);}
  assert.equal(f.submitted.length,1);assert.equal(f.submitted[0].target,'both');assert.equal(r.cleanup_confirmed,true);
  t.diagnostic('Actual Linux isolation unavailable: abort and cleanup verified; successful sandbox repair path not qualified here.');return;
 }
 assert.equal(r.reason,null);assert.equal(r.status,'completed');assert.equal(r.workflow.code_quality,'passed');assert.deepEqual(r.workflow.repair_arms,['without','with']);
 for(const arm of ['without','with']){
  const initial=r.workflow.initial_checks[arm],final=r.workflow.final_checks[arm];
  assert.equal(initial.status,'failed');assert.equal(initial.summary.public_tests.fail,1);assert.equal(initial.summary.frozen_tests.fail,11);
  assert.equal(final.status,'passed');assert.equal(final.summary.public_tests.pass,2);assert.equal(final.summary.frozen_tests.pass,15);assert.equal(final.summary.trusted_plan_hash,initial.summary.trusted_plan_hash);
  assert.notEqual(final.summary.artifact_sha256,initial.summary.artifact_sha256);
  const before=JSON.parse(await fs.readFile(path.join(f.context.directory,initial.artifact_record))),after=JSON.parse(await fs.readFile(path.join(f.context.directory,final.artifact_record)));
  assert.equal(before.sha256,initial.summary.artifact_sha256);assert.equal(after.sha256,final.summary.artifact_sha256);
  const own=f.submitted.find(x=>x.target===arm).prompt;assert.ok(own.includes(initial.summary.artifact_sha256));assert.ok(own.includes('Failed frozen trusted cases:'));
 }
 assert.equal(r.turns.length,2);assert.equal(r.cleanup_confirmed,true);
 const saved=JSON.parse(await fs.readFile(path.join(f.context.directory,'workflow.json')));assert.equal(saved.code_quality,'passed');
});
