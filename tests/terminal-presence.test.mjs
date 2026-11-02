import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {readHookEvidence,TerminalPresenceObserver} from '../src/terminal-presence.mjs';import {presenceView,receiptAgeLabel,captureHint} from '../web/terminal-presence-view.mjs';
test('projects only safe hook metadata and refuses symlinks',async t=>{
 const w=await fs.mkdtemp(path.join(os.tmpdir(),'terminal-presence-'));t.after(()=>fs.rm(w,{recursive:true,force:true}));await fs.mkdir(path.join(w,'.presence'));const file=path.join(w,'.presence','hook-events.jsonl');
 await fs.writeFile(file,JSON.stringify({event:'PreLLMCall',eligible:true,read_at:'2026-10-27T12:00:01Z',received_at:'2026-10-27T12:00:00Z',controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'},guidance:'PRIVATE-SENTINEL',request_id:'PRIVATE-SENTINEL'})+'\n');
 const e=await readHookEvidence(w);assert.equal(e.reads,1);assert.equal(e.last.eligible,true);assert.ok(!JSON.stringify(e).includes('PRIVATE-SENTINEL'));await fs.rm(file);await fs.symlink('/etc/passwd',file);assert.equal((await readHookEvidence(w)).status,'unavailable');
});
test('display distinguishes current policy, hook evidence and unavailable data',()=>{
 const source={eligible:true,read_at:'2026-10-27T12:00:01Z',received_at:'2026-10-27T12:00:00Z',capture:{state:'collecting'},controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'}};
 const view=presenceView({source,hook:{status:'workspace_scoped_unverified',reads:1,last:{eligible:true}}},null,Date.parse('2026-10-27T12:00:02Z'));
 assert.equal(view.capture,'Collecting');assert.match(view.policy,/terse response/);assert.equal(view.controls.response_extent,'terse');assert.match(view.hookText,/session link unverified/);assert.equal(presenceView(null).reading,'Not read');
});
test('observer clears transient source on stop and closes the reader',async()=>{
 let closed=0;const r={read:async()=>null,close:async()=>closed++};const obs=new TerminalPresenceObserver({reader:r,workspace:'/tmp'});await obs.poll();await obs.stop();assert.equal(closed,1);assert.equal(obs.snapshot().source,null);
});

test('an old source read cannot remain a current policy',()=>{
 const source={eligible:true,read_at:'2026-10-27T12:00:01Z',capture:{state:'collecting'},controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'}};
 const view=presenceView({source},null,Date.parse('2026-10-27T12:00:23Z'));assert.match(view.capture,/not recent/);assert.match(view.reading,/no longer current/);assert.match(view.policy,/no longer current/);assert.equal(view.controls,null);
});

test('an ineligible reading cannot supply values for the visible policy rows',()=>{
 const now=Date.parse('2026-10-27T12:00:02Z');const source={eligible:false,read_at:'2026-10-27T12:00:01Z',controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'}};
 const view=presenceView({source},null,now);assert.equal(view.controls,null);assert.equal(view.policy,'Ordinary behavior');
});

test('receipt age reports the actual receipt and never invents a fresh one',()=>{const now=Date.parse('2026-10-27T12:03:10Z');assert.equal(receiptAgeLabel({received_at:'2026-10-27T12:00:01Z'},now),'Receipt 3m 9s ago');assert.equal(receiptAgeLabel(null,now),'No receipt');assert.equal(receiptAgeLabel({received_at:'2026-10-27T12:03:11Z'},now),'Receipt time unconfirmed');});

test('paused capture identifies last eligible guidance and offers safe context',()=>{const now=Date.parse('2026-10-27T12:03:10Z');const source={eligible:true,read_at:'2026-10-27T12:03:08Z',received_at:'2026-10-27T11:30:00Z',capture:{state:'paused',reason:'unsupported_field'}};assert.equal(presenceView({source},null,now).reading,'Last eligible guidance');assert.match(captureHint(source),/supported editor/);assert.match(receiptAgeLabel(source,now),/33m/);assert.doesNotMatch(captureHint({read_at:source.read_at,capture:{state:'paused',reason:'secure_input'}}),/disable|bypass/i);assert.equal(captureHint(null),'Waiting for a confirmed capture status.');});
test('an eligible flag without a recent source read never appears as active guidance',()=>{
 const now=Date.parse('2026-10-27T12:00:02Z'),controls={response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'};
 for(const read_at of [undefined,null,'','not-a-date','2026-10-27T11:59:00Z','2026-10-27T12:00:20Z'])for(const state of ['collecting','paused']){
  const view=presenceView({source:{eligible:true,read_at,controls,capture:{state}}},null,now);
  assert.ok(!['Eligible guidance','Last eligible guidance'].includes(view.reading));assert.equal(view.controls,null);
 }
 const eligible={eligible:true,read_at:'2026-10-27T12:00:01Z',controls,capture:{state:'collecting'}};
 assert.equal(presenceView({source:eligible},null,now).reading,'Eligible guidance');
 assert.equal(presenceView({source:{...eligible,eligible:false}},null,now).reading,'Ordinary fallback');
});
