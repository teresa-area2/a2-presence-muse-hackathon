import test from 'node:test';import assert from 'node:assert/strict';
import {MuseUserInput,initializeNativeQuestions} from '../src/muse-user-input.mjs';
import {MUSE_MSP_FINGERPRINT} from '../vendor/agent-lab/core/muse-msp.mjs';
const prompt=(over={})=>({sessionId:'session',turnId:'turn',userInputId:'prompt',itemId:'item',toolCallId:'call',toolName:'request_user_input',viewCursor:'cursor',questions:[{id:'q',header:'Notice',question:'Inline notice or dialog?',selection:{mode:'single'},options:[{label:'Inline',description:'Continue editing'},{label:'Dialog'}]}],...over});
function fixture(){const receipts=[],calls=[],client={sessionId:'session',receipt:id=>receipts.push(id),request:async(method,params)=>{calls.push({method,params});return{status:'accepted',commandId:params.commandId,userInputId:params.userInputId};}},q=new MuseUserInput({client,enabled:true});q.bindTurn('turn');return{q,client,receipts,calls};}
const settle=(outcome,over={})=>({sessionId:'session',userInputId:'prompt',outcome,answers:[],clarification:null,...over});

test('explicit question capability preserves the exact qualified handshake and no grants',async()=>{
 const seen=[],client={fingerprint:MUSE_MSP_FINGERPRINT,request:async(method,params)=>{seen.push({method,params});return{schema:{version:1,fingerprint:MUSE_MSP_FINGERPRINT},sandboxAvailability:'available'};},write:frame=>seen.push(frame)};
 const r=await initializeNativeQuestions(client);assert.equal(r.sandboxAvailability,'available');assert.equal(seen[0].method,'initialize');assert.deepEqual(seen[0].params.capabilities,{experimentalApi:true,userInputDialogs:true,requestedCapabilities:[]});assert.deepEqual(seen[1],{method:'initialized'});
 for(const fingerprint of ['wrong',undefined]){let writes=0;await assert.rejects(initializeNativeQuestions({...client,fingerprint,write:()=>writes++}),/unqualified/);assert.equal(writes,0);}
 let aborted=false;await assert.rejects(initializeNativeQuestions({...client,request:async()=>({schema:{version:1,fingerprint:'wrong'}}),abort:()=>{aborted=true}}),/schema_mismatch/);assert.equal(aborted,true);
});
test('question notifications and repeated must-answer requests present once, receipt only',()=>{
 const f=fixture();assert.equal(f.q.present(prompt()),true);assert.equal(f.q.present(structuredClone(prompt()),{requestId:1}),false);assert.equal(f.q.present(prompt(),{requestId:1}),false);
 assert.deepEqual(f.receipts,[1,1]);assert.equal(f.q.snapshot().length,1);assert.equal(f.q.metrics().questions_presented,1);assert.equal(f.q.metrics().pending_questions,1);assert.equal(f.calls.length,0);
 const projected=f.q.snapshot();projected[0].questions[0].options[0].label='changed';assert.equal(f.q.snapshot()[0].questions[0].options[0].label,'Inline');assert.ok(!JSON.stringify(f.q.snapshot()).includes('toolCallId'));
});
test('foreign, stale, malformed, changed and oversized native prompts fail before a receipt',()=>{
 const cases=[{sessionId:'foreign'},{turnId:'old'},{questions:[]},{userInputId:''},{questions:[{...prompt().questions[0],options:[{label:'Same'},{label:'Same'}]}]},{questions:[{...prompt().questions[0],selection:{mode:'unknown'}}]},{questions:[{...prompt().questions[0],header:'x'.repeat(13)}]}];
 for(const over of cases){const f=fixture();assert.throws(()=>f.q.present(prompt(over),{requestId:1}));assert.equal(f.receipts.length,0);assert.equal(f.q.size,0);}
 const f=fixture();f.q.present(prompt());assert.throws(()=>f.q.present(prompt({questions:[{...prompt().questions[0],question:'Changed decision?'}]}),{requestId:2}),/changed/);assert.deepEqual(f.receipts,[]);
});
test('disabled or closed question support never auto-presents or answers',()=>{
 const c={sessionId:'session'},q=new MuseUserInput({client:c});q.bindTurn('turn');assert.throws(()=>q.present(prompt()),/unavailable/);assert.equal(q.size,0);q.close();assert.equal(q.metrics().questions_answered,0);
});
test('answer admission is not settlement, and no second action is auto-dispatched',async()=>{
 const f=fixture();f.q.present(prompt());const r=await f.q.respond({userInputId:'prompt',action:'answer',answers:[{questionId:'q',selectedLabel:'Inline'}]});
 assert.equal(r.status,'accepted');assert.equal(f.calls[0].method,'userInput/answer');assert.match(f.calls[0].params.commandId,/^[a-f0-9-]{36}$/);assert.deepEqual(f.calls[0].params.answers,[{questionId:'q',selectedLabel:'Inline'}]);assert.equal(f.q.snapshot()[0].busy,true);assert.equal(f.q.metrics().questions_answered,0);assert.equal(f.q.size,1);
 await assert.rejects(f.q.respond({userInputId:'prompt',action:'cancel'}),/not_pending/);assert.equal(f.calls.length,1);
 const event=f.q.settle(settle('answered',{answers:[{selectedLabel:'Inline',questionId:'q'}]}));assert.equal(event.outcome,'answered');assert.equal(f.q.size,0);assert.equal(f.q.metrics().questions_answered,1);
 assert.equal(f.q.settle(settle('answered',{answers:[{questionId:'q',selectedLabel:'Inline'}]})),null);assert.equal(f.q.metrics().questions_answered,1);
});
test('clarification and explicit cancellation use independent supported native commands',async()=>{
 for(const action of ['clarify','cancel']){const f=fixture();f.q.present(prompt());const d={userInputId:'prompt',action,...(action==='clarify'?{clarification:'Prefer inline, keep edits.'}:{})};await f.q.respond(d);assert.equal(f.calls[0].method,'userInput/'+action);if(action==='clarify')assert.deepEqual(f.calls[0].params.clarification,{format:'text',content:'Prefer inline, keep edits.'});assert.equal(f.q.metrics().questions_clarified+f.q.metrics().questions_cancelled,0);f.q.settle(settle(action==='clarify'?'clarified':'cancelled',action==='clarify'?{clarification:{format:'text',content:d.clarification}}:{}));assert.equal(f.q.metrics()['questions_'+(action==='clarify'?'clarified':'cancelled')],1);}
});
test('answer validation follows all questions, native options and 500-character bounds',async()=>{
 const invalid=[{action:'answer',answers:[]},{action:'answer',answers:[{questionId:'q',selectedLabel:'Other'}]},{action:'answer',answers:[{questionId:'other',selectedLabel:'Inline'}]},{action:'answer',answers:[{questionId:'q',selectedLabel:'Inline',freeText:'Also'}]},{action:'answer',answers:[{questionId:'q',selectedLabels:['Inline']}]},{action:'clarify',clarification:'x'.repeat(501)},{action:'clarify',clarification:{format:'html',content:'x'}},{action:'cancel',answers:[]},{action:'other'}];
 for(const d of invalid){const f=fixture();f.q.present(prompt());await assert.rejects(f.q.respond({userInputId:'prompt',...d}));assert.equal(f.calls.length,0);assert.equal(f.q.snapshot()[0].busy,false);}
 const f=fixture();const q=prompt().questions[0];f.q.present(prompt({questions:[{...q,id:'many',selection:{mode:'multiple',minSelections:1,maxSelections:2}},{...q,id:'text'}]}));await f.q.respond({userInputId:'prompt',action:'answer',answers:[{questionId:'many',selectedLabels:['Inline','Dialog']},{questionId:'text',freeText:'A distinct preference',note:'My note'}]});assert.equal(f.calls.length,1);assert.equal(f.q.metrics().pending_questions,2);
});
test('failed or mismatched command acknowledgment is not recorded as human settlement or retried',async()=>{
 for(const mode of ['throw','wrong']){const f=fixture();let n=0;f.client.request=async()=>{n++;if(mode==='throw')throw Error('native rejected');return{status:'accepted',commandId:'wrong',userInputId:'prompt'};};f.q.present(prompt());await assert.rejects(f.q.respond({userInputId:'prompt',action:'cancel'}));assert.equal(n,1);assert.equal(f.q.size,1);assert.equal(f.q.metrics().questions_cancelled,0);assert.equal(f.q.snapshot()[0].busy,false);}
});
test('unknown or older settlements cannot close a different current pending prompt',()=>{
 const f=fixture();f.q.present(prompt());f.q.present(prompt({userInputId:'new-prompt'}));f.q.settle(settle('timedOut',{userInputId:'unknown'}));assert.equal(f.q.size,2);f.q.settle(settle('timedOut'));assert.equal(f.q.size,1);assert.equal(f.q.snapshot()[0].userInputId,'new-prompt');assert.equal(f.q.metrics().questions_timed_out,1);f.q.settle(settle('timedOut'));assert.equal(f.q.size,1);
 assert.throws(()=>f.q.settle(settle('cancelled',{sessionId:'foreign',userInputId:'new-prompt'})),/settlement_invalid/);assert.equal(f.q.size,1);
});
test('stop clears pending locally without inventing cancellation, answers or native abort',()=>{
 const f=fixture();f.q.present(prompt());f.q.close();f.q.close();const m=f.q.metrics();assert.equal(m.pending_questions,0);assert.equal(m.questions_closed_locally,1);assert.equal(m.questions_cancelled+m.questions_answered+m.questions_aborted,0);assert.equal(f.calls.length,0);
});
test('settlement replay before a late presentation never reopens the settled prompt',()=>{
 const f=fixture();f.q.settle(settle('timedOut'));assert.equal(f.q.present(prompt(),{requestId:1,allowNew:false}),false);assert.deepEqual(f.receipts,[1]);assert.equal(f.q.size,0);assert.equal(f.q.metrics().questions_presented,0);
});


