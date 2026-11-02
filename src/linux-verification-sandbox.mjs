// Optional Linux verifier. Missing bubblewrap or denied namespaces never fall
// back to direct execution. Only frozen source and private scratch are mounted.
import path from 'node:path';

export function verificationCapability(platform = process.platform) {
  if (platform === 'darwin') return 'requires_sandbox_check';
  if (platform === 'linux') return 'requires_linux_sandbox_check';
  return 'unsupported_platform';
}

export function linuxSandboxInvocation({node, snapshot, scratch, args, environment = {}}) {
  if (![node, snapshot, scratch].every(p => typeof p === 'string' && path.posix.isAbsolute(p) && !/[\0\r\n]/.test(p)) ||
      !Array.isArray(args) || args.some(a => typeof a !== 'string' || a.includes('\0')) ||
      snapshot === scratch || scratch.startsWith(snapshot + '/') || snapshot.startsWith(scratch + '/')) throw Error('verification_arguments_invalid');
  const flags = [
    '--die-with-parent', '--new-session', '--unshare-user', '--unshare-ipc',
    '--unshare-pid', '--unshare-net', '--unshare-uts', '--cap-drop', 'ALL', '--clearenv',
    '--ro-bind', '/usr/lib', '/usr/lib', '--ro-bind-try', '/usr/lib64', '/usr/lib64',
    '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/runtime',
    '--ro-bind', node, '/runtime/node', '--ro-bind', snapshot, '/work',
    '--bind', scratch, '/scratch', '--chdir', '/work',
  ];
  const env = {HOME: '/scratch/home', TMPDIR: '/scratch/tmp', TMP: '/scratch/tmp', TEMP: '/scratch/tmp', PATH: '/runtime', LANG: 'C', LC_ALL: 'C', TZ: 'UTC'};
  if (environment.A2_CANDIDATE_WORKSPACE === snapshot) env.A2_CANDIDATE_WORKSPACE = '/work';
  for (const [key, value] of Object.entries(env)) flags.push('--setenv', key, value);
  return {file: '/usr/bin/bwrap', args: [...flags, '--', '/runtime/node', ...args], env: {PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C'}};
}

// This trusted probe runs before any candidate. Check real namespaces and mount
// restrictions, not an echo from an unqualified child process.
export function linuxSandboxProbe({hostNetworkNamespace, hostMountNamespace, canary}) {
  if (![hostNetworkNamespace, hostMountNamespace, canary].every(x => typeof x === 'string' && x && !x.includes('\0'))) throw Error('verification_arguments_invalid');
  return `const fs=require('node:fs'),assert=require('node:assert/strict');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),${JSON.stringify(hostNetworkNamespace)});
assert.notEqual(fs.readlinkSync('/proc/self/ns/mnt'),${JSON.stringify(hostMountNamespace)});
assert.equal(fs.existsSync(${JSON.stringify(canary)}),false);
assert.throws(()=>fs.writeFileSync('/work/.sandbox-probe','blocked'),e=>['EROFS','EACCES','EPERM'].includes(e.code));
assert.equal(process.env.HOME,'/scratch/home');
assert.equal(process.env.NODE_OPTIONS,undefined);
fs.writeFileSync('/scratch/tmp/sandbox-probe','allowed');
process.stdout.write('MUSE_LINUX_SANDBOX_READY\\n');`;
}
