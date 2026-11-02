import test from 'node:test';
import assert from 'node:assert/strict';
import {bindDesktopCipher} from '../web/cipher-batching.mjs';
import {mountTextboxPresence} from '../web/textbox-presence-client.mjs';
import {TextboxPresence} from '../src/textbox-presence.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const timing=()=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:'synthetic',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});
const base=Date.parse('2026-10-28T12:00:00Z');
const policy={response_extent:'standard',unsolicited_update:'send',conversation_style:'conversational'};
const reordered={conversation_style:'conversational',unsolicited_update:'send',response_extent:'standard'};
const sample=(at,controls=policy,extra={})=>({status:'usable',guidance:'SYNTHETIC_GUIDANCE',controls,generated_at:new Date(base+at).toISOString(),received_at:new Date(base+at).toISOString(),renderer:'coding-instructions.3',...extra});

test('receipt and policy status compares public field values, not key order',async()=>{
 let at=0,value=sample(0);const p=new TextboxPresence({now:()=>at,monotonicNow:()=>at,client:{capture:async()=>value}});p.open('one');p.setConsent(true);
 await p.capture(timing());assert.equal(p.snapshot().last_receipt,'accepted');assert.equal(p.snapshot().policy_change,'first');
 at+=30000;value=sample(at,reordered);await p.capture(timing());assert.equal(p.snapshot().policy_change,'unchanged');assert.equal(p.snapshot().reading_count,2);
 at+=30000;value=sample(at,{...policy,response_extent:'terse'});await p.capture(timing());const selected=p.selectForRequest();assert.equal(p.snapshot().policy_change,'changed');assert.equal(p.snapshot().receipt_count,3);
 at+=30000;value=sample(60000,{conversation_style:'conversational',response_extent:'terse',unsolicited_update:'send'});await p.capture(timing());assert.equal(p.snapshot().last_receipt,'duplicate');assert.equal(p.snapshot().policy_change,'unchanged');assert.equal(p.snapshot().reading_count,3);assert.equal(p.selectForRequest().reading_id,selected.reading_id);
 at+=30000;value=sample(60000,{...policy,response_extent:'full'});await p.capture(timing());assert.equal(p.snapshot().last_receipt,'rejected_order');assert.equal(p.snapshot().reading_count,3);assert.equal(p.selectForRequest().reading_id,selected.reading_id);
 at+=30000;value={status:'unavailable'};await p.capture(timing());assert.equal(p.snapshot().last_receipt,'unavailable');assert.equal(p.snapshot().policy_change,'unchanged');assert.equal(p.selectForRequest().status,'selected');
 at+=120001;assert.equal(p.selectForRequest().status,'selected');assert.equal(p.selectForRequest().reading_freshness,'last_known');p.clear();p.open('two');assert.equal(p.snapshot().receipt_count,0);assert.equal(p.snapshot().policy_change,'none');
});

test('local observation distinguishes completed, pending and discarded windows without contents',async()=>{
 const events=new Map(),element={tagName:'TEXTAREA',parentElement:{},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};Object.defineProperty(element,'value',{get(){throw Error('private text must not be read');}});
 let clock=0,release,widget,state={status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:0,in_flight:false}};
 const fakeCapture={handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession:timing};
 widget=mountTextboxPresence(element,{config:{enabled:true,live_enabled:true,session_authorized:true},now:()=>clock,onState:s=>{state=s;widget.render(s,{connected:true});},post:async()=>new Promise(resolve=>release=resolve),loadCollector:async()=>({mountCipherTextarea:async(target,opts)=>bindDesktopCipher({element:target,capture:fakeCapture,...opts})})});
 widget.render(state,{connected:true});await settle();
 const key=()=>{events.get('keydown')({isTrusted:true,key:'a',code:'KeyA'});events.get('keyup')({isTrusted:true,key:'a',code:'KeyA'});};
 key();assert.equal(widget.observation().window,'open');const pending=widget.finish();assert.deepEqual(widget.observation(),{window:'closed',last_window:'completed',last_submission:'in_flight'});
 key();await widget.finish();assert.equal(widget.observation().last_submission,'discarded_in_flight');
 state={...state,textbox:{...state.textbox,refresh_after_ms:30000}};release({state,capture_status:'ready'});await pending;
 assert.equal(widget.observation().last_submission,'discarded_in_flight','an earlier response must not overwrite the later dropped-window outcome');
 key();await widget.finish();assert.equal(widget.observation().last_submission,'discarded_cooldown');
 assert.ok(!JSON.stringify(widget.observation()).includes('synthetic'));widget.close();
});

test('backend in-flight gate prevents a new window from posting when another client is still settling',async()=>{
 const events=new Map(),element={tagName:'TEXTAREA',parentElement:{},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};let sends=0,widget;
 const state={status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:0,in_flight:true}};
 widget=mountTextboxPresence(element,{config:{enabled:true,live_enabled:true,session_authorized:true},onState(){},post:async()=>{sends++;},loadCollector:async()=>({mountCipherTextarea:async(target,opts)=>bindDesktopCipher({element:target,capture:{handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession:timing},...opts})})});
 widget.render(state,{connected:true});await settle();events.get('keydown')({isTrusted:true,key:'a',code:'KeyA'});events.get('keyup')({isTrusted:true,key:'a',code:'KeyA'});await widget.finish();assert.equal(sends,0);assert.equal(widget.observation().last_submission,'discarded_in_flight');widget.close();
});


