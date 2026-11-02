import {mountCodeChecks} from './session-code-checks.mjs';
import {currentQuestion,canActOnQuestion,questionReplyReady,questionFingerprint,questionComposerRoute} from './session-questions.mjs';
import {mountCodingTask} from './coding-task-control.mjs';
import {mountComparisonModel} from './comparison-model-control.mjs';
import {mountSessionMeasurement} from './session-measurement.mjs';
import {mountSessionEvidence,mountWindowEvents,createCaptureEventSync,mountPresenceObserver} from './session-evidence.mjs';
import {mountEvidencePackage} from './evidence-package.mjs';
import {museDeliveryView,museBaselineView} from './muse-delivery-view.mjs';
import {presenceView,receiptAgeLabel,captureHint,textboxPresenceCopy,textboxCaptureLabel,textboxRateLimit,mountReadingHistory,mountReadingPulse,createTextboxReadingClock,currentTextboxDisplay} from './terminal-presence-view.mjs';
import {terminalUsageView} from './terminal-usage-view.mjs';
import {renderTaskCard} from './terminal-task-card.mjs';
import {selectedArms,nextRecipientTarget,recipientTargetForGeneration,canSubmitTarget,approvalFingerprint,canDecideCurrent,isNewSessionGeneration,approvalRequirementKey,sessionSubmitKey,draftAfterSend,expectedTurnBindings,canInterruptSelected,interruptionSettlement,nativeMuseKeyAction,interruptedDraft,interruptionTargetsAfterReceipt} from './session-controls.mjs';
import {mountSessionPane} from './session-panes.mjs';
export function newerSessionSnapshot(previous,next){return !!next&&typeof next==='object'&&Number.isSafeInteger(next.version)&&next.version>previous&&typeof next.status==='string'&&next.arms&&typeof next.arms==='object';}
export function cleanupUnconfirmed(state){return state?.error==='cleanup_unconfirmed';}
export function sessionStopReady({state,token,pending,confirmed}){return typeof token==='string'&&!!token&&!pending&&!confirmed&&!!state&&!['idle','closed','stopping'].includes(state.status);}
export function textboxCaptureOptions(textboxPresence){
 const latestSupported=textboxPresence?.enabled===true&&textboxPresence?.latest_buffer_supported===true;
 return {enableLatestBuffer:latestSupported,enableCumulativeCapture:latestSupported};
}
// macOS routes Control-click through contextmenu rather than click. Keep both
// gestures on the same recipient path without consuming ordinary right-clicks.
const INTERACTIVE_RECIPIENT_EXCLUSION='button,a,input,textarea,select,summary,label,[role="button"],[role="link"],[contenteditable],.session-approval,.session-question';
function recipientControlOrigin(event){
 return [event.target,...(event.composedPath?.()??[])].some(node=>node?.closest?.(INTERACTIVE_RECIPIENT_EXCLUSION));
}
export function bindRecipientActivation(element,activate,{allow=()=>true,protectControls=false}={}){
 let protectedGesture=false,pointerGesture=false;
 const begin=event=>{if(event.type==='pointerdown'){pointerGesture=true;protectedGesture=recipientControlOrigin(event);}else if(!pointerGesture)protectedGesture=recipientControlOrigin(event);},cancel=()=>{protectedGesture=false;pointerGesture=false;};
 const handle=event=>{
  if(event.type==='click')pointerGesture=false;
  if(protectControls&&protectedGesture&&!(event.type==='click'&&event.detail===0))return;
  if(event.defaultPrevented||element.disabled||!allow(event))return;
  if(event.type==='contextmenu'){if(!event.ctrlKey)return;event.preventDefault();}
  else if(event.button!==0)return;
  activate(event);
 };
 element.addEventListener('click',handle);element.addEventListener('contextmenu',handle);
 if(protectControls){element.addEventListener('pointerdown',begin,true);element.addEventListener('mousedown',begin,true);element.addEventListener('pointercancel',cancel,true);}
 return()=>{element.removeEventListener('click',handle);element.removeEventListener('contextmenu',handle);if(protectControls){element.removeEventListener('pointerdown',begin,true);element.removeEventListener('mousedown',begin,true);element.removeEventListener('pointercancel',cancel,true);}};
}
export function paneRecipientAllowed(event,{selectionText=''}={}){
 if(recipientControlOrigin(event))return false;
 // Copying a transcript must not switch recipients, but stale selected text
 // elsewhere must not disable the pane's heading or other selection surfaces.
 return !!(event.metaKey||event.ctrlKey||!event.target.closest?.('.session-feed')||!selectionText);
}
export function presenceConnectionSentence(value,{connected=true,now=Date.now(),textbox=null,liveEnabled=true,localCapture=null,observation=null}={}){
 if(textbox)return textboxPresenceCopy(textbox,{connected,liveEnabled,localCapture,observation,current:['Eligible guidance','Last eligible guidance','Ordinary fallback'].includes(presenceView(value,null,now).reading)}).connection;
 if(!connected)return 'The workspace connection is lost; Presence readings cannot be confirmed.';
 const source=value?.source,view=presenceView(value,null,now);
 if(!['Eligible guidance','Last eligible guidance','Ordinary fallback'].includes(view.reading))return 'No current Presence reading is available.';
 const capture=source?.capture;
 const activity=capture?.state==='collecting'?'Presence is capturing input':capture?.state==='waiting_for_input'?'Presence is waiting for input':capture?.state==='off'?'Capture is off':capture?.state==='paused'?(capture.reason==='secure_input'?'Capture is paused for secure input':capture.reason==='unsupported_field'?'Capture is paused in this field':'Capture is paused'):'Capture status is unconfirmed';
 if(view.reading==='Ordinary fallback')return activity+'; no eligible guidance is available.';
 const age=/^Receipt (.+) ago$/.exec(receiptAgeLabel(source,now));
 return activity+(age?'; the last eligible guidance is '+age[1]+' old.':'; the guidance receipt time is unconfirmed.');
}
// Keep routine source diagnostics out of the working header. The full copy is
// still available in Presence details; availability never implies Muse delivery.
function refreshAvailability(textbox,{connected,liveEnabled,localCapture}){
 const visible=!!textbox&&connected&&liveEnabled&&textbox.consented===true&&!textbox.consent_revoked&&textbox.status!=='access_rejected'&&!['paused','closed','starting'].includes(localCapture);
 const valid=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0,remaining=valid(textbox?.refresh_after_ms)?textbox.refresh_after_ms:null;
 const attempt=Array.isArray(textbox?.attempt_history)?textbox.attempt_history.findLast(row=>row?.kind==='http'&&valid(row.cooldown_ms)&&row.cooldown_ms>0):null;
 const total=attempt?.cooldown_ms,refreshing=textbox?.refreshing===true,limit=textboxRateLimit(textbox);
 const phase=!visible?'idle':refreshing?'refreshing':limit?.active===true?'backoff':remaining===0?'ready':remaining>0?'cooldown':'unknown';
 const fraction=!visible||refreshing||remaining===null?null:remaining===0?1:valid(total)&&total>=remaining?Math.max(0,Math.min(1,1-remaining/total)):null;
 const description=phase==='refreshing'?'Refreshing OP guidance':remaining===0?'OP refresh available when fresh typing is ready':remaining>0?'Next OP submission available in '+Math.ceil(remaining/1000)+'s; Send does not wait':'OP refresh timing unavailable';
 return{visible,fraction,phase,description};
}
export function presenceHeaderView(value,options={}){
 const {connected=true,now=Date.now(),textbox=null,liveEnabled=true,localCapture=null,observation=null}=options;
 const view=presenceView(value,null,now),current=!!view.controls;
 const detail=presenceConnectionSentence(value,options);
 const help=textbox?textboxPresenceCopy(textbox,{...options,current:['Eligible guidance','Last eligible guidance','Ordinary fallback'].includes(view.reading)}).help:captureHint(value?.source);
 const reportedAge=textbox?.age_ms,lastReceipt=Array.isArray(textbox?.readings)?Date.parse(textbox.readings.at(-1)?.received_at):NaN;
 const age=typeof reportedAge==='number'&&Number.isFinite(reportedAge)&&reportedAge>=0?reportedAge:Number.isFinite(lastReceipt)&&now>=lastReceipt?now-lastReceipt:null;
 const currentReading=current&&textbox?.selected===true&&textbox?.reading_freshness!=='last_known';
 const recency=age===null?'':currentReading?(age<15000?'Updated just now':age<60000?'Updated recently':`Updated ${Math.floor(age/60000)}m ago`):(age<60000?'Last reading <1m ago':`Last reading ${Math.floor(age/60000)}m ago`);
 const refresh=refreshAvailability(textbox,{connected,liveEnabled,localCapture});
 const result=(label,tone='quiet')=>({label,tone,detail,help,recency,refresh});
 if(!connected)return result('Disconnected','warning');
 if(textbox){
  if(!liveEnabled)return result('Live readings off');
  if(textbox.status==='access_rejected')return result('Access rejected','warning');
  if(textbox.consent_revoked)return result('Capture stopped');
  if(textbox.consented!==true)return result('Not started');
  if(['paused','closed'].includes(localCapture))return result('Capture paused','warning');
  if(localCapture==='starting')return result('Reconnecting');
  if(textbox.status==='unavailable')return result(current?'Refresh failed · using last reading':'Refresh failed · ordinary fallback','warning');
  const limit=textboxRateLimit(textbox);
  if(limit?.active===true)return result('Rate limited','warning');
  if(limit?.active===null)return result('Last refresh rate limited','warning');
  if(!current||textbox.selected!==true)return result(textbox.refreshing===true?'Refreshing · ordinary fallback':'Ordinary fallback');
  const pending=textbox.refreshing===true||['in_flight','pending'].includes(observation?.last_submission);
  return result(pending?'Refreshing':textbox.guidance_lifetime==='active_session'&&textbox.reading_freshness==='last_known'?'Using last reading':'Reading available','current');
 }
 if(!current)return result('Ordinary fallback');
 const capture=value?.source?.capture?.state;
 return result(capture==='paused'?'Capture paused · last reading':capture==='off'?'Capture off · last reading':'Reading available',capture==='paused'||capture==='off'?'warning':'current');
}
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id),arms=['without','with'],panes={},decisions=new Map(),questionDecisions=new Map(),uncertainArms=new Set(),uncertainInputs=new Map();
 const engagedQuestions=new Set(),interrupts=new Set();let clearedDraft=null;
 let replySelection=null,token=null,state=null,version=0,generation=0,draftRevision=0,recipientRevision=0,connected=false,sending=false,starting=false,stopping=false,stopConfirmed=false,startEnabled=false,codeChecksPanel=null,measurementPanel=null,evidencePanel=null,packagePanel=null,observerPanel=null,textboxPanel=null,windowAudit=null,captureSync=null,readingHistory=null,textboxLiveEnabled=false,pulse=null,previousReceipt=null,streamAbort=null,retryTimer=null,retryCount=0,closed=false;
 const warn=text=>{$('fault').textContent=text;$('fault').hidden=!text;};
 $('stop').textContent='Close sessions';$('stop').title='Close both native sessions';
 const displayClock=createTextboxReadingClock();
 const modelControl=$('comparison-model')?mountComparisonModel($('comparison-model')):null;
 const taskControl=$('coding-task')?mountCodingTask($('coding-task')):null;let displayedTask=null;
 $('target').value='both';
 const target=()=>$('target').value;
 const composerRoute=()=>questionComposerRoute({state,target:target(),intent:replySelection});
 const replyPrompt=()=>composerRoute().prompt??null;
 const interruptBusy=selected=>[...interrupts].some(x=>x.generation===generation&&selectedArms(selected).some(a=>x.expectedTurns[a]!==undefined&&x.expectedTurns[a]!==null));
 const targetUncertain=()=>selectedArms(target()).some(arm=>uncertainArms.has(arm));
 async function post(action,body={},options={}){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),action==='start'?120000:30000);
  try{const signal=options.signal?AbortSignal.any([abort.signal,options.signal]):abort.signal;const r=await fetch('/api/'+action,{method:'POST',headers:{'content-type':'application/json','x-terminal-token':token},mode:'same-origin',credentials:'same-origin',body:JSON.stringify(body),signal,keepalive:options.keepalive===true});const data=await r.json();if(!r.ok){const error=Error(data.error??'operation_failed');error.delivery=data.delivery;if(data.error==='evidence_publication_unconfirmed')error.possibly_saved=data.possibly_saved;throw error;}return data;}finally{clearTimeout(timer);}
 }
 function apply(next){if(!newerSessionSnapshot(version,next))return;version=next.version;state=next;
  const nextTarget=recipientTargetForGeneration(target(),generation,state.session_generation);if(nextTarget!==target()){recipientRevision++;$('target').value=nextTarget;}
  if(isNewSessionGeneration(generation,state.session_generation)){generation=state.session_generation;interrupts.clear();clearedDraft=null;uncertainArms.clear();uncertainInputs.clear();decisions.clear();questionDecisions.clear();engagedQuestions.clear();if(!$('shared').value)replySelection=null;stopConfirmed=false;warn('');$('send-status').textContent='';}
  for(const [key,fingerprint] of decisions){const arm=key.slice(0,key.indexOf(':')),id=key.slice(key.indexOf(':')+1);const current=state.arms?.[arm]?.approvals?.find(a=>a.approvalId===id);if(!current||approvalRequirementKey(current)!==fingerprint)decisions.delete(key);}
  for(const [key,fingerprint] of questionDecisions){const arm=key.slice(0,key.indexOf(':')),current=currentQuestion(state,arm,key.slice(key.indexOf(':')+1));if(!current||questionFingerprint(current)!==fingerprint)questionDecisions.delete(key);}
  if(state.status==='closed'&&state.error!=='cleanup_unconfirmed')stopConfirmed=true;render();
 }
 function renderPresence(){
  const shown=currentTextboxDisplay(state,displayClock),value=connected?shown?.presence:null,source=value?.source??null,view=presenceView(value,previousReceipt);previousReceipt=view.change;
  const header=presenceHeaderView(value,{connected,textbox:shown?.textbox,liveEnabled:textboxLiveEnabled,localCapture:textboxPanel?.status?.(),observation:textboxPanel?.observation?.()});
  if($('presence-inline-status').textContent!==header.label)$('presence-inline-status').textContent=header.label;$('presence-inline-status').title=header.detail;$('presence-inline-status').dataset.tone=header.tone;
  const refresh=$('presence-refresh'),fill=$('presence-refresh-fill'),recency=$('presence-recency');
  refresh.hidden=!header.refresh.visible;refresh.dataset.phase=header.refresh.phase;refresh.title=header.refresh.description;refresh.setAttribute('aria-valuetext',header.refresh.description);
  if(header.refresh.fraction===null)refresh.removeAttribute('aria-valuenow');else refresh.setAttribute('aria-valuenow',String(Math.round(header.refresh.fraction*100)));
  fill.style.transform='scaleX('+(header.refresh.fraction??0)+')';if(recency.textContent!==header.recency)recency.textContent=header.recency;recency.hidden=!header.recency;recency.title=header.detail;
  $('presence-connection-detail').textContent=header.detail;$('presence-inline-policy').textContent='Policy: '+view.policy;$('presence-help').textContent=header.help;
  $('presence-capture').textContent=state?.textbox?textboxCaptureLabel(textboxPanel?.observation?.(),{connected,localCapture:textboxPanel?.status?.(),liveEnabled:textboxLiveEnabled}):view.capture;$('presence-reading').textContent=view.reading;$('presence-policy').textContent=view.policy;$('presence-change').textContent=view.change.label;$('presence-hook').textContent=view.hookText;$('presence-receipt').textContent=receiptAgeLabel(source);
  const c=view.controls,label=x=>x?x.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase()):'—';$('presence-policy-caption').textContent=c?(view.reading==='Last eligible guidance'?'Last source policy':'Source policy'):'No current source policy';
  for(const [key,field,scale,ordinary] of [['depth','response_extent',['terse','standard','full'],'standard'],['updates','unsolicited_update',['defer','send'],'send'],['conversation','conversation_style',['self_contained','conversational'],'conversational']]){const node=$('presence-policy-'+key);node.textContent=label(c?.[field]);const row=node.closest('.policy-row'),index=scale.indexOf(c?.[field]);if(index<0){delete row.dataset.level;delete row.dataset.adapted;}else{row.dataset.level=String(index+1);row.dataset.adapted=String(c[field]!==ordinary);}}
  pulse?.update(['Eligible guidance','Last eligible guidance'].includes(view.reading)?(state?.textbox?shown.textbox:source):null);
  readingHistory?.render(state,{connected});windowAudit?.render(state);
 }
 function render(){
  for(const attempt of interrupts){
   const settlement=interruptionSettlement(state,attempt);if(settlement==='pending')continue;
   attempt.settled=true;interrupts.delete(attempt);
   if(attempt.generation!==generation)continue;
   if(settlement==='ended'){
    const cancelled=Object.keys(attempt.expectedTurns).filter(a=>attempt.expectedTurns[a]!==null).every(a=>state.arms[a].last_turn_terminal==='cancelled');
    const next=interruptedDraft({current:$('shared').value,revision:draftRevision,submittedRevision:attempt.revision,generation,submittedGeneration:attempt.generation,original:attempt.original,terminal:cancelled?'cancelled':'completed',target:target(),submittedTarget:attempt.target,targetRevision:recipientRevision,submittedTargetRevision:attempt.recipientRevision});
    if(next!==$('shared').value){$('shared').value=next;draftRevision++;}
    $('send-status').textContent=cancelled?'Interrupted. The session remains open.':'Selected work stopped or already finished. Sessions remain open.';
   }else $('send-status').textContent='Interruption could not be confirmed. Check the selected pane.';
  }

  const route=composerRoute();if(route.kind==='reply'&&!replySelection)replySelection={arm:target(),userInputId:route.prompt.userInputId,generation,fingerprint:questionFingerprint(route.prompt)};
  const shown=currentTextboxDisplay(state,displayClock);
  modelControl?.render({connected,starting,stopping,state});
  const task=taskControl?.render({connected,starting,stopping,state});if(task&&task.id!==displayedTask){
   const free=task.id==='free-task';
   renderTaskCard($('task-brief'),{title:free?'Your task · clean workspace':'Coding task: '+task.title,description:task.description,nextSteps:free?['Describe your goal, then discuss a plan before implementation.']:['Ask both agents for a plan, then review before implementation.','Approve commands inside each pane; request a revision when ready.']});displayedTask=task.id;
  }
  const labels={not_started:'Not started',ready:'Ready',starting:'Starting',running:'Working',approval:'Approval needed',question:'Question for you',failed:'Failed',stopping:'Stopping',closed:'Closed'};
  for(const arm of arms){const a=state?.arms?.[arm];$('state-'+arm).textContent=(!connected?'Disconnected · ':'')+(cleanupUnconfirmed(state)?'Cleanup unconfirmed':a?.interrupt_pending?'Interrupting…':labels[a?.status]??'Not started')+(a?.activity?' · '+a.activity.tool+' '+a.activity.status:'');panes[arm]?.render(shown,{connected,pendingDecisions:decisions,pendingQuestions:questionDecisions,pendingRecovery:interruptBusy(arm)});$('focus-'+arm).disabled=!connected||!state?.arms?.[arm]||state.status!=='ready';}
  $('start').disabled=!connected||starting||sending||!['idle','closed'].includes(state?.status)||state?.error==='cleanup_unconfirmed'||!startEnabled;$('stop').disabled=!sessionStopReady({state,token,pending:stopping,confirmed:stopConfirmed});$('reconnect').hidden=connected;$('reconnect').disabled=closed;
  for(const button of document.querySelectorAll('[data-target]')){button.disabled=sending;button.setAttribute('aria-pressed',String(button.dataset.target===target()));}
  const recipients=selectedArms(target());
  for(const arm of arms){const pane=document.querySelector('[data-terminal-arm="'+arm+'"]').closest('.terminal-pane');pane.dataset.recipientSelected=String(recipients.includes(arm));}
  const recipientName=target()==='both'?'both agents':target()==='with'?'With Presence':'Without Presence';
  $('target-label').textContent='To '+recipientName;
  const updating=Object.values(expectedTurnBindings(state,target())??{}).some(x=>x!==null);$('send-shared').setAttribute('aria-label',(updating?'Update ':'Send to ')+recipientName);$('send-shared').title=(updating?'Update ':'Send to ')+recipientName+' (Enter)';
  const reply=questionReplyReady({state,target:target(),text:$('shared').value,connected,pending:sending||stopping||questionDecisions.has(target()+':'+replyPrompt()?.userInputId),uncertain:targetUncertain(),userInputId:replySelection?.userInputId??null});
  $('send-shared').disabled=composerRoute().kind==='stale_reply'||(composerRoute().kind==='reply'?!reply:!canSubmitTarget({state,target:target(),text:$('shared').value,connected,pending:sending||stopping||interruptBusy(target()),uncertain:targetUncertain()}));
  if(replyPrompt()){$('send-shared').setAttribute('aria-label','Reply to '+recipientName);$('send-shared').title='Reply to '+recipientName+' (up to 500 characters)';}
  const usage=terminalUsageView(state);for(const arm of arms)for(const label of ['calls','input','output','cache'])$('usage-'+label+'-'+arm).textContent=usage.values[arm][label];
  $('usage-note').textContent=usage.note;
  $('mode-note').textContent=!connected?'Connection lost. Messages and approvals are paused; reconnect to restore the view.':starting||state?.status==='opening'?'Opening two isolated Muse sessions…':cleanupUnconfirmed(state)?'Cleanup could not be confirmed. Stop the workspace launcher and verify its owned processes before reopening.':state?.status==='idle'?'Open the sessions when ready.':state?.status==='closed'?'Both sessions are closed.':state?.error?'Session stopped: '+state.error.replaceAll('_',' ')+'.':target()==='both'&&arms.some(a=>currentQuestion(state,a))?'Choose the asking agent’s pane to reply, or use its options above.':composerRoute().kind==='stale_reply'?'That question ended. Your draft is kept; select a recipient to send it as a new instruction.':'Send to either agent or both. Send a new instruction while Muse works to update its direction. Handle approvals inside its pane.';
  const delivery=museDeliveryView(state?.arms?.with?.delivery??(state?.status==='idle'?{status:'not_started'}:null));$('muse-delivery').textContent=delivery.compactLabel;$('muse-delivery').title=delivery.label+'. '+delivery.detail;$('muse-baseline-delivery').textContent=museBaselineView(state?.arms?.without?.delivery??(state?.status==='idle'?{status:'not_started'}:null));
  codeChecksPanel?.render(state,{connected});measurementPanel?.render(state,{connected});evidencePanel?.render(state,{connected});packagePanel?.render(state,{connected});observerPanel?.render(shown,{connected});captureSync?.setConnected(connected);textboxPanel?.render(state,{connected});renderPresence();
 }
 async function decide(arm,approval,choiceId,options={}){const key=arm+':'+approval.approvalId;if(!canDecideCurrent({state,arm,approval,choiceId,connected,pending:decisions.has(key)||interruptBusy(arm)}))return;decisions.set(key,approvalRequirementKey(approval));render();try{const out=await post('decide',{arm,approvalId:approval.approvalId,requirementId:approval.requirementId,choiceId,reviewToken:approval.review_token,...(options.feedback!==undefined?{feedback:options.feedback}:{}),actor:'participant',generation});apply(out.state);}catch(error){if(error.delivery==='not_started'){decisions.delete(key);warn('No approval was sent. Review the current request before deciding.');}else warn('That approval decision could not be confirmed. It will not be retried automatically.');}finally{render();}}
 async function engageQuestion(arm,prompt){
  const key=arm+':'+prompt?.userInputId;if(engagedQuestions.has(key)||!canActOnQuestion({state,arm,prompt,connected,pending:questionDecisions.has(key)}))return;
  engagedQuestions.add(key);try{const out=await post('question',{arm,userInputId:prompt.userInputId,action:'engage',actor:'participant',generation});apply(out.state);}catch{/* Engagement never answers a question or retries an uncertain write. */}
 }
 async function question(arm,prompt,decision){
  const key=arm+':'+prompt.userInputId;if(!canActOnQuestion({state,arm,prompt,connected,pending:questionDecisions.has(key)}))return null;
  questionDecisions.set(key,questionFingerprint(prompt));render();
  try{const out=await post('question',{arm,userInputId:prompt.userInputId,...decision,actor:'participant',generation});apply(out.state);if(out.result?.status!=='accepted')throw Error('question_unconfirmed');if(replySelection?.userInputId===prompt.userInputId&&!$('shared').value)replySelection=null;return out;}
  catch(error){if(error.delivery==='not_started')questionDecisions.delete(key);warn('That reply could not be confirmed. It will not be sent again automatically.');return null;}finally{render();}
 }
 async function events(){
  streamAbort?.abort();const abort=new AbortController();streamAbort=abort;
  try{const response=await fetch('/api/events',{headers:{'x-terminal-token':token},credentials:'same-origin',cache:'no-store',signal:abort.signal});if(!response.ok||!response.body)throw Error('events_unavailable');const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   for(;;){const {value,done}=await reader.read();if(done)throw Error('events_closed');if(closed||streamAbort!==abort)return;buffer+=decoder.decode(value,{stream:true});if(buffer.length>2*1024*1024)throw Error('events_limit');let at;while((at=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,at);buffer=buffer.slice(at+2);if(!block.startsWith('data: '))continue;const event=JSON.parse(block.slice(6));if(event?.type==='status'&&newerSessionSnapshot(version,event.state)){connected=true;retryCount=0;apply(event.state);}}}
  }catch{if(closed||streamAbort!==abort)return;connected=false;render();if(retryCount<3&&!retryTimer){retryCount++;retryTimer=setTimeout(()=>{retryTimer=null;void events();},1000*retryCount);}}
 }
 $('start').addEventListener('click',async()=>{if($('start').disabled)return;const modelPayload={...(modelControl?.supported()?{model:modelControl.value()}:{}),...(taskControl?.supported()?{task:taskControl.value()}:{})};stopConfirmed=false;starting=true;warn('');render();try{const out=await post('start',modelPayload);apply(out.state);}catch{warn('Opening could not be confirmed. Check the session status; use Stop before trying again.');}finally{starting=false;render();}});
 $('coding-task')?.addEventListener('change',render);
 $('stop').addEventListener('click',async()=>{if($('stop').disabled)return;stopping=true;textboxPanel?.suspend();render();try{const out=await post('stop');apply(out.state);stopConfirmed=out.state?.status==='closed';}catch{warn('Session cleanup could not be confirmed. Stop was not retried automatically.');}finally{stopping=false;render();}});
 $('reconnect').addEventListener('click',()=>{if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}retryCount=0;void events();});
 function selectTarget(next){if(sending||!selectedArms(next).length)return;if(next!==target()){recipientRevision++;clearedDraft=null;}replySelection=null;$('target').value=next;render();}
 for(const button of document.querySelectorAll('[data-target]'))bindRecipientActivation(button,event=>selectTarget(nextRecipientTarget(target(),button.dataset.target,event)));
 for(const arm of arms){
  bindRecipientActivation($('focus-'+arm),event=>{selectTarget(nextRecipientTarget(target(),arm,event));$('shared').focus();});
  bindRecipientActivation(document.querySelector('[data-terminal-arm="'+arm+'"]').closest('.terminal-pane'),event=>selectTarget(nextRecipientTarget(target(),arm,event)),{
   protectControls:true,allow:event=>paneRecipientAllowed(event,{selectionText:window.getSelection()?.toString()??''})
  });
 }
 $('shared').addEventListener('input',()=>{draftRevision++;if($('shared').value)clearedDraft=null;for(const[arm,entry]of uncertainInputs){if($('shared').value!==entry.text&&(entry.status!=='unknown'||entry.turnId&&state?.arms?.[arm]?.active_turn_id!==entry.turnId)){uncertainInputs.delete(arm);uncertainArms.delete(arm);}};const prompt=replyPrompt();if(prompt)void engageQuestion(target(),prompt);render();});$('shared').addEventListener('focus',()=>{const prompt=replyPrompt();if(prompt)void engageQuestion(target(),prompt);});$('shared').addEventListener('keydown',e=>{if(sessionSubmitKey(e)&&!$('send-shared').disabled){e.preventDefault();$('send-shared').click();}});

 async function interruptSelected(selected){
  if(!canInterruptSelected({state,target:selected,connected,pending:sending||stopping||interruptBusy(selected)}))return;
  const expectedTurns=expectedTurnBindings(state,selected),names=selectedArms(selected),inputs=names.filter(a=>expectedTurns[a]!==null).map(a=>state.arms[a].messages.findLast(m=>m.author==='You'&&!['question_reply','question'].includes(m.phase))?.text),original=inputs.length&&inputs.every(x=>x===inputs[0])?inputs[0]:null;
  const attempt={generation,expectedTurns,revision:draftRevision,original,pending:true,target:selected,recipientRevision};interrupts.add(attempt);$('send-status').textContent='Interrupting…';render();
  try{const out=await post('interrupt',{target:selected,expectedTurns,actor:'participant',generation:attempt.generation});if(generation!==attempt.generation)return;apply(out.state);if(generation!==attempt.generation||attempt.settled)return;const remaining=interruptionTargetsAfterReceipt(expectedTurns,out.outcome);if(!remaining){interrupts.delete(attempt);$('send-status').textContent='No interruption was sent. The current work can continue.';}else{attempt.expectedTurns=remaining;if(out.outcome?.status!=='accepted'){attempt.original=null;$('send-status').textContent='Some interruptions could not be confirmed. Check each selected pane.';}}}
  catch(error){if(generation!==attempt.generation||attempt.settled)return;if(error.delivery==='not_started')interrupts.delete(attempt);$('send-status').textContent=error.delivery==='not_started'?'That turn already changed; no interruption was sent.':'Interruption could not be confirmed. Check the selected pane.';}
  finally{attempt.pending=false;render();}
 }
 function nativeKeyboard(event){
  const element=event.target,composer=element===$('shared'),pane=element.closest?.('.terminal-pane');
  if(!composer&&!pane)return;
  // Escape must close a native browser selector/dialog before any agent action.
  if(element.closest?.('select,[role="dialog"],[role="menu"],[role="listbox"]'))return;
  if(event.key==='ArrowUp'&&!event.defaultPrevented&&event.keyCode!==229&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.repeat&&!event.isComposing&&composer&&!$('shared').value&&clearedDraft?.generation===generation&&clearedDraft.target===target()&&clearedDraft.recipientRevision===recipientRevision){event.preventDefault();$('shared').value=clearedDraft.text;draftRevision++;clearedDraft=null;render();return;}
  const action=nativeMuseKeyAction(event,{draft:$('shared').value,selectionText:window.getSelection()?.toString()||((composer&&$('shared').selectionStart!==$('shared').selectionEnd)?'selected':''),composer});
  if(action==='clear_draft'){event.preventDefault();event.stopPropagation();clearedDraft={generation,text:$('shared').value,target:target(),recipientRevision};$('shared').value='';draftRevision++;$('send-status').textContent='Draft cleared · press ↑ to restore';render();return;}
  if(action!=='interrupt')return;
  const arm=pane?.querySelector('[data-terminal-arm]')?.dataset.terminalArm,selected=arm??target();
  if(!canInterruptSelected({state,target:selected,connected,pending:sending||stopping||interruptBusy(selected)}))return;
  event.preventDefault();event.stopPropagation();void interruptSelected(selected);
 }
 window.addEventListener('keydown',nativeKeyboard);
 $('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('shared').value);$('copy-status').textContent='Copied.';}catch{$('shared').select();$('copy-status').textContent='Copy the selected message.';}});
 $('send-shared').addEventListener('click',async()=>{
  if($('send-shared').disabled||composerRoute().kind==='stale_reply')return;textboxPanel?.finish();
  const text=$('shared').value,selected=target(),names=selectedArms(selected),selectedQuestion=replyPrompt(),sendGeneration=generation,submittedRevision=draftRevision,bindings=expectedTurnBindings(state,selected),active=bindings&&Object.values(bindings).some(id=>id!==null);
  sending=true;$('send-status').textContent='Sending…';render();
  try{
   const out=selectedQuestion?await question(selected,selectedQuestion,{action:'clarify',clarification:{format:'text',content:text}}):await post('submit',{text,target:selected,actor:'participant',generation:sendGeneration,...(active?{expectedTurns:bindings}:{})});
   if(!out)throw Error('dispatch_unconfirmed');apply(out.state);if(generation!==sendGeneration){$('send-status').textContent='An earlier session returned this result. Your current draft is kept.';return;}
   if(!selectedQuestion&&['partial_or_unconfirmed','not_started'].includes(out.outcome?.status)){
    const labels=[];for(const arm of names){const status=out.outcome.arms?.[arm]?.status??'unknown';labels.push((arm==='with'?'With':'Without')+': '+status.replaceAll('_',' '));if(status!=='not_started'){uncertainArms.add(arm);uncertainInputs.set(arm,{status,text,turnId:bindings?.[arm]??null});}}
    $('send-status').textContent=labels.join(' · ')+'. Draft kept; no automatic resend.';return;
   }
   if(selectedQuestion?out.result?.status!=='accepted':!['started','forwarded'].includes(out.outcome?.status))throw Error('dispatch_unconfirmed');
   $('shared').value=draftAfterSend({current:$('shared').value,submitted:text,revision:draftRevision,submittedRevision,acknowledged:true,generation,submittedGeneration:sendGeneration});if(selectedQuestion&&!$('shared').value)replySelection=null;
   $('send-status').textContent=(out.outcome?.status==='forwarded'?'Instruction forwarded to ':'Sent to ')+(selected==='both'?'both agents':selected==='with'?'With Presence':'Without Presence')+'.';
  }catch(error){if(generation!==sendGeneration)return;if(!selectedQuestion&&error.delivery!=='not_started'&&generation===sendGeneration)for(const arm of names){uncertainArms.add(arm);if(bindings?.[arm])uncertainInputs.set(arm,{status:'unknown',text,turnId:bindings[arm]});}$('send-status').textContent=error.delivery==='not_started'?'Not sent: the selected turn changed. Your draft is kept.':'Delivery could not be confirmed. Check the sessions before sending again.';}
  finally{sending=false;render();}
 });

 async function init(){
  const composerHint=document.querySelector('.composer-hint');if(composerHint)composerHint.textContent='Enter sends · Shift+Enter adds a line · Esc interrupts';
  codeChecksPanel=mountCodeChecks($('session-code-checks'),{post,onState:apply,readTarget:target,beforeFeedback:()=>textboxPanel?.finish()});
   measurementPanel=mountSessionMeasurement($('session-measurement'),{post,onState:apply});
  packagePanel=mountEvidencePackage($('evidence-package-export'),{save:body=>post('evidence/package',body)});
  windowAudit=mountWindowEvents($('presence-window-audit'),{readEvents:()=>textboxPanel?.windowEvents?.(),readPersistence:()=>captureSync?.status?.()??'unsupported'});
  evidencePanel=mountSessionEvidence($('session-evidence'),{readWindowEvents:()=>textboxPanel?.windowEvents?.(),fetchExport:async selectedGeneration=>{
   const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),30000);
   try{const response=await fetch('/api/evidence?generation='+encodeURIComponent(selectedGeneration),{headers:{'x-terminal-token':token},mode:'same-origin',credentials:'same-origin',cache:'no-store',signal:abort.signal});if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('evidence_export_unavailable');const text=await response.text();if(text.length>2*1024*1024)throw Error('evidence_export_too_large');return JSON.parse(text);}finally{clearTimeout(timer);}
  }});
  for(const arm of arms)panes[arm]=mountSessionPane({container:document.querySelector('[data-terminal-arm="'+arm+'"]'),arm,onDecide:decide,onQuestion:question,onInterrupt:(name,binding)=>{if(binding.generation===generation&&state?.arms?.[name]?.active_turn_id===binding.turnId)void interruptSelected(name);},onReplyQuestion:(name,prompt)=>{if(canActOnQuestion({state,arm:name,prompt,connected,pending:questionDecisions.has(name+':'+prompt.userInputId)})){selectTarget(name);replySelection={arm:name,userInputId:prompt.userInputId,generation,fingerprint:questionFingerprint(prompt)};render();void engageQuestion(name,prompt);$('shared').focus();}},onChange:render});
  try{const {mountPulse}=await import('/lab/pulse.mjs');pulse=mountPulse($('presence-pulse'));const copy=$('presence-pulse').querySelector('.pulse-copy');if(copy)copy.hidden=true;const art=$('presence-pulse').querySelector('.pulse-art');if(art)art.setAttribute('aria-hidden','true');}catch{}
  const response=await fetch('/api/config',{cache:'no-store'});if(!response.ok)throw Error('config_unavailable');const config=await response.json();if(typeof config.token!=='string')throw Error('config_invalid');token=config.token;packagePanel?.configure(config.evidence_package);modelControl?.configure(config.model_selection);taskControl?.configure(config.task_selection);observerPanel=mountPresenceObserver($('presence-observer'),{readMetrics:()=>panes.with?.metrics?.()??null,readPresentation:()=>({schema_version:1,arms:{without:panes.without?.presentation?.()??null,with:panes.with?.presentation?.()??null}}),post,onState:apply,enabled:config.presence_observer?.enabled===true,recordingEnabled:config.presence_observer?.recording_enabled===true,reportEnabled:config.presence_observer?.comparison_reports===true});startEnabled=config.startEnabled===true;$('fixture-banner').hidden=config.fixture!==true;if(config.fixture&&config.fixtureLabel)$('fixture-banner').textContent=config.fixtureLabel;renderTaskCard($('task-brief'),config.taskBrief);if(config.textbox_presence?.enabled===true){pulse?.close?.();pulse=mountReadingPulse($('presence-pulse'));readingHistory=mountReadingHistory(document);textboxLiveEnabled=config.textbox_presence.live_enabled===true;if(config.textbox_presence.capture_event_logging_supported===true)captureSync=createCaptureEventSync({send:(body,options)=>post('capture-events',body,options),onChange:()=>windowAudit?.render(state)});const {mountTextboxPresence}=await import('/textbox-presence-client.mjs');textboxPanel=mountTextboxPresence($('shared'),{config:config.textbox_presence,post,stopElement:$('stop'),onState:apply,onError:warn,onObservation:()=>{captureSync?.observe(textboxPanel?.windowEvents?.());render();},...textboxCaptureOptions(config.textbox_presence)});}apply(config.state);await events();
 }
 // Expiry changes message visibility as well as the header; no new event is needed.
 const timer=setInterval(render,1000);window.addEventListener('pagehide',()=>{window.removeEventListener('keydown',nativeKeyboard);closed=true;clearInterval(timer);clearTimeout(retryTimer);streamAbort?.abort();textboxPanel?.close();captureSync?.close(textboxPanel?.windowEvents?.());readingHistory?.close();observerPanel?.close();pulse?.close?.();});
 init().catch(()=>{connected=false;render();warn('Could not connect to the local Muse workspace. No message was sent.');});
}
