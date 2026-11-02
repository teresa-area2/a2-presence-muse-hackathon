// Standalone native hook: no OP API, credentials, model calls or raw input logs.
import fs from 'node:fs';import net from 'node:net';import path from 'node:path';
const PREFIX='Automatic Presence refresh immediately before this model generation, including final-answer generation. The highest Presence sequence for this turn supersedes earlier Presence context, regardless of block order. Correctness, requested substance, explicit user intent and required approvals take precedence. Do not claim tests or execution without evidence.\n';
const FALLBACK=PREFIX+'Presence unavailable or ineligible: textbox guidance unavailable. Use ordinary behavior; do not reuse earlier guidance.';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x),token=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const own=s=>!(s.mode&0o077)&&(!process.getuid||s.uid===process.getuid());
function identity(x){const r={};for(const k of ['session_id','turn_id','run_id'])if(uuid(x[k]))r[k]=x[k];for(const [k,v]of [['request_id',x.request_id??x.requestId],['response_id',x.response_id??x.responseId??x.model_response_id]])if(token(v))r[k]=v;for(const k of ['attempt','step'])if(Number.isSafeInteger(x[k])&&x[k]>=0)r[k]=x[k];return r;}
function outcome(x){const values=[x.status,x.success].filter(v=>v!==undefined).map(v=>v===true||['successful','success','ok'].includes(v)?'successful':v===false||['failed','failure','error'].includes(v)?'failed':'unknown');return values.includes('successful')&&values.includes('failed')?'conflicting':values.includes('failed')?'failed':!values.length||values.includes('unknown')?'unknown':'successful';}
let done=false,body='',event=process.argv.includes('PreLLMCall')?'PreLLMCall':'PostLLMCall';
function output(context=FALLBACK){if(done)return;done=true;process.stdout.write(JSON.stringify(event==='PreLLMCall'?{hookSpecificOutput:{hookEventName:'PreLLMCall',additionalContext:context}}:{})+'\n');}
const deadline=setTimeout(()=>{output();process.stdin.destroy();},1500);deadline.unref();
process.stdin.setEncoding('utf8');process.stdin.on('error',()=>output());process.stdin.on('data',part=>{body+=part;if(Buffer.byteLength(body)>1024*1024){body='';output();process.stdin.destroy();}});
process.stdin.on('end',async()=>{try{
 const args={};if(process.argv.length!==8)throw Error('invalid');for(let i=2;i<8;i+=2){const key=process.argv[i];if(!['--workspace','--socket','--event'].includes(key)||Object.hasOwn(args,key))throw Error('invalid');args[key]=process.argv[i+1];}event=args['--event'];if(!['PreLLMCall','PostLLMCall'].includes(event)||!path.isAbsolute(args['--workspace'])||!path.isAbsolute(args['--socket']))throw Error('invalid');
 const incoming=JSON.parse(body);body='';if(!incoming||incoming.hook_event_name!==event||!path.isAbsolute(incoming.cwd??'')||fs.realpathSync(incoming.cwd)!==args['--workspace'])throw Error('invalid');
 if(event==='PreLLMCall'&&(!uuid(incoming.session_id)||!uuid(incoming.turn_id)))throw Error('invalid');
 const dir=fs.lstatSync(path.dirname(args['--socket'])),sock=fs.lstatSync(args['--socket']);if(!dir.isDirectory()||dir.isSymbolicLink()||!own(dir)||!sock.isSocket()||!own(sock))throw Error('invalid');
 const response=await new Promise((resolve,reject)=>{const c=net.createConnection(args['--socket']);let text='';c.setTimeout(750,()=>{c.destroy();reject(Error('timeout'));});c.on('error',reject);c.on('connect',()=>c.write(JSON.stringify({op:event==='PreLLMCall'?'read':'observe',workspace:args['--workspace'],ids:identity(incoming),...(event==='PostLLMCall'?{provider_status:outcome(incoming)}:{})})+'\n'));c.on('data',part=>{text+=part.toString('utf8');if(Buffer.byteLength(text)>65536){c.destroy();reject(Error('oversize'));return;}const at=text.indexOf('\n');if(at>=0){c.destroy();try{resolve(JSON.parse(text.slice(0,at)));}catch{reject(Error('invalid'));}}});c.on('end',()=>reject(Error('closed')));});
 if(event==='PreLLMCall'&&uuid(response?.read_id)){
  if(!Number.isSafeInteger(response.read_sequence)||response.read_sequence<1)throw Error('invalid');
  const prefix=PREFIX+'Presence turn: '+incoming.turn_id+'\nPresence sequence: '+response.read_sequence+'\nPresence read: '+response.read_id+'\n';
  if([2,3].includes(response.collaboration_version)){
   const version=response.collaboration_version;
   const eligible=response.status==='selected'&&typeof response.guidance==='string'&&response.guidance.trim()&&response.guidance.length<=12000;
   let presentation=null;
   if(eligible)try{
    const {createHash}=await import('node:crypto'),file=new URL('./muse-presentation-guidance.mjs',import.meta.url),bytes=fs.readFileSync(file);
    if(typeof response.presentation_helper_sha256==='string'&&createHash('sha256').update(bytes).digest('hex')===response.presentation_helper_sha256){
     const m=await import('./muse-presentation-guidance.mjs'),candidate=m.compileMusePresentation(response.controls);
     if(m.MUSE_PRESENTATION_VERSION===version&&m.MUSE_PRESENTATION_MAX_BYTES===384&&candidate?.version===version&&typeof candidate.text==='string'&&candidate.text.startsWith('Muse collaboration v'+version+':\n')&&candidate.utf8_bytes===Buffer.byteLength(candidate.text)&&candidate.utf8_bytes+1<=384)presentation=candidate;
    }
   }catch{/* Eligible OP survives unavailable presentation hints. */}
   if(eligible)output(prefix+(presentation?presentation.text+'\n':'Presentation hints unavailable: withdraw earlier Muse presentation hints; use native judgment with current server guidance.\n')+'Server guidance (verbatim):\n'+response.guidance);
   else output(prefix+'Earlier Muse presentation hints are withdrawn.\nPresence unavailable or ineligible: textbox guidance unavailable. Use ordinary behavior; do not reuse earlier guidance.');
  }else{
  let contract=null;try{if(response.status==='selected'&&response.collaboration_version===1){const m=await import('./muse-collaboration-contract.mjs');const c=m.compileMuseCollaboration(response.controls);if(c&&c.utf8_bytes+1<=m.MUSE_COLLABORATION_MAX_BYTES)contract=c;}}catch{/* A missing/corrupt companion must replace old context with fallback. */}
  if(response.status==='selected'&&!Object.hasOwn(response,'collaboration_version')&&typeof response.guidance==='string'&&response.guidance.trim()&&response.guidance.length<=12000)output(prefix+'Server guidance (verbatim):\n'+response.guidance);
  else if(contract&&typeof response.guidance==='string'&&response.guidance.trim()&&response.guidance.length<=12000)output(prefix+contract.text+'\nServer guidance (verbatim):\n'+response.guidance);
  else output(prefix+'Presence unavailable or ineligible: textbox guidance unavailable. Use ordinary behavior; do not reuse earlier guidance.');
  }
 }else output();
 }catch{output();}finally{clearTimeout(deadline);}});
