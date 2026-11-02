import test from 'node:test';
import assert from 'node:assert/strict';
import {buildObserverExperience,observerLocalEvidence,projectObserverExperience} from '../src/observer-comparison.mjs';
import {buildObserverEvidence,observerPrompt,observerExperience,validateObserverSelection} from '../src/presence-observer.mjs';
import {PresenceObserverService} from '../src/presence-observer-service.mjs';
import {presenceObserverHtml,mountPresenceObserver,projectObserverReports,registerObserverReport,renderObserverExperience} from '../web/session-evidence.mjs';

import {NOW,READ,READING,NEW,controls,newer,metrics,observerState,inertObserver} from './helpers/observer-state.mjs';
export {observerState,inertObserver} from './helpers/observer-state.mjs';
const dimension=(v,id)=>v.dimensions.find(x=>x.id===id);

test('six dimensions connect latest scoped finals to request-time reading, not the new policy',()=>{
 const state=observerState(),v=buildObserverExperience(state,{metrics,now:NOW});
 assert.equal(v.paired,true);assert.equal(v.dimensions.length,6);assert.match(v.paragraph,/Presentation differs/);assert.match(v.link,/turn 2, final 1 → request 1 → reading 1/);assert.match(v.link,/receipt age 180s/);assert.match(v.link,/terse.*self contained/);assert.match(v.link,/different reading is selected now/);assert.match(v.link,/hints v2 matched/);assert.match(v.source,/full.*conversational/);
 const quotes=observerLocalEvidence(v);assert.equal(quotes.length,2);assert.ok(!JSON.stringify(quotes).includes('OLDER_PRIVATE_RESPONSE'));assert.ok(!JSON.stringify(quotes).includes('PRIVATE_USER_MESSAGE'));assert.ok(JSON.stringify(quotes).includes('current draft'));
 assert.match(dimension(v,'presentation').with,/2 numbered/);assert.match(dimension(v,'presentation').with,/1 emphasis/);assert.match(dimension(v,'conversation').with,/0 prose question/);assert.equal(dimension(v,'depth').status,'unverified');assert.match(dimension(v,'resources').summary,/input tokens increased by 50/);assert.match(dimension(v,'resources').summary,/output tokens decreased by 20/);assert.match(dimension(v,'resources').detail,/Cumulative session/);
 assert.match(dimension(v,'interaction').with,/1 native question.*2 approval decisions/);assert.match(dimension(v,'interruptions').with,/1 reported.*1 accepted hard/);assert.match(dimension(v,'interruptions').summary,/3 optional updates held/);assert.match(dimension(v,'interruptions').detail,/separate/);
 assert.ok(!JSON.stringify(v).includes('PRIVATE'));assert.deepEqual(observerLocalEvidence(structuredClone(v)),[],'forged references cannot retrieve quotes');
});

test('last-known source is separate from request age and fallback does not reuse its reading',()=>{
 const state=observerState();state.textbox.reading_id=READING;state.textbox.reading_freshness='last_known';Object.assign(state.presence.source,{controls,guidance_lifetime:'active_session',reading_freshness:'last_known'});
 const old=buildObserverExperience(state,{now:NOW});assert.match(old.source,/last-known accepted/);assert.match(old.link,/last-known now, not a new observation/);
 const d=state.arms.with.delivery;Object.assign(d.request_attribution[0],{status:'fallback_observed',reading_id:null,controls:null,collaboration_contract:{version:2,status:'withdrawn',added_utf8_bytes:0}});d.response_attribution.requests[0].presence='fallback';d.response_attribution.finals[0].presence='fallback';state.presence.source.eligible=false;
 const fallback=buildObserverExperience(state,{now:NOW});assert.match(fallback.link,/ordinary fallback.*No reading/);assert.match(fallback.source,/ordinary fallback/);assert.ok(!fallback.link.includes('reading 1'));
});

test('unmatched, unknown and unequal turns do not become a controlled comparison',()=>{
 for(const change of [s=>s.comparison.matched_context=false,s=>delete s.comparison.matched_context,s=>s.arms.without.delivery.turn_ordinal=1,s=>s.arms.with.model={...s.arms.with.model,status:'mismatch'}]){
  const s=observerState();change(s);const v=buildObserverExperience(s,{now:NOW});assert.equal(v.paired,false);assert.match(v.scope,/descriptive|unverified/);assert.ok(!v.paragraph.includes('improved'));
 }
});

test('no difference and exact JSON answers keep meaningful observations without inventing depth',()=>{
 const s=observerState();for(const arm of ['without','with'])s.arms[arm].messages.at(-1).text='{"ok":true}';
 const v=buildObserverExperience(s,{metrics,now:NOW});assert.match(v.paragraph,/No structural response difference/);assert.match(dimension(v,'presentation').detail,/explicit requested formats retain priority/);assert.match(dimension(v,'depth').summary,/unverified/);assert.equal(observerLocalEvidence(v).length,2);
});

