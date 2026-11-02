import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {minimizeDesktopCipher} from '../src/cipher-capture.mjs';

// Synthetic in-memory experiments only. Never submit reconstructed/overlapping data.
const require=createRequire(new URL('../integrations/cipher-textbox/package.json',import.meta.url));
const {KeystrokeManager}=require('@area2-ai/a2-cipher-core');
function controlledClock(t){
 const original=Object.getOwnPropertyDescriptor(performance,'now'),wall=Date.now;let mono=1000,unix=1793268000000;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>mono});Date.now=()=>unix;
 t.after(()=>{if(original)Object.defineProperty(performance,'now',original);else delete performance.now;Date.now=wall;});
 return{at(value){mono=value;},jumpWall(ms){unix+=ms;},time(){return mono;}};
}
function stitch(clips,origins){
 const first=clips[0],out={...first,sessionID:randomUUID(),keyAreas:[],keyTypes:[],pressTimes:[],releaseTimes:[],length:0};
 for(let i=0;i<clips.length;i++){
  const offset=(origins[i]-origins[0])*1000;
  for(let j=0;j<clips[i].length;j++){
   out.keyAreas.push(clips[i].keyAreas[j]);out.keyTypes.push(clips[i].keyTypes[j]);out.pressTimes.push(clips[i].pressTimes[j]+offset);out.releaseTimes.push(clips[i].releaseTimes[j]+offset);out.length++;
  }
 }
 return minimizeDesktopCipher(out);
}

test('clip reconstruction matches full capture in a controlled simple sequence',t=>{
 const clock=controlledClock(t),full=new KeystrokeManager(),clip=new KeystrokeManager(),clips=[],origins=[];
 const down=(key,at)=>{clock.at(at);full.processKeydown(key);clip.processKeydown(key);};
 const up=(key,at)=>{clock.at(at);full.processKeyup(key);clip.processKeyup(key);};
 origins.push(1000);down('a',1000);up('a',1010);clock.at(15000);clips.push(clip.endTypingSession());clip.resetTypingData();
 origins.push(31000);down('b',31000);up('b',31010);clock.at(46000);clips.push(clip.endTypingSession());clip.resetTypingData();
 origins.push(61000);down('c',61000);up('c',61010);clock.at(121000);clips.push(clip.endTypingSession());const whole=full.endTypingSession();
 const cumulative=stitch(clips,origins);for(const key of ['pressTimes','releaseTimes','keyAreas','keyTypes'])assert.deepEqual(cumulative[key],whole[key]);
 assert.equal(cumulative.length,3);assert.notEqual(cumulative.sessionID,whole.sessionID);
});

test('overlapping keys reveal lost offsets in independently finalized clips',t=>{
 const clock=controlledClock(t),full=new KeystrokeManager(),clip=new KeystrokeManager(),clips=[],origins=[1000,31000];
 const down=(key,at)=>{clock.at(at);full.processKeydown(key);clip.processKeydown(key);};
 const up=(key,at)=>{clock.at(at);full.processKeyup(key);clip.processKeyup(key);};
 down('a',1000);up('a',1010);clock.at(15000);clips.push(clip.endTypingSession());clip.resetTypingData();
 down('b',31000);down('c',31005);up('c',31010);up('b',31015);clock.at(46000);clips.push(clip.endTypingSession());const whole=full.endTypingSession();
 const cumulative=stitch(clips,origins);assert.equal(cumulative.length,whole.length);assert.notDeepEqual(cumulative.pressTimes,whole.pressTimes);
 assert.equal(cumulative.pressTimes[1],30000000);assert.equal(whole.pressTimes[1],30005000);
});

test('wall clock changes cannot safely align independently timed clips',t=>{
 const clock=controlledClock(t),clip=new KeystrokeManager(),origins=[1000,31000],clips=[];
 clock.at(1000);clip.processKeydown('a');clock.at(1010);clip.processKeyup('a');clips.push(clip.endTypingSession());clip.resetTypingData();
 clock.jumpWall(30000);assert.equal(Date.now()/1000-clips[0].startUnixTime,30);clock.jumpWall(-60000);clock.at(31000);clip.processKeydown('b');clock.at(31010);clip.processKeyup('b');clips.push(clip.endTypingSession());
 const monoOffset=(origins[1]-origins[0])*1000,wallOffset=(clips[1].startUnixTime-clips[0].startUnixTime)*1000000;
 assert.ok(monoOffset>0);assert.ok(wallOffset<0);assert.notEqual(monoOffset,wallOffset);
});

test('independent parallel collectors produce cumulative SDK snapshots and preserve held keys',t=>{
 const clock=controlledClock(t),managers=[new KeystrokeManager(),new KeystrokeManager(),new KeystrokeManager()],active=new Set(managers),snapshots=[];
 const down=(key,at)=>{clock.at(at);for(const manager of active)manager.processKeydown(key);};const up=(key,at)=>{clock.at(at);for(const manager of active)manager.processKeyup(key);};
 down('a',1000);up('a',1010);down('b',14000);up('b',16000);clock.at(16001);snapshots.push(managers[0].endTypingSession());active.delete(managers[0]);
 down('c',44000);up('c',44010);clock.at(46000);snapshots.push(managers[1].endTypingSession());active.delete(managers[1]);
 down('d',119000);up('d',119010);clock.at(121000);snapshots.push(managers[2].endTypingSession());
 assert.deepEqual(snapshots.map(x=>x.length),[2,3,4]);assert.equal(new Set(snapshots.map(x=>x.sessionID)).size,3);
 for(let i=0;i<2;i++){for(const key of ['pressTimes','releaseTimes','keyAreas','keyTypes'])assert.deepEqual(snapshots[i][key],snapshots[2][key].slice(0,snapshots[i].length));}
 for(const value of snapshots)assert.equal(minimizeDesktopCipher(value).length,value.length);
});

test('parallel collectors can differ slightly when time advances between handler calls',t=>{
 const original=Object.getOwnPropertyDescriptor(performance,'now');let eventTime=1000,calls=0;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>eventTime+(calls++)*0.0001});
 t.after(()=>{if(original)Object.defineProperty(performance,'now',original);else delete performance.now;});
 const first=new KeystrokeManager(),second=new KeystrokeManager(),both=[first,second];
 for(const manager of both)manager.processKeydown('a');eventTime=1010;for(const manager of both)manager.processKeyup('a');
 eventTime=2000;for(const manager of both)manager.processKeydown('b');eventTime=2010;for(const manager of both)manager.processKeyup('b');
 const a=first.endTypingSession(),b=second.endTypingSession();assert.notDeepEqual(a.pressTimes,b.pressTimes);assert.equal(a.length,b.length);
});

test('cumulative observations retain the existing 2000-pair payload ceiling',t=>{
 const clock=controlledClock(t),limit=new KeystrokeManager(),longer=new KeystrokeManager();
 for(let i=0;i<2000;i++){clock.at(1000+i*2);limit.processKeydown('a');longer.processKeydown('a');clock.at(1001+i*2);limit.processKeyup('a');longer.processKeyup('a');}
 const valid=limit.endTypingSession();clock.at(5001);longer.processKeydown('b');clock.at(5002);longer.processKeyup('b');const oversized=longer.endTypingSession();
 assert.equal(minimizeDesktopCipher(valid).length,2000);assert.throws(()=>minimizeDesktopCipher(oversized),/cipher_capture_invalid/);
});
