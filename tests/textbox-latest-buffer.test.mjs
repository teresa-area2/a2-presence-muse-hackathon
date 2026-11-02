import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextboxLatestBuffer} from '../web/textbox-latest-buffer.mjs';

const payload=id=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:id,startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday',private_extra:'never_forward'});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let time=0,id=0,offerSequence=0,timers=new Map(),eligible=true;const attempts=[],settlements=[],events=[];
 const buffer=createTextboxLatestBuffer({now:()=>time,setTimer:(fn,ms)=>{const k=++id;timers.set(k,{fn,at:time+ms});return k;},clearTimer:k=>timers.delete(k),isEligible:()=>eligible,onEvent:event=>events.push(event),dispatch:(batch,context)=>{attempts.push({batch,context});return new Promise((resolve,reject)=>settlements.push({resolve,reject}));}});
 const advance=async delta=>{const end=time+delta;for(;;){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}time=end;await flush();};
 const api={...buffer,offer:(value,options)=>buffer.offer(value,{token:buffer.token(),sequence:++offerSequence,...options})};
 return{buffer:api,raw:buffer,events,attempts,settlements,advance,time:()=>time,timers,eligible:value=>{eligible=value;buffer.notifyEligibilityChanged();}};
}

test('latest unattempted window replaces older, stays private, and dispatches after cooldown',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});await flush();assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].batch.private_extra,undefined);
 f.buffer.offer(payload('two'),{completedAt:0});f.buffer.offer(payload('three'),{completedAt:0});assert.equal(f.attempts.length,1);
 f.settlements[0].resolve({status:'ready'});await flush();await f.advance(29999);assert.equal(f.attempts.length,1);await f.advance(1);
 assert.equal(f.attempts.length,2);assert.equal(f.attempts[1].batch.sessionID,'three');assert.equal(f.attempts[1].context.captureAgeMs,30000);assert.equal(JSON.stringify(f.buffer.status()).includes('three'),false);f.buffer.close();
});

test('failure is not retried; supplied cooldown applies after settlement',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});await flush();await f.advance(1000);f.buffer.offer(payload('two'),{completedAt:1000});f.settlements[0].resolve({status:'unavailable',cooldown_ms:60000});await flush();await f.advance(59999);assert.equal(f.attempts.length,1);await f.advance(1);assert.equal(f.attempts[1].batch.sessionID,'two');f.settlements[1].reject(Error('synthetic'));await flush();await f.advance(120000);assert.equal(f.attempts.length,2);f.buffer.close();
});

test('rate limit preserves the newest unattempted sample until its deadline',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});await flush();f.buffer.offer(payload('two'),{completedAt:0});f.settlements[0].resolve({status:'backoff',cooldown_ms:90000});await flush();assert.equal(f.buffer.status().pending,true);await f.advance(89999);assert.equal(f.attempts.length,1);await f.advance(1);assert.equal(f.attempts[1].batch.sessionID,'two');f.buffer.close();
});

test('local broker gate and age expiration never cause autonomous stale dispatch',async()=>{
 const f=fixture();f.eligible(false);f.buffer.offer(payload('one'),{completedAt:0});await f.advance(120000);assert.equal(f.buffer.status().last,'expired');f.eligible(true);await flush();assert.equal(f.attempts.length,0);assert.equal(f.buffer.offer(payload('old'),{completedAt:0}),false);
 f.buffer.offer(payload('fresh'),{completedAt:f.time()});await flush();assert.equal(f.attempts[0].context.captureAgeMs,0);f.buffer.close();
});

test('clear aborts, drops pending and timers; close rejects input and late settlement cannot replay',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});await flush();f.buffer.offer(payload('two'),{completedAt:0});const signal=f.attempts[0].context.signal;f.buffer.clear();assert.equal(signal.aborted,true);assert.equal(f.buffer.status().pending,false);assert.equal(f.timers.size,0);
 f.buffer.close();assert.throws(()=>f.buffer.offer(payload('three'),{completedAt:0}),/closed/);f.settlements[0].resolve({status:'ready'});await flush();await f.advance(120000);assert.equal(f.attempts.length,1);assert.equal(f.buffer.status().closed,true);
});

test('a cleared session response applies its shared gate without discarding new-session pending input',async()=>{
 const f=fixture();f.buffer.offer(payload('old'),{completedAt:0});await flush();f.buffer.clear();f.buffer.offer(payload('new'),{completedAt:0});assert.equal(f.attempts.length,1);f.settlements[0].resolve({status:'rate_limited',cooldown_ms:30000});await flush();assert.equal(f.buffer.status().pending,true);await f.advance(29999);assert.equal(f.attempts.length,1);await f.advance(1);assert.equal(f.attempts[1].batch.sessionID,'new');f.buffer.close();
});

