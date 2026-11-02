import test from 'node:test';
import assert from 'node:assert/strict';
import {isOptionalCommentary,shouldDeferCommentary,partitionPresenceMessages,heldNoticeText,createCommentaryProjection} from '../web/commentary-policy.mjs';

const now = Date.parse('2026-10-28T12:00:00.000Z');
const fresh = (over = {}) => ({
  source: {
    eligible: true,
    renderer: 'coding-instructions.3',
    read_at: new Date(now - 5000).toISOString(),
    received_at: new Date(now - 7000).toISOString(),
    controls: {response_extent: 'terse', unsolicited_update: 'defer', conversation_style: 'conversational'},
    capture: {state: 'collecting', reason: null},
    ...over,
  },
});
const rows = () => ([
  {author: 'You', text: 'do X', phase: 'sent'},
  {author: 'Muse', text: 'progress 1', phase: 'commentary'},
  {author: 'Muse', text: 'final', phase: 'finalAnswer'},
  {author: 'Muse', text: 'progress 2', phase: 'commentary'},
  {author: 'You', text: 'sending…', phase: 'attempted'},
]);

test('only Muse commentary is optional; user, final and unknown rows stay mandatory', () => {
  assert.equal(isOptionalCommentary({author: 'Muse', phase: 'commentary', text: 'working…'}), true);
  for(const r of [{author: 'You', phase: 'commentary', text: 'hi'}, {author: 'You', phase: 'sent', text: 'hi'},
    {author: 'Muse', phase: 'finalAnswer', text: 'done'}, {author: 'Muse', phase: 'sent', text: 'hi'},
    {author: 'Muse', phase: undefined, text: 'hi'}, {author: 'other', phase: 'commentary', text: 'hi'}, null, {}])
    assert.equal(isOptionalCommentary(r), false);
});

test('strict row validation: nonempty text, flags and kinds are mandatory', () => {
  const base = {author: 'Muse', phase: 'commentary', text: 'progress'};
  assert.equal(isOptionalCommentary(base), true);
  assert.equal(isOptionalCommentary({...base, text: ''}), false);
  assert.equal(isOptionalCommentary({...base, text: '   '}), false);
  assert.equal(isOptionalCommentary({...base, text: 42}), false);
  assert.equal(isOptionalCommentary({author: 'Muse', phase: 'commentary'}), false);
  assert.equal(isOptionalCommentary({...base, essential: true}), false);
  assert.equal(isOptionalCommentary({...base, mandatory: true}), false);
  assert.equal(isOptionalCommentary({...base, decisionNeeded: true}), false);
  assert.equal(isOptionalCommentary({...base, decision_needed: true}), false);
  assert.equal(isOptionalCommentary({...base, kind: 'error'}), false);
  assert.equal(isOptionalCommentary({...base, kind: 'decision'}), false);
  assert.equal(isOptionalCommentary({...base, kind: 'update'}), true);
  assert.equal(isOptionalCommentary({...base, author: 'muse'}), false);
  assert.equal(isOptionalCommentary({...base, phase: 'Commentary'}), false);
  assert.equal(isOptionalCommentary({...base, phase: 'error', kind: 'error', text: 'boom'}), false);
});

test('baseline arm shows ordinary updates: no defer without eligible defer guidance', () => {
  // Ordinary fallback cases must never defer.
  assert.equal(shouldDeferCommentary(null, now), false);
  assert.equal(shouldDeferCommentary({}, now), false);
  assert.equal(shouldDeferCommentary(fresh({eligible: false}), now), false);
  assert.equal(shouldDeferCommentary(fresh({controls: {response_extent: 'terse', unsolicited_update: 'send', conversation_style: 'conversational'}}), now), false);
  const stale = fresh(); stale.source.read_at = new Date(now - 21000).toISOString();
  assert.equal(shouldDeferCommentary(stale, now), false);
  const future = fresh(); future.source.read_at = new Date(now + 6000).toISOString();
  assert.equal(shouldDeferCommentary(future, now), false);
  const broken = fresh(); broken.source.controls = {response_extent: 'terse', unsolicited_update: 'defer'};
  assert.equal(shouldDeferCommentary(broken, now), false);
  assert.equal(shouldDeferCommentary(fresh(), now), true);
});

