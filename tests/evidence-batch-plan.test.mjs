import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {compileEvidenceBatch} from '../src/evidence-batch-plan.mjs';
const sourceCommit = 'a'.repeat(40);
const spec = () => ({schema_version: 1, model_ids: ['muse-spark-1.3'], task_ids: ['save-conflicts', 'booking-rules'], trajectory_ids: ['steady', 'change-during-work', 'fallback-return'], repetitions: 2, seed: 'fixture-20261101', limits: {per_arm_generations: 8, max_total_generations: 192, batch_timeout_ms: 600000}});
const compile = value => compileEvidenceBatch(value, {sourceCommit});
function deeplyFrozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) deeplyFrozen(child); } }

test('example compiles to twelve matched pairs and exactly192 reserved generations without execution', async () => {
  const example = JSON.parse(await fs.readFile(new URL('../experiments/evidence-batch.example.json', import.meta.url), 'utf8'));
  const p = compile(example);
  assert.equal(p.cells.length, 12);
  assert.equal(p.limits.pair_count, 12);
  assert.equal(p.limits.allocated_generations, 192);
  assert.equal(p.limits.max_total_generations, 192);
  assert.equal(p.limits.batch_timeout_ms, 600000);
  assert.equal(p.labels.execution, 'not_started');
  assert.equal(p.labels.synthetic, true);
  const expected = [];
  for (const task of ['booking-rules', 'save-conflicts']) for (const trajectory of ['steady', 'change-during-work', 'fallback-return']) for (const repetition of [1, 2]) expected.push([task, trajectory, repetition].join(':'));
  assert.deepEqual(p.cells.map(c => [c.task_id, c.trajectory_id, c.repetition].join(':')).sort(), expected.sort());
  assert.ok(p.cells.every(c => c.model_id === 'muse-spark-1.3' && /^pair-[a-f0-9]{64}$/.test(c.id)));
  assert.equal(new Set(p.cells.map(c => c.id)).size, 12);
});

test('the same normalized input and seed yield identical JSON, including cell ordering and plan identity', () => {
  const a = spec(), b = spec(); b.task_ids.reverse(); b.trajectory_ids.reverse();
  assert.deepEqual(compile(a), compile(b));
  assert.deepEqual(compile(a), compile(a));
  assert.match(compile(a).plan_id, /^[a-f0-9]{64}$/);
  assert.equal(compile(a).source_commit, sourceCommit);
});

test('seed changes ordering but preserves the exact matrix and stable per-cell identity', () => {
  const a = compile(spec()), changed = spec(); changed.seed = 'another-seed'; const b = compile(changed);
  assert.notEqual(a.plan_id, b.plan_id);
  assert.notDeepEqual(a.cells.map(c => c.id), b.cells.map(c => c.id));
  assert.deepEqual(a.cells.map(c => c.id).sort(), b.cells.map(c => c.id).sort());
});

test('default fixture and explicit fixture normalize equally, while source or guidance changes bind a new plan', () => {
  const input = spec(), a = compile(input); input.guidance_variant = 'op-fixture'; assert.deepEqual(compile(input), a);
  assert.notEqual(compileEvidenceBatch(input, {sourceCommit: 'b'.repeat(40)}).plan_id, a.plan_id);
  input.guidance_variant = 'contextual-v2'; const p = compile(input);
  assert.notEqual(p.plan_id, a.plan_id);
  assert.equal(p.labels.experimental, true);
  assert.equal(p.labels.quality_status, 'quality_failed_not_promoted');
  assert.equal(p.labels.human_benefit, 'not_measured');
  assert.equal(p.labels.model_compliance, 'not_established');
});

