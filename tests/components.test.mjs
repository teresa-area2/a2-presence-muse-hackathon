import test from 'node:test';
import assert from 'node:assert/strict';

test('no implicit sibling checkout remains; external Lab selection stays explicit', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/components.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /agent-workspaces\/muse-lab/);
  assert.match(source, /setup-config/);
  assert.match(source, /A2_AGENT_LAB_ROOT/);
  assert.match(source, /A2_OPEN_PRESENCE_LOCAL/);
});

test('server and checker share one path-resolution module', async () => {
  const fs = await import('node:fs/promises');
  const checker = await fs.readFile(new URL('../scripts/check-setup.mjs', import.meta.url), 'utf8');
  const components = await fs.readFile(new URL('../src/components.mjs', import.meta.url), 'utf8');
  assert.match(checker, /setup-config/);
  assert.match(components, /resolveSetupConfig/);
  assert.match(checker, /resolveSetupConfig/);
});

test('missing explicit roots throw before any component import', async () => {
  const {resolveSetupConfig} = await import('../src/setup-config.mjs');
  const setup = await resolveSetupConfig({env: {}, configPath: '/definitely/missing-setup.json', readFile: async () => {throw Object.assign(Error('nope'), {code: 'ENOENT'});}}).catch(e => e);
  assert.match(String(setup?.message ?? ''), /setup_config_missing/);
});

test('project plan selection: sample default, strict refusal, frozen baseline', async t => {
  const {loadProjectPlan} = await import('../src/components.mjs');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util');
  const run = promisify(execFile);

  // Unset selection preserves the sample default.
  assert.equal(await loadProjectPlan({}), null);

  // Missing, malformed, and control-character selections refuse.
  await assert.rejects(loadProjectPlan({A2_MUSE_TASK_PROFILE: '/definitely/missing.json'}), /missing/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-plan-select-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const bad = path.join(dir, 'bad.json');
  await fs.writeFile(bad, '{not json');
  await assert.rejects(loadProjectPlan({A2_MUSE_TASK_PROFILE: bad}), /invalid/);
  const unknown = path.join(dir, 'unknown.json');
  await fs.writeFile(unknown, JSON.stringify({version: 1, kind: 'project', bogus: true}));
  await assert.rejects(loadProjectPlan({A2_MUSE_TASK_PROFILE: unknown}), /unknown_key/);
  await assert.rejects(loadProjectPlan({A2_MUSE_TASK_PROFILE: '/tmp/x\0y'}), /invalid/);

  // A well-formed selection freezes commit plus trusted bytes ONCE.
  const repo = path.join(dir, 'repo');
  await fs.mkdir(path.join(repo, 'tests'), {recursive: true});
  await fs.writeFile(path.join(repo, 'tests/keep.test.mjs'), "import test from 'node:test';\ntest('k', () => {});\n");
  await run('git', ['init', '-q'], {cwd: repo});
  await run('git', ['add', '-A'], {cwd: repo});
  await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], {cwd: repo});
  const head = (await run('git', ['rev-parse', 'HEAD'], {cwd: repo})).stdout.trim();
  const profile = {
    version: 1, kind: 'project',
    repository: {root: repo, commit: head},
    source: {include: ['tests/']},
    task: {id: 'T', prompt: 'Do the bounded task.'},
    verification: {mode: 'project', own_tests: ['tests/keep.test.mjs'], trusted: {tests: ['tests/keep.test.mjs'], plan_hash: null}},
  };
  const profilePath = path.join(dir, 'profile.json');
  await fs.writeFile(profilePath, JSON.stringify(profile));
  const plan = await loadProjectPlan({A2_MUSE_TASK_PROFILE: profilePath});
  assert.equal(plan.originalCommit, head);
  assert.match(plan.expectedPlanHash, /^[a-f0-9]{64}$/);
  assert.ok(Buffer.isBuffer(plan.trustedFiles['tests/keep.test.mjs']));

  // An explicitly supplied hash must match the frozen bytes.
  const wrong = {...profile, verification: {...profile.verification, trusted: {tests: ['tests/keep.test.mjs'], plan_hash: 'f'.repeat(64)}}};
  const wrongPath = path.join(dir, 'wrong.json');
  await fs.writeFile(wrongPath, JSON.stringify(wrong));
  await assert.rejects(loadProjectPlan({A2_MUSE_TASK_PROFILE: wrongPath}), /hash_mismatch/);
  const exact = {...profile, verification: {...profile.verification, trusted: {tests: ['tests/keep.test.mjs'], plan_hash: plan.expectedPlanHash}}};
  const exactPath = path.join(dir, 'exact.json');
  await fs.writeFile(exactPath, JSON.stringify(exact));
  assert.equal((await loadProjectPlan({A2_MUSE_TASK_PROFILE: exactPath})).expectedPlanHash, plan.expectedPlanHash);
});

test('malformed task profile refuses before component probing', async () => {
  const {loadComponents} = await import('../src/components.mjs');
  await assert.rejects(loadComponents({A2_MUSE_TASK_PROFILE: '/definitely/missing.json'}), /missing/);
});
