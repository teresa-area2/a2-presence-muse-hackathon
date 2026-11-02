// Pure browser ES module: session target/approval controls.
// No imports. All functions are pure and side-effect free.

const ARMS = ["without", "with"];

// A normal click selects one recipient; Command/Ctrl-click adds a recipient.
// Selecting both panes this way must always target both, regardless of which
// recipients were already selected. A normal click returns to a single pane.
export function nextRecipientTarget(current, clicked, {metaKey = false, ctrlKey = false} = {}) {
  if (clicked === 'both') return 'both';
  if (!ARMS.includes(clicked)) return current;
  if (!metaKey && !ctrlKey) return clicked;
  const members = new Set(selectedArms(current));
  members.add(clicked);
  return members.size === 2 ? 'both' : [...members][0] ?? clicked;
}

const MAX_TEXT = 14000;
const MAX_ID = 160;
const MAX_COMMAND = 12000;
const MAX_LABEL = 200;
const MAX_CHOICES = 64;

function isArm(value) {
  return value === "without" || value === "with";
}

function isBoundedString(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

// selectedArms(target): array of arms for 'without' / 'with' / 'both', else [].
export function selectedArms(target) {
  if (target === "without") return ["without"];
  if (target === "with") return ["with"];
  if (target === "both") return ["without", "with"];
  return [];
}

// Only an unmodified, non-repeating Enter submits. Shift+Enter stays a newline.
export function sessionSubmitKey(event) {
  return event?.key === 'Enter' && !event.shiftKey && !event.altKey &&
    !event.ctrlKey && !event.metaKey && !event.repeat && !event.isComposing && event.keyCode !== 229;
}

// Never erase a draft typed or retyped while the earlier request was pending.
export function draftAfterSend({current, submitted, revision, submittedRevision, acknowledged, generation, submittedGeneration}) {
  return acknowledged === true && generation === submittedGeneration && revision === submittedRevision && current === submitted ? '' : current;
}

// canSubmitTarget({state,target,text,connected,pending,uncertain}):
// true only when every gate passes; otherwise false.
export function canSubmitTarget({ state, target, text, connected, pending, uncertain } = {}) {
  if (connected !== true) return false;
  if (pending !== false) return false;
  if (uncertain !== false) return false;
  if (typeof text !== "string") return false;
  if (text.trim().length === 0) return false;
  if (text.length > MAX_TEXT) return false;
  if (new TextEncoder().encode(JSON.stringify({text,target})).length>24000) return false;
  if (!state || state.status !== "ready") return false;

  const arms = selectedArms(target);
  if (arms.length === 0) return false;
  if (!state.arms || typeof state.arms !== "object") return false;

  for (const arm of arms) {
    const armState = state.arms[arm];
    if (!armState || typeof armState !== "object") return false;
    if (!Array.isArray(armState.approvals)) return false;
    if (armState.status === 'ready') { if (armState.approvals.length !== 0) return false; }
    else if (!['running','approval','question'].includes(armState.status) || !isBoundedString(armState.active_turn_id,1,160) || armState.interrupt_pending===true) return false;
  }
  return true;
}

// approvalFingerprint(approval): stable JSON string or null.
// Snapshot approval links via `requirementId` (not `currentRequirementId`).
// Fingerprint keys: approvalId, requirement {requirementId, sourceIndex},
// command, choices [{choiceId, label}].
const displayText=(value,max,multiline=false,empty=false)=>typeof value==='string'&&(empty||value.length>0)&&value.length<=max&&!/[\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)&&!(multiline?/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u:/[\u0000-\u001f\u007f-\u009f]/u).test(value);
export function approvalFingerprint(approval) {
 if(!approval||approval.status!=='review'||!(/^[a-f0-9]{64}$/).test(approval.review_token??''))return null;
 if(approval.projection_version===2){
  const a=approval,r=a.requirementId;
  if(a.display_complete!==true||!isBoundedString(a.approvalId,1,MAX_ID)||r?.approvalId!==a.approvalId||!Number.isSafeInteger(r.sourceIndex)||r.sourceIndex<0||!displayText(a.subject_display,512*1024,true)||!a.subject||typeof a.subject.kind!=='string')return null;
  if(a.raw_args_omitted==='cua_sensitive_input'&&(typeof a.cua_card_display!=='string'||a.raw_args_display!==undefined))return null;
  if(a.cua_card_display!==undefined&&!displayText(a.cua_card_display,512*1024,true)||a.raw_args_display!==undefined&&!displayText(a.raw_args_display,512*1024,true)||a.reviewer_reason_display!==undefined&&!displayText(a.reviewer_reason_display,512*1024,true))return null;
  if(!Array.isArray(a.choices)||!a.choices.length||a.choices.length>16)return null;
  const seen=new Set();for(const c of a.choices){if(typeof c?.choiceId!=='string'||!c.choiceId||new TextEncoder().encode(c.choiceId).length>1024||seen.has(c.choiceId)||!displayText(c.label,256*1024,true)||!displayText(c.decision,256)||!displayText(c.scope,256)||c.rulePreview!==undefined&&!displayText(c.rulePreview,256*1024,true)||c.native_display!==undefined&&!displayText(c.native_display,512*1024,true)||c.acceptsFeedback!==undefined&&typeof c.acceptsFeedback!=='boolean')return null;seen.add(c.choiceId);}
  try{const {decision_pending,...shown}=a,encoded=JSON.stringify(shown);return new TextEncoder().encode(encoded).length<=512*1024?encoded:null;}catch{return null;}
 }

 const {approvalId,requirementId,command,choices,subject}=approval,sourceIndex=requirementId?.sourceIndex;
 if(!isBoundedString(approvalId,1,MAX_ID)||requirementId?.approvalId!==approvalId||!Number.isSafeInteger(sourceIndex)||sourceIndex<0)return null;
 if(approval.protectedWrite!==undefined&&typeof approval.protectedWrite!=='boolean')return null;
 let shown;
 if(subject?.kind==='fileAccess'){
  if(sourceIndex!==0||!displayText(subject.path,4096)||!['read','write'].includes(subject.access)||!displayText(subject.toolName,160))return null;
  let origin=null;if(subject.origin!==undefined){const o=subject.origin;if(o?.kind==='shellCommand'&&displayText(o.command,12000,true))origin={kind:o.kind,command:o.command};else if(o?.kind==='url'&&displayText(o.url,4096))origin={kind:o.kind,url:o.url};else return null;}
  shown={kind:'fileAccess',path:subject.path,access:subject.access,toolName:subject.toolName,origin};
 }else if(subject===undefined||subject?.kind==='shell'){
  if(!displayText(command,MAX_COMMAND,true))return null;
  const workspaceRoot=subject?.workspaceRoot??null;if(workspaceRoot!==null&&!displayText(workspaceRoot,4096))return null;
  const stage=subject?.stage??null;if(stage!==null&&(!Number.isSafeInteger(stage.position)||stage.position!==sourceIndex+1||!Number.isSafeInteger(stage.totalStages)||stage.totalStages<stage.position||stage.totalStages>32||typeof stage.argvComplete!=='boolean'||!Array.isArray(stage.argv)||stage.argv.length>64||!stage.argv.every(x=>displayText(x,4096,false,true))))return null;
  shown={kind:'shell',workspaceRoot,stage:stage?{position:stage.position,totalStages:stage.totalStages,argvComplete:stage.argvComplete,argv:[...stage.argv]}:null};
 }else return null;
 if(!Array.isArray(choices)||!choices.length||choices.length>16)return null;const seen=new Set(),normalized=[];
 for(const c of choices){if(!isBoundedString(c?.choiceId,1,MAX_ID)||seen.has(c.choiceId)||!displayText(c.label,MAX_LABEL)||c.scope!=='once'||!['approved','denied'].includes(c.decision)||c.rulePreview!==undefined&&!displayText(c.rulePreview,2048,true))return null;seen.add(c.choiceId);normalized.push({choiceId:c.choiceId,label:c.label,decision:c.decision,scope:c.scope,...(c.rulePreview!==undefined?{rulePreview:c.rulePreview}:{})});}
 return JSON.stringify({approvalId,requirementId:{approvalId,sourceIndex},command,subject:shown,protectedWrite:approval.protectedWrite===true,choices:normalized,review_token:approval.review_token});
}

export const APPROVAL_REASON_COPY=Object.freeze({invalid_identity:'Muse did not provide a consistent approval identity.',unsupported_subject:'This native approval shape is not yet supported.',missing_subject_details:'Muse did not provide all details needed for this decision.',subject_too_large:'The request exceeds the complete-review size limit.',unsafe_display_characters:'The request contains characters that cannot be shown unambiguously.',choices_unavailable:'Muse did not provide complete decision choices.',choices_ambiguous:'Muse supplied ambiguous decision choices.',review_queued:'This approval is queued while earlier requests are reviewed.',unknown:'This request could not be verified for review.'});
export function approvalRecoveryReady({state,arm,generation,turnId,connected,pending=false}){
 return state?.session_generation===generation&&isArm(arm)&&typeof turnId==='string'&&state.arms?.[arm]?.active_turn_id===turnId&&state.arms[arm].status==='approval'&&Array.isArray(state.arms[arm].approvals)&&state.arms[arm].approvals.some(a=>a.reason!=='review_queued'&&approvalFingerprint(a)===null)&&canInterruptSelected({state,target:arm,connected,pending});
}

// canDecideCurrent({state,arm,approval,choiceId,connected,pending}):
// true only when pair is ready, arm awaits approval, link is up and idle,
// and the exact supplied approval fingerprint still exists in
// state.arms[arm].approvals with the requested choiceId.
// Only the named arm is consulted: traffic on the other arm never disables this.
export function canDecideCurrent({ state, arm, approval, choiceId, connected, pending } = {}) {
  if (connected !== true) return false;
  if (pending !== false) return false;
  if (!isArm(arm)) return false;
  if (typeof choiceId !== "string" || choiceId.length === 0) return false;
  if (!state || state.status !== "ready") return false;

  const armState = state.arms?.[arm];
  if (!armState || typeof armState !== "object") return false;
  if (armState.status !== "approval"||armState.interrupt_pending===true||armState.approval_decision_pending===true||approval?.decision_pending===true) return false;
  if (!Array.isArray(armState.approvals) || armState.approvals.length === 0) return false;

  const wanted = approvalFingerprint(approval);
  if (wanted === null) return false;

  for (const stored of armState.approvals) {
    if (stored.decision_pending!==true&&approvalFingerprint(stored) === wanted) {
      if (!Array.isArray(stored.choices)) return false;
      return stored.choices.some(
        (c) => c && typeof c === "object" && c.choiceId === choiceId,
      );
    }
  }
  return false;
}

// Uncertainty may reset only after a confirmed new pair, never on reconnect.
export function isNewSessionGeneration(previous,next) {
  return Number.isSafeInteger(next)&&next>0&&Number.isSafeInteger(previous)&&next>previous;
}
// A fresh pair starts matched; later snapshots retain the user's recipient.
export function recipientTargetForGeneration(current,previous,next){
 return isNewSessionGeneration(previous,next)?'both':current;
}
export function approvalRequirementKey(approval) {
  const id=approval?.approvalId,requirement=approval?.requirementId;
  if(typeof id!=='string'||!id||requirement?.approvalId!==id||!Number.isSafeInteger(requirement?.sourceIndex)||requirement.sourceIndex<0)return null;
  return JSON.stringify([id,requirement.sourceIndex,approval.review_token??null]);
}


// Bind each action to the precise native turn shown at the click boundary.
export function expectedTurnBindings(state,target){
 if(state?.status!=='ready')return null;const names=selectedArms(target);if(!names.length)return null;const out={};
 for(const name of names){const a=state.arms?.[name];if(a?.status==='ready'&&(a.approvals?.length??0)===0)out[name]=null;else if(['running','approval','question'].includes(a?.status)&&isBoundedString(a.active_turn_id,1,160)&&a.interrupt_pending!==true)out[name]=a.active_turn_id;else return null;}return out;
}
export function canInterruptSelected({state,target,connected,pending}){
 if(connected!==true||pending!==false)return false;const bindings=expectedTurnBindings(state,target);return !!bindings&&Object.values(bindings).some(id=>id!==null);
}

// The RPC acknowledges an interrupt request; only the native terminal ends work.
export function interruptionSettlement(state,attempt){
 if(!attempt||state?.session_generation!==attempt.generation)return 'superseded';
 const names=Object.keys(attempt.expectedTurns??{}).filter(n=>attempt.expectedTurns[n]!==null);
 if(!names.length)return 'unconfirmed';
 if(names.some(n=>!state.arms?.[n]||['failed','closed'].includes(state.arms[n].status)))return 'unconfirmed';
 return names.every(n=>state.arms[n].active_turn_id!==attempt.expectedTurns[n]&&['completed','cancelled'].includes(state.arms[n].last_turn_terminal))?'ended':'pending';
}

// Defaults observed in the pinned native Muse TUI. Browser-owned overlays/copy
// keep priority; neither key approves a command or answers a question.
export function nativeMuseKeyAction(event,{draft='',selectionText='',composer=false}={}){
 if(!event||event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229||event.altKey||event.metaKey||event.shiftKey)return null;
 if(event.key==='Escape'&&!event.ctrlKey)return 'interrupt';
 if(event.ctrlKey&&String(event.key).toLowerCase()==='c'){
  if(selectionText)return null;
  return composer&&draft.length?'clear_draft':'interrupt';
 }
 return null;
}
export function interruptedDraft({current,revision,submittedRevision,generation,submittedGeneration,original,terminal,target,submittedTarget,targetRevision,submittedTargetRevision}){
 return terminal==='cancelled'&&generation===submittedGeneration&&revision===submittedRevision&&target===submittedTarget&&targetRevision===submittedTargetRevision&&!current&&typeof original==='string'?original:current;
}

// A definite refusal releases that arm; an unknown write remains guarded until
// the exact native terminal establishes what happened.
export function interruptionTargetsAfterReceipt(expectedTurns,outcome){
 if(outcome?.status==='not_started')return null;
 const active=Object.fromEntries(Object.entries(expectedTurns??{}).filter(([arm,id])=>id!==null&&outcome?.arms?.[arm]?.status!=='not_started'));
 return Object.keys(active).length?active:null;
}
