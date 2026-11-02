// project-task.mjs — trusted local-only project task profile + isolated worktrees (BUILD-04).
//
// The sample task remains the default. A project profile is selected before
// server startup; repository paths, revisions, commands and verification
// policy are never accepted from browser requests. An invalid profile
// refuses instead of silently falling back to the sample task.
//
// Source extraction reads only explicitly permitted committed public source
// via hermetic read-only git (ls-tree/show/rev-parse/status through
// src/git-ops.mjs, which scrubs inherited GIT_* overrides and forces
// core.fsmonitor=false, hooks-disabled and signing-disabled operation).
// The original checkout, branch and index are never mutated. A sanitized
// fresh private Git backing repository holds exactly ONE baseline commit;
// detached per-arm worktrees point at the backing store so original
// history/config/hooks/remotes stay inaccessible through .git. Failed
// preparation removes only verified-owned partial state and never leaves a
// registered worktree behind.
//
// Ownership rule: the backing root must not exist when preparation starts,
// none of its ancestors may be symlinks, and it must neither equal nor
// overlap the source checkout. Preparation creates the root exclusively and
// records an ownership nonce plus the root inode/device. Cleanup revalidates
// ownership (nonce + inode + device) and refuses foreign or caller-existing
// state instead of deleting it.
//
// Metadata rule: the frozen original commit and the sanitized baseline SHA
// are named distinctly in an outer private manifest (a sidecar file in the
// owned root, never committed). The sanitized commit itself carries only
// source plus the identical universal TASK.md; it is never labelled the
// original commit and no self-referential committed metadata names an
// earlier commit.
//
// Universal collaboration constraints are installed identically in both
// arms. Only the Presence arm receives the adapter-specific adaptive
// instructions (a short equivalent specific to actually exported coding
// controls: response_extent, unsolicited_update, conversation_style).
// Baseline retains no signal, Presence reads, observer instructions or
// adaptive policy.

import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {classifyFile, validateRelativePath, PROJECT_ARTIFACT_LIMITS as ARTIFACT_LIMITS} from './artifact-source.mjs';
import {runGit, runGitBuffer} from './git-ops.mjs';

export const PROJECT_PROFILE_VERSION = 1;
export const PROJECT_ARMS = Object.freeze(['without', 'with']);

export const UNIVERSAL_INSTRUCTIONS = Object.freeze(
`# Universal collaboration constraints (both arms)
- Work only inside this worktree. Do not install, delegate, commit or publish.
- Fixed task, source commit and verification plan are frozen; do not change them.
- Human approvals are once-only and require exact review of the proposed command.
- Rerun the public tests available in this worktree before handback. The harness runs any private frozen checks separately; do not claim those passed. Report behavior, validation and limitations.
- Budgets, consumed markers, finish admission and receipt behavior are unchanged.
`);

export const PRESENCE_ADAPTIVE_ADDENDUM = Object.freeze(
`# Presence-arm adaptive instructions (right arm only)
- Adapter-specific hook context may adjust only actually exported coding controls: response_extent (terse/standard/full), unsolicited_update (send/defer), conversation_style (self_contained/conversational).
- Never invent user state or personal traits.
- Missing or ineligible guidance uses ordinary behavior.
`);

const HEX40 = /^[0-9a-f]{40}$/;
const HASH64 = /^[a-f0-9]{64}$/;

function fail(reason) { throw Error(reason); }

