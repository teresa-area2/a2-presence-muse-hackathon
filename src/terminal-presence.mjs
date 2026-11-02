// Read-only operational projection. Never stores capsule text or raw typing.
import fs from 'node:fs/promises';import fssync from 'node:fs';import path from 'node:path';import {EventEmitter} from 'node:events';
const timestamps=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const controls=value=>value&&['terse','standard','full'].includes(value.response_extent)&&['send','defer'].includes(value.unsolicited_update)&&['conversational','self_contained'].includes(value.conversation_style)?{response_extent:value.response_extent,unsolicited_update:value.unsolicited_update,conversation_style:value.conversation_style}:null;
export async function readHookEvidence(workspace){
 try{
  const dir=path.join(await fs.realpath(workspace),'.presence'),file=path.join(dir,'hook-events.jsonl');
  const dirInfo=await fs.lstat(dir);if(!dirInfo.isDirectory()||dirInfo.isSymbolicLink()||await fs.realpath(dir)!==dir)throw Error('unsafe');
  const handle=await fs.open(file,fssync.constants.O_RDONLY|fssync.constants.O_NOFOLLOW);
  try{
   const info=await handle.stat();if(!info.isFile()||info.size>1024*1024||(process.getuid&&info.uid!==process.getuid()))throw Error('unsafe');
   const data=await handle.readFile({encoding:'utf8'});const rows=[];
   for(const line of data.split('\n')){if(!line)continue;let r;try{r=JSON.parse(line);}catch{continue;}if(r?.event==='PreLLMCall'&&typeof r.eligible==='boolean'&&timestamps(r.read_at))rows.push(r);}
   const last=rows.at(-1);return {status:'workspace_scoped_unverified',reads:rows.length,eligible:rows.filter(x=>x.eligible===true).length,last:last?{eligible:last.eligible,read_at:timestamps(last.read_at),received_at:timestamps(last.received_at),controls:last.eligible?controls(last.controls):null}:null};
  }finally{await handle.close();}
 }catch{return {status:'unavailable',reads:null,eligible:null,last:null};}
}
export class TerminalPresenceObserver extends EventEmitter{
 constructor({reader,workspace,intervalMs=5000}){super();if(!reader||typeof reader.read!=='function'||!path.isAbsolute(workspace)||!Number.isSafeInteger(intervalMs)||intervalMs<1000)throw Error('presence_observer_invalid');this.reader=reader;this.workspace=workspace;this.intervalMs=intervalMs;this.current={source:null,hook:null};this.timer=null;this.closed=false;this.reading=false;}
 snapshot(){return this.current;}
 async poll(){if(this.closed||this.reading)return;this.reading=true;try{const [source,hook]=await Promise.all([this.reader.read().catch(()=>null),readHookEvidence(this.workspace)]);if(!this.closed){this.current={source,hook};this.emit('change');}}finally{this.reading=false;}}
 start(){if(this.closed||this.timer)return;void this.poll();this.timer=setInterval(()=>void this.poll(),this.intervalMs);}
 async stop(){this.closed=true;clearInterval(this.timer);this.current={source:null,hook:null};await this.reader.close?.();}
}
