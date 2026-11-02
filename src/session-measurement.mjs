// Counts acknowledged actions, never message text, raw keys or Presence state.
// Actor is an explicit local client label, not authenticated human identity.
import {HumanReview} from './human-review.mjs';
const ARMS=['without','with'],ACTORS=['participant','coordinator','unattributed'];
const freshArm=()=>({messages:0,characters:0,approval_decisions:0});
const freshActor=()=>({submissions:0,shared_submissions:0,characters:0,partial_submissions:0,partial_characters:0,unconfirmed_submissions:0,unconfirmed_characters:0,unconfirmed_approval_decisions:0,arms:{without:freshArm(),with:freshArm()}});
export function measurementActor(value){if(value===undefined)return 'unattributed';if(!ACTORS.includes(value))throw Error('measurement_actor_invalid');return value;}
export class SessionMeasurement {
 constructor({now}={}){this.review=new HumanReview(now);this.actions=Object.fromEntries(ACTORS.map(n=>[n,freshActor()]));this.decisions=new Set();this.turnActions=Object.fromEntries(ACTORS.map(a=>[a,Object.fromEntries(ARMS.map(n=>[n,{steering_accepted:0,interrupt_accepted:0,interrupt_unconfirmed:0}]))]));this.interruptions=new Set();this.questionActions=new Set();this.questionEffort=Object.fromEntries(ACTORS.map(a=>[a,Object.fromEntries(ARMS.map(n=>[n,{accepted:0,unconfirmed:0,characters:0}]))]));}
 submitted({actor,target='both',text,outcome}){
  actor=measurementActor(actor);const selected=target==='both'?ARMS:ARMS.includes(target)?[target]:null;
  if(!selected||typeof text!=='string')throw Error('measurement_submission_invalid');if(outcome?.status==='not_started')return;
  const value=this.actions[actor],complete=['started','forwarded'].includes(outcome?.status);
  // Complete, partial and wholly unconfirmed action totals are disjoint.
  // Confirmed per-arm receipts still count for a partial shared delivery.
  const confirmed=selected.filter(n=>complete||['started','steered'].includes(outcome?.arms?.[n]?.status)),length=Array.from(text).length;
  if(complete){value.submissions++;value.characters+=length;if(target==='both')value.shared_submissions++;}
  else if(confirmed.length){value.partial_submissions++;value.partial_characters+=length;}
  else {value.unconfirmed_submissions++;value.unconfirmed_characters+=length;}
  for(const n of confirmed){if(outcome?.arms?.[n]?.status==='steered')this.turnActions[actor][n].steering_accepted++;value.arms[n].messages++;value.arms[n].characters+=length;}
 }
 decided({actor,arm,approvalId,requirementId,result}){
  actor=measurementActor(actor);
  if(!ARMS.includes(arm)||typeof approvalId!=='string'||requirementId?.approvalId!==approvalId||!Number.isSafeInteger(requirementId?.sourceIndex)||requirementId.sourceIndex<0)throw Error('measurement_decision_invalid');
  // Native approval/decide must acknowledge the decision. A request succeeding
  // at HTTP transport level alone does not establish a native accepted action.
  const key=JSON.stringify([arm,approvalId,requirementId.sourceIndex]);if(this.decisions.has(key))return;
  if(result?.status!=='accepted'){this.actions[actor].unconfirmed_approval_decisions++;return;}
  if(this.decisions.size>=2048)throw Error('measurement_capacity');this.decisions.add(key);this.actions[actor].arms[arm].approval_decisions++;
 }
 interrupted({actor,target,expectedTurns,outcome}){
  actor=measurementActor(actor);const names=target==='both'?ARMS:ARMS.includes(target)?[target]:null;if(!names)throw Error('measurement_interrupt_invalid');
  for(const arm of names){const status=outcome?.arms?.[arm]?.status,key=JSON.stringify([arm,expectedTurns?.[arm]]);if(status==='interrupt_requested'&&!this.interruptions.has(key)){if(this.interruptions.size>=2048)throw Error('measurement_capacity');this.interruptions.add(key);this.turnActions[actor][arm].interrupt_accepted++;}else if(status==='unknown')this.turnActions[actor][arm].interrupt_unconfirmed++;}
 }
 questioned({actor,arm,userInputId,action,clarification,result}){
  actor=measurementActor(actor);if(!ARMS.includes(arm)||typeof userInputId!=='string'||!['answer','clarify','cancel'].includes(action))throw Error('measurement_question_invalid');
  const key=JSON.stringify([arm,userInputId]);if(this.questionActions.has(key))return;
  const value=this.questionEffort[actor][arm];if(result?.status!=='accepted'){value.unconfirmed++;return;}
  if(this.questionActions.size>=2048)throw Error('measurement_capacity');this.questionActions.add(key);value.accepted++;
  const text=typeof clarification==='string'?clarification:clarification?.content;if(action==='clarify'&&typeof text==='string')value.characters+=Array.from(text).length;
 }
 feedback(payload){const candidate=this.review.clone();candidate.apply(payload);this.review=candidate;}
 snapshot(){return {turn_actions:structuredClone(this.turnActions),question_effort:structuredClone(this.questionEffort),actions:structuredClone(this.actions),review:this.review.snapshot(),attribution:'explicit_client_label_not_verified_identity',resources:'use_existing_cumulative_arm_usage_without_adding_native_and_trace'};}
}
