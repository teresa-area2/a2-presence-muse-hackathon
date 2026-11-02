import test from 'node:test';
import assert from 'node:assert/strict';
import {projectWindowEvents,attachWindowEvents,mountWindowEvents} from '../web/session-evidence.mjs';
import {textboxCaptureLabel} from '../web/terminal-presence-view.mjs';
const id='11111111-1111-4111-8111-111111111111';
const event=(extra={})=>({window_id:1,sample_id:2,sample_kind:'interim',phase:'sample',at_ms:1700000000000,reason:null,status:'captured',...extra});
const ledger=(extra={})=>({ledger_id:id,session_generation:1,events:[event()],events_omitted:0,...extra});
test('window/sample metadata is scoped and closed-schema; no signal or text can enter the export',()=>{
 const raw=ledger({raw:'PRIVATE',events:[event({guidance:'PRIVATE',keyCount:999,keys:['PRIVATE'],capsule:'PRIVATE'})]});
 const projected=projectWindowEvents(raw,1);assert.equal(projected.events.length,1);
 assert.deepEqual(Object.keys(projected.events[0]).sort(),['window_id','sample_id','sample_kind','phase','at_ms','reason','status'].sort());
 assert.ok(!JSON.stringify(projected).includes('PRIVATE'));assert.ok(!JSON.stringify(projected).includes('999'));
 assert.equal(projectWindowEvents(raw,2),null);assert.equal(projectWindowEvents({...raw,ledger_id:null},1),null);
 assert.equal(projectWindowEvents({...raw,ledger_id:'PRIVATE'},1),null);
 assert.equal(projectWindowEvents({...raw,events_omitted:-1},1),null);
});
test('captured and unchanged finals survive projection without implying a new reading or request delivery',()=>{
 const x=projectWindowEvents(ledger({events:[event(),event({sample_id:3,sample_kind:'final',status:'unchanged_skipped'})]}),1);
 assert.deepEqual(x.events.map(e=>e.status),['captured','unchanged_skipped']);
 assert.ok(!JSON.stringify(x).includes('delivery'));assert.equal(x.source,'current_browser_tab');
});
test('legacy rows keep null sample identity; event order and bounded omission count are retained',()=>{
 const legacy={window_id:1,phase:'start',at_ms:null,reason:null,status:null};
 assert.equal(projectWindowEvents(ledger({events:[legacy]}),1).events[0].sample_id,null);
 const x=projectWindowEvents(ledger({events:Array.from({length:203},(_,i)=>event({window_id:i+1,at_ms:1700000000000-i})),events_omitted:4}),1);
 assert.equal(x.events.length,200);assert.equal(x.events[0].window_id,4);assert.equal(x.events_omitted,7);
 assert.ok(x.events[0].at_ms>x.events.at(-1).at_ms,'wall-clock correction does not reorder emission history');
 const invalid=projectWindowEvents(ledger({events:[event({phase:'PRIVATE'}),event({reason:'PRIVATE'}),event({status:'PRIVATE'}),event({at_ms:Infinity})]}),1);
 assert.equal(invalid.events.length,0);assert.equal(invalid.rejected_events,4);
});
test('client attachment never mutates or misattributes the durable server report',()=>{
 const report={schema_version:1,session_generation:1,run_id:'run-1',revision:2};
 const attached=attachWindowEvents(report,ledger());assert.notEqual(attached,report);assert.equal(attached.browser_capture.persistence,'download_only');
 assert.equal(report.browser_capture,undefined);assert.equal(attachWindowEvents(report,ledger({session_generation:2})),report);
});
class Element{constructor(){this.children=[];this.textContent='';}append(x){this.children.push(x);}replaceChildren(){this.children=[];}}
test('capture table replaces a previous page ledger and exposes local cancellation honestly',()=>{
 const summary=new Element(),body=new Element();let current=ledger({events:[event({phase:'outcome',status:'cancel_requested'})]});
 const container={ownerDocument:{createElement:()=>new Element()},querySelector:s=>s==='[data-window-summary]'?summary:body};
 const panel=mountWindowEvents(container,{readEvents:()=>current});panel.render({session_generation:1});
 assert.equal(body.children.length,1);assert.match(body.children[0].children.at(-1).textContent,/remote outcome unknown/);
 current=ledger({ledger_id:'22222222-2222-4222-8222-222222222222',events:[event({window_id:2,sample_kind:'final',status:'unchanged_skipped'})]});
 panel.render({session_generation:1});assert.equal(body.children.length,1);assert.match(body.children[0].children[1].textContent,/Window 2/);
 assert.match(body.children[0].children.at(-1).textContent,/No new input; not sent/);
 panel.render({session_generation:2});assert.match(body.children[0].children[0].textContent,/No capture events in this tab/);
});
test('cumulative capture gaps and exhausted interim slots remain visible without claiming failure of the final manager',()=>{
 assert.match(textboxCaptureLabel({cumulative_capture:'capture_gap',window:'open'},{localCapture:'starting'}),/typing window is skipped/);
 assert.match(textboxCaptureLabel({cumulative_capture:'interim_exhausted',window:'open'}),/final snapshot is reserved/);
 assert.doesNotMatch(textboxCaptureLabel({cumulative_capture:'interim_exhausted',window:'closed',last_submission:'complete'}),/final snapshot is reserved/);
 assert.equal(textboxCaptureLabel({cumulative_capture:'capture_gap'},{connected:false}),'Textbox capture disconnected.');
});
