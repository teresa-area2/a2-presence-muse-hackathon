import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {linuxSandboxInvocation,linuxSandboxProbe,verificationCapability} from '../src/linux-verification-sandbox.mjs';

const input = {node:'/opt/node/bin/node',snapshot:'/private/candidate',scratch:'/private/scratch',args:['--test','test/example.test.mjs'],environment:{HOME:'/owner',META_API_KEY:'SYNTHETIC',NODE_OPTIONS:'unsafe',A2_CANDIDATE_WORKSPACE:'/private/candidate'}};
test('Linux verifier exposes only the frozen source, runtime libraries, Node and scratch; no credentials or host sockets',()=>{
  const command=linuxSandboxInvocation(input),args=command.args;
  assert.equal(command.file,'/usr/bin/bwrap');
  for(const flag of ['--unshare-user','--unshare-net','--unshare-pid','--unshare-ipc','--unshare-uts','--die-with-parent','--new-session','--clearenv'])assert.ok(args.includes(flag));
  const binds=[];for(let i=0;i<args.length;i++)if(['--bind','--ro-bind','--ro-bind-try'].includes(args[i]))binds.push(args.slice(i,i+3));
  assert.deepEqual(binds.filter(b=>b[0]==='--bind'),[['--bind','/private/scratch','/scratch']]);
  assert.ok(binds.some(b=>b.join('|')==='--ro-bind|/private/candidate|/work'));
  assert.ok(binds.some(b=>b.join('|')==='--ro-bind|/opt/node/bin/node|/runtime/node'));
  assert.ok(!binds.some(b=>['/','/home','/run','/etc','/tmp','/var/run/docker.sock'].includes(b[1])));
  assert.ok(!args.includes('--share-net'));assert.ok(!args.some(a=>a.includes('SYNTHETIC')||a.includes('/owner')));
  const env={};for(let i=0;i<args.length;i++)if(args[i]==='--setenv')env[args[i+1]]=args[i+2];
  assert.equal(env.A2_CANDIDATE_WORKSPACE,'/work');assert.equal(env.HOME,'/scratch/home');assert.equal(env.NODE_OPTIONS,undefined);
  assert.deepEqual(args.slice(-4),['--','/runtime/node','--test','test/example.test.mjs']);
  assert.deepEqual(command.env,{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'});
});
test('Linux sandbox rejects unsafe paths and overlapping writable scratch',()=>{
  for(const patch of [{node:'node'},{snapshot:'relative'},{scratch:'/private/candidate/scratch'},{snapshot:'/private/scratch/source'},{scratch:'/private/candidate'},{args:['--test\0bad']}])assert.throws(()=>linuxSandboxInvocation({...input,...patch}),/verification_arguments_invalid/);
});
test('Linux qualification checks actual namespace separation and read-only source before printing readiness',()=>{
  const probe=linuxSandboxProbe({hostNetworkNamespace:'net:[1]',hostMountNamespace:'mnt:[1]',canary:'/private/host-secret'});
  const execute=({net='net:[2]',mnt='mnt:[2]',outside=false,writable=false}={})=>{
    let output='',scratchWrites=0;
    const fs={readlinkSync:p=>p.endsWith('/net')?net:mnt,existsSync:()=>outside,writeFileSync:p=>{if(p.startsWith('/work/')){if(!writable)throw Object.assign(Error('read only'),{code:'EROFS'});}else scratchWrites++;}};
    vm.runInNewContext(probe,{require:name=>name==='node:fs'?fs:assert,process:{env:{HOME:'/scratch/home'},stdout:{write:s=>output+=s}}});
    return{output,scratchWrites};
  };
  assert.deepEqual(execute(),{output:'MUSE_LINUX_SANDBOX_READY\n',scratchWrites:1});
  for(const settings of [{net:'net:[1]'},{mnt:'mnt:[1]'},{outside:true},{writable:true}])assert.throws(()=>execute(settings));
});
test('platform capability distinguishes an optional Linux sandbox from unsupported native Windows',()=>{
  assert.equal(verificationCapability('darwin'),'requires_sandbox_check');
  assert.equal(verificationCapability('linux'),'requires_linux_sandbox_check');
  for(const os of ['win32','freebsd'])assert.equal(verificationCapability(os),'unsupported_platform');
});
