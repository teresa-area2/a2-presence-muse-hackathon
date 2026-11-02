// Ephemeral provider-completion facts: no text, reasoning, credentials or native
// IDs leave the collector through public delivery/evidence projections.
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
const token=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
export const publicTextDigest=text=>typeof text==='string'&&text.length>0&&text.length<=65536?createHash('sha256').update(text).digest('hex'):null;
export function hookIdentity(row){
 const out={};for(const k of ['session_id','turn_id'])out[k]=uuid(row?.[k])?row[k]:null;
 for(const k of ['request_id','response_id'])if(Object.hasOwn(row,k))out[k]=token(row[k])?row[k]:null;
 for(const k of ['attempt','step'])if(Object.hasOwn(row,k))out[k]=Number.isSafeInteger(row[k])&&row[k]>=0?row[k]:null;
 return out;
}
function publicOutputDigest(response){
 if(!Array.isArray(response.output)||response.output.length>64)return null;
 const messages=response.output.filter(x=>x?.type==='message'&&x.role==='assistant');if(messages.length!==1)return null;
 const message=messages[0];if(message.status!==undefined&&message.status!=='completed'||message.truncated===true||message.cut_off===true||!Array.isArray(message.content)||message.content.length>64||!message.content.length)return null;
 if(message.content.some(x=>x?.type!=='output_text'||typeof x.text!=='string'||x.truncated===true))return null;
 return publicTextDigest(message.content.map(x=>x.text).join(''));
}
export class MuseResponseTrace {
 constructor(){this.rows=[];this.active=false;this.invalid=false;}
 feedLine(line){
  if(this.invalid)return false;let raw;
  if(line.startsWith('REQUEST:')){this.active=false;return false;}
  if(line.startsWith('SSE RESPONSE: ')){raw=line.slice(14).trim();const at=raw.indexOf('{');if(at<0)return false;raw=raw.slice(at);}
  else if(line.startsWith('RESPONSE: ')){this.active=true;raw=line.slice(10).trim();}
  else if(this.active&&line.startsWith('data: '))raw=line.trim();
  else if(this.active&&line.startsWith('event: '))return false;
  else{if(this.active&&!line.trim())this.active=false;return false;}
  if(raw.startsWith('event: '))return false;if(raw==='data: [DONE]'||raw==='[DONE]'){this.active=false;return false;}
  const payload=raw.startsWith('data: ')?raw.slice(6):raw;let item;
  try{item=JSON.parse(payload);}catch{if(payload.startsWith('{')){this.invalid=true;this.rows=[];return true;}return false;}
  if(item?.type!=='response.completed')return false;const response=item.response;
  if(!token(response?.id)||response.status!==undefined&&response.status!=='completed'){this.invalid=true;this.rows=[];return true;}
  const row={response_id:response.id,public_text_sha256:publicOutputDigest(response)},prior=this.rows.find(x=>x.response_id===row.response_id);
  if(prior){if(prior.public_text_sha256!==row.public_text_sha256){this.invalid=true;this.rows=[];}return true;}
  if(this.rows.length>=64){this.invalid=true;this.rows=[];return true;}this.rows.push(row);return true;
 }
}
export async function readOwnedPostHooks(workspace,sessionId,turnId){
 const real=await fs.realpath(workspace),dir=path.join(real,'.presence'),info=await fs.lstat(dir);
 if(!info.isDirectory()||info.isSymbolicLink()||await fs.realpath(dir)!==dir||info.mode&0o077||(process.getuid&&info.uid!==process.getuid()))throw Error('response_hooks_unsafe');
 let handle;try{handle=await fs.open(path.join(dir,'hook-events.jsonl'),constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>1024*1024||stat.mode&0o077||(process.getuid&&stat.uid!==process.getuid()))throw Error('response_hooks_unsafe');
  const rows=[];for(const line of (await handle.readFile({encoding:'utf8'})).split('\n')){if(!line.trim())continue;let row;try{row=JSON.parse(line);}catch{throw Error('response_hooks_invalid');}
   if(row?.event!=='PostLLMCall'||row.session_id!==sessionId||row.turn_id!==turnId)continue;if(rows.length>=64)throw Error('response_hooks_capacity');
   rows.push({...hookIdentity(row),provider_status:['successful','failed','unknown','conflicting'].includes(row.provider_status)?row.provider_status:'unknown'});
  }return rows;
 }finally{await handle.close();}
}
