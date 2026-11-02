import { test } from "node:test";
import assert from "node:assert/strict";
import { projectEvidence } from "../src/evidence-projection.mjs";

test('request attribution survives safe evidence projection without raw input or claimed response proof',()=>{
 const state=baseState(),read='10000000-0000-4000-8000-000000000001',reading='20000000-0000-4000-8000-000000000001';
 state.arms.with.delivery={status:'mixed_observed',requests_observed:2,hook_linkage:'read_marker_matched',response_linkage:'verified',request_attribution:[
  {ordinal:1,status:'guidance_observed',read_id:read,reading_id:reading,controls:{response_extent:'full',unsolicited_update:'defer',conversation_style:'conversational',secret:'PRIVATE'},receipt_age_seconds:2,raw_request:'PRIVATE'},
  {ordinal:2,status:'fallback_observed',read_id:'10000000-0000-4000-8000-000000000002',reading_id:'PRIVATE',controls:{raw:'PRIVATE'},receipt_age_seconds:1,capsule:'PRIVATE'}]};
 const out=projectEvidence(state).arms.with.delivery;assert.equal(out.status,'mixed_observed');assert.equal(out.hook_linkage,'read_marker_matched');assert.equal(out.response_linkage,'unverified');assert.equal(out.request_attribution.length,2);assert.equal(out.request_attribution[0].reading_id,reading);assert.equal(out.request_attribution[1].reading_id,null);assert.ok(!JSON.stringify(out).includes('PRIVATE'));
 state.arms.with.delivery.request_attribution[0].read_id='invalid';assert.equal(projectEvidence(state).arms.with.delivery.hook_linkage,'unverified');
 state.arms.with.delivery.request_attribution=Array.from({length:70},(_,index)=>({ordinal:index+1,status:'unverified',read_id:null}));assert.equal(projectEvidence(state).arms.with.delivery.request_attribution.length,64);
});

const SECRET = "super-secret-text-abc123";
const PRIVATE_PATH = "/private/user/history/private-path";

function baseState() {
  return {
    status: "ready", comparison: {matched_context: true},
    arms: {
      without: {
        status: "closed",
        usage: { status: "observed", model_calls: 2, input_tokens: 100, output_tokens: 50, cache_read_tokens: 10, estimated_cost_usd: 0.01, cost_partial: false, coverage: "observed", source: "provider_trace" },
        elapsed: { status: "completed", completed_seconds: 5, in_flight_seconds: 0, incomplete_seconds: 0, total_seconds: 5, completed_turns: 1, incomplete_turns: 0 },
        delivery: { status: "request_observed", turn_ordinal: 1, requests_observed: 1, public_finals: 1, turn_completed: true, shared_quality_observed: true, trace_ended: true },
        messages: [{ author: "Muse", phase: "finalAnswer", text: "hello world" }]
      },
      with: {
        status: "closed",
        usage: { status: "observed", model_calls: 3, input_tokens: 200, output_tokens: 80, cache_read_tokens: 20, estimated_cost_usd: 0.02, cost_partial: false, coverage: "observed", source: "native" },
        elapsed: { status: "completed", completed_seconds: 6, in_flight_seconds: 0, incomplete_seconds: 0, total_seconds: 6, completed_turns: 1, incomplete_turns: 0 },
        delivery: { status: "guidance_observed", turn_ordinal: 1, requests_observed: 1, public_finals: 1, turn_completed: true, shared_quality_observed: false, trace_ended: true },
        messages: [{ author: "Muse", phase: "commentary", text: "one two three" }]
      }
    },
    measurement: {
      actions: {
        participant: { arms:{without:{messages:1,characters:11,approval_decisions:0},with:{messages:1,characters:13,approval_decisions:1}}, submissions: 1, shared_submissions: 1, characters: 10, partial_submissions: 0, partial_characters: 0, unconfirmed_submissions: 0, unconfirmed_characters: 0, unconfirmed_approval_decisions: 0 },
        coordinator: { submissions: 0, shared_submissions: 0, characters: 0, partial_submissions: 0, partial_characters: 0, unconfirmed_submissions: 0, unconfirmed_characters: 0, unconfirmed_approval_decisions: 0 },
        unattributed: { submissions: 0, shared_submissions: 0, characters: 0, partial_submissions: 0, partial_characters: 0, unconfirmed_submissions: 0, unconfirmed_characters: 0, unconfirmed_approval_decisions: 0 }
      },
      arms: {
        without: { messages: 1, characters: 11, approval_decisions: 0 },
        with: { messages: 1, characters: 13, approval_decisions: 1 }
      },
      review: {
        active_arm: "with",
        arms: {
          without: { review_window_seconds: 12.5, completed_review_segments: 1, effort_rating: 4, interruption_count: 0 },
          with: { review_window_seconds: 9, completed_review_segments: 2, effort_rating: 2, interruption_count: 1 }
        }
      }
    },
    presence: {
      source: {
        eligible: true,
        controls: { response_extent: "standard", unsolicited_update: "defer", conversation_style: "conversational" },
        capture: { state: "collecting", reason: null },
        read_at: "2026-10-26T10:00:00Z",
        received_at: "2026-10-26T10:00:01+00:00",
        latency_ms: 5
      }
    }
  };
}

