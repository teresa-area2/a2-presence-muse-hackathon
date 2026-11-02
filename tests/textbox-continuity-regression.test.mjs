import test from 'node:test';
import assert from 'node:assert/strict';
import {bindDesktopCipher} from '../web/cipher-batching.mjs';
import {TextboxPresence} from '../src/textbox-presence.mjs';

const capture=()=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:'synthetic',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
const controls={response_extent:'standard',unsolicited_update:'send',conversation_style:'conversational'};
const result=clock=>({status:'usable',guidance:'SYNTHETIC_GUIDANCE',controls,generated_at:new Date(clock).toISOString(),received_at:new Date(clock).toISOString(),renderer:'coding-instructions.3'});

test('a keyboard shortcut does not discard the completed part of a typing window',async()=>{
 const events=new Map(),element={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};let count=0;const batches=[];
 const binding=bindDesktopCipher({element,capture:{handleProcessKeydown(){count++;},handleProcessKeyup(){},handleEndTypingSession(){const n=count;count=0;return{count:n};}},onBatch:async payload=>batches.push(payload.count)});
 const emit=(kind,extra={})=>events.get(kind)({isTrusted:true,key:'a',code:'KeyA',metaKey:false,ctrlKey:false,...extra});
 const key=()=>{emit('keydown');emit('keyup');};
 binding.setEnabled(true);key();key();
 emit('keydown',{key:'Meta',code:'MetaLeft',metaKey:true});emit('keydown',{key:'ArrowLeft',code:'ArrowLeft',metaKey:true});emit('keyup',{key:'ArrowLeft',code:'ArrowLeft',metaKey:true});emit('keyup',{key:'Meta',code:'MetaLeft'});
 key();key();await binding.finish();binding.close();
 assert.deepEqual(batches,[4]);
});

test('a prior abort-ignoring refresh blocks new-session capture until it really settles',async()=>{
 let clock=0,release,calls=0;const p=new TextboxPresence({now:()=>clock,monotonicNow:()=>clock,client:{capture:()=>{calls++;return calls===1?new Promise(resolve=>release=resolve):Promise.resolve(result(clock));}}});
 p.open('one');p.setConsent(true);const old=p.capture(capture());p.setConsent(false);p.open('two');p.setConsent(true);clock=30000;
 const other=await p.capture(capture());assert.equal(other.status,'busy');assert.equal(calls,1);
 release(result(0));assert.equal((await old).status,'discarded');
 assert.equal((await p.capture(capture())).status,'deferred_unattempted');clock=60000;
 assert.equal((await p.capture(capture())).status,'ready');assert.equal(calls,2);
});

test('a late 429 from a discarded session still extends shared application backoff',async()=>{
 let clock=0,release,calls=0;const p=new TextboxPresence({now:()=>clock,monotonicNow:()=>clock,client:{capture:()=>{calls++;return calls===1?new Promise(resolve=>release=resolve):Promise.resolve(result(clock));}}});
 p.open('one');p.setConsent(true);const old=p.capture(capture());clock=10000;p.setConsent(false);p.open('two');p.setConsent(true);
 release({status:'backoff',retry_after_ms:90000});assert.equal((await old).status,'discarded');
 assert.equal(p.snapshot().refresh_after_ms,90000);
 clock=30000;assert.equal((await p.capture(capture())).status,'deferred_unattempted');assert.equal(calls,1);
 clock=100000;assert.equal((await p.capture(capture())).status,'ready');assert.equal(calls,2);
});


test('a late authorization rejection blocks a newer session and clears its guidance',async()=>{
 let clock=0,release,calls=0;const p=new TextboxPresence({now:()=>clock,monotonicNow:()=>clock,client:{capture:()=>{calls++;return new Promise(resolve=>release=resolve);}}});
 p.open('one');p.setConsent(true);const old=p.capture(capture());p.setConsent(false);p.open('two');p.setConsent(true);clock=30000;
 release({status:'access_rejected'});assert.equal((await old).status,'discarded');assert.equal(p.snapshot().status,'access_rejected');
 assert.equal((await p.capture(capture())).status,'access_rejected');assert.equal(p.selectForRequest().status,'fallback');assert.equal(calls,1);
});