test('invalid controls never defer', () => {
  for(const controls of [
    {response_extent: 'verbose', unsolicited_update: 'defer', conversation_style: 'conversational'},
    {response_extent: 'terse', unsolicited_update: 'hold', conversation_style: 'conversational'},
    {response_extent: 'terse', unsolicited_update: 'defer', conversation_style: 'formal'},
    null, undefined, 'defer',
  ])
    assert.equal(shouldDeferCommentary(fresh({controls}), now), false);
});

test('old receipt with fresh read remains usable (no receipt-age cutoff)', () => {
  const old = fresh();
  old.source.received_at = new Date(now - 3600_000).toISOString();
  old.source.read_at = new Date(now - 5000).toISOString();
  assert.equal(shouldDeferCommentary(old, now), true);
});

test('held updates stay grouped and visible rows keep order', () => {
  const {visible, held} = partitionPresenceMessages(rows(), {defer: true});
  assert.deepEqual(visible.map(r => r.text), ['do X', 'final', 'sending…']);
  assert.deepEqual(held.map(r => r.text), ['progress 1', 'progress 2']);
});

test('manual reveal releases held commentary immediately in order', () => {
  const all = rows();
  const held = partitionPresenceMessages(all, {defer: true});
  assert.equal(held.held.length, 2);
  const shown = partitionPresenceMessages(all, {defer: true, revealed: true});
  assert.deepEqual(shown.visible, all);
  assert.deepEqual(shown.held, []);
});

test('policy change to send releases everything in original order', () => {
  const all = rows();
  const during = partitionPresenceMessages(all, {defer: true});
  assert.equal(during.visible.length, 3);
  const after = partitionPresenceMessages(all, {defer: false});
  assert.deepEqual(after.visible, all);
  assert.deepEqual(after.held, []);
});

test('held notice names current vs older receipt and reassures mandatory visibility', () => {
  const cur = heldNoticeText(2, 'Eligible guidance', 'Receipt 5s ago');
  assert.match(cur, /Holding 2 optional updates/);
  assert.match(cur, /Current eligible policy/);
  assert.match(cur, /Receipt 5s ago/);
  assert.match(cur, /Mandatory messages, approvals and answers stay visible/);
  const older = heldNoticeText(1, 'Last eligible guidance', 'Receipt 2m 0s ago');
  assert.match(older, /Holding 1 optional update[^s]/);
  assert.match(older, /Last eligible policy/);
  assert.ok(!cur.includes('flow') && !cur.includes('state of the user'));
});

test('non-array input never throws and reveals nothing', () => {
  assert.deepEqual(partitionPresenceMessages(null, {defer: true}), {visible: [], held: []});
  assert.deepEqual(partitionPresenceMessages(undefined, {defer: false}).held, []);
});

// ---- Stateful projector ----

const projRows = () => ([
  {author: 'You', text: 'do X', phase: 'sent'},
  {author: 'Muse', text: 'progress 1', phase: 'commentary'},
  {author: 'Muse', text: 'final', phase: 'finalAnswer'},
]);
const sendPresence = () => fresh({controls: {response_extent: 'terse', unsolicited_update: 'send', conversation_style: 'conversational'}});
const fallbackPresence = () => fresh({eligible: false});

test('with arm defers; baseline/without never consult Presence (throwing getter safe)', () => {
  const p = createCommentaryProjection();
  const r = p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  assert.equal(r.defer, true);
  assert.deepEqual(r.held.map(x => x.text), ['progress 1']);
  assert.deepEqual(r.visible.map(x => x.text), ['do X', 'final']);

  for(const arm of ['without', 'baseline', undefined]){
    const q = createCommentaryProjection();
    const opts = {arm, generation: 1, connected: true, now};
    Object.defineProperty(opts, 'presence', {enumerable: true, get(){ throw new Error('must not consult Presence'); }});
    // Baseline must not read `presence` at all, even when the getter throws.
    const out = q.project(projRows(), opts);
    assert.equal(out.defer, false);
    assert.deepEqual(out.held, []);
    assert.deepEqual(out.visible.map(x => x.text), ['do X', 'progress 1', 'final']);
  }
});