test('actual engagement notifies once without command, answer, settlement or counter changes',async()=>{
 const f=fixture(),notifications=[];f.client.write=frame=>notifications.push(structuredClone(frame));f.q.present(prompt());const before=f.q.metrics();
 assert.deepEqual(await f.q.respond({userInputId:'prompt',action:'engage'}),{status:'notified',userInputId:'prompt'});await f.q.respond({userInputId:'prompt',action:'engage'});
 assert.deepEqual(notifications,[{method:'userInput/engaged',params:{sessionId:'session',userInputId:'prompt'}}]);assert.equal(f.calls.length,0);assert.deepEqual(f.q.metrics(),before);assert.equal(f.q.size,1);assert.equal(f.q.snapshot()[0].busy,false);
 await f.q.respond({userInputId:'prompt',action:'cancel'});assert.equal(f.calls.length,1);f.q.settle(settle('cancelled'));await assert.rejects(f.q.respond({userInputId:'prompt',action:'engage'}),/not_pending/);assert.equal(notifications.length,1);
 const withheld=new MuseUserInput({client:{sessionId:'session'}});assert.equal(withheld.metrics().enabled,false);assert.equal(f.q.metrics().enabled,true);
});


test('only invoked native RPC failures carry a privacy-safe dispatch-attempt marker',async()=>{
 for(const mode of ['reject','primitive','unknown_ack']){const f=fixture();f.q.present(prompt());let calls=0;f.client.request=async()=>{calls++;if(mode==='reject')throw Error('muse_rpc_rejected');if(mode==='primitive')throw 'SECRET_RAW_NATIVE_DETAIL';return{status:'accepted',commandId:'wrong',userInputId:'prompt'};};await assert.rejects(f.q.respond({userInputId:'prompt',action:'cancel'}),e=>{assert.equal(e.nativeDispatchAttempted,true);assert.ok(!String(e).includes('SECRET'));assert.equal(Object.hasOwn(e,'cause'),false);return true;});assert.equal(calls,1);}
 for(const d of [{userInputId:'stale',action:'cancel'},{userInputId:'prompt',action:'answer',answers:[]},{userInputId:'prompt',action:'clarify',clarification:''}]){const f=fixture();f.q.present(prompt());await assert.rejects(f.q.respond(d),e=>e.nativeDispatchAttempted===undefined);assert.equal(f.calls.length,0);}
 const f=fixture();f.q.present(prompt());f.client.write=()=>{throw Error('transport closed');};await assert.rejects(f.q.respond({userInputId:'prompt',action:'engage'}),e=>e.nativeDispatchAttempted===undefined);assert.equal(f.calls.length,0);
});


