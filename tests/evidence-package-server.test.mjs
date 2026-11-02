import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {EventEmitter} from 'node:events';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {createStructuredServer} from '../structured-server.mjs';import {createEvidenceStore} from '../src/evidence-store.mjs';import {createEvidencePackageStore} from '../src/evidence-package.mjs';
import {observerState} from './helpers/observer-state.mjs';import {structuredFixtureReport} from './helpers/comparison-report.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=v=>createHash('sha256').update(v).digest('hex');
class Pair extends EventEmitter{
 constructor(){super();this.state=observerState();this.stops=0;}
 snapshot(){return structuredClone(this.state);}
 async submit(text){for(const a of Object.values(this.state.arms))a.messages.push({author:'You',phase:'sent',text});this.emit('status');return{status:'started'};}
 async stop(){this.stops++;this.state.status='closed';for(const a of Object.values(this.state.arms))a.status='closed';this.emit('status');}
}
async function fixture(t,options={}){
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'evidence-package-api-'))),repo=path.join(directory,'canonical');await fs.mkdir(repo,{mode:0o700});execFileSync('git',['init','-q',repo],{stdio:'ignore'});await fs.writeFile(path.join(repo,'.gitignore'),'/.local/\n');
 const store=await createEvidenceStore({directory:path.join(directory,'checkpoints'),debounceMs:0,metadata:{evidence_mode:'fixture'}}),packages=await createEvidencePackageStore({repositoryRoot:repo});let pair;
 const server=createStructuredServer({root,labRoot:root,createPair:async()=>pair=new Pair(),evidenceStore:store,evidencePackageStore:options.unconfigured?null:options.wrapStore?.(packages)??packages,evidencePackageSource:{assets:[{name:'evidence_package',sha256:'a'.repeat(64)}]},reviewComparison:options.review??null,checkpointMs:60000});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,config=await(await fetch(base+'/api/config')).json();
 const read=async()=>(await(await fetch(base+'/api/config')).json()).state;
 const post=async(route,body={},headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{origin:base,'content-type':'application/json','x-terminal-token':config.token,...headers},body:JSON.stringify(body)});
 const start=async()=>{const r=await post('start');assert.equal(r.status,200);return read();};
 const exported=async(extra={},headers={})=>{const s=await read();return post('evidence/package',{generation:s.session_generation,run_id:s.evidence.run_id,include_public_excerpts:false,...extra},headers);};
 const files=()=>fs.readdir(path.join(repo,'.local/evidence-packages'));
 t.after(async()=>{await server.shutdown();await fs.rm(directory,{recursive:true,force:true});});
 return{server,store,repo,config,start,post,read,exported,files,pair:()=>pair};
}
test('explicit package save targets the trusted repository, preserves the checkpoint and legacy download, and dispatches nothing',async t=>{
 let calls=0;const f=await fixture(t,{review:()=>{calls++;throw Error('must_not_dispatch');}});await f.start();assert.deepEqual(await f.files(),[]);assert.equal(calls,0);
 const response=await f.exported();assert.equal(response.status,200);const receipt=await response.json(),bytes=await fs.readFile(receipt.saved.path),pkg=JSON.parse(bytes);
 assert.equal(sha(bytes),receipt.saved.sha256);assert.equal(receipt.saved.bytes,bytes.length);assert.ok(receipt.saved.path.startsWith(f.repo+'/.local/evidence-packages/'));assert.equal(pkg.checkpoint.sha256,sha(JSON.stringify(pkg.checkpoint.value)));
 assert.deepEqual(pkg.source.assets,[{name:'evidence_package',sha256:'a'.repeat(64)}]);assert.equal(pkg.assessment.enabled,true);assert.equal(pkg.assessment.status,'idle');assert.equal(pkg.assessment.reports.length,0);assert.equal(pkg.assessment.reports_omitted,null);assert.deepEqual(pkg.checkpoint.value.observer_reports,[]);assert.equal(calls,0);assert.equal(f.pair().stops,0);
 const legacy=await fetch('http://127.0.0.1:'+f.server.address().port+'/api/evidence?generation=1',{headers:{'x-terminal-token':f.config.token}});assert.equal(legacy.status,200);const old=await legacy.json();assert.equal(old.schema_version,1);assert.equal(old.evidence_kind,'checkpoint');assert.ok(!JSON.stringify(pkg).includes('PRIVATE_USER_MESSAGE'));assert.ok(!JSON.stringify(pkg).includes(f.config.token));
});
test('same-origin/token/strict fields protect export; browser paths and wrong identities cannot write',async t=>{
 const f=await fixture(t);await f.start();
 for(const [extra,headers,expected] of [[{}, {'x-terminal-token':'wrong'},403],[{}, {origin:'https://foreign.test'},403],[{generation:2},{},409],[{run_id:'20000000-0000-4000-8000-000000000002'},{},409],[{path:'/private/arbitrary'},{},400],[{include_public_excerpts:'yes'},{},400]]){assert.equal((await f.exported(extra,headers)).status,expected);}
 assert.deepEqual(await f.files(),[]);
});
test('missing trusted output binding fails explicitly without disabling the workspace',async t=>{
 const f=await fixture(t,{unconfigured:true});assert.equal(f.config.evidence_package.enabled,false);await f.start();assert.equal((await f.exported()).status,503);assert.equal((await f.read()).status,'ready');assert.equal(f.pair().stops,0);
});
test('completed rich report is separate from legacy facts, and later progress marks it stale',async t=>{
 let calls=0;const f=await fixture(t,{review:async packet=>{calls++;return{report:structuredFixtureReport(packet),usage:{status:'observed',model_calls:1,input_tokens:123,output_tokens:45,elapsed_ms:10}};}});await f.start();
 const prepared=await(await f.post('observer/report/preview',{generation:1})).json();assert.ok(prepared.preview?.id);assert.equal((await f.post('observer/report',{generation:1,preview_id:prepared.preview.id})).status,202);
 let current;for(let n=0;n<100;n++){current=await f.read();if(current.muse_comparison.status!=='running')break;await new Promise(r=>setTimeout(r,2));}assert.equal(current.muse_comparison.status,'completed');
 await f.pair().submit('another synthetic instruction');const r=await(await f.exported()).json(),pkg=JSON.parse(await fs.readFile(r.saved.path,'utf8'));
 assert.equal(pkg.assessment.status,'completed');assert.equal(pkg.assessment.reports[0].stale,true);assert.equal(pkg.assessment.reports[0].fingerprint,current.muse_comparison.reports[0].fingerprint);assert.equal(pkg.assessment.reports[0].usage.input_tokens,123);assert.ok(pkg.assessment.reports[0].report.overall.text);assert.equal(pkg.assessment.reports[0].snapshot_context.scope,'snapshot_context_not_model_selected_citations');assert.deepEqual(pkg.checkpoint.value.observer_reports,[]);assert.equal(calls,1);assert.ok(!JSON.stringify(pkg).includes('PRIVATE_USER_MESSAGE'));assert.ok(!JSON.stringify(pkg).includes('PRIVATE_CODE_QUESTION'));
});
test('running assessment is exported immediately, without waiting, a retry or a second call',async t=>{
 let calls=0;const f=await fixture(t,{review:(_packet,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('synthetic_cancel')),{once:true}));}});await f.start();
 const p=await(await f.post('observer/report/preview',{generation:1})).json();await f.post('observer/report',{generation:1,preview_id:p.preview.id});
 const r=await(await f.exported()).json(),pkg=JSON.parse(await fs.readFile(r.saved.path,'utf8'));assert.equal(pkg.assessment.status,'running');assert.equal(pkg.assessment.reports[0].status,'running');assert.equal(pkg.assessment.reports[0].report,null);assert.equal(calls,1);
});
test('checkpoint progress during package writing invalidates publication',async t=>{
 let f;f=await fixture(t,{wrapStore:store=>({async save(pkg,options){await f.pair().submit('changed while writing');return store.save(pkg,options);}})});await f.start();const r=await f.exported();assert.equal(r.status,409);assert.equal((await r.json()).error,'evidence_package_changed');assert.deepEqual(await f.files(),[]);assert.equal(f.pair().stops,0);
});
test('generation replacement during package writing cannot publish mixed evidence',async t=>{
 let entered,release;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const f=await fixture(t,{wrapStore:store=>({async save(pkg,options){entered();await gate;return store.save(pkg,options);}})});await f.start();const writing=f.exported();await started;await f.post('stop');await f.start();release();assert.equal((await writing).status,409);assert.deepEqual(await f.files(),[]);assert.equal((await f.read()).session_generation,2);
});
test('write failures are visible and private low-level diagnostics cannot leak',async t=>{
 const f=await fixture(t,{wrapStore:()=>({async save(){throw Error('PRIVATE_DISK_SECRET');}})});await f.start();const r=await f.exported();assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'evidence_package_save_failed'});assert.deepEqual(await f.files(),[]);
});
test('a possible published file is distinguished from a pre-publication write error',async t=>{
 const f=await fixture(t,{wrapStore:()=>({async save(pkg){const error=Error('evidence_publication_unconfirmed');error.package_id=pkg.package_id;error.published_path=path.join(f.repo,'.local/evidence-packages',pkg.package_id+'.json');throw error;}})});await f.start();const r=await f.exported();assert.equal(r.status,503);const body=await r.json();assert.equal(body.error,'evidence_publication_unconfirmed');assert.ok(body.possibly_saved.path.startsWith(f.repo));assert.equal(body.possibly_saved.session_generation,1);assert.equal(body.possibly_saved.run_id,(await f.read()).evidence.run_id);
});