test('missing resources, effort, interruptions and native question data remain unavailable',()=>{
 const s=observerState();delete s.measurement;for(const a of Object.values(s.arms)){delete a.usage;delete a.interactions;}
 const v=buildObserverExperience(s,{now:NOW});for(const id of ['resources','interruptions','interaction'])assert.equal(dimension(v,id).status,'unverified');assert.match(dimension(v,'resources').without,/unavailable calls/);assert.match(dimension(v,'conversation').without,/effort unavailable/);assert.match(dimension(v,'interruptions').without,/unavailable reported/);assert.match(dimension(v,'interruptions').summary,/unavailable/);
});

test('forged or partial attribution cannot attach assistant text to a reading',()=>{
 const mutations=[s=>s.arms.with.delivery.response_attribution.finals[0].request_ordinal=2,s=>s.arms.with.delivery.response_attribution.requests[0].presence='fallback',s=>s.arms.with.delivery.request_attribution[0].read_id='forged',s=>s.arms.with.delivery.response_linkage='unverified',s=>s.arms.with.delivery.public_finals=3,s=>s.arms.with.last_turn_terminal='cancelled',s=>s.arms.with.status='running'];
 for(const mutate of mutations){const s=observerState();mutate(s);const v=buildObserverExperience(s,{now:NOW});assert.match(v.link,/link unavailable/);assert.equal(observerLocalEvidence(v).filter(x=>x.arm==='with').length,0);assert.equal(v.paired,false);}
});

test('provider facts and registered exports exclude local text; model cannot override the experience',async()=>{
 const s=observerState(),e=buildObserverEvidence(s,{metrics,now:NOW});const prompt=observerPrompt(e);assert.ok(!prompt.includes('PRIVATE'));assert.ok(!prompt.includes('current draft'));assert.ok(prompt.includes('dimension_presentation'));assert.ok(prompt.includes('increased by 50'));
 const experience=observerExperience(e);experience.paragraph='FORGED';assert.ok(!observerExperience(e).paragraph.includes('FORGED'));assert.equal(projectObserverExperience({...experience,excerpts:['PRIVATE']}).excerpts,undefined);
 assert.throws(()=>validateObserverSelection({fact_ids:['dimension_presentation'],quote:'forged'},e),/observer_selection_invalid/);
 const service=new PresenceObserverService({now:()=>NOW,explain:async()=>({fact_ids:['dimension_presentation','dimension_resources'],experience:{paragraph:'FORGED_MODEL'},quotes:['PRIVATE'],model:'evil',usage:{status:'observed',model_calls:1,input_tokens:10,output_tokens:2,elapsed_ms:1}})}),ctx={generation:1,pair:{snapshot:()=>s}};
 service.start(ctx,s,metrics);await service.wait(ctx);const reports=service.view(ctx).reports;assert.equal(reports[0].status,'completed');assert.equal(reports[0].model,'muse-spark-1.3');assert.ok(!JSON.stringify(reports).includes('PRIVATE'));assert.ok(!JSON.stringify(reports).includes('FORGED'));assert.ok(!('references' in reports[0].experience));assert.match(reports[0].experience.paragraph,/Presentation differs/);await service.close();
});

test('new turns reject late model results while retaining their separate observed spend',async()=>{
 const s=observerState(),ctx={generation:1,pair:{snapshot:()=>s}};let finish;
 const service=new PresenceObserverService({now:()=>NOW,explain:()=>new Promise(r=>{finish=r;})});service.start(ctx,s,metrics);s.arms.with.delivery.turn_ordinal++;finish({fact_ids:['dimension_presentation'],usage:{status:'observed',model_calls:1,input_tokens:9}});await service.wait(ctx);
 const report=service.view(ctx).reports[0];assert.equal(report.status,'failed');assert.deepEqual(report.sentences,[]);assert.ok(!report.experience);assert.equal(report.usage.input_tokens,9);await service.close();
});

test('old registered reports keep their validated facts without fabricated new dimensions',()=>{
 const value=registerObserverReport({id:READ,session_generation:1,at:new Date(NOW).toISOString(),input_fingerprint:'a'.repeat(64),status:'completed',fact_ids:['source_fallback'],sentences:['Historical validated fact.'],usage:{}});
 const [report]=projectObserverReports([value],1);assert.deepEqual(report.sentences,['Historical validated fact.']);assert.ok(!report.experience);assert.deepEqual(projectObserverReports([structuredClone(value)],1),[]);
});

