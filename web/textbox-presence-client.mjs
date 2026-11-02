// Browser-only consent/lifecycle wrapper around the official Cipher binding.
// No composer text, clipboard content, raw keys or capture payloads enter UI state.
const context={season:['Winter','Spring','Summer','Fall'],time:['Morning','Afternoon','Evening','Night'],weekday:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']};
const types=new Set(['an','pt','md','sp','bk','em','en','ukn']);
const integer=x=>Number.isSafeInteger(x)&&x>0;
const liveSession=s=>integer(s?.session_generation)&&s?.status==='ready';
const readingId=x=>typeof x==='string'&&/^[-A-Za-z0-9_]{1,96}$/.test(x)?x:null;
export function minimizeTextboxBatch(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('textbox_batch_invalid');
 const n=value.keyTypes?.length;
 if(!Number.isSafeInteger(n)||n<1||n>2000||!Array.isArray(value.keyTypes)||!value.keyTypes.every(x=>types.has(x))||value.length!==n)throw Error('textbox_batch_invalid');
 if(![value.keyAreas,value.pressTimes,value.releaseTimes].every(a=>Array.isArray(a)&&a.length===n&&a.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)))throw Error('textbox_batch_invalid');
 if(typeof value.sessionID!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(value.sessionID)||typeof value.startUnixTime!=='number'||!Number.isFinite(value.startUnixTime)||value.startUnixTime<=0||!Number.isFinite(value.timeZone)||Math.abs(value.timeZone)>24)throw Error('textbox_batch_invalid');
 const clean={keyAreas:[...value.keyAreas],keyTypes:[...value.keyTypes],pressTimes:[...value.pressTimes],releaseTimes:[...value.releaseTimes],length:n,sessionID:value.sessionID,startUnixTime:value.startUnixTime,timeZone:value.timeZone};
 for(const [key,allowed]of Object.entries(context)){if(!allowed.includes(value[key]))throw Error('textbox_batch_invalid');clean[key]=value[key];}
 return clean;
}

