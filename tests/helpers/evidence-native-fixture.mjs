// Scripted clients only; optional real sandboxed CI is still not model evidence.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {nativeEvidenceAdapter,EVIDENCE_USER_TURNS} from '../../src/evidence-batch-native.mjs';
import {compileEvidenceBatch} from '../../src/evidence-batch-plan.mjs';
import {describeEvidenceAnswer} from '../../src/evidence-batch-runner.mjs';
import {EventEmitter} from 'node:events';
import {collectArtifactFilesWithBytes,hashArtifactFiles} from '../../src/artifact-source.mjs';
import {buildCIFeedback} from '../../src/coding-ci-report.mjs';
import {SessionCIService} from '../../src/session-ci-service.mjs';
import {prepareCodingTaskProfiles} from '../../src/coding-task-profiles.mjs';
import {prepareProjectWorktrees,cleanupProjectWorktrees} from '../../src/project-task.mjs';
import {fileURLToPath} from 'node:url';
const ARMS=['without','with'];
export async function fixture(t,{failure=null,storeFailure=false,missingLink=false,hang=false,holdBridge=false,stopApproval=false,lateUsage=false,toolEvents=false,initialCI={without:'passed',with:'passed'},repairCI={without:'passed',with:'passed'},hangRepair=false,sandboxCI=false,leaveRepairBroken=false,mutateOnStop=false,cancelBetweenRepairs=false,withoutFinalMissing=false,withoutRepairFinalMissing=false,withoutRepairStaleOrdinal=false}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'evidence-native-fixture-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const outputDirectory=path.join(root,'batch');await fs.mkdir(outputDirectory);const directory=path.join(outputDirectory,'pair');await fs.mkdir(directory);
 const plan=compileEvidenceBatch({schema_version:1,model_ids:['muse-spark-1.3'],task_ids:['save-conflicts'],trajectory_ids:['change-during-work'],repetitions:1,seed:'native-fixture',limits:{per_arm_generations:6,max_total_generations:12,batch_timeout_ms:60000}},{sourceCommit:'a'.repeat(40)});
 const abort=new AbortController(),context={plan,outputDirectory,directory,signal:abort.signal,started_monotonic_ms:performance.now()-500,remainingMs:()=>59000.9};
 const logs=[],prompts=[],guardStates=[],snapshots=[];let pair,source,closed=false,stopPromise,releaseBridge,requestRows=[],late=false,workspacesForCI;const armTurns={without:0,with:0},submitted=[];const bridgeEntered=new Promise(resolve=>{releaseBridge={entered:resolve};});
 const model={status:'observed',observed_models:['muse-spark-1.3']};
 const armSnapshot=a=>({status:closed?'closed':stopApproval?'approval':'ready',last_turn_terminal:hang||stopApproval?null:'completed',model,
  usage:{status:'observed',coverage:late||!stopApproval||a==='without'?'observed':'partial_or_unconfirmed',model_calls:stopApproval?(late&&a==='with'?4:3):armTurns[a],input_tokens:late&&a==='with'?1600:100,output_tokens:20,cache_read_tokens:0},
  elapsed:{status:closed?'incomplete':'in_progress'},
  messages:hang||stopApproval?[]:[{author:'Muse',phase:'finalAnswer',text:'# Result\n- Fixed it.'}],
  delivery:{public_finals:a==='without'&&(withoutFinalMissing||(withoutRepairFinalMissing&&armTurns[a]>1))?0:1,turn_ordinal:a==='without'&&withoutRepairStaleOrdinal&&armTurns[a]>1?armTurns[a]-1:armTurns[a],turn_completed:!hang&&!stopApproval,status:a==='without'?'baseline_isolated':'guidance_observed',request_attribution:a==='without'?[]:requestRows,hook_linkage:'read_marker_matched',response_linkage:missingLink||hang||stopApproval?'unverified':'public_final_matched'}});
 const nativeClients={};
 const components={binary:'/fixture/muse',python:'/fixture/python',labRoot:'/fixture/lab',pins:{agent_lab:'b'.repeat(40),presence_runtime:'c'.repeat(40)},msp:{museServeCommand:()=>['muse','--preset','miniswe','--contributor-mode','off'],spawnMuseMsp:opts=>{const arm=Object.keys(nativeClients).length?'with':'without';const client=Object.assign(new EventEmitter(),{closed:true,stopping:true,ownsProcessGroup:true,sessionId:'s-'+arm,activeTurnId:'turn',turnIds:new Set(['turn']),approvals:new Map()});nativeClients[arm]=client;return client;}}};
 const dependencies={
  sessionParent:path.join(root,'sessions'),
  async loadComponents(){return components;},
  async prepareCodingTaskProfiles(options){if(sandboxCI)return prepareCodingTaskProfiles({sourceRoot:fileURLToPath(new URL('../../',import.meta.url)),localRoot:options.localRoot,environment:{HOME:root,PATH:process.env.PATH}});return{entries:[{id:'save-conflicts',metadata:{task_id:'SAVE-conflicts',source_commit:'d'.repeat(40),fixture_commit:'a'.repeat(40)},plan:{taskId:'SAVE-conflicts',include:['TASK.md','CONTRACT.md','src/save.mjs'],repoRoot:root,originalCommit:'d'.repeat(40),expectedPlanHash:'e'.repeat(64),limits:{}}}]};},
  execute:(binary,args)=>Buffer.from(args[0]==='config'?'{}':'10000'),
  async prepareProjectWorktrees(options){if(sandboxCI)return prepareProjectWorktrees({...options,env:{HOME:root,PATH:process.env.PATH}});const {backingRoot}=options,worktrees={};for(const a of ARMS){worktrees[a]=path.join(backingRoot,a);await fs.mkdir(path.join(worktrees[a],'src'),{recursive:true});await fs.writeFile(path.join(worktrees[a],'AGENTS.md'),'Instructions');await fs.writeFile(path.join(worktrees[a],'src/save.mjs'),'export {};');if(a==='with')await fs.writeFile(path.join(worktrees[a],'PRESENCE-ADAPTER.md'),'Fixture adapter addendum');}return{worktrees};},
  async cleanupProjectWorktrees(backing){assert.equal(closed,true,'never remove running workspace');logs.push('worktrees');if(sandboxCI)return cleanupProjectWorktrees(backing,{env:{HOME:root,PATH:process.env.PATH}});await fs.rm(backing,{recursive:true});},
  async createIsolatedMuseConfigs(){return{without:{HOME:root,PATH:'/bin'},with:{HOME:root,PATH:'/bin'}};},async removeIsolatedMuseConfigs(){logs.push('configs');},
  async createTextboxMuseBridge({presence}){source=presence;if(holdBridge){releaseBridge.entered();await new Promise(resolve=>{releaseBridge.finish=resolve;});}return{socket:'/fixture/socket',prepareBoundary(){},async close(){logs.push('bridge');}};},
  prepareEvidenceNativeBudget(options){assert.ok(options.anchor<=9999.5);assert.equal(options.maxGenerations,6);assert.equal(options.seconds,60);const file=path.join(directory,'guard-'+guardStates.length+'.json');guardStates.push(file);return{state:file,capability:{enabled:true,trusted_definition_hash:'sha256:'+'f'.repeat(64)}};},
  async createStructuredPair({components:c,workspaces,nativeQuestions,model}){
   assert.equal(nativeQuestions,true);assert.equal(model,'muse-spark-1.3');for(const a of ARMS){const argv=c.msp.museServeCommand({arm:a,workspace:workspaces[a]});assert.ok(argv.includes('provider_retry.max_retries=0'));c.msp.spawnMuseMsp({workspace:workspaces[a]});}
   if(failure)throw Error(failure);workspacesForCI=workspaces;
   pair={state:'ready',error:null,arms:Object.fromEntries(ARMS.map(a=>[a,{ready:()=>!hang&&!stopApproval&&!(hangRepair&&prompts.length>1),client:{sessionId:'s-'+a,activeTurnId:'turn',approvals:new Map(stopApproval&&a==='without'?[['approval',{approvalId:'approval',sessionId:'s-'+a,turnId:'turn',currentRequirementId:{approvalId:'approval',sourceIndex:0},availableChoices:[{choiceId:'once',scope:'once',decision:'approved'}],subject:{kind:'shell',workspaceRoot:workspaces[a],command:'npm test'}}]]:[])},questions:{size:0},delivery:{settled:async()=>{}}}])),
    async submit(prompt,target){assert.ok([...ARMS,'both'].includes(target));prompts.push(prompt);const selected=target==='both'?ARMS:[target];for(const a of selected){armTurns[a]++;if(armTurns[a]>1&&!leaveRepairBroken)await fs.writeFile(path.join(workspaces[a],'src/save.mjs'),sandboxCI?CORRECT_SAVE:'export const repaired = true;');}submitted.push({prompt,target});if(selected.includes('with'))requestRows=[];if(toolEvents)for(const arm of ARMS)nativeClients[arm].emit('notification',{method:'item/started',params:{sessionId:'s-'+arm,item:{itemId:'tool-1',turnId:'turn',kind:'toolCall',tool:'bash',callId:'call-1',revision:1,status:'inProgress',args:{command:'cat PRIVATE-PATH'}}}});for(let n=0;n<(selected.includes('with')?(stopApproval?4:3):0);n++){const selection=source.selectForRequest();source.recordSelection('hook',selection);requestRows.push({ordinal:n+1,status:selection.status==='selected'?'guidance_observed':'fallback_observed',controls:selection.controls});}if(cancelBetweenRepairs&&target==='without')abort.abort();return{status:'started',arms:Object.fromEntries(selected.map(a=>[a,{status:'started'}]))};},
    snapshot:()=>({status:closed?'closed':'ready',arms:Object.fromEntries(ARMS.map(a=>[a,armSnapshot(a)]))}),
    stop(){return stopPromise??=(async()=>{logs.push('stop-start');await new Promise(r=>setTimeout(r,20));closed=true;late=lateUsage;if(mutateOnStop)await fs.writeFile(path.join(workspaces.with,'src/save.mjs'),'export const changedAfterCheck = true;');if(toolEvents)for(const arm of ARMS)nativeClients[arm].emit('notification',{method:'item/completed',params:{sessionId:'s-'+arm,item:{itemId:'tool-1',turnId:'turn',kind:'toolCall',tool:'bash',callId:'call-1',revision:2,status:'failed',args:{command:'cat PRIVATE-PATH'},failureKind:'execution_error',failureReason:'ENOENT PRIVATE-PATH',visibleOutput:'PRIVATE-TOOL-OUTPUT'}}});for(const file of guardStates)await fs.writeFile(file,JSON.stringify({generations_reserved:2,blocked:0}));logs.push('stop-end');})();}};
   const emitter=new EventEmitter();pair.on=emitter.on.bind(emitter);pair.off=emitter.off.bind(emitter);pair.emit=emitter.emit.bind(emitter);return pair;
  },
  async confirmOwnedExit(){return failure!=='startup_cleanup_unconfirmed';},
  SessionCIService:class{
   constructor(){this.latest={};this.round=0;this.selected=[];}
   check(target){this.selected=target==='both'?ARMS:[target];this.round++;logs.push('ci-after-turns:'+prompts.length);}
   async wait(){for(const a of this.selected){const captured=await collectArtifactFilesWithBytes(workspacesForCI[a],'project');const artifact=hashArtifactFiles(captured.files);captured.bytes.clear();const state=(this.round===1?initialCI:repairCI)[a];const pass=state==='passed',counts={tests:1,pass:pass?1:0,fail:pass?0:1,skipped:0,cancelled:0,todo:0};this.latest[a]={id:'check-'+this.round+'-'+a,status:state,current:true,summary:{schema_version:1,state,exit_code:pass?0:1,public_tests:{...counts},frozen_tests:{...counts},cases:[{name:'fixed public contract',result:state}],artifact_sha256:artifact,trusted_plan_hash:'e'.repeat(64)}};}this.selected=[];}
   snapshot(){return{arms:Object.fromEntries(ARMS.map(a=>[a,{latest:this.latest[a]??null}]))};}
   async feedback(target,ids){const selected=target==='both'?ARMS:[target],reports=this.latest;for(const a of selected)assert.equal(ids[a],reports[a].id);const prompts=Object.fromEntries(selected.map(a=>[a,buildCIFeedback(reports[a].summary)]));return{prompts,commit:()=>({prompts,target})};}
   close(){logs.push('ci');}
  },
  async createEvidenceStore({metadata}){assert.match(metadata.source_commit,/^[a-f0-9]{40}$/);if(!sandboxCI)assert.equal(metadata.fixture_commit,'a'.repeat(40));assert.equal(metadata.evidence_mode,'live');return{begin:()=>1,capture:(id,snapshot)=>snapshots.push(snapshot),async flush(){},async close(){logs.push('store');if(storeFailure)throw Error('fixture_store_error');}};},
 };
 if(sandboxCI)dependencies.SessionCIService=SessionCIService;
 const adapter=nativeEvidenceAdapter({environment:{HOME:root,PATH:process.env.PATH},dependencies});return{adapter,context,cell:plan.cells[0],logs,prompts,submitted,snapshots,nativeClients,abort,root,bridgeEntered,releaseBridge:()=>releaseBridge.finish()};
}

const CORRECT_SAVE=`export async function saveEdit(client,id,draft,revision){
 const pending=structuredClone(draft);
 try{return await client.save(id,structuredClone(pending),revision);}
 catch(error){if(error?.code!=='CONFLICT')throw error;}
 const current=await client.get(id);
 return client.save(id,{...current.fields,...pending},current.revision);
}\n`;

