import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {attributeMuseResponses} from '../src/muse-response-attribution.mjs';
const sha = text => createHash('sha256').update(text).digest('hex');
const sessionId = '10000000-0000-4000-8000-000000000001', turnId = '10000000-0000-4000-8000-000000000002';
const readA = '10000000-0000-4000-8000-000000000003', readB = '10000000-0000-4000-8000-000000000004';
const controls = {response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'};
function fixture() {
  return {sessionId,turnId,
    requestAttribution:[{ordinal:1,read_id:readA,status:'guidance_observed',reading_id:'reading-1',controls:{...controls}}],
    preHooks:[{read_id:readA,request_id:'request-1',session_id:sessionId,turn_id:turnId,attempt:0,step:1}],
    postHooks:[{request_id:'request-1',response_id:'response-1',session_id:sessionId,turn_id:turnId,attempt:0,step:1,provider_status:'successful'}],
    responses:[{response_id:'response-1',public_text_sha256:sha('Implemented and tested.')}],
    finals:[{public_text_sha256:sha('Implemented and tested.'),truncated:false}],
  };
}

test('exact scoped IDs plus a unique complete public digest establish compact response/final linkage',()=>{
  const input=fixture(),before=structuredClone(input),result=attributeMuseResponses(input);
  assert.deepEqual(result,{status:'linked',linked_responses:1,linked_finals:1,requests:[{ordinal:1,status:'response_linked',presence:'guidance'}],finals:[{ordinal:1,status:'final_linked',request_ordinal:1,presence:'guidance'}]});
  assert.deepEqual(input,before);
  for(const secret of [readA,'request-1','response-1','reading-1',sha('Implemented and tested.')])assert.ok(!JSON.stringify(result).includes(secret));
});

test('ordinary fallback can link a response/final without becoming eligible guidance',()=>{
  const input=fixture();Object.assign(input.requestAttribution[0],{status:'fallback_observed',reading_id:null,controls:null});
  const result=attributeMuseResponses(input);assert.equal(result.status,'linked');assert.equal(result.requests[0].presence,'fallback');assert.equal(result.finals[0].presence,'fallback');
});

test('out-of-order records use identity rather than position; tool-only completions need no public final',()=>{
  const input=fixture();input.responses[0].public_text_sha256=null;
  input.requestAttribution.push({ordinal:2,read_id:readB,status:'fallback_observed',reading_id:null,controls:null});
  input.preHooks.push({read_id:readB,request_id:'request-2',session_id:sessionId,turn_id:turnId,attempt:0,step:2});
  input.postHooks.push({request_id:'request-2',response_id:'response-2',session_id:sessionId,turn_id:turnId,attempt:0,step:2,provider_status:'successful'});
  input.responses.push({response_id:'response-2',public_text_sha256:input.finals[0].public_text_sha256});
  for(const key of ['requestAttribution','preHooks','postHooks','responses'])input[key].reverse();
  const result=attributeMuseResponses(input);assert.equal(result.status,'linked');assert.equal(result.linked_responses,2);assert.deepEqual(result.requests.map(x=>x.ordinal),[2,1]);assert.equal(result.finals[0].request_ordinal,2);assert.equal(result.finals[0].presence,'fallback');
});

test('unsuccessful, conflicting, missing and unknown provider outcomes never qualify',()=>{
  for(const provider_status of ['failed','conflicting','unknown',undefined,'ok',true]){
    const input=fixture();input.postHooks[0].provider_status=provider_status;
    const result=attributeMuseResponses(input);assert.equal(result.status,'unverified');assert.equal(result.linked_responses,0);assert.equal(result.linked_finals,0);
  }
});

test('missing or unscoped evidence cannot establish linkage; baseline does not infer Presence',()=>{
  for(const key of ['requestAttribution','preHooks','postHooks','responses']){
    const input=fixture();input[key]=[];const result=attributeMuseResponses(input);assert.equal(result.status,'unverified');assert.equal(result.linked_finals,0);
  }
  const noFinal=fixture();noFinal.finals=[];assert.equal(attributeMuseResponses(noFinal).status,'partial');
  assert.equal(attributeMuseResponses().status,'unverified');
  for(const key of ['sessionId','turnId']){const input=fixture();input[key]='invalid';assert.equal(attributeMuseResponses(input).status,'unverified');}
});

test('duplicates or conflicting native identity fail closed even if one candidate looks valid',()=>{
  const mutations=[
    x=>x.requestAttribution.push(structuredClone(x.requestAttribution[0])),
    x=>x.preHooks.push(structuredClone(x.preHooks[0])),
    x=>x.postHooks.push(structuredClone(x.postHooks[0])),
    x=>x.responses.push(structuredClone(x.responses[0])),
    x=>x.postHooks.push({...x.postHooks[0],request_id:'another-request'}),
    x=>x.preHooks.push({...x.preHooks[0],read_id:readB}),
    x=>x.responses.push({...x.responses[0],public_text_sha256:sha('Different answer.')}),
  ];
  for(const mutate of mutations){const input=fixture();mutate(input);const result=attributeMuseResponses(input);assert.equal(result.status,'ambiguous');assert.equal(result.linked_finals,0);}
});

test('foreign sessions/turns and attempt or step contradictions do not link',()=>{
  for(const key of ['preHooks','postHooks'])for(const field of ['session_id','turn_id']){
    const input=fixture();input[key][0][field]='20000000-0000-4000-8000-000000000001';assert.equal(attributeMuseResponses(input).status,'unverified');
  }
  for(const field of ['attempt','step'])for(const value of [2,-1,'1',null,Number.MAX_SAFE_INTEGER+1]){
    const input=fixture();input.postHooks[0][field]=value;assert.equal(attributeMuseResponses(input).status,'unverified');
  }
  const absent=fixture();for(const key of ['preHooks','postHooks'])for(const field of ['attempt','step'])delete absent[key][0][field];assert.equal(attributeMuseResponses(absent).status,'linked');
  const oneSided=fixture();delete oneSided.postHooks[0].attempt;assert.equal(attributeMuseResponses(oneSided).status,'linked','unique IDs remain sufficient when optional metadata is absent');
});

test('partial/truncated, missing or mismatched public output cannot qualify a final',()=>{
  for(const mutation of [x=>x.finals[0].truncated=true,x=>delete x.finals[0].truncated,x=>x.finals[0].public_text_sha256=sha('A partial answer'),x=>x.finals[0].public_text_sha256=null,x=>x.responses[0].public_text_sha256=null,x=>{x.finals[0].public_text_sha256=sha('');x.responses[0].public_text_sha256=sha('');}]){
    const input=fixture();mutation(input);const result=attributeMuseResponses(input);assert.equal(result.status,'partial');assert.equal(result.linked_finals,0);assert.equal(result.linked_responses,1);
  }
});

test('identical public answers across completions or final events are ambiguous',()=>{
  for(const mutation of [x=>x.finals.push({...x.finals[0]}),x=>x.responses.push({...x.responses[0],response_id:'another-response'})]){
    const input=fixture();mutation(input);const result=attributeMuseResponses(input);assert.equal(result.status,'ambiguous');assert.equal(result.linked_finals,0);
  }
});

test('valid final linkage can coexist with unrelated unknown intermediate completion, without complete-turn claims',()=>{
  const input=fixture();input.requestAttribution.unshift({ordinal:2,read_id:readB,status:'guidance_observed',reading_id:'reading-2',controls:{...controls}});
  input.preHooks.push({read_id:readB,request_id:'unknown-intermediate',session_id:sessionId,turn_id:turnId});
  const result=attributeMuseResponses(input);assert.equal(result.status,'partial');assert.equal(result.linked_responses,1);assert.equal(result.linked_finals,1);assert.equal(result.finals[0].request_ordinal,1);
});

test('malformed IDs, attribution controls and digests cannot smuggle proof or raw values',()=>{
  const mutations=[x=>x.preHooks[0].request_id='../private',x=>x.postHooks[0].response_id='',x=>x.requestAttribution[0].read_id='not-a-uuid',x=>x.requestAttribution[0].ordinal=0,x=>x.requestAttribution[0].controls.response_extent='invented',x=>x.requestAttribution[0].status='request_observed',x=>x.responses[0].public_text_sha256='raw-private-value'];
  for(const mutate of mutations){const input=fixture();mutate(input);const out=attributeMuseResponses(input);assert.equal(out.linked_finals,0);assert.equal(out.linked_responses,0);assert.ok(!JSON.stringify(out).includes('raw-private-value'));}
});

test('inputs are bounded at 64 rows without mutation or silent slicing',()=>{
  for(const key of ['requestAttribution','preHooks','postHooks','responses','finals']){
    for(const bad of [null,{},'private',Array.from({length:65},()=>({}))]){const input=fixture();input[key]=bad;assert.throws(()=>attributeMuseResponses(input),/response_attribution_invalid/);}
  }
  const input=fixture();Object.freeze(input);for(const rows of [input.requestAttribution,input.preHooks,input.postHooks,input.responses,input.finals]){rows.forEach(Object.freeze);Object.freeze(rows);}assert.equal(attributeMuseResponses(input).status,'linked');
});
