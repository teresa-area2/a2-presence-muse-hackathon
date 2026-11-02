import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createEvidencePolicySource} from '../src/evidence-policy-trajectories.mjs';
const matrix = JSON.parse(await fs.readFile(new URL('./fixtures/coding-instructions-3-matrix.json', import.meta.url), 'utf8'));
const full = {response_extent: 'full', unsolicited_update: 'send', conversation_style: 'conversational'};
const terse = {response_extent: 'terse', unsolicited_update: 'defer', conversation_style: 'self_contained'};
const standard = {response_extent: 'standard', unsolicited_update: 'send', conversation_style: 'conversational'};
function ids() {let i = 0; return () => '00000000-0000-4000-8000-' + String(++i).padStart(12, '0');}
const source = (trajectoryId, extra = {}) => createEvidencePolicySource({trajectoryId, scopeId: 'test-pair', makeId: ids(), now: () => 1000, ...extra});
const fixtureText = controls => matrix.find(row => Object.keys(controls).every(key => row.controls[key] === controls[key])).instructions.llm.preamble;

test('steady uses the exact standard OP fixture and a stable frame UUID without state inference', () => {
  const s = source('steady'); assert.equal(s.snapshot().read_sequence, 0);
  const first = s.selectForRequest(); assert.deepEqual(first.controls, standard); assert.equal(first.guidance, fixtureText(standard));
  assert.equal(first.status, 'selected'); assert.equal(first.renderer, 'coding-instructions.3'); assert.equal(first.age_ms, 0);
  for (let i = 0; i < 5; i++) assert.equal(s.selectForRequest().reading_id, first.reading_id);
  assert.equal(s.snapshot().read_sequence, 6); assert.equal(s.snapshot().calibration, 'not_assessed'); assert.equal(s.snapshot().model_compliance, 'not_established');
});

test('source observations and hook/send recording never consume model-boundary positions', () => {
  const s = source('change-during-work');
  for (let i = 0; i < 10; i++) {s.snapshot(); s.recordSelection('send');}
  assert.equal(s.snapshot().read_sequence, 0);
  const first = s.selectForRequest(); const second = s.selectForRequest();
  for (let i = 0; i < 10; i++) {s.snapshot(); s.recordSelection('hook', second); s.recordSelection('send');}
  assert.equal(s.snapshot().read_sequence, 2); assert.equal(second.reading_id, first.reading_id); assert.deepEqual(second.controls, full);
  const third = s.selectForRequest(); assert.deepEqual(third.controls, terse); assert.notEqual(third.reading_id, first.reading_id);
  assert.equal(s.snapshot().read_sequence, 3); assert.equal(s.snapshot().frame_index, 1);
});

test('change-during-work changes after exactly two hook reads and preserves verbatim matching guidance', () => {
  const s = source('change-during-work'), rows = Array.from({length: 5}, () => s.selectForRequest());
  assert.deepEqual(rows.map(row => row.controls), [full, full, terse, terse, terse]);
  assert.equal(rows[0].guidance, fixtureText(full)); assert.equal(rows[2].guidance, fixtureText(terse));
  assert.equal(rows[0].reading_id, rows[1].reading_id); assert.equal(rows[2].reading_id, rows[4].reading_id); assert.notEqual(rows[1].reading_id, rows[2].reading_id);
});

test('fallback-return yields full then terse then two ineligible reads and a genuinely fresh return', () => {
  const s = source('fallback-return'), rows = [], frames = [];
  for (let i = 0; i < 6; i++) {rows.push(s.selectForRequest()); frames.push(s.snapshot().frame_id);}
  assert.deepEqual(rows.map(row => row.status), ['selected', 'selected', 'fallback', 'fallback', 'selected', 'selected']);
  assert.deepEqual(rows.map(row => row.controls), [full, terse, null, null, full, full]);
  for (const row of rows.slice(2, 4)) assert.deepEqual(row, {status: 'fallback', guidance: null, controls: null, reading_id: null, age_ms: null, renderer: null});
  assert.equal(frames[2], frames[3]); assert.notEqual(frames[1], frames[2]);
  assert.notEqual(rows[4].reading_id, rows[0].reading_id); assert.equal(rows[4].reading_id, rows[5].reading_id);
  assert.equal(rows[4].guidance, fixtureText(full));
});

