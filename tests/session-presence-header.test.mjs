import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {presenceHeaderView} from '../web/session-app.mjs';
import {sessionWorkspaceHtml} from '../src/session-workspace-view.mjs';
import {createTextboxReadingClock,currentTextboxDisplay,readingPulseValues} from '../web/terminal-presence-view.mjs';
const now=Date.parse('2026-10-29T18:00:00Z');
const controls={response_extent:'full',unsolicited_update:'defer',conversation_style:'conversational'};
const value={source:{read_at:new Date(now).toISOString(),eligible:true,controls}};
const textbox={consented:true,selected:true,status:'ready',age_ms:25000,observation_age_ms:27000,received_at:new Date(now-25000).toISOString(),last_receipt:'accepted',policy_change:'changed'};
const header=(box=textbox,extra={},source=value)=>presenceHeaderView(source,{now,textbox:box,...extra});
test('routine header is stable with quiet recency and full diagnostics available',()=>{
 const out=header();assert.equal(out.label,'Reading available');assert.equal(out.recency,'Updated recently');assert.equal(out.tone,'current');
 assert.match(out.detail,/policy changed/);assert.match(out.detail,/typing observation is 27s old/);assert.match(out.detail,/Latest OP receipt/);
 assert.doesNotMatch(out.label,/OP|receipt|policy|typing|Muse|18:/);
 assert.equal(header({...textbox,policy_change:'unchanged'}).label,out.label);
 assert.equal(header({...textbox,age_ms:61000}).recency,'Updated 1m ago');
 assert.equal(header({...textbox,age_ms:NaN}).label,'Reading available');
});
test('failures, rate limits, stopped capture and ordinary fallback stay visible',()=>{
 for(const [status,label] of [['unavailable','Refresh failed'],['backoff','Rate limited']]){
  assert.equal(header({...textbox,status,refresh_after_ms:30000}).label,status==='backoff'?'Rate limited':label+' · using last reading');
  const out=header({...textbox,status,selected:false,refresh_after_ms:30000},{},{source:{...value.source,eligible:false,controls:null}});
  assert.equal(out.label,status==='backoff'?'Rate limited':label+' · ordinary fallback');assert.equal(out.tone,'warning');
 }
 assert.equal(header(textbox,{connected:false}).label,'Disconnected');
 assert.equal(header({...textbox,consent_revoked:true}).label,'Capture stopped');
 assert.equal(header({...textbox,status:'access_rejected'}).label,'Access rejected');
 assert.equal(header(textbox,{localCapture:'paused'}).label,'Capture paused');
 assert.equal(header(textbox,{liveEnabled:false}).label,'Live readings off');
 assert.equal(header({...textbox,selected:false},{},{source:{...value.source,eligible:false,controls:null}}).label,'Ordinary fallback');
 assert.equal(header({...textbox,refreshing:true}).label,'Refreshing');
 assert.equal(header(textbox,{}, {source:{...value.source,read_at:new Date(now-21000).toISOString()}}).label,'Ordinary fallback');
});

test('missing or invalid retry timing stays historical and never invents a countdown',()=>{
 for(const delay of [undefined,null,-1,NaN,Infinity,'30000']){
  const out=header({...textbox,status:'backoff',refresh_after_ms:delay});assert.equal(out.label,'Last refresh rate limited');assert.match(out.detail,/timing is unconfirmed/);
 }
});
test('diagnostics live in collapsed Presence details and policy is not duplicated in the header',async()=>{
 const html=sessionWorkspaceHtml(await fs.readFile(new URL('../web/terminal-app.html',import.meta.url),'utf8'));
 assert.match(html,/<strong class="sr-only">Presence connection<\/strong>/);
 assert.match(html,/<small id="presence-inline-policy" hidden>/);
 const details=html.slice(html.indexOf('<details class="presence-summary'),html.indexOf('</details>',html.indexOf('<details class="presence-summary')));
 assert.ok(details.includes('id="presence-connection-detail"'));assert.ok(details.includes('id="presence-help"'));
 assert.doesNotMatch(details.split('>')[0],/\bopen\b/);
 for(const field of ['depth','updates','conversation'])assert.ok(html.includes('id="presence-policy-'+field+'"'));
});

