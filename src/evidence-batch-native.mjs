// Actual Muse adapter. Constructing this object never dispatches a model turn.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {loadComponents} from './components.mjs';import {terminalEnvironment} from './terminal-env.mjs';import {prepareCodingTaskProfiles} from './coding-task-profiles.mjs';import {codingTaskSpec} from './coding-task-catalog.mjs';import {prepareProjectWorktrees,cleanupProjectWorktrees} from './project-task.mjs';import {createIsolatedMuseConfigs,removeIsolatedMuseConfigs} from './isolated-muse-config.mjs';import {createStructuredPair} from './structured-factory.mjs';import {createTextboxMuseBridge} from './textbox-muse-bridge.mjs';import {createEvidencePolicySource} from './evidence-policy-trajectories.mjs';import {prepareEvidenceNativeBudget,EVIDENCE_BUDGET_CAPABILITY} from './evidence-native-budget.mjs';import {benchmarkApprovalDecision,EVIDENCE_WORKSPACE_INSTRUCTIONS} from './evidence-batch-approvals.mjs';import {SessionCIService} from './session-ci-service.mjs';import {runProjectVerification} from './verification-runner.mjs';import {collectArtifactFilesWithBytes,hashArtifactFiles} from './artifact-source.mjs';import {createEvidenceStore} from './evidence-store.mjs';import {confirmOwnedExit} from './structured-pair.mjs';import {writeEvidenceJson,describeEvidenceAnswer,describeEvidenceTrajectoryRequests} from './evidence-batch-runner.mjs';
import {EvidenceToolOutcomes} from './evidence-tool-outcomes.mjs';
import {executeEvidenceCodingWorkflow} from './evidence-coding-workflow.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url)),ARMS=['without','with'],wait=ms=>new Promise(r=>setTimeout(r,ms)),sha=x=>createHash('sha256').update(x).digest('hex');
export const EVIDENCE_USER_TURNS=Object.freeze(['Implement the coding task in TASK.md using CONTRACT.md as the authority. Explain the outcome and distinguish tests you ran from proposed checks. '+EVIDENCE_WORKSPACE_INSTRUCTIONS,'Conditional repair: only a failed arm receives its own executed CI feedback (counts, case names and artifact/plan hashes) from the bound checker. At most one repair turn, followed by the same independent checks. No repair turn on first-pass success.']);
export function nativeEvidenceAdapter({environment=process.env,approvalPolicy='fixture-scoped',dependencies={}}={}){
 if(!['fixture-scoped','pause'].includes(approvalPolicy))throw Error('evidence_approval_policy_invalid');
 let components,registry,sharedPythonAnchor=null,activeClose=null;
 const env=terminalEnvironment(environment);
 const d={loadComponents,prepareCodingTaskProfiles,prepareProjectWorktrees,cleanupProjectWorktrees,createIsolatedMuseConfigs,removeIsolatedMuseConfigs,createStructuredPair,createTextboxMuseBridge,prepareEvidenceNativeBudget,SessionCIService,createEvidenceStore,execute:execFileSync,confirmOwnedExit,sessionParent:path.join(os.homedir(),'Library/Caches/a2-presence-muse/evidence-batches'),...dependencies};
 return{
  async prepare(context){
   if(context.signal.aborted)throw Error('evidence_batch_cancelled');components=await d.loadComponents({...env,A2_MUSE_PRESENCE_SOURCE:'textbox',...(environment.A2_LAB_MUSE?{A2_LAB_MUSE:environment.A2_LAB_MUSE}:{}),...(environment.A2_LAB_PYTHON?{A2_LAB_PYTHON:environment.A2_LAB_PYTHON}:{})});
   if(context.signal.aborted||context.remainingMs()<=0)throw Error('evidence_batch_deadline');const localRoot=path.join(context.outputDirectory,'prepared-tasks');await fs.mkdir(localRoot,{mode:0o700});registry=await d.prepareCodingTaskProfiles({sourceRoot:ROOT,localRoot,commit:context.plan.source_commit,environment:env});
   if(context.signal.aborted||context.remainingMs()<=0)throw Error('evidence_batch_deadline');const retry=path.join(context.outputDirectory,'retry-config.json');await writeEvidenceJson(retry,{schema_version:1,settings:{provider_retry:{max_retries:0}}});d.execute(components.binary,['config','validate','--plane','defaults','--file',retry],{env,cwd:context.outputDirectory,timeout:5000,maxBuffer:4096,stdio:'pipe'});
   sharedPythonAnchor=Number(d.execute(components.python,['-B','-c','import time;print(time.monotonic())'],{env,timeout:5000,maxBuffer:1024}));if(!Number.isFinite(sharedPythonAnchor))throw Error('evidence_clock_invalid');sharedPythonAnchor-=(performance.now()-context.started_monotonic_ms)/1000;if(sharedPythonAnchor<0)throw Error('evidence_clock_invalid');
  },
  async runCell(cell,context){
   const {plan,directory,signal,remainingMs}=context,c=components,entry=registry.entries.find(t=>t.id===cell.task_id);if(!entry)throw Error('evidence_task_unavailable');
   const parent=d.sessionParent;await fs.mkdir(parent,{recursive:true,mode:0o700});const session=await fs.mkdtemp(path.join(parent,'pair-'));await fs.chmod(session,0o700);
   const backing=path.join(session,'backing'),task=entry.plan;let prepared,pair,bridge,configs,ci,store,evidenceId,snapshot=null,codeChecks=null,stopped=null,closePromise=null,cleanup=true;const guards=[],clients=[],turns=[],decisions=[],handled=new Set(),disposers=[];
   let workflow=null,activeTurn=null;
   const armClients={};let toolObservationFailed=false;
   const tools=Object.fromEntries(ARMS.map(arm=>[arm,new EvidenceToolOutcomes({arm,scope:()=>({sessionId:armClients[arm]?.sessionId,turnIds:armClients[arm]?.turnIds})})]));
   const toolSnapshot=()=>Object.fromEntries(ARMS.map(arm=>[arm,{...tools[arm].snapshot(),...(toolObservationFailed?{coverage:'partial_or_unverified',observer_failed:true}:{})}]));
   const source=createEvidencePolicySource({trajectoryId:cell.trajectory_id,scopeId:cell.id,guidanceVariant:plan.spec.guidance_variant});
   const own=action=>{let promise;const dispose=()=>promise??=Promise.resolve().then(action);disposers.push(dispose);return dispose;};
   const drain=async()=>{for(const dispose of disposers)try{await dispose();}catch{cleanup=false;}};
   const check=()=>{if(signal.aborted||remainingMs()<=0)throw Error('evidence_batch_deadline');if(stopped)throw Error(stopped);};
   const stop=reason=>{if(stopped)return;stopped=reason;void pair?.stop();};const abort=()=>stop('evidence_batch_cancelled');signal.addEventListener('abort',abort,{once:true});
   const close=()=>closePromise??=(async()=>{
    if(ci)try{ci.close();await ci.wait();}catch{cleanup=false;}
    if(pair){try{await pair.stop();if(pair.error==='cleanup_unconfirmed')cleanup=false;}catch{cleanup=false;}}
    else for(const client of clients){try{
     // Factory failure may already have stopped a client. Never signal a stale
     // process group again after a confirmed owned exit.
     if(!client.stopping&&!client.closed)await client.stop(client.activeTurnId);
     if(!await d.confirmOwnedExit(client))cleanup=false;
    }catch{cleanup=false;}}
    // Stop first, then consume any final trace/usage updates before closing the
    // evidence store or removing hook audits. An interrupted turn is still evidence.
    if(pair)try{
     const settled=await Promise.allSettled(ARMS.map(arm=>pair.arms[arm].delivery.settled()));
     if(settled.some(item=>item.status==='rejected'))cleanup=false;
     snapshot=pair.snapshot();
     const record=activeTurn??turns.at(-1);
     if(record){
      const index=turns.findIndex(turn=>turn.ordinal===record.ordinal),previous=index<0?null:turns[index];
      const row={...record,...observeTurn(record,previous?.completed===true),observation_stage:'after_owned_stop',stop_reason:previous?.completed===true?null:stopped??failure??'session_closed'};
      if(index<0)turns.push(row);else turns[index]=row;
     }
     if(store&&evidenceId){store.capture(evidenceId,{...snapshot,code_checks:codeChecks});await store.flush(evidenceId);}
    }catch{cleanup=false;}
    for(const g of guards)try{const v=JSON.parse(await fs.readFile(g.state,'utf8'));g.reserved=v.generations_reserved;g.blocked=v.blocked;}catch{g.reserved=null;cleanup=false;}
    // The independent observer stays attached during stop, even after the public
    // arms close. It retains metadata from late failure/completion notifications.
    try{await writeEvidenceJson(path.join(directory,'tool-outcomes.json'),{schema_version:1,arms:toolSnapshot()});}catch{toolObservationFailed=true;failure??='evidence_tool_log_unavailable';cleanup=false;}
    await drain();
    signal.removeEventListener('abort',abort);
    return{cleanup_confirmed:cleanup};
   })();activeClose=close;
   const approvePending=async()=>{
    for(const arm of ARMS){const native=pair.arms[arm];if(native.questions.size){stopped='human_answer_required';return;}
     for(const pending of native.client.approvals.values()){
      if(approvalPolicy==='pause'){stopped='human_approval_required';return;}
      const key=arm+':'+pending.approvalId+':'+pending.currentRequirementId?.sourceIndex;if(handled.has(key))continue;
      const decision=await benchmarkApprovalDecision(pending,{workspace:prepared.worktrees[arm],sourceFile:codingTaskSpec(cell.task_id).sourceFile,readFiles:task.include,excludedFiles:Object.keys(task.trustedFiles??{}),sessionId:native.client.sessionId,turnId:native.client.activeTurnId});
      if(decision.action!=='approve'){decisions.push({arm,actor:'benchmark_policy',kind:'outside_scope',status:'not_granted',reason:decision.reason,command_sha256:typeof pending.subject?.command==='string'?sha(pending.subject.command):null});stopped='approval_outside_benchmark_scope';return;}
      handled.add(key);const receipt=await pair.decide(arm,decision.decision);decisions.push({arm,actor:'benchmark_policy',kind:decision.kind,status:receipt?.status==='accepted'?'accepted':'unconfirmed'});
     }
    }
   };
   let failure=null;
   const targetFor=arms=>arms.length===2?'both':arms[0];
   const hasCurrentFinal=(record,arm)=>{const delivery=snapshot.arms[arm].delivery;return record.selected_arms.includes(arm)&&delivery?.turn_ordinal===record.expected_ordinals[arm]&&Number.isSafeInteger(delivery.public_finals)&&delivery.public_finals>=1&&delivery.turn_completed===true;};
   const observeTurn=(record,completed)=>({completed,
    delivery:Object.fromEntries(ARMS.map(arm=>[arm,record.selected_arms.includes(arm)&&snapshot.arms[arm].delivery?.turn_ordinal===record.expected_ordinals[arm]?snapshot.arms[arm].delivery:null])),
    usage_snapshot:Object.fromEntries(ARMS.map(arm=>[arm,record.selected_arms.includes(arm)?snapshot.arms[arm].usage:null])),
    response_presentation:Object.fromEntries(ARMS.map(arm=>[arm,completed&&hasCurrentFinal(record,arm)?describeEvidenceAnswer(snapshot.arms[arm].messages.findLast(m=>m.author==='Muse'&&m.phase==='finalAnswer')?.text):null]))});
   const beginTurn=(stage,selected,prompts)=>{
    const current=pair.snapshot();activeTurn={ordinal:turns.length+1,stage,selected_arms:[...selected],
     prompt_sha256:selected.length===2&&prompts.without===prompts.with?sha(prompts.with):null,
     prompt_sha256_by_arm:Object.fromEntries(selected.map(a=>[a,sha(prompts[a])])),
     expected_ordinals:Object.fromEntries(selected.map(a=>[a,(current.arms[a].delivery?.turn_ordinal??0)+1])),dispatch_receipts:{}};
   };
   const finishTurn=async selected=>{
    while(!selected.every(a=>pair.arms[a].ready())){check();if(pair.state!=='ready'||pair.error)throw Error('evidence_pair_failed');await approvePending();check();await wait(40);}
    for(const arm of selected)await pair.arms[arm].delivery.settled();snapshot=pair.snapshot();
    if(!selected.every(a=>snapshot.arms[a].last_turn_terminal==='completed'))throw Error('evidence_turn_not_completed');
    const row={...activeTurn,...observeTurn(activeTurn,true),observation_stage:'turn_complete'};turns.push(row);activeTurn=null;
    store.capture(evidenceId,snapshot);await store.flush(evidenceId);
    for(const arm of selected){
     const a=snapshot.arms[arm];if(a.model.status!=='observed'||!hasCurrentFinal(row,arm))throw Error('evidence_model_or_isolation_unqualified');
     if(arm==='without'){if(a.delivery.status!=='baseline_isolated')throw Error('evidence_model_or_isolation_unqualified');continue;}
     const rows=a.delivery.request_attribution;if(a.delivery.hook_linkage!=='read_marker_matched'||a.delivery.response_linkage!=='public_final_matched'||!rows.length||!rows.every(r=>['guidance_observed','fallback_observed'].includes(r.status)))throw Error('evidence_delivery_unqualified');
     if(plan.spec.guidance_variant==='contextual-v2'&&!rows.every(r=>r.collaboration_contract?.version===2&&r.collaboration_contract.status===(r.status==='guidance_observed'?'matched':'withdrawn')))throw Error('evidence_candidate_unqualified');
    }
   };
   const saveArtifacts=async(stage,reports,selected)=>{
    const records={};
    for(const arm of selected){
     const captured=await collectArtifactFilesWithBytes(prepared.worktrees[arm],'project');
     try{const digest=hashArtifactFiles(captured.files);if(digest!==reports[arm]?.summary?.artifact_sha256)throw Error('evidence_checked_artifact_changed');
      const root=path.join(directory,'attempts',stage),target=path.join(root,'artifacts',arm);await fs.mkdir(target,{recursive:true,mode:0o700});
      for(const[name,bytes]of captured.bytes){const destination=path.join(target,name);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.writeFile(destination,bytes,{mode:0o600,flag:'wx'});}
      const manifest={sha256:digest,files:captured.files};await writeEvidenceJson(path.join(root,'artifact-'+arm+'.json'),manifest);records[arm]={...reports[arm],artifact_record:'attempts/'+stage+'/artifact-'+arm+'.json'};
     }finally{captured.bytes.clear();}
    }
    return records;
   };
   const runChecks=async(selected,stage)=>{
    check();ci.check(targetFor(selected));await ci.wait();check();codeChecks=ci.snapshot();
    store.capture(evidenceId,{...pair.snapshot(),code_checks:codeChecks});await store.flush(evidenceId);
    const reports=Object.fromEntries(selected.map(a=>[a,codeChecks.arms[a].latest]));
    if(selected.some(a=>reports[a]?.current!==true||!['passed','failed'].includes(reports[a].status)||!reports[a].summary))return reports;
    return saveArtifacts(stage,reports,selected);
   };
   try{
    check();prepared=await d.prepareProjectWorktrees({repoRoot:task.repoRoot,originalCommit:task.originalCommit,include:task.include,taskPrompt:task.taskPrompt,taskId:task.taskId,verificationPlan:task.expectedPlanHash,backingRoot:backing,limits:task.limits,env});
    for(const arm of ARMS)await fs.appendFile(path.join(prepared.worktrees[arm],'AGENTS.md'),'\n'+EVIDENCE_WORKSPACE_INSTRUCTIONS+'\n');
    check();configs=await d.createIsolatedMuseConfigs({sessionDir:session,environment:env,nativeProfile:true});own(()=>d.removeIsolatedMuseConfigs(configs));check();bridge=await d.createTextboxMuseBridge({presence:source,environment:env,presentationGuidance:plan.spec.guidance_variant==='contextual-v2'});own(()=>bridge.close());
    const msp={...c.msp,museServeCommand:opts=>{check();const result=d.prepareEvidenceNativeBudget({directory:path.join(directory,'budget-'+opts.arm),workspace:opts.workspace,binary:c.binary,python:c.python,budgetScript:path.join(c.labRoot,'host-adapters/muse_budget.py'),environment:configs[opts.arm],maxGenerations:plan.limits.per_arm_generations,seconds:Math.floor(plan.limits.batch_timeout_ms/1000),anchor:sharedPythonAnchor});guards.push({arm:opts.arm,state:result.state});const argv=c.msp.museServeCommand(opts);argv.push('-c','runtime_capabilities.'+EVIDENCE_BUDGET_CAPABILITY+'='+JSON.stringify(result.capability),'-c','provider_retry.max_retries=0','-c','context.foreign_personal_rules=false','-c','context.foreign_personal_skills=false');if(argv[argv.indexOf('--preset')+1]!=='miniswe'||argv[argv.indexOf('--contributor-mode')+1]!=='off')throw Error('evidence_profile_unqualified');check();return argv;},spawnMuseMsp:opts=>{const client=c.msp.spawnMuseMsp(opts);clients.push(client);const arm=ARMS.find(a=>prepared.worktrees[a]===opts.workspace);if(!arm||armClients[arm]||typeof client.on!=='function'||typeof client.off!=='function')throw Error('evidence_tool_observer_unavailable');armClients[arm]=client;const observe=event=>{try{tools[arm].observe(event);}catch{toolObservationFailed=true;}};client.on('notification',observe);own(()=>client.off('notification',observe));return client;}};
    check();pair=await d.createStructuredPair({components:{...c,msp},workspaces:prepared.worktrees,environment:env,armEnvironments:configs,presenceBridge:bridge,model:cell.model_id,nativeQuestions:true,signal,prepareBoundary:()=>{throw Error('evidence_desktop_forbidden');}});
    own(()=>pair.stop());check();ci=new d.SessionCIService({pair,plan:task,workspaces:prepared.worktrees,verify:options=>{check();const deadlineMs=Math.floor(Math.min(options.deadlineMs,remainingMs()));if(deadlineMs<100)throw Error('evidence_batch_deadline');return runProjectVerification({...options,deadlineMs});}});
    store=await d.createEvidenceStore({directory:path.join(directory,'evidence'),metadata:{...entry.metadata,component_pins:c.pins,model:cell.model_id,contributor_mode:'off',evidence_mode:'live'},debounceMs:0});own(()=>store.close());check();evidenceId=store.begin(1);
    workflow=await executeEvidenceCodingWorkflow({expectedPlanHash:task.expectedPlanHash,
     checkpoint:async state=>{workflow=state;await writeEvidenceJson(path.join(directory,'workflow.json'),state);},
     implement:async()=>{check();const prompt=EVIDENCE_USER_TURNS[0];beginTurn('implementation',ARMS,{without:prompt,with:prompt});const receipt=await pair.submit(prompt,'both');activeTurn.dispatch_receipts=receipt.arms??{};if(receipt.status!=='started')throw Error('evidence_dispatch_unconfirmed');await finishTurn(ARMS);},
     check:arms=>runChecks(arms,'implementation'),
     prepareFeedback:async(arms,reports)=>{check();const ids=Object.fromEntries(arms.map(a=>[a,reports[a].id]));const lease=await ci.feedback(targetFor(arms),ids);return{lease,metadata:Object.fromEntries(arms.map(a=>[a,{check_id:ids[a],artifact_sha256:reports[a].summary.artifact_sha256,trusted_plan_hash:task.expectedPlanHash,prompt_sha256:sha(lease.prompts[a])}]))};},
     repair:async(preparedFeedback,arms)=>{check();const claim=preparedFeedback.lease.commit();beginTurn('repair',arms,claim.prompts);const receipts=Object.fromEntries(arms.map(a=>[a,{status:'not_started'}]));for(const arm of arms){let attempted=false;try{check();attempted=true;const r=await pair.submit(claim.prompts[arm],arm,{expectedTurns:{[arm]:null}});receipts[arm]={status:r.arms?.[arm]?.status??(r.status==='started'?'started':'unknown')};}catch{receipts[arm]={status:attempted?'unknown':'not_started'};}activeTurn.dispatch_receipts={...receipts};if(receipts[arm].status!=='started')break;}return{status:arms.every(a=>receipts[a]?.status==='started')?'started':'partial_or_unconfirmed',arms:receipts};},
     awaitRepair:finishTurn,recheck:arms=>runChecks(arms,'repair'),
     validateFinal:async reports=>{check();const current=ci.snapshot();for(const arm of ARMS){const latest=current.arms[arm].latest;if(latest?.current!==true||latest.id!==reports[arm].id||latest.summary?.artifact_sha256!==reports[arm].summary.artifact_sha256)return false;const captured=await collectArtifactFilesWithBytes(prepared.worktrees[arm],'project');try{if(hashArtifactFiles(captured.files)!==reports[arm].summary.artifact_sha256)return false;}finally{captured.bytes.clear();}}codeChecks=current;return true;},
    });
    if(workflow.code_quality!=='passed')failure='evidence_quality_checks_failed';
   }catch(e){workflow=e.workflow??workflow;failure=/^[a-z0-9_]{1,100}$/.test(e.message??'')?e.message:'evidence_native_execution_failed';if(failure==='startup_cleanup_unconfirmed')cleanup=false;if(pair)snapshot=pair.snapshot();}
   finally{
    await close();await drain();
    if(prepared&&cleanup){try{for(const arm of ARMS){const captured=await collectArtifactFilesWithBytes(prepared.worktrees[arm],'project');try{if(workflow?.final_checks&&hashArtifactFiles(captured.files)!==workflow.final_checks[arm]?.summary?.artifact_sha256)throw Error('evidence_final_artifact_changed');const target=path.join(directory,'artifacts',arm);await fs.mkdir(target,{recursive:true,mode:0o700});for(const [name,bytes]of captured.bytes){const destination=path.join(target,name);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.writeFile(destination,bytes,{mode:0o600,flag:'wx'});}await writeEvidenceJson(path.join(directory,'artifact-'+arm+'.json'),{sha256:hashArtifactFiles(captured.files),files:captured.files});}finally{captured.bytes.clear();}}await d.cleanupProjectWorktrees(backing,{env});await fs.rmdir(session);}catch(error){cleanup=false;failure??=/^[a-z_]{1,100}$/.test(error?.message??'')?error.message:'evidence_artifact_capture_failed';if(workflow?.final_checks){workflow={...workflow,status:'incomplete',stage:'final_artifact_capture',code_quality:'unverified',reason:failure,final_checks:Object.fromEntries(ARMS.map(a=>[a,{...workflow.final_checks[a],current:false,stale_reason:'final_capture_unconfirmed'}]))};try{await writeEvidenceJson(path.join(directory,'workflow.json'),workflow);}catch{}}}}else if(!prepared&&cleanup){try{await fs.rmdir(session);}catch{cleanup=false;}}
    activeClose=null;
   }
   if(toolObservationFailed)failure??='evidence_tool_observation_failed';
   const requestTrajectory=describeEvidenceTrajectoryRequests(cell.trajectory_id,turns);
   const blocked=['human_answer_required','human_approval_required','approval_outside_benchmark_scope'].includes(stopped),status=failure?(blocked?'blocked':signal.aborted?'interrupted':'failed'):requestTrajectory.status==='observed'?'completed':'partial';
   const safeReason=value=>typeof value==='string'&&/^[a-z_]{1,100}$/.test(value)?value:null;
   return{status,reason:stopped??failure??(status==='partial'?'evidence_trajectory_incomplete':null),arms:snapshot?.arms??null,turns,workflow,comparison_protocol:'shared_implementation_then_conditional_own_ci_feedback',tool_outcomes:toolSnapshot(),stop_diagnostics:{pair_error:safeReason(pair?.error),arms:Object.fromEntries(ARMS.map(arm=>{const guard=guards.find(g=>g.arm===arm);return[arm,{native_error:safeReason(pair?.arms[arm]?.error),guard_reserved:guard?.reserved??null,guard_blocked:guard?.blocked??null}];}))},code_checks:codeChecks,trajectory:source.snapshot(),request_trajectory:requestTrajectory,source_script_coverage:source.snapshot().read_sequence>=(cell.trajectory_id==='steady'?1:cell.trajectory_id==='change-during-work'?3:5)?'complete':'partial',approval_policy:approvalPolicy,automated_decisions:decisions,human_effort:'not_measured',answer_quality:'unreviewed',native_generations_reserved:guards.every(g=>Number.isSafeInteger(g.reserved))?guards.reduce((n,g)=>n+g.reserved,0):null,guard_maxima:plan.limits.per_arm_generations*2,cleanup_confirmed:cleanup};
  },
  async close(){return await activeClose?.();},
 };
}