// In-memory scheduling only. Broker eligibility and service rate limits remain
// authoritative; this timer is a local lower bound, not a grant to send.
export function createTextboxLatestBuffer({dispatch,isEligible=()=>true,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,onChange=()=>{},onEvent=()=>{}}={}){
 if([dispatch,isEligible,now,setTimer,clearTimer,onChange,onEvent].some(fn=>typeof fn!=='function'))throw Error('textbox_buffer_invalid');
 const minimumCooldown=30000,maxAge=120000;
 let pending=null,inFlight=null,nextAt=0,timer=null,closed=false,blocked=false,epoch=0,last='none',latestAt=null,lastSequence=null,reportedSequence=null;
 const clock=()=>{const t=now();if(!Number.isFinite(t)||t<0)throw Error('textbox_buffer_clock_invalid');return t;};
 const emit=()=>{try{onChange(status());}catch{}};
 const event=(sequence,phase,status=null)=>{if(!Number.isSafeInteger(sequence))return;try{onEvent({sequence,phase,status});}catch{}};
 const cancel=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
 function status(){return{pending:pending!==null,in_flight:inFlight!==null,last,closed,blocked,sequence:reportedSequence};}
 function run(){
  cancel();if(closed||blocked||!pending)return;
  const at=clock();
  if(at-pending.completedAt>=maxAge){reportedSequence=pending.sequence;event(pending.sequence,'outcome','expired');pending=null;last='expired';emit();return;}
  if(!inFlight&&at>=nextAt){
   let eligible=false;try{eligible=isEligible()===true;}catch{}
   if(eligible){
    const item=pending;pending=null;
    const controller=new AbortController(),flight={controller,epoch,started:at,sequence:item.sequence,item};inFlight=flight;reportedSequence=item.sequence;last='attempting';emit();
    // Remove before invocation; attempted observations are never put back.
    Promise.resolve().then(()=>{
     if(closed||blocked||flight.epoch!==epoch||controller.signal.aborted)return null;
     try{if(isEligible()!==true)return{status:'deferred_unattempted',item};}catch{return{status:'deferred_unattempted',item};}
     if(pending){flight.terminal=true;event(item.sequence,'replaced');return{status:'superseded_unattempted'};}
     const current=clock();
     if(current-item.completedAt>=maxAge)return{status:'expired_unattempted'};
     if(current<nextAt)return{status:'deferred_unattempted',item};
     nextAt=Math.max(nextAt,current+minimumCooldown);
     flight.attempted=true;event(item.sequence,'dispatch');
     return dispatch(item.payload,{signal:controller.signal,completedAt:item.completedAt,observationEndedAtMs:item.observationEndedAtMs,captureAgeMs:current-item.completedAt});
    }).then(result=>settle(flight,result),()=>settle(flight,null));
    return;
   }
  }
  const untilExpiry=pending.completedAt+maxAge-at;
  const untilEligible=!inFlight&&at<nextAt?nextAt-at:Infinity;
  timer=setTimer(()=>{timer=null;run();},Math.max(0,Math.min(untilExpiry,untilEligible)));
 }
 function settle(flight,result){
  if(inFlight!==flight)return;
  inFlight=null;const at=clock();
  if(flight.rateLimited){if(!closed){emit();run();}return;}
  // The local broker can reject admission before any OP HTTP attempt. Keep
  // that fresh item only if it has not been superseded or cancelled.
  if(result?.status==='deferred_unattempted'&&flight.epoch===epoch&&!closed&&!flight.cancelReported&&!flight.controller.signal.aborted){
   const delay=Math.max(Number.isFinite(result.cooldown_ms)?result.cooldown_ms:0,Number.isFinite(result.retry_after_ms)?result.retry_after_ms:0);nextAt=Math.max(nextAt,at+delay);
   if(!pending){pending=result.item??flight.item;reportedSequence=pending.sequence;last='queued';event(pending.sequence,'queued');}else event(flight.sequence,'replaced');emit();run();return;
  }
  if(flight.attempted&&flight.epoch===epoch){const outcome=result?.status==='ready'&&['accepted','duplicate'].includes(result?.receipt)?result.receipt:['ready','backoff','access_rejected','unavailable','discarded','observation_expired'].includes(result?.status)?result.status:'unconfirmed';event(flight.sequence,'outcome',outcome);}
  if(result?.status==='expired_unattempted'&&flight.epoch===epoch&&!closed){flight.terminal=true;event(flight.sequence,'outcome','expired');}
  const delay=Math.max(Number.isFinite(result?.cooldown_ms)?result.cooldown_ms:0,Number.isFinite(result?.retry_after_ms)?result.retry_after_ms:0);
  if(typeof delay==='number'&&Number.isFinite(delay)&&delay>=0)nextAt=Math.max(nextAt,at+delay);
  if(result?.status==='backoff'||result?.status==='rate_limited'){
   // Keep only a newer, never-attempted observation while respecting the
   // authoritative deadline; the rejected attempt is never replayed.
   nextAt=Math.max(nextAt,at+minimumCooldown);reportedSequence=pending?.sequence??flight.sequence;last=pending?'queued':'rate_limited';
  }else if(result?.status==='access_rejected'){
   reportedSequence=pending?.sequence??flight.sequence;if(pending)event(pending.sequence,'outcome','access_rejected');pending=null;blocked=true;last='access_rejected';
  }else if(flight.epoch===epoch){reportedSequence=pending?.sequence??flight.sequence;last=pending?'queued':result?.status==='ready'?'sent':result?.status==='expired_unattempted'?'expired':'failed';}
  if(!closed){emit();run();}
 }
 function clear(reason='cleared'){
  if(pending)event(pending.sequence,'outcome','cancelled');if(inFlight&&!inFlight.cancelReported&&!inFlight.terminal){inFlight.cancelReported=true;event(inFlight.sequence,'outcome',inFlight.attempted?'cancel_requested':'cancelled');}epoch++;pending=null;latestAt=null;lastSequence=null;reportedSequence=null;cancel();inFlight?.controller.abort();last=reason;emit();
 }
 return{
  offer(value,{completedAt,observationEndedAtMs=null,token,sequence}={}){
   if(closed)throw Error('textbox_buffer_closed');
   if(blocked||token!==epoch)return false;
   if(!Number.isSafeInteger(sequence)||sequence<1||lastSequence!==null&&sequence<=lastSequence)return false;
   if(observationEndedAtMs!==null&&(!Number.isSafeInteger(observationEndedAtMs)||observationEndedAtMs<0))throw Error('textbox_buffer_time_invalid');
   const at=clock();if(!Number.isFinite(completedAt)||completedAt<0||completedAt>at)throw Error('textbox_buffer_time_invalid');
   if(latestAt!==null&&completedAt<latestAt)return false;
   const payload=minimizeTextboxBatch(value);
   if(at-completedAt>=maxAge){reportedSequence=sequence??null;last='expired';event(sequence,'outcome','expired');emit();return false;}
   if(pending)event(pending.sequence,'replaced');latestAt=completedAt;lastSequence=sequence;reportedSequence=sequence;pending={payload,completedAt,observationEndedAtMs,sequence};last='queued';event(sequence,'queued');emit();run();return true;
  },
  // A broker-state change may unblock the local gate; this does not override it.
  notifyEligibilityChanged(){if(!closed)run();},
  deferUntil(at){if(!Number.isFinite(at)||at<0)throw Error('textbox_buffer_time_invalid');nextAt=Math.max(nextAt,at);if(!closed)run();},
  rateLimitUntil(at){if(!Number.isFinite(at)||at<0)throw Error('textbox_buffer_time_invalid');nextAt=Math.max(nextAt,at);if(inFlight&&inFlight.epoch===epoch&&!inFlight.cancelReported&&!inFlight.controller.signal.aborted&&!inFlight.attempted&&!inFlight.rateLimited&&!inFlight.terminal){const reserved=inFlight;reserved.rateLimited=true;reserved.cancelReported=true;reserved.terminal=true;reserved.controller.abort();if(!pending){pending=reserved.item;reportedSequence=reserved.sequence;last='queued';}else event(reserved.sequence,'replaced');}if(pending){reportedSequence=pending.sequence;last='queued';}else if(!inFlight||!inFlight.attempted){last='rate_limited';}emit();if(pending)run();else cancel();},
  clear(){if(!closed)clear();},
  close(){if(closed)return;closed=true;clear('closed');},
  token(){return epoch;},
  status
 };
}

