// Client-reported display decisions only. This projection supplies no native
// request-delivery, human-attention or causal-benefit evidence.
import {PRESENTATION_EVENT_LIMIT} from './presentation-decisions.mjs';
const ARMS=['without','with'];
const SNAPSHOT_KEYS=['schema_version','source','arm','session_generation','history_epoch','revision','events_omitted','coverage','events'];
const EVENT_KEYS=['sequence','revision','history_epoch','kind','ordinal','event','reason','at_ms','controls'];
const CONTROL_KEYS=['response_extent','unsolicited_update','conversation_style'];
const REASONS=['mandatory','defer','baseline','manual','send','fallback','disconnected','not_held'];
const MAX_AT_MS=8640000000000000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const keys=(value,allowed)=>object(value)&&Reflect.ownKeys(value).length===allowed.length&&allowed.every(key=>Object.hasOwn(value,key));
function controls(value){
 if(value===null)return null;
 if(!keys(value,CONTROL_KEYS)||!['terse','standard','full'].includes(value.response_extent)||!['send','defer'].includes(value.unsolicited_update)||!['conversational','self_contained'].includes(value.conversation_style))return undefined;
 return{response_extent:value.response_extent,unsolicited_update:value.unsolicited_update,conversation_style:value.conversation_style};
}
function snapshot(value,arm,generation){
 if(value===null)return null;
 if(!keys(value,SNAPSHOT_KEYS)||value.schema_version!==1||value.source!=='browser_current_display_policy'||value.arm!==arm||value.session_generation!==generation||!integer(value.history_epoch)||!integer(value.revision)||!integer(value.events_omitted)||!['observed','partial'].includes(value.coverage)||!Array.isArray(value.events)||value.events.length>PRESENTATION_EVENT_LIMIT)return undefined;
 const total=value.events_omitted+value.events.length;
 if(!integer(total)||total>0&&value.revision===0||(value.events_omitted>0||value.history_epoch>0)&&value.coverage!=='partial')return undefined;
 const events=[];let previous=null;
 for(let index=0;index<value.events.length;index++){
  const row=value.events[index];
  if(!keys(row,EVENT_KEYS)||row.sequence!==value.events_omitted+index+1||!integer(row.sequence)||!integer(row.revision)||row.revision<1||row.revision>value.revision||!integer(row.history_epoch)||row.history_epoch>value.history_epoch||!['message','approval','question'].includes(row.kind)||!integer(row.ordinal)||row.ordinal<1||row.ordinal>4096||!['shown','held','released'].includes(row.event)||!REASONS.includes(row.reason)||!integer(row.at_ms)||row.at_ms>MAX_AT_MS)return undefined;
  const c=controls(row.controls);if(c===undefined)return undefined;
  if(previous&&(row.revision<previous.revision||row.history_epoch<previous.history_epoch||row.at_ms<previous.at_ms))return undefined;
  if(row.reason==='mandatory'&&row.event!=='shown'||['approval','question'].includes(row.kind)&&(row.event!=='shown'||row.reason!=='mandatory'))return undefined;
  if(row.event==='held'&&(row.kind!=='message'||row.reason!=='defer'||c?.unsolicited_update!=='defer'))return undefined;
  if(row.event==='released'&&(row.kind!=='message'||!['manual','send','fallback','disconnected','not_held'].includes(row.reason)))return undefined;
  if(row.reason==='manual'&&row.event!=='released'||row.reason==='defer'&&row.event!=='held')return undefined;
  if(row.reason==='send'&&c?.unsolicited_update!=='send'||row.reason==='not_held'&&c?.unsolicited_update!=='defer')return undefined;
  if(['fallback','disconnected','baseline'].includes(row.reason)&&c!==null)return undefined;
  if(arm==='without'&&(row.event!=='shown'||!['baseline','mandatory'].includes(row.reason)||c!==null)||arm==='with'&&row.reason==='baseline')return undefined;
  const clean={sequence:row.sequence,revision:row.revision,history_epoch:row.history_epoch,kind:row.kind,ordinal:row.ordinal,event:row.event,reason:row.reason,at_ms:row.at_ms,controls:c};events.push(clean);previous=clean;
 }
 return{schema_version:1,source:'browser_current_display_policy',arm,session_generation:generation,history_epoch:value.history_epoch,revision:value.revision,events_omitted:value.events_omitted,coverage:value.coverage,events};
}

export function projectPresentationEnvelope(value,generation){
 try{
  if(!integer(generation)||generation<1||!keys(value,['schema_version','arms'])||value.schema_version!==1||!keys(value.arms,ARMS))return null;
  const without=snapshot(value.arms.without,'without',generation),withArm=snapshot(value.arms.with,'with',generation);
  if(without===undefined||withArm===undefined)return null;
  return{schema_version:1,arms:{without,with:withArm}};
 }catch{return null;}
}
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
function armAdvances(previous,next){
 if(previous===null)return true;
 if(next===null||next.revision<previous.revision||next.history_epoch<previous.history_epoch||next.events_omitted<previous.events_omitted||previous.coverage==='partial'&&next.coverage!=='partial')return false;
 if(next.revision===previous.revision)return same(previous,next);
 const oldTotal=previous.events_omitted+previous.events.length,nextTotal=next.events_omitted+next.events.length;
 if(nextTotal<oldTotal)return false;
 const overlapStart=Math.max(previous.events_omitted,next.events_omitted)+1,overlapEnd=Math.min(oldTotal,nextTotal);
 for(let sequence=overlapStart;sequence<=overlapEnd;sequence++)if(!same(previous.events[sequence-previous.events_omitted-1],next.events[sequence-next.events_omitted-1]))return false;
 const oldLast=previous.events.at(-1);
 for(const row of next.events){if(row.sequence<=oldTotal)continue;if(row.revision<=previous.revision||row.history_epoch<previous.history_epoch||oldLast&&row.at_ms<oldLast.at_ms)return false;}
 return true;
}
function generationOf(value){for(const arm of ARMS){const generation=value?.arms?.[arm]?.session_generation;if(integer(generation)&&generation>0)return generation;}return null;}
export function presentationAdvances(previous,next){
 try{
  if(previous==null&&next==null)return true;
  if(next==null)return false;
  const generation=generationOf(previous)??generationOf(next)??1;
  const current=projectPresentationEnvelope(next,generation);if(!current)return false;
  if(previous==null)return true;
  const before=projectPresentationEnvelope(previous,generation);return !!before&&ARMS.every(arm=>armAdvances(before.arms[arm],current.arms[arm]));
 }catch{return false;}
}
