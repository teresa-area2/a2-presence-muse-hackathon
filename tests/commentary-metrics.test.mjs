import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommentaryProjection } from '../web/commentary-policy.mjs';

function makeOpt(text, extra = {}) {
  return { author: 'Muse', phase: 'commentary', text, ...extra };
}
function makeMandatory(text) {
  return { author: 'Muse', phase: 'answer', text };
}
function cloneRows(rows) {
  return rows.map((r) => ({ ...r }));
}
function withOpts(presence, now, extra = {}) {
  return { arm: 'with', connected: true, presence, now, generation: 'g1', ...extra };
}
const NOW = Date.parse('2026-10-30T12:00:00Z');
const DEFER_PRESENCE = {source:{eligible:true,renderer:'coding-instructions.3',read_at:new Date(NOW-1000).toISOString(),received_at:new Date(NOW-2000).toISOString(),capture:{state:'collecting'},controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'conversational'}}};

test('clones and identical-text duplicates count once; repeated renders unchanged', () => {
  assert.ok(DEFER_PRESENCE, 'need a deferring presence value');
  const p = createCommentaryProjection();
  const rows = [makeMandatory('m0'), makeOpt('dup'), makeOpt('dup')];
  const r1 = p.project(cloneRows(rows), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(r1.defer, true);
  assert.equal(r1.held.length, 2);
  let m = p.metrics();
  assert.equal(m.held_total, 2);
  assert.equal(m.held_current, 2);
  const r2 = p.project(cloneRows(rows), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(r2.held.length, 2);
  m = p.metrics();
  assert.equal(m.held_total, 2);
  assert.equal(m.held_current, 2);
  const r3 = p.project(cloneRows(rows), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(r3.held.length, 2);
  m = p.metrics();
  assert.equal(m.held_total, 2);
  assert.equal(m.coverage, 'observed');
});

test('manual release via reveal counts once; repeated reveal without new held is no-op', () => {
  assert.ok(DEFER_PRESENCE, 'need a deferring presence value');
  const p = createCommentaryProjection();
  const rows = [makeMandatory('m0'), makeOpt('held-one')];
  p.project(cloneRows(rows), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(p.metrics().held_current, 1);
  p.reveal();
  let m = p.metrics();
  assert.equal(m.released_manual, 1);
  assert.equal(m.held_current, 0);
  assert.equal(m.held_total, 1);
  p.reveal();
  m = p.metrics();
  assert.equal(m.released_manual, 1);
  assert.equal(m.held_current, 0);
  const r = p.project(cloneRows(rows), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(r.held.length, 0);
  assert.ok(r.visible.some((x) => x.text === 'held-one'));
  m = p.metrics();
  assert.equal(m.released_manual, 1);
  assert.equal(m.held_total, 1);
});

test('automatic release on disconnect without reveal', () => {
  assert.ok(DEFER_PRESENCE, 'need a deferring presence value');
  const p = createCommentaryProjection();
  const rows = [makeMandatory('m0'), makeOpt('auto-one')];
  p.project(cloneRows(rows), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(p.metrics().held_current, 1);
  const r = p.project(cloneRows(rows), { arm: 'with', connected: false, now: NOW, generation: 'g1' });
  assert.equal(r.defer, false);
  assert.equal(r.held.length, 0);
  assert.ok(r.visible.some((x) => x.text === 'auto-one'));
  const m = p.metrics();
  assert.equal(m.released_automatic, 1);
  assert.equal(m.released_manual, 0);
  assert.equal(m.held_current, 0);
  assert.equal(m.held_total, 1);
});

test('generation change and reset clear counts', () => {
  assert.ok(DEFER_PRESENCE, 'need a deferring presence value');
  const p = createCommentaryProjection();
  p.project([makeMandatory('m0'), makeOpt('g-one')], withOpts(DEFER_PRESENCE, NOW, { generation: 'g1' }));
  assert.equal(p.metrics().held_total, 1);
  p.reveal();
  p.project([makeMandatory('m0'), makeOpt('g-one')], withOpts(DEFER_PRESENCE, NOW, { generation: 'g2' }));
  let m = p.metrics();
  assert.equal(m.held_total, 1, 'the first held occurrence belongs to the new generation');
  assert.equal(m.held_current, 1);
  assert.equal(m.released_manual, 0);
  assert.equal(m.released_automatic, 0);
  assert.equal(m.history_resets, 0);
  assert.equal(m.coverage, 'observed');
  p.project([makeMandatory('m0'), makeOpt('g-one'), makeOpt('g-two')], withOpts(DEFER_PRESENCE, NOW, { generation: 'g2' }));
  assert.equal(p.metrics().held_total, 2);
  p.reset();
  m = p.metrics();
  assert.equal(m.held_total, 0);
  assert.equal(m.held_current, 0);
  assert.equal(m.history_resets, 0);
  assert.equal(m.coverage, 'observed');
});

test('rewritten history keeps lower bounds, marks partial, allows later new rows; truncation also partial', () => {
  assert.ok(DEFER_PRESENCE, 'need a deferring presence value');
  const p = createCommentaryProjection();
  const base = [makeMandatory('base'), makeOpt('keep-a'), makeOpt('keep-b')];
  p.project(cloneRows(base), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(p.metrics().held_total, 2);
  const rewritten = [makeMandatory('base-CHANGED'), makeOpt('keep-a'), makeOpt('keep-b')];
  const r = p.project(cloneRows(rewritten), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(r.defer, false);
  let m = p.metrics();
  assert.equal(m.coverage, 'partial');
  assert.equal(m.history_resets, 1);
  assert.equal(m.held_total, 2);
  assert.equal(m.released_automatic, 0);
  assert.equal(m.held_current, 0, 'rewritten rows are released, so none remain currently held');
  const rAgain = p.project(cloneRows(rewritten), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(p.metrics().history_resets, 1);
  assert.equal(rAgain.defer, true);
  assert.equal(p.metrics().held_total, 2);
  const extended = [...cloneRows(rewritten), makeOpt('brand-new')];
  const rNew = p.project(extended, withOpts(DEFER_PRESENCE, NOW));
  assert.ok(rNew.held.some((x) => x.text === 'brand-new'));
  m = p.metrics();
  assert.equal(m.held_total, 3);
  assert.equal(m.coverage, 'partial');
  const q = createCommentaryProjection();
  const full = [makeMandatory('t0'), makeOpt('t-a'), makeOpt('t-b')];
  q.project(cloneRows(full), withOpts(DEFER_PRESENCE, NOW));
  assert.equal(q.metrics().held_total, 2);
  q.project([makeMandatory('t0')], withOpts(DEFER_PRESENCE, NOW));
  m = q.metrics();
  assert.equal(m.coverage, 'partial');
  assert.equal(m.history_resets, 1);
  assert.equal(m.held_total, 2);
  assert.equal(m.released_automatic, 0);
});

test('baseline non-with arm shows zero deferral counters without reading Presence throwing getter', () => {
  const p = createCommentaryProjection();
  const rows = [makeMandatory('m0'), makeOpt('base-opt')];
  let getterFired = false;
  const opts = {};
  opts.arm = 'baseline';
  opts.connected = true;
  opts.now = NOW;
  opts.generation = 'g1';
  Object.defineProperty(opts, 'presence', {
    get() {
      getterFired = true;
      throw new Error('presence must not be read on baseline');
    },
  });
  const r = p.project(cloneRows(rows), opts);
  assert.equal(getterFired, false);
  assert.equal(r.defer, false);
  assert.equal(r.held.length, 0);
  assert.equal(r.visible.length, 2);
  const m = p.metrics();
  assert.equal(m.held_current, 0);
  assert.equal(m.held_total, 0);
  assert.equal(m.released_manual, 0);
  assert.equal(m.released_automatic, 0);
});

test('metrics closed schema, snapshot copies, content-free', () => {
  assert.ok(DEFER_PRESENCE, 'need a deferring presence value');
  const p = createCommentaryProjection();
  p.project([makeMandatory('m0'), makeOpt('secret-text-xyz')], withOpts(DEFER_PRESENCE, NOW));
  const m1 = p.metrics();
  assert.deepEqual(Object.keys(m1).sort(), ['coverage', 'held_current', 'held_total', 'history_resets', 'released_automatic', 'released_manual', 'schema_version'].sort());
  assert.equal(m1.schema_version, 1);
  for (const k of ['held_current', 'held_total', 'released_manual', 'released_automatic', 'history_resets']) {
    assert.ok(Number.isInteger(m1[k]) && m1[k] >= 0);
  }
  assert.ok(m1.coverage === 'observed' || m1.coverage === 'partial');
  assert.ok(!JSON.stringify(m1).includes('secret-text-xyz'));
  m1.held_total = 9999;
  m1.coverage = 'hacked';
  const m2 = p.metrics();
  assert.notEqual(m2.held_total, 9999);
  assert.notEqual(m2.coverage, 'hacked');
});
