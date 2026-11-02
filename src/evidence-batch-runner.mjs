// Finite headless orchestration. Simulations never become real-model evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {compileEvidenceBatch} from './evidence-batch-plan.mjs';
import {createEvidencePolicySource} from './evidence-policy-trajectories.mjs';

const ARMS = ['without', 'with'];
const METRICS = ['model_calls', 'input_tokens', 'output_tokens', 'cache_read_tokens'];
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const completeMetric = (record, arm, metric) => numeric(record.arms?.[arm]?.usage?.[metric]) && record.arms[arm].usage.status === 'observed' && record.arms[arm].usage.coverage === 'observed';
const reason = (error, fallback) => /^[a-z0-9_]{1,100}$/.test(error?.message ?? '') ? error.message : fallback;
const median = values => {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};

export async function writeEvidenceJson(file, value) {
  const body = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw Error('evidence_record_capacity');
  const temporary = path.join(path.dirname(file), '.' + randomUUID());
  try {
    await fs.writeFile(temporary, body, {mode: 0o600, flag: 'wx'});
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, {force: true});
  }
}

// Descriptive text features, not a correctness/adaptation score.
export function describeEvidenceAnswer(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let fence = null, code_blocks = 0, bullets = 0, headings = 0;
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { if (!fence) { fence = marker[0]; code_blocks++; } else if (marker[0] === fence) fence = null; continue; }
    if (fence) continue;
    if (/^ {0,3}#{1,6}\s+\S/.test(line)) headings++;
    if (/^\s*(?:[-*+] |\d+[.)] )\S/.test(line)) bullets++;
  }
  return {words: text.trim().split(/\s+/u).length, bullets, headings, code_blocks, interpretation: 'descriptive_only'};
}

export function describeEvidenceTrajectoryRequests(trajectoryId, turns) {
  const target = trajectoryId === 'steady' ? ['standard'] : trajectoryId === 'change-during-work' ? ['full', 'terse'] : trajectoryId === 'fallback-return' ? ['full', 'terse', 'fallback', 'full'] : [];
  const sequence = [];
  let requests = 0, unknown = 0;
  for (const turn of turns) for (const row of turn.delivery?.with?.request_attribution ?? []) {
    requests++;
    const control = row.controls;
    const extent = control?.response_extent;
    const expected = extent === 'terse' ? {unsolicited_update: 'defer', conversation_style: 'self_contained'}
      : {unsolicited_update: 'send', conversation_style: 'conversational'};
    const matches = ['standard', 'full', 'terse'].includes(extent)
      && control.unsolicited_update === expected.unsolicited_update && control.conversation_style === expected.conversation_style;
    const value = row.status === 'fallback_observed' && control == null ? 'fallback'
      : row.status === 'guidance_observed' && matches ? extent : null;
    if (!value) { unknown++; continue; }
    if (sequence.at(-1) !== value) sequence.push(value);
  }
  return {requests_observed: requests, unclassified_requests: unknown, observed_sequence: sequence, target_sequence: target,
    status: !unknown && target.length > 0 && sequence.length === target.length && target.every((value, index) => sequence[index] === value) ? 'observed' : 'partial_or_unverified',
    scope: 'attributed_request_policy_not_model_compliance'};
}