// Connection copy describes source availability, never model delivery or a measured user state.
export {textboxPresenceCopy} from './terminal-presence-view.mjs';

// Stop intent must discard before blur can finalize. This adds no DOM and does
// not latch capture off merely because keyboard focus moved onto Stop.
export function bindTextboxStopGuard(element,stop,discard){
 if(!stop)return{close(){}};
 const pointer=e=>{if(!stop.disabled&&e.button===0)discard();};
 const blur=e=>{if(e.relatedTarget===stop&&!stop.disabled)discard();};
 stop.addEventListener('pointerdown',pointer,true);element.addEventListener('blur',blur,true);
 return{close(){stop.removeEventListener('pointerdown',pointer,true);element.removeEventListener('blur',blur,true);}};
}

// Cancel a pending import/mount promptly, and dispose bindings that arrive late.
function abortable(task,signal,onLate=()=>{}){
 return new Promise((resolve,reject)=>{
  let finished=false;
  const abort=()=>{if(finished)return;finished=true;reject(Error('textbox_mount_cancelled'));};
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(task).then(value=>{signal.removeEventListener('abort',abort);if(finished){try{onLate(value);}catch{}return;}finished=true;resolve(value);},error=>{signal.removeEventListener('abort',abort);if(finished)return;finished=true;reject(error);});
 });
}

