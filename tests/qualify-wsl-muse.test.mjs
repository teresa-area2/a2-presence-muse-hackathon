import test from 'node:test';import assert from 'node:assert/strict';
import {qualify,isWSL2,parseArgs,parsePublicEvents,modelArguments,captureOwned} from '../scripts/qualify-wsl-muse.mjs';

const rec=(payload_type,payload)=>JSON.stringify({payload_type,payload})+'\n';
const output=()=>rec('run.usage',{calls:1,models:[{input_tokens:11,output_tokens:2,cached_tokens:3}]})+rec('run.terminal.completed',{terminal:'completed',text:'{"ready":true}'});
function fixture({tty=true,ci=false,cleanupSafe=true}={}){
 const calls=[],env={HOME:'/fake/home',PATH:'/fake/bin',META_API_KEY:'SYNTHETIC_SECRET',CI:ci?'true':''},system={platform:'linux',env,tty,nodeVersion:'22.12.0'};
 const ops={
  readKernel:async()=>{calls.push('kernel');return '5.15.153.1-microsoft-standard-WSL2';},
  findBinary:async e=>{calls.push('find');assert.equal(e.META_API_KEY,undefined);return '/fake/bin/muse';},
  newWorkspace:async()=>{calls.push('workspace');return '/fake/cache/work';},
  authMetadata:async()=>{calls.push('auth-metadata-only');return true;},
  createConfigs:async x=>{calls.push('configs');assert.equal(x.nativeProfile,true);assert.equal(x.environment.META_API_KEY,undefined);return {without:{...x.environment,XDG_CONFIG_HOME:'/fake/config'}};},
  removeConfigs:async()=>calls.push('remove-configs'),removeWorkspace:async()=>calls.push('remove-workspace'),
  capture:async(_bin,args,opts)=>{calls.push(args[0]);assert.equal(opts.env.META_API_KEY,undefined);if(args[0]==='--version')return {started:true,code:0,stdout:'Muse Code 1.4.14 (1.4.14-R7309.1)\n',cleanupSafe:true};assert.equal(opts.timeoutMs,60000);return {started:true,code:0,stdout:output(),cleanupSafe};},
  login:async(_binary,e)=>{calls.push('interactive-login');assert.equal(e.META_API_KEY,undefined);return{ok:true};},
 };
 return {calls,system,ops};
}
test('requires actual WSL2 and closed arguments',()=>{
 assert.equal(isWSL2('linux','5.15-microsoft-standard-WSL2'),true);for(const [p,k] of [['darwin','microsoft-WSL2'],['linux','5.15.90'],['linux','microsoft-WSL']])assert.equal(isWSL2(p,k),false);
 assert.throws(()=>parseArgs(['--login','--allow-one-model-request']),/arguments_invalid/);assert.throws(()=>parseArgs(['--check','--login']),/arguments_invalid/);assert.deepEqual(parseArgs([]),{mode:'preflight',allowed:false});
});
test('non-WSL platform stops before kernel, credential or process operations',async()=>{
 const f=fixture();f.system.platform='darwin';const r=await qualify({args:['--check','--allow-one-model-request'],...f});assert.equal(r.reason,'wsl2_required');assert.deepEqual(f.calls,[]);assert.equal(r.model_request,'not_sent');
});
test('default and check without opt-in never dispatch a model or create configs',async()=>{
 for(const args of [[],['--check']]){const f=fixture(),r=await qualify({args,...f});assert.equal(r.status,'passed');assert.equal(r.model_request,'not_sent');assert.equal(r.cleanup,'confirmed');assert.deepEqual(f.calls,['kernel','find','workspace','--version','auth-metadata-only','remove-workspace']);assert.ok(!JSON.stringify(r).includes('SYNTHETIC_SECRET'));}
});
test('login requires real terminal and refuses CI before launching any process',async()=>{
 for(const opts of [{tty:false},{ci:true}]){const f=fixture(opts),r=await qualify({args:['--login'],...f});assert.equal(r.reason,'interactive_terminal_required');assert.deepEqual(f.calls,['kernel']);}
 const f=fixture(),r=await qualify({args:['--login'],...f});assert.equal(r.status,'passed');assert.ok(f.calls.includes('interactive-login'));assert.ok(!f.calls.includes('auth-metadata-only'));assert.ok(!f.calls.includes('exec'));assert.equal(r.cleanup,'confirmed');
});
test('opted-in check makes exactly one bounded, isolated model request',async()=>{
 const f=fixture(),r=await qualify({args:['--check','--allow-one-model-request'],...f});assert.equal(r.status,'passed');assert.equal(r.model_request,'qualified');assert.deepEqual(r.usage,{calls:1,input_tokens:11,output_tokens:2,cache_read_tokens:3,cost_usd:null});assert.equal(f.calls.filter(x=>x==='exec').length,1);assert.deepEqual(f.calls.slice(-2),['remove-configs','remove-workspace']);assert.doesNotMatch(JSON.stringify(r),/ready|SYNTHETIC_SECRET|\/fake\//);
 const args=modelArguments('/synthetic/work');for(const [key,value] of [['--provider','meta'],['--model','muse-spark-1.3'],['--preset','empty'],['--contributor-mode','off'],['--max-model-steps','1'],['--approval-mode','on-request'],['--approval-judge','off'],['-c','provider_retry.max_retries=0']])assert.equal(args[args.indexOf(key)+1],value);for(const flag of ['--disable-shell','--disable-write','--disable-web-tools','--disable-request-user-input'])assert.ok(args.includes(flag));assert.ok(!args.includes('--disable-sandbox'));assert.equal(args.at(-1),'Return exactly {"ready":true}.');
});
test('unconfirmed child cleanup keeps isolated configuration and workspace',async()=>{
 const f=fixture({cleanupSafe:false}),r=await qualify({args:['--check','--allow-one-model-request'],...f});assert.equal(r.status,'failed');assert.equal(r.reason,'process_cleanup_unconfirmed');assert.equal(r.cleanup,'unconfirmed_private_files_retained');assert.equal(r.model_request,'attempted');assert.ok(!f.calls.includes('remove-configs'));assert.ok(!f.calls.includes('remove-workspace'));
});
test('pre-aborted or unspawned model process is recorded as not sent',async()=>{
 for(const reason of ['process_cancelled','process_start_failed']){const f=fixture(),capture=f.ops.capture;f.ops.capture=async(bin,args,opts)=>args[0]==='exec'?{started:false,code:null,reason,stdout:'',cleanupSafe:true}:capture(bin,args,opts);const r=await qualify({args:['--check','--allow-one-model-request'],...f});assert.equal(r.status,'failed');assert.equal(r.model_request,'not_sent');assert.equal(r.usage,null);assert.equal(r.cleanup,'confirmed');assert.deepEqual(f.calls.slice(-2),['remove-configs','remove-workspace']);}
});
test('public event parser rejects tools, wrong answers, excess usage and missing terminal; unknown usage stays null',()=>{
 assert.equal(parsePublicEvents(rec('run.terminal.completed',{terminal:'completed',text:'{"ready":true}'})),null);
 for(const value of [rec('tool.started',{})+output(),rec('run.terminal.completed',{terminal:'completed',text:'{"ready":false}'}),rec('run.usage',{calls:2,models:[]})+output(),rec('run.usage',{calls:1,models:[]}), 'not json\n'])assert.throws(()=>parsePublicEvents(value));
});
test('owned harmless child exits normally or is stopped on deadline',async()=>{
 const opts={cwd:process.cwd(),env:{PATH:process.env.PATH},timeoutMs:5000};
 const ok=await captureOwned(process.execPath,['-e','process.stdout.write("ok")'],opts);assert.equal(ok.started,true);assert.equal(ok.code,0);assert.equal(ok.stdout,'ok');assert.equal(ok.cleanupSafe,true);
 const bounded=await captureOwned(process.execPath,['-e','setInterval(()=>{},1000)'],{...opts,timeoutMs:100});assert.equal(bounded.started,true);assert.equal(bounded.reason,'process_timeout');assert.equal(bounded.cleanupSafe,true);
 const abort=new AbortController();abort.abort();const cancelled=await captureOwned(process.execPath,['-e','process.exit(9)'],{...opts,signal:abort.signal});assert.equal(cancelled.started,false);assert.equal(cancelled.reason,'process_cancelled');assert.equal(cancelled.cleanupSafe,true);
 const missing=await captureOwned('/definitely/not/a/program',[],opts);assert.equal(missing.started,false);assert.equal(missing.reason,'process_start_failed');assert.equal(missing.cleanupSafe,true);
});
