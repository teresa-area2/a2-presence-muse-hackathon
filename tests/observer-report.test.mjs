import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {buildComparisonPacket,comparisonPacketView,comparisonPrompt,legacyComparisonSchema as comparisonSchema,validateComparisonReport} from '../src/observer-report.mjs';
const NOW=Date.parse('2026-11-01T15:00:00Z'),hash=s=>createHash('sha256').update(s).digest('hex');
const READ='11111111-1111-4111-8111-111111111111',READING='22222222-2222-4222-8222-222222222222';
const brief={response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'},full={response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'};
function state(){
 const s={session_generation:3,status:'ready',comparison:{matched_context:true,reason:null},presence:{source:{eligible:true,controls:full,read_at:new Date(NOW).toISOString()}},textbox:{readings_omitted:0,readings:[{reading_id:READING,received_at:new Date(NOW-1000).toISOString(),generated_at:new Date(NOW-1100).toISOString(),controls:brief,policy_change:'first'}]},arms:{}};
 for(const arm of ['without','with'])s.arms[arm]={status:'ready',messages:[{author:'You',phase:'sent',target:'both',text:'Preserve the caller draft and retry one conflict.'},{author:'Muse',phase:'finalAnswer',text:'I implemented the retry and all tests pass.'}],delivery:{status:arm==='with'?'guidance_observed':'baseline_isolated',turn_ordinal:1,turn_completed:true,public_finals:1,requests_observed:arm==='with'?1:0,request_attribution:arm==='with'?[{ordinal:1,status:'guidance_observed',read_id:READ,reading_id:READING,controls:brief,receipt_age_seconds:1}]:[],hook_linkage:'read_marker_matched',response_linkage:'unverified'}};
 return s;
}
function work(text='export const answer = 42;\n'){
 return Object.fromEntries(['without','with'].map(arm=>{const files=[{path:'src/result.mjs',sha256:hash(text),text}],artifact_sha256=hash(JSON.stringify(files.map(({path,sha256})=>({path,sha256}))));return[arm,{status:'observed',artifact_sha256,files,omitted_files:0,checks:{state:'passed',artifact_sha256,public_tests:{tests:2,pass:2,fail:0},frozen_tests:{tests:3,pass:3,fail:0}}}];}));
}
const make=(s=state(),w=work(),options={})=>buildComparisonPacket(s,{work:w,now:NOW,...options});
const evidence=(p,id)=>comparisonPacketView(p).payload.evidence.find(e=>e.id===id);
function report(p){const items=comparisonPacketView(p).payload.evidence,has=id=>items.some(e=>e.id===id);return{
 paragraph:{text:'Muse and Muse + Presence can be compared through their replies, work and recorded resource use.',evidence_ids:['comparison','presence.history','inputs.without','inputs.with',...['without','with'].flatMap(arm=>{const reply=items.find(e=>e.kind==='message'&&e.arm===arm&&e.author==='Muse');return[has(`file.${arm}.1`)?`file.${arm}.1`:has(`artifact.${arm}`)?`artifact.${arm}`:`work.${arm}`,`telemetry.${arm}`,...(reply?[reply.id]:[])];})]},
 lanes:['without','with'].map(arm=>({arm,stages:[{kind:'what',text:has(`artifact.${arm}`)?'Captured work and checks can be compared.':'Produced work is unavailable in this snapshot.',evidence_ids:[has(`artifact.${arm}`)?`artifact.${arm}`:`work.${arm}`,...(has(`file.${arm}.1`)?[`file.${arm}.1`]:[])]},{kind:'how',text:'Compare the public reply and feedback response with the recorded instructions.',evidence_ids:[items.find(e=>e.kind==='presence_request'&&e.arm===arm)?.id??`presence.delivery.${arm}`,items.find(e=>e.kind==='message'&&e.arm===arm&&e.author==='Muse')?.id??`inputs.${arm}`]},{kind:'when',text:'Compare the observed turn sequence, interruptions, timing and resources.',evidence_ids:[`telemetry.${arm}`,`interactions.${arm}`]}]})),
 presence:{assessment:'unverified',text:'The delivered guidance is recorded; exact reply binding is unavailable.',evidence_ids:['presence.current'],moments:[]}};}

