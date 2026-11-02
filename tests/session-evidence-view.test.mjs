import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {evidenceView,mountSessionEvidence,sessionEvidenceHtml} from '../web/session-evidence.mjs';import {sessionWorkspaceHtml} from '../src/session-workspace-view.mjs';
const state=(extra={})=>({status:'ready',session_generation:1,evidence:{status:'saved',run_id:'run-abc',revision:3,last_saved_at:'2026-10-28T18:00:00Z'},...extra});
const report=(extra={})=>({schema_version:1,run_id:'run-abc',session_generation:1,revision:3,...extra});
function fixture(fetchExport=async()=>report(),download=async()=>{},readWindowEvents=()=>null){
 const nodes=Object.fromEntries(['evidence-save-status','evidence-export','evidence-export-status'].map(id=>[id,{textContent:'',disabled:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}}]));
 const container={querySelector:selector=>nodes[selector.slice(1)]??null};const panel=mountSessionEvidence(container,{fetchExport,download,readWindowEvents});return {panel,nodes,click:()=>nodes['evidence-export'].listeners.click()};
}
test('evidence status remains explicit; unknown/error fields cannot turn into saved proof',()=>{
 assert.match(evidenceView(state(),{connected:true}).label,/saved automatically at/);
 for(const status of ['not_started','disabled','unavailable','unknown']){const s=state({evidence:{status,error:'SECRET'}}),v=evidenceView(s,{connected:true});assert.equal(v.enabled,false);assert.ok(!v.label.includes('SECRET'));}
 assert.equal(evidenceView(state(),{connected:false}).enabled,false);assert.match(evidenceView(state(),{connected:false}).label,/Reconnect/);
 assert.equal(evidenceView(state({status:'closed'}),{connected:true}).enabled,true);
 assert.equal(evidenceView(state({evidence:{status:'saved',run_id:'../../private',revision:3}}),{connected:true}).enabled,false);
});
test('workspace without the legacy export still renders saved evidence status',()=>{
 const nodes={'evidence-save-status':{textContent:''},'evidence-export-status':{textContent:''}};
 const panel=mountSessionEvidence({querySelector:s=>nodes[s.slice(1)]??null},{fetchExport:async()=>{throw Error('unexpected export');}});
 panel.render(state(),{connected:true});assert.match(nodes['evidence-save-status'].textContent,/saved automatically at/);
 assert.ok(!sessionEvidenceHtml({includeExport:false}).includes('id="evidence-export"'));
});
test('adapter keeps measurement contract and places compact export controls inside it',async()=>{
 const html=sessionWorkspaceHtml(await fs.readFile(new URL('../web/terminal-app.html',import.meta.url),'utf8'));const start=html.indexOf('id="session-measurement"'),end=html.indexOf('</details>',start);
 assert.ok(start>=0);assert.ok(html.indexOf('id="session-evidence"',start)<end);assert.ok(html.includes('data-measure-action="review"'));assert.ok(html.includes('class="result-metrics"'));assert.match(sessionEvidenceHtml(),/Export evidence/);
});
test('render never exports automatically, and pending clicks cannot duplicate a download',async()=>{
 let release,calls=0;const downloads=[];const f=fixture(async generation=>{calls++;assert.equal(generation,1);return new Promise(r=>{release=r;});},async(...args)=>downloads.push(args));
 f.panel.render(state(),{connected:true});assert.equal(calls,0);const first=f.click();await f.click();assert.equal(calls,1);assert.equal(f.nodes['evidence-export'].disabled,true);release(report());await first;
 assert.equal(downloads.length,1);assert.equal(downloads[0][1],'presence-comparison-run-abc.json');assert.match(f.nodes['evidence-export-status'].textContent,/prepared for download/);assert.equal(f.nodes['evidence-export'].disabled,false);
});
test('wrong schema/run/generation and stale report revisions cannot download',async()=>{
 for(const change of [{schema_version:2},{run_id:'other'},{session_generation:2},{revision:2},{revision:null}]){let downloads=0;const f=fixture(async()=>report(change),async()=>downloads++);f.panel.render(state(),{connected:true});await f.click();assert.equal(downloads,0);assert.match(f.nodes['evidence-export-status'].textContent,/could not be confirmed/);}
});
test('generation/disconnection refuse export; a valid advancing-run checkpoint remains downloadable',async()=>{
 for(const mode of ['generation','revision','disconnect']){let release,downloads=0;const f=fixture(()=>new Promise(r=>{release=r;}),async()=>downloads++);f.panel.render(state(),{connected:true});const pending=f.click();
  if(mode==='generation')f.panel.render(state({session_generation:2,evidence:{status:'saved',run_id:'run-new',revision:1}}),{connected:true});
  if(mode==='revision')f.panel.render(state({evidence:{status:'saved',run_id:'run-abc',revision:4}}),{connected:true});
  if(mode==='disconnect')f.panel.render(state(),{connected:false});
  release(report());await pending;assert.equal(downloads,mode==='revision'?1:0);assert.match(f.nodes['evidence-export-status'].textContent,mode==='generation'?/session changed/:mode==='revision'?/newer evidence is available/:/connection changed/);
 }
});
test('a fresh flushed revision is exportable; failures never expose server diagnostics',async()=>{
 const downloads=[];const f=fixture(async()=>report({revision:4}),async(...args)=>downloads.push(args));f.panel.render(state({evidence:{status:'saving',run_id:'run-abc',revision:3}}),{connected:true});await f.click();assert.equal(downloads.length,1);
 const broken=fixture(async()=>{throw Error('SECRET provider/path diagnostic');});broken.panel.render(state(),{connected:true});await broken.click();assert.ok(!broken.nodes['evidence-export-status'].textContent.includes('SECRET'));assert.match(broken.nodes['evidence-export-status'].textContent,/could not be confirmed/);
});
test('save failure during fetch refuses export; a later revision during download is labelled accurately',async()=>{
 let release,downloads=0;const first=fixture(()=>new Promise(r=>{release=r;}),async()=>downloads++);first.panel.render(state(),{connected:true});const pending=first.click();first.panel.render(state({evidence:{status:'unavailable',run_id:'run-abc',revision:3}}),{connected:true});release(report());await pending;assert.equal(downloads,0);assert.match(first.nodes['evidence-export-status'].textContent,/could not be confirmed/);
 let finish;const second=fixture(async()=>report(),()=>new Promise(r=>{finish=r;}));second.panel.render(state(),{connected:true});const downloadPending=second.click();await Promise.resolve();second.panel.render(state({evidence:{status:'saved',run_id:'run-abc',revision:4}}),{connected:true});finish();await downloadPending;assert.match(second.nodes['evidence-export-status'].textContent,/newer evidence is available/);
});

