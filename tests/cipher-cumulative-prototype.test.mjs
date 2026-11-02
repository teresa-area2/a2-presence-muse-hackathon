import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bindCumulativeCipherExperiment} from '../web/cipher-cumulative-experiment.mjs';
import {minimizeDesktopCipher} from '../src/cipher-capture.mjs';
const require=createRequire(new URL('../integrations/cipher-textbox/package.json',import.meta.url));
const {KeystrokeManager}=require('@area2-ai/a2-cipher-core');
function fakeElement(){const handlers=new Map();return{handlers,addEventListener(k,fn){if(!handlers.has(k))handlers.set(k,new Set());handlers.get(k).add(fn);},removeEventListener(k,fn){handlers.get(k)?.delete(fn);},emit(name,key,extra={}){const e={isTrusted:true,key,code:key==='Enter'?'Enter':'Key'+key.toUpperCase(),metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...extra};for(const fn of [...(handlers.get(name)??[])])fn(e);}};}
function adapter(){const manager=new KeystrokeManager();return{handleProcessKeydown:k=>manager.processKeydown(k),handleProcessKeyup:k=>manager.processKeyup(k),handleEndTypingSession(){const data=manager.endTypingSession();manager.resetTypingData();return data;}};}
function fixture(n=3){const element=fakeElement(),snapshots=[],statuses=[],captures=Array.from({length:n},adapter);const binding=bindCumulativeCipherExperiment({element,captures,onSnapshot:(payload,meta)=>snapshots.push({payload,meta}),onStatus:value=>statuses.push(value)});const tap=k=>{element.emit('keydown',k);element.emit('keyup',k);};binding.setEnabled(true);return{element,binding,snapshots,statuses,tap};}
const settle=()=>new Promise(r=>setImmediate(r));

test('bounded independent managers produce nested cumulative snapshots and final',async t=>{
 const f=fixture();t.after(()=>f.binding.close());f.tap('a');f.tap('b');assert.equal(f.binding.checkpoint().status,'finished');
 f.tap('c');assert.equal(f.binding.checkpoint().status,'finished');f.tap('d');assert.equal(f.binding.checkpoint().status,'exhausted');await f.binding.finish();
 assert.deepEqual(f.snapshots.map(x=>x.payload.length),[2,3,4]);assert.deepEqual(f.snapshots.map(x=>x.meta.kind),['interim','interim','final']);assert.deepEqual(f.snapshots.map(x=>x.meta.sequence),[1,2,3]);
 assert.equal(new Set(f.snapshots.map(x=>x.payload.sessionID)).size,3);for(const sample of f.snapshots)assert.equal(minimizeDesktopCipher(sample.payload).length,sample.payload.length);
 assert.equal(f.statuses.filter(x=>x==='window_open').length,1);assert.equal(f.statuses.filter(x=>x==='window_completed').length,1);assert.equal(f.binding.checkpoint().status,'unavailable');
});

test('held-key checkpoint defers until genuine release; final Enter emits once',async t=>{
 const f=fixture();t.after(()=>f.binding.close());f.tap('a');f.element.emit('keydown','b');assert.equal(f.binding.checkpoint().status,'held_key');assert.equal(f.snapshots.length,0);
 f.element.emit('keyup','b');assert.equal(f.binding.checkpoint().status,'finished');f.tap('c');f.element.emit('keydown','Enter');f.element.emit('keyup','Enter');await settle();
 assert.deepEqual(f.snapshots.map(x=>x.payload.length),[2,3]);assert.deepEqual(f.snapshots.map(x=>x.meta.kind),['interim','final']);await f.binding.finish();assert.equal(f.snapshots.length,2);
});

test('stop, revoke and close discard pending cumulative observations',async t=>{
 for(const action of ['discard','disable','close']){const f=fixture();t.after(()=>f.binding.close());f.tap('a');
  if(action==='discard')f.binding.discardWindow('stop');else if(action==='disable')f.binding.setEnabled(false);else f.binding.close();
  f.tap('b');await settle();assert.equal(f.snapshots.length,0,action);assert.equal(f.binding.checkpoint().status,'unavailable',action);
 }
});

test('partial shortcut publishes only completed pairs without fabricating releases',async t=>{
 const f=fixture();t.after(()=>f.binding.close());f.tap('a');f.element.emit('keydown','b');f.element.emit('keydown','Control',{code:'ControlLeft',ctrlKey:true});await settle();
 assert.equal(f.binding.checkpoint().status,'unavailable');await f.binding.finish();assert.equal(f.snapshots.length,1);assert.equal(f.snapshots[0].payload.length,1);assert.ok(f.statuses.includes('partial_discarded'));assert.ok(!f.statuses.includes('experiment_unavailable'));
});

test('manager pool is bounded and rejects shared managers before attaching listeners',()=>{
 const el=fakeElement(),a=adapter();for(const captures of [[a],[a,a],Array.from({length:6},adapter)])assert.throws(()=>bindCumulativeCipherExperiment({element:el,captures,onSnapshot(){}}),/cipher_cumulative_invalid/);assert.equal(el.handlers.size,0);
});

