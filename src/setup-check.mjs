// setup-check.mjs — read-only preflight checks (BUILD-04).
//
// Complete preflight is read-only metadata/source-pin/interface/tool
// validation. It never imports production readers (runtime-reader),
// never probes auth/state/provider/collector, never clones, downloads,
// installs or starts the runtime. Offline mode requires Node only and
// makes no external calls at all.
//
// All I/O goes through the injectable `io` seam so tests use fake
// clients instead of live git/filesystem/processes.

import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isPlaceholder, validateSetupConfigObject} from './setup-config.mjs';
import {runGit} from './git-ops.mjs';

const execute = promisify(execFile);

export const SETUP_CHECK_VERSION = 1;

function check(name, ok, detail = '') {
  return {name, ok, detail: String(detail).slice(0, 500)};
}

export function satisfiesNodeRequirement(version, required = '>=22.12.0 <23.0.0') {
  // Minimal parser for the documented ">=22.12.0 <23.0.0" range.
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ''));
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]), patch = Number(match[3]);
  void required;
  if (major !== 22) return false;
  if (minor < 12) return false;
  if (minor === 12 && patch < 0) return false;
  return true;
}

export function satisfiesPythonRequirement(versionOutput, majorMin = 3, minorMin = 11) {
  const match = /Python\s+(\d+)\.(\d+)\.(\d+)/.exec(String(versionOutput ?? ''));
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  if (major !== majorMin) return major > majorMin;
  return minor >= minorMin;
}

