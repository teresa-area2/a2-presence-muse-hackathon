// Fixed transport metadata only. A local broker submission is not an OP request.
const outcomes=new Set(['usable','backoff','invalid','unavailable','access_rejected']);
const count=x=>Number.isSafeInteger(x)&&x>=0;
const duration=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=Number.MAX_SAFE_INTEGER?x:null;
const wall=x=>count(x)&&x<=8640000000000000?x:null;
export function projectOpAttemptHistory(value,omitted){
 if(!Array.isArray(value))return{attempt_history:null,attempt_history_omitted:null};
 let dropped=Math.max(0,value.length-64);const rows=[];
 for(const row of value.slice(-64)){
  if(!row||typeof row!=='object'||Array.isArray(row)||!['http','local_backoff'].includes(row.kind)||!outcomes.has(row.outcome)||row.kind==='local_backoff'&&row.outcome!=='backoff'){dropped++;continue;}
  const http=row.kind==='http';
  rows.push({kind:row.kind,start_wall_ms:wall(row.start_wall_ms),end_wall_ms:http?wall(row.end_wall_ms):null,duration_ms:http?duration(row.duration_ms):null,http_status:http&&Number.isSafeInteger(row.http_status)&&row.http_status>=100&&row.http_status<=599?row.http_status:null,outcome:row.outcome,retry_after_ms:http?duration(row.retry_after_ms):null,cooldown_ms:duration(row.cooldown_ms)});
 }
 const total=count(omitted)&&count(omitted+dropped)?omitted+dropped:null;
 return{attempt_history:rows,attempt_history_omitted:total};
}