export function validateProjectProfile(object) {
  if (!object || Array.isArray(object) || typeof object !== 'object') fail('project_profile_invalid');
  const allowed = new Set(['version', 'kind', 'repository', 'source', 'task', 'verification', 'limits', 'notes']);
  for (const key of Object.keys(object)) if (!allowed.has(key)) fail('project_profile_unknown_key');
  if (object.version !== 1) fail('project_profile_invalid');
  if (object.kind !== 'project') fail('project_profile_invalid');
  const repo = object.repository;
  if (!repo || typeof repo.root !== 'string' || !path.isAbsolute(repo.root)) fail('project_profile_repository_invalid');
  if (repo.commit !== undefined && repo.commit !== null && !HEX40.test(repo.commit)) fail('project_profile_commit_invalid');
  const source = object.source;
  if (!source || !Array.isArray(source.include) || !source.include.length) fail('project_profile_source_invalid');
  for (const entry of source.include) {
    if (typeof entry !== 'string' || !entry || path.isAbsolute(entry)) fail('project_profile_source_invalid');
    validateRelativePath(entry.replace(/\/$/, ''));
    if (entry.startsWith('-') || entry.includes('\0') || /[\x00-\x1f\x7f]/.test(entry)) fail('project_profile_source_invalid');
  }
  const task = object.task;
  if (!task || typeof task.prompt !== 'string' || !task.prompt.trim() || task.prompt.length > 14000) fail('project_profile_task_invalid');
  if (typeof task.id !== 'string' || !task.id.trim() || task.id.length > 128) fail('project_profile_task_invalid');
  const verification = object.verification;
  if (!verification || verification.mode !== 'project') fail('project_profile_verification_invalid');
  if (!Array.isArray(verification.own_tests) || !verification.own_tests.length) fail('project_profile_verification_invalid');
  for (const name of verification.own_tests) {
    if (typeof name !== 'string' || !name.endsWith('.test.mjs')) fail('project_profile_verification_invalid');
    validateRelativePath(name);
  }
  if (!verification.trusted || !Array.isArray(verification.trusted.tests) || !verification.trusted.tests.length) fail('project_profile_verification_invalid');
  for (const name of verification.trusted.tests) {
    if (typeof name !== 'string' || !name.endsWith('.test.mjs')) fail('project_profile_verification_invalid');
    validateRelativePath(name);
  }
  if (verification.trusted.plan_hash !== undefined && verification.trusted.plan_hash !== null && !HASH64.test(verification.trusted.plan_hash)) fail('project_profile_verification_invalid');
  if (verification.subset !== undefined && verification.subset !== true) fail('project_profile_verification_invalid');
  if (object.limits !== undefined) {
    if (!object.limits || typeof object.limits !== 'object') fail('project_profile_invalid');
    for (const [key, value] of Object.entries(object.limits)) {
      if (!['max_files', 'max_file_bytes', 'max_total_bytes'].includes(key)) fail('project_profile_invalid');
      if (!Number.isSafeInteger(value) || value <= 0 || value > 16 * 1024 * 1024) fail('project_profile_invalid');
      const ceiling={max_files:ARTIFACT_LIMITS.maxFiles,max_file_bytes:ARTIFACT_LIMITS.maxFileBytes,max_total_bytes:ARTIFACT_LIMITS.maxTotalBytes}[key];
      if(value>ceiling)fail('project_profile_invalid');
    }
  }
  return object;
}

export async function loadProjectProfile(profilePath, {readFile = fs.readFile} = {}) {
  let raw;
  try {
    raw = await readFile(profilePath, 'utf8');
  } catch {
    fail('project_profile_missing');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('project_profile_invalid');
  }
  return validateProjectProfile(parsed);
}