function baseMetadata() {
  return {
    task_id: "PROJECT-05",
    source_commit: "a".repeat(40),
    verification_plan_hash: "b".repeat(64),
    harness_fingerprint: "c".repeat(64),
    component_pins: { agent_lab: "d".repeat(40), presence_runtime: "e".repeat(40) },
    model: "muse-spark-1.3",
    contributor_mode: "off",
    evidence_mode: "live"
  };
}

test("deep sentinel stripping drops raw text, paths, errors and injected metadata", () => {
  const state = baseState();
  state.arms.without.raw_text = SECRET;
  state.arms.without.prompt = SECRET;
  state.arms.without.reasoning = SECRET;
  state.arms.without.private_path = PRIVATE_PATH;
  state.arms.without.credentials = { token: SECRET };
  state.arms.without.capsule = { id: SECRET };
  state.arms.without.native_id = SECRET;
  state.arms.without.unknown_injected = SECRET;
  state.arms.with.messages = [{ author: "Muse", phase: "finalAnswer", text: SECRET }];
  state.raw_error = SECRET;
  state.error = SECRET;
  state.measurement.extra_field = SECRET;
  state.measurement.review.extra = SECRET;
  state.presence.source.renderer_text = SECRET;
  state.presence.source.extra_native_log = SECRET;
  state.extra_top_level = SECRET;
  const out = projectEvidence(state, { task_id: "PROJECT-05", evidence_mode: "live", injected: SECRET });
  const serial = JSON.stringify(out);
  assert.equal(serial.includes(SECRET), false);
  assert.equal(serial.includes(PRIVATE_PATH), false);
  assert.deepEqual(Object.keys(out).sort(), ["arms", "limitations", "measurement", "metadata", "pair", "presence", "quality", "textbox"]);
  assert.equal("raw_text" in out.arms.without, false);
  assert.equal("prompt" in out.arms.without, false);
  assert.equal("injected" in out.metadata, false);
  assert.equal("renderer_text" in out.presence, false);
  assert.equal(out.arms.with.public_output.final_words, 1);
});

test("public word counts use only Muse finalAnswer/commentary and exclude You text", () => {
  const state = baseState();
  state.arms.without.messages = [
    { author: "Muse", phase: "finalAnswer", text: "hello   world" },
    { author: "Muse", phase: "commentary", text: "one two" },
    { author: "You", phase: "finalAnswer", text: "ignore all these extra words completely" },
    { author: "Muse", phase: "thinking", text: "should be ignored entirely" },
    { author: "Muse", phase: "finalAnswer", text: 12345 },
    { author: "Muse", phase: "commentary", text: "" }
  ];
  const out = projectEvidence(state, baseMetadata());
  assert.equal(out.arms.without.public_output.final_messages, 2);
  assert.equal(out.arms.without.public_output.final_words, 2);
  assert.equal(out.arms.without.public_output.commentary_messages, 2);
  assert.equal(out.arms.without.public_output.commentary_words, 2);
});

