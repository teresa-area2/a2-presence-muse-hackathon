import {renderMarkdown} from './transcript-notice.mjs';
import {presenceView,receiptAgeLabel,captureHint} from './terminal-presence-view.mjs';
import {terminalUsageView} from './terminal-usage-view.mjs';
const arms=['without','with'];
export function sharedSendReady(state,connected,pending,uncertain,text){return connected===true&&!pending&&!uncertain&&state?.status==='ready'&&arms.every(a=>state.arms?.[a]?.status==='ready'&&(state.arms[a].approvals??[]).length===0)&&typeof text==='string'&&!!text.trim()&&text.length<=14000;}
export function messageKind(value){return value?.author==='You'?'You':'Muse';}
export function messageLabel(value){const author=messageKind(value);if(author==='You'&&value?.phase==='attempted')return 'You · sending';if(author==='You'&&value?.phase==='unconfirmed')return 'You · delivery unconfirmed';if(author==='Muse'&&value?.phase==='commentary')return 'Muse · update';return author;}
export function emptyConversationLabel(status){return ({ready:'Ready for your first shared message.',closed:'Session closed.',running:'Muse is working…',approval:'Waiting for your approval.',failed:'Session unavailable. Check the status above.',starting:'Opening session…'})[status]??'Open both sessions to begin.';}
export function stopReady(state,connected,token,stopping,confirmed){const status=state?.status??'idle';return typeof token==='string'&&token.length>0&&!stopping&&!confirmed&&!['stopping','closed'].includes(status)&&(!connected||['opening','ready','failed'].includes(status));}
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id);
 let token=null,state=null,connected=false,pending=false,uncertain=false,stopping=false,stopConfirmed=false,pulse=null,previousReceipt=null,simulated=false,startEnabled=true;
 const approvalBusy=new Map(),messageKeys={},approvalKeys={};
 const warn=value=>{$('fault').textContent=value;$('fault').hidden=!value;};
 const explainError=()=>warn('The action could not be confirmed. Do not retry until the session has been checked or stopped.');
 async function post(action,body={}){const r=await fetch('/api/'+action,{method:'POST',headers:{'content-type':'application/json','x-terminal-token':token},credentials:'same-origin',body:JSON.stringify(body)});let result;try{result=await r.json();}catch{throw Error('invalid_response');}if(!r.ok)throw Error('action_failed');return result;}
 function updatePresence(){
  const value=connected?state?.presence:null,source=value?.source??null,view=presenceView(value,previousReceipt);previousReceipt=view.change;
  $('presence-status').textContent=view.capture+' · '+view.reading+' · '+receiptAgeLabel(source);
  $('presence-policy').textContent=(view.reading==='Last eligible guidance'?'Last policy: ':'Policy: ')+view.policy;
  const c=view.controls;const label=x=>x?x.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase()):'—';
  $('policy-heading').textContent=c?(view.reading==='Last eligible guidance'?'Last source policy':'Source policy'):'No current source policy';
  $('policy-depth').textContent=label(c?.response_extent);$('policy-updates').textContent=label(c?.unsolicited_update);$('policy-conversation').textContent=label(c?.conversation_style);
  const pulseSource=simulated&&source&&!source.renderer?{...source,renderer:'coding-instructions.3'}:source;
  $('presence-help').textContent=captureHint(source);pulse?.update(['Eligible guidance','Last eligible guidance'].includes(view.reading)?pulseSource:null);
 }
 function renderMessages(name,messages){
  const rows=Array.isArray(messages)?messages:[],armStatus=state?.arms?.[name]?.status,key=JSON.stringify([rows,armStatus]);if(messageKeys[name]===key)return;messageKeys[name]=key;
  const target=$('conversation-'+name),atBottom=target.scrollHeight-target.scrollTop-target.clientHeight<40,previousTop=target.scrollTop;target.replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.className='placeholder';p.textContent=emptyConversationLabel(armStatus);target.append(p);return;}
  for(const row of rows){if(typeof row?.text!=='string')continue;const e=document.createElement('div'),label=document.createElement('div'),body=document.createElement('div');e.className='entry';label.className='entry-label';body.className='entry-body';label.textContent=messageLabel(row);if(messageKind(row)==='You')body.textContent=row.text;else body.append(renderMarkdown(document,row.text));e.append(label,body);target.append(e);}
  target.scrollTop=atBottom?target.scrollHeight:previousTop;
 }
 function approvalSignature(p){return JSON.stringify([p?.requirementId,p?.choices]);}
 function renderApprovals(name,approvals,force=false){
  const rows=Array.isArray(approvals)?approvals:[],key=JSON.stringify([rows,connected,state?.status,pending,uncertain,Array.from(approvalBusy.entries())]);if(!force&&approvalKeys[name]===key)return;approvalKeys[name]=key;
  const target=$('approvals-'+name);target.replaceChildren();
  for(const p of rows){const box=document.createElement('section');box.className='approval';box.setAttribute('aria-label','Approval for '+(name==='with'?'With Presence':'Without Presence'));
   const title=document.createElement('strong');title.textContent='Approval requested';box.append(title);
   if(p?.status!=='review'||typeof p.command!=='string'||!Array.isArray(p.choices)){const body=document.createElement('p');body.textContent='This approval cannot be displayed safely here. Use Stop at the top of the page to end the sessions before deciding what to do next.';box.append(body);target.append(box);continue;}
   const command=document.createElement('pre');command.textContent=p.command;box.append(command);const controls=document.createElement('div');controls.className='approval-buttons';
   for(const choice of p.choices){if(typeof choice?.choiceId!=='string'||typeof choice.label!=='string')continue;const button=document.createElement('button');button.type='button';button.textContent=choice.label;const key=name+':'+p.approvalId;button.disabled=!connected||pending||uncertain||state?.status!=='ready'||approvalBusy.has(key);button.addEventListener('click',async()=>{
    if(button.disabled||approvalBusy.has(key))return;approvalBusy.set(key,approvalSignature(p));renderApprovals(name,rows,true);
    try{const out=await post('decide',{arm:name,approvalId:p.approvalId,requirementId:p.requirementId,choiceId:choice.choiceId});render();}
    catch{explainError();} // Do not repeat an uncertain approval decision.
   });controls.append(button);}box.append(controls);target.append(box);
  }
 }
 function render(){
  const status=state?.status??'idle',labels={idle:'Not started',ready:'Ready',starting:'Starting',running:'Working',approval:'Approval needed',failed:'Failed',stopping:'Stopping',closed:'Closed'};
  for(const name of arms){const arm=state?.arms?.[name],activity=arm?.status==='running'&&typeof arm.activity?.tool==='string'?' · '+arm.activity.tool+' '+(arm.activity.status==='inProgress'?'running':arm.activity.status):'';$('state-'+name).textContent=(labels[arm?.status]??(status==='idle'?'Not started':'Unavailable'))+activity;renderMessages(name,arm?.messages);const rows=Array.isArray(arm?.approvals)?arm.approvals:[];for(const [key,sig] of approvalBusy){if(!key.startsWith(name+':'))continue;const p=rows.find(a=>name+':'+a.approvalId===key);if(!p||approvalSignature(p)!==sig)approvalBusy.delete(key);}renderApprovals(name,rows);}
  $('start').disabled=!connected||pending||status!=='idle'||!startEnabled;$('stop').disabled=!stopReady(state,connected,token,stopping,stopConfirmed);$('send').disabled=!sharedSendReady(state,connected,pending,uncertain,$('message').value);
  const usage=terminalUsageView(state);for(const name of arms)for(const label of ['calls','input','output','cache'])$(label+'-'+name).textContent=usage.values[name][label];
  $('mode').textContent=!connected?'Connection unavailable. Messages are not sent.':status==='idle'&&!startEnabled?'Live coding approvals are not qualified yet. Sessions cannot start.':status==='idle'?'Open both sessions to start.':status==='ready'?(simulated?'Simulated conversations · Presence and responses are examples.':'Two separate Muse sessions · only the right receives Presence.'):'Session status: '+status.replaceAll('_',' ')+'.';
  updatePresence();
 }
 $('message').addEventListener('input',render);
 $('start').addEventListener('click',async()=>{if($('start').disabled)return;pending=true;render();try{await post('start');}catch{uncertain=true;explainError();}finally{pending=false;render();}});
 $('stop').addEventListener('click',async()=>{if($('stop').disabled)return;stopping=true;uncertain=true;render();try{const result=await post('stop');if(result?.state?.status==='closed'&&result.state.error!=='cleanup_unconfirmed'){stopConfirmed=true;warn('Sessions stopped.');}else warn('Stop requested; session cleanup is not yet confirmed.');}catch{warn('Stopping the sessions could not be confirmed. You can try Stop again.');}finally{stopping=false;render();}});
 $('send-form').addEventListener('submit',async e=>{e.preventDefault();const value=$('message').value;if(!sharedSendReady(state,connected,pending,uncertain,value))return;pending=true;$('send-status').textContent='Sending to both sessions…';render();try{const out=await post('submit',{text:value});if(out?.outcome?.status==='started'){if($('message').value===value)$('message').value='';$('send-status').textContent='Sent to both sessions.';}else{uncertain=true;$('send-status').textContent='The paired send was not confirmed. Check the sessions before trying again.';}}catch{uncertain=true;$('send-status').textContent='The paired send could not be confirmed. Check the sessions before trying again.';}finally{pending=false;render();}});
 async function events(){
  const response=await fetch('/api/events',{headers:{'x-terminal-token':token},cache:'no-store',credentials:'same-origin'});if(!response.ok||!response.body)throw Error('events_unavailable');connected=true;render();const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  for(;;){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true}).replaceAll('\r\n','\n');if(buffer.length>2*1024*1024)throw Error('stream_limit');let i;while((i=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,i);buffer=buffer.slice(i+2);const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)continue;const event=JSON.parse(data);if(event?.type==='status'&&event.state){state=event.state;render();}}}
  throw Error('events_closed');
 }
 async function init(){
  try{const module=await import('/lab/pulse.mjs');pulse=module.mountPulse($('pulse'));const copy=$('pulse').querySelector('.pulse-copy');if(copy)copy.hidden=true;const art=$('pulse').querySelector('.pulse-art');if(art)art.setAttribute('aria-hidden','true');}catch{}
  const response=await fetch('/api/config',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw Error('config_unavailable');const config=await response.json();if(typeof config.token!=='string')throw Error('invalid_config');token=config.token;state=config.state;startEnabled=config.startEnabled===true;simulated=config.fixture===true;$('fixture').hidden=!simulated;if(simulated&&typeof config.fixtureLabel==='string'&&config.fixtureLabel)$('fixture').textContent=config.fixtureLabel;
  if(config.taskBrief&&typeof config.taskBrief.title==='string'){$('task').hidden=false;$('task-title').textContent=config.taskBrief.title;$('task-description').textContent=typeof config.taskBrief.description==='string'?config.taskBrief.description:'';}
  if(typeof config.taskPrompt==='string')$('message').value=config.taskPrompt;render();await events();
 }
 setInterval(updatePresence,1000);
 init().catch(()=>{connected=false;uncertain=true;render();warn('The connection is unavailable. Messages and approvals are not sent automatically.');});
}
