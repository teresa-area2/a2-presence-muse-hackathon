// setup-config.mjs — unified machine-neutral setup path resolution (BUILD-04).
//
// Single owner of local path rules for both the server (src/components.mjs)
// and the read-only checker (scripts/check-setup.mjs). There is no implicit
// sibling-Lab default: every component/tool path must come from explicit
// configuration (JSON file and/or environment overrides) and is validated
// by the checker before use.
//
// Precedence: explicit configPath argument, then A2_SETUP_CONFIG, then
// <repo>/setup.json when present (machine-private, git-ignored). Environment
// overrides win over file values:
//   A2_AGENT_LAB_ROOT overrides agent_lab_root
//   A2_OPEN_PRESENCE_LOCAL overrides presence_runtime_root
//   A2_LAB_PYTHON overrides lab_python
//   A2_LAB_MUSE overrides lab_muse
// Unknown keys are rejected. Placeholder values from setup.example.json
// (/path/to/...) are reported as placeholders, never probed.

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SETUP_CONFIG_ALLOWED_KEYS = Object.freeze([
  'agent_lab_root',
  'presence_runtime_root',
  'lab_python',
  'lab_muse',
]);

export const SETUP_CONFIG_ENV_MAP = Object.freeze({
  agent_lab_root: 'A2_AGENT_LAB_ROOT',
  presence_runtime_root: 'A2_OPEN_PRESENCE_LOCAL',
  lab_python: 'A2_LAB_PYTHON',
  lab_muse: 'A2_LAB_MUSE',
});

const PLACEHOLDER_PREFIX = '/path/to/';

export function isPlaceholder(value) {
  return typeof value === 'string' && (value === '/path/to' || value.startsWith(PLACEHOLDER_PREFIX));
}

export function validateSetupConfigObject(object) {
  if (!object || Array.isArray(object) || typeof object !== 'object') throw Error('setup_config_invalid');
  for (const key of Object.keys(object)) {
    if (!SETUP_CONFIG_ALLOWED_KEYS.includes(key)) throw Error('setup_config_unknown_key');
  }
  for (const key of SETUP_CONFIG_ALLOWED_KEYS) {
    const value = object[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) throw Error('setup_config_invalid');
    if (value.includes('\0') || /[\x00-\x1f\x7f]/.test(value)) throw Error('setup_config_invalid');
  }
  return object;
}

async function assertSafeConfigPath(resolvedPath, {explicit}) {
  // The configured leaf must be a real file, never a symlink, and no
  // ancestor directory may be a symlink that steers the read elsewhere.
  // An explicitly selected path refuses; the ignored default setup.json is
  // silently skipped instead so absence stays equivalent to no file.
  const leaf = await fs.lstat(resolvedPath).catch(() => null);
  if (!leaf) {
    if (explicit) throw Error('setup_config_missing');
    return false;
  }
  // A symlinked leaf, or a symlinked immediate parent, would steer the read
  // outside the intended tree: refuse before reading. Higher system
  // ancestors (macOS /var and /tmp links) are resolved to their real
  // locations and every resolved ancestor must be a real directory.
  if (leaf.isSymbolicLink() || !leaf.isFile()) {
    if (explicit) throw Error('setup_config_symlink_refused');
    return false;
  }
  const parent = path.dirname(resolvedPath);
  const parentStat = await fs.lstat(parent).catch(() => null);
  if (!parentStat) {
    if (explicit) throw Error('setup_config_missing');
    return false;
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    if (explicit) throw Error('setup_config_symlink_refused');
    return false;
  }
  let cursor = parent;
  for (;;) {
    let real;
    try {
      real = await fs.realpath(cursor);
    } catch {
      if (explicit) throw Error('setup_config_missing');
      return false;
    }
    const st = await fs.lstat(real).catch(() => null);
    if (!st || st.isSymbolicLink() || !st.isDirectory()) {
      if (explicit) throw Error('setup_config_symlink_refused');
      return false;
    }
    const next = path.dirname(real);
    if (next === real) break;
    cursor = next;
  }
  return true;
}

function validateEnvValue(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.includes('\0') || /[\x00-\x1f\x7f]/.test(value)) throw Error('setup_config_invalid');
  return value;
}

export async function resolveSetupConfig({env = process.env, configPath = null, readFile = fs.readFile} = {}) {
  let fileValues = {};
  let source = 'environment';
  const explicit = configPath ?? env.A2_SETUP_CONFIG ?? null;
  let resolvedPath = explicit;
  if (!resolvedPath) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const candidate = path.join(root, 'setup.json');
    try {
      if (await assertSafeConfigPath(candidate, {explicit: false})) resolvedPath = candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  } else if (readFile === fs.readFile) {
    // Real filesystem reads go through the symlink/ancestor gate. Injected
    // fixture readers bypass the gate (tests assert parsing, not fs links).
    if (!await assertSafeConfigPath(resolvedPath, {explicit: true})) throw Error('setup_config_missing');
  }
  if (resolvedPath) {
    let raw;
    try {
      raw = await readFile(resolvedPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT' && explicit) throw Error('setup_config_missing');
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw Error('setup_config_invalid');
    }
    validateSetupConfigObject(parsed);
    fileValues = parsed;
    source = resolvedPath;
  }
  const pick = key => {
    const envName = SETUP_CONFIG_ENV_MAP[key];
    const fromEnv = validateEnvValue(env[envName]);
    if (fromEnv) return {value: fromEnv, from: 'environment'};
    if (typeof fileValues[key] === 'string' && fileValues[key].trim()) return {value: fileValues[key], from: 'file'};
    return {value: null, from: null};
  };
  const lab = pick('agent_lab_root');
  const runtime = pick('presence_runtime_root');
  const python = pick('lab_python');
  const muse = pick('lab_muse');
  return {
    source,
    agentLabRoot: lab.value,
    presenceRuntimeRoot: runtime.value,
    labPython: python.value,
    labMuse: muse.value,
    origins: {agent_lab_root: lab.from, presence_runtime_root: runtime.from, lab_python: python.from, lab_muse: muse.from},
  };
}

export function describeSetupConfig(config) {
  // Safe for logs: reports presence/placeholder status, never echoes full local paths.
  // origins distinguishes per-key environment overrides from file values.
  const describe = value => {
    if (!value) return 'missing';
    if (isPlaceholder(value)) return 'placeholder';
    return 'configured';
  };
  const origins = config.origins ?? {};
  return {
    source: config.source === 'environment' ? 'environment' : 'file',
    agent_lab_root: describe(config.agentLabRoot),
    presence_runtime_root: describe(config.presenceRuntimeRoot),
    lab_python: describe(config.labPython),
    lab_muse: describe(config.labMuse),
    origins: {
      agent_lab_root: origins.agent_lab_root ?? null,
      presence_runtime_root: origins.presence_runtime_root ?? null,
      lab_python: origins.lab_python ?? null,
      lab_muse: origins.lab_muse ?? null,
    },
  };
}
