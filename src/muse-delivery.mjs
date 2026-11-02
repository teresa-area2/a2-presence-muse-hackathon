// Ephemeral native transport observation. Raw requests/guidance/answers never
// leave feed() or persist. A body match is deliberately weaker than exact
// hook invocation or provider-response linkage.
import {createHash} from 'node:crypto';
import{compileMuseCollaboration}from '../scripts/muse-collaboration-contract.mjs';
import {compileMusePresentation} from '../scripts/muse-presentation-guidance.mjs';
import {compileMusePresentation as compileMusePresentationV3} from '../scripts/muse-presentation-guidance-v3.mjs';
import {StringDecoder} from 'node:string_decoder';
import fs from 'node:fs/promises';
import constants from 'node:fs';
import path from 'node:path';
import {TerminalTraceUsage} from './terminal-trace-usage.mjs';
import {COMPARISON_MODELS,modelEvidence} from './comparison-model.mjs';
import {attributeMuseRequests} from './muse-request-attribution.mjs';
import {attributeMuseResponses} from './muse-response-attribution.mjs';
import {MuseResponseTrace,publicTextDigest,hookIdentity,readOwnedPostHooks} from './muse-response-trace.mjs';
const PREFIX='Automatic Presence refresh immediately before this model generation';
const MARK='Server guidance (verbatim):\n';
const FALLBACK='Presence unavailable or ineligible:';
const sha=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const text=value=>typeof value==='string'?value:Array.isArray(value)?value.filter(p=>p?.type==='input_text'||p?.type==='text').map(p=>p.text??'').join(''):null;
const controls=value=>value&&['terse','standard','full'].includes(value.response_extent)&&['send','defer'].includes(value.unsolicited_update)&&['conversational','self_contained'].includes(value.conversation_style)?{response_extent:value.response_extent,unsolicited_update:value.unsolicited_update,conversation_style:value.conversation_style}:null;
const sequence=value=>Number.isSafeInteger(value)&&value>0;
const MAX_REFRESH_CANDIDATES=64;
function ordered(value){return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;}
export const requestFingerprint=value=>sha(JSON.stringify(ordered(value)));
function refreshFacts(context){
 const at=context.indexOf(MARK),hashes=[];
 const header=context.slice(0,at>=0?at:context.indexOf(FALLBACK)>=0?context.indexOf(FALLBACK):context.length);
 const readMarkers=[...header.matchAll(/^Presence read: ([^\r\n]*)$/gm)];
 const candidateRead=readMarkers.length===1&&uuid(readMarkers[0][1])?readMarkers[0][1]:null;
 const contractMarkers=[...header.matchAll(/\bMuse\s+collaboration\b/gi)],readEnd=readMarkers.length===1?readMarkers[0].index+readMarkers[0][0].length+1:-1;
 const tail=readEnd>=0?header.slice(readEnd):null,version=tail?.match(/^Muse collaboration v([123]):\n/)?.[1],contract=contractMarkers.length===1&&version?tail:null;
 const contractBytes=contract===null?null:Buffer.byteLength(contract),contractHash=contract!==null&&contract.endsWith('\n')&&contractBytes<=384?sha(contract.slice(0,-1)):null;
 if(at>=0){const tail=context.slice(at+MARK.length);if(tail.length<=100000){hashes.push(sha(tail));for(const suffix of ['\n\n<system-reminder','\n</system-reminder>','</system-reminder>']){const end=tail.indexOf(suffix);if(end>=0)hashes.push(sha(tail.slice(0,end)));}}}
 return {has_read_marker:readMarkers.length>0,read_id:candidateRead,guidance_hashes:hashes,fallback:context.includes(FALLBACK)&&context.includes('do not reuse earlier guidance')&&at<0,collaboration_present:at<0&&context.includes(FALLBACK)?/\bMuse\s+collaboration\b/i.test(context):contractMarkers.length>0,collaboration_version:contractHash?Number(version):null,collaboration_hash:contractHash,collaboration_bytes:contractHash?contractBytes:null};
}
function refreshCandidates(blocks){
 const candidates=[],readCounts=new Map(),sequenceCounts=new Map();
 for(const block of blocks){
  for(const match of block.matchAll(/^Presence read: ([^\r\n]*)$/gm))if(uuid(match[1]))readCounts.set(match[1],(readCounts.get(match[1])??0)+1);
  for(const match of block.matchAll(/^Presence sequence: ([1-9][0-9]*)$/gm))if(sequence(Number(match[1])))sequenceCounts.set(Number(match[1]),(sequenceCounts.get(Number(match[1]))??0)+1);
  const starts=[];
  for(const match of block.matchAll(new RegExp(PREFIX,'g'))){if(candidates.length+starts.length>=MAX_REFRESH_CANDIDATES)throw Error('delivery_refresh_capacity');starts.push(match.index);}
  for(let index=0;index<starts.length;index++){
   const context=block.slice(starts[index],starts[index+1]??block.length),at=context.indexOf(MARK),fallback=context.indexOf(FALLBACK),header=context.slice(0,at>=0?at:fallback>=0?fallback:context.length);
   const turns=[...header.matchAll(/^Presence turn: ([^\r\n]*)$/gm)],sequences=[...header.matchAll(/^Presence sequence: ([^\r\n]*)$/gm)];
   const turn=turns.length===1&&uuid(turns[0][1])?turns[0][1]:null;
   const seq=sequences.length===1&&/^[1-9][0-9]*$/.test(sequences[0][1])&&sequence(Number(sequences[0][1]))?Number(sequences[0][1]):null;
   const facts=refreshFacts(context),sequenced=turns.length>0||sequences.length>0;
   const valid=turn!==null&&seq!==null&&facts.read_id!==null&&header.includes(`Presence turn: ${turn}\nPresence sequence: ${seq}\nPresence read: ${facts.read_id}\n`);
   // Only hashes and bounded correlation metadata survive request parsing.
   candidates.push({...facts,turn_id:turn,read_sequence:seq,sequenced,valid});
  }
 }
 for(const candidate of candidates)candidate.valid=candidate.valid&&readCounts.get(candidate.read_id)===1&&sequenceCounts.get(candidate.read_sequence)===1;
 return {candidates,readCounts};
}
export function requestDeliveryFacts(request,expectedHash,observedAt=Date.now(),qualityInstructions=null){
 if(!request||!Array.isArray(request.input))throw Error('delivery_request_invalid');
 const user=request.input.filter(p=>p?.role==='user').at(-1),userText=text(user?.content);
 const blocks=request.input.filter(p=>p?.role==='developer').flatMap(p=>typeof p.content==='string'?[p.content]:Array.isArray(p.content)?p.content.filter(x=>(x?.type==='input_text'||x?.type==='text')&&typeof x.text==='string').map(x=>x.text):[]);
 const markers=request.input.some(p=>{const body=text(p?.content)??'';return body.includes(PREFIX)||/\bMuse\s+collaboration\s+v\d+\s*:/i.test(body);});
 const {candidates,readCounts}=refreshCandidates(blocks),sequenced=candidates.some(candidate=>candidate.sequenced);
 // The historical last-block predicate is retained only for unsequenced input.
 // Sequenced input needs the owned audit and native turn before it can qualify.
 const block=blocks.filter(block=>block.includes(PREFIX)).at(-1),legacy=refreshFacts(block?.slice(block.lastIndexOf(PREFIX))??'');
 if(sequenced||readCounts.get(legacy.read_id)!==1)legacy.read_id=null;
 return {...legacy,model:COMPARISON_MODELS.some(m=>m.id===request.model)?request.model:null,prompt_match:typeof userText==='string'&&sha(userText)===expectedHash,marker:markers,request_fingerprint:requestFingerprint(request),observed_at:observedAt,refresh_candidates:candidates,sequenced_refresh:sequenced,shared_quality_present:qualityInstructions===null?null:blocks.some(block=>block.includes(qualityInstructions)),shared_quality_prompt_present:qualityInstructions===null||typeof userText!=='string'||sha(userText)!==expectedHash?null:userText.startsWith(qualityInstructions+'\n\n')};
}
function resolveRefresh(request,hooks,sessionId,turnId){
 if(!request.sequenced_refresh&&!hooks?.some(hook=>Object.hasOwn(hook,'read_sequence')))return request;
 const unknown={...request,read_id:null,guidance_hashes:[],fallback:false,collaboration_hash:null,collaboration_bytes:null};
 if(!uuid(sessionId)||!uuid(turnId)||!Array.isArray(hooks)||!hooks.length||hooks.length>64||!Number.isFinite(request.observed_at))return unknown;
 if(hooks.some(hook=>hook.session_id!==sessionId||hook.turn_id!==turnId||!sequence(hook.read_sequence)||!uuid(hook.read_id)||!Number.isFinite(Date.parse(hook.read_at))))return unknown;
 if(new Set(hooks.map(hook=>hook.read_sequence)).size!==hooks.length||new Set(hooks.map(hook=>hook.read_id)).size!==hooks.length)return unknown;
 const before=hooks.filter(hook=>Date.parse(hook.read_at)<=request.observed_at);
 if(!before.length)return unknown;
 const latest=before.reduce((a,b)=>a.read_sequence>b.read_sequence?a:b),candidates=request.refresh_candidates??[];
 if(candidates.some(candidate=>candidate.sequenced&&!candidate.valid))return unknown;
 const current=candidates.filter(candidate=>candidate.turn_id===turnId);
 if(!current.length||current.some(candidate=>!candidate.valid))return unknown;
 const highest=current.reduce((a,b)=>a.read_sequence>b.read_sequence?a:b);
 if(highest.read_sequence!==latest.read_sequence||highest.read_id!==latest.read_id)return unknown;
 return {...request,...highest};
}
export async function readOwnedPreHooks(workspace,sessionId,turnId,{baseline=false}={}){
 const real=await fs.realpath(workspace),dir=path.join(real,'.presence');
 const info=await fs.lstat(dir);if(!info.isDirectory()||info.isSymbolicLink()||await fs.realpath(dir)!==dir)throw Error('hook_evidence_unsafe');
 let handle;try{handle=await fs.open(path.join(dir,'hook-events.jsonl'),constants.constants.O_RDONLY|constants.constants.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>1024*1024||(process.getuid&&stat.uid!==process.getuid()))throw Error('hook_evidence_unsafe');const body=await handle.readFile({encoding:'utf8'}),rows=[];
  if(baseline&&body.trim())return [{eligible:false,digest:null,controls:null}];
  for(const line of body.split('\n')){if(!line.trim())continue;let row;try{row=JSON.parse(line);}catch{throw Error('hook_evidence_invalid');}if(row?.event!=='PreLLMCall'||row.session_id!==sessionId||row.turn_id!==turnId)continue;if(rows.length>=64||typeof row.eligible!=='boolean'||row.eligible===false&&row.guidance_sha256!==null||Object.hasOwn(row,'read_sequence')&&!sequence(row.read_sequence))throw Error('hook_evidence_invalid');rows.push({...hookIdentity(row),...(Object.hasOwn(row,'read_sequence')?{read_sequence:row.read_sequence}:{}),...([1,2,3].includes(row.collaboration_version)?{collaboration_version:row.collaboration_version}:{}),read_id:uuid(row.read_id)?row.read_id:null,reading_id:id(row.reading_id)?row.reading_id:null,receipt_age_seconds:typeof row.receipt_age_seconds==='number'&&Number.isFinite(row.receipt_age_seconds)&&row.receipt_age_seconds>=0?row.receipt_age_seconds:null,eligible:row.eligible,digest:digest(row.guidance_sha256)?row.guidance_sha256:null,controls:controls(row.controls),read_at:typeof row.read_at==='string'?row.read_at:null});}
  return rows;
 }finally{await handle.close();}
}
export class MuseDelivery {
 constructor({arm,workspace,readHooks=readOwnedPreHooks,readResponseHooks=readOwnedPostHooks,onChange=()=>{},qualityInstructions=null,now=()=>performance.now()}){
  if(!['without','with'].includes(arm)||!path.isAbsolute(workspace)||typeof readHooks!=='function'||typeof readResponseHooks!=='function'||typeof now!=='function')throw Error('delivery_configuration_invalid');this.now=now;
  if(qualityInstructions!==null&&(typeof qualityInstructions!=='string'||!qualityInstructions||qualityInstructions.length>6000))throw Error('delivery_quality_invalid');this.qualityInstructions=qualityInstructions;
  this.arm=arm;this.workspace=workspace;this.readHooks=readHooks;this.readResponseHooks=readResponseHooks;this.onChange=onChange;this.decoder=new StringDecoder('utf8');this.buffer='';this.invalid=false;this.current=null;this.serial=0;this.usage=new TerminalTraceUsage();this.pending=new Set();this.steerTokens=new WeakMap();this.promptHashes=new Set();this.traceEnded=false;this.modelObservations=[];
 }
 begin(prompt){if(typeof prompt!=='string'||!prompt)throw Error('delivery_prompt_invalid');if(this.buffer.trim()||this.promptHashes.size>=128)this.fail();const hash=sha(prompt),reused=this.promptHashes.has(hash);this.promptHashes.add(hash);this.current={startedAt:this.now(),dispatchElapsed:null,ordinal:++this.serial,promptHash:hash,reused_prompt:reused,knownPromptHashes:new Set([hash]),steers:new Map(),sessionId:null,turnId:null,requests:[],completed:false,finals:0,publicFinals:[],responseTrace:new MuseResponseTrace(),postHooks:[],postReadFailed:false,responseInvalid:false,status:'waiting',hooks:null};this.changed();}
 bind(sessionId,turnId){if(!this.current||!id(sessionId)||!id(turnId))throw Error('delivery_scope_invalid');this.current.sessionId=sessionId;this.current.turnId=turnId;if(this.current.requests.length)void this.refresh(this.current);}
 prepareSteer(prompt,{sessionId,turnId,commandId}={}){
  const r=this.current;if(this.invalid||!r||r.completed||r.sessionId!==sessionId||r.turnId!==turnId||!id(commandId)||typeof prompt!=='string'||!prompt.trim()||prompt.length>14000)return null;
  if(r.steers.size>=64){this.fail();return null;}const hash=sha(prompt);if(r.steers.has(commandId))return null;
  const candidate={hash,state:'pending',from:r.requests.length,reused:!r.knownPromptHashes.has(hash)&&this.promptHashes.has(hash)},token=Object.freeze({});r.steers.set(commandId,candidate);this.steerTokens.set(token,{record:r,candidate});return token;
 }
 continueSteer(commandId,sessionId,turnId){
  const old=this.current,candidate=old?.steers.get(commandId);if(this.invalid||!old?.completed||old.sessionId!==sessionId||!id(turnId)||!candidate||candidate.state==='refused'||candidate.continuationRecord)return false;
  const carried=new Map([...old.steers].filter(([cmd,c])=>cmd!==commandId&&c.state!=='refused'&&!c.continuationRecord));for(const c of carried.values())c.from=0;
  this.current={startedAt:this.now(),dispatchElapsed:null,ordinal:++this.serial,promptHash:candidate.hash,reused_prompt:candidate.reused,knownPromptHashes:new Set([candidate.hash,...[...carried.values()].map(c=>c.hash)]),steers:carried,nativeCandidates:new Map([[commandId,candidate],...carried]),coalescedHashes:null,sessionId,turnId,requests:[],completed:false,finals:0,publicFinals:[],responseTrace:new MuseResponseTrace(),postHooks:[],postReadFailed:false,responseInvalid:false,status:'waiting',hooks:null};candidate.continuationRecord=this.current;this.changed();return true;
 }
 setContinuationInputs(commandIds,sessionId,turnId){
  const r=this.current;if(this.invalid||!r||r.completed||r.sessionId!==sessionId||r.turnId!==turnId||!r.nativeCandidates||!Array.isArray(commandIds)||commandIds.length<1||commandIds.length>64||new Set(commandIds).size!==commandIds.length)return false;
  const candidates=commandIds.map(id=>r.nativeCandidates.get(id));if(candidates.some(c=>!c||c.state==='refused'))return false;r.coalescedHashes=candidates.map(c=>c.hash);r.coalescedCandidates=candidates;return true;
 }
 settleSteer(token,status){
  if(!['accepted','refused','unknown'].includes(status)||!token||typeof token!=='object')return false;const entry=this.steerTokens.get(token);if(!entry)return false;this.steerTokens.delete(token);const{record,candidate}=entry;candidate.state=status;
  if(status!=='refused'){
   if(!this.promptHashes.has(candidate.hash)&&this.promptHashes.size>=128){this.fail();return false;}this.promptHashes.add(candidate.hash);record.knownPromptHashes.add(candidate.hash);
   if(this.current!==record&&this.current!==candidate.continuationRecord&&![...(this.current?.steers.values()??[])].includes(candidate)&&this.current?.knownPromptHashes.has(candidate.hash)){this.current.reused_prompt=true;this.classify(this.current);}
  }
  if(status==='refused'){if(candidate.continuationRecord===this.current||this.current?.coalescedCandidates?.includes(candidate)){this.fail();return false;}for(const req of record.requests)if(req.steer_candidate===candidate||req.steer_candidates?.includes(candidate)){req.prompt_match=false;req.shared_quality_prompt_present=null;}this.classify(record);}return true;
 }
 feed(chunk){
  this.usage.feed(chunk);if(this.invalid)return;this.buffer+=this.decoder.write(chunk);
  if(Buffer.byteLength(this.buffer)>4*1024*1024){this.fail();return;}
  let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at).replace(/\r$/,'');this.buffer=this.buffer.slice(at+1);if(!line.startsWith('REQUEST: ')){if(this.current?.responseTrace.feedLine(line)&&this.current.turnId)void this.refresh(this.current);continue;}
   if(!this.current||this.current.completed||this.current.requests.length>=64){this.fail();return;}
   try{if(this.current.requests.length===0){const elapsed=this.now()-this.current.startedAt;this.current.dispatchElapsed=Number.isFinite(elapsed)&&elapsed>=0?elapsed:null;}const request=JSON.parse(line.slice(9)),r=this.current,last=text(request.input?.filter(p=>p?.role==='user').at(-1)?.content),lastHash=typeof last==='string'?sha(last):null,candidate=lastHash===r.promptHash?null:[...r.steers.values()].find(c=>c.hash===lastHash&&c.state!=='refused'&&c.from<=r.requests.length);
    const parts=request.input?.filter(p=>p?.role==='user').at(-1)?.content,coalesced=Array.isArray(r.coalescedHashes)&&r.coalescedHashes.length>1&&Array.isArray(parts)&&parts.length===r.coalescedHashes.length&&parts.every((p,i)=>['text','input_text'].includes(p?.type)&&typeof p.text==='string'&&sha(p.text)===r.coalescedHashes[i]);
    const facts=requestDeliveryFacts(request,coalesced?lastHash:candidate?candidate.hash:r.promptHash,Date.now(),this.qualityInstructions);
    if(coalesced){facts.steer_candidates=r.coalescedCandidates;if(r.coalescedCandidates.some(c=>c.reused)){facts.prompt_match=false;facts.shared_quality_prompt_present=null;}}

    if(candidate){if(candidate.reused){facts.prompt_match=false;facts.shared_quality_prompt_present=null;}else if(facts.prompt_match){if(!r.knownPromptHashes.has(candidate.hash)&&this.promptHashes.size>=128)throw Error('prompt_capacity');r.knownPromptHashes.add(candidate.hash);this.promptHashes.add(candidate.hash);facts.steer_candidate=candidate;}}
    if(this.modelObservations.length>=8192)throw Error('model_capacity');this.modelObservations.push(facts.model);this.current.requests.push(facts);this.classify(this.current);if(this.current.turnId)void this.refresh(this.current);}catch{this.fail();return;}
  }
 }
 async finishTurn(){
  const record=this.current;if(!record||!record.sessionId||!record.turnId){this.fail();return;}
  record.completed=true;
  await this.refresh(record);
 }
 async refresh(record){
  if(this.pending.size>=64){this.fail();return;}
  const revision=record.hookRevision=(record.hookRevision??0)+1;
  const task=(async()=>{try{const hooks=await this.readHooks(this.workspace,record.sessionId,record.turnId,{baseline:this.arm==='without'});let posts=[],postReadFailed=false;if(this.arm==='with'&&record.responseTrace.rows.length&&record.publicFinals.length){try{posts=await this.readResponseHooks(this.workspace,record.sessionId,record.turnId);}catch{postReadFailed=true;}}if(revision!==record.hookRevision)return;record.hooks=hooks;record.postHooks=posts;record.postReadFailed=postReadFailed;this.classify(record);}catch{if(revision!==record.hookRevision)return;record.status='unavailable';record.markerMatched=false;if(this.current===record)this.changed();}})();
  this.pending.add(task);try{await task;}finally{this.pending.delete(task);}
 }
 publicFinal(payload){const r=this.current;if(!r)return;r.finals++;if(this.arm==='with'){if(r.publicFinals.length>=64)r.responseInvalid=true;else r.publicFinals.push({public_text_sha256:publicTextDigest(payload?.text),truncated:payload?.truncated!==false||payload?.cut_off===true});}this.classify(r);}
 classify(record){
  const requests=record.requests.map(request=>resolveRefresh(request,record.hooks,record.sessionId,record.turnId));
  record.attribution=[];record.markerMatched=false;
  if(this.invalid)record.status='unavailable';
  else if(record.requests.length===0)record.status=record.hooks?.length?'hook_only':'waiting';
  else if(this.arm==='without'){
   record.status=record.requests.some(r=>r.marker)||record.hooks?.length?'baseline_contaminated':record.reused_prompt||record.requests.some(r=>r.prompt_match!==true)?'ambiguous':record.hooks?'baseline_isolated':'request_observed';
  }
  else if(record.requests.some(r=>r.sequenced_refresh||r.has_read_marker)||record.hooks?.some(h=>Object.hasOwn(h,'read_sequence')||h.read_id)){
   record.attribution=attributeMuseRequests(requests,record.hooks??[]);
   const rows=record.attribution,positive=rows.every(r=>['guidance_observed','fallback_observed'].includes(r.status));
   const complete=record.hooks?.length===rows.length&&positive;
   if(!record.hooks)record.status='request_observed';
   else if(rows.some(r=>r.status==='ambiguous')||record.hooks.length!==rows.length)record.status='ambiguous';
   else if(!positive)record.status='unverified';
   else{record.markerMatched=complete;record.status=rows.every(r=>r.status==='guidance_observed')?'guidance_observed':rows.every(r=>r.status==='fallback_observed')?'fallback_observed':'mixed_observed';}
  }
  else if(record.reused_prompt||record.requests.length!==1||record.requests[0].prompt_match!==true)record.status='ambiguous';
  else if(!record.hooks)record.status='request_observed';
  else if(record.hooks.length!==1)record.status='ambiguous';
  else {const hook=record.hooks[0],req=record.requests[0],read=Date.parse(hook.read_at),valid=typeof hook.eligible==='boolean'&&Number.isFinite(read)&&read<=req.observed_at;
   record.status=valid&&hook.eligible&&controls(hook.controls)&&hook.digest&&req.guidance_hashes.includes(hook.digest)?'guidance_observed':valid&&hook.eligible===false&&hook.digest===null&&req.fallback?'fallback_observed':'unverified';}
  if(this.arm==='with')record.attribution=record.attribution.map((row,index)=>{
   const req=requests[index],hook=record.hooks?.find(h=>h.read_id===row.read_id),known=[1,2,3].includes(hook?.collaboration_version);
   if(!known&&!req?.collaboration_present)return row;
   const version=known?hook.collaboration_version:req?.collaboration_version??1;
   let status='unverified',bytes=null;
   if(known){
    if(row.status==='guidance_observed'&&req.collaboration_version===version){
     const expected=version===3?compileMusePresentationV3(row.controls):version===2?compileMusePresentation(row.controls):compileMuseCollaboration(row.controls);
     if(expected&&req.collaboration_hash===sha(expected.text)){status='matched';bytes=req.collaboration_bytes;}
    }else if(row.status==='fallback_observed'&&!req.collaboration_present){status='withdrawn';bytes=0;}
   }
   return{...row,collaboration_contract:{version,status,added_utf8_bytes:bytes}};
  });
  if(this.current===record)this.changed();
 }
 fail(){this.invalid=true;this.buffer='';if(this.current){this.current.requests=[];this.current.hooks=null;this.current.attribution=[];this.current.markerMatched=false;this.current.status='unavailable';}this.changed();}
 changed(){try{this.onChange();}catch{}}
 modelSnapshot(requested){const value=modelEvidence(requested,this.modelObservations);return this.invalid?{...value,status:'unavailable'}:value;}
 responseAttribution(record){
  const empty={status:'unverified',linked_responses:0,linked_finals:0,requests:[],finals:[]};
  if(this.arm!=='with'||this.invalid||!record?.completed||!record.markerMatched||record.responseInvalid||record.postReadFailed||record.responseTrace.invalid||this.usage.snapshot().status==='unavailable'||record.responseTrace.rows.length!==record.requests.length||record.postHooks.length!==record.requests.length)return empty;
  try{return attributeMuseResponses({requestAttribution:record.attribution,preHooks:record.hooks??[],postHooks:record.postHooks,responses:record.responseTrace.rows,finals:record.publicFinals,sessionId:record.sessionId,turnId:record.turnId});}catch{return empty;}
 }
 snapshot(){const r=this.current,proof=this.responseAttribution(r),finalLinked=r?.completed&&r.finals>0&&proof.status!=='ambiguous'&&proof.linked_finals===r.finals&&proof.finals.length===r.finals&&proof.finals.every(x=>x.status==='final_linked');return {request_dispatch_elapsed_ms:r?.dispatchElapsed??null,status:this.invalid?'unavailable':r?.status??'not_started',turn_ordinal:r?.ordinal??null,requests_observed:r?.requests.length??0,turn_completed:r?.completed===true,public_finals:r?.finals??0,shared_quality_prompt_check_version:1,shared_quality_prompt_observed:this.invalid||!r?.requests.length||r.reused_prompt||r.requests.some(x=>x.prompt_match!==true)?null:r.requests.every(x=>x.shared_quality_prompt_present===true)?true:r.requests.some(x=>x.shared_quality_prompt_present===false)?false:null,shared_quality_observed:r?.requests.length?r.requests.every(x=>x.shared_quality_present===true)?true:r.requests.some(x=>x.shared_quality_present===false)?false:null:null,trace_ended:this.traceEnded,request_attribution:(r?.attribution??[]).map((row,index)=>({...row,model:r.requests[index]?.model??null,controls:row.controls?{...row.controls}:null,...(row.collaboration_contract?{collaboration_contract:{...row.collaboration_contract}}:{})})),hook_linkage:!this.invalid&&r?.markerMatched?'read_marker_matched':'unverified',response_linkage:finalLinked?'public_final_matched':'unverified',response_attribution:proof,behavior:'not_measured',capture:'native_request_trace_in_memory'};}
 async settled(){await Promise.all([...this.pending]);}
 close(){if(this.traceEnded)return;this.buffer+=this.decoder.end();if(this.buffer.trim())this.fail();this.buffer='';this.usage.finish();this.traceEnded=true;this.changed();}
}
