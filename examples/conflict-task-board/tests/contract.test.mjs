import test from 'node:test';
import assert from 'node:assert/strict';

const MODULE_URL = process.env.TASK_MODULE ?? new URL('../resolve-conflict.mjs', import.meta.url).href;
const { resolveConflict } = await import(MODULE_URL);

function snap(revision, title, done) {
  return { revision, fields: { title, done } };
}
function draftOf(title, done) {
  return { title, done };
}

test('safety: semantic overlap is checked BEFORE automatic retry — same title edit conflicts even though revision-safe write could succeed', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'Remote', false);
  const res = await resolveConflict({
    base,
    readRemote: async () => remote,
    readLatestDraft: () => draftOf('Local', false)
  });
  assert.deepEqual(res, { kind: 'conflict', fields: ['title'], draft: draftOf('Local', false) });
  assert.deepEqual(Object.keys(res).sort(), ['draft', 'fields', 'kind']);
});

test('safety: only compatible changes can retry — disjoint title/done edits retry with local-only patch', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'A', true);
  const res = await resolveConflict({
    base,
    readRemote: async () => remote,
    readLatestDraft: () => draftOf('B', false)
  });
  assert.equal(res.kind, 'retry');
  assert.equal(res.expectedRevision, 'r2');
  assert.deepEqual(res.patch, { title: 'B' });
  assert.deepEqual(res.draft, draftOf('B', false));
  assert.deepEqual(Object.keys(res).sort(), ['draft', 'expectedRevision', 'kind', 'patch']);
});

test('safety: identical concurrent values are compatible — convergent same title is clean, not conflict', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'Same', false);
  const res = await resolveConflict({
    base,
    readRemote: async () => remote,
    readLatestDraft: () => draftOf('Same', false)
  });
  assert.deepEqual(res, { kind: 'clean', draft: draftOf('Same', false) });
});

test('safety: unchanged local does not revert remote — remote-only change stays clean with no patch', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'Remote', true);
  const res = await resolveConflict({
    base,
    readRemote: async () => remote,
    readLatestDraft: () => draftOf('A', false)
  });
  assert.deepEqual(res, { kind: 'clean', draft: draftOf('A', false) });
  assert.ok(!('patch' in res));
});

test('safety: latest draft is preserved — edit made while remote awaits is read after await (deferred promise)', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'A', true);
  let current = draftOf('A', false);
  let release;
  const gate = new Promise((r) => { release = r; });
  const readRemote = () => gate.then(() => remote);
  const readLatestDraft = () => ({ ...current });
  const pending = resolveConflict({ base, readRemote, readLatestDraft });
  current = draftOf('B', false);
  release();
  const res = await pending;
  assert.equal(res.kind, 'retry');
  assert.deepEqual(res.patch, { title: 'B' });
  assert.deepEqual(res.draft, draftOf('B', false));
});

test('safety: latest draft is preserved — overlapping edit made while waiting still conflicts', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'Remote', false);
  let current = draftOf('A', false);
  let release;
  const gate = new Promise((r) => { release = r; });
  const pending = resolveConflict({
    base,
    readRemote: () => gate.then(() => remote),
    readLatestDraft: () => ({ ...current })
  });
  current = draftOf('Local', false);
  release();
  const res = await pending;
  assert.deepEqual(res, { kind: 'conflict', fields: ['title'], draft: draftOf('Local', false) });
});

test('safety: latest draft is preserved on conflict — entire dirty draft kept, not base or remote', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'Remote', false);
  const res = await resolveConflict({
    base,
    readRemote: async () => remote,
    readLatestDraft: () => draftOf('Local', true)
  });
  assert.equal(res.kind, 'conflict');
  assert.deepEqual(res.fields, ['title']);
  assert.deepEqual(res.draft, draftOf('Local', true));
});