test('projector releases on send/fallback/unavailable/disconnect/expired read', () => {
  const cases = [
    ['send', sendPresence()],
    ['fallback', fallbackPresence()],
    ['unavailable', null],
    ['expired', (() => { const s = fresh(); s.source.read_at = new Date(now - 21000).toISOString(); return s; })()],
  ];
  for(const [name, presence] of cases){
    const p = createCommentaryProjection();
    // First hold under defer, then release under the case.
    const held = p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
    assert.equal(held.defer, true, name);
    const out = p.project(projRows(), {arm: 'with', generation: 1, presence, connected: true, now});
    assert.equal(out.defer, false, name);
    assert.deepEqual(out.held, [], name);
    assert.deepEqual(out.visible.map(x => x.text), ['do X', 'progress 1', 'final'], name);
  }
  const p2 = createCommentaryProjection();
  p2.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  const disc = p2.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: false, now});
  assert.equal(disc.defer, false);
  assert.deepEqual(disc.held, []);
});

test('projector release is sticky: later defer never re-hides visible messages', () => {
  const p = createCommentaryProjection();
  p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  const released = p.project(projRows(), {arm: 'with', generation: 1, presence: sendPresence(), connected: true, now});
  assert.deepEqual(released.visible.map(x => x.text), ['do X', 'progress 1', 'final']);
  const again = p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  assert.equal(again.defer, true);
  assert.deepEqual(again.held, []);
  assert.deepEqual(again.visible.map(x => x.text), ['do X', 'progress 1', 'final']);
});

test('clock-tick expiry releases and stays released when defer resumes', () => {
  const p = createCommentaryProjection();
  const t0 = now;
  const held = p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now: t0});
  assert.equal(held.defer, true);
  // UI ticks every clock tick: same rows re-projected at t0+21s (read expired).
  const stale = fresh(); stale.source.read_at = new Date(t0 - 5000).toISOString();
  const expired = p.project(projRows(), {arm: 'with', generation: 1, presence: stale, connected: true, now: t0 + 21000});
  assert.equal(expired.defer, false);
  assert.deepEqual(expired.held, []);
  // Fresh eligible read again: previously visible stays visible.
  const resumedSource = fresh(); resumedSource.source.read_at = new Date(t0 + 21000).toISOString();
  const resumed = p.project(projRows(), {arm: 'with', generation: 1, presence: resumedSource, connected: true, now: t0 + 22000});
  assert.equal(resumed.defer, true);
  assert.deepEqual(resumed.held, []);
});