export function summarizeEvidenceBatch(records, {execution, plannedPairs}) {
  // Costs include failed/partial native cells. Paired comparisons require both
  // observed model identities; missing evidence is never turned into zero usage.
  const native = records.filter(record => record.execution === 'native' && record.status !== 'not_started');
  const paired = native.filter(record => ARMS.every(arm => {
    const evidence = record.arms?.[arm];
    return evidence?.model?.status === 'observed' && evidence.model.observed_models?.length === 1
      && evidence.model.observed_models[0] === record.model_id && evidence.usage?.model_calls > 0;
  }));
  const resources = Object.fromEntries(ARMS.map(arm => [arm, Object.fromEntries(METRICS.map(metric => {
    const values = native.map(record => record.arms?.[arm]?.usage?.[metric]);
    const complete = native.filter(record => completeMetric(record, arm, metric)).length;
    const known = values.filter(numeric).length, missing = values.length - known;
    return [metric, {
      observed_total: values.filter(numeric).reduce((sum, value) => sum + value, 0),
      known_pairs: known, unknown_pairs: missing, complete_pairs: complete,
      partial_or_unconfirmed_pairs: known - complete,
      has_unknown_remainder: missing > 0 || known > complete,
    }];
  }))]));
  const deltas = Object.fromEntries(METRICS.map(metric => {
    const values = paired.filter(record => ARMS.every(arm => completeMetric(record, arm, metric)))
      .map(record => record.arms.with.usage[metric] - record.arms.without.usage[metric]);
    return [metric, {pairs: values.length, median_with_minus_without: median(values), excluded_incomplete_coverage_pairs: paired.length - values.length, scope: 'explicit_complete_observed_resource_coverage'}];
  }));
  const workflows=native.filter(r=>r.workflow?.schema_version===1),validCheck=r=>r?.current===true&&['passed','failed'].includes(r.status)&&r.summary?.state===r.status;
  const initial=workflows.flatMap(r=>ARMS.map(a=>r.workflow.initial_checks?.[a])),final=workflows.flatMap(r=>ARMS.map(a=>r.workflow.final_checks?.[a]));
  const workflowResults={status:workflows.length?'observed':'not_observed',pairs:workflows.length,
    arms_with_initial_check:initial.filter(validCheck).length,initial_check_passed_arms:initial.filter(r=>validCheck(r)&&r.status==='passed').length,
    repair_turns_started:workflows.reduce((n,r)=>n+ARMS.filter(a=>r.workflow.repair_dispatch?.[a]==='started').length,0),
    repair_dispatch_unknown:workflows.reduce((n,r)=>n+ARMS.filter(a=>r.workflow.repair_dispatch?.[a]==='unknown').length,0),
    arms_with_final_check:final.filter(validCheck).length,
    final_checked_passed_arms:workflows.filter(r=>r.cleanup_confirmed===true&&r.workflow.stage==='finished').reduce((n,r)=>n+ARMS.filter(a=>validCheck(r.workflow.final_checks?.[a])&&r.workflow.final_checks[a].status==='passed').length,0),
    failed_after_recheck_arms:workflows.reduce((n,r)=>n+ARMS.filter(a=>validCheck(r.workflow.rechecks?.[a])&&r.workflow.rechecks[a].status==='failed').length,0),
    incomplete_pairs:workflows.filter(r=>r.workflow.status==='incomplete').length,
    scope:'executed_code_checks_only; answer review and human benefit separate'};
  return {
    schema_version: 1, execution, planned_pairs: plannedPairs, recorded_pairs: records.length,
    real_model_pairs_observed: paired.length,
    completed_real_model_pairs: paired.filter(record => record.status === 'completed').length,
    simulated_pairs: records.filter(record => record.execution === 'simulation').length,
    status_counts: Object.fromEntries([...new Set(records.map(record => record.status))].sort()
      .map(status => [status, records.filter(record => record.status === status).length])),
    code_checks_passed_both: paired.filter(record => record.status === 'completed' && ARMS.every(arm => {
      const check = record.code_checks?.arms?.[arm]?.latest;
      return check?.current === true && check.status === 'passed' && check.summary?.state === 'passed';
    })).length,
    answer_quality: 'unreviewed', human_benefit: 'not_measured', policy_source: 'synthetic_conformance_fixture',
    resources, paired_resource_deltas: deltas, resource_scope: 'all_started_native_cells_including_failures',
    failed_and_incomplete_retained: true, evaluator_calls: 0, op_calls: 0, cost_usd: null,
    workflow_results:workflowResults,
  };
}

