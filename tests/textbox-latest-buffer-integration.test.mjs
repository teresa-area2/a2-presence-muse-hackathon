import test from 'node:test';
import assert from 'node:assert/strict';
import {mountTextboxPresence} from '../web/textbox-presence-client.mjs';
import {bindDesktopCipher} from '../web/cipher-batching.mjs';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const sample=id=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:id,startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
function fixture({emptySecond=false}={}){
 let clock=0,timerId=0,seq=0,release;const timers=new Map(),events=new Map(),stopEvents=new Map(),posts=[];
 const element={tagName:'TEXTAREA',parentElement:{},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};
 const stop={disabled:false,addEventListener:(k,v)=>stopEvents.set(k,v),removeEventListener:k=>stopEvents.delete(k)};
 const state={status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:0,in_flight:false}};
 const fakeCapture={handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession:()=>{seq++;return emptySecond&&seq===2?null:sample(`window-${seq}`);}};
 let widget;widget=mountTextboxPresence(element,{enableLatestBuffer:true,config:{enabled:true,live_enabled:true,session_authorized:true},stopElement:stop,now:()=>clock,wallNow:()=>1700000000000+clock,
  setTimeoutFn:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},clearTimeoutFn:id=>timers.delete(id),
  loadCollector:async()=>({mountCipherTextarea:async(target,opts)=>bindDesktopCipher({element:target,capture:fakeCapture,...opts})}),
  onState:next=>widget.render(next,{connected:true}),post:async(action,body)=>{assert.equal(action,'presence/capture');posts.push(body.capture.sessionID);if(posts.length===1)return new Promise(resolve=>{release=resolve;});return{capture_status:'ready',state:{...state,textbox:{...state.textbox,refresh_after_ms:30000}}};}});
 widget.render(state,{connected:true});
 const key=()=>{events.get('keydown')({isTrusted:true,key:'a',code:'KeyA',ctrlKey:false,metaKey:false});events.get('keyup')({isTrusted:true,key:'a',code:'KeyA',ctrlKey:false,metaKey:false});};
 const advance=async ms=>{const until=clock+ms;for(;;){const due=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!due||due[1].at>until)break;clock=due[1].at;timers.delete(due[0]);due[1].fn();await settle();}clock=until;await settle();};
 return{widget,key,posts,advance,stopEvents,backoff:()=>widget.render({...state,textbox:{...state.textbox,status:'backoff',refresh_after_ms:30000,in_flight:false}},{connected:true}),release:()=>release({capture_status:'ready',state:{...state,textbox:{...state.textbox,refresh_after_ms:30000}}})};
}

test('enabled browser integration sends latest waiting window without blocking Muse',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();
 f.key();await f.widget.finish();await settle();assert.deepEqual(f.posts,['window-1']);
 f.key();await f.widget.finish();f.key();await f.widget.finish();assert.equal(f.widget.observation().last_submission,'queued');
 f.release();await settle();await f.advance(29999);assert.deepEqual(f.posts,['window-1']);await f.advance(1);assert.deepEqual(f.posts,['window-1','window-3']);
});

test('Stop discards pending input and prevents later background dispatch',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();f.key();await f.widget.finish();await settle();f.key();await f.widget.finish();
 f.widget.suspend();f.release();await settle();await f.advance(60000);assert.deepEqual(f.posts,['window-1']);
});


test('an older response does not overwrite a newer no-payload outcome',async t=>{
 const f=fixture({emptySecond:true});t.after(()=>f.widget.close());await settle();f.key();await f.widget.finish();await settle();f.key();await f.widget.finish();
 assert.equal(f.widget.observation().last_submission,'not_submitted');f.release();await settle();assert.equal(f.widget.observation().last_submission,'not_submitted');
});


test('Stop pointer intent clears waiting input before the eventual click',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();f.key();await f.widget.finish();await settle();f.key();await f.widget.finish();
 f.stopEvents.get('pointerdown')({button:0});assert.equal(f.widget.observation().last_submission,'unconfirmed');f.release();await settle();await f.advance(60000);assert.deepEqual(f.posts,['window-1']);
});

