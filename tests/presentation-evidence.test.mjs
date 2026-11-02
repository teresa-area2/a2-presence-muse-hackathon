import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresentationLedger,PRESENTATION_EVENT_LIMIT} from '../web/presentation-decisions.mjs';
import {projectPresentationEnvelope,presentationAdvances} from '../web/presentation-evidence.mjs';
const DEFER={response_extent:'standard',unsolicited_update:'defer',conversation_style:'conversational'},SEND={response_extent:'full',unsolicited_update:'send',conversation_style:'self_contained'};
const item=(ordinal,visible=true,optional=true)=>({kind:'message',ordinal,visible,optional});
const envelope=(withArm,without=null)=>({schema_version:1,arms:{without,with:withArm}});
const observed=(ledger,items,{at=100,mode='eligible',controls=DEFER,epoch=0,generation=1,manual=false}={})=>ledger.observe({session_generation:generation,history_epoch:epoch,items,at_ms:at,...(mode==='baseline'?{}:{policy:{mode,controls:mode==='eligible'?controls:null}}),manual});
function initial(){const ledger=createPresentationLedger({arm:'with'});return envelope(observed(ledger,[item(1,false),item(2,true,false)]));}
const clone=structuredClone;

test('projects detached canonical two-arm Muse ledgers without extending their provenance',()=>{
 const withLedger=createPresentationLedger({arm:'with'}),baseline=createPresentationLedger({arm:'without'});
 const value=envelope(observed(withLedger,[item(1,false),{kind:'approval',ordinal:1,visible:true,optional:false}]),observed(baseline,[item(1,true)],{mode:'baseline'}));
 const before=clone(value),safe=projectPresentationEnvelope(value,1);assert.deepEqual(safe,value);assert.deepEqual(value,before);assert.notEqual(safe,value);assert.notEqual(safe.arms.with.events[0].controls,value.arms.with.events[0].controls);
 safe.arms.with.events[0].controls.response_extent='full';assert.equal(value.arms.with.events[0].controls.response_extent,'standard');
 assert.equal(safe.arms.with.source,'browser_current_display_policy');assert.ok(!JSON.stringify(safe).includes('request_delivery'));assert.ok(!JSON.stringify(safe).includes('human_benefit'));
});

test('send/manual/fallback/disconnected releases retain current display policy, not model-input policy',()=>{
 for(const reason of ['send','manual','fallback','disconnected']){
  const ledger=createPresentationLedger({arm:'with'});const previous=envelope(observed(ledger,[item(1,false)]));
  const opts=reason==='manual'?{manual:true}:reason==='send'?{controls:SEND}:{mode:reason};
  const next=envelope(observed(ledger,[item(1,true)],{at:200,...opts}));
  const safe=projectPresentationEnvelope(next,1);assert.ok(safe,reason);assert.equal(safe.arms.with.events[1].reason,reason);assert.equal(safe.arms.with.events[1].event,'released');
  assert.deepEqual(safe.arms.with.events[1].controls,['fallback','disconnected'].includes(reason)?null:reason==='send'?SEND:DEFER);assert.equal(presentationAdvances(previous,next),true);
 }
 const notHeld=createPresentationLedger({arm:'with'});assert.ok(projectPresentationEnvelope(envelope(observed(notHeld,[item(1,true)])),1));
});

test('strict shape, privacy, controls and arm/generation validation reject entire invalid envelopes',()=>{
 const changes=[
  x=>x.raw_text='PRIVATE',x=>x.arms.extra=null,x=>delete x.arms.without,x=>x.arms.with.native_id='PRIVATE',x=>x.arms.with.source='model_request_policy',x=>x.arms.with.arm='without',x=>x.arms.with.session_generation=2,x=>x.arms.with.events[0].text='PRIVATE',x=>x.arms.with.events[0].digest='a'.repeat(64),x=>x.arms.with.events[0].controls.person_state='PRIVATE',x=>x.arms.with.events[0].controls.unsolicited_update='maybe',x=>delete x.arms.with.events[0].controls,x=>x.arms.with.events.push(null),x=>x.arms.with.events[0].controls=[],
 ];
 for(const change of changes){const value=initial();change(value);assert.equal(projectPresentationEnvelope(value,1),null);}
 for(const value of [null,undefined,{},[],false])assert.equal(projectPresentationEnvelope(value,1),null);
 for(const generation of [0,-1,'1',null,Number.MAX_SAFE_INTEGER+1])assert.equal(projectPresentationEnvelope(initial(),generation),null);
});

