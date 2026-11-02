// Extend the reviewed MSP transport without changing the pinned Lab snapshot.
// Only explicit host-provided approval choices are forwarded; modes never change.
import {isDeepStrictEqual} from 'node:util';
import {uuid7,MUSE_MSP_FINGERPRINT} from '../vendor/agent-lab/core/muse-msp.mjs';
import {approvalView} from './approval-view.mjs';
const installed=new WeakSet(),schemas=new Set([MUSE_MSP_FINGERPRINT,'sha256:c94c3d1f2f51e6424074b9ec43eac3eedcf532d3dcd77351ec1383a87d3049c6']);
const ref=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const fail=label=>Object.assign(Error(label),{code:label});
function originValid(origin){return origin===undefined||plain(origin)&&Object.keys(origin).every(k=>['childRunId','childSessionId','subagentId'].includes(k))&&['childRunId','childSessionId','subagentId'].every(k=>ref(origin[k]));}
export function installNativeApprovalAdapter(client){
 if(installed.has(client))return client;
 if(!client||!schemas.has(client.fingerprint)||!(client.approvals instanceof Map)||typeof client.receipt!=='function'||typeof client.request!=='function')throw fail('muse_approval_client_unqualified');
 client.presentApproval=function(request){
  const p=request?.params,r=p?.currentRequirementId;
  if(request?.method!=='approval/request'||!plain(p)||this.closed||this.stopping||p.sessionId!==this.sessionId||p.turnId!==this.activeTurnId||!ref(p.approvalId)||!plain(r)||r.approvalId!==p.approvalId||!Number.isSafeInteger(r.sourceIndex)||r.sourceIndex<0||!Array.isArray(p.availableChoices)||p.availableChoices.length>16||!originValid(p.subagentOrigin)||!this.approvals.has(p.approvalId)&&this.approvals.size>=16)throw fail('muse_approval_scope_mismatch');
  this.approvals.set(p.approvalId,p);this.receipt(request.id);return p;
 };
 client.updateApproval=function(params){
  const old=this.approvals.get(params?.approvalId);
  if(!old||this.closed||this.stopping||old.turnId!==this.activeTurnId||params.sessionId!==this.sessionId||params.turnId!==undefined&&params.turnId!==old.turnId||params.subagentOrigin!==undefined&&!isDeepStrictEqual(params.subagentOrigin,old.subagentOrigin))throw fail('muse_approval_scope_mismatch');
  const next={...old,...params};if(!plain(next.currentRequirementId)||next.currentRequirementId.approvalId!==old.approvalId||!Number.isSafeInteger(next.currentRequirementId.sourceIndex)||next.currentRequirementId.sourceIndex<0||!Array.isArray(next.availableChoices)||next.availableChoices.length>16)throw fail('muse_approval_scope_mismatch');this.approvals.set(params.approvalId,next);
 };
 client.decideApproval=async function({approvalId,requirementId,choiceId,feedback}){
  const p=this.approvals.get(approvalId);
  if(this.closed||this.stopping||!p||p.sessionId!==this.sessionId||p.turnId!==this.activeTurnId||!isDeepStrictEqual(requirementId,p.currentRequirementId))throw fail('muse_approval_stale');
  const view=approvalView(p,{sessionId:this.sessionId,turnId:this.activeTurnId}),choice=view.status==='review'&&view.choices.find(c=>c.choiceId===choiceId);
  if(!choice||feedback!==undefined&&(typeof feedback!=='string'||feedback.length>4000||choice.acceptsFeedback!==true))throw fail('muse_approval_choice_refused');
  return this.request('approval/decide',{sessionId:this.sessionId,approvalId,requirementId:p.currentRequirementId,choiceId,commandId:uuid7(),...(feedback!==undefined?{feedback}:{})});
 };
 client.resolveApproval=function(params){
  const old=this.approvals.get(params?.approvalId);
  if(!old||params.sessionId!==this.sessionId||params.turnId!==this.activeTurnId||old.turnId!==params.turnId||!ref(params.approvalId)||typeof params.resolvedBy!=='string'||!params.resolvedBy||params.resolvedBy.length>160||params.subagentOrigin!==undefined&&!isDeepStrictEqual(params.subagentOrigin,old.subagentOrigin))throw fail('muse_approval_scope_mismatch');
  this.approvals.delete(params.approvalId);
 };
 installed.add(client);return client;
}
