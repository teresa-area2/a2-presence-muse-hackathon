import{bindCumulativeCipherExperiment}from'../web/cipher-cumulative-experiment.mjs';
import{createCipherClipDriver}from'../web/cipher-batching.mjs';
import{createTextboxLatestBuffer}from'../web/textbox-latest-buffer.mjs';
import{pathToFileURL}from'node:url';
import{realpathSync}from'node:fs';

export const SCENARIO_IDS=Object.freeze(['continuous-refresh','send-before-refresh','latest-only-buffering','stop-clears-pending']);
const ACTIONS=new Set(['tap','advance','checkpoint','send','resolve','stop']);
const MAX_EVENTS=64;
const MAX_TAPS_PER_ACTION=500;
const MAX_TOTAL_TAPS=1000;
const MAX_ADVANCE_MS=120000;
const MAX_TOTAL_MS=300000;

function validateScript(events){
 if(!Array.isArray(events)||events.length<1||events.length>MAX_EVENTS)throw Error('simulate_script_invalid: event count out of range');
 let taps=0,totalMs=0;
 for(const event of events){
  if(!event||typeof event!=='object'||Array.isArray(event)||!ACTIONS.has(event.action))throw Error('simulate_script_invalid: unknown action');
  const keys=event.action==='tap'?['action','count']:event.action==='advance'?['action','ms']:['action'];
  if(Object.keys(event).some(k=>!keys.includes(k)))throw Error('simulate_script_invalid: unknown field');
  if(event.action==='tap'){
   if(!Number.isSafeInteger(event.count)||event.count<1||event.count>MAX_TAPS_PER_ACTION)throw Error('simulate_script_invalid: tap count out of range');
   taps+=event.count;
  }
  if(event.action==='advance'){
   if(!Number.isSafeInteger(event.ms)||event.ms<0||event.ms>MAX_ADVANCE_MS)throw Error('simulate_script_invalid: advance out of range');
   totalMs+=event.ms;
  }
 }
 if(taps>MAX_TOTAL_TAPS)throw Error('simulate_script_invalid: total tap count out of range');
 if(totalMs>MAX_TOTAL_MS)throw Error('simulate_script_invalid: total advance out of range');
}
function validateOptions(options){
 if(options===undefined)return{holdFirstDispatch:false,firstSampleMinMs:30000,captureCount:5};
 if(!options||typeof options!=='object'||Array.isArray(options))throw Error('simulate_option_invalid');
 if(Object.keys(options).some(k=>!['holdFirstDispatch','firstSampleMinMs','captureCount'].includes(k)))throw Error('simulate_option_invalid: unknown option');
 const out={holdFirstDispatch:false,firstSampleMinMs:30000,captureCount:5,...options};
 if(typeof out.holdFirstDispatch!=='boolean')throw Error('simulate_option_invalid: holdFirstDispatch');
 if(!Number.isSafeInteger(out.firstSampleMinMs)||out.firstSampleMinMs<0||out.firstSampleMinMs>30000)throw Error('simulate_option_invalid: firstSampleMinMs');
 if(!Number.isSafeInteger(out.captureCount)||out.captureCount<2||out.captureCount>5)throw Error('simulate_option_invalid: captureCount');
 return out;
}
function makePayload(length,index){
 return{keyAreas:Array.from({length},()=>1),keyTypes:Array.from({length},()=>'an'),pressTimes:Array.from({length},(_,i)=>i*10),releaseTimes:Array.from({length},(_,i)=>i*10+5),length,sessionID:'synthetic-capture-'+index,startUnixTime:1700000000,timeZone:0,season:'Winter',time:'Morning',weekday:'Monday'};
}
function makeCapture(index){
 let completed=0;
 return{handleProcessKeydown(){},handleProcessKeyup(){completed+=1;},handleEndTypingSession(){return completed>0?makePayload(completed,index):null;}};
}
function makeElement(){
 const handlers=new Map();
 return{ownerDocument:undefined,addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},removeEventListener(type,fn){handlers.get(type)?.delete(fn);},emit(type,event){for(const fn of[...(handlers.get(type)??[])])fn(event);}};
}
const SCENARIOS={
 'continuous-refresh':{options:{},events:[{action:'tap',count:2},{action:'advance',ms:30000},{action:'tap',count:2},{action:'advance',ms:30000},{action:'tap',count:2},{action:'advance',ms:30000}]},
 'send-before-refresh':{options:{},events:[{action:'tap',count:2},{action:'advance',ms:30000},{action:'advance',ms:29999},{action:'send'},{action:'advance',ms:2}]},
 'latest-only-buffering':{options:{holdFirstDispatch:true},events:[{action:'tap',count:2},{action:'checkpoint'},{action:'advance',ms:1000},{action:'tap',count:2},{action:'checkpoint'},{action:'advance',ms:1000},{action:'tap',count:2},{action:'checkpoint'},{action:'resolve'},{action:'advance',ms:28000}]},
 'stop-clears-pending':{options:{holdFirstDispatch:true},events:[{action:'tap',count:2},{action:'checkpoint'},{action:'advance',ms:1000},{action:'tap',count:2},{action:'checkpoint'},{action:'stop'},{action:'resolve'},{action:'advance',ms:60000}]}
};

