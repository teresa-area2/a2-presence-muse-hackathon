import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createStructuredServer} from '../structured-server.mjs';
import {SessionCIService} from '../src/session-ci-service.mjs';
import {createEvidenceStore} from '../src/evidence-store.mjs';

const ROOT=path.resolve('.'),ARM_NAMES=['without','with'],HASH={without:'a'.repeat(64),with:'b'.repeat(64)},PLAN='c'.repeat(64),CASE='KNOWN_CI_CASE_NOT_FOR_EXPORT';
const totals=fail=>({tests:1,pass:fail?0:1,fail:fail?1:0,skipped:0,cancelled:0,todo:0});
async function until(check){for(let n=0;n<100;n++){if(await check())return;await new Promise(r=>setTimeout(r,2));}assert.fail('fixture did not reach expected state');}
async function fixture(t,{hold=false,evidence=false,failedArm=null}={}){
 const pending=[],pairs=[],verifications=[],calls=[];let closing=null;
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'session-ci-http-'));const store=evidence?await createEvidenceStore({directory:folder,metadata:{task_id:'CODING-save-conflicts',evidence_mode:'fixture'},debounceMs:0}):null;
 const createPair=async()=>{
  const pair=new EventEmitter();pair.state='ready';pair.stopped=0;pair.hashes={...HASH};pair.values=Object.fromEntries(ARM_NAMES.map(a=>[a,{status:'ready',active_turn_id:null,interrupt_pending:false,last_turn_terminal:'completed',model:{requested_model:'muse-spark-1.3',status:'observed'},delivery:{turn_ordinal:1},elapsed:{completed_turns:1,incomplete_turns:0},messages:[],approvals:[],questions:[],usage:{status:'not_observed'}}]));
  pair.arms=Object.fromEntries(ARM_NAMES.map(a=>[a,{client:{sessionId:'PRIVATE_NATIVE_SESSION_'+a},turnId:'PRIVATE_NATIVE_TURN_'+a,workGroup:1,events:[],ready:()=>pair.values[a].status==='ready'&&!pair.values[a].questions.length&&!pair.values[a].approvals.length}]));
  pair.snapshot=()=>({status:pair.state,comparison:{matched_context:true},arms:structuredClone(pair.values)});
  pair.begin=a=>{pair.values[a].status='running';pair.values[a].active_turn_id='active-'+a;pair.values[a].delivery.turn_ordinal++;pair.arms[a].workGroup++;pair.arms[a].turnId+='next';pair.emit('status');};
  pair.finish=a=>{pair.values[a].status='ready';pair.values[a].active_turn_id=null;pair.values[a].interrupt_pending=false;pair.values[a].elapsed.completed_turns++;pair.emit('status');};
  pair.submit=async(text,target='both',options={})=>{const selected=target==='both'?ARM_NAMES:[target];if(pair.state!=='ready'||selected.some(a=>pair.values[a].questions.length||pair.values[a].approvals.length))throw Error('pair_not_ready');for(const a of selected)if(options.expectedTurns?.[a]===null&&pair.values[a].status!=='ready')throw Error('native_turn_stale');calls.push({pair,target,text,options});for(const a of selected){pair.values[a].messages.push({author:'You',phase:'sent',text});pair.begin(a);}return{status:'started',arms:Object.fromEntries(selected.map(a=>[a,{status:'started'}]))};};
  pair.interrupt=async(target,{expectedTurns})=>{const selected=target==='both'?ARM_NAMES:[target];for(const a of selected){if(expectedTurns[a]!==pair.values[a].active_turn_id)throw Error('turn_action_stale');pair.values[a].interrupt_pending=true;}pair.emit('status');return{status:'accepted',arms:Object.fromEntries(selected.map(a=>[a,{status:'interrupt_requested'}]))};};
  pair.question=async()=>{assert.fail('CI must never answer a question');};pair.decide=async()=>{assert.fail('CI must never approve a command');};
  pair.stop=async()=>{pair.codeChecks.close();pair.stopped++;pair.state='closed';for(const a of ARM_NAMES){pair.values[a].status='closed';pair.values[a].active_turn_id=null;}pair.emit('status');};
  const result=o=>({state:o.workspace.endsWith('/'+failedArm)?'failed':'passed',exit_code:o.workspace.endsWith('/'+failedArm)?1:0,artifact_sha256:o.artifactHash,trusted_plan_hash:PLAN,stdout:'PRIVATE_RAW_STDOUT /Users/private/credential-secret'});
  const verify=o=>{verifications.push({pair,options:o});return hold?new Promise(resolve=>pending.push(()=>resolve(result(o)))):Promise.resolve(result(o));};
  pair.codeChecks=new SessionCIService({pair,plan:{ownTests:['test/required.test.mjs'],expectedPlanHash:PLAN,trustedFiles:{'test/frozen.test.mjs':Buffer.from("test('"+CASE+"',()=>{});")}},workspaces:{without:'/owned/without',with:'/owned/with'},collect:async workspace=>({files:[{digest:pair.hashes[workspace.endsWith('/with')?'with':'without']}],bytes:new Map()}),hash:files=>files[0].digest,verify,summarize:r=>({schema_version:1,state:r.state,exit_code:r.exit_code,public_tests:totals(false),frozen_tests:totals(r.state==='failed'),cases:[{name:CASE,result:r.state==='failed'?'failed':'passed'}],artifact_sha256:r.artifact_sha256,trusted_plan_hash:r.trusted_plan_hash}),onChange:()=>pair.emit('status')});pairs.push(pair);return pair;
 };
 const server=createStructuredServer({root:ROOT,labRoot:ROOT,createPair,evidenceStore:store,fixture:true,checkpointMs:60000});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,config=await(await fetch(base+'/api/config')).json();
 const state=async()=>(await(await fetch(base+'/api/config')).json()).state;
 const post=async(route,body={},headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{origin:base,'content-type':'application/json','x-terminal-token':config.token,...headers},body:JSON.stringify(body)});
 const release=()=>{pending.splice(0).forEach(resolve=>resolve());};const shutdown=()=>closing??=(async()=>{await server.shutdown();})();
 t.after(async()=>{release();await shutdown().catch(()=>{});await fs.rm(folder,{recursive:true,force:true});});
 return{server,base,config,state,post,release,shutdown,pairs,verifications,calls,pair:()=>pairs.at(-1),start:()=>post('start'),checks:async(target='both')=>{const response=await post('ci/check',{generation:(await state()).session_generation,target,actor:'participant'});assert.equal(response.status,202);return(await response.json()).outcome.checks;},exported:g=>fetch(base+'/api/evidence?generation='+g,{headers:{'x-terminal-token':config.token}})};
}

