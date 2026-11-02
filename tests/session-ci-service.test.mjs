import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {buildCIFeedback} from '../src/coding-ci-report.mjs';
import {SessionCIService} from '../src/session-ci-service.mjs';

const A='a'.repeat(64),B='b'.repeat(64),PLAN='c'.repeat(64);
const totals=(failed=false)=>({tests:1,pass:failed?0:1,fail:failed?1:0,skipped:0,cancelled:0,todo:0});
function fixture(t,{verify,collect,onChange=()=>{},summary,formatFeedback,monotonicNow,native=false}={}){
 const pair=new EventEmitter(),calls=[],hashes={without:A,with:A},states=Object.fromEntries(['without','with'].map(a=>[a,{status:'ready',active_turn_id:null,approvals:[],questions:[],model:{requested_model:'muse-spark-1.3',status:'observed'},delivery:{turn_ordinal:1},elapsed:{completed_turns:1,incomplete_turns:0},last_turn_terminal:'completed'}]));
 pair.state='ready';pair.arms=Object.fromEntries(['without','with'].map(a=>[a,{client:{sessionId:'PRIVATE_NATIVE_SESSION_'+a},turnId:'PRIVATE_NATIVE_TURN_'+a,workGroup:1,events:[],ready:()=>states[a].status==='ready'&&!states[a].approvals.length&&!states[a].questions.length}]));
 pair.snapshot=()=>({status:pair.state,arms:structuredClone(states)});let submitted=0;pair.submit=()=>{submitted++;throw Error('must_never_dispatch');};
 const plan={ownTests:['test/public.test.mjs'],expectedPlanHash:PLAN,trustedFiles:{'test/frozen.test.mjs':Buffer.from("test('fixed contract',()=>{});")}};
 const result=opts=>({state:'passed',exit_code:0,artifact_sha256:opts.artifactHash,trusted_plan_hash:opts.expectedPlanHash,stdout:'PRIVATE_RAW_STDOUT /private/home TOKEN_secret'});
 const summarize=(r,names)=>({state:r.state,exit_code:r.exit_code,public_tests:totals(),frozen_tests:totals(r.state==='failed'),cases:names.map(name=>({name,result:r.state==='failed'?'failed':'passed'})),artifact_sha256:r.artifact_sha256,trusted_plan_hash:r.trusted_plan_hash,...(summary??{})});
 const service=new SessionCIService({pair,plan,workspaces:{without:'/owned/without',with:'/owned/with'},onChange,...(monotonicNow?{monotonicNow}:{}),...(native?{}:{verify:async opts=>{calls.push(opts);return verify?verify(opts):result(opts);}}),collect:collect??(async workspace=>({files:[{digest:hashes[workspace.endsWith('/with')?'with':'without']}],bytes:new Map()})),hash:files=>files[0].digest,summarize,formatFeedback:formatFeedback??(s=>'Independent CI '+s.state+': '+s.cases.map(c=>c.name+' '+c.result).join(';'))});
 t.after(async()=>{service.close();await service.wait();});
 const start=arm=>{states[arm].status='running';states[arm].active_turn_id='PRIVATE_ACTIVE';pair.arms[arm].workGroup++;pair.arms[arm].turnId+='next';states[arm].delivery.turn_ordinal++;pair.arms[arm].events.push({});pair.emit('status');};
 const end=arm=>{states[arm].status='ready';states[arm].active_turn_id=null;states[arm].elapsed.completed_turns++;pair.emit('status');};
 return{pair,plan,service,states,hashes,calls,result,start,end,submitted:()=>submitted};
}
async function until(fn){for(let i=0;i<50;i++){if(fn())return;await new Promise(r=>setImmediate(r));}assert.fail('fixture did not settle');}

test('checks both ready workspaces independently without model actions',async t=>{
 const f=fixture(t),started=f.service.check('both');assert.equal(started.status,'started');assert.deepEqual(Object.keys(started.checks),['without','with']);assert.equal(f.service.snapshot().running,2);await f.service.wait();
 assert.equal(f.calls.length,2);for(const call of f.calls){assert.equal(call.ownTestDiscovery,'node-default');assert.deepEqual(call.ownTests,['test/public.test.mjs']);assert.equal(call.deadlineMs,20000);assert.equal(call.expectedPlanHash,PLAN);}
 for(const arm of ['without','with'])assert.equal(f.service.snapshot().arms[arm].latest.summary.state,'passed');assert.equal(f.submitted(),0);
});

test('both admission rejects before effects when one arm is working, approval or question',async t=>{
 for(const state of ['running','approval','question']){const f=fixture(t);f.states.with.status=state;assert.throws(()=>f.service.check('both'),/ci_wait_for_ready/);assert.equal(f.calls.length,0);f.service.check('without');await f.service.wait();assert.equal(f.calls.length,1);}
});

