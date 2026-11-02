// Prepare the reviewed task battery from committed bytes. Browser requests select
// a registered ID; they never choose these repositories, refs or test programs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CODING_TASKS, DEFAULT_CODING_TASK, FREE_CODING_TASK, codingTaskProfile} from './coding-task-catalog.mjs';
import {runGit, runGitBuffer} from './git-ops.mjs';
import {freezeProjectPlan} from './project-task.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HEX40 = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;
const PRIVATE_TEST = 'test/frozen-acceptance.test.mjs';
const INITIAL_PROMPT = 'Please read TASK.md and CONTRACT.md, propose a short plan, and wait for my response before making changes.';
const fail = reason => {throw Error(reason);};

// Refuse links before mkdir/write. Destinations are private, caller-owned local
// directories, not silently adopted foreign/shared directories.
async function checkedDirectory(value, {create = false, privateDirectory = false} = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) fail('coding_task_directory_invalid');
  const absolute = path.resolve(value), parts = absolute.split(path.sep).filter(Boolean);
  let cursor = path.parse(absolute).root;
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    let st = await fs.lstat(cursor).catch(e => {if (e.code !== 'ENOENT') throw e; return null;});
    if (!st && create && index === parts.length - 1) {
      await fs.mkdir(cursor, {mode: 0o700});
      st = await fs.lstat(cursor);
    }
    if (!st || !st.isDirectory() || st.isSymbolicLink()) fail('coding_task_directory_invalid');
    if (index === parts.length - 1 && privateDirectory &&
        ((st.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && st.uid !== process.getuid()))) fail('coding_task_directory_invalid');
  }
  return fs.realpath(absolute);
}

function adaptAcceptance(bytes) {
  const source = bytes.toString('utf8');
  const pointer = 'process.env.TASK_PROJECT_DIR';
  const fallback = "new URL('../project/',import.meta.url)";
  if (source.split(pointer).length !== 2 || source.split(fallback).length !== 2) fail('coding_task_acceptance_invalid');
  return Buffer.from(source.replace(pointer, 'process.env.A2_CANDIDATE_WORKSPACE').replace(fallback, "new URL('../',import.meta.url)"));
}