const LEDGER_ID='12345678-1234-1234-1234-1234567890ab';
const ledgerEvent=(extra={})=>({window_id:1,sample_id:1,sample_kind:'final',phase:'sample',at_ms:Date.parse('2026-10-28T18:00:01Z'),reason:'send',status:'captured',...extra});
const ledger=(extra={},events=[ledgerEvent()])=>({ledger_id:LEDGER_ID,session_generation:1,events,events_omitted:0,...extra});
test('matching ledger attaches bounded download_only capture without private unknown fields',async()=>{
 const downloads=[];
 const events=[ledgerEvent({transcript:'SECRET',input_text:'SECRET',capsule_body:'SECRET',unknown_private:'SECRET'})];
 const f=fixture(async()=>report(),async(...args)=>{downloads.push(args);},()=>ledger({transcript:'SECRET',text:'SECRET',capsule:'SECRET',credential:'SECRET'},events));
 f.panel.render(state(),{connected:true});await f.click();
 assert.equal(downloads.length,1);assert.equal(downloads[0][1],'presence-comparison-run-abc.json');
 const exported=downloads[0][0];
 assert.equal(exported.schema_version,1);assert.equal(exported.run_id,'run-abc');
 assert.equal(exported.browser_capture.persistence,'download_only');
 assert.equal(exported.browser_capture.source,'current_browser_tab');
 assert.equal(exported.browser_capture.schema_version,1);
 assert.equal(exported.browser_capture.session_generation,1);
 assert.equal(exported.browser_capture.ledger_id,LEDGER_ID);
 assert.equal(exported.browser_capture.events.length,1);
 assert.deepEqual(exported.browser_capture.events[0],{window_id:1,sample_id:1,sample_kind:'final',phase:'sample',at_ms:Date.parse('2026-10-28T18:00:01Z'),reason:'send',status:'captured'});
 assert.ok(!JSON.stringify(exported).includes('SECRET'));
});
test('generation mismatch excludes window capture from the download',async()=>{
 const downloads=[];
 const f=fixture(async()=>report({session_generation:1}),async(...args)=>{downloads.push(args);},()=>ledger({session_generation:2}));
 f.panel.render(state(),{connected:true});await f.click();
 assert.equal(downloads.length,1);
 assert.ok(!('browser_capture' in downloads[0][0]));
});
test('bounded ledger keeps only the last 200 events and counts omission',async()=>{
 const downloads=[];
 const many=Array.from({length:250},(_,index)=>ledgerEvent({window_id:index+1,sample_id:index+1}));
 const f=fixture(async()=>report(),async(...args)=>{downloads.push(args);},()=>ledger({events_omitted:5},many));
 f.panel.render(state(),{connected:true});await f.click();
 assert.equal(downloads.length,1);
 const capture=downloads[0][0].browser_capture;
 assert.equal(capture.persistence,'download_only');
 assert.equal(capture.events.length,200);
 assert.equal(capture.events[0].window_id,51);assert.equal(capture.events.at(-1).window_id,250);
 assert.equal(capture.events_omitted,55);
 assert.ok(!JSON.stringify(downloads[0][0]).includes('SECRET'));
});
test('capture event panel distinguishes acknowledged, pending and unsaved logs',async()=>{
 const {mountWindowEvents}=await import('../web/session-evidence.mjs');const summary={textContent:''},body={children:[],replaceChildren(...x){this.children=x;},append(x){this.children.push(x);}};let persistence='saving';const document={createElement:()=>({children:[],textContent:'',append(x){this.children.push(x);}})};const container={ownerDocument:document,querySelector:s=>s==='[data-window-summary]'?summary:s==='[data-window-events]'?body:null};
 const panel=mountWindowEvents(container,{readEvents:()=>ledger(),readPersistence:()=>persistence});panel.render(state());assert.match(summary.textContent,/Saving locally/);persistence='saved';panel.render(state());assert.match(summary.textContent,/Saved locally/);persistence='failed';panel.render(state());assert.match(summary.textContent,/Not saved/);
});