export function evidenceBatchMarkdown(summary) {
  return ['# Evidence batch', '',
    `Execution: ${summary.execution}. Real-model paired samples observed: ${summary.real_model_pairs_observed}; completed: ${summary.completed_real_model_pairs}; simulated: ${summary.simulated_pairs}.`,
    `Recorded ${summary.recorded_pairs} of ${summary.planned_pairs} planned pairs.`, '',
    'Policy trajectories are declared synthetic fixtures. Human benefit is not measured. Answer correctness needs separate review; passing code checks does not establish it.', '',
    '| Status | Pairs |', '|---|---:|', ...Object.entries(summary.status_counts).map(([status, count]) => `| ${status} | ${count} |`), '',
    ...(summary.workflow_results?.status==='observed'?[`Workflow: ${summary.workflow_results.initial_check_passed_arms} arms passed their initial check; ${summary.workflow_results.repair_turns_started} repair turns started; ${summary.workflow_results.final_checked_passed_arms} final code artifacts passed with confirmed cleanup; ${summary.workflow_results.incomplete_pairs} workflows incomplete. Code checks do not replace answer review.`,'']:[]),
    '| Observed resource (all started native cells) | Without | With |', '|---|---:|---:|',
    ...METRICS.map(metric => `| ${metric} | ${summary.resources.without[metric].observed_total}${summary.resources.without[metric].has_unknown_remainder ? ' + unknown' : ''} | ${summary.resources.with[metric].observed_total}${summary.resources.with[metric].has_unknown_remainder ? ' + unknown' : ''} |`), '',
    'Totals are observed subtotals; unknown remainders stay visible. Paired deltas require explicit complete resource coverage in both arms. Failures and incomplete cells are retained. Sample unit is a fresh pair, not a turn, generation or reading. Paired deltas are descriptive, including failed pairs with both model identities observed. Synthetic policy cases do not validate real OP inference/calibration. No savings or human-benefit claim is automatic.', '',
  ].join('\n');
}