test('export survives safe ignore-file edits after the workspace starts',async t=>{const f=await fixture(t);await f.start();await fs.appendFile(path.join(f.repo,'.gitignore'),'/docs/handoffs/\n/outputs/\n');const r=await f.exported();assert.equal(r.status,200);const receipt=await r.json(),bytes=await fs.readFile(receipt.saved.path);assert.equal(sha(bytes),receipt.saved.sha256);assert.equal((await f.read()).status,'ready');assert.equal(f.pair().stops,0);});
test('unsafe output policy is reported without advising connection retries or stopping sessions',async t=>{const f=await fixture(t);await f.start();await fs.writeFile(path.join(f.repo,'.gitignore'),'/.local/\n!/.local/\n');const r=await f.exported();assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'evidence_output_configuration_changed'});assert.deepEqual(await f.files(),[]);assert.equal(f.pair().stops,0);});

test('removed Git metadata and transient missing-output failures are configuration errors',async t=>{for(const mode of ['removed_git','open_race']){const f=await fixture(t,mode==='open_race'?{wrapStore:()=>({async save(){const e=Error('not_for_ui');e.code='ENOENT';throw e;}})}:{});await f.start();if(mode==='removed_git')await fs.rm(path.join(f.repo,'.git'),{recursive:true});const r=await f.exported();assert.equal(r.status,503,mode);assert.deepEqual(await r.json(),{error:'evidence_output_configuration_changed'},mode);assert.equal(f.pair().stops,0,mode);assert.deepEqual(await f.files(),[],mode);}});