test('plans are detached, recursively immutable and JSON-safe', () => {
  const input = spec(), p = compile(input); deeplyFrozen(p);
  input.task_ids[0] = 'free-task'; input.limits.per_arm_generations = 1;
  assert.ok(p.spec.task_ids.includes('save-conflicts')); assert.equal(p.limits.per_arm_generations, 8);
  assert.throws(() => p.cells.push({}), TypeError);
  assert.throws(() => p.spec.limits.batch_timeout_ms = 1, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  assert.doesNotMatch(JSON.stringify(p), /api_key|credential|workspace_path|\/Users\//i);
});

test('unknown fields, execution credentials and caller-selected paths are rejected', () => {
  for (const key of ['path', 'repository', 'source_commit', 'api_key', 'endpoint', 'run', 'evaluator']) {
    const value = spec(); value[key] = '/private/not-an-input'; assert.throws(() => compile(value), /evidence_batch_spec_invalid/);
  }
  const value = spec(); value.limits.retry = 1; assert.throws(() => compile(value), /evidence_batch_spec_invalid/);
  const getter = spec(); Object.defineProperty(getter, 'seed', {enumerable: true, get: () => 'must-not-run'}); assert.throws(() => compile(getter), /evidence_batch_spec_invalid/);
});

test('closed model, sample task and trajectory dimensions reject duplicates, holes, arbitrary values and free-form mode', () => {
  for (const [field, values] of [
    ['model_ids', ['muse-spark-1.3', 'unknown']], ['task_ids', ['free-task']], ['trajectory_ids', ['other']],
    ['model_ids', ['muse-spark-1.3', 'muse-spark-1.3']], ['task_ids', []], ['trajectory_ids', 'steady'], ['task_ids', Array(1)]
  ]) { const value = spec(); value[field] = values; assert.throws(() => compile(value), /evidence_batch_spec_invalid/); }
  const value = spec(); value.model_ids = ['muse-wonder-1.0']; assert.ok(compile(value).cells.every(c => c.model_id === 'muse-wonder-1.0'));
});

test('invalid schema, seed, variant, source identity and repetition counts fail closed', () => {
  for (const [key, val] of [['schema_version', 2], ['seed', ''], ['seed', '/private/path'], ['seed', 'x'.repeat(129)], ['guidance_variant', null], ['guidance_variant', 'live'], ['repetitions', 0], ['repetitions', 21], ['repetitions', 1.5]]) {
    const value = spec(); value[key] = val; assert.throws(() => compile(value), /evidence_batch_spec_invalid/);
  }
  for (const commit of [undefined, '', 'HEAD', 'a'.repeat(39), 'A'.repeat(40), '../source']) assert.throws(() => compileEvidenceBatch(spec(), {sourceCommit: commit}), /evidence_batch_spec_invalid/);
  for (const value of [null, [], {}, Object.create({schema_version: 1})]) assert.throws(() => compile(value), /evidence_batch_spec_invalid/);
});

test('hard allocation rejects a valid matrix whose reserved paired calls exceed the total ceiling', () => {
  const value = spec(); value.limits.max_total_generations = 191; assert.throws(() => compile(value), /evidence_batch_budget_exceeded/);
  const one = spec(); one.task_ids = ['save-conflicts']; one.trajectory_ids = ['steady']; one.repetitions = 1; one.limits.per_arm_generations = 32; one.limits.max_total_generations = 64;
  assert.equal(compile(one).limits.allocated_generations, 64);
  one.limits.max_total_generations = 63; assert.throws(() => compile(one), /evidence_batch_budget_exceeded/);
});

test('the sixty-four-pair cap is independent of the generation ceiling and is accepted exactly at its bound', () => {
  const value = spec(); value.model_ids = ['muse-spark-1.3', 'muse-wonder-1.0']; value.trajectory_ids = ['steady', 'fallback-return']; value.repetitions = 8; value.limits.max_total_generations = 1024;
  assert.equal(compile(value).cells.length, 64); assert.equal(compile(value).limits.allocated_generations, 1024);
  value.task_ids.push('batch-import'); value.repetitions = 6; value.limits.per_arm_generations = 1;
  assert.throws(() => compile(value), /evidence_batch_budget_exceeded/);
});

test('all numeric limit ceilings are enforced rather than silently clamped', () => {
  for (const [field, values] of [['per_arm_generations', [0, 33, 1.5]], ['max_total_generations', [0, 1025, Infinity]], ['batch_timeout_ms', [0, 1, 999, 600001, NaN]]]) {
    for (const val of values) { const value = spec(); value.limits[field] = val; assert.throws(() => compile(value), /evidence_batch_spec_invalid/); }
  }
});

test('batch deadlines admit the native guard minimum of one second exactly', () => {
  const value = spec(); value.limits.batch_timeout_ms = 1000;
  assert.equal(compile(value).limits.batch_timeout_ms, 1000);
});
