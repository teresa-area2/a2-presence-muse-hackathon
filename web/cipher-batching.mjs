// A typing window opens on focus/first trusted input and ends on blur, Send or
// unmodified Enter. It is separate from the long-lived Muse conversation.
// No composer text, clipboard, global keystrokes or fabricated release timings.
export function bindDesktopCipher({element,capture,onBatch,onStatus=()=>{},onDiscontinuity=null,canFlush=()=>true,allowConcurrent=false,quarantine=new Set(),nowMonotonic=()=>performance.now(),nowWall=Date.now}){
 if(!element?.addEventListener||typeof capture?.handleEndTypingSession!=='function'||typeof capture?.handleProcessKeydown!=='function'||typeof capture?.handleProcessKeyup!=='function'||typeof onBatch!=='function'||typeof canFlush!=='function'||onDiscontinuity!==null&&typeof onDiscontinuity!=='function'||!(quarantine instanceof Set)||typeof nowMonotonic!=='function'||typeof nowWall!=='function')throw Error('cipher_binding_invalid');
 let enabled=false,closed=false,windowOpen=false,busy=false,completed=0,completionVersion=0,epoch=0,overflow=false;
 const down=new Map(),shortcutHeld=new Set(),hostDocument=element.ownerDocument,hostWindow=hostDocument?.defaultView;
 const clock=fn=>{try{const n=fn();return typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;}catch{return null;}};
 const boundary=(reason,ended,elapsed=null)=>({end_reason:reason,ended_at_ms:ended,eligibility_elapsed_ms:elapsed});
 const discard=()=>{let ok=true;for(const code of down.keys())quarantine.add(code);if(completed||down.size){try{capture.handleEndTypingSession();}catch{ok=false;}}completed=0;down.clear();return ok;};
 const focus=()=>{if(enabled&&!closed&&!windowOpen){windowOpen=true;overflow=false;onStatus('window_open',{started_at_ms:clock(nowWall)});}};
 function disable(reason='waiting_for_consent'){const hadInput=completed>0||down.size>0;epoch++;enabled=false;windowOpen=false;overflow=false;shortcutHeld.clear();if(!discard())reason='collector_unavailable';if(hadInput)onStatus('window_discarded');onStatus(reason);}
 function discardSafely(){if(discard())return true;disable('collector_unavailable');return false;}
 function interrupt(){if(!onDiscontinuity)return false;try{onDiscontinuity();}catch{disable('collector_unavailable');}return true;}
 async function finish(reason='send'){
  if(!enabled||closed||!windowOpen)return;
  const endReason=['send','enter','blur','window_blur','visibility','checkpoint','discontinuity'].includes(reason)?reason:'send',ended=clock(nowWall),started=clock(nowMonotonic);
  windowOpen=false;shortcutHeld.clear();
  if(overflow||(down.size&&!completed)){if(!discardSafely())return;overflow=false;onStatus('incomplete_window',boundary(endReason,ended));return;}
  // The SDK returns only completed pairs and resets its pending keys. Keep
  // those pairs rather than losing a whole window when a release is late.
  if(down.size){for(const code of down.keys())quarantine.add(code);onStatus('partial_discarded',{phase:'boundary'});}
  if(!completed){onStatus('window_empty',boundary(endReason,ended));return;}
  let eligible;try{eligible=canFlush()===true;}catch{onStatus('window_completed',boundary(endReason,ended));disable('collector_unavailable');return;}
  const stopped=clock(nowMonotonic),elapsed=started!==null&&stopped!==null&&stopped>=started?stopped-started:null;
  onStatus('window_completed',boundary(endReason,ended,elapsed));
  // End every logical window. A completed window inside cooldown/in-flight is
  // discarded, never queued as a retry or merged with a later interaction.
  if((busy&&!allowConcurrent)||!eligible){if(!discardSafely())return;onStatus(busy?'refresh_pending':'cooldown');return;}
  let payload;try{payload=capture.handleEndTypingSession();completed=0;down.clear();}catch{disable('collector_unavailable');return;}
  if(!payload){onStatus('no_payload');return;}
  const e=epoch;busy=true;onStatus('refreshing');
  try{await onBatch(payload);}catch{if(enabled&&!closed&&e===epoch)onStatus('refresh_unavailable');}
  finally{payload=null;busy=false;}
 }
 const keydown=e=>{
  if(!enabled||closed||e.isTrusted!==true||e.repeat||e.isComposing||e.keyCode===229||typeof e.code!=='string'||!e.code)return;
  focus();
  // Enter is a boundary even if an earlier Shift+Enter release was lost.
  // It is not sent to the SDK, so no new key pair can be fabricated.
  if(e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey){void finish('enter');return;}
  // A key still down at an earlier boundary has an ambiguous next release.
  // Drop that pair until one matching keyup; never pair it across windows.
  if(quarantine.has(e.code)){if(!interrupt())onStatus('partial_discarded');return;}
  if(shortcutHeld.size&&e.key!=='Meta'&&e.key!=='Control'&&e.metaKey===false&&e.ctrlKey===false){shortcutHeld.clear();if(down.size){if(interrupt())return;if(!discardSafely())return;onStatus('partial_discarded');}}
  if(e.key==='Meta'||e.key==='Control'||e.metaKey||e.ctrlKey||shortcutHeld.size){if(e.key==='Meta'||e.key==='Control')shortcutHeld.add(e.code);if(down.size){if(interrupt())return;if(!discardSafely())return;onStatus('partial_discarded');}return;}
  if(overflow)return;
  if(down.has(e.code)){if(interrupt())return;if(!discardSafely())return;onStatus('partial_discarded');return;}
  // Cipher indexes open keys by value. Do not let two physical codes sharing
  // that value complete one another's timing (for example, both Shift keys).
  if([...down.values()].some(value=>value===e.key)){quarantine.add(e.code);if(!interrupt())onStatus('partial_discarded');return;}
  if(completed>=2000){if(!discardSafely())return;overflow=true;onStatus('overflow_pending');return;}
  try{capture.handleProcessKeydown(e.key);down.set(e.code,e.key);}catch{disable('collector_unavailable');}
 };
 const keyup=e=>{
  if(!enabled||closed||e.isTrusted!==true)return;
  if(quarantine.has(e.code)){quarantine.delete(e.code);return;}
  if(!windowOpen)return;
  if(shortcutHeld.has(e.code)||e.metaKey||e.ctrlKey||shortcutHeld.size){shortcutHeld.delete(e.code);if(down.size){if(interrupt())return;if(!discardSafely())return;onStatus('partial_discarded');}return;}
  if(!down.has(e.code))return;
  try{capture.handleProcessKeyup(down.get(e.code));down.delete(e.code);completed++;completionVersion++;}catch{disable('collector_unavailable');}
 };
 const blur=()=>{void finish('blur');};
 const windowBlur=()=>{void finish('window_blur');};
 const visibility=()=>{if(hostDocument?.visibilityState==='hidden')void finish('visibility');};
 element.addEventListener('focus',focus);element.addEventListener('keydown',keydown,true);element.addEventListener('keyup',keyup,true);element.addEventListener('blur',blur);
 hostWindow?.addEventListener?.('blur',windowBlur);hostDocument?.addEventListener?.('visibilitychange',visibility);
 return{
  setEnabled(value){if(closed||typeof value!=='boolean')throw Error('cipher_binding_closed');if(!value){disable();return;}if(enabled)return;enabled=true;onStatus('waiting_for_input');if(hostDocument?.activeElement===element)focus();},
  finish,hasPendingKeys(){return down.size>0;},hasCompletedKeys(){return completed>0;},completedVersion(){return completionVersion;},discardWindow(reason='discarded'){const wasOpen=windowOpen,hadInput=completed>0||down.size>0,ended=clock(nowWall),meta=boundary(reason==='stop'?'stop':'discarded',ended);windowOpen=false;overflow=false;shortcutHeld.clear();if(!discardSafely())return;if(hadInput)onStatus('window_discarded',meta);else if(wasOpen)onStatus('window_empty',meta);},async flush(){return finish();},
  close(){if(closed)return;disable();closed=true;element.removeEventListener('focus',focus);element.removeEventListener('keydown',keydown,true);element.removeEventListener('keyup',keyup,true);element.removeEventListener('blur',blur);hostWindow?.removeEventListener?.('blur',windowBlur);hostDocument?.removeEventListener?.('visibilitychange',visibility);}
 };
}

