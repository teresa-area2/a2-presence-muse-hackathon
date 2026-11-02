import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePresenceReadings, createReadingHistory, readingPolicySummary, mountReadingHistory, readingPulseValues, createReadingPulseRenderer, mountReadingPulse, createTextboxReadingClock, currentTextboxDisplay, textboxPresenceCopy, revealReadingRow} from '../web/terminal-presence-view.mjs';
import {projectEvidence} from '../src/evidence-projection.mjs';
const base = Date.parse('2026-10-29T10:00:00Z');
const controls = {response_extent: 'terse', unsolicited_update: 'defer', conversation_style: 'conversational'};
const row = (n, extra = {}) => ({reading_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  received_at: new Date(base + n * 30000).toISOString(), generated_at: new Date(base + n * 30000 - 1000).toISOString(),
  controls: {...controls}, policy_change: n === 1 ? 'first' : 'unchanged', ...extra});
const state = (readings, extra = {}) => ({session_generation: 1, textbox: {readings, readings_omitted: 0,
  ...readings.at(-1), consented: true, selected: true, freshness_limit_ms: 120000, ...extra}});

test('distinct readings with identical policy remain distinct; repeated snapshots and duplicate IDs do not add rows', () => {
  const history = createReadingHistory(), s = state([row(1), row(2), row(2)]);
  assert.equal(history.update(s).rows.length, 2);
  assert.equal(history.update(s).rows.length, 2);
  assert.equal(readingPolicySummary(row(2), row(1)), 'Policy unchanged');
  assert.match(readingPolicySummary(row(3, {controls: {...controls, response_extent: 'full'}, policy_change: 'changed'}), row(2)), /Depth Terse → Full/);
});
test('a new page restores the buffered session history, while older backends explicitly have only observed coverage', () => {
  const old = createReadingHistory();
  const latest = {session_generation: 1, textbox: {...row(2)}};
  assert.equal(old.update(latest).coverage, 'observed');
  assert.deepEqual(old.update(latest).rows, [row(2)]);
  assert.equal(old.update({session_generation: 1, textbox: row(3)}).rows.length, 2);
  assert.equal(old.update({session_generation: 2, textbox: {}}).rows.length, 0);
  const restored = createReadingHistory().update(state([row(1), row(2), row(3)]));
  assert.equal(restored.coverage, 'session'); assert.equal(restored.rows.length, 3);
});
test('reading metadata is bounded, copied and closed-schema; acceptance order survives local clock correction', () => {
  const input = row(1, {guidance: 'PRIVATE', capsule: 'PRIVATE', keyTimes: 'PRIVATE', controls: {...controls, raw: 'PRIVATE'}});
  const rows = normalizePresenceReadings([input, row(2, {received_at: 'not a timestamp'}), row(3, {controls: {...controls, response_extent: 'PRIVATE'}}), row(4, {reading_id: 'PRIVATE'})]);
  assert.deepEqual(rows, [row(1)]); assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
  rows[0].controls.response_extent = 'full'; assert.equal(input.controls.response_extent, 'terse');
  assert.deepEqual(normalizePresenceReadings([row(2), row(1)]).map(x => x.reading_id), [row(2).reading_id, row(1).reading_id]);
  assert.equal(normalizePresenceReadings(Array.from({length: 205}, (_, i) => row(i + 1))).length, 200);
});
test('evidence exports every safe reading and leaves old-backend history unavailable', () => {
  const value = state([row(1), row(2, {capsule: 'PRIVATE', guidance: 'PRIVATE'})], {readings_omitted: 4});
  const out = projectEvidence(value).textbox;
  assert.equal(out.readings.length, 2); assert.equal(out.readings_omitted, 4);
  assert.equal(out.readings[1].policy_change, 'unchanged'); assert.ok(!JSON.stringify(out).includes('PRIVATE'));
  assert.equal(projectEvidence({textbox: {}}).textbox.readings, null);
});

