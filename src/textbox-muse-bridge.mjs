// Native Muse hooks read this in-memory consumer cache, never the OP service.
// Local observations establish a read, not provider delivery or model compliance.
// Compact translation remains opt-in until its semantic/quality qualification passes.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {terminalEnvironment} from './terminal-env.mjs';

const PRE='plugin:area2-presence-boundary:hook:pre-llm',POST='plugin:area2-presence-boundary:hook:post-llm';
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const privateOwned=s=>!(s.mode&0o077)&&(!process.getuid||s.uid===process.getuid());
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const script=fileURLToPath(new URL('../scripts/textbox-muse-hook.mjs',import.meta.url)),contractScript=fileURLToPath(new URL('../scripts/muse-collaboration-contract.mjs',import.meta.url)),presentationScripts={2:fileURLToPath(new URL('../scripts/muse-presentation-guidance.mjs',import.meta.url)),3:fileURLToPath(new URL('../scripts/muse-presentation-guidance-v3.mjs',import.meta.url))};
const controls=x=>x&&['terse','standard','full'].includes(x.response_extent)&&['send','defer'].includes(x.unsolicited_update)&&['self_contained','conversational'].includes(x.conversation_style)?{response_extent:x.response_extent,unsolicited_update:x.unsolicited_update,conversation_style:x.conversation_style}:null;
function ids(x){const out={};for(const k of ['session_id','turn_id','run_id'])if(uuid(x?.[k]))out[k]=x[k];for(const k of ['request_id','response_id'])if(validId(x?.[k]))out[k]=x[k];for(const k of ['attempt','step'])if(Number.isSafeInteger(x?.[k])&&x[k]>=0)out[k]=x[k];return out;}
function capability(x){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['enabled','trusted_definition_hash'].includes(k))||x.enabled!==true||!/^sha256:[a-f0-9]{64}$/.test(x.trusted_definition_hash??''))throw Error('textbox_hook_approval_invalid');return{enabled:true,trusted_definition_hash:x.trusted_definition_hash};}
function privateDir(p){try{fs.mkdirSync(p,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||!privateOwned(s))throw Error('textbox_hook_directory_unsafe');return s;}
function audit(workspace,row){const folder=path.join(workspace,'.presence');privateDir(folder);const fd=fs.openSync(path.join(folder,'hook-events.jsonl'),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);try{const s=fs.fstatSync(fd);if(!s.isFile()||!privateOwned(s)||s.size>1024*1024-8192)throw Error('textbox_hook_audit_unavailable');fs.writeSync(fd,JSON.stringify(row)+'\n');}finally{fs.closeSync(fd);}}

export async function createTextboxMuseBridge({presence,node=process.execPath,environment=process.env,execute=execFileSync,experimentalCollaboration=false,presentationGuidance=false,presentationVersion=2}={}){
 if(typeof experimentalCollaboration!=='boolean'||typeof presentationGuidance!=='boolean'||![2,3].includes(presentationVersion)||!presentationGuidance&&presentationVersion!==2||experimentalCollaboration&&presentationGuidance||typeof presence?.selectForRequest!=='function'||!path.isAbsolute(node)||typeof execute!=='function')throw Error('textbox_bridge_invalid');
 const adapterRevision=presentationGuidance&&presentationVersion===3?'textbox-generation-boundary.6':'textbox-generation-boundary.5';
 const base=await fsp.realpath('/tmp'),directory=await fsp.mkdtemp(path.join(base,'a2-tbm-'));await fsp.chmod(directory,0o700);const owned=await fsp.lstat(directory),socket=path.join(directory,'s');
 if(Buffer.byteLength(socket)>100){await fsp.rmdir(directory);throw Error('textbox_socket_path_too_long');}
 const workspaces=new Map(),presentationHashes=new Map(),sequences=new Map(),clients=new Set();let closed=false,closing;
 const server=net.createServer(client=>{
  if(closed||clients.size>=8){client.destroy();return;}clients.add(client);client.setTimeout(750,()=>client.destroy());let buffer='',handled=false;
  client.on('error',()=>{});client.on('close',()=>clients.delete(client));client.on('data',chunk=>{
   if(handled)return client.destroy();buffer+=chunk.toString('utf8');if(Buffer.byteLength(buffer)>4096)return client.destroy();const cut=buffer.indexOf('\n');if(cut<0)return;handled=true;
   let reply={status:'fallback'};
   try{const q=JSON.parse(buffer.slice(0,cut));buffer='';const entry=workspaces.get(q.workspace);if(!entry||q.workspace!==fs.realpathSync(q.workspace)||!same(entry,fs.lstatSync(q.workspace))||Object.keys(q).some(k=>!['op','workspace','ids','provider_status'].includes(k)))throw Error('textbox_hook_scope_invalid');
    if(q.op==='observe'){const row={adapter_revision:adapterRevision,...(presentationGuidance?{collaboration_version:presentationVersion}:{}),event:'PostLLMCall',observed_at:new Date().toISOString(),...ids(q.ids),provider_status:['successful','failed','conflicting','unknown'].includes(q.provider_status)?q.provider_status:'unknown'};audit(q.workspace,row);reply={status:'observed'};}
    else if(q.op==='read'){
     const selected=presence.selectForRequest(),c=controls(selected?.controls),eligible=selected?.status==='selected'&&typeof selected.guidance==='string'&&selected.guidance.trim()&&selected.guidance.length<=12000&&validId(selected.reading_id)&&typeof selected.age_ms==='number'&&Number.isFinite(selected.age_ms)&&selected.age_ms>=0&&c&&selected.renderer==='coding-instructions.3';
     const readId=randomUUID(),readSequence=(sequences.get(q.workspace)??0)+1;if(!Number.isSafeInteger(readSequence))throw Error('textbox_sequence_exhausted');sequences.set(q.workspace,readSequence);
     const row={adapter_revision:adapterRevision,...(presentationGuidance?{collaboration_version:presentationVersion}:experimentalCollaboration?{collaboration_version:1}:{}),event:'PreLLMCall',read_id:readId,read_sequence:readSequence,read_at:new Date().toISOString(),eligible:!!eligible,fallback_reason:eligible?null:'textbox_guidance_unavailable',controls:eligible?c:null,guidance_sha256:eligible?createHash('sha256').update(selected.guidance).digest('hex'):null,reading_id:eligible?selected.reading_id:null,receipt_age_seconds:eligible?selected.age_ms/1000:null,...ids(q.ids)};
     audit(q.workspace,row);presence.recordSelection?.('hook',selected);reply=eligible?{status:'selected',read_id:readId,read_sequence:readSequence,...(presentationGuidance?{collaboration_version:presentationVersion,adapter_revision:adapterRevision,presentation_helper_sha256:presentationHashes.get(q.workspace)}:experimentalCollaboration?{collaboration_version:1}:{}),guidance:selected.guidance,controls:c,reading_id:selected.reading_id,age_ms:selected.age_ms,renderer:selected.renderer}:{status:'fallback',read_id:readId,read_sequence:readSequence,...(presentationGuidance?{collaboration_version:presentationVersion,adapter_revision:adapterRevision}:{})};
    }
   }catch{reply={status:'fallback'};}
   client.end(JSON.stringify(reply)+'\n');
  });
 });
 try{await new Promise((yes,no)=>{server.once('error',no);server.listen(socket,yes);});await fsp.chmod(socket,0o600);}catch{server.close();await fsp.rm(directory,{recursive:true,force:true});throw Error('textbox_bridge_start_failed');}
 function prepareBoundary({workspace,binary}={}){
  if(closed||!path.isAbsolute(workspace??'')||!path.isAbsolute(binary??''))throw Error('textbox_hook_configuration_invalid');
  workspace=fs.realpathSync(workspace);const stat=fs.lstatSync(workspace);if(!stat.isDirectory()||stat.isSymbolicLink()||(process.getuid&&stat.uid!==process.getuid())||workspaces.has(workspace))throw Error('textbox_hook_workspace_invalid');
  const folder=path.join(workspace,'.presence');privateDir(folder);privateDir(path.join(workspace,'.muse'));const bundle=path.join(workspace,'.muse/presence-boundary-plugin'),config=path.join(folder,'textbox-muse-approval-config');let madeBundle=false,madeConfig=false,presentationHash=null;
  try{fs.mkdirSync(bundle,{mode:0o700});madeBundle=true;fs.mkdirSync(config,{mode:0o700});madeConfig=true;privateDir(path.join(config,'muse'));privateDir(path.join(bundle,'hooks'));privateDir(path.join(bundle,'.muse-plugin'));
   for(const name of ['muse-pre-boundary.mjs','muse-post-boundary.mjs'])fs.copyFileSync(script,path.join(bundle,'hooks',name),fs.constants.COPYFILE_EXCL);
   const contractFile=path.join(bundle,'hooks/muse-collaboration-contract.mjs');fs.copyFileSync(contractScript,contractFile,fs.constants.COPYFILE_EXCL);fs.chmodSync(contractFile,0o600);
   if(presentationGuidance){const file=path.join(bundle,'hooks/muse-presentation-guidance.mjs');fs.copyFileSync(presentationScripts[presentationVersion],file,fs.constants.COPYFILE_EXCL);fs.chmodSync(file,0o600);presentationHash=createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
   const hooks=[['pre-llm','PreLLMCall','muse-pre-boundary.mjs'],['post-llm','PostLLMCall','muse-post-boundary.mjs']].map(([id,event,name])=>({id,event,command:[node,'hooks/'+name,'--workspace',workspace,'--socket',socket,'--event',event],timeoutMs:2000}));
   const manifest={schemaVersion:1,name:'area2-presence-boundary',displayName:'Area2 Presence boundary',version:'0.1.0',description:'Read same-session cached textbox guidance before each generation; observe response metadata.',compat:{source:'native',manifestDir:'.muse-plugin'},capabilities:{skills:[],commands:[],hooks,mcpServers:[],reminders:[]}};
   fs.writeFileSync(path.join(bundle,'.muse-plugin/plugin.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});for(const name of ['muse-pre-boundary.mjs','muse-post-boundary.mjs'])fs.chmodSync(path.join(bundle,'hooks',name),0o600);
   const data=path.join(folder,'muse-native-data');privateDir(data);const native=path.join(data,'muse');try{fs.mkdirSync(native,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const ns=fs.lstatSync(native);if(!ns.isDirectory()||ns.isSymbolicLink()||ns.mode&0o022||(process.getuid&&ns.uid!==process.getuid()))throw Error('textbox_hook_directory_unsafe');
   const env={...terminalEnvironment(environment),XDG_CONFIG_HOME:config,XDG_DATA_HOME:data};
   for(const args of [['plugins','validate',bundle,'--json'],['plugins','install',bundle,'--scope','user','--json'],['plugins','approve','area2-presence-boundary:hook:pre-llm','--json'],['plugins','approve','area2-presence-boundary:hook:post-llm','--json']]){const output=execute(binary,args,{cwd:workspace,env,timeout:30000,maxBuffer:131072,stdio:'pipe'});if(args[1]==='validate'){const x=JSON.parse(output.toString());if(x.valid!==true||(x.diagnostics&&(!Array.isArray(x.diagnostics)||x.diagnostics.length)))throw Error('textbox_hook_validation_failed');}}
   const settings=path.join(config,'muse/settings.json'),ss=fs.lstatSync(settings);if(!ss.isFile()||ss.isSymbolicLink()||ss.mode&0o022||(process.getuid&&ss.uid!==process.getuid())||ss.size>131072||fs.existsSync(path.join(config,'muse/auth.json'))||(()=>{try{return fs.lstatSync(path.join(config,'muse/auth.json')).isSymbolicLink();}catch{return false;}})())throw Error('textbox_hook_approval_invalid');
   const x=JSON.parse(fs.readFileSync(settings,'utf8'));if(!x||Object.keys(x).some(k=>!['schema_version','tui','runtime_capabilities'].includes(k))||!x.runtime_capabilities||Object.keys(x.runtime_capabilities).some(k=>![PRE,POST].includes(k)))throw Error('textbox_hook_approval_invalid');const pre=capability(x.runtime_capabilities[PRE]),post=capability(x.runtime_capabilities[POST]);workspaces.set(workspace,stat);sequences.set(workspace,0);if(presentationGuidance)presentationHashes.set(workspace,presentationHash);return{scope:'isolated_workspace_data_and_approval_config',events:['PreLLMCall','PostLLMCall'],capability_override:pre,post_capability_override:post};
  }catch{if(madeBundle)fs.rmSync(bundle,{recursive:true,force:true});if(madeConfig)fs.rmSync(config,{recursive:true,force:true});throw Error('textbox_hook_setup_failed');}
 }
 return{socket,prepareBoundary,close(){if(closing)return closing;closed=true;workspaces.clear();presentationHashes.clear();sequences.clear();for(const c of clients)c.destroy();closing=(async()=>{await new Promise(resolve=>server.close(resolve));const current=await fsp.lstat(directory).catch(()=>null);if(current&&same(current,owned)&&current.isDirectory()&&!current.isSymbolicLink())await fsp.rm(directory,{recursive:true,force:true});})();return closing;}};
}
