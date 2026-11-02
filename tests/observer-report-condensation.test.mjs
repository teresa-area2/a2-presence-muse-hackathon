import test from 'node:test';
import assert from 'node:assert/strict';
import {presenceObserverHtml,mountComparisonReport,mountPresenceObserver,comparisonGuidanceView} from '../web/session-evidence.mjs';
import {inertObserver} from './helpers/observer-state.mjs';

const paragraph='Without explains each conflict step; With gives a shorter handoff while keeping the draft snapshot and one-retry rule. Both saved frozen results passed. The shorter exchange fits the recorded brief guidance, although the archive does not map it to an exact reply.';
const controls={response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'};
function state(){
 const evidence=[{id:'presence.request.with.1',kind:'presence_request',arm:'with',status:'guidance_observed',turn_ordinal:1,ordinal:1,controls}];
 return{status:'ready',session_generation:1,arms:Object.fromEntries(['without','with'].map(arm=>[arm,{status:'ready',messages:[{author:'Muse',phase:'finalAnswer',text:'Saved actual reply'}],approvals:[],questions:[]}])),muse_comparison:{status:'completed',reports:[{status:'completed',at:'2026-11-01T12:00:00.000Z',fingerprint:'test',input_relation:'different_observed_sequence',evidence,report:{paragraph:{text:paragraph,evidence_ids:[]},lanes:['without','with'].map(arm=>({arm,stages:[{kind:'how',text:arm==='with'?'Brief, self-contained guidance was recorded.':'Baseline task instructions; no Presence guidance recorded.',evidence_ids:[]},{kind:'when',text:arm==='with'?'Short handoff retains the requested retry explanation.':'Longer explanation of each conflict step.',evidence_ids:[]},{kind:'what',text:'Both saved check summaries passed; source snapshot unavailable.',evidence_ids:[]}]})),presence:{assessment:'unverified',text:'Shorter replies fit the recorded brief guidance; exact reply attribution is unavailable.',evidence_ids:['presence.request.with.1']}}}]}};
}
test('the built observer leads with a compact overall assessment and keeps audit detail secondary',()=>{
 const html=presenceObserverHtml(),result=html.slice(html.indexOf('data-comparison-result'));
 assert.ok(result.indexOf('data-comparison-paragraph')<result.indexOf('data-comparison-graphic'),'One compact assessment must precede the selected comparison');
 assert.match(result,/Session assessment/);assert.match(result,/data-comparison-paragraph-more/);
 assert.match(html,/data-comparison-summary-layout/);
 assert.match(html,/Presence impact/);
 assert.doesNotMatch(html,/causal effect|does not establish that Presence caused/);
 assert.doesNotMatch(result.slice(0,result.indexOf('data-comparison-audit')),/causal effect and overall quality remain unverified/);
 const telemetry=html.match(/<details[^>]*data-observer-telemetry[^>]*>/)?.[0];assert.ok(telemetry);assert.doesNotMatch(telemetry,/\bopen\b/);
 assert.match(html,/Meta/,'The explicit generation disclosure names the destination');
});
test('missing reply binding keeps the concrete comparison visible and scopes the attribution label',()=>{
 const f=inertObserver(),calls=[],panel=mountComparisonReport(f.container,{enabled:true,post:(...args)=>calls.push(args),onState:()=>{}}),s=state();
 panel.render(s,{connected:true});
 assert.equal(f.nodes['comparison-result'].hidden,false);assert.ok(paragraph.startsWith(f.nodes['comparison-paragraph'].textContent));assert.equal(f.nodes['comparison-paragraph-more'].hidden,false);f.nodes['comparison-paragraph-more'].onclick();assert.equal(f.nodes['comparison-paragraph'].textContent,paragraph);
 assert.match(f.nodes['comparison-verdict'].textContent,/Reply link not recorded/);
 assert.doesNotMatch(f.nodes['comparison-verdict'].textContent,/Evidence insufficient/);
 assert.equal(f.nodes['comparison-presence'].textContent,s.muse_comparison.reports[0].report.presence.text);
 assert.match(f.nodes['comparison-context'].textContent,/Different recorded inputs/);
 assert.equal(f.nodes['comparison-graphic'].children.length,2);
 assert.equal(f.nodes['comparison-graphic'].children[1].children[1].children[1].children[0].textContent,'How');
 for(let i=0;i<3;i++){s.textbox={reading_id:'later-'+i};panel.render(s,{connected:true});}assert.equal(calls.length,0,'Rendering and new readings must not dispatch an interpretation');
});
test('recorded guidance without exact reply proof remains usable comparison evidence',()=>{
 const record=state().muse_comparison.reports[0],view=comparisonGuidanceView(record);
 assert.match(view.text,/brief replies/);assert.match(view.note,/still be compared/);
 assert.doesNotMatch(view.note,/adaptation cannot be verified/);
 assert.deepEqual(view.evidence_ids,['presence.request.with.1']);
});
test('an undecided assessment does not erase an available exact reply link',()=>{
 const f=inertObserver(),s=state(),record=s.muse_comparison.reports[0];
 record.evidence.push({id:'message.with.2',kind:'message',arm:'with',author:'Muse',phase:'finalAnswer'},
  {id:'presence.final.with.1',kind:'completion_link',arm:'with',status:'request_linked',request_id:'presence.request.with.1',message_id:'message.with.2'});
 const panel=mountComparisonReport(f.container,{enabled:true,post:()=>{throw Error('unexpected_call');},onState:()=>{}});panel.render(s,{connected:true});
 assert.match(f.nodes['comparison-verdict'].textContent,/Reply alignment not determined/);
 assert.doesNotMatch(f.nodes['comparison-verdict'].textContent,/link not recorded/);
 assert.match(f.nodes['comparison-linkage'].textContent,/Linked public-reply evidence is available/);
 assert.ok(paragraph.startsWith(f.nodes['comparison-paragraph'].textContent));assert.equal(f.nodes['comparison-paragraph-more'].hidden,false);f.nodes['comparison-paragraph-more'].onclick();assert.equal(f.nodes['comparison-paragraph'].textContent,paragraph);
});
test('the overall assessment replaces duplicate observer panels and keeps row evidence in one Details disclosure',()=>{
 const f=inertObserver(),calls=[],panel=mountPresenceObserver(f.container,{reportEnabled:true,enabled:true,readMetrics:()=>null,post:(...args)=>calls.push(args),onState:()=>{}});
 panel.render(state(),{connected:true});
 assert.equal(f.nodes.live.hidden,true);assert.equal(f.nodes.telemetry.hidden,true);assert.equal(f.nodes.explain.disabled,true);
 assert.equal(f.nodes['comparison-graphic'].children[0].children[0].textContent,'Muse');
 assert.equal(f.nodes['comparison-graphic'].children[1].children[0].textContent,'Muse + Presence');
 assert.equal(f.nodes['comparison-node-sources'].children.length,6);
 assert.ok(f.nodes['comparison-graphic'].children.every(lane=>lane.children[1].children.every(row=>row.children.length===2)),'Source buttons are secondary, not six extra controls in the assessment');
 assert.equal(calls.length,0);panel.close();
});
test('one explicit Presence-impact click freezes evidence and requests one assessment',async()=>{
 const f=inertObserver(),s=state(),calls=[];let panel;
 panel=mountComparisonReport(f.container,{enabled:true,post:async(route,body)=>{calls.push({route,body});return route.endsWith('/preview')?{preview:{id:'frozen-evidence'},state:s}:{state:s};},onState:next=>panel.render(next,{connected:true})});
 panel.render(s,{connected:true});assert.equal(calls.length,0);
 await f.nodes['comparison-prepare'].listeners.click();
 assert.deepEqual(calls.map(c=>c.route),['observer/report/preview','observer/report']);
 assert.deepEqual(calls[1].body,{generation:1,preview_id:'frozen-evidence'});
 panel.render(s,{connected:true});assert.equal(calls.length,2);
 assert.equal(f.nodes['comparison-prepare'].textContent,'See Presence impact');
});
test('a session change while preparing evidence prevents the automatic second request',async()=>{
 const f=inertObserver(),s=state(),calls=[];let release;
 const panel=mountComparisonReport(f.container,{enabled:true,post:async(route,body)=>{calls.push({route,body});return new Promise(resolve=>release=resolve);},onState:()=>{}});
 panel.render(s,{connected:true});const pending=f.nodes['comparison-prepare'].listeners.click();
 await Promise.resolve();panel.render({...s,session_generation:2},{connected:true});release({preview:{id:'old-session'},state:s});await pending;
 assert.equal(calls.length,1);assert.equal(calls[0].route,'observer/report/preview');
});
test('the explicit action saves current display evidence before freezing its JSON',async()=>{
 const f=inertObserver(),s=state(),events=[];let release;
 const panel=mountComparisonReport(f.container,{enabled:true,beforeAssess:()=>new Promise(resolve=>{events.push('save');release=resolve;}),post:async route=>{events.push(route);return{preview:{id:'frozen'},state:s};},onState:()=>{}});
 panel.render(s,{connected:true});const pending=f.nodes['comparison-prepare'].listeners.click();assert.deepEqual(events,['save']);
 release();await pending;assert.deepEqual(events,['save','observer/report/preview','observer/report']);
});
