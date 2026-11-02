import test from 'node:test';import assert from 'node:assert/strict';
import {presenceConnectionSentence} from '../web/session-app.mjs';
const now=Date.parse('2026-10-28T18:30:00Z');
const source=(extra={})=>({eligible:true,read_at:new Date(now-1000).toISOString(),received_at:new Date(now-43000).toISOString(),capture:{state:'collecting'},...extra});
const sentence=s=>presenceConnectionSentence({source:s},{now});
test('connection copy is one sentence while keeping capture and receipt age distinct',()=>{
 assert.equal(sentence(source()),'Presence is capturing input; the last eligible guidance is 43s old.');
 assert.equal(sentence(source({capture:{state:'paused',reason:'unsupported_field'}})),'Capture is paused in this field; the last eligible guidance is 43s old.');
 assert.equal(sentence(source({capture:{state:'paused',reason:'secure_input'}})),'Capture is paused for secure input; the last eligible guidance is 43s old.');
 assert.equal(sentence(source({capture:{state:'waiting_for_input'}})),'Presence is waiting for input; the last eligible guidance is 43s old.');
 assert.equal(sentence(source({capture:{state:'off'}})),'Capture is off; the last eligible guidance is 43s old.');
});
test('missing/stale reads and disconnection cannot imply current capture or model fallback',()=>{
 for(const s of [null,source({read_at:null}),source({read_at:'invalid'}),source({read_at:new Date(now-21000).toISOString()}),source({read_at:new Date(now+6000).toISOString()})])assert.equal(sentence(s),'No current Presence reading is available.');
 assert.equal(presenceConnectionSentence({source:source()},{connected:false,now}),'The workspace connection is lost; Presence readings cannot be confirmed.');
});
test('fallback and unknown receipt times stay explicit without inventing eligibility cutoffs',()=>{
 assert.equal(sentence(source({eligible:false})),'Presence is capturing input; no eligible guidance is available.');
 assert.equal(sentence(source({received_at:null})),'Presence is capturing input; the guidance receipt time is unconfirmed.');
 assert.equal(sentence(source({received_at:new Date(now+1000).toISOString()})),'Presence is capturing input; the guidance receipt time is unconfirmed.');
 assert.equal(sentence(source({received_at:new Date(now-600000).toISOString()})),'Presence is capturing input; the last eligible guidance is 10m 0s old.');
});
test('buffered windows show waiting and expiry honestly',async()=>{
 const {textboxCaptureLabel}=await import('../web/terminal-presence-view.mjs');
 assert.equal(textboxCaptureLabel({window:'closed',last_submission:'queued'}),'Typing sample waiting for OP; a newer sample replaces it.');
 assert.equal(textboxCaptureLabel({window:'closed',last_submission:'expired'}),'Waiting typing sample expired without being sent.');
 assert.equal(textboxCaptureLabel({window:'closed',last_submission:'cancelled'}),'Typing-window refresh cancelled.');
});