// Session capture authorization is supplied by the trusted local launcher. There
// are no extra composer controls. Existing Open/Stop own the session lifecycle.
export function mountTextboxPresence(element,{config,post,onState,stopElement=null,onError=()=>{},onObservation=()=>{},now=()=>performance.now(),wallNow=Date.now,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout,mountTimeoutMs=10000,enableLatestBuffer=false,enableCumulativeCapture=false,loadCollector=()=>import('/cipher-textbox.mjs')}={}){
 if(config?.enabled!==true)return {render(){},finish(){},status(){return 'not_started';},observation(){return{window:'closed',last_window:'none',last_submission:'none'};},windowEvents(){return{ledger_id:null,session_generation:null,events:[],events_omitted:0};},timing(){return{current_window_started_at_ms:null,last_boundary:null};},suspend(){},close(){}};
 if(enableCumulativeCapture&&(!enableLatestBuffer||config.latest_buffer_supported!==true))throw Error('textbox_cumulative_requires_buffer');
 if(element?.tagName!=='TEXTAREA'||typeof post!=='function'||typeof onState!=='function'||typeof loadCollector!=='function'||typeof now!=='function'||typeof wallNow!=='function'||typeof setTimeoutFn!=='function'||typeof clearTimeoutFn!=='function'||!Number.isSafeInteger(mountTimeoutMs)||mountTimeoutMs<1000||mountTimeoutMs>60000)throw Error('textbox_ui_invalid');
 let current=null,connected=false,closed=false,epoch=0,binding=null,armed=false,grantAcknowledged=false,attempted=false,suspended=false,suspensionReason=null,captureAbort=null,mountAbort=null,consentChain=Promise.resolve(),gateState=null,nextCaptureAt=0;
 let windowState='closed',lastWindow='none',lastSubmission='none',windowRevision=0,partialDropped=false,windowStartedAt=null,lastBoundary=null,observationScheduled=false,windowSerial=0,activeWindowId=null,lastEndedWindowId=null,latestBufferSequence=0,latestOfferedBufferSequence=0,cumulativeStatus='ready',missedWindow=false,windowEvents=[],windowEventsOmitted=0;
 let ledgerId=null;try{ledgerId=globalThis.crypto?.randomUUID?.()??null;}catch{}
 const revisionWindows=new Map();
 const notifyObservation=()=>{if(!enableLatestBuffer||observationScheduled)return;observationScheduled=true;queueMicrotask(()=>{observationScheduled=false;if(!closed)try{onObservation();}catch{}});};
 const recordWindowEvent=(windowId,phase,reason=null,status=null,sample=null)=>{if(!Number.isSafeInteger(windowId)||windowId<1)return;let at=null;try{const value=wallNow();if(Number.isSafeInteger(value)&&value>=0)at=value;}catch{}const row=Object.freeze({window_id:windowId,phase,at_ms:at,reason,status,...(enableCumulativeCapture?{sample_id:sample?.id??null,sample_kind:sample?.kind??null}:{})});if(windowEvents.length===200){windowEvents.shift();windowEventsOmitted++;}windowEvents.push(row);notifyObservation();};
 const quarantine=new Set();
 const buffer=createTextboxLatestBuffer({now,setTimer:setTimeoutFn,clearTimer:clearTimeoutFn,
  isEligible:()=>!closed&&connected&&liveSession(current)&&armed&&current?.textbox?.consented===true&&current?.textbox?.in_flight!==true,
  onChange:status=>{const labels={queued:'queued',attempting:'in_flight',sent:'complete',failed:'unavailable',expired:'expired',rate_limited:'discarded_cooldown',access_rejected:'access_rejected'};if((enableCumulativeCapture?status.sequence===latestOfferedBufferSequence:status.sequence===windowRevision)&&labels[status.last])lastSubmission=labels[status.last];notifyObservation();},
  onEvent:event=>{const mapped=revisionWindows.get(event.sequence);if(mapped)recordWindowEvent(enableCumulativeCapture?mapped.windowId:mapped,event.phase,null,event.status,enableCumulativeCapture?mapped:null);},
  dispatch:async(payload,{signal,observationEndedAtMs})=>{const g=current?.session_generation,e=epoch;
   if(!same(g,e)||!armed||current?.textbox?.consented!==true)return{status:'discarded'};
   try{const out=await post('presence/capture',{generation:g,capture:payload,observation_ended_at_ms:observationEndedAtMs},{signal});
    if(!same(g,e)||!armed||out?.state?.session_generation!==g)return{status:'discarded'};
    onState(out.state);const receipt=out.capture_status==='ready'&&['accepted','duplicate'].includes(out.state.textbox?.last_receipt)?out.state.textbox.last_receipt:null;return{status:out.capture_status,receipt,cooldown_ms:out.state.textbox?.refresh_after_ms};
   }catch{if(same(g,e)&&armed)onError('Textbox guidance could not be refreshed. The attempted batch will not be retried.');return{status:'unavailable'};}
  }});
 let bufferToken=buffer.token();
 const stopGuard=bindTextboxStopGuard(element,stopElement,()=>{if(enableLatestBuffer){const prior=buffer.status();buffer.clear();bufferToken=buffer.token();if(prior.pending||prior.in_flight){lastSubmission=prior.in_flight?'unconfirmed':'cancelled';notifyObservation();}}binding?.discardWindow?.('stop');});
 const dispose=()=>{const old=binding;binding=null;try{old?.setEnabled(false);}catch{}try{old?.close();}catch{}};
 function deactivate(reason='discarded'){epoch++;armed=false;grantAcknowledged=false;mountAbort?.abort();mountAbort=null;if(windowState==='open'){let ended=null;try{const n=wallNow();if(typeof n==='number'&&Number.isFinite(n)&&n>=0)ended=n;}catch{}lastBoundary={started_at_ms:windowStartedAt,ended_at_ms:ended,end_reason:reason,eligibility_elapsed_ms:null};recordWindowEvent(activeWindowId,'end',reason,'discarded');activeWindowId=null;windowStartedAt=null;windowState='closed';lastWindow='discarded';windowRevision++;}if(captureAbort){lastSubmission='unconfirmed';captureAbort.abort();}captureAbort=null;buffer.clear();dispose();}
 const same=(g,e)=>!closed&&connected&&liveSession(current)&&current.session_generation===g&&epoch===e;
 function consent(allowed,g){const task=consentChain.catch(()=>{}).then(()=>{if(closed||!connected||!liveSession(current)||current.session_generation!==g)throw Error('textbox_context_changed');return post('presence/consent',{generation:g,allowed});});consentChain=task.catch(()=>{});return task;}
 async function revoke(reason){const g=current?.session_generation,valid=connected&&liveSession(current);deactivate('revoked');suspended=true;suspensionReason='revoked';if(reason)onError(reason);if(!valid)return;const e=epoch;
  try{const out=await consent(false,g);if(same(g,e)){if(out?.state?.session_generation!==g||out.state.textbox?.consented!==false)throw Error('textbox_revoke_unconfirmed');onState(out.state);}}
  catch{if(same(g,e))onError('Textbox capture is stopped; session revocation could not be confirmed.');}
 }
 async function legacyCapture(payload,g,e){
  if(!same(g,e)||!armed||captureAbort||current?.textbox?.consented!==true)return;
  let clean;try{clean=minimizeTextboxBatch(payload);}catch{if(same(g,e)){lastSubmission='invalid';onError('Textbox timing metadata was rejected; no batch was sent.');}return;}
  const abort=new AbortController(),submittedWindow=windowRevision;captureAbort=abort;lastSubmission='in_flight';
  try{const out=await post('presence/capture',{generation:g,capture:clean},{signal:abort.signal});if(same(g,e)&&armed&&out?.state?.session_generation===g){const statuses={ready:'complete',backoff:'discarded_cooldown',busy:'discarded_in_flight',not_consented:'discarded_consent',discarded:'discarded',unavailable:'unavailable',access_rejected:'access_rejected'};if(windowRevision===submittedWindow)lastSubmission=statuses[out.capture_status]??'unconfirmed';onState(out.state);}}
  catch{if(same(g,e)&&armed){if(windowRevision===submittedWindow)lastSubmission='unavailable';onError('Textbox guidance could not be refreshed. No batch will be retried.');}}
  finally{clean=null;if(captureAbort===abort)captureAbort=null;}
 }
 function bufferedCapture(payload,g,e,token,meta){
  if(!same(g,e)||!armed||current?.textbox?.consented!==true)return;
  const sequence=enableCumulativeCapture?++latestBufferSequence:windowRevision;
  if(enableCumulativeCapture){
   const windowId=meta?.kind==='final'?lastEndedWindowId:activeWindowId;
   const sample={windowId,id:sequence,kind:meta?.kind==='final'?'final':'interim'};
   if(windowId){revisionWindows.set(sequence,sample);if(revisionWindows.size>200)revisionWindows.delete(revisionWindows.keys().next().value);recordWindowEvent(windowId,'sample',null,meta?.has_new_input===false?'unchanged_skipped':'captured',sample);}
   if(meta?.has_new_input===false)return;
  }
  try{if(enableCumulativeCapture)latestOfferedBufferSequence=sequence;const observationEndedAtMs=enableCumulativeCapture&&meta?.kind==='final'&&Number.isSafeInteger(lastBoundary?.ended_at_ms)?lastBoundary.ended_at_ms:wallNow();buffer.offer(payload,{completedAt:now(),observationEndedAtMs,token,sequence});}catch{if(same(g,e)){lastSubmission='invalid';onError('Textbox timing metadata was rejected; no batch was sent.');}}
 }
 async function begin(){const g=current.session_generation,e=++epoch;attempted=true;
  try{
   if(current?.textbox?.consented!==true){const out=await consent(true,g);if(!same(g,e))return;if(out?.state?.session_generation!==g||out.state.textbox?.consented!==true)throw Error('textbox_consent_unconfirmed');onState(out.state);}
   if(!same(g,e)||current?.textbox?.consented!==true)return;grantAcknowledged=true;
   const controller=new AbortController();mountAbort=controller;const timer=setTimeoutFn(()=>controller.abort(),mountTimeoutMs);
   try{
   const module=await abortable(loadCollector(),controller.signal);if(!same(g,e)||current?.textbox?.consented!==true){controller.abort();return;}
   bufferToken=buffer.token();
   const mount=enableCumulativeCapture?module.mountCumulativeCipherTextarea:module.mountCipherTextarea;
   if(typeof mount!=='function')throw Error('textbox_collector_unavailable');
   const attached=await abortable(mount(element,{signal:controller.signal,quarantine,nowMonotonic:now,nowWall:wallNow,clipDriverOptions:{now,setTimer:setTimeoutFn,clearTimer:clearTimeoutFn},allowConcurrent:enableLatestBuffer,canFlush:()=>enableLatestBuffer||(now()>=nextCaptureAt&&current?.textbox?.in_flight!==true),onBatch:payload=>enableLatestBuffer?bufferedCapture(payload,g,e,bufferToken):legacyCapture(payload,g,e),onSnapshot:(payload,meta)=>{bufferedCapture(payload,g,e,bufferToken,meta);},onStatus:(value,meta)=>{
    if(!same(g,e)||(!armed&&!grantAcknowledged))return;
    if(value==='window_open'){if(enableCumulativeCapture)cumulativeStatus='ready';windowState='open';partialDropped=false;activeWindowId=++windowSerial;recordWindowEvent(activeWindowId,'start');windowStartedAt=typeof meta?.started_at_ms==='number'&&Number.isFinite(meta.started_at_ms)&&meta.started_at_ms>=0?meta.started_at_ms:null;}
    if(['window_completed','window_empty','incomplete_window','window_discarded'].includes(value)&&meta&&typeof meta.ended_at_ms==='number'&&Number.isFinite(meta.ended_at_ms)&&meta.ended_at_ms>=0){const reasons=new Set(['send','enter','blur','window_blur','visibility','stop','discarded','discontinuity']);lastBoundary={started_at_ms:windowStartedAt,ended_at_ms:meta.ended_at_ms,end_reason:reasons.has(meta.end_reason)?meta.end_reason:'discarded',eligibility_elapsed_ms:typeof meta.eligibility_elapsed_ms==='number'&&Number.isFinite(meta.eligibility_elapsed_ms)&&meta.eligibility_elapsed_ms>=0?meta.eligibility_elapsed_ms:null};windowStartedAt=null;}
    if(value==='window_completed'){windowRevision++;windowState='closed';lastWindow=partialDropped?'completed_partial':'completed';if(!enableCumulativeCapture)lastSubmission='pending';partialDropped=false;}
    else if(value==='window_empty'){windowRevision++;windowState='closed';lastWindow=partialDropped?'discarded_incomplete':'empty';lastSubmission=partialDropped?'not_submitted':'none';partialDropped=false;}
    else if(value==='incomplete_window'){windowRevision++;windowState='closed';lastWindow='discarded_incomplete';lastSubmission='not_submitted';}
    else if(value==='partial_discarded'||value==='overflow_pending'){windowRevision++;partialDropped=true;lastWindow='discarded_incomplete';lastSubmission='not_submitted';}
    else if(value==='window_discarded'){windowRevision++;windowState='closed';lastWindow='discarded';lastSubmission='not_submitted';}
    else if(value==='cooldown'||value==='refresh_pending'){lastSubmission=value==='refresh_pending'||current?.textbox?.in_flight===true?'discarded_in_flight':'discarded_cooldown';}
    else if(value==='no_payload')lastSubmission='not_submitted';
    else if(value==='refresh_unavailable')lastSubmission='unavailable';
    else if(value==='interim_exhausted'){cumulativeStatus='interim_exhausted';if(activeWindowId!==null)recordWindowEvent(activeWindowId,'sample',null,'pool_exhausted');}
    else if(value==='experiment_unavailable'){cumulativeStatus='unavailable';void revoke('Textbox capture is unavailable; capture is stopped.');}
    else if(value==='collector_unavailable'){windowState='closed';lastWindow='error';lastSubmission='unavailable';void revoke('Textbox capture is unavailable; capture is stopped.');}
    if(['window_completed','window_empty','incomplete_window','window_discarded'].includes(value)&&activeWindowId!==null){const reason=['send','enter','blur','window_blur','visibility','stop','discarded','discontinuity'].includes(meta?.end_reason)?meta.end_reason:'discarded';const status=value==='window_completed'?(lastWindow==='completed_partial'?'partial':'completed'):value==='window_empty'?'empty':value==='incomplete_window'?'incomplete':'discarded';recordWindowEvent(activeWindowId,'end',reason,status);if(value==='window_completed'){lastEndedWindowId=activeWindowId;if(!enableCumulativeCapture){revisionWindows.set(windowRevision,activeWindowId);if(revisionWindows.size>200)revisionWindows.delete(revisionWindows.keys().next().value);}}activeWindowId=null;}
    notifyObservation();
   }}),controller.signal,value=>value?.close?.());
   if(!same(g,e)||current?.textbox?.consented!==true){attached.close();return;}binding=attached;armed=true;binding.deferUntil?.(nextCaptureAt);if(!missedWindow)binding.setEnabled(true);
   }finally{clearTimeoutFn(timer);if(mountAbort===controller)mountAbort=null;}
  }catch{if(same(g,e)){lastWindow='error';lastSubmission='unavailable';await revoke('Textbox capture could not start; ordinary behavior remains available.');}}
 }
 function render(state,options={}){
  if(gateState!==state){gateState=state;const delay=state?.textbox?.refresh_after_ms;if(typeof delay==='number'&&Number.isFinite(delay)&&delay>=0){nextCaptureAt=now()+delay;}}
  const nextConnected=options.connected===true,changed=current?.session_generation!==state?.session_generation,enteredBackoff=state?.textbox?.status==='backoff'&&current?.textbox?.status!=='backoff';
  if(changed){deactivate();attempted=false;suspended=false;suspensionReason=null;windowState='closed';lastWindow='none';lastSubmission='none';windowRevision=0;partialDropped=false;windowStartedAt=null;lastBoundary=null;windowSerial=0;activeWindowId=null;lastEndedWindowId=null;latestBufferSequence=0;latestOfferedBufferSequence=0;cumulativeStatus='ready';missedWindow=false;windowEvents=[];windowEventsOmitted=0;revisionWindows.clear();}
  if(connected&&!nextConnected){deactivate('connection_lost');if(!suspended){suspended=true;suspensionReason='connection';}}
  if(!liveSession(state)&&liveSession(current)){deactivate('session_ended');suspended=true;suspensionReason='ended';}
  if((armed||grantAcknowledged)&&state?.textbox?.consented!==true){deactivate('revoked');suspended=true;suspensionReason='revoked';}
  // Reconnect resumes only still-authorized capture, without issuing a new grant.
  // Explicit Stop/revocation/SDK failure remain latched until a fresh Open.
  if(suspensionReason==='connection'&&nextConnected&&liveSession(state)&&state?.textbox?.consented===true&&state.textbox.consent_revoked!==true&&state.textbox.status!=='access_rejected'){suspended=false;suspensionReason=null;attempted=false;}
  current=state;connected=nextConnected;if(enableLatestBuffer){if(enteredBackoff)buffer.rateLimitUntil(nextCaptureAt);buffer.deferUntil(nextCaptureAt);binding?.deferUntil?.(nextCaptureAt);buffer.notifyEligibilityChanged();}
  if(state?.textbox?.status==='access_rejected'&&(armed||grantAcknowledged))void revoke('Textbox service access was rejected; capture is stopped.');
  if(!closed&&connected&&liveSession(current)&&config.live_enabled===true&&config.session_authorized===true&&!attempted&&!suspended&&current.textbox?.status!=='access_rejected'&&current.textbox?.consent_revoked!==true)void begin();
 }
 const gapKey=e=>{if(!enableCumulativeCapture||!connected||!liveSession(current)||suspended||(armed&&!missedWindow)||e.isTrusted!==true||e.repeat||e.isComposing||e.keyCode===229||typeof e.code!=='string'||!e.code)return;if(e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey){queueMicrotask(endGap);return;}if(!e.ctrlKey&&!e.metaKey&&!['Shift','Control','Alt','Meta','CapsLock','Tab','Escape'].includes(e.key)){missedWindow=true;cumulativeStatus='capture_gap';notifyObservation();}};
 const endGap=()=>{if(!missedWindow)return;missedWindow=false;if(binding&&armed&&!suspended&&connected&&current?.textbox?.consented===true){cumulativeStatus='ready';binding.setEnabled(true);notifyObservation();}};
 const gapBlur=()=>{if(enableCumulativeCapture&&missedWindow)queueMicrotask(endGap);};
 if(enableCumulativeCapture){element.addEventListener('keydown',gapKey,true);element.addEventListener('blur',gapBlur,true);}
 return{render,finish(){if(enableCumulativeCapture&&missedWindow){endGap();return;}return binding?.finish?.();},status(){return closed?'closed':suspended?'paused':armed?'active':liveSession(current)&&attempted?'starting':'not_started';},observation(){return{window:windowState,last_window:lastWindow,last_submission:lastSubmission,...(enableCumulativeCapture?{cumulative_capture:cumulativeStatus}:{})};},windowEvents(){return{ledger_id:ledgerId,session_generation:current?.session_generation??null,events:windowEvents.slice(),events_omitted:windowEventsOmitted};},timing(){return{current_window_started_at_ms:windowState==='open'?windowStartedAt:null,last_boundary:lastBoundary?{...lastBoundary}:null};},suspend(){deactivate('stop');suspended=true;suspensionReason='stop';},close(){if(closed)return;if(enableCumulativeCapture){element.removeEventListener('keydown',gapKey,true);element.removeEventListener('blur',gapBlur,true);}stopGuard.close();deactivate('page_closed');buffer.close();quarantine.clear();closed=true;}};
}
