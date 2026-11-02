import {createHash} from 'node:crypto';
import {presenceView} from './presence-view.mjs';

// A projection of the assigned MSP stream. This class never executes a tool,
// answers an approval, reads native history, or interprets opaque cursors.
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const identifier=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x)?x:null;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const statuses=new Set(['inProgress','completed','failed','cancelled','rejected','timedOut']);
const knownKinds=new Set(['userMessage','agentMessage','reasoning','toolCall','userShell','subagent','workflow','reminderChild','compaction','hookRun','sideChat','webSearch','monitorFeed','damagedRange','scheduledFire','backgroundTerminalCompletion','overdueNotice']);
const itemMethods=new Set(['item/started','item/updated','item/completed']);
const rawCounters=['inputTokens','outputTokens','cachedTokens','reasoningTokens','cacheReadTokens','cacheWriteTokens'];
const cumulativeCounters=['promptTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens'];
const canonical=value=>JSON.stringify(value,(_key,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fingerprint=value=>createHash('sha256').update(canonical(value)).digest('hex');
const clone=value=>structuredClone(value);
function counters(value,keys,required=[]){
 if(!object(value)||required.some(key=>!Object.hasOwn(value,key)))throw Error('muse_public_invalid_usage');
 const result={};
 for(const key of keys){
  const v=value[key];
  if(v===undefined)continue;
  if(!Number.isSafeInteger(v)||v<0)throw Error('muse_public_invalid_usage');
  result[key]=v;
 }
 return result;
}
function provenance(value){
 if(!object(value)||!object(value.stream)||!object(value.first)||!object(value.last))throw Error('muse_public_invalid_provenance');
 const stream={kind:identifier(value.stream.kind),id:identifier(value.stream.id)};
 const position=p=>({id:identifier(p.id),sequence:p.sequence});
 const first=position(value.first),last=position(value.last);
 if(!stream.kind||!stream.id||!first.id||!last.id||!Number.isSafeInteger(first.sequence)||first.sequence<0||!Number.isSafeInteger(last.sequence)||last.sequence<first.sequence)throw Error('muse_public_invalid_provenance');
 return {stream,first,last};
}

export class MusePublicEvents{
 #arm;#sessionId;#mode;#turnId=null;#runId=null;#terminal=false;#failed=false;#seq=0;
 #events=[];#items=new Map();#usage=new Map();#completed=new Map();#cumulative=null;#turnStart=1;
 constructor({arm,sessionId,evidenceMode='live'}={}){
  if(!['with','without'].includes(arm)||!uuid(sessionId)||!['live','replay','fixture','unknown'].includes(evidenceMode))throw TypeError('muse_public_invalid_scope');
  this.#arm=arm;this.#sessionId=sessionId;this.#mode=evidenceMode;
 }
 bindTurn(turnId,{runId=null}={}){
  if(this.#failed)throw Error('muse_public_evidence_failed');
  if(!uuid(turnId)||runId!==null&&!uuid(runId)||this.#turnId!==null&&!this.#terminal&&this.#turnId!==turnId)throw Error('muse_public_invalid_turn_binding');
  // The controller supplies runId only after reconciling native evidence.
  // MSP turn identity alone never establishes a native run identity.
  if(this.#turnId===turnId){
   if(runId!==null&&this.#runId!==null&&this.#runId!==runId)throw Error('muse_public_invalid_run_binding');
   if(runId!==null&&this.#runId===null){this.#runId=runId;return [this.#emit('binding',{turn_ref:turnId,run_ref:runId,from_sequence:this.#turnStart,through_sequence:this.#seq})];}
   return [];
  }
  if(this.#completed.has(turnId))throw Error('muse_public_invalid_turn_binding');
  this.#turnId=turnId;this.#runId=runId;this.#terminal=false;this.#turnStart=this.#seq+1;return [];
 }
 #emit(type,payload,source=null){
  if(this.#events.length>=512){this.#failed=true;throw Error('muse_public_event_limit');}
  const publicType={message:'public_message',tool:'task_status',hook:'task_status',usage:'task_status',binding:'task_status',presence:'presence_projection',turn_completed:'completion',evidence_error:'unknown',unknown:'unknown'}[type];
  const publicPayload=type==='evidence_error'?{kind:'coverage_failure',...payload}:
   ['tool','hook','usage'].includes(type)?{kind:type,...payload}:type==='binding'?{kind:'run_binding',...payload}:type==='unknown'?{kind:'native_item',...payload}:payload;
  const sequence=++this.#seq;
  const event={schema_version:1,event_id:`muse_${this.#arm}_${this.#sessionId}_${sequence}`,arm:this.#arm,session_ref:this.#sessionId,run_ref:this.#runId,sequence,at:new Date().toISOString(),type:publicType,evidence_mode:this.#mode,payload:publicPayload,
   provenance:{source_event_id:source?'source_'+fingerprint(source):null,artifact_id:null,verification_status:this.#runId===null?'native_session_turn_scoped':'native_run_scoped'}};
  this.#events.push(event);return clone(event);
 }
 #fail(reason){
  this.#failed=true;
  if(this.#events.length<512)this.#emit('evidence_error',{reason});
  throw Error(reason);
 }
 #scope(params,turnId=params?.turnId){
  if(!object(params)||params.sessionId!==this.#sessionId||!this.#turnId||turnId!==this.#turnId)throw Error('muse_public_scope_mismatch');
 }
 accept(method,params){
  if(this.#failed)throw Error('muse_public_evidence_failed');
  if(method==='view/gap'){
   if(!object(params)||params.sessionId!==this.#sessionId)throw Error('muse_public_scope_mismatch');
   return this.#fail('muse_public_source_gap');
  }
  // Deltas may include private tool output; only authoritative committed agent
  // text is published, so no delta is forwarded or accumulated here.
  if(method==='item/delta')return [];
  if(itemMethods.has(method))return this.#item(method,params);
  if(method==='session/tokenUsage')return this.#modelUsage(params);
  if(method==='turn/completed')return this.#completion(params);
  return [];
 }
 #item(method,params){
  const item=params?.item;
  if(!object(item))throw Error('muse_public_invalid_item');
  this.#scope(params,item.turnId);
  if(item.kind==='reasoning')return [];
  const id=identifier(item.itemId),revision=item.revision;
  if(!id||!Number.isSafeInteger(revision)||revision<1||typeof item.kind!=='string'||typeof item.status!=='string')throw Error('muse_public_invalid_item');
  const digest=fingerprint(item),prior=this.#items.get(id);
  if(prior){
   if(revision<prior.revision)return [];
   if(revision===prior.revision){if(digest!==prior.digest)return this.#fail('muse_public_item_conflict');return [];}
   if(prior.kind!==item.kind||prior.turnId!==item.turnId)return this.#fail('muse_public_item_conflict');
  }else if(this.#items.size>=256)return this.#fail('muse_public_item_limit');
  const source=params.sourceRange===undefined?null:provenance(params.sourceRange);
  if(method!=='item/started'&&!source)throw Error('muse_public_invalid_provenance');
  if(item.kind==='agentMessage'&&method==='item/completed'&&item.status==='completed'&&typeof item.text!=='string')throw Error('muse_public_invalid_message');
  this.#items.set(id,{revision,digest,kind:item.kind,turnId:item.turnId});
  const metadata={item_id:id,revision,status:statuses.has(item.status)?item.status:'unknown'};
  if(!knownKinds.has(item.kind)||!statuses.has(item.status)){
   return [this.#emit('unknown',{...metadata,native_kind:identifier(item.kind),native_status:identifier(item.status)},source)];
  }
  if(item.kind==='agentMessage'){
   if(method!=='item/completed'||item.status!=='completed')return [];
   return [this.#emit('message',{...metadata,text:item.text.slice(0,65536),message_phase:['commentary','finalAnswer'].includes(item.messagePhase)?item.messagePhase:'finalAnswer',truncated:item.truncated===true||item.text.length>65536,cut_off:item.cutOff===true},source)];
  }
  if(item.kind==='toolCall')return [this.#emit('tool',{...metadata,tool:identifier(item.tool),call_id:identifier(item.callId)},source)];
  if(item.kind==='hookRun')return [this.#emit('hook',{...metadata,event:identifier(item.event)},source)];
  // Other known kinds remain visible as metadata; their arbitrary content,
  // child objectives and generic fallback text are not public artifacts.
  return [this.#emit('unknown',{...metadata,native_kind:identifier(item.kind),native_status:identifier(item.status)},source)];
 }
 #modelUsage(params){
  this.#scope(params);
  const source=provenance(params.sourceRange);
  const usage=counters(params.usage,rawCounters,['inputTokens','outputTokens','cachedTokens','reasoningTokens']);
  const cumulative=counters(params.cumulative,cumulativeCounters,['promptTokens','outputTokens','totalTokens']);
  const counted=counters(params,['promptTokens','totalTokens'],['promptTokens','totalTokens']);
  const payload={model_id:identifier(params.modelId),per_completion:{...counted,raw:usage},session_cumulative:cumulative};
  if(params.durationMs!==undefined)Object.assign(payload,counters(params,['durationMs']));
  const key=canonical(source),digest=fingerprint(payload),prior=this.#usage.get(key);
  if(prior){if(prior!==digest)return this.#fail('muse_public_usage_conflict');return [];}
  if(this.#usage.size>=256)return this.#fail('muse_public_usage_limit');
  if(this.#cumulative&&['promptTokens','outputTokens','totalTokens'].some(k=>cumulative[k]<this.#cumulative[k]))return this.#fail('muse_public_usage_regression');
  this.#usage.set(key,digest);this.#cumulative=cumulative;
  return [this.#emit('usage',payload,source)];
 }
 #completion(params){
  this.#scope(params);
  const source=provenance(params.sourceRange);
  const terminal=['completed','failed','cancelled'].includes(params.terminal)?params.terminal:'unknown';
  const payload={terminal};
  // Aggregate turn usage is a reconciliation fact, separate from model-call
  // usage events. Consumers must never sum these two levels together.
  if(params.usage!==undefined)payload.turn_aggregate_usage=counters(params.usage,rawCounters,['inputTokens','outputTokens','cachedTokens','reasoningTokens']);
  if(params.durationMs!==undefined)Object.assign(payload,counters(params,['durationMs']));
  if(params.timeToFirstTokenMs!==undefined)Object.assign(payload,counters(params,['timeToFirstTokenMs']));
  const digest=fingerprint({payload,source}),prior=this.#completed.get(this.#turnId);
  if(prior){if(prior!==digest)return this.#fail('muse_public_completion_conflict');return [];}
  if(this.#completed.size>=64)return this.#fail('muse_public_turn_limit');
  this.#completed.set(this.#turnId,digest);this.#terminal=true;
  return [this.#emit('turn_completed',payload,source)];
 }
 snapshot(){return clone(this.#events);}
 currentTurnUsage(){
  const current=this.#events.filter(e=>e.sequence>=this.#turnStart),calls=current.filter(e=>e.type==='task_status'&&e.payload.kind==='usage');
  const totals={};for(const field of rawCounters){const values=calls.map(e=>e.payload.per_completion.raw[field]);totals[field]=values.length&&values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0):null;}
  return {model_completions:calls.length,raw:totals,turn_aggregate:current.findLast(e=>e.type==='completion')?.payload.turn_aggregate_usage??null};
 }
 recordPresence(presence){
  if(this.#failed||!this.#runId)throw Error('muse_public_invalid_run_binding');
  return this.#emit('presence',presenceView({arm:this.#arm,evidenceMode:this.#mode,presence}));
 }
 // Metadata-only guidance-to-response correlation. The scoped payload carries
 // no raw request/response/session identifiers and no private path: only the
 // linkage status, generation ordinal, eligibility, and fallback reason.
 // MSP schema says public agentMessage.itemId is the committed message_id;
 // matching itemId to a linked message_id does not prove adaptation and
 // requires live qualification.
 recordResponseProvenance(scoped){
  if(this.#failed||!this.#runId)throw Error('muse_public_invalid_run_binding');
  const link=scoped&&typeof scoped==='object'?scoped:{};
  const status=['linked','unverified','unknown'].includes(link.linkage_status)?link.linkage_status:'unknown';
  const payload={kind:'response_correlation',linkage_status:status,
   generation_ordinal:Number.isSafeInteger(link.generation_ordinal)?link.generation_ordinal:null,
   eligible:link.eligible===true?true:link.eligible===false?false:null,
   fallback_reason:typeof link.fallback_reason==='string'&&/^[a-z_]{1,64}$/.test(link.fallback_reason)?link.fallback_reason:null,
   guidance_digest_present:link.guidance_digest_present===true?true:link.guidance_digest_present===false?false:null,
   context_delivery:'unknown',provider_outcome:'unknown',
   adaptation_claim:'ids_match_only',qualification:'requires_live_qualification'};
  return this.#emit('presence',payload);
 }
}

// Safe scoped representation for UI/telemetry: strips raw identifiers.
export function scopedResponseProvenance(link){
 if(!link||typeof link!=='object')return {linkage_status:'unknown',reason:'missing_linkage',generation_ordinal:null,eligible:null,fallback_reason:null,guidance_digest_present:null,context_delivery:'unknown',provider_outcome:'unknown',adaptation_claim:'ids_match_only',qualification:'requires_live_qualification'};
 return {
  linkage_status:['linked','unverified','unknown'].includes(link.linkage_status)?link.linkage_status:'unknown',
  reason:typeof link.reason==='string'?link.reason:(link.linkage_status==='linked'?null:'unspecified'),
  generation_ordinal:Number.isSafeInteger(link.generation_ordinal)?link.generation_ordinal:null,
  eligible:link.eligible===true?true:link.eligible===false?false:null,
  fallback_reason:typeof link.fallback_reason==='string'?link.fallback_reason:null,
  guidance_digest_present:link.guidance_sha256_present===true?true:link.guidance_sha256_present===false?false:null,
  context_delivery:'unknown',provider_outcome:'unknown',
  adaptation_claim:'ids_match_only',qualification:'requires_live_qualification'};
}
// MSP identity: public agentMessage.itemId is the committed message_id.
// Returns true only on exact identifier equality; never proves adaptation.
export function publicItemMatchesCommitted(publicItemId,committedMessageId){
 const valid=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
 if(!valid(publicItemId)||!valid(committedMessageId))return false;
 return publicItemId===committedMessageId;
}
