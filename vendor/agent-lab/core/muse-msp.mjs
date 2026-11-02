import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {once} from 'node:events';
import {museCommand,museEnvironment} from '../agents/muse-interactive.mjs';

export const MUSE_MSP_FINGERPRINT='sha256:7fddaf646dbc317e5fcac0785e135eb04df14fbb0db1863089dfd6da21730e5b';
export function uuid7(now=Date.now()){
 const bytes=randomBytes(16);bytes.writeUIntBE(now,0,6);bytes[6]=(bytes[6]&15)|0x70;bytes[8]=(bytes[8]&63)|0x80;
 const x=bytes.toString('hex');return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`;
}
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x);
const reference=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const fail=label=>Object.assign(Error(label),{code:label});
export function qualifiedHumanPermission(state){
 const a=state?.axes;
 return state?.profileId===':ask-me'&&state.reviewerAuthority==='human'&&state.reviewerAttached===true&&a?.filesystem==='sandboxed'&&a.network==='off'&&a.approval==='onRequest'&&a.reviewer==='human';
}

// JSONL transport only. It never records raw protocol messages or reasoning.
// Application layers decide what to retain/present and explicitly acknowledge
// must-answer requests after presentation; receipt is not an approval decision.
export class MuseMsp extends EventEmitter{
 constructor({child,requestTimeoutMs=10000,fingerprint=MUSE_MSP_FINGERPRINT}){
  super();this.child=child;this.timeoutMs=requestTimeoutMs;this.fingerprint=fingerprint;this.next=0;this.pending=new Map();this.buffer='';this.closed=false;this.stopping=false;this.sessionId=null;this.activeTurnId=null;this.turnIds=new Set();this.approvals=new Map();
  child.stdout.setEncoding('utf8');child.stdout.on('data',data=>this.consume(data));child.stdin.on('error',()=>this.abort('muse_transport_write_failed'));
  child.stderr?.resume();child.on('error',()=>this.abort('muse_transport_failed'));child.on('close',()=>this.abort('muse_transport_closed'));
 }
 consume(data){
  if(this.closed)return;this.buffer+=data;
  if(Buffer.byteLength(this.buffer)>2*1024*1024)return this.abort('muse_transport_frame_limit');
  let cut;while((cut=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,cut);this.buffer=this.buffer.slice(cut+1);if(!line.trim())continue;
   let frame;try{frame=JSON.parse(line);}catch{return this.abort('muse_transport_invalid_json');}
   if(!frame||frame.jsonrpc!=='2.0')return this.abort('muse_transport_invalid_frame');
   if(!frame.method&&Object.hasOwn(frame,'id')){
    const pending=this.pending.get(frame.id);if(!pending)continue;clearTimeout(pending.timer);this.pending.delete(frame.id);
    if(frame.error)pending.reject(fail('muse_rpc_rejected'));else pending.resolve(frame.result);continue;
   }
   if(typeof frame.method!=='string'||!frame.params||typeof frame.params!=='object')return this.abort('muse_transport_invalid_frame');
   if(Object.hasOwn(frame,'id'))this.emit('request',{id:frame.id,method:frame.method,params:frame.params});
   else this.emit('notification',{method:frame.method,params:frame.params});
  }
 }
 write(frame){if(this.closed)throw fail('muse_transport_closed');this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...frame})+'\n');}
 request(method,params){
  if(this.closed)return Promise.reject(fail('muse_transport_closed'));if(this.pending.size>=32)return Promise.reject(fail('muse_transport_request_limit'));
  const id=++this.next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(fail('muse_rpc_timeout'));},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});try{this.write({id,method,...(params===undefined?{}:{params})});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
 }
 receipt(id){this.write({id,result:{}});}
 async initialize({experimentalApi=false}={}){
  const result=await this.request('initialize',{clientInfo:{name:'area2_agent_lab',title:'Area2 Presence Muse harness',version:'m1'},capabilities:{experimentalApi,userInputDialogs:false,requestedCapabilities:[]}});
  if(result?.schema?.version!==1||result?.schema?.fingerprint!==this.fingerprint){this.abort('muse_schema_mismatch');throw fail('muse_schema_mismatch');}
  this.write({method:'initialized'});return {schema:result.schema,serverInfo:result.serverInfo,sandboxAvailability:result.sandboxAvailability??'unknown'};
 }
 async startSession({sessionId=uuid7(),workspace,modelId,providerId,permissionProfile=':ask-me'}){
  if(this.sessionId||!uuid(sessionId)||permissionProfile!==':ask-me')throw fail('muse_session_invalid');this.sessionId=sessionId;this.startCommandId=uuid7();
  try{const result=await this.request('session/start',{sessionId,commandId:this.startCommandId,workspaceRoot:workspace,approvalMode:'onRequest',permissionProfile,...(modelId?{modelId}:{}),...(providerId?{providerId}:{})});
   const session=result?.session;
   if(session?.sessionId!==sessionId||session.workspaceRoot!==workspace||session.parentSessionId||session.forkedFrom||session.sideFrom||!session.path||session.approvalMode?.mode!=='onRequest'||!qualifiedHumanPermission(session.permissionState))throw fail('muse_session_scope_mismatch');
   return session;
  }catch(error){this.abort(error.code??'muse_session_failed');throw error;}
 }
 async startTurn({text,reasoningEffort='high',admit,dispatchGuard=()=>true}){
  if(!this.sessionId||this.closed||this.stopping||this.approvals.size||typeof text!=='string'||!text.trim()||text.length>16000)throw fail('muse_turn_invalid');
  // The caller owns admission and aggregate budgets; unsupported enforcement
  // cannot be bypassed by an HTTP boolean or guessed native config key.
  if(typeof admit!=='function'||await admit()!==true)throw fail('muse_dispatch_not_admitted');
  if(this.closed||this.stopping||dispatchGuard()!==true)throw fail('muse_dispatch_revoked');
  const commandId=uuid7();const result=await this.request('turn/start',{sessionId:this.sessionId,commandId,input:[{type:'text',text}],reasoningEffort});
  if(!uuid(result?.turnId)||result.commandId!==commandId||result.disposition!=='started'||result.startedNewTurn!==true)throw fail('muse_turn_not_started');
  this.turnIds.add(result.turnId);this.activeTurnId=result.turnId;return result.turnId;
 }
 presentApproval(request){
  const p=request.params;
  if(request.method!=='approval/request'||p.sessionId!==this.sessionId||p.turnId!==this.activeTurnId||!reference(p.approvalId)||p.currentRequirementId?.approvalId!==p.approvalId||!Number.isSafeInteger(p.currentRequirementId?.sourceIndex)||p.currentRequirementId.sourceIndex<0||!Array.isArray(p.availableChoices)||p.availableChoices.length>16||p.subagentOrigin)throw fail('muse_approval_scope_mismatch');
  this.approvals.set(p.approvalId,p);this.receipt(request.id);return p;
 }
 updateApproval(params){
  const old=this.approvals.get(params.approvalId);if(!old||old.turnId!==this.activeTurnId||params.sessionId!==this.sessionId)throw fail('muse_approval_scope_mismatch');
  this.approvals.set(params.approvalId,{...old,...params});
 }
 async decideApproval({approvalId,requirementId,choiceId}){
  const p=this.approvals.get(approvalId);
  if(this.stopping||!p||p.turnId!==this.activeTurnId||!isDeepStrictEqual(requirementId,p.currentRequirementId))throw fail('muse_approval_stale');
  const choice=p.availableChoices.find(x=>x.choiceId===choiceId);
  if(!choice||choice.scope!=='once')throw fail('muse_approval_choice_refused');
  const result=await this.request('approval/decide',{sessionId:this.sessionId,approvalId,requirementId:p.currentRequirementId,choiceId,commandId:uuid7()});
  return result; // Remains pending until native approval/resolved or updated.
 }
 resolveApproval(params){
  if(params.sessionId!==this.sessionId||params.turnId!==this.activeTurnId||!reference(params.approvalId)||!['user','policy','llmJudge'].includes(params.resolvedBy))throw fail('muse_approval_scope_mismatch');
  this.approvals.delete(params.approvalId);
 }
 async interrupt(turnId){if(!this.turnIds.has(turnId))throw fail('muse_turn_scope_mismatch');return this.request('turn/interrupt',{sessionId:this.sessionId,turnId,commandId:uuid7()});}
 async stop(turnId){
  this.stopping=true;
  if(this.ownsProcessGroup&&this.child.exitCode===null){
   if(!this.closed&&this.turnIds.has(turnId))await Promise.race([this.interrupt(turnId).catch(()=>{}),new Promise(r=>setTimeout(r,500))]);
   this.child.stdin.end();
   await Promise.race([once(this.child,'close').catch(()=>{}),new Promise(r=>setTimeout(r,250))]);
   if(this.child.exitCode===null)try{process.kill(-this.child.pid,'SIGTERM');}catch{}
   await Promise.race([once(this.child,'close').catch(()=>{}),new Promise(r=>setTimeout(r,750))]);
   if(this.child.exitCode===null)try{process.kill(-this.child.pid,'SIGKILL');}catch{}
  }
  this.abort('muse_owned_host_stopped');
 }
 abort(label){if(this.closed)return;this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(fail(label));}this.pending.clear();this.emit('closed',label);}
}

export function museServeCommand(options){
 const base=museCommand(options);const workspace=base.indexOf('--workspace');if(workspace!==1)throw fail('muse_command_invalid');
 return [base[0],'serve',...base.slice(3),'--contributor-mode','off','--disable-request-user-input',...(options.provider?['--provider',options.provider]:[]),...(options.model?['--model',options.model]:[]),...(options.preset?['--preset',options.preset]:[])];
}
export function spawnMuseMsp({workspace,argv,environment=process.env,requestTimeoutMs}){
 const child=spawn(argv[0],argv.slice(1),{cwd:workspace,env:museEnvironment(workspace,environment),detached:true,stdio:['pipe','pipe','pipe']});
 const client=new MuseMsp({child,requestTimeoutMs});client.ownsProcessGroup=true;return client;
}

// Committed-message identity for Presence provenance. MSP schema says the
// public agentMessage.itemId is the native committed message_id; the
// coordinator observed in an owned 1.4.13 session that committed records
// carry response_id plus a distinct message_id matching model_response_created.
// Neither observation establishes that installed Pre/Post hooks expose all
// fields or that guidance was applied: live qualification is required, and an
// ID match alone never claims behavioral adaptation.
const tokenPattern=/^[A-Za-z0-9_.:-]{1,160}$/;
export function committedMessageIdentity({messageId,responseId}={}){
 if(typeof messageId!=='string'||!tokenPattern.test(messageId))throw Error('muse_committed_message_invalid');
 if(responseId!==undefined&&responseId!==null&&(typeof responseId!=='string'||!tokenPattern.test(responseId)))throw Error('muse_committed_response_invalid');
 return {message_id:messageId,response_id:responseId??null};
}
export function publicItemIdForCommittedMessage(messageId){
 if(typeof messageId!=='string'||!tokenPattern.test(messageId))throw Error('muse_committed_message_invalid');
 return messageId;
}
