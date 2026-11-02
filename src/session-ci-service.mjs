// Owned per-pair CI: checking code never submits to Muse or changes native permissions.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {collectArtifactFilesWithBytes,hashArtifactFiles} from './artifact-source.mjs';
import {runProjectVerification} from './verification-runner.mjs';
import {summarizeCI,buildCIFeedback} from './coding-ci-report.mjs';
import {verificationCapability} from './linux-verification-sandbox.mjs';

const ARMS=['without','with'],HEX=/^[a-f0-9]{64}$/,LIMIT=8;
const error=code=>{throw Error(code);};
const clone=value=>structuredClone(value);
function selection(target){if(target==='both')return ARMS.slice();if(ARMS.includes(target))return[target];return error('ci_target_invalid');}
function counts(value){if(!value||typeof value!=='object')return null;const out={};for(const k of['tests','pass','fail','skipped','cancelled','todo']){if(!Number.isSafeInteger(value[k])||value[k]<0||value[k]>4096)return null;out[k]=value[k];}return out;}
function unavailable(reason){return{schema_version:1,state:'unavailable',exit_code:null,public_tests:null,frozen_tests:null,cases:[],reason};}

export class SessionCIService{
 constructor({pair,plan,workspaces,node=process.execPath,onChange=()=>{},verify=runProjectVerification,collect=collectArtifactFilesWithBytes,hash=hashArtifactFiles,summarize=summarizeCI,formatFeedback=buildCIFeedback,now=Date.now,monotonicNow=()=>performance.now()}={}){
  if(!pair||typeof pair.snapshot!=='function'||typeof pair.on!=='function'||!plan||!HEX.test(plan.expectedPlanHash??'')||!Array.isArray(plan.ownTests)||!plan.ownTests.length||!plan.trustedFiles||!ARMS.every(a=>path.isAbsolute(workspaces?.[a]??''))||!path.isAbsolute(node)||![onChange,verify,collect,hash,summarize,formatFeedback,now,monotonicNow].every(f=>typeof f==='function'))error('ci_service_invalid');
  const trustedFiles={};for(const[k,v]of Object.entries(plan.trustedFiles)){const b=Buffer.from(v);if(!b.length||b.length>128000)error('ci_service_invalid');trustedFiles[k]=b;}
  const names=Object.values(trustedFiles).flatMap(b=>[...b.toString().matchAll(/\btest\(\s*(['"])(.*?)\1\s*,/g)].map(m=>m[2]));
  if(!names.length||names.length>64||new Set(names).size!==names.length||names.some(n=>!n||n.length>512||/[\x00-\x1f\x7f]/.test(n)))error('ci_trusted_cases_invalid');
  Object.assign(this,{pair,node,onChange,verify,collect,hash,summarize,formatFeedback,now,monotonicNow});this.plan={ownTests:[...plan.ownTests],trustedFiles,expectedPlanHash:plan.expectedPlanHash};this.workspaces={...workspaces};this.trustedNames=Object.freeze(names);this.capability=verificationCapability();this.closed=false;this.jobs=new Map();this.records=new Map();this.latest={without:null,with:null};this.history={without:[],with:[]};this.omitted={without:0,with:0};this.epochs={without:0,with:0};this.observed={};
  for(const a of ARMS)this.observed[a]=this.binding(a).key;
  this.listener=()=>this.observe(true);pair.on('status',this.listener);
 }
 binding(arm){
  const s=this.pair.snapshot(),v=s.arms?.[arm],native=this.pair.arms?.[arm],model=v?.model?.requested_model??native?.requestedModel??null;
  const ready=!this.closed&&s.status==='ready'&&v?.status==='ready'&&(v.approvals??[]).length===0&&(v.questions??[]).length===0&&v.active_turn_id==null&&v.interrupt_pending!==true&&(!native?.ready||native.ready());
  const ordinal=Number.isSafeInteger(v?.delivery?.turn_ordinal)?v.delivery.turn_ordinal:null;
  const key=JSON.stringify([ready,s.status,v?.status??null,v?.active_turn_id??null,native?.client?.sessionId??null,native?.turnId??null,native?.workGroup??null,ordinal,v?.last_turn_terminal??null,v?.elapsed?.completed_turns??null,v?.elapsed?.incomplete_turns??null,v?.model??model,(v?.approvals??[]).length,(v?.questions??[]).length,native?.events?.length??null]);
  return{key,ready,ordinal,model:typeof model==='string'&&/^[a-z0-9._-]{1,80}$/.test(model)?model:null};
 }
 observe(notify=false){let changed=false;for(const arm of ARMS){const b=this.binding(arm);if(b.key!==this.observed[arm]){this.observed[arm]=b.key;this.epochs[arm]++;for(const id of this.history[arm]){const r=this.records.get(id);if(r?.current){r.current=false;r.stale_reason='session_changed';changed=true;}}}}if(changed&&notify)this.notify();}
 notify(){try{this.onChange(this.snapshot());}catch{}}
 assertReady(arms){this.observe();if(this.closed)error('ci_closed');for(const arm of arms)if(!this.binding(arm).ready)error('ci_wait_for_ready');}
 async artifact(arm){const captured=await this.collect(this.workspaces[arm],'project');try{const digest=this.hash(captured.files);if(!HEX.test(digest))error('ci_snapshot_invalid');return digest;}finally{captured.bytes?.clear();}}
 safeSummary(value,artifact){
  if(!value||!['passed','failed'].includes(value.state))return unavailable('ci_verification_unavailable');
  const p=counts(value.public_tests),f=counts(value.frozen_tests),cases=Array.isArray(value.cases)?value.cases:[];
  if(!p||!f||![0,1].includes(value.exit_code)||value.artifact_sha256!==artifact||value.trusted_plan_hash!==this.plan.expectedPlanHash||cases.length!==this.trustedNames.length||new Set(cases.map(x=>x?.name)).size!==cases.length||cases.some(c=>!this.trustedNames.includes(c?.name)||!['passed','failed'].includes(c.result))||[p,f].some(c=>!c.tests||c.skipped||c.cancelled||c.todo||c.tests!==c.pass+c.fail)||f.tests!==cases.length||f.fail!==cases.filter(c=>c.result==='failed').length||(value.state==='passed')!==(p.fail+f.fail===0)||(value.exit_code===0)!==(value.state==='passed'))return unavailable('ci_result_invalid');
  return{schema_version:1,state:value.state,exit_code:value.exit_code,public_tests:p,frozen_tests:f,cases:cases.map(c=>({name:c.name,result:c.result})),artifact_sha256:artifact,trusted_plan_hash:this.plan.expectedPlanHash};
 }
 check(target='both'){
  if(this.capability==='unsupported_platform'&&this.verify===runProjectVerification)error('ci_platform_unsupported');
  const selected=selection(target);this.assertReady(selected);if(selected.some(a=>this.jobs.has(a)))error('ci_busy');const started=this.monotonicNow();if(!Number.isFinite(started)||started<0)error('ci_clock_invalid');const ids={};
  for(const arm of selected){for(const oldId of this.history[arm]){const previous=this.records.get(oldId);if(previous)previous.current=false;}const binding=this.binding(arm),id=randomUUID(),record={id,arm,state:'checking',current:true,consumed:false,epoch:this.epochs[arm],binding:binding.key,turn_ordinal:binding.ordinal,model:binding.model,at:new Date(this.now()).toISOString(),started_mono:started,elapsed_ms:null,summary:null,artifact:null};
   this.records.set(id,record);this.latest[arm]=id;this.history[arm].push(id);while(this.history[arm].length>LIMIT){this.records.delete(this.history[arm].shift());this.omitted[arm]++;}ids[arm]=id;
   const job=Promise.resolve().then(()=>this.perform(record)).finally(()=>{if(this.jobs.get(arm)===job)this.jobs.delete(arm);this.notify();});this.jobs.set(arm,job);job.catch(()=>{});
  }
  this.notify();return{status:'started',checks:ids};
 }
 async perform(record){
  const {arm}=record;
  try{
   record.artifact=await this.artifact(arm);this.observe();if(!this.current(record))return;
   const result=await this.verify({workspace:this.workspaces[arm],node:this.node,artifactHash:record.artifact,ownTests:[...this.plan.ownTests],trustedFiles:Object.fromEntries(Object.entries(this.plan.trustedFiles).map(([k,v])=>[k,Buffer.from(v)])),expectedPlanHash:this.plan.expectedPlanHash,ownTestDiscovery:'node-default',deadlineMs:20000});
   record.summary=this.safeSummary(this.summarize(result,this.trustedNames),record.artifact);record.state=record.summary.state;
   const after=await this.artifact(arm);this.observe();if(after!==record.artifact){record.current=false;record.stale_reason='artifact_changed';}this.current(record);
  }catch{record.summary=unavailable('ci_verification_unavailable');record.state='unavailable';this.observe();this.current(record);}
  finally{let end;try{end=this.monotonicNow();}catch{}record.elapsed_ms=Number.isFinite(end)&&end>=record.started_mono?Math.round(end-record.started_mono):null;if(record.state==='checking')record.state='stale';}
 }
 current(record){const valid=!this.closed&&record.current&&record.epoch===this.epochs[record.arm]&&record.binding===this.binding(record.arm).key&&this.binding(record.arm).ready&&this.latest[record.arm]===record.id;if(!valid){record.current=false;record.stale_reason??='session_changed';}return valid;}
 invalidate(target='both'){for(const arm of selection(target)){this.epochs[arm]++;for(const id of this.history[arm]){const r=this.records.get(id);if(r)r.current=false;}}this.notify();}
 snapshot(){
  this.observe();const project=r=>({id:r.id,arm:r.arm,status:r.current?r.state:'stale',current:r.current&&!this.closed,consumed:r.consumed,turn_ordinal:r.turn_ordinal,model:r.model,at:r.at,elapsed_ms:r.elapsed_ms,summary:r.summary?clone(r.summary):null,feedback_available:!this.closed&&r.current&&!r.consumed&&['passed','failed'].includes(r.state)&&!this.jobs.has(r.arm)});
  return{enabled:true,capability:this.capability,closed:this.closed,running:this.jobs.size,arms:Object.fromEntries(ARMS.map(arm=>{const r=this.records.get(this.latest[arm]);return[arm,{status:r?(r.current?r.state:'stale'):'idle',running:this.jobs.has(arm),latest:r?project(r):null,reports:this.history[arm].map(id=>this.records.get(id)).filter(Boolean).map(project),reports_omitted:this.omitted[arm]}];}))};
 }
 async feedback(target,checkIds){
  if(this.capability==='unsupported_platform'&&this.verify===runProjectVerification)error('ci_platform_unsupported');
  const selected=selection(target);this.assertReady(selected);if(!checkIds||typeof checkIds!=='object'||Array.isArray(checkIds)||Object.keys(checkIds).sort().join(',')!==selected.slice().sort().join(','))error('ci_feedback_invalid');
  const records=selected.map(a=>{const r=this.records.get(checkIds[a]);if(!r||r.arm!==a||r.consumed||this.jobs.has(a)||!['passed','failed'].includes(r.state)||!this.current(r))error('ci_feedback_stale');return r;});
  for(const r of records){if(await this.artifact(r.arm)!==r.artifact){r.current=false;r.stale_reason='artifact_changed';this.notify();error('ci_feedback_stale');}this.observe();if(records.some(x=>!this.current(x)||x.consumed))error('ci_feedback_stale');}
  const prompts={};for(const r of records){const text=this.formatFeedback(clone(r.summary));if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>8192)error('ci_feedback_invalid');prompts[r.arm]=text;}
  let usable=true;const expiry=setImmediate(()=>{usable=false;});expiry.unref?.();
  const commit=()=>{this.assertReady(selected);if(!usable||records.some(r=>r.consumed||!this.current(r)))error('ci_feedback_stale');usable=false;clearImmediate(expiry);for(const r of records)r.consumed=true;this.notify();return{target,prompts:{...prompts},expectedTurns:Object.fromEntries(selected.map(a=>[a,null]))};};
  return{target,prompt:selected.length===1?prompts[selected[0]]:null,prompts:{...prompts},expectedTurns:Object.fromEntries(selected.map(a=>[a,null])),commit};
 }
 async wait(){await Promise.allSettled([...this.jobs.values()]);}
 close(){if(this.closed)return;this.closed=true;this.pair.off?.('status',this.listener);for(const arm of ARMS){this.epochs[arm]++;for(const id of this.history[arm]){const r=this.records.get(id);if(r)r.current=false;}}this.notify();}
}
