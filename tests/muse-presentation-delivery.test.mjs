import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MuseDelivery,requestDeliveryFacts} from '../src/muse-delivery.mjs';
import {projectEvidence} from '../src/evidence-projection.mjs';
import {compileMuseCollaboration} from '../scripts/muse-collaboration-contract.mjs';
import {compileMusePresentation} from '../scripts/muse-presentation-guidance.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const read='10000000-0000-4000-8000-000000000001',reading='20000000-0000-4000-8000-000000000001';
const c={response_extent:'full',unsolicited_update:'defer',conversation_style:'self_contained'},guidance='PRIVATE_CURRENT_OP';
const prefix='Automatic Presence refresh immediately before this model generation.\nPresence read: '+read+'\n';
const render=(v=2)=>prefix+(v===2?compileMusePresentation(c):compileMuseCollaboration(c)).text+'\nServer guidance (verbatim):\n'+guidance;
const fallback=prefix+'Presence unavailable or ineligible: unavailable. Use ordinary behavior; do not reuse earlier guidance.';
const request=content=>({input:[{role:'developer',content},{role:'user',content:'coding task'}]});
async function observe(content,{version=2,eligible=true,arm='with',history=[]}={}){
 const hooks=arm==='without'?[]:[{collaboration_version:version,read_id:read,reading_id:eligible?reading:null,eligible,controls:eligible?c:null,digest:eligible?sha(guidance):null,read_at:new Date(Date.now()-1000).toISOString()}];
 const d=new MuseDelivery({arm,workspace:'/owned',readHooks:async()=>hooks});d.begin('coding task');d.bind('session','turn');
 const r=request(content);r.input.unshift(...history);d.feed(Buffer.from('REQUEST: '+JSON.stringify(r)+'\n'));await d.finishTurn();await d.settled();return d.snapshot();
}
test('exact v2 hints and historical v1 hints retain distinct current-request proof and safe export',async()=>{
 for(const version of [1,2]){
  const state=await observe(render(version),{version});assert.equal(state.status,'guidance_observed');
  const expected={version,status:'matched',added_utf8_bytes:Buffer.byteLength((version===2?compileMusePresentation(c):compileMuseCollaboration(c)).text)+1};
  assert.deepEqual(state.request_attribution[0].collaboration_contract,expected);
  const out=projectEvidence({arms:{with:{delivery:state}}}).arms.with.delivery;
  assert.deepEqual(out.request_attribution[0].collaboration_contract,expected);assert.ok(!JSON.stringify(out).includes('PRIVATE_CURRENT_OP'));
 }
});
test('v2 ordinary fallback supersedes historical hints and exports verified withdrawal only for this request',async()=>{
 const state=await observe(fallback,{eligible:false,history:[{role:'developer',content:render(2).replace(read,'30000000-0000-4000-8000-000000000001')}]});
 assert.equal(state.status,'fallback_observed');assert.deepEqual(state.request_attribution[0].collaboration_contract,{version:2,status:'withdrawn',added_utf8_bytes:0});
 assert.deepEqual(projectEvidence({arms:{with:{delivery:state}}}).arms.with.delivery.request_attribution[0].collaboration_contract,{version:2,status:'withdrawn',added_utf8_bytes:0});
});
test('altered, duplicate, wrong-version or absent hints never acquire exact v2 proof',async()=>{
 const v2=compileMusePresentation(c).text;
 for(const content of [render().replace('Muse collaboration v2:','Muse collaboration v2:\nMANDATORY SCRIPT'),render().replace(v2,v2+'\n'+v2),render(1),prefix+'Server guidance (verbatim):\n'+guidance,render().replace('v2:','v999:')]){
  const state=await observe(content);assert.equal(state.status,'guidance_observed');assert.equal(state.request_attribution[0].collaboration_contract.status,'unverified');
 }
});
test('retained or malformed presentation markers in current fallback cannot claim withdrawal',async()=>{
 for(const retained of [compileMusePresentation(c).text,'Muse collaboration v999: retained','inline Muse collaboration v2: retained','muse  collaboration v2: retained']){
  const state=await observe(fallback+'\n'+retained,{eligible:false});assert.equal(state.request_attribution[0].collaboration_contract.status,'unverified');
 }
});
test('bare presentation hints contaminate baseline even without a full refresh prefix',async()=>{
 assert.equal((await observe('ordinary instructions',{arm:'without'})).status,'baseline_isolated');
 assert.equal((await observe(compileMusePresentation(c).text,{arm:'without'})).status,'baseline_contaminated');
});
test('current v2 proof cannot borrow a hint from an earlier developer block or user role',()=>{
 const r=request(prefix+'Server guidance (verbatim):\n'+guidance);r.input.unshift({role:'developer',content:render().replace(read,'30000000-0000-4000-8000-000000000001')});
 assert.equal(requestDeliveryFacts(r,sha('coding task')).collaboration_hash,null);
 r.input.at(-1).content=render();assert.equal(requestDeliveryFacts(r,sha(render())).collaboration_hash,null);
});

test('live launcher accepts no implicit or malformed presentation activation',async()=>{
 const {buildStructuredLauncher}=await import('../structured-live.mjs');
 for(const value of [null,'yes',1,{}])await assert.rejects(buildStructuredLauncher({presentationGuidance:value}),/presentation_guidance_invalid/);
});