test('CI HTTP admission requires local origin/token/generation and rejects browser paths',async t=>{
 const f=await fixture(t);await f.start();const body={generation:1,target:'with',actor:'participant'};
 assert.equal((await f.post('ci/check',body,{'x-terminal-token':'bad'})).status,403);assert.equal((await f.post('ci/check',body,{origin:'https://foreign.test'})).status,403);assert.equal((await f.post('ci/check',{...body,generation:2})).status,409);
 for(const extra of[{workspace:'/private'},{node:'/bin/sh'},{trustedFiles:{}},{tests:['bad.test.mjs']}])assert.equal((await f.post('ci/check',{...body,...extra})).status,400);
 assert.equal(f.verifications.length,0);assert.equal(f.calls.length,0);await f.checks('with');await f.pair().codeChecks.wait();assert.equal(f.verifications.length,1);assert.equal(f.calls.length,0);
});

test('explicit CI feedback sends only each arm own results and counts zero generated human characters',async t=>{
 const f=await fixture(t,{failedArm:'without'});await f.start();const checks=await f.checks();await f.pair().codeChecks.wait();const response=await f.post('ci/feedback',{generation:1,target:'both',checks,actor:'participant'});assert.equal(response.status,200);const body=await response.json();assert.equal(body.outcome.status,'started');assert.equal(f.calls.length,2);
 for(const a of ARM_NAMES){const call=f.calls.find(c=>c.target===a);assert.ok(call.text.includes(HASH[a]));assert.ok(!call.text.includes(HASH[a==='with'?'without':'with']));assert.deepEqual(call.options.expectedTurns,{[a]:null});assert.ok(!call.text.includes('PRIVATE_RAW_STDOUT'));}
 const actions=body.state.measurement.actions.participant;assert.equal(actions.submissions,1);assert.equal(actions.characters,0);assert.equal(actions.arms.with.characters,0);assert.equal(actions.arms.without.characters,0);
 assert.equal((await f.post('ci/feedback',{generation:1,target:'both',checks,actor:'participant'})).status,409);assert.equal(f.calls.length,2);
});