test('safety: conflict fields use canonical title/done order', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'Remote', false);
  const res = await resolveConflict({
    base,
    readRemote: async () => remote,
    readLatestDraft: () => draftOf('Local', false)
  });
  assert.deepEqual(res.fields, ['title']);
  assert.deepEqual([...res.fields], ['title']);
});

test('safety: inputs are never mutated and outputs are detached copies', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'A', true);
  const draftObj = draftOf('B', false);
  const baseBefore = JSON.stringify(base);
  const remoteBefore = JSON.stringify(remote);
  const draftBefore = JSON.stringify(draftObj);
  const res = await resolveConflict({ base, readRemote: async () => remote, readLatestDraft: () => draftObj });
  assert.equal(JSON.stringify(base), baseBefore);
  assert.equal(JSON.stringify(remote), remoteBefore);
  assert.equal(JSON.stringify(draftObj), draftBefore);
  assert.notEqual(res.draft, draftObj);
  assert.notEqual(res.patch, draftObj);
  res.draft.title = 'MUT';
  res.patch.title = 'MUT2';
  assert.equal(draftObj.title, 'B');
  const cbase = snap('cb', 'A', false);
  const cremote = snap('cr', 'R', false);
  const cdraft = draftOf('L', true);
  const cres = await resolveConflict({ base: cbase, readRemote: async () => cremote, readLatestDraft: () => cdraft });
  assert.equal(cres.kind, 'conflict');
  assert.notEqual(cres.draft, cdraft);
  assert.notEqual(cres.fields, undefined);
  cres.fields.push('x');
  assert.deepEqual(cres.draft, draftOf('L', true));
});

test('safety: revisions are opaque tokens passed through untouched (no numeric assumptions)', async () => {
  const base = snap('rev-α-☃-001', 'A', false);
  const remote = snap('📦 rev with spaces :: 007', 'A', true);
  const res = await resolveConflict({
    base,
    readRemote: async () => remote,
    readLatestDraft: () => draftOf('B', false)
  });
  assert.equal(res.kind, 'retry');
  assert.equal(res.expectedRevision, '📦 rev with spaces :: 007');
  const res2 = await resolveConflict({
    base: snap('2', 'A', false),
    readRemote: async () => snap('10', 'A', false),
    readLatestDraft: () => draftOf('A', false)
  });
  assert.deepEqual(res2, { kind: 'clean', draft: draftOf('A', false) });
});

test('safety: plain and null-prototype records accepted; class/array instances rejected', async () => {
  const base = Object.assign(Object.create(null), { revision: 'b1', fields: Object.assign(Object.create(null), { title: 'A', done: false }) });
  const remote = Object.assign(Object.create(null), { revision: 'r2', fields: Object.assign(Object.create(null), { title: 'A', done: true }) });
  const d = Object.assign(Object.create(null), { title: 'B', done: false });
  const res = await resolveConflict({ base, readRemote: async () => remote, readLatestDraft: () => d });
  assert.equal(res.kind, 'retry');
  assert.deepEqual(res.patch, { title: 'B' });
  class Box { constructor() { this.revision = 'b1'; this.fields = { title: 'A', done: false }; } }
  await assert.rejects(() => resolveConflict({ base: new Box(), readRemote: async () => remote, readLatestDraft: () => draftOf('B', false) }));
  await assert.rejects(() => resolveConflict({ base: snap('b1', 'A', false), readRemote: async () => ['x'], readLatestDraft: () => draftOf('B', false) }));
});

test('safety: malformed callbacks and base rejected at entry without calling remote', async () => {
  const goodBase = snap('b1', 'A', false);
  const goodRemote = snap('r2', 'A', false);
  await assert.rejects(() => resolveConflict({ base: goodBase, readRemote: null, readLatestDraft: () => draftOf('A', false) }));
  await assert.rejects(() => resolveConflict({ base: goodBase, readRemote: async () => goodRemote, readLatestDraft: 'x' }));
  let called = 0;
  await assert.rejects(() => resolveConflict({ base: { revision: '', fields: { title: 'A', done: false } }, readRemote: async () => { called++; return goodRemote; }, readLatestDraft: () => draftOf('A', false) }));
  assert.equal(called, 0);
  await assert.rejects(() => resolveConflict({ base: { revision: 7, fields: { title: 'A', done: false } }, readRemote: async () => goodRemote, readLatestDraft: () => draftOf('A', false) }));
  await assert.rejects(() => resolveConflict({ base: { revision: 'b1', fields: { title: 'A' } }, readRemote: async () => goodRemote, readLatestDraft: () => draftOf('A', false) }));
});

