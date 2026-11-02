import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=text=>createHash('sha256').update(text).digest('hex');
import {ObserverReportHistory,observerHistoryView} from '../src/observer-report-history.mjs';
import {StructuredPair} from '../src/structured-pair.mjs';
import {initializeApprovalProjectionFixture} from './helpers/presence-report-scenarios.mjs';
const ARMS=['without','with'];
const BRIEF={response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'},FULL={response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'};
const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const human=(text,target='both',phase='sent')=>({type:'human_message',payload:{text,message_phase:phase,submission_target:target}});
const final=text=>({type:'public_message',payload:{text,message_phase:'finalAnswer'}});
function delivery(arm,turn,{controls=BRIEF,count=1,linked=true}={}){
 const requests=arm==='with'?Array.from({length:count},(_,i)=>({ordinal:i+1,status:'guidance_observed',read_id:uuid(turn*10+i+1),reading_id:uuid(turn+100),controls:{...controls},receipt_age_seconds:1})):[];
 return{status:arm==='with'?'guidance_observed':'baseline_isolated',turn_ordinal:turn,turn_completed:true,requests_observed:requests.length,public_finals:count,hook_linkage:arm==='with'?'read_marker_matched':'unverified',response_linkage:arm==='with'&&linked?'public_final_matched':'unverified',request_attribution:requests,response_attribution:{status:arm==='with'?'linked':'unverified',linked_responses:requests.length,linked_finals:requests.length,requests:requests.map((_,i)=>({ordinal:i+1,status:'response_linked',presence:'guidance'})),finals:requests.map((_,i)=>({ordinal:i+1,status:'final_linked',request_ordinal:i+1,presence:'guidance'}))}};
}
function native(arm){
 const n={state:'ready',turnId:'PRIVATE_NATIVE_TURN_'+arm+'_1',turnEventStart:1,events:[human('PUBLIC_INPUT_'+arm),{type:'task_status',payload:{kind:'tool',private:'PRIVATE_TOOL_BODY'}},final('PUBLIC_FINAL_'+arm)],client:{sessionId:'PRIVATE_NATIVE_SESSION_'+arm,approvals:new Map()},interruptExpected:new Set(),lastTurnTerminal:'completed',requestedModel:null,activeTurn:()=>null,elapsed:()=>({status:'complete',total_seconds:1}),usage:{snapshot:()=>({status:'not_observed'})},questions:{snapshot:()=>[],metrics:()=>({})}};
 n.raw=delivery(arm,1);n.delivery={current:{sessionId:n.client.sessionId,turnId:n.turnId,ordinal:1},snapshot:()=>structuredClone(n.raw),usage:{snapshot:()=>({status:'not_observed'})}};return n;
}
function fixture(){
 // Exercise the actual application's public/human projection, not a parallel
 // implementation of its message-index convention.
 const pair=initializeApprovalProjectionFixture(Object.assign(Object.create(StructuredPair.prototype),{state:'ready',error:null,comparisonMatched:false,arms:Object.fromEntries(ARMS.map(a=>[a,native(a)]))}));
 const state=()=>({...pair.snapshot(),session_generation:1});return{pair,state};
}
function next(pair,arm,turn,{controls=FULL,linked=true,text='NEXT_PUBLIC_FINAL'}={}){
 const n=pair.arms[arm];n.events.push(human('Next instruction '+turn,arm));n.turnEventStart=n.events.length;n.events.push({type:'task_status',payload:{private:'NEVER_READ'}},{type:'public_message',payload:{text:'Working on it.',message_phase:'commentary'}},final(text));n.turnId='PRIVATE_NATIVE_TURN_'+arm+'_'+turn;n.raw=delivery(arm,turn,{controls,linked});n.delivery.current={sessionId:n.client.sessionId,turnId:n.turnId,ordinal:turn};
}
const view=h=>observerHistoryView(h.snapshot());
const turn=(v,arm,n)=>v.turns.find(x=>x.arm===arm&&x.turn_ordinal===n);

