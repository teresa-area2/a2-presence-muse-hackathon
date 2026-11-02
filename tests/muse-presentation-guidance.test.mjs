import test from 'node:test';
import assert from 'node:assert/strict';
import {compileMusePresentation, MUSE_PRESENTATION_VERSION, MUSE_PRESENTATION_MAX_BYTES} from '../scripts/muse-presentation-guidance.mjs';
const controls=(response_extent='standard',unsolicited_update='send',conversation_style='conversational')=>({response_extent,unsolicited_update,conversation_style});
test('all policy combinations yield distinct, bounded and deterministic presentation hints',()=>{
 assert.equal(MUSE_PRESENTATION_VERSION,2);assert.equal(MUSE_PRESENTATION_MAX_BYTES,384);const texts=new Set();
 for(const depth of ['terse','standard','full'])for(const updates of ['send','defer'])for(const style of ['conversational','self_contained']){
  const c=controls(depth,updates,style),a=compileMusePresentation(c);assert.equal(a.version,2);assert.ok(a.text.startsWith('Muse collaboration v2:\n'));
  assert.equal(a.utf8_bytes,Buffer.byteLength(a.text));assert.ok(a.utf8_bytes+1<=384);assert.deepEqual(a,compileMusePresentation(c));texts.add(a.text);
  assert.match(a.text,/Presentation only/);assert.match(a.text,/User format and required substance\/checks win/);assert.match(a.text,/fit content, no fixed layout/);
  assert.doesNotMatch(a.text,/question NOW|Result\/Checks\/Risks|must use|always use|one question per/);assert.ok(!a.text.includes('<'));assert.match(a.text,/don't duplicate it or invent claims\/questions/);
 }
 assert.equal(texts.size,12);
});
test('depth shifts presentation priorities while content determines the layout',()=>{
 const terse=compileMusePresentation(controls('terse')).text,normal=compileMusePresentation(controls()).text,full=compileMusePresentation(controls('full')).text;
 assert.match(terse,/Spotlight the decision.*tiny callout or text flow may replace/);assert.match(normal,/Balance context.*compact comparison or callout may clarify a real choice/);assert.match(full,/Connect steps and trade-offs.*small text diagram or table may clarify/);
 for(const text of [terse,normal,full]){assert.doesNotMatch(text.split('\n')[1],/bullets|headings|summary|labels|template|sections/i);assert.match(text,/no fixed layout/);}
});
test('style and update hints preserve genuine clarification and required interaction',()=>{
 assert.match(compileMusePresentation(controls('full','defer','self_contained')).text,/clarify when needed/);
 assert.match(compileMusePresentation(controls('full','defer')).text,/never required interaction/);
 assert.match(compileMusePresentation(controls()).text,/Invite input on real choices/);
 assert.match(compileMusePresentation(controls()).text,/useful milestones/);
});
test('controls change only their corresponding hint; quality and user-format precedence always survive',()=>{
 const base=compileMusePresentation(controls()).text.split('\n');
 for(const [c,line]of [[controls('terse'),1],[controls('standard','defer'),2],[controls('standard','send','self_contained'),3]]){
  const next=compileMusePresentation(c).text.split('\n');assert.equal(next.length,base.length);assert.notEqual(next[line],base[line]);
  for(let i=0;i<base.length;i++)if(i!==line)assert.equal(next[i],base[i]);
 }
});
test('invalid, extra, inherited and accessor controls fail closed without reading arbitrary values',()=>{
 const getter={...controls()};let calls=0;Object.defineProperty(getter,'response_extent',{get(){calls++;throw Error('unexpected getter');}});
 for(const bad of [null,undefined,[],1,'terse',{}, {...controls(),response_extent:'verbose'},{...controls(),conversation_style:'chatty'},{...controls(),unsolicited_update:'always'},{...controls(),extra:'PRIVATE'},Object.create(controls()),getter,new Proxy({},{getPrototypeOf(){throw Error('unsafe proxy');}})])assert.equal(compileMusePresentation(bad),null);
 assert.equal(calls,0);assert.ok(compileMusePresentation(Object.assign(Object.create(null),controls())));
});


test('visual choices replace prose conditionally without changing task content or prescribing a layout',()=>{
 for(const depth of ['terse','standard','full']){
  const text=compileMusePresentation(controls(depth)).text;
  assert.match(text,/may/);assert.match(text,/Replace prose; don't duplicate it/);
  assert.match(text,/User format and required substance\/checks win/);
  assert.doesNotMatch(text,/always|must (draw|use)|Mermaid|minimum|add (a|one) diagram|Result\/Checks\/Risks/i);
 }
});
