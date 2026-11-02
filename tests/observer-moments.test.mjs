import test from 'node:test';
import assert from 'node:assert/strict';
import {presenceMomentCandidates,presenceMomentView,presenceChangeLabel,presenceMomentReference} from '../src/observer-comparison.mjs';
import {comparisonPacketView,validateComparisonReport} from '../src/observer-report.mjs';
import {presenceObserverHtml,renderComparisonGraphic} from '../web/session-evidence.mjs';
import {scenarioPacket,scenarioReport,full,brief} from './helpers/presence-report-scenarios.mjs';
import {inertObserver} from './helpers/observer-state.mjs';

const request=(id,turn,ordinal,controls)=>({id,kind:'presence_request',arm:'with',turn_ordinal:turn,ordinal,status:'guidance_observed',controls});
const reply=(id,arm,index,text)=>({id,kind:'message',arm,index,author:'Muse',phase:'finalAnswer',text});
const links=e=>e.filter(v=>v.kind==='completion_link');
const textOf=node=>[node.textContent??'',...(node.children??[]).map(textOf)].join(' ');

test('moments describe the actual changed control, not an invented full-to-brief transition',()=>{
 const before=request('presence.request.with.3',4,3,{...brief,unsolicited_update:'send'}),after=request('presence.request.with.4',4,4,{...brief,unsolicited_update:'send',conversation_style:'conversational'});
 const [{record}]=presenceMomentCandidates([after,before]);assert.deepEqual(record.changed_controls,['conversation_style']);assert.equal(record.before_id,before.id);assert.equal(record.after_id,after.id);assert.equal(record.scope,'request_change');
 assert.equal(presenceChangeLabel(before,after),'self-contained → conversational');assert.equal(presenceMomentReference({before,after}),'Turn 4 · requests 3 → 4');
});

test('identical controls do not create a moment merely because reading or request IDs differ',()=>{
 const rows=[request('r1',1,1,brief),request('r2',2,1,{...brief}),{id:'reading1',kind:'presence_reading',controls:brief,received_at:'2026-11-01T10:00:00.000Z'},{id:'reading2',kind:'presence_reading',controls:{...brief},received_at:'2026-11-01T10:01:00.000Z'}];
 assert.deepEqual(presenceMomentCandidates(rows),[]);
});

test('exact before and after replies come from their own completion links',()=>{
 const {packet}=scenarioPacket(),e=comparisonPacketView(packet).payload.evidence,m=e.find(v=>v.kind==='presence_moment'&&v.scope==='linked_reply_change');assert.ok(m);
 assert.equal(m.with_before_message_id,'message.with.2');assert.equal(m.with_after_message_id,'message.with.4');
 for(const [requestId,linkId,messageId]of [[m.before_id,m.with_before_link_id,m.with_before_message_id],[m.after_id,m.with_after_link_id,m.with_after_message_id]]){const link=e.find(v=>v.id===linkId);assert.equal(link.request_id,requestId);assert.equal(link.message_id,messageId);assert.equal(link.status,'request_linked');}
});

test('ordinal-only final metadata does not become an exact response change',()=>{
 const rows=[request('r1',1,1,full),request('r2',2,1,brief),reply('a','with',2,'Earlier answer'),reply('b','with',4,'Later answer')];
 for(const r of rows.filter(v=>v.kind==='presence_request'))Object.assign(r,{response_linkage:'public_final_matched',public_final_ordinals:[1]});
 let m=presenceMomentCandidates(rows)[0].record;assert.equal(m.scope,'request_change');assert.equal(m.with_before_link_id,null);assert.equal(m.with_after_link_id,null);assert.equal(m.with_context_message_id,'b');
 rows.push({id:'link.after',kind:'completion_link',arm:'with',status:'request_linked',request_id:'r2',message_id:'b'});m=presenceMomentCandidates(rows)[0].record;assert.equal(m.scope,'request_change');assert.equal(m.with_before_message_id,null);assert.equal(m.with_after_message_id,'b');
});

test('baseline replies are independent references, not joined by equal arm turn ordinals',()=>{
 const matchedOrdinal={...reply('baseline.equal','without',2,'Equal ordinal'),turn_ordinal:2},laterReference={...reply('baseline.reference','without',90,'Independent later reference'),turn_ordinal:77};
 const [{record}]=presenceMomentCandidates([request('r1',1,1,full),request('r2',2,1,brief),matchedOrdinal,laterReference]);
 assert.equal(record.baseline_message_id,'baseline.reference');assert.equal(record.baseline_relation,'independent_reference');assert.equal(record.scope,'request_change');
});

test('byte limits keep moment dependencies whole and omit an oversized response moment',()=>{
 for(const options of [{},{maxBytes:12000,largeLatest:true}]){const {packet}=scenarioPacket('aligned',options),v=comparisonPacketView(packet),e=v.payload.evidence,ids=new Set(e.map(x=>x.id)),moments=e.filter(x=>x.kind==='presence_moment');assert.ok(v.bytes<=(options.maxBytes??48000));
  if(options.largeLatest)assert.equal(moments.length,0);else assert.ok(moments.length>0);
  for(const m of moments)for(const key of ['before_id','after_id','with_before_link_id','with_after_link_id','with_before_message_id','with_after_message_id','with_context_message_id','baseline_message_id'])if(m[key])assert.ok(ids.has(m[key]),key+' must resolve');
  for(const link of links(e)){assert.ok(ids.has(link.message_id));if(link.request_id)assert.ok(ids.has(link.request_id));}
 }
});

