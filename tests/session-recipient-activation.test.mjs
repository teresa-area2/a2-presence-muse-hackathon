import test from 'node:test';
import assert from 'node:assert/strict';
import {bindRecipientActivation,paneRecipientAllowed} from '../web/session-app.mjs';
import {nextRecipientTarget} from '../web/session-controls.mjs';

function event(type,properties={}){
 const value=new Event(type,{cancelable:true});
 Object.defineProperties(value,Object.fromEntries(Object.entries({button:0,ctrlKey:false,metaKey:false,...properties}).map(([key,value])=>[key,{value}])));
 return value;
}
test('macOS Control-contextmenu adds the other recipient without a click event',()=>{
 const without=new EventTarget(),withPresence=new EventTarget();let target='both';
 const bind=(element,arm)=>bindRecipientActivation(element,e=>{target=nextRecipientTarget(target,arm,e);});
 bind(without,'without');bind(withPresence,'with');
 without.dispatchEvent(event('click'));assert.equal(target,'without');
 const control=event('contextmenu',{ctrlKey:true,button:2});
 withPresence.dispatchEvent(control);assert.equal(target,'both');assert.equal(control.defaultPrevented,true);
 withPresence.dispatchEvent(event('click'));assert.equal(target,'with');
 without.dispatchEvent(event('click',{metaKey:true}));assert.equal(target,'both','Command-click shares the same recipient path');
});
test('ordinary context menus, blocked controls and disabled buttons keep their behavior',()=>{
 const element=new EventTarget();let calls=0,allowed=true;
 const close=bindRecipientActivation(element,()=>calls++,{allow:()=>allowed});
 const plain=event('contextmenu',{button:2});element.dispatchEvent(plain);assert.equal(calls,0);assert.equal(plain.defaultPrevented,false);
 allowed=false;const blocked=event('contextmenu',{ctrlKey:true,button:2});element.dispatchEvent(blocked);assert.equal(calls,0);assert.equal(blocked.defaultPrevented,false);
 allowed=true;element.disabled=true;element.dispatchEvent(event('contextmenu',{ctrlKey:true,button:2}));assert.equal(calls,0);
 element.disabled=false;element.dispatchEvent(event('click'));assert.equal(calls,1);
 close();element.dispatchEvent(event('click'));element.dispatchEvent(event('contextmenu',{ctrlKey:true,button:2}));assert.equal(calls,1);
});
test('stale selected text does not disable headings; transcript copying and interactive controls stay protected',()=>{
 const pointer=(region,modifiers={})=>({target:{closest:selector=>selector==='.session-feed'?(region==='transcript'?{}:null):(region==='interactive'?{}:null)},...modifiers});
 assert.equal(paneRecipientAllowed(pointer('heading'),{selectionText:'old transcript selection'}),true);
 assert.equal(paneRecipientAllowed(pointer('transcript'),{selectionText:'copy this'}),false);
 assert.equal(paneRecipientAllowed(pointer('transcript'),{selectionText:''}),true);
 for(const modifier of [{ctrlKey:true},{metaKey:true}]){
  assert.equal(paneRecipientAllowed(pointer('transcript',modifier),{selectionText:'copy this'}),true);
  assert.equal(paneRecipientAllowed(pointer('interactive',modifier)),false);
 }
});


test('an approval gesture never selects a pane when its click is retargeted after an update',()=>{
 const pane=new EventTarget(),control={closest:()=>({})},background={closest:()=>null};let selected=0;
 bindRecipientActivation(pane,()=>selected++,{protectControls:true});
 pane.dispatchEvent(event('pointerdown',{target:control}));
 pane.dispatchEvent(event('click',{target:background,detail:1}));assert.equal(selected,0);
 pane.dispatchEvent(event('contextmenu',{target:background,ctrlKey:true,button:2}));assert.equal(selected,0);
 pane.dispatchEvent(event('pointerdown',{target:background}));
 pane.dispatchEvent(event('click',{target:background,detail:1}));assert.equal(selected,1);
});

test('protected gestures do not block keyboard selection or future background clicks',()=>{
 const pane=new EventTarget(),control={closest:()=>({})},background={closest:()=>null};let selected=0;
 const unbind=bindRecipientActivation(pane,()=>selected++,{protectControls:true});
 pane.dispatchEvent(event('mousedown',{target:control}));
 pane.dispatchEvent(event('click',{target:background,detail:0}));assert.equal(selected,1);
 pane.dispatchEvent(event('pointercancel'));pane.dispatchEvent(event('click',{target:background,detail:1}));assert.equal(selected,2);
 unbind();pane.dispatchEvent(event('click',{target:background,detail:1}));assert.equal(selected,2);
});

test('retargeted compatibility mousedown cannot erase the protected pointer origin',()=>{
 const pane=new EventTarget(),control={closest:()=>({})},background={closest:()=>null};let selected=0;
 bindRecipientActivation(pane,()=>selected++,{protectControls:true});
 pane.dispatchEvent(event('pointerdown',{target:control}));pane.dispatchEvent(event('mousedown',{target:background}));pane.dispatchEvent(event('click',{target:background,detail:1}));assert.equal(selected,0);
 pane.dispatchEvent(event('pointerdown',{target:background}));pane.dispatchEvent(event('mousedown',{target:background}));pane.dispatchEvent(event('click',{target:background,detail:1}));assert.equal(selected,1);
});
