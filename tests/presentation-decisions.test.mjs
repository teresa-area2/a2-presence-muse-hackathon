import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresentationLedger, PRESENTATION_EVENT_LIMIT } from '../web/presentation-decisions.mjs';

const ERR = 'presentation_ledger_invalid';
const DEFER = { response_extent: 'standard', unsolicited_update: 'defer', conversation_style: 'conversational' };
const SEND = { response_extent: 'full', unsolicited_update: 'send', conversation_style: 'self_contained' };

function throwsInvalid(fn) {
  assert.throws(fn, (error) => error instanceof Error && error.message === ERR);
}

function eligible(controls) {
  return { mode: 'eligible', controls: { ...controls } };
}

function base(overrides = {}) {
  return {
    session_generation: 1,
    history_epoch: 0,
    items: [],
    policy: eligible(DEFER),
    at_ms: 1000,
    ...overrides,
  };
}

function msg(ordinal, optional, visible) {
  return { kind: 'message', ordinal, optional, visible };
}

function approval(ordinal) {
  return { kind: 'approval', ordinal, optional: false, visible: true };
}

test('exports and snapshot before first observation and reset', () => {
  assert.equal(PRESENTATION_EVENT_LIMIT, 100);
  const ledger = createPresentationLedger({ arm: 'with' });
  assert.equal(ledger.snapshot(), null);
  const snap = ledger.observe(base({ items: [msg(1, false, true)] }));
  assert.equal(snap.schema_version, 1);
  assert.equal(snap.source, 'browser_current_display_policy');
  assert.equal(snap.arm, 'with');
  ledger.reset();
  assert.equal(ledger.snapshot(), null);
  const again = ledger.observe(base({ session_generation: 1, items: [msg(1, false, true)] }));
  assert.equal(again.events[0].sequence, 1);
  assert.equal(again.revision, 1);
});

test('constructor rejects invalid arm and closed keys', () => {
  throwsInvalid(() => createPresentationLedger());
  throwsInvalid(() => createPresentationLedger({}));
  throwsInvalid(() => createPresentationLedger({ arm: 'both' }));
  throwsInvalid(() => createPresentationLedger({ arm: 'with', extra: true }));
  throwsInvalid(() => createPresentationLedger(null));
});

test('baseline arm never accesses a throwing policy getter', () => {
  const ledger = createPresentationLedger({ arm: 'without' });
  let accessed = false;
  const input = {
    session_generation: 1,
    history_epoch: 0,
    items: [msg(1, false, true), msg(2, true, true)],
    at_ms: 10,
  };
  Object.defineProperty(input, 'policy', {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error('must not be read');
    },
  });
  const snap = ledger.observe(input);
  assert.equal(accessed, false);
  assert.deepEqual(snap.events, [
    { sequence: 1, revision: 1, history_epoch: 0, kind: 'message', ordinal: 1, event: 'shown', reason: 'mandatory', at_ms: 10, controls: null },
    { sequence: 2, revision: 1, history_epoch: 0, kind: 'message', ordinal: 2, event: 'shown', reason: 'baseline', at_ms: 10, controls: null },
  ]);
  throwsInvalid(() => ledger.observe({ session_generation: 1, history_epoch: 0, items: [msg(1, false, true), msg(2, true, false), msg(3, true, true)], policy: null, at_ms: 11 }));
});

test('initial mandatory shown and optional held under eligible defer', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  const snap = ledger.observe(base({ items: [msg(1, false, true), msg(2, true, false), approval(3)] }));
  assert.equal(snap.coverage, 'observed');
  assert.equal(snap.events_omitted, 0);
  assert.deepEqual(snap.events, [
    { sequence: 1, revision: 1, history_epoch: 0, kind: 'message', ordinal: 1, event: 'shown', reason: 'mandatory', at_ms: 1000, controls: DEFER },
    { sequence: 2, revision: 1, history_epoch: 0, kind: 'message', ordinal: 2, event: 'held', reason: 'defer', at_ms: 1000, controls: DEFER },
    { sequence: 3, revision: 1, history_epoch: 0, kind: 'approval', ordinal: 3, event: 'shown', reason: 'mandatory', at_ms: 1000, controls: DEFER },
  ]);
});

