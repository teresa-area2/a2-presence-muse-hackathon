// Closed, text-free projections of facts already recorded in a comparison packet.
// These are source receipts, not verified identity, causal impact or model findings.
const arms=['without','with'],actors=['participant','coordinator','unattributed'];
const actorFields=['messages','characters','approval_decisions','steering_accepted','interrupt_accepted','interrupt_unconfirmed','question_replies_accepted','question_replies_unconfirmed','question_reply_characters'];
const questions=['questions_presented','questions_answered','questions_clarified','questions_cancelled','questions_timed_out','questions_aborted','questions_interrupted','questions_settled_unknown','questions_closed_locally','pending_questions'];
const metricFields=['held_current','held_total','released_manual','released_automatic','history_resets'];
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x))&&Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>Object.hasOwn(d,'value'));
const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const bool=x=>typeof x==='boolean'?x:null;
const pickCounts=(obj,keys)=>Object.fromEntries(keys.map(k=>[k,count(record(obj)?obj[k]:null)]));
const validEnum=(x,values)=>values.includes(x)?x:null;
const seconds=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=Number.MAX_SAFE_INTEGER?x:null;
const covered=x=>validEnum(x,['observed','partial']);
function presentationArm(x){if(!record(x))return null;return{coverage:covered(x.coverage),history_epoch:count(x.history_epoch),events_omitted:count(x.events_omitted),retained_event_count:count(x.retained_event_count),first_event_at_ms:count(x.first_event_at_ms),last_event_at_ms:count(x.last_event_at_ms),events:pickCounts(x.events,['shown','held','released']),released_by_reason:pickCounts(x.released_by_reason,['manual','send','fallback','disconnected','not_held'])};}
export function projectRecordedEvidence(e){
 if(!record(e))return null;
 if(e.kind==='interaction'){
  if(!arms.includes(e.arm)||e.id!==`interactions.${e.arm}`)return null;
  const available=record(e.available)?e.available:{},qs=record(e.native_questions)?e.native_questions:null,review=record(e.self_report)?e.self_report:null;
  return{id:e.id,kind:e.kind,arm:e.arm,scope:e.scope==='per_arm_receipts_not_additive_and_self_reports'?e.scope:null,available:Object.fromEntries(['actions','turn_actions','question_effort','review','native_questions'].map(k=>[k,bool(available[k])])),actors:Object.fromEntries(actors.map(a=>[a,pickCounts(record(e.actors)?e.actors[a]:null,actorFields)])),native_questions:qs?{enabled:bool(qs.enabled),...pickCounts(qs,questions)}:null,completed_turns:count(e.completed_turns),incomplete_turns:count(e.incomplete_turns),elapsed_includes_approval_wait:bool(e.elapsed_includes_approval_wait),review_window_seconds:seconds(e.review_window_seconds),completed_review_segments:count(e.completed_review_segments),self_report:review?{effort_rating:Number.isInteger(review.effort_rating)&&review.effort_rating>=1&&review.effort_rating<=5?review.effort_rating:null,interruption_count:count(review.interruption_count),effort_scale:review.effort_scale==='1_low_5_high'?review.effort_scale:null}:null};
 }
 if(e.kind==='message'){
  if(!arms.includes(e.arm)||typeof e.id!=='string'||!new RegExp(`^message\\.${e.arm}\\.[1-9]\\d{0,5}$`).test(e.id))return null;
  return{id:e.id,kind:e.kind,arm:e.arm,index:count(e.index),author:validEnum(e.author,['You','Muse']),phase:validEnum(e.phase,['sent','shared','individual','steered','question_reply','attempted','unconfirmed','not_sent','not_started','commentary','finalAnswer','question']),target:validEnum(e.target,['both','without','with','unknown']),delivery:validEnum(e.delivery,['submitted','accepted_steering','question_reply','attempted','unconfirmed','not_sent','assistant_public']),truncated:bool(e.truncated),cut_off:bool(e.cut_off)};
 }
 if(e.kind==='presentation'){
  if(typeof e.id!=='string'||!/^presentation\.view\.(?:[1-9]|1[0-6])$/.test(e.id))return null;
  const metrics=record(e.metrics)?e.metrics:null,byArm=record(e.arms)?e.arms:{};
  return{id:e.id,kind:e.kind,arm:null,scope:e.scope==='client_reported_view_only_not_additive'?e.scope:null,metrics:metrics?{schema_version:metrics.schema_version===1?1:null,coverage:covered(metrics.coverage),...pickCounts(metrics,metricFields)}:null,arms:Object.fromEntries(arms.map(a=>[a,presentationArm(byArm[a])]))};
 }
 return null;
}
