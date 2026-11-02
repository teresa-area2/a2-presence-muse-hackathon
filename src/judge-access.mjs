// Submission-only temporary access; no Muse account or key belongs in this bundle.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
const error=code=>{throw Error(code);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,allowed)=>object(x)&&Object.keys(x).every(k=>allowed.includes(k));
const value=x=>typeof x==='string'&&x.length>0&&x.length<=4096&&!/[\r\n\0]/.test(x)&&!x.includes('${')&&!/^(REPLACE|YOUR_|<)/i.test(x);
function instant(x){if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x)||!Number.isFinite(Date.parse(x)))error('judge_expiry_invalid');const iso=new Date(x).toISOString();if(x!==iso&&x!==iso.replace('.000Z','Z'))error('judge_expiry_invalid');return Date.parse(x);}
export function parseJudgeAccess(input,{purpose,now=Date.now()}={}){
 if(!['install','start'].includes(purpose)||!Number.isFinite(now)||now<0)error('judge_access_arguments_invalid');
 if(!keys(input,['schema_version','purpose','cipher','open_presence'])||input.schema_version!==1||input.purpose!=='hackathon-judge-evaluation')error('judge_access_invalid');
 const c=input.cipher,o=input.open_presence;
 if(!keys(c,['registry','token','expires_at'])||c.registry!=='https://registry.npmjs.org/'||!value(c.token)||!/^npm_[A-Za-z0-9_-]+$/.test(c.token))error('judge_cipher_access_invalid');
 const cipherExpiry=instant(c.expires_at);
 if(!keys(o,['environment','client_id','client_secret','expires_on'])||!['dev','production'].includes(o.environment)||!value(o.client_id)||o.client_id.includes(':')||!value(o.client_secret)||typeof o.expires_on!=='string'||!/^\d{4}-\d\d-\d\d$/.test(o.expires_on)||!Number.isFinite(Date.parse(o.expires_on+'T00:00:00.000Z'))||new Date(o.expires_on+'T00:00:00.000Z').toISOString().slice(0,10)!==o.expires_on)error('judge_op_access_invalid');
 // OP's owner reported a date, not a verified hour. Stop at its start in UTC;
 // the service remains authoritative and may reject a credential earlier.
 const opCutoff=Date.parse(o.expires_on+'T00:00:00.000Z');
 if(purpose==='install'&&now>=cipherExpiry)error('judge_cipher_access_expired');
 if(purpose==='start'&&now>=opCutoff)error('judge_op_access_expired');
 return {purpose,cipher:{...c},open_presence:{...o},summary:{purpose,cipher_install_expires_at:c.expires_at,op_owner_reported_expiry_on:o.expires_on,op_client_cutoff_at:new Date(opCutoff).toISOString(),op_server_expiry_hour:'not_verified',registry:c.registry,muse_access:'requires_judge_own_authorized_account'}};
}
export async function readJudgeAccess(file,options){
 if(typeof file!=='string'||!path.isAbsolute(file))error('judge_access_path_invalid');
 let h;try{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>16384)error('judge_access_file_invalid');h=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const current=await h.stat();if(current.ino!==st.ino||current.dev!==st.dev||current.size>16384)error('judge_access_file_changed');const bytes=Buffer.alloc(16385),read=await h.read(bytes,0,16385,0);if(read.bytesRead>16384)error('judge_access_file_invalid');return parseJudgeAccess(JSON.parse(bytes.subarray(0,read.bytesRead).toString('utf8')),options);}catch(e){if(/^judge_[a-z_]+$/.test(e.message))throw e;error(e.code==='ENOENT'?'judge_access_missing':'judge_access_unreadable');}finally{await h?.close();}
}
export async function prepareJudgeAccess(bundle,{repoRoot,tempBase=os.tmpdir()}={}){
 if(!bundle?.summary||!path.isAbsolute(repoRoot??'')||!path.isAbsolute(tempBase))error('judge_access_arguments_invalid');
 const [base,repo]=await Promise.all([fs.realpath(tempBase),fs.realpath(repoRoot)]);
 if(base===repo||base.startsWith(repo+path.sep))error('judge_private_directory_required');
 const directory=await fs.mkdtemp(path.join(base,'a2-judge-access-'));await fs.chmod(directory,0o700);const owned=await fs.lstat(directory);let closed=false;
 const cleanup=async()=>{if(closed)return;const st=await fs.lstat(directory).catch(()=>null);if(st&&(!st.isDirectory()||st.isSymbolicLink()||st.ino!==owned.ino||st.dev!==owned.dev))error('judge_access_cleanup_unconfirmed');if(st)await fs.rm(directory,{recursive:true,force:false});closed=true;};
 try{
  if(bundle.purpose==='install'){const config=path.join(directory,'cipher.npmrc');await fs.writeFile(config,'@area2-ai:registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken='+bundle.cipher.token+'\n',{mode:0o600,flag:'wx'});return{directory,environment:{NPM_CONFIG_USERCONFIG:config},summary:{...bundle.summary},cleanup};}
  const config=path.join(directory,'open-presence.json'),{environment,client_id,client_secret}=bundle.open_presence,client_cutoff_at=bundle.summary.op_client_cutoff_at;const cutoff=instant(client_cutoff_at);if(cutoff!==instant(bundle.open_presence.expires_on+'T00:00:00.000Z'))error('judge_expiry_invalid');await fs.writeFile(config,JSON.stringify({environment,client_id,client_secret,client_cutoff_at})+'\n',{mode:0o600,flag:'wx'});return{directory,environment:{A2_MUSE_OP_CONFIG:config},summary:{...bundle.summary},cleanup};
 }catch(e){try{await cleanup();}catch{error('judge_access_cleanup_failed');}throw e;}
}
export function judgeArguments(args){let access=null,port=null,consent=false;for(let i=0;i<args.length;i++){if(args[i]==='--access'&&access===null&&typeof args[i+1]==='string'&&!args[i+1].startsWith('--'))access=path.resolve(args[++i]);else if(args[i]==='--port'&&port===null&&/^\d+$/.test(args[i+1]??'')){port=Number(args[++i]);if(!Number.isSafeInteger(port)||port<0||port>65535)error('judge_port_invalid');}else if(args[i]==='--consent-typing'&&!consent)consent=true;else error('judge_argument_invalid');}return{access,port,consent};}