test('pending native questions cannot be answered or bypassed by CI feedback',async t=>{
 const f=await fixture(t);await f.start();const checks=await f.checks('with');await f.pair().codeChecks.wait();f.pair().values.with.questions=[{userInputId:'PRIVATE_PROMPT',questions:[]}];f.pair().values.with.status='question';f.pair().emit('status');const r=await f.post('ci/feedback',{generation:1,target:'with',checks,actor:'participant'});assert.equal(r.status,409);assert.equal(f.calls.length,0);
});

test('pending CI does not block ordinary submission and targeted interruption',async t=>{
 const f=await fixture(t,{hold:true});await f.start();await f.checks('with');await until(()=>f.verifications.length===1);assert.equal(f.server.isQuiescent(),false);
 assert.equal((await f.post('submit',{generation:1,text:'Work independently',target:'without',actor:'participant'})).status,200);assert.equal((await f.post('interrupt',{generation:1,target:'without',expectedTurns:{without:'active-without'},actor:'participant'})).status,200);assert.equal(f.calls.length,1);assert.equal(f.pair().values.without.interrupt_pending,true);assert.equal(f.pair().codeChecks.snapshot().running,1);f.release();await f.pair().codeChecks.wait();
});

test('external code edits and completed native ABA make previous CI feedback stale',async t=>{
 for(const change of ['artifact','turn']){const f=await fixture(t);await f.start();const checks=await f.checks('with');await f.pair().codeChecks.wait();if(change==='artifact')f.pair().hashes.with='d'.repeat(64);else{f.pair().begin('with');f.pair().finish('with');}const r=await f.post('ci/feedback',{generation:1,target:'with',checks,actor:'participant'});assert.equal(r.status,409);assert.equal(f.calls.length,0);}
});

test('Stop invalidates promptly, and old CI cannot leak into a reopened generation',async t=>{
 const f=await fixture(t,{hold:true});await f.start();const old=f.pair(),checks=await f.checks('with');await until(()=>f.verifications.length===1);assert.equal((await f.post('stop')).status,200);assert.equal(old.state,'closed');assert.equal(old.codeChecks.snapshot().closed,true);
 let awaitingOld=false;const originalWait=old.codeChecks.wait.bind(old.codeChecks);old.codeChecks.wait=async()=>{awaitingOld=true;return originalWait();};const starting=f.start();await until(()=>awaitingOld);assert.equal(f.pairs.length,1);f.release();assert.equal((await starting).status,200);assert.equal((await f.state()).session_generation,2);assert.equal(f.pair().codeChecks.snapshot().arms.with.latest,null);old.emit('status');assert.equal((await f.state()).code_checks.arms.with.latest,null);assert.equal((await f.post('ci/feedback',{generation:1,target:'with',checks,actor:'participant'})).status,409);
});

test('shutdown waits for bounded owned CI completion after closing native pair',async t=>{
 const f=await fixture(t,{hold:true});await f.start();await f.checks('with');await until(()=>f.verifications.length===1);let finished=false;const closing=f.shutdown().then(()=>{finished=true;});await until(()=>f.pair().state==='closed');assert.equal(finished,false);assert.equal(f.pair().codeChecks.snapshot().closed,true);f.release();await closing;assert.equal(finished,true);
});

test('evidence export persists CI summary metadata without raw output, test names or native IDs',async t=>{
 const f=await fixture(t,{evidence:true,failedArm:'without'});await f.start();await f.checks();await f.pair().codeChecks.wait();const response=await f.exported(1);assert.equal(response.status,200);const doc=await response.json();assert.equal(doc.code_checks.arms.with.latest.summary.state,'passed');assert.equal(doc.code_checks.arms.without.latest.summary.state,'failed');assert.equal(doc.code_checks.arms.with.latest.summary.frozen_tests.tests,1);const raw=JSON.stringify(doc);assert.doesNotMatch(raw,/PRIVATE_RAW|PRIVATE_NATIVE|credential-secret|\/owned\/|KNOWN_CI_CASE/);assert.ok(!raw.includes(f.config.token));
});
