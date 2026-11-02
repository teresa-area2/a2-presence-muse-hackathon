// Native Codex JSONL is version-sensitive. Inspect only the public/usage allowlist.
export function normalizeCodexSession(input,{workspace,sessionId}={}){
 const meta=input.find(r=>r.type==='session_meta')?.payload;
 if(!meta||meta.cwd!==workspace||!['cli','exec'].includes(meta.source))return {records:[],limitations:['Non-primary or mismatched Codex session excluded.']};
 const prefix=sessionId??meta.id,records=[],seen=new Set(),totals={};let lastUsageAt=null;const hasTaskStarts=input.some(r=>r.type==='event_msg'&&r.payload?.type==='task_started');
 const add=(type,timestamp,id,content,extra={})=>records.push({type,timestamp,cwd:workspace,uuid:prefix+':'+id,message:{id:prefix+':'+id,content,...extra}});
 for(let i=0;i<input.length;i++){
  const r=input[i],p=r.payload??{},at=r.timestamp;
  if(r.type==='event_msg'&&((hasTaskStarts&&p.type==='task_started')||(!hasTaskStarts&&p.type==='user_message')))add('user',at,'user:'+(p.turn_id??i),'[redacted]');
  if(r.type==='response_item'&&p.type==='message'&&p.role==='assistant'){
   const text=(p.content??[]).filter(b=>b.type==='output_text'&&typeof b.text==='string').map(b=>({type:'text',text:b.text}));
   if(text.length){const key=JSON.stringify([at,p.id,text]);if(!seen.has(key)){seen.add(key);add('assistant',at,p.id??'message:'+i,text);}}
  }
  if(r.type==='response_item'&&['function_call','custom_tool_call'].includes(p.type)&&typeof p.call_id==='string')add('assistant',at,'tool:'+p.call_id,[{type:'tool_use',id:prefix+':'+p.call_id}]);
  if(r.type==='event_msg'&&p.type==='task_complete')add('assistant',at,'complete:'+p.turn_id,[],{stop_reason:'end_turn'});
  if(r.type==='event_msg'&&p.type==='token_count'){
   const usage=p.info?.total_token_usage;
   for(const [native,field] of Object.entries({input_tokens:'input_tokens',output_tokens:'output_tokens',cached_input_tokens:'cache_read_input_tokens',cache_write_input_tokens:'cache_creation_input_tokens'})){
    const n=usage?.[native];if(typeof n==='number'&&Number.isFinite(n)&&n>=0)totals[field]=n;
   }
   lastUsageAt=at;
  }
 }
 if(lastUsageAt)add('assistant',lastUsageAt,'usage-total',[],{usage:totals});
 return {records,limitations:['Codex tokens use the latest cumulative session counters, not a sum of cumulative snapshots. Input tokens include cached input; cache read is a subset. Native usage can include internal generation. Turn counts use native task-start boundaries and can include automated continuations; timings use recorded message events, not UI render timestamps.']};
}