class Element {
  constructor() {this.dataset = {}; this.children = []; this.listeners = new Map(); this.attributes = {}; this.textContent = ''; this.disabled = false;}
  setAttribute(key, value) {this.attributes[key] = value;}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children = nodes;}
  addEventListener(name, fn) {this.listeners.set(name, fn);}
  removeEventListener(name, fn) {if (this.listeners.get(name) === fn) this.listeners.delete(name);}
  closest() {return this.card;}
}
function fixture() {
  const ids = ['policy-history', 'pulse-view', 'pulse-view-caption', 'pulse-view-policy', 'pulse-view-policy-title', 'pulse-policy-depth', 'pulse-policy-updates', 'pulse-policy-conversation', 'pulse-replay', 'policy-latest', 'presence-policy-depth', 'policy-last'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()])); elements['presence-policy-depth'].card = new Element();
  for (const field of ['depth','updates','conversation']) elements['pulse-policy-'+field].card = new Element();
  const draws = [], timers = new Map(); let timer = 0, clock = base + 61000;
  class Animator {update(values) {draws.push(values);} setActive() {} clear() {draws.push(null);}}
  const document = {getElementById: id => elements[id], createElement: () => new Element()};
  const panel = mountReadingHistory(document, {loadAnimator: async () => Animator, now: () => clock,
    setTimer: fn => {timers.set(++timer, fn); return timer;}, clearTimer: id => timers.delete(id)});
  const tick = () => {const [id, fn] = timers.entries().next().value; timers.delete(id); fn();};
  return {elements, panel, draws, timers, tick, advance: ms => clock += ms};
}
test('visible rows show each receipt time and unchanged policy; replay includes both identical-policy readings', async () => {
  const f = fixture(); f.panel.render(state([row(1), row(2)])); await Promise.resolve();
  const list = f.elements['policy-history']; assert.equal(list.children.length, 2);
  assert.match(list.children[1].children.at(-1).textContent, /Reading 2 · Policy unchanged/);
  assert.equal(list.children[1].children[0].attributes.datetime, row(2).received_at);
  assert.equal(list.children[1].dataset.active, 'true');
  assert.match(f.elements['policy-latest'].textContent, /2 readings/);
  assert.equal(f.elements['pulse-replay'].disabled, false);
  f.elements['pulse-replay'].listeners.get('click')();
  assert.match(f.elements['pulse-view-caption'].textContent, /Replay · Reading 1/); f.tick();
  assert.match(f.elements['pulse-view-caption'].textContent, /Replay · Reading 2/); f.tick();
  assert.equal(f.timers.size, 0); assert.equal(f.elements['pulse-replay'].attributes['aria-pressed'], 'false');
  f.panel.close();
});
test('expiry and disconnect retain readings while the current Pulse reports ordinary fallback', async () => {
  const f = fixture(), s = state([row(1), row(2)]); f.panel.render(s); await Promise.resolve();
  f.advance(120001); f.panel.render(s); await Promise.resolve();
  assert.equal(f.elements['policy-history'].children.length, 2);
  assert.match(f.elements['pulse-view-caption'].textContent, /ordinary fallback/);
  assert.equal(f.draws.at(-1), null);
  f.panel.render(s, {connected: false}); assert.match(f.elements['policy-latest'].textContent, /ordinary fallback/); f.panel.close();
});
test('opening a new comparison clears rows and cancels replay; malformed selected snapshots cannot crash the view', () => {
  const f = fixture(); f.panel.render(state([row(1), row(2)])); f.elements['pulse-replay'].listeners.get('click')(); assert.equal(f.timers.size, 1);
  f.panel.render({session_generation: 2, textbox: {readings: [], readings_omitted: 0, selected: true, consented: true, freshness_limit_ms: 120000}});
  assert.equal(f.timers.size, 0); assert.equal(f.elements['policy-history'].children[0].className, 'empty');
  assert.equal(f.elements['policy-history'].children[0].dataset.active, 'false');
  assert.equal(f.elements['pulse-replay'].disabled, true); f.panel.close(); assert.equal(f.elements['pulse-replay'].listeners.size, 0);
});
test('bounded history explains omissions and preserves source reading numbering', () => {
  const f = fixture(); f.panel.render(state([row(4), row(5)], {readings_omitted: 3}));
  assert.match(f.elements['policy-latest'].textContent, /3 earlier readings omitted/);
  assert.match(f.elements['policy-history'].children[0].children.at(-1).textContent, /Reading 4/); f.panel.close();
});
test('legacy live backends get an honest observed-only timeline without requiring a new server route', () => {
  const f = fixture(); f.panel.render({session_generation: 1, textbox: {...row(2), selected: false}});
  assert.match(f.elements['policy-latest'].textContent, /earlier readings unavailable/);
  assert.equal(f.elements['policy-history'].children.length, 1); f.panel.close();
});
test('buffer recovery or eviction cancels queued replay before it can misnumber an old reading', () => {
  const f = fixture();
  f.panel.render(state(Array.from({length: 200}, (_, i) => row(i + 1))));
  f.elements['pulse-replay'].listeners.get('click')();
  assert.match(f.elements['pulse-view-caption'].textContent, /Replay · Reading 1/);
  assert.equal(f.timers.size, 1);
  f.panel.render(state(Array.from({length: 200}, (_, i) => row(i + 21)), {readings_omitted: 20}));
  assert.equal(f.timers.size, 0);
  assert.equal(f.elements['pulse-replay'].attributes['aria-pressed'], 'false');
  assert.doesNotMatch(f.elements['pulse-view-caption'].textContent, /Replay/);
  assert.match(f.elements['policy-history'].children[0].children.at(-1).textContent, /Reading 21/);
  f.panel.close();
});