test('rate-limit warning counts down and expires between snapshots without claiming a new reading',()=>{
 let tick=1000;
 const clock=createTextboxReadingClock({now:()=>now,monotonicNow:()=>tick});
 const state={presence:value,textbox:{...textbox,status:'backoff',last_receipt:'backoff',refresh_after_ms:1000,reading_id:'00000000-0000-4000-8000-000000000001',freshness_limit_ms:120000}};
 const shown=()=>{const s=currentTextboxDisplay(state,clock);return header(s.textbox,{},s.presence);};
 assert.equal(shown().label,'Rate limited');tick+=999;assert.equal(shown().label,'Rate limited');tick++;
 assert.equal(shown().label,'Reading available');assert.equal(shown().recency,'Updated recently');assert.match(shown().detail,/retry delay has elapsed/i);
 assert.equal(state.textbox.refresh_after_ms,1000);assert.equal(state.textbox.last_receipt,'backoff');
 assert.equal(header({...textbox,refresh_after_ms:30000}).label,'Reading available','normal cadence is not a service rate-limit warning');
 const fallback=header({...state.textbox,selected:false,refresh_after_ms:0},{},{source:{...value.source,eligible:false,controls:null}});
 assert.equal(fallback.label,'Ordinary fallback');assert.equal(fallback.tone,'quiet');
});

test('refresh availability fills without a ticking visible countdown or resetting reading age',()=>{
 const history=[{kind:'http',cooldown_ms:30000}];
 for(const [remaining,fraction]of [[30000,0],[15000,.5],[0,1]]){
  const out=header({...textbox,refresh_after_ms:remaining,attempt_history:history});
  assert.equal(out.label,'Reading available');assert.equal(out.recency,'Updated recently');assert.equal(out.refresh.visible,true);assert.equal(out.refresh.fraction,fraction);
 }
 const limited=header({...textbox,status:'backoff',refresh_after_ms:45000,attempt_history:[{kind:'http',cooldown_ms:90000}]});
 assert.equal(limited.label,'Rate limited');assert.equal(limited.refresh.fraction,.5);assert.equal(limited.refresh.phase,'backoff');assert.match(limited.refresh.description,/45s/);
 assert.equal(header({...textbox,refresh_after_ms:15000}).refresh.fraction,null,'an unknown cycle does not invent a percentage');
 for(const options of [{connected:false},{liveEnabled:false},{localCapture:'paused'}])assert.equal(header(textbox,options).refresh.visible,false);
});

test('expired receipt remains a historical recency label without restoring eligibility',()=>{
 const box={...textbox,selected:false,age_ms:null,received_at:null,readings:[{received_at:new Date(now-180000).toISOString()}]};
 const out=header(box,{},{source:{...value.source,eligible:false,controls:null}});
 assert.equal(out.label,'Ordinary fallback');assert.equal(out.recency,'Last reading 3m ago');assert.equal(box.selected,false);assert.equal(box.age_ms,null);
 assert.equal(header({...box,readings:[{received_at:new Date(now+1000).toISOString()}]}).recency,'');
});

test('delayed same-cycle snapshots do not reverse the bar or rejuvenate a reading',()=>{
 let tick=0;
 const clock=createTextboxReadingClock({now:()=>now,monotonicNow:()=>tick});
 const attempt={kind:'http',start_wall_ms:100,end_wall_ms:200,cooldown_ms:30000};
 const initial={...textbox,reading_id:'00000000-0000-4000-8000-000000000001',received_at:new Date(now-14900).toISOString(),age_ms:14900,observation_age_ms:14900,refresh_after_ms:30000,attempt_history:[attempt]};
 clock(initial);tick=1000;
 const before=clock(initial),delayed=clock({...initial,refresh_after_ms:29500});
 assert.equal(delayed.refreshAfterMs,before.refreshAfterMs);
 assert.equal(delayed.receiptAge,before.receiptAge);assert.equal(delayed.observationAge,before.observationAge);
 assert.equal(clock({...initial,refresh_after_ms:90000}).refreshAfterMs,90000,'an authoritative extension is honored even before a new HTTP record exists');
 const next=clock({...initial,reading_id:'00000000-0000-4000-8000-000000000002',age_ms:0,observation_age_ms:100,refresh_after_ms:90000,attempt_history:[attempt,{...attempt,start_wall_ms:300,end_wall_ms:400,cooldown_ms:90000}]});
 assert.equal(next.refreshAfterMs,90000,'a new attempt with longer backoff starts its own cycle');
 assert.equal(next.receiptAge,0);assert.equal(next.observationAge,100);
 for(const attempt_history of [{},'invalid',null])assert.equal(clock({...initial,attempt_history,refresh_after_ms:5000}).refreshAfterMs,5000,'unknown history keeps authoritative timing without throwing');
});

