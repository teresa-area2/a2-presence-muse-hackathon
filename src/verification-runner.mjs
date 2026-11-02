import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {linuxSandboxInvocation,linuxSandboxProbe} from './linux-verification-sandbox.mjs';

const SANDBOX='/usr/bin/sandbox-exec',MAX_OUTPUT=256000;
const excluded=new Set(['.git','.presence','.muse','.verification']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sb=value=>JSON.stringify(value);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function profile({node,snapshot,scratch,acceptance}){
  // macOS26's dyld ignition opens root/cryptex directories before JavaScript.
  // These are OS loader resources; no user configuration/store is readable.
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec (literal ${sb(node)}))
(allow signal (target self) (target children))
(allow sysctl-read)
(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.dyld"))
(allow file-read-metadata)
(allow file-read*
 (literal "/") (literal "/private") (literal "/private/var")
 (literal "/System") (literal "/usr")
 (subpath "/System/Library") (subpath "/System/Cryptexes")
 (subpath "/usr/lib") (subpath "/usr/share/locale") (subpath "/usr/share/zoneinfo")
 (subpath "/private/preboot")
 (subpath "/Library/Caches/com.apple.dyld") (subpath "/private/var/db/dyld")
 (literal "/private/etc/localtime") (literal "/dev/null")
 (literal "/dev/urandom") (literal "/dev/random")
 (literal ${sb(node)}) (subpath ${sb(snapshot)}) (subpath ${sb(scratch)})
 (literal ${sb(acceptance)}))
(allow file-write* (subpath ${sb(scratch)}) (literal "/dev/null"))`;
}

async function snapshotSource(workspace,destination){
  const files=[];let total=0;
  async function walk(relative=''){
    for(const entry of await fs.readdir(path.join(workspace,relative),{withFileTypes:true})){
      if(!relative&&excluded.has(entry.name))continue;
      const rel=path.join(relative,entry.name),source=path.join(workspace,rel),info=await fs.lstat(source);
      if(info.isSymbolicLink()||rel.split(path.sep).length>8)throw Error('verification_source_unsafe');
      const target=path.join(destination,rel);
      if(info.isDirectory()){await fs.mkdir(target,{mode:0o700});await walk(rel);continue;}
      if(!info.isFile()||info.size>128000||files.length>=64||!/\.(m?js|json|md|txt)$/.test(rel))throw Error('verification_source_unsafe');
      const body=await fs.readFile(source);total+=body.length;
      if(total>512000)throw Error('verification_source_unsafe');
      await fs.writeFile(target,body,{flag:'wx',mode:0o400});files.push({path:rel,sha256:hash(body)});
    }
  }
  await walk();files.sort((a,b)=>a.path.localeCompare(b.path));
  return hash(JSON.stringify(files));
}
async function directoryMode(folder,mode){
  // Only directories created by this runner; never follow a link during cleanup.
  for(const entry of await fs.readdir(folder,{withFileTypes:true})){
    if(entry.isDirectory())await directoryMode(path.join(folder,entry.name),mode);
  }
  await fs.chmod(folder,mode);
}

async function boundedProcess({node,args,policy,cwd,env,deadline,onOutput,linux=false,scratch}){
  const remaining=deadline-performance.now();
  if(remaining<=0)return {code:1,reason:'verification_deadline'};
  let child,timer,killTimer,reason=null,code=null;
  const kill=signal=>{if(child?.pid)try{process.kill(-child.pid,signal);}catch{}};
  try{
    const invocation=linux?linuxSandboxInvocation({node,snapshot:cwd,scratch,args,environment:env}):{file:SANDBOX,args:['-p',policy,node,...args],env};
    child=spawn(invocation.file,invocation.args,{cwd,env:invocation.env,detached:true,stdio:['ignore','pipe','pipe']});
    const stop=why=>{if(reason)return;reason=why;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),100);};
    timer=setTimeout(()=>stop('verification_deadline'),remaining);
    const consume=chunk=>{if(onOutput(chunk)===false)stop('verification_output_limit');};
    child.stdout.on('data',consume);child.stderr.on('data',consume);
    const result=await new Promise(resolve=>{
      child.once('error',()=>resolve({code:1,reason:'verification_sandbox_unavailable'}));
      child.once('close',(exitCode,signal)=>resolve({code:exitCode??1,reason:reason??(signal?'verification_process_failed':null)}));
    });
    code=result.code;reason=result.reason;
  }finally{
    clearTimeout(timer);clearTimeout(killTimer);
    // A leader exit never proves its same-group children exited. Always clean
    // the exact group this runner created; never discover/kill foreign groups.
    kill('SIGTERM');await pause(75);kill('SIGKILL');
  }
  return {code,reason};
}

export async function runVerification({workspace,labRoot,node=process.execPath,artifactHash,deadlineMs=20000}={}){
  let temporary,snapshot,scratch;let output='',outputBytes=0;
  const fail=(reason,state='failed')=>({state,stdout:output+(output?'\n':'')+reason+'\n',exit_code:1});
  if(process.platform!=='darwin')return fail('verification_sandbox_unavailable','unavailable');
  if(!path.isAbsolute(workspace??'')||!path.isAbsolute(labRoot??'')||!/^[a-f0-9]{64}$/.test(artifactHash??'')||!Number.isSafeInteger(deadlineMs)||deadlineMs<100||deadlineMs>20000)return fail('verification_arguments_invalid');
  const deadline=performance.now()+deadlineMs;
  try{
    await fs.access(SANDBOX);node=await fs.realpath(node);
    if(!(await fs.stat(node)).isFile())return fail('verification_node_unavailable','unavailable');
    workspace=await fs.realpath(workspace);labRoot=await fs.realpath(labRoot);
    temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'muse-verification-')));await fs.chmod(temporary,0o700);
    snapshot=path.join(temporary,'source');scratch=path.join(temporary,'scratch');
    await fs.mkdir(snapshot,{mode:0o700});await fs.mkdir(scratch,{mode:0o700});
    const home=path.join(scratch,'home'),tmp=path.join(scratch,'tmp');
    await fs.mkdir(home,{mode:0o700});await fs.mkdir(tmp,{mode:0o700});
    if(await snapshotSource(workspace,snapshot)!==artifactHash)return fail('verification_reviewed_artifact_changed');
    const trusted=path.join(labRoot,'tests/common-task-acceptance.mjs');
    const trustedInfo=await fs.lstat(trusted);
    if(!trustedInfo.isFile()||trustedInfo.isSymbolicLink()||trustedInfo.size>128000)return fail('verification_acceptance_unsafe');
    const acceptance=path.join(temporary,'trusted-acceptance.mjs');
    await fs.writeFile(acceptance,await fs.readFile(trusted),{flag:'wx',mode:0o400});
    await directoryMode(snapshot,0o500);
    const env={HOME:home,TMPDIR:tmp,TMP:tmp,TEMP:tmp,PATH:path.dirname(node),LANG:'C',LC_ALL:'C',TZ:'UTC',A2_ACCEPTANCE_WORKSPACE:snapshot};
    const policy=profile({node,snapshot,scratch,acceptance});
    const consume=chunk=>{outputBytes+=chunk.length;if(outputBytes>MAX_OUTPUT)return false;output+=chunk.toString('utf8');return true;};
    // Qualify the actual sandbox invocation before running any reviewed source.
    let proof='';
    const qualified=await boundedProcess({node,args:['-e','process.stdout.write("MUSE_SANDBOX_READY\\n")'],policy,cwd:snapshot,env,deadline,onOutput:chunk=>{proof+=chunk.toString('utf8');return proof.length<1024;}});
    if(qualified.code!==0||proof!=='MUSE_SANDBOX_READY\n')return fail('verification_sandbox_unavailable','unavailable');
    const ownFiles=(await fs.readdir(path.join(snapshot,'test'))).filter(name=>/^[\w.-]+\.test\.m?js$/.test(name)).sort().map(name=>'test/'+name);
    if(!ownFiles.length)return fail('verification_own_tests_missing');
    let failed=false;
    for(const args of [['--test',...ownFiles],['--test',acceptance]]){
      const result=await boundedProcess({node,args,policy,cwd:snapshot,env,deadline,onOutput:consume});
      if(result.code!==0)failed=true;
      if(result.reason)return fail(result.reason);
    }
    return {state:failed?'failed':'passed',stdout:output,exit_code:failed?1:0};
  }catch{return fail('verification_setup_failed');}
  finally{
    if(snapshot)await directoryMode(snapshot,0o700).catch(()=>{});
    if(temporary)await fs.rm(temporary,{recursive:true,force:true}).catch(()=>{});
  }
}

// ---- Project-mode verification (BUILD-04) ----
// Fixed Node arguments, no shell/npm scripts, installs, network or ambient
// credentials, against a read-only candidate snapshot with scratch-only
// writes. Project-owned tests run in the snapshot; frozen trusted baseline
// checks run in a separate read-only candidate overlay whose selected
// tests/helpers are replaced with frozen baseline bytes, so they exercise
// CANDIDATE source (never the original implementation). Missing
// package.json is valid. Changed plans, missing tests, content/hash
// mismatch and source mutation before/during verification all reject.
// No silent pass: empty own or trusted selections fail.

import {collectArtifactFilesWithBytes as collectProjectBytes, hashArtifactFiles as hashProjectFiles, validateRelativePath as validateProjectRel} from './artifact-source.mjs';

const HEX64 = /^[a-f0-9]{64}$/;

// Approved frozen-overlay paths: project-owned test selections only. Frozen
// baseline bytes may never overlay candidate implementation, configuration or
// secret-adjacent paths (src/, package.json, config, dotfiles). Every
// trusted entry must be a nonempty .test.mjs file under tests/ or test/.
const TRUSTED_OVERLAY_PREFIXES = Object.freeze(['tests/', 'test/']);

export function isApprovedTrustedPath(name) {
  if (typeof name !== 'string' || !name.endsWith('.test.mjs')) return false;
  try {
    validateProjectRel(name);
  } catch {
    return false;
  }
  if (!TRUSTED_OVERLAY_PREFIXES.some(prefix => name.startsWith(prefix))) return false;
  const base = name.split('/').pop();
  if (base.startsWith('.')) return false;
  return true;
}

export function hashTrustedFiles(trustedFiles) {
  if (!trustedFiles || Array.isArray(trustedFiles) || typeof trustedFiles !== 'object') throw Error('verification_trusted_plan_invalid');
  const names = Object.keys(trustedFiles);
  if (!names.length) throw Error('verification_trusted_tests_missing');
  const entries = names.map(name => {
    if (!isApprovedTrustedPath(name)) throw Error('verification_trusted_tests_missing');
    const body = trustedFiles[name];
    const bytes = typeof body === 'string' ? Buffer.from(body) : body;
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 128000) throw Error('verification_trusted_plan_invalid');
    return {path: name, sha256: hash(bytes)};
  }).sort((a, b) => a.path.localeCompare(b.path));
  return {entries, planHash: hash(JSON.stringify(entries))};
}

// Alias used by the project freeze path (plan bytes hashed from the frozen
// commit); identical deterministic content binding.
export const hashTrustedPlan = hashTrustedFiles;

function projectEnv({node, scratch}) {
  const home = path.join(scratch, 'home'), tmp = path.join(scratch, 'tmp');
  return {home, tmp, env: {HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp, PATH: path.dirname(node), LANG: 'C', LC_ALL: 'C', TZ: 'UTC'}};
}

export async function runProjectVerification({workspace, node = process.execPath, artifactHash, deadlineMs = 20000, ownTests = [], ownTestDiscovery = 'explicit', trustedFiles = {}, expectedPlanHash = null, runTests = null} = {}) {
  // ---- Synchronous immutable capture: independent copies of every live
  // input BEFORE the first await. trustedFiles is a caller-owned mutable
  // map: later mutation (or a late overlay compared against the same live
  // reference) must never change what this run hashed, bound or executed.
  // The trusted-suite hash binds its selected files and content. Both own
  // and trusted selections are captured before awaiting any I/O.
  let frozenOwn, frozenTrustedNames, frozenTrustedBytes, frozenPlanHash, frozenPlanEntries;
  try {
    if (!['explicit', 'node-default'].includes(ownTestDiscovery)) throw Error('verification_own_tests_missing');
    if (!Array.isArray(ownTests) || !ownTests.length) throw Error('verification_own_tests_missing');
    frozenOwn = [...ownTests].sort();
    for (const name of frozenOwn) {
      validateProjectRel(name);
      if (typeof name !== 'string' || !name.endsWith('.test.mjs')) throw Error('verification_own_tests_missing');
    }
    if (!trustedFiles || Array.isArray(trustedFiles) || typeof trustedFiles !== 'object') throw Error('verification_trusted_plan_invalid');
    frozenTrustedNames = Object.keys(trustedFiles).sort();
    if (!frozenTrustedNames.length) throw Error('verification_trusted_tests_missing');
    frozenTrustedBytes = new Map();
    for (const name of frozenTrustedNames) {
      if (!isApprovedTrustedPath(name)) throw Error('verification_trusted_tests_missing');
      const live = trustedFiles[name];
      const bytes = typeof live === 'string' ? Buffer.from(live) : live;
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 128000) throw Error('verification_trusted_plan_invalid');
      frozenTrustedBytes.set(name, Buffer.from(bytes));
    }
    frozenPlanEntries = frozenTrustedNames.map(name => ({path: name, sha256: hash(frozenTrustedBytes.get(name))}));
    frozenPlanHash = hash(JSON.stringify(frozenPlanEntries));
    if (typeof expectedPlanHash !== 'string' || frozenPlanHash !== expectedPlanHash) throw Error('verification_trusted_plan_changed');
  } catch (error) {
    const label = /trusted_tests_missing/.test(error.message) ? 'verification_trusted_tests_missing'
      : /own_tests_missing/.test(error.message) ? 'verification_own_tests_missing'
      : /trusted_plan_changed/.test(error.message) ? 'verification_trusted_plan_changed'
      : 'verification_trusted_plan_invalid';
    return {state: 'failed', stdout: label + '\n', exit_code: 1};
  }
  const frozenOwnArgs = ownTestDiscovery === 'node-default' ? ['--test'] : ['--test', ...frozenOwn];
  const frozenArtifactHash = artifactHash;
  const frozenDeadlineMs = deadlineMs;
  const frozenRunTests = runTests;

  let temporary, snapshot, overlay, scratch;
  let output = '', outputBytes = 0;
  const fail = (reason, state = 'failed') => ({state, stdout: output + (output ? '\n' : '') + reason + '\n', exit_code: 1});
  if (!path.isAbsolute(workspace ?? '') || !HEX64.test(frozenArtifactHash ?? '') || !Number.isSafeInteger(frozenDeadlineMs) || frozenDeadlineMs < 100 || frozenDeadlineMs > 20000) return fail('verification_arguments_invalid');
  const deadline = performance.now() + frozenDeadlineMs;
  const consume = chunk => {
    outputBytes += chunk.length;
    if (outputBytes > MAX_OUTPUT) return false;
    output += chunk.toString('utf8');
    return true;
  };
  try {
    node = await fs.realpath(node);
    if (!(await fs.stat(node)).isFile()) return fail('verification_node_unavailable', 'unavailable');
    workspace = await fs.realpath(workspace);
    temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'muse-project-verification-')));
    await fs.chmod(temporary, 0o700);
    snapshot = path.join(temporary, 'candidate'); overlay = path.join(temporary, 'overlay'); scratch = path.join(temporary, 'scratch');
    await fs.mkdir(snapshot, {mode: 0o700}); await fs.mkdir(overlay, {mode: 0o700}); await fs.mkdir(scratch, {mode: 0o700});
    const {home, tmp, env: baseEnv} = projectEnv({node, scratch});
    await fs.mkdir(home, {mode: 0o700}); await fs.mkdir(tmp, {mode: 0o700});
    // Capture source bytes ONCE with validated no-follow reads. These exact
    // bytes feed the manifest hash, the snapshot copy and (via the snapshot)
    // execution; paths are never reopened unchecked for the same review.
    const captured = await collectProjectBytes(workspace, 'project').catch(() => null);
    if (!captured || hashProjectFiles(captured.files) !== frozenArtifactHash) return fail('verification_reviewed_artifact_changed');
    const names = new Set(captured.files.map(f => f.path));
    for (const name of frozenOwn) {
      if (!names.has(name)) return fail('verification_own_tests_missing');
    }
    // Read-only candidate snapshot written from the captured bytes only.
    for (const entry of captured.files) {
      const target = path.join(snapshot, entry.path);
      await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
      await fs.writeFile(target, captured.bytes.get(entry.path), {flag: 'wx', mode: 0o400});
    }
    captured.bytes.clear();
    await directoryMode(snapshot, 0o500);
    // Gate: the EXACT complete snapshot hash must equal the reviewed
    // artifact hash BEFORE any candidate execution. A mismatch executes
    // nothing and prints no execution marker.
    const snapshotFiles = await collectProjectBytes(snapshot, 'project').catch(() => null);
    if (!snapshotFiles || hashProjectFiles(snapshotFiles.files) !== frozenArtifactHash) return fail('verification_reviewed_artifact_changed');
    // Separate overlay: candidate source plus FROZEN baseline test bytes
    // (the synchronously captured copies, never the live caller map).
    const copyInto = async (from, to) => {
      for (const entry of await fs.readdir(from, {withFileTypes: true})) {
        const src = path.join(from, entry.name), dst = path.join(to, entry.name);
        const st = await fs.lstat(src);
        if (st.isDirectory()) { await fs.mkdir(dst, {mode: 0o700}); await copyInto(src, dst); }
        else await fs.copyFile(src, dst);
      }
    };
    await copyInto(snapshot, overlay);
    for (const name of frozenTrustedNames) {
      const target = path.join(overlay, name);
      await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
      await fs.rm(target, {force: true});
      await fs.writeFile(target, frozenTrustedBytes.get(name), {flag: 'wx', mode: 0o400});
    }
    // Confirm the overlay carries frozen bytes (compared against the
    // immutable capture, not a mutable caller reference).
    for (const name of frozenTrustedNames) {
      if (hash(await fs.readFile(path.join(overlay, name))) !== hash(frozenTrustedBytes.get(name))) return fail('verification_trusted_plan_changed');
    }
    await directoryMode(overlay, 0o500);
    // runTests is a narrow fixture seam for offline tests only: production
    // calls pass no runner and always execute through the real platform
    // sandbox below. Fixture runners are never labelled sandbox or network
    // qualification.
    const run = frozenRunTests ?? (async ({args, cwd, env}) => {
      if (!['darwin','linux'].includes(process.platform)) return {code: 1, reason: 'verification_sandbox_unavailable', stdout: ''};
      const linux=process.platform==='linux',policy=linux?null:profile({node, snapshot: cwd, scratch, acceptance: cwd});
      let probe='process.stdout.write("MUSE_SANDBOX_READY\\n")',marker='MUSE_SANDBOX_READY\n';
      if(linux){
        const canary=path.join(temporary,'host-only-canary');await fs.writeFile(canary,'private verifier canary',{mode:0o600});
        probe=linuxSandboxProbe({hostNetworkNamespace:await fs.readlink('/proc/self/ns/net'),hostMountNamespace:await fs.readlink('/proc/self/ns/mnt'),canary});marker='MUSE_LINUX_SANDBOX_READY\n';
      }
      let proof = '';
      const qualified = await boundedProcess({node, args: ['-e', probe], policy, cwd, env, deadline, linux, scratch, onOutput: chunk => { proof += chunk.toString('utf8'); return proof.length < 4096; }});
      if (qualified.code !== 0 || proof !== marker) return {code: 1, reason: 'verification_sandbox_unavailable', stdout: ''};
      let runOutput = '';
      const result = await boundedProcess({node, args, policy, cwd, env, deadline, linux, scratch, onOutput: chunk => { runOutput += chunk.toString('utf8'); return consume(chunk); }});
      return {...result, stdout: runOutput};
    });
    let failed = false;
    // Trusted tests observe the candidate through the overlay: the candidate
    // workspace pointer aims INSIDE the overlay sandbox allowance, never at
    // the outside snapshot.
    const ownEnv = {...baseEnv, A2_CANDIDATE_WORKSPACE: snapshot};
    const trustedEnv = {...baseEnv, A2_CANDIDATE_WORKSPACE: overlay};
    for (const [args, cwd, env] of [[frozenOwnArgs, snapshot, ownEnv], [['--test', ...frozenTrustedNames], overlay, trustedEnv]]) {
      const result = await run({node, args, cwd, env, deadline});
      if (result && typeof result.stdout === 'string' && result.stdout && !output.includes(result.stdout)) {
        output += result.stdout;
      }
      if (!result || result.code !== 0) failed = true;
      if (result && result.reason) return fail(result.reason,result.reason==='verification_sandbox_unavailable'?'unavailable':'failed');
    }
    // Recheck after execution: mutation before/during verification rejects.
    const snapshotHashAfter = hashProjectFiles((await collectProjectBytes(snapshot, 'project').catch(() => null))?.files ?? []);
    if (snapshotHashAfter !== frozenArtifactHash) return fail('verification_source_mutated');
    return {state: failed ? 'failed' : 'passed', stdout: output, exit_code: failed ? 1 : 0, artifact_sha256: frozenArtifactHash, trusted_plan_hash: frozenPlanHash};
  } catch {
    return fail('verification_setup_failed');
  } finally {
    if (snapshot) await directoryMode(snapshot, 0o700).catch(() => {});
    if (overlay) await directoryMode(overlay, 0o700).catch(() => {});
    if (temporary) await fs.rm(temporary, {recursive: true, force: true}).catch(() => {});
  }
}