export async function executeEvidenceBatch({plan, outputDirectory, adapter, execution = 'simulation',
  authorizedPlanId = null, preparedManifest = null, signal = null, now = () => performance.now(), cleanupGraceMs = 10000} = {}) {
  if (!['simulation', 'native'].includes(execution) || !path.isAbsolute(outputDirectory ?? '')
    || typeof adapter?.runCell !== 'function' || typeof adapter.close !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(cleanupGraceMs) || cleanupGraceMs < 1 || cleanupGraceMs > 10000) throw Error('evidence_batch_configuration_invalid');
  const rebuilt = compileEvidenceBatch(plan.spec, {sourceCommit: plan.source_commit});
  if (JSON.stringify(rebuilt) !== JSON.stringify(plan)) throw Error('evidence_batch_plan_changed');
  if (execution === 'native' && authorizedPlanId !== plan.plan_id) throw Error('evidence_batch_not_authorized');
  const parent = await fs.realpath(path.dirname(outputDirectory));
  if (parent !== path.dirname(outputDirectory)) throw Error('evidence_output_parent_not_canonical');
  await fs.mkdir(outputDirectory, {mode: 0o700}); // Refuse reuse/resume, including partial output.

  const batchId = randomUUID(), records = [], abort = new AbortController(), started = now();
  let stopped = null, cleanup = true, closePromise;
  const settleWithin = async promise => {
    let timer;
    try {
      return await Promise.race([promise.then(value => ({settled: true, value}), error => ({settled: true, error})),
        new Promise(resolve => { timer = setTimeout(() => resolve({settled: false}), cleanupGraceMs); })]);
    } finally { clearTimeout(timer); }
  };
  const close = () => closePromise ??= (async () => {
    const result = await settleWithin(Promise.resolve().then(() => adapter.close()));
    if (!result.settled || result.error || result.value?.cleanup_confirmed === false) cleanup = false;
  })();
  const cancel = () => { stopped ??= 'cancelled'; abort.abort(); };
  signal?.addEventListener('abort', cancel, {once: true});
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => { stopped ??= 'batch_deadline'; abort.abort(); }, plan.limits.batch_timeout_ms);
  const context = {plan, outputDirectory, signal: abort.signal, started_monotonic_ms: started,
    remainingMs: () => Math.max(0, plan.limits.batch_timeout_ms - (now() - started))};
  // A noncooperative operation cannot hold orchestration indefinitely. Owned
  // processes are closed immediately on abort; unresolved work marks cleanup unsafe.
  const operation = async action => {
    if (abort.signal.aborted) throw Error(stopped ?? 'cancelled');
    const pending = Promise.resolve().then(action);
    let listener;
    const interrupted = new Promise(resolve => {
      listener = () => resolve({interrupted: true});
      abort.signal.addEventListener('abort', listener, {once: true});
    });
    try {
      const result = await Promise.race([pending.then(value => ({value}), error => ({error})), interrupted]);
      if (!result.interrupted) { if (result.error) throw result.error; return result.value; }
      const [tail] = await Promise.all([settleWithin(pending), close()]);
      if (!tail.settled) cleanup = false;
      if (tail.settled && !tail.error) return tail.value;
      throw Error(stopped ?? 'cancelled');
    } finally { abort.signal.removeEventListener('abort', listener); }
  };
  try {
    await writeEvidenceJson(path.join(outputDirectory, 'manifest.json'), {schema_version: 1, batch_id: batchId, plan, execution,
      started_at: new Date().toISOString(), authority: execution === 'native' ? 'caller_approved_prepared_manifest' : 'offline_simulation_only'});
    if (preparedManifest) await writeEvidenceJson(path.join(outputDirectory, 'prepared-manifest.json'), preparedManifest);
    await operation(() => adapter.prepare?.(context));
    for (const cell of plan.cells) {
      if (context.remainingMs() <= 0) { stopped ??= 'batch_deadline'; abort.abort(); }
      if (abort.signal.aborted || stopped) {
        records.push({...cell, execution, status: 'not_started', reason: stopped ?? 'cancelled', arms: null});
        continue;
      }
      const directory = path.join(outputDirectory, cell.id);
      await fs.mkdir(directory, {mode: 0o700});
      await writeEvidenceJson(path.join(directory, 'started.json'), {batch_id: batchId, cell, execution, at: new Date().toISOString()});
      let result;
      try {
        result = await operation(() => adapter.runCell(cell, {...context, directory}));
        if (!result || !['completed', 'simulated', 'blocked', 'failed', 'interrupted', 'partial'].includes(result.status)) throw Error('invalid_cell_result');
        if (abort.signal.aborted && result.status === 'completed') result = {...result, status: 'interrupted', reason: stopped};
      } catch (error) {
        result = {status: abort.signal.aborted ? 'interrupted' : 'failed', reason: reason(error, 'cell_execution_failed'), arms: null, cleanup_confirmed: false};
      }
      records.push({...result, ...cell, execution, batch_id: batchId});
      await writeEvidenceJson(path.join(directory, 'result.json'), records.at(-1));
      if (result.cleanup_confirmed === false) { cleanup = false; stopped ??= 'cleanup_unconfirmed'; abort.abort(); }
      if (result.status === 'blocked') { stopped ??= result.reason ?? 'human_decision_required'; abort.abort(); }
      await writeEvidenceJson(path.join(outputDirectory, 'progress.json'), summarizeEvidenceBatch(records, {execution, plannedPairs: plan.cells.length}));
    }
  } catch (error) {
    stopped ??= reason(error, 'batch_preparation_failed');
    for (const cell of plan.cells.slice(records.length)) records.push({...cell, execution, status: 'not_started', reason: stopped, arms: null});
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    await close();
  }
  const summary = {...summarizeEvidenceBatch(records, {execution, plannedPairs: plan.cells.length}), batch_id: batchId,
    plan_id: plan.plan_id, stop_reason: stopped, cleanup_confirmed: cleanup, elapsed_ms: Math.max(0, now() - started)};
  await writeEvidenceJson(path.join(outputDirectory, 'results.json'), {schema_version: 1, batch_id: batchId, plan_id: plan.plan_id, records: records.map(({arms, ...record}) => ({...record, arms: arms ? Object.fromEntries(ARMS.map(arm => [arm, arms[arm] ? {model: arms[arm].model, usage: arms[arm].usage} : null])) : null})), summary});
  await writeEvidenceJson(path.join(outputDirectory, 'summary.json'), summary);
  await fs.writeFile(path.join(outputDirectory, 'REPORT.md'), evidenceBatchMarkdown(summary), {mode: 0o600, flag: 'wx'});
  return summary;
}

export function simulatedEvidenceAdapter() {
  return {
    async runCell(cell, context) {
      const source = createEvidencePolicySource({trajectoryId: cell.trajectory_id, scopeId: cell.id, guidanceVariant: context?.plan?.spec.guidance_variant ?? 'op-fixture'});
      for (let index = 0; index < 6; index++) { const selected = source.selectForRequest(); source.recordSelection('hook', selected); }
      return {status: 'simulated', arms: null, code_checks: null, trajectory: source.snapshot(), provider_calls: 0,
        cleanup_confirmed: true, answer_quality: 'not_assessed', synthetic_output: true, native_bridge_exercised: false};
    },
    async close() {},
  };
}