test('clear before dispatch microtask prevents the attempted send',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});f.buffer.clear();await flush();assert.equal(f.attempts.length,0);assert.equal(f.buffer.status().pending,false);f.buffer.close();
});

test('a late older observation cannot replace newer completed input',async()=>{
 const f=fixture();f.eligible(false);await f.advance(100);f.buffer.offer(payload('newer'),{completedAt:100});
 assert.equal(f.buffer.offer(payload('older'),{completedAt:50}),false);f.eligible(true);await flush();
 assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].batch.sessionID,'newer');f.buffer.close();
});

test('access rejection clears any other waiting observation',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});await flush();f.buffer.offer(payload('two'),{completedAt:0});
 f.settlements[0].resolve({status:'access_rejected'});await flush();assert.equal(f.buffer.status().pending,false);assert.equal(f.buffer.status().last,'access_rejected');
 await f.advance(30000);assert.equal(f.attempts.length,1);f.buffer.close();
});

test('access rejection stays latched across ordinary session resets',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});await flush();f.settlements[0].resolve({status:'access_rejected'});await flush();
 f.buffer.clear();await f.advance(30000);assert.equal(f.buffer.offer(payload('two'),{completedAt:f.time()}),false);await flush();assert.equal(f.attempts.length,1);assert.equal(f.buffer.status().blocked,true);f.buffer.close();
});

test('actual broker retry_after_ms gates a new sample captured during cooldown',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});await flush();f.settlements[0].resolve({status:'backoff',retry_after_ms:90000});await flush();
 await f.advance(1);assert.equal(f.buffer.offer(payload('during-backoff'),{completedAt:f.time()}),true);await f.advance(89998);assert.equal(f.attempts.length,1);await f.advance(1);assert.equal(f.attempts.length,2);assert.equal(f.attempts[1].batch.sessionID,'during-backoff');f.buffer.close();
});

test('captured epoch and window sequence reject late or repeated completion',async()=>{
 const f=fixture();let token=f.buffer.token();assert.equal(f.buffer.offer(payload('one'),{completedAt:0,token,sequence:1}),true);await flush();
 assert.equal(f.buffer.offer(payload('duplicate'),{completedAt:0,token,sequence:1}),false);
 f.buffer.clear();assert.equal(f.buffer.offer(payload('old'),{completedAt:0,token,sequence:2}),false);
 token=f.buffer.token();assert.equal(f.buffer.offer(payload('new'),{completedAt:0,token,sequence:1}),true);f.buffer.close();
});

test('eligibility is rechecked immediately before dispatch',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});f.eligible(false);await flush();
 assert.equal(f.attempts.length,0);assert.equal(f.buffer.status().pending,true);f.eligible(true);await flush();assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].batch.sessionID,'one');f.buffer.close();
});

test('cancel before dispatch does not start an unnecessary cooldown',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});f.buffer.clear();await flush();
 f.buffer.offer(payload('two'),{completedAt:0});await flush();assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].batch.sessionID,'two');f.buffer.close();
});


test('offer requires an explicit current token and unique sequence',async()=>{
 const f=fixture();assert.equal(f.raw.offer(payload('missing'),{completedAt:0}),false);
 const token=f.raw.token();assert.equal(f.raw.offer(payload('one'),{completedAt:0,token,sequence:1}),true);await flush();
 assert.equal(f.raw.offer(payload('duplicate'),{completedAt:0,token,sequence:1}),false);f.raw.clear();
 assert.equal(f.raw.offer(payload('stale'),{completedAt:0,token,sequence:2}),false);f.raw.close();
});

test('a later completed observation replaces an older unattempted window during 429 cooldown',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});await flush();await f.advance(10000);f.settlements[0].resolve({status:'backoff',retry_after_ms:30000});await flush();
 await f.advance(1);assert.equal(f.buffer.offer(payload('old-window'),{completedAt:9999}),true);assert.equal(f.buffer.offer(payload('fresh-window'),{completedAt:f.time()}),true);
 await f.advance(29998);assert.equal(f.attempts.length,1);await f.advance(1);assert.equal(f.attempts.length,2);assert.equal(f.attempts[1].batch.sessionID,'fresh-window');f.buffer.close();
});

test('a newer window arriving before the dispatch microtask replaces the reserved one',async()=>{
 const f=fixture();f.buffer.offer(payload('old'),{completedAt:0});f.buffer.offer(payload('new'),{completedAt:0});await flush();
 assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].batch.sessionID,'new');f.buffer.close();
});


test('authoritative 429 before dispatch holds the reserved unattempted observation',async()=>{
 const f=fixture();f.buffer.offer(payload('old'),{completedAt:0});f.buffer.rateLimitUntil(30000);await flush();assert.equal(f.attempts.length,0);assert.equal(f.buffer.status().last,'queued');
 await f.advance(29999);assert.equal(f.attempts.length,0);await f.advance(1);assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].batch.sessionID,'old');f.buffer.close();
});

