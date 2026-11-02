// Credential-free, real-kernel qualification of the optional Linux Check code.
// It executes synthetic code only after the production sandbox's trusted probe.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {runProjectVerification,hashTrustedFiles} from '../src/verification-runner.mjs';
import {collectArtifactFilesWithBytes,hashArtifactFiles} from '../src/artifact-source.mjs';

if(process.platform!=='linux'){
  console.log(JSON.stringify({status:'unavailable',reason:'linux_kernel_required',platform:process.platform}));process.exitCode=2;
}else{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'a2-linux-sandbox-check-')),workspace=path.join(root,'project'),outside=path.join(root,'host-only');
  const server=net.createServer(c=>c.destroy());
  try{
    await fs.mkdir(path.join(workspace,'test'),{recursive:true,mode:0o700});await fs.writeFile(outside,'UNCHANGED',{mode:0o600});
    await fs.writeFile(path.join(workspace,'package.json'),'{"type":"module"}\n');await fs.writeFile(path.join(workspace,'value.mjs'),'export const value=42;\n');
    await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
    const own=`import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import net from 'node:net';import {value} from '../value.mjs';
test('own value',()=>assert.equal(value,42));
test('host files and credentials absent',()=>{assert.equal(fs.existsSync(${JSON.stringify(outside)}),false);assert.equal(fs.existsSync('/etc/passwd'),false);assert.equal(process.env.META_API_KEY,undefined);assert.equal(process.env.NODE_OPTIONS,undefined);});
test('source is read only and scratch permits writes',()=>{assert.throws(()=>fs.writeFileSync(new URL('../value.mjs',import.meta.url),'mutated'),e=>['EROFS','EACCES','EPERM'].includes(e.code));fs.writeFileSync(process.env.TMPDIR+'/allowed','scratch');});
test('host loopback unreachable',async()=>{await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port:${server.address().port}});socket.setTimeout(1000,()=>{socket.destroy();reject(Error('network timeout'));});socket.once('connect',()=>{socket.destroy();reject(Error('host network exposed'));});socket.once('error',e=>{if(['ECONNREFUSED','ENETUNREACH','EACCES','EPERM'].includes(e.code))resolve();else reject(e);});});});`;
    await fs.writeFile(path.join(workspace,'test/own.test.mjs'),own);
    const trustedFiles={'test/frozen.test.mjs':Buffer.from("import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../value.mjs';test('frozen acceptance',()=>assert.equal(value,42));")};
    const expectedPlanHash=hashTrustedFiles(trustedFiles).planHash;
    const options=async()=>{const captured=await collectArtifactFilesWithBytes(workspace,'project');try{return{workspace,artifactHash:hashArtifactFiles(captured.files),ownTests:['test/own.test.mjs'],trustedFiles,expectedPlanHash,deadlineMs:10000};}finally{captured.bytes.clear();}};
    const result=await runProjectVerification(await options());
    if(result.state!=='passed'){
      const unavailable=result.state==='unavailable'||result.stdout.includes('verification_sandbox_unavailable');
      console.log(JSON.stringify({status:unavailable?'unavailable':'failed',reason:unavailable?'bubblewrap_or_namespaces_unavailable':'synthetic_checks_failed',platform:process.platform,node:process.versions.node}));process.exitCode=unavailable?2:1;
    }else{
      if(await fs.readFile(outside,'utf8')!=='UNCHANGED'||await fs.readFile(path.join(workspace,'value.mjs'),'utf8')!=='export const value=42;\n')throw Error('host_source_changed');
      await fs.writeFile(path.join(workspace,'test/own.test.mjs'),"import {spawn} from 'node:child_process';spawn(process.execPath,['-e',\"const fs=require('node:fs');console.log('SYNTHETIC_PID_NAMESPACE='+fs.readlinkSync('/proc/self/ns/pid'));setInterval(()=>{},1000);\"],{stdio:'inherit'});setInterval(()=>{},1000);");
      const started=performance.now(),deadline=await runProjectVerification({...await options(),deadlineMs:1500});
      if(!deadline.stdout.includes('verification_deadline')||performance.now()-started>6000)throw Error('deadline_not_enforced');
      // Returning within the deadline is observable here. This does not by
      // itself prove every descendant exited; report that qualification apart.
      console.log(JSON.stringify({status:'passed',platform:process.platform,node:process.versions.node,backend:'bubblewrap',checks:['own_and_frozen_tests','host_files_hidden','source_read_only','scratch_writable','credentials_scrubbed','host_loopback_denied','deadline_enforced'],descendant_cleanup:'not_independently_qualified',model_calls:0,op_calls:0}));
    }
  }catch{console.log(JSON.stringify({status:'failed',reason:'linux_sandbox_check_failed'}));process.exitCode=1;}
  finally{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
}