export async function prepareCodingTaskProfiles({sourceRoot = ROOT, localRoot, commit, environment = process.env} = {}) {
  const source = await checkedDirectory(sourceRoot);
  if (commit !== undefined && (typeof commit !== 'string' || !HEX40.test(commit))) fail('coding_task_commit_invalid');
  const git = (args, cwd = source) => runGit(args, cwd, {env: environment});
  const fixtureCommit = commit ?? String(await git(['rev-parse', 'HEAD'])).trim();
  if (!HEX40.test(fixtureCommit) || String(await git(['cat-file', '-t', fixtureCommit])).trim() !== 'commit') fail('coding_task_commit_invalid');
  const tree = String(await git(['ls-tree', '-rlz', fixtureCommit, '--', 'coding-tasks']));
  const entries = new Map();
  for (const record of tree.split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([0-9a-f]{40})\s+(\d+|-)\t(.+)$/.exec(record);
    if (!match || entries.has(match[5])) fail('coding_task_source_invalid');
    entries.set(match[5], {mode: match[1], type: match[2], size: Number(match[4])});
  }
  async function readCommitted(relative) {
    const entry = entries.get(relative);
    if (!entry || !['100644', '100755'].includes(entry.mode) || entry.type !== 'blob') fail('coding_task_source_unsafe');
    if (!Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 128000) fail('coding_task_source_invalid');
    const bytes = await runGitBuffer(['show', `${fixtureCommit}:${relative}`], source, {env: environment, maxBuffer: 128000});
    if (bytes.length !== entry.size) fail('coding_task_source_invalid');
    return bytes;
  }
  let manifest;
  try {manifest = JSON.parse((await readCommitted('coding-tasks/manifest.json')).toString('utf8'));} catch {fail('coding_task_manifest_invalid');}
  if (typeof manifest.version !== 'string' || manifest.version.length > 48 || !VERSION.test(manifest.version) || !Array.isArray(manifest.tasks) || manifest.tasks.length !== CODING_TASKS.length) fail('coding_task_manifest_invalid');
  const manifestIds = new Set();
  for (const row of CODING_TASKS) {
    const found = manifest.tasks.filter(t => t?.id === row.id);
    if (found.length !== 1 || manifestIds.has(row.id) || found[0].agent_snapshot !== `tasks/${row.id}/project` || found[0].acceptance !== `tasks/${row.id}/checks/acceptance.test.mjs`) fail('coding_task_manifest_invalid');
    if (row.id === 'save-conflicts' ? found[0].supplemental_acceptance !== 'tasks/save-conflicts/checks/edge-cases.test.mjs' : Object.hasOwn(found[0], 'supplemental_acceptance')) fail('coding_task_manifest_invalid');
    manifestIds.add(row.id);
  }
  // Read/validate every required blob before creating any prepared repository.
  const captured = [];
  for (const row of CODING_TASKS) {
    const names = ['CONTRACT.md', 'TASK.md', 'package.json', row.sourceFile, 'test/behavior.test.mjs', 'test/smoke.test.mjs'];
    const files = new Map();
    for (const name of names) files.set(name, await readCommitted(`coding-tasks/tasks/${row.id}/project/${name}`));
    files.set(PRIVATE_TEST, adaptAcceptance(await readCommitted(`coding-tasks/tasks/${row.id}/checks/acceptance.test.mjs`)));
    if (row.id === 'save-conflicts') files.set('test/qualification-contract.test.mjs', await readCommitted('coding-tasks/tasks/save-conflicts/checks/edge-cases.test.mjs'));
    if ([...files.values()].reduce((total, bytes) => total + bytes.length, 0) > 524288) fail('coding_task_source_invalid');
    captured.push({row, files});
  }
  const freeFiles = new Map();
  for(const name of ['README.md','package.json']) freeFiles.set(name,await readCommitted('coding-tasks/free-workspace/'+name));
  const destination = await checkedDirectory(localRoot ?? path.join(source, '.local'), {create: true, privateDirectory: true});
  const registryRoot = await fs.mkdtemp(path.join(destination, 'coding-task-profiles-'));
  await fs.chmod(registryRoot, 0o700);
  const owned = await fs.lstat(registryRoot);
  let completed = false;
  try {
    const prepared = [];
    for (const {row, files} of captured) {
      const repo = path.join(registryRoot, row.id), profilePath = path.join(registryRoot, `${row.id}.json`);
      await fs.mkdir(repo, {mode: 0o700});
      for (const [relative, bytes] of files) {
        const target = path.join(repo, relative);
        await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
        await fs.writeFile(target, bytes, {flag: 'wx', mode: 0o600});
      }
      await git(['init', '-q'], repo);
      await git(['add', '--', '.'], repo);
      await git(['-c', 'user.name=Presence task preparation', '-c', 'user.email=task-preparation@invalid', 'commit', '-qm', 'Frozen coding task source'], repo);
      const sourceCommit = String(await git(['rev-parse', 'HEAD'], repo)).trim();
      const prompt = files.get('TASK.md').toString('utf8') + '\n\nRead CONTRACT.md. Run the public tests before handback. Frozen acceptance checks are run separately by the harness/facilitator and are not available in this worktree.\n';
      const profile = codingTaskProfile({id: row.id, repositoryRoot: repo, commit: sourceCommit, prompt});
      if (row.id === 'save-conflicts') profile.verification.trusted.tests.push('test/qualification-contract.test.mjs');
      const plan = await freezeProjectPlan({profile, env: environment});
      profile.verification.trusted.plan_hash = plan.expectedPlanHash;
      await fs.writeFile(profilePath, JSON.stringify(profile, null, 2) + '\n', {flag: 'wx', mode: 0o600});
      prepared.push(Object.freeze({
        id: row.id, title: row.title, description: row.description, profilePath, plan,
        metadata: Object.freeze({task_id: row.taskId, task_profile_id: row.id, fixture_commit: fixtureCommit, fixture_version: manifest.version, source_commit: sourceCommit, verification_plan_hash: plan.expectedPlanHash}),
        presentation: Object.freeze({taskBrief: {title: 'Coding task: ' + row.title, description: row.description, nextSteps: []}, taskPrompt: INITIAL_PROMPT}),
      }));
    }
    const freeRepo=path.join(registryRoot,FREE_CODING_TASK.id);
    await fs.mkdir(freeRepo,{mode:0o700});
    for(const[name,bytes]of freeFiles)await fs.writeFile(path.join(freeRepo,name),bytes,{mode:0o600,flag:'wx'});
    await git(['init','-q'],freeRepo);await git(['add','--','.'],freeRepo);
    await git(['-c','user.name=Presence task preparation','-c','user.email=task-preparation@invalid','commit','-qm','Clean user task workspace'],freeRepo);
    const freeCommit=String(await git(['rev-parse','HEAD'],freeRepo)).trim();
    const freeTask=Object.freeze({id:FREE_CODING_TASK.id,plan:Object.freeze({verificationMode:'none',repoRoot:freeRepo,originalCommit:freeCommit,taskId:FREE_CODING_TASK.taskId,include:['README.md','package.json'],taskPrompt:'This is a clean workspace for the user’s own coding task. The user will describe the goal in conversation. Understand the goal, agree on a sensible plan, implement and test the requested work. There is no predefined feature, solution or hidden acceptance suite. Work only in this workspace; keep normal command approvals.',ownTests:[],trustedFiles:{},expectedPlanHash:null,limits:{maxFiles:128,maxFileBytes:128000,maxTotalBytes:1048576}}),metadata:Object.freeze({task_id:FREE_CODING_TASK.taskId,task_profile_id:FREE_CODING_TASK.id,fixture_commit:fixtureCommit,fixture_version:manifest.version,source_commit:freeCommit,verification_plan_hash:null})});
    completed = true;
    return Object.freeze({defaultTask: DEFAULT_CODING_TASK, fixtureCommit, fixtureVersion: manifest.version, entries: Object.freeze(prepared), freeTask});
  } finally {
    if (!completed) {
      const current = await fs.lstat(registryRoot).catch(() => null);
      if (current?.isDirectory() && !current.isSymbolicLink() && current.ino === owned.ino && current.dev === owned.dev) await fs.rm(registryRoot, {recursive: true, force: true});
    }
  }
}
