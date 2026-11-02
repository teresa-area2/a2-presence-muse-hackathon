import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import path from'node:path';import{EventEmitter}from'node:events';import{PassThrough}from'node:stream';
import{MuseObserverEvents,createMuseObserverRunner,assertInstructionFreeDirectory}from'../src/muse-observer-runner.mjs';import{buildObserverEvidence}from'../src/presence-observer.mjs';
const record=(type,payload)=>JSON.stringify({payload_type:type,payload})+'\n';
const output=()=>record('run.usage',{calls:1,models:[{input_tokens:42,output_tokens:7,cached_tokens:10}]})+record('run.terminal.completed',{terminal:'completed',text:JSON.stringify({fact_ids:['source_fallback']})});
test('actual CLI JSON envelope parsing retains only usage and the bounded final selection',()=>{
 const parser=new MuseObserverEvents(),stream=record('turn.input.user',{prompt:'PRIVATE_PROMPT'})+output();
 for(let i=0;i<stream.length;i+=7)parser.feed(Buffer.from(stream.slice(i,i+7)));parser.finish();assert.equal(parser.invalid,false);assert.equal(parser.completed,true);
 assert.deepEqual(parser.selection,{fact_ids:['source_fallback']});assert.equal(parser.usage.input_tokens,42);assert.equal(parser.usage.model_calls,1);assert.ok(!JSON.stringify(parser).includes('PRIVATE_PROMPT'));
});
test('malformed, unexpected child activity and unfinished streams fail closed',()=>{
 for(const stream of ['invalid\n',record('subagent.spawned',{}),record('run.terminal.completed',{terminal:'completed',text:'unstructured private text'}),'{}']){const p=new MuseObserverEvents();p.feed(Buffer.from(stream));p.finish();assert.equal(p.invalid,true);}
});
test('null usage records cannot throw out of a process callback or invent counts',()=>{
 const parser=new MuseObserverEvents();assert.doesNotThrow(()=>parser.feed(Buffer.from(record('run.usage',{calls:1,models:[null]}))));assert.equal(parser.invalid,true);assert.equal(parser.usage.status,'invalid');assert.equal(parser.usage.input_tokens,null);
});
test('default workspace preflight rejects inherited repository instructions',async()=>{
 await assert.rejects(assertInstructionFreeDirectory(process.cwd()),/observer_workspace_has_instructions/);
});
async function fixture(t,behavior,options={}){
 const parent=await fs.mkdtemp(path.join(process.cwd(),'.muse-config-test-observer-')),home=path.join(parent,'home'),directory=path.join(parent,'runs');
 await fs.mkdir(path.join(home,'.config/muse'),{recursive:true,mode:0o700});await fs.writeFile(path.join(home,'.config/muse/auth.json'),'FAKE_AUTH',{mode:0o600});
 t.after(()=>fs.rm(parent,{recursive:true,force:true}));let captured,child,kills=[];
 const runner=createMuseObserverRunner({binary:'/fixture/muse',directory,checkWorkspace:async()=>{},environment:{HOME:home,PATH:'/bin',OP_KEY:'PRIVATE_CREDENTIAL'},timeoutMs:100,...options,spawnProcess:(binary,args,options)=>{captured={binary,args,options};child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=456789;setImmediate(()=>behavior(child));return child;},killProcess:(c,signal)=>{assert.equal(c,child);kills.push(signal);setImmediate(()=>c.emit('close',null));}});
 return{runner,directory,capture:()=>captured,kills};
}
test('observer uses isolated credentials/settings, one tool-free step and separate actual usage',async t=>{
 const f=await fixture(t,c=>{c.stderr.write('PRIVATE_STDERR');c.stdout.write(output());c.emit('close',0);});
 const evidence=buildObserverEvidence({session_generation:1,arms:{with:{messages:[]},without:{messages:[]}}});
 const result=await f.runner(evidence),call=f.capture();assert.ok(result.fact_ids.includes('benefit_unverified'));assert.equal(result.usage.input_tokens,42);assert.equal(result.usage.cost_usd,null);
 assert.ok(call.args.includes('--json'));assert.equal(call.args[call.args.indexOf('--max-model-steps')+1],'1');assert.equal(call.args[call.args.indexOf('--contributor-mode')+1],'off');
 for(const flag of ['--disable-shell','--disable-write','--no-session-log','--no-foreign-personal-context'])assert.ok(call.args.includes(flag));
 const overrides=call.args.flatMap((value,index)=>value==='-c'?[call.args[index+1]]:[]);assert.equal(overrides.filter(x=>x==='provider_retry.max_retries=0').length,1);
 for(const flag of ['--yolo','--disable-sandbox','--disable-approval','--workspace'])assert.ok(!call.args.includes(flag));
 assert.ok(!('OP_KEY'in call.options.env));assert.notEqual(call.options.env.XDG_CONFIG_HOME,path.join(call.options.env.HOME,'.config'));
 assert.deepEqual(await fs.readdir(f.directory),[]);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('timeout terminates only the owned observer and cleans its isolated files',async t=>{
 const f=await fixture(t,()=>{});await assert.rejects(f.runner(buildObserverEvidence({})),/observer_explanation_unavailable/);assert.deepEqual(f.kills,['SIGTERM']);assert.deepEqual(await fs.readdir(f.directory),[]);
});
test('explicit cancellation is reported separately from a successful explanation',async t=>{
 const abort=new AbortController(),f=await fixture(t,()=>abort.abort());await assert.rejects(f.runner(buildObserverEvidence({}),{signal:abort.signal}),/observer_cancelled/);assert.deepEqual(f.kills,['SIGTERM']);assert.deepEqual(await fs.readdir(f.directory),[]);
});

import {buildComparisonPacket,comparisonPrompt} from '../src/observer-report.mjs';
import {structuredFixtureReport,comparisonFixtureReport} from './helpers/comparison-report.mjs';
test('comparison protocol sends only its canonical preview and enforces one tool-free attempt with zero provider retries',async t=>{
 const state={session_generation:1,status:'ready',arms:{without:{status:'ready',messages:[{author:'You',phase:'sent',text:'Compare this task'},{author:'Muse',phase:'finalAnswer',text:'Preserve the draft and retry one conflict.'}]},with:{status:'ready',messages:[{author:'You',phase:'sent',text:'Compare this task'},{author:'Muse',phase:'finalAnswer',text:'Preserve the draft and retry one conflict.'}]}}},packet=buildComparisonPacket(state);let sent,schema;
 const reply=structuredFixtureReport(packet);reply.highlights=['depth','interruptions','turns','format'].map(category=>({...structuredClone(reply.highlights[0]),category}));reply.overall.text='Both preserve the draft guard; interpret reduced output alongside the cache tradeoff.';
 const f=await fixture(t,async c=>{const call=f.capture();sent=await fs.readFile(call.args[call.args.indexOf('--prompt-file')+1],'utf8');schema=JSON.parse(await fs.readFile(call.args[call.args.indexOf('--output-schema')+1],'utf8'));c.stdout.write(record('run.usage',{calls:1,models:[{input_tokens:123,output_tokens:45,cached_tokens:0}]})+record('run.terminal.completed',{terminal:'completed',text:JSON.stringify(reply)}));c.emit('close',0);},{protocol:'comparison'});
 const result=await f.runner(packet);assert.equal(sent,comparisonPrompt(packet,{profile:'concise',grounding:'snapshot_context'}));assert.equal(result.report.highlights.length,4);assert.equal(result.usage.model_calls,1);assert.ok(f.capture().args.includes('provider_retry.max_retries=0'));assert.equal(schema.properties.highlights.minItems,4);assert.equal(schema.properties.highlights.maxItems,5);assert.equal(schema.properties.overall.properties.text.maxLength,240);assert.equal(schema.properties.highlights.items.properties.explanation.properties.text.maxLength,160);assert.equal(schema.properties.highlights.items.properties.title.maxLength,60);assert.deepEqual(await fs.readdir(f.directory),[]);
});

test('comparison runner enforces concise word counts locally without retrying a broad-valid saved response',async t=>{
 const packet=buildComparisonPacket({session_generation:1,arms:{without:{messages:[{author:'Muse',phase:'finalAnswer',text:'Original response'}]},with:{messages:[{author:'Muse',phase:'finalAnswer',text:'Adaptive response'}]}}}),reply=structuredFixtureReport(packet);reply.highlights=['depth','interruptions','turns','format'].map(category=>({...structuredClone(reply.highlights[0]),category}));reply.overall.text=Array(36).fill('a').join(' ');let calls=0;
 const f=await fixture(t,c=>{calls++;c.stdout.write(record('run.usage',{calls:1,models:[{input_tokens:123,output_tokens:45,cached_tokens:0}]})+record('run.terminal.completed',{terminal:'completed',text:JSON.stringify(reply)}));c.emit('close',0);},{protocol:'comparison'});
 await assert.rejects(f.runner(packet),error=>error.message==='observer_explanation_unavailable'&&error.usage.model_calls===1);assert.equal(calls,1);assert.deepEqual(await fs.readdir(f.directory),[]);
});

test('comparison runner rejects legacy report output instead of accepting a live v1 fallback',async t=>{
 const packet=buildComparisonPacket({session_generation:1,arms:{without:{messages:[{author:'Muse',phase:'finalAnswer',text:'Original response'}]},with:{messages:[{author:'Muse',phase:'finalAnswer',text:'Adaptive response'}]}}});
 const f=await fixture(t,c=>{c.stdout.write(record('run.usage',{calls:1,models:[{input_tokens:123,output_tokens:45,cached_tokens:0}]})+record('run.terminal.completed',{terminal:'completed',text:JSON.stringify(comparisonFixtureReport(packet))}));c.emit('close',0);},{protocol:'comparison'});
 await assert.rejects(f.runner(packet),error=>error.message==='observer_explanation_unavailable'&&error.usage.model_calls===1);assert.deepEqual(await fs.readdir(f.directory),[]);
});


test('facts Observer rejects multiple reported calls while retaining actual usage',async t=>{
 const f=await fixture(t,c=>{c.stdout.write(record('run.usage',{calls:2,models:[{input_tokens:84,output_tokens:14,cached_tokens:20}]})+record('run.terminal.completed',{terminal:'completed',text:JSON.stringify({fact_ids:['source_fallback']})}));c.emit('close',0);});
 await assert.rejects(f.runner(buildObserverEvidence({session_generation:1,arms:{without:{messages:[]},with:{messages:[]}}})),error=>error.message==='observer_explanation_unavailable'&&error.usage.model_calls===2&&error.usage.input_tokens===84&&error.usage.output_tokens===14);
 assert.deepEqual(await fs.readdir(f.directory),[]);
});
