import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {prepareCodingTaskProfiles} from '../src/coding-task-profiles.mjs';
import {CODING_TASKS} from '../src/coding-task-catalog.mjs';
import {runGit} from '../src/git-ops.mjs';
import {prepareProjectWorktrees, cleanupProjectWorktrees} from '../src/project-task.mjs';
import {collectArtifactFiles, hashArtifactFiles} from '../src/artifact-source.mjs';
import {hashTrustedFiles, runProjectVerification} from '../src/verification-runner.mjs';

const execute = promisify(execFile);
const battery = fileURLToPath(new URL('../coding-tasks/', import.meta.url));
const env = {...process.env, GIT_DIR: '/poisoned', GIT_INDEX_FILE: '/poisoned/index', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: '/poisoned/helper'};
const git = (args, cwd) => runGit(args, cwd, {env});
async function commit(repo) {
  await git(['add', '-A'], repo);
  await git(['-c', 'user.name=test', '-c', 'user.email=test@invalid', 'commit', '-qm', 'fixture'], repo);
  return String(await git(['rev-parse', 'HEAD'], repo)).trim();
}
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'muse-task-catalog-')));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const repo = path.join(root, 'source'), local = path.join(root, 'private');
  await fs.mkdir(repo, {mode: 0o700});
  await fs.cp(battery, path.join(repo, 'coding-tasks'), {recursive: true});
  await git(['init', '-q'], repo);
  const sha = await commit(repo);
  return {root, repo, local, sha};
}
async function runOffline({node, args, cwd, env}) {
  try {const out = await execute(node, args, {cwd, env, timeout: 10000, maxBuffer: 256000}); return {code: 0, stdout: out.stdout};}
  catch (error) {return {code: typeof error.code === 'number' ? error.code : 1, stdout: String(error.stdout ?? '') + String(error.stderr ?? '')};}
}
async function verify(workspace, plan) {
  return runProjectVerification({workspace, artifactHash: hashArtifactFiles(await collectArtifactFiles(workspace, 'project')), ownTests: plan.ownTests, trustedFiles: plan.trustedFiles, expectedPlanHash: plan.expectedPlanHash, runTests: runOffline});
}