async function executeScript(events,options,recorded=null){
 validateScript(events);
 const opts=validateOptions(options);
 let now=0,timerId=0,timerOrder=0,tapTotal=0,skippedFinalCount=0,lastDispatchSequence=null,dispatchOrdinal=0,closed=false,timersAfterClose=null;
 const timers=new Map(),ledger=[],snapshots=[],dispatches=[],replacedSequences=[],bufferOutcomes=[];
 let heldResolvers=[];
 const setTimer=(fn,delay)=>{if(typeof fn!=='function'||!Number.isFinite(delay))throw Error('simulate_timer_invalid');const id=++timerId;timers.set(id,{fn,at:now+Math.max(0,delay),order:++timerOrder});return id;};
 const clearTimer=id=>{timers.delete(id);};
 const drain=async()=>{for(let i=0;i<3;i+=1)await new Promise(resolve=>setImmediate(resolve));};
 const earliest=()=>[...timers.entries()].map(([id,timer])=>({id,...timer})).sort((a,b)=>a.at-b.at||a.order-b.order)[0]??null;
 async function advanceVirtual(ms){
  const target=now+ms;
  for(let guard=0;guard<10000;guard+=1){
   const next=earliest();
   if(next&&next.at<=target){now=Math.max(now,next.at);timers.delete(next.id);next.fn();await drain();continue;}
   if(now<target){now=target;await drain();continue;}
   await drain();
   const after=earliest();
   if(after&&after.at<=target)continue;
   return;
  }
  throw Error('simulate_timer_limit');
 }
 const element=makeElement();
 const captures=Array.from({length:opts.captureCount},(_,i)=>makeCapture(i));
 const quarantines=Array.from({length:opts.captureCount},()=>new Set());
 const buffer=createTextboxLatestBuffer({now:()=>now,setTimer,clearTimer,dispatch:payload=>{dispatchOrdinal+=1;const sequence=lastDispatchSequence;dispatches.push({sequence,length:payload.length,at:now});if(recorded)recorded.push({at_ms:now,sequence,fixture_capture:structuredClone(payload)});ledger.push({t:now,type:'dispatch',sequence,length:payload.length});if(opts.holdFirstDispatch&&dispatchOrdinal===1)return new Promise(resolve=>heldResolvers.push(resolve));return Promise.resolve({status:'ready'});},onEvent:evt=>{const entry={t:now,type:'buffer',sequence:evt.sequence,phase:evt.phase};if(evt.status!==null&&evt.status!==undefined)entry.status=evt.status;ledger.push(entry);if(evt.phase==='replaced'&&!replacedSequences.includes(evt.sequence))replacedSequences.push(evt.sequence);if(evt.phase==='outcome')bufferOutcomes.push({sequence:evt.sequence,status:evt.status??null,t:now});if(evt.phase==='dispatch')lastDispatchSequence=evt.sequence;},onChange:()=>{}});
 let binding,driver;
 const closeAll=()=>{if(closed)return;closed=true;try{driver.close();}finally{try{binding.close();}finally{buffer.close();timersAfterClose=timers.size;ledger.push({t:now,type:'close'});}}};
 binding=bindCumulativeCipherExperiment({element,captures,quarantines,nowMonotonic:()=>now,nowWall:()=>now,onStatus:()=>{},onSnapshot:(payload,meta)=>{snapshots.push({sequence:meta.sequence,kind:meta.kind,length:payload.length,has_new_input:meta.has_new_input===true,t:now});ledger.push({t:now,type:'snapshot',sequence:meta.sequence,kind:meta.kind,length:payload.length,has_new_input:meta.has_new_input===true});if(meta.kind==='final'&&meta.has_new_input!==true){skippedFinalCount+=1;ledger.push({t:now,type:'final_skipped',sequence:meta.sequence,has_new_input:false});return;}if(meta.has_new_input!==true)return;buffer.offer(payload,{completedAt:now,observationEndedAtMs:now,token:buffer.token(),sequence:meta.sequence});}});
 driver=createCipherClipDriver({binding,now:()=>now,setTimer,clearTimer,firstSampleMinMs:opts.firstSampleMinMs});
 binding.setEnabled(true);
 driver.start();
 try{
  for(const event of events){
   if(event.action==='tap'){
    tapTotal+=event.count;ledger.push({t:now,type:'tap',count:event.count});
    for(let i=0;i<event.count;i+=1){const base={isTrusted:true,key:'a',code:'KeyA',repeat:false,isComposing:false,keyCode:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false};element.emit('keydown',base);element.emit('keyup',{...base});driver.notifyInput();}
    await drain();
   }else if(event.action==='advance'){
    await advanceVirtual(event.ms);ledger.push({t:now,type:'advance',ms:event.ms});
   }else if(event.action==='checkpoint'){
    const result=binding.checkpoint();ledger.push({t:now,type:'checkpoint',status:result.status});await drain();
   }else if(event.action==='send'){
    ledger.push({t:now,type:'send'});driver.stop();await binding.finish();await drain();
   }else if(event.action==='resolve'){
    const resolvers=heldResolvers;heldResolvers=[];ledger.push({t:now,type:'resolve',count:resolvers.length});for(const resolve of resolvers)resolve({status:'ready'});await drain();
   }else if(event.action==='stop'){
    ledger.push({t:now,type:'stop'});closeAll();await drain();
   }
  }
 }finally{
  closeAll();await drain();timersAfterClose=Math.max(timersAfterClose??0,timers.size);timers.clear();
 }
 const interimSnapshots=snapshots.filter(x=>x.kind==='interim').length;
 return{synthetic:true,inference:'stub',scenario:'custom',ok:true,virtualTime:now,dispatchLengths:dispatches.map(x=>x.length),dispatchTimes:dispatches.map(x=>x.at),dispatches,snapshots,replacedSequences,skippedFinalCount,bufferOutcomes,ledger,counts:{taps:tapTotal,snapshots:snapshots.length,interimSnapshots,finalSnapshots:snapshots.length-interimSnapshots,dispatches:dispatches.length,replaced:replacedSequences.length,skippedFinal:skippedFinalCount},capturesTotal:opts.captureCount,interimSlotsRemaining:(opts.captureCount-1)-interimSnapshots,timersPending:timersAfterClose,closed:true,bufferClosed:buffer.status().closed};
}

