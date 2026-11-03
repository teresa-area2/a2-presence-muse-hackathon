import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {readJudgeAccess,prepareJudgeAccess} from './judge-access.mjs';
import {runJudgeCommand} from './judge-process.mjs';
import {assertJudgePlatform} from './judge-platform.mjs';

const allowedCodes=new Set(['e401','e403','e404','etimedout','enotfound','econnrefused','econnreset','eintegrity','eacces','enospc','eai_again','command_failed']);
const fail=message=>{throw Error(message);};
// Child processes inherit only normal execution context. Registry-only proxy and
// CA settings are given to npm but never to dependency-loaded build/check steps.
const baseEnvironment=['HOME','PATH','TMPDIR','TMP','TEMP','USER','LOGNAME','SHELL','LANG','LC_ALL','LC_CTYPE','TZ'];
const registryEnvironment=['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','ALL_PROXY','http_proxy','https_proxy','no_proxy','all_proxy','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'];
function selectEnvironment(environment,keys){return Object.fromEntries(keys.filter(key=>typeof environment[key]==='string').map(key=>[key,environment[key]]));}
function checkAbort(signal){if(signal?.aborted)fail('judge_install_cancelled');}
async function refuseProjectNpmrc(root){
 // npm can read project configs even with a selected user config. Refuse them,
 // including dangling symlinks, rather than risk inherited registry credentials.
 for(const dir of [root,path.join(root,'integrations'),path.join(root,'integrations/cipher-textbox')]){
  try{await fs.lstat(path.join(dir,'.npmrc'));fail('judge_public_project_npmrc_present');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
}
async function preparePublicNpmConfig(root,environment){
 const tmp=environment.TMPDIR||os.tmpdir();if(!path.isAbsolute(tmp))fail('judge_private_directory_required');
 const [base,repo]=await Promise.all([fs.realpath(tmp),fs.realpath(root)]);if(base===repo||base.startsWith(repo+path.sep))fail('judge_private_directory_required');
 const directory=await fs.mkdtemp(path.join(base,'a2-judge-access-'));await fs.chmod(directory,0o700);const owned=await fs.lstat(directory);let closed=false;
 const cleanup=async()=>{if(closed)return;const st=await fs.lstat(directory).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(st&&(!st.isDirectory()||st.isSymbolicLink()||st.ino!==owned.ino||st.dev!==owned.dev))fail('judge_access_cleanup_failed');if(st)await fs.rm(directory,{recursive:true,force:false});closed=true;};
 try{const user=path.join(directory,'public.npmrc'),global=path.join(directory,'global.npmrc');await fs.writeFile(user,'registry=https://registry.npmjs.org/\n@area2-ai:registry=https://registry.npmjs.org/\n',{mode:0o600,flag:'wx'});await fs.writeFile(global,'',{mode:0o600,flag:'wx'});return{directory,environment:{NPM_CONFIG_USERCONFIG:user,NPM_CONFIG_GLOBALCONFIG:global},cleanup};}catch(e){try{await cleanup();}catch{fail('judge_access_cleanup_failed');}throw e;}
}
export async function runJudgeInstall({root,accessPath=null,environment=process.env,signal,runCommand=runJudgeCommand,now=Date.now(),onProgress=()=>{}}={}){
 assertJudgePlatform();
 if(!path.isAbsolute(root??'')||(accessPath!==null&&!path.isAbsolute(accessPath??''))||!environment||typeof environment!=='object'||typeof runCommand!=='function'||typeof onProgress!=='function')fail('judge_install_arguments_invalid');
 let access,cleanupSafe=true;
 try{
  checkAbort(signal);
  const bundle=accessPath===null?null:await readJudgeAccess(accessPath,{purpose:'install',now});checkAbort(signal);
  if(!bundle)await refuseProjectNpmrc(root);checkAbort(signal);
  const npm=environment.npm_execpath;if(!path.isAbsolute(npm??'')||path.basename(npm)!=='npm-cli.js'||!(await fs.stat(npm)).isFile())fail('judge_run_via_npm_required');checkAbort(signal);
  access=bundle?await prepareJudgeAccess(bundle,{repoRoot:root}):await preparePublicNpmConfig(root,environment);checkAbort(signal);
  const clean=selectEnvironment(environment,baseEnvironment),config=access.environment.NPM_CONFIG_USERCONFIG;
  // Public installs do not forward proxy URLs, which can embed credentials.
  // CA paths remain available; proxy-only networks need a separate reviewed path.
  const npmRegistryEnvironment=bundle?registryEnvironment:['NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'];
  const npmEnv={...clean,...selectEnvironment(environment,npmRegistryEnvironment),npm_config_userconfig:config,npm_config_logs_max:'0',npm_config_loglevel:'error'};
  const installArgs=['ci','--prefix',path.join(root,'integrations/cipher-textbox'),'--ignore-scripts','--no-audit','--fund=false','--logs-max=0','--loglevel=error',...(!bundle?['--userconfig',config,'--globalconfig',access.environment.NPM_CONFIG_GLOBALCONFIG]:[])];
  const run=async(name,entry,args,env)=>{
   checkAbort(signal);onProgress(name);let result;
   try{result=await runCommand({entry,args,cwd:root,environment:env,signal,timeoutMs:180000});}catch{fail('judge_'+name+'_command_failed');}
   if(result?.cleanupSafe===false){cleanupSafe=false;fail('judge_access_cleanup_unconfirmed');}
   if(result?.status==='cancelled')fail('judge_install_cancelled');
   if(result?.status==='unsupported')fail('judge_install_process_group_unavailable');
   if(result?.status!=='completed'){const code=allowedCodes.has(result?.code)?result.code:'command_failed';fail('judge_'+name+'_'+code);}
   checkAbort(signal);
  };
  if(!bundle)await refuseProjectNpmrc(root);checkAbort(signal);
  await run('cipher_install',npm,installArgs,npmEnv);
  // Registry configuration is removed before dependency-loaded build/check.
  // Public mode never contains a token; explicit legacy private mode may.
  try{await access.cleanup();}catch{fail('judge_access_cleanup_failed');}access=null;checkAbort(signal);
  const postEnv={...clean,npm_config_logs_max:'0',npm_config_loglevel:'error'};
  for(const [name,entry,args] of [['cipher_build',path.join(root,'scripts/build-cipher-textbox.mjs'),[]],['offline_setup',path.join(root,'scripts/check-setup.mjs'),['--offline']],['dependency_check',path.join(root,'scripts/check-dependencies.mjs'),[]]])await run(name,entry,args,postEnv);
  return{status:'installed'};
 }finally{
  if(access){
   // Retain the owned config while descendant termination is unconfirmed. This
   // is a failed install, never a success or permission to race recursive cleanup.
   if(!cleanupSafe){const error=Error('judge_access_cleanup_unconfirmed');error.recovery={directory:access.directory,process_termination:'unconfirmed'};throw error;}
   try{await access.cleanup();}catch{fail('judge_access_cleanup_failed');}
  }
 }
}
