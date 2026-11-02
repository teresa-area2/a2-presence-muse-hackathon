import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildObserverEvidence,
  observerSelectionSchema,
  observerPrompt,
  validateObserverSelection
} from '../src/presence-observer.mjs';

const NOW = Date.parse('2026-10-30T12:00:00.000Z');
const RECENT_AT = new Date(NOW - 5000).toISOString();
const STALE_AT = new Date(NOW - 60000).toISOString();
const GOOD_CONTROLS = {
  response_extent: 'standard',
  unsolicited_update: 'send',
  conversation_style: 'conversational'
};
const READ1 = '11111111-1111-1111-1111-111111111111';
const READ2 = '22222222-2222-2222-2222-222222222222';
const READING1 = '33333333-3333-3333-3333-333333333333';
const SENTINEL = 'SENTINEL_PRIVATE_CAPSULE_9f8a_credential_path_/etc/secret';

function baseMessages() {
  return [
    { author: 'Muse', phase: 'finalAnswer', text: 'hello world' },
    { author: 'Muse', phase: 'finalAnswer', text: 'three word sentence here' },
    { author: 'Muse', phase: 'commentary', text: 'commentary should not count' },
    { author: 'human', phase: 'finalAnswer', text: 'human typing must not count' }
  ];
}

function matchedDelivery() {
  return {
    status: 'request_observed',
    turn_ordinal: 1,
    request_dispatch_elapsed_ms: 12,
    requests_observed: 2,
    public_finals: 1,
    turn_completed: true,
    shared_quality_observed: false,
    trace_ended: true,
    request_attribution: [
      {
        ordinal: 1,
        status: 'guidance_observed',
        read_id: READ1,
        reading_id: READING1,
        controls: { ...GOOD_CONTROLS },
        receipt_age_seconds: 1
      },
      {
        ordinal: 2,
        status: 'fallback_observed',
        read_id: READ2,
        reading_id: null,
        controls: null,
        receipt_age_seconds: null
      }
    ],
    hook_linkage: 'read_marker_matched'
  };
}

function makeState(over = {}) {
  const withDelivery = over.withDelivery ?? matchedDelivery();
  const withUsage = over.withUsage ?? {
    status: 'observed',
    model_calls: 3,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 10,
    estimated_cost_usd: 0.42,
    cost_partial: false,
    coverage: 'observed',
    source: 'native'
  };
  const withMessages = over.withMessages ?? baseMessages();
  const withoutMessages = over.withoutMessages ?? [{ author: 'Muse', phase: 'finalAnswer', text: 'one more final' }];
  const matched = over.matched_context ?? true;
  const readAt = over.read_at ?? RECENT_AT;
  const controls = over.controls ?? {...GOOD_CONTROLS};
  const deliveryStatus = over.deliveryStatus;
  const withEffort = over.withEffort ?? null;
  const withoutEffort = over.withoutEffort ?? null;
  const state = {
    session_generation: 7,
    status: 'ready',
    comparison: { matched_context: matched },
    arms: {
      with: {
        status: 'ready',
        usage: withUsage,
        elapsed: { status: 'completed', completed_seconds: 5, total_seconds: 5, completed_turns: 1 },
        delivery: withDelivery,
        messages: withMessages
      },
      without: {
        status: 'ready',
        usage: { status: 'unknown', model_calls: null, input_tokens: null, output_tokens: null, cache_read_tokens: null, coverage: 'unknown', source: 'unknown' },
        elapsed: { status: 'completed', completed_seconds: 4, total_seconds: 4, completed_turns: 1 },
        delivery: { status: deliveryStatus ?? 'not_started' },
        messages: withoutMessages
      }
    },
    measurement: {
      actions: {},
      review: {
        active_arm: 'with',
        arms: {
          with: { review_window_seconds: 60, completed_review_segments: 1, effort_rating: withEffort, interruption_count: 1 },
          without: { review_window_seconds: 60, completed_review_segments: 1, effort_rating: withoutEffort, interruption_count: 0 }
        }
      }
    },
    presence: {
      source: {
        eligible: true,
        controls,
        capture: { state: 'collecting' },
        read_at: readAt,
        received_at: readAt,
        latency_ms: 5
      }
    }
  };
  if (over.injectSentinel) {
    state.capsule = SENTINEL;
    state.credential = SENTINEL;
    state.some_path = '/secret/path';
    state.arms.with.messages = [{ author: 'Muse', phase: 'finalAnswer', text: `private typing ${SENTINEL}` }];
    state.presence.source.controls = { ...GOOD_CONTROLS, unknown_prop: SENTINEL };
  }
  return state;
}