// A deliberately inert DOM: HTML interpretation is forbidden. This exercises the
// production renderer, including hostile-looking assistant text as plain text.
test('actual observer renderer presents six dimensions, expandable exact excerpts and safe text',()=>{
 const f=inertObserver(),s=observerState();s.arms.with.messages.at(-1).text='<img src=x onerror="throw SECRET">\n\n1. Keep the current draft.';
 const v=buildObserverExperience(s,{metrics,now:NOW});renderObserverExperience(f.container,v);assert.equal(f.nodes.dimensions.children.length,6);assert.equal(f.nodes.excerpts.children.length,2);
 assert.ok(f.nodes.excerpts.children[1].children[1].textContent.includes('<img'));assert.ok(!JSON.stringify(f.nodes.dimensions).includes('SECRET'));assert.ok(!presenceObserverHtml().includes('data-observer-facts></ol><p'));
 assert.match(presenceObserverHtml(),/Current local evidence/);assert.match(presenceObserverHtml(),/Spark 1.3/);assert.match(presenceObserverHtml(),/generated facts only/);assert.match(f.nodes.link.textContent,/different reading/);
});

test('unavailable, historical, failed and cancelled observer panels retain useful local evidence',()=>{
 const f=inertObserver(),s=observerState(),panel=mountPresenceObserver(f.container,{readMetrics:()=>metrics,post:async()=>{},onState:()=>{},recordingEnabled:false,enabled:false});
 panel.render(s,{connected:true});assert.equal(f.nodes.explain.disabled,true);assert.match(f.nodes.status.textContent,/unavailable/);assert.match(f.nodes.paragraph.textContent,/Presentation differs/);
 for(const status of ['failed','cancelled','completed']){
  s.presence_observer={reports:[{at:new Date(NOW).toISOString(),status,evidence_scope:{with_turn:1,without_turn:1},fact_ids:['source_fallback'],sentences:['Historical fact.'],usage:{}}]};panel.render(s,{connected:true});assert.match(f.nodes.time.textContent,/earlier turn/);
  assert.match(f.nodes.paragraph.textContent,/Presentation differs/);if(status==='completed'){assert.match(f.nodes['report-paragraph'].textContent,/Historical observer/);assert.equal(f.nodes.facts.children.length,1);}else assert.match(f.nodes.highlight.textContent,/cancelled|No Muse explanation/);
 }
 panel.close();
});

test('reading IDs with contradictory recorded controls do not acquire a numbered-history attribution',()=>{
 const s=observerState();s.textbox.readings[0].controls=newer;const v=buildObserverExperience(s,{now:NOW});assert.match(v.link,/history link unverified/);assert.ok(!v.link.includes('→ reading 1'));
});

test('a contaminated baseline is prominently invalid before a model explanation',()=>{
 const s=observerState();s.arms.without.delivery.status='baseline_contaminated';const v=buildObserverExperience(s,{now:NOW});assert.equal(v.paired,false);assert.match(v.scope,/comparison is invalid/);assert.equal(observerLocalEvidence(v).filter(x=>x.arm==='without').length,0);
});

test('newer current reading reports the earlier exact request match without causal absence',()=>{
 const v=buildObserverExperience(observerState(),{now:NOW});assert.match(v.link,/this final request matched the earlier reading/);assert.doesNotMatch(v.link,/did not govern/);
});

test('missing, requested-only, unknown and partial model evidence stays descriptive and unpaired',()=>{
 const mutations=[
  s=>{for(const a of Object.values(s.arms))delete a.model;},
  s=>{delete s.arms.with.model;},
  s=>{for(const a of Object.values(s.arms))a.model={requested_model:'muse-wonder-1.0'};},
  s=>{for(const a of Object.values(s.arms))a.model={requested_model:'muse-wonder-1.0',observed_models:[],requests_observed:null,unidentified_requests:null,status:'unknown'};},
  s=>{s.arms.with.model={...s.arms.with.model,status:'partial',requests_observed:2,unidentified_requests:1};},
  s=>{s.arms.with.model={...s.arms.with.model,observed_models:[]};},
  s=>{s.arms.with.model={...s.arms.with.model,requests_observed:0};},
  s=>{s.arms.with.model={...s.arms.with.model,unidentified_requests:null};}
 ];
 for(const mutate of mutations){const s=observerState();mutate(s);const v=buildObserverExperience(s,{now:NOW});assert.equal(v.paired,false);assert.match(v.scope,/Model matching is unverified/);assert.match(v.paragraph,/Presentation differs/);assert.equal(dimension(v,'presentation').status,'observed');assert.equal(observerLocalEvidence(v).length,2);}
});

test('only compatible fully observed native model records qualify as paired',()=>{
 const s=observerState();assert.equal(buildObserverExperience(s,{now:NOW}).paired,true);
 s.arms.with.model={...s.arms.with.model,requested_model:'muse-spark-1.3',observed_models:['muse-spark-1.3']};const different=buildObserverExperience(s,{now:NOW});assert.equal(different.paired,false);assert.match(different.scope,/Model identities differ/);assert.match(different.paragraph,/Presentation differs/);
 s.arms.with.model={...s.arms.with.model,requested_model:'muse-wonder-1.0'};const contradictory=buildObserverExperience(s,{now:NOW});assert.equal(contradictory.paired,false);assert.match(contradictory.scope,/Model identities differ/);
});
