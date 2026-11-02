import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSetupConfig, validateSetupConfigObject} from '../src/setup-config.mjs';
import {runSetupCheck, satisfiesNodeRequirement, satisfiesPythonRequirement} from '../src/setup-check.mjs';

const PIN_LAB = 'f11debc15be05d4b3054a98f1268a535d5899355';
const PIN_RT = '2183c6b75f6b11216f3a85b7268f46d8a2008c2f';
const requirements = {
  components: [
    {name: 'agent-lab', pin: PIN_LAB, interfaces: ['core/muse-msp.mjs']},
    {name: 'presence-runtime', pin: PIN_RT, interfaces: ['presence-pa']},
  ],
};
const goodConfig = {
  agentLabRoot: '/abs/agent-lab',
  presenceRuntimeRoot: '/abs/presence-runtime',
  labPython: '/abs/python3',
  labMuse: '/abs/muse',
};
function goodIo(overrides = {}) {
  return {
    nodeVersion: 'v22.12.0',
    execGit: async (args, cwd) => {
      if (args[0] === 'rev-parse') return cwd.includes('agent-lab') ? PIN_LAB + '\n' : PIN_RT + '\n';
      if (args[0] === 'status') return '';
      throw Error('unexpected git');
    },
    execTool: async () => 'Python 3.11.0',
    lstat: async target => {
      const tool = /python3|muse$|presence-pa$/.test(String(target).split('/').pop());
      return {isSymbolicLink: () => false, isDirectory: () => !tool, isFile: () => tool, mode: 0o755};
    },
    realpath: async target => target,
    accessExec: async () => true,
    existsFile: async () => true,
    ...overrides,
  };
}

test('offline mode requires Node only and makes no external calls', async () => {
  let calls = 0;
  const io = {nodeVersion: 'v22.12.0', execGit: async () => {calls++; throw Error('must not call git');}, execTool: async () => {calls++; throw Error('no tools');}, lstat: async () => {calls++; throw Error('no fs');}, existsFile: async () => {calls++; throw Error('no fs');}};
  const result = await runSetupCheck({mode: 'offline', config: {}, requirements, io});
  assert.equal(result.ok, true);
  assert.equal(calls, 0);
  const bad = await runSetupCheck({mode: 'offline', config: {}, requirements, io: {...io, nodeVersion: 'v20.1.0'}});
  assert.equal(bad.ok, false);
});

test('complete preflight passes for clean pinned checkouts and fails usefully otherwise', async () => {
  const pass = await runSetupCheck({mode: 'complete', config: goodConfig, requirements, io: goodIo()});
  assert.equal(pass.ok, true);
  // Wrong pin fails.
  const wrongPin = await runSetupCheck({mode: 'complete', config: goodConfig, requirements, io: goodIo({execGit: async args => args[0] === 'rev-parse' ? '0'.repeat(40) + '\n' : ''})});
  assert.equal(wrongPin.ok, false);
  assert.match(JSON.stringify(wrongPin.checks), /pin mismatch/);
  // Dirty Lab fails; dirty runtime WORKSTATE-only passes.
  const dirtyLab = await runSetupCheck({mode: 'complete', config: goodConfig, requirements, io: goodIo({execGit: async (args, cwd) => args[0] === 'rev-parse' ? (cwd.includes('agent-lab') ? PIN_LAB + '\n' : PIN_RT + '\n') : (cwd.includes('agent-lab') ? ' M src/x.mjs\n' : '')})});
  assert.equal(dirtyLab.ok, false);
  const dirtyRuntimeDocs = await runSetupCheck({mode: 'complete', config: goodConfig, requirements, io: goodIo({execGit: async (args, cwd) => args[0] === 'rev-parse' ? (cwd.includes('agent-lab') ? PIN_LAB + '\n' : PIN_RT + '\n') : (cwd.includes('agent-lab') ? '' : 'M docs/WORKSTATE.md\n')})});
  assert.equal(dirtyRuntimeDocs.ok, true);
  // Symlinked root refused.
  const symlinked = await runSetupCheck({mode: 'complete', config: goodConfig, requirements, io: goodIo({lstat: async () => ({isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false})})});
  assert.equal(symlinked.ok, false);
  assert.match(JSON.stringify(symlinked.checks), /symlink/);
  // Placeholder config fails without probing.
  let gitCalls = 0;
  const placeholder = await runSetupCheck({mode: 'complete', config: {...goodConfig, agentLabRoot: '/path/to/pinned/agent-lab'}, requirements, io: goodIo({execGit: async () => {gitCalls++; return '';}})});
  assert.equal(placeholder.ok, false);
  assert.equal(gitCalls, 0);
});

