import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bindDesktopCipher} from '../web/cipher-batching.mjs';
import {minimizeTextboxBatch} from '../web/textbox-presence-client.mjs';
import {minimizeDesktopCipher} from '../src/cipher-capture.mjs';
import {createOpenPresenceClient} from '../src/op-service-client.mjs';

// Actual installed Cipher core; synthetic events/text/credentials and injected
// HTTP only. This is not a React/browser mount, TLS audit or retention guarantee.
const require=createRequire(new URL('../integrations/cipher-textbox/package.json',import.meta.url));
const {KeystrokeManager}=require('@area2-ai/a2-cipher-core');
const composerText='SYNTHETIC_COMPOSER_TEXT_7f08e';
const rawKey='SYNTHETIC_RAW_KEY_4a03b';
const appContext='SYNTHETIC_APP_CONTEXT_8dd1c';
const emojiContent='SYNTHETIC_EMOJI_CONTENT_b149e';
const clientId='SYNTHETIC_PRIVACY_CLIENT',clientSecret='SYNTHETIC_PRIVACY_SECRET',bearer='SYNTHETIC_PRIVACY_TOKEN';
const metadataFields=['keyAreas','keyTypes','pressTimes','releaseTimes','length','sessionID','startUnixTime','season','time','timeZone','weekday'];
const json=value=>new Response(JSON.stringify(value));
const same=(actual,expected,message)=>assert.ok(JSON.stringify(actual)===JSON.stringify(expected),message);

