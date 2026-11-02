import test from 'node:test';
import assert from 'node:assert/strict';
import {presenceAction} from '../web/presence-action.mjs';
const current=(style,timing)=>({eligible:true,read_at:'2026-10-27T12:00:00Z',controls:{response_extent:'standard',conversation_style:style,unsolicited_update:timing}});
test('current guidance describes the actionable difference without claiming the model followed it',()=>{
  assert.match(presenceAction(current('conversational','defer')),/final answer.*optional updates wait/);
  assert.match(presenceAction(current('conversational','send')),/update or answer/);
  assert.match(presenceAction(current('self_contained','defer')),/avoid optional/);
  assert.match(presenceAction({eligible:false,read_at:'2026-10-27T12:00:00Z'}),/intended fallback is ordinary/);
  assert.match(presenceAction({}),/Awaiting/);
  assert.match(presenceAction({...current('conversational','send'),controls:{}}),/incomplete/);
  assert.match(presenceAction({...current('conversational','send'),controls:{conversation_style:'conversational',unsolicited_update:'send'}}),/incomplete/);
  assert.match(presenceAction(current('conversational','send'),{review:true}),/finished run/);
});
