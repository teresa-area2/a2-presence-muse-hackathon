import {labConfig} from './config.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const execute=promisify(execFile);
export const probeCommand=labConfig.probe;
export const statePath=labConfig.state;
export function assessProbe(p:any,now=Date.now()){
 let reason:string|null=null;const receipt=typeof p?.received_at==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(p.received_at)?Date.parse(p.received_at):NaN;
 const age=(now-receipt)/1000,c=p?.controls;
 if(p?.environment!=='production'||p?.mode!=='live')reason='not_production_live';
 else if(p?.renderer!=='coding-instructions.3')reason='unsupported_renderer';
 else if(p?.profile!=='coding'||p?.eligible!==true||p?.retained!==false||p?.conformance_only!==false||p?.consumer?.adaptation_eligible!==true||p?.consumer?.fallback_reason!=null)reason=p?.consumer?.fallback_reason??'source_ineligible';
 else if(!Number.isFinite(age)||age<0)reason='stale_or_invalid_receipt';
 else if(!c||!['terse','standard','full'].includes(c.response_extent)||!['send','defer'].includes(c.unsolicited_update)||!['self_contained','conversational'].includes(c.conversation_style))reason='invalid_controls';
 else if(typeof p?.guidance!=='string'||!p.guidance.trim())reason='guidance_missing';
 return {eligible:reason===null,controls:reason?null:c,read_at:p?.consumer?.read_at??new Date(now).toISOString(),received_at:p?.received_at??null,age_seconds:Number.isFinite(age)?Math.round(age*1000)/1000:null,renderer:p?.renderer??null,fallback_reason:reason,age_policy:'no_consumer_age_limit',source:'existing_local_mcp',guidance_sha256:reason?null:createHash('sha256').update(p.guidance).digest('hex')};
}
export class PresenceReader{
 cached:any=null;private checkedAt=0;private pending:Promise<any>|null=null;
 async read(force=false){
  if(this.pending)return this.pending;
  if(!force&&this.cached&&Date.now()-this.checkedAt<5000)return this.view();
  this.pending=(async()=>{try{
   if(labConfig.baselineOnly||!probeCommand||!statePath)throw Error('presence_not_configured');
   const {stdout}=await execute(probeCommand,['--state',statePath,'probe'],{timeout:8000,maxBuffer:150000,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8'}});
   const line=stdout.split('\n').find(x=>x.startsWith('{')&&x.includes('"transport"'));
   if(!line)throw Error('probe_output_unavailable');
   const p=JSON.parse(line).result;this.cached={raw:p,guidance:p?.guidance};
  }catch{this.cached={raw:null,guidance:''};}
  this.checkedAt=Date.now();return this.view();})().finally(()=>{this.pending=null});
  return this.pending;
 }
 view(){return {...assessProbe(this.cached?.raw),guidance:assessProbe(this.cached?.raw).eligible?this.cached.guidance:''};}
 public(){const {guidance,...meta}=this.view();return meta;}
}
