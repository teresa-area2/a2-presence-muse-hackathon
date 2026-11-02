import test from'node:test';
import fs from'node:fs/promises';import os from'node:os';import path from'node:path';import{execFile}from'node:child_process';import{promisify}from'node:util';import{fileURLToPath}from'node:url';
import assert from'node:assert/strict';
import{runScenario,runScript,SCENARIO_IDS}from'../scripts/simulate-textbox.mjs';
const dispatches=r=>r.ledger.filter(x=>x.type==='dispatch');

test('exports the four deterministic scenario ids',()=>{
 assert.deepEqual(SCENARIO_IDS,['continuous-refresh','send-before-refresh','latest-only-buffering','stop-clears-pending']);
 assert.equal(typeof runScenario,'function');
 assert.equal(typeof runScript,'function');
});

test('continuous-refresh dispatches cumulative lengths at three refreshes',async()=>{
 const r=await runScenario('continuous-refresh');
 assert.equal(r.synthetic,true);
 assert.equal(r.inference,'stub');
 assert.deepEqual(r.dispatchLengths,[2,4,6]);
 assert.deepEqual(r.dispatchTimes,[30000,60000,90000]);
 assert.deepEqual(dispatches(r),[{t:30000,type:'dispatch',sequence:1,length:2},{t:60000,type:'dispatch',sequence:2,length:4},{t:90000,type:'dispatch',sequence:3,length:6}]);
 assert.deepEqual(r.snapshots.map(x=>x.length),[2,4,6]);
 assert.equal(r.counts.interimSnapshots,3);
 assert.equal(r.capturesTotal,5);
 assert.equal(r.interimSlotsRemaining,1);
 assert.equal(r.timersPending,0);
 assert.equal(r.closed,true);
});

test('send-before-refresh skips the unchanged final and stops the stale timer',async()=>{
 const r=await runScenario('send-before-refresh');
 assert.deepEqual(r.dispatchLengths,[2]);
 assert.deepEqual(r.dispatchTimes,[30000]);
 assert.equal(r.skippedFinalCount,1);
 assert.deepEqual(r.ledger.filter(x=>x.type==='final_skipped'),[{t:59999,type:'final_skipped',sequence:2,has_new_input:false}]);
 assert.deepEqual(r.snapshots.map(x=>({kind:x.kind,length:x.length,has_new_input:x.has_new_input})),[{kind:'interim',length:2,has_new_input:true},{kind:'final',length:2,has_new_input:false}]);
 assert.equal(r.virtualTime,60001);
 assert.equal(r.timersPending,0);
});

test('latest-only-buffering replaces the middle snapshot and waits for cooldown',async()=>{
 const r=await runScenario('latest-only-buffering');
 assert.deepEqual(r.dispatchLengths,[2,6]);
 assert.deepEqual(r.dispatchTimes,[0,30000]);
 assert.deepEqual(dispatches(r).map(x=>x.sequence),[1,3]);
 assert.deepEqual(r.snapshots.map(x=>x.length),[2,4,6]);
 assert.deepEqual(r.replacedSequences,[2]);
 assert.equal(r.timersPending,0);
});

test('stop-clears-pending cancels queued work and ignores the old settlement',async()=>{
 const r=await runScenario('stop-clears-pending');
 assert.deepEqual(r.dispatchLengths,[2]);
 assert.deepEqual(r.dispatchTimes,[0]);
 assert.deepEqual(r.bufferOutcomes,[{sequence:2,status:'cancelled',t:1000},{sequence:1,status:'cancel_requested',t:1000}]);
 assert.equal(r.bufferOutcomes.some(x=>x.status==='ready'||x.status==='sent'),false);
 assert.equal(r.timersPending,0);
 assert.equal(r.closed,true);
 assert.equal(r.bufferClosed,true);
 assert.equal(r.virtualTime,61000);
});

test('runScript rejects malformed actions and unsafe timing before running',async()=>{
 await assert.rejects(runScript([{action:'bogus'}]),/simulate_script_invalid/);
 await assert.rejects(runScript([{action:'advance',ms:-1}]),/simulate_script_invalid/);
 await assert.rejects(runScript([{action:'advance',ms:Number.NaN}]),/simulate_script_invalid/);
 await assert.rejects(runScript([{action:'advance',ms:Infinity}]),/simulate_script_invalid/);
 await assert.rejects(runScript([{action:'tap',count:0}]),/simulate_script_invalid/);
 await assert.rejects(runScript(Array.from({length:65},()=>({action:'advance',ms:0}))),/simulate_script_invalid/);
 await assert.rejects(runScript([{action:'tap',count:2}],{captureCount:6}),/simulate_option_invalid/);
 await assert.rejects(runScenario('missing-scenario'),/simulate_scenario_unknown/);
});

