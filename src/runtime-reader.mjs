import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
// Only the operational status crosses the UI boundary: no app name, raw
// capture, diagnostic counters, or capsule text. This is independent of
// guidance eligibility and is never used to override the upstream consumer.
export function captureHealth(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {state:'unavailable', reason:null};
  if (raw.mode === 'fixture') return {state:'fixture', reason:null};
  if (raw.mode === 'baseline' && raw.collector === 'off') return {state:'off', reason:null};
  if (raw.mode !== 'live' || raw.adapter_schema !== 'a2_presence_pa_adapter.v1') return {state:'unavailable', reason:null};
  const states = new Set(['collecting','waiting_for_input','paused','native_starting','off']);
  const reasons = new Set(['native_focus_unavailable','focus_unavailable','focus_changed','inactive_session','poll_error','runtime_not_running','secure_input','unsupported_field','field_safety_unavailable']);
  const state = states.has(raw.collector) ? raw.collector : 'unavailable';
  return {state, reason: state === 'paused' || state === 'off' ? (reasons.has(raw.pause_reason) ? raw.pause_reason : null) : null};
}
export class RuntimeReader {
  constructor({python,probe,state,assess,spawnProcess=spawn}) {
    this.assess=assess; this.reads=0; this.serial=0; this.pending=null; this.closed=false; this.buffer='';
    this.child=spawnProcess(python,['-B',fileURLToPath(new URL('../scripts/presence_bridge.py',import.meta.url)),probe,state],{detached:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    this.child.stdout.setEncoding('utf8'); this.child.stderr.resume();
    this.child.stdout.on('data',chunk=>{
      if(this.dead||this.closed)return;
      this.buffer+=chunk;
      if(Buffer.byteLength(this.buffer)>200000){
        // A partial oversized frame cannot be resynchronized safely. Close
        // the transport and bound memory instead of accepting later bytes as
        // a fresh Presence reading.
        this.buffer='';this.dead=true;this.fail();this.child.stdin.end();return;
      }
      let cut;
      while((cut=this.buffer.indexOf('\n'))>=0) {
        const line=this.buffer.slice(0,cut); this.buffer=this.buffer.slice(cut+1);
        try {const result=JSON.parse(line); if(result.id===this.pending?.id) this.pending.finish(result.result??null);} catch {this.fail();}
      }
    });
    this.child.on('error',()=>{this.dead=true;this.fail();}); this.child.on('close',()=>{this.dead=true;this.fail();}); this.child.stdin.on('error',()=>{this.dead=true;this.fail();});
  }
  fail(){this.pending?.finish(null);}
  async read() {
    if(this.closed||this.dead) return this.view(null,0);
    if(this.pending) return this.pending.promise;
    const start=performance.now(), id=++this.serial;
    let resolve; const promise=new Promise(r=>resolve=r);
    const timer=setTimeout(()=>this.pending?.id===id&&this.pending.finish(null),8000);
    const finish=raw=>{if(this.pending?.id!==id)return; clearTimeout(timer);this.pending=null;this.reads++;resolve(this.view(raw,performance.now()-start));};
    this.pending={id,promise,finish};
    try{this.child.stdin.write(JSON.stringify({id})+'\n');}catch{finish(null);}
    return promise;
  }
  view(raw,latency) {
    try {
      const assessed=this.assess(raw);
      if(!assessed||typeof assessed!=='object'||typeof assessed.eligible!=='boolean')throw Error('assessment_invalid');
      return {eligible:assessed.eligible,controls:assessed.eligible&&assessed.controls?{
        response_extent:assessed.controls.response_extent,unsolicited_update:assessed.controls.unsolicited_update,conversation_style:assessed.controls.conversation_style}:null,
        renderer:assessed.renderer,received_at:assessed.received_at,read_at:assessed.read_at,capture:captureHealth(raw),
        fallback_reason:assessed.fallback_reason,latency_ms:Math.round(latency*100)/100,reads:this.reads,evidenceMode:'live'};
    } catch {
      // A faulty assessor must not strand the pending read or retain controls.
      return {eligible:false,controls:null,renderer:null,received_at:null,read_at:null,capture:{state:'unavailable',reason:null},fallback_reason:'assessment_unavailable',latency_ms:Math.round(latency*100)/100,reads:this.reads,evidenceMode:'live'};
    }
  }
  async close(){
    this.closed=true;this.fail();this.child.stdin.end();
    const exited=()=>this.child.exitCode!==null||this.child.signalCode!==null;
    const wait=ms=>Promise.race([once(this.child,'close').catch(()=>{}),new Promise(r=>setTimeout(r,ms))]);
    if(!exited())await wait(5000); // Let the official SDK close its separate MCP process tree.
    if(!exited()){try{process.kill(-this.child.pid,'SIGTERM');}catch{}await wait(3000);}
    if(!exited()){try{process.kill(-this.child.pid,'SIGKILL');}catch{}await wait(1000);}
  }
}