async function syntheticWindow(t){
 const events=new Map(),seenRawKeys=[],manager=new KeystrokeManager();let composerReads=0,captured=null,finalized=0;
 const element={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 Object.defineProperty(element,'value',{get(){composerReads++;return composerText;}});
 const capture={
  handleProcessKeydown:key=>{seenRawKeys.push(key);manager.processKeydown(key);},
  handleProcessKeyup:key=>manager.processKeyup(key),
  handleEndTypingSession:()=>{finalized++;const data=manager.endTypingSession();manager.resetTypingData();return data.startUnixTime?{...data,appContext,emojis:[emojiContent]}:undefined;}
 };
 const binding=bindDesktopCipher({element,capture,onBatch:async payload=>{captured=payload;}});t.after(()=>binding.close());
 binding.setEnabled(true);events.get('focus')();
 // The long key value is a synthetic raw-string sentinel, not real keyboard data.
 for(const [key,code]of[['a','KeyA'],[' ','Space'],[rawKey,'KeyQ']]){
  events.get('keydown')({isTrusted:true,key,code});events.get('keyup')({isTrusted:true,key,code});
 }
 assert.equal(captured,null,'focus and input alone do not dispatch');
 await binding.finish('send');
 assert.equal(finalized,1);assert.equal(composerReads,0,'binding must not read composer text');
 assert.ok(seenRawKeys.includes(rawKey),'raw DOM key strings reach Cipher locally');
 assert.equal(captured.length,3);assert.ok(captured.sessionID&&/^[0-9a-f-]{36}$/i.test(captured.sessionID),'installed core creates a session identifier');
 return captured;
}

function transport(environment,inspectCapture){
 const calls=[];
 const client=createOpenPresenceClient({environment,client_id:clientId,client_secret:clientSecret,resolveCodingInstructions:()=>({status:'invalid'}),fetcher:async(url,request)=>{
  assert.equal(request.method,'POST');assert.equal(request.redirect,'error');
  same(Object.keys(request.headers).sort(),['accept','authorization','content-type'],'only explicit transport headers');
  assert.equal(request.headers['content-type'],'application/json');assert.equal(request.headers.accept,'application/json');
  if(url==='https://auth.area2-ai.com/token'){
   calls.push('auth');assert.equal(request.body,'{}');
   assert.ok(request.headers.authorization==='Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),'backend app credentials go to Auth via Basic');
   return json({access_token:bearer,expires_in:300});
  }
  assert.equal(url,environment==='production'?'https://api.area2-ai.com/v2/capture':'https://api-dev.area2-ai.com/v2/capture');calls.push('capture');
  assert.ok(request.headers.authorization==='Bearer '+bearer,'only the synthetic Bearer token goes to capture');
  const envelope=JSON.parse(request.body);same(Object.keys(envelope).sort(),['actions','open_presence_instructions_version','open_presence_schema','payload','user_mode'],'closed capture envelope');
  same(envelope.actions,['a2_open'],'action');assert.equal(envelope.open_presence_schema,'open_presence.controls.v0.4');assert.equal(envelope.open_presence_instructions_version,'coding-instructions.3');assert.equal(envelope.user_mode,'internal');
  same(Object.keys(envelope.payload).sort(),[...metadataFields,'signal_type'].sort(),'closed metadata payload');assert.equal(envelope.payload.signal_type,'keystroke-mech');
  for(const sentinel of[composerText,rawKey,appContext,emojiContent,clientId,clientSecret,bearer])assert.ok(!request.body.includes(sentinel),'capture JSON must exclude synthetic text, raw keys, semantic context and access secrets');
  inspectCapture(envelope.payload);
  // Invalid synthetic result: this test verifies outbound transport only.
  return json({status:'success',results:{a2_open:{}}});
 }});
 return{client,calls};
}

for(const environment of['dev','production'])test('real Cipher → minimizers → '+environment+' OP transport preserves only the declared metadata',async t=>{
 const raw=await syntheticWindow(t),browser=minimizeTextboxBatch(raw),backend=minimizeDesktopCipher(browser);
 same(Object.keys(browser).sort(),metadataFields.slice().sort(),'browser metadata fields');same(Object.keys(backend).sort(),metadataFields.slice().sort(),'backend metadata fields');
 for(const field of metadataFields){same(browser[field],raw[field],'browser preserves '+field);same(backend[field],raw[field],'backend preserves '+field);}
 assert.ok(browser.pressTimes.every(Number.isFinite)&&browser.releaseTimes.every(Number.isFinite));assert.equal(browser.pressTimes[0],0);assert.ok(browser.startUnixTime>0&&Number.isFinite(browser.timeZone));
 const f=transport(environment,sent=>{for(const field of metadataFields)same(sent[field],raw[field],'wire preserves '+field);});t.after(()=>f.client.clear());
 assert.equal((await f.client.capture(browser)).status,'invalid');same(f.calls,['auth','capture'],'only injected Auth and capture calls');
});

test('browser whitelist drops injected text/identity fields rather than claiming to reject them',async t=>{
 const raw=await syntheticWindow(t),injected={...raw,text:composerText,rawKeys:[rawKey],prompt:composerText,email:'synthetic@example.invalid',name:'SYNTHETIC_NAME',subject_id:'SYNTHETIC_SUBJECT'};
 const projected=minimizeTextboxBatch(injected);same(Object.keys(projected).sort(),metadataFields.slice().sort(),'only whitelisted fields remain');
 for(const field of metadataFields)same(projected[field],raw[field],'metadata preserved after projection');
 for(const value of[composerText,rawKey,appContext,emojiContent,'synthetic@example.invalid','SYNTHETIC_NAME','SYNTHETIC_SUBJECT'])assert.ok(!JSON.stringify(projected).includes(value));
});

test('backend rejects unexpected content/identity fields or content in constrained arrays before Auth/capture',async t=>{
 const browser=minimizeTextboxBatch(await syntheticWindow(t));let fetches=0;
 const client=createOpenPresenceClient({environment:'dev',client_id:clientId,client_secret:clientSecret,resolveCodingInstructions:()=>({status:'invalid'}),fetcher:async()=>{fetches++;throw Error('injected fetch must not be reached');}});t.after(()=>client.clear());
 for(const key of['text','rawKeys','key','code','prompt','source_code','email','name','subject_id','identity_key','internal_user_id'])await assert.rejects(client.capture({...browser,[key]:composerText}),/cipher_capture_invalid/);
 for(const change of[{keyTypes:browser.keyTypes.map(()=>rawKey)},{keyAreas:browser.keyAreas.map(()=>rawKey)},{time:composerText}])await assert.rejects(client.capture({...browser,...change}),/cipher_capture_invalid/);
 assert.equal(fetches,0);
});

test('backend independently removes allowed semantic fields and preserves fractional timezone metadata',async t=>{
 const browser=minimizeTextboxBatch(await syntheticWindow(t)),input={...browser,timeZone:5.75,appContext,emojis:[emojiContent]};
 const f=transport('dev',sent=>{assert.equal(sent.timeZone,5.75);for(const field of metadataFields.filter(x=>x!=='timeZone'))same(sent[field],browser[field],'wire preserves '+field);});t.after(()=>f.client.clear());
 assert.equal((await f.client.capture(input)).status,'invalid');same(f.calls,['auth','capture'],'only fake transport called');
});
