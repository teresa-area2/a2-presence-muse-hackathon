import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bindDualDesktopCipher,createCipherClipDriver} from '../web/cipher-batching.mjs';
import {createTextboxLatestBuffer} from '../web/textbox-presence-client.mjs';
const require=createRequire(new URL('../integrations/cipher-textbox/package.json',import.meta.url));
const {KeystrokeManager}=require('@area2-ai/a2-cipher-core');
function fixture({onClip=()=>{}}={}){
 const handlers=new Map(),snapshots=[],clips=[],statuses=[],clipStatuses=[];
 const element={addEventListener:(k,fn)=>{if(!handlers.has(k))handlers.set(k,new Set());handlers.get(k).add(fn);},removeEventListener:(k,fn)=>handlers.get(k)?.delete(fn)};
 function adapter(label){const manager=new KeystrokeManager();return {handleProcessKeydown:key=>manager.processKeydown(key),handleProcessKeyup:key=>manager.processKeyup(key),handleEndTypingSession(){const out=manager.endTypingSession();snapshots.push({label,data:out});manager.resetTypingData();return out;}};}
 const full=adapter('full'),clip=adapter('clip');const binding=bindDualDesktopCipher({element,fullCapture:full,clipCapture:clip,onClip:x=>{clips.push(x);onClip(x);},onLogicalStatus:value=>statuses.push(value),onClipStatus:(value,meta)=>{if(value==='window_completed')clipStatuses.push(meta.end_reason);}});
 const emit=(name,key,extra={})=>{const event={isTrusted:true,key,code:'Key'+key.toUpperCase(),metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...extra};for(const cb of [...(handlers.get(name)??[])])cb(event);};
 const tap=key=>{emit('keydown',key);emit('keyup',key);};binding.setEnabled(true);return{binding,emit,tap,clips,snapshots,statuses,clipStatuses,handlers};
}

test('interim checkpoints preserve one logical full session with non-overlapping clips',async t=>{
 const f=fixture();t.after(()=>f.binding.close());f.tap('a');f.emit('keydown','b');
 assert.equal(f.binding.checkpoint().status,'held_key');assert.equal(f.clips.length,0);
 f.emit('keyup','b');assert.equal(f.binding.checkpoint().status,'finished');await new Promise(r=>setImmediate(r));
 f.tap('c');assert.equal(f.binding.checkpoint().status,'finished');await new Promise(r=>setImmediate(r));f.tap('d');await f.binding.finish();
 assert.deepEqual(f.clips.map(x=>x.length),[2,1,1]);assert.deepEqual(f.clipStatuses,['checkpoint','checkpoint','send']);const full=f.snapshots.filter(x=>x.label==='full');assert.equal(full.length,1);assert.equal(full[0].data.length,4);
 assert.equal(new Set(f.clips.map(x=>x.sessionID)).size,3);assert.equal(f.statuses.filter(x=>x==='window_open').length,1);assert.equal(f.statuses.filter(x=>x==='window_completed').length,1);
});

test('blur and repeated finalization do not duplicate a clip or full session',async t=>{
 const f=fixture();t.after(()=>f.binding.close());f.tap('a');f.emit('blur','a');await f.binding.finish();await f.binding.finish();assert.equal(f.clips.length,1);assert.equal(f.snapshots.filter(x=>x.label==='full').length,1);
});

test('discard and disabling remove the remaining suffix without sending it',async t=>{
 const f=fixture();t.after(()=>f.binding.close());f.tap('a');f.binding.discardWindow('stop');await f.binding.finish();assert.equal(f.clips.length,0);
 f.tap('b');f.binding.setEnabled(false);await f.binding.finish();assert.equal(f.clips.length,0);
});

test('full-window overflow stops the experiment rather than silently losing the aggregate',async t=>{
 const f=fixture();t.after(()=>f.binding.close());for(let i=0;i<2001;i++)f.tap('a');await new Promise(r=>setImmediate(r));
 assert.ok(f.statuses.includes('overflow_pending'));assert.equal(f.binding.checkpoint().status,'unavailable');assert.equal(f.clips.length,0);
});

