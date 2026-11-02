import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {StructuredPair} from '../src/structured-pair.mjs';
import {MusePublicEvents} from '../vendor/agent-lab/core/muse-public-events.mjs';
import {buildComparisonPacket,comparisonPacketView} from '../src/observer-report.mjs';
function pairFixture(){
 const ids={without:'10000000-0000-4000-8000-000000000001',with:'10000000-0000-4000-8000-000000000002'},turns={without:'20000000-0000-4000-8000-000000000001',with:'20000000-0000-4000-8000-000000000002'};
 const sessions=Object.fromEntries(['without','with'].map(arm=>{const client=new EventEmitter();Object.assign(client,{sessionId:ids[arm],startCommandId:'start',turnIds:new Set(),approvals:new Map(),closed:false,stopping:false,receipt(){},request:async(_method,p)=>({status:'accepted',commandId:p.commandId,turnId:turns[arm],disposition:'started',startedNewTurn:true}),stop:async()=>{}});return[arm,{client,ledger:new MusePublicEvents({arm,sessionId:ids[arm],evidenceMode:'fixture'}),usage:{observe(){},snapshot:()=>({status:'not_observed'})}}];}));
 let command=0;return{pair:new StructuredPair({sessions,makeId:()=>`synthetic-${++command}`}),sessions,turns};
}
for(const sample of [
 {name:'native truncated flag',text:'one two',truncated:true,cutOff:false,partial:true},
 {name:'native cut-off flag',text:'one two',truncated:false,cutOff:true,partial:true},
 {name:'native public text length clipping',text:'word '.repeat(14000),truncated:false,cutOff:false,partial:true},
 {name:'explicit complete native text',text:'one two',truncated:false,cutOff:false,partial:false}
])test(`${sample.name} survives native projection and cannot gain stronger observer coverage`,async()=>{
 const f=pairFixture();try{
  await f.pair.submit('Synthetic review');const client=f.sessions.with.client;
  client.emit('notification',{method:'item/completed',params:{sessionId:client.sessionId,item:{itemId:'synthetic-message',revision:1,kind:'agentMessage',turnId:f.turns.with,status:'completed',messagePhase:'finalAnswer',text:sample.text,truncated:sample.truncated,cutOff:sample.cutOff},sourceRange:{stream:{kind:'session',id:'synthetic-stream'},first:{id:'synthetic-event',sequence:1},last:{id:'synthetic-event',sequence:1}}}});
  const state={...f.pair.snapshot(),session_generation:1},message=state.arms.with.messages.find(m=>m.author==='Muse');
  assert.equal(message.text,sample.text.slice(0,65536));
  assert.equal(message.truncated,sample.truncated||sample.text.length>65536);assert.equal(message.cut_off,sample.cutOff);
  const metrics=comparisonPacketView(buildComparisonPacket(state)).payload.evidence.find(e=>e.id==='responses.comparison').arms.with;
  assert.equal(metrics.text.complete,!sample.partial);assert.equal(metrics.packet_text.complete,!sample.partial);
  if(sample.partial)assert.notEqual(metrics.final.source,'complete_text');else{assert.equal(metrics.final.source,'complete_text');assert.equal(metrics.final.total_words,2);assert.equal(metrics.final.mean_words_per_message,2);}
 }finally{await f.pair.stop();}
});

test('typed completeness metadata preserves exact native history and a forged flag cannot borrow its links',async()=>{
 const {nativeReportPair,appendReportTurn}=await import('./helpers/presence-report-scenarios.mjs');
 const {ObserverReportHistory,observerHistoryView}=await import('../src/observer-report-history.mjs');
 const pair=nativeReportPair();for(const arm of ['without','with'])appendReportTurn(pair,arm,{ordinal:1});
 const state=pair.snapshot(),history=new ObserverReportHistory();history.observe(pair,state);
 assert.equal(observerHistoryView(history.snapshot()).coverage.arms.with.source,'observed');
 let rows=comparisonPacketView(buildComparisonPacket(state,{history:history.snapshot()})).payload.evidence;
 assert.equal(rows.filter(e=>e.kind==='completion_link'&&e.arm==='with').length,1);
 const forged=structuredClone(state);forged.arms.with.messages.at(-1).cut_off=true;
 const rejected=new ObserverReportHistory();rejected.observe(pair,forged);
 assert.equal(observerHistoryView(rejected.snapshot()).coverage.arms.with.last_issue,'state_projection_mismatch');
 rows=comparisonPacketView(buildComparisonPacket(forged,{history:rejected.snapshot()})).payload.evidence;
 assert.equal(rows.filter(e=>e.kind==='completion_link'&&e.arm==='with').length,0);
});