test('two native turns retain changing request guidance with unique exact public-message indexes',()=>{
 const f=fixture(),h=new ObserverReportHistory();h.observe(f.pair,f.state());for(const a of ARMS)next(f.pair,a,2);h.observe(f.pair,f.state());const v=view(h);
 assert.equal(v.turns.length,4);assert.deepEqual(turn(v,'with',1).finals,[{message_index:2,message_sha256:sha('PUBLIC_FINAL_with'),request_ordinal:1,linkage:'request_linked'}]);assert.deepEqual(turn(v,'with',2).finals,[{message_index:5,message_sha256:sha('NEXT_PUBLIC_FINAL'),request_ordinal:1,linkage:'request_linked'}]);assert.deepEqual(turn(v,'without',2).finals,[{message_index:5,message_sha256:sha('NEXT_PUBLIC_FINAL'),request_ordinal:null,linkage:'native_turn_scoped'}]);
 assert.deepEqual(turn(v,'with',1).delivery.request_attribution[0].controls,BRIEF);assert.deepEqual(turn(v,'with',2).delivery.request_attribution[0].controls,FULL);assert.equal(v.coverage.status,'partial');assert.equal(v.coverage.provider_history,'unverified');
});

test('divergent arm ordinals remain separate, rather than inventing paired turn histories',()=>{
 const f=fixture(),h=new ObserverReportHistory();h.observe(f.pair,f.state());next(f.pair,'without',2);h.observe(f.pair,f.state());next(f.pair,'with',3);h.observe(f.pair,f.state());const v=view(h);
 assert.deepEqual(v.turns.filter(x=>x.arm==='without').map(x=>x.turn_ordinal),[1,2]);assert.deepEqual(v.turns.filter(x=>x.arm==='with').map(x=>x.turn_ordinal),[1,3]);assert.equal(turn(v,'with',2),undefined);assert.match(v.coverage.late_evidence,/older late evidence remains unknown/);
});

test('new selected or stale policy never rewrites an earlier recorded request',()=>{
 const f=fixture(),h=new ObserverReportHistory();h.observe(f.pair,f.state());const state=f.state();state.presence={source:{eligible:true,controls:FULL,reading_freshness:'last_known'}};state.textbox={controls:FULL,readings:[{controls:FULL}]};h.observe(f.pair,state);
 assert.deepEqual(turn(view(h),'with',1).delivery.request_attribution[0].controls,BRIEF);
});

test('identical final text is indexed by event position and ordinal proof, never digest-guessed',()=>{
 const f=fixture(),n=f.pair.arms.with,h=new ObserverReportHistory();n.events=[human('Ask once.'),{type:'task_status',payload:{private:'PRIVATE'}},final('Same exact answer'),{type:'task_status',payload:{private:'PRIVATE'}},{type:'public_message',payload:{text:'An update',message_phase:'commentary'}},final('Same exact answer')];n.turnEventStart=1;n.raw=delivery('with',1,{count:2});h.observe(f.pair,f.state());
 assert.deepEqual(turn(view(h),'with',1).finals,[{message_index:2,message_sha256:sha('Same exact answer'),request_ordinal:1,linkage:'request_linked'},{message_index:4,message_sha256:sha('Same exact answer'),request_ordinal:2,linkage:'request_linked'}]);
});

test('incomplete or contradictory response proof never acquires provider-request linkage',()=>{
 for(const change of [d=>d.response_linkage='unverified',d=>d.public_finals=2,d=>d.response_attribution.finals[0].request_ordinal=9,d=>d.response_attribution.requests[0].presence='fallback',d=>d.request_attribution[0].read_id='not-a-read-id']){
  const f=fixture(),h=new ObserverReportHistory();change(f.pair.arms.with.raw);h.observe(f.pair,f.state());assert.deepEqual(turn(view(h),'with',1).finals,[{message_index:2,message_sha256:sha('PUBLIC_FINAL_with'),request_ordinal:null,linkage:'native_turn_scoped'}]);
 }
});

test('baseline finals never become request-linked, even when supplied a With-shaped proof',()=>{
 const f=fixture(),h=new ObserverReportHistory();f.pair.arms.without.raw=delivery('with',1);h.observe(f.pair,f.state());assert.equal(turn(view(h),'without',1).finals[0].linkage,'native_turn_scoped');assert.equal(turn(view(h),'without',1).finals[0].request_ordinal,null);
});

test('snapshot handles are authoritative and detached views cannot edit earlier or later snapshots',()=>{
 const f=fixture(),h=new ObserverReportHistory(),first=h.observe(f.pair,f.state()),copy=observerHistoryView(first);copy.turns[1].delivery.request_attribution[0].controls.response_extent='full';copy.turns[1].finals[0].message_index=999;
 assert.equal(observerHistoryView(first).turns[1].finals[0].message_index,2);assert.equal(observerHistoryView(first).turns[1].delivery.request_attribution[0].controls.response_extent,'terse');next(f.pair,'with',2);h.observe(f.pair,f.state());assert.equal(observerHistoryView(first).turns.length,2);assert.equal(view(h).turns.length,3);
 for(const forged of [structuredClone(first),copy,{},null])assert.throws(()=>observerHistoryView(forged),/observer_history_untrusted/);
});