test('shared and diverged instruction histories retain exact public exposure without assuming equality',()=>{
 const s=state(),p=make(s);assert.equal(comparisonPacketView(p).payload.comparison.observed_input_relation,'same_observed_sequence');
 s.comparison={matched_context:false,reason:'individual_messages'};s.arms.with.messages.push({author:'You',phase:'sent',target:'with',text:'Also explain the overlap rule.'});const q=make(s),v=comparisonPacketView(q);
 assert.equal(v.payload.comparison.matched_context,false);assert.equal(v.payload.comparison.reason,'individual_messages');assert.equal(v.payload.comparison.observed_input_relation,'different_observed_sequence');assert.equal(evidence(q,'message.with.3').text,'Also explain the overlap rule.');assert.equal(evidence(q,'message.with.3').target,'with');assert.match(comparisonPrompt(q),/Never attribute an advantage from extra instructions/);
});

test('attempted, unconfirmed, not-sent, steering and question replies retain distinct exposure markers',()=>{
 const s=state();s.arms.with.messages=['attempted','unconfirmed','not_sent','not_started','steered','question_reply','shared','individual'].map((phase,i)=>({author:'You',phase,target:i%2?'with':'both',text:'Input '+phase}));const p=make(s);
 assert.deepEqual(comparisonPacketView(p).payload.evidence.filter(e=>e.kind==='message'&&e.arm==='with').map(e=>e.delivery),['attempted','unconfirmed','not_sent','not_sent','accepted_steering','question_reply','submitted','submitted']);assert.equal(comparisonPacketView(p).payload.comparison.observed_input_relation,'unverified');assert.match(evidence(p,'inputs.with').delivery,/provider receipt.*unverified/);
});

test('request-time controls and current selected controls remain separate; unknown metrics are null',()=>{
 const p=make();assert.deepEqual(evidence(p,'presence.current').controls,full);assert.deepEqual(evidence(p,'presence.request.with.1').controls,brief);assert.equal(evidence(p,'presence.request.with.1').response_linkage,'unverified');assert.deepEqual(evidence(p,'presence.request.with.1').public_final_ordinals,[]);
 assert.equal(evidence(p,'telemetry.with').usage.input_tokens,null);assert.equal(evidence(p,'telemetry.with').usage.model_calls,null);assert.equal(evidence(p,'telemetry.with').elapsed.total_seconds,null);assert.match(comparisonPrompt(p),/unknown means zero/);
});

test('only public exchange fields and allowed public work enter the packet',()=>{
 const s=state(),w=work();s.private_stream='PRIVATE_NATIVE_SENTINEL';s.capsule='CAPSULE_SENTINEL';s.arms.with.native_log='NATIVE_LOG_SENTINEL';s.presence.source.capsule='CAPSULE_BODY_SENTINEL';s.textbox.typing='TYPING_SENTINEL';s.arms.with.messages[0].private='MESSAGE_PRIVATE_SENTINEL';s.arms.with.messages.push({author:'Muse',phase:'analysis',text:'PRIVATE_ANALYSIS_SENTINEL'});
 for(const path of ['AGENTS.md','CLAUDE.md','MUSE.md','.env.example','src/.secret/config.json','private/notes.md'])w.with.files.push({path,sha256:hash('PRIVATE_FILE_SENTINEL'),text:'PRIVATE_FILE_SENTINEL'});
 const p=make(s,w),v=comparisonPacketView(p),json=JSON.stringify(v);for(const marker of ['PRIVATE_NATIVE','CAPSULE_','NATIVE_LOG','TYPING_','MESSAGE_PRIVATE','PRIVATE_ANALYSIS','PRIVATE_FILE'])assert.ok(!json.includes(marker));assert.equal(v.coverage.messages.with.omitted,1);assert.equal(v.coverage.files.with.omitted,6);assert.equal(v.coverage.status,'partial');
 assert.ok(!JSON.stringify(v.inventory).includes('Preserve the caller'));assert.ok(!JSON.stringify(v.inventory).includes('export const answer'));
});

