import test from 'node:test';
import assert from 'node:assert/strict';
import {runCommentaryReplay} from '../scripts/replay-commentary.mjs';

test('unattended replay holds only new optional updates and releases them in source order', () => {
  const result = runCommentaryReplay();
  assert.deepEqual(result.steps.map(s => [s.phase,s.visible,s.held]), [
    ['defer',5,1], ['send',6,0], ['defer_new',6,1], ['stale',7,0],
    ['defer_again',7,1], ['manual_reveal',8,0], ['defer_before_disconnect',8,1], ['disconnect',9,0],
  ]);
  assert.equal(result.mandatory_rows_visible,true);
  assert.equal(result.released_in_source_order,true);
  assert.deepEqual(result.adaptive_metrics,{
    schema_version:1,held_current:0,held_total:4,released_manual:1,released_automatic:3,history_resets:0,coverage:'observed'
  });
});

test('baseline never reads Presence and unattended evidence contains no message bodies', () => {
  const result = runCommentaryReplay();
  assert.equal(result.baseline.presence_reads,0);
  assert.equal(result.baseline.held,0);
  assert.equal(result.baseline.visible,9);
  assert.equal(result.synthetic,true);
  assert.equal(result.model_runtime,'none');
  assert.equal(result.op_service_calls,0);
  assert.equal(result.provider_calls,0);
  assert.equal(result.human_benefit,'not_measured');
  assert.ok(!JSON.stringify(result).includes('FIXTURE_'));
});

test('the bounded replay is deterministic and does not accept runtime inputs', () => {
  assert.deepEqual(runCommentaryReplay(),runCommentaryReplay());
  assert.throws(() => runCommentaryReplay({presence:'external'}),/no arguments/);
});
