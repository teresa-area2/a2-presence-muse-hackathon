// git-ops.mjs — one shared hermetic read-only Git invocation policy (BUILD-04).
//
// Every local Git subprocess in this repository (setup preflight, component
// loader, source freeze/extraction, backing-store/worktree preparation,
// artifact diff) goes through these helpers so the rules cannot drift:
//
// - inherited GIT_* location/config overrides are scrubbed (a poisoned
//   GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_NAMESPACE/GIT_COMMON_DIR or a
//   configured core.fsmonitor helper must never redirect reads/writes or
//   execute code). Only the narrow safe set below is set explicitly.
// - global/system configuration is disabled (GIT_CONFIG_NOSYSTEM=1 plus
//   empty global/system files); repository-local config is never trusted
//   for helpers, hooks, signing, attributes or transports.
// - core.fsmonitor is forced off, hooks path is /dev/null, commit/push
//   signing is off, templates/attributes are isolated, and textconv/ext-diff
//   are never invoked (diff callers pass --no-textconv --no-ext-diff).
// - no remote operations: only local paths and the synthetic private backing
//   store created by project-task.mjs. Callers must not add fetch/clone/push
//   to foreign URLs.
//
// Local synthetic backing transfer (file paths under an owned root created
// by prepareProjectWorktrees) is allowed; any argument that looks like a
// URL or a non-file transport refuses before spawning.

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);

const SCRUB_PREFIX = /^GIT_/;

// Explicitly safe GIT_* entries. Everything else inherited from the caller
// environment that starts with GIT_ is dropped.
const SAFE_GIT_ENV = Object.freeze({
  GIT_OPTIONAL_LOCKS: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TEMPLATE_DIR: '/dev/null',
  GIT_ATTR_NOSYSTEM: '1',
  GIT_CEILING_DIRECTORIES: '/',
});

const FORCED_CONFIG = Object.freeze([
  ['core.hooksPath', '/dev/null'],
  ['core.fsmonitor', 'false'],
  ['core.attributesFile', '/dev/null'],
  ['commit.gpgsign', 'false'],
  ['tag.gpgsign', 'false'],
  ['push.gpgsign', 'false'],
  ['core.sshCommand', 'false'],
  ['core.askpass', 'false'],
]);

const REMOTE_LIKE = /^(ssh:\/\/|https?:\/\/|git:\/\/|ftp:\/\/|ftps:\/\/|[^/@:]*@[^:]*:)/i;

function fail(reason) { throw Error(reason); }

export function hermeticGitEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (SCRUB_PREFIX.test(key)) continue;
    out[key] = value;
  }
  for (const [key, value] of Object.entries(SAFE_GIT_ENV)) out[key] = value;
  return out;
}

export function hermeticGitArgs(extra = []) {
  const args = [];
  for (const [key, value] of FORCED_CONFIG) args.push('-c', `${key}=${value}`);
  for (const entry of extra ?? []) {
    if (typeof entry !== 'string' || !entry) fail('git_arguments_invalid');
    args.push(entry);
  }
  return args;
}

function assertLocalOnly(args) {
  for (const entry of args) {
    if (typeof entry !== 'string') fail('git_arguments_invalid');
    if (REMOTE_LIKE.test(entry)) fail('git_remote_refused');
    if (/(^|[\s=,])--(upload-pack|receive-pack|exec)=/.test(entry)) fail('git_remote_refused');
  }
}

export async function runGit(args, cwd, {env = process.env, timeout = 15000, maxBuffer = 4 * 1024 * 1024, input = undefined, encoding = 'utf8'} = {}) {
  if (!Array.isArray(args) || !args.length) fail('git_arguments_invalid');
  const full = hermeticGitArgs(args);
  assertLocalOnly(full);
  const options = {cwd, env: hermeticGitEnv(env), timeout, maxBuffer};
  const locations=[];
  for(let i=0;i<args.length;i++) {
    if(args[i]==='-c'){i++;continue;}
    if(args[i].startsWith('--git-dir=')||args[i].startsWith('--work-tree=')){locations.push(args[i]);continue;}
    if(['--git-dir','--work-tree','-C'].includes(args[i])){locations.push(args[i],args[++i]);continue;}
    if(!args[i].startsWith('-'))break;
  }
  // Reading only key names cannot invoke a filter. Refuse local executable
  // filters/includes before status/add can consult attributes or helpers.
  try {
    const configured = await execute('git', hermeticGitArgs([...locations, 'config', '--local', '--no-includes', '--null', '--name-only', '--get-regexp', '^(filter\\..*\\.(clean|smudge|process)|include\\..*|includeif\\..*)$']), options);
    if (configured.stdout.trim()) fail('git_local_helpers_refused');
  } catch (error) {
    if (error.message === 'git_local_helpers_refused') throw error;
    // 1 means no matching key; 128 is expected only before git init.
    if (error.code !== 1 && !(error.code === 128 && args.includes('init'))) throw error;
  }
  if (encoding === 'buffer') options.encoding = 'buffer';
  if (input !== undefined) options.input = input;
  const result = await execute('git', full, options);
  return typeof result.stdout === 'string' || Buffer.isBuffer(result.stdout) ? result.stdout : String(result.stdout ?? '');
}

export async function runGitBuffer(args, cwd, options = {}) {
  return runGit(args, cwd, {...options, encoding: 'buffer'});
}
