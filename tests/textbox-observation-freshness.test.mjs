import test from 'node:test';
import assert from 'node:assert/strict';
import {TextboxPresence} from '../src/textbox-presence.mjs';
const base=Date.parse('2026-10-29T10:00:00Z');
const payload=()=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:'synthetic',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
const reading=()=>({status:'usable',guidance:'SYNTHETIC',controls:{response_extent:'standard',unsolicited_update:'send',conversation_style:'conversational'},generated_at:new Date(base).toISOString(),received_at:new Date(base).toISOString(),renderer:'coding-instructions.3'});

test('deferred observation freshness is anchored at input end, not new OP receipt',async()=>{
 let at=base,calls=0;const p=new TextboxPresence({now:()=>at,monotonicNow:()=>at,client:{capture:async()=>{calls++;return reading();}}});p.open('one');p.setConsent(true);
 await p.capture(payload(),{observationEndedAtMs:base-90000});const first=p.selectForRequest();assert.equal(first.status,'selected');assert.equal(first.age_ms,0);assert.equal(first.observation_age_ms,90000);
 at+=30001;assert.equal(p.selectForRequest().status,'selected');assert.equal(p.selectForRequest().reading_freshness,'last_known');assert.equal(p.selectForRequest().observation_age_ms,120001);assert.equal(calls,1);
});

test('invalid, future or already expired observation does not reach OP',async()=>{
 let calls=0;const p=new TextboxPresence({now:()=>base,client:{capture:async()=>{calls++;return reading();}}});p.open('one');p.setConsent(true);
 for(const value of [base+1,base-120001,-1,0.5,NaN])assert.equal((await p.capture(payload(),{observationEndedAtMs:value})).status,'observation_expired');
 assert.equal(calls,0);
});

test('a late OP response cannot make an expired observation eligible',async()=>{
 let at=base,resolve;const p=new TextboxPresence({now:()=>at,monotonicNow:()=>at,client:{capture:()=>new Promise(r=>resolve=r)}});p.open('one');p.setConsent(true);
 const pending=p.capture(payload(),{observationEndedAtMs:base-119999});at+=2;resolve(reading());await pending;assert.equal(p.selectForRequest().status,'fallback');
});


test('slower wall time cannot make old observation look current',async()=>{
 let wall=base,mono=1000;const p=new TextboxPresence({now:()=>wall,monotonicNow:()=>mono,client:{capture:async()=>reading()}});p.open('one');p.setConsent(true);
 await p.capture(payload(),{observationEndedAtMs:base-90000});wall+=1000;mono+=31001;assert.equal(p.selectForRequest().status,'selected');assert.equal(p.selectForRequest().reading_freshness,'last_known');assert.equal(p.selectForRequest().observation_age_ms,121001);
});
