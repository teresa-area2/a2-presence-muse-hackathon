import fs from 'node:fs/promises';
import path from 'node:path';
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
export async function runJudgeInstall({root,accessPath,environment=process.env,signal,runCommand=runJudgeCommand,now=Date.now(),onProgress=()=>{}}={}){
 assertJudgePlatform();
 if(!path.isAbsolute(root??'')||!path.isAbsolute(accessPath??'')||!environment||typeof environment!=='object'||typeof runCommand!=='function'||typeof onProgress!=='function')fail('judge_install_arguments_invalid');
 let access,cleanupSafe=true;
 try{
  checkAbort(signal);
  const bundle=await readJudgeAccess(accessPath,{purpose:'install',now});checkAbort(signal);
  const npm=environment.npm_execpath;if(!path.isAbsolute(npm??'')||path.basename(npm)!=='npm-cli.js'||!(await fs.stat(npm)).isFile())fail('judge_run_via_npm_required');checkAbort(signal);
  access=await prepareJudgeAccess(bundle,{repoRoot:root});checkAbort(signal);
  const clean=selectEnvironment(environment,baseEnvironment),config=access.environment.NPM_CONFIG_USERCONFIG;
  const npmEnv={...clean,...selectEnvironment(environment,registryEnvironment),npm_config_userconfig:config,npm_config_logs_max:'0',npm_config_loglevel:'error'};
  const installArgs=['ci','--prefix',path.join(root,'integrations/cipher-textbox'),'--ignore-scripts','--no-audit','--fund=false','--logs-max=0','--loglevel=error'];
  const run=async(name,entry,args,env)=>{
   checkAbort(signal);onProgress(name);let result;
   try{result=await runCommand({entry,args,cwd:root,environment:env,signal,timeoutMs:180000});}catch{fail('judge_'+name+'_command_failed');}
   if(result?.cleanupSafe===false){cleanupSafe=false;fail('judge_access_cleanup_unconfirmed');}
   if(result?.status==='cancelled')fail('judge_install_cancelled');
   if(result?.status==='unsupported')fail('judge_install_process_group_unavailable');
   if(result?.status!=='completed'){const code=allowedCodes.has(result?.code)?result.code:'command_failed';fail('judge_'+name+'_'+code);}
   checkAbort(signal);
  };
  await run('cipher_install',npm,installArgs,npmEnv);
  // The copied token is removed before any dependency-loaded build or check.
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
