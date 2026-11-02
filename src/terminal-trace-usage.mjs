// Derive only provider usage counters from a private, in-memory Muse stderr
// stream. Never forwards, logs or stores request/response text or raw IDs.
import {StringDecoder} from 'node:string_decoder';import {createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const MAX_LINE=4*1024*1024,MAX_RESPONSES=4096,MAX_SAFE=Number.MAX_SAFE_INTEGER;
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
const responseId=x=>typeof x==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(x)?createHash('sha256').update(x).digest('hex'):null;
export class TerminalTraceUsage {
 constructor(){this.decoder=new StringDecoder('utf8');this.buffer='';this.requests=0;this.responses=new Map();this.invalid=false;this.ended=false;this.diagnostic=false;this.responseActive=false;}
 feed(chunk){
  if(this.invalid||this.ended)return;if(!Buffer.isBuffer(chunk))throw Error('trace_chunk_invalid');
  this.buffer+=this.decoder.write(chunk);if(Buffer.byteLength(this.buffer)>MAX_LINE){this.fail();return;}
  let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i).replace(/\r$/,'');this.buffer=this.buffer.slice(i+1);if(Buffer.byteLength(line)>MAX_LINE){this.fail();return;}
   if(line.startsWith('REQUEST:')){this.requests++;if(this.requests>MAX_RESPONSES){this.fail();return;}continue;}
   let raw;if(line.startsWith('SSE RESPONSE: ')){raw=line.slice(14).trim();const at=raw.indexOf('{');if(at<0)continue;raw=raw.slice(at);}else if(line.startsWith('RESPONSE: ')){this.responseActive=true;raw=line.slice(10).trim();}else if(this.responseActive&&line.startsWith('data: ')){raw=line.trim();}else if(this.responseActive&&line.startsWith('event: ')){continue;}else if(this.responseActive&&!line.trim()){this.responseActive=false;continue;}else{if(line.trim())this.diagnostic=true;continue;}
   if(raw.startsWith('event: '))continue;if(raw==='data: [DONE]'||raw==='[DONE]'){this.responseActive=false;continue;}const payload=raw.startsWith('data: ')?raw.slice(6):raw;
   let item;try{item=JSON.parse(payload);}catch{if(payload.startsWith('{'))this.fail();continue;}
   if(item?.type!=='response.completed')continue;const id=responseId(item.response?.id),u=item.response?.usage;
   if(!id||!u||!nonnegative(u.input_tokens)||!nonnegative(u.output_tokens)){this.fail();return;}
   const cache=u.input_tokens_details?.cached_tokens;if(cache!==undefined&&cache!==null&&(!nonnegative(cache)||cache>u.input_tokens)){this.fail();return;}
   const record={input:u.input_tokens,output:u.output_tokens,cached:cache??null};
   if(this.responses.has(id)){if(!isDeepStrictEqual(this.responses.get(id),record)){this.fail();return;}}else{if(this.responses.size>=MAX_RESPONSES){this.fail();return;}this.responses.set(id,record);}
  }
 }
 fail(){this.invalid=true;this.buffer='';this.responses.clear();}
 finish(){if(this.ended)return;this.buffer+=this.decoder.end();if(this.buffer.trim())this.fail();this.ended=true;this.buffer='';}
 snapshot(){
  if(this.invalid)return {status:'unavailable',reason:'trace_invalid'};
  if(this.responses.size===0)return {status:this.requests?'waiting_for_usage':'not_observed',model_calls:null,input_tokens:null,output_tokens:null,cache_read_tokens:null,coverage:'unknown',diagnostic:this.diagnostic};
  const rows=[...this.responses.values()],sum=key=>{if(rows.some(x=>x[key]===null))return null;const n=rows.reduce((a,x)=>a+x[key],0);return n<=MAX_SAFE?n:null;};
  const coverage=this.requests===this.responses.size?'observed':'partial_or_unconfirmed';
  return {status:'observed',model_calls:rows.length,input_tokens:sum('input'),output_tokens:sum('output'),cache_read_tokens:sum('cached'),coverage,diagnostic:this.diagnostic};
 }
 clear(){this.buffer='';this.responses.clear();this.ended=true;}
}
