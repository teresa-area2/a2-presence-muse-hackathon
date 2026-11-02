// Supported MSP question transport; presentation receipts never grant authority.
import {createHash} from 'node:crypto';
import {uuid7} from '../vendor/agent-lab/core/muse-msp.mjs';
import {initializeMuseProtocol} from './muse-protocol.mjs';
const ref=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=(x,max=2097152)=>typeof x==='string'&&x.trim().length>0&&[...x].length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x);
const clone=x=>structuredClone(x),bad=()=>{throw Error('user_input_invalid');};
const ordered=x=>Array.isArray(x)?x.map(ordered):record(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
const fingerprint=x=>createHash('sha256').update(JSON.stringify(ordered(x))).digest('hex');
const command=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
export async function initializeNativeQuestions(client,{experimentalApi=true}={}){
 return initializeMuseProtocol(client,{experimentalApi,userInputDialogs:true});
}
function prompt(value,sessionId,turnId){
 if(!record(value)||value.sessionId!==sessionId||value.turnId!==turnId||!ref(value.userInputId)||!ref(value.itemId)||!ref(value.toolCallId)||!ref(value.toolName)||!text(value.viewCursor,512)||!Array.isArray(value.questions)||value.questions.length<1||value.questions.length>3)bad();
 const seen=new Set(),questions=value.questions.map(q=>{
  if(!record(q)||!text(q.id,64)||seen.has(q.id)||!text(q.header,12)||!text(q.question)||!record(q.selection)||!['single','multiple'].includes(q.selection.mode)||!Array.isArray(q.options)||q.options.length<2||q.options.length>3)bad();seen.add(q.id);
  const labels=new Set(),options=q.options.map(o=>{if(!record(o)||!text(o.label,80)||labels.has(o.label)||o.description!==undefined&&(typeof o.description!=='string'||[...o.description].length>240))bad();labels.add(o.label);const p={label:o.label,...(o.description!==undefined?{description:o.description}:{})};if(o.preview!==undefined){if(q.selection.mode!=='single'||!record(o.preview)||!text(o.preview.format,80)||!text(o.preview.content,2000))bad();p.preview={format:o.preview.format,content:o.preview.content};}return p;});
  const selection={mode:q.selection.mode};if(selection.mode==='single'){if(q.selection.minSelections!==undefined||q.selection.maxSelections!==undefined)bad();}else{const min=q.selection.minSelections??1,max=q.selection.maxSelections??options.length;if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<0||max<min||max>options.length)bad();if(q.selection.minSelections!==undefined)selection.minSelections=min;if(q.selection.maxSelections!==undefined)selection.maxSelections=max;}
  return{id:q.id,header:q.header,question:q.question,selection,options};
 });
 if(value.autoResolutionMs!==undefined&&(!Number.isSafeInteger(value.autoResolutionMs)||value.autoResolutionMs<0))bad();
 const result={sessionId,turnId,userInputId:value.userInputId,itemId:value.itemId,toolCallId:value.toolCallId,toolName:value.toolName,viewCursor:value.viewCursor,questions,...(value.autoResolutionMs!==undefined?{autoResolutionMs:value.autoResolutionMs}:{})};if(Buffer.byteLength(JSON.stringify(result))>2097152)bad();return result;
}
function answers(value,questions,partial=false){
 if(!Array.isArray(value)||value.length>(questions?.length??3)||!partial&&value.length!==questions.length)bad();const seen=new Set();
 return value.map(a=>{if(!record(a)||Object.keys(a).some(k=>!['questionId','selectedLabel','selectedLabels','freeText','note'].includes(k))||!text(a.questionId,64)||seen.has(a.questionId))bad();seen.add(a.questionId);const q=questions.find(q=>q.id===a.questionId);if(!q)bad();const keys=['selectedLabel','selectedLabels','freeText'].filter(k=>Object.hasOwn(a,k));if(keys.length!==1)bad();const k=keys[0],out={questionId:a.questionId};
  if(k==='selectedLabel'){if(q.selection.mode!=='single'||!q.options.some(o=>o.label===a[k]))bad();out[k]=a[k];}
  else if(k==='selectedLabels'){const v=a[k],min=q.selection.minSelections??1,max=q.selection.maxSelections??q.options.length;if(q.selection.mode!=='multiple'||!Array.isArray(v)||new Set(v).size!==v.length||v.length<min||v.length>max||v.some(label=>!q.options.some(o=>o.label===label)))bad();out[k]=v.slice();}
  else{if(!text(a.freeText,500))bad();out.freeText=a.freeText;}
  if(a.note!==undefined){if(typeof a.note!=='string'||[...a.note].length>500)bad();out.note=a.note;}return out;
 });
}
function clarification(value){const content=typeof value==='string'?value:value?.format==='text'?value.content:null;if(!text(content,500)||record(value)&&Object.keys(value).some(k=>!['format','content'].includes(k)))bad();return{format:'text',content};}
export class MuseUserInput{
 constructor({client,enabled=false,makeId=uuid7,onChange=()=>{}}){if(typeof enabled!=='boolean'||!ref(client?.sessionId)||typeof makeId!=='function'||typeof onChange!=='function'||enabled&&(typeof client.request!=='function'||typeof client.receipt!=='function'))throw Error('user_input_configuration_invalid');this.client=client;this.enabled=enabled;this.makeId=makeId;this.onChange=onChange;this.turnId=null;this.pending=new Map();this.known=new Map();this.settled=new Map();this.busy=new Set();this.engaged=new Set();this.closed=false;this.counts={questions_presented:0,questions_answered:0,questions_clarified:0,questions_cancelled:0,questions_timed_out:0,questions_aborted:0,questions_interrupted:0,questions_settled_unknown:0,questions_closed_locally:0};}
 bindTurn(turnId){if(this.closed||!ref(turnId)||this.pending.size)throw Error('user_input_turn_invalid');this.turnId=turnId;}
 present(value,{requestId,allowNew=true}={}){
  if(!this.enabled||this.closed)throw Error('user_input_unavailable');if(requestId!==undefined&&!(typeof requestId==='string'&&text(requestId,160))&&!(Number.isSafeInteger(requestId)&&requestId>=0))bad();let fresh=false;const p=prompt(value,this.client.sessionId,this.turnId),key=fingerprint(p),known=this.known.get(p.userInputId);
  if(known&&known.digest!==key)throw Error('user_input_changed');if(!known&&!this.settled.has(p.userInputId)){if(!allowNew||this.known.size>=128||this.pending.size>=32)throw Error('user_input_scope_invalid');this.known.set(p.userInputId,{digest:key,count:p.questions.length,turnId:p.turnId});this.pending.set(p.userInputId,p);this.counts.questions_presented+=p.questions.length;fresh=true;}
  if(requestId!==undefined)this.client.receipt(requestId);this.changed();return fresh;
 }
 settle(value){
  if(!this.enabled||this.closed||!record(value)||value.sessionId!==this.client.sessionId||!ref(value.userInputId)||!ref(value.outcome))throw Error('user_input_settlement_invalid');const p=this.pending.get(value.userInputId),known=this.known.get(value.userInputId);if(p&&p.turnId!==this.turnId)throw Error('user_input_scope_invalid');const outcome=value.outcome,rawAnswers=value.answers??[];let safeAnswers=[];
  if(!Array.isArray(rawAnswers)||rawAnswers.length>3)bad();if(p&&(outcome==='answered'||outcome==='interrupted'))safeAnswers=answers(rawAnswers,p.questions,outcome==='interrupted');else if(rawAnswers.length&&p)bad();
  const c=outcome==='clarified'?clarification(value.clarification):null,key=fingerprint({outcome,answers:p?safeAnswers:rawAnswers,clarification:c});const old=this.settled.get(value.userInputId);if(old){if(old!==key)throw Error('user_input_settlement_changed');return null;}if(this.settled.size>=128)throw Error('user_input_capacity');this.settled.set(value.userInputId,key);
  if(p){const suffix={answered:'answered',clarified:'clarified',cancelled:'cancelled',timedOut:'timed_out',aborted:'aborted',interrupted:'interrupted'}[outcome]??'settled_unknown';this.counts['questions_'+suffix]+=p.questions.length;this.pending.delete(value.userInputId);}this.busy.delete(value.userInputId);this.engaged.delete(value.userInputId);this.changed();return p?{prompt:clone(p),outcome,answers:clone(safeAnswers),clarification:c}:null;
 }
 async respond(value){
  if(!this.enabled||this.closed||this.client.closed||this.client.stopping||!record(value)||Object.keys(value).some(k=>!['userInputId','action','answers','clarification'].includes(k)))throw Error('user_input_unavailable');const p=this.pending.get(value.userInputId);if(!p||p.turnId!==this.turnId)throw Error('user_input_not_pending');if(value.action==='engage'){if(Object.hasOwn(value,'answers')||Object.hasOwn(value,'clarification'))bad();if(!this.engaged.has(p.userInputId)){if(typeof this.client.write!=='function')throw Error('user_input_client_unqualified');this.client.write({method:'userInput/engaged',params:{sessionId:this.client.sessionId,userInputId:p.userInputId}});this.engaged.add(p.userInputId);}return{status:'notified',userInputId:p.userInputId};}if(this.busy.has(value.userInputId))throw Error('user_input_not_pending');const id=this.makeId();if(!command(id))throw Error('user_input_command_invalid');const params={sessionId:this.client.sessionId,userInputId:p.userInputId,commandId:id};
  if(value.action==='answer'){if(Object.hasOwn(value,'clarification'))bad();params.answers=answers(value.answers,p.questions);}
  else if(value.action==='clarify'){if(Object.hasOwn(value,'answers'))bad();params.clarification=clarification(value.clarification);}
  else if(value.action==='cancel'){if(Object.hasOwn(value,'answers')||Object.hasOwn(value,'clarification'))bad();}
  else bad();this.busy.add(p.userInputId);this.changed();
  try{const out=await this.client.request('userInput/'+value.action,params);if(this.closed||out?.status!=='accepted'||out.commandId!==id||out.userInputId!==p.userInputId)throw Error('user_input_command_unconfirmed');return out;}catch(e){this.busy.delete(p.userInputId);this.changed();const label=e instanceof Error&&typeof e.message==='string'&&/^[a-z_]{1,80}$/.test(e.message)?e.message:'user_input_command_unconfirmed';const failure=Error(label);Object.defineProperty(failure,'nativeDispatchAttempted',{value:true});throw failure;}
 }
 knows(id){return this.known.has(id)||this.settled.has(id);}
 get size(){return this.pending.size;}
 snapshot(){return [...this.pending.values()].map(p=>({userInputId:p.userInputId,turnId:p.turnId,questions:clone(p.questions),busy:this.busy.has(p.userInputId),...(p.autoResolutionMs!==undefined?{autoResolutionMs:p.autoResolutionMs}:{})}));}
 metrics(){return{enabled:this.enabled,...this.counts,pending_questions:[...this.pending.values()].reduce((n,p)=>n+p.questions.length,0)};}
 endTurn(){if(this.closed)return;this.counts.questions_closed_locally+=[...this.pending.values()].reduce((n,p)=>n+p.questions.length,0);this.pending.clear();this.busy.clear();this.engaged.clear();this.turnId=null;this.changed();}
 close(){if(this.closed)return;this.endTurn();this.closed=true;this.changed();}
 changed(){try{this.onChange();}catch{}}
}