test('event semantics keep mandatory and approval rows visible and baseline free of controls',()=>{
 const changes=[
  x=>x.event='unknown',x=>{x.event='released';x.reason='mandatory';},x=>{x.kind='approval';},x=>x.controls={...SEND},x=>x.controls=null,x=>x.reason='send',x=>{x.event='shown';x.reason='manual';},x=>{x.event='released';x.reason='defer';},x=>{x.event='shown';x.reason='fallback';},
 ];
 for(const change of changes){const value=initial();change(value.arms.with.events[0]);assert.equal(projectPresentationEnvelope(value,1),null);}
 const baseline=createPresentationLedger({arm:'without'}),safe=envelope(null,observed(baseline,[item(1,true),{kind:'approval',ordinal:1,optional:false,visible:true}],{mode:'baseline'}));assert.ok(projectPresentationEnvelope(safe,1));
 for(const change of [x=>x.reason='not_held',x=>x.controls={...DEFER},x=>{x.event='held';x.reason='defer';x.controls={...DEFER};}]){const value=clone(safe);change(value.arms.without.events[0]);assert.equal(projectPresentationEnvelope(value,1),null);}
});

test('contiguous sequences and monotonic revision/epoch/time bounds are enforced',()=>{
 for(const change of [x=>x.arms.with.events[0].sequence=2,x=>x.arms.with.events[1].sequence=4,x=>x.arms.with.events[0].revision=0,x=>x.arms.with.events[0].revision=2,x=>x.arms.with.events[0].ordinal=0,x=>x.arms.with.events[0].ordinal=4097,x=>x.arms.with.events[0].at_ms=-1,x=>x.arms.with.events[0].at_ms=8640000000000001,x=>x.arms.with.events[1].at_ms=99,x=>x.arms.with.events[0].history_epoch=1,x=>x.arms.with.revision=0]){const value=initial();change(value);assert.equal(projectPresentationEnvelope(value,1),null);}
 const epoch=initial();epoch.arms.with.history_epoch=1;assert.equal(projectPresentationEnvelope(epoch,1),null);epoch.arms.with.coverage='partial';assert.ok(projectPresentationEnvelope(epoch,1));
 const empty=envelope({schema_version:1,source:'browser_current_display_policy',arm:'with',session_generation:1,history_epoch:0,revision:0,events_omitted:0,coverage:'observed',events:[]});assert.ok(projectPresentationEnvelope(empty,1));
 const bound=initial();bound.arms.with.events[0].at_ms=8640000000000000;bound.arms.with.events[1].at_ms=8640000000000000;assert.ok(projectPresentationEnvelope(bound,1));
 const overflow=initial();overflow.arms.with.events=Array.from({length:PRESENTATION_EVENT_LIMIT+1},(_,i)=>({...overflow.arms.with.events[0],sequence:i+1}));assert.equal(projectPresentationEnvelope(overflow,1),null);
});

test('adding optional tracking works, but dropping a prior arm or envelope does not',()=>{
 const next=initial();assert.equal(presentationAdvances(null,null),true);assert.equal(presentationAdvances(undefined,next),true);assert.equal(presentationAdvances(next,null),false);
 const drop=envelope(null);assert.equal(presentationAdvances(next,drop),false);assert.equal(presentationAdvances(drop,next),true);assert.equal(presentationAdvances({},next),false);
 const other=clone(next);other.arms.with.session_generation=2;assert.equal(presentationAdvances(next,other),false);
 const baseline=createPresentationLedger({arm:'without'});const both=clone(next);both.arms.without=observed(baseline,[item(1,true)],{mode:'baseline'});assert.equal(presentationAdvances(next,both),true);assert.equal(presentationAdvances(both,next),false);
});

test('same revision is idempotent only for byte-equivalent canonical contents',()=>{
 const previous=initial();assert.equal(presentationAdvances(previous,clone(previous)),true);
 const reordered={arms:{with:{...previous.arms.with},without:null},schema_version:1};assert.equal(presentationAdvances(previous,reordered),true);
 const altered=clone(previous);altered.arms.with.events[0].at_ms++;altered.arms.with.events[1].at_ms++;assert.equal(presentationAdvances(previous,altered),false);
 const revisionOnly=clone(previous);revisionOnly.arms.with.revision++;revisionOnly.arms.with.coverage='partial';assert.equal(presentationAdvances(previous,revisionOnly),true);
 const recovery=clone(revisionOnly);recovery.arms.with.revision++;recovery.arms.with.coverage='observed';assert.equal(presentationAdvances(revisionOnly,recovery),false);
});

