import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipherClipDriver} from '../web/cipher-batching.mjs';
function setup(){let clock=0,id=0,completed=0;const timers=new Map(),snapshots=[];const binding={hasCompletedInput:()=>completed>0,hasMinimumInput:()=>completed>=2,checkpoint(){if(!completed)return{status:'empty'};snapshots.push(clock);return{status:'finished'};}};
 const driver=createCipherClipDriver({binding,firstSampleMinMs:5000,now:()=>clock,setTimer:(fn,ms)=>{const key=++id;timers.set(key,{at:clock+ms,fn});return key;},clearTimer:key=>timers.delete(key)});
 const advance=ms=>{const target=clock+ms;for(;;){const due=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!due||due[1].at>target)break;timers.delete(due[0]);clock=due[1].at;due[1].fn();}clock=target;};
 return{driver,snapshots,advance,input(){completed++;driver.notifyInput();},noise(){driver.notifyInput();},resetInput(){completed=0;}};
}
test('first automatic snapshot waits after actual typing, then respects 30-second cadence',()=>{const f=setup();f.driver.start();f.noise();f.advance(10000);f.input();f.input();f.advance(4999);assert.deepEqual(f.snapshots,[]);f.advance(1);assert.deepEqual(f.snapshots,[15000]);f.input();f.advance(29999);assert.deepEqual(f.snapshots,[15000]);f.advance(1);assert.deepEqual(f.snapshots,[15000,45000]);f.driver.close();});
test('an authoritative longer deadline wins, and stop cancels pending checkpoint',()=>{const f=setup();f.driver.deferUntil(15000);f.driver.start();f.input();f.advance(14999);assert.deepEqual(f.snapshots,[]);f.driver.stop();f.advance(10000);assert.deepEqual(f.snapshots,[]);f.driver.close();});
test('a new window starts its own minimum without resetting the call gate',()=>{const f=setup();f.driver.start();f.input();f.input();f.advance(5000);assert.deepEqual(f.snapshots,[5000]);f.driver.stop();f.resetInput();f.driver.start();f.advance(10000);f.input();f.input();f.advance(19999);assert.deepEqual(f.snapshots,[5000]);f.advance(1);assert.deepEqual(f.snapshots,[5000,35000]);f.driver.close();});

test('one key followed by idle never creates a premature interim snapshot',()=>{const f=setup();f.driver.start();f.input();f.advance(60000);assert.deepEqual(f.snapshots,[]);f.input();assert.deepEqual(f.snapshots,[60000]);f.driver.close();});