test('illustrative Pulse values are stable per reading and vary within separate categorical bands', () => {
  const bands = {terse: [.2, .3], standard: [.4, .6], full: [.7, .8]};
  for (const extent of Object.keys(bands)) {
    const shapes = new Set();
    for (let i = 1; i <= 128; i++) {
      const sample = row(i, {controls: {...controls, response_extent: extent}}), original = structuredClone(sample);
      const values = readingPulseValues(sample);
      assert.ok(values[0] >= bands[extent][0] && values[0] <= bands[extent][1]);
      assert.ok(values[1] >= .7 && values[1] <= .8); assert.ok(values[2] >= .7 && values[2] <= .8);
      assert.deepEqual(readingPulseValues({...sample, received_at: 'different', raw_scores: 'PRIVATE'}), values);
      assert.deepEqual(sample, original); shapes.add(JSON.stringify(values));
    }
    assert.equal(shapes.size, 128);
  }
  const low = readingPulseValues(row(1, {controls: {...controls, unsolicited_update: 'send', conversation_style: 'self_contained'}}));
  assert.ok(low[1] >= .2 && low[1] <= .3); assert.ok(low[2] >= .2 && low[2] <= .3);
  assert.equal(readingPulseValues(null), null); assert.equal(readingPulseValues({...row(1), reading_id: null}), null);
  assert.equal(readingPulseValues(row(1, {controls: {...controls, response_extent: 'unknown'}})), null);
});

test('shared renderer avoids redraw jitter and hides the pinned artwork numeric RFS label', async () => {
  const root = new Element(), svg = new Element(), draws = []; root.querySelector = () => svg;
  let closes = 0;
  class Animator {update(values) {draws.push(values); svg.setAttribute('aria-label', 'readiness 0.500 flow 0.750 stability 0.750');} setActive() {} clear() {} close() {closes++;}}
  const renderer = createReadingPulseRenderer(root, {loadAnimator: async () => Animator});
  await renderer.update(row(1)); await renderer.update(row(1)); assert.equal(draws.length, 1);
  await renderer.update(row(2)); assert.equal(draws.length, 2); assert.deepEqual(draws[1], readingPulseValues(row(2)));
  assert.equal(svg.attributes['aria-hidden'], 'true'); assert.equal(svg.attributes['aria-label'], 'Illustrative policy-derived Pulse');
  await renderer.update(null); assert.equal(root.dataset.available, 'false'); renderer.close(); assert.equal(closes, 1);
  await renderer.update(row(3)); assert.equal(draws.length, 2);
});