test('2001 completed pairs fail closed rather than emit an oversized observation',async t=>{
 const f=fixture(2);t.after(()=>f.binding.close());for(let i=0;i<2001;i++)f.tap('a');await settle();
 assert.ok(f.statuses.includes('overflow_pending'));assert.equal(f.binding.checkpoint().status,'unavailable');assert.equal(f.snapshots.length,0);
});

test('Stop from completion callback suppresses the final snapshot',async t=>{
 const element=fakeElement(),snapshots=[];let binding;
 binding=bindCumulativeCipherExperiment({element,captures:[adapter(),adapter()],onSnapshot:(value,meta)=>snapshots.push(meta),onStatus:value=>{if(value==='window_completed')binding.discardWindow('stop');}});t.after(()=>binding.close());
 binding.setEnabled(true);element.emit('keydown','a');element.emit('keyup','a');await binding.finish();assert.deepEqual(snapshots,[]);
});

test('checkpoint does not consume a collector when no new input has arrived',async t=>{
 const f=fixture();t.after(()=>f.binding.close());f.tap('a');assert.equal(f.binding.checkpoint().status,'finished');assert.equal(f.binding.checkpoint().status,'unchanged');assert.equal(f.snapshots.length,1);
 f.tap('b');assert.equal(f.binding.checkpoint().status,'finished');await f.binding.finish();
 assert.deepEqual(f.snapshots.map(x=>x.payload.length),[1,2,2]);assert.equal(f.snapshots.at(-1).meta.has_new_input,false);
});

test('automatic timer does not consume a snapshot without new typing',async t=>{
 const {createCipherClipDriver}=await import('../web/cipher-batching.mjs');let now=0,id=0;const timers=new Map(),f=fixture();
 const driver=createCipherClipDriver({binding:f.binding,now:()=>now,setTimer:(fn,ms)=>{const k=++id;timers.set(k,{fn,at:now+ms});return k;},clearTimer:k=>timers.delete(k)});t.after(()=>{driver.close();f.binding.close();});
 driver.deferUntil(15000);driver.start();f.tap('a');now=15000;for(const [k,v] of [...timers])if(v.at<=now){timers.delete(k);v.fn();}await settle();assert.equal(f.snapshots.length,1);
 now=45000;for(const [k,v] of [...timers])if(v.at<=now){timers.delete(k);v.fn();}await settle();assert.equal(f.snapshots.length,1);
 f.tap('b');driver.notifyInput();await settle();assert.equal(f.snapshots.length,2);driver.stop();await f.binding.finish();assert.equal(f.snapshots.length,3);
});

test('a failing consumer or status callback stops the prototype safely',async t=>{
 for(const mode of ['snapshot','status']){const element=fakeElement();let emitted=0;const binding=bindCumulativeCipherExperiment({element,captures:[adapter(),adapter()],onSnapshot(){emitted++;if(mode==='snapshot')throw Error('synthetic');},onStatus:value=>{if(mode==='status'&&value==='window_open')throw Error('synthetic');}});t.after(()=>binding.close());binding.setEnabled(true);
  element.emit('keydown','a');element.emit('keyup','a');if(mode==='snapshot')binding.checkpoint();await settle();assert.equal(binding.checkpoint().status,'unavailable');assert.equal(emitted,mode==='snapshot'?1:0);
 }
});

test('asynchronous consumer rejection is handled and stops later snapshots',async t=>{
 const element=fakeElement(),binding=bindCumulativeCipherExperiment({element,captures:[adapter(),adapter()],onSnapshot:()=>Promise.reject(Error('synthetic'))});t.after(()=>binding.close());
 binding.setEnabled(true);element.emit('keydown','a');element.emit('keyup','a');assert.equal(binding.checkpoint().status,'finished');await settle();assert.equal(binding.checkpoint().status,'unavailable');
});

test('pending asynchronous consumers fail closed before another snapshot can start',async t=>{
 const element=fakeElement();let calls=0;const binding=bindCumulativeCipherExperiment({element,captures:[adapter(),adapter(),adapter()],onSnapshot:()=>{calls++;return new Promise(()=>{});}});t.after(()=>binding.close());
 binding.setEnabled(true);element.emit('keydown','a');element.emit('keyup','a');assert.equal(binding.checkpoint().status,'finished');
 element.emit('keydown','b');element.emit('keyup','b');assert.equal(binding.checkpoint().status,'unavailable');await settle();assert.equal(calls,1);
});


test('five-manager pool yields four interim cumulative snapshots and preserves final',async t=>{
 const f=fixture(5);t.after(()=>f.binding.close());for(const key of ['a','b','c','d']){f.tap(key);assert.equal(f.binding.checkpoint().status,'finished');}f.tap('e');assert.equal(f.binding.checkpoint().status,'exhausted');await f.binding.finish();assert.deepEqual(f.snapshots.map(x=>x.payload.length),[1,2,3,4,5]);assert.deepEqual(f.snapshots.map(x=>x.meta.kind),['interim','interim','interim','interim','final']);assert.equal(new Set(f.snapshots.map(x=>x.payload.sessionID)).size,5);
});
