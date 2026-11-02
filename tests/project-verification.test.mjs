import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runProjectVerification, hashTrustedFiles} from '../src/verification-runner.mjs';
import {collectArtifactFiles, hashArtifactFiles} from '../src/artifact-source.mjs';

const digest = x => createHash('sha256').update(x).digest('hex');

// Direct Node runner for offline tests (no sandbox-exec): enforces the same
// contract the sandboxed production runner enforces — fixed `node --test`
// args only, scrubbed env, per-run deadline — without requiring macOS
// sandbox qualification (a separate coordinator release check).
function directRunner(calls) {
  return async ({node, args, cwd, env, deadline}) => {
    calls.push({args: [...args], cwd, envKeys: Object.keys(env).sort()});
    assert.equal(node, process.execPath);
    assert.equal(args[0], '--test');
    for (const a of args.slice(1)) {
      assert.match(a, /\.test\.mjs$/);
      assert.ok(!a.includes('..') && !path.isAbsolute(a));
    }
    assert.equal(env.A2_VERIFIER_SECRET, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.ok(String(env.HOME).includes('scratch'));
    const remaining = deadline - performance.now();
    if (remaining <= 0) return {code: 1, reason: 'verification_deadline', stdout: ''};
    return await new Promise(resolve => {
      const child = spawn(node, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
      let out = '';
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({code: 1, reason: 'verification_deadline', stdout: out}); }, Math.min(remaining, 15000));
      child.stdout.on('data', c => { out += c.toString('utf8'); });
      child.stderr.on('data', c => { out += c.toString('utf8'); });
      child.on('close', code => { clearTimeout(timer); resolve({code: code ?? 1, reason: null, stdout: out}); });
      child.on('error', () => { clearTimeout(timer); resolve({code: 1, reason: 'verification_setup_failed', stdout: out}); });
    });
  };
}