// Freeze once before either arm: exact source commit plus the complete
// trusted baseline bytes read from that commit. An explicitly supplied
// expected plan hash must match the frozen bytes; a null plan_hash means
// "freeze automatically from the selected commit" and the computed hash is
// returned for binding. Nothing here touches the working copy.
export async function freezeProjectPlan({profile, repoRoot = null, expectedPlanHash = undefined, runGitFn = null, env = process.env} = {}) {
  const validated = validateProjectProfile(profile);
  const root = path.resolve(repoRoot ?? validated.repository.root);
  if (!path.isAbsolute(root)) fail('project_repository_invalid');
  const st = await fs.lstat(root).catch(() => null);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) fail('project_repository_invalid');
  const run = runGitFn ?? ((args, cwd) => runGit(args, cwd, {env}));
  const head = String(await run(['rev-parse', 'HEAD'], root)).trim();
  if (!HEX40.test(head)) fail('project_source_unavailable');
  const wanted = validated.repository.commit ?? head;
  if (!HEX40.test(wanted)) fail('project_profile_commit_invalid');
  const kind = String(await run(['cat-file', '-t', wanted], root)).trim();
  if (kind !== 'commit') fail('project_source_unavailable');
  // Trusted baseline bytes come from the frozen commit, never the worktree.
  const trustedNames = [...validated.verification.trusted.tests].sort();
  const trustedFiles = {};
  for (const name of trustedNames) {
    validateRelativePath(name);
    const raw = runGitFn
      ? await run(['show', `${wanted}:${name}`], root)
      : await runGitBuffer(['show', `${wanted}:${name}`], root, {env});
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
    if (!bytes.length || bytes.length > ARTIFACT_LIMITS.maxFileBytes) fail('project_baseline_unavailable');
    trustedFiles[name] = bytes;
  }
  const {hashTrustedPlan} = await import('./verification-runner.mjs');
  const {planHash} = hashTrustedPlan(trustedFiles);
  const explicit = expectedPlanHash ?? validated.verification.trusted.plan_hash ?? null;
  if (explicit !== undefined && explicit !== null && explicit !== planHash) fail('project_baseline_hash_mismatch');
  return {
    profile: validated,
    universalInstructions: UNIVERSAL_INSTRUCTIONS,
    presenceAddendum: PRESENCE_ADAPTIVE_ADDENDUM,
    repoRoot: root,
    originalCommit: wanted,
    headCommit: head,
    taskId: validated.task.id,
    taskPrompt: validated.task.prompt,
    include: [...validated.source.include],
    ownTests: [...validated.verification.own_tests],
    trustedFiles,
    trustedTestNames: trustedNames,
    expectedPlanHash: planHash,
    limits: {
      maxFiles: validated.limits?.max_files ?? ARTIFACT_LIMITS.maxFiles,
      maxFileBytes: validated.limits?.max_file_bytes ?? ARTIFACT_LIMITS.maxFileBytes,
      maxTotalBytes: validated.limits?.max_total_bytes ?? ARTIFACT_LIMITS.maxTotalBytes,
    },
  };
}

export async function freezeProjectSource({repoRoot, commit = null, execGit = null, lstat = fs.lstat, env = process.env} = {}) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) fail('project_repository_invalid');
  const st = await lstat(repoRoot).catch(() => null);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) fail('project_repository_invalid');
  // execGit is a narrow fixture seam for offline tests; production always
  // uses the shared hermetic runner below.
  const run = execGit ?? ((args, cwd) => runGit(args, cwd, {env}));
  const head = String(await run(['rev-parse', 'HEAD'], repoRoot)).trim();
  if (!HEX40.test(head)) fail('project_source_unavailable');
  const wanted = commit ?? head;
  if (!HEX40.test(wanted)) fail('project_profile_commit_invalid');
  // Verify the frozen commit exists without mutating anything.
  const kind = String(await run(['cat-file', '-t', wanted], repoRoot)).trim();
  if (kind !== 'commit') fail('project_source_unavailable');
  const branch = String(await run(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).catch(() => 'HEAD')).trim();
  const status = String(await run(['status', '--porcelain', '--untracked-files=all'], repoRoot)).trim();
  // Untracked/ignored sentinels must not travel: require a clean checkout so the
  // frozen commit fully describes the working copy.
  if (status) fail('project_source_dirty');
  return {originalCommit: wanted, headCommit: head, branch: branch || 'HEAD'};
}

const OWNER_FILE = '.owner.json';
const MANIFEST_FILE = '.project-manifest.json';
// Authority comes from creation in this process, never a caller-forged file.
const ownedRoots = new Map();

async function realpathOrNull(target) {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}

