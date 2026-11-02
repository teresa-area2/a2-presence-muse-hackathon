// Synthetic native-facing fixtures; no processes, provider calls or user data.
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {StructuredPair} from '../../src/structured-pair.mjs';
import {ObserverReportHistory} from '../../src/observer-report-history.mjs';
import {buildComparisonPacket,comparisonPacketView} from '../../src/observer-report.mjs';
import {comparisonFixtureReport} from './comparison-report.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const full={response_extent:'full',unsolicited_update:'send',conversation_style:'conversational'};
export const brief={response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'};
// These synthetic pairs intentionally reuse the production snapshot without
// running its constructor. Initialize the same empty approval state it creates.
export function initializeApprovalProjectionFixture(pair){
 pair.approvalPending=Object.fromEntries(['without','with'].map(arm=>[arm,new Map()]));
 pair.approvalDiagnostics=Object.fromEntries(['without','with'].map(arm=>[arm,{events:[],events_omitted:0,seen:new Map()}]));
 pair.approvalSnapshot=StructuredPair.prototype.approvalSnapshot;
 return pair;
}
export function nativeReportPair(){
 const pair=initializeApprovalProjectionFixture(new EventEmitter());Object.assign(pair,{state:'ready',error:null,comparisonMatched:true,arms:{},generation:1});
 for(const [i,arm]of ['without','with'].entries()){
  const native={state:'ready',requestedModel:'muse-spark-1.3',events:[],turnEventStart:0,turnId:null,client:{sessionId:uuid(i+1),approvals:new Map()},activeTurn:()=>null,elapsed:()=>({status:'unavailable'}),usage:{snapshot:()=>({status:'not_reported'})},interruptExpected:new Set(),questions:{snapshot:()=>[],metrics:()=>({})}};
  native.delivery={usage:{snapshot:()=>({status:'not_reported'})},current:null,snapshot:()=>native._delivery??{},modelSnapshot:()=>({requested_model:'muse-spark-1.3',observed_models:['muse-spark-1.3'],requests_observed:1,status:'observed',unidentified_requests:0})};pair.arms[arm]=native;
 }
 pair.snapshot=()=>({...StructuredPair.prototype.snapshot.call(pair),session_generation:pair.generation});
 pair.close=()=>{pair.state='closed';for(const a of Object.values(pair.arms)){a.state='closed';if(a._delivery)a._delivery.trace_ended=true;}pair.emit('status');};
 return pair;
}
export function appendReportTurn(pair,arm,{ordinal,controls=brief,text='Keep the draft and check conflicts.',prompt='Summarize the save guard.',target='both',linked=true}={}){
 const a=pair.arms[arm],turnId=uuid((arm==='with'?1000:2000)+ordinal);a.events.push({type:'human_message',payload:{text:prompt,message_phase:'sent',submission_target:target}});a.turnEventStart=a.events.length;a.events.push({type:'public_message',payload:{text,message_phase:'finalAnswer',truncated:false,cut_off:false}});a.turnId=turnId;a.lastTurnTerminal='completed';a.delivery.current={ordinal,sessionId:a.client.sessionId,turnId};
 const withPresence=arm==='with';a._delivery={status:withPresence?'guidance_observed':'baseline_isolated',turn_ordinal:ordinal,turn_completed:true,public_finals:1,requests_observed:1,hook_linkage:withPresence?'read_marker_matched':'unverified',response_linkage:withPresence&&linked?'public_final_matched':'unverified',request_attribution:withPresence?[{ordinal:1,status:'guidance_observed',read_id:uuid(3000+ordinal),reading_id:uuid(4000+ordinal),controls}]:[],response_attribution:withPresence&&linked?{status:'linked',linked_responses:1,linked_finals:1,requests:[{ordinal:1,status:'response_linked',presence:'guidance'}],finals:[{ordinal:1,status:'final_linked',request_ordinal:1,presence:'guidance'}]}:{status:'unverified'},trace_ended:false};
 return pair.snapshot();
}
export function scenarioPacket(kind='aligned',options={}){
 const pair=nativeReportPair(),history=new ObserverReportHistory(),work={};
 for(const arm of ['without','with']){appendReportTurn(pair,arm,{ordinal:1,controls:full,text:'Fetch remote, compare base and remote with the latest draft, and ask about overlapping changes.'});history.observe(pair,pair.snapshot());}
 for(const arm of ['without','with']){appendReportTurn(pair,arm,{ordinal:2,controls:arm==='with'?brief:full,text:options.largeLatest&&arm==='with'?'oversized public reply '.repeat(900):kind==='no_clear_change'?'Fetch remote, compare base and remote with the latest draft, and ask about overlapping changes.':arm==='without'?'Fetch remote, retain the latest draft, check which fields overlap, and stop for explicit conflict resolution.':kind==='possible_tradeoff'?'Save immediately.':'Keep the latest draft; resolve overlapping edits before saving.',prompt:kind==='different_inputs'&&arm==='with'?'Make the summary shorter.':'Summarize the save guard.',target:kind==='different_inputs'&&arm==='with'?'with':'both',linked:kind!=='unverified'});history.observe(pair,pair.snapshot());}
 if(kind==='different_inputs')pair.comparisonMatched=false;
 for(const arm of ['without','with']){const text=kind==='possible_tradeoff'&&arm==='with'?'export const mayOverwrite = () => true;\n':'export const mayOverwrite = (base, remote) => base === remote;\n',files=[{path:'src/save.mjs',text,sha256:sha(text)}];work[arm]={status:'observed',artifact_sha256:sha(JSON.stringify(files.map(({path,sha256})=>({path,sha256})))),files,omitted_files:0,checks:null};}
 return{pair,history,work,packet:buildComparisonPacket(pair.snapshot(),{work,history:history.snapshot(),now:Date.parse('2026-11-01T19:00:00Z'),...options})};
}
export function scenarioReport(packet,assessment='aligned'){
 const value=comparisonFixtureReport(packet,{assessment}),e=comparisonPacketView(packet).payload.evidence;
 const links=e.filter(v=>v.kind==='completion_link'&&v.arm==='with'&&v.status==='request_linked').sort((a,b)=>b.turn_ordinal-a.turn_ordinal),latest=links[0];
 if(latest){value.presence.evidence_ids=[latest.id,latest.request_id,latest.message_id];value.paragraph.evidence_ids=[...new Set(['comparison','inputs.without','inputs.with',latest.id,latest.request_id,latest.message_id,...['without','with'].flatMap(arm=>{const reply=e.find(v=>v.arm===arm&&v.kind==='message'&&v.author==='Muse');return[e.find(v=>v.arm===arm&&v.kind==='file')?.id??e.find(v=>v.arm===arm&&['artifact','work_status'].includes(v.kind))?.id,`telemetry.${arm}`,...(reply?[reply.id]:[])];})])];value.lanes[1].stages[1].evidence_ids=[latest.request_id,latest.message_id];}
 if(assessment==='no_clear_change'){const prior=links.find(v=>v.message_id!==latest?.message_id);if(prior)value.presence.evidence_ids.push(prior.message_id);}
 for(const moment of value.presence.moments){value.presence.evidence_ids.push(moment.moment_id);value.paragraph.evidence_ids.push(moment.moment_id);}
 value.presence.evidence_ids=[...new Set(value.presence.evidence_ids)];value.paragraph.evidence_ids=[...new Set(value.paragraph.evidence_ids)];
 value.presence.text=assessment==='aligned'?'The linked brief reply retains the overlap precondition while following terse guidance.':assessment==='possible_tradeoff'?'The terse reply and saved source omit the conflict guard, creating a quality tradeoff.':assessment==='no_clear_change'?'The guidance changed, but the captured final replies retain the same explanation.':'The guidance is recorded; its exact connection to this public reply is missing.';
 value.paragraph.text=assessment==='aligned'?'Muse explains each conflict step; Muse + Presence gives a compact handoff while keeping the overlap precondition. Both saved sources retain the guard. The linked reply follows the brief guidance; the recorded sequence and resource evidence supply the timing comparison.':assessment==='possible_tradeoff'?'Muse + Presence follows terse guidance but omits the required conflict guard in its reply and saved source. Muse retains that guard. The shorter handoff carries a substantive work defect, so its resource and interaction tradeoffs need to be assessed alongside that loss.':assessment==='no_clear_change'?'The guidance changed, but the two captured Muse + Presence replies retain the same explanation. Both saved sources keep the guard. Compare that unchanged response with the recorded feedback, turn sequence and resource use.':'Muse and Muse + Presence have concrete public replies and work to compare. The saved guidance can inform the communication comparison, while the missing exact reply link limits that specific connection.';
 return value;
}
