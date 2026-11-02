// Memory-only history of native public-message positions and safe delivery data.
// Text is compared transiently, never retained in a history view. Index provenance
// comes from owned native events, not reply text matching or timing heuristics.
import {createHash} from 'node:crypto';
import {projectEvidence} from './evidence-projection.mjs';
const ARMS=['without','with'],MAX_EVENTS=512;
const snapshots=new WeakMap();
const positive=x=>Number.isSafeInteger(x)&&x>0;
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
const identifier=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const projectedDelivery=raw=>projectEvidence({arms:{with:{delivery:raw}}}).arms.with.delivery;
const freshArm=()=>({entries:new Map(),source:'unavailable',turns_unobserved:null,turns_evicted:0,latest:null,session:null,turnId:null,prefixCount:0,prefixHash:hash(''),projectionValid:false,invalid_observations:0,late_attachment_updates:0,last_issue:null});
function invalidate(data,source,issue){data.source=source;data.projectionValid=false;data.last_issue=issue;data.invalid_observations=Math.min(Number.MAX_SAFE_INTEGER,data.invalid_observations+1);}
function nativePublic(native){
 if(!Array.isArray(native.events)||native.events.length>MAX_EVENTS||!nonnegative(native.turnEventStart)||native.turnEventStart>native.events.length)throw Error('turn_window_invalid');
 const messages=[],finals=[];let prefix=hash('');const prefixes=[prefix];
 for(let i=0;i<native.events.length;i++){
  const event=native.events[i];if(event?.type!=='public_message'&&event?.type!=='human_message')continue;
  // Do not inspect payloads of tool, private, usage or other event types.
  const p=event.payload;if(!object(p)||typeof p.text!=='string'||typeof p.message_phase!=='string')throw Error('public_projection_invalid');
  const human=event.type==='human_message';
  const row={author:human?'You':'Muse',text:p.text,phase:p.message_phase,...(human?{target:p.submission_target??'unknown'}:{...(typeof p.truncated==='boolean'?{truncated:p.truncated}:{}),...(typeof p.cut_off==='boolean'?{cut_off:p.cut_off}:{})})};
  messages.push(row);
  // Human submission phase settles in place (attempted -> sent/steered/etc.).
  // It cannot change a message's position; author/text/target still must agree.
  const stable=human?{author:row.author,text:row.text,target:row.target}:row;
  prefix=hash(prefix+'\0'+JSON.stringify(stable));prefixes.push(prefix);
  if(!human&&p.message_phase==='finalAnswer'&&i>=native.turnEventStart)finals.push({message_index:messages.length,message_sha256:hash(p.text)});
 }
 if(finals.length>64)throw Error('final_capacity');
 return{messages,finals,prefixes};
}
function sameMessages(actual,expected){
 if(!Array.isArray(actual)||actual.length!==expected.length)return false;
 return expected.every((row,i)=>{const value=actual[i];return object(value)&&Object.keys(value).length===Object.keys(row).length&&Object.keys(row).every(key=>Object.hasOwn(value,key)&&value[key]===row[key]);});
}
function linkedFinals(arm,delivery,finals){
 const base=finals.map(slot=>({...slot,request_ordinal:null,linkage:'native_turn_scoped'}));
 if(arm==='without'||!finals.length||delivery.response_linkage!=='public_final_matched'||delivery.hook_linkage!=='read_marker_matched'||delivery.turn_completed!==true||delivery.public_finals!==finals.length)return base;
 const proof=delivery.response_attribution,requests=delivery.request_attribution;
 if(proof.linked_finals!==finals.length||proof.finals.length!==finals.length||requests.length!==delivery.requests_observed||proof.requests.length!==requests.length||!requests.every((r,i)=>r.ordinal===i+1))return base;
 const valid=proof.finals.every((f,i)=>{
  const request=requests[f.request_ordinal-1],response=proof.requests[f.request_ordinal-1];
  const presence=request?.status==='guidance_observed'?'guidance':request?.status==='fallback_observed'?'fallback':null;
  return f.ordinal===i+1&&f.status==='final_linked'&&positive(f.request_ordinal)&&request?.ordinal===f.request_ordinal&&presence&&f.presence===presence&&response?.ordinal===f.request_ordinal&&response.status==='response_linked'&&response.presence===presence;
 });
 if(!valid||new Set(proof.finals.map(f=>f.request_ordinal)).size!==finals.length)return base;
 return finals.map((slot,i)=>({...slot,request_ordinal:proof.finals[i].request_ordinal,linkage:'request_linked'}));
}