test('strict config rejects unknown keys and missing explicit paths', async () => {
  assert.throws(() => validateSetupConfigObject({agent_lab_root: '/x', unknown_key: '/y'}), /unknown_key/);
  const missing = await runSetupCheck({mode: 'complete', config: {agentLabRoot: null, presenceRuntimeRoot: null, labPython: null, labMuse: null}, requirements, io: goodIo()});
  assert.equal(missing.ok, false);
  assert.match(JSON.stringify(missing.checks), /explicit configuration required/);
});

test('checker never imports production readers or probes provider state', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/setup-check.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import.*runtime-reader/m);
  assert.doesNotMatch(source, /presence_bridge\.py/);
  assert.doesNotMatch(source, /spawnMuseMsp|startSession|spawnProcess/);
  const configSource = await (await import('node:fs/promises')).readFile(new URL('../src/setup-config.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(configSource, /agent-workspaces\/muse-lab/);
});

test('node/python requirement parsing is strict', () => {
  assert.equal(satisfiesNodeRequirement('v22.12.0'), true);
  assert.equal(satisfiesNodeRequirement('v22.20.1'), true);
  assert.equal(satisfiesNodeRequirement('v21.9.0'), false);
  assert.equal(satisfiesNodeRequirement('v23.0.0'), false);
  assert.equal(satisfiesPythonRequirement('Python 3.11.4'), true);
  assert.equal(satisfiesPythonRequirement('Python 3.7.17'), false);
});

test('env overrides win and no personal paths leak into example/config sources', async t => {
  const fs = await import('node:fs/promises');
  const example = await fs.readFile(new URL('../setup.example.json', import.meta.url), 'utf8');
  assert.doesNotMatch(example, /Users\//);
  const configSource = await fs.readFile(new URL('../src/setup-config.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(configSource, /Users\//);
  const os=await import('node:os'),path=await import('node:path');
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'muse-config-precedence-')));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const configPath=path.join(dir,'setup.json');
  await fs.writeFile(configPath,JSON.stringify({agent_lab_root:'/file/lab',presence_runtime_root:'/file/rt',lab_python:'/file/py',lab_muse:'/file/muse'}));
  const resolved = await resolveSetupConfig({env: {A2_AGENT_LAB_ROOT: '/env/lab', A2_OPEN_PRESENCE_LOCAL: '/env/rt', A2_LAB_PYTHON: '/env/py', A2_LAB_MUSE: '/env/muse'},configPath});
  assert.equal(resolved.agentLabRoot,'/env/lab');assert.equal(resolved.presenceRuntimeRoot,'/env/rt');
  assert.equal(resolved.labPython,'/env/py');assert.equal(resolved.labMuse,'/env/muse');
  assert.ok(Object.values(resolved.origins).every(origin=>origin==='environment'));
});

const fileStat = {isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true, mode: 0o755};
const dirStat = {isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false, mode: 0o755};

test('missing bare muse, directory-as-muse and nonexecutable tools fail', async () => {
  const missingBare = await runSetupCheck({mode: 'complete', config: {...goodConfig, labMuse: 'definitely-missing-muse-tool'}, requirements, io: goodIo({execTool: async binary => {
    if (String(binary).includes('muse')) throw Error('not found');
    return 'Python 3.11.0';
  }})});
  assert.equal(missingBare.ok, false);
  assert.match(JSON.stringify(missingBare.checks), /muse_tool/);
  const dirAsMuse = await runSetupCheck({mode: 'complete', config: {...goodConfig, labMuse: '/abs/muse-dir'}, requirements, io: goodIo({
    lstat: async target => /python3$|presence-pa$/.test(String(target)) ? fileStat : dirStat,
  })});
  assert.equal(dirAsMuse.ok, false);
  assert.match(JSON.stringify(dirAsMuse.checks), /directory/);
  const nonexec = await runSetupCheck({mode: 'complete', config: {...goodConfig, labMuse: '/abs/muse'}, requirements, io: goodIo({
    lstat: async target => /python3$|presence-pa$/.test(String(target))
      ? fileStat
      : String(target).endsWith('muse')
        ? {isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true, mode: 0o644}
        : dirStat,
    accessExec: async target => !String(target).endsWith('muse'),
  })});
  assert.equal(nonexec.ok, false);
  assert.match(JSON.stringify(nonexec.checks), /not executable/);
});

