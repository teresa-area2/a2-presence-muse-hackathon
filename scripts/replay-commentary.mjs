// Unattended presentation replay. Uses the existing Muse-built commentary policy;
// every source/message is a fixture. No browser, provider, OP or capture adapter.
import assert from 'node:assert/strict';
import {createCommentaryProjection} from '../web/commentary-policy.mjs';

const START = Date.parse('2026-10-31T12:00:00.000Z');
const source = (update,at) => ({source:{
  eligible:true,renderer:'coding-instructions.3',
  read_at:new Date(START+at).toISOString(),received_at:new Date(START+at).toISOString(),
  controls:{response_extent:update==='defer'?'terse':'full',unsolicited_update:update,conversation_style:'conversational'},
  capture:{state:'collecting',reason:null},
}});
const row = (id,phase,author='Muse') => Object.freeze({id,author,phase,text:'FIXTURE_'+id+'_NOT_EXPORTED'});

export function runCommentaryReplay(){
  if(arguments.length) throw new TypeError('runCommentaryReplay accepts no arguments');
  const adaptive=createCommentaryProjection(),baseline=createCommentaryProjection(),steps=[];
  const rows=[row('prompt','sent','You'),row('update1','commentary'),row('tool','activity'),row('approval','approval'),row('final','finalAnswer'),row('error','error')];
  const mandatory=['prompt','tool','approval','final','error'];
  let baselineReads=0,lastBaseline;
  function observe(phase,at,presence,expectedHeld,{connected=true}={}){
    const input=Object.freeze(rows.slice());
    const actual=adaptive.project(input,{arm:'with',generation:1,connected,now:START+at,presence});
    lastBaseline=baseline.project(input,{arm:'without',generation:1,connected,now:START+at,get presence(){baselineReads++;throw Error('baseline consulted Presence');}});
    assert.equal(baselineReads,0,'baseline must never consult Presence');
    assert.deepEqual(lastBaseline.visible,input);
    assert.equal(lastBaseline.held.length,0);
    assert.deepEqual(actual.held.map(r=>r.id),expectedHeld,'only the declared new optional rows may be held');
    assert.deepEqual(actual.visible.map(r=>r.id),rows.filter(r=>!expectedHeld.includes(r.id)).map(r=>r.id),'visible rows preserve source order');
    for(const id of mandatory) assert.ok(actual.visible.some(r=>r.id===id),'mandatory decision/output must remain visible');
    if(expectedHeld.length===0) assert.deepEqual(actual.visible,input,'release must restore source order');
    steps.push({phase,visible:actual.visible.length,held:actual.held.length});
  }
  observe('defer',0,source('defer',0),['update1']);
  observe('send',1000,source('send',1000),[]);
  rows.push(row('update2','commentary'));
  observe('defer_new',2000,source('defer',2000),['update2']);
  observe('stale',23001,source('defer',2000),[]);
  rows.push(row('update3','commentary'));
  observe('defer_again',24000,source('defer',24000),['update3']);
  adaptive.reveal();
  observe('manual_reveal',24001,source('defer',24000),[]);
  rows.push(row('update4','commentary'));
  observe('defer_before_disconnect',25000,source('defer',25000),['update4']);
  observe('disconnect',25001,source('defer',25000),[],{connected:false});
  const metrics=adaptive.metrics();
  assert.deepEqual(metrics,{schema_version:1,held_current:0,held_total:4,released_manual:1,released_automatic:3,history_resets:0,coverage:'observed'});
  return {
    synthetic:true,scope:'presentation_projection',model_runtime:'none',
    op_service_calls:0,provider_calls:0,human_benefit:'not_measured',
    steps,mandatory_rows_visible:true,released_in_source_order:true,
    baseline:{presence_reads:baselineReads,visible:lastBaseline.visible.length,held:lastBaseline.held.length},
    adaptive_metrics:metrics,
  };
}
