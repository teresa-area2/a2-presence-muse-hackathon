import {MuseUserInput} from './muse-user-input.mjs';
// One memory-only, user-approved Muse session. Events arriving before the
// turn/start acknowledgement are buffered until the accepted turn is bound.
import {humanSandboxPosture} from './memory-muse-session.mjs';
const ref=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const sourceRange=r=>r&&ref(r.stream?.kind)&&ref(r.stream?.id)&&ref(r.first?.id)&&ref(r.last?.id)&&Number.isSafeInteger(r.first.sequence)&&r.first.sequence>=0&&Number.isSafeInteger(r.last.sequence)&&r.last.sequence>=r.first.sequence;
export class StructuredArm {
 constructor({client,ledger,usage,delivery=null,workspace=null,requestedModel=null,arm=null,nativeQuestions=false,onFatal,onChange=()=>{},now=()=>performance.now()}){
  if(!client?.sessionId||!ledger||!usage||typeof onFatal!=='function'||typeof onChange!=='function'||typeof now!=='function')throw Error('structured_arm_invalid');
  this.arm=arm;this.client=client;this.ledger=ledger;this.usage=usage;this.delivery=delivery;this.requestedModel=requestedModel;this.workspace=workspace;this.onFatal=onFatal;this.onChange=onChange;this.state='ready';this.queue=[];this.error=null;this.turnId=null;this.events=[];this.turnEventStart=0;this.now=now;this.clockWatermark=null;this.timingInvalid=false;this.activeTiming=null;this.completedMs=0;this.incompleteMs=0;this.completedTurns=0;this.incompleteTurns=0;this.workGroup=0;this.nativePromptCommands=[];this.steers=new Map();this.waitingContinuation=false;this.interruptExpected=new Set();this.terminatedTurns=new Map();this.turnApprovalIds=new Set();this.lastTurnTerminal=null;this.questions=new MuseUserInput({client,enabled:nativeQuestions,onChange:()=>this.notify()});
 }
 activeTurn(){return !this.waitingContinuation&&['running','approval','question'].includes(this.state)&&!this.client.closed&&!this.client.stopping&&this.turnId===this.client.activeTurnId?this.turnId:null;}
 ready(){return this.state==='ready'&&!this.client.closed&&!this.client.stopping&&this.client.approvals.size===0&&this.questions.size===0;}
 prepare(){if(!this.ready())throw Error('structured_arm_not_ready');this.workGroup++;this.nativePromptCommands=[];this.turnApprovalIds.clear();this.state='starting';this.activeTiming={startedAt:this.time()};this.queue=[];this.turnEventStart=this.events.length;this.notify();}
 bindTurn(turnId){
  if(this.state!=='starting'||typeof turnId!=='string'||!turnId||this.client.turnIds.has(turnId))throw Error('structured_arm_binding_invalid');
  this.client.turnIds.add(turnId);this.client.activeTurnId=turnId;this.turnId=turnId;this.ledger.bindTurn(turnId);this.questions.bindTurn(turnId);this.state='running';
  this.delivery?.bind(this.client.sessionId,turnId);
  const pending=this.queue;this.queue=[];for(const item of pending){this.incoming(item.event,item.request);if(this.state==='failed')throw Error('structured_arm_event_failed');}this.notify();
 }
 incoming(event,request=false){
  if(this.state==='failed'||this.state==='closed')return;
  if(this.state==='starting'){if(this.queue.length>=256)return this.fail('event_capacity');this.queue.push({event,request});return;}
  try{
   const {method,params}=event??{};
   if(method==='session/started'&&!request){const s=params?.session;if(!this.workspace||s?.sessionId!==this.client.sessionId||s.workspaceRoot!==this.workspace||s.path||s.parentSessionId||s.forkedFrom||s.sideFrom||s.spawnedBy||s.approvalMode?.mode!=='onRequest'||!humanSandboxPosture(s.permissionState))throw Error('foreign_session');return;}
   if(!params||params.sessionId!==this.client.sessionId)throw Error('foreign_session');
   if(method==='turn/started'&&!request){this.acceptNativeStart(params);return;}
   if(method==='session/statusChanged'){if(!humanSandboxPosture(params.permissionState))throw Error('permission_drift');return;}
   if(method==='session/viewHealthChanged'){if(params.health==='unavailable')throw Error('view_unavailable');return;}
   if(method==='session/closed')throw Error('session_closed');
   if(method==='session/approvalModeChanged'){if(params.mode!=='onRequest'||params.commandId!==this.client.startCommandId)throw Error('approval_drift');return;}
   if(method==='session/permissionProfileChanged'||method==='approval/reviewing')throw Error('permission_drift');
   if(method.startsWith('item/')&&['subagent','workflow','reminderChild'].includes(params.item?.kind))throw Error('unexpected_child');
   if(['approval/updated','approval/resolved'].includes(method)){for(const [turn,ids]of this.terminatedTurns)if(!this.client.approvals.has(params.approvalId)&&ids.has(params.approvalId)&&(params.turnId===turn||method==='approval/updated'&&params.turnId===undefined))return;}
   if(method==='userInput/request'||method==='userInput/requested'){
    if(request!== (method==='userInput/request'))throw Error('user_input_scope_invalid');
    if(!this.questions.knows(params.userInputId)&&this.events.length+this.questionReserve()+(Array.isArray(params.questions)?params.questions.length:0)+1>512)throw Error('event_capacity');
    this.questions.present(params,{...(request?{requestId:event.id}:{}),allowNew:['running','approval','question'].includes(this.state)});
    if(['running','approval','question'].includes(this.state))this.state=this.client.approvals.size?'approval':this.questions.size?'question':'running';this.notify();return;
   }
   if(method==='userInput/settled'&&!request){const settled=this.questions.settle(params);if(settled)this.archiveQuestion(settled.prompt,settled);if(['running','approval','question'].includes(this.state))this.state=this.client.approvals.size?'approval':this.questions.size?'question':'running';this.notify();return;}
   if(request||['approval/updated','approval/resolved'].includes(method)){
    const turn=method==='approval/updated'?this.client.approvals.get(params.approvalId)?.turnId:params.turnId;
    if(!['running','approval','question'].includes(this.state)||turn!==this.turnId)throw Error('approval_scope_invalid');
    if(request){if(method!=='approval/request')throw Error('unsupported_request');this.client.presentApproval(event);this.turnApprovalIds.add(params.approvalId);this.state='approval';this.notify();return;}
    if(method==='approval/updated'){this.client.updateApproval(params);this.state='approval';this.notify();return;}
    this.client.resolveApproval(params);this.turnApprovalIds.add(params.approvalId);this.state=this.client.approvals.size?'approval':this.questions.size?'question':'running';this.notify();return;
   }
   if(method==='session/tokenUsage')this.usage.observe(params);
   if(method==='item/completed'&&params.item?.kind==='userMessage'&&params.item.steered===true&&params.item.turnId===this.turnId){const e=this.steers.get(params.item.commandId);if(!e||e.group!==this.workGroup||e.fromTurn!==this.turnId&&!this.terminatedTurns.has(e.fromTurn)||e.state==='refused')throw Error('native_steer_scope_invalid');e.inlineConsumed=true;e.consumedTurn=this.turnId;if(!this.nativePromptCommands.includes(params.item.commandId))this.nativePromptCommands.push(params.item.commandId);try{this.delivery?.setContinuationInputs?.(this.nativePromptCommands,this.client.sessionId,this.turnId);}catch{try{this.delivery?.fail?.();}catch{}}}
   if(method.startsWith('item/')&&params.item?.turnId==null)return;
   const out=this.ledger.accept(method,params);
   // A held tool has not executed. The pinned Lab projection predates held;
   // do not expose its ordinary inProgress/completed status as execution.
   if(params.item?.kind==='toolCall'&&(params.item.held!==undefined&&params.item.held!==false||params.item.heldFor!=null))for(const e of out)if(e.type==='task_status'&&e.payload?.kind==='tool')e.payload.status='unknown';
   if(out.length){if(this.events.length+out.length+this.questionReserve()>512)throw Error('event_capacity');this.events.push(...out);}
   for(const event of out)if(event.type==='public_message'&&event.payload.message_phase==='finalAnswer')this.delivery?.publicFinal(event.payload);
   if(method==='turn/completed'){
    if((this.state==='ready'||this.waitingContinuation)&&params.turnId===this.turnId&&params.terminal===this.lastTurnTerminal&&out.length===0)return;
    if(params.turnId!==this.turnId||!['running','approval','question'].includes(this.state))throw Error('completion_scope_invalid');
    if(['completed','failed','cancelled'].includes(params.terminal))this.lastTurnTerminal=params.terminal;
    const closedApprovalIds=new Set([...this.turnApprovalIds,...this.client.approvals.keys()]);
    const interrupted=params.terminal==='cancelled'&&this.interruptExpected.has(params.turnId);
    if(interrupted){const pending=this.questions.snapshot();this.questions.endTurn();for(const p of pending)this.archiveQuestion(p);this.client.approvals.clear();}
    else{if(this.client.approvals.size!==0||this.questions.size!==0)throw Error('completion_scope_invalid');if(params.terminal!=='completed')throw Error('turn_not_completed');}
    this.terminatedTurns.set(params.turnId,closedApprovalIds);if(this.terminatedTurns.size>64)this.terminatedTurns.delete(this.terminatedTurns.keys().next().value);
    this.interruptExpected.delete(params.turnId);this.finishTiming(!interrupted);this.waitingContinuation=this.pendingContinuation(params.turnId);this.state=this.waitingContinuation?'running':'ready';void this.delivery?.finishTurn();
   }
   this.notify();
  }catch(error){const reason=typeof error?.message==='string'&&/^[a-z_]{1,80}$/.test(error.message)?error.message:'native_event_unverified';this.fail(reason);}
 }
 pendingContinuation(turnId){return [...this.steers.values()].some(e=>e.group===this.workGroup&&e.dispatched&&!e.adoptedTurn&&!e.inlineConsumed&&e.state!=='refused');}
 acceptNativeStart(p){
  if(!ref(p.turnId)||!ref(p.commandId)||typeof p.viewCursor!=='string'||!p.viewCursor||p.viewCursor.length>8192||!sourceRange(p.sourceRange))throw Error('native_start_invalid');
  const identity=JSON.stringify([p.sessionId,p.turnId,p.commandId,p.viewCursor,p.sourceRange.stream.kind,p.sourceRange.stream.id,p.sourceRange.first.id,p.sourceRange.first.sequence,p.sourceRange.last.id,p.sourceRange.last.sequence]),entry=this.steers.get(p.commandId);if(entry?.adoptedTurn){if(entry.adoptedTurn!==p.turnId||entry.startIdentity!==identity)throw Error('native_continuation_conflict');return;}
  if(!entry&&p.turnId===this.turnId&&this.client.turnIds.has(p.turnId)&&!this.waitingContinuation)return;
  if(!entry||!entry.dispatched||entry.state==='refused'||entry.inlineConsumed||entry.group!==this.workGroup||!this.terminatedTurns.has(entry.fromTurn)||!this.terminatedTurns.has(this.turnId)||!this.waitingContinuation||this.state!=='running'||this.questions.size||this.client.approvals.size||this.client.turnIds.has(p.turnId))throw Error('native_continuation_unowned');
  this.ledger.bindTurn(p.turnId);this.questions.bindTurn(p.turnId);entry.adoptedTurn=p.turnId;entry.startIdentity=identity;this.client.turnIds.add(p.turnId);this.client.activeTurnId=p.turnId;this.turnId=p.turnId;this.waitingContinuation=false;this.nativePromptCommands=[];this.turnApprovalIds.clear();this.turnEventStart=this.events.length;this.activeTiming={startedAt:this.time()};this.state='running';
  try{if(this.delivery?.continueSteer?.(p.commandId,this.client.sessionId,p.turnId)!==true)this.delivery?.fail?.();}catch{try{this.delivery?.fail?.();}catch{}}this.notify();
 }
 questionReserve(){return this.questions.metrics().pending_questions+this.questions.size;}
 archiveQuestion(prompt,settled=null){
  const out=prompt.questions.map(q=>({type:'public_message',payload:{text:q.question,message_phase:'question'}}));let reply=null;
  if(settled?.outcome==='clarified')reply=settled.clarification.content;
  else if(settled?.outcome==='answered')reply=prompt.questions.map(q=>{const a=settled.answers.find(a=>a.questionId===q.id);const value=a.freeText??a.selectedLabel??(a.selectedLabels.length?a.selectedLabels.join('\n'):'[]');return value+(a.note?'\n'+a.note:'');}).join('\n');
  else if(settled?.outcome==='cancelled')reply='Question skipped.';
  if(reply!==null)out.push({type:'human_message',payload:{text:reply,message_phase:'question_reply',submission_target:this.arm??'unknown'}});
  if(this.events.length+out.length+this.questionReserve()>512)throw Error('event_capacity');this.events.push(...out);
 }
 async requestTurn(method,params){
  if(method!=='turn/steer')return this.client.request(method,params);
  const input=params?.input;if(params?.sessionId!==this.client.sessionId||params.expectedTurnId!==this.activeTurn()||!ref(params.commandId)||!Array.isArray(input)||input.length!==1||input[0]?.type!=='text'||typeof input[0].text!=='string'||!input[0].text.trim()||input[0].text.length>14000)throw Error('native_steer_scope_invalid');
  if(this.steers.size>=64||this.steers.has(params.commandId))throw Error('native_steer_capacity');const entry={group:this.workGroup,fromTurn:params.expectedTurnId,prompt:input[0].text,state:'pending',dispatched:false,adoptedTurn:null,inlineConsumed:false};this.steers.set(params.commandId,entry);
  let token=null;const invalidate=()=>{try{this.delivery?.fail?.();}catch{}};try{token=this.delivery?.prepareSteer?.(input[0].text,{sessionId:params.sessionId,turnId:params.expectedTurnId,commandId:params.commandId});}catch{invalidate();}
  const settle=status=>{entry.state=status;try{this.delivery?.settleSteer?.(token,status);}catch{invalidate();}if(status==='refused'&&(entry.adoptedTurn||entry.consumedTurn))this.fail('native_steer_receipt_conflict');if(this.waitingContinuation&&!this.pendingContinuation(this.turnId)){this.waitingContinuation=false;this.state='ready';this.notify();}};
  entry.dispatched=true;try{const result=await this.client.request(method,params);settle(result?.status==='accepted'&&result.commandId===params.commandId&&result.turnId===params.expectedTurnId?'accepted':'unknown');return result;}catch(e){settle(e?.message==='muse_rpc_rejected'?'refused':'unknown');throw e;}
 }
 async interrupt(turnId,commandId){
  if(this.activeTurn()!==turnId)return{status:'not_started'};if(this.interruptExpected.has(turnId))return{status:'not_started'};
  this.interruptExpected.add(turnId);let out;try{out=await this.client.request('turn/interrupt',{sessionId:this.client.sessionId,turnId,commandId});}catch(e){if(e?.message==='muse_rpc_rejected'){this.interruptExpected.delete(turnId);return{status:'not_started'};}return{status:'unknown'};}
  return{status:out?.status==='accepted'&&out.commandId===commandId&&out.turnId===turnId?'interrupt_requested':'unknown'};
 }
 async question(decision){if(!['question','approval'].includes(this.state))throw Error('user_input_not_pending');return this.questions.respond(decision);}
 async decide(decision){if(this.state!=='approval')throw Error('approval_not_pending');return this.client.decideApproval(decision);}
 fail(reason){if(this.state==='failed'||this.state==='closed')return;this.steers.clear();this.waitingContinuation=false;this.interruptExpected.clear();this.finishTiming(false);this.state='failed';this.error=reason;this.queue=[];const pending=this.questions.snapshot();this.questions.close();for(const p of pending){try{this.archiveQuestion(p);}catch{this.error??='event_capacity';}}try{this.notify();}finally{this.onFatal(reason);}}
 // Monotonic dispatch-to-completion wall time includes approvals and local tool
 // waits. It is not provider latency, attention, or summed token-event duration.
 time(){if(this.timingInvalid)return null;let at;try{at=this.now();}catch{this.timingInvalid=true;return null;}if(typeof at!=='number'||!Number.isFinite(at)||at<0||(this.clockWatermark!==null&&at<this.clockWatermark)){this.timingInvalid=true;return null;}this.clockWatermark=at;return at;}
 finishTiming(completed){if(!this.activeTiming)return;const at=this.time(),elapsed=at===null||this.activeTiming.startedAt===null?null:at-this.activeTiming.startedAt;if(completed){this.completedTurns++;if(elapsed!==null)this.completedMs+=elapsed;}else{this.incompleteTurns++;if(elapsed!==null)this.incompleteMs+=elapsed;}this.activeTiming=null;}
 close(){this.steers.clear();this.waitingContinuation=false;this.interruptExpected.clear();this.finishTiming(false);this.state='closed';this.queue=[];const pending=this.questions.snapshot();this.questions.close();for(const p of pending){try{this.archiveQuestion(p);}catch{this.error??='event_capacity';}}}
 elapsed(){
  const at=this.activeTiming?this.time():null,base={completed_turns:this.completedTurns,incomplete_turns:this.incompleteTurns,includes_approval_wait:true};
  if(this.timingInvalid)return {...base,status:'unavailable',completed_seconds:null,in_flight_seconds:null,incomplete_seconds:null,total_seconds:null};
  if(!this.activeTiming&&!this.completedTurns&&!this.incompleteTurns)return {...base,status:'not_observed',completed_seconds:null,in_flight_seconds:null,incomplete_seconds:null,total_seconds:null};
  const active=this.activeTiming?(at-this.activeTiming.startedAt)/1000:null,completed=this.completedMs/1000,incomplete=this.incompleteMs/1000;
  return {...base,status:this.incompleteTurns?'partial':this.activeTiming?'in_progress':'complete',completed_seconds:completed,in_flight_seconds:active,incomplete_seconds:incomplete,total_seconds:completed+incomplete+(active??0)};
 }
 notify(){try{this.onChange();}catch{/* UI observers cannot block session safety. */}}
}
