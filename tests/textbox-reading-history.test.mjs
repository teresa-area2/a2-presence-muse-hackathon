import test from 'node:test';
import assert from 'node:assert/strict';
import {TextboxPresence} from '../src/textbox-presence.mjs';

const base=Date.parse('2026-10-28T12:00:00Z');
const controls={response_extent:'standard',unsolicited_update:'send',conversation_style:'conversational'};
const capture=()=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:'synthetic',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
const reading=(generated,policy=controls)=>({status:'usable',guidance:'PRIVATE_GUIDANCE',controls:{...policy,private_extra:'PRIVATE_CONTROL'},generated_at:new Date(base+generated).toISOString(),received_at:'2000-01-01T00:00:00.000Z',renderer:'coding-instructions.3',capsule:'PRIVATE_CAPSULE'});

test('unique readings append even for unchanged policy; duplicate, older and invalid do not',async()=>{
 let now=base,sequence=0,value=reading(0);const p=new TextboxPresence({now:()=>now,monotonicNow:()=>now,makeId:()=>`id-${++sequence}`,client:{capture:async()=>value}});
 p.open('session');p.setConsent(true);await p.capture(capture());
 now+=30000;value=reading(1000);await p.capture(capture());
 now+=30000;value=reading(2000,{...controls,response_extent:'terse'});await p.capture(capture());
 const snapshot=p.snapshot();assert.deepEqual(snapshot.readings.map(x=>x.policy_change),['first','unchanged','changed']);
 assert.deepEqual(snapshot.readings.map(x=>x.reading_id),['id-1','id-2','id-3']);
 assert.deepEqual(snapshot.readings.map(x=>x.received_at),[0,30000,60000].map(x=>new Date(base+x).toISOString()));
 assert.equal(snapshot.reading_id,'id-3');assert.equal(snapshot.readings_omitted,0);
 assert.deepEqual(Object.keys(snapshot.readings[0]).sort(),['controls','generated_at','policy_change','reading_id','received_at'].sort());
 assert.deepEqual(snapshot.readings[0].controls,controls);
 assert.ok(!JSON.stringify(snapshot.readings).includes('PRIVATE'));
 const rows=JSON.stringify(snapshot.readings),last=p.selectForRequest();snapshot.readings.pop();
 assert.equal(p.snapshot().readings.length,3,'returned array cannot mutate internal history');
 now+=30000;value=reading(2000,{...controls,response_extent:'terse'});await p.capture(capture());
 assert.equal(p.snapshot().last_receipt,'duplicate');assert.equal(p.selectForRequest().reading_id,last.reading_id);assert.equal(p.selectForRequest().age_ms,30000);
 now+=30000;value=reading(1500);await p.capture(capture());assert.equal(p.snapshot().last_receipt,'rejected_order');
 now+=30000;value=reading(2000,controls);await p.capture(capture());assert.equal(p.snapshot().last_receipt,'rejected_order');
 now+=30000;value={status:'invalid'};await p.capture(capture());
 assert.equal(JSON.stringify(p.snapshot().readings),rows);assert.equal(p.snapshot().readings_omitted,0);
});

test('reading ring counts evictions and survives stop, then resets for a new session',async()=>{
 let now=base,sequence=0;const p=new TextboxPresence({now:()=>now,monotonicNow:()=>now,makeId:()=>`id-${++sequence}`,client:{capture:async()=>reading(now-base)}});
 p.open('session');p.setConsent(true);
 for(let i=0;i<203;i++){await p.capture(capture());now+=30000;}
 const before=p.snapshot();assert.equal(before.readings.length,200);assert.equal(before.readings_omitted,3);assert.equal(before.readings[0].reading_id,'id-4');assert.equal(before.readings.at(-1).reading_id,'id-203');
 p.clear({preserveHistory:true});const stopped=p.snapshot();assert.deepEqual(stopped.readings,before.readings);assert.equal(stopped.readings_omitted,3);assert.equal(stopped.reading_id,null);
 p.open('new-session');const fresh=p.snapshot();assert.deepEqual(fresh.readings,[]);assert.equal(fresh.readings_omitted,0);assert.equal(fresh.reading_count,0);
 p.setConsent(true);await p.capture(capture());assert.equal(p.snapshot().readings[0].policy_change,'first');
 p.clear();assert.deepEqual(p.snapshot().readings,[]);assert.equal(p.snapshot().readings_omitted,0);
});

test('repeated consent cannot reset the ordering watermark or re-age a duplicate',async()=>{
 let now=base,sequence=0,value=reading(0);const p=new TextboxPresence({now:()=>now,monotonicNow:()=>now,makeId:()=>`id-${++sequence}`,client:{capture:async()=>value}});
 p.open('session');p.setConsent(true);await p.capture(capture());const first=p.selectForRequest();
 p.setConsent(true);assert.equal(p.selectForRequest().reading_id,first.reading_id);
 now+=30000;await p.capture(capture());assert.equal(p.snapshot().last_receipt,'duplicate');assert.equal(p.snapshot().readings.length,1);assert.equal(p.selectForRequest().age_ms,30000);
 p.setConsent(true);now+=30000;value=reading(-1000);await p.capture(capture());assert.equal(p.snapshot().last_receipt,'rejected_order');assert.equal(p.snapshot().readings.length,1);assert.equal(p.selectForRequest().reading_id,first.reading_id);
});
