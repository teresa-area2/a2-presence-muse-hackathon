// Planning only: this module cannot start a provider, runtime or OP request.
import {createHash} from 'node:crypto';
import {CODING_TASKS} from './coding-task-catalog.mjs';
import {COMPARISON_MODELS} from './comparison-model.mjs';

export const EVIDENCE_TRAJECTORY_IDS = Object.freeze(['steady', 'change-during-work', 'fallback-return']);
const MODELS = new Set(COMPARISON_MODELS.map(row => row.id));
const TASKS = new Set(CODING_TASKS.map(row => row.id));
const VARIANTS = new Set(['op-fixture', 'contextual-v2']);
const bad = () => { throw Error('evidence_batch_spec_invalid'); };
const digest = value => createHash('sha256').update(value).digest('hex');
function record(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad();
  const keys = Reflect.ownKeys(value), permitted = new Set([...required, ...optional]);
  if (keys.some(key => typeof key !== 'string' || !permitted.has(key) || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) || required.some(key => !Object.hasOwn(value, key))) bad();
}
function dimension(values, allowed) {
  if (!Array.isArray(values) || !values.length || values.length > allowed.size || new Set(values).size !== values.length || [...values].some(value => typeof value !== 'string' || !allowed.has(value))) bad();
  return [...values].sort();
}
function integer(value, maximum) { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) bad(); return value; }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }

export function compileEvidenceBatch(spec, {sourceCommit} = {}) {
  record(spec, ['schema_version', 'model_ids', 'task_ids', 'trajectory_ids', 'repetitions', 'seed', 'limits'], ['guidance_variant']);
  if (spec.schema_version !== 1 || typeof sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(sourceCommit)) bad();
  const model_ids = dimension(spec.model_ids, MODELS), task_ids = dimension(spec.task_ids, TASKS);
  const trajectory_ids = dimension(spec.trajectory_ids, new Set(EVIDENCE_TRAJECTORY_IDS));
  const repetitions = integer(spec.repetitions, 20), seed = spec.seed, guidance_variant = Object.hasOwn(spec, 'guidance_variant') ? spec.guidance_variant : 'op-fixture';
  // A seed is an opaque reproducibility token, never an input path or free prose.
  if (typeof seed !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(seed) || !VARIANTS.has(guidance_variant)) bad();
  record(spec.limits, ['per_arm_generations', 'max_total_generations', 'batch_timeout_ms']);
  const per_arm_generations = integer(spec.limits.per_arm_generations, 32);
  const max_total_generations = integer(spec.limits.max_total_generations, 1024);
  const batch_timeout_ms = integer(spec.limits.batch_timeout_ms, 600000);
  if (batch_timeout_ms < 1000) bad();
  const pair_count = model_ids.length * task_ids.length * trajectory_ids.length * repetitions;
  const allocated_generations = pair_count * 2 * per_arm_generations;
  if (pair_count > 64 || allocated_generations > max_total_generations) throw Error('evidence_batch_budget_exceeded');
  const normalized = {schema_version: 1, model_ids, task_ids, trajectory_ids, repetitions, seed, guidance_variant,
    limits: {per_arm_generations, max_total_generations, batch_timeout_ms}};
  const plan_id = digest(canonical({schema_version: 1, source_commit: sourceCommit, spec: normalized}));
  const cells = [];
  for (const model_id of model_ids) for (const task_id of task_ids) for (const trajectory_id of trajectory_ids) for (let repetition = 1; repetition <= repetitions; repetition++) {
    const row = {model_id, task_id, trajectory_id, repetition};
    cells.push({id: 'pair-' + digest(canonical({...row, guidance_variant})), ...row});
  }
  // Seeded hash ordering avoids engine-dependent PRNG/shuffle behavior.
  cells.sort((a, b) => {
    const left = digest(seed + '\0' + a.id), right = digest(seed + '\0' + b.id);
    return left < right ? -1 : left > right ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return freeze({schema_version: 1, plan_id, source_commit: sourceCommit, spec: normalized, cells,
    limits: {per_arm_generations, max_total_generations, batch_timeout_ms, pair_count, allocated_generations},
    labels: {synthetic: true, policy_source: 'synthetic_conformance_fixture', human_state: 'not_measured', calibration: 'not_assessed', human_benefit: 'not_measured', model_compliance: 'not_established', execution: 'not_started',
      guidance_variant, experimental: guidance_variant === 'contextual-v2', quality_status: guidance_variant === 'contextual-v2' ? 'quality_failed_not_promoted' : 'fixture_conformance_only'}});
}
