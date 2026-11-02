import test from 'node:test';import assert from 'node:assert/strict';
import {createCaptureEventSync} from '../web/session-evidence.mjs';
const id='00000000-0000-4000-8000-000000000001';
const event=(n)=>({window_id:1,sample_id:n,sample_kind:'interim',phase:'sample',at_ms:1700000000000+n,reason:null,status:'captured',raw:'PRIVATE_SENTINEL'});
const ledger=n=>({ledger_id:id,session_generation:1,events:Array.from({length:n},(_,i)=>event(i+1)),events_omitted:0,raw:'PRIVATE_SENTINEL'});
const tick=()=>new Promise(r=>setImmediate(r));
test('automatically serializes and coalesces sanitized events; saved requires acknowledgement',async()=>{
 const calls=[],resolvers=[];const states=[];const sync=createCaptureEventSync({send:(body,options)=>{calls.push({body,options});return new Promise(resolve=>resolvers.push(resolve));},onChange:s=>states.push(s)});
 sync.setConnected(true);sync.observe(ledger(1));await tick();assert.equal(calls.length,1);assert.equal(sync.status(),'saving');assert.ok(!JSON.stringify(calls).includes('PRIVATE_SENTINEL'));
 sync.observe(ledger(2));sync.observe(ledger(3));await tick();assert.equal(calls.length,1);resolvers.shift()({ok:true,accepted_total:1});await tick();assert.equal(calls.length,2);assert.equal(calls[1].body.ledger.events.length,3);assert.equal(sync.status(),'saving');resolvers.shift()({ok:true,accepted_total:3});await tick();assert.equal(sync.status(),'saved');sync.observe(ledger(3));await tick();assert.equal(calls.length,2);sync.close();
});
test('failed persistence is explicit and can be retried on reconnect',async()=>{
 let calls=0;const sync=createCaptureEventSync({send:async()=>{calls++;if(calls===1)throw Error('synthetic');return{ok:true,accepted_total:1};}});sync.setConnected(true);sync.observe(ledger(1));await tick();assert.equal(sync.status(),'failed');assert.equal(calls,1);sync.setConnected(false);sync.setConnected(true);await tick();assert.equal(sync.status(),'saved');assert.equal(calls,2);sync.close();
});
test('closing while a post is in flight attempts a sanitized keepalive snapshot',async()=>{
 const calls=[];const sync=createCaptureEventSync({send:(body,options)=>{calls.push({body,options});return new Promise(()=>{});}});sync.setConnected(true);sync.observe(ledger(1));await tick();sync.observe(ledger(2));sync.close(ledger(2));await tick();assert.equal(calls.length,2);assert.equal(calls[1].options.keepalive,true);assert.equal(calls[1].body.ledger.events.length,2);assert.ok(!JSON.stringify(calls).includes('PRIVATE_SENTINEL'));
});
test('empty and malformed events never get sent or marked saved',async()=>{
 let calls=0;const sync=createCaptureEventSync({send:async()=>{calls++;return{ok:true,accepted_total:0};}});sync.setConnected(true);sync.observe(ledger(0));sync.observe({...ledger(1),ledger_id:'bad'});await tick();assert.equal(calls,0);assert.notEqual(sync.status(),'saved');sync.close();
});
test('a newer pending session is sent after an older request fails without more typing',async()=>{
 const calls=[],resolvers=[];const sync=createCaptureEventSync({send:body=>{calls.push(body);return new Promise((resolve,reject)=>resolvers.push({resolve,reject}));}});sync.setConnected(true);sync.observe(ledger(1));await tick();const next={...ledger(1),session_generation:2};sync.observe(next);resolvers.shift().reject(Error('old_generation'));await tick();assert.equal(calls.length,2);assert.equal(calls[1].generation,2);resolvers.shift().resolve({ok:true,accepted_total:1});await tick();assert.equal(sync.status(),'incomplete');sync.close();
});
test('a newer same-session snapshot is sent after an older request fails without more typing',async()=>{
 const calls=[],resolvers=[];const sync=createCaptureEventSync({send:body=>{calls.push(body);return new Promise((resolve,reject)=>resolvers.push({resolve,reject}));}});sync.setConnected(true);sync.observe(ledger(1));await tick();sync.observe(ledger(2));resolvers.shift().reject(Error('synthetic'));await tick();assert.equal(calls.length,2);assert.equal(calls[1].ledger.events.length,2);resolvers.shift().resolve({ok:true,accepted_total:2});await tick();assert.equal(sync.status(),'saved');sync.close();
});
test('ledger identity or capacity failures are visible and never reported saved',async()=>{
 const invalid=createCaptureEventSync({send:async()=>({ok:true,accepted_total:1})});invalid.setConnected(true);invalid.observe({...ledger(1),ledger_id:'bad'});assert.equal(invalid.status(),'failed');invalid.close();
 const full=createCaptureEventSync({send:async()=>{throw Error('capture_ledger_capacity');}});full.setConnected(true);full.observe(ledger(1));await tick();assert.equal(full.status(),'capacity');full.close();
});
test('a capacity failure in an earlier generation does not discard a newer session',async()=>{
 const calls=[],resolvers=[];const sync=createCaptureEventSync({send:body=>{calls.push(body);return new Promise((resolve,reject)=>resolvers.push({resolve,reject}));}});sync.setConnected(true);sync.observe(ledger(1));await tick();sync.observe({...ledger(1),session_generation:2});resolvers.shift().reject(Error('capture_ledger_capacity'));await tick();assert.equal(calls.length,2);assert.equal(calls[1].generation,2);resolvers.shift().resolve({ok:true,accepted_total:1});await tick();assert.equal(sync.status(),'incomplete');sync.close();
});
test('a later invalid observation cannot be hidden by an earlier successful acknowledgement',async()=>{
 let resolve;const sync=createCaptureEventSync({send:()=>new Promise(r=>{resolve=r;})});sync.setConnected(true);sync.observe(ledger(1));await tick();sync.observe({...ledger(1),ledger_id:'invalid'});assert.equal(sync.status(),'failed');resolve({ok:true,accepted_total:1});await tick();assert.equal(sync.status(),'incomplete');sync.close();
});