test('typing resumes after Stop pointer intent is cancelled',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();f.key();await f.widget.finish();await settle();f.key();await f.widget.finish();
 f.stopEvents.get('pointerdown')({button:0});f.key();await f.widget.finish();assert.equal(f.widget.observation().last_submission,'queued');
 f.release();await settle();await f.advance(30000);assert.deepEqual(f.posts,['window-1','window-3']);
});


test('authoritative 429 retains a new sample after a cancelled Stop until the gate clears',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();f.key();await f.widget.finish();await settle();f.stopEvents.get('pointerdown')({button:0});
 f.key();await f.widget.finish();assert.equal(f.widget.observation().last_submission,'queued');f.backoff();f.release();await settle();await f.advance(30000);
 assert.deepEqual(f.posts,['window-1','window-2']);
});

test('private event ledger records start, end, replacement and actual dispatch',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();
 f.key();await f.widget.finish();await settle();await f.advance(5000);f.key();await f.widget.finish();await f.advance(5000);f.key();await f.widget.finish();
 let ledger=f.widget.windowEvents();assert.equal(ledger.events_omitted,0);
 const events=ledger.events.map(({window_id,phase,status})=>[window_id,phase,status]);
 assert.deepEqual(events.slice(0,9),[[1,'start',null],[1,'end','completed'],[1,'queued',null],[1,'dispatch',null],[2,'start',null],[2,'end','completed'],[2,'queued',null],[3,'start',null],[3,'end','completed']]);
 assert.ok(events.some(row=>row[0]===2&&row[1]==='replaced'));assert.ok(events.some(row=>row[0]===3&&row[1]==='queued'));
 f.release();await settle();await f.advance(30000);ledger=f.widget.windowEvents();assert.ok(ledger.events.some(e=>e.window_id===3&&e.phase==='dispatch'));assert.ok(!ledger.events.some(e=>e.window_id===2&&e.phase==='dispatch'));
 assert.ok(!JSON.stringify(ledger).includes('window-'));assert.ok(!JSON.stringify(ledger).includes('key'));assert.ok(!JSON.stringify(ledger).includes('SYNTHETIC'));
 const copy=ledger.events;copy.length=0;assert.ok(f.widget.windowEvents().events.length>0);
});


test('Stop records unconfirmed in-flight cancellation only once',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();f.key();await f.widget.finish();await settle();
 f.stopEvents.get('pointerdown')({button:0});f.stopEvents.get('pointerdown')({button:0});f.release();await settle();
 const rows=f.widget.windowEvents().events.filter(x=>x.window_id===1&&x.phase==='outcome');assert.deepEqual(rows.map(x=>x.status),['cancel_requested']);
});

test('event ledger is bounded and resets for a new session generation',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();
 for(let i=0;i<110;i++){f.key();await f.widget.finish();}const before=f.widget.windowEvents();assert.equal(before.events.length,200);assert.ok(before.events_omitted>0);
 f.widget.render({status:'ready',session_generation:2,textbox:{consented:false,consent_revoked:true,refresh_after_ms:0,in_flight:false}},{connected:true});
 const after=f.widget.windowEvents();assert.equal(after.session_generation,2);assert.deepEqual(after.events,[]);assert.equal(after.events_omitted,0);
});
test('Stop and an immediate backoff cannot restore a reserved textbox sample',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();f.key();void f.widget.finish();f.widget.suspend();f.backoff();await settle();await f.advance(30000);assert.deepEqual(f.posts,[]);
});
test('a generation change and immediate backoff cannot dispatch the old sample',async t=>{
 const f=fixture();t.after(()=>f.widget.close());await settle();f.key();void f.widget.finish();
 f.widget.render({status:'ready',session_generation:2,textbox:{consented:false,consent_revoked:true,status:'backoff',refresh_after_ms:30000,in_flight:false}},{connected:true});await settle();await f.advance(30000);assert.deepEqual(f.posts,[]);
});
