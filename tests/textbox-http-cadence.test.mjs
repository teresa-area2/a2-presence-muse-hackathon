import test from 'node:test';import assert from 'node:assert/strict';
import {createOpenPresenceClient} from '../src/op-service-client.mjs';import {TextboxPresence} from '../src/textbox-presence.mjs';
const sample=()=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:'synthetic',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
const res=x=>new Response(JSON.stringify(x));
test('30s service cadence starts at actual HTTP capture dispatch after delayed authentication',async()=>{
 let now=0,release;const attempts=[];const client=createOpenPresenceClient({environment:'dev',client_id:'ID',client_secret:'SECRET',now:()=>now,resolveCodingInstructions:()=>({status:'invalid'}),fetcher:async url=>{if(url.endsWith('/token')){await new Promise(r=>release=r);return res({access_token:'TOKEN',expires_in:300});}attempts.push(now);return res({status:'success'});}});
 const p=new TextboxPresence({client,now:()=>now,monotonicNow:()=>now});p.open('first');p.setConsent(true);const first=p.capture(sample());now=1000;release();await first;assert.deepEqual(attempts,[1000]);
 now=30000;assert.equal((await p.capture(sample())).status,'deferred_unattempted');assert.equal(p.snapshot().refresh_after_ms,1000);assert.deepEqual(attempts,[1000]);now=31000;await p.capture(sample());assert.deepEqual(attempts,[1000,31000]);
});

test('dispatch-based gate survives Stop and a new session',async()=>{
 let now=0,release;const attempts=[];const client=createOpenPresenceClient({environment:'dev',client_id:'ID',client_secret:'SECRET',now:()=>now,resolveCodingInstructions:()=>({status:'invalid'}),fetcher:async url=>{if(url.endsWith('/token')){await new Promise(r=>release=r);return res({access_token:'TOKEN',expires_in:300});}attempts.push(now);return res({status:'success'});}});
 const p=new TextboxPresence({client,now:()=>now,monotonicNow:()=>now});p.open('first');p.setConsent(true);const first=p.capture(sample());now=1200;release();await first;p.clear();p.open('second');p.setConsent(true);now=30000;assert.equal((await p.capture(sample())).status,'deferred_unattempted');assert.equal(p.snapshot().refresh_after_ms,1200);assert.deepEqual(attempts,[1200]);now=31200;await p.capture(sample());assert.deepEqual(attempts,[1200,31200]);
});

test('Stop during authentication prevents a late capture request',async()=>{
 let now=0,release,captures=0,auth=0;const client=createOpenPresenceClient({environment:'dev',client_id:'ID',client_secret:'SECRET',now:()=>now,resolveCodingInstructions:()=>({status:'invalid'}),fetcher:async url=>{if(url.endsWith('/token')){if(++auth===1)await new Promise(r=>release=r);return res({access_token:'TOKEN',expires_in:300});}captures++;return res({status:'success'});}});
 const p=new TextboxPresence({client,now:()=>now,monotonicNow:()=>now});p.open('first');p.setConsent(true);const first=p.capture(sample());p.clear();now=1000;release();assert.equal((await first).status,'discarded');assert.equal(captures,0);p.open('second');p.setConsent(true);now=30000;await p.capture(sample());assert.equal(captures,1);
});
