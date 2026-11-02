// Human-operated WSL2 check. No Presence capture, evaluator or transcript export.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {terminalEnvironment} from '../src/terminal-env.mjs';
import {createIsolatedMuseConfigs, removeIsolatedMuseConfigs} from '../src/isolated-muse-config.mjs';

const VERSIONS=new Set(['Muse Code 1.4.13 (1.4.13-R6996.1)','Muse Code 1.4.14 (1.4.14-R7309.1)']);
const PROMPT='Return exactly {"ready":true}.';
const fail=code=>{throw Error(code);};
const safeCode=e=>/^[a-z0-9_]{1,80}$/.test(e?.message??'')?e.message:'qualification_failed';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function parseArgs(args){
 let mode='preflight',allowed=false,selected=false;
 for(const arg of args){
  if(['--login','--check','--preflight'].includes(arg)){if(selected)fail('arguments_invalid');selected=true;mode=arg.slice(2);}
  else if(arg==='--allow-one-model-request'){if(allowed)fail('arguments_invalid');allowed=true;}
  else fail('arguments_invalid');
 }
 if(allowed&&mode!=='check')fail('arguments_invalid');
 return {mode,allowed};
}
export function isWSL2(platform,kernel){return platform==='linux'&&typeof kernel==='string'&&/microsoft.*wsl2/i.test(kernel);}

export function parsePublicEvents(output){
 if(typeof output!=='string'||Buffer.byteLength(output)>2*1024*1024)fail('model_output_invalid');
 let completed=0,usage=null,usageSeen=false;
 for(const line of output.split('\n')){
  if(!line.trim())continue;let row;try{row=JSON.parse(line);}catch{fail('model_output_invalid');}
  const type=row?.payload_type,p=row?.payload;
  if(typeof type!=='string'||!p||typeof p!=='object'||Array.isArray(p)||/(?:subagent|child|approval|tool)[._]/i.test(type))fail('model_output_invalid');
  if(type==='run.usage'){
   if(usageSeen||!Number.isSafeInteger(p.calls)||p.calls<0||p.calls>1||!Array.isArray(p.models)||p.models.length>8)fail('model_usage_invalid');
   usageSeen=true;const sum=k=>p.models.length&&p.models.every(m=>Number.isSafeInteger(m?.[k])&&m[k]>=0)?p.models.reduce((a,m)=>a+m[k],0):null;
   usage={calls:p.calls,input_tokens:sum('input_tokens'),output_tokens:sum('output_tokens'),cache_read_tokens:sum('cached_tokens'),cost_usd:null};
   if(Object.values(usage).some(v=>v!==null&&(!Number.isSafeInteger(v)||v<0)))fail('model_usage_invalid');
  }
  if(type==='run.terminal.completed'){
   if(p.terminal!=='completed'||typeof p.text!=='string'||p.text.length>2048)fail('model_output_invalid');
   let answer;try{answer=JSON.parse(p.text);}catch{fail('model_output_invalid');}
   if(!answer||typeof answer!=='object'||Array.isArray(answer)||Object.keys(answer).length!==1||answer.ready!==true)fail('model_answer_unqualified');completed++;
  }
  if(/^run\.terminal\.(failed|cancelled)$/.test(type))fail('model_terminal_failed');
 }
 if(completed!==1)fail('model_terminal_unqualified');return usage;
}

export function modelArguments(workspace){return ['exec','--json','--provider','meta','--model','muse-spark-1.3','--preset','empty','--contributor-mode','off','--max-model-steps','1','--workspace',workspace,'--no-session-log','--no-foreign-personal-context','--disable-reminders','--disable-web-tools','--disable-request-user-input','--disable-shell','--disable-write','--approval-mode','on-request','--approval-judge','off','-c','provider_retry.max_retries=0',PROMPT];}

