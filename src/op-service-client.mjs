// Authenticated backend-only OP transport. Construction performs no I/O.
// The authoritative optional Capsule client supplies strict schema/renderer validation.
import fs from 'node:fs/promises';import path from 'node:path';
import {minimizeDesktopCipher}from'./cipher-capture.mjs';
import {projectOpDiagnostics}from'./op-diagnostics.mjs';
const origins={dev:'https://api-dev.area2-ai.com',production:'https://api.area2-ai.com'};

// Optional consumer deadline; ordinary credentials without this field keep their
// existing lifecycle. Only canonical UTC instants are accepted, never date repair.
function clientCutoff(value){
 if(value===undefined)return null;
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('op_client_cutoff_invalid');
 const iso=new Date(value).toISOString();if(value!==iso&&value!==iso.replace('.000Z','Z'))throw Error('op_client_cutoff_invalid');return Date.parse(value);
}
async function boundedJson(response){
 if(!response.body)throw Error('op_response_invalid');const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;if((size+=r.value.byteLength)>65536)throw Error('op_response_invalid');text+=decoder.decode(r.value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{await reader.cancel().catch(()=>{});}
}
export async function loadPrivateOpConfig(file,{repoRoot}={}){
 if(!path.isAbsolute(file)||!path.isAbsolute(repoRoot))throw Error('op_config_location_invalid');
 const inside=(f,r)=>f===r||f.startsWith(r+path.sep);file=path.resolve(file);repoRoot=path.resolve(repoRoot);if(inside(file,repoRoot))throw Error('op_config_location_invalid');
 const [realFile,realRepo]=await Promise.all([fs.realpath(file),fs.realpath(repoRoot)]);if(inside(realFile,realRepo))throw Error('op_config_location_invalid');
 const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.mode&0o077||st.size>8192||(process.getuid&&st.uid!==process.getuid()))throw Error('op_config_permissions_invalid');
 const h=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const current=await h.stat();if(current.ino!==st.ino||current.dev!==st.dev||!current.isFile()||current.mode&0o077||current.size>8192||(process.getuid&&current.uid!==process.getuid()))throw Error('op_config_changed');const bytes=Buffer.alloc(8193),read=await h.read(bytes,0,8193,0);if(read.bytesRead>8192)throw Error('op_config_invalid');const c=JSON.parse(bytes.subarray(0,read.bytesRead).toString('utf8'));if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['environment','client_id','client_secret','client_cutoff_at'].includes(k))||!origins[c.environment]||typeof c.client_id!=='string'||!c.client_id||typeof c.client_secret!=='string'||!c.client_secret||/[\r\n:]/.test(c.client_id)||/[\r\n]/.test(c.client_secret))throw Error('op_config_invalid');clientCutoff(c.client_cutoff_at);return c;}catch{throw Error('op_config_invalid');}finally{await h.close();}
}
export function createOpenPresenceClient({environment,client_id,client_secret,client_cutoff_at,resolveCodingInstructions,fetcher=fetch,now=Date.now}){
 if(!origins[environment]||typeof client_id!=='string'||!client_id||/[\r\n:]/.test(client_id)||typeof client_secret!=='string'||!client_secret||/[\r\n]/.test(client_secret)||typeof resolveCodingInstructions!=='function')throw Error('op_client_invalid');
 let cutoff;try{cutoff=clientCutoff(client_cutoff_at);}catch{throw Error('op_client_invalid');}
 let token='',refreshAt=0,renewing=null,blocked=false,expired=false;
 const diagnostics={environment,auth_requests:0,capture_requests:0,last_stage:null,last_http_status:null,auth_elapsed_ms:null,capture_elapsed_ms:null,validation:null,error:null};
 function accessStatus(){
  if(!expired&&cutoff!==null){let at;try{at=now();}catch{}if(!Number.isFinite(at)||at>=cutoff)expired=true;}
  if(expired){blocked=true;token='';refreshAt=0;diagnostics.validation=null;return 'expired';}
  return blocked?'rejected':'active';
 }
 const requireAccess=()=>{if(accessStatus()!=='active')throw Error('op_access_rejected');};
 const auth=async signal=>{
  requireAccess();if(token&&now()<refreshAt)return token;
  if(!renewing)renewing=(async()=>{
   const start=now(),elapsedStart=performance.now();diagnostics.auth_requests++;diagnostics.last_stage='auth';diagnostics.last_http_status=null;diagnostics.auth_elapsed_ms=null;
   requireAccess();const response=await fetcher('https://auth.area2-ai.com/token',{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),headers:{'content-type':'application/json',accept:'application/json',authorization:'Basic '+Buffer.from(client_id+':'+client_secret).toString('base64')},body:'{}'});
   diagnostics.auth_elapsed_ms=performance.now()-elapsedStart;diagnostics.last_http_status=response.status;
   if(accessStatus()!=='active'){await response.body?.cancel().catch(()=>{});throw Error('op_access_rejected');}
   if([401,403].includes(response.status)){diagnostics.error='op_auth_rejected';blocked=true;await response.body?.cancel().catch(()=>{});throw Error('op_access_rejected');}
   const x=await boundedJson(response);requireAccess();diagnostics.auth_elapsed_ms=performance.now()-elapsedStart;
   if(!response.ok||typeof x.access_token!=='string'||!x.access_token||/\s/.test(x.access_token)||!Number.isFinite(x.expires_in)||x.expires_in<=0||x.expires_in>3600)throw Error('op_auth_unavailable');
   refreshAt=start+x.expires_in*1000-Math.min(30000,x.expires_in*500);if(now()>=refreshAt)throw Error('op_auth_unavailable');token=x.access_token;return token;
  })().finally(()=>{renewing=null;});return renewing;
 };
 return {dispatch_reporting:true,accessStatus,async capture(value,{signal=new AbortController().signal,onDispatch=()=>{},onAttempt=()=>{}}={}){
  if(accessStatus()!=='active')return{status:'access_rejected'};
  const payload=minimizeDesktopCipher(value);diagnostics.error=null;diagnostics.validation=null;
  let started=false,httpStatus=null,retryAfter=null;
  try{
   const bearer=await auth(signal);requireAccess();signal.throwIfAborted();
   const request={method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),headers:{'content-type':'application/json',accept:'application/json',authorization:'Bearer '+bearer},body:JSON.stringify({actions:['a2_open'],open_presence_schema:'open_presence.controls.v0.4',open_presence_instructions_version:'coding-instructions.3',user_mode:'internal',payload:{...payload,signal_type:'keystroke-mech'}})};
   onDispatch();requireAccess();signal.throwIfAborted();const elapsedStart=performance.now();diagnostics.capture_requests++;diagnostics.last_stage='capture';diagnostics.last_http_status=null;diagnostics.capture_elapsed_ms=null;started=true;
   const response=await fetcher(origins[environment]+'/v2/capture',request);httpStatus=response.status;diagnostics.capture_elapsed_ms=performance.now()-elapsedStart;diagnostics.last_http_status=response.status;
   if(accessStatus()!=='active'){await response.body?.cancel().catch(()=>{});return{status:'access_rejected'};}
   if([401,403].includes(response.status)){diagnostics.error='op_capture_rejected';blocked=true;token='';refreshAt=0;await response.body?.cancel().catch(()=>{});return{status:'access_rejected'};}
   if(response.status===429){diagnostics.error='op_backoff';const h=response.headers.get('retry-after');const delay=h&&/^\d+$/.test(h)?Number(h)*1000:h?Date.parse(h)-now():30000;retryAfter=Number.isFinite(delay)?Math.max(30000,delay):30000;await response.body?.cancel().catch(()=>{});requireAccess();return{status:'backoff',retry_after_ms:retryAfter};}
   if(response.status!==200){diagnostics.error='op_capture_unavailable';await response.body?.cancel().catch(()=>{});requireAccess();return{status:'unavailable'};}
   const x=await boundedJson(response);requireAccess();diagnostics.capture_elapsed_ms=performance.now()-elapsedStart;if(x?.status!=='success'){diagnostics.error='op_capture_unavailable';return{status:'unavailable'};}
   const resolved=resolveCodingInstructions(x.results?.a2_open,now());requireAccess();diagnostics.validation=resolved.status;if(resolved.status!=='usable'||resolved.capsule?.instructions?.version!=='coding-instructions.3'){diagnostics.error='op_response_invalid';return{status:'invalid'};}
   const c=resolved.capsule,receivedAt=new Date(now()).toISOString();requireAccess();return{status:'usable',guidance:c.instructions.llm.preamble,controls:{...c.controls},generated_at:c.generated_at,received_at:receivedAt,renderer:c.instructions.version};
  }catch(e){if(!diagnostics.error){const code=e?.cause?.code??e?.code;diagnostics.error=['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','CERT_HAS_EXPIRED'].includes(code)?'op_tls_unavailable':signal.aborted?'op_aborted':e?.message==='op_auth_unavailable'?'op_auth_unavailable':expired?null:'op_transport_unavailable';}token='';refreshAt=0;return{status:blocked||e?.message==='op_access_rejected'?'access_rejected':'unavailable'};}finally{if(started)try{onAttempt({http_status:httpStatus,retry_after_ms:retryAfter});}catch{}}
 },diagnostics(){return projectOpDiagnostics(diagnostics);},clear(){token='';refreshAt=0;}};
}