test('unavailable Pulse stays static and the same artwork recovers after live guidance expires', async () => {
  const root = new Element(), svg = new Element(), active = [], draws = [];
  root.innerHTML = '<span>◌</span>';
  let imports = 0, mounts = 0, clears = 0;
  class Animator {
    constructor() {mounts++; root.innerHTML = '<svg></svg>';}
    update(values) {assert.equal(root.innerHTML, '<svg></svg>', 'fallback must retain the animator mount'); draws.push(values);}
    setActive(value) {active.push(value);}
    clear() {clears++;}
  }
  root.querySelector = () => root.innerHTML === '<svg></svg>' ? svg : null;
  const renderer = createReadingPulseRenderer(root, {loadAnimator: async () => {imports++; return Animator;}});
  await renderer.update(null);
  assert.equal(root.dataset.available, 'false'); assert.equal(root.innerHTML, '');
  assert.equal(imports, 0, 'unavailable guidance needs no active artwork or animation');
  await renderer.update(row(1)); assert.equal(root.dataset.available, 'true');
  await renderer.update(null); assert.equal(root.dataset.available, 'false');
  assert.equal(clears, 1); assert.equal(root.innerHTML, '<svg></svg>');
  await renderer.update(row(2)); assert.equal(root.dataset.available, 'true');
  assert.deepEqual(active, [true, false, true]); assert.equal(imports, 1); assert.equal(mounts, 1);
  assert.deepEqual(draws, [readingPulseValues(row(1)), readingPulseValues(row(2))]);
  renderer.close();
});

test('header and replay use the same seeded Pulse while policy comparisons remain exact', async () => {
  const root = new Element(), headerDraws = [], document = {createElement: () => new Element()};
  root.ownerDocument = document; root.classList = {add() {}};
  class Animator {update(values) {headerDraws.push(values);} setActive() {} clear() {} close() {}}
  const header = mountReadingPulse(root, {loadAnimator: async () => Animator});
  await header.update(row(2));
  const f = fixture(); f.panel.render(state([row(1), row(2)])); await Promise.resolve();
  assert.deepEqual(headerDraws[0], f.draws.at(-1));
  f.elements['pulse-replay'].listeners.get('click')(); await Promise.resolve();
  assert.deepEqual(f.draws.at(-1), readingPulseValues(row(1))); f.tick(); await Promise.resolve();
  assert.deepEqual(f.draws.at(-1), headerDraws[0]);
  assert.match(f.elements['policy-history'].children[1].children.at(-1).textContent, /Policy unchanged/);
  assert.match(root.attributes['aria-label'], /variation is decorative/);
  assert.equal(projectEvidence(state([row(1), row(2)])).textbox.readings[1].controls.response_extent, 'terse');
  header.close(); f.panel.close();
});

test('a fallback or close supersedes a pending Pulse import without painting late guidance', async () => {
  const root = new Element(), draws = []; let release;
  class Animator {update(values) {draws.push(values);} setActive() {} clear() {} close() {}}
  const renderer = createReadingPulseRenderer(root, {loadAnimator: () => new Promise(r => {release = r;})});
  const pending = renderer.update(row(1)); await renderer.update(null); release(Animator); await pending;
  assert.deepEqual(draws, []); assert.equal(root.dataset.available, 'false'); renderer.close();
});

