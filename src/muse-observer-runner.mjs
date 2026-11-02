// A separate, tool-free Muse Code session. Only a locally built fact catalogue
// reaches the facts observer. The opt-in comparison protocol sends a previewed
// bounded public-exchange/work packet and returns validated, inert report data.
import fs from'node:fs/promises';import path from'node:path';import{spawn}from'node:child_process';import{StringDecoder}from'node:string_decoder';
import{createIsolatedMuseConfigs,removeIsolatedMuseConfigs}from'./isolated-muse-config.mjs';
import{observerPrompt,observerSelectionSchema,validateObserverSelection}from'./presence-observer.mjs';
import{comparisonPrompt,comparisonSchema,validateStructuredComparisonReport}from'./observer-report.mjs';
const count=x=>Number.isSafeInteger(x)&&x>=0;
export async function assertInstructionFreeDirectory(directory){
 let parent=await fs.realpath(directory);
 for(;;){for(const file of ['AGENTS.md','CLAUDE.md','MUSE.md','.git'])if(await fs.lstat(path.join(parent,file)).catch(()=>null))throw Error('observer_workspace_has_instructions');const next=path.dirname(parent);if(next===parent)break;parent=next;}
}
export class MuseObserverEvents{
 constructor({maxFinalChars=8192}={}){this.maxFinalChars=maxFinalChars;this.decoder=new StringDecoder('utf8');this.buffer='';this.selection=null;this.completed=false;this.invalid=false;this.bytes=0;this.diagnostics={terminal:null,http_status:null,schema_error:false,step_limit:false};this.usage={scope:'presence_observer',status:'not_reported',model_calls:null,input_tokens:null,output_tokens:null,cache_read_tokens:null,cost_usd:null};}
 diagnostic(text){if(typeof text!=='string')return;const status=/(?:status|HTTP)[^\d\n]{0,12}([45]\d\d)\b/i.exec(text);if(status)this.diagnostics.http_status=Number(status[1]);if(/uniqueItems|unsupported.{0,40}schema|invalid.{0,40}schema/i.test(text))this.diagnostics.schema_error=true;if(/max.model.steps|step.{0,8}(?:limit|budget)/i.test(text))this.diagnostics.step_limit=true;}
 feed(chunk){
  if(this.invalid)return;this.bytes+=chunk.length;if(this.bytes>2*1024*1024){this.invalid=true;return;}
  this.buffer+=this.decoder.write(chunk);if(this.buffer.length>262144){this.invalid=true;return;}let at;
  while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(!line.trim())continue;let record;try{record=JSON.parse(line);}catch{this.invalid=true;return;}
   const p=record?.payload,type=record?.payload_type;
   if(typeof type!=='string'||!p||typeof p!=='object'){this.invalid=true;return;}
   if(/(?:subagent|child|approval|tool)[._]/i.test(type)){this.invalid=true;return;}
   if(/error|failed/.test(type)||p.event?.kind==='failed')this.diagnostic(JSON.stringify(p));
   if(type.startsWith('run.terminal.')){if(['completed','failed','cancelled'].includes(p.terminal))this.diagnostics.terminal=p.terminal;if(p.terminal!=='completed')this.diagnostic(typeof p.reason==='string'?p.reason:JSON.stringify(p.reason));}
   if(type==='run.usage'){
    const models=p.models;
    if(!count(p.calls)||!Array.isArray(models)||models.length>8||models.some(m=>!m||typeof m!=='object'||Array.isArray(m)||['input_tokens','output_tokens','cached_tokens'].some(k=>m[k]!=null&&!count(m[k])))){this.invalid=true;this.usage={scope:'presence_observer',status:'invalid',model_calls:null,input_tokens:null,output_tokens:null,cache_read_tokens:null,cost_usd:null};return;}
    const sum=key=>models.length&&models.every(m=>count(m[key]))?models.reduce((n,m)=>n+m[key],0):null;
    const values={model_calls:p.calls,input_tokens:sum('input_tokens'),output_tokens:sum('output_tokens'),cache_read_tokens:sum('cached_tokens')};
    if(Object.values(values).some(x=>x!==null&&!count(x))){this.usage={...this.usage,status:'invalid'};continue;}
    this.usage={...this.usage,...values,status:'observed'};
   }
   if(type==='run.terminal.completed'){
    if(this.completed||p.terminal!=='completed'||typeof p.text!=='string'||p.text.length>this.maxFinalChars){this.invalid=true;return;}
    try{this.selection=JSON.parse(p.text);}catch{this.invalid=true;return;}this.completed=true;
   }
  }
 }
 finish(){this.buffer+=this.decoder.end();if(this.buffer.trim())this.invalid=true;this.buffer='';}
}
export function createMuseObserverRunner({binary,directory,environment=process.env,timeoutMs=120000,protocol='facts',spawnProcess=spawn,checkWorkspace=assertInstructionFreeDirectory,killProcess=(child,signal)=>{if(child.pid)try{process.kill(-child.pid,signal);}catch{}}}={}){
 if(!['facts','comparison'].includes(protocol)||!path.isAbsolute(binary??'')||!path.isAbsolute(directory??'')||!count(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error('observer_runner_invalid');
 return async(evidence,{signal}={})=>{
  if(signal?.aborted)throw Error('observer_cancelled');
  const comparison=protocol==='comparison',profile={profile:'concise',grounding:'snapshot_context'},prompt=comparison?comparisonPrompt(evidence,profile):observerPrompt(evidence),schema=comparison?comparisonSchema(evidence,profile):observerSelectionSchema(evidence);if(!comparison&&!schema.properties.fact_ids.items.enum.length)throw Error('observer_catalogue_invalid');
  await fs.mkdir(directory,{recursive:true,mode:0o700});const owner=await fs.lstat(directory);if(!owner.isDirectory()||owner.isSymbolicLink()||(owner.mode&0o077))throw Error('observer_directory_unsafe');
  const session=await fs.mkdtemp(path.join(directory,'observer-'));await fs.chmod(session,0o700);let configs,child,timer,killTimer,abortHandler;
  const events=new MuseObserverEvents({maxFinalChars:protocol==='comparison'?24000:8192}),start=performance.now();let cancelled=false,timedOut=false;
  try{
   await checkWorkspace(session);
   configs=await createIsolatedMuseConfigs({sessionDir:session,environment:{HOME:environment.HOME,PATH:environment.PATH,TMPDIR:environment.TMPDIR,MUSE_NO_AUTO_UPDATE:'1',...(environment.XDG_CONFIG_HOME?{XDG_CONFIG_HOME:environment.XDG_CONFIG_HOME}:{})},nativeProfile:true});
   // Uniqueness is enforced locally. The provider's supported schema subset
   // need not support JSON Schema's uniqueItems assertion.
   const providerSchema=structuredClone(schema);if(!comparison)delete providerSchema.properties.fact_ids.uniqueItems;
   await fs.writeFile(path.join(session,'prompt.txt'),prompt,{mode:0o600});await fs.writeFile(path.join(session,'schema.json'),JSON.stringify(providerSchema),{mode:0o600});
   if(signal?.aborted)throw Error('observer_cancelled');
   const args=['exec','--json','--provider','meta','--model','muse-spark-1.3','--preset','empty','--contributor-mode','off','--reasoning-effort','medium','--max-model-steps','1','--output-schema',path.join(session,'schema.json'),'--prompt-file',path.join(session,'prompt.txt'),'--no-session-log','--no-foreign-personal-context','--disable-reminders','--disable-web-tools','--disable-request-user-input','--disable-shell','--disable-write','--approval-mode','on-request'];
   args.push('-c','provider_retry.max_retries=0');
   child=spawnProcess(binary,args,{cwd:session,env:configs.without,stdio:['ignore','pipe','pipe'],detached:true});
   const terminate=()=>{killProcess(child,'SIGTERM');if(!killTimer)killTimer=setTimeout(()=>killProcess(child,'SIGKILL'),500);};
   abortHandler=()=>{cancelled=true;terminate();};signal?.addEventListener('abort',abortHandler,{once:true});
   if(signal?.aborted)abortHandler();
   timer=setTimeout(()=>{timedOut=true;terminate();},timeoutMs);
   child.stdout.on('data',chunk=>{try{events.feed(chunk);}catch{events.invalid=true;}if(events.invalid)terminate();});child.stderr.on('data',chunk=>events.diagnostic(chunk.toString('utf8')));
   const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});events.finish();
   const usage={...events.usage,elapsed_ms:Math.round(performance.now()-start)};
   if(cancelled||timedOut||code!==0||events.invalid||!events.completed){const failure=Error(cancelled?'observer_cancelled':'observer_explanation_unavailable');failure.usage=usage;throw failure;}
   if(usage.model_calls!==null&&usage.model_calls>1)throw Object.assign(Error('observer_explanation_unavailable'),{usage});
   if(comparison)return{report:validateStructuredComparisonReport(events.selection,evidence,profile),usage};
   const result=validateObserverSelection(events.selection,evidence);return{...result,usage};
  }catch(error){const failure=Error(error?.message==='observer_cancelled'?'observer_cancelled':'observer_explanation_unavailable');failure.usage=error.usage??{...events.usage,elapsed_ms:Math.round(performance.now()-start)};failure.diagnostics={...events.diagnostics};throw failure;}
  finally{clearTimeout(timer);clearTimeout(killTimer);if(abortHandler)signal?.removeEventListener('abort',abortHandler);if(configs)await removeIsolatedMuseConfigs(configs);await fs.rm(session,{recursive:true,force:true});}
 };
}