test('fresh source instances get separate actual UUIDs even for the same scripted scope', () => {
  const opts = {trajectoryId: 'steady', scopeId: 'same-pair'};
  const a = createEvidencePolicySource(opts).selectForRequest(), b = createEvidencePolicySource(opts).selectForRequest();
  assert.match(a.reading_id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/); assert.notEqual(a.reading_id, b.reading_id);
});

test('contextual-v2 never edits OP fixture prose or pretends its failed quality gate was promoted', () => {
  const ordinary = source('fallback-return'), experimental = source('fallback-return', {guidanceVariant: 'contextual-v2'});
  for (let i = 0; i < 6; i++) assert.deepEqual(experimental.selectForRequest(), ordinary.selectForRequest());
  assert.equal(experimental.snapshot().experimental, true); assert.equal(experimental.snapshot().quality_status, 'quality_failed_not_promoted');
  assert.equal(experimental.snapshot().guidance_variant, 'contextual-v2'); assert.equal(ordinary.snapshot().quality_status, 'fixture_conformance_only');
});

test('selections are immutable and telemetry snapshots detach nested arrays without exposing prose', () => {
  const s = source('steady'), current = s.selectForRequest(); s.recordSelection('hook', current);
  assert.throws(() => current.controls.response_extent = 'full', TypeError);
  assert.throws(() => s.snapshot().selections.push({}), TypeError);
  assert.equal(s.snapshot().selections.length, 1);
  const text = JSON.stringify(s.snapshot()); assert.doesNotMatch(text, /A2 Presence presentation guidance|"guidance"|readiness|stability|"flow"/);
  assert.deepEqual(JSON.parse(text), s.snapshot());
});

test('invalid source dimensions, UUIDs and clocks fail closed', () => {
  for (const extra of [{trajectoryId: 'live'}, {scopeId: '../private'}, {scopeId: ''}, {guidanceVariant: 'automatic'}, {now: 1}, {makeId: 1}]) assert.throws(() => source('steady', extra), /evidence_policy_source_invalid/);
  for (const makeId of [() => 'not-a-uuid', () => null]) assert.throws(() => source('steady', {makeId}), /evidence_policy_id_invalid/);
  for (const now of [() => -1, () => NaN, () => 1.5]) assert.throws(() => source('steady', {now}), /evidence_policy_clock_invalid/);
});

test('a duplicate transition ID or bad clock cannot silently consume a policy read', () => {
  const s = source('change-during-work', {makeId: () => '00000000-0000-4000-8000-000000000001'});
  s.selectForRequest(); s.selectForRequest(); assert.throws(() => s.selectForRequest(), /evidence_policy_id_invalid/); assert.equal(s.snapshot().read_sequence, 2);
  let time = 1000; const clocked = source('steady', {now: () => time}); clocked.selectForRequest(); time = NaN;
  assert.throws(() => clocked.selectForRequest(), /evidence_policy_clock_invalid/); assert.equal(clocked.snapshot().read_sequence, 1);
});

test('recording accepts only the actual current selection and never advances on rejection', () => {
  const s = source('change-during-work'), current = s.selectForRequest();
  assert.throws(() => s.recordSelection('request', current), /evidence_policy_stage_invalid/);
  assert.throws(() => s.recordSelection('hook', {...current, reading_id: 'forged'}), /evidence_policy_selection_mismatch/);
  assert.equal(s.snapshot().read_sequence, 1); assert.equal(s.snapshot().selections.length, 0);
});

test('both read count and selection telemetry have finite independent bounds', () => {
  const s = source('steady'); for (let i = 0; i < 70; i++) s.recordSelection('send');
  assert.equal(s.snapshot().selections.length, 64); assert.equal(s.snapshot().selections_omitted, 6); assert.equal(s.snapshot().read_sequence, 0);
  for (let i = 0; i < 1024; i++) s.selectForRequest(); assert.throws(() => s.selectForRequest(), /evidence_policy_read_limit/);
  assert.equal(s.snapshot().read_sequence, 1024);
});

test('clock advancement between a hook read and its audit does not reject or consume another read', () => {
  let at = 1000; const s = source('change-during-work', {now: () => at});
  const selected = s.selectForRequest(); at = 3500;
  assert.deepEqual(s.recordSelection('hook', selected), selected);
  assert.equal(s.snapshot().read_sequence, 1);
  assert.equal(s.snapshot().selections[0].at_ms, 3500);
  assert.equal(s.snapshot().selected_at_ms, 1000);
  assert.equal(s.selectForRequest().reading_id, selected.reading_id);
});
