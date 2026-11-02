import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import path from'node:path';import os from'node:os';import{spawn}from'node:child_process';
async function fixture(t,{slow=false,closeFails=false}={}){
 const d=await fs.mkdtemp(path.join(os.tmpdir(),'judge-start-test-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));for(const n of ['scripts','src','.local'])await fs.mkdir(path.join(d,n));
 await fs.copyFile(new URL('../scripts/judge-start.mjs',import.meta.url),path.join(d,'scripts/judge-start.mjs'));await fs.copyFile(new URL('../src/judge-access.mjs',import.meta.url),path.join(d,'src/judge-access.mjs'));
 await fs.copyFile(new URL('../src/judge-platform.mjs',import.meta.url),path.join(d,'src/judge-platform.mjs'));
 const profiles=`import fs from'node:fs/promises';import path from'node:path';export async function prepareCodingTaskProfiles({sourceRoot,environment}){await fs.writeFile(path.join(sourceRoot,'.local/setup.json'),JSON.stringify({op:environment.A2_MUSE_OP_CONFIG??null,live:environment.A2_MUSE_OP_LIVE,authorized:environment.A2_MUSE_CAPTURE_AUTHORIZED}));${slow?'await new Promise(r=>setTimeout(r,150));':''}return{};}`;
 await fs.writeFile(path.join(d,'src/coding-task-profiles.mjs'),profiles);
 await fs.writeFile(path.join(d,'structured-live.mjs'),`import http from'node:http';export const canonicalWorkspaceEnvironment=x=>x;export async function buildStructuredLauncher(options){await (await import('node:fs/promises')).writeFile(new URL('./.local/launch.json',import.meta.url),JSON.stringify({presentationGuidance:options.presentationGuidance,presentationVersion:options.presentationVersion}));const server=http.createServer((q,r)=>r.end('fixture'));return{server,reconcile(){},async close(){await new Promise(resolve=>server.close(()=>resolve()));${closeFails?"throw Error('fixture_close_failure');":''}}};}`);
 return d;
}
function run(d,args=[]){const c=spawn(process.execPath,['--experimental-strip-types',path.join(d,'scripts/judge-start.mjs'),'--port','0',...args],{cwd:d,env:process.env,stdio:['ignore','pipe','pipe']});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);const ended=new Promise((resolve,reject)=>{c.once('error',reject);c.once('close',(code,signal)=>resolve({code,signal,out,err}));});return{c,ended,output:()=>out};}
async function until(fn){const end=Date.now()+5000;while(Date.now()<end){const x=await fn();if(x)return x;await new Promise(r=>setTimeout(r,15));}throw Error('fixture_wait_timeout');}
async function bundle(d,{expired=false}={}){const f=path.join(d,'access.json');await fs.writeFile(f,JSON.stringify({schema_version:1,purpose:'hackathon-judge-evaluation',cipher:{registry:'https://registry.npmjs.org/',token:'npm_SYNTHETIC_VALUE',expires_at:'2099-01-01T00:00:00Z'},open_presence:{environment:'dev',client_id:'synthetic-client',client_secret:'SYNTHETIC_SECRET',expires_on:expired?'2000-01-01':'2099-01-01'}}));return f;}
test('no-consent ordinary launch needs no access file, including when an expired file is named',async t=>{for(const expired of [false,true]){const d=await fixture(t),args=expired?['--access',await bundle(d,{expired:true})]:[],r=run(d,args);t.after(()=>r.c.kill('SIGTERM'));await until(()=>r.output().includes('Judge workspace:'));const setup=JSON.parse(await fs.readFile(path.join(d,'.local/setup.json')));assert.deepEqual(setup,{op:null,live:'0',authorized:'0'});r.c.kill('SIGTERM');const end=await r.ended;assert.equal(end.code,0);assert.match(end.out,/Live Presence is off/);assert.ok(!end.out.includes('SYNTHETIC_SECRET'));}});
test('consented launch rejects expired OP access before constructing the app',async t=>{const d=await fixture(t),r=run(d,['--consent-typing','--access',await bundle(d,{expired:true})]);t.after(()=>r.c.kill('SIGTERM'));const end=await r.ended;assert.equal(end.code,1);assert.match(end.err,/judge_op_access_expired/);await assert.rejects(fs.stat(path.join(d,'.local/setup.json')),{code:'ENOENT'});});
test('SIGTERM during async setup waits and removes the private OP config',async t=>{const d=await fixture(t,{slow:true}),r=run(d,['--consent-typing','--access',await bundle(d)]);t.after(()=>r.c.kill('SIGTERM'));const setup=await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(d,'.local/setup.json')));}catch{return null;}});assert.ok(setup.op);r.c.kill('SIGTERM');const end=await r.ended;assert.equal(end.code,0);await assert.rejects(fs.stat(setup.op),{code:'ENOENT'});assert.ok(!end.out.includes('Judge workspace:'));});
test('app-close failure still removes private OP credentials',async t=>{const d=await fixture(t,{closeFails:true}),r=run(d,['--consent-typing','--access',await bundle(d)]);t.after(()=>r.c.kill('SIGTERM'));await until(()=>r.output().includes('Judge workspace:'));const setup=JSON.parse(await fs.readFile(path.join(d,'.local/setup.json')));assert.equal((await fs.stat(setup.op)).mode&511,384);r.c.kill('SIGTERM');const end=await r.ended;assert.equal(end.code,1);assert.match(end.err,/judge_cleanup_unconfirmed/);await assert.rejects(fs.stat(setup.op),{code:'ENOENT'});assert.ok(!end.err.includes('SYNTHETIC_SECRET'));});

test('judge entry selects the reviewed v3 textbox presentation path without dispatching a task',async t=>{const d=await fixture(t),r=run(d,['--consent-typing','--access',await bundle(d)]);t.after(()=>r.c.kill('SIGTERM'));await until(()=>r.output().includes('Judge workspace:'));const launch=JSON.parse(await fs.readFile(path.join(d,'.local/launch.json')));assert.deepEqual(launch,{presentationGuidance:true,presentationVersion:3});r.c.kill('SIGTERM');assert.equal((await r.ended).code,0);});


for(const phase of ['during setup','after listen'])test('SIGHUP '+phase+' closes only the fixture app and removes its copied OP config',async t=>{
 const d=await fixture(t,{slow:phase==='during setup'}),r=run(d,['--consent-typing','--access',await bundle(d)]);
 t.after(()=>r.c.kill('SIGTERM'));
 const setup=await until(async()=>{try{return JSON.parse(await fs.readFile(path.join(d,'.local/setup.json')));}catch{return null;}});
 assert.ok(setup.op);assert.match(path.basename(path.dirname(setup.op)),/^a2-judge-access-/);
 // The pre-fix hangup leaves this synthetic file; clean only this fixture's copy.
 t.after(()=>fs.rm(path.dirname(setup.op),{recursive:true,force:true}));
 if(phase==='after listen')await until(()=>r.output().includes('Judge workspace:'));
 r.c.kill('SIGHUP');const end=await r.ended;
 assert.equal(end.signal,null);assert.equal(end.code,0);
 await assert.rejects(fs.stat(setup.op),{code:'ENOENT'});
 if(phase==='during setup')assert.ok(!end.out.includes('Judge workspace:'));
 assert.doesNotMatch(end.out+end.err,/SYNTHETIC_SECRET|synthetic-client/);
});