test('endTurn retires questions locally yet preserves normal questions in a later turn',async()=>{
 const f=fixture();f.q.present(prompt());f.q.endTurn();assert.equal(f.q.metrics().enabled,true);assert.equal(f.q.metrics().questions_closed_locally,1);assert.equal(f.q.metrics().questions_answered+f.q.metrics().questions_cancelled,0);assert.equal(f.calls.length,0);assert.equal(f.q.size,0);f.q.bindTurn('next-turn');f.q.present(prompt({turnId:'next-turn',userInputId:'next-prompt'}));f.q.settle(settle('interrupted'));assert.equal(f.q.size,1);assert.equal(f.q.snapshot()[0].userInputId,'next-prompt');assert.equal(f.q.metrics().questions_presented,2);await f.q.respond({userInputId:'next-prompt',action:'clarify',clarification:'Keep edits'});assert.equal(f.calls[0].method,'userInput/clarify');
});

test('reviewed 1.4.14 handshake is accepted with the native question capability',async()=>{
 const newer='sha256:c94c3d1f2f51e6424074b9ec43eac3eedcf532d3dcd77351ec1383a87d3049c6',sent=[];
 const client={fingerprint:MUSE_MSP_FINGERPRINT,request:async(method,params)=>{sent.push({method,params});return{schema:{version:1,fingerprint:newer},sandboxAvailability:'available'};},write:value=>sent.push(value),abort:()=>{}};
 const result=await initializeNativeQuestions(client);assert.equal(result.schema.fingerprint,newer);assert.equal(sent[0].params.capabilities.userInputDialogs,true);assert.deepEqual(sent[1],{method:'initialized'});
});