test('same-session retained policy crosses the recency threshold without losing controls or Pulse eligibility',()=>{
 let wall=now,tick=0;const clock=createTextboxReadingClock({now:()=>wall,monotonicNow:()=>tick});
 const box={...textbox,guidance_lifetime:'active_session',reading_freshness:'fresh',reading_id:'00000000-0000-4000-8000-000000000007',controls,age_ms:119000,observation_age_ms:119000,freshness_limit_ms:120000};
 const state={session_generation:3,presence:{source:{...value.source,guidance_lifetime:'active_session',reading_freshness:'fresh'}},textbox:box};
 assert.equal(clock(box).current,true);wall+=2000;tick+=2000;
 const shown=currentTextboxDisplay(state,clock);assert.equal(shown.textbox.selected,true);assert.equal(shown.textbox.age_ms,121000);assert.equal(shown.textbox.reading_freshness,'last_known');assert.deepEqual(shown.presence.source.controls,controls);assert.equal(shown.presence.source.eligible,true);assert.ok(readingPulseValues(shown.textbox),'the retained policy still supplies the Pulse');
 const out=presenceHeaderView(shown.presence,{now:wall,textbox:shown.textbox});assert.equal(out.label,'Using last reading');assert.match(out.recency,/Last reading 2m ago/);assert.equal(out.tone,'current');assert.equal(state.textbox.reading_freshness,'fresh','display does not rewrite source snapshot');
});

test('retained guidance is revoked immediately and unknown/legacy lifetimes do not extend it',()=>{
 const base={...textbox,guidance_lifetime:'active_session',reading_freshness:'last_known',reading_id:'00000000-0000-4000-8000-000000000008',age_ms:300000,observation_age_ms:300000,freshness_limit_ms:120000};
 for(const patch of [{selected:false},{consented:false},{consent_revoked:true},{status:'access_rejected'},{guidance_lifetime:undefined},{guidance_lifetime:'forever'},{age_ms:-1},{observation_age_ms:NaN}]){
  const clock=createTextboxReadingClock({now:()=>now,monotonicNow:()=>0});assert.equal(clock({...base,...patch}).current,false,JSON.stringify(patch));
 }
 const clock=createTextboxReadingClock({now:()=>now,monotonicNow:()=>0});assert.equal(clock(base).current,true);
});

test('retained labels never turn a stale backend confirmation into a current source read',()=>{
 const box={...textbox,guidance_lifetime:'active_session',reading_freshness:'last_known',age_ms:300000};
 assert.equal(header(box).label,'Using last reading');
 const oldSource={source:{...value.source,read_at:new Date(now-21000).toISOString(),guidance_lifetime:'active_session',reading_freshness:'last_known'}};
 assert.equal(header(box,{},oldSource).label,'Ordinary fallback');
 assert.equal(header({...box,status:'unavailable'}).label,'Refresh failed · using last reading');
});

test('a retained policy with unknown observation time is never labeled fresh',()=>{const box={...textbox,guidance_lifetime:'active_session',reading_freshness:'last_known',reading_id:'00000000-0000-4000-8000-000000000009',age_ms:0,observation_age_ms:null,freshness_limit_ms:120000};const clock=createTextboxReadingClock({now:()=>now,monotonicNow:()=>0});const shown=currentTextboxDisplay({presence:value,textbox:box},clock);assert.equal(shown.textbox.selected,true);assert.equal(shown.textbox.reading_freshness,'last_known');assert.equal(header(shown.textbox).label,'Using last reading');});


test('a backwards display clock with a replacement snapshot cannot rejuvenate a retained reading',()=>{
 let tick=1000;const clock=createTextboxReadingClock({now:()=>now,monotonicNow:()=>tick});
 const box={...textbox,guidance_lifetime:'active_session',reading_freshness:'fresh',reading_id:'00000000-0000-4000-8000-000000000009',age_ms:0,observation_age_ms:0,freshness_limit_ms:120000};
 clock(box);tick=122000;assert.equal(clock(box).readingFreshness,'last_known');
 tick=121000;const regressed=clock({...box,age_ms:120000,observation_age_ms:120000});
 assert.equal(regressed.current,false);assert.equal(regressed.readingFreshness,'unavailable');
 tick=123000;const recovered=clock({...box,age_ms:120000,observation_age_ms:120000});assert.equal(recovered.readingFreshness,'last_known');assert.ok(recovered.receiptAge>=122000);
});

test('an unavailable textbox selection clears inconsistent source eligibility and controls',()=>{
 const box={...textbox,selected:false,guidance_lifetime:'active_session',reading_freshness:'unavailable'};
 const input={textbox:box,presence:{source:{...value.source,guidance_lifetime:'active_session',reading_freshness:'fresh'}}};
 const out=currentTextboxDisplay(input,createTextboxReadingClock({now:()=>now,monotonicNow:()=>0}));
 assert.equal(out.presence.source.eligible,false);assert.equal(out.presence.source.controls,null);assert.equal(out.presence.source.reading_freshness,'unavailable');assert.equal(input.presence.source.eligible,true);
});