test('all registered profiles freeze committed public tasks and keep private checks out of agent Git history', async t => {
  const {root, repo, local, sha} = await fixture(t);
  const dirty = path.join(repo, 'coding-tasks/tasks/save-conflicts/project/TASK.md');
  await fs.writeFile(dirty, 'UNCOMMITTED SENTINEL MUST NOT TRAVEL');
  const registry = await prepareCodingTaskProfiles({sourceRoot: repo, localRoot: local, environment: env});
  assert.equal(registry.defaultTask, 'save-conflicts');
  assert.equal(registry.fixtureCommit, sha);
  assert.equal(registry.fixtureVersion, '1.0.4-draft');
  assert.deepEqual(registry.entries.map(x => x.id), ['save-conflicts', 'booking-rules', 'batch-import', 'notification-routing','shared-expenses']);
  for (const [index, entry] of registry.entries.entries()) {
    const {plan, metadata} = entry, spec = CODING_TASKS[index];
    assert.equal(metadata.task_profile_id, spec.id);
    assert.equal(metadata.task_id, spec.taskId);
    assert.equal(metadata.fixture_commit, sha);
    assert.equal(metadata.fixture_version, '1.0.4-draft');
    assert.equal(metadata.source_commit, plan.originalCommit);
    assert.equal(metadata.verification_plan_hash, hashTrustedFiles(plan.trustedFiles).planHash);
    assert.equal((await fs.stat(entry.profilePath)).mode & 0o777, 0o600);
    assert.equal(entry.presentation.taskBrief.title, 'Coding task: ' + spec.title);
    assert.match(entry.presentation.taskPrompt, /wait for my response/);
    assert.deepEqual(plan.include, ['CONTRACT.md', 'TASK.md', 'package.json', spec.sourceFile, 'test/behavior.test.mjs', 'test/smoke.test.mjs']);
    assert.deepEqual(Object.keys(plan.trustedFiles), entry.id === 'save-conflicts' ? ['test/frozen-acceptance.test.mjs', 'test/qualification-contract.test.mjs'] : ['test/frozen-acceptance.test.mjs']);
    if (entry.id === 'save-conflicts') assert.equal(plan.expectedPlanHash, 'c4ecb0ff6436c6bbc6523ad3478ccd46d71df681d2ba1ba80c4f2968ce658175');
    assert.match(plan.trustedFiles['test/frozen-acceptance.test.mjs'].toString(), /process\.env\.A2_CANDIDATE_WORKSPACE/);
    assert.doesNotMatch(plan.taskPrompt, /UNCOMMITTED SENTINEL/);
    assert.match(plan.taskPrompt, /Frozen acceptance checks are run separately/);
    const sourceNames = String(await git(['ls-tree', '-r', '--name-only', plan.originalCommit], plan.repoRoot)).trim().split('\n');
    assert.equal(sourceNames.length, entry.id === 'save-conflicts' ? 8 : 7);
    assert.equal(sourceNames.some(p => /FACILITATOR|reference|checks\//.test(p)), false);
    const backingRoot = path.join(root, 'arms-' + entry.id);
    const prepared = await prepareProjectWorktrees({repoRoot: plan.repoRoot, originalCommit: plan.originalCommit, include: plan.include, taskPrompt: plan.taskPrompt, taskId: plan.taskId, verificationPlan: plan, backingRoot, env});
    try {
      for (const arm of ['without', 'with']) {
        const workspace = prepared.worktrees[arm];
        const names = String(await git(['ls-tree', '-r', '--name-only', 'HEAD'], workspace)).trim().split('\n');
        assert.deepEqual(names.sort(), [...plan.include].sort());
        assert.equal(String(await git(['rev-list', '--count', '--all'], workspace)).trim(), '1');
        assert.doesNotMatch(String(await git(['rev-list', '--objects', '--all'], workspace)), /frozen-acceptance|FACILITATOR|reference|checks\//);
        await assert.rejects(git(['cat-file', '-e', plan.originalCommit], workspace));
        await assert.rejects(fs.lstat(path.join(workspace, 'test/frozen-acceptance.test.mjs')), {code: 'ENOENT'});
      }
      await assert.rejects(fs.lstat(path.join(prepared.worktrees.without, 'PRESENCE-ADAPTER.md')), {code: 'ENOENT'});
      assert.equal((await fs.lstat(path.join(prepared.worktrees.with, 'PRESENCE-ADAPTER.md'))).isFile(), true);
      // Execute the same frozen plan against incomplete and correct candidate
      // source; this fixture runner is not a production sandbox qualification.
      const workspace = prepared.worktrees.without;
      assert.equal((await verify(workspace, plan)).state, 'failed');
      const reference = await fs.readFile(path.join(repo, 'coding-tasks/tasks', entry.id, 'reference', spec.sourceFile));
      await fs.writeFile(path.join(workspace, spec.sourceFile), reference);
      const result = await verify(workspace, plan);
      assert.equal(result.state, 'passed', result.stdout);
      assert.equal(result.trusted_plan_hash, metadata.verification_plan_hash);
    } finally {await cleanupProjectWorktrees(backingRoot);}
  }
  assert.equal(await fs.readFile(dirty, 'utf8'), 'UNCOMMITTED SENTINEL MUST NOT TRAVEL');
  assert.equal(String(await git(['rev-parse', 'HEAD'], repo)).trim(), sha);
});

test('explicit fixture commit stays pinned when HEAD changes', async t => {
  const {repo, local, sha} = await fixture(t);
  await fs.writeFile(path.join(repo, 'coding-tasks/tasks/save-conflicts/project/TASK.md'), 'LATER COMMIT');
  const newer = await commit(repo);
  assert.notEqual(newer, sha);
  const registry = await prepareCodingTaskProfiles({sourceRoot: repo, localRoot: local, commit: sha, environment: env});
  assert.equal(registry.fixtureCommit, sha);
  assert.doesNotMatch(registry.entries[0].plan.taskPrompt, /LATER COMMIT/);
  for (const invalid of [null, '', 'HEAD', '../main', 'a'.repeat(39), ['a'.repeat(40)]]) await assert.rejects(prepareCodingTaskProfiles({sourceRoot: repo, localRoot: local, commit: invalid, environment: env}));
});

test('unknown manifest tasks and unexpected acceptance bridges fail before creating destinations', async t => {
  const {repo, local} = await fixture(t);
  const manifestPath = path.join(repo, 'coding-tasks/manifest.json'), original = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original);manifest.tasks[0].id = '../outside';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));await commit(repo);
  await assert.rejects(prepareCodingTaskProfiles({sourceRoot: repo, localRoot: local}), /coding_task_manifest_invalid/);
  await assert.rejects(fs.stat(local), {code: 'ENOENT'});
  await fs.writeFile(manifestPath, original);
  await fs.writeFile(path.join(repo, 'coding-tasks/tasks/save-conflicts/checks/acceptance.test.mjs'), 'throw Error("unexpected bridge");');await commit(repo);
  await assert.rejects(prepareCodingTaskProfiles({sourceRoot: repo, localRoot: local}), /coding_task_acceptance_invalid/);
  await assert.rejects(fs.stat(local), {code: 'ENOENT'});
});

test('committed source links and linked/shared destinations are refused', async t => {
  const {root, repo, local} = await fixture(t);
  const source = path.join(repo, 'coding-tasks/tasks/save-conflicts/project/src/save.mjs');
  await fs.rm(source);await fs.symlink('/etc/passwd', source);await commit(repo);
  await assert.rejects(prepareCodingTaskProfiles({sourceRoot: repo, localRoot: local}), /coding_task_source_unsafe/);
  await assert.rejects(fs.stat(local), {code: 'ENOENT'});
  await fs.rm(source);await fs.writeFile(source, 'export const saveEdit=()=>{};');const clean = await commit(repo);
  const foreign = path.join(root, 'foreign');await fs.mkdir(foreign, {mode: 0o700});await fs.symlink(foreign, local);
  await assert.rejects(prepareCodingTaskProfiles({sourceRoot: repo, localRoot: local, commit: clean}), /coding_task_directory_invalid/);
  assert.deepEqual(await fs.readdir(foreign), []);
  await fs.rm(local);await fs.mkdir(local, {mode: 0o755});await fs.chmod(local, 0o755);
  await assert.rejects(prepareCodingTaskProfiles({sourceRoot: repo, localRoot: local, commit: clean}), /coding_task_directory_invalid/);
  assert.deepEqual(await fs.readdir(local), []);
  const linkedRepo = path.join(root, 'linked-source');await fs.symlink(repo, linkedRepo);
  await assert.rejects(prepareCodingTaskProfiles({sourceRoot: linkedRepo, localRoot: local}), /coding_task_directory_invalid/);
});
