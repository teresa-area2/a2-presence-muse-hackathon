import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {MuseDelivery,requestDeliveryFacts,readOwnedPreHooks} from '../src/muse-delivery.mjs';import {museDeliveryView} from '../web/muse-delivery-view.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex'),prefix='Automatic Presence refresh immediately before this model generation';
const req=(prompt='task',context=prefix+'\nServer guidance (verbatim):\nPRIVATE-GUIDANCE')=>({input:[{role:'developer',content:context},{role:'user',content:prompt}]});
const feed=(d,value)=>d.feed(Buffer.from('REQUEST: '+JSON.stringify(value)+'\n'));
const validHook=()=>({eligible:true,digest:sha('PRIVATE-GUIDANCE'),controls:{response_extent:'terse',unsolicited_update:'send',conversation_style:'conversational'},read_at:new Date(Date.now()-1000).toISOString()});
const make=(arm='with',hooks=[validHook()])=>new MuseDelivery({arm,workspace:'/owned',readHooks:async()=>hooks});
test('exact current-prompt developer-block digest gets a request-observed status, never response proof',async()=>{const d=make();d.begin('task');feed(d,req());d.bind('session','turn');d.publicFinal();await d.finishTurn();const s=d.snapshot();assert.equal(s.status,'guidance_observed');assert.equal(s.response_linkage,'unverified');assert.equal(s.hook_linkage,'unverified');assert.equal(s.public_finals,1);assert.ok(!JSON.stringify(s).includes('PRIVATE'));assert.ok(!JSON.stringify(d).includes('PRIVATE-GUIDANCE'));});
test('processes repeated turns and verifies fallback independently of earlier eligible reads',async()=>{let hooks=[validHook()];const d=new MuseDelivery({arm:'with',workspace:'/owned',readHooks:async()=>hooks});d.begin('first');d.bind('s','t1');feed(d,req('first'));await d.finishTurn();assert.equal(d.snapshot().status,'guidance_observed');hooks=[{eligible:false,digest:null,read_at:new Date(Date.now()-1000).toISOString()}];d.begin('second');d.bind('s','t2');feed(d,req('second',prefix+' Presence unavailable or ineligible: unavailable. do not reuse earlier guidance'));await d.finishTurn();assert.equal(d.snapshot().status,'fallback_observed');assert.equal(d.snapshot().turn_ordinal,2);});
test('user, assistant, stale-prefix context and other prompt cannot establish delivery',async()=>{for(const mode of ['user','assistant','stale','prompt']){const d=make();d.begin('task');d.bind('s','t');const r=req();if(mode==='user')r.input[0].role='user';if(mode==='assistant')r.input[0].role='assistant';if(mode==='stale')r.input[0].content+='\n'+prefix+' Presence unavailable or ineligible: missing. do not reuse earlier guidance';if(mode==='prompt')r.input[1].content='other';feed(d,r);await d.finishTurn();assert.notEqual(d.snapshot().status,'guidance_observed',mode);}});
test('duplicate request or scoped hook rows fail closed as ambiguous',async()=>{for(const duplicate of ['request','hook']){const d=make('with',duplicate==='hook'?[validHook(),validHook()]:undefined);d.begin('task');d.bind('s','t');feed(d,req());if(duplicate==='request')feed(d,req());await d.finishTurn();assert.equal(d.snapshot().status,'ambiguous');}});
test('baseline requires absence of both request markers and hook evidence',async()=>{for(const mode of ['clean','marker','audit']){const d=make('without',mode==='audit'?[{eligible:false}]:[]);d.begin('task');d.bind('s','t');feed(d,req('task',mode==='marker'?prefix:'Shared instructions'));await d.finishTurn();assert.equal(d.snapshot().status,mode==='clean'?'baseline_isolated':'baseline_contaminated');}});
test('malformed/oversized/truncated trace becomes unavailable without retaining payload',()=>{for(const b of ['REQUEST: {bad}\n','X'.repeat(4*1024*1024+1),'REQUEST: {']){const d=make();d.begin('task');d.feed(Buffer.from(b));d.close();assert.equal(d.snapshot().status,'unavailable');assert.equal(d.buffer,'');}});
test('late request after completion cannot qualify the next turn',async()=>{const d=make();d.begin('task');d.bind('s','t');feed(d,req());await d.finishTurn();feed(d,req());assert.equal(d.snapshot().status,'unavailable');});
test('UI unknown inputs never claim verified response or behavioral effect',()=>{for(const value of [null,{}, {status:'verified'}, {status:'guidance_observed'}]){const v=museDeliveryView(value);assert.ok(!/delivered|applied|behavior changed/i.test(v.label));assert.match(v.detail,/unverified/);}});
test('hook reader scopes owned session/turn and refuses symlink evidence',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-audit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'.presence'));const file=path.join(dir,'.presence','hook-events.jsonl');await fs.writeFile(file,JSON.stringify({event:'PreLLMCall',session_id:'s',turn_id:'t',eligible:true,guidance_sha256:sha('PRIVATE'),controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'}})+'\n');assert.equal((await readOwnedPreHooks(dir,'s','t')).length,1);assert.equal((await readOwnedPreHooks(dir,'foreign','t')).length,0);assert.equal((await readOwnedPreHooks(dir,'foreign','t',{baseline:true})).length,1);await fs.unlink(file);await fs.symlink('/unowned',file);await assert.rejects(readOwnedPreHooks(dir,'s','t'));});

test('a digest cannot match across distinct developer input-text blocks',async()=>{const d=make();d.begin('task');d.bind('s','t');const r=req();r.input[0].content=[{type:'input_text',text:prefix+'\nServer guidance (verbatim):\n'},{type:'input_text',text:'PRIVATE-GUIDANCE'}];feed(d,r);await d.finishTurn();assert.notEqual(d.snapshot().status,'guidance_observed');});
test('missing/invalid controls or reads after request observation cannot establish current guidance',async()=>{for(const change of [{controls:null},{read_at:null},{read_at:new Date(Date.now()+60000).toISOString()}]){const d=make('with',[{...validHook(),...change}]);d.begin('task');d.bind('s','t');feed(d,req());await d.finishTurn();assert.equal(d.snapshot().status,'unverified');}});
test('a reused prompt stays ambiguous rather than matching a delayed earlier request',async()=>{const d=make();for(const t of ['first','second']){d.begin('task');d.bind('s',t);feed(d,req());await d.finishTurn();}assert.equal(d.snapshot().status,'ambiguous');});
test('partial diagnostic capture marks evidence unavailable without rejecting a ready send',()=>{const d=make();d.feed(Buffer.from('partial diagnostic'));assert.doesNotThrow(()=>d.begin('task'));assert.equal(d.snapshot().status,'unavailable');});

const readIds=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
const markedContext=(readId,guidance)=>prefix+'\nPresence read: '+readId+'\n'+(guidance===null?'Presence unavailable or ineligible: unavailable. do not reuse earlier guidance':'Server guidance (verbatim):\n'+guidance);
const identifiedHook=(readId,guidance,readingId)=>({...validHook(),read_id:readId,eligible:guidance!==null,digest:guidance===null?null:sha(guidance),reading_id:readingId,receipt_age_seconds:2,controls:guidance===null?null:validHook().controls});
test('coding requests correlate changed guidance and fallback by exact read markers',async()=>{
 const hooks=[identifiedHook(readIds[1],'POLICY_B','reading-b'),identifiedHook(readIds[2],null,null),identifiedHook(readIds[0],'POLICY_A','reading-a')];
 const d=make('with',hooks);d.begin('coding task');d.bind('s','t');
 for(const [i,guidance]of ['POLICY_A','POLICY_B',null].entries())feed(d,req('coding task',markedContext(readIds[i],guidance)));
 d.publicFinal();await d.finishTurn();const out=d.snapshot();
 assert.equal(out.status,'mixed_observed');assert.equal(out.hook_linkage,'read_marker_matched');assert.equal(out.response_linkage,'unverified');
 assert.deepEqual(out.request_attribution.map(x=>[x.ordinal,x.status,x.reading_id]),[[1,'guidance_observed','reading-a'],[2,'guidance_observed','reading-b'],[3,'fallback_observed',null]]);
 assert.ok(!JSON.stringify(out).includes('POLICY_'));assert.equal(out.behavior,'not_measured');
});
test('duplicate read markers and extra unobserved hooks keep a coding turn ambiguous',async()=>{
 for(const mode of ['duplicate','extra']){
  const hooks=[identifiedHook(readIds[0],'POLICY_A','reading-a'),identifiedHook(readIds[1],'POLICY_A','reading-a')];
  const d=make('with',hooks);d.begin('coding task');d.bind('s','t');feed(d,req('coding task',markedContext(readIds[0],'POLICY_A')));
  if(mode==='duplicate')feed(d,req('coding task',markedContext(readIds[0],'POLICY_A')));
  await d.finishTurn();assert.equal(d.snapshot().status,'ambiguous');assert.equal(d.snapshot().hook_linkage,'unverified');
 }
});
test('a repeated human prompt can correlate only through fresh current-turn read markers',async()=>{
 let hooks=[identifiedHook(readIds[0],'POLICY_A','reading-a')];const d=new MuseDelivery({arm:'with',workspace:'/owned',readHooks:async()=>hooks});
 for(const [index,turn]of ['t1','t2'].entries()){
  hooks=[identifiedHook(readIds[index],'POLICY_A','reading-a')];d.begin('same prompt');d.bind('s',turn);feed(d,req('same prompt',markedContext(readIds[index],'POLICY_A')));await d.finishTurn();
  assert.equal(d.snapshot().status,'guidance_observed');assert.equal(d.snapshot().hook_linkage,'read_marker_matched');
 }
});
test('markers inside guidance or other roles cannot substitute for the current read header',()=>{
 const expected=sha('task');
 const userMarker=req('task',prefix+'\nServer guidance (verbatim):\nPresence read: '+readIds[0]);
 assert.equal(requestDeliveryFacts(userMarker,expected).read_id,null);
 const duplicate=req('task',prefix+'\nPresence read: '+readIds[0]+'\nPresence read: '+readIds[1]+'\nServer guidance (verbatim):\nA');
 assert.equal(requestDeliveryFacts(duplicate,expected).read_id,null);
 const otherRole=req('task',markedContext(readIds[0],'A'));otherRole.input[0].role='assistant';assert.equal(requestDeliveryFacts(otherRole,expected).read_id,null);
 const newer=req('task',markedContext(readIds[0],'OLD')+'\n'+markedContext(readIds[1],null));
 const facts=requestDeliveryFacts(newer,expected);assert.equal(facts.read_id,readIds[1]);assert.equal(facts.fallback,true);assert.deepEqual(facts.guidance_hashes,[]);
});
test('multiple baseline requests require every request to be marker-free and scoped',async()=>{
 for(const contaminated of [false,true]){
  const d=make('without',[]);d.begin('task');d.bind('s','t');feed(d,req('task','Shared instructions'));feed(d,req('task',contaminated?markedContext(readIds[0],'A'):'Shared instructions after a tool result'));await d.finishTurn();
  assert.equal(d.snapshot().status,contaminated?'baseline_contaminated':'baseline_isolated');assert.deepEqual(d.snapshot().request_attribution,[]);
 }
});
test('older asynchronous audit reads cannot overwrite a newer completed request match',async()=>{
 const pending=[];const d=new MuseDelivery({arm:'with',workspace:'/owned',readHooks:()=>new Promise(resolve=>pending.push(resolve))});d.begin('task');d.bind('s','t');feed(d,req('task',markedContext(readIds[0],'A')));
 const finished=d.finishTurn();assert.equal(pending.length,2);pending[1]([identifiedHook(readIds[0],'A','reading-a')]);await finished;assert.equal(d.snapshot().status,'guidance_observed');pending[0]([]);await d.settled();assert.equal(d.snapshot().status,'guidance_observed');
 d.feed(Buffer.from('REQUEST: {broken}\n'));assert.equal(d.snapshot().status,'unavailable');assert.deepEqual(d.snapshot().request_attribution,[]);
});
test('owned fallback audit must have an explicit null digest before read-marker linkage can qualify',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-digest-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'.presence'),{mode:0o700});
 for(const variant of ['missing','malformed','explicit-null']){
  const row={event:'PreLLMCall',session_id:'s',turn_id:'t',read_id:readIds[0],eligible:false,controls:null,reading_id:null,read_at:new Date(Date.now()-1000).toISOString()};
  if(variant!=='missing')row.guidance_sha256=variant==='explicit-null'?null:'malformed-non-null-digest';
  await fs.writeFile(path.join(dir,'.presence/hook-events.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});
  const d=new MuseDelivery({arm:'with',workspace:dir});d.begin('task');d.bind('s','t');feed(d,req('task',markedContext(readIds[0],null)));await d.finishTurn();await d.settled();
  assert.equal(d.snapshot().status,variant==='explicit-null'?'fallback_observed':'unavailable',variant);
  assert.equal(d.snapshot().hook_linkage,variant==='explicit-null'?'read_marker_matched':'unverified',variant);
 }
});
test('compact matched status counts requests without claiming provider linkage or behavior',()=>{
 const result=museDeliveryView({status:'mixed_observed',turn_ordinal:2,requests_observed:3,hook_linkage:'read_marker_matched',request_attribution:[{status:'guidance_observed'},{status:'guidance_observed'},{status:'fallback_observed'}]});
 assert.equal(result.label,'Turn 2 · 2 guidance · 1 fallback');assert.match(result.detail,/Provider response linkage and behavioral effects remain unverified/);
 const invalid=museDeliveryView({status:'unavailable',requests_observed:1,hook_linkage:'read_marker_matched',request_attribution:[{status:'guidance_observed'}]});assert.match(invalid.label,/unavailable/i);assert.match(invalid.detail,/Hook and response linkage unverified/);
});

test('quality prefix has a separately versioned prompt-bound fact without relaxing the developer predicate',async()=>{
 const quality='Required technical substance and limitations.',prompt=quality+'\n\nCheckpoint A';
 const d=new MuseDelivery({arm:'without',workspace:'/owned',qualityInstructions:quality,readHooks:async()=>[]});
 d.begin(prompt);d.bind('s','t');feed(d,req(prompt,'Unrelated developer context'));await d.finishTurn();
 assert.equal(d.snapshot().shared_quality_observed,false);
 assert.equal(d.snapshot().shared_quality_prompt_observed,true);assert.equal(d.snapshot().shared_quality_prompt_check_version,1);
 assert.ok(!JSON.stringify(d.snapshot()).includes(quality));
 const late=requestDeliveryFacts(req(prompt,'Unrelated'),sha('different prompt'),Date.now(),quality);
 assert.equal(late.shared_quality_prompt_present,null);
 const embedded='Checkpoint '+quality+'\n\nA';
 assert.equal(requestDeliveryFacts(req(embedded,'Unrelated'),sha(embedded),Date.now(),quality).shared_quality_prompt_present,false);
 d.begin(prompt);d.bind('s','next');feed(d,req(prompt,'Unrelated'));await d.finishTurn();assert.equal(d.snapshot().shared_quality_prompt_observed,null,'reused prompts cannot prove current delivery');
});


test('same-turn native steer keeps prior request facts and qualifies the next exact input',async()=>{
 const hooks=[identifiedHook(readIds[0],'POLICY_A','reading-a'),identifiedHook(readIds[1],'POLICY_B','reading-b')];const d=new MuseDelivery({arm:'with',workspace:'/owned',readHooks:async()=>hooks});d.begin('initial');d.bind('s','t');feed(d,req('initial',markedContext(readIds[0],'POLICY_A')));
 const token=d.prepareSteer('steer',{sessionId:'s',turnId:'t',commandId:'command'});d.settleSteer(token,'accepted');feed(d,req('steer',markedContext(readIds[1],'POLICY_B')));await d.finishTurn();await d.settled();const s=d.snapshot();assert.equal(s.status,'guidance_observed');assert.deepEqual(s.request_attribution.map(x=>x.reading_id),['reading-a','reading-b']);assert.equal(s.turn_ordinal,1);assert.equal(s.requests_observed,2);assert.equal(s.hook_linkage,'read_marker_matched');assert.equal(s.behavior,'not_measured');assert.ok(!JSON.stringify(s).includes('steer'));assert.ok(!JSON.stringify(s).includes('POLICY_'));
});


test('a pending candidate alone never repairs earlier mismatched native input',async()=>{
 const d=make('without',[]);d.begin('initial');d.bind('s','t');feed(d,req('unsubmitted-steer','ordinary'));await d.settled();assert.equal(d.snapshot().status,'ambiguous');const before=d.snapshot();const token=d.prepareSteer('unsubmitted-steer',{sessionId:'s',turnId:'t',commandId:'cmd'});assert.deepEqual(d.snapshot(),before);d.settleSteer(token,'accepted');assert.deepEqual(d.snapshot(),before);await d.finishTurn();assert.equal(d.snapshot().status,'ambiguous');
});
test('unknown steer ACK can be qualified only by an exact subsequent native input trace',async()=>{
 for(const matched of [false,true]){const d=make('without',[]);d.begin('initial');d.bind('s','t');feed(d,req('initial','ordinary'));const token=d.prepareSteer('changed',{sessionId:'s',turnId:'t',commandId:'cmd'});d.settleSteer(token,'unknown');feed(d,req(matched?'changed':'different','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,matched?'baseline_isolated':'ambiguous');assert.equal(d.snapshot().requests_observed,2);}
});
test('refused candidate cannot qualify, including a conflicting trace preceding the refusal',async()=>{
 for(const before of [false,true]){const d=make('without',[]);d.begin('initial');d.bind('s','t');feed(d,req('initial','ordinary'));const token=d.prepareSteer('changed',{sessionId:'s',turnId:'t',commandId:'cmd'});if(before){feed(d,req('changed','ordinary'));await d.settled();assert.equal(d.snapshot().status,'baseline_isolated');}d.settleSteer(token,'refused');if(!before)feed(d,req('changed','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'ambiguous');}
});
test('pending steer does not invalidate still-in-flight initial requests or advance turn/read ordinals',async()=>{
 const hooks=[identifiedHook(readIds[0],'A','reading-a'),identifiedHook(readIds[1],'B','reading-b')];const d=new MuseDelivery({arm:'with',workspace:'/owned',readHooks:async()=>hooks});d.begin('initial');d.bind('s','t');const token=d.prepareSteer('changed',{sessionId:'s',turnId:'t',commandId:'cmd'});feed(d,req('initial',markedContext(readIds[0],'A')));d.settleSteer(token,'accepted');feed(d,req('changed',markedContext(readIds[1],'B')));await d.finishTurn();assert.deepEqual(d.snapshot().request_attribution.map(x=>[x.ordinal,x.reading_id]),[[1,'reading-a'],[2,'reading-b']]);assert.equal(d.snapshot().turn_ordinal,1);assert.equal(d.snapshot().status,'guidance_observed');
});
test('turn reset discards unused and refused candidates and late acknowledgements cannot bind the new turn',async()=>{
 for(const status of ['accepted','refused','unknown']){const d=make('without',[]);d.begin('first');d.bind('s','t1');const token=d.prepareSteer('old-steer',{sessionId:'s',turnId:'t1',commandId:'cmd'});if(status!=='unknown')d.settleSteer(token,status);await d.finishTurn();d.begin('new');d.bind('s','t2');d.settleSteer(token,'unknown');feed(d,req('old-steer','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'ambiguous');assert.equal(d.snapshot().turn_ordinal,2);}
});
test('observed steer hashes preserve cross-turn repetition ambiguity and bounded candidate storage',async()=>{
 const d=make('without',[]);d.begin('initial');d.bind('s','t1');const first=d.prepareSteer('repeated',{sessionId:'s',turnId:'t1',commandId:'cmd1'});d.settleSteer(first,'accepted');feed(d,req('repeated','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'baseline_isolated');d.begin('new');d.bind('s','t2');const second=d.prepareSteer('repeated',{sessionId:'s',turnId:'t2',commandId:'cmd2'});d.settleSteer(second,'accepted');feed(d,req('repeated','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'ambiguous');
 const bounded=make('without',[]);bounded.begin('task');bounded.bind('s','t');for(let i=0;i<64;i++)assert.ok(bounded.prepareSteer('new-'+i,{sessionId:'s',turnId:'t',commandId:'cmd-'+i}));assert.equal(bounded.prepareSteer('overflow',{sessionId:'s',turnId:'t',commandId:'overflow'}),null);assert.equal(bounded.snapshot().status,'unavailable');
});
test('baseline steering stays marker-free and quality prefix facts retain their original meaning',async()=>{
 for(const include of [false,true]){const quality='Preserve all correctness requirements.',initial=quality+'\n\nInitial',changed=include?quality+'\n\nChanged':'Changed';const d=new MuseDelivery({arm:'without',workspace:'/owned',qualityInstructions:quality,readHooks:async()=>[]});d.begin(initial);d.bind('s','t');feed(d,req(initial,quality));const token=d.prepareSteer(changed,{sessionId:'s',turnId:'t',commandId:'cmd'});d.settleSteer(token,'accepted');feed(d,req(changed,quality));await d.finishTurn();const s=d.snapshot();assert.equal(s.status,'baseline_isolated');assert.equal(s.shared_quality_observed,true);assert.equal(s.shared_quality_prompt_observed,include);assert.deepEqual(s.request_attribution,[]);assert.ok(!JSON.stringify(s).includes(quality));}
});


test('accepted or uncertain unused steer retains conservative cross-turn ambiguity',async()=>{
 for(const status of ['accepted','unknown']){const d=make('without',[]);d.begin('initial');d.bind('s','t1');feed(d,req('initial','ordinary'));const token=d.prepareSteer('possibly-old-input',{sessionId:'s',turnId:'t1',commandId:'cmd'});d.settleSteer(token,status);await d.finishTurn();d.begin('possibly-old-input');d.bind('s','t2');feed(d,req('possibly-old-input','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'ambiguous');}
});
test('late old-steer ACK can only downgrade overlapping new-turn baseline evidence',async()=>{
 for(const before of [false,true]){const d=make('without',[]);d.begin('initial');d.bind('s','t1');const token=d.prepareSteer('same-input',{sessionId:'s',turnId:'t1',commandId:'cmd'});await d.finishTurn();d.begin('same-input');d.bind('s','t2');if(before){feed(d,req('same-input','ordinary'));await d.settled();assert.equal(d.snapshot().status,'baseline_isolated');}d.settleSteer(token,'accepted');if(!before)feed(d,req('same-input','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'ambiguous');}
});


test('authoritative native continuation creates a separately scoped current-policy delivery record',async()=>{
 let hooks=[identifiedHook(readIds[0],'A','reading-a')];const d=new MuseDelivery({arm:'with',workspace:'/owned',readHooks:async()=>hooks});d.begin('initial');d.bind('s','t1');feed(d,req('initial',markedContext(readIds[0],'A')));const token=d.prepareSteer('steer',{sessionId:'s',turnId:'t1',commandId:'cmd'});d.settleSteer(token,'accepted');await d.finishTurn();assert.equal(d.snapshot().status,'guidance_observed');assert.equal(d.continueSteer('cmd','s','native-t2'),true);assert.equal(d.snapshot().turn_ordinal,2);assert.equal(d.snapshot().requests_observed,0);hooks=[identifiedHook(readIds[1],'B','reading-b')];feed(d,req('steer',markedContext(readIds[1],'B')));await d.finishTurn();assert.equal(d.snapshot().status,'guidance_observed');assert.deepEqual(d.snapshot().request_attribution.map(x=>x.reading_id),['reading-b']);assert.equal(d.continueSteer('cmd','s','another'),false);
});
test('pre-ACK native continuation does not falsely become repeated-input ambiguity after acceptance',async()=>{
 const d=make('without',[]);d.begin('initial');d.bind('s','t1');const token=d.prepareSteer('steer',{sessionId:'s',turnId:'t1',commandId:'cmd'});await d.finishTurn();assert.equal(d.continueSteer('cmd','s','native-t2'),true);d.settleSteer(token,'accepted');feed(d,req('steer','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'baseline_isolated');d.begin('steer');d.bind('s','unrelated-t3');feed(d,req('steer','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'ambiguous');
});


test('native coalescing retains exact pending input candidates in the authoritative continuation',async()=>{
 const d=make('without',[]);d.begin('initial');d.bind('s','t1');const one=d.prepareSteer('first',{sessionId:'s',turnId:'t1',commandId:'one'}),two=d.prepareSteer('second',{sessionId:'s',turnId:'t1',commandId:'two'});d.settleSteer(one,'accepted');await d.finishTurn();assert.equal(d.continueSteer('one','s','native-t2'),true);d.settleSteer(two,'accepted');feed(d,req('second','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'baseline_isolated');assert.equal(d.snapshot().turn_ordinal,2);assert.equal(d.snapshot().requests_observed,1);assert.equal(d.continueSteer('two','s','native-t3'),true);feed(d,req('second','ordinary'));await d.finishTurn();assert.equal(d.snapshot().status,'baseline_isolated');
});


test('native committed coalescing qualifies only the exact owned ordered text parts',async()=>{
 for(const variant of ['exact','swapped','extra','unsubmitted']){const d=make('without',[]);d.begin('initial');d.bind('s','t1');const one=d.prepareSteer('first',{sessionId:'s',turnId:'t1',commandId:'one'}),two=d.prepareSteer('second',{sessionId:'s',turnId:'t1',commandId:'two'});d.settleSteer(one,'accepted');d.settleSteer(two,'accepted');await d.finishTurn();d.continueSteer('one','s','t2');assert.equal(d.setContinuationInputs(['one','two'],'s','t2'),true);const request=req('ignored','ordinary');let parts=['first','second'];if(variant==='swapped')parts.reverse();if(variant==='extra')parts.push('extra');if(variant==='unsubmitted')parts[1]='other';request.input[1].content=parts.map(text=>({type:'input_text',text}));feed(d,request);await d.finishTurn();assert.equal(d.snapshot().status,variant==='exact'?'baseline_isolated':'ambiguous');assert.equal(d.snapshot().requests_observed,1);}
});
test('committed coalescing candidates alone never repair prior mismatched requests',async()=>{
 const d=make('without',[]);d.begin('initial');d.bind('s','t1');for(const commandId of ['first','second']){const t=d.prepareSteer(commandId,{sessionId:'s',turnId:'t1',commandId});d.settleSteer(t,'accepted');}await d.finishTurn();d.continueSteer('first','s','t2');const r=req('ignored','ordinary');r.input[1].content=['first','second'].map(text=>({type:'input_text',text}));feed(d,r);await d.settled();assert.equal(d.snapshot().status,'ambiguous');d.setContinuationInputs(['first','second'],'s','t2');assert.equal(d.snapshot().status,'ambiguous');assert.equal(d.setContinuationInputs(['unowned'],'s','t2'),false);
});


test('late refusal of an owned coalesced input invalidates current continuation evidence',async()=>{
 const d=make('without',[]);d.begin('initial');d.bind('s','t1');
 const one=d.prepareSteer('first',{sessionId:'s',turnId:'t1',commandId:'one'}),two=d.prepareSteer('second',{sessionId:'s',turnId:'t1',commandId:'two'});
 d.settleSteer(one,'accepted');await d.finishTurn();assert.equal(d.continueSteer('one','s','t2'),true);assert.equal(d.setContinuationInputs(['one','two'],'s','t2'),true);
 const request=req('unused','ordinary');request.input.at(-1).content=[{type:'input_text',text:'first'},{type:'input_text',text:'second'}];feed(d,request);await d.settled();assert.equal(d.snapshot().status,'baseline_isolated');
 d.settleSteer(two,'refused');assert.equal(d.snapshot().status,'unavailable');
});
