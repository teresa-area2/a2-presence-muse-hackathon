import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {runVerification} from '../src/verification-runner.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex');
const node = process.execPath;
async function fixture(t,source,own){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'muse-verifier-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspace'),labRoot=path.join(root,'lab');
 await fs.mkdir(path.join(workspace,'src'),{recursive:true});await fs.mkdir(path.join(workspace,'test'));await fs.mkdir(path.join(labRoot,'tests'),{recursive:true});
 await fs.writeFile(path.join(workspace,'package.json'),'{"type":"module"}');await fs.writeFile(path.join(workspace,'src/value.mjs'),source);
 await fs.writeFile(path.join(workspace,'test/value.test.mjs'),own);
 await fs.writeFile(path.join(labRoot,'tests/common-task-acceptance.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import path from 'node:path';const {value}=await import(pathToFileURL(path.join(process.env.A2_ACCEPTANCE_WORKSPACE,'src/value.mjs')));test('trusted acceptance',()=>assert.equal(value,42));`);
 const files=[];for(const rel of ['package.json','src/value.mjs','test/value.test.mjs'])files.push({path:rel,sha256:digest(await fs.readFile(path.join(workspace,rel)))});
 return {root,workspace,labRoot,node,artifactHash:digest(JSON.stringify(files))};
}
const benign=`import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/value.mjs';test('own test',()=>assert.equal(value,42));`;
const live={skip:process.platform!=='darwin',timeout:30000};

test('fixed sandbox runs reviewed own tests and independent trusted acceptance',live,async t=>{
 const options=await fixture(t,'export const value=42;',benign);
 const result=await runVerification(options);assert.equal(result.state,'passed',JSON.stringify(result));assert.match(result.stdout,/trusted acceptance/);assert.match(result.stdout,/own test/);
});
test('outside files, writes, network, commands and ambient credentials are denied',live,async t=>{
 const options=await fixture(t,'export const value=42;',benign);const outside=path.join(options.root,'outside.txt');await fs.writeFile(outside,'UNCHANGED');
 const own=`import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import net from 'node:net';import {spawnSync} from 'node:child_process';
test('outside read/write denied',()=>{assert.throws(()=>fs.readFileSync(${JSON.stringify(outside)}),/EPERM|EACCES/);assert.throws(()=>fs.writeFileSync(${JSON.stringify(outside)},'changed'),/EPERM|EACCES/);});
test('credential environment scrubbed',()=>{assert.equal(process.env.A2_VERIFIER_SECRET,undefined);assert.equal(process.env.NODE_OPTIONS,undefined);fs.writeFileSync(process.env.TMPDIR+'/allowed','scratch');});
test('other executable denied',()=>{const r=spawnSync('/bin/sh',['-c','exit 0']);assert.ok(r.error||r.status!==0);});
test('network denied',async()=>{await new Promise((resolve,reject)=>{const s=net.connect({host:'127.0.0.1',port:9});s.once('connect',()=>{s.destroy();reject(Error('network unexpectedly allowed'));});s.once('error',e=>{try{assert.match(e.code,/EPERM|EACCES/);resolve();}catch(x){reject(x);}});});});`;
 await fs.writeFile(path.join(options.workspace,'test/value.test.mjs'),own);
 const entries=[];for(const rel of ['package.json','src/value.mjs','test/value.test.mjs'])entries.push({path:rel,sha256:digest(await fs.readFile(path.join(options.workspace,rel)))});options.artifactHash=digest(JSON.stringify(entries));
 process.env.A2_VERIFIER_SECRET='SYNTHETIC_SECRET';t.after(()=>delete process.env.A2_VERIFIER_SECRET);
 const result=await runVerification(options);assert.equal(result.state,'passed',JSON.stringify(result));assert.equal(await fs.readFile(outside,'utf8'),'UNCHANGED');
});
test('source mutation fails and cannot change the original or trusted acceptance',live,async t=>{
 const own=`import test from 'node:test';import fs from 'node:fs';test('attempt source mutation',()=>fs.writeFileSync(new URL('../src/value.mjs',import.meta.url),'export const value=0;'));`;
 const options=await fixture(t,'export const value=42;',own),before=await fs.readFile(path.join(options.labRoot,'tests/common-task-acceptance.mjs'),'utf8');
 const result=await runVerification(options);assert.equal(result.state,'failed');assert.match(result.stdout,/EPERM|EACCES/);assert.match(result.stdout,/trusted acceptance/);
 assert.equal(await fs.readFile(path.join(options.workspace,'src/value.mjs'),'utf8'),'export const value=42;');assert.equal(await fs.readFile(path.join(options.labRoot,'tests/common-task-acceptance.mjs'),'utf8'),before);
});
test('stale reviewed artifact refuses all execution',live,async t=>{
 const options=await fixture(t,'export const value=42;',benign);await fs.writeFile(path.join(options.workspace,'src/value.mjs'),'export const value=0;');
 const result=await runVerification(options);assert.equal(result.state,'failed');assert.match(result.stdout,/reviewed_artifact_changed/);assert.doesNotMatch(result.stdout,/own test/);
});
test('shared deadline terminates an owned process and its same-group child',live,async t=>{
 const own=`import test from 'node:test';import {spawn} from 'node:child_process';test('leaves a child',()=>{spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});});`;
 const options=await fixture(t,'export const value=42;',own),start=performance.now();const result=await runVerification({...options,deadlineMs:1500});
 assert.equal(result.state,'failed');assert.match(result.stdout,/verification_deadline/);assert.ok(performance.now()-start<6000);
});
test('same-group child is cleaned even when the verification leader exits first',live,async t=>{
 const own=`import test from 'node:test';import {spawn} from 'node:child_process';test('leaves an unreferenced child',()=>{const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('SYNTHETIC_CHILD_PID='+c.pid);c.unref();});`;
 const options=await fixture(t,'export const value=42;',own),result=await runVerification(options);assert.equal(result.state,'passed',JSON.stringify(result));
 const pid=Number(/SYNTHETIC_CHILD_PID=(\d+)/.exec(result.stdout)?.[1]);assert.ok(Number.isSafeInteger(pid));
 let alive=true;for(let i=0;i<20&&alive;i++){try{process.kill(pid,0);await new Promise(r=>setTimeout(r,50));}catch(error){if(error.code!=='ESRCH')throw error;alive=false;}}
 assert.equal(alive,false,'owned same-group child survived leader exit');
});
test('output is bounded and its owned process is stopped on overflow',live,async t=>{
 const own=`import test from 'node:test';test('excess output',()=>{process.stdout.write('x'.repeat(300000));});`;
 const options=await fixture(t,'export const value=42;',own),result=await runVerification(options);assert.equal(result.state,'failed');assert.match(result.stdout,/verification_output_limit/);assert.ok(Buffer.byteLength(result.stdout)<257000);
});
test('unsupported platform or invalid configuration fails closed',async()=>{
 const result=await runVerification({workspace:'/missing',labRoot:'/missing',artifactHash:'invalid'});assert.notEqual(result.state,'passed');assert.equal(result.exit_code,1);
});
