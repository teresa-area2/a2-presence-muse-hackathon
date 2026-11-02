// Metadata-only observation of owned MSP tool events. Never executes a tool or
// interprets a successful lifecycle status as verified execution/code quality.
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const ref=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const methods=new Set(['item/started','item/updated','item/completed']);
const statuses=new Set(['inProgress','completed','failed','cancelled','rejected','timedOut']);
const tools=new Set(['bash','read_file','write_file','edit_file','apply_patch','read_skill','list_files','request_user_input','exec_command']);
const kinds=new Set(['execution_error','environment_failure','permission_denied','sandbox_unavailable','file_not_found','tool_not_found','invalid_arguments','timeout','cancelled']);
const patterns=[
 ['managed_sandbox_unavailable',/managed shell sandbox is unavailable/i],
 ['path_not_found',/\bENOENT\b|no such file or directory/i],
 ['permission_denied',/\bEACCES\b|\bEPERM\b|permission denied|operation not permitted/i],
 ['tool_unavailable',/unknown tool|unsupported tool|tool not found|command not found/i],
 ['invalid_arguments',/invalid (?:tool )?(?:arguments|parameters)|validation_error/i],
 ['timeout',/timed out|deadline exceeded/i],
];
function digest(value){
 if(value===undefined||value===null)return null;
 try{const text=typeof value==='string'?value:JSON.stringify(value);return typeof text==='string'&&Buffer.byteLength(text)<=262144?hash(text):null;}catch{return null;}
}
export class EvidenceToolOutcomes {
 constructor({arm,scope,limit=128}={}){
  if(!['without','with'].includes(arm)||typeof scope!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>128)throw Error('evidence_tools_configuration_invalid');
  this.arm=arm;this.scope=scope;this.limit=limit;this.rows=new Map();this.pending=new Map();this.omitted=new Set();this.omittedOverflow=false;this.invalid=0;this.foreign=0;this.duplicates=0;
 }
 reconcile(){
  const s=this.scope();if(!ref(s?.sessionId)||!(s.turnIds instanceof Set))return;
  const session=hash(s.sessionId),turns=new Set([...s.turnIds].filter(ref).map(hash));
  for(const [key,p]of this.pending){
   if(p.session!==session){this.pending.delete(key);this.foreign++;}
   else if(turns.has(p.row.turn_sha256)){this.pending.delete(key);this.rows.set(key,{...p.row,ordinal:this.rows.size+1});}
  }
 }
 observe(event){
  if(!methods.has(event?.method)||event.params?.item?.kind!=='toolCall')return;
  this.reconcile();
  const p=event.params,item=p.item,s=this.scope();
  if(!ref(s?.sessionId)||p.sessionId!==s.sessionId||!(s.turnIds instanceof Set)){this.foreign++;return;}
  if(!ref(item.itemId)||!ref(item.turnId)||!Number.isSafeInteger(item.revision)||item.revision<1){this.invalid++;return;}
  const admitted=s.turnIds.has(item.turnId),key=hash(p.sessionId+'\0'+item.turnId+'\0'+item.itemId),prior=this.rows.get(key)??this.pending.get(key)?.row;
  if(prior&&item.revision<prior.revision)return;
  if(!prior&&this.rows.size+this.pending.size>=this.limit){if(this.omitted.size<128)this.omitted.add(key);else this.omittedOverflow=true;return;}
  const reason=typeof item.failureReason==='string'?item.failureReason.slice(0,8192):'';
  const output=typeof item.visibleOutput==='string'?item.visibleOutput.slice(0,8192):'';
  const hints=patterns.filter(([,pattern])=>pattern.test(reason)||pattern.test(output)).map(([name])=>name);
  const row={ordinal:prior?.ordinal??(admitted?this.rows.size+1:0),turn_sha256:hash(item.turnId),item_sha256:key,
   call_sha256:ref(item.callId)?hash(item.callId):prior?.call_sha256??null,
   tool:tools.has(item.tool)?item.tool:'other',tool_sha256:digest(item.tool),
   revision:item.revision,status:statuses.has(item.status)?item.status:'unknown',
   args_sha256:digest(item.args)??prior?.args_sha256??null,
   failure_kind:item.failureKind==null?null:kinds.has(item.failureKind)?item.failureKind:'other',
   failure_kind_sha256:digest(item.failureKind),failure_reason_sha256:digest(item.failureReason),
   diagnostic_hints:hints,diagnostic_hint_source:hints.length?(reason&&patterns.some(([,pattern])=>pattern.test(reason))?'failure_reason_or_output_pattern':'visible_output_pattern'):null,
   output_present:typeof item.visibleOutput==='string'&&item.visibleOutput.length>0,
   execution_verification:'not_verified',
  };
  if(prior&&item.revision===prior.revision){if(JSON.stringify(row)===JSON.stringify(prior))this.duplicates++;else this.invalid++;return;}
  // The native stream can lead the turn/start RPC acknowledgement. Retain only
  // normalized metadata until that exact turn is admitted; never store raw frames.
  if(admitted)this.rows.set(key,row);else this.pending.set(key,{session:hash(p.sessionId),row});
 }
 snapshot(){
  this.reconcile();
  const rows=[...this.rows.values()],counts=new Map();
  for(const row of rows)if(row.args_sha256){const key=row.tool_sha256+':'+row.args_sha256;const prior=counts.get(key);counts.set(key,{tool:row.tool,args_sha256:row.args_sha256,count:(prior?.count??0)+1});}
  return{schema_version:1,arm:this.arm,status:rows.length?'observed':'not_observed',
   coverage:this.invalid||this.foreign||this.pending.size||this.omitted.size||this.omittedOverflow?'partial_or_unverified':'observed_notifications_only',
   tool_calls:rows.length,native_failure_statuses:rows.filter(r=>['failed','rejected','timedOut'].includes(r.status)).length,
   in_progress_or_unknown:rows.filter(r=>['inProgress','unknown'].includes(r.status)).length,
   omitted_calls:this.omitted.size,omitted_count_is_lower_bound:this.omittedOverflow,invalid_events:this.invalid,unscoped_events:this.foreign,pending_calls:this.pending.size,duplicate_events:this.duplicates,
   repeated_invocations:[...counts.values()].filter(r=>r.count>1),rows:structuredClone(rows),
   interpretation:'Native lifecycle metadata and diagnostic text matches only; completed is not verified execution or quality. Raw args, output, paths and reasoning are excluded.'};
 }
}
