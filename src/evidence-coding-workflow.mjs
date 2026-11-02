// Bounded orchestration only: callbacks own model dispatch, CI and permissions.
// A scripted/offline callback never becomes real-model evidence.
import {buildCIFeedback} from './coding-ci-report.mjs';
const ARMS=['without','with'],HEX=/^[a-f0-9]{64}$/;
const copy=x=>structuredClone(x);
export const EVIDENCE_WORKFLOW_POLICY=Object.freeze({version:1,
 stages:Object.freeze(['implementation','independent_check','own_failed_arm_feedback','one_repair','independent_recheck']),
 max_repair_turns_per_arm:1,repair_targets:'failed_arms_only',first_pass:'no_repair_or_repeated_check',
 checks:'same_public_and_frozen_plan',feedback:'own_artifact_counts_cases_and_hashes_only',
 answer_quality:'separate_review_required',human_benefit:'not_measured'});

function checkedReports(value,arms,planHash){
 const out={};
 for(const arm of arms){
  const r=value?.[arm];
  if(!r||typeof r.id!=='string'||!r.id||r.current!==true||!['passed','failed'].includes(r.status)||r.summary?.state!==r.status||!HEX.test(r.summary.artifact_sha256??'')||r.summary.trusted_plan_hash!==planHash)throw Error('evidence_check_unqualified');
  // Reuse the established strict result/count validator, without sending text.
  try{buildCIFeedback(r.summary);}catch{throw Error('evidence_check_unqualified');}
  out[arm]=copy(r);
 }
 return out;
}

export async function executeEvidenceCodingWorkflow({implement,check,prepareFeedback,repair,awaitRepair,recheck,validateFinal,checkpoint=async()=>{},expectedPlanHash}={}){
 if(!HEX.test(expectedPlanHash??'')||[implement,check,prepareFeedback,repair,awaitRepair,recheck,validateFinal,checkpoint].some(x=>typeof x!=='function'))throw Error('evidence_workflow_invalid');
 const state={schema_version:1,policy:EVIDENCE_WORKFLOW_POLICY,status:'running',stage:'implementation',
  repair_arms:[],repair_attempts:{without:0,with:0},repair_dispatch:{without:'not_started',with:'not_started'},initial_checks:null,feedback:null,rechecks:null,final_checks:null,
  code_quality:'unverified',answer_quality:'unreviewed',human_benefit:'not_measured'};
 const save=async()=>checkpoint(copy(state));
 try{
  await save();await implement();state.stage='independent_check';await save();
  state.initial_checks=copy(await check(ARMS));state.initial_checks=checkedReports(state.initial_checks,ARMS,expectedPlanHash);await save();
  const failed=ARMS.filter(arm=>state.initial_checks[arm].status==='failed');state.repair_arms=failed;
  if(failed.length){
   state.stage='own_failed_arm_feedback';await save();
   const prepared=await prepareFeedback(failed,copy(state.initial_checks));
   if(!prepared||!prepared.metadata||Object.keys(prepared.metadata).sort().join(',')!==failed.slice().sort().join(','))throw Error('evidence_feedback_unqualified');
   state.feedback=copy(prepared.metadata);
   for(const arm of failed){
    const f=state.feedback[arm],r=state.initial_checks[arm];
    if(f.check_id!==r.id||f.artifact_sha256!==r.summary.artifact_sha256||f.trusted_plan_hash!==expectedPlanHash||!HEX.test(f.prompt_sha256??''))throw Error('evidence_feedback_unqualified');
   }
   state.stage='repair';
   // No await/checkpoint between obtaining the short-lived CI lease and the
   // dispatch callback: it must commit/revalidate the lease before its first await.
   const receipt=await repair(prepared,failed);
   for(const arm of failed){state.repair_dispatch[arm]=['started','not_started'].includes(receipt?.arms?.[arm]?.status)?receipt.arms[arm].status:'unknown';if(state.repair_dispatch[arm]==='started')state.repair_attempts[arm]=1;}
   if(receipt?.status!=='started'||failed.some(a=>receipt.arms?.[a]?.status!=='started'))throw Error('evidence_repair_dispatch_unconfirmed');
   await save();await awaitRepair(failed);
   state.stage='independent_recheck';await save();
   state.rechecks=copy(await recheck(failed));state.rechecks=checkedReports(state.rechecks,failed,expectedPlanHash);
  }
  state.final_checks={...state.initial_checks,...state.rechecks};state.stage='final_artifact_binding';await save();
  if(await validateFinal(copy(state.final_checks))!==true)throw Error('evidence_final_artifact_unqualified');
  state.code_quality=ARMS.every(a=>state.final_checks[a].status==='passed')?'passed':'failed';
  state.status=state.code_quality==='passed'?'passed':'failed';state.stage='finished';await save();
  return copy(state);
 }catch(e){
  state.status='incomplete';state.reason=/^[a-z_]{1,100}$/.test(e?.message??'')?e.message:'evidence_workflow_failed';
  // Retain the actual check/feedback/attempt facts even when repair is interrupted.
  try{await save();}catch{}
  const error=Error(state.reason);error.workflow=copy(state);throw error;
 }
}
