import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {sessionWorkspaceHtml,sessionWorkspaceShell} from '../src/session-workspace-view.mjs';import {newerSessionSnapshot,sessionStopReady,cleanupUnconfirmed} from '../web/session-app.mjs';
test('Claude shell retains controls and Presence policy while identifying supported sessions',async()=>{const html=sessionWorkspaceHtml(await fs.readFile(new URL('../web/terminal-app.html',import.meta.url),'utf8'));for(const id of ['target','shared','send-shared','presence-policy-depth','presence-policy-updates','presence-policy-conversation','usage-input-with','focus-with'])assert.ok(html.includes('id="'+id+'"'));assert.ok(html.includes('/session-app.mjs'));assert.ok(html.includes('/session-panes.css'));assert.ok(!html.includes('/xterm.js'));assert.ok(!html.includes('Two real Muse terminals'));assert.ok(html.includes('Open sessions'));});
test('stale or malformed snapshots cannot replace current session state',()=>{const s={version:3,status:'ready',arms:{}};assert.equal(newerSessionSnapshot(2,s),true);assert.equal(newerSessionSnapshot(3,s),false);assert.equal(newerSessionSnapshot(4,s),false);assert.equal(newerSessionSnapshot(0,{...s,version:'3'}),false);});
test('Stop stays available after disconnect when a token exists',()=>{const s={state:{status:'ready'},token:'token',pending:false,confirmed:false};assert.equal(sessionStopReady(s),true);assert.equal(sessionStopReady({...s,token:null}),false);assert.equal(sessionStopReady({...s,pending:true}),false);assert.equal(sessionStopReady({...s,confirmed:true}),false);});

test('unconfirmed cleanup remains distinct from ordinary closure',()=>{assert.equal(cleanupUnconfirmed({status:'closed',error:'cleanup_unconfirmed'}),true);assert.equal(cleanupUnconfirmed({status:'closed',error:null}),false);});

test('shared presentation shell understands supported-session readiness',async()=>{const code=sessionWorkspaceShell(await fs.readFile(new URL('../web/terminal-shell.mjs',import.meta.url),'utf8'));assert.ok(code.includes("text === 'Ready'"));assert.ok(code.includes("['Ready', 'Working', 'Approval needed']"));assert.ok(!code.includes("?.textContent.trim() === 'Interactive'"));});

test('supported composer has an accessible arrow and an explicit Both choice',async()=>{const html=sessionWorkspaceHtml(await fs.readFile(new URL('../web/terminal-app.html',import.meta.url),'utf8'));assert.ok(html.includes('id="send-shared" aria-label="Send to both agents"'));assert.ok(html.includes('<svg viewBox="0 0 24 24"'));assert.ok(html.includes('data-target="both"'));assert.ok(html.includes('Enter sends; Shift+Enter adds a line.'));});

test('workspace removes long Pulse disclaimers and explains actual model usage',async()=>{
 const html=sessionWorkspaceHtml(await fs.readFile(new URL('../web/terminal-app.html',import.meta.url),'utf8'));
 for(const text of ['Recorded in this browser tab','Shows the source policy, not proof','Pulse reflects collaboration settings','A reading or hook record does not prove','Public Muse messages and approval requests remain visible','About these numbers'])assert.ok(!html.includes(text),text);
 for(const text of ['Model usage guide','Completed model responses with reported usage across this session.','Already included in input tokens.','Command/Ctrl-click adds the other.','id="usage-note"'])assert.ok(html.includes(text),text);
});


test('composer starts empty without placeholder and clearly selects Both',async()=>{
 const html=sessionWorkspaceHtml(await fs.readFile(new URL('../web/terminal-app.html',import.meta.url),'utf8'));
 const composer=html.match(/<textarea\b([^>]*\bid="shared"[^>]*)>([\s\S]*?)<\/textarea>/);
 assert.ok(composer);assert.doesNotMatch(composer[1],/\bplaceholder=/);assert.equal(composer[2],'');
 assert.match(html,/<input[^>]*id="target"[^>]*value="both"/);
 assert.match(html,/<button[^>]*data-target="both"[^>]*aria-pressed="true"/);
});