const TRUSTED_NAME = 'tests/trusted-value.test.mjs';
const TRUSTED_BODY = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.mjs';\ntest('frozen trusted value', () => assert.equal(value, 42));\n`;
const OWN_GOOD = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.mjs';\ntest('own value', () => assert.equal(value, 42));\n`;
const OWN_WEAKENED = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {value} from '../src/value.mjs';\ntest('own value', () => assert.equal(value, 0));\n`;

test('trusted bytes are sealed before asynchronous setup yields to the caller', async t => {
  const {workspace,artifactHash}=await fixture(t,{valueSrc:'export const value = 0;',own:OWN_WEAKENED});
  const trustedFiles={[TRUSTED_NAME]:TRUSTED_BODY};
  const {planHash}=hashTrustedFiles(trustedFiles);
  const calls=[];
  const pending=runProjectVerification({workspace,artifactHash,ownTests:['tests/value.test.mjs'],trustedFiles,expectedPlanHash:planHash,runTests:directRunner(calls)});
  trustedFiles[TRUSTED_NAME]="import test from 'node:test';test('unapproved weak substitute',()=>{});";
  const result=await pending;
  assert.equal(result.state,'failed');
  assert.match(result.stdout,/frozen trusted value/);
  assert.equal(calls.length,2);
});

test('own test selection is sealed before asynchronous setup yields', async t => {
  const {workspace}=await fixture(t);
  await fs.writeFile(path.join(workspace,'tests/unapproved.test.mjs'),"import test from 'node:test';test('UNAPPROVED_SELECTION',()=>{throw Error('unapproved ran');});");
  const artifactHash=hashArtifactFiles(await collectArtifactFiles(workspace,'project'));
  const ownTests=['tests/value.test.mjs'],trustedFiles={[TRUSTED_NAME]:TRUSTED_BODY};
  const {planHash}=hashTrustedFiles(trustedFiles);
  const pending=runProjectVerification({workspace,artifactHash,ownTests,trustedFiles,expectedPlanHash:planHash,runTests:directRunner([])});
  ownTests[0]='tests/unapproved.test.mjs';
  const result=await pending;
  assert.equal(result.state,'passed',result.stdout);
  assert.doesNotMatch(result.stdout,/UNAPPROVED_SELECTION/);
});

async function fixture(t, {valueSrc = 'export const value = 42;', own = OWN_GOOD} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-project-verif-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(path.join(workspace, 'src'), {recursive: true});
  await fs.mkdir(path.join(workspace, 'tests'), {recursive: true});
  await fs.writeFile(path.join(workspace, 'src/value.mjs'), valueSrc);
  await fs.writeFile(path.join(workspace, 'tests/value.test.mjs'), own);
  await fs.writeFile(path.join(workspace, 'style.css'), 'body { color: black; }\n');
  await fs.writeFile(path.join(workspace, 'page.html'), '<!doctype html><html><body>hi</body></html>\n');
  await fs.writeFile(path.join(workspace, 'LICENSE'), 'Public license fixture\n');
  const files = await collectArtifactFiles(workspace, 'project');
  return {root, workspace, artifactHash: hashArtifactFiles(files), files};
}

test('project verification passes without package.json and hashes CSS/HTML/new files', async t => {
  const {workspace, artifactHash, files} = await fixture(t);
  assert.ok(!files.some(f => f.path === 'package.json'));
  assert.ok(files.some(f => f.path === 'style.css'));
  assert.ok(files.some(f => f.path === 'page.html'));
  assert.ok(files.some(f => f.path === 'LICENSE'));
  const trustedFiles = {[TRUSTED_NAME]: TRUSTED_BODY};
  const {planHash} = hashTrustedFiles(trustedFiles);
  const calls = [];
  const result = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles, expectedPlanHash: planHash, runTests: directRunner(calls)});
  assert.equal(result.state, 'passed', JSON.stringify(result).slice(0, 2000));
  assert.equal(result.exit_code, 0);
  assert.equal(result.artifact_sha256, artifactHash);
  assert.equal(result.trusted_plan_hash, planHash);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ['--test', 'tests/value.test.mjs']);
  assert.deepEqual(calls[1].args, ['--test', TRUSTED_NAME]);
});

test('stale reviewed artifact refuses all execution', async t => {
  const {workspace, artifactHash} = await fixture(t);
  await fs.writeFile(path.join(workspace, 'src/value.mjs'), 'export const value = 0;');
  const trustedFiles = {[TRUSTED_NAME]: TRUSTED_BODY};
  const {planHash} = hashTrustedFiles(trustedFiles);
  const calls = [];
  const result = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles, expectedPlanHash: planHash, runTests: directRunner(calls)});
  assert.equal(result.state, 'failed');
  assert.match(result.stdout, /reviewed_artifact_changed/);
  assert.equal(calls.length, 0);
});

test('canary fails when candidate source is broken and own tests are weakened', async t => {
  const t1 = {after() {}};
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-canary-'));
  try {
    const workspace = path.join(dir, 'workspace');
    await fs.mkdir(path.join(workspace, 'src'), {recursive: true});
    await fs.mkdir(path.join(workspace, 'tests'), {recursive: true});
    await fs.writeFile(path.join(workspace, 'src/value.mjs'), 'export const value = 0;');
    await fs.writeFile(path.join(workspace, 'tests/value.test.mjs'), OWN_WEAKENED);
    const files = await collectArtifactFiles(workspace, 'project');
    const artifactHash = hashArtifactFiles(files);
    const trustedFiles = {[TRUSTED_NAME]: TRUSTED_BODY};
    const {planHash} = hashTrustedFiles(trustedFiles);
    const calls = [];
    const result = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles, expectedPlanHash: planHash, runTests: directRunner(calls)});
    assert.equal(result.state, 'failed', JSON.stringify(result).slice(0, 2000));
    assert.match(result.stdout, /frozen trusted value/);
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
  void t1;
});

test('changed trusted plan, missing tests and bad selection all reject', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-plan-'));
  try {
    const workspace = path.join(dir, 'workspace');
    await fs.mkdir(path.join(workspace, 'src'), {recursive: true});
    await fs.mkdir(path.join(workspace, 'tests'), {recursive: true});
    await fs.writeFile(path.join(workspace, 'src/value.mjs'), 'export const value = 42;');
    await fs.writeFile(path.join(workspace, 'tests/value.test.mjs'), OWN_GOOD);
    const files = await collectArtifactFiles(workspace, 'project');
    const artifactHash = hashArtifactFiles(files);
    const trustedFiles = {[TRUSTED_NAME]: TRUSTED_BODY};
    const {planHash} = hashTrustedFiles(trustedFiles);
    const calls = [];
    const changed = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles, expectedPlanHash: 'f'.repeat(64), runTests: directRunner(calls)});
    assert.equal(changed.state, 'failed');
    assert.match(changed.stdout, /trusted_plan_changed/);
    const mutated = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles: {[TRUSTED_NAME]: TRUSTED_BODY + '// edited'}, expectedPlanHash: planHash, runTests: directRunner(calls)});
    assert.equal(mutated.state, 'failed');
    assert.match(mutated.stdout, /trusted_plan_changed/);
    const noOwn = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: [], trustedFiles, expectedPlanHash: planHash, runTests: directRunner(calls)});
    assert.equal(noOwn.state, 'failed');
    assert.match(noOwn.stdout, /own_tests_missing/);
    const noTrusted = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles: {}, expectedPlanHash: planHash, runTests: directRunner(calls)});
    assert.equal(noTrusted.state, 'failed');
    assert.match(noTrusted.stdout, /trusted_tests_missing/);
    const missing = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/absent.test.mjs'], trustedFiles, expectedPlanHash: planHash, runTests: directRunner(calls)});
    assert.equal(missing.state, 'failed');
    assert.match(missing.stdout, /own_tests_missing/);
    void planHash;
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test('overlay carries frozen bytes, not mutable candidate edits', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-overlay-'));
  try {
    const workspace = path.join(dir, 'workspace');
    await fs.mkdir(path.join(workspace, 'src'), {recursive: true});
    await fs.mkdir(path.join(workspace, 'tests'), {recursive: true});
    await fs.writeFile(path.join(workspace, 'src/value.mjs'), 'export const value = 42;');
    await fs.writeFile(path.join(workspace, 'tests/value.test.mjs'), OWN_GOOD);
    await fs.writeFile(path.join(workspace, TRUSTED_NAME), 'WEAKENED-BY-CANDIDATE');
    const files = await collectArtifactFiles(workspace, 'project');
    const artifactHash = hashArtifactFiles(files);
    const trustedFiles = {[TRUSTED_NAME]: TRUSTED_BODY};
    const {planHash} = hashTrustedFiles(trustedFiles);
    const seen = [];
    const result = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles, expectedPlanHash: planHash, runTests: async ({args, cwd, env, deadline}) => {
      seen.push({args, cwd});
      const body = await fs.readFile(path.join(cwd, TRUSTED_NAME), 'utf8');
      assert.equal(body, cwd.includes('overlay') ? TRUSTED_BODY : 'WEAKENED-BY-CANDIDATE');
      return directRunner([])({node: process.execPath, args, cwd, env, deadline});
    }});
    assert.equal(result.state, 'passed', JSON.stringify(result).slice(0, 2000));
    assert.equal(seen.length, 2);
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test('mutating trustedFiles after the plan check cannot relabel a run with the old hash', async t => {
  const {workspace, artifactHash} = await fixture(t);
  const trustedFiles = {[TRUSTED_NAME]: TRUSTED_BODY};
  const {planHash} = hashTrustedFiles(trustedFiles);
  // Attacker mutates the live map after the expected hash was approved.
  trustedFiles[TRUSTED_NAME] = `import test from 'node:test';\ntest('weakened substitute', () => {});\n`;
  const calls = [];
  const result = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles, expectedPlanHash: planHash, runTests: directRunner(calls)});
  assert.equal(result.state, 'failed');
  assert.match(result.stdout, /trusted_plan_changed/);
  assert.equal(calls.length, 0, 'no candidate execution on changed plan');
  assert.ok(!JSON.stringify(result).includes(planHash) || result.trusted_plan_hash === undefined);
});

test('frozen overlays never accept candidate implementation or config paths', async t => {
  const {workspace, artifactHash} = await fixture(t);
  const calls = [];
  for (const name of ['src/value.mjs', 'src/trusted.test.mjs', 'package.json', 'tests/../../escape.test.mjs', 'config.mjs']) {
    const trustedFiles = {[name]: TRUSTED_BODY};
    const expectedPlanHash = digest(JSON.stringify([{path: name, sha256: digest(TRUSTED_BODY)}]));
    const result = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles, expectedPlanHash, runTests: directRunner(calls)});
    assert.equal(result.state, 'failed', name);
    assert.match(result.stdout, /trusted_tests_missing|trusted_plan_invalid/);
  }
  assert.equal(calls.length, 0);
});

test('trusted tests observe the candidate through the overlay workspace pointer', async t => {
  const {workspace, artifactHash} = await fixture(t);
  const trustedFiles = {[TRUSTED_NAME]: TRUSTED_BODY};
  const {planHash} = hashTrustedFiles(trustedFiles);
  const seen = [];
  const result = await runProjectVerification({workspace, node: process.execPath, artifactHash, ownTests: ['tests/value.test.mjs'], trustedFiles, expectedPlanHash: planHash, runTests: async args => {
    seen.push({cwd: args.cwd, candidate: args.env.A2_CANDIDATE_WORKSPACE});
    return directRunner([])(args);
  }});
  assert.equal(result.state, 'passed', JSON.stringify(result).slice(0, 2000));
  assert.equal(seen.length, 2);
  assert.equal(seen[0].candidate, seen[0].cwd, 'own tests point at the snapshot');
  assert.equal(seen[1].candidate, seen[1].cwd, 'trusted tests point at the overlay, never the outside snapshot');
  assert.ok(seen[1].cwd.includes('overlay'));
});

test('opt-in Node discovery catches added JS tests while explicit frozen selection stays unchanged', async t => {
  const {workspace} = await fixture(t);
  await fs.writeFile(path.join(workspace, 'tests/additional.test.js'), "import test from 'node:test';test('new regression fails',()=>{throw Error('additional regression');});\n");
  const artifactHash = hashArtifactFiles(await collectArtifactFiles(workspace, 'project'));
  const trustedFiles = {[TRUSTED_NAME]: TRUSTED_BODY}, expectedPlanHash = hashTrustedFiles(trustedFiles).planHash;
  const calls = [];
  const result = await runProjectVerification({workspace, artifactHash, ownTestDiscovery:'node-default', ownTests:['tests/value.test.mjs'], trustedFiles, expectedPlanHash, runTests:directRunner(calls)});
  assert.equal(result.state, 'failed');
  assert.match(result.stdout, /additional regression/);
  assert.deepEqual(calls[0].args, ['--test']);
  assert.deepEqual(calls[1].args, ['--test', TRUSTED_NAME]);
});

test('Node discovery cannot hide a deleted required public test', async t => {
  const {workspace} = await fixture(t);
  await fs.unlink(path.join(workspace, 'tests/value.test.mjs'));
  await fs.writeFile(path.join(workspace, 'tests/new.test.mjs'), "import test from 'node:test';test('replacement',()=>{});\n");
  const artifactHash = hashArtifactFiles(await collectArtifactFiles(workspace, 'project'));
  const trustedFiles = {[TRUSTED_NAME]: TRUSTED_BODY};
  const result = await runProjectVerification({workspace, artifactHash, ownTestDiscovery:'node-default', ownTests:['tests/value.test.mjs'], trustedFiles, expectedPlanHash:hashTrustedFiles(trustedFiles).planHash, runTests:()=>assert.fail('missing baseline must reject before execution')});
  assert.equal(result.state, 'failed');
  assert.notEqual(result.exit_code, 0);
});
