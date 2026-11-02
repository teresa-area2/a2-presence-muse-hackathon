import {projectRecordedEvidence} from './observer-recorded-evidence.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {buildComparisonPacket,comparisonPacketView,comparisonContext,validateStructuredComparisonReport} from './observer-report.mjs';
import {ObserverReportHistory} from './observer-report-history.mjs';
import {captureObserverWork} from './observer-work-context.mjs';
import {projectObserverUsage,projectMechanismLedger} from '../web/session-evidence.mjs';
import {projectEvidence} from './evidence-projection.mjs';
const ARMS=['without','with'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hasRun=s=>ARMS.some(a=>(s.arms?.[a]?.messages??[]).length>0||s.arms?.[a]?.delivery?.turn_ordinal>0||s.arms?.[a]?.usage?.model_calls>0);
const quiescent=s=>['ready','closed'].includes(s?.status)&&ARMS.every(a=>['ready','closed','failed'].includes(s.arms?.[a]?.status)&&!(s.arms[a].approvals??[]).length&&!(s.arms[a].questions??[]).length&&!s.arms[a].active_turn_id);
function progressDelivery(value){if(!value||typeof value!=='object')return value;const {trace_ended,...evidence}=value;return evidence;}
function experienceScope(state){
 const safe=projectEvidence(state),measurement=safe.measurement,review=measurement?.review;
 const present=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 // An open review clock keeps ticking without a new action. Freeze its duration
 // in the packet; action receipts, completed segments and ratings bind scope.
 const arms=Object.fromEntries(ARMS.map(arm=>{const value=review?.arms?.[arm]??{};if(review?.active_arm!==arm)return[arm,value];const {review_window_seconds,...stable}=value;return[arm,stable];})),views=Array.isArray(state.browser_mechanisms)?state.browser_mechanisms:[];
 return{measurement:measurement?{...measurement,review:{...review,arms}}:null,measurement_available:{actions:present(state.measurement?.actions),turn_actions:present(state.measurement?.turn_actions),question_effort:present(state.measurement?.question_effort)},arms:Object.fromEntries(ARMS.map(arm=>[arm,{elapsed:safe.arms[arm].elapsed,includes_approval_wait:typeof state.arms?.[arm]?.elapsed?.includes_approval_wait==='boolean'?state.arms[arm].elapsed.includes_approval_wait:null,interactions:safe.arms[arm].interactions,review_available:present(state.measurement?.review?.arms?.[arm]),native_questions_available:present(state.arms?.[arm]?.interactions)}])),view_source_count:views.length,views:views.slice(0,16).map(value=>projectMechanismLedger(value,state.session_generation)).filter(Boolean)};
}
function progressScope(state){return digest({generation:state.session_generation,comparison:state.comparison,experience:experienceScope(state),arms:Object.fromEntries(ARMS.map(a=>{const v=state.arms?.[a]??{},check=state.code_checks?.arms?.[a]?.latest;return[a,{status:['ready','closed'].includes(v.status)?'settled':v.status,terminal:v.last_turn_terminal,model:v.model,messages:v.messages,delivery:progressDelivery(v.delivery),usage:v.usage,public_output:v.public_output,check:check?{id:check.id,summary:check.summary}:null}];}))});}
function scope(state){return digest({progress:progressScope(state),readings:state.textbox?.readings,reading_id:state.textbox?.reading_id,controls:state.textbox?.controls,checks:state.code_checks});}
const safeDiagnostics=value=>({terminal:['completed','failed','cancelled'].includes(value?.terminal)?value.terminal:null,http_status:Number.isInteger(value?.http_status)&&value.http_status>=400&&value.http_status<=599?value.http_status:null,schema_error:value?.schema_error===true,step_limit:value?.step_limit===true});
const workScope=work=>digest(Object.fromEntries(ARMS.map(a=>[a,{hash:work[a]?.artifact_sha256??null,status:work[a]?.status??'unavailable'}])));
export class ComparisonReportService{
 constructor({review=null,capture=captureObserverWork,onChange=()=>{},now=Date.now,readState=null}={}){if(review!==null&&typeof review!=='function'||typeof capture!=='function')throw Error('comparison_service_invalid');Object.assign(this,{review,capture,onChange,now,readState});this.contexts=new WeakMap();this.jobs=new Set();this.closed=false;}
 fresh(ctx,state){return this.readState?this.readState(ctx):{...state,...ctx.pair.snapshot()};}
 data(ctx){if(!ctx)return null;let x=this.contexts.get(ctx);if(!x){x={preview:null,job:null,reports:[],epoch:0,history:new ObserverReportHistory()};this.contexts.set(ctx,x);}return x;}
 observe(ctx,state){if(!this.review||!ctx||ctx.finalized===true)return;this.data(ctx).history.observe(ctx.pair,state);}
 assert(ctx,state){if(this.closed||!this.review)throw Error('comparison_report_unavailable');if(!ctx||ctx.finalized===true||ctx.generation!==state?.session_generation)throw Error('comparison_session_changed');if(!hasRun(state))throw Error('comparison_run_not_started');if(state?.code_checks?.running||!quiescent(state))throw Error('comparison_wait_for_tasks');}
 rememberChecks(ctx){if(!ctx)return;const checks=ctx.pair.codeChecks?.snapshot?.();this.data(ctx).closingChecks=Object.fromEntries(ARMS.map(arm=>{const check=checks?.arms?.[arm]?.latest,raw=check?.summary;return[arm,check?.current===true&&raw?{state:raw.state,artifact_sha256:raw.artifact_sha256,public_tests:structuredClone(raw.public_tests),frozen_tests:structuredClone(raw.frozen_tests)}:null];}));}
 async retainFinalWork(ctx){if(!ctx||!this.review)return;const work=await this.capture(ctx.pair);for(const arm of ARMS){const prior=this.contexts.get(ctx)?.closingChecks?.[arm];if(!work[arm].checks&&prior?.artifact_sha256===work[arm].artifact_sha256)work[arm].checks=prior;work[arm]={...work[arm],captured_at:new Date(this.now()).toISOString(),retained_final_snapshot:true};}this.data(ctx).finalWork=work;}
 async captureWork(ctx){const retained=this.contexts.get(ctx)?.finalWork;if(ctx.pair.snapshot().status==='closed'&&retained)return structuredClone(retained);return this.capture(ctx.pair);}
 async prepare(ctx,state,{task=null}={}){
  this.assert(ctx,state);this.observe(ctx,state);const data=this.data(ctx);if(data.job)throw Error('comparison_report_busy');const epoch=data.epoch,source=scope(state),work=await this.captureWork(ctx);
  const latest=this.fresh(ctx,state);this.assert(ctx,latest);if(epoch!==data.epoch||scope(latest)!==source)throw Error('comparison_snapshot_changed');
  const packet=buildComparisonPacket(state,{work,history:data.history.snapshot(),task,now:this.now()}),view=comparisonPacketView(packet),id=randomUUID();data.preview={id,packet,source,work:workScope(work),generation:ctx.generation,at:new Date(this.now()).toISOString(),used:false};
  return{id,...view,at:data.preview.at};
 }
 async generate(ctx,state,previewId){
  this.assert(ctx,state);const data=this.data(ctx),p=data.preview;if(data.job)throw Error('comparison_report_busy');if(!p||p.id!==previewId||p.used||this.now()-Date.parse(p.at)>300000||p.generation!==ctx.generation||p.source!==scope(state))throw Error('comparison_preview_changed');
  const work=await this.captureWork(ctx);if(data.job)throw Error('comparison_report_busy');this.assert(ctx,this.fresh(ctx,state));if(p!==data.preview||p.used||p.source!==scope(this.fresh(ctx,state))||p.work!==workScope(work))throw Error('comparison_preview_changed');
  p.used=true;const packetView=comparisonPacketView(p.packet),inputPacket={fingerprint:packetView.fingerprint,bytes:packetView.bytes,captured_at:packetView.payload.captured_at};const controller=new AbortController(),job={controller,promise:null},record={id:randomUUID(),at:p.at,fingerprint:packetView.fingerprint,input_packet:inputPacket,recorded_facts:{source:'comparison_input_receipts',evidence:packetView.payload.evidence.map(projectRecordedEvidence).filter(Boolean)},status:'running',stale:false,report:null,usage:null,source:p.source,progress:progressScope(state),work:p.work,coverage:comparisonPacketView(p.packet).coverage,input_relation:comparisonPacketView(p.packet).payload.comparison.observed_input_relation,evidence:comparisonPacketView(p.packet).payload.evidence};data.job=job;this.jobs.add(job);data.reports.push(record);data.reports=data.reports.slice(-3);
  job.promise=(async()=>{
   try{const result=await this.review(p.packet,{signal:controller.signal});record.usage=projectObserverUsage(result?.usage);if(controller.signal.aborted)throw Error('comparison_cancelled');if(this.closed||ctx.finalized===true||ctx.generation!==p.generation)throw Error('comparison_session_changed');const report=validateStructuredComparisonReport(result?.report??result,p.packet,{grounding:'snapshot_context'});const currentWork=await this.captureWork(ctx);if(controller.signal.aborted)throw Error('comparison_cancelled');if(this.closed||ctx.finalized===true||ctx.generation!==p.generation)throw Error('comparison_session_changed');record.report=report;record.snapshot_context=comparisonContext(p.packet);record.stale=record.progress!==progressScope(this.fresh(ctx,state))||record.work!==workScope(currentWork);record.status='completed';}
   catch(error){record.usage=projectObserverUsage(error?.usage??record.usage);record.diagnostics=safeDiagnostics(error?.diagnostics);record.status=controller.signal.aborted?'cancelled':'failed';record.report=null;record.evidence=[];}
   finally{if(data.job===job)data.job=null;this.jobs.delete(job);this.onChange();}
  })();job.promise.catch(()=>{});this.onChange();return record.id;
 }
 view(ctx,state){const data=this.contexts.get(ctx);return{enabled:!!this.review,model:'muse-spark-1.3',preview_id:data?.preview?.id??null,preview_current:!!data?.preview&&!data.preview.used&&this.now()-Date.parse(data.preview.at)<=300000&&(!state||data.preview.source===scope(state)),status:data?.job?'running':data?.reports.at(-1)?.status??'idle',reports:(data?.reports??[]).map(r=>({id:r.id,at:r.at,fingerprint:r.fingerprint,input_packet:r.input_packet?structuredClone(r.input_packet):null,recorded_facts:r.recorded_facts?structuredClone(r.recorded_facts):null,input_relation:r.input_relation,coverage:r.coverage?structuredClone(r.coverage):null,status:r.status,stale:r.stale||!!state&&r.progress!==progressScope(state),report:r.report?structuredClone(r.report):null,snapshot_context:r.report&&r.snapshot_context?structuredClone(r.snapshot_context):null,evidence:r.report?structuredClone(r.evidence):[],usage:r.usage?structuredClone(r.usage):null,diagnostics:r.diagnostics??null}))};}
 cancel(ctx){const data=this.contexts.get(ctx);if(data)data.epoch++;this.contexts.get(ctx)?.job?.controller.abort();const p=this.contexts.get(ctx)?.preview;if(p)p.used=true;}
 async wait(ctx){await this.contexts.get(ctx)?.job?.promise;}
 async close(){this.closed=true;for(const job of this.jobs)job.controller.abort();await Promise.allSettled([...this.jobs].map(j=>j.promise));}
}
