import test from 'node:test';
import assert from 'node:assert/strict';
import {createObserverProgress,observerProgressReplies} from '../src/observer-comparison.mjs';
import {observerState,inertObserver} from './helpers/observer-state.mjs';
import {mountPresenceObserver,presenceObserverHtml} from '../web/session-evidence.mjs';
const full={response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'};
const NEW='33333333-3333-4333-8333-333333333333';
function next(s,turn){for(const arm of ['with','without']){s.arms[arm].delivery.turn_ordinal=turn;s.arms[arm].messages.push({author:'Muse',phase:'finalAnswer',text:arm==='with'?'What changed: implementation details.\n\nCost: linear space and time for the new object.\n\nVerification: supplied checks only; no new execution.':'Done.'});}Object.assign(s.arms.with.delivery.request_attribution[0],{reading_id:NEW,controls:full});}

test('running and one-sided completion show progress, never old finals or held commentary',()=>{
 const s=observerState(),p=createObserverProgress();
 for(const a of Object.values(s.arms)){a.status='running';a.delivery.turn_completed=false;a.delivery.public_finals=0;a.messages.push({author:'Muse',phase:'commentary',text:'HELD_PRIVATE_UPDATE'});}
 let v=p.observe(s);assert.match(v.summary,/working/);assert.ok(observerProgressReplies(v).every(x=>x.text===null));
 s.arms.with.status='ready';s.arms.with.delivery.turn_completed=true;s.arms.with.delivery.public_finals=1;
 v=p.observe(s);assert.match(v.summary,/With has finished/);assert.equal(observerProgressReplies(v)[0].text,null);assert.ok(!JSON.stringify(observerProgressReplies(v)).includes('HELD_PRIVATE_UPDATE'));
});

test('completed moments retain actual paired replies locally and describe linked guidance changes',()=>{
 const s=observerState(),p=createObserverProgress(),first=p.observe(s);assert.equal(first.moments.length,1);const initial=first.latest_key;
 next(s,3);const v=p.observe(s);assert.equal(v.moments.length,2);assert.match(v.summary,/brief to full/);assert.match(v.summary,/became longer/);assert.match(v.summary,/cost and verification sections/);assert.match(observerProgressReplies(v,initial)[1].text,/current draft/);assert.match(observerProgressReplies(v)[1].text,/linear space/);
 assert.ok(!JSON.stringify(v).includes('linear space'));assert.ok(!JSON.stringify(v).includes('PRIVATE'));assert.deepEqual(observerProgressReplies(structuredClone(v)),[]);
});

test('a newer current reading cannot retroactively explain a reply',()=>{
 const p=createObserverProgress(),s=observerState(),v=p.observe(s);assert.match(v.summary,/brief, self contained/);assert.doesNotMatch(v.summary,/changed from|full, conversational/);assert.match(v.moments[0].link,/earlier reading/);
});

test('unverified proof still permits local final display but no Presence adaptation claim',()=>{
 for(const mutate of [s=>s.arms.with.delivery.response_linkage='unverified',s=>s.arms.without.delivery.status='baseline_contaminated',s=>s.arms.with.delivery.turn_ordinal=3,s=>s.arms.with.model.status='partial']){
  const s=observerState();mutate(s);const v=createObserverProgress().observe(s);assert.equal(v.moments[0].paired,false);assert.doesNotMatch(v.summary,/Its final request used|Guidance changed/);assert.match(observerProgressReplies(v)[1].text,/current draft/);
 }
});

test('ordinary fallback and cancellation do not reuse earlier guidance',()=>{
 const s=observerState(),p=createObserverProgress();p.observe(s);next(s,3);const d=s.arms.with.delivery;
 Object.assign(d.request_attribution[0],{status:'fallback_observed',reading_id:null,controls:null});d.response_attribution.requests[0].presence='fallback';d.response_attribution.finals[0].presence='fallback';
 let v=p.observe(s);assert.match(v.summary,/ordinary fallback/);assert.doesNotMatch(v.summary,/brief to full/);
 s.arms.with.last_turn_terminal='cancelled';d.public_finals=0;d.turn_completed=false;v=p.observe(s);assert.match(v.summary,/interrupted/);assert.equal(observerProgressReplies(v)[1].text,null);
});

test('generation reset clears retained moments; completed local history is bounded',()=>{
 const s=observerState(),p=createObserverProgress();p.observe(s);for(let turn=3;turn<18;turn++){next(s,turn);p.observe(s);}let v=p.observe(s);assert.equal(v.moments.length,8);
 s.session_generation++;for(const arm of ['without','with'])s.arms[arm]={status:'not_started',messages:[]};v=p.observe(s);assert.equal(v.moments.length,1);assert.ok(observerProgressReplies(v).every(x=>x.text===null));
});

test('optional observer renders without requesting an explanation and stays collapsed in diagnostics',()=>{
 const f=inertObserver(),posts=[],panel=mountPresenceObserver(f.container,{readMetrics:()=>null,post:async(...args)=>posts.push(args),onState:()=>{},enabled:false,recordingEnabled:false});
 panel.render(observerState(),{connected:true});assert.equal(f.nodes.replies.children.length,2);assert.match(f.nodes['progress-summary'].textContent,/With gives/);assert.deepEqual(posts,[]);assert.equal(f.container.open,false);
 const html=presenceObserverHtml();assert.match(html,/<details[^>]+id="presence-observer" hidden>/);assert.match(html,/<details class="observer-evidence" data-observer-telemetry>/);assert.ok(!/<details[^>]*data-observer-telemetry[^>]*open/.test(html));panel.close();
});

test('pending start cannot relabel an old completed reply or erase the retained moment',()=>{
 const s=observerState(),p=createObserverProgress(),before=p.observe(s);for(const a of Object.values(s.arms))a.status='starting';
 const pending=p.observe(s);assert.equal(pending.moments.length,2);assert.ok(observerProgressReplies(pending).every(x=>x.text===null));assert.match(observerProgressReplies(pending,before.latest_key)[1].text,/current draft/);
});

test('adding a moment preserves the existing navigation button for keyboard focus',async()=>{
 const {renderObserverProgress}=await import('../web/session-evidence.mjs');const f=inertObserver(),s=observerState(),p=createObserverProgress();let v=p.observe(s);renderObserverProgress(f.container,v);const first=f.nodes.moments.children[0];
 next(s,3);v=p.observe(s);renderObserverProgress(f.container,v);assert.equal(f.nodes.moments.children[0],first);assert.equal(f.nodes.moments.children.length,2);
});

test('one arm progressing preserves the other arm’s unchanged reply DOM for reading',async()=>{
 const {renderObserverProgress}=await import('../web/session-evidence.mjs'),f=inertObserver(),s=observerState(),p=createObserverProgress();s.arms.without.status='running';s.arms.without.delivery.public_finals=0;s.arms.without.delivery.turn_completed=false;
 let v=p.observe(s);renderObserverProgress(f.container,v);const withArticle=f.nodes.replies.children[1],body=withArticle.children[2];s.arms.without.status='approval';v=p.observe(s);renderObserverProgress(f.container,v);assert.equal(f.nodes.replies.children[1],withArticle);assert.equal(f.nodes.replies.children[1].children[2],body);
});

test('section-like labels inside an unclosed code fence do not become observer claims',()=>{
 const s=observerState();s.arms.with.messages.at(-1).text='```js\nCost: example string\nVerification: example string';const v=createObserverProgress().observe(s);assert.doesNotMatch(v.summary,/explicit cost|explicit verification/);
});


test('mount restores the observer to its diagnostics host without changing the main workspace',async()=>{
 const {placeObserverLayout}=await import('../web/session-evidence.mjs'),f=inertObserver(),workspace={unchanged:true},results={kind:'results'};
 const effort={id:'session-measurement'},utilities={children:[effort],append(node){node.parentNode=this;this.children.push(node);}},telemetry={querySelector:()=>results,before(node){this.restored=node;},remove(){this.removed=true;}};
 f.container.parentNode=workspace;f.document.querySelector=selector=>selector==='#session-utilities'?utilities:selector==='[data-workspace-telemetry]'?telemetry:null;
 placeObserverLayout(f.container);assert.equal(f.container.parentNode,utilities);assert.deepEqual(utilities.children,[effort,f.container]);assert.equal(f.container.open,false);assert.deepEqual(workspace,{unchanged:true});assert.equal(telemetry.restored,results);assert.equal(telemetry.removed,true);
});