test('rerender with cloned items is a no-op and returns same revision', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  const first = ledger.observe(base({ items: [msg(1, false, true), msg(2, true, false)] }));
  const second = ledger.observe(base({ items: [msg(1, false, true), msg(2, true, false)], at_ms: 2000, policy: eligible(SEND) }));
  assert.deepEqual(second, first);
  assert.equal(second.revision, 1);
  assert.equal(second.events.length, 2);
});

test('eligible send releases held items in source order sharing one revision', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  ledger.observe(base({ items: [msg(1, false, true), msg(3, true, false), msg(2, true, false)] }));
  const snap = ledger.observe(base({
    items: [msg(1, false, true), msg(3, true, true), msg(2, true, true)],
    policy: eligible(SEND),
    at_ms: 2000,
  }));
  assert.equal(snap.revision, 2);
  assert.deepEqual(snap.events.slice(3), [
    { sequence: 4, revision: 2, history_epoch: 0, kind: 'message', ordinal: 3, event: 'released', reason: 'send', at_ms: 2000, controls: SEND },
    { sequence: 5, revision: 2, history_epoch: 0, kind: 'message', ordinal: 2, event: 'released', reason: 'send', at_ms: 2000, controls: SEND },
  ]);
});

test('manual reveal wins while current policy still defers', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  ledger.observe(base({ items: [msg(1, true, false)] }));
  const snap = ledger.observe(base({ items: [msg(1, true, true)], at_ms: 2000, manual: true }));
  assert.deepEqual(snap.events[1], { sequence: 2, revision: 2, history_epoch: 0, kind: 'message', ordinal: 1, event: 'released', reason: 'manual', at_ms: 2000, controls: DEFER });
});

test('optional visible under defer is shown as not_held, not decided by recorder', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  const snap = ledger.observe(base({ items: [msg(7, true, true)] }));
  assert.equal(snap.events[0].event, 'shown');
  assert.equal(snap.events[0].reason, 'not_held');
});

test('fallback and disconnected each release held items with null controls', () => {
  for (const mode of ['fallback', 'disconnected']) {
    const ledger = createPresentationLedger({ arm: 'with' });
    ledger.observe(base({ items: [msg(1, true, false)] }));
    const snap = ledger.observe(base({ items: [msg(1, true, true)], policy: { mode, controls: null }, at_ms: 2000 }));
    assert.deepEqual(snap.events[1], { sequence: 2, revision: 2, history_epoch: 0, kind: 'message', ordinal: 1, event: 'released', reason: mode, at_ms: 2000, controls: null });
  }
});

test('approvals and mandatory final or error style rows are shown as mandatory', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  const snap = ledger.observe(base({ items: [approval(1), msg(1, false, true), msg(2, false, true)] }));
  assert.deepEqual(snap.events.map((e) => [e.kind, e.ordinal, e.event, e.reason]), [
    ['approval', 1, 'shown', 'mandatory'],
    ['message', 1, 'shown', 'mandatory'],
    ['message', 2, 'shown', 'mandatory'],
  ]);
});

test('identity is kind plus ordinal and duplicates by that identity reject', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  const snap = ledger.observe(base({ items: [msg(1, false, true), approval(1)] }));
  assert.equal(snap.events.length, 2);
  const before = ledger.snapshot();
  throwsInvalid(() => ledger.observe(base({ items: [msg(1, false, true), approval(1), msg(1, false, true)], at_ms: 2000 })));
  assert.deepEqual(ledger.snapshot(), before);
});

test('approval may disappear at same epoch but a missing message rejects', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  ledger.observe(base({ items: [msg(1, false, true), approval(2)] }));
  const snap = ledger.observe(base({ items: [msg(1, false, true)], at_ms: 2000 }));
  assert.equal(snap.events.length, 2);
  assert.equal(snap.revision, 1);
  const before = ledger.snapshot();
  throwsInvalid(() => ledger.observe(base({ items: [approval(2)], at_ms: 3000 })));
  assert.deepEqual(ledger.snapshot(), before);
});

