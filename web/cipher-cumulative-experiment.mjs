import {bindDesktopCipher} from './cipher-batching.mjs';

// OFFLINE experiment: all independent Cipher instances must exist before input.
// Each interim instance is consumed once; the final instance remains reserved.
// This function does not call OP, store samples, or alter the live textbox path.
export function bindCumulativeCipherExperiment({element,captures,quarantines=Array.from({length:captures?.length??0},()=>new Set()),onSnapshot,onStatus=()=>{},nowMonotonic=()=>performance.now(),nowWall=Date.now}={}){
 if(!element?.addEventListener||!Array.isArray(captures)||captures.length<2||captures.length>5||new Set(captures).size!==captures.length||!Array.isArray(quarantines)||quarantines.length!==captures.length||quarantines.some(q=>!(q instanceof Set))||new Set(quarantines).size!==quarantines.length||typeof onSnapshot!=='function'||typeof onStatus!=='function')throw Error('cipher_cumulative_invalid');
 let closed=false,enabled=false,failed=false,ended=false,finalReady=false,selected=null,serial=0,exhaustionReported=false,lastSnapshotVersion=0;
 const slots=[],finalIndex=captures.length-1;
 const fatal=new Set(['collector_unavailable','overflow_pending']);
 const closeSlots=()=>{for(const slot of slots)slot.binding?.close();};
 const fail=()=>{if(failed)return;failed=true;enabled=false;finalReady=false;queueMicrotask(()=>{if(!closed){closeSlots();try{Promise.resolve(onStatus('experiment_unavailable')).catch(()=>{});}catch{}}});};
 const handle=(fn,...args)=>{try{const result=fn(...args);if(result&&typeof result.then==='function')Promise.resolve(result).catch(fail);}catch{fail();}};
 // The experiment accepts only synchronous enqueue callbacks. Actual async
 // dispatch belongs in the separately serialized latest-only buffer.
 const publish=(payload,meta)=>{try{const result=onSnapshot(payload,meta);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});fail();}}catch{fail();}};
 const report=(value,meta)=>handle(onStatus,value,meta);
 // A guarded keyboard discontinuity ends the current observation. Cipher
 // returns completed key pairs only; held keys remain quarantined across the
 // replacement pool and no synthetic release is generated.
 const interrupt=()=>{if(!closed&&enabled&&!ended&&!failed)void final.binding.finish('discontinuity');};
 const logicalStatus=(value,meta)=>{
  if(fatal.has(value)){fail();report(value,meta);return;}
  if(value==='partial_discarded'&&meta?.phase!=='boundary'){fail();report(value,meta);return;}
  if(['window_completed','window_empty','window_discarded','incomplete_window'].includes(value)){
   ended=true;enabled=false;finalReady=value==='window_completed';
   // Discard every unused interim manager before it can emit on the same blur.
   for(const slot of slots)if(slot.index!==finalIndex)slot.binding?.close();
  }
  report(value,meta);
 };
 try{
  // The final manager is installed first so its logical boundary closes unused
  // interim managers before their own blur/Enter handlers can emit snapshots.
  const order=[finalIndex,...Array.from({length:finalIndex},(_,i)=>i)];
  for(const index of order){
   const slot={index,binding:null,used:false};slots.push(slot);
   slot.binding=bindDesktopCipher({element,capture:captures[index],quarantine:quarantines[index],onDiscontinuity:interrupt,nowMonotonic,nowWall,
    onStatus:index===finalIndex?logicalStatus:(value)=>{if(fatal.has(value)||value==='partial_discarded'||value==='incomplete_window')fail();},
    onBatch:payload=>{
     if(closed||failed)return;
     if(index===finalIndex&&finalReady){finalReady=false;publish(payload,{kind:'final',sequence:++serial,has_new_input:final.binding.completedVersion()>lastSnapshotVersion});}
     else if(index!==finalIndex&&enabled&&selected===index){lastSnapshotVersion=final.binding.completedVersion();publish(payload,{kind:'interim',sequence:++serial,has_new_input:true});}
    }});
  }
 }catch(error){closeSlots();throw error;}
 const final=slots.find(x=>x.index===finalIndex),interims=slots.filter(x=>x.index!==finalIndex);
 return{
  setEnabled(value){if(closed||ended||failed||typeof value!=='boolean')throw Error('cipher_cumulative_unavailable');if(!value){enabled=false;ended=true;closeSlots();return;}enabled=true;for(const slot of interims)slot.binding.setEnabled(true);if(!failed)final.binding.setEnabled(true);},
  hasCompletedInput(){return !closed&&enabled&&!ended&&!failed&&final.binding.hasCompletedKeys();},
  hasMinimumInput(){return !closed&&enabled&&!ended&&!failed&&final.binding.completedVersion()>=2;},
  checkpoint(){
   if(closed||!enabled||ended||failed)return{status:'unavailable'};
   if(slots.some(slot=>!slot.used&&slot.binding.hasPendingKeys()))return{status:'held_key'};
   if(!final.binding.hasCompletedKeys())return{status:'empty'};
   if(final.binding.completedVersion()===lastSnapshotVersion)return{status:'unchanged'};
   const slot=interims.find(x=>!x.used);if(!slot){if(!exhaustionReported){exhaustionReported=true;report('interim_exhausted');}return{status:'exhausted'};}
   slot.used=true;selected=slot.index;void slot.binding.finish('checkpoint');selected=null;slot.binding.close();return{status:'finished'};
  },
  finish(){if(closed||!enabled||ended||failed)return;return final.binding.finish('send');},
  discardWindow(reason='discarded'){if(closed)return;enabled=false;ended=true;finalReady=false;for(const slot of interims)if(!slot.used)slot.binding.discardWindow(reason);final.binding.discardWindow(reason);closeSlots();},
  close(){if(closed)return;closed=true;enabled=false;finalReady=false;closeSlots();}
 };
}
