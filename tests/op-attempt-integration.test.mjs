import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createOpenPresenceClient} from '../src/op-service-client.mjs';
import {TextboxPresence} from '../src/textbox-presence.mjs';
import {createStructuredServer} from '../structured-server.mjs';
import {createEvidenceStore} from '../src/evidence-store.mjs';

class Pair extends EventEmitter {
 constructor(){super();this.status='ready';this.arms=Object.fromEntries(['without','with'].map(a=>[a,{status:'ready',messages:[],approvals:[],usage:{status:'not_observed'}}]));}
 snapshot(){return{status:this.status,arms:this.arms};}
 async stop(){this.status='closed';for(const arm of Object.values(this.arms))arm.status='closed';this.emit('status');}
}
const sample=()=>({keyAreas:[1],keyTypes:['an'],pressTimes:[0],releaseTimes:[1],length:1,sessionID:'PRIVATE_SYNTHETIC',startUnixTime:1700000000,timeZone:1,time:'Morning',season:'Fall',weekday:'Monday'});

test('actual transport attempts and local deferral remain distinct through server, Stop and disk export',async t=>{
 let mono=0,wall=1700000000000,remote=0;
 const client=createOpenPresenceClient({environment:'dev',client_id:'PRIVATE_ID',client_secret:'PRIVATE_SECRET',now:()=>wall,
  resolveCodingInstructions:()=>({status:'usable',capsule:{generated_at:new Date(wall).toISOString(),controls:{response_extent:'terse',unsolicited_update:'send',conversation_style:'self_contained'},instructions:{version:'coding-instructions.3',llm:{preamble:'PRIVATE_GUIDANCE'}}}}),
  fetcher:async url=>{
   if(url==='https://auth.area2-ai.com/token')return new Response(JSON.stringify({access_token:'PRIVATE_TOKEN',expires_in:300}));
   assert.equal(url,'https://api-dev.area2-ai.com/v2/capture');remote++;
   if(remote===2)return new Response('{}',{status:429,headers:{'retry-after':'90'}});
   mono+=2000;wall+=2000;return new Response(JSON.stringify({status:'success',results:{a2_open:{}}}));
  }});
 const textbox=new TextboxPresence({client,now:()=>wall,monotonicNow:()=>mono}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'op-attempt-evidence-'));
 const store=await createEvidenceStore({directory,debounceMs:0}),server=createStructuredServer({root:path.resolve('.'),labRoot:path.resolve('.'),createPair:async()=>new Pair(),evidenceStore:store,textboxPresence:textbox,textboxLiveEnabled:true,textboxSessionAuthorized:true,checkpointMs:60000});
 t.after(async()=>{await server.shutdown().catch(()=>{});await fs.rm(directory,{recursive:true,force:true});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,config=await(await fetch(base+'/api/config')).json();
 const post=async(route,body={})=>{const r=await fetch(base+'/api/'+route,{method:'POST',headers:{origin:base,'content-type':'application/json','x-terminal-token':config.token},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 await post('start');await post('presence/consent',{generation:1,allowed:true});
 const capture=()=>post('presence/capture',{generation:1,capture:sample()});
 assert.equal((await capture()).capture_status,'ready');
 mono=30000;wall=1700000030000;assert.equal((await capture()).capture_status,'deferred_unattempted');assert.equal(remote,1);
 mono=32000;wall=1700000032000;assert.equal((await capture()).capture_status,'backoff');assert.equal(remote,2);
 await post('stop');const response=await fetch(base+'/api/evidence?generation=1',{headers:{'x-terminal-token':config.token}});assert.equal(response.status,200);const report=await response.json();
 assert.deepEqual(report.textbox.attempt_history.map(x=>[x.kind,x.http_status,x.outcome,x.cooldown_ms]),[['http',200,'usable',30000],['local_backoff',null,'backoff',2000],['http',429,'backoff',90000]]);
 assert.equal(report.textbox.attempt_history[0].duration_ms,2000);assert.equal(report.textbox.attempt_history_omitted,0);assert.equal(report.pair.status,'closed');assert.ok(!JSON.stringify(report).includes('PRIVATE'));
 assert.deepEqual(report,JSON.parse(await fs.readFile(path.join(directory,report.run_id+'.json'),'utf8')));
});
