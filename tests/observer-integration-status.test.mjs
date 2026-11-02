import test from 'node:test';
import assert from 'node:assert/strict';
import {presenceObserverHtml,mountComparisonReport} from '../web/session-evidence.mjs';
import {inertObserver,observerState} from './helpers/observer-state.mjs';

test('the optional observer identifies its assessment as Beta without a new primary panel',()=>{
 const html=presenceObserverHtml();
 assert.match(html,/<summary>Presence observer <span class="observer-badge observer-beta">Beta<\/span>/);
 assert.match(html,/<details class="card presence-observer" id="presence-observer" hidden>/);
 assert.match(html,/data-comparison-summary-layout="concise-comparison-v6"/);
});

for(const kind of ['failed','cancelled'])test(`a stale ${kind} assessment stays explicit and does not publish an interpretation`,()=>{
 const f=inertObserver();let calls=0;
 const panel=mountComparisonReport(f.container,{enabled:true,post:async()=>{calls++;},onState:()=>{}});
 const record={status:kind,stale:true,at:'2026-11-02T12:00:00Z',fingerprint:'synthetic',report:null,evidence:[],usage:{model_calls:1,input_tokens:57,output_tokens:11,elapsed_ms:9}};
 panel.render({...observerState(),muse_comparison:{status:kind,reports:[record]}},{connected:true});
 assert.match(f.nodes['comparison-status'].textContent,kind==='failed'?/unavailable.*No report was published.*no retry/i:/cancelled/i);
 assert.match(f.nodes['comparison-status'].textContent,/earlier work/i);
 assert.equal(f.nodes['comparison-result'].hidden,true);assert.equal(f.nodes['comparison-audit'].hidden,false);
 assert.match(f.nodes['comparison-usage'].textContent,/57 input/);assert.equal(calls,0);
 assert.match(f.nodes['comparison-sources'].textContent,/No validated report/);
});

test('connection and running status retain precedence without sending an assessment',()=>{
 const f=inertObserver();let calls=0;
 const panel=mountComparisonReport(f.container,{enabled:true,post:async()=>{calls++;},onState:()=>{}});
 const state={...observerState(),muse_comparison:{status:'running',reports:[{status:'failed',stale:true,report:null}]}};
 panel.render(state,{connected:false});assert.match(f.nodes['comparison-status'].textContent,/Disconnected/);assert.equal(f.nodes['comparison-prepare'].disabled,true);
 panel.render(state,{connected:true});assert.match(f.nodes['comparison-status'].textContent,/Muse is comparing/);assert.equal(f.nodes['comparison-prepare'].disabled,true);assert.equal(calls,0);
});
