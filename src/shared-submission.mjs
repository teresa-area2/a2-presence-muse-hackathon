// Human-authored input goes to an exact owned turn, or starts a ready session.
// A stale steer is never queued or retried as a new turn. Unknown new-turn
// admission retains the existing conservative pair shutdown boundary.
const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(x);
const names=['without','with'];
export class SharedSubmission {
 constructor({arms,makeId,onPartial,isAdmitted=()=>true}){if(!arms||typeof makeId!=='function'||typeof onPartial!=='function'||typeof isAdmitted!=='function'||names.some(n=>!arms[n]||!validId(arms[n].sessionId)||typeof arms[n].request!=='function'||typeof arms[n].ready!=='function'||typeof arms[n].prepare!=='function'||typeof arms[n].bindTurn!=='function'))throw Error('shared_submission_invalid');this.arms=arms;this.makeId=makeId;this.onPartial=onPartial;this.isAdmitted=isAdmitted;this.busy=false;this.locked=false;}
 preflight(text,target='both',options={}){
  if(!names.includes(target)&&target!=='both')throw Error('shared_submission_invalid_target');
  if(this.busy||this.locked||typeof text!=='string'||!text.trim()||text.length>14000||!this.isAdmitted())throw Error('shared_submission_not_admitted');
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='expectedTurns'))throw Error('turn_action_invalid');
  const selected=target==='both'?[...names]:[target],explicit=Object.hasOwn(options,'expectedTurns'),expected=options.expectedTurns;
  if(explicit&&(!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).length!==selected.length||Object.keys(expected).some(n=>!selected.includes(n))||selected.some(n=>!Object.hasOwn(expected,n)||expected[n]!==null&&!validId(expected[n]))))throw Error('turn_action_invalid');
  return Object.fromEntries(selected.map(n=>{const arm=this.arms[n],ready=arm.ready()===true,current=arm.activeTurn?.()??null;if(ready){if(explicit&&expected[n]!==null)throw Error('turn_action_stale');return[n,{mode:'start',turnId:null}];}if(!validId(current)){if(explicit)throw Error('turn_action_stale');throw Error('shared_sessions_not_ready');}if(!explicit)throw Error('shared_sessions_not_ready');if(expected[n]!==current)throw Error('turn_action_stale');return[n,{mode:'steer',turnId:current}];}));
 }
 async submit(text,target='both',options={}){
  const plan=this.preflight(text,target,options),selected=Object.keys(plan);this.busy=true;
  try{
   let stopping=null;const revoke=()=>{this.locked=true;stopping??=Promise.resolve().then(()=>this.onPartial());return stopping;};
   try{for(const n of selected){if(!this.isAdmitted())throw Error('dispatch_revoked');if(plan[n].mode==='start')this.arms[n].prepare();}}catch{await revoke();return {status:'partial_or_unconfirmed',arms:Object.fromEntries(selected.map(n=>[n,{status:'unknown'}]))};}
   const jobs=selected.map(async name=>{
    const arm=this.arms[name],p=plan[name];if(this.locked||!this.isAdmitted())return{status:'unknown'};
    if(p.mode==='steer'&&arm.activeTurn?.()!==p.turnId)return{status:'not_started'};
    const commandId=this.makeId();if(!validId(commandId))return{status:'unknown'};
    let result;try{result=await arm.request(p.mode==='steer'?'turn/steer':'turn/start',{sessionId:arm.sessionId,commandId,input:[{type:'text',text}],...(p.mode==='steer'?{expectedTurnId:p.turnId}:{ifBusy:'queue'})});}catch(e){return{status:p.mode==='steer'&&e?.message==='muse_rpc_rejected'?'not_started':'unknown'};}
    if(!result||result.commandId!==commandId||result.status!=='accepted'||!validId(result.turnId))return{status:'unknown'};
    if(p.mode==='steer')return{status:result.turnId===p.turnId&&!this.locked&&this.isAdmitted()?'steered':'unknown'};
    if(result.disposition==='started'&&result.startedNewTurn===true){try{if(this.locked||!this.isAdmitted())return{status:'unknown'};arm.bindTurn(result.turnId);return{status:!this.locked&&this.isAdmitted()?'started':'unknown'};}catch{return{status:'unknown'};}}
    if(result.disposition==='queued'&&result.startedNewTurn===false){void revoke();const cancelId=this.makeId();if(!validId(cancelId))return{status:'queued_unknown'};try{const out=await arm.request('turn/unqueue',{sessionId:arm.sessionId,commandId:cancelId,turnId:result.turnId});return out?.status==='accepted'&&out.commandId===cancelId&&out.turnId===result.turnId?{status:'unqueued'}:{status:'queued_unknown'};}catch{return{status:'queued_unknown'};}}
    return{status:'unknown'};
   }).map((job,i)=>job.then(result=>{if(plan[selected[i]].mode==='start'&&result.status!=='started')void revoke();return result;},()=>{if(plan[selected[i]].mode==='start')void revoke();return{status:'unknown'};}));
   const outcomes=await Promise.all(jobs),complete=!this.locked&&this.isAdmitted()&&outcomes.every(x=>['started','steered'].includes(x.status));if(this.locked)await revoke();
   return{status:complete?(outcomes.some(x=>x.status==='steered')?'forwarded':'started'):outcomes.every(x=>x.status==='not_started')?'not_started':'partial_or_unconfirmed',arms:Object.fromEntries(selected.map((n,i)=>[n,outcomes[i]]))};
  }finally{this.busy=false;}
 }
}