test('ordinary updated admission deadline keeps an unattempted observation waiting',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});f.buffer.deferUntil(30000);await flush();assert.equal(f.attempts.length,0);assert.equal(f.buffer.status().pending,true);
 await f.advance(29999);assert.equal(f.attempts.length,0);await f.advance(1);assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].batch.sessionID,'one');f.buffer.close();
});

test('clear after a reserved window is replaced does not add a second terminal outcome',async()=>{
 const f=fixture();f.buffer.offer(payload('one'),{completedAt:0});f.buffer.offer(payload('two'),{completedAt:0});queueMicrotask(()=>f.buffer.clear());await flush();
 const first=f.events.filter(e=>e.sequence===1&&(['replaced','outcome'].includes(e.phase)));assert.deepEqual(first.map(e=>[e.phase,e.status]),[['replaced',null]]);assert.equal(f.attempts.length,0);f.buffer.close();
});
test('newly completed observations during 429 wait latest-only until the authoritative green deadline',async()=>{
 const f=fixture();f.buffer.offer(payload('attempted'),{completedAt:0});await flush();await f.advance(1000);f.settlements[0].resolve({status:'backoff',retry_after_ms:30000});await flush();
 await f.advance(1000);assert.equal(f.buffer.offer(payload('newer'),{completedAt:f.time()}),true);await f.advance(1000);assert.equal(f.buffer.offer(payload('latest'),{completedAt:f.time()}),true);
 assert.equal(f.buffer.status().pending,true);await f.advance(27999);assert.equal(f.attempts.length,1);await f.advance(1);assert.equal(f.attempts.length,2);assert.equal(f.attempts[1].batch.sessionID,'latest');assert.equal(f.attempts.filter(x=>x.batch.sessionID==='attempted').length,1);f.buffer.close();
});
test('Stop clears samples queued during a 429 cooldown',async()=>{
 const f=fixture();f.buffer.offer(payload('attempted'),{completedAt:0});await flush();await f.advance(10);f.settlements[0].resolve({status:'backoff',retry_after_ms:30000});await flush();await f.advance(1);f.buffer.offer(payload('pending'),{completedAt:f.time()});f.buffer.clear();await f.advance(60000);assert.equal(f.attempts.length,1);assert.equal(f.buffer.status().pending,false);f.buffer.close();
});
test('a 429-queued sample expires if retry-after exceeds its freshness',async()=>{
 const f=fixture();f.buffer.offer(payload('attempted'),{completedAt:0});await flush();await f.advance(10);f.settlements[0].resolve({status:'backoff',retry_after_ms:150000});await flush();await f.advance(1);f.buffer.offer(payload('pending'),{completedAt:f.time()});await f.advance(120000);assert.equal(f.attempts.length,1);assert.equal(f.buffer.status().last,'expired');await f.advance(30000);assert.equal(f.attempts.length,1);f.buffer.close();
});
test('a sample created after a 429 broadcast survives its delayed response',async()=>{
 const f=fixture();f.buffer.offer(payload('attempted'),{completedAt:0});await flush();await f.advance(100);f.buffer.rateLimitUntil(30100);await f.advance(100);f.buffer.offer(payload('new-after-broadcast'),{completedAt:f.time()});assert.equal(f.buffer.status().pending,true);
 await f.advance(100);f.settlements[0].resolve({status:'backoff',retry_after_ms:29800});await flush();assert.equal(f.buffer.status().pending,true);await f.advance(29999);assert.equal(f.attempts.length,1);await f.advance(1);assert.equal(f.attempts.length,2);assert.equal(f.attempts[1].batch.sessionID,'new-after-broadcast');f.buffer.close();
});
test('clear then a 429 before dispatch never resurrects the cancelled observation',async()=>{
 const f=fixture();f.buffer.offer(payload('cancelled'),{completedAt:0});f.buffer.clear();f.buffer.rateLimitUntil(30000);await flush();assert.equal(f.buffer.status().pending,false);await f.advance(30000);assert.equal(f.attempts.length,0);f.buffer.close();
});
test('clear then a 429 before dispatch preserves only new-generation input',async()=>{
 const f=fixture();f.buffer.offer(payload('cancelled'),{completedAt:0});f.buffer.clear();f.buffer.rateLimitUntil(30000);f.buffer.offer(payload('new-generation'),{completedAt:0});await flush();await f.advance(29999);assert.equal(f.attempts.length,0);await f.advance(1);assert.deepEqual(f.attempts.map(x=>x.batch.sessionID),['new-generation']);f.buffer.close();
});
