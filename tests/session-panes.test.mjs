import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSessionPane} from '../web/session-panes.mjs';

// Inert DOM: exercises the real pane renderer and click callbacks without a browser.
class Node {
 constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.children=[];this.attrs={};this.events={};this._text='';this.scrollTop=0;this.scrollHeight=500;this.clientHeight=500;}
 set textContent(text){this._text=String(text);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
 insertBefore(node,before){if(node===before)return node;node.remove();const index=before===null?this.children.length:this.children.indexOf(before);if(index<0)throw Error('missing_child');this.children.splice(index,0,node);node.parentNode=this;return node;}
 remove(){if(this.parentNode){const children=this.parentNode.children,index=children.indexOf(this);if(index>=0)children.splice(index,1);this.parentNode=null;}}
 replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this._text='';this.children=[];this.append(...nodes);}
 setAttribute(name,value){this.attrs[name]=String(value);}
 addEventListener(name,listener){this.events[name]=listener;}
 click(){if(!this.disabled)this.events.click?.({});}
 focus(){}
}
const doc={createElement:tag=>new Node(tag,doc),createDocumentFragment:()=>new Node('fragment',doc),createTextNode:text=>{const n=new Node('#text',doc);n.textContent=text;return n;}};
const walk=(node,check)=>[...(check(node)?[node]:[]),...node.children.flatMap(child=>walk(child,check))];
const now=Date.parse('2026-10-28T12:00:00Z');
const source=()=>({source:{eligible:true,read_at:new Date(now).toISOString(),received_at:new Date(now-600000).toISOString(),capture:{state:'collecting'},controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'}}});
const rows=()=>[
 {author:'You',phase:'sent',text:'TASK'},
 {author:'Muse',phase:'commentary',text:'OPTIONAL_ONE'},
 {author:'Muse',phase:'commentary',text:'ESSENTIAL_DECISION',decisionNeeded:true},
 {author:'System',phase:'commentary',text:'UNKNOWN_MANDATORY'},
 {author:'Muse',phase:'finalAnswer',text:'FINAL_ANSWER'}
];
const approval=()=>({status:'review',review_token:'a'.repeat(64),approvalId:'a',requirementId:{approvalId:'a',sourceIndex:0},command:'node --test',choices:[{choiceId:'once',label:'Allow once',decision:'approved',scope:'once'},{choiceId:'reject',label:'Reject',decision:'denied',scope:'once'}]});
function fixture(arm='with'){
 const container=new Node('div',doc),messages=rows();
 let state={status:'ready',session_generation:1,presence:source(),arms:{[arm]:{status:'approval',messages,approvals:[approval()]}}},options={connected:true,pendingDecisions:new Map(),now};
 const questionDecisions=[],replies=[],decisions=[],pane=mountSessionPane({container,arm,onQuestion:(...args)=>questionDecisions.push(args),onReplyQuestion:(...args)=>replies.push(args),onDecide:(...args)=>decisions.push(args),onChange:()=>pane.render(state,options)});
 pane.render({...state,arms:{[arm]:{status:'ready',messages:[],approvals:[]}}},options);
 return {container,pane,decisions,questionDecisions,replies,get state(){return state;},render(change={},opts={}){state={...state,...change};options={...options,...opts};pane.render(state,options);},text:()=>container.textContent,buttons:()=>walk(container,n=>n.tag==='button')};
}
test('only optional Muse updates hold; finals, unknown rows, essential decisions and approvals remain',()=>{
 const f=fixture();f.render();assert.match(f.text(),/1 optional update held/);assert.ok(!f.text().includes('OPTIONAL_ONE'));
 for(const text of ['TASK','ESSENTIAL_DECISION','UNKNOWN_MANDATORY','FINAL_ANSWER','node --test','Allow once','Reject'])assert.ok(f.text().includes(text),text);
 f.buttons().find(b=>b.textContent==='Allow once').click();assert.equal(f.decisions.length,1);assert.equal(f.decisions[0][0],'with');
});
test('baseline renders ordinary updates without ever reading Presence',()=>{
 const f=fixture('without'),state={status:'ready',session_generation:1,arms:f.state.arms};
 Object.defineProperty(state,'presence',{get(){throw Error('baseline_presence_read');}});
 f.pane.render(state,{connected:true,pendingDecisions:new Map(),now});assert.match(f.text(),/OPTIONAL_ONE/);assert.ok(!f.text().includes('held'));
});
test('clock-only expiry releases in original order and a later defer cannot hide released rows',()=>{
 const f=fixture();f.render();f.render({}, {now:now+21001});assert.match(f.text(),/OPTIONAL_ONE/);assert.ok(!f.text().includes('optional update held'));
 assert.ok(f.text().indexOf('TASK')<f.text().indexOf('OPTIONAL_ONE'));assert.ok(f.text().indexOf('OPTIONAL_ONE')<f.text().indexOf('FINAL_ANSWER'));
 f.render({presence:source()},{now});assert.match(f.text(),/OPTIONAL_ONE/);
 const arm={...f.state.arms.with,messages:[...f.state.arms.with.messages,{author:'Muse',phase:'commentary',text:'OPTIONAL_TWO'}]};
 f.render({arms:{with:arm}});assert.match(f.text(),/OPTIONAL_ONE/);assert.ok(!f.text().includes('OPTIONAL_TWO'));assert.match(f.text(),/1 optional update held/);
});
test('Show now releases current updates; a newly arriving update can still defer',()=>{
 const f=fixture();f.render();f.buttons().find(b=>b.textContent==='Show now').click();assert.match(f.text(),/OPTIONAL_ONE/);assert.ok(!f.text().includes('optional update held'));
 f.render({arms:{with:{...f.state.arms.with,messages:[...f.state.arms.with.messages,{author:'Muse',phase:'commentary',text:'OPTIONAL_TWO'}]}}});
 assert.match(f.text(),/OPTIONAL_ONE/);assert.ok(!f.text().includes('OPTIONAL_TWO'));
});
test('send, ineligible, missing source, disconnect and closed pair release updates immediately',()=>{
 const variants=[{presence:{source:{...source().source,controls:{...source().source.controls,unsolicited_update:'send'}}}},{presence:{source:{...source().source,eligible:false}}},{presence:null},{status:'closed'}];
 for(const change of variants){const f=fixture();f.render();f.render(change);assert.match(f.text(),/OPTIONAL_ONE/);assert.ok(!f.text().includes('optional update held'));}
 const f=fixture();f.render();f.render({}, {connected:false});assert.match(f.text(),/OPTIONAL_ONE/);assert.ok(f.buttons().filter(b=>b.textContent==='Allow once').every(b=>b.disabled));
});
test('new session generation resets only transient presentation state',()=>{
 const f=fixture();f.render();f.buttons().find(b=>b.textContent==='Show now').click();f.render({session_generation:2,arms:{with:{...f.state.arms.with,messages:rows()}}});
 assert.ok(!f.text().includes('OPTIONAL_ONE'));assert.match(f.text(),/1 optional update held/);
});
test('receipt-age ticks do not recreate approval buttons or disturb their focus',()=>{
 const f=fixture();f.render();const before=f.buttons().find(b=>b.textContent==='Allow once');f.render({}, {now:now+1000});
 assert.equal(f.buttons().find(b=>b.textContent==='Allow once'),before);
});

test('both panes show real ongoing work after a message without creating a Muse reply',()=>{
 for(const arm of ['without','with']){const f=fixture(arm);f.render({arms:{[arm]:{status:'running',active_turn_id:'turn',messages:[{author:'You',phase:'sent',text:'TASK'}],approvals:[],activity:null}}});const status=walk(f.container,n=>n.className==='session-placeholder session-work-status')[0];assert.ok(status);assert.equal(status.hidden,false);assert.match(status.textContent,/Muse is working/);assert.equal(walk(f.container,n=>n.className==='session-entry').length,1);const events=f.pane.presentation().events;assert.ok(events.every(e=>e.kind==='message'));}
});
test('an empty running pane shows only one activity indicator and never claims current work after disconnect',()=>{
 const f=fixture();f.render({arms:{with:{status:'running',active_turn_id:'turn',messages:[],approvals:[]}}});assert.equal((f.text().match(/Muse is working/g)??[]).length,1);f.render({}, {connected:false});assert.ok(!f.text().includes('Muse is working'));assert.match(f.text(),/Disconnected/);
});
test('activity-only changes update the work status; ready or disconnected sessions never look busy',()=>{
 const f=fixture(),session={status:'running',active_turn_id:'turn',messages:[{author:'You',phase:'sent',text:'TASK'}],approvals:[],activity:{tool:'bash',status:'inProgress'}};f.render({arms:{with:session}});const status=walk(f.container,n=>n.className==='session-placeholder session-work-status')[0];assert.match(status.textContent,/bash.*in progress/);f.render({arms:{with:{...session,activity:{tool:'bash',status:'completed'}}}});assert.match(status.textContent,/bash.*completed/);f.render({}, {connected:false});assert.equal(status.hidden,true);f.render({arms:{with:{...session,status:'ready'}}},{connected:true});assert.equal(status.hidden,true);assert.equal(status.textContent,'');
});
test('working indicator ignores private activity fields and unreviewable tool names',()=>{
 const f=fixture();f.render({arms:{with:{status:'running',messages:[{author:'You',phase:'sent',text:'TASK'}],approvals:[],activity:{tool:'bash\u202eSENSITIVE_TOOL',status:'completed',args:'SENSITIVE_ARGUMENTS',reasoning:'SENSITIVE_REASONING'}}}});const status=walk(f.container,n=>n.className==='session-placeholder session-work-status')[0];assert.ok(status);assert.equal(status.textContent,'Muse is working…');assert.ok(!f.text().includes('SENSITIVE_'));
});
test('resolved native stage awaiting confirmation has a non-actionable pending card in either pane',()=>{
 for(const arm of ['without','with']){const f=fixture(arm);f.render({arms:{[arm]:{status:'approval',active_turn_id:'turn',messages:[],approval_decision_pending:true,approvals:[{status:'decision_pending',decision_pending:true,approvalId:'a',requirementId:{approvalId:'a',sourceIndex:0}}]}}});assert.match(f.text(),/Confirming decision/);assert.match(f.text(),/waiting for Muse/);assert.ok(!f.text().includes('not yet supported'));assert.equal(f.buttons().length,0);}
});
test('pending transition invalidates a stale Allow once button without hiding another unsupported request',()=>{
 const f=fixture();f.render();const old=f.buttons().find(b=>b.textContent==='Allow once');f.render({arms:{with:{...f.state.arms.with,approval_decision_pending:true,approvals:[{status:'decision_pending',decision_pending:true,approvalId:'a',requirementId:{approvalId:'a',sourceIndex:0}},{status:'unsupported',reason:'unsupported_subject'}]}}});old.click();assert.equal(f.decisions.length,0);assert.match(f.text(),/Confirming decision/);assert.match(f.text(),/not yet supported/);assert.equal(f.buttons().filter(b=>b.textContent==='Interrupt this agent').length,1);
});
test('a pending card cannot reuse the preceding generic unsupported card',()=>{
 const f=fixture();f.render({arms:{with:{status:'approval',active_turn_id:'turn',messages:[],approvals:[{status:'unsupported',reason:'unknown'}]}}});assert.match(f.text(),/No decision can be sent/);f.render({arms:{with:{status:'approval',active_turn_id:'turn',messages:[],approvals:[{status:'decision_pending',decision_pending:true,approvalId:'a',requirementId:{approvalId:'a',sourceIndex:0}}]}}});assert.match(f.text(),/Confirming decision/);assert.ok(!f.text().includes('No decision can be sent'));
});

test('rendered decisions describe held updates and mandatory approvals without content',()=>{
 const f=fixture();f.render();const p=f.pane.presentation();
 assert.equal(p.source,'browser_current_display_policy');assert.equal(p.coverage,'observed');
 assert.ok(p.events.some(e=>e.kind==='message'&&e.ordinal===2&&e.event==='held'&&e.reason==='defer'));
 assert.ok(p.events.some(e=>e.kind==='approval'&&e.event==='shown'&&e.reason==='mandatory'));
 assert.ok(p.events.some(e=>e.kind==='message'&&e.ordinal===5&&e.event==='shown'&&e.reason==='mandatory'));
 const n=p.events.length;f.render({}, {now:now+1000});assert.equal(f.pane.presentation().events.length,n);
 for(const secret of ['OPTIONAL_ONE','FINAL_ANSWER','node --test','approvalId'])assert.ok(!JSON.stringify(p).includes(secret));
});
test('display-time release reasons distinguish manual, send, fallback and disconnect',()=>{
 for(const cause of ['manual','send','fallback','disconnected']){
  const f=fixture();f.render();
  if(cause==='manual')f.buttons().find(b=>b.textContent==='Show now').click();
  if(cause==='send')f.render({presence:{source:{...source().source,controls:{...source().source.controls,unsolicited_update:'send'}}}},{now:now+1});
  if(cause==='fallback')f.render({presence:null},{now:now+1});
  if(cause==='disconnected')f.render({}, {connected:false,now:now+1});
  const release=f.pane.presentation().events.filter(e=>e.event==='released');
  assert.equal(release.length,1);assert.equal(release[0].ordinal,2);assert.equal(release[0].reason,cause);
 }
});
test('baseline records shown rows without consulting Presence',()=>{
 const f=fixture('without');const state={status:'ready',session_generation:1,arms:f.state.arms};
 Object.defineProperty(state,'presence',{get(){throw Error('baseline_presence_read')}});
 f.pane.render(state,{connected:true,pendingDecisions:new Map(),now});
 assert.ok(f.pane.presentation().events.every(e=>e.event==='shown'&&e.controls===null));
 assert.equal(f.pane.presentation().arm,'without');
});
test('a rewritten history is partial and never invents releases for removed updates',()=>{
 const f=fixture();f.render();const before=f.pane.presentation().events.length;
 f.render({arms:{with:{...f.state.arms.with,messages:[{author:'Muse',phase:'finalAnswer',text:'replacement'}]}}},{now:now+1});
 const p=f.pane.presentation();assert.equal(p.history_epoch,1);assert.equal(p.coverage,'partial');
 assert.ok(p.events.slice(before).every(e=>e.event!=='released'));
});


test('human acknowledgments repaint delivery labels without resetting either pane journal',()=>{
 for(const arm of ['without','with']){
  const f=fixture(arm),messages=rows().map((row,index)=>index===0?{...row,phase:'attempted'}:row);
  const state={status:'ready',session_generation:1,arms:{[arm]:{...f.state.arms[arm],messages}}};
  if(arm==='without')Object.defineProperty(state,'presence',{get(){throw Error('baseline_presence_read')}});
  else state.presence=source();
  const options={connected:true,pendingDecisions:new Map(),now};
  f.pane.render(state,options);assert.match(f.text(),/You · sending/);
  const first=f.pane.presentation();
  for(const [index,phase]of ['sent','steered','not_sent','unconfirmed','sent'].entries()){
   const next={...state,arms:{[arm]:{...state.arms[arm],messages:messages.map((row,i)=>i===0?{...row,phase}:row)}}};
   if(arm==='without')Object.defineProperty(next,'presence',{get(){throw Error('baseline_presence_read')}});
   f.pane.render(next,{...options,now:now+index+1});
   assert.equal(f.text().includes('You · sending'),false);
   assert.equal(f.text().includes('You · unconfirmed'),phase==='unconfirmed');assert.equal(f.text().includes('You · steering'),phase==='steered');assert.equal(f.text().includes('You · not sent'),phase==='not_sent');
   assert.deepEqual(f.pane.presentation(),first);
   if(arm==='with'){
    assert.ok(!f.text().includes('OPTIONAL_ONE'));assert.equal(f.pane.metrics().held_current,1);
    assert.equal(f.pane.metrics().history_resets,0);
   }
  }
 }
});

test('genuine content and optional-type changes still reset either pane journal',()=>{
 for(const arm of ['without','with'])for(const change of [
  messages=>messages.map((row,index)=>index===0?{...row,text:'Different task'}:row),
  messages=>messages.map((row,index)=>index===1?{...row,phase:'finalAnswer'}:row),
  messages=>messages.map((row,index)=>index===1?{...row,mandatory:true}:row),
 ]){
  const f=fixture(arm);f.render();const before=f.pane.presentation();
  f.render({arms:{[arm]:{...f.state.arms[arm],messages:change(f.state.arms[arm].messages)}}},{now:now+1});
  const after=f.pane.presentation();assert.equal(after.history_epoch,1);assert.equal(after.coverage,'partial');
  assert.ok(after.events.length>before.events.length);
 }
});


const nativeQuestion=()=>({userInputId:'prompt-1',turnId:'turn-1',questions:[{id:'recovery',header:'Recovery',question:'Which recovery experience should we use?',selection:{mode:'single'},options:[{label:'Inline notice',description:'Keep editing.'},{label:'Review dialog',description:'Stop to resolve.'}]}]});
test('native questions remain visible under defer and offer choices or the same message composer',()=>{
 const f=fixture();f.render({arms:{with:{...f.state.arms.with,status:'question',approvals:[],questions:[nativeQuestion()]}}});
 assert.match(f.text(),/Which recovery experience/);assert.ok(!f.text().includes('OPTIONAL_ONE'));assert.match(f.text(),/Muse · question/);
 f.buttons().find(b=>b.textContent==='Inline notice').click();assert.deepEqual(f.questionDecisions[0],['with',nativeQuestion(),{action:'answer',answers:[{questionId:'recovery',selectedLabel:'Inline notice'}]}]);
 f.buttons().find(b=>b.textContent==='Reply in message box').click();assert.deepEqual(f.replies[0],['with',nativeQuestion()]);
 f.buttons().find(b=>b.textContent==='Skip question').click();assert.deepEqual(f.questionDecisions[1],['with',nativeQuestion(),{action:'cancel'}]);
});
test('disconnected or pending question controls cannot send or auto-select an answer',()=>{
 const f=fixture();f.render({arms:{with:{...f.state.arms.with,status:'question',approvals:[],questions:[nativeQuestion()]}}},{connected:false});
 assert.match(f.text(),/Which recovery experience/);assert.ok(f.buttons().filter(b=>['Inline notice','Review dialog','Skip question','Reply in message box'].includes(b.textContent)).every(b=>b.disabled));assert.equal(f.questionDecisions.length,0);
});


test('mounting a recovered conversation shows existing updates while new updates may be held',()=>{
 const container=new Node('div',doc),pane=mountSessionPane({container,arm:'with',onDecide:()=>{}});
 const state={status:'ready',session_generation:8,presence:source(),arms:{with:{status:'ready',messages:rows(),approvals:[]}}};
 const options={connected:true,pendingDecisions:new Map(),now};pane.render(state,options);
 assert.match(container.textContent,/OPTIONAL_ONE/);assert.equal(pane.metrics().held_current,0);
 state.arms.with.messages.push({author:'Muse',phase:'commentary',text:'NEW_OPTIONAL'});pane.render(state,options);
 assert.match(container.textContent,/OPTIONAL_ONE/);assert.ok(!container.textContent.includes('NEW_OPTIONAL'));assert.equal(pane.metrics().held_current,1);
});


test('new transcript updates keep the active approval button mounted and usable',()=>{
 for(const arm of ['without','with']){
  const f=fixture(arm);f.render();const button=f.buttons().find(b=>b.textContent==='Allow once');
  const messages=[...f.state.arms[arm].messages,{author:'Muse',phase:'commentary',text:'LATER_UPDATE'}];
  f.render({arms:{[arm]:{...f.state.arms[arm],messages}}});
  assert.equal(f.buttons().find(b=>b.textContent==='Allow once'),button,'background updates must not replace the pressed control');
  button.click();assert.equal(f.decisions.length,1);assert.equal(f.decisions[0][0],arm);
 }
});
test('another arm decision does not replace this pane approval controls',()=>{
 const f=fixture();f.render();const button=f.buttons().find(b=>b.textContent==='Allow once');
 f.render({}, {pendingDecisions:new Map([['without:other','pending']])});
 assert.equal(f.buttons().find(b=>b.textContent==='Allow once'),button);
});
test('retired approval controls check the latest requirement before dispatching',()=>{
 const f=fixture();f.render();const button=f.buttons().find(b=>b.textContent==='Allow once');
 f.render({arms:{with:{...f.state.arms.with,approvals:[{...approval(),requirementId:{approvalId:'a',sourceIndex:1}}]}}});
 button.click();assert.equal(f.decisions.length,0,'a detached older request must not be submitted');
});

test('approval controls retain identity while disabling on disconnect or pending decision',()=>{
 const f=fixture();f.render();const button=f.buttons().find(b=>b.textContent==='Allow once');
 for(const options of [{connected:false},{connected:true,pendingDecisions:new Map([['with:a','pending']])}]){
  f.render({},options);assert.equal(f.buttons().find(b=>b.textContent==='Allow once'),button);assert.equal(button.disabled,true);button.click();assert.equal(f.decisions.length,0);
 }
 f.render({}, {connected:true,pendingDecisions:new Map()});assert.equal(button.disabled,false);
});
test('an old generation approval cannot act on identical IDs reused by a new pair',()=>{
 const f=fixture();f.render();const old=f.buttons().find(b=>b.textContent==='Allow once');
 f.render({session_generation:2});old.click();assert.equal(f.decisions.length,0);
 const current=f.buttons().find(b=>b.textContent==='Allow once');assert.notEqual(current,old);current.click();assert.equal(f.decisions.length,1);
});

test('global closure disables unchanged approval buttons immediately',()=>{
 const f=fixture('without');f.render();const button=f.buttons().find(b=>b.textContent==='Allow once');
 f.render({status:'closed'});assert.equal(f.buttons().find(b=>b.textContent==='Allow once'),button);assert.equal(button.disabled,true);button.click();assert.equal(f.decisions.length,0);
});
test('adding or removing a different pending approval preserves this control',()=>{
 const f=fixture();f.render();const button=f.buttons().find(b=>b.textContent==='Allow once');
 const other={...approval(),approvalId:'b',requirementId:{approvalId:'b',sourceIndex:0},command:'node check.mjs'};
 f.render({arms:{with:{...f.state.arms.with,approvals:[approval(),other]}}});
 assert.equal(f.buttons().find(b=>b.textContent==='Allow once'),button);
 f.render({arms:{with:{...f.state.arms.with,approvals:[approval()]}}});assert.equal(f.buttons().find(b=>b.textContent==='Allow once'),button);
});

test('a removed approval control cannot revive when identical requirements return',()=>{
 const f=fixture();f.render();const old=f.buttons().find(b=>b.textContent==='Allow once');
 f.render({arms:{with:{...f.state.arms.with,approvals:[]}}});
 f.render({arms:{with:{...f.state.arms.with,approvals:[approval()]}}});
 old.click();assert.equal(f.decisions.length,0);f.buttons().find(b=>b.textContent==='Allow once').click();assert.equal(f.decisions.length,1);
});
test('missing initial session state renders disconnected placeholder without throwing',()=>{
 for(const arm of ['without','with']){const container=new Node('div',doc),pane=mountSessionPane({container,arm,onDecide:()=>assert.fail('unexpected decision')});
  assert.doesNotThrow(()=>pane.render(null,{connected:false,pendingDecisions:new Map()}));assert.match(container.textContent,/Open the sessions/);
 }
});