test("action attribution is fixed and human ratings stay self-report", () => {
  const out = projectEvidence(baseState(), baseMetadata());
  assert.equal(out.measurement.attribution, "explicit_client_label_not_verified_identity");
  assert.equal(out.measurement.actions.participant.submissions, 1);
  assert.equal(out.measurement.review.active_arm, "with");
  assert.equal(out.measurement.review.arms.with.effort_rating, 2);
  assert.equal(out.measurement.review.arms.with.interruption_count, 1);
  assert.equal(out.quality.state, "not_verified");
  assert.deepEqual(out.limitations, ["request_observation_is_not_response_identity", "single_pair_not_causal_evidence", "human_ratings_are_self_report", "review_time_is_not_attention", "dollar_cost_and_presence_overhead_may_be_unavailable"]);
  assert.equal(out.measurement.actions.participant.arms.with.approval_decisions, 1);
  assert.equal(out.measurement.review.arms.without.interruption_count, 0);
});

test("explicit zero is preserved while invalid and unknown metrics stay null/unknown", () => {
  const state = baseState();
  state.arms.without.usage.model_calls = 0;
  state.arms.without.usage.estimated_cost_usd = 0;
  state.arms.without.usage.input_tokens = -5;
  state.arms.without.usage.output_tokens = 1.5;
  state.arms.without.usage.cache_read_tokens = "10";
  state.arms.without.elapsed.completed_seconds = Infinity;
  state.arms.without.elapsed.completed_turns = NaN;
  state.arms.without.status = "bogus-status";
  state.arms.without.usage.status = "bogus";
  state.arms.without.delivery.status = "bogus";
  state.status = "bogus";
  state.measurement.review.arms.with.effort_rating = 9;
  state.measurement.review.arms.with.interruption_count = 500;
  state.measurement.review.arms.with.review_window_seconds = -1;
  const out = projectEvidence(state, { task_id: "NOPE", source_commit: "zzz", model: "other-model", contributor_mode: "on", evidence_mode: "bogus" });
  assert.equal(out.arms.without.usage.model_calls, 0);
  assert.equal(out.arms.without.usage.estimated_cost_usd, 0);
  assert.equal(out.arms.without.usage.input_tokens, null);
  assert.equal(out.arms.without.usage.output_tokens, null);
  assert.equal(out.arms.without.usage.cache_read_tokens, null);
  assert.equal(out.arms.without.elapsed.completed_seconds, null);
  assert.equal(out.arms.without.elapsed.completed_turns, null);
  assert.equal(out.arms.without.status, "unknown");
  assert.equal(out.arms.without.usage.status, "unknown");
  assert.equal(out.arms.without.delivery.status, "unknown");
  assert.equal(out.arms.without.delivery.hook_linkage, "unverified");
  assert.equal(out.pair.status, "unknown");
  assert.equal(out.measurement.review.arms.with.effort_rating, null);
  assert.equal(out.measurement.review.arms.with.interruption_count, null);
  assert.equal(out.measurement.review.arms.with.review_window_seconds, null);
  assert.equal(out.metadata.task_id, null);
  assert.equal(out.metadata.source_commit, null);
  assert.equal(out.metadata.model, null);
  assert.equal(out.metadata.contributor_mode, null);
  assert.equal(out.metadata.evidence_mode, "unknown");
});