test('included file bytes verify their supplied hashes; duplicates and false hashes are explicit omissions',()=>{
 const w=work();w.with.files.push({...w.with.files[0]},{path:'src/other.mjs',sha256:'f'.repeat(64),text:'not that hash'});w.with.omitted_files=2;const p=make(state(),w),v=comparisonPacketView(p);
 assert.equal(evidence(p,'file.with.1').sha256,hash('export const answer = 42;\n'));assert.equal(evidence(p,'file.with.1').artifact_id,'artifact.with');assert.equal(v.coverage.files.with.included,1);assert.equal(v.coverage.files.with.omitted,2);assert.equal(v.coverage.files.with.source_omitted,2);
});

test('an actual on-disk public source can be hash-bound and cited as work',async()=>{
 const text=await readFile(new URL('../src/observer-work-context.mjs',import.meta.url),'utf8'),w=work(text),p=make(state(),w),r=report(p);
 assert.equal(evidence(p,'file.with.1').text,text);assert.equal(evidence(p,'file.with.1').sha256,hash(text));assert.ok(validateComparisonReport(r,p).lanes[1].stages[0].evidence_ids.includes('file.with.1'));
});

test('hash-matched CI summaries remain distinct from stale or contradictory checks and assistant claims',()=>{
 const w=work();w.with.checks.raw_output='TEST_OUTPUT_SENTINEL';w.with.checks.cases=[{name:'PRIVATE_CASE_SENTINEL'}];let p=make(state(),w);assert.equal(evidence(p,'checks.with').status,'hash_linked_summary');assert.ok(!JSON.stringify(comparisonPacketView(p)).includes('TEST_OUTPUT_SENTINEL'));assert.ok(!JSON.stringify(comparisonPacketView(p)).includes('PRIVATE_CASE_SENTINEL'));assert.match(evidence(p,'message.with.2').text,/all tests pass/);
 w.with.checks.artifact_sha256='f'.repeat(64);p=make(state(),w);assert.equal(evidence(p,'checks.with').status,'artifact_mismatch');
 w.with.checks.public_tests.fail=1;p=make(state(),w);assert.deepEqual(evidence(p,'checks.with').summary,null);assert.equal(evidence(p,'checks.with').status,'unavailable');
});

test('packet preview is an editable copy; forged handles and changed input never gain prompt authority',()=>{
 const s=state(),w=work(),p=make(s,w),original=comparisonPrompt(p),v=comparisonPacketView(p);v.payload.evidence.find(e=>e.id==='message.with.1').text='EDITED_PREVIEW';v.inventory.push({id:'forged'});s.arms.with.messages[0].text='EDITED_SOURCE';w.with.files[0].text='EDITED_WORK';assert.equal(comparisonPrompt(p),original);
 assert.ok(!comparisonPrompt(p).includes('EDITED_'));for(const forged of [structuredClone(p),{},v.payload])for(const call of [comparisonPacketView,comparisonPrompt,comparisonSchema])assert.throws(()=>call(forged),/comparison_packet_untrusted/);
 const schema=comparisonSchema(p);schema.properties.paragraph.properties.evidence_ids.items.enum.push('invented');const r=report(p);r.paragraph.evidence_ids=['invented'];assert.throws(()=>validateComparisonReport(r,p),/comparison_report_invalid/);
});

test('UTF8 limits omit whole messages and files with explicit coverage, never clipped text',()=>{
 const s=state(),giant='🙂'.repeat(15000);s.arms.with.messages.push({author:'You',phase:'sent',target:'with',text:giant});const w=work('/* '+'é'.repeat(15000)+' */');const metadataState=structuredClone(s);for(const arm of ['without','with'])metadataState.arms[arm].messages=[];const budget=comparisonPacketView(make(metadataState,w)).bytes+1500,p=make(s,w,{maxBytes:budget}),v=comparisonPacketView(p);
 assert.ok(v.bytes<=budget);assert.equal(v.bytes,Buffer.byteLength(JSON.stringify(v.payload),'utf8'));assert.equal(v.fingerprint,hash(JSON.stringify(v.payload)));assert.equal(v.coverage.status,'partial');assert.ok(v.coverage.messages.with.omitted>=1);assert.equal(v.coverage.files.with.included,0);assert.equal(v.coverage.files.with.omitted,1);assert.ok(!v.payload.evidence.some(e=>e.kind==='message'&&e.text.includes('🙂')));
 for(const e of v.payload.evidence.filter(e=>e.kind==='message'))assert.ok(s.arms[e.arm].messages.some(m=>m.text===e.text));
});