function validMetrics(over = {}) {
  return {
    schema_version: 1,
    held_current: 1,
    held_total: 2,
    released_manual: 1,
    released_automatic: 0,
    history_resets: 0,
    coverage: 'observed',
    ...over
  };
}

function factById(ev, id) {
  return ev.facts.find((f) => f.id === id);
}

describe('closed schema', () => {
  it('returns schema_version 1, generation, at most 19 fixed facts including six dimension observations, limitations', () => {
    const ev = buildObserverEvidence(makeState(), { metrics: validMetrics(), now: NOW });
    assert.equal(ev.schema_version, 1);
    assert.equal(ev.session_generation, 7);
    assert.ok(Array.isArray(ev.facts));
    assert.ok(ev.facts.length <= 19);
    assert.equal(ev.facts.filter(f=>f.id.startsWith('dimension_')).length,6);
    assert.ok(ev.facts.some(f=>f.id==='response_scope'));
    assert.deepEqual(Object.keys(ev).sort(), ['facts', 'limitations', 'required_fact_ids', 'schema_version', 'session_generation']);
    for (const f of ev.facts) {
      assert.deepEqual(Object.keys(f).sort(), ['id', 'kind', 'text']);
      assert.equal(typeof f.text, 'string');
    }
    assert.ok(ev.required_fact_ids.includes('benefit_unverified'));
    assert.ok(Array.isArray(ev.limitations) && ev.limitations.length > 0);
    const again = buildObserverEvidence(makeState({ matched_context: false }), { now: NOW });
    assert.deepEqual(again.limitations, ev.limitations);
  });

  it('nulls bad session generation', () => {
    const s = makeState();
    s.session_generation = -3;
    assert.equal(buildObserverEvidence(s, { now: NOW }).session_generation, null);
  });
});

describe('source freshness', () => {
  it('current policy when recent eligible reading', () => {
    const ev = buildObserverEvidence(makeState(), { now: NOW });
    const f = factById(ev, 'source_current');
    assert.ok(f);
    assert.equal(f.kind, 'source');
    assert.match(f.text, /standard/);
    assert.ok(!factById(ev, 'source_fallback'));
  });

  it('fallback when stale reading is not called current', () => {
    const ev = buildObserverEvidence(makeState({ read_at: STALE_AT }), { now: NOW });
    const f = factById(ev, 'source_fallback');
    assert.ok(f);
    assert.equal(f.kind, 'source');
    assert.ok(!factById(ev, 'source_current'));
  });
});

describe('delivery correlation', () => {
  it('correlates 2 known requests as request observation only', () => {
    const ev = buildObserverEvidence(makeState(), { now: NOW });
    const f = factById(ev, 'delivery_correlated');
    assert.ok(f);
    assert.equal(f.kind, 'delivery');
    assert.match(f.text, /2 request/);
    assert.match(f.text, /1 guidance, 1 fallback/);
    assert.match(f.text, /not provider execution/);
    assert.ok(!/model compliance/i.test(f.text) || /not provider execution or model compliance/.test(f.text));
  });

  it('missing markers yield unverified', () => {
    const d = matchedDelivery();
    d.hook_linkage = 'unverified';
    d.requests_observed = null;
    const ev = buildObserverEvidence(makeState({ withDelivery: d }), { now: NOW });
    assert.ok(factById(ev, 'delivery_unverified'));
    assert.ok(!factById(ev, 'delivery_correlated'));
  });

  it('duplicate read ids yield unverified', () => {
    const d = matchedDelivery();
    d.request_attribution[1].read_id = READ1;
    const ev = buildObserverEvidence(makeState({ withDelivery: d }), { now: NOW });
    assert.ok(factById(ev, 'delivery_unverified'));
    assert.ok(!factById(ev, 'delivery_correlated'));
  });
});