// Offline qualification only: independent official Cipher managers see the same
// admitted DOM events. Interim clips are non-overlapping; the full aggregate is
// finalized and discarded locally, never sent alongside those clips.
export function bindDualDesktopCipher({element,fullCapture,clipCapture,onClip,onLogicalStatus=()=>{},onClipStatus=()=>{},nowMonotonic=()=>performance.now(),nowWall=Date.now}){
 if(!fullCapture||!clipCapture||fullCapture===clipCapture||typeof onClip!=='function')throw Error('cipher_dual_invalid');
 let closed=false,enabled=false,failed=false,clip;
 const latch=()=>{failed=true;enabled=false;queueMicrotask(()=>{if(!closed){try{full.setEnabled(false);}finally{clip?.setEnabled(false);}}});};
 const full=bindDesktopCipher({element,capture:fullCapture,onBatch:()=>{},onStatus:(value,meta)=>{onLogicalStatus(value,meta);if(['collector_unavailable','overflow_pending','partial_discarded','incomplete_window'].includes(value))latch();},nowMonotonic,nowWall});
 try{clip=bindDesktopCipher({element,capture:clipCapture,onBatch:payload=>{if(!closed&&enabled&&!failed)return onClip(payload);},onStatus:(value,meta)=>{onClipStatus(value,meta);if(['collector_unavailable','overflow_pending','partial_discarded','incomplete_window'].includes(value))latch();},allowConcurrent:true,nowMonotonic,nowWall});}
 catch(error){full.close();throw error;}
 return{
  setEnabled(value){if(closed||typeof value!=='boolean'||failed&&value)throw Error('cipher_dual_unavailable');enabled=value;full.setEnabled(value);clip.setEnabled(value);},
  checkpoint(){if(closed||!enabled||failed)return{status:'unavailable'};if(clip.hasPendingKeys())return{status:'held_key'};if(!clip.hasCompletedKeys())return{status:'empty'};void clip.finish('checkpoint');return{status:'finished'};},
  finish(){if(closed||!enabled||failed)return;const left=full.finish('send'),right=clip.finish('send');return Promise.all([left,right]);},
  discardWindow(reason='discarded'){if(closed)return;full.discardWindow(reason);clip.discardWindow(reason);},
  close(){if(closed)return;closed=true;enabled=false;try{full.close();}finally{clip.close();}}
 };
}