// All pre-mutation filesystem checks. Nothing is created, removed or
// modified before every check here passes.
async function assertSafeDestination({repoRoot, backingRoot}) {
  const repoResolved = path.resolve(repoRoot);
  const backingResolved = path.resolve(backingRoot);
  if (repoResolved === backingResolved) fail('project_workspace_overlap');
  const repoStat = await fs.lstat(repoResolved).catch(() => null);
  if (!repoStat || repoStat.isSymbolicLink() || !repoStat.isDirectory()) fail('project_repository_invalid');
  // Existing destinations are never adopted or deleted: refuse outright.
  const existing = await fs.lstat(backingResolved).catch(() => null);
  if (existing) fail('project_workspace_exists');
  const parent = path.dirname(backingResolved);
  const parentStat = await fs.lstat(parent).catch(() => null);
  if (!parentStat || !parentStat.isDirectory()) fail('project_workspace_unsafe_parent');
  // A symlinked immediate parent would steer exclusive creation outside the
  // intended tree: refuse before any mutation. Higher system ancestors
  // (macOS /var and /tmp links) are resolved to their real locations below
  // and every resolved ancestor must be a real directory, so creation cannot
  // be steered anywhere the overlap and post-creation checks do not cover.
  if (parentStat.isSymbolicLink()) fail('project_workspace_unsafe_parent');
  let cursor = parent;
  for (;;) {
    const real = await realpathOrNull(cursor);
    if (!real) fail('project_workspace_unsafe_parent');
    const st = await fs.lstat(real).catch(() => null);
    if (!st || st.isSymbolicLink() || !st.isDirectory()) fail('project_workspace_unsafe_parent');
    const next = path.dirname(real);
    if (next === real) break;
    cursor = next;
  }
  // Source/destination equality or ancestor overlap in either direction.
  const repoReal = await realpathOrNull(repoResolved);
  const parentReal = await realpathOrNull(parent);
  if (!repoReal || !parentReal) fail('project_repository_invalid');
  const backingReal = path.join(parentReal, path.basename(backingResolved));
  const inside = (child, ancestor) => child === ancestor || child.startsWith(ancestor + path.sep);
  if (inside(backingReal, repoReal) || inside(repoReal, backingReal)) fail('project_workspace_overlap');
  return {repoResolved, backingResolved, repoReal, backingReal, parentReal};
}

async function writeOwnedRoot(backingResolved) {
  // Exclusive creation: fails if anything appeared since the pre-check.
  await fs.mkdir(backingResolved, {mode: 0o700});
  const st = await fs.lstat(backingResolved);
  if (st.isSymbolicLink() || !st.isDirectory()) fail('project_workspace_invalid');
  const nonce = randomBytes(16).toString('hex');
  const owner = {nonce, ino: st.ino, dev: st.dev, created_at: new Date().toISOString()};
  const real = await fs.realpath(backingResolved);
  ownedRoots.set(real, owner);
  try {
    await fs.writeFile(path.join(backingResolved, OWNER_FILE), JSON.stringify(owner), {flag: 'wx', mode: 0o600});
  } catch (error) {
    const current = await fs.lstat(backingResolved).catch(() => null);
    if (current && !current.isSymbolicLink() && current.ino === owner.ino && current.dev === owner.dev) await fs.rm(backingResolved, {recursive: true, force: true});
    ownedRoots.delete(real);
    throw error;
  }
  return owner;
}

async function assertOwnedRoot(backingRoot) {
  if (typeof backingRoot !== 'string' || !path.isAbsolute(backingRoot)) fail('project_workspace_invalid');
  const resolved = path.resolve(backingRoot);
  const st = await fs.lstat(resolved).catch(() => null);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) fail('project_workspace_foreign');
  const real = await fs.realpath(resolved);
  const expected = ownedRoots.get(real);
  if (!expected || expected.ino !== st.ino || expected.dev !== st.dev) fail('project_workspace_foreign');
  const ownerPath = path.join(resolved, OWNER_FILE);
  const ownerStat = await fs.lstat(ownerPath).catch(() => null);
  if (!ownerStat || ownerStat.isSymbolicLink() || !ownerStat.isFile()) fail('project_workspace_foreign');
  let owner;
  try {
    owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
  } catch {
    fail('project_workspace_foreign');
  }
  if (!owner || owner.nonce !== expected.nonce) fail('project_workspace_foreign');
  if (owner.ino !== st.ino || owner.dev !== st.dev) fail('project_workspace_foreign');
  return {resolved, owner};
}

async function removeOwnedRoot(resolved) {
  // Only the verified-owned root is removed; ancestor position was fixed by
  // assertOwnedRoot (absolute, resolved, non-symlink directory).
  await assertOwnedRoot(resolved);
  const real = await fs.realpath(resolved);
  await fs.rm(resolved, {recursive: true, force: true});
  ownedRoots.delete(real);
}

