// Read-only normalization of verified Muse root-session public events.
import {isDeepStrictEqual} from 'node:util';
const assignedUuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x);
const tokenId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function omittedLiveOnly(record){
 if(!exactKeys(record,['schema_version','stream','position','retained_marker','omitted_record'])||record.schema_version!==1||record.retained_marker!=='omitted_live_only')return false;
 const {stream,position,omitted_record:o}=record;
 return exactKeys(stream,['kind','id'])&&stream.kind==='session'&&assignedUuid(stream.id)&&
  exactKeys(position,['id','sequence'])&&assignedUuid(position.id)&&Number.isSafeInteger(position.sequence)&&position.sequence>=0&&
  exactKeys(o,['record_type','durability','payload_type','payload_schema_version','payload_kind','omission_class'])&&
  o.record_type==='status'&&o.durability==='ephemeral'&&o.payload_type==='runtime.session'&&o.payload_schema_version===1&&o.payload_kind==='task'&&o.omission_class==='task_tool_delta_v1';
}
const boundEvents=new Set(['user_prompt_display','model_response_created','model_completed','assistant_message_committed','assistant_tool_calls_committed','tool_result_batch_committed','terminal','hook_run_started','hook_run_terminal','context_block_updated','model_input_trace_recorded']);
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
const iso=x=>typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const stamp=x=>number(x)!==null&&Number.isSafeInteger(x)&&x>0?new Date(Math.floor(x/1000)).toISOString():null;
const presenceName='mcp__area2_presence__get_presence_guidance';
function presenceResult(result,at){
 let p=null,reason=null,age=null;
 try{if(typeof result.text!=='string'||result.text.length>150000)throw Error();p=JSON.parse(result.text);}catch{reason='decode_error';}
 if(!reason){
  const c=p?.consumer,received=iso(p?.received_at),read=iso(c?.read_at);age=read&&received?(Date.parse(read)-Date.parse(received))/1000:null;
  if(p?.environment!=='production'||p?.mode!=='live')reason='not_production_live';
  else if(p?.renderer!=='coding-instructions.3'||p?.profile!=='coding')reason='unsupported_contract';
  else if(p?.eligible!==true||p?.retained!==false||p?.conformance_only!==false||c?.adaptation_eligible!==true||c?.fallback_reason!=null)reason=/^[a-z_]{1,64}$/.test(c?.fallback_reason??'')?c.fallback_reason:'source_ineligible';
  else if(age===null||age<0)reason='invalid_or_future_receipt';
  else if(!['terse','standard','full'].includes(p?.controls?.response_extent)||!['send','defer'].includes(p?.controls?.unsolicited_update)||!['self_contained','conversational'].includes(p?.controls?.conversation_style))reason='invalid_controls';
 }
 return {event:'MCPRead',eligible:reason===null,fallback_reason:reason,read_at:iso(p?.consumer?.read_at)??at,received_at:iso(p?.received_at),age_seconds:age,max_age_seconds:number(p?.consumer?.max_age_seconds),renderer:p?.renderer==='coding-instructions.3'?p.renderer:null,controls:reason?null:{response_extent:p.controls.response_extent,unsolicited_update:p.controls.unsolicited_update,conversation_style:p.controls.conversation_style}};
}
export function normalizeMuseSession(input,options={}){
 const {workspace,sessionId,runId}=options;
 if(typeof workspace!=='string'||typeof sessionId!=='string'||!sessionId)throw TypeError('workspace and sessionId required');
 const owned=Object.hasOwn(options,'runId');
 const rejected=()=>({records:[],presenceReads:[],committedMessages:[],createdResponseIds:[],limitations:['Assigned Muse session/run identity could not be verified.'],user_turns_known:false,scope_error:'owned_session_mismatch'});
 if(owned&&(!assignedUuid(sessionId)||!assignedUuid(runId)))return rejected();
 let foreign=false;
 const flat=[];function flatten(items,depth=0){if(depth>32){foreign=true;return;}for(const r of items??[]){if(!r||typeof r!=='object')continue;if(Array.isArray(r.children))flatten(r.children,depth+1);if(r.stream?.kind==='session'){if(r.stream.id===sessionId)flat.push(r);else foreign=true;}}}
 flatten(input);const seen=new Set(),source=[];
 const identities=new Map(),sequences=new Map();
 for(const r of flat){
  const retained=owned&&Object.hasOwn(r,'retained_marker');
  if(retained&&!omittedLiveOnly(r))return rejected();
  const identity=retained?r.position:r;
  if(owned&&(typeof identity.id!=='string'||!Number.isSafeInteger(identity.sequence)||identity.sequence<0))return rejected();
  if(owned&&r.payload_type==='runtime.session'&&boundEvents.has(r.payload?.event?.kind)&&!assignedUuid(r.payload?.run_id))return rejected();
  if(owned&&((identities.has(identity.id)&&!isDeepStrictEqual(identities.get(identity.id),r))||(sequences.has(identity.sequence)&&sequences.get(identity.sequence)!==identity.id)))return rejected();
  identities.set(identity.id,r);sequences.set(identity.sequence,identity.id);
  if(retained||typeof r.id!=='string'||seen.has(r.id))continue;seen.add(r.id);source.push(r);
 }
 source.sort((a,b)=>(a.sequence??a.recorded_at)-(b.sequence??b.recorded_at));
 const metadata=source.filter(r=>r.payload_type==='runtime.session.metadata').map(r=>r.payload?.record?.workspace_root).filter(x=>typeof x==='string');
 if(owned&&(foreign||!metadata.length||metadata.length!==source.filter(r=>r.payload_type==='runtime.session.metadata').length||metadata.some(x=>x!==workspace)||!source.some(r=>r.payload_type==='runtime.session'&&r.payload?.run_id===runId)))return rejected();
 if(metadata.some(x=>x!==workspace))return {records:[],presenceReads:[],committedMessages:[],createdResponseIds:[],limitations:['Muse workspace metadata did not match the requested workspace.'],user_turns_known:false};
 const generations=new Set();
 const committedMessages=[],createdResponses=new Set(),messageToResponse=new Map(),responseToMessages=new Map();
 const records=[],presenceReads=[],accepted=new Map(),materialized=new Set(),display=[],calls=new Map(),finishedCalls=new Set();let response=null;
 const id=(kind,key)=>`muse:${sessionId}:${kind}:${key}`;
 const push=(type,key,at,message)=>{if(at)records.push({type,uuid:id(type,key),cwd:workspace,timestamp:at,message});};
 for(const r of source){
  const p=r.payload??{},e=p.event??{},at=stamp(r.recorded_at);if(!at)continue;
  // Old runs in this exact root session are intentionally excluded. Unbound
  // intent records cannot establish per-run turns; use bound display events.
  if(owned&&(r.payload_type!=='runtime.session'||p.run_id!==runId))continue;
  if(!owned&&r.payload_type==='runtime.user_intent.accepted'&&p.source_session_id===sessionId&&p.surface==='main'&&p.semantic_kind?.kind==='chat'&&typeof p.intent_id==='string')accepted.set(p.intent_id,at);
  if(!owned&&r.payload_type==='runtime.user_intent.materialized'&&p.source_session_id===sessionId&&p.outcome?.kind==='top_level_turn_started'&&typeof p.intent_id==='string')materialized.add(p.intent_id);
  if(e.kind==='user_prompt_display')display.push({id:r.id,at});
  if(e.kind==='model_response_created'&&typeof e.response_id==='string')response=e.response_id;
  if(e.kind==='model_completed'){
   generations.add(response??r.id);
   const u=e.usage??{},usage={};
   for(const [from,to] of [['input_tokens','input_tokens'],['output_tokens','output_tokens'],['cache_read_tokens','cache_read_input_tokens'],['cache_write_tokens','cache_creation_input_tokens']])if(number(u[from])!==null)usage[to]=u[from];
   if(Object.keys(usage).length)push('assistant','usage:'+String(response??r.id),at,{id:id('usage',response??r.id),content:[],usage});
  }
  if(e.kind==='assistant_message_committed'&&typeof e.text==='string'){push('assistant','text:'+String(e.message_id??r.id),at,{id:id('text',e.message_id??r.id),content:[{type:'text',text:e.text}]});
   // Metadata-only generation linkage: MSP schema says public agentMessage
   // itemId is this committed message_id. The coordinator observed in owned
   // 1.4.13 sessions that committed records carry response_id matching
   // model_response_created. These observations require live qualification;
   // fixtures alone prove nothing about hook exposure or applied guidance.
   if(tokenId(e.message_id)){const rid=tokenId(e.response_id)?e.response_id:null;const prior=messageToResponse.get(e.message_id);if(prior!==undefined&&prior!==rid)return rejected();messageToResponse.set(e.message_id,rid);if(rid){if(!responseToMessages.has(rid))responseToMessages.set(rid,[]);if(!responseToMessages.get(rid).includes(e.message_id))responseToMessages.get(rid).push(e.message_id);}committedMessages.push({message_id:e.message_id,response_id:rid,run_id:owned?p.run_id:null});}}
  if(typeof e.response_id==='string'&&e.kind==='model_response_created'&&tokenId(e.response_id))createdResponses.add(e.response_id);
  if(e.kind==='assistant_tool_calls_committed'){
   const content=[];for(const call of e.tool_calls??[]){const key=call.call_id??call.id;if(typeof key!=='string'||calls.has(key))continue;calls.set(key,{name:call.name,at});content.push({type:'tool_use',id:id('tool',key)});}
   if(content.length)push('assistant','tools:'+r.id,at,{id:id('tools',r.id),content});
  }
  if(e.kind==='tool_result_batch_committed')for(const result of e.results??[]){
   const key=result.tool_call_id;if(calls.get(key)?.name!==presenceName||finishedCalls.has(key))continue;finishedCalls.add(key);presenceReads.push(presenceResult(result,at));
  }
  if(e.kind==='terminal'&&e.terminal==='completed')push('assistant','completion:'+r.id,at,{id:id('completion',r.id),content:[],stop_reason:'end_turn'});
 }
 const actual=[...materialized].filter(key=>accepted.has(key));
 if(actual.length)for(const key of actual)push('user',key,accepted.get(key),{content:'[verified user turn]'});
 else for(const item of display)push('user',item.id,item.at,{content:'[verified user turn]'});
 const pending=[...calls].filter(([key,value])=>value.name===presenceName&&!finishedCalls.has(key)).length;
 const user_turns_known=actual.length>0||display.length>0;
 const limitations=['Muse token values are per-response provider counters, not visible text tokens.'];
 if(!user_turns_known)limitations.push('No verified user-turn input events; user turns and response latency are unknown.');
 if(pending)limitations.push(`${pending} Presence call(s) have no committed result; they are not counted as completed reads.`);
 const model_generations=generations.size;
 return {records,presenceReads,limitations,user_turns_known,model_generations,committedMessages,createdResponseIds:[...createdResponses]};
}
