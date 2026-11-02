import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {labConfig} from '../config.mjs';
import {collaborationPolicy} from '../agents/collaboration-policy.mjs';
import {museInstructions} from '../agents/muse-interactive.mjs';
import {museServeCommand,spawnMuseMsp,uuid7} from './muse-msp.mjs';
import {MuseSessionHarness} from './muse-session-harness.mjs';
const execute=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));

// Per-process, nonpersistent controls independently exercised on local echo.
export const MUSE_SESSION_CONTROLS=[
 '-c','runtime_capabilities.plugin:tbh-reminders:reminder:goal-reminder.enabled=false',
 '-c','runtime_capabilities.plugin:tbh-reminders:reminder:verify-reminder.enabled=false',
 '-c','run.workflow_trigger_mode="off"',
 '-c','tools.web_fetch.enabled=false','-c','tools.web_search.mode="off"',
];

export async function prepareHarnessWorkspaces({labRoot=root,folder}){
 folder=path.resolve(folder);const parent=path.dirname(folder);await fs.mkdir(parent,{recursive:true,mode:0o700});
 if((await fs.lstat(parent)).isSymbolicLink()||await fs.realpath(parent)!==parent)throw Error('harness_parent_unsafe');
 await fs.mkdir(folder,{mode:0o700});const workspaces={};
 for(const arm of ['without','with']){
  const workspace=path.join(folder,arm);workspaces[arm]=workspace;
  await fs.cp(path.join(labRoot,'repo-fixture'),workspace,{recursive:true,filter:p=>path.basename(p)!=='.git'});
  for(const name of ['AGENTS.md','CLAUDE.md']){
   const file=path.join(workspace,name);const original=await fs.readFile(file,'utf8');
   await fs.writeFile(file,original+'\n'+collaborationPolicy.universal+(arm==='with'?'\n'+museInstructions+'\n'+collaborationPolicy.session:'')+'\nDo not delegate, install dependencies, commit or publish. Preserve .verification and .presence.\n');
  }
  await fs.mkdir(path.join(workspace,'.verification'),{mode:0o700});
  await fs.copyFile(path.join(labRoot,'tests/common-task-acceptance.mjs'),path.join(workspace,'.verification/common-task-acceptance.mjs'));
  await execute('git',['-c','core.hooksPath=/dev/null','init','--quiet','-b','main',workspace]);
  await execute('git',['-C',workspace,'add','.']);
  await execute('git',['-C',workspace,'-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Agent Lab Fixture','-c','user.email=fixture@localhost','commit','--quiet','-m','Task board qualification baseline']);
 }
 return workspaces;
}

export async function createMuseSessionHarness({folder,binary=labConfig.muse,python=labConfig.python,probe=labConfig.probe,state=labConfig.state,model='muse-spark-1.3',preset='miniswe',readPresence,admit=async()=>false,environment=process.env,labRoot=root}={}){
 if(!folder||!binary||!python||!probe||!state)throw Error('harness_connection_configuration_missing');
 const workspaces=await prepareHarnessWorkspaces({labRoot,folder});
 const prepared={};
 // Preparation creates private workspaces/registries/config only. Native hosts
 // start at open(); turn admission is separate and defaults denied.
 const createClient=async arm=>{
  const workspace=workspaces[arm];
  const argv=museServeCommand({workspace,arm,binary,probe,state,environment,model,provider:'meta',preset});
  const control=path.join(folder,'.control',arm);await fs.mkdir(control,{recursive:true,mode:0o700});
  const budgetState=path.join(control,'budget.json');
  const result=JSON.parse((await execute(python,['-B',path.join(labRoot,'host-adapters/muse_budget.py'),'prepare','--workspace',workspace,'--state',budgetState,'--max-generations','32','--seconds','600','--muse',binary,'--approval-config',path.join(control,'approval')],{env:environment,timeout:70000,maxBuffer:65536})).stdout);
  if(result.capability_id!=='plugin:area2-harness-budget:hook:pre-llm'||result.capability?.enabled!==true||!/^sha256:[a-f0-9]{64}$/.test(result.capability.trusted_definition_hash??''))throw Error('harness_budget_approval_invalid');
  argv.push('-c','runtime_capabilities.'+result.capability_id+'='+JSON.stringify(result.capability),...MUSE_SESSION_CONTROLS);
  prepared[arm]={budgetState,argv};return spawnMuseMsp({workspace,argv,environment});
 };
 const readActualPresence=async(arm,owned)=>{
  if(arm==='without')return null;
  const file=path.join(workspaces[arm],'.presence/hook-events.jsonl');
  try{const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)return null;
   // Presence guidance is the latest PreLLMCall observation only. PostLLMCall
   // response observations are correlated separately via
   // muse-presence-provenance; a fallback Pre is a current distinct
   // observation and never reuses prior fresh guidance.
   return (await fs.readFile(file,'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.event==='PreLLMCall'&&r.session_id===owned.sessionId&&(r.run_id===owned.runId||r.run_id==null&&r.turn_id===owned.turnId)).at(-1)??null;
  }catch{return null;}
 };
 const harness=new MuseSessionHarness({folder,workspaces,createClient,readPresence,readActualPresence,admit});
 harness.prepared=prepared;return harness;
}

export function newHarnessFolder(){return path.join(root,'interactive-sessions','m1-'+uuid7());}
