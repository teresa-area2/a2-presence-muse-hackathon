import {presenceObserverHtml} from '../../web/session-evidence.mjs';
export const NOW=Date.parse('2026-11-01T12:00:00Z');
export const READ='11111111-1111-4111-8111-111111111111',READING='22222222-2222-4222-8222-222222222222',NEW='33333333-3333-4333-8333-333333333333';
export const controls={response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'};
export const newer={response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'};
export const metrics={schema_version:1,held_current:1,held_total:3,released_manual:1,released_automatic:1,history_resets:0,coverage:'observed'};
export function observerState(){
 const model={requested_model:'muse-wonder-1.0',observed_models:['muse-wonder-1.0'],requests_observed:1,unidentified_requests:0,status:'observed'};
 const state={session_generation:1,status:'ready',comparison:{matched_context:true},arms:{},presence:{source:{eligible:true,controls:newer,read_at:new Date(NOW).toISOString()}},textbox:{reading_id:NEW,readings_omitted:0,readings:[{reading_id:READING,generated_at:new Date(NOW-181000).toISOString(),received_at:new Date(NOW-180000).toISOString(),controls},{reading_id:NEW,generated_at:new Date(NOW-2000).toISOString(),received_at:new Date(NOW-1000).toISOString(),controls:newer}]},measurement:{actions:{},turn_actions:{},review:{arms:{without:{effort_rating:2,interruption_count:2},with:{effort_rating:4,interruption_count:1}}}}};
 for(const arm of ['without','with']){
  state.arms[arm]={status:'ready',last_turn_terminal:'completed',model,usage:{status:'observed',source:'native',model_calls:arm==='with'?2:1,input_tokens:arm==='with'?150:100,output_tokens:arm==='with'?60:80,cache_read_tokens:0},interactions:{enabled:true,questions_presented:arm==='with'?1:0},messages:[{author:'Muse',phase:'finalAnswer',text:'OLDER_PRIVATE_RESPONSE'}, {author:'You',phase:'sent',text:'PRIVATE_USER_MESSAGE exact format must remain local'}, {author:'Muse',phase:'finalAnswer',text:arm==='with'?'## Next step\n1. Keep the **current draft**.\n2. Fetch the saved version.\n\n```js\n// # PRIVATE_CODE_QUESTION?\n```':'Keep the current draft.\n\nFetch the saved version.'}],delivery:{status:arm==='with'?'guidance_observed':'baseline_isolated',turn_ordinal:2,turn_completed:true,requests_observed:1,public_finals:1}};
  for(const role of ['participant','coordinator','unattributed']){state.measurement.actions[role]??={arms:{}};state.measurement.actions[role].arms[arm]={approval_decisions:role==='participant'?2:0};state.measurement.turn_actions[role]??={};state.measurement.turn_actions[role][arm]={interrupt_accepted:role==='participant'&&arm==='with'?1:0};}
 }
 Object.assign(state.arms.with.delivery,{hook_linkage:'read_marker_matched',response_linkage:'public_final_matched',request_attribution:[{ordinal:1,status:'guidance_observed',read_id:READ,reading_id:READING,controls,receipt_age_seconds:180,collaboration_contract:{version:2,status:'matched',added_utf8_bytes:340}}],response_attribution:{status:'linked',linked_responses:1,linked_finals:1,requests:[{ordinal:1,status:'response_linked',presence:'guidance'}],finals:[{ordinal:1,status:'final_linked',request_ordinal:1,presence:'guidance'}]}});
 return state;
}
class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.textContent='';this.hidden=false;this.listeners={};}
 append(...nodes){this.children.push(...nodes);}removeChild(node){this.children=this.children.filter(x=>x!==node);}replaceChildren(...nodes){this.children=[...nodes];}
 addEventListener(type,fn){this.listeners[type]=fn;}setAttribute(key,value){this[key]=value;}set innerHTML(_){throw Error('unsafe_html');}
}
export function inertObserver(){
 const nodes={};for(const match of presenceObserverHtml().matchAll(/data-(observer|comparison)-([a-z-]+)/g))nodes[(match[1]==='observer'?'':'comparison-')+match[2]]??=new Node();
 const document={createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('fragment'),createTextNode:text=>Object.assign(new Node('text'),{textContent:text})},container=new Node();container.ownerDocument=document;container.querySelector=selector=>nodes[(()=>{const m=/data-(observer|comparison)-([a-z-]+)/.exec(selector);return m?(m[1]==='observer'?'':'comparison-')+m[2]:'';})()]??null;
 for(const node of Object.values(nodes))node.ownerDocument=document;
 return{container,nodes,document};
}
