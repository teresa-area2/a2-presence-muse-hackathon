// Private, serialized, atomic checkpoints. Only the closed-schema projection
// enters the queue; native snapshots/text are never written or retained here.
import fs from 'node:fs/promises';import {constants} from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {EventEmitter} from 'node:events';
import {projectEvidence} from './evidence-projection.mjs';
import {projectWindowEvents,projectMechanismLedger,projectObserverReports,projectObserverTotals} from '../web/session-evidence.mjs';
const MAX_BYTES=2*1024*1024,MAX_HISTORY=200;
const safeId=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const canonicalTime=now=>{const n=now();if(!Number.isFinite(n))throw Error('evidence_clock_invalid');return new Date(n).toISOString();};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function privateDirectory(directory){
 if(!path.isAbsolute(directory))throw Error('evidence_directory_invalid');
 await fs.mkdir(directory,{recursive:true,mode:0o700});const resolved=await fs.realpath(directory),st=await fs.lstat(directory);
 if(st.isSymbolicLink()||!st.isDirectory()||(st.mode&0o077)||(process.getuid&&st.uid!==process.getuid()))throw Error('evidence_directory_unsafe');
 return {directory:resolved,dev:st.dev,ino:st.ino};
}
async function checkDirectory(owner){const st=await fs.lstat(owner.directory);if(st.isSymbolicLink()||!st.isDirectory()||st.dev!==owner.dev||st.ino!==owner.ino||(st.mode&0o077)||(process.getuid&&st.uid!==process.getuid())||await fs.realpath(owner.directory)!==owner.directory)throw Error('evidence_directory_unsafe');}
async function atomicWrite(owner,id,body){
 await checkDirectory(owner);const target=path.join(owner.directory,id+'.json'),temp=path.join(owner.directory,'.'+id+'.'+randomUUID()+'.tmp');
 const previous=await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(previous&&(!previous.isFile()||previous.isSymbolicLink()||(previous.mode&0o077)||(process.getuid&&previous.uid!==process.getuid())))throw Error('evidence_file_unsafe');
 let handle;
 try{handle=await fs.open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(body);await handle.sync();await handle.close();handle=null;await checkDirectory(owner);await fs.rename(temp,target);const dir=await fs.open(owner.directory,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}}
 finally{await handle?.close().catch(()=>{});await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export async function createEvidenceStore({directory,metadata={},debounceMs=200,now=()=>Date.now(),write=atomicWrite}={}){
 if(!Number.isSafeInteger(debounceMs)||debounceMs<0||debounceMs>5000||typeof now!=='function'||typeof write!=='function')throw Error('evidence_configuration_invalid');
 return new EvidenceStore({owner:await privateDirectory(directory),metadata,debounceMs,now,write});
}
class EvidenceStore extends EventEmitter{
 constructor({owner,metadata,debounceMs,now,write}){super();Object.assign(this,{owner,metadata:projectEvidence({},metadata).metadata,debounceMs,now,write});this.runs=new Map();this.closed=false;}
 begin(generation,metadata={}){
  if(this.closed||!Number.isSafeInteger(generation)||generation<1||this.runs.size>=64)throw Error('evidence_run_invalid');
  const id=randomUUID(),at=canonicalTime(this.now);this.runs.set(id,{id,generation,metadata:projectEvidence({},{...this.metadata,...metadata}).metadata,created:at,revision:0,savedRevision:0,lastSaved:null,status:'not_started',document:null,saved:null,pending:null,writing:null,timer:null,policy:[],delivery:[],requests:new Map(),requestCutoffs:new Map(),requestsOmitted:0,policyOmitted:0,deliveryOmitted:0,lastPolicy:undefined,lastDelivery:{}});return id;
 }
 capture(id,state){
  const run=this.runs.get(id);if(this.closed||!run)throw Error('evidence_run_invalid');
  const safe=projectEvidence(state,run.metadata),at=canonicalTime(this.now);
  const policy={available:safe.presence.available,eligible:safe.presence.eligible,controls:safe.presence.controls,capture:safe.presence.capture};
  if(!same(policy,run.lastPolicy)){run.lastPolicy=structuredClone(policy);run.policy.push({at,...policy});if(run.policy.length>MAX_HISTORY){run.policy.shift();run.policyOmitted++;}}
  for(const arm of ['without','with']){
   const {request_attribution:rows,...summary}=safe.arms[arm].delivery,turn=summary.turn_ordinal;
   // Store each request once, updating its evidence as hooks arrive. Repeating
   // every turn's full table in delivery_history would multiply report size.
   if(Number.isSafeInteger(turn)&&turn>0)for(const row of rows){
    const cutoff=run.requestCutoffs.get(arm);if(cutoff&&(turn<cutoff.turn||turn===cutoff.turn&&row.ordinal<=cutoff.ordinal))continue;
    const key=arm+':'+turn+':'+row.ordinal,facts={arm,turn_ordinal:turn,...row},previous=run.requests.get(key);
    if(previous){const {first_observed_at,updated_at,...priorFacts}=previous;if(same(facts,priorFacts))continue;}
    run.requests.set(key,{...facts,first_observed_at:previous?.first_observed_at??at,updated_at:at});
    if(run.requests.size>MAX_HISTORY){const oldest=run.requests.keys().next().value,removed=run.requests.get(oldest),prior=run.requestCutoffs.get(removed.arm);run.requests.delete(oldest);run.requestsOmitted++;if(!prior||removed.turn_ordinal>prior.turn||removed.turn_ordinal===prior.turn&&removed.ordinal>prior.ordinal)run.requestCutoffs.set(removed.arm,{turn:removed.turn_ordinal,ordinal:removed.ordinal});}
   }
   const delivery={...summary,attribution_counts:{guidance:rows.filter(x=>x.status==='guidance_observed').length,fallback:rows.filter(x=>x.status==='fallback_observed').length,unverified:rows.filter(x=>!['guidance_observed','fallback_observed'].includes(x.status)).length}};
   if(!same(delivery,run.lastDelivery[arm])){run.lastDelivery[arm]=structuredClone(delivery);run.delivery.push({at,arm,...delivery});if(run.delivery.length>MAX_HISTORY){run.delivery.shift();run.deliveryOmitted++;}}
  }
  const ledgers=(Array.isArray(state.browser_capture_logs)?state.browser_capture_logs:[]).slice(0,16).map(x=>projectWindowEvents(x,run.generation)).filter(x=>x&&x.rejected_events===0);
  const browserCaptureLogs={provenance:'client_reported_unverified',persistence:'local_checkpoint',ledgers};
  safe.browser_mechanisms={provenance:'client_reported_presentation',scope:'separate_browser_projections_not_additive',ledgers:(Array.isArray(state.browser_mechanisms)?state.browser_mechanisms:[]).slice(0,16).map(x=>projectMechanismLedger(x,run.generation)).filter(Boolean)};
  safe.observer_reports=projectObserverReports(state.observer_reports,run.generation);
  safe.observer_totals=projectObserverTotals(state.observer_totals);safe.observer_reports_omitted=Number.isSafeInteger(state.observer_reports_omitted)&&state.observer_reports_omitted>=0?state.observer_reports_omitted:0;
  const doc={schema_version:1,evidence_kind:'checkpoint',run_id:id,session_generation:run.generation,revision:++run.revision,created_at:run.created,recorded_at:at,...safe,browser_capture_logs:browserCaptureLogs,policy_history:structuredClone(run.policy),delivery_history:structuredClone(run.delivery),request_history:structuredClone([...run.requests.values()]),history_omitted:{policy:run.policyOmitted,delivery:run.deliveryOmitted,requests:run.requestsOmitted},limitations:[...safe.limitations,'only_checkpoints_durable_unflushed_crash_tail_unknown','browser_replay_is_not_restored_from_report','policy_history_is_source_metadata_not_proof_of_rendering_or_behavior','request_history_timestamps_are_checkpoint_observations_not_provider_execution','browser_capture_logs_are_client_reported_not_verified_model_or_service_outcomes','browser_capture_logs_may_omit_unacknowledged_tab_or_crash_tail']};
  const body=JSON.stringify(doc)+'\n';if(Buffer.byteLength(body)>MAX_BYTES){run.status='unavailable';this.changed();throw Error('evidence_capacity');}
  run.document=doc;run.pending={body,document:doc};run.status='saving';if(!run.timer&&!run.writing){run.timer=setTimeout(()=>{run.timer=null;void this.drain(run);},this.debounceMs);run.timer.unref?.();}this.changed();return run.revision;
 }
 changed(){try{this.emit('change');}catch{/* Persistence UI cannot change agent authority. */}}
 async drain(run){
  if(run.writing)return run.writing;
  if(run.timer){clearTimeout(run.timer);run.timer=null;}
  run.writing=(async()=>{while(run.pending){const next=run.pending;run.pending=null;try{await this.write(this.owner,run.id,next.body);run.saved=next.document;run.savedRevision=next.document.revision;run.lastSaved=canonicalTime(this.now);run.status=run.pending?'saving':'saved';}catch{run.status='unavailable';this.changed();return false;}this.changed();}return true;})();
  try{return await run.writing;}finally{run.writing=null;if(run.pending&&!this.closed&&run.status!=='unavailable'&&!run.timer){run.timer=setTimeout(()=>{run.timer=null;void this.drain(run);},this.debounceMs);run.timer.unref?.();}}
 }
 async flush(id){const run=this.runs.get(id);if(!run)throw Error('evidence_run_invalid');if(run.timer){clearTimeout(run.timer);run.timer=null;}await this.drain(run);if(run.pending)await this.drain(run);if(run.status!=='saved'||run.savedRevision!==run.revision)throw Error('evidence_save_failed');return this.status(id);}
 status(id){const r=this.runs.get(id);return r?{status:r.status,run_id:r.id,last_saved_at:r.lastSaved,revision:r.revision,error:r.status==='unavailable'?'evidence_save_failed':null}:{status:'not_started',run_id:null,last_saved_at:null,revision:null,error:null};}
 async export(id){if(!safeId(id))throw Error('evidence_run_invalid');await this.flush(id);const r=this.runs.get(id);return structuredClone(r.saved);}
 async close(){this.closed=true;for(const r of this.runs.values())if(r.timer){clearTimeout(r.timer);r.timer=null;}const results=await Promise.allSettled([...this.runs.keys()].filter(id=>this.runs.get(id).revision>0).map(id=>this.flush(id)));this.closed=true;if(results.some(x=>x.status==='rejected'))throw Error('evidence_save_failed');}
}