async function findBinary(env){
 for(const dir of env.PATH.split(path.delimiter)){if(!path.isAbsolute(dir))continue;const p=path.join(dir,'muse');try{await fs.access(p,fs.constants.X_OK);return await fs.realpath(p);}catch{}}
 fail('muse_unavailable');
}
async function authMetadata(env){
 const auth=path.join(env.XDG_CONFIG_HOME||path.join(env.HOME,'.config'),'muse','auth.json');
 const st=await fs.lstat(auth).catch(()=>null);
 if(!st?.isFile()||st.isSymbolicLink()||(st.mode&0o077)||(process.getuid&&st.uid!==process.getuid()))fail('file_backed_auth_unavailable');
 return true;
}
async function newWorkspace(env){
 const cache=path.join(env.HOME,'.cache');await fs.mkdir(cache,{mode:0o700,recursive:true});const st=await fs.lstat(cache);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o022)||(process.getuid&&st.uid!==process.getuid()))fail('cache_unsafe');
 const base=await fs.realpath(cache);
 for(const candidate of [os.tmpdir(),'/tmp','/private/tmp',env.TMPDIR].filter(Boolean)){const temp=await fs.realpath(candidate).catch(()=>null);if(temp&&(base===temp||base.startsWith(temp+path.sep)))fail('cache_temporary');}
 const dir=await fs.mkdtemp(path.join(base,'a2-wsl-muse-'));await fs.chmod(dir,0o700);
 try{
  for(let p=dir;;p=path.dirname(p)){for(const name of ['AGENTS.md','CLAUDE.md','MUSE.md','.git'])if(await fs.lstat(path.join(p,name)).catch(()=>null))fail('workspace_has_instructions');if(path.dirname(p)===p)break;}
  return dir;
 }catch(e){await fs.rm(dir,{recursive:true,force:true});throw e;}
}

// Signals only the group while its original leader is known alive. If cleanup
// cannot be proven, the caller keeps its private configuration intact.
export async function captureOwned(binary,args,{cwd,env,timeoutMs,signal:abortSignal}){
 let child,closed=false,reason=null,timer,killTimer,expiry,bytes=0,out='';
 return new Promise(resolve=>{
  if(abortSignal?.aborted){resolve({started:false,code:null,reason:'process_cancelled',stdout:'',cleanupSafe:true});return;}
  let done=false;
  const finish=async(code)=>{
   if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(expiry);
   abortSignal?.removeEventListener('abort',onAbort);
   let gone=!child?.pid;
   if(child?.pid&&closed){const end=Date.now()+2000;do{try{process.kill(-child.pid,0);}catch(e){if(e.code==='ESRCH'){gone=true;break;}break;}await wait(25);}while(Date.now()<end);}
   resolve({started:Number.isSafeInteger(child?.pid)&&child.pid>1,code,reason,stdout:out,cleanupSafe:gone});
  };
  const signal=s=>{if(child?.pid&&child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,s);}catch{reason='process_cleanup_unconfirmed';}};
  const stop=why=>{if(reason)return;reason=why;signal('SIGTERM');killTimer=setTimeout(()=>signal('SIGKILL'),250);expiry=setTimeout(()=>{child?.stdout?.destroy();child?.stderr?.destroy();void finish(null);},2500);};
  const onAbort=()=>stop('process_cancelled');
  try{child=spawn(binary,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});}catch{reason='process_start_failed';void finish(null);return;}
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){stop('model_output_invalid');return;}out+=chunk.toString('utf8');});
  child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024)stop('model_output_invalid');});
  child.once('error',()=>{reason='process_start_failed';if(!child.pid)void finish(null);});
  child.once('close',code=>{closed=true;void finish(code);});abortSignal?.addEventListener('abort',onAbort,{once:true});if(abortSignal?.aborted)onAbort();timer=setTimeout(()=>stop('process_timeout'),timeoutMs);
 });
}
async function interactiveLogin(binary,env,{signal:abortSignal}={}){
 if(abortSignal?.aborted)fail('process_cancelled');
 return await new Promise((resolve,reject)=>{const child=spawn(binary,['login'],{env,stdio:'inherit'});let killTimer;const cancel=()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);};abortSignal?.addEventListener('abort',cancel,{once:true});if(abortSignal?.aborted)cancel();child.once('error',()=>{clearTimeout(killTimer);abortSignal?.removeEventListener('abort',cancel);reject(Error('login_start_failed'));});child.once('close',(code,signal)=>{clearTimeout(killTimer);abortSignal?.removeEventListener('abort',cancel);resolve({ok:code===0&&!signal&&!abortSignal?.aborted});});});
}
function interactiveEnvironment(env,source){
 const result={...env};
 for(const key of ['TERM','COLORTERM','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','WSL_INTEROP']){
  const value=source[key];if(typeof value==='string'&&value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value))result[key]=value;
 }
 return result;
}