test('new epoch discards item state, fabricates no releases, and marks partial', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  ledger.observe(base({ items: [msg(1, true, false), msg(2, false, true)] }));
  const snap = ledger.observe(base({ history_epoch: 1, items: [msg(1, true, true), msg(3, false, true)], at_ms: 2000 }));
  assert.equal(snap.coverage, 'partial');
  assert.equal(snap.history_epoch, 1);
  assert.deepEqual(snap.events.map((e) => [e.sequence, e.history_epoch, e.ordinal, e.event, e.reason]), [
    [1, 0, 1, 'held', 'defer'],
    [2, 0, 2, 'shown', 'mandatory'],
    [3, 1, 1, 'shown', 'not_held'],
    [4, 1, 3, 'shown', 'mandatory'],
  ]);
  assert.equal(snap.revision, 2);
});

test('epoch change with no new events still increments revision once', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  ledger.observe(base({ items: [msg(1, false, true)] }));
  const snap = ledger.observe(base({ history_epoch: 2, items: [], at_ms: 2000 }));
  assert.equal(snap.revision, 2);
  assert.equal(snap.events.length, 1);
  assert.equal(snap.coverage, 'partial');
});

test('generation change resets history and sequence; decrease rejects without mutation', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  ledger.observe(base({ history_epoch: 3, items: [msg(1, true, false)] }));
  ledger.observe(base({ history_epoch: 4, items: [msg(9, false, true)], at_ms: 2000 }));
  assert.equal(ledger.snapshot().coverage, 'partial');
  const fresh = ledger.observe(base({ session_generation: 2, history_epoch: 0, items: [msg(5, false, true)], at_ms: 5 }));
  assert.equal(fresh.session_generation, 2);
  assert.equal(fresh.coverage, 'observed');
  assert.equal(fresh.events_omitted, 0);
  assert.deepEqual(fresh.events, [
    { sequence: 1, revision: 1, history_epoch: 0, kind: 'message', ordinal: 5, event: 'shown', reason: 'mandatory', at_ms: 5, controls: DEFER },
  ]);
  const before = ledger.snapshot();
  throwsInvalid(() => ledger.observe(base({ session_generation: 1, items: [msg(5, false, true)], at_ms: 6 })));
  assert.deepEqual(ledger.snapshot(), before);
});

test('epoch and at_ms must be nondecreasing within a generation', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  ledger.observe(base({ history_epoch: 1, at_ms: 5000, items: [msg(1, false, true)] }));
  const before = ledger.snapshot();
  throwsInvalid(() => ledger.observe(base({ history_epoch: 0, at_ms: 6000, items: [msg(1, false, true)] })));
  throwsInvalid(() => ledger.observe(base({ history_epoch: 1, at_ms: 4999, items: [msg(1, false, true)] })));
  assert.deepEqual(ledger.snapshot(), before);
});

test('invalid inputs reject transactionally without partial mutation', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true)] }));
  const before = ledger.snapshot();
  const attempts = [
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true), msg(3, true, true)], at_ms: 2000, text: 'nope' })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true), { ...msg(3, true, true), payload: 1 }], at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true)], policy: { mode: 'eligible', controls: { ...DEFER }, extra: 1 }, at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true)], policy: eligible({ response_extent: 'brief', unsolicited_update: 'defer', conversation_style: 'conversational' }), at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true)], policy: eligible({ response_extent: 'standard', unsolicited_update: 'defer' }), at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true)], policy: { mode: 'fallback', controls: { ...DEFER } }, at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true)], policy: { mode: 'unknown', controls: null }, at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true)], at_ms: Number.MAX_SAFE_INTEGER + 1 })),
    () => ledger.observe(base({ session_generation: 0, items: [msg(1, false, true), msg(2, true, true)], at_ms: 2000 })),
    () => ledger.observe(base({ history_epoch: -1, items: [msg(1, false, true), msg(2, true, true)], at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true), msg(0, true, true)], at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true), msg(4097, true, true)], at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true), msg(3, false, false)], at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true), { kind: 'approval', ordinal: 4, optional: false, visible: false }], at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, false)], at_ms: 2000 })),
    () => ledger.observe(base({ items: [{ kind: 'message', ordinal: 1, optional: true, visible: true }, msg(2, true, true)], at_ms: 2000 })),
    () => ledger.observe(base({ items: [msg(1, false, true), msg(2, true, true)], manual: 'yes', at_ms: 2000 })),
  ];
  for (const attempt of attempts) throwsInvalid(attempt);
  assert.deepEqual(ledger.snapshot(), before);
});

