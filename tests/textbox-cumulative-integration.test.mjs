import test from 'node:test';
import assert from 'node:assert/strict';
import {mountTextboxPresence} from '../web/textbox-presence-client.mjs';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const sample=id=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:id,startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
function setup({mountDelay=false,postDelay=false,receiptStatus}={}){
 let clock=0,opts,enabled=false,releaseMount,releasePost,timerId=0;const listeners=new Map(),timers=new Map(),posts=[];
 const el={tagName:'TEXTAREA',addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)};
 const state={status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:0,in_flight:false,...(receiptStatus?{last_receipt:receiptStatus}:{})}};
 const binding={setEnabled(v){enabled=v;},deferUntil(){},finish(){},discardWindow(){},close(){enabled=false;}};
 const module={mountCumulativeCipherTextarea:async(_,options)=>{opts=options;if(mountDelay)await new Promise(r=>{releaseMount=r;});return binding;}};
 let widget;widget=mountTextboxPresence(el,{config:{enabled:true,live_enabled:true,session_authorized:true,latest_buffer_supported:true},enableLatestBuffer:true,enableCumulativeCapture:true,now:()=>clock,wallNow:()=>1700000000000+clock,setTimeoutFn:(fn,ms)=>{let id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},clearTimeoutFn:id=>timers.delete(id),loadCollector:async()=>module,post:async(_,body)=>{posts.push(body.capture.sessionID);if(postDelay&&posts.length===1)await new Promise(r=>{releasePost=r;});return{capture_status:'ready',state};},onState:next=>widget.render(next,{connected:true})});widget.render(state,{connected:true});
 const advance=async ms=>{const end=clock+ms;for(;;){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;clock=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}clock=end;await settle();};
 const emit=(name,event)=>{for(const fn of listeners.get(name)??[])fn(event);};
 return{widget,posts,advance,emit,release:()=>releaseMount(),releasePost:()=>releasePost(),isEnabled:()=>enabled,open:()=>opts.onStatus('window_open',{started_at_ms:1700000000000+clock}),snapshot:(id,kind,changed=true)=>opts.onSnapshot(sample(id),{kind,has_new_input:changed}),exhaust:()=>opts.onStatus('interim_exhausted'),partial:()=>opts.onStatus('partial_discarded',{phase:'boundary'}),end:(reason='send')=>opts.onStatus('window_completed',{end_reason:reason,ended_at_ms:1700000000000+clock})};
}
test('cumulative samples replace queued older windows and skip unchanged final',async t=>{
 const f=setup();t.after(()=>f.widget.close());await settle();assert.equal(f.isEnabled(),true);
 f.open();f.snapshot('first','interim');await settle();f.end();f.snapshot('unchanged','final',false);
 f.open();f.snapshot('second','interim');f.end();f.snapshot('newest','final');await settle();assert.deepEqual(f.posts,['first']);
 let events=f.widget.windowEvents().events;assert.ok(events.some(e=>e.phase==='sample'&&e.sample_kind==='final'&&e.status==='unchanged_skipped'));assert.ok(events.some(e=>e.phase==='replaced'&&e.sample_id===3));
 await f.advance(30000);assert.deepEqual(f.posts,['first','newest']);events=f.widget.windowEvents().events;assert.ok(events.some(e=>e.phase==='dispatch'&&e.sample_id===4&&e.sample_kind==='final'));
});
test('cumulative pending data is cancelled on Stop',async t=>{const f=setup();t.after(()=>f.widget.close());await settle();f.open();f.snapshot('first','interim');await settle();f.end();f.snapshot('pending','final');f.widget.suspend();await f.advance(60000);assert.deepEqual(f.posts,['first']);});
test('mount gap fails closed for the current window and resumes at its boundary',async t=>{const f=setup({mountDelay:true});t.after(()=>f.widget.close());await settle();f.emit('keydown',{isTrusted:true,key:'a',code:'KeyA'});assert.equal(f.widget.observation().cumulative_capture,'capture_gap');f.release();await settle();assert.equal(f.isEnabled(),false);f.widget.finish();assert.equal(f.isEnabled(),true);assert.equal(f.widget.observation().cumulative_capture,'ready');});
test('cumulative path requires the supported latest buffer',()=>{assert.throws(()=>mountTextboxPresence({tagName:'TEXTAREA'},{config:{enabled:true},enableCumulativeCapture:true}),/textbox_cumulative_requires_buffer/);});
test('disconnect clears queued sample and ignores later snapshot callbacks',async t=>{
 const f=setup();t.after(()=>f.widget.close());await settle();f.open();f.snapshot('first','interim');await settle();f.end();f.snapshot('queued','final');
 f.widget.render({status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:0,in_flight:false}},{connected:false});f.snapshot('late','interim');await f.advance(60000);assert.deepEqual(f.posts,['first']);
});
test('generation change clears queued sample and stale snapshot callbacks',async t=>{
 const f=setup();t.after(()=>f.widget.close());await settle();f.open();f.snapshot('first','interim');await settle();f.end();f.snapshot('queued','final');
 f.widget.render({status:'ready',session_generation:2,textbox:{consented:false,consent_revoked:true,refresh_after_ms:0,in_flight:false}},{connected:true});f.snapshot('late','interim');await f.advance(60000);assert.deepEqual(f.posts,['first']);
});
test('Shift+Enter and IME Enter do not end the mount gap or enable partial capture',async t=>{
 const f=setup({mountDelay:true});t.after(()=>f.widget.close());await settle();
 f.emit('keydown',{isTrusted:true,key:'a',code:'KeyA'});f.release();await settle();assert.equal(f.isEnabled(),false);
 for(const extra of [{shiftKey:true},{isComposing:true},{keyCode:229},{repeat:true},{altKey:true},{ctrlKey:true},{metaKey:true}]){
  f.emit('keydown',{isTrusted:true,key:'Enter',code:'Enter',...extra});await settle();assert.equal(f.isEnabled(),false);assert.equal(f.widget.observation().cumulative_capture,'capture_gap');
 }
 f.emit('keydown',{isTrusted:true,key:'Enter',code:'Enter'});await settle();assert.equal(f.isEnabled(),true);assert.equal(f.widget.observation().cumulative_capture,'ready');
});

