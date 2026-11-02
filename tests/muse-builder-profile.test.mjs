import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MUSE_BUILDER_PROFILE,museSourceBuilderLaunch} from '../src/muse-builder-profile.mjs';
const paths={promptFile:'/fixture/task prompt.txt',outputSchema:'/fixture/schema.json'};
const value=(args,key)=>args[args.indexOf(key)+1];
test('future source builders choose Wonder while benchmark metadata stays Spark',()=>{
 const launch=museSourceBuilderLaunch(paths),manifest=JSON.parse(fs.readFileSync(new URL('../dependencies.json',import.meta.url),'utf8'));
 assert.equal(value(launch.args,'--model'),'muse-wonder-1.0');
 assert.equal(manifest.muse.model,'muse-spark-1.3');
 assert.equal(value(launch.args,'--provider'),'meta');assert.equal(value(launch.args,'--contributor-mode'),'off');
 assert.equal(value(launch.args,'--reasoning-effort'),'high');assert.equal(value(launch.args,'--preset'),'empty');
});
test('builder launch preserves the existing bounded tool-free safety boundary',()=>{
 const launch=museSourceBuilderLaunch(paths);
 assert.equal(value(launch.args,'--max-model-steps'),'2');assert.equal(launch.timeoutMs,180000);assert.equal(launch.maxAttempts,1);
 for(const flag of ['--json','--no-session-log','--no-foreign-personal-context','--disable-reminders','--disable-web-tools','--disable-request-user-input','--disable-shell','--disable-write'])assert.ok(launch.args.includes(flag),flag);
 assert.equal(value(launch.args,'--approval-mode'),'on-request');
 for(const flag of ['--yolo','--disable-sandbox','--disable-approval','--trust-workspace','--workspace'])assert.ok(!launch.args.includes(flag),flag);
 assert.equal(value(launch.args,'--prompt-file'),paths.promptFile);assert.equal(value(launch.args,'--output-schema'),paths.outputSchema);
});
test('paths fail closed and callers cannot mutate the shared future launch policy',()=>{
 for(const key of ['promptFile','outputSchema'])for(const bad of [null,'relative.txt','/fixture/line\nbreak','/fixture/null\0byte'])assert.throws(()=>museSourceBuilderLaunch({...paths,[key]:bad}),/muse_builder_path_invalid/);
 assert.throws(()=>museSourceBuilderLaunch(),/muse_builder_path_invalid/);
 const launch=museSourceBuilderLaunch(paths);assert.throws(()=>{MUSE_BUILDER_PROFILE.model='muse-spark-1.3';},TypeError);
 assert.throws(()=>launch.args.push('--disable-sandbox'),TypeError);assert.throws(()=>{launch.maxAttempts=2;},TypeError);
});
