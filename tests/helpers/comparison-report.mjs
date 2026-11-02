import {comparisonPacketView} from '../../src/observer-report.mjs';
// Authored test output, never evidence of actual Muse interpretation quality.
export function comparisonFixtureReport(packet,{assessment='unverified'}={}){
 const payload=comparisonPacketView(packet).payload,e=payload.evidence,has=id=>e.some(v=>v.id===id),find=id=>e.find(v=>v.id===id);
 const link=e.find(v=>v.kind==='completion_link'&&v.arm==='with'&&v.status==='request_linked'&&find(v.request_id)?.status==='guidance_observed');
 const replies=Object.fromEntries(['without','with'].map(arm=>[arm,(arm==='with'&&link?find(link.message_id):e.find(v=>v.kind==='message'&&v.arm===arm&&v.author==='Muse'))?.id]));
 const workRefs=arm=>[(has('artifact.'+arm)?'artifact.':'work.')+arm,...(has('file.'+arm+'.1')?['file.'+arm+'.1']:[])];
 const howRefs=arm=>[(arm==='with'&&link?link.request_id:e.find(v=>v.kind==='presence_request'&&v.arm===arm)?.id)??'presence.delivery.'+arm,replies[arm]??'inputs.'+arm];
 const refs=link?[link.id,link.request_id,link.message_id]:['presence.history'];
 const moments=e.filter(v=>v.kind==='presence_moment').slice(0,1).map(v=>({moment_id:v.id,baseline_message_id:e.find(r=>r.kind==='message'&&r.arm==='without'&&r.author==='Muse'&&r.phase==='finalAnswer')?.id??'none',label:'At the task handoff'}));
 return{
  paragraph:{text:'Muse and Muse + Presence describe the requested change in their public replies. Compare the concrete recorded guidance change, actual responses, produced work and resource use at the task handoff.',evidence_ids:[...new Set(['comparison','inputs.without','inputs.with',...moments.map(m=>m.moment_id),'presence.history',...refs,...Object.values(replies).filter(Boolean),...['without','with'].flatMap(arm=>[has('file.'+arm+'.1')?'file.'+arm+'.1':has('artifact.'+arm)?'artifact.'+arm:'work.'+arm,'telemetry.'+arm])])]},
  lanes:['without','with'].map(arm=>({arm,stages:[
   {kind:'what',text:has('artifact.'+arm)?'Compare the captured implementation and supplied test results.':'Work files are unavailable; recorded replies and historical results remain available.',evidence_ids:workRefs(arm)},
   {kind:'how',text:arm==='with'?'Compare the explanation and feedback response with the recorded Presence guidance.':'Compare the reply and feedback response against the task instructions.',evidence_ids:howRefs(arm)},
   {kind:'when',text:'Evaluate the recorded turn sequence, feedback, timing and resources together.',evidence_ids:['telemetry.'+arm,'interactions.'+arm]}
  ]})),
  presence:{assessment,text:link?'The request and public final are linked; assess the actual response and work against the delivered guidance.':'Exact reply binding was not recorded for this archived context.',evidence_ids:[...refs,...moments.map(m=>m.moment_id)],moments}
 };
}

// Authored v2 output for service/runner tests; legacy factory above is unchanged.
export function structuredFixtureReport(packet){
 const e=comparisonPacketView(packet).payload.evidence,byId=new Map(e.map(x=>[x.id,x])),messages=arm=>e.filter(x=>x.kind==='message'&&x.author==='Muse'&&x.arm===arm),chosen=Object.fromEntries(['without','with'].map(arm=>[arm,messages(arm)[0]??null]));
 const link=e.find(x=>x.kind==='completion_link'&&x.status==='request_linked'&&x.arm==='with'&&x.message_id===chosen.with?.id),policy=link?.request_id??e.find(x=>x.kind==='presence_request'&&x.arm==='with')?.id??'presence.current';
 const quote=arm=>({message_id:chosen[arm]?.id??'none',excerpt:chosen[arm]?.text.replace(/\s+/gu,' ').trim().slice(0,180).trim()??''});
 const refs=[...new Set(['comparison',policy,...Object.values(chosen).filter(Boolean).map(x=>x.id)])];
 const work=arm=>e.find(x=>x.kind==='file'&&x.arm===arm)?.id??`work.${arm}`;
 return{schema_version:2,highlights:Object.values(chosen).some(Boolean)?[{category:'content',title:'The responses and required work',explanation:{text:'Muse and Muse + Presence address the recorded task; compare the quoted explanation and feedback response with the recorded guidance.',evidence_ids:refs},policy_ids:[policy],without:quote('without'),with:quote('with')}]:[],overall:{text:'Compare the produced work with the supplied checks, session turns, feedback and interruption receipts. Total input, cache reads and input-minus-cache describe different resource quantities; interpret them alongside calls and recorded elapsed time.',evidence_ids:[...new Set(['comparison','inputs.without','inputs.with','telemetry.without','telemetry.with','interactions.without','interactions.with',policy,work('without'),work('with'),...(byId.has('resources.comparison')?['resources.comparison']:[])])]}};
}
