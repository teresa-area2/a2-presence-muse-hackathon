import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileMusePresentation as compileV2} from '../scripts/muse-presentation-guidance.mjs';
import {compileMusePresentation,MUSE_PRESENTATION_VERSION,MUSE_PRESENTATION_MAX_BYTES} from '../scripts/muse-presentation-guidance-v3.mjs';
const controls=(response_extent='standard',unsolicited_update='send',conversation_style='conversational')=>({response_extent,unsolicited_update,conversation_style});
test('v3 conditions a useful visual on Full, with ordinary prose when it does not clarify',()=>{
 const full=compileMusePresentation(controls('full')).text;
 assert.match(full,/For flows or comparisons, prefer a small text diagram\/table over prose when clearer; otherwise prose\./);
 for(const extent of ['terse','standard'])assert.doesNotMatch(compileMusePresentation(controls(extent)).text,/prefer a small text diagram\/table/);
 assert.match(full,/Presentation only; no fixed layout/);
 assert.match(full,/Replace prose, don't duplicate or invent claims\/questions/);
 assert.match(full,/User format and required content\/checks win/);
 assert.doesNotMatch(full,/always|must (draw|use)|Mermaid|tired|capacity|readiness|stability|user state/i);
});
test('all twelve v3 combinations are deterministic, distinct and within the UTF-8 budget including separator',()=>{
 assert.equal(MUSE_PRESENTATION_VERSION,3);assert.equal(MUSE_PRESENTATION_MAX_BYTES,384);const texts=new Set();
 for(const depth of ['terse','standard','full'])for(const updates of ['send','defer'])for(const style of ['self_contained','conversational']){
  const c=controls(depth,updates,style),a=compileMusePresentation(c);assert.equal(a.version,3);assert.ok(a.text.startsWith('Muse collaboration v3:\n'));
  assert.equal(a.utf8_bytes,Buffer.byteLength(a.text));assert.ok(a.utf8_bytes+1<=384);assert.deepEqual(a,compileMusePresentation(c));texts.add(a.text);
  assert.match(a.text,/User format and required content\/checks win/);
 }
 assert.equal(texts.size,12);
});
test('each control changes only its own line; necessary decisions are never deferred',()=>{
 const base=compileMusePresentation(controls()).text.split('\n');
 for(const [c,line] of [[controls('full'),1],[controls('standard','defer'),2],[controls('standard','send','self_contained'),3]]){
  const next=compileMusePresentation(c).text.split('\n');assert.notEqual(next[line],base[line]);
  for(let i=0;i<base.length;i++)if(i!==line)assert.equal(next[i],base[i]);
 }
 assert.match(compileMusePresentation(controls('full','defer')).text,/never required interaction/);
});
test('only the three validated own data controls are read; invalid controls withdraw hints',()=>{
 let called=0;const getter={...controls()};Object.defineProperty(getter,'response_extent',{get(){called++;throw Error('must not run');}});
 for(const bad of [null,undefined,[],1,'full',{},Object.create(controls()),{...controls(),response_extent:'diagram'},{...controls(),extra:true},getter,new Proxy({},{getPrototypeOf(){throw Error('unsafe');}})])assert.equal(compileMusePresentation(bad),null);
 assert.equal(called,0);assert.ok(compileMusePresentation(Object.assign(Object.create(null),controls())));
});
test('all historical v2 rendered bytes and versions remain attributable unchanged',()=>{
 const old=[];for(const depth of ['terse','standard','full'])for(const updates of ['send','defer'])for(const style of ['self_contained','conversational'])old.push(compileV2(controls(depth,updates,style)));
 assert.ok(old.every(result=>result.version===2&&result.text.startsWith('Muse collaboration v2:\n')));
 assert.equal(createHash('sha256').update(JSON.stringify(old)).digest('hex'),'e1af47c10e202f0e43a2362b124070f970ce4aea6a7b18e475c8e776efa2fd5b');
});
