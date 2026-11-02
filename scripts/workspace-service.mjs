// Explicit local dev-server lifecycle. No login item, schedule, system service,
// collector control, installation or automatic model dispatch.
import fs from 'node:fs/promises';import{constants}from'node:fs';import path from'node:path';import{randomUUID}from'node:crypto';import{spawn,execFile}from'node:child_process';import{promisify}from'node:util';import{fileURLToPath}from'node:url';
import {workspaceServiceEnvironment}from'../src/workspace-service-env.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),local=path.join(root,'.local'),manifest=path.join(local,'workspace-process.json'),log=path.join(local,'workspace-launch.log'),entry=path.join(root,'workspace.mjs'),base='http://127.0.0.1:8930';
const validId=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function probe(){try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});if(!r.ok)return{occupied:true};const v=await r.json();return{occupied:true,instance_id:v.workspace_instance};}catch(e){return e.cause?.code==='ECONNREFUSED'?{occupied:false}:{occupied:true};}}
async function record(){try{const h=await fs.open(manifest,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await h.stat();if(!st.isFile()||(st.mode&0o077)||st.size>4096||(process.getuid&&st.uid!==process.getuid()))throw Error();const v=JSON.parse(await h.readFile('utf8'));if(!Number.isSafeInteger(v.pid)||v.pid<2||!validId(v.instance_id))throw Error();return{pid:v.pid,instance_id:v.instance_id};}finally{await h.close();}}catch{return null;}}
async function ownedProcess(r){if(!r)return false;try{const{stdout}=await promisify(execFile)('/bin/ps',['-p',String(r.pid),'-o','command='],{timeout:2000});return stdout.trim()===[process.execPath,'--experimental-strip-types',entry].join(' ');}catch{return false;}}
async function status(){const [v,r]=await Promise.all([probe(),record()]);return{status:v.occupied?(r&&v.instance_id===r.instance_id?'running':'unowned_port'):'stopped',port:8930,pid:r&&await ownedProcess(r)?r.pid:null};}
async function startUnlocked(){
 const before=await status();if(before.status==='running')return before;if(before.status!=='stopped')throw Error('workspace_port_in_use');
 await fs.mkdir(local,{recursive:true,mode:0o700});if((await fs.lstat(local)).isSymbolicLink())throw Error('workspace_local_unsafe');
 const old=await record();if(old&&await ownedProcess(old))throw Error('owned_workspace_not_responding');
 const previous=await fs.lstat(manifest).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(previous&&(!old||previous.isSymbolicLink()))throw Error('workspace_manifest_unsafe');
 const instance_id=randomUUID(),h=await fs.open(log,constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);const stat=await h.stat();if(!stat.isFile()||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid())){await h.close();throw Error('workspace_log_unsafe');}
 const child=spawn(process.execPath,['--experimental-strip-types',entry],{cwd:root,env:workspaceServiceEnvironment(process.env,instance_id),detached:true,stdio:['ignore',h.fd,h.fd]});let spawnError=false;child.on('error',()=>{spawnError=true;});child.unref();await h.close();
 const info={pid:child.pid,instance_id,port:8930,started_at:new Date().toISOString()};
 // The manifest grants no authority; stop also checks the exact live command
 // and the service-instance identity before signalling the PID.
 try{const temp=path.join(local,'.workspace-process-'+instance_id+'.tmp');const saved=await fs.open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await saved.writeFile(JSON.stringify(info,null,2)+'\n');await saved.sync();}finally{await saved.close();}await fs.rename(temp,manifest);}catch{if(child.exitCode===null&&child.signalCode===null)try{process.kill(child.pid,'SIGTERM');}catch{}throw Error('workspace_manifest_write_failed');}
 for(let i=0;i<100;i++){if(spawnError)break;const v=await probe();if(v.instance_id===instance_id)return{status:'running',port:8930,pid:child.pid};if(child.exitCode!==null||child.signalCode!==null)break;await pause(100);}
 if(await ownedProcess(info))try{process.kill(child.pid,'SIGTERM');}catch{}throw Error('workspace_start_unconfirmed');
}
async function start(){
 await fs.mkdir(local,{recursive:true,mode:0o700});const parent=await fs.lstat(local);if(parent.isSymbolicLink()||(parent.mode&0o022)||(process.getuid&&parent.uid!==process.getuid()))throw Error('workspace_local_unsafe');
 const lockPath=path.join(local,'workspace-start.lock');let handle;
 try{handle=await fs.open(lockPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}catch(e){
  if(e.code!=='EEXIST')throw e;
  const previous=await fs.open(lockPath,constants.O_RDONLY|constants.O_NOFOLLOW);let st,owner;try{st=await previous.stat();if(!st.isFile()||(st.mode&0o077)||st.size>256||(process.getuid&&st.uid!==process.getuid()))throw Error('workspace_start_locked');owner=JSON.parse(await previous.readFile('utf8'));}finally{await previous.close();}
  if(!Number.isSafeInteger(owner.pid)||owner.pid<2)throw Error('workspace_start_locked');let alive=true;try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}if(alive)throw Error('workspace_start_in_progress');
  const current=await fs.lstat(lockPath);if(current.ino!==st.ino||current.dev!==st.dev)throw Error('workspace_start_locked');await fs.unlink(lockPath);handle=await fs.open(lockPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 }
 const identity=await handle.stat();try{await handle.writeFile(JSON.stringify({pid:process.pid}));return await startUnlocked();}finally{await handle.close();const current=await fs.lstat(lockPath).catch(()=>null);if(current?.ino===identity.ino&&current.dev===identity.dev)await fs.unlink(lockPath);}
}
async function stop(){const r=await record(),v=await probe();if(!r||!await ownedProcess(r)){if(!v.occupied)return{status:'stopped',port:8930};throw Error('workspace_ownership_unconfirmed');}if(v.occupied&&v.instance_id!==r.instance_id)throw Error('workspace_ownership_unconfirmed');process.kill(r.pid,'SIGTERM');for(let i=0;i<150;i++){if(!await ownedProcess(r)&&!(await probe()).occupied)return{status:'stopped',port:8930};await pause(100);}throw Error('workspace_stop_unconfirmed');}
const command=process.argv[2];try{if(!['start','status','stop'].includes(command))throw Error('workspace_command_invalid');console.log(JSON.stringify(await({start,status,stop}[command])()));}catch(e){console.error(/^[a-z_]+$/.test(e.message)?e.message:'workspace_operation_failed');process.exitCode=1;}