test('model moment selections are closed, known, unique and tied to a baseline public final',()=>{
 const {packet}=scenarioPacket(),valid=scenarioReport(packet);assert.equal(validateComparisonReport(valid,packet).presence.moments.length,1);
 for(const mutate of [r=>r.presence.moments[0].moment_id='invented',r=>r.presence.moments[0].baseline_message_id='message.with.4',r=>r.presence.moments[0].baseline_message_id='none',r=>r.presence.moments.push({...r.presence.moments[0]}),r=>r.presence.moments[0].scope='linked_reply_change',r=>r.presence.moments[0].label='<img src=x>']){const r=structuredClone(valid);mutate(r);assert.throws(()=>validateComparisonReport(r,packet),/comparison_report_moment_invalid/);}
 let r=structuredClone(valid);r.presence.moments=[];assert.throws(()=>validateComparisonReport(r,packet),/comparison_report_moment_required/);
 r=structuredClone(valid);r.presence.evidence_ids=r.presence.evidence_ids.filter(id=>id!==r.presence.moments[0].moment_id);assert.throws(()=>validateComparisonReport(r,packet),/comparison_report_moment_reference_required/);
});

test('the primary graphic shows factual changes and saved replies, with model caution confined to Details',()=>{
 const {packet}=scenarioPacket(),p=comparisonPacketView(packet),record={evidence:p.payload.evidence,report:scenarioReport(packet)};record.report.presence.text='BOTTOM_CAUTION_SENTINEL';
 const view=presenceMomentView(record);assert.equal(view[0].with_before.id,'message.with.2');assert.equal(view[0].with_after.id,'message.with.4');
 const f=inertObserver(),host=f.nodes['comparison-graphic'];renderComparisonGraphic(host,record,{sourceHost:f.nodes['comparison-node-sources']});const text=textOf(host);
 assert.match(text,/fuller replies → brief replies/);assert.match(text,/Before/);assert.match(text,/After/);assert.match(text,/overlapping changes/);assert.ok(!text.includes('BOTTOM_CAUTION_SENTINEL'));
 const html=presenceObserverHtml(),primary=html.slice(html.indexOf('data-comparison-result'),html.indexOf('data-comparison-audit'));assert.ok(!primary.includes('data-comparison-presence'));assert.match(html.slice(html.indexOf('data-comparison-audit')),/data-comparison-presence/);
});

test('older reports prefer delivered request changes and show reading-only changes in time order',()=>{
 const readings=[{id:'presence.reading.1',kind:'presence_reading',controls:full,received_at:'2026-11-01T10:00:00.000Z'},{id:'presence.reading.2',kind:'presence_reading',controls:brief,received_at:'2026-11-01T10:01:00.000Z'},{id:'presence.reading.3',kind:'presence_reading',controls:full,received_at:'2026-11-01T10:02:00.000Z'}];
 const record={report:{presence:{}},evidence:readings};let view=presenceMomentView(record);assert.equal(view.length,2);assert.equal(view[0].after.id,'presence.reading.2');assert.equal(view[1].after.id,'presence.reading.3');
 record.evidence.push(request('r1',4,3,full),request('r2',4,4,brief));view=presenceMomentView(record);assert.equal(view.length,1);assert.equal(view[0].after.id,'r2');assert.equal(view[0].scope,'request_change');
});

test('two recorded changes share one literal saved reply comparison instead of duplicating it',()=>{
 const baselineBody='I preserved the original draft in an isolated copy before every client call and retained remote-only fields on a single conflict retry.';
 const adaptiveBody='The workspace has seven working sections with routines, communication, calming activities and games. '+ 'Each section keeps the requested behavior visible. '.repeat(4);
 const evidence=[{id:'presence.reading.1',kind:'presence_reading',controls:full,received_at:'2026-11-01T10:00:00.000Z'},{id:'presence.reading.2',kind:'presence_reading',controls:brief,received_at:'2026-11-01T10:01:00.000Z'},{id:'presence.reading.3',kind:'presence_reading',controls:full,received_at:'2026-11-01T10:02:00.000Z'},reply('baseline','without',1,'Done.\n\n'+baselineBody),reply('adaptive','with',1,adaptiveBody+'\n\nSeparate detail omitted from this excerpt.')];
 const f=inertObserver(),host=f.nodes['comparison-graphic'];renderComparisonGraphic(host,{evidence,report:{lanes:[],presence:{}}},{sourceHost:f.nodes['comparison-node-sources']});
 const walk=node=>[node,...(node.children??[]).flatMap(walk)],quotes=walk(host).filter(n=>n.tagName==='blockquote');assert.equal(quotes.length,2);
 assert.equal(quotes[0].textContent,baselineBody);assert.equal(quotes[1].textContent,adaptiveBody.replace(/\s+/g,' ').trim().slice(0,190)+'…');
 assert.equal(walk(host).filter(n=>n.className==='observer-moment-change').length,2);assert.equal(f.nodes['comparison-node-sources'].children.length,2);
});
