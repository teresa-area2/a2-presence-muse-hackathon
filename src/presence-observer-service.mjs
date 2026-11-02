import{createHash,randomUUID}from'node:crypto';
import{buildObserverEvidence,validateObserverSelection,observerExperience}from'./presence-observer.mjs';
import{projectObserverReports,projectObserverUsage,registerObserverReport}from'../web/session-evidence.mjs';
const ordinal = arm => Number.isSafeInteger(arm?.delivery?.turn_ordinal) && arm.delivery.turn_ordinal>0 ? arm.delivery.turn_ordinal : null;
function scopeStillCurrent(ctx,base){
 if(ctx.generation!==base.session_generation)return false;
 if(!ctx.pair)return true;
 const latest=ctx.pair.snapshot();
 return ['ready','closed'].includes(latest.status) && ['without','with'].every(arm=>ordinal(latest.arms?.[arm])===base.evidence_scope[arm+'_turn'] && ['ready','closed','failed'].includes(latest.arms?.[arm]?.status) && (latest.arms?.[arm]?.approvals??[]).length===0);
}
export class PresenceObserverService{
 constructor({explain=null,onFinish=async()=>{},now=Date.now}={}){if(explain!==null&&typeof explain!=='function')throw Error('observer_service_invalid');Object.assign(this,{explain,onFinish,now});this.jobs=new Set();this.closed=false;}
 view(ctx){const reports=projectObserverReports(ctx?.observerReports,ctx?.generation);return{enabled:!!this.explain,status:ctx?.observerJob?'running':reports.at(-1)?.status??'idle',reports,reports_omitted:ctx?.observerReportsOmitted??0,totals:ctx?.observerTotals?structuredClone(ctx.observerTotals):null};}
 start(ctx,state,metrics,{ledger_id=null,revision=null}={}){
  if(this.closed||!this.explain)throw Error('observer_unavailable');if(!ctx)throw Error('observer_session_missing');if(ctx.observerJob)throw Error('observer_busy');
  ctx.observerReports??=[];
  if(!['ready','closed'].includes(state.status)||!['without','with'].every(arm=>['ready','closed','failed'].includes(state.arms?.[arm]?.status)&&(state.arms[arm].approvals??[]).length===0))throw Error('observer_wait_for_turn');
  const evidence=buildObserverEvidence({...state,session_generation:ctx.generation},{metrics,now:this.now()}),controller=new AbortController();
  const turn=arm=>ordinal(state.arms?.[arm]);
  const base={id:randomUUID(),session_generation:ctx.generation,at:new Date(this.now()).toISOString(),input_fingerprint:createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),evidence_scope:{with_turn:turn('with'),without_turn:turn('without'),mechanism_ledger_id:ledger_id,mechanism_revision:revision}};
  const job={controller,promise:null};ctx.observerJob=job;this.jobs.add(job);
  job.promise=(async()=>{
   let report,observedUsage=null;
   try{const result=await this.explain(evidence,{signal:controller.signal});observedUsage=projectObserverUsage(result?.usage);if(controller.signal.aborted)throw Error('observer_cancelled');if(!scopeStillCurrent(ctx,base))throw Error('observer_evidence_changed');const selection=validateObserverSelection({fact_ids:result?.fact_ids},evidence);report={...base,status:'completed',...selection,experience:observerExperience(evidence),usage:observedUsage};}
   catch(error){report={...base,status:controller.signal.aborted?'cancelled':'failed',fact_ids:[],sentences:[],usage:projectObserverUsage(error?.usage??observedUsage)};}
   const totals=ctx.observerTotals??{reports:0,completed:0,failed:0,cancelled:0,usage:{scope:'presence_observer',status:'observed',model_calls:0,input_tokens:0,output_tokens:0,cache_read_tokens:0,elapsed_ms:0,cost_usd:null}};
   totals.reports++;totals[report.status]++;for(const key of ['model_calls','input_tokens','output_tokens','cache_read_tokens','elapsed_ms']){const value=totals.usage[key],next=report.usage[key];totals.usage[key]=value===null||next===null||!Number.isSafeInteger(value+next)?null:value+next;}
   if(report.usage.status!=='observed'||totals.usage.status!=='observed')totals.usage.status='not_reported';ctx.observerTotals=totals;
   ctx.observerReports.push(registerObserverReport(report));if(ctx.observerReports.length>8){ctx.observerReports.shift();ctx.observerReportsOmitted=(ctx.observerReportsOmitted??0)+1;}if(ctx.observerJob===job)ctx.observerJob=null;
   try{await this.onFinish(ctx);}finally{this.jobs.delete(job);}
  })();job.promise.catch(()=>{});
  return base.id;
 }
 cancel(ctx){ctx?.observerJob?.controller.abort();}
 async wait(ctx){await ctx?.observerJob?.promise;}
 async close(){this.closed=true;for(const job of this.jobs)job.controller.abort();await Promise.allSettled([...this.jobs].map(job=>job.promise));}
}