test('skipping an unchanged final preserves the in-flight interim status and audit identity',async t=>{
 const f=setup({postDelay:true});t.after(()=>f.widget.close());await settle();f.open();f.snapshot('interim','interim');await settle();assert.equal(f.widget.observation().last_submission,'in_flight');
 f.end();f.snapshot('duplicate','final',false);f.releasePost();await settle();await settle();assert.equal(f.widget.observation().last_submission,'complete');
 const events=f.widget.windowEvents().events;assert.ok(events.some(e=>e.phase==='outcome'&&e.sample_id===1&&e.sample_kind==='interim'&&e.status==='ready'));assert.ok(events.some(e=>e.phase==='sample'&&e.sample_id===2&&e.sample_kind==='final'&&e.status==='unchanged_skipped'));assert.deepEqual(f.posts,['interim']);
});
test('skipping an unchanged final allows a queued interim to update after cooldown',async t=>{
 const f=setup();t.after(()=>f.widget.close());await settle();f.open();f.snapshot('first','interim');await settle();f.end();f.snapshot('same-first','final',false);
 f.open();f.snapshot('queued','interim');f.end();f.snapshot('same-queued','final',false);assert.equal(f.widget.observation().last_submission,'queued');
 await f.advance(30000);assert.deepEqual(f.posts,['first','queued']);assert.equal(f.widget.observation().last_submission,'complete');const events=f.widget.windowEvents().events;
 assert.ok(events.some(e=>e.phase==='dispatch'&&e.sample_id===3));assert.ok(events.some(e=>e.phase==='sample'&&e.sample_id===4&&e.status==='unchanged_skipped'));
});

test('interim pool exhaustion is recorded without typing data',async t=>{const f=setup();t.after(()=>f.widget.close());await settle();f.open();f.exhaust();const events=f.widget.windowEvents().events;assert.ok(events.some(e=>e.phase==='sample'&&e.status==='pool_exhausted'&&e.sample_id===null));assert.ok(!JSON.stringify(events).includes('keyAreas'));});

test('captured sample outcomes distinguish accepted readings from duplicates',async t=>{for(const receiptStatus of ['accepted','duplicate']){const f=setup({receiptStatus});t.after(()=>f.widget.close());await settle();f.open();f.snapshot('synthetic','interim');await settle();await settle();assert.ok(f.widget.windowEvents().events.some(e=>e.phase==='outcome'&&e.sample_kind==='interim'&&e.status===receiptStatus));}});

test('a preserved interruption records a partial window and offers its final sample',async t=>{const f=setup();t.after(()=>f.widget.close());await settle();f.open();f.partial();f.end('discontinuity');f.snapshot('completed-pairs','final');await settle();await settle();assert.deepEqual(f.posts,['completed-pairs']);assert.ok(f.widget.windowEvents().events.some(e=>e.phase==='end'&&e.reason==='discontinuity'&&e.status==='partial'));assert.equal(f.widget.timing().last_boundary.end_reason,'discontinuity');});
