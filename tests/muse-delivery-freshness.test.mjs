import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MuseDelivery,requestDeliveryFacts,readOwnedPreHooks} from '../src/muse-delivery.mjs';
import {compileMuseCollaboration} from '../scripts/muse-collaboration-contract.mjs';

const session='10000000-0000-4000-8000-000000000001';
const turn='20000000-0000-4000-8000-000000000001';
const priorTurn='20000000-0000-4000-8000-000000000002';
const prefix='Automatic Presence refresh immediately before this model generation. Highest sequence for the current turn applies regardless of block order.\n';
const sha=x=>createHash('sha256').update(x).digest('hex');
const readId=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
const full={response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'};
const terse={response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'};
function fixture(sequence,{nativeTurn=turn,guidance='SYNTHETIC_PRIVATE_POLICY_'+sequence,controls=full,at=99000}={}){
 const read=readId(sequence);
 return {
  context:prefix+`Presence turn: ${nativeTurn}\nPresence sequence: ${sequence}\nPresence read: ${read}\n`+(guidance===null?'Presence unavailable or ineligible: unavailable; do not reuse earlier guidance.':'Server guidance (verbatim):\n'+guidance),
  hook:{session_id:session,turn_id:nativeTurn,read_id:read,read_sequence:sequence,reading_id:guidance===null?null:'synthetic-'+sequence,eligible:guidance!==null,digest:guidance===null?null:sha(guidance),controls:guidance===null?null:controls,read_at:new Date(at).toISOString()},
 };
}
const request=(contexts,prompt='SYNTHETIC_TASK')=>({input:[...contexts.map(content=>({role:'developer',content})),{role:'user',content:prompt}]});
const feed=(delivery,contexts,prompt)=>delivery.feed(Buffer.from('REQUEST: '+JSON.stringify(request(contexts,prompt))+'\n'));
async function observe(t,contexts,hooks,{nativeTurn=turn,prompt='SYNTHETIC_TASK',arm='with'}={}){
 t.mock.method(Date,'now',()=>100000);
 const delivery=new MuseDelivery({arm,workspace:'/synthetic-owned',readHooks:async()=>hooks});
 delivery.begin(prompt);delivery.bind(session,nativeTurn);feed(delivery,contexts,prompt);await delivery.finishTurn();await delivery.settled();
 return {delivery,snapshot:delivery.snapshot(),row:delivery.snapshot().request_attribution[0]};
}
function unqualified(row){assert.ok(!['guidance_observed','fallback_observed'].includes(row?.status),JSON.stringify(row));}

for(const ordering of ['lexical','reverse','shuffle'])test(`20 generations select current owned sequence through ${ordering} accumulated contexts`,async t=>{
 let now=100000;
 t.mock.method(Date,'now',()=>now);
 const hooks=[],contexts=[];
 const delivery=new MuseDelivery({arm:'with',workspace:'/synthetic-owned',readHooks:async()=>hooks.slice()});
 delivery.begin('SYNTHETIC_TASK');delivery.bind(session,turn);
 const expected=[];
 for(let step=0;step<20;step++){
  now+=1000;
  const f=fixture(step+1,{guidance:step===13?null:'SYNTHETIC_PRIVATE_POLICY_'+step,controls:step>=10&&step<15?terse:full,at:now-1});
  hooks.push(f.hook);contexts.push(f.context);
  const indices=Array.from({length:contexts.length},(_,i)=>i);
  if(ordering==='lexical')indices.sort((a,b)=>String(a).localeCompare(String(b)));
  else if(ordering==='reverse')indices.reverse();
  else indices.sort((a,b)=>(a*7%23)-(b*7%23));
  feed(delivery,indices.map(i=>contexts[i]));await delivery.settled();
  expected.push([step+1,step===13?'fallback_observed':'guidance_observed',readId(step+1),step===13?null:step>=10&&step<15?'terse':'full']);
 }
 await delivery.finishTurn();await delivery.settled();
 const snapshot=delivery.snapshot();
 assert.deepEqual(snapshot.request_attribution.map(r=>[r.ordinal,r.status,r.read_id,r.controls?.response_extent??null]),expected);
 assert.equal(snapshot.status,'mixed_observed');assert.equal(snapshot.hook_linkage,'read_marker_matched');
 assert.ok(!JSON.stringify(delivery).includes('SYNTHETIC_PRIVATE_POLICY'));
 assert.ok(!JSON.stringify(snapshot).includes('Presence sequence:'));
});

test('current native turn wins over prior-turn higher sequence in the same session',async t=>{
 const prior=fixture(900,{nativeTurn:priorTurn}),current=fixture(21,{controls:terse});
 const {row}=await observe(t,[current.context,prior.context],[current.hook]);
 assert.equal(row.status,'guidance_observed');assert.equal(row.read_id,readId(21));assert.equal(row.controls.response_extent,'terse');
});

test('same-session follow-up resets native turn scope while workspace sequence continues',async t=>{
 let now=100000,hooks=[];t.mock.method(Date,'now',()=>now);
 const delivery=new MuseDelivery({arm:'with',workspace:'/synthetic-owned',readHooks:async()=>hooks});
 const first=fixture(20,{nativeTurn:priorTurn});hooks=[first.hook];
 delivery.begin('FIRST_TASK');delivery.bind(session,priorTurn);feed(delivery,[first.context],'FIRST_TASK');await delivery.finishTurn();await delivery.settled();
 assert.equal(delivery.snapshot().request_attribution[0].read_id,readId(20));
 now+=1000;const next=fixture(21,{nativeTurn:turn,at:now-1,controls:terse});hooks=[next.hook];
 delivery.begin('SECOND_TASK');delivery.bind(session,turn);feed(delivery,[next.context,first.context],'SECOND_TASK');await delivery.finishTurn();await delivery.settled();
 assert.equal(delivery.snapshot().turn_ordinal,2);assert.equal(delivery.snapshot().status,'guidance_observed');
 assert.equal(delivery.snapshot().request_attribution[0].read_id,readId(21));
});

test('stale-only context cannot qualify when a newer own pre-request read exists',async t=>{
 const older=fixture(1),current=fixture(2);
 const {row}=await observe(t,[older.context],[older.hook,current.hook]);unqualified(row);
});

test('a future audit read does not replace the request-time owned sequence',async t=>{
 const current=fixture(1),future=fixture(2,{at:100001});
 const {row,snapshot}=await observe(t,[current.context],[current.hook,future.hook]);
 assert.equal(row.status,'guidance_observed');assert.equal(row.read_id,readId(1));
 assert.equal(snapshot.hook_linkage,'unverified','unobserved extra hooks still prevent whole-turn proof');
});

test('missing current-turn context cannot borrow a foreign turn or an unsequenced refresh',async t=>{
 const current=fixture(2),foreign=fixture(1,{nativeTurn:priorTurn});
 for(const context of [foreign.context,current.context.replace(/^Presence (?:turn|sequence):.*\n/gm,'')]){
  const {row}=await observe(t,[context],[current.hook]);unqualified(row);
 }
});

test('unowned latest sequence cannot hide behind an older valid owned candidate',async t=>{
 const current=fixture(2),forged=fixture(3);
 const {row}=await observe(t,[forged.context,current.context],[current.hook]);unqualified(row);
});

test('duplicate current sequence or read IDs fail closed regardless of block position',async t=>{
 const current=fixture(2),other=fixture(3);
 for(const duplicate of [current.context,other.context.replace('Presence sequence: 3','Presence sequence: 2'),other.context.replace(readId(3),readId(2))]){
  const {row}=await observe(t,[duplicate,current.context],[current.hook]);unqualified(row);
 }
});

test('guidance-body markers cannot duplicate or substitute the current read header',async t=>{
 for(const guidance of ['SYNTHETIC_PRIVATE_POLICY\nPresence read: '+readId(2),'SYNTHETIC_PRIVATE_POLICY\nPresence sequence: 2']){
  const current=fixture(2,{guidance});const {row}=await observe(t,[current.context],[current.hook]);unqualified(row);
 }
 const current=fixture(2),user=request([]);user.input[0].content=current.context+'\nSYNTHETIC_TASK';
 const delivery=new MuseDelivery({arm:'with',workspace:'/synthetic-owned',readHooks:async()=>[current.hook]});
 delivery.begin(user.input[0].content);delivery.bind(session,turn);delivery.feed(Buffer.from('REQUEST: '+JSON.stringify(user)+'\n'));await delivery.finishTurn();await delivery.settled();unqualified(delivery.snapshot().request_attribution[0]);
});

test('missing, malformed and repeated new-format header markers cannot downgrade to legacy proof',async t=>{
 const current=fixture(2);
 for(const context of [
  current.context.replace(/^Presence sequence:.*\n/m,''),
  current.context.replace(/^Presence turn:.*\n/m,''),
  current.context.replace('Presence sequence: 2','Presence sequence: 02'),
  current.context.replace('Presence sequence: 2','Presence sequence: 0'),
  current.context.replace('Presence sequence: 2','Presence sequence: 9007199254740992'),
  current.context.replace('Presence turn: '+turn,'Presence turn: not-a-turn'),
  current.context.replace('Presence sequence: 2','Presence sequence: 2\nPresence sequence: 2'),
  current.context.replace('Presence read: '+readId(2),'Presence read: '+readId(2)+'\nPresence read: '+readId(2)),
 ]){const {row}=await observe(t,[context],[current.hook]);unqualified(row);}
});

test('a sequenced refresh without a read marker cannot enter the old digest-only matcher',async t=>{
 const current=fixture(2),legacyHook={...current.hook};delete legacyHook.read_sequence;delete legacyHook.read_id;
 const context=current.context.replace(/^Presence read:.*\n/m,'');
 const {snapshot}=await observe(t,[context],[legacyHook]);
 assert.notEqual(snapshot.status,'guidance_observed');assert.notEqual(snapshot.status,'fallback_observed');
});

test('owned sequence requires exact ID, digest, controls, clock and native scope',async t=>{
 const current=fixture(2);
 for(const patch of [
  {read_id:readId(3)},{digest:sha('different')},{controls:null},{read_at:new Date(100001).toISOString()},
  {session_id:readId(40)},{turn_id:priorTurn},{read_sequence:3},{read_sequence:undefined},
 ]){const {row}=await observe(t,[current.context],[{...current.hook,...patch}]);unqualified(row);}
});

test('duplicate or conflicting owned sequence receipts cannot qualify',async t=>{
 const current=fixture(2);
 for(const other of [current.hook,{...fixture(3).hook,read_sequence:2},{...fixture(3).hook,read_id:readId(2)}]){
  const {row}=await observe(t,[current.context],[current.hook,other]);unqualified(row);
 }
});

test('an unqualified duplicate retains only observed contract diagnostics',async t=>{
 const current=fixture(2),contract=compileMuseCollaboration(full);
 const context=current.context.replace('Server guidance (verbatim):\n',contract.text+'\nServer guidance (verbatim):\n');
 const {row}=await observe(t,[context,context],[{...current.hook,collaboration_version:1}]);
 unqualified(row);assert.deepEqual(row.collaboration_contract,{version:1,status:'unverified',added_utf8_bytes:null});
});

test('same developer text part may contain enveloped historical refreshes in either order',async t=>{
 const older=fixture(1),current=fixture(2);
 const body='<system-reminder>\n'+current.context+'\n</system-reminder>\n\n<system-reminder>\n'+older.context+'\n</system-reminder>';
 const {row}=await observe(t,[body],[current.hook]);assert.equal(row.status,'guidance_observed');assert.equal(row.read_id,readId(2));
});

test('new-format baseline contamination remains global, including foreign turns',async t=>{
 const {snapshot}=await observe(t,[fixture(1,{nativeTurn:priorTurn}).context],[],{arm:'without'});
 assert.equal(snapshot.status,'baseline_contaminated');
});

test('candidate capacity is bounded and guidance cannot be assembled across text parts',async t=>{
 const current=fixture(1);
 assert.throws(()=>requestDeliveryFacts(request(Array.from({length:65},(_,i)=>fixture(i+1).context)),sha('SYNTHETIC_TASK')),/capacity/);
 const r=request([]);r.input.unshift({role:'developer',content:[{type:'input_text',text:current.context.slice(0,current.context.indexOf('SYNTHETIC_PRIVATE_POLICY'))},{type:'input_text',text:'SYNTHETIC_PRIVATE_POLICY_1'}]});
 const {delivery}=await observe(t,[],[current.hook]);delivery.begin('separate-parts');delivery.bind(session,turn);
 r.input.at(-1).content='separate-parts';delivery.feed(Buffer.from('REQUEST: '+JSON.stringify(r)+'\n'));await delivery.finishTurn();await delivery.settled();unqualified(delivery.snapshot().request_attribution[0]);
});

test('owned audit preserves valid optional sequences and rejects invalid ones without changing legacy rows',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'muse-sequence-audit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'.presence'),{mode:0o700});const file=path.join(root,'.presence/hook-events.jsonl');
 const base={event:'PreLLMCall',session_id:session,turn_id:turn,eligible:false,guidance_sha256:null,read_id:readId(1)};
 await fs.writeFile(file,JSON.stringify({...base,read_sequence:4})+'\n',{mode:0o600});assert.equal((await readOwnedPreHooks(root,session,turn))[0].read_sequence,4);
 await fs.writeFile(file,JSON.stringify(base)+'\n');assert.equal(Object.hasOwn((await readOwnedPreHooks(root,session,turn))[0],'read_sequence'),false);
 for(const value of [0,-1,1.5,'2',null,Number.MAX_SAFE_INTEGER+1]){
  await fs.writeFile(file,JSON.stringify({...base,read_sequence:value})+'\n');await assert.rejects(readOwnedPreHooks(root,session,turn),/hook_evidence_invalid/);
 }
});