test('runScript executes a small custom script with hardcoded results',async()=>{
 const r=await runScript([{action:'tap',count:2},{action:'checkpoint'}]);
 assert.equal(r.scenario,'custom');
 assert.deepEqual(r.dispatchLengths,[2]);
 assert.deepEqual(r.dispatchTimes,[0]);
 assert.deepEqual(r.snapshots.map(x=>x.length),[2]);
 assert.equal(r.timersPending,0);
});

test('scenarios are repeatable',async()=>{
 const first=await runScenario('continuous-refresh');
 const second=await runScenario('continuous-refresh');
 assert.deepEqual(second,first);
 assert.deepEqual(second.dispatchLengths,[2,4,6]);
});

test('unknown event fields and options are rejected rather than silently changing the experiment',async()=>{
 await assert.rejects(runScript([{action:'advance',ms:0,unknown:true}]),/simulate_script_invalid/);
 await assert.rejects(runScript([{action:'tap',count:2,key:'PRIVATE'}]),/simulate_script_invalid/);
 await assert.rejects(runScript([{action:'stop',ms:1}]),/simulate_script_invalid/);
 await assert.rejects(runScript([{action:'tap',count:2}],{firstSampleMinimumMs:1}),/simulate_option_invalid/);
 await assert.rejects(runScript([{action:'tap',count:2}],{dispatch:()=>assert.fail('No caller-supplied live dispatch')}),/simulate_option_invalid/);
});

test('CLI runs through a symlink instead of exiting with an empty success',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'typing-cli-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const alias=path.join(dir,'runner.mjs');await fs.symlink(fileURLToPath(new URL('../scripts/simulate-textbox.mjs',import.meta.url)),alias);
 const{stdout}=await promisify(execFile)(process.execPath,[alias,'continuous-refresh'],{timeout:5000,maxBuffer:100000});const report=JSON.parse(stdout);assert.equal(report.scenario,'continuous-refresh');assert.equal(report.synthetic,true);assert.deepEqual(report.dispatchTimes,[30000,60000,90000]);
});

test('recorded synthetic dispatches come from the same bounded clip/buffer replay',async()=>{
 const {recordSyntheticDispatches}=await import('../scripts/simulate-textbox.mjs');
 assert.equal(typeof recordSyntheticDispatches,'function');
 const events=[{action:'tap',count:2},{action:'advance',ms:30000},{action:'tap',count:2},{action:'advance',ms:30000}];
 const recorded=await recordSyntheticDispatches(events);
 assert.equal(recorded.synthetic,true);assert.equal(recorded.inference,'stub');assert.equal(recorded.payload_origin,'generated_not_sdk');
 assert.deepEqual(recorded.dispatches.map(d=>({at:d.at_ms,sequence:d.sequence,length:d.fixture_capture.length})),[{at:30000,sequence:1,length:2},{at:60000,sequence:2,length:4}]);
 assert.deepEqual(recorded.dispatches.map(d=>d.fixture_capture.pressTimes),[[0,10],[0,10,20,30]]);
 assert.deepEqual(recorded.dispatches.map(d=>d.fixture_capture.releaseTimes),[[5,15],[5,15,25,35]]);
 assert.deepEqual(recorded.report,await runScript(events));
 assert.deepEqual(recorded.report.dispatchLengths,[2,4]);
 assert.equal(JSON.stringify(recorded.report).includes('fixture_capture'),false);
 assert.equal(recorded.report.timersPending,0);
});

test('synthetic recording never accepts source text, real captures or a caller-supplied dispatcher',async()=>{
 const {recordSyntheticDispatches}=await import('../scripts/simulate-textbox.mjs');
 assert.equal(typeof recordSyntheticDispatches,'function');
 await assert.rejects(recordSyntheticDispatches([{action:'tap',count:2,key:'PRIVATE_INPUT'}]),/simulate_script_invalid/);
 await assert.rejects(recordSyntheticDispatches([{action:'tap',count:2}],{dispatch:()=>assert.fail('No external dispatch')}),/simulate_option_invalid/);
 await assert.rejects(recordSyntheticDispatches([{action:'tap',count:2}],{},()=>assert.fail('No external dispatch')),/simulate_option_invalid/);
});

test('recorded fake payloads are detached and replaying cannot mutate a later run',async()=>{
 const {recordSyntheticDispatches}=await import('../scripts/simulate-textbox.mjs');
 assert.equal(typeof recordSyntheticDispatches,'function');
 const events=[{action:'tap',count:2},{action:'checkpoint'}],a=await recordSyntheticDispatches(events);
 a.dispatches[0].fixture_capture.pressTimes[0]=999999;
 const b=await recordSyntheticDispatches(events);
 assert.deepEqual(b.dispatches[0].fixture_capture.pressTimes,[0,10]);
 assert.deepEqual(b.report.dispatchLengths,[2]);
});