export class ObserverReportHistory{
 #maxTurns;#pair=null;#generation=null;#arms={without:freshArm(),with:freshArm()};
 constructor({maxTurns=32}={}){if(!positive(maxTurns)||maxTurns>32)throw Error('observer_history_invalid');this.#maxTurns=maxTurns;}
 observe(pair,state){
  if(!object(pair)||!object(state)){for(const arm of ARMS)invalidate(this.#arms[arm],'unavailable','source_unavailable');return this.snapshot();}
  const generation=nonnegative(state.session_generation)?state.session_generation:null;
  if(this.#pair!==pair||generation!==null&&this.#generation!==null&&generation!==this.#generation){this.#arms={without:freshArm(),with:freshArm()};this.#generation=generation;this.#pair=pair;}
  else if(generation!==null)this.#generation=generation;
  for(const arm of ARMS){const data=this.#arms[arm];
   try{
    const native=pair.arms?.[arm],current=native?.delivery?.current;
    if(!object(native)||!object(current)||typeof native.delivery.snapshot!=='function'||!identifier(current.sessionId)||!identifier(current.turnId)||!identifier(native.client?.sessionId)||!identifier(native.turnId)){invalidate(data,'unavailable','native_identity_unavailable');continue;}
    if(current.sessionId!==native.client.sessionId||current.turnId!==native.turnId){invalidate(data,'invalid','native_identity_mismatch');continue;}
    if(data.session!==null&&data.session!==current.sessionId){invalidate(data,'invalid','native_session_changed');continue;}
    const delivery=projectedDelivery(native.delivery.snapshot()),reported=projectedDelivery(state.arms?.[arm]?.delivery);
    if(!positive(current.ordinal)||delivery.turn_ordinal!==current.ordinal){invalidate(data,'invalid','turn_ordinal_invalid');continue;}
    if(data.latest!==null&&(current.ordinal<data.latest||current.ordinal===data.latest&&data.turnId!==current.turnId)){invalidate(data,'invalid','turn_identity_rewound');continue;}
    if(JSON.stringify(delivery)!==JSON.stringify(reported)){invalidate(data,'invalid','delivery_snapshot_mismatch');continue;}
    const projection=nativePublic(native);
    if(!sameMessages(state.arms?.[arm]?.messages,projection.messages)){invalidate(data,'invalid','state_projection_mismatch');continue;}
    if(data.prefixCount>projection.messages.length||projection.prefixes[data.prefixCount]!==data.prefixHash){invalidate(data,'invalid','history_prefix_changed');continue;}
    const finals=linkedFinals(arm,delivery,projection.finals),previous=data.entries.get(current.ordinal);
    if(previous&&previous.finals.some(f=>f.linkage==='native_turn_scoped')&&finals.filter(f=>f.linkage==='request_linked').length>previous.finals.filter(f=>f.linkage==='request_linked').length)data.late_attachment_updates++;
    if(data.latest===null)data.turns_unobserved=current.ordinal-1;else if(current.ordinal>data.latest)data.turns_unobserved+=current.ordinal-data.latest-1;
    data.entries.set(current.ordinal,{arm,turn_ordinal:current.ordinal,delivery:clone(delivery),finals});
    while(data.entries.size>this.#maxTurns){data.entries.delete(data.entries.keys().next().value);data.turns_evicted++;}
    data.session=current.sessionId;data.turnId=current.turnId;data.latest=current.ordinal;data.prefixCount=projection.messages.length;data.prefixHash=projection.prefixes.at(-1);data.projectionValid=true;data.source='observed';data.last_issue=null;
   }catch{invalidate(data,'invalid','source_invalid');}
  }
  return this.snapshot();
 }
 snapshot(){
  const turns=[],arms={};
  for(const arm of ARMS){const data=this.#arms[arm];for(const entry of data.entries.values())turns.push({...clone(entry),...(!data.projectionValid?{finals:[]}:{})});
   arms[arm]={source:data.source,turns_retained:data.entries.size,turns_omitted:data.turns_unobserved===null?null:data.turns_unobserved+data.turns_evicted,turns_unobserved:data.turns_unobserved,turns_evicted:data.turns_evicted,latest_observed_turn_ordinal:data.latest,invalid_observations:data.invalid_observations,late_attachment_updates:data.late_attachment_updates,last_issue:data.last_issue};
  }
  const value={turns,coverage:{status:turns.length?'partial':'unknown',scope:'observed_native_current_turns_only',provider_history:'unverified',late_evidence:'current_turn_updates_only; older late evidence remains unknown',arms}};
  const handle=Object.freeze({schema_version:1});snapshots.set(handle,value);return handle;
 }
}
export function observerHistoryView(handle){const value=snapshots.get(handle);if(!value)throw Error('observer_history_untrusted');return clone(value);}
