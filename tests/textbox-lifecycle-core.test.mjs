import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bindDesktopCipher} from '../web/cipher-batching.mjs';

const require=createRequire(new URL('../integrations/cipher-textbox/package.json',import.meta.url));
const {KeystrokeManager}=require('@area2-ai/a2-cipher-core');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({failDiscard=false,quarantine,canFlush}={}){
 const events=new Map(),manager=new KeystrokeManager(),batches=[],statuses=[];let finalizations=0;
 const element={addEventListener:(key,handler)=>events.set(key,handler),removeEventListener:key=>events.delete(key)};
 const capture={handleProcessKeydown:key=>manager.processKeydown(key),handleProcessKeyup:key=>manager.processKeyup(key),handleEndTypingSession(){finalizations++;if(failDiscard&&finalizations===1)throw Error('synthetic SDK reset failure');const value=manager.endTypingSession();manager.resetTypingData();return value;}};
 const binding=bindDesktopCipher({element,capture,quarantine,canFlush,onStatus:value=>statuses.push(value),onBatch:async value=>batches.push(value.length)});
 const emit=(name,key,extra={})=>events.get(name)({isTrusted:true,key,code:key==='Enter'?'Enter':'Key'+key.toUpperCase(),metaKey:false,ctrlKey:false,...extra});
 const key=letter=>{emit('keydown',letter);emit('keyup',letter);};
 return{binding,events,batches,statuses,emit,key,finalizations:()=>finalizations};
}
test('real Cipher core preserves completed pairs when Enter arrives before a held keyup, then starts a separate next window',async()=>{
 const f=fixture();f.binding.setEnabled(true);f.events.get('focus')();f.key('a');f.key('b');f.emit('keydown','c');
 f.emit('keydown','Enter');f.emit('keyup','Enter');await settle();
 assert.deepEqual(f.batches,[2]);assert.ok(f.statuses.includes('partial_discarded'));
 // Late keyup from the preceding window cannot be mixed into the next window.
 f.emit('keydown','d');f.emit('keyup','c');f.emit('keyup','d');await f.binding.finish();
 assert.deepEqual(f.batches,[2,1]);assert.equal(f.finalizations(),2);f.binding.close();
});
test('an SDK failure while discarding an incomplete window disables capture instead of mixing it with later typing',async()=>{
 const f=fixture({failDiscard:true});f.binding.setEnabled(true);f.key('a');f.emit('keydown','b');
 // A second physical down reveals that the previous release was missed.
 f.emit('keydown','b');f.emit('keyup','b');f.key('c');await f.binding.finish();await settle();
 assert.ok(f.statuses.includes('collector_unavailable'));assert.equal(f.batches.length,0);f.binding.close();
});


test('an old keyup cannot complete a new same-code keydown after Enter',async()=>{const f=fixture();f.binding.setEnabled(true);f.key('a');f.key('b');f.emit('keydown','c');f.emit('keydown','Enter');f.emit('keyup','Enter');await settle();assert.deepEqual(f.batches,[2]);f.emit('keydown','c');f.emit('keyup','c');f.emit('keyup','c');f.key('d');f.key('c');await f.binding.finish();assert.deepEqual(f.batches,[2,2]);f.binding.close();});
test('unreleased keys remain quarantined across a stopped and rebound collector',async()=>{const quarantine=new Set(),old=fixture({quarantine});old.binding.setEnabled(true);old.key('a');old.emit('keydown','c');old.binding.setEnabled(false);old.binding.close();const fresh=fixture({quarantine});fresh.binding.setEnabled(true);fresh.emit('keydown','c');fresh.emit('keyup','c');fresh.emit('keyup','c');fresh.key('d');fresh.key('c');await fresh.binding.finish();assert.deepEqual(fresh.batches,[2]);fresh.binding.close();});
test('an ambiguous pair is dropped while no late release arrives, and later presses recover',async()=>{const f=fixture();f.binding.setEnabled(true);f.key('a');f.emit('keydown','c');f.emit('keydown','Enter');f.emit('keyup','Enter');await settle();f.key('c');f.key('c');await f.binding.finish();assert.deepEqual(f.batches,[1,1]);f.binding.close();});

test('the SDK never pairs two physical keys that share one key value',async()=>{
 const events=new Map(),manager=new KeystrokeManager();let keyupCalls=0,observed=null;
 const element={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const binding=bindDesktopCipher({element,capture:{handleProcessKeydown:key=>manager.processKeydown(key),handleProcessKeyup:key=>{keyupCalls++;manager.processKeyup(key);},handleEndTypingSession(){const v=manager.endTypingSession();manager.resetTypingData();return v;}},onBatch:async value=>observed=value.length});
 const emit=(kind,code)=>events.get(kind)({isTrusted:true,key:'Shift',code,metaKey:false,ctrlKey:false});
 binding.setEnabled(true);emit('keydown','ShiftLeft');emit('keydown','ShiftRight');emit('keyup','ShiftRight');assert.equal(keyupCalls,0,'release from ignored physical key must not complete another key');emit('keyup','ShiftLeft');assert.equal(keyupCalls,1);await binding.finish();assert.equal(observed,1);binding.close();
});

test('plain Enter still ends a later window when a previous Shift+Enter release was lost',async()=>{const f=fixture();f.binding.setEnabled(true);f.key('a');f.emit('keydown','Enter',{shiftKey:true});f.events.get('blur')();await settle();assert.deepEqual(f.batches,[1]);f.key('b');f.emit('keydown','Enter');assert.deepEqual(f.batches,[1,1],'plain Enter is a boundary before keyup or blur');f.emit('keyup','Enter');f.events.get('blur')();await settle();assert.deepEqual(f.batches,[1,1]);f.binding.close();});

test('boundary metadata measures local eligibility only, with closed reasons and no per-key data',async()=>{
 const events=new Map(),seen=[];let wall=1700000000000,mono=100;
 const element={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const binding=bindDesktopCipher({element,nowWall:()=>wall,nowMonotonic:()=>mono,canFlush:()=>{mono+=3;return true;},onStatus:(kind,meta)=>seen.push({kind,meta}),capture:{handleProcessKeydown(){},handleProcessKeyup(){},handleEndTypingSession(){return{synthetic:true};}},onBatch:async()=>{}});
 binding.setEnabled(true);events.get('focus')();events.get('keydown')({isTrusted:true,key:'a',code:'KeyA'});events.get('keyup')({isTrusted:true,key:'a',code:'KeyA'});wall+=1500;await binding.finish();
 const started=seen.find(x=>x.kind==='window_open').meta,ended=seen.find(x=>x.kind==='window_completed').meta;
 assert.deepEqual(started,{started_at_ms:1700000000000});assert.deepEqual(ended,{end_reason:'send',ended_at_ms:1700000001500,eligibility_elapsed_ms:3});
 assert.equal(Object.keys(ended).some(key=>/key|press|release|text/i.test(key)),false);binding.close();
});