test('one job per arm; checking never blocks ordinary native actions',async t=>{
 let finish;const f=fixture(t,{verify:o=>new Promise(r=>{finish=()=>r(f.result(o));})});f.service.check('without');await until(()=>finish);assert.throws(()=>f.service.check('without'),/ci_busy/);f.start('with');f.end('with');assert.equal(f.service.snapshot().arms.without.status,'checking');finish();await f.service.wait();assert.equal(f.service.snapshot().arms.without.status,'passed');
});

test('ready to working to ready ABA invalidates in-flight and completed reports',async t=>{
 let finish;const f=fixture(t,{verify:o=>new Promise(r=>{finish=()=>r(f.result(o));})});const {checks}=f.service.check('with');await until(()=>finish);f.start('with');f.end('with');finish();await f.service.wait();assert.equal(f.service.snapshot().arms.with.status,'stale');await assert.rejects(()=>f.service.feedback('with',checks),/ci_feedback_stale/);
});

test('live artifact mutation during verification leaves the old result stale',async t=>{
 let finish;const f=fixture(t,{verify:o=>new Promise(r=>{finish=()=>r(f.result(o));})});f.service.check('with');await until(()=>finish);f.hashes.with=B;finish();await f.service.wait();const r=f.service.snapshot().arms.with.latest;assert.equal(r.status,'stale');assert.equal(r.summary.state,'passed');assert.equal(r.summary.artifact_sha256,A);
});

test('feedback rehash detects edits that emitted no native status event',async t=>{
 const f=fixture(t),{checks}=f.service.check('without');await f.service.wait();f.hashes.without=B;await assert.rejects(()=>f.service.feedback('without',checks),/ci_feedback_stale/);assert.equal(f.service.snapshot().arms.without.status,'stale');
});

test('feedback commit is synchronous, one-use and contains only the selected own results',async t=>{
 const f=fixture(t),{checks}=f.service.check('without');await f.service.wait();const action=await f.service.feedback('without',checks);assert.equal(action.target,'without');assert.deepEqual(action.expectedTurns,{without:null});assert.deepEqual(Object.keys(action.prompts),['without']);assert.match(action.prompt,/fixed contract/);assert.equal(f.submitted(),0);assert.deepEqual(action.commit().expectedTurns,{without:null});assert.throws(()=>action.commit(),/ci_feedback_stale/);await assert.rejects(()=>f.service.feedback('without',checks),/ci_feedback_stale/);assert.equal(f.submitted(),0);
});

test('parallel feedback leases cannot commit the same report twice after unknown sends',async t=>{
 const f=fixture(t),{checks}=f.service.check('with');await f.service.wait();const first=await f.service.feedback('with',checks),second=await f.service.feedback('with',checks);first.commit();assert.throws(()=>second.commit(),/ci_feedback_stale/);
});

test('both feedback validates every binding before consuming either report',async t=>{
 const f=fixture(t),{checks}=f.service.check('both');await f.service.wait();const action=await f.service.feedback('both',checks);assert.equal(action.prompt,null);assert.deepEqual(Object.keys(action.prompts),['without','with']);f.start('with');assert.throws(()=>action.commit(),/ci_wait_for_ready/);assert.equal(f.service.snapshot().arms.without.latest.consumed,false);
});

test('a delayed feedback claim expires instead of bypassing a fresh filesystem rehash',async t=>{
 const f=fixture(t),{checks}=f.service.check('without');await f.service.wait();const action=await f.service.feedback('without',checks);await new Promise(r=>setImmediate(r));assert.throws(()=>action.commit(),/ci_feedback_stale/);
});

test('question or approval arrival after feedback never becomes a reply or permission',async t=>{
 for(const field of ['questions','approvals']){const f=fixture(t),{checks}=f.service.check('with');await f.service.wait();const action=await f.service.feedback('with',checks);f.states.with[field]=[{}];f.pair.emit('status');assert.throws(()=>action.commit(),/ci_wait_for_ready/);assert.equal(f.submitted(),0);}
});

test('failed known checks are available as feedback, verifier failures are not passes',async t=>{
 const f=fixture(t,{verify:o=>({...f.result(o),state:'failed',exit_code:1})}),{checks}=f.service.check('with');await f.service.wait();assert.equal(f.service.snapshot().arms.with.status,'failed');assert.match((await f.service.feedback('with',checks)).prompt,/failed/);
 const bad=fixture(t,{verify:()=>{throw Error('/private/secret-path');}});bad.service.check('with');await bad.service.wait();assert.equal(bad.service.snapshot().arms.with.status,'unavailable');assert.ok(!JSON.stringify(bad.service.snapshot()).includes('secret-path'));
});

