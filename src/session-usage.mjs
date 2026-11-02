// Bounded, per-session projection of native Muse session/tokenUsage events.
// No prompts, responses, personal state or raw record identifiers are output.
import {isDeepStrictEqual} from 'node:util';
const ref=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const count=x=>Number.isSafeInteger(x)&&x>=0;
function sourceKey(r){if(!r||!ref(r.stream?.kind)||!ref(r.stream?.id)||!ref(r.first?.id)||!ref(r.last?.id)||!count(r.first?.sequence)||!count(r.last?.sequence)||r.last.sequence<r.first.sequence)return null;return JSON.stringify([r.stream.kind,r.stream.id,r.first.id,r.first.sequence,r.last.id,r.last.sequence]);}
export class SessionUsage {
 constructor(sessionId){if(!ref(sessionId))throw Error('session_usage_invalid_scope');this.sessionId=sessionId;this.seen=new Map();this.cumulative=null;this.invalid=false;}
 observe(event){
  if(this.invalid)return;if(!event||event.sessionId!==this.sessionId)return;
  const k=sourceKey(event.sourceRange),c=event.cumulative,u=event.usage;
  if(!k||!ref(event.turnId)||!c||!u||!count(c.promptTokens)||!count(c.outputTokens)||!count(c.totalTokens)||c.totalTokens!==c.promptTokens+c.outputTokens){this.invalid=true;return;}
  const raw={};for(const f of ['inputTokens','outputTokens','cachedTokens','reasoningTokens','cacheReadTokens','cacheWriteTokens']){if(u[f]!==undefined){if(!count(u[f])){this.invalid=true;return;}raw[f]=u[f];}}
  if(event.durationMs!==undefined&&!count(event.durationMs)){this.invalid=true;return;}
  if(c.cost!==undefined&&(!Number.isFinite(c.cost?.usd)||c.cost.usd<0||typeof c.cost.partial!=='boolean')){this.invalid=true;return;}
  const clean={promptTokens:c.promptTokens,outputTokens:c.outputTokens,totalTokens:c.totalTokens};for(const f of ['cacheReadTokens','cacheWriteTokens'])if(c[f]!==undefined)clean[f]=c[f];if(c.cost!==undefined)clean.cost={usd:c.cost.usd,partial:c.cost.partial};
  const data={usage:raw,cumulative:clean,turnId:event.turnId,durationMs:event.durationMs??null};
  if(this.seen.has(k)){if(!isDeepStrictEqual(this.seen.get(k),data))this.invalid=true;return;}
  if(this.seen.size>=2048){this.invalid=true;return;}
  if(this.cumulative&&['promptTokens','outputTokens','totalTokens'].some(f=>c[f]<this.cumulative[f])){this.invalid=true;return;}
  for(const f of ['cacheReadTokens','cacheWriteTokens'])if(c[f]!==undefined&&!count(c[f])){this.invalid=true;return;}
  if(c.cacheReadTokens!==undefined&&c.cacheReadTokens>c.promptTokens){this.invalid=true;return;}
  if(this.cumulative&&['cacheReadTokens','cacheWriteTokens'].some(f=>c[f]!==undefined&&this.cumulative[f]!==undefined&&c[f]<this.cumulative[f])){this.invalid=true;return;}
  this.seen.set(k,structuredClone(data));this.cumulative=structuredClone(clean);
 }
 snapshot(){
  if(this.invalid)return {status:'unavailable',reason:'usage_evidence_invalid'};
  if(!this.cumulative)return {status:'not_observed',model_calls:null,input_tokens:null,output_tokens:null,cache_read_tokens:null,estimated_cost_usd:null};
  // A usage event is not necessarily one provider call; do not infer calls.
  const c=this.cumulative;return {status:'observed',model_calls:null,input_tokens:c.promptTokens,output_tokens:c.outputTokens,cache_read_tokens:c.cacheReadTokens??null,estimated_cost_usd:c.cost?.usd??null,cost_partial:c.cost?.partial??null};
 }
 clear(){this.seen.clear();this.cumulative=null;this.sessionId=null;this.invalid=true;}
}