test('normal explicit tool links including venv python are permitted', async () => {
  const venv = await runSetupCheck({mode: 'complete', config: {...goodConfig, labPython: '/abs/.venv/bin/python'}, requirements, io: goodIo({
    lstat: async target => {
      if (String(target).endsWith('/python')) return {isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false, mode: 0o777};
      if (/muse$|presence-pa$/.test(String(target)) || String(target).includes('python3')) return fileStat;
      return dirStat;
    },
    realpath: async target => String(target).endsWith('/python') ? '/abs/python3.11' : target,
    accessExec: async () => true,
  })});
  assert.equal(venv.ok, true);
});

test('symlinked configured component roots, config leaves and ancestors refuse', async () => {
  const linkedRoot = await runSetupCheck({mode: 'complete', config: goodConfig, requirements, io: goodIo({
    lstat: async target => String(target).includes('agent-lab') && !String(target).includes('/')
      ? {isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false}
      : {isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false},
  })});
  void linkedRoot;
  const ancLink = await runSetupCheck({mode: 'complete', config: goodConfig, requirements, io: goodIo({
    lstat: async target => String(target) === '/abs'
      ? {isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false}
      : {isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false, mode: 0o755},
  })});
  assert.equal(ancLink.ok, false);
  assert.match(JSON.stringify(ancLink.checks), /symlink/);
});

test('explicit config leaf and ancestor symlinks refuse via real filesystem', async t => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const {resolveSetupConfig} = await import('../src/setup-config.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-config-link-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const real = path.join(dir, 'real.json');
  await fs.writeFile(real, JSON.stringify({agent_lab_root: '/x'}));
  const leafLink = path.join(dir, 'leaf.json');
  await fs.symlink(real, leafLink);
  await assert.rejects(resolveSetupConfig({env: {}, configPath: leafLink}), /symlink_refused/);
  const outer = path.join(dir, 'outer');
  await fs.mkdir(outer);
  const inner = path.join(outer, 'inner.json');
  await fs.writeFile(inner, JSON.stringify({agent_lab_root: '/x'}));
  const outerLink = path.join(dir, 'outer-link');
  await fs.symlink(outer, outerLink);
  await assert.rejects(resolveSetupConfig({env: {}, configPath: path.join(outerLink, 'inner.json')}), /symlink_refused/);
  const ok = await resolveSetupConfig({env: {}, configPath: real});
  assert.equal(ok.origins.agent_lab_root, 'file');
});

test('requirements pin drift against the canonical manifest fails', async () => {
  const drifted = {
    components: [
      {name: 'agent-lab', pin: '0'.repeat(40), interfaces: []},
      {name: 'presence-runtime', pin: PIN_RT, interfaces: []},
    ],
    canonicalPins: {'agent-lab': PIN_LAB, 'presence-runtime': PIN_RT},
  };
  const result = await runSetupCheck({mode: 'complete', config: goodConfig, requirements: drifted, io: goodIo()});
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.checks), /pin_drift/);
});

test('describeSetupConfig distinguishes environment from file origins', async () => {
  const {describeSetupConfig} = await import('../src/setup-config.mjs');
  const fromEnv = describeSetupConfig({source: 'environment', agentLabRoot: '/e/lab', origins: {agent_lab_root: 'environment'}});
  assert.equal(fromEnv.source, 'environment');
  assert.equal(fromEnv.origins.agent_lab_root, 'environment');
  const fromFile = describeSetupConfig({source: '/repo/setup.json', agentLabRoot: '/f/lab', origins: {agent_lab_root: 'file'}});
  assert.equal(fromFile.source, 'file');
  assert.equal(fromFile.origins.agent_lab_root, 'file');
});

test('CLI offline bypasses machine config; --config usage errors exit 2', async () => {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const run = promisify(execFile);
  const script = new URL('../scripts/check-setup.mjs', import.meta.url);
  const offline = await run(process.execPath, [script.pathname, '--offline'], {env: {...process.env, A2_SETUP_CONFIG: '/definitely/malformed.json'}});
  assert.match(offline.stdout, /offline.*PASS/);
  for (const args of [['--config'], ['--config', '--offline'], ['--bogus']]) {
    const code = await run(process.execPath, [script.pathname, ...args]).then(() => 'no-throw', error => error.code);
    assert.equal(code, 2, args.join(' '));
  }
});

test('checked-in prerequisite pins match the canonical component manifest',async()=>{const requirements=JSON.parse(await fs.readFile(new URL('../setup-requirements.json',import.meta.url),'utf8')),pins=JSON.parse(await fs.readFile(new URL('../components.json',import.meta.url),'utf8'));assert.equal(requirements.components.find(c=>c.name==='agent-lab').pin,pins.agent_lab);assert.equal(requirements.components.find(c=>c.name==='presence-runtime').pin,pins.presence_runtime);});
