import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runPresenceReplay} from '../scripts/replay-presence.mjs';
const execute=promisify(execFile),entry=fileURLToPath(new URL('../scripts/replay-presence.mjs',import.meta.url));
async function ownedRoots(pid=process.pid){return(await fs.readdir(await fs.realpath(os.tmpdir()))).filter(name=>name.startsWith(`a2-presence-replay-${pid}-`)).sort();}
function privacy(value){
 const forbidden=new Set(['guidance','text','prompt','payload','read_id','reading_id','session_id','turn_id','request_id','response_id','guidance_sha256','public_text_sha256','pressTimes','releaseTimes','keyAreas','keyTypes','fixture_capture']);
 const walk=x=>{if(Array.isArray(x))return x.forEach(walk);if(x&&typeof x==='object'){for(const [key,child]of Object.entries(x)){assert.ok(!forbidden.has(key),key);walk(child);}}};walk(value);
 const serialized=JSON.stringify(value);
 for(const pattern of [/DECLARED_SYNTHETIC_GUIDANCE/,/fixture-request-/,/fixture-response-/,/baseline-response-/,/Protocol fixture completion/,/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/,/[a-f0-9]{64}/,/\/Users\//,/\/private\//,/PRIVATE_CREDENTIAL_SENTINEL/])assert.doesNotMatch(serialized,pattern);
}

test('offline replay exercises same-turn replacement, public-final correlation, retained follow-up and revoked fallback and strict baseline isolation',async()=>{
 const before=await ownedRoots(),report=await runPresenceReplay();
 assert.equal(report.synthetic,true);assert.equal(report.model_runtime,'protocol_fixture');assert.equal(report.op_service_calls,0);assert.equal(report.provider_calls,0);
 assert.equal(report.policy_source,'declared_fixture');for(const key of ['behavior','human_effort','live_benefit'])assert.equal(report[key],'not_measured');assert.equal(report.calibration,'not_tested');
 assert.equal(report.results.ok,true);assert.equal(report.scenarios.length,3);
 assert.deepEqual(report.capture_handoff,{mode:'synthetic_record_replay',generated_lengths:[2,4],consumed_lengths:[2,4],dispatch_times:[30000,60000]});
 const [changed,retained,stale]=report.scenarios;
 assert.equal(changed.id,'same_turn_policy_change');assert.equal(changed.turn_ordinal,1);assert.equal(changed.status,'guidance_observed');
 assert.deepEqual(changed.requests,[
  {ordinal:1,status:'guidance_observed',controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'}},
  {ordinal:2,status:'guidance_observed',controls:{response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'}},
 ]);
 assert.deepEqual(changed.final,{status:'final_linked',request_ordinal:2,presence:'guidance'});
 assert.deepEqual(changed.hook_records,{pre:2,post:2});
 assert.equal(retained.id,'follow_up_retained_guidance');assert.equal(retained.turn_ordinal,2);assert.equal(retained.status,'guidance_observed');
 assert.deepEqual(retained.requests,[{ordinal:1,status:'guidance_observed',controls:{response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'}}]);
 assert.deepEqual(retained.final,{status:'final_linked',request_ordinal:1,presence:'guidance'});assert.deepEqual(retained.hook_records,{pre:1,post:1});
 assert.equal(stale.id,'revoked_fallback');assert.equal(stale.turn_ordinal,3);assert.equal(stale.status,'fallback_observed');
 assert.deepEqual(stale.requests,[{ordinal:1,status:'fallback_observed',controls:null}]);
 assert.deepEqual(stale.final,{status:'final_linked',request_ordinal:1,presence:'fallback'});assert.deepEqual(stale.hook_records,{pre:1,post:1});
 for(const scenario of report.scenarios){assert.equal(scenario.hook_linkage,'read_marker_matched');assert.equal(scenario.response_linkage,'public_final_matched');assert.equal(scenario.baseline,'baseline_isolated');assert.equal(scenario.baseline_hook_linkage,'unverified');assert.equal(scenario.usage_status,'observed');assert.equal(scenario.usage_coverage,'observed');}
 assert.deepEqual(report.cleanup,{workspaces_removed:true,bridge_removed:true,hook_children_exited:true});assert.deepEqual(await ownedRoots(),before);privacy(report);
});

test('replays are deterministic despite real owned hooks and leave no owned workspace behind',async()=>{
 const before=await ownedRoots();const first=await runPresenceReplay(),second=await runPresenceReplay();assert.deepEqual(second,first);assert.deepEqual(await ownedRoots(),before);privacy(second);
 assert.equal(first.typing.synthetic,true);assert.equal(first.typing.inference,'stub');assert.equal(first.typing.payload_origin,'simulated_events_not_sdk_capture');assert.equal(first.typing.calibration,'not_tested');
 assert.deepEqual(first.typing.reports.map(row=>row.scenario),['continuous-refresh','send-before-refresh','latest-only-buffering','stop-clears-pending']);
 for(const row of first.typing.reports){assert.equal(row.ok,true);assert.equal(row.closed,true);assert.equal(row.bufferClosed,true);assert.equal(row.timersPending,0);assert.ok(row.dispatchTimes.every(at=>Number.isFinite(at)&&at>=0&&at<=300000));}
 assert.equal(first.commentary.synthetic,true);
});

test('CLI works through a symlink and exports only safe fixture evidence',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'presence-replay-entry-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const link=path.join(root,'replay.mjs');await fs.symlink(entry,link);
 const node=await fs.realpath(process.execPath),env={HOME:root,PATH:path.dirname(node),TMPDIR:await fs.realpath(os.tmpdir()),LANG:'C',OPEN_PRESENCE_AUTH_CLIENT_SECRET:'PRIVATE_CREDENTIAL_SENTINEL'};
 const out=await execute(node,[link],{env,timeout:10000,maxBuffer:65536});assert.equal(out.stderr,'');const report=JSON.parse(out.stdout);assert.equal(report.results.ok,true);assert.equal(report.provider_calls,0);assert.equal(report.op_service_calls,0);privacy(report);
});

test('CLI failures use fixed safe JSON and a nonzero exit without model/service calls',async()=>{
 const node=await fs.realpath(process.execPath);
 await assert.rejects(execute(node,[entry,'/private/PRIVATE_CREDENTIAL_SENTINEL'],{env:{PATH:path.dirname(node),HOME:os.homedir(),LANG:'C'},timeout:10000,maxBuffer:65536}),error=>{
  assert.equal(error.code,1);assert.equal(error.stderr,'');assert.deepEqual(JSON.parse(error.stdout),{synthetic:true,model_runtime:'protocol_fixture',op_service_calls:0,provider_calls:0,results:{ok:false},error:'presence_replay_failed'});privacy(JSON.parse(error.stdout));return true;
 });
});


test('imported replay rejects all arguments before creating resources or accepting payloads/endpoints',async()=>{
 const before=await ownedRoots();
 for(const args of [[undefined],[{}],[null],[{endpoint:'https://invalid.example',fixture_capture:{length:1}}],[()=>{}],[[],{}]])await assert.rejects(runPresenceReplay(...args),/presence_replay_failed/);
 assert.deepEqual(await ownedRoots(),before);
});