// Offline driver for one logical focus window. Caller supplies the current
// local admission deadline and notifies real keyup events; no provider calls.
export function createCipherClipDriver({binding,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,firstSampleMinMs=0}={}){
 if(typeof binding?.checkpoint!=='function'||[now,setTimer,clearTimer].some(x=>typeof x!=='function')||!Number.isSafeInteger(firstSampleMinMs)||firstSampleMinMs<0||firstSampleMinMs>30000||(firstSampleMinMs>0&&(typeof binding.hasCompletedInput!=='function'||typeof binding.hasMinimumInput!=='function')))throw Error('cipher_clip_driver_invalid');
 let active=false,closed=false,timer=null,nextAt=0,firstInputAt=null,firstSnapshot=false;
 const clock=()=>{const value=now();if(!Number.isFinite(value)||value<0)throw Error('cipher_clip_clock_invalid');return value;};
 const cancel=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
 function pump(){cancel();if(!active||closed)return;const at=clock();if(firstSampleMinMs>0&&!firstSnapshot&&firstInputAt===null)return;const due=Math.max(nextAt,firstSampleMinMs>0&&!firstSnapshot?firstInputAt+firstSampleMinMs:0);if(at<due){timer=setTimer(pump,due-at);return;}if(firstSampleMinMs>0&&!firstSnapshot&&binding.hasMinimumInput()!==true)return;const result=binding.checkpoint();if(result?.status==='finished'){firstSnapshot=true;nextAt=at+30000;timer=setTimer(pump,30000);}else if(result?.status==='unavailable'||result?.status==='exhausted')active=false;}
 return{start(){if(closed)return;active=true;firstInputAt=null;firstSnapshot=false;pump();},notifyInput(){if(!active||closed)return;if(firstSampleMinMs>0&&!firstSnapshot&&firstInputAt===null&&binding.hasCompletedInput()===true)firstInputAt=clock();if(timer===null)pump();},deferUntil(at){if(!Number.isFinite(at)||at<0)throw Error('cipher_clip_clock_invalid');nextAt=Math.max(nextAt,at);if(active)pump();},stop(){active=false;cancel();},close(){closed=true;active=false;cancel();}};
}