test('append and ring rollover preserve exact overlap and reject stale or forged history',()=>{
 const ledger=createPresentationLedger({arm:'with'});const first=envelope(observed(ledger,[item(1,false)],{at:1}));
 const items=Array.from({length:100},(_,i)=>item(i+1,false));const hundred=envelope(observed(ledger,items,{at:2}));assert.equal(presentationAdvances(first,hundred),true);
 const next=envelope(observed(ledger,[...items,item(101,false)],{at:3}));assert.equal(next.arms.with.events_omitted,1);assert.equal(next.arms.with.coverage,'partial');assert.equal(presentationAdvances(hundred,next),true);assert.equal(presentationAdvances(next,hundred),false);
 const divergent=clone(next);divergent.arms.with.events[0].ordinal=333;assert.equal(presentationAdvances(hundred,divergent),false);
 const oldRevision=clone(next);oldRevision.arms.with.events.at(-1).revision=hundred.arms.with.revision;assert.equal(presentationAdvances(hundred,oldRevision),false);
 const rewind=clone(next);rewind.arms.with.history_epoch=-1;assert.equal(presentationAdvances(hundred,rewind),false);
 const shorter=clone(hundred);shorter.arms.with.events.pop();shorter.arms.with.revision++;assert.equal(presentationAdvances(hundred,shorter),false);
});

test('epoch resets mark partial coverage without rewriting retained events or recovering old coverage',()=>{
 const ledger=createPresentationLedger({arm:'with'});const previous=envelope(observed(ledger,[item(1,false)],{at:1}));
 const next=envelope(observed(ledger,[item(1,true,false)],{at:2,epoch:1,mode:'fallback'}));assert.equal(presentationAdvances(previous,next),true);assert.equal(next.arms.with.coverage,'partial');
 const changed=clone(next);changed.arms.with.events[0].reason='not_held';assert.equal(presentationAdvances(previous,changed),false);
});

test('maximum bounded presentation request stays below128KiB; report combined evidence capacity',t=>{
 const max=Number.MAX_SAFE_INTEGER,epoch=max-1;
 const snapshot=arm=>({schema_version:1,source:'browser_current_display_policy',arm,session_generation:max,history_epoch:epoch,revision:max,events_omitted:max-100,coverage:'partial',events:Array.from({length:100},(_,i)=>({sequence:max-99+i,revision:max,history_epoch:epoch,kind:'message',ordinal:4096,event:'shown',reason:arm==='with'?'not_held':'baseline',at_ms:8640000000000000,controls:arm==='with'?{response_extent:'standard',unsolicited_update:'defer',conversation_style:'conversational'}:null}))});
 const presentation=projectPresentationEnvelope(envelope(snapshot('with'),snapshot('without')),max);assert.ok(presentation);
 const mechanism={schema_version:1,source:'browser_projection',ledger_id:'11111111-1111-4111-8111-111111111111',session_generation:max,revision:max,metrics:{schema_version:1,held_current:0,held_total:max,released_manual:max,released_automatic:0,history_resets:max,coverage:'partial'},presentation};
 const requestBytes=Buffer.byteLength(JSON.stringify({generation:max,ledger:mechanism}));assert.ok(requestBytes<128*1024,requestBytes);
 const capture={schema_version:1,source:'current_browser_tab',ledger_id:mechanism.ledger_id,session_generation:max,events_omitted:max,rejected_events:0,events:Array.from({length:200},()=>({window_id:max,sample_id:max,sample_kind:'interim',phase:'dispatch',at_ms:8640000000000000,reason:'connection_lost',status:'observation_expired'}))};
 const sections={browser_mechanisms:{provenance:'client_reported_presentation',scope:'separate_browser_projections_not_additive',ledgers:Array(16).fill(mechanism)},browser_capture_logs:{ledgers:Array(16).fill(capture)}};
 const combinedBytes=Buffer.byteLength(JSON.stringify(sections,null,2)),compactBytes=Buffer.byteLength(JSON.stringify(sections));
 t.diagnostic(JSON.stringify({request_bytes:requestBytes,combined_sections_pretty_bytes:combinedBytes,combined_sections_compact_bytes:compactBytes,evidence_limit_bytes:2*1024*1024,combined_sections_fit:combinedBytes<2*1024*1024}));
});
