import test from 'node:test';import assert from 'node:assert/strict';
import {createOpenPresenceClient} from '../src/op-service-client.mjs';
const payload=()=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:'synthetic',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
const capsule={generated_at:'2026-10-28T12:00:00Z',controls:{response_extent:'standard',unsolicited_update:'send',conversation_style:'conversational'},instructions:{version:'coding-instructions.3',llm:{preamble:'SYNTHETIC_GUIDANCE'}}};
const options=(fetcher,now)=>({environment:'dev',client_id:'SYNTHETIC_ID',client_secret:'SYNTHETIC_SECRET',resolveCodingInstructions:c=>({status:'usable',capsule:c}),fetcher,now});

test('tokens are reused and renewed before expiry, without replaying an observation',async()=>{
 let at=0,auth=0,captures=0;const headers=[];const c=createOpenPresenceClient(options(async(url,request)=>{if(url.endsWith('/token')){auth++;return response({access_token:'SYNTHETIC_TOKEN_'+auth,expires_in:60});}captures++;headers.push(request.headers.authorization);return response({status:'success',results:{a2_open:capsule}});},()=>at));
 await c.capture(payload());at=29999;await c.capture(payload());at=30000;await c.capture(payload());assert.equal(auth,2);assert.equal(captures,3);assert.equal(headers[0],headers[1]);assert.notEqual(headers[1],headers[2]);
});
test('401 and 403 at Auth or Capture stop all later calls',async()=>{
 for(const stage of['auth','capture'])for(const rejected of[401,403]){let calls=0;const c=createOpenPresenceClient(options(async url=>{calls++;if(url.endsWith('/token'))return stage==='auth'?response({},rejected):response({access_token:'SYNTHETIC_TOKEN',expires_in:60});return response({},rejected);},()=>0));
  assert.equal((await c.capture(payload())).status,'access_rejected');const previous=calls;assert.equal((await c.capture(payload())).status,'access_rejected');assert.equal(calls,previous,stage+' '+rejected);
 }
});
test('non-JSON or empty HTTP 503 is a service failure without auth churn or replay',async()=>{
 for(const body of ['<html>service unavailable</html>',null,JSON.stringify({error:'unavailable'})]){
  let auth=0,captures=0;const c=createOpenPresenceClient(options(async url=>{if(url.endsWith('/token')){auth++;return response({access_token:'SYNTHETIC_TOKEN',expires_in:60});}captures++;return new Response(body,{status:503});},()=>0));
  assert.equal((await c.capture(payload())).status,'unavailable');assert.equal(c.diagnostics().last_http_status,503);assert.equal(c.diagnostics().error,'op_capture_unavailable');assert.equal(captures,1);
  assert.equal((await c.capture(payload())).status,'unavailable');assert.equal(auth,1);assert.equal(captures,2);
 }
});