test('snapshots are detached and contain no native IDs, paths, stdout or unexpected helper fields',async t=>{
 const f=fixture(t,{summary:{stdout:'PRIVATE_SECRET',source_path:'/owned/private',native_id:'PRIVATE_NATIVE'}});f.service.check('both');await f.service.wait();const view=f.service.snapshot(),raw=JSON.stringify(view);assert.doesNotMatch(raw,/PRIVATE_|\/owned\//);view.arms.with.latest.summary.cases[0].name='tampered';assert.equal(f.service.snapshot().arms.with.latest.summary.cases[0].name,'fixed contract');
});

test('plan bytes are frozen before asynchronous checking',async t=>{
 const f=fixture(t);f.plan.trustedFiles['test/frozen.test.mjs'].fill(0);f.plan.ownTests.length=0;f.service.check('with');await f.service.wait();assert.match(f.calls[0].trustedFiles['test/frozen.test.mjs'].toString(),/fixed contract/);assert.deepEqual(f.calls[0].ownTests,['test/public.test.mjs']);
});

test('close invalidates immediately, keeps verified history and waits without stopping Muse',async t=>{
 const finish=[];const f=fixture(t,{verify:o=>new Promise(r=>{finish.push(()=>r(f.result(o)));})});f.service.check('both');await until(()=>finish.length===2);
 f.service.close();assert.equal(f.service.snapshot().closed,true);assert.throws(()=>f.service.check('without'),/ci_closed/);assert.equal(f.pair.state,'ready');let settled=false;const waiting=f.service.wait().then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);finish.forEach(resolve=>resolve());await waiting;for(const arm of ['without','with']){const report=f.service.snapshot().arms[arm].latest;assert.equal(report.status,'stale');assert.equal(report.summary.state,'passed');assert.equal(report.feedback_available,false);}assert.equal(f.submitted(),0);
});

test('new checks supersede old feedback and keep bounded history',async t=>{
 const f=fixture(t);let old;for(let n=0;n<10;n++){const x=f.service.check('with');old??=x.checks.with;await f.service.wait();}const view=f.service.snapshot().arms.with;assert.equal(view.reports.length,8);assert.equal(view.reports_omitted,2);assert.equal(view.reports.filter(r=>r.current).length,1);await assert.rejects(()=>f.service.feedback('with',{with:old}),/ci_feedback_stale/);
});

test('malformed helper values cannot leak through the typed summary',async t=>{
 const f=fixture(t,{summary:{state:'failed',exit_code:'PRIVATE_EXIT'}});f.service.check('with');await f.service.wait();assert.equal(f.service.snapshot().arms.with.status,'unavailable');assert.doesNotMatch(JSON.stringify(f.service.snapshot()),/PRIVATE_EXIT/);
});


test('production feedback formatter accepts the detached typed summary',async t=>{
 const f=fixture(t,{formatFeedback:buildCIFeedback}),{checks}=f.service.check('with');await f.service.wait();const feedback=await f.service.feedback('with',checks);assert.equal(typeof feedback.prompt,'string');assert.ok(feedback.prompt.length>0);assert.equal(f.service.snapshot().arms.with.latest.summary.schema_version,1);
});


test('records monotonic CI duration separately from native usage and human time',async t=>{
 let clock=100;const f=fixture(t,{monotonicNow:()=>clock,verify:o=>{clock=137.6;return f.result(o);}});f.service.check('with');await f.service.wait();const report=f.service.snapshot().arms.with.latest;assert.equal(report.elapsed_ms,38);assert.ok(report.elapsed_ms>=0);assert.equal(f.submitted(),0);assert.equal(f.states.with.elapsed.completed_turns,1);
});

test('own report status broadcasts do not invalidate unchanged native bindings',async t=>{
 let f;f=fixture(t,{onChange:()=>f.pair.emit('status')});f.service.check('with');await f.service.wait();assert.equal(f.service.snapshot().arms.with.latest.current,true);assert.equal(f.service.snapshot().arms.with.latest.feedback_available,true);
});


test('unsupported-platform production checks are unavailable without starting a verifier',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform');let f;
 try{Object.defineProperty(process,'platform',{value:'win32'});f=fixture(t,{native:true});}finally{Object.defineProperty(process,'platform',descriptor);}
 assert.equal(f.service.snapshot().capability,'unsupported_platform');
 assert.throws(()=>f.service.check('both'),/ci_platform_unsupported/);
 assert.equal(f.calls.length,0);assert.equal(f.service.snapshot().running,0);assert.equal(f.service.snapshot().arms.with.latest,null);
});

test('native macOS capability is platform-only, not sandbox qualification',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform');let f;
 try{Object.defineProperty(process,'platform',{value:'darwin'});f=fixture(t);}finally{Object.defineProperty(process,'platform',descriptor);}
 assert.equal(f.service.snapshot().capability,'requires_sandbox_check');
 f.service.check('with');await f.service.wait();assert.equal(f.calls.length,1);assert.equal(f.service.snapshot().arms.with.latest.status,'passed');
});


test('Linux capability advertises its sandbox prerequisite before a supplied verifier',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform');let f;
 try{Object.defineProperty(process,'platform',{value:'linux'});f=fixture(t);}finally{Object.defineProperty(process,'platform',descriptor);}
 assert.equal(f.service.snapshot().capability,'requires_linux_sandbox_check');
 f.service.check('with');await f.service.wait();assert.equal(f.calls.length,1);
});
