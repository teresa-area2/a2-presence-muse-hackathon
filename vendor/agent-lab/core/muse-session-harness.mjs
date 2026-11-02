import {EventEmitter} from 'node:events';
import {MusePublicEvents} from './muse-public-events.mjs';
import {presenceView} from './presence-view.mjs';
import {lookupNativeSessions,readTelemetry} from './telemetry.mjs';
import {uuid7,qualifiedHumanPermission} from './muse-msp.mjs';

const arms=['without','with'];
const phases=['implementation','review-handback'];
// This controller owns identity and phase/deadline state, never a browser.
// Native approvals remain pending until a reviewed, currently offered choice.
export class MuseSessionHarness extends EventEmitter{
 constructor({folder,workspaces,createClient,admit,readPresence=async()=>null,readActualPresence=async()=>null,sessionIndex=lookupNativeSessions,telemetry=readTelemetry,deadlineMs=600000,evidenceMode='live',now=()=>performance.now()}){
  super();if(!workspaces||arms.some(a=>typeof workspaces[a]!=='string')||typeof createClient!=='function'||typeof admit!=='function'||!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>600000)throw Error('harness_configuration_invalid');
  this.folder=folder;this.workspaces=workspaces;this.createClient=createClient;this.admit=admit;this.readPresence=readPresence;this.readActualPresence=readActualPresence;this.sessionIndex=sessionIndex;this.readTelemetry=telemetry;this.deadlineMs=deadlineMs;this.mode=evidenceMode;this.now=now;
  this.id=uuid7();this.arms={};this.phases=[];this.phaseEvidence=[];this.started=null;this.timer=null;this.submitting=false;this.opening=false;this.revision=0;this.closed=false;this.stopping=false;this.stopPromise=null;this.failed=null;this.observer=null;this.audit=[];
 }
 live(revision){return revision===this.revision&&!this.closed&&!this.stopping&&!this.failed&&(this.started===null||this.now()-this.started<this.deadlineMs);}
 check(revision){if(!this.live(revision))throw Error('harness_operation_revoked');}
 async open(){
  if(this.opening||Object.keys(this.arms).length||this.closed||this.stopping)throw Error('harness_already_opened');
  this.opening=true;const revision=this.revision;
  try{for(const arm of arms){
   this.check(revision);
   const sessionId=uuid7(),client=await this.createClient(arm,{workspace:this.workspaces[arm],sessionId});
   if(!this.live(revision)){await client.stop?.();throw Error('harness_operation_revoked');}
   const state={client,sessionId,workspace:this.workspaces[arm],ledger:new MusePublicEvents({arm,sessionId,evidenceMode:this.mode}),queue:[],pending:false,turnId:null,runId:null,terminal:null,verifiedStart:false,phaseVerified:false,phase:null,actualPresence:null};this.arms[arm]=state;
   client.on('notification',event=>this.incoming(arm,event,false));client.on('request',event=>this.incoming(arm,event,true));client.on('closed',reason=>{if(!this.closed&&!this.stopping)this.fail(reason);});
   state.handshake=await client.initialize({experimentalApi:true});this.check(revision);
   if(state.handshake.sandboxAvailability!=='available')throw Error('harness_sandbox_unavailable');
   const session=await client.startSession({sessionId,workspace:state.workspace});this.check(revision);
   if(!qualifiedHumanPermission(session.permissionState))throw Error('harness_permission_unqualified');state.session=session;
  }return this.coordinator();}catch(error){await this.stop();throw error;}finally{this.opening=false;}
 }
 incoming(arm,event,request){
  const state=this.arms[arm];if(this.closed||this.stopping||this.failed||!state)return;
  try{
   if(state.pending){if(state.queue.length>=256)throw Error('harness_early_event_limit');state.queue.push({event,request});return;}
   const {method,params}=event;
   // Connection-wide and session lifecycle notifications carry no task facts.
   if(params.sessionId&&params.sessionId!==state.sessionId)throw Error('harness_foreign_session');
   if(!state.session&&method.startsWith('session/'))return; // Start ack seeds the authoritative latest permission snapshot.
   if(method==='session/permissionProfileChanged')throw Error('harness_permission_drift');
   if(method==='session/approvalModeChanged'){
    // The exact controller start command's same-mode audit may arrive
    // after its ack. Other reconfigurations always revoke qualification.
    if(params.commandId===state.client.startCommandId&&params.commandId&&params.mode==='onRequest'&&params.source==='approvalReconfigure')return;
    throw Error('harness_permission_drift');
   }
   if(method==='session/statusChanged'){
    if(!qualifiedHumanPermission(params.permissionState))throw Error('harness_permission_drift');return;
   }
   if(method==='approval/reviewing')throw Error('harness_unaccounted_approval_review');
   if(method.startsWith('approval/')){
    const target=params.turnId??state.client.approvals.get(params.approvalId)?.turnId;
    if(!target||target!==state.turnId||state.terminal)throw Error('harness_approval_turn_mismatch');
   }
   if(request){
    if(method!=='approval/request')throw Error('harness_unsupported_native_request');
    const approval=state.client.presentApproval(event);this.audit.push({kind:'approval_presented',arm,approval_id:approval.approvalId,turn_id:approval.turnId,at:new Date().toISOString()});
    this.emit('approval',{arm,approval});return;
   }
   if(method==='approval/updated'){state.client.updateApproval(params);this.emit('approval',{arm,approval:state.client.approvals.get(params.approvalId)});return;}
   if(method==='approval/resolved'){state.client.resolveApproval(params);this.audit.push({kind:'approval_resolved',arm,approval_id:params.approvalId,turn_id:params.turnId,decision:params.decision,resolved_by:params.resolvedBy,at:new Date().toISOString()});return;}
   if(method.startsWith('item/')&&['subagent','workflow','reminderChild'].includes(params.item?.kind))throw Error('harness_unaccounted_child_work');
   if(method==='turn/started'){
    if(params.turnId!==state.turnId)throw Error('harness_turn_start_mismatch');state.verifiedStart=true;return;
   }
   if(method.startsWith('item/')&&params.item?.turnId==null)return;
   if(method==='turn/completed'&&params.turnId!==state.turnId)throw Error('harness_completion_scope_mismatch');
   for(const projected of state.ledger.accept(method,params))this.emit('public',projected);
   if(method==='turn/completed'){if(state.client.approvals.size)throw Error('harness_unresolved_approval_at_completion');state.terminal=params.terminal;this.emit('completion',{arm,terminal:params.terminal,turnId:params.turnId});}
  }catch(error){this.fail(error.message);}
 }
 fail(reason){if(this.failed||this.closed)return;this.failed=/^[a-z_]{1,100}$/.test(reason??'')?reason:'harness_evidence_failed';this.emit('failure',this.failed);void this.stop();}
 async submit({phase,text}){
  if(this.closed||this.stopping||this.failed||this.submitting||Object.keys(this.arms).length!==2||phases[this.phases.length]!==phase||typeof text!=='string'||!text.trim()||text.length>16000)throw Error('harness_submission_invalid');
  if(this.phases.length&&arms.some(a=>this.arms[a].terminal!=='completed'||!this.arms[a].phaseVerified))throw Error('harness_previous_phase_unverified');
  // Reserve synchronously before the first await: parallel HTTP submissions
  // must never pass admission twice or reset aggregate workflow state.
  this.submitting=true;let armed=false;const admissionRevision=this.revision;
  try{
   if(await this.admit({phase,workflowId:this.id})!==true)throw Error('harness_dispatch_not_admitted');
   this.check(admissionRevision);
   if(this.started!==null&&this.now()-this.started>=this.deadlineMs)throw Error('harness_deadline_exhausted');
   armed=true;
   if(this.started===null){this.started=this.now();this.timer=setTimeout(()=>this.fail('harness_deadline_exhausted'),this.deadlineMs);}
   this.observer=await this.readPresence(); // Observer is never model input.
   this.check(admissionRevision);
   const phaseRevision=++this.revision;
   this.phases.push(phase);this.audit.push({kind:'phase_dispatch',phase,at:new Date().toISOString()});
   await Promise.all(arms.map(async arm=>{
    const state=this.arms[arm];state.pending=true;state.terminal=null;state.runId=null;state.verifiedStart=false;state.phaseVerified=false;state.phase=phase;state.actualPresence=null;
    this.check(phaseRevision);
    const turnId=await state.client.startTurn({text,admit:()=>this.live(phaseRevision),dispatchGuard:()=>this.live(phaseRevision)});
    this.check(phaseRevision);
    state.turnId=turnId;state.ledger.bindTurn(turnId);state.pending=false;
    for(const entry of state.queue.splice(0))this.incoming(arm,entry.event,entry.request);
   }));
   return this.coordinator();
  }catch(error){if(armed)this.fail(error.message);throw error;}finally{this.submitting=false;}
 }
 async reconcile(){
  if(this.closed||this.failed)throw Error('harness_unavailable');
  if(this.submitting)throw Error('harness_submission_pending');
  const revision=this.revision,phase=this.phases.at(-1);
  const expected=Object.fromEntries(arms.map(arm=>[arm,{sessionId:this.arms[arm].sessionId,turnId:this.arms[arm].turnId}]));
  const ownedSessions={};
  for(const arm of arms){
   const state=this.arms[arm];if(!state.terminal||!state.verifiedStart)throw Error('harness_native_completion_pending');
   // Equality is a candidate checked against strict native evidence, never an
   // inferred binding. No index hit means no run binding and no broad fallback.
   const ownedSession={sessionId:state.sessionId,runId:state.turnId};
   const index=await this.sessionIndex('muse',state.workspace,undefined,{ownedSession});
   this.check(revision);
   if(index.error||index.files?.length!==1||index.files[0].id!==state.sessionId||index.files[0].runId!==state.turnId)throw Error('harness_native_run_unverified');
   ownedSessions[arm]={sessionId:state.sessionId,runId:index.files[0].runId};
  }
  const result=await this.readTelemetry({folder:this.folder,host:'muse',ownedSessions,ownedTurnIds:Object.fromEntries(arms.map(a=>[a,expected[a].turnId])),sessionIndex:this.sessionIndex});
  this.check(revision);
  for(const arm of arms){const observed=result.arms?.[arm],binding=ownedSessions[arm];
   if(observed?.scope_binding?.verified!==true||observed.scope_binding.session_id!==binding.sessionId||observed.scope_binding.run_id!==binding.runId||!observed.available||observed.limited||observed.state!=='completed'||!Number.isFinite(observed.tokens?.input_tokens)||!Number.isFinite(observed.tokens?.output_tokens))throw Error('harness_owned_telemetry_unverified');
   const usage=this.arms[arm].ledger.currentTurnUsage();
   if(!usage.model_completions||observed.model_generations!==usage.model_completions)throw Error('harness_usage_mismatch');
   for(const [msp,native]of [['inputTokens','input_tokens'],['outputTokens','output_tokens'],['cacheReadTokens','cache_read_input_tokens'],['cacheWriteTokens','cache_creation_input_tokens']]){
    if(Number.isFinite(usage.raw[msp])&&Number.isFinite(observed.tokens[native])&&usage.raw[msp]!==observed.tokens[native])throw Error('harness_usage_mismatch');
    if(usage.turn_aggregate&&Number.isFinite(usage.raw[msp])&&Number.isFinite(usage.turn_aggregate[msp])&&usage.raw[msp]!==usage.turn_aggregate[msp])throw Error('harness_usage_mismatch');
   }
  }
  const actual={};for(const arm of arms){actual[arm]=await this.readActualPresence(arm,{...ownedSessions[arm],turnId:expected[arm].turnId});this.check(revision);}
  this.check(revision);if(this.phases.at(-1)!==phase||arms.some(a=>this.arms[a].turnId!==expected[a].turnId))throw Error('harness_reconciliation_stale');
  for(const arm of arms){const s=this.arms[arm];s.runId=ownedSessions[arm].runId;
   for(const event of s.ledger.bindTurn(s.turnId,{runId:s.runId}))this.emit('public',event);
   s.actualPresence=actual[arm];
   if(!s.phaseVerified)this.emit('public',s.ledger.recordPresence(s.actualPresence));s.phaseVerified=true;
  }
  if(!this.phaseEvidence.some(x=>x.phase===phase))this.phaseEvidence.push({phase,bindings:structuredClone(ownedSessions),telemetry:structuredClone(result)});
  return result;
 }
 async decide({arm,approvalId,requirementId,choiceId,reviewedBy,reviewNote}){
  if(this.closed||this.stopping||this.failed||!arms.includes(arm)||this.arms[arm].terminal||!['human','coordinator'].includes(reviewedBy)||typeof reviewNote!=='string'||!reviewNote.trim()||reviewNote.length>1000)throw Error('harness_approval_review_required');
  const result=await this.arms[arm].client.decideApproval({approvalId,requirementId,choiceId});
  this.audit.push({kind:'approval_decision_submitted',arm,approval_id:approvalId,reviewed_by:reviewedBy,review_note:reviewNote,at:new Date().toISOString()});return result;
 }
 async collectIncompleteTelemetry(){
  const ownedSessions=Object.fromEntries(arms.map(arm=>{const s=this.arms[arm];return [arm,s?.turnId?{sessionId:s.sessionId,runId:s.turnId}:null];}));
  const result=await this.readTelemetry({folder:this.folder,host:'muse',ownedSessions,ownedTurnIds:Object.fromEntries(arms.map(a=>[a,this.arms[a]?.turnId??null])),sessionIndex:this.sessionIndex});
  return {...result,verified_prior_phases:structuredClone(this.phaseEvidence),measurement_state:'incomplete_or_unverified',failure:this.failed,closed:this.closed};
 }
 participant(arm){
  if(!arms.includes(arm)||!this.arms[arm])throw Error('harness_arm_invalid');
  return {schema_version:1,workflow_ref:this.id,arm,phase:this.arms[arm].phase,status:this.failed?'failed':this.closed?'closed':this.arms[arm].terminal??'ready',events:this.arms[arm].ledger.snapshot(),presence:presenceView({arm,evidenceMode:this.mode,presence:this.arms[arm].actualPresence})};
 }
 coordinator(){
  return {schema_version:1,workflow_id:this.id,phase:this.phases.at(-1)??null,closed:this.closed,failed:this.failed,evaluator:{enabled:false,calls:0,tokens:0,elapsed_seconds:0},observer:presenceView({arm:'without',audience:'coordinator',evidenceMode:this.mode,presence:this.observer}).presence,arms:Object.fromEntries(arms.filter(a=>this.arms[a]).map(arm=>{const s=this.arms[arm];return [arm,{session_id:s.sessionId,turn_id:s.turnId,run_id:s.runId,terminal:s.terminal,verified_start:s.verifiedStart,pending_approvals:[...s.client.approvals.values()]}];}))};
 }
 async stop(){
  if(this.stopPromise)return this.stopPromise;if(this.closed)return;
  this.stopping=true;this.revision++;clearTimeout(this.timer);
  this.stopPromise=Promise.allSettled(Object.values(this.arms).map(s=>s.client.stop?.(s.turnId))).then(()=>{this.closed=true;this.stopping=false;});
  return this.stopPromise;
 }
}

// Fixed-artifact handbacks get one assigned condition, never a counterfactual
// second run. This is an offline contract; no model is dispatched here.
export function fixedArtifactReviewContract({condition,caseId,artifactSha256}){
 if(!arms.includes(condition)||!/^[A-Za-z0-9_-]{1,64}$/.test(caseId??'')||!/^[a-f0-9]{64}$/.test(artifactSha256??''))throw Error('harness_review_contract_invalid');
 return {schema_version:1,mode:'fixed_artifact_handback',assigned_arm:condition,case_id:caseId,artifact_sha256:artifactSha256,arm_count:1,max_generations:2,deadline_seconds:90,coding_tools:false,counterfactual_runs:0,evaluator:false,status:'contract_only_native_tool_free_surface_requires_qualification'};
}
