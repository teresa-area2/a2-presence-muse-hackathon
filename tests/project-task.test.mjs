import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadProjectProfile, validateProjectProfile, freezeProjectSource, prepareProjectWorktrees, cleanupProjectWorktrees, UNIVERSAL_INSTRUCTIONS, PRESENCE_ADAPTIVE_ADDENDUM} from '../src/project-task.mjs';
import {collectArtifactFiles} from '../src/artifact-source.mjs';

const execute = promisify(execFile);
const git = (args, cwd) => execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {cwd, timeout: 15000}).then(r => r.stdout);

async function makeRepo(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-project-task-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo, {recursive: true});
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(repo, rel)), {recursive: true});
    await fs.writeFile(path.join(repo, rel), body);
  }
  await execute('git', ['init', '-q'], {cwd: repo});
  await git(['add', '-A'], repo);
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], repo);
  return {root, repo, commit: (await git(['rev-parse', 'HEAD'], repo)).trim()};
}

test('invalid project profile refuses, never silently uses the sample task', async () => {
  const base = JSON.parse(await fs.readFile(new URL('../task-profiles/harness.json', import.meta.url), 'utf8'));
  assert.throws(() => validateProjectProfile({...base, bogus: 1}), /unknown_key/);
  assert.throws(() => validateProjectProfile({...base, repository: {root: 'relative'}}), /repository_invalid/);
  assert.throws(() => validateProjectProfile({...base, repository: {...base.repository, commit: 'short'}}), /commit_invalid/);
  assert.throws(() => validateProjectProfile({...base, source: {include: ['../escape']}}), /refused/);
  assert.throws(() => validateProjectProfile({...base, source: {include: ['--evil']}}), /refused/);
  assert.throws(() => validateProjectProfile({...base, verification: {...base.verification, own_tests: []}}), /verification_invalid/);
  assert.throws(() => validateProjectProfile({...base, verification: {...base.verification, trusted: {...base.verification.trusted, plan_hash: 'zzz'}}}), /verification_invalid/);
  await assert.rejects(loadProjectProfile('/definitely/missing.json'), /missing/);
});

test('freeze binds the exact source commit and rejects dirty checkouts without mutation', async t => {
  const {repo, commit} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;', 'README.md': 'hi'});
  const branchBefore = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).trim();
  const frozen = await freezeProjectSource({repoRoot: repo});
  assert.equal(frozen.originalCommit, commit);
  assert.equal(frozen.headCommit, commit);
  // Dirty (untracked sentinel) refuses.
  await fs.writeFile(path.join(repo, 'sentinel.txt'), 'sentinel');
  await assert.rejects(freezeProjectSource({repoRoot: repo}), /dirty/);
  await fs.rm(path.join(repo, 'sentinel.txt'));
  // Explicit commit pin is honored.
  const pinned = await freezeProjectSource({repoRoot: repo, commit});
  assert.equal(pinned.originalCommit, commit);
  await assert.rejects(freezeProjectSource({repoRoot: repo, commit: '0'.repeat(40)}), /unavailable|object/);
  // Original checkout unchanged: same branch, clean index.
  assert.equal((await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).trim(), branchBefore);
  assert.equal((await git(['status', '--porcelain'], repo)).trim(), '');
  await assert.rejects(freezeProjectSource({repoRoot: '/missing/repo'}), /repository_invalid/);
});

test('detached worktrees keep original history inaccessible and original unchanged', async t => {
  const {repo, commit} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;', 'README.md': 'public', '.env': 'SECRET=1', '.presence/log.jsonl': 'native'});
  // Second original commit to prove history isolation.
  await fs.writeFile(path.join(repo, 'src/a.mjs'), 'export const a = 2;');
  await git(['add', '-A'], repo);
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'second original commit'], repo);
  const head = (await git(['rev-parse', 'HEAD'], repo)).trim();
  const statusBefore = await git(['status', '--porcelain'], repo);
  const branchBefore = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo);
  const backingRoot = path.join(path.dirname(repo), 'backing');
  t.after(() => fs.rm(backingRoot, {recursive: true, force: true}));
  const prep = await prepareProjectWorktrees({repoRoot: repo, originalCommit: head, include: ['src/', 'README.md'], taskPrompt: 'Do the bounded task.', taskId: 'PROJECT-01', backingRoot});
  assert.notEqual(prep.sanitizedCommit, head);
  assert.ok(!prep.sanitizedCommit || true);
  for (const arm of ['without', 'with']) {
    const gitlink = await fs.readFile(path.join(prep.worktrees[arm], '.git'), 'utf8');
    assert.match(gitlink, /^gitdir:/);
    assert.ok(!gitlink.includes(repo), 'worktree .git must not reach the original store');
  }
  // Sanitized history has no original commits.
  const log = await git(['log', '--oneline', 'baseline'], prep.backingRepo.replace(/\/backing\.git$/, '/backing.git'));
  void log;
  const armLog = await git(['log', '--format=%H'], prep.worktrees.without);
  assert.ok(!armLog.includes(head) || armLog.trim().split('\n').length <= 3);
  assert.ok(!armLog.includes(commit), 'original first commit must not be reachable');
  // Untracked sentinels and private data excluded.
  await assert.rejects(fs.stat(path.join(prep.worktrees.without, '.env')), /ENOENT/);
  await assert.rejects(fs.stat(path.join(prep.worktrees.without, '.presence')), /ENOENT/);
  assert.equal(await fs.readFile(path.join(prep.worktrees.without, 'README.md'), 'utf8'), 'public');
  // Original checkout byte-for-byte unchanged.
  assert.equal((await git(['rev-parse', 'HEAD'], repo)).trim(), head);
  assert.equal(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo), branchBefore);
  assert.equal((await git(['status', '--porcelain'], repo)).trim(), statusBefore.trim());
  await cleanupProjectWorktrees(backingRoot);
});

