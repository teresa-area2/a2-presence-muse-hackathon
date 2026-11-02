import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileMuseCollaboration,
  MUSE_COLLABORATION_MAX_BYTES,
  MUSE_COLLABORATION_VERSION,
} from '../scripts/muse-collaboration-contract.mjs';

const EXTENTS = ['terse', 'standard', 'full'];
const UPDATES = ['defer', 'send'];
const STYLES = ['conversational', 'self_contained'];
const make = (response_extent, unsolicited_update, conversation_style) => ({
  response_extent,
  unsolicited_update,
  conversation_style,
});
const valid = () => make('standard', 'defer', 'self_contained');

test('exports and all 12 combinations satisfy shape and byte bound', () => {
  assert.equal(MUSE_COLLABORATION_VERSION, 1);
  assert.equal(MUSE_COLLABORATION_MAX_BYTES, 384);
  const texts = new Set();
  for (const e of EXTENTS) for (const u of UPDATES) for (const s of STYLES) {
    const result = compileMuseCollaboration(make(e, u, s));
    assert.notEqual(result, null);
    assert.deepEqual(Object.keys(result).sort(), ['text', 'utf8_bytes', 'version']);
    assert.equal(result.version, 1);
    assert.ok(result.text.startsWith('Muse collaboration v1:\n'));
    assert.ok(!result.text.endsWith('\n'));
    assert.equal(result.utf8_bytes, new TextEncoder().encode(result.text).length);
    assert.ok(result.utf8_bytes <= MUSE_COLLABORATION_MAX_BYTES);
    assert.ok([...result.text].every((c) => c === '\n' || (c >= ' ' && c <= '~')));
    texts.add(result.text);
  }
  assert.equal(texts.size, 12);
});

test('each control changes meaning independently', () => {
  const base = compileMuseCollaboration(valid());
  assert.match(compileMuseCollaboration(make('terse', 'defer', 'self_contained')).text, /Lead with the result/);
  assert.match(compileMuseCollaboration(make('full', 'defer', 'self_contained')).text, /never invent tests/);
  assert.match(compileMuseCollaboration(make('standard', 'send', 'self_contained')).text, /meaningful milestones/);
  assert.match(compileMuseCollaboration(make('standard', 'defer', 'conversational')).text, /recommended default/);
  assert.match(base.text, /avoid optional preference questions/);
  assert.notEqual(compileMuseCollaboration(make('terse', 'defer', 'self_contained')).text, base.text);
  assert.notEqual(compileMuseCollaboration(make('standard', 'send', 'self_contained')).text, base.text);
  assert.notEqual(compileMuseCollaboration(make('standard', 'defer', 'conversational')).text, base.text);
});

test('deterministic and detached results', () => {
  const controls = valid();
  const a = compileMuseCollaboration(controls);
  const b = compileMuseCollaboration(controls);
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  a.text = 'mutated';
  a.utf8_bytes = 0;
  controls.response_extent = 'terse';
  assert.deepEqual(compileMuseCollaboration(valid()), b);
});

test('rejects missing, extra, unknown, and non-string controls', () => {
  assert.equal(compileMuseCollaboration({}), null);
  assert.equal(compileMuseCollaboration({ response_extent: 'terse', unsolicited_update: 'defer' }), null);
  assert.equal(compileMuseCollaboration({ ...valid(), extra: 'x' }), null);
  assert.equal(compileMuseCollaboration({ ...valid(), [Symbol('x')]: 1 }), null);
  assert.equal(compileMuseCollaboration(make('verbose', 'defer', 'self_contained')), null);
  assert.equal(compileMuseCollaboration(make('TERSE', 'defer', 'self_contained')), null);
  assert.equal(compileMuseCollaboration(make('standard', 'always', 'self_contained')), null);
  assert.equal(compileMuseCollaboration(make('standard', 'defer', 'chatty')), null);
  assert.equal(compileMuseCollaboration(make(1, 'defer', 'self_contained')), null);
  assert.equal(compileMuseCollaboration(make('standard', null, 'self_contained')), null);
  assert.equal(compileMuseCollaboration(make('standard', 'defer', ['self_contained'])), null);
});

test('rejects non-objects and non-plain prototypes; accepts null prototype', () => {
  for (const value of [null, undefined, 'standard', 1, true, [], () => {}, new Date()]) {
    assert.equal(compileMuseCollaboration(value), null);
  }
  class Controls {}
  assert.equal(compileMuseCollaboration(Object.assign(new Controls(), valid())), null);
  assert.equal(compileMuseCollaboration(Object.create({})), null);
  const bare = Object.create(null);
  Object.assign(bare, valid());
  assert.deepEqual(compileMuseCollaboration(bare), compileMuseCollaboration(valid()));
});

test('getters are rejected without being invoked', () => {
  let calls = 0;
  const controls = { unsolicited_update: 'defer', conversation_style: 'self_contained' };
  Object.defineProperty(controls, 'response_extent', {
    enumerable: true,
    get() { calls += 1; throw new Error('must not run'); },
  });
  assert.equal(compileMuseCollaboration(controls), null);
  assert.equal(calls, 0);
});

test('never renders arbitrary supplied strings', () => {
  const secret = 'SECRET_USER_STRING_123';
  assert.equal(compileMuseCollaboration(make(secret, 'defer', 'self_contained')), null);
  assert.equal(compileMuseCollaboration({ ...valid(), note: secret }), null);
  for (const e of EXTENTS) for (const u of UPDATES) for (const s of STYLES) {
    assert.ok(!compileMuseCollaboration(make(e, u, s)).text.includes(secret));
  }
});

test('candidate two makes format, immediate optional choice and no invented gates explicit',()=>{
 const a=compileMuseCollaboration(make('terse','defer','self_contained')),b=compileMuseCollaboration(make('full','send','conversational'));
 assert.ok(a.text.includes('Result/Checks/Risks bullets'));assert.match(a.text,/new approval gates/);assert.match(a.text,/necessary clarification/);
 assert.match(b.text,/question NOW/);assert.match(b.text,/recommended default/);assert.match(b.text,/No new approval gates/);
 for(const extent of ['terse','standard','full'])for(const update of ['defer','send'])for(const style of ['conversational','self_contained'])assert.ok(compileMuseCollaboration(make(extent,update,style)).utf8_bytes+1<=384);
});