test('empty focus moving to Stop reports a closed window and permits later input',async()=>{
 const element=new EventTarget(),stop=new EventTarget();element.tagName='TEXTAREA';stop.disabled=false;let widget,sends=0;const state={status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:0}};
 widget=mountTextboxPresence(element,{config:{enabled:true,live_enabled:true,session_authorized:true},stopElement:stop,onState(){},post:async()=>{sends++;return{state,capture_status:'ready'};},loadCollector:async()=>({mountCipherTextarea:async(target,opts)=>bindDesktopCipher({element:target,capture:{handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession:timing},...opts})})});
 widget.render(state,{connected:true});await settle();element.dispatchEvent(new Event('focus'));assert.equal(widget.observation().window,'open');
 const blur=new Event('blur');Object.defineProperty(blur,'relatedTarget',{value:stop});element.dispatchEvent(blur);assert.equal(widget.observation().window,'closed');assert.equal(widget.observation().last_window,'empty');assert.equal(sends,0);
 for(const kind of['keydown','keyup']){const event=new Event(kind);for(const [key,value]of Object.entries({isTrusted:true,key:'a',code:'KeyA'}))Object.defineProperty(event,key,{value});element.dispatchEvent(event);}await widget.finish();assert.equal(sends,1);widget.close();
});


test('a completed window with no SDK payload is not left pending or sent',async()=>{
 const events=new Map(),element={tagName:'TEXTAREA',parentElement:{},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};let sends=0,widget;
 const state={status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:0,in_flight:false}};
 widget=mountTextboxPresence(element,{config:{enabled:true,live_enabled:true,session_authorized:true},onState(){},post:async()=>{sends++;},loadCollector:async()=>({mountCipherTextarea:async(target,opts)=>bindDesktopCipher({element:target,capture:{handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession(){return undefined;}},...opts})})});
 widget.render(state,{connected:true});await settle();for(const kind of['keydown','keyup'])events.get(kind)({isTrusted:true,key:'a',code:'KeyA'});await widget.finish();assert.equal(sends,0);assert.deepEqual(widget.observation(),{window:'closed',last_window:'completed',last_submission:'not_submitted'});widget.close();
});


test('partial-window status survives successful, cooldown and in-flight outcomes',async()=>{
 for(const mode of['success','cooldown','in_flight']){
  const events=new Map(),element={tagName:'TEXTAREA',parentElement:{},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};let widget,sends=0;const state={status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:mode==='cooldown'?30000:0,in_flight:mode==='in_flight'}};
  widget=mountTextboxPresence(element,{config:{enabled:true,live_enabled:true,session_authorized:true},now:()=>0,onState(){},post:async()=>{sends++;return{state,capture_status:'ready'};},loadCollector:async()=>({mountCipherTextarea:async(target,opts)=>bindDesktopCipher({element:target,capture:{handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession:timing},...opts})})});
  widget.render(state,{connected:true});await settle();const emit=(type,extra={})=>events.get(type)({isTrusted:true,key:'a',code:'KeyA',metaKey:false,ctrlKey:false,...extra});
  emit('keydown');emit('keyup');emit('keydown',{key:'b',code:'KeyB'});emit('keydown',{key:'Meta',code:'MetaLeft',metaKey:true});emit('keyup',{key:'Meta',code:'MetaLeft'});emit('keydown');emit('keyup');await widget.finish();
  assert.equal(sends,mode==='success'?1:0,mode);assert.equal(widget.observation().last_window,'completed_partial',mode);assert.equal(widget.observation().last_submission,{success:'complete',cooldown:'discarded_cooldown',in_flight:'discarded_in_flight'}[mode]);widget.close();
 }
});

test('oversized input stays in its logical window until an actual boundary',async()=>{
 const events=new Map(),element={tagName:'TEXTAREA',parentElement:{},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};let widget,sends=0;const state={status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:0,in_flight:false}};
 widget=mountTextboxPresence(element,{config:{enabled:true,live_enabled:true,session_authorized:true},onState(){},post:async()=>{sends++;},loadCollector:async()=>({mountCipherTextarea:async(target,opts)=>bindDesktopCipher({element:target,capture:{handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession:timing},...opts})})});
 widget.render(state,{connected:true});await settle();for(let i=0;i<2001;i++){events.get('keydown')({isTrusted:true,key:'a',code:'KeyA'});events.get('keyup')({isTrusted:true,key:'a',code:'KeyA'});}assert.equal(widget.observation().window,'open');assert.equal(sends,0);await widget.finish();assert.equal(widget.observation().window,'closed');assert.equal(widget.observation().last_window,'discarded_incomplete');assert.equal(sends,0);widget.close();
});

test('window timing exposes focus and actual Enter boundary without exposing keystroke data',async()=>{
 const events=new Map(),element={tagName:'TEXTAREA',parentElement:{},addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};let widget,wall=1700000000000,mono=10;const state={status:'ready',session_generation:1,textbox:{consented:true,refresh_after_ms:0,in_flight:false}};
 widget=mountTextboxPresence(element,{config:{enabled:true,live_enabled:true,session_authorized:true},now:()=>mono,wallNow:()=>wall,onState(){},post:async()=>({state,capture_status:'ready'}),loadCollector:async()=>({mountCipherTextarea:async(target,opts)=>bindDesktopCipher({element:target,capture:{handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession:timing},...opts})})});
 widget.render(state,{connected:true});await settle();events.get('focus')();assert.equal(widget.timing().current_window_started_at_ms,wall);
 events.get('keydown')({isTrusted:true,key:'a',code:'KeyA'});events.get('keyup')({isTrusted:true,key:'a',code:'KeyA'});wall+=400;mono+=5;events.get('keydown')({isTrusted:true,key:'Enter',code:'Enter'});await settle();
 assert.deepEqual(widget.timing(),{current_window_started_at_ms:null,last_boundary:{started_at_ms:1700000000000,ended_at_ms:1700000000400,end_reason:'enter',eligibility_elapsed_ms:0}});
 assert.equal(JSON.stringify(widget.timing()).includes('synthetic'),false);widget.close();
});