// Injectable seams are for offline tests; CLI execution supplies no overrides.
export async function qualify({args,system={platform:process.platform,env:process.env,tty:process.stdin.isTTY&&process.stdout.isTTY,nodeVersion:process.versions.node},signal,ops={}}={}){
 const o={readKernel:()=>fs.readFile('/proc/sys/kernel/osrelease','utf8'),findBinary,newWorkspace,authMetadata,createConfigs:createIsolatedMuseConfigs,removeConfigs:removeIsolatedMuseConfigs,capture:captureOwned,login:interactiveLogin,removeWorkspace:dir=>fs.rm(dir,{recursive:true,force:true}),...ops};
 const report={schema_version:1,scope:'wsl_muse_qualification',status:'failed',mode:null,wsl2:false,muse_version:null,file_backed_auth_metadata:'not_checked',login:'not_requested',model_request:'not_sent',usage:null,cleanup:'not_started',presence_calls:0,limitations:['no_live_presence','no_coding_workflow','native_windows_unsupported']};
 let session,configs,cleanupSafe=true;
 try{
  const {mode,allowed}=parseArgs(args??[]);report.mode=mode;
  if(system.platform!=='linux'||!isWSL2(system.platform,await o.readKernel()))fail('wsl2_required');report.wsl2=true;
  const [major,minor]=(system.nodeVersion??'').split('.').map(Number);if(major!==22||minor<12||!Number.isInteger(minor))fail('node_version_unqualified');
  if(mode==='login'&&(!system.tty||system.env.CI))fail('interactive_terminal_required');
  const env=terminalEnvironment(system.env),binary=await o.findBinary(env);session=await o.newWorkspace(env);
  const versionEnv=terminalEnvironment({...env,HOME:session,XDG_CONFIG_HOME:path.join(session,'empty-config')});
  const v=await o.capture(binary,['--version'],{cwd:session,env:versionEnv,timeoutMs:10000,signal});cleanupSafe=v.cleanupSafe===true;
  if(!cleanupSafe)fail('process_cleanup_unconfirmed');if(v.reason||v.code!==0||!VERSIONS.has(v.stdout.trim()))fail('muse_version_unqualified');report.muse_version=v.stdout.trim().match(/1\.4\.(?:13|14)-R\d+\.\d+/)[0];
  if(mode==='login'){
   const result=await o.login(binary,interactiveEnvironment(env,system.env),{signal});if(!result?.ok)fail('login_not_completed');report.login='process_completed_auth_unverified';report.status='passed';return report;
  }
  await o.authMetadata(env);report.file_backed_auth_metadata='qualified';
  if(mode==='check'&&allowed){
   configs=await o.createConfigs({sessionDir:session,environment:env,nativeProfile:true});
   const result=await o.capture(binary,modelArguments(session),{cwd:session,env:configs.without,timeoutMs:60000,signal});cleanupSafe=result.cleanupSafe===true;
   if(result.started===true)report.model_request='attempted';if(!cleanupSafe)fail('process_cleanup_unconfirmed');if(result.started!==true||result.reason||result.code!==0)fail('model_request_failed');
   report.usage=parsePublicEvents(result.stdout);report.model_request='qualified';
  }
  report.status='passed';
 }catch(e){report.reason=safeCode(e);}
 finally{
  if(session){
   if(!cleanupSafe)report.cleanup='unconfirmed_private_files_retained';
   else try{if(configs)await o.removeConfigs(configs);await o.removeWorkspace(session);report.cleanup='confirmed';}catch{report.cleanup='unconfirmed_private_files_retained';report.status='failed';report.reason='cleanup_unconfirmed';}
  }
 }
 return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
 try{const report=await qualify({args:process.argv.slice(2),signal:controller.signal});console.log(JSON.stringify(report));if(report.status!=='passed')process.exitCode=1;}
 finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);}
}