describe('baseline', () => {
  it('contaminated and isolated variants', () => {
    const iso = buildObserverEvidence(makeState({ deliveryStatus: 'baseline_isolated' }), { now: NOW });
    assert.ok(factById(iso, 'baseline_isolated'));
    const con = buildObserverEvidence(makeState({ deliveryStatus: 'baseline_contaminated' }), { now: NOW });
    const f = factById(con, 'baseline_contaminated');
    assert.ok(f);
    assert.match(f.text, /comparison is invalid/);
  });

  it('defaults to unverified', () => {
    const ev = buildObserverEvidence(makeState(), { now: NOW });
    assert.ok(factById(ev, 'baseline_unverified'));
  });
});

describe('browser metrics', () => {
  it('valid observed metrics produce presentation counts without interruption claim', () => {
    const ev = buildObserverEvidence(makeState(), { metrics: validMetrics(), now: NOW });
    const f = factById(ev, 'browser_updates');
    assert.ok(f);
    assert.equal(f.kind, 'presentation');
    assert.match(f.text, /1 current held of 2 total/);
    assert.match(f.text, /1 manual/);
    assert.match(f.text, /cause unknown/);
    assert.ok(!/interrupt/i.test(f.text) || /no interruption claim/.test(f.text));
  });

  it('zero holds are reported as zero, missing metrics as unavailable not zero', () => {
    const zero = buildObserverEvidence(makeState(), {
      metrics: validMetrics({ held_current: 0, held_total: 0, released_manual: 0, released_automatic: 0, history_resets: 0 }),
      now: NOW
    });
    assert.match(factById(zero, 'browser_updates').text, /0 current held of 0 total/);
    const missing = buildObserverEvidence(makeState(), { metrics: null, now: NOW });
    const u = factById(missing, 'browser_unavailable');
    assert.ok(u);
    assert.match(u.text, /unavailable/);
    assert.ok(!/0 current held/.test(u.text));
  });

  it('manual/automatic and partial coverage', () => {
    const ev = buildObserverEvidence(makeState(), {
      metrics: validMetrics({ held_total:7,released_manual: 2, released_automatic: 3, coverage: 'partial' }),
      now: NOW
    });
    const f = factById(ev, 'browser_updates');
    assert.match(f.text, /2 manual/);
    assert.match(f.text, /3 automatic/);
    assert.match(f.text, /partial/);
  });

  it('invalid metrics yield unavailable', () => {
    const ev = buildObserverEvidence(makeState(), {
      metrics: { schema_version: 1, held_current: -1, held_total: 2, released_manual: 0, released_automatic: 0, history_resets: 0, coverage: 'observed' },
      now: NOW
    });
    assert.ok(factById(ev, 'browser_unavailable'));
  });
});

describe('output totals and resources', () => {
  it('session totals count raw messages words (2 + 4 + 3)', () => {
    const ev = buildObserverEvidence(makeState(), { now: NOW });
    const f = factById(ev, 'output_totals');
    assert.ok(f);
    assert.match(f.text, /session totals/i);
    assert.match(f.text, /Without: 3 words \/ 1 final messages; With: 6 words \/ 2 final messages/);
  });

  it('unreported usage stays unknown with no cost', () => {
    const ev = buildObserverEvidence(makeState({
      withUsage: { status: 'unknown', model_calls: null, input_tokens: null, output_tokens: null, cache_read_tokens: null, coverage: 'unknown', source: 'unknown' }
    }), { now: NOW });
    const f = factById(ev, 'resources_unreported');
    assert.ok(f);
    assert.match(f.text, /unknown is not zero/);
    assert.ok(!/\$|0\.42|usd/i.test(JSON.stringify(ev.facts)));
  });

  it('observed native usage reports known fields, unknown stays unknown', () => {
    const ev = buildObserverEvidence(makeState({
      withUsage: { status: 'observed', model_calls: 3, input_tokens: null, output_tokens: 50, cache_read_tokens: null, coverage: 'observed', source: 'native' }
    }), { now: NOW });
    const f = factById(ev, 'resources_observed');
    assert.ok(f);
    assert.match(f.text, /3 calls/);
    assert.match(f.text, /unknown/);
    assert.ok(!/0\.42/.test(f.text));
  });
});

