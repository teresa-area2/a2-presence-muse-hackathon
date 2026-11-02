import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {importAgentLab,AGENT_LAB_SOURCE_FILES} from '../scripts/import-agent-lab.mjs';
import {readDependencyBundle,sha256} from '../src/dependency-bundle.mjs';
import {runGit} from '../src/git-ops.mjs';

const execute=promisify(execFile),ROOT=fileURLToPath(new URL('../',import.meta.url));
const BUNDLE=path.join(ROOT,'vendor/agent-lab');
async function privateTemp(t){const base=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'agent-lab-bundle-')));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
async function fixture(t){
 const base=await privateTemp(t),source=path.join(base,'upstream'),repo=path.join(base,'consumer');await fs.mkdir(source);await fs.mkdir(repo);
 for(const relative of AGENT_LAB_SOURCE_FILES){const target=path.join(source,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(BUNDLE,relative),target);}
 await runGit(['init','-q'],source);await runGit(['add','--','.'],source);await runGit(['-c','user.name=bundle-test','-c','user.email=bundle-test@invalid','commit','-qm','test source snapshot'],source);
 const pin=String(await runGit(['rev-parse','HEAD'],source)).trim();await fs.writeFile(path.join(repo,'components.json'),JSON.stringify({agent_lab:pin}));await fs.copyFile(path.join(ROOT,'LICENSE'),path.join(repo,'LICENSE'));
 return {base,source,repo,pin,destination:path.join(repo,'vendor/agent-lab')};
}

test('checked-in Lab runtime subset is complete, pinned and carries original scope notices',async()=>{
 const bytes=await fs.readFile(path.join(BUNDLE,'manifest.json')),m=JSON.parse(bytes),bundle=await readDependencyBundle({repoRoot:ROOT,id:'agent-lab',manifestSha256:sha256(bytes),required:true});
 const pins=JSON.parse(await fs.readFile(path.join(ROOT,'components.json'),'utf8'));
 assert.equal(m.sources.commit,pins.agent_lab);assert.equal(m.rights.status,'owner-authorized');assert.equal(m.rights.license_spdx,'Apache-2.0');assert.equal(m.sources.files.length,28);assert.equal(m.files.length,30);
 assert.deepEqual(m.sources.files.map(x=>x.path).sort(),[...AGENT_LAB_SOURCE_FILES].sort());
 for(const row of m.sources.files){assert.equal(sha256(await fs.readFile(bundle.file(row.path))),row.sha256);assert.ok(!row.path.split('/').some(x=>['.git','.local','.env','node_modules','credentials','secrets'].includes(x)));}
 assert.ok((await fs.readFile(bundle.file('NOTICE'),'utf8')).includes('explicit 31 October 2026'));
 assert.ok((await fs.readFile(bundle.file('host-adapters/NOTICE'),'utf8')).includes('configuration helpers and instructions only'));
 assert.ok((await fs.readFile(bundle.file('host-adapters/PROVENANCE.json'),'utf8')).includes('source_repository'));
 assert.equal(await fs.access(path.join(BUNDLE,'.git')).then(()=>true,()=>false),false);
});

test('every static and literal dynamic relative import remains inside the declared runtime closure',async()=>{
 const m=JSON.parse(await fs.readFile(path.join(BUNDLE,'manifest.json'),'utf8')),declared=new Set(m.files.map(x=>x.path)),links=new Set();
 for(const row of m.sources.files.filter(x=>/\.(mjs|ts)$/.test(x.path))){
  const source=await fs.readFile(path.join(BUNDLE,row.path),'utf8');
  const imports=[...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map(x=>x[1]);
  for(const specifier of imports){
   if(specifier.startsWith('node:'))continue;
   assert.ok(specifier.startsWith('.'),row.path+': unexpected package '+specifier);
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(row.path),specifier));assert.ok(!target.startsWith('../'));assert.ok(declared.has(target),row.path+' -> '+target);links.add(row.path+' -> '+target);
  }
 }
 for(const edge of ['core/telemetry.mjs -> core/muse-telemetry.mjs','core/muse-msp.mjs -> agents/muse-interactive.mjs','interactive-public/pulse.mjs -> interactive-public/presence-print.mjs'])assert.ok(links.has(edge),edge);
 for(const required of ['agents/collaboration-policy.json','repo-task.txt','host-adapters/muse_boundary.py','agents/claude-presence-hook.py','core/native-session-index.py','interactive-public/pulse.css'])assert.ok(declared.has(required));
});

