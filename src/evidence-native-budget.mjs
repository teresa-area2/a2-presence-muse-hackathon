// Host-side admission guard. Authentication never enters installer metadata.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {terminalEnvironment} from './terminal-env.mjs';
export const EVIDENCE_BUDGET_CAPABILITY = 'plugin:area2-harness-budget:hook:pre-llm';

function unusedState(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 16384) throw Error('evidence_guard_unsafe');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.schema_version !== 1 || data.generations_reserved !== 0 || data.blocked !== 0 || data.started_monotonic !== null) throw Error('evidence_guard_already_used');
  return data;
}

export function prepareEvidenceNativeBudget({directory, workspace, binary, python, budgetScript, environment,
  maxGenerations, seconds, anchor = null, execute = execFileSync}) {
  if (![directory, workspace, binary, python, budgetScript].every(value => typeof value === 'string' && path.isAbsolute(value))
    || !Number.isSafeInteger(maxGenerations) || maxGenerations < 1 || maxGenerations > 32
    || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 600
    || anchor !== null && (!Number.isFinite(anchor) || anchor < 0)) throw Error('evidence_budget_invalid');
  const canonical = fs.realpathSync(workspace);
  if (canonical !== workspace || directory === workspace || directory.startsWith(workspace + path.sep)) throw Error('evidence_guard_in_workspace');
  fs.mkdirSync(directory, {mode: 0o700});
  const metadata = path.join(directory, 'metadata');
  fs.mkdirSync(metadata, {mode: 0o700});
  fs.mkdirSync(path.join(metadata, 'muse'), {mode: 0o700});
  fs.writeFileSync(path.join(metadata, 'muse/settings.json'), JSON.stringify({schema_version: 1}), {mode: 0o600, flag: 'wx'});
  const state = path.join(directory, 'state.json'), approval = path.join(directory, 'approval');
  const result = JSON.parse(execute(python, ['-B', budgetScript, 'prepare', '--workspace', workspace, '--state', state,
    '--max-generations', String(maxGenerations), '--seconds', String(seconds), '--muse', binary, '--approval-config', approval],
  {cwd: workspace, env: {...terminalEnvironment(environment), XDG_CONFIG_HOME: metadata}, timeout: 30000, maxBuffer: 65536, stdio: 'pipe'}).toString());
  if (result.capability_id !== EVIDENCE_BUDGET_CAPABILITY || result.capability?.enabled !== true
    || !/^sha256:[a-f0-9]{64}$/.test(result.capability?.trusted_definition_hash ?? '')) throw Error('evidence_budget_unqualified');
  const data = unusedState(state);
  if (data.workspace !== workspace || data.max_generations !== maxGenerations || data.seconds !== seconds) throw Error('evidence_guard_mismatch');
  if (anchor !== null) anchorEvidenceNativeBudget(state, anchor);
  return {state, capability: result.capability};
}

export function anchorEvidenceNativeBudget(file, anchor) {
  if (!Number.isFinite(anchor) || anchor < 0) throw Error('evidence_clock_invalid');
  const data = unusedState(file);
  data.started_monotonic = anchor;
  fs.writeFileSync(file, JSON.stringify(data) + '\n', {mode: 0o600});
}