test('safety: malformed remote snapshot rejected at boundary', async () => {
  const base = snap('b1', 'A', false);
  await assert.rejects(() => resolveConflict({ base, readRemote: async () => ({ revision: '', fields: { title: 'A', done: false } }), readLatestDraft: () => draftOf('A', false) }));
  await assert.rejects(() => resolveConflict({ base, readRemote: async () => ({ revision: 'r2', fields: { title: 1, done: false } }), readLatestDraft: () => draftOf('A', false) }));
  await assert.rejects(() => resolveConflict({ base, readRemote: async () => ({ revision: 'r2', fields: { title: 'A', done: 'no' } }), readLatestDraft: () => draftOf('A', false) }));
  await assert.rejects(() => resolveConflict({ base, readRemote: async () => ({ revision: 'r2', fields: { title: 'A', done: false }, extra: 1 }), readLatestDraft: () => draftOf('A', false) }));
});

test('safety: malformed draft and unknown fields rejected at boundary', async () => {
  const base = snap('b1', 'A', false);
  const remote = snap('r2', 'A', false);
  await assert.rejects(() => resolveConflict({ base, readRemote: async () => remote, readLatestDraft: () => ({ title: 'A' }) }));
  await assert.rejects(() => resolveConflict({ base, readRemote: async () => remote, readLatestDraft: () => ({ title: 'A', done: false, extra: 1 }) }));
  await assert.rejects(() => resolveConflict({ base, readRemote: async () => remote, readLatestDraft: () => ({ title: 5, done: false }) }));
  await assert.rejects(() => resolveConflict({ base: snap('b1', 'A', false), readRemote: async () => snap('r2', 'A', false), readLatestDraft: () => ({ title: 'A', done: false,zzz: 1 }.title ? { title: 'A', done: false, zzz: 1 } : null) }));
  await assert.rejects(() => resolveConflict({ base: { revision: 'b1', fields: { title: 'A', done: false, extra: true } }, readRemote: async () => remote, readLatestDraft: () => draftOf('A', false) }));
});

test('safety: remote rejection passes through and never reads draft', async () => {
  const base = snap('b1', 'A', false);
  let draftCalls = 0;
  const readRemote = async () => { throw new Error('boom-remote'); };
  const readLatestDraft = () => { draftCalls++; return draftOf('A', false); };
  await assert.rejects(() => resolveConflict({ base, readRemote, readLatestDraft }), /boom-remote/);
  assert.equal(draftCalls, 0);
});


// Coordinator regression from independent review: unknown own keys count even
// when non-enumerable. Exact record shape must not depend on JSON visibility.
test('safety: non-enumerable unknown own fields are rejected at every record boundary', async () => {
  const extra = object => Object.defineProperty(object, 'hiddenExtra', {value: true, enumerable: false});
  const goodBase = () => snap('base', 'A', false);
  const goodRemote = () => snap('remote', 'A', true);
  const goodDraft = () => draftOf('B', false);
  for (const location of ['base', 'baseFields', 'remote', 'remoteFields', 'draft']) {
    const base = goodBase(), remote = goodRemote(), draft = goodDraft();
    extra({base, baseFields: base.fields, remote, remoteFields: remote.fields, draft}[location]);
    await assert.rejects(() => resolveConflict({base, readRemote: async () => remote, readLatestDraft: () => draft}), TypeError, location);
  }
});
