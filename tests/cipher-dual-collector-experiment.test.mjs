import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

// Offline experiment: actual installed Cipher core, synthetic key events only.
// This does not mount React, invoke OP or retain/log any capture payload.
const require=createRequire(new URL('../integrations/cipher-textbox/package.json',import.meta.url));
const {KeystrokeManager}=require('@area2-ai/a2-cipher-core');
const near=(actual,expected)=>Number.isFinite(actual)&&Math.abs(actual-expected)<0.00001;

test('independent interim reset preserves the full session and its held key',t=>{
 const original=Object.getOwnPropertyDescriptor(performance,'now');
 let timeMs=1000;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>timeMs});
 t.after(()=>{if(original)Object.defineProperty(performance,'now',original);else delete performance.now;});

 const full=new KeystrokeManager(),interim=new KeystrokeManager();
 const bothDown=key=>{full.processKeydown(key);interim.processKeydown(key);};
 const bothUp=key=>{full.processKeyup(key);interim.processKeyup(key);};
 const beforeSeconds=Date.now()/1000;

 // One completed pair, followed by another key held at the interim boundary.
 bothDown('a');timeMs=1000.1;bothUp('a');timeMs=1000.25;bothDown('b');
 const first=interim.endTypingSession();
 assert.ok(full.getIsTypingSessionActive,'the full session remains active');
 assert.ok(!interim.getIsTypingSessionActive,'the interim session ended');
 assert.ok(first.length===1&&first.pressTimes.length===1&&first.releaseTimes.length===1,
  'the held key was excluded from the interim payload');
 assert.ok(near(first.pressTimes[0],0)&&near(first.releaseTimes[0],100),
  'interim timestamps use microseconds and normalize the first press');
 interim.resetTypingData();

 // The actual held keyup belongs to the still-running full manager only.
 // After reset the interim manager ignores it, rather than inventing a pair.
 timeMs=1000.75;bothUp('b');
 timeMs=1001;bothDown('c');timeMs=1001.2;bothUp('c');
 const second=interim.endTypingSession();
 const complete=full.endTypingSession();
 const afterSeconds=Date.now()/1000;

 assert.ok(complete.length===3&&complete.pressTimes.length===3&&complete.releaseTimes.length===3,
  'the full session contains every genuinely paired event, including the held key');
 assert.ok(second.length===1&&second.pressTimes.length===1&&second.releaseTimes.length===1,
  'the next interim session contains only its own completed pair');
 assert.ok(near(complete.pressTimes[0],0)&&near(complete.pressTimes[1],250)&&near(complete.pressTimes[2],1000),
  'full-session press offsets preserve the original microsecond clock');
 assert.ok(near(complete.releaseTimes[0],100)&&near(complete.releaseTimes[1],750)&&near(complete.releaseTimes[2],1200),
  'full-session release offsets preserve the original microsecond clock');
 assert.ok(near(second.pressTimes[0],0)&&near(second.releaseTimes[0],200),
  'the reset interim session uses its own microsecond clock');
 assert.ok(first.startUnixTime>=beforeSeconds&&first.startUnixTime<=afterSeconds&&
  complete.startUnixTime>=beforeSeconds&&complete.startUnixTime<=afterSeconds&&
  second.startUnixTime>=beforeSeconds&&second.startUnixTime<=afterSeconds,
  'startUnixTime uses Unix seconds, independently of event microseconds');
 assert.ok(new Set([first.sessionID,second.sessionID,complete.sessionID]).size===3,
  'the full and two interim windows have distinct SDK session IDs');
 assert.ok(first.length===1&&first.releaseTimes.length===1,
  'the first finalized interim result remains intact after reset');
});
