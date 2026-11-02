import test from 'node:test';import assert from 'node:assert/strict';
import {publicResponseMetrics} from '../src/observer-response-metrics.mjs';
import {buildComparisonPacket,comparisonPacketView,comparisonPrompt} from '../src/observer-report.mjs';
const final=flags=>({author:'Muse',phase:'finalAnswer',text:'one two',...flags});
const evidence=state=>comparisonPacketView(buildComparisonPacket(state)).payload.evidence;
for(const flags of [{truncated:true,cut_off:false},{truncated:false,cut_off:true},{truncated:true,cut_off:true}])test(`known clipped text cannot certify totals, even with matching saved counters: ${JSON.stringify(flags)}`,()=>{
 const r=publicResponseMetrics({messages:[{id:'reply',...final(flags)}],complete:true,reported:{final_messages:1,final_words:2},includedMessageIds:['reply']});
 assert.equal(r.text.complete,false);assert.equal(r.text.clipped_messages,1);assert.equal(r.text.unknown_completeness_messages,0);
 assert.equal(r.final.source,'captured_subset');assert.equal(r.final.total_words,2);assert.equal(r.final.mean_words_per_message,null);assert.equal(r.counter_agreement.final,'not_comparable');
 assert.deepEqual(r.per_message,[{message_id:'reply',phase:'finalAnswer',words:2,text_complete:false}]);
});
test('missing, partial and nonboolean historical flags do not invent complete text',()=>{
 for(const flags of [{},{truncated:false},{cut_off:false},{truncated:'false',cut_off:false}]){
  const r=publicResponseMetrics({messages:[{id:'reply',...final(flags)}],complete:true,includedMessageIds:['reply']});
  assert.equal(r.text.complete,false);assert.equal(r.text.clipped_messages,0);assert.equal(r.text.unknown_completeness_messages,1);
  assert.equal(r.final.source,'captured_subset');assert.equal(r.final.mean_words_per_message,null);assert.equal(r.per_message[0].text_complete,null);
 }
});
test('saved counters cannot promote unknown-completeness text into a full-reply average',()=>{
 const r=publicResponseMetrics({messages:[{id:'legacy',...final({})}],complete:true,reported:{final_messages:1,final_words:2},includedMessageIds:['legacy']});
 assert.equal(r.text.unknown_completeness_messages,1);assert.equal(r.final.source,'captured_subset');assert.equal(r.final.mean_words_per_message,null);assert.equal(r.per_message[0].text_complete,null);
});
test('explicit complete public text still establishes totals and per-reply means',()=>{
 const r=publicResponseMetrics({messages:[{id:'reply',...final({truncated:false,cut_off:false})}],complete:true,includedMessageIds:['reply']});
 assert.equal(r.text.complete,true);assert.equal(r.text.clipped_messages,0);assert.equal(r.text.unknown_completeness_messages,0);
 assert.equal(r.final.source,'complete_text');assert.equal(r.final.total_words,2);assert.equal(r.final.mean_words_per_message,2);assert.equal(r.per_message[0].text_complete,true);
});
test('id-less packet messages preserve clipping and cannot produce a certified length direction',()=>{
 const rows=evidence({arms:{without:{messages:[final({truncated:false,cut_off:false})]},with:{messages:[final({truncated:true,cut_off:false})],public_output:{final_messages:1,final_words:2}}}}),m=rows.find(e=>e.id==='responses.comparison'),reply=rows.find(e=>e.id==='message.with.1');
 assert.equal(reply.truncated,true);assert.equal(reply.cut_off,false);assert.equal(m.arms.with.text.complete,false);assert.equal(m.arms.with.packet_text.complete,false);
 assert.deepEqual(m.arms.with.per_message,[{message_id:reply.id,phase:'finalAnswer',words:2,text_complete:false}]);
 assert.equal(m.final_comparison.message_counts_equal,null);assert.equal(m.final_comparison.total_words_with_relative_to_muse,'unknown');assert.equal(m.final_comparison.mean_words_per_message_with_relative_to_muse,'unknown');
});
test('legacy packet text retains unknown completeness without changing its literal quote',()=>{
 const rows=evidence({arms:{with:{messages:[final({})]}}}),m=rows.find(e=>e.id==='responses.comparison').arms.with,reply=rows.find(e=>e.id==='message.with.1');
 assert.equal(reply.text,'one two');assert.equal(reply.truncated,null);assert.equal(reply.cut_off,null);assert.equal(m.text.complete,false);assert.equal(m.packet_text.complete,false);assert.equal(m.text.unknown_completeness_messages,1);assert.equal(m.per_message[0].text_complete,null);
});
test('legacy text plus matching saved counters cannot certify a shorter reply than complete native text',()=>{
 const rows=evidence({arms:{without:{messages:[{...final({truncated:false,cut_off:false}),text:'one two three four'}]},with:{messages:[final({})],public_output:{final_messages:1,final_words:2}}}}),m=rows.find(e=>e.id==='responses.comparison');
 assert.equal(m.arms.with.final.source,'captured_subset');assert.equal(m.arms.with.final.mean_words_per_message,null);assert.equal(m.final_comparison.total_words_with_relative_to_muse,'unknown');assert.equal(m.final_comparison.mean_words_per_message_with_relative_to_muse,'unknown');
});
for(const large of [false,true])test(`projection losses cannot hide a clipping flag before metrics (${large?'512-message cap':'filtered empty text'})`,()=>{
 const prefix=large?Array.from({length:512},()=>({...final({truncated:false,cut_off:false}),text:'one'})):[],messages=[...prefix,{...final({truncated:true,cut_off:false}),text:large?'one':' '}];
 const rows=evidence({arms:{without:{messages:[final({truncated:false,cut_off:false})]},with:{messages,public_output:{final_messages:messages.length,final_words:messages.length}}}}),m=rows.find(e=>e.id==='responses.comparison');
 assert.equal(m.arms.with.text.projection_omitted_messages,1);assert.equal(m.arms.with.text.projection_source_messages,messages.length);
 assert.equal(m.arms.with.text.complete,false);assert.equal(m.arms.with.packet_text.complete,false);assert.notEqual(m.arms.with.final.source,'reported_snapshot');assert.equal(m.arms.with.final.mean_words_per_message,null);
 assert.equal(m.final_comparison.total_words_with_relative_to_muse,'unknown');assert.equal(m.final_comparison.mean_words_per_message_with_relative_to_muse,'unknown');
});
test('excluded private phases never expose completeness getters or text',()=>{
 const hidden={author:'Muse',phase:'analysis',get text(){throw Error('private text');},get truncated(){throw Error('private flag');},get cut_off(){throw Error('private flag');}};
 const r=publicResponseMetrics({messages:[hidden,final({truncated:false,cut_off:false})],complete:true});assert.equal(r.text.complete,true);assert.equal(r.final.total_words,2);
 const p=buildComparisonPacket({arms:{with:{messages:[hidden,final({truncated:true,cut_off:false})]}}});assert.ok(!JSON.stringify(comparisonPacketView(p)).includes('private text'));
 assert.match(comparisonPrompt(p),/clipped or unknown-completeness reply/);
});