test('an exact empty-payload byte boundary is honored and too-small or invalid limits fail closed',()=>{
 const s={session_generation:1,arms:{without:{messages:[],delivery:{request_attribution:[]}},with:{messages:[],delivery:{request_attribution:[]}}},textbox:{readings:[],readings_omitted:0}},w={without:{status:'unavailable',files:[],omitted_files:0},with:{status:'unavailable',files:[],omitted_files:0}},first=make(s,w),n=comparisonPacketView(first).bytes;
 assert.equal(comparisonPacketView(make(s,w,{maxBytes:n})).bytes,n);assert.throws(()=>make(s,w,{maxBytes:n-1}),/comparison_packet_too_small/);for(const maxBytes of [0,-1,NaN,1.2])assert.throws(()=>make(s,w,{maxBytes}),/comparison_packet_invalid/);assert.throws(()=>make(s,w,{now:NaN}),/comparison_packet_invalid/);
});

test('valid assessments normalize lanes and copy output without self-certifying any text',()=>{
 const p=make(),r=report(p);r.lanes.reverse();const out=validateComparisonReport(r,p);assert.deepEqual(out.lanes.map(l=>l.arm),['without','with']);assert.deepEqual(out.lanes[0].stages.map(s=>s.kind),['what','how','when']);r.paragraph.text='changed';assert.notEqual(out.paragraph.text,'changed');assert.match(comparisonPrompt(p),/Every generated sentence is your assessment/);assert.equal(JSON.stringify(comparisonSchema(p)).includes('uniqueItems'),false);
});

test('work must cite its own captured artifact rather than a reply or the other lane',()=>{
 const p=make();for(const refs of [['message.with.2'],['artifact.without'],['file.with.1']]){const r=report(p);r.lanes[1].stages[0].evidence_ids=refs;assert.throws(()=>validateComparisonReport(r,p),/comparison_report_work_reference_required/);}
});

test('missing work produces a valid exchange-only assessment that cites the explicit work status',()=>{
 const p=make(state(),{without:{status:'unavailable',files:[],omitted_files:0},with:{status:'unavailable',files:[],omitted_files:0}}),r=report(p),out=validateComparisonReport(r,p);assert.match(out.lanes[1].stages[0].text,/unavailable/);assert.deepEqual(out.lanes[1].stages[0].evidence_ids,['work.with']);assert.equal(evidence(p,'work.with').artifact_sha256,null);assert.equal(comparisonPacketView(p).coverage.files.with.source_count,null);assert.equal(comparisonPacketView(p).coverage.files.with.source_omitted,null);assert.equal(comparisonPacketView(p).coverage.status,'partial');assert.match(comparisonPrompt(p),/Compare available exchanges usefully even when work is unavailable/);
});

test('unknown, duplicate, absent, wrong-lane and non-Presence citations are rejected',()=>{
 const p=make();for(const refs of [['unknown'],['comparison','comparison'],[]]){const r=report(p);r.paragraph.evidence_ids=refs;assert.throws(()=>validateComparisonReport(r,p),/comparison_report_invalid/);}
 let r=report(p);r.lanes[1].stages[1].evidence_ids=['inputs.without'];assert.throws(()=>validateComparisonReport(r,p),/comparison_report_lane_reference_required/);r=report(p);r.presence.evidence_ids=['comparison'];assert.throws(()=>validateComparisonReport(r,p),/comparison_report_presence_reference_required/);
});

