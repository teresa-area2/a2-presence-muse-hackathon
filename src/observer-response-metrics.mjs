// One-arm public response counts. No text, native identity or policy inference
// leaves this projection. Caller completeness never overrides local bounds.
const MAX_MESSAGES=2048,MAX_BYTES=1024*1024,MAX_IDS=2048,MAX_ROWS=12;
const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const fields=(raw,keys)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const out={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(raw,key);if(d&&!Object.hasOwn(d,'value'))return null;out[key]=d?.value;}return out;};
const facet=(source,message_count=null,total_words=null)=>({source,message_count,total_words,mean_words_per_message:source!=='captured_subset'&&message_count>0?total_words/message_count:null});
function reportedFacet(raw,kind){
 const keys=[kind+'_messages',kind+'_words'];if(raw===null||raw===undefined)return{status:'absent'};
 const values=fields(raw,keys);if(!values)return{status:'invalid'};
 if(keys.every(k=>!Object.hasOwn(raw,k)))return{status:'absent'};
 const messages=count(values[keys[0]]),words=count(values[keys[1]]);
 if(messages===null||words===null||messages===0&&words>0)return{status:'invalid'};
 return{status:'valid',messages,words};
}
export function publicResponseMetrics({messages=null,complete=false,reported=null,includedMessageIds=null,projectionOmitted=0}={}){
 const available=Array.isArray(messages),sourceCount=available?messages.length:null,totals={final:{messages:0,words:0},commentary:{messages:0,words:0}},per_message=[];
 // Upstream projection can remove a row (and its clipping flag) before this
 // bounded reader sees it. Loss counts describe supplied rows, never turns.
 const projectionLoss=count(projectionOmitted),projectionSource=available&&projectionLoss!==null&&Number.isSafeInteger(sourceCount+projectionLoss)?sourceCount+projectionLoss:null;
 const requested=Array.isArray(includedMessageIds)?new Set(includedMessageIds.slice(0,MAX_IDS).filter(id=>typeof id==='string'&&id.length>0&&id.length<=64&&!/[\x00-\x1f\x7f]/u.test(id))):null;
 let processed=0,omitted=available?Math.max(0,sourceCount-MAX_MESSAGES):null,rejected=0,usedBytes=0,matched=0,clipped=0,unknown=0;
 for(const raw of available?messages.slice(0,MAX_MESSAGES):[]){
  processed++;const role=fields(raw,['author','phase']);if(!role){rejected++;continue;}
  if(role.author!=='Muse'||!['finalAnswer','commentary'].includes(role.phase))continue;
  const row=fields(raw,['id','text','truncated','cut_off']);if(!row||typeof row.text!=='string'){rejected++;continue;}
  const text_complete=row.truncated===true||row.cut_off===true?false:row.truncated===false&&row.cut_off===false?true:null;
  if(text_complete===false)clipped++;else if(text_complete===null)unknown++;
  if(row.text.length>MAX_BYTES-usedBytes){omitted++;continue;}const size=Buffer.byteLength(row.text,'utf8');if(size>MAX_BYTES-usedBytes){omitted++;continue;}usedBytes+=size;
  let words=0;for(const _ of row.text.matchAll(/\S+/gu))words++;
  const target=totals[role.phase==='finalAnswer'?'final':'commentary'];if(!Number.isSafeInteger(target.words+words)){omitted++;continue;}target.messages++;target.words+=words;
  if(requested?.has(row.id)){matched++;if(per_message.length<MAX_ROWS)per_message.push({message_id:row.id,phase:role.phase,words,text_complete});}
 }
 const full=complete===true&&available&&omitted===0&&rejected===0&&clipped===0&&unknown===0&&projectionLoss===0,result={source:'unknown',scope:'single_arm_public_responses',text:{available,complete:full,source_messages:sourceCount,processed_messages:processed,omitted_messages:omitted,rejected_messages:rejected,clipped_messages:clipped,unknown_completeness_messages:unknown,projection_source_messages:projectionSource,projection_omitted_messages:projectionLoss},counter_agreement:{},reported:{},per_message,per_message_omitted:requested?(omitted===0&&rejected===0&&projectionLoss===0&&includedMessageIds.length<=MAX_IDS?matched-per_message.length:null):0};
 for(const kind of ['final','commentary']){
  const t=totals[kind],r=reportedFacet(reported,kind);result.reported[kind]=r.status;
  const usableReport=r.status==='valid'&&clipped===0&&unknown===0&&(!available||projectionLoss===0&&omitted===0&&rejected===0);
  result[kind]=full?facet('complete_text',t.messages,t.words):usableReport?facet('reported_snapshot',r.messages,r.words):t.messages>0?facet('captured_subset',t.messages,t.words):facet('unknown');
  result.counter_agreement[kind]=r.status!=='valid'?'unavailable':!full?'not_comparable':r.messages===t.messages&&r.words===t.words?'agree':'conflict';
 }
 result.source=result.final.source===result.commentary.source?result.final.source:'mixed';return result;
}
