import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runJudgeInstall} from '../src/judge-install-runner.mjs';
import {runJudgeCommand} from '../src/judge-process.mjs';

const sample={schema_version:1,purpose:'hackathon-judge-evaluation',cipher:{registry:'https://registry.npmjs.org/',token:'npm_SYNTHETIC_INSTALL_ONLY',expires_at:'2099-11-10T19:24:02.563Z'},open_presence:{environment:'dev',client_id:'synthetic',client_secret:'SYNTHETIC_OP_SECRET',expires_on:'2099-11-15'}};
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'judge-install-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const root=path.join(dir,'repo'),tmp=path.join(dir,'tmp'),npm=path.join(dir,'npm-cli.js'),accessPath=path.join(dir,'access.json');await fs.mkdir(root);await fs.mkdir(tmp);await fs.writeFile(npm,'');await fs.writeFile(accessPath,JSON.stringify(sample));return{dir,root,tmp,npm,accessPath,environment:{HOME:dir,PATH:process.env.PATH,npm_execpath:npm,npm_config_userconfig:'/synthetic-old-user-config',NPM_CONFIG_USERCONFIG:'/synthetic-old-uppercase-config',META_API_KEY:'SYNTHETIC_META_TOKEN',NPM_TOKEN:'SYNTHETIC_NPM_TOKEN',NODE_AUTH_TOKEN:'SYNTHETIC_NODE_TOKEN',npm_config_auth:'SYNTHETIC_CONFIG_TOKEN',NODE_OPTIONS:'SYNTHETIC_UNTRUSTED_OPTIONS',HTTPS_PROXY:'https://synthetic-proxy.invalid',TMPDIR:tmp}};}
const completed={status:'completed',cleanupSafe:true};
test('npm uses only the temporary config, which is removed before build and checks',async t=>{
 const f=await fixture(t),seen=[];let config;
 const result=await runJudgeInstall({...f,now:0,runCommand:async x=>{
  seen.push(x);for(const key of ['META_API_KEY','NPM_TOKEN','NODE_AUTH_TOKEN','npm_config_auth','NODE_OPTIONS'])assert.equal(x.environment[key],undefined);assert.equal(x.environment.HOME,f.dir);assert.equal(x.environment.PATH,f.environment.PATH);if(seen.length===1){assert.equal(x.environment.HTTPS_PROXY,f.environment.HTTPS_PROXY);config=x.environment.npm_config_userconfig;assert.ok(config&&!config.includes('synthetic-old'));assert.equal(x.environment.NPM_CONFIG_USERCONFIG,undefined);assert.match(await fs.readFile(config,'utf8'),/npm_SYNTHETIC_INSTALL_ONLY/);assert.ok(x.args.includes('--ignore-scripts'));}
  else{assert.equal(x.environment.HTTPS_PROXY,undefined);await assert.rejects(fs.stat(config),{code:'ENOENT'});assert.ok(!Object.keys(x.environment).some(k=>k.toLowerCase()==='npm_config_userconfig'));assert.ok(!JSON.stringify(x.environment).includes('SYNTHETIC_INSTALL_ONLY'));assert.ok(!JSON.stringify(x.environment).includes(config));}
  return completed;
 }});
 assert.equal(result.status,'installed');assert.equal(seen.length,4);await assert.rejects(fs.stat(path.dirname(config)),{code:'ENOENT'});
});
test('npm failure removes credentials and exposes only an allowed diagnostic',async t=>{
 const f=await fixture(t);let config;
 await assert.rejects(runJudgeInstall({...f,now:0,runCommand:async x=>{config=x.environment.npm_config_userconfig;return {status:'failed',code:'e401',cleanupSafe:true,stderr:'SYNTHETIC_INSTALL_ONLY /private/secret'};}}),e=>e.message==='judge_cipher_install_e401');
 await assert.rejects(fs.stat(config),{code:'ENOENT'});
});
test('failure after npm cleanup never recreates or forwards token config',async t=>{
 const f=await fixture(t);let config,count=0;
 await assert.rejects(runJudgeInstall({...f,now:0,runCommand:async x=>{count++;if(count===1){config=x.environment.npm_config_userconfig;return completed;}await assert.rejects(fs.stat(config),{code:'ENOENT'});throw Error('SYNTHETIC_INSTALL_ONLY /private/path');}}),e=>e.message==='judge_cipher_build_command_failed');assert.equal(count,2);
});
test('abort waits for the installer command to exit before removing its token',async t=>{
 const f=await fixture(t),abort=new AbortController();let config,done=false,release;const entered=new Promise(resolve=>{release=resolve;});
 const job=runJudgeInstall({...f,now:0,signal:abort.signal,runCommand:async x=>{config=x.environment.npm_config_userconfig;release();await new Promise(resolve=>x.signal.addEventListener('abort',resolve,{once:true}));assert.ok(await fs.stat(config));await new Promise(r=>setTimeout(r,30));done=true;return{status:'cancelled',cleanupSafe:true};}});
 await entered;abort.abort();await assert.rejects(job,/judge_install_cancelled/);assert.equal(done,true);await assert.rejects(fs.stat(config),{code:'ENOENT'});
});
test('unconfirmed child termination never deletes its credentials early',async t=>{
 const f=await fixture(t);let config;
 let failure,calls=0;
 await assert.rejects(runJudgeInstall({...f,now:0,runCommand:async x=>{calls++;config=x.environment.npm_config_userconfig;t.after(()=>fs.rm(path.dirname(config),{recursive:true,force:true}));return{status:'termination_unconfirmed',cleanupSafe:false};}}),error=>{failure=error;return error.message==='judge_access_cleanup_unconfirmed';});
 assert.equal(calls,1);assert.deepEqual(failure.recovery,{directory:path.dirname(config),process_termination:'unconfirmed'});
 assert.doesNotMatch(JSON.stringify(failure.recovery),/SYNTHETIC_INSTALL_ONLY|SYNTHETIC_OP_SECRET/);
 assert.equal((await fs.stat(config)).mode&0o777,0o600);assert.equal((await fs.stat(path.dirname(config))).mode&0o777,0o700);
 assert.ok(await fs.stat(config));await fs.rm(path.dirname(config),{recursive:true});
});
test('owned harmless child stops on abort before returning',async t=>{
 const f=await fixture(t),entry=path.join(f.dir,'wait.mjs');await fs.writeFile(entry,'setInterval(()=>{},1000)');const abort=new AbortController();const job=runJudgeCommand({entry,args:[],cwd:f.dir,environment:f.environment,signal:abort.signal,timeoutMs:10000});setTimeout(()=>abort.abort(),100);const r=await job;assert.equal(r.status,'cancelled');assert.equal(r.cleanupSafe,true);
});
test('CLI SIGTERM cancels its harmless npm child and removes the temporary token',async t=>{
 const f=await fixture(t),marker=path.join(f.dir,'started');await fs.writeFile(f.npm,"require('node:fs').writeFileSync("+JSON.stringify(marker)+",'started');setInterval(()=>{},1000);");
 const script=fileURLToPath(new URL('../scripts/judge-install.mjs',import.meta.url));const child=spawn(process.execPath,[script,'--access',f.accessPath],{env:{...f.environment,SYNTHETIC_MARKER:marker},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const exit=new Promise(r=>child.once('close',(code,signal)=>r({code,signal})));
 let seen=false;for(let n=0;n<100;n++){try{await fs.stat(marker);seen=true;break;}catch{}await new Promise(r=>setTimeout(r,30));}assert.equal(seen,true);child.kill('SIGTERM');const result=await exit;assert.notEqual(result.code,0);assert.match(output,/judge_install_cancelled/);assert.doesNotMatch(output,/SYNTHETIC_INSTALL_ONLY|SYNTHETIC_OP_SECRET/);assert.deepEqual(await fs.readdir(f.tmp),[]);
});
test('cancellation waits for owned descendant even when the group leader exits first',async t=>{
 const f=await fixture(t),entry=path.join(f.dir,'group.mjs'),marker=path.join(f.dir,'child-ready');
 await fs.writeFile(entry,`import {spawn} from 'node:child_process';import fs from 'node:fs';const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.env.SYNTHETIC_MARKER,'ok');setInterval(()=>{},1000)"],{stdio:'ignore'});child.unref();process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`);
 const abort=new AbortController(),job=runJudgeCommand({entry,args:[],cwd:f.dir,environment:{...f.environment,SYNTHETIC_MARKER:marker},signal:abort.signal,timeoutMs:10000});
 let ready=false;for(let n=0;n<100;n++){try{await fs.stat(marker);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,25));}assert.equal(ready,true);abort.abort();const r=await job;assert.equal(r.status,'cancelled');assert.equal(r.cleanupSafe,true);
});


test('CLI SIGHUP cancels only its owned harmless npm group before deleting temporary access',async t=>{
 const f=await fixture(t),marker=path.join(f.dir,'npm-pid');
 await fs.writeFile(f.npm,"require('node:fs').writeFileSync("+JSON.stringify(marker)+",String(process.pid));setInterval(()=>{},1000);");
 const script=fileURLToPath(new URL('../scripts/judge-install.mjs',import.meta.url));
 const child=spawn(process.execPath,[script,'--access',f.accessPath],{env:f.environment,stdio:['ignore','pipe','pipe']});
 let output='',npmPid,groupGone=false;child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 try{
  for(let n=0;n<100;n++){try{npmPid=Number(await fs.readFile(marker,'utf8'));break;}catch{}await new Promise(r=>setTimeout(r,25));}
  assert.ok(Number.isSafeInteger(npmPid)&&npmPid>1);
  child.kill('SIGHUP');const result=await ended;
  assert.equal(result.signal,null);assert.notEqual(result.code,0);assert.match(output,/judge_install_cancelled/);
  assert.throws(()=>process.kill(-npmPid,0),{code:'ESRCH'});groupGone=true;
  assert.deepEqual(await fs.readdir(f.tmp),[]);assert.doesNotMatch(output,/SYNTHETIC_INSTALL_ONLY|SYNTHETIC_OP_SECRET/);
 }finally{
  child.kill('SIGTERM');
  // The failing pre-fix fixture can leave its detached dummy child. This PID
  // came from this test's unique marker, never from a port or global process scan.
  if(npmPid&&!groupGone)try{process.kill(-npmPid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
 }
});


test('CLI recovery output names only the exact retained directory and keeps credential fields hidden',async t=>{
 const f=await fixture(t);for(const name of ['scripts','src'])await fs.mkdir(path.join(f.root,name));
 for(const [from,to] of [['scripts/judge-install.mjs','scripts/judge-install.mjs'],['src/judge-access.mjs','src/judge-access.mjs'],['src/judge-platform.mjs','src/judge-platform.mjs']])await fs.copyFile(new URL('../'+from,import.meta.url),path.join(f.root,to));
 const directory=path.join(f.tmp,'a2-judge-access-synthetic');
 await fs.writeFile(path.join(f.root,'src/judge-install-runner.mjs'),'export async function runJudgeInstall(){const error=Error("judge_access_cleanup_unconfirmed");error.recovery='+JSON.stringify({directory,process_termination:'unconfirmed',token:'SYNTHETIC_INSTALL_ONLY'})+';throw error;}');
 const child=spawn(process.execPath,[path.join(f.root,'scripts/judge-install.mjs')],{cwd:f.root,env:{HOME:f.dir,PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(code,1);assert.match(output,/judge_access_cleanup_unconfirmed/);assert.ok(output.includes(JSON.stringify(directory)));assert.match(output,/JUDGE-QUICKSTART.md#installer-recovery/);
 assert.doesNotMatch(output,/SYNTHETIC_INSTALL_ONLY|SYNTHETIC_OP_SECRET|process_termination/);
});


test('confirmed child exit with replaced access directory fails cleanup without treating it as a verified recovery path',async t=>{
 const f=await fixture(t);let original,preserved,failure,calls=0;
 await assert.rejects(runJudgeInstall({...f,now:0,runCommand:async x=>{
  calls++;original=path.dirname(x.environment.npm_config_userconfig);preserved=original+'-synthetic-owned';
  t.after(async()=>{await fs.rm(original,{recursive:true,force:true});await fs.rm(preserved,{recursive:true,force:true});});
  await fs.rename(original,preserved);await fs.mkdir(original,{mode:0o700});await fs.writeFile(path.join(original,'replacement-marker'),'keep');
  return completed;
 }}),error=>{failure=error;return error.message==='judge_access_cleanup_failed';});
 assert.equal(calls,1);assert.equal(failure.recovery,undefined);
 assert.equal(await fs.readFile(path.join(original,'replacement-marker'),'utf8'),'keep');
 assert.ok(await fs.stat(path.join(preserved,'cipher.npmrc')));
});


test('partial access preparation cannot report an uncertain child when no command ever started',async t=>{
 const f=await fixture(t),writeFile=fs.writeFile;let original,preserved,calls=0,failure;
 fs.writeFile=async(file,data,...options)=>{
  if(typeof file==='string'&&path.basename(file)==='cipher.npmrc'&&String(data).includes('npm_SYNTHETIC_INSTALL_ONLY')){
   original=path.dirname(file);preserved=original+'-synthetic-preparation';
   await fs.rename(original,preserved);await fs.mkdir(original,{mode:0o700});await writeFile(path.join(original,'replacement-marker'),'keep');
   throw Error('synthetic_partial_write_failure');
  }
  return writeFile(file,data,...options);
 };
 try{
  await assert.rejects(runJudgeInstall({...f,now:0,runCommand:async()=>{calls++;return completed;}}),error=>{failure=error;return error.message==='judge_access_cleanup_failed';});
  assert.equal(calls,0);assert.equal(failure.recovery,undefined);
  assert.equal(await fs.readFile(path.join(original,'replacement-marker'),'utf8'),'keep');assert.ok(await fs.stat(preserved));
 }finally{
  fs.writeFile=writeFile;
  if(original)await fs.rm(original,{recursive:true,force:true});
  if(preserved)await fs.rm(preserved,{recursive:true,force:true});
 }
});