test('item list bound rejects 577 items without mutation', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  ledger.observe(base({ items: [msg(1, false, true)] }));
  const before = ledger.snapshot();
  const many = Array.from({ length: 577 }, (_, i) => msg(i + 1, false, true));
  throwsInvalid(() => ledger.observe(base({ items: many, at_ms: 2000 })));
  assert.deepEqual(ledger.snapshot(), before);
});

test('bounded rollover keeps last 100 events and counts omitted exactly', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  let snap;
  for (let epoch = 0; epoch < 105; epoch += 1) {
    snap = ledger.observe(base({ history_epoch: epoch, at_ms: epoch, items: [msg(1, false, true)] }));
  }
  assert.equal(snap.events.length, PRESENTATION_EVENT_LIMIT);
  assert.equal(snap.events_omitted, 5);
  assert.equal(snap.coverage, 'partial');
  assert.equal(snap.revision, 105);
  assert.equal(snap.events[0].sequence, 6);
  assert.equal(snap.events[99].sequence, 105);
});

test('snapshots and event controls are detached from caller and returned objects', () => {
  const ledger = createPresentationLedger({ arm: 'with' });
  const controls = { ...DEFER };
  const snap = ledger.observe(base({ items: [msg(1, true, false)], policy: { mode: 'eligible', controls } }));
  controls.unsolicited_update = 'send';
  snap.events[0].reason = 'tampered';
  snap.events[0].controls.unsolicited_update = 'send';
  snap.coverage = 'tampered';
  const fresh = ledger.snapshot();
  assert.equal(fresh.events[0].reason, 'defer');
  assert.equal(fresh.events[0].controls.unsolicited_update, 'defer');
  assert.equal(fresh.coverage, 'observed');
  const fresh2 = ledger.snapshot();
  assert.notEqual(fresh, fresh2);
  assert.notEqual(fresh.events, fresh2.events);
  assert.notEqual(fresh.events[0].controls, fresh2.events[0].controls);
  assert.deepEqual(fresh, fresh2);
});

test('starting within a rewritten history is explicitly partial',()=>{
 const ledger=createPresentationLedger({arm:'with'});
 const policy={mode:'eligible',controls:{response_extent:'terse',unsolicited_update:'defer',conversation_style:'self_contained'}};
 const first=ledger.observe({session_generation:1,history_epoch:2,at_ms:10,items:[],policy});
 assert.equal(first.coverage,'partial');
 const next=ledger.observe({session_generation:2,history_epoch:1,at_ms:0,items:[],policy});
 assert.equal(next.coverage,'partial');
});
test('a recorded hold cannot falsely claim defer under send or ordinary fallback',()=>{
 for(const policy of [{mode:'eligible',controls:{response_extent:'terse',unsolicited_update:'send',conversation_style:'self_contained'}},{mode:'fallback',controls:null},{mode:'disconnected',controls:null}]){
  const ledger=createPresentationLedger({arm:'with'});
  assert.throws(()=>ledger.observe({session_generation:1,history_epoch:0,at_ms:0,items:[{kind:'message',ordinal:1,optional:true,visible:false}],policy}),/presentation_ledger_invalid/);
  assert.equal(ledger.snapshot(),null);
 }
});