test('buffered observation expires by monotonic age before its fresh receipt, across all displayed policies', () => {
  let tick = 1000, wall = base + 61000;
  const clock = createTextboxReadingClock({now: () => wall, monotonicNow: () => tick});
  const s = {...state([row(1), row(2)], {age_ms: 0, observation_age_ms: 119000}),
    presence: {source: {eligible: true, controls: {...controls}}}};
  assert.equal(clock(s.textbox).current, true); tick += 1001; wall -= 100000;
  assert.equal(clock(s.textbox).current, false);
  const display = currentTextboxDisplay(s, clock);
  assert.equal(display.textbox.selected, false); assert.equal(display.presence.source.eligible, false);
  assert.equal(display.presence.source.controls, null); assert.equal(s.presence.source.eligible, true);
  assert.equal(display.textbox.readings.length, 2);
  assert.equal(clock({...s.textbox, observation_age_ms: null}).current, true, 'old-backend receipt-only compatibility');
});

test('the timeline expires the same delayed observation without waiting for a new server snapshot', () => {
  let tick = 1000;
  const f = fixture(); // Reuse its DOM; an explicit clock controls this panel.
  f.panel.close();
  const document = {getElementById: id => f.elements[id], createElement: () => new Element()};
  const panel = mountReadingHistory(document, {loadAnimator: async () => null, now: () => base + 61000, monotonicNow: () => tick});
  const s = state([row(1), row(2)], {age_ms: 0, observation_age_ms: 119000});
  panel.render(s); assert.match(f.elements['pulse-view-caption'].textContent, /Reading 2/);
  tick += 1001; panel.render(s); assert.match(f.elements['pulse-view-caption'].textContent, /ordinary fallback/);
  assert.equal(f.elements['policy-history'].children.length, 2); panel.close();
});

test('receipt and typing-observation ages are explicit and queued status stays visible at narrow widths', () => {
  const reading = {...row(2), age_ms: 0, observation_age_ms: 119000, selected: true, consented: true};
  const copy = textboxPresenceCopy(reading, {observation: {window: 'closed', last_submission: 'queued'}});
  assert.match(copy.connection, /Typing sample waiting for OP/); assert.match(copy.connection, /typing observation is 119s old/);
});

test('replay follows its active row in both directions inside the table only', () => {
  const f = fixture(), samples = Array.from({length: 8}, (_, i) => row(i + 1));
  f.panel.render(state(samples));
  const list = f.elements['policy-history'], positions = [];
  Object.assign(list, {clientHeight: 80, scrollHeight: 320, scrollTop: 240,
    getBoundingClientRect: () => ({top: 100}),
    scrollTo: options => {positions.push(options); list.scrollTop = options.top;}});
  for (const [index, item] of list.children.entries()) item.getBoundingClientRect = () => ({top: 100 + index * 40 - list.scrollTop, bottom: 140 + index * 40 - list.scrollTop});
  f.elements['pulse-replay'].listeners.get('click')();
  assert.equal(list.scrollTop, 0, 'replay starts by revealing the first reading');
  f.tick(); assert.equal(list.scrollTop, 0, 'a visible row does not move the table');
  f.tick(); assert.equal(list.scrollTop, 40, 'the next offscreen row is revealed');
  for (let i = 0; i < 5; i++) f.tick();
  assert.equal(list.scrollTop, 240); assert.equal(list.children[7].dataset.active, 'true');
  assert.ok(positions.every(x => x.behavior === 'smooth')); f.panel.close();
});

test('history autoscroll respects reduced motion and bounds the table scroll', () => {
  let result;
  const list = {scrollTop: 90, scrollHeight: 200, clientHeight: 100, clientTop: 1,
    ownerDocument: {defaultView: {matchMedia: () => ({matches: true})}},
    getBoundingClientRect: () => ({top: 10}), scrollTo: options => {result = options;}};
  revealReadingRow(list, {getBoundingClientRect: () => ({top: 200, bottom: 250})});
  assert.deepEqual(result, {top: 100, behavior: 'auto'});
  result = null; revealReadingRow(list, {getBoundingClientRect: () => ({top: 20, bottom: 40})}); assert.equal(result, null);
});
test('a single reading can be replayed and returns to current or fallback state',async()=>{
 for(const selected of [true,false]){
  const f=fixture();f.panel.render(state([row(1)],{selected}));await Promise.resolve();
  assert.equal(f.elements['pulse-replay'].disabled,false);f.elements['pulse-replay'].listeners.get('click')();
  assert.equal(f.elements['pulse-replay'].attributes['aria-pressed'],'true');assert.match(f.elements['pulse-view-caption'].textContent,/Replay · Reading 1/);
  assert.equal(f.timers.size,1);f.tick();assert.equal(f.elements['pulse-replay'].attributes['aria-pressed'],'false');
  assert.match(f.elements['pulse-view-caption'].textContent,selected?/^Reading 1/:/ordinary fallback/);assert.equal(f.timers.size,0);f.panel.close();
 }
});
test('replay stays disabled when there are no readings',()=>{const f=fixture();f.panel.render(state([],{selected:false}));assert.equal(f.elements['pulse-replay'].disabled,true);f.elements['pulse-replay'].listeners.get('click')();assert.equal(f.timers.size,0);f.panel.close();});


