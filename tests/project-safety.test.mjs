import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareProjectWorktrees, cleanupProjectWorktrees, freezeProjectSource} from '../src/project-task.mjs';
import {classifyFile, collectArtifactFiles, readFileNoFollow} from '../src/artifact-source.mjs';
import {hermeticGitEnv, runGit} from '../src/git-ops.mjs';
import {collectArtifactFilesWithBytes} from '../src/artifact-source.mjs';

test('large bounded source capture preserves every chunk', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'muse-multichunk-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const body=Buffer.concat([Buffer.alloc(65536,65),Buffer.alloc(54464,66)]);
  await fs.writeFile(path.join(root,'large.mjs'),body);
  const captured=await collectArtifactFilesWithBytes(root,'project');
  assert.deepEqual(captured.bytes.get('large.mjs'),body);
});

test('cleanup refuses a foreign directory with a forged owner marker', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'muse-forged-owner-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const st=await fs.stat(root);
  await fs.writeFile(path.join(root,'keep.txt'),'caller data');
  await fs.writeFile(path.join(root,'.owner.json'),JSON.stringify({nonce:'forged',ino:st.ino,dev:st.dev}));
  await assert.rejects(cleanupProjectWorktrees(root),/foreign/);
  assert.equal(await fs.readFile(path.join(root,'keep.txt'),'utf8'),'caller data');
});

test('a parent swapped at file open cannot expose outside bytes', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'muse-ancestor-swap-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source'),outside=path.join(root,'outside');
  await fs.mkdir(path.join(source,'inner'),{recursive:true});await fs.mkdir(outside);
  await fs.writeFile(path.join(source,'inner/value.mjs'),'original');
  await fs.writeFile(path.join(outside,'value.mjs'),'OUTSIDE-SENTINEL');
  const realSource=await fs.realpath(source),originalOpen=fs.open;
  let swapped=false;
  fs.open=async (file,...args)=>{
    if(!swapped&&String(file)===path.join(realSource,'inner/value.mjs')){
      swapped=true;await fs.rename(path.join(source,'inner'),path.join(source,'saved'));
      await fs.symlink(outside,path.join(source,'inner'));
    }
    return originalOpen(file,...args);
  };
  try {await assert.rejects(readFileNoFollow(realSource,'inner/value.mjs'),/refused/);}
  finally {fs.open=originalOpen;}
  assert.equal(swapped,true);
});

const run = promisify(execFile);
const git = (args, cwd, env) => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {cwd, timeout: 15000, env}).then(r => r.stdout);

async function makeRepo(t, files, {secondCommit = false} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-safety-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo, {recursive: true});
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(repo, rel)), {recursive: true});
    await fs.writeFile(path.join(repo, rel), body);
  }
  await run('git', ['init', '-q'], {cwd: repo});
  await run('git', ['add', '-A'], {cwd: repo});
  await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first original commit'], {cwd: repo});
  if (secondCommit) {
    await fs.writeFile(path.join(repo, 'src/a.mjs'), 'export const a = 2;\n');
    await run('git', ['add', '-A'], {cwd: repo});
    await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'second original commit'], {cwd: repo});
  }
  const head = (await git(['rev-parse', 'HEAD'], repo)).trim();
  return {root, repo, head};
}

const PREP = (repo, head, backingRoot, include = ['src/']) => prepareProjectWorktrees({
  repoRoot: repo, originalCommit: head, include,
  taskPrompt: 'Do the bounded task.', taskId: 'PROJECT-01',
  verificationPlan: 'bound', backingRoot,
});

test('repository-local executable clean filters are refused before status', async t => {
  const {root,repo}=await makeRepo(t,{'src/a.mjs':'export const a = 1;\n'});
  const helper=path.join(root,'filter.sh'),marker=path.join(root,'filter-ran'),attrs=path.join(root,'attributes');
  await fs.writeFile(helper,'#!/bin/sh\nprintf ran > "$1"\ncat\n',{mode:0o755});
  await fs.writeFile(attrs,'* filter=fixture\n');
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  await git(['config','core.attributesFile',attrs],repo);
  await git(['config','filter.fixture.clean',quote(helper)+' '+quote(marker)],repo);
  await fs.writeFile(path.join(repo,'src/a.mjs'),'export const a = 2;\n');
  await assert.rejects(runGit(['status','--porcelain','--untracked-files=no'],repo),/git_local_helpers_refused/);
  await assert.rejects(fs.stat(marker),/ENOENT/);
});