test("presence eligibility gates controls and timestamps canonicalize", () => {
  const eligible = projectEvidence(baseState(), baseMetadata());
  assert.equal(eligible.presence.available, true);
  assert.equal(eligible.presence.eligible, true);
  assert.deepEqual(eligible.presence.controls, { response_extent: "standard", unsolicited_update: "defer", conversation_style: "conversational" });
  assert.equal(eligible.presence.read_at, "2026-10-26T10:00:00.000Z");
  assert.equal(eligible.presence.received_at, "2026-10-26T10:00:01.000Z");
  const state = baseState();
  state.presence.source.eligible = false;
  state.presence.source.read_at = "not-a-time";
  state.presence.source.received_at = 12345;
  state.presence.source.latency_ms = -2;
  state.presence.source.capture = { state: "bogus", reason: "bogus" };
  const out = projectEvidence(state, baseMetadata());
  assert.equal(out.presence.eligible, false);
  assert.equal(out.presence.controls, null);
  assert.equal(out.presence.read_at, null);
  assert.equal(out.presence.received_at, null);
  assert.equal(out.presence.latency_ms, null);
  assert.equal(out.presence.capture.state, "unavailable");
  assert.equal(out.presence.capture.reason, null);
  const missing = projectEvidence({ arms: {} }, baseMetadata());
  assert.equal(missing.presence.available, false);
  assert.equal(missing.presence.eligible, null);
});

test("cumulative usage is passed through without summing native, trace, or cache", () => {
  const state = baseState();
  state.arms.without.usage.input_tokens = 100;
  state.arms.without.usage.cache_read_tokens = 30;
  state.arms.without.usage.output_tokens = 50;
  const out = projectEvidence(state, baseMetadata());
  assert.equal(out.arms.without.usage.input_tokens, 100);
  assert.equal(out.arms.without.usage.cache_read_tokens, 30);
  assert.equal(out.arms.without.usage.output_tokens, 50);
  assert.equal(out.arms.without.usage.model_calls, 2);
});

test("approvals do not imply interruptions and missing usage is not zero", () => {
  const state = baseState();
  delete state.arms.with.usage.model_calls;
  delete state.measurement.review.arms.with.interruption_count;
  state.measurement.actions.participant.arms.with.approval_decisions = 2;
  const out = projectEvidence(state, baseMetadata());
  assert.equal(out.arms.with.usage.model_calls, null);
  assert.equal(out.measurement.review.arms.with.interruption_count, null);
  assert.equal(out.measurement.actions.participant.arms.with.approval_decisions, 2);
});

test("inputs are not mutated", () => {
  const state = baseState();
  const metadata = baseMetadata();
  const beforeState = JSON.stringify(state);
  const beforeMeta = JSON.stringify(metadata);
  projectEvidence(state, metadata);
  assert.equal(JSON.stringify(state), beforeState);
  assert.equal(JSON.stringify(metadata), beforeMeta);
});

test("empty input yields closed safe defaults", () => {
  const out = projectEvidence();
  assert.equal(out.metadata.task_id, null);
  assert.equal(out.metadata.evidence_mode, "unknown");
  assert.equal(out.pair.status, "unknown");
  assert.equal(out.pair.matched_context, null);
  assert.equal(out.arms.without.status, "unknown");
  assert.equal(out.arms.without.public_output.final_messages, 0);
  assert.equal(out.arms.without.public_output.final_words, 0);
  assert.equal(out.measurement.attribution, "explicit_client_label_not_verified_identity");
  assert.equal(out.measurement.review.active_arm, null);
  assert.equal(out.presence.available, false);
  assert.equal(out.quality.state, "not_verified");
  assert.equal(out.limitations.length, 5);
});