test('tool/private payloads are never read and raw text/native IDs never enter the history view',()=>{
 const f=fixture(),h=new ObserverReportHistory();let touched=false;for(const a of ARMS){const n=f.pair.arms[a];Object.defineProperty(n.events[1],'payload',{get(){touched=true;throw Error('private body read');}});n.raw.capsule='PRIVATE_CAPSULE';n.raw.native_session_id='PRIVATE_NATIVE_SESSION';if(a==='with')n.raw.request_attribution[0].private_stream='PRIVATE_STREAM';}
 h.observe(f.pair,f.state());const v=view(h),json=JSON.stringify(v);assert.equal(touched,false);assert.equal(v.turns.length,2);for(const marker of ['PUBLIC_INPUT','PUBLIC_FINAL','PRIVATE_NATIVE','PRIVATE_TOOL','PRIVATE_CAPSULE','PRIVATE_STREAM'])assert.ok(!json.includes(marker));
});

test('missing or mismatched native identity cannot grant message indexes',()=>{
 for(const mutate of [n=>n.delivery.current.sessionId=null,n=>n.delivery.current.sessionId='foreign',n=>n.delivery.current.turnId='foreign',n=>n.turnId=undefined]){
  const f=fixture(),h=new ObserverReportHistory();mutate(f.pair.arms.with);h.observe(f.pair,f.state());const v=view(h);assert.equal(turn(v,'with',1),undefined);assert.notEqual(v.coverage.arms.with.source,'observed');
 }
});

test('state/native message disagreement suppresses old indexes until the trusted projection recovers',()=>{
 const f=fixture(),h=new ObserverReportHistory();h.observe(f.pair,f.state());let state=f.state();state.arms.with.messages[0].text='forged text';h.observe(f.pair,state);let v=view(h);assert.deepEqual(turn(v,'with',1).finals,[]);assert.equal(v.coverage.arms.with.last_issue,'state_projection_mismatch');
 h.observe(f.pair,f.state());v=view(h);assert.equal(turn(v,'with',1).finals[0].message_index,2);
 state=f.state();state.arms.with.messages.splice(0,1);h.observe(f.pair,state);assert.deepEqual(turn(view(h),'with',1).finals,[]);
});

test('normalized native/state delivery disagreement is partial and never silently rebound',()=>{
 const f=fixture(),h=new ObserverReportHistory(),state=f.state();state.arms.with.delivery.turn_ordinal=9;h.observe(f.pair,state);const v=view(h);assert.equal(turn(v,'with',1),undefined);assert.equal(v.coverage.arms.with.last_issue,'delivery_snapshot_mismatch');
});

test('late hook evidence upgrades only the still-current turn',()=>{
 const f=fixture(),h=new ObserverReportHistory(),old=f.pair.arms.with.raw;old.response_linkage='unverified';h.observe(f.pair,f.state());assert.equal(turn(view(h),'with',1).finals[0].linkage,'native_turn_scoped');old.response_linkage='public_final_matched';h.observe(f.pair,f.state());assert.equal(turn(view(h),'with',1).finals[0].linkage,'request_linked');assert.equal(view(h).coverage.arms.with.late_attachment_updates,1);
 const g=fixture(),j=new ObserverReportHistory(),earlier=g.pair.arms.with.raw;earlier.response_linkage='unverified';j.observe(g.pair,g.state());next(g.pair,'with',2,{linked:false});j.observe(g.pair,g.state());earlier.response_linkage='public_final_matched';j.observe(g.pair,g.state());assert.equal(turn(view(j),'with',1).finals[0].linkage,'native_turn_scoped');assert.equal(view(j).coverage.arms.with.late_attachment_updates,0);
});

test('legitimate human submission-phase settlement preserves prior final indexes',()=>{
 const f=fixture(),h=new ObserverReportHistory();f.pair.arms.with.events[0].payload.message_phase='attempted';h.observe(f.pair,f.state());f.pair.arms.with.events[0].payload.message_phase='sent';next(f.pair,'with',2);h.observe(f.pair,f.state());const v=view(h);assert.equal(turn(v,'with',1).finals[0].message_index,2);assert.equal(v.coverage.arms.with.source,'observed');
});