test('canonical lowercase conditional includes cannot enable a clean filter', async t => {
  const {root,repo}=await makeRepo(t,{'src/a.mjs':'export const a = 1;\n','.gitattributes':'* filter=fixture\n'});
  const helper=path.join(root,'conditional-filter.sh'),marker=path.join(root,'conditional-filter-ran'),included=path.join(root,'included.config');
  await fs.writeFile(helper,'#!/bin/sh\nprintf ran > "$1"\ncat\n',{mode:0o755});
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  await run('git',['config','--file',included,'filter.fixture.clean',quote(helper)+' '+quote(marker)]);
  const gitdir=await fs.realpath(path.join(repo,'.git'));
  await git(['config','includeIf.gitdir:'+gitdir+'.path',included],repo);
  await fs.writeFile(path.join(repo,'src/a.mjs'),'export const a = 2;\n');
  await assert.rejects(runGit(['status','--porcelain','--untracked-files=no'],repo),/git_local_helpers_refused/);
  await assert.rejects(fs.stat(marker),/ENOENT/);
});

test('existing destinations refuse before any mutation', async t => {
  const {root, repo, head} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;\n'});
  // Existing directory, existing file, and existing symlink all refuse.
  const existingDir = path.join(root, 'backing');
  await fs.mkdir(existingDir);
  await assert.rejects(PREP(repo, head, existingDir), /project_workspace_exists/);
  const existingFile = path.join(root, 'backing-file');
  await fs.writeFile(existingFile, 'caller state');
  await assert.rejects(PREP(repo, head, existingFile), /project_workspace_exists/);
  assert.equal(await fs.readFile(existingFile, 'utf8'), 'caller state');
  const linkTarget = path.join(root, 'link-target');
  await fs.mkdir(linkTarget);
  const linkPath = path.join(root, 'backing-link');
  await fs.symlink(linkTarget, linkPath);
  await assert.rejects(PREP(repo, head, linkPath), /project_workspace_exists/);
  assert.equal(await fs.realpath(linkPath), await fs.realpath(linkTarget));
  // Original checkout unchanged and no owned root was created.
  assert.equal((await git(['rev-parse', 'HEAD'], repo)).trim(), head);
  assert.equal((await git(['status', '--porcelain'], repo)).trim(), '');
});

test('source/destination equality and ancestor overlap refuse', async t => {
  const {root, repo, head} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;\n'});
  await assert.rejects(PREP(repo, head, repo), /overlap|exists/);
  await assert.rejects(PREP(repo, head, path.join(repo, 'backing')), /overlap/);
  // Repository nested under the destination root refuses as well.
  const outer = path.join(root, 'outer');
  await fs.mkdir(outer);
  const nested = path.join(outer, 'nested-repo');
  await fs.mkdir(nested);
  await run('git', ['init', '-q'], {cwd: nested});
  await fs.writeFile(path.join(nested, 'f.txt'), 'x');
  await run('git', ['add', '-A'], {cwd: nested});
  await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'nested'], {cwd: nested});
  const nestedHead = (await git(['rev-parse', 'HEAD'], nested)).trim();
  await assert.rejects(PREP(nested, nestedHead, outer), /overlap|exists/);
  assert.equal((await git(['rev-parse', 'HEAD'], repo)).trim(), head);
});

test('symlinked immediate parents refuse before mutation', async t => {
  const {root, repo, head} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;\n'});
  const real = path.join(root, 'real-parent');
  await fs.mkdir(real);
  const link = path.join(root, 'linked-parent');
  await fs.symlink(real, link);
  await assert.rejects(PREP(repo, head, path.join(link, 'backing')), /unsafe_parent/);
  // Nothing was created through the link.
  assert.deepEqual(await fs.readdir(real), []);
  assert.equal((await git(['rev-parse', 'HEAD'], repo)).trim(), head);
});