test('Lab and Pulse module loading needs no third-party packages and dispatches no side effects',async()=>{
 const modules=AGENT_LAB_SOURCE_FILES.filter(x=>/\.(mjs|ts)$/.test(x));
 const program=`import cp from 'node:child_process';import fs from 'node:fs';import fsp from 'node:fs/promises';import http from 'node:http';import https from 'node:https';import net from 'node:net';import {syncBuiltinESMExports} from 'node:module';import {pathToFileURL} from 'node:url';import path from 'node:path';
const forbidden=()=>{throw Error('unexpected_import_side_effect');};for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=forbidden;for(const k of ['writeFileSync','appendFileSync','mkdirSync','rmSync','unlinkSync','renameSync','chmodSync'])fs[k]=forbidden;for(const k of ['writeFile','appendFile','mkdir','rm','unlink','rename','chmod'])fsp[k]=forbidden;http.request=http.get=https.request=https.get=forbidden;net.Socket.prototype.connect=net.Server.prototype.listen=forbidden;globalThis.fetch=forbidden;syncBuiltinESMExports();
for(const file of ${JSON.stringify(modules)})await import(pathToFileURL(path.join(${JSON.stringify(BUNDLE)},file)).href);console.log('imports-safe');`;
 const result=await execute(process.execPath,['--experimental-strip-types','--input-type=module','-e',program],{env:{...process.env,PATH:''},timeout:10000,maxBuffer:65536});assert.equal(result.stdout.trim(),'imports-safe');
});

test('import reads only committed selected files and produces deterministic path-independent bytes',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.source,'.git/PRIVATE-HISTORY-SENTINEL'),'not copied');
 const a=await importAgentLab({repoRoot:f.repo,sourceRoot:f.source,environment:{...process.env,GIT_DIR:'/not-a-repository',GIT_WORK_TREE:'/also-not-a-repository'}});
 assert.equal(a.status,'imported');assert.equal(a.commit,f.pin);const raw=await fs.readFile(path.join(f.destination,'manifest.json'));
 assert.equal(sha256(raw),a.manifest_sha256);assert.ok(!raw.includes(Buffer.from(f.source)));assert.ok(!raw.includes(Buffer.from(f.repo)));
 await readDependencyBundle({repoRoot:f.repo,id:'agent-lab',manifestSha256:a.manifest_sha256,required:true});
 for(const rel of AGENT_LAB_SOURCE_FILES)assert.deepEqual(await fs.readFile(path.join(f.destination,rel)),await fs.readFile(path.join(f.source,rel)));
 const b=await importAgentLab({repoRoot:f.repo,sourceRoot:f.source});assert.equal(b.status,'already_present');assert.equal(b.manifest_sha256,a.manifest_sha256);
 assert.equal(await fs.access(path.join(f.destination,'.git')).then(()=>true,()=>false),false);assert.equal(await fs.access(path.join(f.destination,'PRIVATE-HISTORY-SENTINEL')).then(()=>true,()=>false),false);
});

test('dirty and wrong-pin source refuses before any destination is created',async t=>{
 const f=await fixture(t);await fs.appendFile(path.join(f.source,'core/muse-msp.mjs'),'\n// uncommitted corruption\n');
 await assert.rejects(importAgentLab({repoRoot:f.repo,sourceRoot:f.source}),/agent_lab_source_changed/);
 assert.equal(await fs.access(f.destination).then(()=>true,()=>false),false);
 await assert.rejects(importAgentLab({repoRoot:f.repo,sourceRoot:f.source,commit:'0'.repeat(40)}),/agent_lab_pin_mismatch/);
 assert.equal(await fs.access(f.destination).then(()=>true,()=>false),false);
});

test('a committed symlink cannot be imported as trusted code',async t=>{
 const f=await fixture(t),file=path.join(f.source,'core/muse-msp.mjs');await fs.unlink(file);await fs.symlink('../config.mjs',file);await runGit(['add','--','.'],f.source);await runGit(['-c','user.name=bundle-test','-c','user.email=bundle-test@invalid','commit','-qm','unsafe test source'],f.source);
 const pin=String(await runGit(['rev-parse','HEAD'],f.source)).trim();await fs.writeFile(path.join(f.repo,'components.json'),JSON.stringify({agent_lab:pin}));
 await assert.rejects(importAgentLab({repoRoot:f.repo,sourceRoot:f.source}),/agent_lab_source_unsafe/);assert.equal(await fs.access(f.destination).then(()=>true,()=>false),false);
});

test('changed destination is preserved and fails the external manifest integrity gate',async t=>{
 const f=await fixture(t),result=await importAgentLab({repoRoot:f.repo,sourceRoot:f.source}),file=path.join(f.destination,'core/muse-msp.mjs');await fs.appendFile(file,'\n// changed snapshot\n');
 await assert.rejects(readDependencyBundle({repoRoot:f.repo,id:'agent-lab',manifestSha256:result.manifest_sha256,required:true}),/dependency_file_mismatch/);
 await assert.rejects(importAgentLab({repoRoot:f.repo,sourceRoot:f.source}),/agent_lab_destination_changed/);assert.match(await fs.readFile(file,'utf8'),/changed snapshot/);
});