test('manual reveal releases current held only; future optionals still hold', () => {
  const p = createCommentaryProjection();
  const first = p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  assert.deepEqual(first.held.map(x => x.text), ['progress 1']);
  p.reveal();
  const after = p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  assert.deepEqual(after.held, []);
  assert.deepEqual(after.visible.map(x => x.text), ['do X', 'progress 1', 'final']);
  const grown = [...projRows(), {author: 'Muse', text: 'progress 2', phase: 'commentary'}];
  const next = p.project(grown, {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  assert.deepEqual(next.visible.map(x => x.text), ['do X', 'progress 1', 'final']);
  assert.deepEqual(next.held.map(x => x.text), ['progress 2']);
});

test('new generation resets transient bookkeeping', () => {
  const p = createCommentaryProjection();
  p.project(projRows(), {arm: 'with', generation: 1, presence: sendPresence(), connected: true, now});
  const resumed = p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  assert.deepEqual(resumed.held, []);
  const nextGen = p.project(projRows(), {arm: 'with', generation: 2, presence: fresh(), connected: true, now});
  assert.equal(nextGen.defer, true);
  assert.deepEqual(nextGen.held.map(x => x.text), ['progress 1']);
});

test('projector preserves original order and survives cloned snapshots', () => {
  const p = createCommentaryProjection();
  const clone = (rs) => rs.map(r => ({...r}));
  const msgs = projRows();
  const a = p.project(clone(msgs), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  assert.deepEqual(a.visible.map(x => x.text), ['do X', 'final']);
  const b = p.project(clone(msgs), {arm: 'with', generation: 1, presence: sendPresence(), connected: true, now});
  assert.deepEqual(b.visible.map(x => x.text), ['do X', 'progress 1', 'final']);
  // Cloned rows after release must not be re-held when defer resumes.
  const c = p.project(clone(msgs), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  assert.deepEqual(c.held, []);
  assert.deepEqual(c.visible.map(x => x.text), ['do X', 'progress 1', 'final']);
});

test('projector treats invalid controls as release and remembers it', () => {
  const p = createCommentaryProjection();
  p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  const bad = fresh(); bad.source.controls = {response_extent: 'terse', unsolicited_update: 'defer'};
  const out = p.project(projRows(), {arm: 'with', generation: 1, presence: bad, connected: true, now});
  assert.equal(out.defer, false);
  assert.deepEqual(out.held, []);
  const resumed = p.project(projRows(), {arm: 'with', generation: 1, presence: fresh(), connected: true, now});
  assert.deepEqual(resumed.held, []);
});

test('identical later commentary is new even after the earlier occurrence was revealed',()=>{
 const p=createCommentaryProjection();const one=[{author:'Muse',phase:'commentary',text:'same progress'}];const options={arm:'with',generation:1,presence:fresh(),connected:true,now};
 assert.equal(p.project(one,options).held.length,1);p.reveal();assert.equal(p.project(one.map(x=>({...x})),options).held.length,0);
 const two=p.project([...one.map(x=>({...x})),{...one[0]}],options);assert.equal(two.visible.length,1);assert.equal(two.held.length,1);
});

test('unknown and explicit error/approval rows remain visible under defer',()=>{const base={author:'Muse',phase:'commentary',text:'important'};for(const change of [{author:'System'},{type:'error'},{type:'approval'},{kind:'approval'},{error:{message:'failed'}}])assert.equal(isOptionalCommentary({...base,...change}),false);});
test('truncated or rewritten histories conservatively release rather than rehide',()=>{for(const rewrite of [rows=>rows.slice(1),rows=>[rows[2],rows[1],rows[0]],rows=>rows.map((r,i)=>i===0?{...r,text:'rewritten task'}:r)]){const p=createCommentaryProjection(),msgs=projRows();p.project(msgs,{arm:'with',generation:1,presence:sendPresence(),connected:true,now});const next=rewrite(msgs);const result=p.project(next,{arm:'with',generation:1,presence:fresh(),connected:true,now});assert.deepEqual(result.visible,next);assert.equal(result.held.length,0);}});
test('duplicate messages are individually revealed and newly appended copies can defer',()=>{const p=createCommentaryProjection(),one={author:'Muse',phase:'commentary',text:'same'},opts={arm:'with',generation:1,presence:fresh(),connected:true,now};p.project([one],opts);p.reveal();const result=p.project([{...one},{...one}],opts);assert.equal(result.visible.length,1);assert.equal(result.held.length,1);});


test('human delivery acknowledgments preserve held occurrences and observed history',()=>{
 const p=createCommentaryProjection(),options={arm:'with',generation:1,presence:fresh(),connected:true,now};
 const messages=[{author:'You',phase:'attempted',text:'Review this change'},...Array.from({length:2},()=>({author:'Muse',phase:'commentary',text:'same update'}))];
 assert.equal(p.project(messages,options).held.length,2);
 for(const phase of ['sent','steered','not_sent','unconfirmed','sent']){
  const snapshot=messages.map((row,index)=>({...row,...(index===0?{phase}:{})}));
  const result=p.project(snapshot,options);
  assert.equal(result.defer,true);assert.equal(result.held.length,2);assert.equal(result.visible.length,1);
  assert.deepEqual(p.metrics(),{schema_version:1,held_current:2,held_total:2,released_manual:0,released_automatic:0,history_resets:0,coverage:'observed'});
 }
});

test('human content and optional-type changes still count as real history rewrites',()=>{
 for(const change of [
  messages=>messages.map((row,index)=>index===0?{...row,text:'different task'}:row),
  messages=>messages.map((row,index)=>index===1?{...row,phase:'finalAnswer'}:row),
  messages=>messages.map((row,index)=>index===1?{...row,mandatory:true}:row),
 ]){
  const p=createCommentaryProjection(),options={arm:'with',generation:1,presence:fresh(),connected:true,now},messages=projRows();
  p.project(messages,options);const rewritten=change(messages),result=p.project(rewritten,options);
  assert.deepEqual(result.visible,rewritten);assert.equal(result.held.length,0);
  assert.equal(p.metrics().history_resets,1);assert.equal(p.metrics().coverage,'partial');
 }
});

test('each optional update has a bounded hold even while valid defer guidance persists',()=>{
 let tick=0;const p=createCommentaryProjection({monotonicNow:()=>tick});
 const a={author:'Muse',phase:'commentary',text:'first progress'},b={author:'Muse',phase:'commentary',text:'second progress'},final={author:'Muse',phase:'finalAnswer',text:'essential result'};
 const opts=()=>({arm:'with',generation:1,presence:fresh({read_at:new Date(now+tick).toISOString()}),connected:true,now:now+tick});
 assert.equal(p.project([a,final],opts()).held.length,1);tick=60000;
 assert.equal(p.project([a,final,b],opts()).held.length,2);tick=119999;assert.equal(p.project([a,final,b],opts()).held.length,2);
 tick=120000;const first=p.project([a,final,b],opts());assert.deepEqual(first.visible,[a,final]);assert.deepEqual(first.held,[b]);assert.equal(first.defer,true,'the policy remains defer while the oldest host hold expires');
 tick=180000;const second=p.project([a,final,b],opts());assert.deepEqual(second.visible,[a,final,b]);assert.equal(second.held.length,0);assert.equal(p.metrics().released_automatic,2);assert.equal(p.metrics().held_total,2);
});

test('hold clocks do not reset on policy refresh or cloned snapshots and clock anomalies release safely',()=>{
 let tick=0;const p=createCommentaryProjection({monotonicNow:()=>tick});const msgs=[{author:'Muse',phase:'commentary',text:'progress'}];
 const opts=()=>({arm:'with',generation:4,presence:fresh({read_at:new Date(now+tick).toISOString()}),connected:true,now:now+tick});
 p.project(msgs,opts());tick=119000;p.project(structuredClone(msgs),opts());tick=120000;assert.equal(p.project(structuredClone(msgs),opts()).held.length,0);
 const q=createCommentaryProjection({monotonicNow:()=>tick});q.project(msgs,opts());tick=1;assert.equal(q.project(msgs,opts()).held.length,0,'a backwards monotonic clock cannot strand an update');
});


test('a remounted pane never re-hides recovered history; new progress can still defer',()=>{
 let tick=0;const row={author:'Muse',phase:'commentary',text:'saved progress'};
 const options=()=>({arm:'with',generation:5,presence:fresh({read_at:new Date(now+tick).toISOString()}),connected:true,now:now+tick});
 const original=createCommentaryProjection({monotonicNow:()=>tick,revealExistingOnMount:true});
 original.project([],options());assert.equal(original.project([row],options()).held.length,1);
 tick=120000;assert.deepEqual(original.project([row],options()).visible,[row]);
 const reloaded=createCommentaryProjection({monotonicNow:()=>tick,revealExistingOnMount:true});
 assert.deepEqual(reloaded.project([row],options()).visible,[row]);
 const next={...row,text:'new progress'};assert.deepEqual(reloaded.project([row,next],options()).held,[next]);
 tick+=120000;assert.deepEqual(reloaded.project([row,next],options()).visible,[row,next]);
});