test('cleanup requires verified ownership and never removes foreign state', async t => {
  const {root, repo, head} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;\n'});
  const foreign = path.join(root, 'caller-existing');
  await fs.mkdir(foreign);
  await fs.writeFile(path.join(foreign, 'keep.txt'), 'caller data');
  await assert.rejects(cleanupProjectWorktrees(foreign), /foreign/);
  assert.equal(await fs.readFile(path.join(foreign, 'keep.txt'), 'utf8'), 'caller data');
  await assert.rejects(cleanupProjectWorktrees(path.join(root, 'missing')), /foreign|invalid/);
  // Owned roots clean up exactly once; a second cleanup refuses.
  const backing = path.join(root, 'backing');
  await PREP(repo, head, backing);
  await cleanupProjectWorktrees(backing);
  assert.ok(!await fs.lstat(backing).catch(() => null));
  await assert.rejects(cleanupProjectWorktrees(backing), /foreign|invalid/);
});

test('worktree .git gitdir and commondir stay inside the owned sanitized store', async t => {
  const {root, repo, head} = await makeRepo(t,
    {'src/a.mjs': 'export const a = 1;\n', 'README.md': 'public\n'},
    {secondCommit: true});
  const backing = path.join(root, 'backing');
  t.after(() => fs.rm(backing, {recursive: true, force: true}));
  const prep = await PREP(repo, head, backing);
  const backingRepoReal = await fs.realpath(prep.backingRepo);
  for (const arm of ['without', 'with']) {
    const gitlink = await fs.readFile(path.join(prep.worktrees[arm], '.git'), 'utf8');
    assert.match(gitlink, /^gitdir:/);
    assert.ok(!gitlink.includes(repo));
    const gitdir = path.resolve(prep.worktrees[arm], gitlink.slice('gitdir:'.length).trim());
    const gitdirReal = await fs.realpath(gitdir);
    assert.ok(gitdirReal === backingRepoReal || gitdirReal.startsWith(backingRepoReal + path.sep));
    const commondir = (await fs.readFile(path.join(gitdirReal, 'commondir'), 'utf8')).trim();
    assert.equal(await fs.realpath(path.resolve(gitdirReal, commondir)), backingRepoReal);
  }
  // Sanitized history is exactly one commit with no original commits.
  const count = (await git(['--git-dir=' + prep.backingRepo, 'rev-list', '--count', 'baseline'], root)).trim();
  assert.equal(count, '1');
  const armLog = await git(['log', '--format=%H', 'HEAD'], prep.worktrees.without);
  assert.ok(!armLog.includes(head));
  // Outer private manifest names both commits distinctly and is not committed.
  const manifest = JSON.parse(await fs.readFile(path.join(backing, '.project-manifest.json'), 'utf8'));
  assert.equal(manifest.original_commit, head);
  assert.equal(manifest.sanitized_commit, prep.sanitizedCommit);
  assert.notEqual(manifest.sanitized_commit, head);
  const baselineFiles = (await git(['--git-dir=' + prep.backingRepo, 'ls-tree', '-r', '--name-only', 'baseline'], root)).trim().split('\n');
  assert.ok(!baselineFiles.some(f => f.includes('manifest') || f.includes('sanitized-baseline')));
  // Owner nonce is recorded and distinct per preparation.
  const owner = JSON.parse(await fs.readFile(path.join(backing, '.owner.json'), 'utf8'));
  assert.match(owner.nonce, /^[a-f0-9]{32}$/);
  assert.equal(manifest.owner_nonce, owner.nonce);
});

test('count/total/per-file limits enforced during extraction with no partial state', async t => {
  const {root, repo, head} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;\n'.repeat(100)});
  const backing = path.join(root, 'backing');
  await assert.rejects(prepareProjectWorktrees({
    repoRoot: repo, originalCommit: head, include: ['src/'],
    taskPrompt: 'x', backingRoot: backing, limits: {maxTotalBytes: 10},
  }), /too_large/);
  assert.ok(!await fs.lstat(backing).catch(() => null), 'failed preparation leaves no partial root');
  const backing2 = path.join(root, 'backing2');
  await assert.rejects(prepareProjectWorktrees({
    repoRoot: repo, originalCommit: head, include: ['src/'],
    taskPrompt: 'x', backingRoot: backing2, limits: {maxFileBytes: 10},
  }), /too_large/);
  assert.ok(!await fs.lstat(backing2).catch(() => null));
});

