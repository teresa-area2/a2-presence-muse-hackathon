import {questionFingerprint,canActOnQuestion} from './session-questions.mjs';
import {renderMarkdown} from './transcript-notice.mjs';
import {approvalFingerprint,canDecideCurrent,approvalRecoveryReady,APPROVAL_REASON_COPY} from './session-controls.mjs';
import {createCommentaryProjection,isOptionalCommentary,messageHistoryKey} from './commentary-policy.mjs';
import {createPresentationLedger} from './presentation-decisions.mjs';
import {presenceView,receiptAgeLabel} from './terminal-presence-view.mjs';
// Native details are untrusted. Decode the JSON-quoted argument only when
// displaying the exact original string cannot conceal control characters.
const safePlain=value=>typeof value==='string'&&!/[\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)&&!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(value);
const activityToolStates=new Map([['inProgress','in progress'],['completed','completed'],['failed','failed'],['cancelled','cancelled'],['rejected','rejected'],['timedOut','timed out'],['unknown','unconfirmed']]);
const escapeJson=(value,space=2)=>JSON.stringify(value,null,space).replace(/[\u007f-\u009f\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu,c=>Array.from({length:c.length},(_,i)=>'\\u'+c.charCodeAt(i).toString(16).padStart(4,'0')).join(''));
function readableArgs(value){try{const decoded=JSON.parse(value);return safePlain(decoded)?decoded:value;}catch{return value;}}
function subjectExtensions(approval){
 try{const subject=JSON.parse(approval.subject_display);if(!subject||Array.isArray(subject)||typeof subject!=='object')return null;
  const common={shell:['kind','command','workspaceRoot','stages'],fileAccess:['kind','path','access','toolName','origin'],network:['kind','host','port','protocol','toolName'],unixSocket:['kind','path','toolName'],process:['kind','target','access','toolName'],tool:['kind','toolName']};
  const known=common[subject.kind];if(!known)return null;const extra=Object.fromEntries(Object.entries(subject).filter(([k])=>!known.includes(k)));
  if(subject.kind==='fileAccess'&&subject.origin){const o=subject.origin;if(!['shellCommand','url'].includes(o.kind))extra.origin=o;else{const knownOrigin=o.kind==='url'?['kind','url']:['kind','command'],unknown=Object.fromEntries(Object.entries(o).filter(([k])=>!knownOrigin.includes(k)));if(Object.keys(unknown).length)extra.origin_details=unknown;}}
  if(subject.kind==='shell'&&Array.isArray(subject.stages)){const additions=subject.stages.map((stage,index)=>{if(!stage||typeof stage!=='object'||Array.isArray(stage))return null;const out=Object.fromEntries(Object.entries(stage).filter(([k])=>!['argv','argvComplete','position','requirementId','resolution','totalStages'].includes(k)));if(stage.resolution&&typeof stage.resolution==='object'){const x=Object.fromEntries(Object.entries(stage.resolution).filter(([k])=>!['kind'].includes(k)));if(Object.keys(x).length)out.resolution=x;}return Object.keys(out).length?{stage:index+1,...out}:null;}).filter(Boolean);if(additions.length)extra.stage_details=additions;}
  return Object.keys(extra).length?escapeJson(extra):null;
 }catch{return null;}
}
function choiceExtensions(choice){if(typeof choice.native_display!=='string')return null;try{const raw=JSON.parse(choice.native_display);if(!raw||typeof raw!=='object'||Array.isArray(raw))return choice.native_display;const extra=Object.fromEntries(Object.entries(raw).filter(([k])=>!['choiceId','label','decision','scope','rulePreview','acceptsFeedback'].includes(k)));return Object.keys(extra).length?escapeJson(extra):null;}catch{return choice.native_display;}}
export function mountSessionPane({container,arm,onDecide,onQuestion=()=>{},onReplyQuestion=()=>{},onInterrupt=()=>{},onChange=()=>{}}){
 const doc=container.ownerDocument,feed=doc.createElement('div'),heldHost=doc.createElement('div'),conversation=doc.createElement('div'),approvalHost=doc.createElement('div');heldHost.className='session-held-host';feed.className='session-feed';feed.setAttribute('role','log');feed.setAttribute('aria-label',(arm==='with'?'With Presence':'Without Presence')+' conversation');feed.tabIndex=0;feed.append(conversation,approvalHost);container.replaceChildren(heldHost,feed);let previous='',heldText=null,latest={};const approvalNodes=new Map();
 const workStatus=doc.createElement('p');workStatus.className='session-placeholder session-work-status';workStatus.setAttribute('role','status');workStatus.setAttribute('aria-label','Muse activity');workStatus.title='Replies appear when complete. Output tokens include reasoning and code/tool arguments.';workStatus.hidden=true;feed.insertBefore(workStatus,approvalHost);
 // Only the With pane constructs a policy projection or consults Presence.
 const projection=arm==='with'?createCommentaryProjection({revealExistingOnMount:true}):null;
 const journal=createPresentationLedger({arm}),approvalOrdinals=new Map(),questionOrdinals=new Map();let recordedGeneration=null,baselineKeys=[],baselineEpoch=0,manualPending=false,recordingFailure=null;
 const presentation=()=>recordingFailure?structuredClone(recordingFailure):journal.snapshot();
 function recordRendered(state,all,approvals,questions,presence,connected,now){
  const generation=state?.session_generation;if(!Number.isSafeInteger(generation)||generation<1)return;
  try{
   if(recordedGeneration!==null&&generation<recordedGeneration)throw Error('presentation_generation_rewound');
   if(generation!==recordedGeneration){journal.reset();approvalOrdinals.clear();questionOrdinals.clear();baselineKeys=[];baselineEpoch=0;manualPending=false;recordingFailure=null;recordedGeneration=generation;}
   if(recordingFailure)return;
   if(!projection){const keys=all.map(messageHistoryKey);if(baselineKeys.some((key,i)=>keys[i]!==key))baselineEpoch++;baselineKeys=keys;}
   const decisions=projection?projection.decisions():all.map((row,index)=>({kind:'message',ordinal:index+1,optional:isOptionalCommentary(row),visible:true}));
   const items=decisions.filter(row=>!row.visible||typeof all[row.ordinal-1]?.text==='string');
   for(const [index,approval]of approvals.entries()){const key=JSON.stringify([approval.approvalId??index,approval.requirementId?.sourceIndex??0]);if(!approvalOrdinals.has(key)){if(approvalOrdinals.size>=64)throw Error('presentation_approval_capacity');approvalOrdinals.set(key,approvalOrdinals.size+1);}items.push({kind:'approval',ordinal:approvalOrdinals.get(key),optional:false,visible:true});}
   for(const prompt of questions){if(!questionFingerprint(prompt))continue;const key=prompt.userInputId;if(!questionOrdinals.has(key)){if(questionOrdinals.size>=64)throw Error('presentation_question_capacity');questionOrdinals.set(key,questionOrdinals.size+1);}items.push({kind:'question',ordinal:questionOrdinals.get(key),optional:false,visible:true});}
   let policy;if(arm==='with'){const c=connected&&state.status==='ready'?presenceView(presence,null,now).controls:null;policy=!connected?{mode:'disconnected',controls:null}:c?{mode:'eligible',controls:{...c}}:{mode:'fallback',controls:null};}
   journal.observe({session_generation:generation,history_epoch:projection?projection.metrics().history_resets:baselineEpoch,items,...(arm==='with'?{policy}:{}),at_ms:now,manual:manualPending});manualPending=false;
  }catch{const old=journal.snapshot();if(old)recordingFailure={...old,revision:old.revision+1,coverage:'partial'};}
 }

 return {render(state,{connected,pendingDecisions,pendingQuestions=new Map(),pendingRecovery=false,now=Date.now()}){
  latest={state,connected,pendingQuestions,pendingDecisions,pendingRecovery};
  const session=state?.arms?.[arm]??{},all=Array.isArray(session.messages)?session.messages:[],approvals=Array.isArray(session.approvals)?session.approvals:[],questions=Array.isArray(session.questions)?session.questions:[];
  const working=connected&&state?.status==='ready'&&session.status==='running'&&!session.interrupt_pending;
  const tool=typeof session.activity?.tool==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(session.activity.tool)?session.activity.tool:null;
  const toolState=activityToolStates.get(session.activity?.status);
  const workText=working?'Muse is working…'+(tool&&toolState?' · Last tool: '+tool+' ('+toolState+')':''):'';
  workStatus.hidden=!working;if(workStatus.textContent!==workText)workStatus.textContent=workText;
  const presence=projection?state?.presence:null;
  const part=projection?projection.project(all,{arm,generation:state?.session_generation,presence,connected:connected&&state?.status==='ready',now}):{visible:all,held:[]};
  const messages=part.visible,held=part.held;
  const view=held.length?presenceView(presence,null,now):null,age=held.length?receiptAgeLabel(presence?.source,now):null;
  const noticeText=held.length?held.length+' optional update'+(held.length===1?'':'s')+' held · '+view.reading+' · '+age+'. Decisions, errors, approvals and final answers stay visible.':'';
  const key=JSON.stringify([state?.session_generation,messages,held,approvals,questions,session.status,session.active_turn_id,session.interrupt_pending,session.approval_decision_pending,pendingRecovery,connected,[...pendingDecisions.entries()],[...pendingQuestions.entries()]]);if(key===previous){for(const entry of approvalNodes.values())for(const control of entry.buttons)control.button.disabled=!control.allowed();if(heldText)heldText.textContent=noticeText;recordRendered(state,all,approvals,questions,presence,connected,now);return;}previous=key;
  const atBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<60,oldTop=feed.scrollTop;conversation.replaceChildren();heldHost.replaceChildren();
  heldText=null;
  if(held.length){const notice=doc.createElement('section'),text=doc.createElement('p'),show=doc.createElement('button');heldText=text;notice.className='session-held';notice.setAttribute('role','status');notice.setAttribute('aria-label','Presence is holding optional updates');text.textContent=noticeText;show.type='button';show.textContent='Show now';show.addEventListener('click',()=>{manualPending=true;projection.reveal();previous='';onChange();});notice.append(text,show);heldHost.append(notice);}
  if(!messages.length&&!held.length&&!working){const p=doc.createElement('p');p.className='session-placeholder';p.textContent=connected||!state?({ready:'Ready for your first message.',starting:'Starting Muse…',running:'Muse is working…',approval:'Waiting for your approval.',question:'Muse has a question for you.',closed:'Session closed.',failed:'Session unavailable.'})[session.status]??'Open the sessions to begin.':'Disconnected. Reconnect to see current activity.';conversation.append(p);}
  for(const message of messages){if(typeof message?.text!=='string')continue;const row=doc.createElement('section'),label=doc.createElement('div'),body=doc.createElement('div');row.className='session-entry';label.className='session-entry-label';body.className='session-entry-body';const human=message.author==='You';label.textContent=human?'You'+(message.phase==='question_reply'?' · reply':message.phase==='steered'?' · steering':'')+(message.phase==='attempted'?' · sending':message.phase==='unconfirmed'?' · unconfirmed':['not_started','not_sent'].includes(message.phase)?' · not sent':'')+(message.target&&message.target!=='both'?' · individual message':''):'Muse'+(message.phase==='commentary'?' · update':message.phase==='question'?' · question':'');if(human)body.textContent=message.text;else body.append(renderMarkdown(doc,message.text));row.append(label,body);conversation.append(row);}
  for(const prompt of questions){
   const box=doc.createElement('section'),label=doc.createElement('div');box.className='session-entry session-question';box.setAttribute('aria-label','Muse question for '+(arm==='with'?'With Presence':'Without Presence'));label.className='session-entry-label';label.textContent='Muse · question';box.append(label);
   if(!questionFingerprint(prompt)){const p=doc.createElement('p');p.textContent='This question cannot be displayed safely. Stop the sessions before continuing.';box.append(p);conversation.append(box);continue;}
   const allowed=()=>canActOnQuestion({state:latest.state,arm,prompt,connected:latest.connected,pending:latest.pendingQuestions.has(arm+':'+prompt.userInputId)});
   for(const q of prompt.questions){const body=doc.createElement('p');body.textContent=q.question;box.append(body);if(prompt.questions.length!==1||q.selection.mode!=='single'){const options=doc.createElement('ul');for(const o of q.options){const item=doc.createElement('li');item.textContent=o.label+(o.description?' — '+o.description:'');options.append(item);}box.append(options);}if(prompt.questions.length===1&&q.selection.mode==='single'){const choices=doc.createElement('div');choices.className='session-approval-choices';for(const o of q.options){const b=doc.createElement('button');b.type='button';b.textContent=o.label;b.title=o.description??'';b.disabled=!allowed();b.addEventListener('click',()=>{if(allowed())void onQuestion(arm,prompt,{action:'answer',answers:[{questionId:q.id,selectedLabel:o.label}]});});choices.append(b);}box.append(choices);}}
   const actions=doc.createElement('div');actions.className='session-approval-choices';for(const [text,callback]of [['Reply in message box',()=>onReplyQuestion(arm,prompt)],['Skip question',()=>onQuestion(arm,prompt,{action:'cancel'})]]){const b=doc.createElement('button');b.type='button';b.textContent=text;b.disabled=!allowed();b.addEventListener('click',()=>{if(allowed())void callback();});actions.append(b);}box.append(actions);conversation.append(box);
  }
  const approvalRows=approvals.map((approval,index)=>({approval,fingerprint:approvalFingerprint(approval),index}));
  const keyFor=row=>JSON.stringify([state?.session_generation,row.fingerprint??['invalid',row.index,session.active_turn_id,row.approval?.status??'unknown',row.approval?.reason??'unknown']]);
  const activeKeys=new Set(approvalRows.map(keyFor));
  for(const [key,entry] of approvalNodes)if(!activeKeys.has(key)){entry.box.remove();approvalNodes.delete(key);}
  for(const [index,row] of approvalRows.entries()){
   const {approval,fingerprint}=row,key=keyFor(row);let entry=approvalNodes.get(key);
   if(!entry){
    const box=doc.createElement('section'),title=doc.createElement('strong');box.className='session-approval';box.setAttribute('aria-label','Approval for '+(arm==='with'?'With Presence':'Without Presence'));title.textContent='Approval requested';box.append(title);entry={box,buttons:[]};
    if(approval?.status==='decision_pending'&&approval.decision_pending===true){
     title.textContent='Confirming decision';
    }else if(!fingerprint){
     const explanation=doc.createElement('p');explanation.textContent=(APPROVAL_REASON_COPY[approval?.reason]??APPROVAL_REASON_COPY.unknown)+(approval?.reason==='review_queued'?' It will appear automatically when space is available.':' No decision can be sent from this card.');box.append(explanation);
     const recover=doc.createElement('button'),approvalGeneration=state?.session_generation,turnId=session.active_turn_id;
     const allowed=()=>approvalNodes.get(key)===entry&&entry.box.parentNode===approvalHost&&approvalRecoveryReady({state:latest.state,arm,generation:approvalGeneration,turnId,connected:latest.connected,pending:latest.pendingRecovery});
     recover.type='button';recover.textContent='Interrupt this agent';recover.addEventListener('click',event=>{event.stopPropagation?.();if(allowed())void onInterrupt(arm,{generation:approvalGeneration,turnId});});if(approval?.reason!=='review_queued'){entry.buttons.push({button:recover,allowed});box.append(recover);}
    }
    else{
     const subject=approval.subject,pre=doc.createElement('pre'),choices=doc.createElement('div'),caption=text=>{const p=doc.createElement('p');p.textContent=text;box.append(p);};
     const show=text=>{const p=doc.createElement('pre');p.textContent=text;box.append(p);return p;};
     if(approval.protectedWrite===true)caption('Protected-file write · only a one-time decision is valid.');
     if(approval.subagent_origin)caption('Requested by a child agent · decision applies on this parent session');
     if(approval.judge_escalated===true)caption('Muse escalated this request for your review.');
     if(approval.reviewer_reason_display!==undefined){caption('Muse review context');show(approval.reviewer_reason_display);}
     if(subject?.kind==='fileAccess'){
      title.textContent='File access requested';caption((subject.access==='write'?'Write':'Read')+' access · tool '+subject.toolName);caption(subject.path.startsWith('/')?'Absolute path':'Workspace-relative path (this agent’s workspace)');pre.textContent=subject.path;box.append(pre);if(subject.path!==subject.path.trim()){caption('Exact path (JSON-quoted; spaces are part of the name)');show(JSON.stringify(subject.path));}
      if(subject.origin){caption('Reported trigger (untrusted)');show(subject.origin.kind==='url'?subject.origin.url:subject.origin.command);}
     }else if(subject?.kind==='shell'||subject===undefined){
      pre.textContent=approval.command;box.append(pre);
      if(subject?.workspaceRoot){caption('Working directory');show(subject.workspaceRoot);}
      if(subject?.stage){caption('Decision for stage '+subject.stage.position+' of '+subject.stage.totalStages);show(escapeJson(subject.stage.argv,0));if(!subject.stage.argvComplete)caption('Native argument parse is partial; review the full command above.');}
     }else{
      title.textContent=({network:'Network access requested',unixSocket:'Socket access requested',process:'Process control requested',tool:'Tool approval requested',generic:'Native approval requested'})[subject.kind]??'Native approval requested';
      if(subject.toolName)caption('Tool: '+subject.toolName);
      if(subject.kind==='network')caption('Destination: '+subject.host+(subject.port===undefined?' · all ports when a session rule is granted':':'+subject.port)+(subject.protocol?' · '+subject.protocol:''));
      if(subject.kind==='unixSocket')show(subject.path);
      if(subject.kind==='process'){caption('Access: '+subject.access);show(subject.target);}
     }
     if(subject?.kind==='generic'&&approval.subject_display!==undefined){caption('Native request');show(approval.subject_display);}else{const extra=subjectExtensions(approval);if(extra){caption('Additional native request details');show(extra);}}
     if(approval.cua_card_display!==undefined){caption('Computer-use actions and data (native card)');show(approval.cua_card_display);caption('Sensitive input values are omitted; the native card shows their masks.');}
     if(approval.raw_args_display!==undefined){caption('Arguments');show(readableArgs(approval.raw_args_display));}
     const actionText=c=>{
      if(c.scope==='once'&&c.decision==='approved')return'Allow once';if(c.scope==='once'&&c.decision==='denied')return'Reject';
      if(c.scope==='session'&&['approved','approvedForSession','approvedPolicyAmendment'].includes(c.decision))return'Allow for session';
      if(c.scope==='localPersistent'&&['approved','approvedForSession','approvedPolicyAmendment'].includes(c.decision))return'Allow and remember';
      if(c.decision==='deniedPolicyAmendment')return c.scope==='localPersistent'?'Reject and remember':'Reject with rule';
      if(c.decision==='abort')return'Cancel request';return c.label;
     };
     choices.className='session-approval-choices';
     for(const choice of approval.choices){
      const button=doc.createElement('button'),approvalGeneration=state?.session_generation,allowed=()=>approvalNodes.get(key)===entry&&entry.box.parentNode===approvalHost&&latest.state?.session_generation===approvalGeneration&&canDecideCurrent({state:latest.state,arm,approval,choiceId:choice.choiceId,connected:latest.connected,pending:latest.pendingRecovery||latest.pendingDecisions.has(arm+':'+approval.approvalId)});
      button.type='button';button.textContent=actionText(choice);button.title=choice.scope==='once'&&['approved','denied'].includes(choice.decision)?choice.decision==='approved'?(subject?.stage?'Approve this stage once':'Approve this request once'):(subject?.stage?'Reject this stage':'Reject this request'):'Native decision: '+choice.decision+' · Scope: '+choice.scope;
      button.addEventListener('click',event=>{event.stopPropagation?.();if(allowed()){const feedback=choice.acceptsFeedback===true?entry.feedback?.value:undefined;if(feedback)void onDecide(arm,approval,choice.choiceId,{feedback});else void onDecide(arm,approval,choice.choiceId);}});entry.buttons.push({button,allowed});
      const option=doc.createElement('div');option.className='session-approval-option';if(['approved','approvedForSession','approvedPolicyAmendment'].includes(choice.decision))button.className='session-approval-allow';option.append(button);
      if(approval.projection_version===2&&!(choice.scope==='once'&&['approved','denied'].includes(choice.decision))){const scope=doc.createElement('p');scope.textContent=({session:'Rest of this session',localPersistent:'Saved in local policy'})[choice.scope]??('Native scope: '+choice.scope);const understood=choice.scope==='once'&&['approved','denied','abort','timedOut'].includes(choice.decision)||choice.scope==='session'&&choice.decision==='approvedForSession'||['session','localPersistent'].includes(choice.scope)&&['approvedPolicyAmendment','deniedPolicyAmendment'].includes(choice.decision);if(!understood)scope.textContent+=' · Native decision: '+choice.decision;option.append(scope);}
      const extra=choiceExtensions(choice);if(extra){const exact=doc.createElement('pre');exact.textContent=extra;option.append(exact);}if(choice.rulePreview!==undefined){const preview=doc.createElement('pre');preview.textContent=choice.rulePreview;option.append(preview);}choices.append(option);
     }
     box.append(choices);
     if(approval.choices.some(c=>c.acceptsFeedback===true)){const details=doc.createElement('details'),summary=doc.createElement('summary'),label=doc.createElement('label'),text=doc.createElement('span'),input=doc.createElement('textarea');details.className='session-approval-feedback';summary.textContent='Add feedback (optional)';text.textContent='Feedback is sent only with a choice that accepts it.';input.maxLength=4000;input.rows=2;input.setAttribute('aria-label','Optional approval feedback');label.append(text,input);details.append(summary,label);box.append(details);entry.feedback=input;}
     if(approval.subject_display!==undefined||approval.subagent_origin||approval.choices.some(c=>c.label!==actionText(c)||c.native_display!==undefined)||approval.raw_args_display!==undefined){const details=doc.createElement('details'),summary=doc.createElement('summary');details.className='session-approval-details';summary.textContent='Request details';details.append(summary);const exact=text=>{const pre=doc.createElement('pre');pre.textContent=text;details.append(pre);};if(approval.subject_display!==undefined)exact(approval.subject_display);if(approval.raw_args_display!==undefined)exact(approval.raw_args_display);if(approval.subagent_origin)exact(JSON.stringify(approval.subagent_origin,null,2));for(const c of approval.choices){if(c.label!==actionText(c))exact('Muse option: '+c.label);if(c.native_display!==undefined)exact(c.native_display);}box.append(details);}
    }
    entry.progress=doc.createElement('p');entry.progress.setAttribute('role','status');entry.box.append(entry.progress);
    approvalNodes.set(key,entry);
   }
   const decisionPending=session.approval_decision_pending===true||approval.decision_pending===true||pendingDecisions.has(arm+':'+approval.approvalId);
   if(entry.feedback)entry.feedback.disabled=decisionPending||session.interrupt_pending===true||pendingRecovery||!connected;
   entry.progress.textContent=session.interrupt_pending===true||pendingRecovery?'Interrupt pending. Waiting for Muse to end this turn.':approval?.status==='decision_pending'&&approval.decision_pending===true?'Decision pending · waiting for Muse.':decisionPending?'Decision pending or unconfirmed. An earlier approval may already have been accepted.':'';
   entry.progress.hidden=!entry.progress.textContent;
   if(approvalHost.children[index]!==entry.box)approvalHost.insertBefore(entry.box,approvalHost.children[index]??null);
   for(const control of entry.buttons)control.button.disabled=!control.allowed();
  }
  feed.scrollTop=atBottom?feed.scrollHeight:oldTop;
  recordRendered(state,all,approvals,questions,presence,connected,now);
 },focus(){feed.focus();},metrics(){return projection?.metrics?.()??null;},presentation};
}
