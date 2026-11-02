import test from 'node:test';
import assert from 'node:assert/strict';
import {REMINDER_IDS,nativeControls} from '../src/native-controls.mjs';
test('every bundled reminder is disabled exactly once and other restrictions survive',()=>{
 const result=nativeControls(['-c','runtime_capabilities.plugin:tbh-reminders:reminder:todo-reminder.enabled=true','-c','run.workflow_trigger_mode="off"']);
 const values=result.filter((_,i)=>i%2===1);
 assert.equal(values.filter(x=>x.includes('tbh-reminders')).length,6);
 for(const id of ['memory','skill-reminder','todo-reminder','goal-reminder','verify-reminder','scope-reminder'])assert.ok(values.includes(`runtime_capabilities.plugin:tbh-reminders:reminder:${id}.enabled=false`));
 assert.ok(values.includes('run.workflow_trigger_mode="off"'));assert.ok(!values.some(x=>x.endsWith('=true')));
 assert.equal(REMINDER_IDS.length,6);
});