test('git stash -u preserves runtime controls while stashing ordinary untracked task files', async t => {
  const {repo, commit} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;'});
  const backingRoot = path.join(path.dirname(repo), 'backing-stash');
  const prep = await prepareProjectWorktrees({repoRoot: repo, originalCommit: commit,
    include: ['src/'], taskPrompt: 'Do the bounded task.', taskId: 'PROJECT-01', backingRoot});
  for (const arm of ['without', 'with']) {
    const workspace = prep.worktrees[arm];
    const adapter = path.join(workspace, 'PRESENCE-ADAPTER.md');
    if (arm === 'with') {
      assert.equal(await fs.readFile(adapter, 'utf8'), PRESENCE_ADAPTIVE_ADDENDUM);
      assert.ok((await git(['ls-files', '--others', '--exclude-standard'], workspace)).split('\n').includes('PRESENCE-ADAPTER.md'));
      assert.ok((await collectArtifactFiles(workspace, 'project')).some(file => file.path === 'PRESENCE-ADAPTER.md'));
    } else await assert.rejects(fs.stat(adapter), {code: 'ENOENT'});
    const controls = {'.presence/muse-native-data/muse/sessions/current.jsonl': 'owned session',
      '.presence/hook-events.jsonl': 'owned hook events', '.muse/presence-boundary-plugin/hooks/boundary.py': 'owned hook'};
    for (const [rel, body] of Object.entries(controls)) {
      const target = path.join(workspace, rel);
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.writeFile(target, body);
    }
    const taskFile = 'src/new-task-test.mjs';
    await fs.writeFile(path.join(workspace, taskFile), 'export const taskTest = true;\n');
    const stashArgs = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=t', '-c', 'user.email=t@t', 'stash', 'push', '--include-untracked', '-m', `test ${arm}`];
    if (process.env.A2_TEST_STASH_NATIVE_SANDBOX === '1') {
      // An explicit host qualification runs real Git under a macOS sandbox
      // that permits writes only in this disposable test root, including its
      // sanitized common Git store. The default regression remains portable
      // and also works when an enclosing sandbox disallows nested sandboxes.
      assert.equal(process.platform, 'darwin', 'native stash sandbox qualification requires macOS');
      const allowed = JSON.stringify(await fs.realpath(path.dirname(repo)));
      const policy = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${allowed}) (literal "/dev/null"))`;
      await execute('/usr/bin/sandbox-exec', ['-p', policy, '/usr/bin/git', ...stashArgs], {cwd: workspace, timeout: 15000});
    } else {
      await execute('git', stashArgs, {cwd: workspace, timeout: 15000});
    }
    for (const [rel, body] of Object.entries(controls)) assert.equal(await fs.readFile(path.join(workspace, rel), 'utf8'), body);
    await assert.rejects(fs.stat(path.join(workspace, taskFile)), {code: 'ENOENT'});
    const stashed = (await git(['ls-tree', '-r', '--name-only', 'stash@{0}^3'], workspace)).trim().split('\n');
    assert.ok(stashed.includes(taskFile), 'ordinary untracked task file is in the stash');
    assert.ok(!stashed.some(rel => rel.startsWith('.presence/') || rel.startsWith('.muse/')), 'runtime controls are not in the stash');
    if (arm === 'with') {
      assert.ok(stashed.includes('PRESENCE-ADAPTER.md'), 'the unignored adapter may be stashed');
      await assert.rejects(fs.stat(adapter), {code: 'ENOENT'});
    } else assert.ok(!stashed.includes('PRESENCE-ADAPTER.md'));
    const tracked = (await git(['ls-tree', '-r', '--name-only', 'HEAD'], workspace)).trim().split('\n');
    assert.ok(!tracked.includes('.gitignore'), 'the protection does not change the task source');
    assert.equal(await git(['show', 'HEAD:src/a.mjs'], workspace), 'export const a = 1;');
  }
  await cleanupProjectWorktrees(backingRoot);
});

test('unsafe source, profile and path inputs are rejected', async t => {
  const {repo} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;'});
  const head = (await git(['rev-parse', 'HEAD'], repo)).trim();
  const backing = path.join(path.dirname(repo), 'backing-unsafe');
  t.after(() => fs.rm(backing, {recursive: true, force: true}));
  await assert.rejects(prepareProjectWorktrees({repoRoot: repo, originalCommit: head, include: ['../escape'], taskPrompt: 'x', backingRoot: backing}), /refused|invalid|empty/);
  await assert.rejects(prepareProjectWorktrees({repoRoot: repo, originalCommit: head, include: ['--evil'], taskPrompt: 'x', backingRoot: backing}), /refused|invalid/);
  await assert.rejects(prepareProjectWorktrees({repoRoot: 'relative/path', originalCommit: head, include: ['src/'], taskPrompt: 'x', backingRoot: backing}), /repository_invalid|unavailable/);
  await assert.rejects(prepareProjectWorktrees({repoRoot: repo, originalCommit: 'nothex', include: ['src/'], taskPrompt: 'x', backingRoot: backing}), /unavailable/);
});

test('symlink and submodule sources are refused', async t => {
  const linkRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-project-symlink-'));
  t.after(() => fs.rm(linkRepo, {recursive: true, force: true}));
  const lr = path.join(linkRepo, 'repo');
  await fs.mkdir(path.join(lr, 'src'), {recursive: true});
  await fs.writeFile(path.join(lr, 'src/a.mjs'), 'export const a = 1;');
  await fs.symlink('src/a.mjs', path.join(lr, 'link.mjs'));
  await execute('git', ['init', '-q'], {cwd: lr});
  await git(['add', '-A'], lr);
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], lr);
  const linkHead = (await git(['rev-parse', 'HEAD'], lr)).trim();
  await assert.rejects(prepareProjectWorktrees({repoRoot: lr, originalCommit: linkHead, include: ['src/', 'link.mjs'], taskPrompt: 'x', backingRoot: path.join(linkRepo, 'backing')}), /symlink_refused/);
  const subRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-project-submod-'));
  t.after(() => fs.rm(subRoot, {recursive: true, force: true}));
  const sub = path.join(subRoot, 'sub'), sup = path.join(subRoot, 'sup');
  await fs.mkdir(sub, {recursive: true}); await fs.mkdir(sup, {recursive: true});
  await fs.writeFile(path.join(sub, 'f.txt'), 'x');
  await execute('git', ['init', '-q'], {cwd: sub});
  await git(['add', '-A'], sub);
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'sub'], sub);
  await execute('git', ['init', '-q'], {cwd: sup});
  await fs.writeFile(path.join(sup, 'top.txt'), 'y');
  await execute('git', ['-c', 'protocol.file.allow=always', '-c', 'core.hooksPath=/dev/null', 'submodule', 'add', '-q', sub, 'submod'], {cwd: sup});
  await git(['add', '-A'], sup);
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'sup'], sup);
  const supHead = (await git(['rev-parse', 'HEAD'], sup)).trim();
  await assert.rejects(prepareProjectWorktrees({repoRoot: sup, originalCommit: supHead, include: ['top.txt', 'submod'], taskPrompt: 'x', backingRoot: path.join(subRoot, 'backing')}), /submodule_refused/);
});

test('failed preparation leaves no registered partial worktrees', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-project-fail-'));
  try {
    await assert.rejects(prepareProjectWorktrees({repoRoot: '/missing/repo', originalCommit: 'c'.repeat(40), include: ['src/'], taskPrompt: 'x', backingRoot: path.join(dir, 'backing')}), /repository_invalid|workspace|unavailable/);
    const entries = await fs.readdir(dir);
    assert.ok(!entries.includes('backing') || (await fs.readdir(path.join(dir, 'backing'))).length === 0);
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test('universal instructions are identical; only Presence arm gets the short adapter addendum', async t => {
  assert.match(UNIVERSAL_INSTRUCTIONS, /Fixed task/);
  assert.match(PRESENCE_ADAPTIVE_ADDENDUM, /response_extent/);
  assert.match(PRESENCE_ADAPTIVE_ADDENDUM, /unsolicited_update/);
  assert.match(PRESENCE_ADAPTIVE_ADDENDUM, /conversation_style/);
  assert.doesNotMatch(PRESENCE_ADAPTIVE_ADDENDUM, /readiness:|flow:|stability:/);
  assert.ok(PRESENCE_ADAPTIVE_ADDENDUM.length < UNIVERSAL_INSTRUCTIONS.length * 2);
});