test('Pulse policy card follows the selected reading and highlights only its changed fields',()=>{
 const first=row(1,{controls:{response_extent:'standard',unsolicited_update:'send',conversation_style:'conversational'}});
 const second=row(2,{controls:{response_extent:'terse',unsolicited_update:'send',conversation_style:'self_contained'},policy_change:'changed'});
 const f=fixture();f.panel.render(state([first,second]));
 const value=field=>f.elements['pulse-policy-'+field],changed=field=>value(field).card.dataset.changed;
 assert.equal(f.elements['pulse-view-policy-title'].textContent,'Current policy');
 assert.equal(value('depth').textContent,'Terse');assert.equal(value('updates').textContent,'Send');assert.equal(value('conversation').textContent,'Self contained');
 assert.deepEqual(['depth','updates','conversation'].map(changed),['true','false','true']);
 assert.match(value('depth').attributes['aria-label'],/changed from Standard/i);
 assert.equal(value('depth').card.dataset.level,'1');assert.equal(value('updates').card.dataset.level,'2');
 assert.match(f.elements['pulse-view-caption'].textContent,/^Reading 2 · \d\d:\d\d:\d\d$/);
 f.elements['pulse-replay'].listeners.get('click')();
 assert.equal(f.elements['pulse-view-policy-title'].textContent,'Replayed policy');
 assert.equal(value('depth').textContent,'Standard');assert.deepEqual(['depth','updates','conversation'].map(changed),['false','false','false']);
 f.tick();assert.equal(value('depth').textContent,'Terse');assert.equal(changed('depth'),'true');assert.equal(changed('updates'),'false');
 assert.match(f.elements['pulse-view-caption'].textContent,/^Replay · Reading 2 · \d\d:\d\d:\d\d$/);
 f.tick();assert.equal(f.elements['pulse-view-policy-title'].textContent,'Current policy');f.panel.close();
});

test('Pulse policy card clears values and highlights when guidance expires after replay',()=>{
 const f=fixture(),s=state([row(1),row(2,{controls:{...controls,response_extent:'full'},policy_change:'changed'})]);
 f.panel.render(s);f.advance(120001);f.panel.render(s);
 const assertFallback=()=>{
  assert.equal(f.elements['pulse-view-policy-title'].textContent,'No current policy');
  assert.match(f.elements['pulse-view-caption'].textContent,/ordinary fallback/i);
  for(const field of ['depth','updates','conversation']){
   const node=f.elements['pulse-policy-'+field];assert.equal(node.textContent,'—');assert.equal(node.card.dataset.changed,'false');assert.equal(node.card.dataset.level,undefined);
  }
 };
 assertFallback();f.elements['pulse-replay'].listeners.get('click')();
 assert.equal(f.elements['pulse-view-policy-title'].textContent,'Replayed policy');assert.equal(f.elements['pulse-policy-depth'].textContent,'Terse');
 f.tick();assert.equal(f.elements['pulse-policy-depth'].textContent,'Full');f.tick();assertFallback();
 assert.equal(f.elements['policy-history'].children.length,2);f.panel.close();
});