// Default reports stay content-free. This separate development helper records only
// internally generated fake captures; it accepts no text, SDK payload or I/O callback.
export async function runScript(events,options){return executeScript(events,options);}
export async function recordSyntheticDispatches(events,options){
 if(arguments.length>2)throw Error('simulate_option_invalid: unknown argument');
 const dispatches=[];
 const report=await executeScript(events,options,dispatches);
 return{synthetic:true,inference:'stub',payload_origin:'generated_not_sdk',report,dispatches};
}

export async function runScenario(id){
 if(!SCENARIO_IDS.includes(id))throw Error('simulate_scenario_unknown');
 const def=SCENARIOS[id];
 const report=await runScript(def.events.map(x=>({...x})),{...def.options});
 report.scenario=id;
 return report;
}
async function main(args){
 if(args.length>1)throw Error('simulate_cli_invalid');
 if(args.length===1){process.stdout.write(JSON.stringify(await runScenario(args[0]))+'\n');return;}
 const reports=[];
 for(const id of SCENARIO_IDS)reports.push(await runScenario(id));
 process.stdout.write(JSON.stringify({synthetic:true,inference:'stub',reports})+'\n');
}
let directEntry=false;try{directEntry=!!process.argv[1]&&pathToFileURL(realpathSync(process.argv[1])).href===import.meta.url;}catch{}
if(directEntry)main(process.argv.slice(2)).catch(error=>{const code=typeof error?.message==='string'&&error.message.startsWith('simulate_')?error.message.split(':')[0]:'simulate_textbox_failed';process.stdout.write(JSON.stringify({synthetic:true,inference:'stub',ok:false,error:code})+'\n');process.exitCode=1;});