describe('effort and comparison and benefit', () => {
  it('omits effort when absent, reports self-reported when present', () => {
    const absent = buildObserverEvidence(makeState(), { now: NOW });
    assert.ok(!factById(absent, 'effort_reported'));
    const present = buildObserverEvidence(makeState({ withEffort: 4, withoutEffort: 2 }), { now: NOW });
    const f = factById(present, 'effort_reported');
    assert.ok(f);
    assert.match(f.text, /Self-reported/);
    assert.match(f.text, /4 of 5/);
  });

  it('unmatched history produces required comparison fact', () => {
    const ev = buildObserverEvidence(makeState({ matched_context: false }), { now: NOW });
    const f = factById(ev, 'comparison_unmatched');
    assert.ok(f);
    assert.equal(f.kind, 'comparison');
    assert.match(f.text, /descriptive/);
    assert.ok(ev.required_fact_ids.includes('comparison_unmatched'));
    const matched = buildObserverEvidence(makeState({ matched_context: true }), { now: NOW });
    assert.ok(!factById(matched, 'comparison_unmatched'));
  });

  it('benefit unverified always required', () => {
    const ev = buildObserverEvidence(makeState(), { now: NOW });
    const f = factById(ev, 'benefit_unverified');
    assert.ok(f);
    assert.match(f.text, /does not establish/);
  });
});

describe('privacy', () => {
  it('excludes sentinel from catalogue and prompt', () => {
    const ev = buildObserverEvidence(makeState({ injectSentinel: true }), { now: NOW });
    const blob = JSON.stringify(ev);
    assert.ok(!blob.includes(SENTINEL));
    assert.ok(!blob.includes('/secret/path'));
    const prompt = observerPrompt(ev);
    assert.ok(!prompt.includes(SENTINEL));
    assert.ok(!prompt.includes('/secret/path'));
  });

  it('prompt survives poisoned evidence without leaking', () => {
    const ev = buildObserverEvidence(makeState(), { now: NOW });
    const poisoned = JSON.parse(JSON.stringify(ev));
    poisoned.secret = SENTINEL;
    poisoned.facts.push({ id: 'evil_free_text', kind: 'source', text: SENTINEL });
    poisoned.facts.push({ id: 'source_current', kind: 'source', text: SENTINEL });
    const prompt = observerPrompt(poisoned);
    assert.ok(!prompt.includes(SENTINEL));
    assert.ok(!prompt.includes('evil_free_text'));
    assert.match(prompt, /up to 6/i);
    assert.match(prompt, /no causal/i);
  });
});

describe('selection schema and validation', () => {
  it('schema allows exactly fact_ids 1..6 unique known, no extra props', () => {
    const ev = buildObserverEvidence(makeState(), { now: NOW });
    const schema = observerSelectionSchema(ev);
    assert.equal(schema.type, 'object');
    assert.deepEqual(schema.required, ['fact_ids']);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.fact_ids.minItems, 1);
    assert.equal(schema.properties.fact_ids.maxItems, 6);
    assert.equal(schema.properties.fact_ids.uniqueItems, true);
    const known = ev.facts.map((f) => f.id).sort();
    assert.deepEqual(schema.properties.fact_ids.items.enum.slice().sort(), known);
  });

  it('rejects unknown, free-text extras, duplicates, empty and malformed', () => {
    const ev = buildObserverEvidence(makeState(), { now: NOW });
    const good = ev.facts[0].id;
    assert.throws(() => validateObserverSelection({ fact_ids: ['no_such_fact'] }, ev), (e) => e.code === 'observer_selection_invalid');
    assert.throws(() => validateObserverSelection({ fact_ids: [good], note: 'free text' }, ev), (e) => e.code === 'observer_selection_invalid');
    assert.throws(() => validateObserverSelection({ fact_ids: [good, good] }, ev), (e) => e.code === 'observer_selection_invalid');
    assert.throws(() => validateObserverSelection({ fact_ids: [] }, ev), (e) => e.code === 'observer_selection_invalid');
    assert.throws(() => validateObserverSelection({ fact_ids: 'x' }, ev), (e) => e.code === 'observer_selection_invalid');
    assert.throws(() => validateObserverSelection({}, ev), (e) => e.code === 'observer_selection_invalid');
  });

  it('appends required facts uniquely with exact catalogue sentences', () => {
    const ev = buildObserverEvidence(makeState({ matched_context: false }), { now: NOW });
    const pick = ev.facts.find((f) => f.id === 'source_current' || f.id === 'source_fallback').id;
    const out = validateObserverSelection({ fact_ids: [pick] }, ev);
    assert.ok(out.fact_ids.includes(pick));
    assert.ok(out.fact_ids.includes('benefit_unverified'));
    assert.ok(out.fact_ids.includes('comparison_unmatched'));
    const byId = new Map(ev.facts.map((f) => [f.id, f.text]));
    assert.deepEqual(out.sentences, out.fact_ids.map((id) => byId.get(id)));
    const again = validateObserverSelection({ fact_ids: ['benefit_unverified', pick] }, ev);
    assert.equal(again.fact_ids.filter((x) => x === 'benefit_unverified').length, 1);
  });
});