test('both reviewed stable schema handshakes bind exactly with and without questions',async()=>{
 const {initializeMuseProtocol}=await import('../src/muse-protocol.mjs');
 for(const fingerprint of [MUSE_MSP_FINGERPRINT,'sha256:c94c3d1f2f51e6424074b9ec43eac3eedcf532d3dcd77351ec1383a87d3049c6'])for(const userInputDialogs of [false,true]){
  const calls=[],client={fingerprint:MUSE_MSP_FINGERPRINT,request:async(method,params)=>{calls.push({method,params});return{schema:{version:1,fingerprint},sandboxAvailability:'available'};},write:x=>calls.push(x),abort:()=>assert.fail('reviewed schema rejected')};
  await initializeMuseProtocol(client,{userInputDialogs});assert.equal(client.fingerprint,fingerprint);assert.equal(calls[0].params.capabilities.userInputDialogs,userInputDialogs);assert.deepEqual(calls[0].params.capabilities.requestedCapabilities,[]);assert.deepEqual(calls[1],{method:'initialized'});
 }
});
test('unreviewed, missing or wrong-version host schemas abort before initialized',async()=>{
 const {initializeMuseProtocol}=await import('../src/muse-protocol.mjs');
 for(const schema of [{version:1,fingerprint:'sha256:'+'a'.repeat(64)},{version:2,fingerprint:MUSE_MSP_FINGERPRINT},{version:1},null])for(const userInputDialogs of [false,true]){
  let writes=0,abort=0;const client={fingerprint:MUSE_MSP_FINGERPRINT,request:async()=>({schema}),write:()=>writes++,abort:()=>abort++};await assert.rejects(initializeMuseProtocol(client,{userInputDialogs}),/muse_schema_mismatch/);assert.equal(writes,0);assert.equal(abort,1);assert.equal(client.fingerprint,MUSE_MSP_FINGERPRINT);
 }
});