test('malicious output, executable markup, URLs, multiline paragraphs and overlong text are rejected',()=>{
 const p=make();for(const text of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','See https://example.com','javascript:alert(1)','First paragraph.\n\nSecond paragraph.','a'.repeat(1201),'\u0000hidden']){const r=report(p);r.paragraph.text=text;assert.throws(()=>validateComparisonReport(r,p),/comparison_report_invalid/);}
 let r=report(p);r.lanes[0].stages[0].text='a'.repeat(181);assert.throws(()=>validateComparisonReport(r,p),/comparison_report_invalid/);r=report(p);r.presence.text='a'.repeat(201);assert.throws(()=>validateComparisonReport(r,p),/comparison_report_invalid/);
});

test('closed report structure rejects extra fields, wrong stage order and executable getters',()=>{
 const p=make();for(const mutate of [r=>r.url='https://example.com',r=>r.paragraph.observed=true,r=>r.lanes[0].stages.reverse(),r=>r.lanes[1].arm='without',r=>r.lanes[0].stages[2].execute='shell']){const r=report(p);mutate(r);assert.throws(()=>validateComparisonReport(r,p),/comparison_report_invalid/);}
 const r=report(p);let invoked=false;Object.defineProperty(r.paragraph,'text',{enumerable:true,get(){invoked=true;throw Error('ran');}});assert.throws(()=>validateComparisonReport(r,p),/comparison_report_invalid/);assert.equal(invoked,false);
});

test('unavailable input counts and unknown prior-history omissions never become zero',()=>{
 const s=state();delete s.arms.with.messages;s.textbox.readings_omitted=null;delete s.arms.with.delivery.requests_observed;const p=make(s),v=comparisonPacketView(p);
 assert.equal(evidence(p,'inputs.with').human_messages,null);assert.equal(v.coverage.messages.with.source_count,null);assert.equal(v.coverage.readings.source_omitted,null);assert.equal(v.coverage.requests.with.source_omitted,null);assert.equal(v.coverage.status,'partial');
});

test('retained final work is explicitly dated and malformed snapshot metadata stays unknown',()=>{
 const w=work();Object.assign(w.with,{captured_at:'2026-11-01T14:59:00.000Z',retained_final_snapshot:true});let p=make(state(),w);assert.equal(evidence(p,'work.with').captured_at,'2026-11-01T14:59:00.000Z');assert.equal(evidence(p,'work.with').retained_final_snapshot,true);assert.match(comparisonPrompt(p),/retained_final_snapshot is historical captured work/);
 Object.assign(w.with,{captured_at:'not-a-date',retained_final_snapshot:'yes'});p=make(state(),w);assert.equal(evidence(p,'work.with').captured_at,null);assert.equal(Object.hasOwn(evidence(p,'work.with'),'retained_final_snapshot'),false);
});

test('a generic exchange comparison without a structured Presence assessment is rejected',()=>{
 const p=make(),generic=report(p);delete generic.presence.assessment;assert.throws(()=>validateComparisonReport(generic,p),/comparison_report_invalid/);
});

test('a paragraph comparing replies must cite an actual Muse message from each available arm',()=>{
 const p=make();for(const arm of ['without','with']){const r=report(p);r.paragraph.evidence_ids=r.paragraph.evidence_ids.filter(id=>id!==`message.${arm}.2`);assert.throws(()=>validateComparisonReport(r,p),/comparison_report_reply_summary_required/);}
 const s=state();s.arms.with.messages=s.arms.with.messages.filter(m=>m.author==='You');const q=make(s);assert.equal(validateComparisonReport(report(q),q).presence.assessment,'unverified');
});

function recordedChecks(s,{status='stale',current=false,consumed=true,failed=false,includePending=false}={}){
 const n=tests=>({tests,pass:tests,fail:0,skipped:0,cancelled:0,todo:0});
 s.code_checks={enabled:true,closed:false,running:includePending?1:0,arms:Object.fromEntries(['without','with'].map((arm,i)=>{
  const public_tests=n(2),frozen_tests=n(10);if(failed){public_tests.pass=1;public_tests.fail=1;}
  const closed={id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,arm,status,current,consumed,turn_ordinal:1,at:'2026-11-01T14:00:00.000Z',summary:{state:failed?'failed':'passed',exit_code:failed?1:0,artifact_sha256:hash('historical '+arm),trusted_plan_hash:hash('frozen plan'),public_tests,frozen_tests,cases:[{name:'PRIVATE_CASE_SENTINEL'}],raw_output:'PRIVATE_OUTPUT_SENTINEL'}};
  const pending={...closed,id:`00000000-0000-4000-8000-${String(i+3).padStart(12,'0')}`,status:'checking',summary:null};
  return[arm,{latest:includePending?pending:closed,reports:includePending?[closed,pending]:[closed],reports_omitted:0}];
 }))};return s;
}

test('closed historical checks survive unavailable work without becoming current artifact evidence',()=>{
 const s=recordedChecks(state()),missing=Object.fromEntries(['without','with'].map(arm=>[arm,{status:'unavailable',files:[],omitted_files:null,checks:null}])),p=make(s,missing);
 for(const arm of ['without','with']){
  const h=evidence(p,`checks.historical.${arm}`);assert.ok(h);assert.equal(h.kind,'historical_checks');assert.equal(h.status,'historical_summary');assert.equal(h.scope,'latest_closed_record_only');assert.equal(h.current_work_binding,'unverified');assert.equal(h.source_status,'stale');assert.equal(h.source_current,false);assert.equal(h.consumed,true);assert.equal(h.at,'2026-11-01T14:00:00.000Z');assert.deepEqual(h.summary.frozen_tests,{tests:10,pass:10,fail:0});assert.equal(h.summary.artifact_sha256,hash('historical '+arm));
  assert.equal(evidence(p,`work.${arm}`).status,'unavailable');assert.equal(evidence(p,`artifact.${arm}`),undefined);assert.equal(evidence(p,`checks.${arm}`).status,'unavailable');
 }
 const json=JSON.stringify(comparisonPacketView(p));assert.ok(!json.includes('PRIVATE_CASE_SENTINEL'));assert.ok(!json.includes('PRIVATE_OUTPUT_SENTINEL'));
 const r=report(p);r.paragraph.text='Both recorded frozen summaries passed 10/10 cases. Source files are unavailable, so this is historical test evidence rather than fresh code inspection.';r.paragraph.evidence_ids.push('checks.historical.without','checks.historical.with');assert.equal(validateComparisonReport(r,p).presence.assessment,'unverified');
});

test('historical summaries retain failures and ignore pending, malformed or superseded current-work records',()=>{
 let s=recordedChecks(state(),{failed:true,includePending:true}),p=make(s,{}),h=evidence(p,'checks.historical.with');assert.ok(h);assert.equal(h.summary.state,'failed');assert.deepEqual(h.summary.public_tests,{tests:2,pass:1,fail:1});
 for(const status of ['checking','unavailable']){s=recordedChecks(state(),{status});p=make(s,{});assert.equal(evidence(p,'checks.historical.with'),undefined);}
 s=recordedChecks(state());s.code_checks.arms.with.reports[0].summary.frozen_tests.pass=9;p=make(s,{});assert.equal(evidence(p,'checks.historical.with'),undefined);
 s=recordedChecks(state(),{status:'passed',current:true,consumed:false});p=make(s,{});assert.equal(evidence(p,'checks.historical.with').source_current,true);assert.equal(evidence(p,'checks.historical.with').current_work_binding,'unverified');assert.equal(evidence(p,'checks.with').status,'unavailable');
 s=recordedChecks(state());p=make(s);assert.equal(evidence(p,'checks.with').status,'hash_linked_summary');assert.equal(evidence(p,'checks.historical.with'),undefined);
});

test('the closed report compares what, how and when with resource-backed timing references',()=>{
 const p=make(),schema=comparisonSchema(p);assert.deepEqual(schema.properties.lanes.items.properties.stages.items.properties.kind.enum,['what','how','when']);assert.equal(schema.properties.paragraph.properties.evidence_ids.maxItems,16);
 const r=report(p);assert.deepEqual(validateComparisonReport(r,p).lanes[1].stages.map(s=>s.kind),['what','how','when']);
 for(const id of ['telemetry.with','interactions.with']){const invalid=report(p);invalid.lanes[1].stages[2].evidence_ids=invalid.lanes[1].stages[2].evidence_ids.filter(x=>x!==id);assert.throws(()=>validateComparisonReport(invalid,p),/comparison_report_timing_reference_required/);}
 const old=report(p);old.lanes[0].stages[0].kind='guidance';assert.throws(()=>validateComparisonReport(old,p),/comparison_report_invalid/);
});

test('closed interaction evidence separates measured actor receipts from self-reports and unknown values',()=>{
 const s=state();s.measurement={actions:{participant:{arms:{with:{messages:2,characters:30,approval_decisions:1}}},coordinator:{arms:{with:{messages:1,approval_decisions:3}}}},turn_actions:{participant:{with:{steering_accepted:1,interrupt_accepted:1,interrupt_unconfirmed:0}},coordinator:{with:{interrupt_accepted:2}}},question_effort:{participant:{with:{accepted:1,unconfirmed:0,characters:12}}},review:{arms:{with:{review_window_seconds:6,completed_review_segments:1,effort_rating:2,interruption_count:4,private_note:'PRIVATE_REVIEW_SENTINEL'}}},private_text:'PRIVATE_MEASUREMENT_SENTINEL'};
 s.arms.with.interactions={enabled:true,questions_presented:2,questions_answered:1,pending_questions:1,prompt:'PRIVATE_QUESTION_SENTINEL'};s.arms.with.elapsed={completed_turns:3,incomplete_turns:1,includes_approval_wait:true};const p=make(s),v=evidence(p,'interactions.with');
 assert.ok(v);assert.equal(v.actors.participant.messages,2);assert.equal(v.actors.coordinator.approval_decisions,3);assert.equal(v.actors.participant.interrupt_accepted,1);assert.equal(v.actors.coordinator.interrupt_accepted,2);assert.equal(v.actors.unattributed.interrupt_accepted,null);assert.equal(v.actors.participant.question_reply_characters,12);assert.equal(v.native_questions.questions_answered,1);assert.equal(v.completed_turns,3);assert.equal(v.incomplete_turns,1);assert.equal(v.elapsed_includes_approval_wait,true);assert.deepEqual(v.self_report,{effort_rating:2,interruption_count:4,effort_scale:'1_low_5_high'});assert.equal(v.review_window_seconds,6);
 const missing=evidence(make(),'interactions.without');assert.equal(missing.actors.participant.messages,null);assert.equal(missing.actors.participant.interrupt_accepted,null);assert.equal(missing.self_report.interruption_count,null);assert.equal(missing.completed_turns,null);assert.equal(missing.elapsed_includes_approval_wait,null);
 assert.ok(!JSON.stringify(comparisonPacketView(p)).includes('PRIVATE_'));
});

test('viewer presentation evidence stays client-reported, bounded and separate across views',()=>{
 const s=state(),event=(sequence,event,reason,at_ms)=>({sequence,revision:sequence,history_epoch:0,kind:'message',ordinal:1,event,reason,at_ms,controls:brief});
 const presentation={schema_version:1,arms:{without:null,with:{schema_version:1,source:'browser_current_display_policy',arm:'with',session_generation:3,history_epoch:0,revision:2,events_omitted:0,coverage:'observed',events:[event(1,'held','defer',100),event(2,'released','manual',200)]}}};
 const ledger={ledger_id:READ,session_generation:3,revision:2,metrics:{schema_version:1,held_current:0,held_total:1,released_manual:1,released_automatic:0,history_resets:0,coverage:'observed',raw:'PRIVATE_METRICS_SENTINEL'},presentation,raw:'PRIVATE_VIEWER_SENTINEL'};
 s.browser_mechanisms=[ledger,{...ledger,session_generation:4}];let p=make(s),v=comparisonPacketView(p),view=evidence(p,'presentation.view.1');assert.ok(view);assert.equal(view.scope,'client_reported_view_only_not_additive');assert.equal(view.metrics.held_total,1);assert.equal(view.arms.with.retained_event_count,2);assert.deepEqual(view.arms.with.events,{shown:0,held:1,released:1});assert.equal(view.arms.with.first_event_at_ms,100);assert.equal(view.arms.with.last_event_at_ms,200);assert.equal(view.arms.without,null);assert.equal(v.coverage.presentation.included,1);assert.equal(v.coverage.presentation.omitted,1);assert.ok(!JSON.stringify(v).includes('PRIVATE_'));assert.equal(Object.hasOwn(view.arms.with,'message_timestamps'),false);
 s.browser_mechanisms=[ledger,{...ledger,ledger_id:READING}];p=make(s);assert.equal(comparisonPacketView(p).payload.evidence.filter(e=>e.kind==='presentation').length,2);assert.equal(evidence(p,'presentation.view.2').metrics.held_total,1);
});