describe('mutation isolation', () => {
  it('caller mutation cannot contaminate subsequent evidence', () => {
    const state = makeState();
    const metrics = validMetrics();
    const first = buildObserverEvidence(state, { metrics, now: NOW });
    const firstText = JSON.stringify(first);
    state.arms.with.messages.push({ author: 'Muse', phase: 'finalAnswer', text: 'mutated extra words here' });
    state.presence.source.controls.response_extent = 'full';
    metrics.held_current = 999;
    first.facts.push({ id: 'hacked', kind: 'source', text: 'hacked' });
    const second = buildObserverEvidence(makeState(), { metrics: validMetrics(), now: NOW });
    assert.equal(JSON.stringify(second), firstText);
  });
});

describe('integration boundaries',()=>{
 it('changed known catalogue text cannot enter the prompt or validated explanation',()=>{
  const evidence=buildObserverEvidence(makeState(),{now:NOW});const first=evidence.facts[0],original=first.text;
  first.text=SENTINEL;evidence.required_fact_ids=[];
  assert.ok(!observerPrompt(evidence).includes(SENTINEL));
  const result=validateObserverSelection({fact_ids:[first.id]},evidence);
  assert.equal(result.sentences[0],original);assert.ok(result.fact_ids.includes('benefit_unverified'));
  assert.throws(()=>validateObserverSelection({fact_ids:[first.id]},structuredClone(evidence)),/observer_selection_invalid/);
 });
 it('required qualifications fit inside six sentences, including a contaminated real baseline',()=>{
  const state=makeState({matched_context:false});state.arms.without.delivery.status='baseline_contaminated';
  const evidence=buildObserverEvidence(state,{now:NOW});const result=validateObserverSelection({fact_ids:evidence.facts.slice(0,6).map(f=>f.id)},evidence);
  assert.equal(result.sentences.length,6);for(const id of ['benefit_unverified','comparison_unmatched','baseline_contaminated'])assert.ok(result.fact_ids.includes(id));
 });
 it('absent histories stay unavailable and observed provider-trace usage stays observable',()=>{
  const state=makeState();delete state.arms.with.messages;state.arms.with.usage.source='provider_trace';
  const evidence=buildObserverEvidence(state,{now:NOW});assert.match(factById(evidence,'output_totals').text,/With: unavailable/);
  assert.match(factById(evidence,'resources_observed').text,/With: 3 calls, 100 input/);
 });
});


it('retained session guidance is explained as last accepted, never a new observation',()=>{
 const state=makeState();Object.assign(state.presence.source,{guidance_lifetime:'active_session',reading_freshness:'last_known'});
 const evidence=buildObserverEvidence(state,{now:NOW});const fact=factById(evidence,'source_current');
 assert.match(fact.text,/last accepted policy/i);assert.match(fact.text,/not a new typing observation/i);assert.ok(!factById(evidence,'source_fallback'));
});