function defaultIo() {
  return {
    nodeVersion: process.version,
    execGit: (args, cwd) => runGit(args, cwd, {timeout: 10000}),
    execTool: (binary, args) => execute(binary, args, {timeout: 10000}).then(r => r.stdout + r.stderr),
    lstat: async target => {
      const fs = await import('node:fs/promises');
      return fs.lstat(target);
    },
    realpath: async target => {
      const fs = await import('node:fs/promises');
      return fs.realpath(target);
    },
    accessExec: async target => {
      const fs = await import('node:fs/promises');
      const fssync = await import('node:fs');
      try {
        await fs.access(target, fssync.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    readFile: async target => {
      const fs = await import('node:fs/promises');
      return fs.readFile(target, 'utf8');
    },
    existsFile: async target => {
      const fs = await import('node:fs/promises');
      try {
        const st = await fs.lstat(target);
        return st.isFile() && !st.isSymbolicLink();
      } catch {
        return false;
      }
    },
  };
}

export async function runSetupCheck({mode = 'complete', config = {}, requirements = {}, io = null} = {}) {
  const runner = io ?? defaultIo();
  const checks = [];
  if (!['offline', 'complete'].includes(mode)) {
    return {mode, ok: false, checks: [check('mode', false, 'unknown mode')]};
  }
  // Offline: Node only, no external calls.
  const nodeOk = satisfiesNodeRequirement(runner.nodeVersion ?? process.version);
  checks.push(check('node', nodeOk, nodeOk ? String(runner.nodeVersion ?? process.version) : `requires >=22.12.0 <23.0.0, saw ${String(runner.nodeVersion ?? process.version)}`));
  if (mode === 'offline') {
    return {mode, ok: checks.every(c => c.ok), checks};
  }
  // Complete: strict config validation first (no probing of placeholders).
  // Environment-supplied paths are validated here too: control characters
  // or NUL bytes refuse before any filesystem or process probe.
  try {
    const raw = {};
    if (config.agentLabRoot) raw.agent_lab_root = config.agentLabRoot;
    if (config.presenceRuntimeRoot) raw.presence_runtime_root = config.presenceRuntimeRoot;
    if (config.labPython) raw.lab_python = config.labPython;
    if (config.labMuse) raw.lab_muse = config.labMuse;
    if (config.rawObject) validateSetupConfigObject(config.rawObject);
    for (const value of Object.values(raw)) {
      if (value.includes('\0') || /[\x00-\x1f\x7f]/.test(value)) throw Error('setup_config_invalid');
    }
  } catch (error) {
    checks.push(check('config', false, error.message));
    return {mode, ok: false, checks};
  }
  // One canonical exact-pin manifest: components.json is canonical. When the
  // caller supplies its pins, requirements/components drift refuses here.
  if (requirements.canonicalPins && typeof requirements.canonicalPins === 'object') {
    const seen = new Map((requirements.components ?? []).map(c => [c.name, c.pin]));
    for (const [name, pin] of Object.entries(requirements.canonicalPins)) {
      if (seen.has(name) && seen.get(name) !== pin) {
        checks.push(check('pin_drift', false, `requirements pin for ${name} differs from canonical components.json`));
        return {mode, ok: false, checks};
      }
    }
    checks.push(check('pin_drift', true, 'requirements match canonical components.json'));
  }
  const labRoot = config.agentLabRoot ?? null;
  const runtimeRoot = config.presenceRuntimeRoot ?? null;
  const labPython = config.labPython ?? null;
  const labMuse = config.labMuse ?? null;
  const missing = [];
  if (!labRoot || isPlaceholder(labRoot)) missing.push('agent_lab_root');
  if (!runtimeRoot || isPlaceholder(runtimeRoot)) missing.push('presence_runtime_root');
  if (!labPython || isPlaceholder(labPython)) missing.push('lab_python');
  if (!labMuse || isPlaceholder(labMuse)) missing.push('lab_muse');
  if (missing.length) {
    checks.push(check('config', false, `explicit configuration required: ${missing.join(', ')}. See setup.example.json; no implicit sibling-Lab default.`));
    return {mode, ok: false, checks};
  }
  checks.push(check('config', true, 'explicit paths configured'));
  // Symlink refusal for configured roots AND their ancestors: a linked
  // root or a linked ancestor directory would steer every later read.
  async function assertRealDir(name, target) {
    const leaf = await runner.lstat(target).catch(() => null);
    if (!leaf || leaf.isSymbolicLink() || !leaf.isDirectory()) return false;
    let cursor = path.dirname(path.resolve(target));
    for (;;) {
      const st = await runner.lstat(cursor).catch(() => null);
      if (!st || st.isSymbolicLink() || !st.isDirectory()) return false;
      const next = path.dirname(cursor);
      if (next === cursor) break;
      cursor = next;
    }
    return true;
  }
  for (const [name, target] of [['agent_lab_root', labRoot], ['presence_runtime_root', runtimeRoot]]) {
    if (!await assertRealDir(name, target)) {
      checks.push(check(name + '_link', false, 'component root missing, symlinked, or under a symlinked ancestor'));
      return {mode, ok: false, checks};
    }
  }
  // Pins + cleanliness (read-only git).
  const pins = requirements.components ?? [];
  const pinFor = name => pins.find(c => c.name === name);
  try {
    for (const [name, rootDir, allowDocs] of [[ 'agent-lab', labRoot, [] ], [ 'presence-runtime', runtimeRoot, ['docs/WORKSTATE.md'] ]]) {
      void name;
      const expected = pinFor(name === 'agent-lab' ? 'agent-lab' : 'presence-runtime')?.pin;
      if (!expected || !/^[0-9a-f]{40}$/.test(expected)) {
        checks.push(check(name + '_pin', false, 'requirements pin missing'));
        return {mode, ok: false, checks};
      }
      let head;
      try {
        head = String(await runner.execGit(['rev-parse', 'HEAD'], rootDir)).trim();
      } catch {
        checks.push(check(name + '_pin', false, 'cannot read component HEAD (read-only git failed)'));
        return {mode, ok: false, checks};
      }
      if (head !== expected) {
        checks.push(check(name + '_pin', false, `pin mismatch: expected ${expected.slice(0, 12)}…, saw ${head.slice(0, 12)}…`));
        return {mode, ok: false, checks};
      }
      checks.push(check(name + '_pin', true, `HEAD ${expected.slice(0, 12)}…`));
      let status;
      try {
        status = String(await runner.execGit(['status', '--porcelain', '--untracked-files=all'], rootDir)).trim();
      } catch {
        checks.push(check(name + '_clean', false, 'cannot read component status'));
        return {mode, ok: false, checks};
      }
      const lines = status.split('\n').filter(Boolean);
      // Runtime owner documentation-only allowance; Lab must be fully clean.
      const bad = lines.filter(line => {
        const trimmed = line.trim();
        if (!allowDocs.length) return true;
        return trimmed !== 'M docs/WORKSTATE.md';
      });
      if (bad.length) {
        checks.push(check(name + '_clean', false, `component source changed: ${bad[0].slice(0, 120)}`));
        return {mode, ok: false, checks};
      }
      checks.push(check(name + '_clean', true, allowDocs.length ? 'clean except allowed docs/WORKSTATE.md' : 'clean'));
    }
  } catch (error) {
    checks.push(check('components', false, error.message));
    return {mode, ok: false, checks};
  }
  // Interface files (existence only; never executed, never read as production).
  const labInterfaces = pinFor('agent-lab')?.interfaces ?? [];
  for (const rel of labInterfaces) {
    const target = path.join(labRoot, rel);
    const ok = await runner.existsFile(target).catch(() => false);
    checks.push(check('interface:agent-lab/' + rel, !!ok, ok ? 'present' : 'missing required interface file'));
    if (!ok) return {mode, ok: false, checks};
  }
  for (const rel of (pinFor('presence-runtime')?.interfaces ?? [])) {
    const target = path.join(runtimeRoot, rel);
    let ok = false;
    try {
      const executable = rel === '.venv/bin/python' || rel === 'presence-pa';
      const real = executable ? await runner.realpath(target) : target;
      const st = await runner.lstat(real);
      ok = st.isFile() && !st.isSymbolicLink();
      if (ok && executable && typeof runner.accessExec === 'function') ok = await runner.accessExec(real);
    } catch { ok = false; }
    checks.push(check('interface:presence-runtime/' + rel, ok, ok ? 'present' : 'missing required runtime entry'));
    if (!ok) return {mode, ok: false, checks};
  }
  // Tool validation: canonically resolve explicit paths and verify the
  // final target is an executable regular file. Normal explicit tool links
  // (including .venv/bin/python symlinks) are permitted: the chain is
  // resolved and the ultimate target is checked. Directories, missing
  // paths and nonexecutable files refuse. Bare names are PATH-resolved at
  // launch, so they are validated by executing `<name> --version`.
  async function resolveExecutableTarget(binary) {
    if (!path.isAbsolute(binary)) return {bare: true};
    const leaf = await runner.lstat(binary).catch(() => null);
    if (!leaf) return {ok: false, detail: 'tool path missing'};
    if (leaf.isDirectory()) return {ok: false, detail: 'tool path is a directory, not an executable file'};
    let real = binary;
    try {
      real = await runner.realpath(binary);
    } catch {
      return {ok: false, detail: 'tool path cannot be resolved'};
    }
    const target = await runner.lstat(real).catch(() => null);
    if (!target || target.isSymbolicLink() || !target.isFile()) return {ok: false, detail: 'tool target is not a regular file'};
    const executable = typeof runner.accessExec === 'function'
      ? await runner.accessExec(real).catch(() => false)
      : (typeof target.mode === 'number' ? (target.mode & 0o111) !== 0 : true);
    if (!executable) return {ok: false, detail: 'tool target is not executable'};
    return {ok: true, resolved: real};
  }
  try {
    const resolved = await resolveExecutableTarget(labPython);
    if (resolved.bare) {
      const pythonOut = String(await runner.execTool(labPython, ['--version']));
      const pyOk = satisfiesPythonRequirement(pythonOut);
      checks.push(check('python', pyOk, pyOk ? pythonOut.trim().slice(0, 80) : `requires Python >=3.11, saw ${pythonOut.trim().slice(0, 80)}`));
      if (!pyOk) return {mode, ok: false, checks};
    } else {
      if (!resolved.ok) {
        checks.push(check('python', false, resolved.detail));
        return {mode, ok: false, checks};
      }
      const pythonOut = String(await runner.execTool(labPython, ['--version']));
      const pyOk = satisfiesPythonRequirement(pythonOut);
      checks.push(check('python', pyOk, pyOk ? pythonOut.trim().slice(0, 80) : `requires Python >=3.11, saw ${pythonOut.trim().slice(0, 80)}`));
      if (!pyOk) return {mode, ok: false, checks};
    }
  } catch {
    checks.push(check('python', false, 'python tool unavailable'));
    return {mode, ok: false, checks};
  }
  try {
    const resolved = await resolveExecutableTarget(labMuse);
    if (resolved.bare) {
      // Bare tool names resolve via PATH at launch; a missing tool fails here.
      await runner.execTool(labMuse, ['--version']);
      checks.push(check('muse_tool', true, 'bare tool name resolves via PATH'));
    } else {
      if (!resolved.ok) {
        checks.push(check('muse_tool', false, resolved.detail));
        return {mode, ok: false, checks};
      }
      checks.push(check('muse_tool', true, 'explicit executable target verified'));
    }
  } catch {
    checks.push(check('muse_tool', false, 'muse tool unavailable'));
    return {mode, ok: false, checks};
  }
  // Honest environment notes (informational; never a fake success claim).
  checks.push(check('platform', true, `${process.platform}/${process.arch} (macOS sandbox qualification is a separate coordinator release check)`));
  checks.push(check('distribution', true, 'component pins are local checkouts; a pin alone is not a fresh-clone installable release and judge access remains open'));
  return {mode, ok: checks.every(c => c.ok), checks};
}