export async function prepareProjectWorktrees({
  repoRoot, originalCommit, include, taskPrompt, taskId = 'project-task',
  verificationPlan = null, backingRoot, arms = [...PROJECT_ARMS],
  execGit = null, env = process.env, limits = {},
} = {}) {
  if (!HEX40.test(originalCommit ?? '')) fail('project_source_unavailable');
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) fail('project_repository_invalid');
  if (typeof backingRoot !== 'string' || !path.isAbsolute(backingRoot)) fail('project_workspace_invalid');
  if (!Array.isArray(include) || !include.length) fail('project_profile_source_invalid');
  if (typeof taskPrompt !== 'string' || !taskPrompt.trim()) fail('project_profile_task_invalid');
  if (!Array.isArray(arms) || !arms.length || arms.some(a => !PROJECT_ARMS.includes(a))) fail('project_workspace_invalid');
  for (const entry of include) {
    if (typeof entry !== 'string' || !entry) fail('project_profile_source_invalid');
    validateRelativePath(entry.replace(/\/$/, ''));
    if (entry.startsWith('-')) fail('project_profile_source_invalid');
  }
  for (const name of arms) {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) fail('project_workspace_invalid');
  }
  const maxFiles = limits.maxFiles ?? ARTIFACT_LIMITS.maxFiles;
  const maxFileBytes = limits.maxFileBytes ?? ARTIFACT_LIMITS.maxFileBytes;
  const maxTotalBytes = limits.maxTotalBytes ?? ARTIFACT_LIMITS.maxTotalBytes;
  for (const value of [maxFiles, maxFileBytes, maxTotalBytes]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 16 * 1024 * 1024) fail('project_profile_invalid');
  }
  if(maxFiles>ARTIFACT_LIMITS.maxFiles||maxFileBytes>ARTIFACT_LIMITS.maxFileBytes||maxTotalBytes>ARTIFACT_LIMITS.maxTotalBytes)fail('project_profile_invalid');
  // ---- pre-mutation checks (no mutation before all pass) ----
  const {repoReal, backingReal} = await assertSafeDestination({repoRoot, backingRoot});
  // execGit is a narrow fixture seam for offline tests; production always
  // uses the shared hermetic runner (scrubbed GIT_*, fsmonitor off).
  const run = execGit ?? ((args, cwd, options = {}) => runGit(args, cwd, {env, ...options}));
  const runRaw = execGit
    ? (async (args, cwd) => run(args, cwd))
    : (async (args, cwd) => { await runGit(args, cwd, {env}); return ''; });
  const owner = await writeOwnedRoot(path.resolve(backingRoot));
  const backingResolved = path.resolve(backingRoot);
  const staging = path.join(backingResolved, '.staging-source');
  const backingRepo = path.join(backingResolved, 'backing.git');
  let completed = false;
  try {
    // 1. Enumerate committed entries (read-only in the original).
    const tree = String(await run(['ls-tree', '-r', '-z', originalCommit], repoReal));
    const entries = [];
    for (const record of tree.split('\0')) {
      if (!record) continue;
      const tab = record.indexOf('\t');
      if (tab < 0) fail('project_source_unavailable');
      const meta = record.slice(0, tab).split(' ');
      const rel = record.slice(tab + 1);
      const mode = meta[0], type = meta[1];
      if (type === 'commit') fail('project_source_submodule_refused');
      if (mode === '120000') fail('project_source_symlink_refused');
      if (type !== 'blob') fail('project_source_unsafe');
      entries.push(rel);
    }
    // 2. Keep only explicitly permitted committed public source.
    const wanted = entries.filter(rel => include.some(prefix => {
      const clean = prefix.replace(/\/$/, '');
      return rel === clean || rel.startsWith(clean + '/');
    }));
    if (!wanted.length) fail('project_source_empty');
    // 3. Validate + copy via `git show` (never checkout/reset the original).
    // Count/total/per-file limits are enforced DURING extraction, so an
    // oversized source refuses before any commit exists.
    await fs.mkdir(staging, {mode: 0o700});
    const manifest = [];
    let fileCount = 0, totalBytes = 0;
    for (const rel of wanted.sort()) {
      validateRelativePath(rel);
      const verdict = (() => { try { return classifyFile(rel, 'project'); } catch { return 'refuse'; } })();
      if (verdict === 'refuse') fail('project_source_unsafe');
      if (verdict === 'exclude') continue; // private control/secret paths stay out
      const body = await (async () => {
        if (execGit) {
          const out = await run(['show', `${originalCommit}:${rel}`], repoReal);
          return Buffer.isBuffer(out) ? out : Buffer.from(String(out));
        }
        return runGitBuffer(['show', `${originalCommit}:${rel}`], repoReal, {env});
      })();
      if (body.length > maxFileBytes) fail('project_source_too_large');
      fileCount += 1;
      totalBytes += body.length;
      if (fileCount > maxFiles || totalBytes > maxTotalBytes) fail('project_source_too_large');
      const target = path.join(staging, rel);
      await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
      await fs.writeFile(target, body, {flag: 'wx', mode: 0o600});
      manifest.push(rel);
    }
    if (!manifest.length) fail('project_source_empty');
    // 4. Fresh private backing repository with exactly ONE sanitized commit.
    await fs.mkdir(backingRepo, {mode: 0o700});
    await runRaw(['init', '--bare', backingRepo], backingResolved);
    const backingRealPath = await realpathOrNull(backingRepo);
    if (!backingRealPath || !backingRealPath.startsWith(backingReal + path.sep) && backingRealPath !== backingRepo) fail('project_workspace_failed');
    // These directories are created later by the native session and hook.
    // Keep them out of ordinary `git stash --include-untracked` without
    // adding files to, or modifying, the frozen project source. The bare
    // repository's private info/exclude applies to both detached worktrees.
    // This does not protect against `git stash --all` or explicit deletion.
    const gitInfo = path.join(backingRepo, 'info');
    await fs.mkdir(gitInfo, {recursive: true, mode: 0o700});
    await fs.writeFile(path.join(gitInfo, 'exclude'), '/.presence/\n/.muse/\n', {flag: 'wx', mode: 0o600});
    const work = path.join(backingResolved, '.commit-tmp');
    await fs.mkdir(work, {mode: 0o700});
    await runRaw(['init'], work);
    // Copy staged files into the commit workspace.
    const copy = async (src, dst) => {
      const st = await fs.lstat(src);
      if (st.isDirectory()) {
        await fs.mkdir(dst, {recursive: true, mode: 0o700});
        for (const entry of await fs.readdir(src)) await copy(path.join(src, entry), path.join(dst, entry));
      } else {
        await fs.copyFile(src, dst);
      }
    };
    await copy(staging, work + '/src-import');
    // Move import into place (avoid dotfile quirks by explicit walk).
    for (const rel of manifest) {
      const from = path.join(work, 'src-import', rel);
      const to = path.join(work, rel);
      await fs.mkdir(path.dirname(to), {recursive: true, mode: 0o700});
      await fs.rename(from, to);
    }
    await fs.rm(work + '/src-import', {recursive: true, force: true});
    // Universal instructions identical in both arms live in the baseline commit.
    await fs.writeFile(path.join(work, 'TASK.md'), `# Task ${taskId}\n\n${taskPrompt}\n\n${UNIVERSAL_INSTRUCTIONS}`);
    await runRaw(['add', '-A'], work);
    await runRaw(['-c', 'user.name=muse-harness', '-c', 'user.email=muse-harness@local', 'commit', '-m', `sanitized baseline of ${originalCommit}`], work);
    const sanitizedCommit = String(await run(['rev-parse', 'HEAD'], work)).trim();
    if (!HEX40.test(sanitizedCommit)) fail('project_workspace_failed');
    if (sanitizedCommit === originalCommit) fail('project_baseline_not_sanitized');
    // Push baseline into the bare backing store, then detach per-arm worktrees.
    await runRaw(['remote', 'add', 'backing', backingRepo], work);
    await runRaw(['push', 'backing', `HEAD:refs/heads/baseline`], work);
    const worktrees = {};
    for (const arm of arms) {
      const armPath = path.join(backingResolved, `arm-${arm}`);
      await runRaw(['--git-dir=' + backingRepo, 'worktree', 'add', '--detach', armPath, 'baseline'], backingResolved);
      // Per-arm files outside version control: universal already committed;
      // Presence arm alone gets the short adapter-specific addendum.
      await fs.writeFile(path.join(armPath, 'TASK.md'), `# Task ${taskId}\n\n${taskPrompt}\n\n${UNIVERSAL_INSTRUCTIONS}`);
      if (arm === 'with') {
        await fs.writeFile(path.join(armPath, 'PRESENCE-ADAPTER.md'), PRESENCE_ADAPTIVE_ADDENDUM);
      }
      // Detachment check: .git must be a gitlink into the private backing
      // store. Resolving the .git FILE's own path is not enough: the
      // referenced gitdir and its commondir must both be contained in the
      // owned sanitized store and must not reach the original checkout.
      const gitlink = await fs.readFile(path.join(armPath, '.git'), 'utf8').catch(() => null);
      if (!gitlink || !gitlink.startsWith('gitdir:') || gitlink.includes(repoReal) || gitlink.includes(repoRoot)) fail('project_worktree_not_detached');
      const gitdirRef = gitlink.slice('gitdir:'.length).trim();
      if (!gitdirRef) fail('project_worktree_not_detached');
      const gitdirResolved = path.resolve(armPath, gitdirRef);
      const gitdirReal = await realpathOrNull(gitdirResolved);
      const backingRepoReal = await realpathOrNull(backingRepo);
      if (!gitdirReal || !backingRepoReal) fail('project_worktree_not_detached');
      if (gitdirReal !== backingRepoReal && !gitdirReal.startsWith(backingRepoReal + path.sep)) fail('project_worktree_not_detached');
      if (gitdirReal === repoReal || gitdirReal.startsWith(repoReal + path.sep)) fail('project_worktree_not_detached');
      const commondirRaw = await fs.readFile(path.join(gitdirReal, 'commondir'), 'utf8').catch(() => null);
      if (!commondirRaw) fail('project_worktree_not_detached');
      const commondirReal = await realpathOrNull(path.resolve(gitdirReal, commondirRaw.trim()));
      if (commondirReal !== backingRepoReal) fail('project_worktree_not_detached');
      worktrees[arm] = armPath;
    }
    await fs.rm(work, {recursive: true, force: true});
    await fs.rm(staging, {recursive: true, force: true});
    // Outer private manifest (sidecar in the owned root, never committed):
    // names the frozen original commit and the sanitized baseline distinctly
    // and fixes the baseline ref for later Git artifact operations.
    const manifestBody = {
      version: 1,
      original_commit: originalCommit,
      sanitized_commit: sanitizedCommit,
      baseline_ref: 'baseline',
      backing_repo: backingRepo,
      task_id: taskId,
      verification_plan: verificationPlan ? 'bound' : 'unbound',
      owner_nonce: owner.nonce,
    };
    await fs.writeFile(path.join(backingResolved, MANIFEST_FILE), JSON.stringify(manifestBody, null, 2), {flag: 'wx', mode: 0o600});
    completed = true;
    return {
      originalCommit,
      sanitizedCommit,
      backingRepo,
      manifestPath: path.join(backingResolved, MANIFEST_FILE),
      baselineRef: 'baseline',
      worktrees,
      universalInstructions: UNIVERSAL_INSTRUCTIONS,
      presenceAddendum: PRESENCE_ADAPTIVE_ADDENDUM,
    };
  } finally {
    if (!completed) {
      // Failed preparation removes only verified-owned partial state, and
      // never leaves a registered worktree behind.
      try {
        await assertOwnedRoot(backingResolved);
        await removeOwnedRoot(backingResolved);
      } catch {
        // Foreign or already-removed state is left untouched.
      }
    }
  }
}

export async function cleanupProjectWorktrees(backingRoot, {execGit = null, env = process.env} = {}) {
  // Verified ownership first: caller-existing or foreign state is never
  // removed. Missing/invalid ownership refuses instead of deleting.
  const {resolved, owner} = await assertOwnedRoot(backingRoot);
  void owner;
  const backingRepo = path.join(resolved, 'backing.git');
  // Best-effort unregistration of per-arm worktrees through the owned store
  // before removing the root, so no registered worktree survives.
  try {
    const run = execGit ?? ((args, cwd) => runGit(args, cwd, {env}));
    const list = String(await run(['--git-dir=' + backingRepo, 'worktree', 'list', '--porcelain'], resolved)).trim();
    for (const line of list.split('\n')) {
      const match = /^worktree (.+)$/.exec(line.trim());
      if (!match) continue;
      const armPath = match[1];
      const armResolved = path.resolve(armPath);
      if (armResolved === resolved || !armResolved.startsWith(resolved + path.sep)) continue;
      try {
        await run(['--git-dir=' + backingRepo, 'worktree', 'remove', '--force', armPath], resolved);
      } catch {}
    }
  } catch {}
  await removeOwnedRoot(resolved);
}