test('rewritten public history cannot silently move or replace an earlier final',()=>{
 const f=fixture(),h=new ObserverReportHistory();h.observe(f.pair,f.state());f.pair.arms.with.events[0].payload.text='changed instruction';next(f.pair,'with',2);h.observe(f.pair,f.state());const v=view(h);assert.equal(v.coverage.arms.with.last_issue,'history_prefix_changed');assert.deepEqual(turn(v,'with',1).finals,[]);assert.equal(turn(v,'with',2),undefined);
});

test('retention is bounded per arm, omitted turns explicit, and pair/generation replacement clears history',()=>{
 const f=fixture(),h=new ObserverReportHistory({maxTurns:2});h.observe(f.pair,f.state());for(let n=2;n<5;n++){next(f.pair,'without',n);h.observe(f.pair,f.state());}let v=view(h);assert.deepEqual(v.turns.filter(t=>t.arm==='without').map(t=>t.turn_ordinal),[3,4]);assert.equal(v.coverage.arms.without.turns_omitted,2);assert.equal(v.coverage.arms.with.turns_retained,1);
 const g=fixture();h.observe(g.pair,g.state());v=view(h);assert.equal(v.turns.length,2);assert.equal(v.coverage.arms.without.turns_omitted,0);h.observe(g.pair,{...g.state(),session_generation:2});assert.equal(view(h).turns.length,2);assert.equal(view(h).coverage.arms.without.turns_omitted,0);
 for(const maxTurns of [0,33,-1,1.2])assert.throws(()=>new ObserverReportHistory({maxTurns}),/observer_history_invalid/);
});

test('unavailable sources and new history are explicitly unknown, never complete provider history',()=>{
 const h=new ObserverReportHistory();let v=view(h);assert.equal(v.coverage.status,'unknown');assert.equal(v.coverage.arms.with.source,'unavailable');h.observe(null,{});v=view(h);assert.equal(v.turns.length,0);assert.equal(v.coverage.arms.with.last_issue,'source_unavailable');
});

test('unobserved initial ordinals, later gaps and evictions are counted without double-counting',()=>{
 const f=fixture(),h=new ObserverReportHistory({maxTurns:2});assert.equal(view(h).coverage.arms.with.turns_omitted,null);assert.equal(view(h).coverage.arms.with.turns_unobserved,null);assert.equal(view(h).coverage.arms.with.turns_evicted,0);
 next(f.pair,'with',3);h.observe(f.pair,f.state());let c=view(h).coverage.arms.with;assert.equal(c.turns_unobserved,2);assert.equal(c.turns_evicted,0);assert.equal(c.turns_omitted,2);
 next(f.pair,'with',5);h.observe(f.pair,f.state());h.observe(f.pair,f.state());c=view(h).coverage.arms.with;assert.equal(c.turns_unobserved,3);assert.equal(c.turns_omitted,3);
 next(f.pair,'with',6);h.observe(f.pair,f.state());c=view(h).coverage.arms.with;assert.equal(c.turns_retained,2);assert.equal(c.turns_unobserved,3);assert.equal(c.turns_evicted,1);assert.equal(c.turns_omitted,4);assert.deepEqual(view(h).turns.filter(t=>t.arm==='with').map(t=>t.turn_ordinal),[5,6]);
});

test('malformed request ordering cannot attach a different request’s controls to a final',()=>{
 const f=fixture(),n=f.pair.arms.with,h=new ObserverReportHistory();n.events=[human('One input'),final('First answer'),final('Second answer')];n.turnEventStart=1;n.raw=delivery('with',1,{count:2});n.raw.request_attribution[1].controls=FULL;n.raw.request_attribution.reverse();h.observe(f.pair,f.state());const t=turn(view(h),'with',1);assert.deepEqual(t.finals,[{message_index:2,message_sha256:sha('First answer'),request_ordinal:null,linkage:'native_turn_scoped'},{message_index:3,message_sha256:sha('Second answer'),request_ordinal:null,linkage:'native_turn_scoped'}]);assert.equal(t.delivery.response_linkage,'unverified');
});

test('final text digest verifies a bound index without granting edited views any authority',()=>{
 const f=fixture(),h=new ObserverReportHistory();f.pair.arms.with.events[2].payload.text='abc';const handle=h.observe(f.pair,f.state()),detached=observerHistoryView(handle),known='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
 assert.equal(turn(detached,'with',1).finals[0].message_sha256,known);turn(detached,'with',1).finals[0].message_sha256='f'.repeat(64);turn(detached,'with',1).finals[0].message_index=99;
 assert.equal(turn(observerHistoryView(handle),'with',1).finals[0].message_sha256,known);assert.equal(turn(observerHistoryView(handle),'with',1).finals[0].message_index,2);
});