test('a collector failure stops both streams without emitting another clip',async t=>{
 const handlers=new Map(),clips=[];const el={addEventListener:(k,fn)=>{if(!handlers.has(k))handlers.set(k,new Set());handlers.get(k).add(fn);},removeEventListener:(k,fn)=>handlers.get(k)?.delete(fn)};
 const full={handleProcessKeydown(){throw Error('synthetic');},handleProcessKeyup(){},handleEndTypingSession(){return null;}};
 const clip={handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession(){return null;}};
 const dual=bindDualDesktopCipher({element:el,fullCapture:full,clipCapture:clip,onClip:x=>clips.push(x)});t.after(()=>dual.close());dual.setEnabled(true);
 for(const fn of handlers.get('keydown'))fn({isTrusted:true,key:'a',code:'KeyA',metaKey:false,ctrlKey:false,shiftKey:false,altKey:false});await new Promise(r=>setImmediate(r));
 assert.equal(dual.checkpoint().status,'unavailable');assert.deepEqual(clips,[]);
});


test('real interim clips and latest-only buffer preserve non-overlapping emission order',async t=>{
 let now=0,timerId=0,seq=0;const timers=new Map(),attempts=[];
 const buffer=createTextboxLatestBuffer({now:()=>now,setTimer:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:now+ms});return id;},clearTimer:id=>timers.delete(id),dispatch:async x=>{attempts.push(x.sessionID);return{status:'ready'};}});
 const f=fixture({onClip:x=>buffer.offer(x,{token:buffer.token(),sequence:++seq,completedAt:now})});t.after(()=>{f.binding.close();buffer.close();});
 f.tap('a');f.binding.checkpoint();await new Promise(r=>setImmediate(r));now=5000;f.tap('b');f.binding.checkpoint();now=10000;f.tap('c');await f.binding.finish();
 assert.equal(f.clips.length,3);assert.equal(attempts.length,1);now=30000;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}await new Promise(r=>setImmediate(r));
 assert.deepEqual(attempts,[f.clips[0].sessionID,f.clips[2].sessionID]);assert.ok(!attempts.includes(f.snapshots.find(x=>x.label==='full').data.sessionID));
});


test('offline driver clips at the green deadline without closing the full session',async t=>{
 let clock=0,id=0;const timers=new Map(),f=fixture();const driver=createCipherClipDriver({binding:f.binding,now:()=>clock,setTimer:(fn,ms)=>{const n=++id;timers.set(n,{fn,at:clock+ms});return n;},clearTimer:n=>timers.delete(n)});t.after(()=>{driver.close();f.binding.close();});
 const advance=async ms=>{clock+=ms;for(const [n,timer] of [...timers])if(timer.at<=clock){timers.delete(n);timer.fn();}await new Promise(r=>setImmediate(r));};
 driver.deferUntil(15000);driver.start();f.tap('a');driver.notifyInput();await advance(14999);assert.equal(f.clips.length,0);await advance(1);assert.equal(f.clips.length,1);
 f.emit('keydown','b');await advance(30000);assert.equal(f.clips.length,1);f.emit('keyup','b');driver.notifyInput();await new Promise(r=>setImmediate(r));assert.equal(f.clips.length,2);
 f.tap('c');driver.stop();await f.binding.finish();assert.equal(f.clips.length,3);assert.equal(f.snapshots.find(x=>x.label==='full').data.length,3);assert.equal(f.statuses.filter(x=>x==='window_open').length,1);
});

test('an incomplete shortcut pair stops clipping instead of silently resetting the full aggregate',async t=>{
 const f=fixture();t.after(()=>f.binding.close());f.tap('a');f.emit('keydown','b');f.emit('keydown','Control',{code:'ControlLeft',ctrlKey:true});
 await new Promise(r=>setImmediate(r));assert.ok(f.statuses.includes('partial_discarded'));assert.equal(f.binding.checkpoint().status,'unavailable');assert.equal(f.clips.length,0);
});