test('actual SessionMeasurement schema preserves each actor and receiving arm independently',async()=>{
 const {SessionMeasurement}=await import('../src/session-measurement.mjs');const m=new SessionMeasurement();
 m.submitted({actor:'participant',target:'both',text:'user',outcome:{status:'started'}});
 m.submitted({actor:'coordinator',target:'with',text:'coordinator',outcome:{status:'started'}});
 m.decided({actor:'participant',arm:'without',approvalId:'a',requirementId:{approvalId:'a',sourceIndex:0},result:{status:'accepted'}});
 const p=projectEvidence({status:'ready',comparison:{matched_context:false},measurement:m.snapshot()});
 assert.deepEqual(p.pair,{status:'ready',matched_context:false});
 assert.equal(p.measurement.actions.participant.arms.without.approval_decisions,1);
 assert.equal(p.measurement.actions.participant.arms.with.messages,1);
 assert.equal(p.measurement.actions.coordinator.arms.with.messages,1);
 assert.equal(p.measurement.actions.unattributed.arms.with.messages,0);
 assert.equal(p.measurement.review.arms.with.interruption_count,null);
});
test('unzoned timestamps and unknown metadata aliases are not accepted as evidence',()=>{
 const p=projectEvidence({presence:{source:{read_at:'2026-10-28T12:00:00',received_at:'2026'}}},{source_commit40hex:'a'.repeat(40)});
 assert.equal(p.presence.read_at,null);assert.equal(p.presence.received_at,null);assert.equal(p.metadata.source_commit,null);
});


test('question evidence keeps content-free native settlements and reply effort while excluding prompts and answers',()=>{
 const state={status:'ready',arms:{with:{status:'question',questions:[{userInputId:SECRET,questions:[{question:SECRET}]}],interactions:{questions_presented:1,questions_answered:0,questions_clarified:0,questions_cancelled:0,questions_timed_out:0,questions_aborted:0,questions_interrupted:0,questions_closed_locally:0,pending_questions:1,raw:SECRET}}},measurement:{question_effort:{participant:{with:{accepted:1,unconfirmed:0,characters:23,answer:SECRET}}}}};
 const out=projectEvidence(state);assert.equal(out.arms.with.status,'question');assert.equal(out.arms.with.interactions.questions_presented,1);assert.equal(out.arms.with.interactions.pending_questions,1);assert.equal(out.measurement.question_effort.participant.with.accepted,1);assert.equal(out.measurement.question_effort.participant.with.characters,23);assert.ok(!JSON.stringify(out).includes(SECRET));
});


test('turn actions export bounded receipt counts, never native IDs or text',()=>{
 const state={status:'ready',arms:{with:{status:'ready',active_turn_id:'PRIVATE-TURN',last_turn_terminal:'cancelled'}},measurement:{turn_actions:{participant:{with:{steering_accepted:2,interrupt_accepted:1,interrupt_unconfirmed:0,turn_id:'PRIVATE-TURN',text:'PRIVATE-STEER'}}}}};
 const out=projectEvidence(state);assert.equal(out.measurement.turn_actions.participant.with.steering_accepted,2);assert.equal(out.measurement.turn_actions.participant.with.interrupt_accepted,1);assert.equal(out.arms.with.last_turn_terminal,'cancelled');assert.ok(!JSON.stringify(out).includes('PRIVATE-'));
});


test('evidence preserves retained recency and session lifetime without exposing raw guidance',()=>{
 const state=baseState();Object.assign(state.presence.source,{guidance_lifetime:'active_session',reading_freshness:'last_known',guidance:'PRIVATE_RETAINED_POLICY'});
 state.textbox={guidance_lifetime:'active_session',reading_freshness:'last_known',selected:true,consented:true,age_ms:180001,observation_age_ms:181000,guidance:'PRIVATE_RETAINED_POLICY'};
 const out=projectEvidence(state);assert.equal(out.presence.eligible,true);assert.equal(out.presence.reading_freshness,'last_known');assert.equal(out.textbox.reading_freshness,'last_known');assert.equal(out.textbox.age_ms,180001);assert.equal(out.presence.guidance_lifetime,'active_session');assert.equal(out.textbox.guidance_lifetime,'active_session');assert.ok(!JSON.stringify(out).includes('PRIVATE_RETAINED_POLICY'));
 state.textbox.selected=false;assert.equal(projectEvidence(state).textbox.reading_freshness,'unavailable');
 for(const target of [state.textbox,state.presence.source])target.reading_freshness='PRIVATE_UNKNOWN';assert.ok(!JSON.stringify(projectEvidence(state)).includes('PRIVATE_UNKNOWN'));
});