test('synthetic fsmonitor and poisoned GIT_DIR never execute; source untouched', async t => {
  const {root, repo, head} = await makeRepo(t, {'src/a.mjs': 'export const a = 1;\n'});
  const marker = path.join(root, 'fsmonitor-marker');
  const helper = path.join(root, 'evil-fsmonitor.sh');
  await fs.writeFile(helper, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`, {mode: 0o755});
  await git(['config', 'core.fsmonitor', helper], repo);
  const poisoned = {...process.env, GIT_DIR: '/tmp/poison-dir', GIT_WORK_TREE: '/tmp/poison-work', GIT_INDEX_FILE: '/tmp/poison-index', GIT_NAMESPACE: 'poison'};
  // Hermetic env drops every inherited GIT_* override.
  const scrubbed = hermeticGitEnv(poisoned);
  assert.equal(scrubbed.GIT_DIR, undefined);
  assert.equal(scrubbed.GIT_WORK_TREE, undefined);
  assert.equal(scrubbed.GIT_CONFIG_NOSYSTEM, '1');
  // Freeze and preparation under poisoned env still bind the true commit.
  const frozen = await freezeProjectSource({repoRoot: repo, env: poisoned});
  assert.equal(frozen.originalCommit, head);
  const backing = path.join(root, 'backing');
  t.after(() => fs.rm(backing, {recursive: true, force: true}));
  const prep = await PREP(repo, head, backing);
  void prep;
  // Rewire env through the seam as well (some callers inject env only).
  await freezeProjectSource({repoRoot: repo, env: poisoned});
  assert.ok(!await fs.lstat(marker).catch(() => null), 'synthetic fsmonitor marker must never be created');
  assert.equal((await git(['rev-parse', 'HEAD'], repo)).trim(), head);
  assert.equal((await git(['status', '--porcelain'], repo)).trim(), '');
  await git(['config', '--unset', 'core.fsmonitor'], repo);
});

test('hermetic git refuses remote transports', async t => {
  await assert.rejects(runGit(['ls-remote', 'https://example.invalid/repo.git'], os.tmpdir()), /remote_refused/);
  await assert.rejects(runGit(['clone', 'git@example.invalid:x.git', 'out'], os.tmpdir()), /remote_refused/);
});

test('hidden ancestors excluded with narrow public exceptions; leaf check alone insufficient', async t => {
  assert.equal(classifyFile('src/.aws/config.json', 'project'), 'exclude');
  assert.equal(classifyFile('src/.ssh/known_hosts.txt', 'project'), 'exclude');
  assert.equal(classifyFile('src/.hidden/notes.md', 'project'), 'exclude');
  assert.equal(classifyFile('.hidden/notes.md', 'project'), 'exclude');
  assert.equal(classifyFile('.env', 'project'), 'exclude');
  assert.equal(classifyFile('.gitignore', 'project'), 'include');
  assert.equal(classifyFile('.env.example', 'project'), 'include');
  assert.equal(classifyFile('src/app.mjs', 'project'), 'include');
  assert.equal(classifyFile('LICENSE', 'project'), 'include');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-hidden-'));
  try {
    await fs.mkdir(path.join(root, 'src', '.hidden'), {recursive: true});
    await fs.writeFile(path.join(root, 'src', 'visible.mjs'), 'export const v = 1;\n');
    await fs.writeFile(path.join(root, 'src', '.hidden', 'notes.md'), 'private\n');
    const files = await collectArtifactFiles(root, 'project');
    assert.ok(files.some(f => f.path === 'src/visible.mjs'));
    assert.ok(!files.some(f => f.path.includes('.hidden')));
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('lstat-to-read symlink race refuses instead of leaking outside bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-race-'));
  try {
    const outside = path.join(root, 'outside-secret.txt');
    await fs.writeFile(outside, 'OUTSIDE-BYTES-SENTINEL');
    const ws = path.join(root, 'workspace');
    await fs.mkdir(ws, {recursive: true});
    // Listed as a real file first (lstat moment), then swapped for a symlink
    // before the read: the no-follow open must refuse.
    const victim = path.join(ws, 'data.txt');
    await fs.writeFile(victim, 'original\n');
    const {open} = await import('node:fs/promises');
    void open;
    const reader = (await import('../src/artifact-source.mjs')).readFileNoFollow;
    // Baseline: regular file reads fine.
    assert.equal(String(await reader(ws, 'data.txt')), 'original\n');
    await fs.rm(victim);
    await fs.symlink(outside, victim);
    await assert.rejects(reader(ws, 'data.txt'), /refused|ELOOP/);
    // A direct symlink read never returns outside bytes either.
    const files = await collectArtifactFiles(ws, 'project').catch(e => e);
    assert.match(String(files?.message ?? files), /refused/);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
