// Import only the Area2-owner-authorized, pinned native/session dependency subset.
// This does not copy Git history, local state, a collector or macOS packaging.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runGit,runGitBuffer} from '../src/git-ops.mjs';
import {sha256} from '../src/dependency-bundle.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const HEX40=/^[0-9a-f]{40}$/;
export const AGENT_LAB_SOURCE_FILES=Object.freeze([
 'config.mjs','presence.ts','agents/collaboration-policy.mjs','agents/muse-interactive.mjs','agents/muse-warm-broker.mjs',
 'core/muse-msp.mjs','core/muse-public-events.mjs','core/muse-harness-factory.mjs','core/muse-session-harness.mjs','core/presence-view.mjs','core/telemetry.mjs','core/codex-telemetry.mjs','core/muse-telemetry.mjs','core/muse-presence-provenance.mjs','core/muse-capability.mjs',
 'agents/collaboration-policy.json','repo-task.txt','core/native-session-index.py','host-adapters/muse_boundary.py','host-adapters/muse_warm_broker.py','host-adapters/muse_budget.py','agents/claude-presence-hook.py',
 'interactive-public/pulse.mjs','interactive-public/presence-print.mjs','interactive-public/pulse.css',
 'host-adapters/LICENSE','host-adapters/NOTICE','host-adapters/PROVENANCE.json'
]);
const fail=reason=>{throw Error(reason);};
const NOTICE=`Area2 Agent Lab selected runtime snapshot
Copyright 2026 Area2

The selected Area2-owned code is included under Apache License, Version 2.0,
by Teresa's explicit 31 October 2026 ownership and redistribution authorization.
See LICENSE. Original file headers and the scoped host-adapters LICENSE, NOTICE
and PROVENANCE.json are preserved without modification.

This is reused foundation code, not newly authored event integration. Agent Lab
was extracted before kickoff on 24 October 2026; its bounded Muse session
foundations were added on 25 October. The selected 28 October snapshot includes
later hook/fallback refinements. The import/layout and integrity checks in the
Muse submission repository are separate event integration work.

Every selected upstream file is imported byte-for-byte at the exact source commit
and its SHA-256 is recorded in manifest.json. Only the declared canonical Muse
native/textbox runtime subset is supplied. Optional sample-harness fixtures and
unreached legacy factory functions are not distributed as a complete Agent Lab
installation. No private Git history, sessions, credentials, collector, inference
service, model weights or macOS packaging is included. Code redistribution does
not grant API admission, model access or trademark rights. Public release and
submission are separately controlled by the project owner.
`;
async function filesIn(root,prefix=''){
 const out=[];
 for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
  const rel=prefix?prefix+'/'+entry.name:entry.name;
  if(entry.isSymbolicLink())fail('agent_lab_destination_changed');
  if(entry.isDirectory())out.push(...await filesIn(root,rel));
  else if(entry.isFile())out.push(rel);else fail('agent_lab_destination_changed');
 }
 return out.sort();
}
async function sameDirectory(left,right){
 const a=await filesIn(left),b=await filesIn(right);if(JSON.stringify(a)!==JSON.stringify(b))return false;
 for(const rel of a)if(sha256(await fs.readFile(path.join(left,rel)))!==sha256(await fs.readFile(path.join(right,rel))))return false;
 return true;
}
export async function importAgentLab({repoRoot=ROOT,sourceRoot,commit,environment=process.env}={}){
 repoRoot=await fs.realpath(repoRoot);
 const pins=JSON.parse(await fs.readFile(path.join(repoRoot,'components.json'),'utf8')),pin=pins.agent_lab;
 if(!HEX40.test(pin??'')||commit!==undefined&&commit!==pin)fail('agent_lab_pin_mismatch');
 if(typeof sourceRoot!=='string'||!path.isAbsolute(sourceRoot)||/[\x00-\x1f\x7f]/.test(sourceRoot))fail('agent_lab_source_invalid');
 sourceRoot=await fs.realpath(sourceRoot);
 const destination=path.join(repoRoot,'vendor/agent-lab');
 if(sourceRoot===destination||sourceRoot.startsWith(destination+path.sep)||destination.startsWith(sourceRoot+path.sep))fail('agent_lab_import_overlap');
 const git=args=>runGit(args,sourceRoot,{env:environment});
 if(String(await git(['rev-parse','HEAD'])).trim()!==pin)fail('agent_lab_pin_mismatch');
 if(String(await git(['status','--porcelain','--untracked-files=all'])).trim())fail('agent_lab_source_changed');
 const tree=String(await git(['ls-tree','-rlz',pin,'--',...AGENT_LAB_SOURCE_FILES])),entries=new Map();
 for(const record of tree.split('\0').filter(Boolean)){
  const match=/^(\d+) (\w+) ([a-f0-9]{40})\s+(\d+|-)\t(.+)$/.exec(record);if(!match||entries.has(match[5]))fail('agent_lab_source_unsafe');
  entries.set(match[5],{mode:match[1],type:match[2],size:Number(match[4])});
 }
 const captured=[];let total=0;
 for(const relative of AGENT_LAB_SOURCE_FILES){
  const entry=entries.get(relative);
  if(!entry||!['100644','100755'].includes(entry.mode)||entry.type!=='blob'||!Number.isSafeInteger(entry.size)||entry.size>512000)fail('agent_lab_source_unsafe');
  total+=entry.size;if(total>2*1024*1024)fail('agent_lab_source_limit');
  const bytes=await runGitBuffer(['show',pin+':'+relative],sourceRoot,{env:environment,maxBuffer:512000});if(bytes.length!==entry.size)fail('agent_lab_source_changed');
  captured.push({path:relative,bytes,sha256:sha256(bytes)});
 }
 const license=await fs.readFile(path.join(repoRoot,'LICENSE'));if(!license.includes(Buffer.from('Apache License')))fail('agent_lab_owner_license_missing');
 const distributed=[...captured,{path:'LICENSE',bytes:license,sha256:sha256(license)},{path:'NOTICE',bytes:Buffer.from(NOTICE),sha256:sha256(Buffer.from(NOTICE))}].sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const manifest={schema_version:1,id:'agent-lab',rights:{status:'owner-authorized',license_spdx:'Apache-2.0',evidence:['LICENSE','NOTICE','host-adapters/LICENSE','host-adapters/NOTICE','host-adapters/PROVENANCE.json']},sources:{commit:pin,repository:'https://gitlab.com/area2.ai/a2-fun/a2-presence-agent-lab',scope:'canonical Muse native/textbox runtime closure',files:captured.map(({path,sha256})=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path,'en'))},runtime_entry:'core/muse-msp.mjs',files:distributed.map(({path,sha256})=>({path,sha256})),inputs:[]};
 const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
 const parent=path.dirname(destination);await fs.mkdir(parent,{recursive:true});const parentInfo=await fs.lstat(parent);if(!parentInfo.isDirectory()||parentInfo.isSymbolicLink())fail('agent_lab_destination_invalid');
 const stage=await fs.mkdtemp(path.join(parent,'.agent-lab-import-'));const stageInfo=await fs.lstat(stage);let installed=false;
 try{
  for(const row of [...distributed,{path:'manifest.json',bytes:manifestBytes}]){const target=path.join(stage,row.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,row.bytes,{flag:'wx',mode:0o644});}
  const prior=await fs.lstat(destination).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(prior){if(!prior.isDirectory()||prior.isSymbolicLink()||!await sameDirectory(stage,destination))fail('agent_lab_destination_changed');}
  else{await fs.rename(stage,destination);installed=true;}
  return {status:installed?'imported':'already_present',commit:pin,source_files:captured.length,distributed_files:distributed.length,manifest_sha256:sha256(manifestBytes)};
 }finally{
  if(!installed){const current=await fs.lstat(stage).catch(()=>null);if(current?.isDirectory()&&!current.isSymbolicLink()&&current.dev===stageInfo.dev&&current.ino===stageInfo.ino)await fs.rm(stage,{recursive:true,force:true});}
 }
}
async function main(){
 const args=process.argv.slice(2);let sourceRoot=process.env.A2_AGENT_LAB_ROOT;
 if(args.length){if(args.length!==2||args[0]!=='--source')fail('agent_lab_import_arguments_invalid');sourceRoot=args[1];}
 if(!sourceRoot){const setup=JSON.parse(await fs.readFile(path.join(ROOT,'setup.json'),'utf8'));sourceRoot=setup.agent_lab_root;}
 console.log(JSON.stringify(await importAgentLab({sourceRoot})));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(/^[a-z_]+$/.test(error?.message)?error.message:'agent_lab_import_failed');process.exitCode=1;});
