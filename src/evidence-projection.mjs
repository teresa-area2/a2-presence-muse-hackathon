import {projectCodeChecks} from './session-ci-evidence.mjs';
import{projectOpDiagnostics}from'./op-diagnostics.mjs';
import{projectOpAttemptHistory}from'./op-attempt-history.mjs';
import {normalizePresenceReadings} from '../web/terminal-presence-view.mjs';
const TASK_IDS = new Set(["CODING-save-conflicts","CODING-booking-rules","CODING-batch-import","CODING-notification-routing", "CODING-shared-expenses", "USER-free-task","PROJECT-05", "PROJECT-06", "PROJECT-07"]);
const MODELS = new Set(["muse-spark-1.3", "muse-wonder-1.0", "fake-model"]);
const EVIDENCE_MODES = new Set(["live", "fixture"]);
const PAIR_STATUSES = new Set(["idle", "opening", "ready", "stopping", "closed", "failed"]);
const ARM_STATUSES = new Set(["not_started", "ready", "starting", "running", "approval", "question", "failed", "stopping", "closed"]);
const USAGE_STATUSES = new Set(["observed", "not_observed", "waiting_for_usage", "unavailable", "unknown"]);
const COVERAGE_VALUES = new Set(["observed", "partial_or_unconfirmed", "unknown"]);
const USAGE_SOURCES = new Set(["provider_trace", "native", "unknown"]);
const ELAPSED_STATUSES = new Set(["not_started", "running", "completed", "partial", "unavailable", "unknown"]);
// Normalize native arm names at the export boundary; historical exports stay valid.
const ELAPSED_ALIASES = new Map([["not_observed", "not_started"], ["in_progress", "running"], ["complete", "completed"]]);
const DELIVERY_STATUSES = new Set(["not_started", "waiting", "hook_only", "request_observed", "guidance_observed", "fallback_observed", "mixed_observed", "unverified", "ambiguous", "unavailable", "baseline_isolated", "baseline_contaminated", "unknown"]);
const RESPONSE_EXTENTS = new Set(["terse", "standard", "full"]);
const UNSOLICITED_UPDATES = new Set(["send", "defer"]);
const CONVERSATION_STYLES = new Set(["self_contained", "conversational"]);
const CAPTURE_STATES = new Set(["collecting", "waiting_for_input", "paused", "native_starting", "off", "fixture", "unavailable"]);
const CAPTURE_REASONS = new Set(["secure_input", "unsupported_field", "native_focus_unavailable", "focus_unavailable", "focus_changed", "inactive_session", "poll_error", "runtime_not_running", "field_safety_unavailable"]);
const ACTION_ROLES = ["participant", "coordinator", "unattributed"];
const ARM_NAMES = ["without", "with"];
const FIXED_ATTRIBUTION = "explicit_client_label_not_verified_identity";
const FIXED_LIMITATIONS = ["request_observation_is_not_response_identity", "single_pair_not_causal_evidence", "human_ratings_are_self_report", "review_time_is_not_attention", "dollar_cost_and_presence_overhead_may_be_unavailable"];

function isRecord(v) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function countOrNull(v) {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  return null;
}

function finiteNonNegOrNull(v) {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return null;
}

function boolOrNull(v) {
  if (typeof v === "boolean") return v;
  return null;
}

function enumOr(v, allowed, fallback) {
  if (typeof v === "string" && allowed.has(v)) return v;
  return fallback;
}

function hexOrNull(v, len) {
  if (typeof v !== "string") return null;
  if (v.length !== len) return null;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;
    const isLow = c >= 97 && c <= 102;
    const isHigh = c >= 65 && c <= 70;
    if (!isDigit && !isLow && !isHigh) return null;
  }
  return v;
}

function firstDefined(values) {
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== undefined) return values[i];
  }
  return undefined;
}

function canonicalTimeOrNull(v) {
  if (typeof v !== "string") return null;
  if (v.length > 40 || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d\d:\d\d)$/.test(v)) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function countWords(text) {
  if (typeof text !== "string") return 0;
  const parts = text.split(/\s+/);
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) n++;
  }
  return n;
}

function intInRangeOrNull(v, min, max) {
  if (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max) return v;
  return null;
}

function projectMetadata(rawMeta) {
  const src = isRecord(rawMeta) ? rawMeta : {};
  const taskRaw = src.task_id;
  const taskId = (typeof taskRaw === "string" && TASK_IDS.has(taskRaw)) ? taskRaw : null;
  const sourceCommit = hexOrNull(src.source_commit, 40);
  const verificationHash = hexOrNull(src.verification_plan_hash, 64);
  const harnessFp = hexOrNull(src.harness_fingerprint, 64);
  const pinsRaw = isRecord(src.component_pins) ? src.component_pins : {};
  const agentLab = hexOrNull(pinsRaw.agent_lab, 40);
  const presenceRuntime = hexOrNull(pinsRaw.presence_runtime, 40);
  const modelRaw = src.model;
  const model = (typeof modelRaw === "string" && MODELS.has(modelRaw)) ? modelRaw : null;
  const contributorRaw = src.contributor_mode;
  const contributorMode = contributorRaw === "off" ? "off" : null;
  const evidenceRaw = src.evidence_mode;
  const evidenceMode = (typeof evidenceRaw === "string" && EVIDENCE_MODES.has(evidenceRaw)) ? evidenceRaw : "unknown";
  return {
    task_id: taskId,
    task_profile_id: ["save-conflicts","booking-rules","batch-import","notification-routing", "shared-expenses", "free-task"].includes(src.task_profile_id)?src.task_profile_id:null,
    fixture_commit: hexOrNull(src.fixture_commit,40),
    fixture_version: typeof src.fixture_version==="string"&&src.fixture_version.length<=48&&/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(src.fixture_version)?src.fixture_version:null,
    source_commit: sourceCommit,
    verification_plan_hash: verificationHash,
    harness_fingerprint: harnessFp,
    component_pins: {
      agent_lab: agentLab,
      presence_runtime: presenceRuntime
    },
    model,
    contributor_mode: contributorMode,
    evidence_mode: evidenceMode
  };
}

function projectUsage(raw) {
  const src = isRecord(raw) ? raw : {};
  return {
    status: enumOr(src.status, USAGE_STATUSES, "unknown"),
    model_calls: countOrNull(src.model_calls),
    input_tokens: countOrNull(src.input_tokens),
    output_tokens: countOrNull(src.output_tokens),
    cache_read_tokens: countOrNull(src.cache_read_tokens),
    estimated_cost_usd: finiteNonNegOrNull(src.estimated_cost_usd),
    cost_partial: boolOrNull(src.cost_partial),
    coverage: enumOr(src.coverage, COVERAGE_VALUES, "unknown"),
    source: enumOr(src.source, USAGE_SOURCES, "unknown"),
    ...(Object.hasOwn(src,"trace_status")?{trace_status:enumOr(src.trace_status,new Set(["observed","not_observed","waiting_for_usage","unavailable"]),"unknown")} : {}),
    ...(Object.hasOwn(src,"trace_coverage")?{trace_coverage:enumOr(src.trace_coverage,COVERAGE_VALUES,"unknown")} : {}),
    ...(Object.hasOwn(src,"native_usage_status")?{native_usage_status:enumOr(src.native_usage_status,USAGE_STATUSES,"unknown")} : {}),
    ...(Object.hasOwn(src,"model_calls_source")?{model_calls_source:enumOr(src.model_calls_source,new Set(["provider_trace_completed_responses","not_observed"]),"unknown")} : {}),
    ...(Object.hasOwn(src,"source_disagreement")?{source_disagreement:enumOr(src.source_disagreement,new Set(["different_unverified","same_observed_totals","not_comparable"]),"unknown")} : {})
  };
}

function projectElapsed(raw) {
  const src = isRecord(raw) ? raw : {};
  return {
    status: enumOr(ELAPSED_ALIASES.get(src.status) ?? src.status, ELAPSED_STATUSES, "unknown"),
    completed_seconds: finiteNonNegOrNull(src.completed_seconds),
    in_flight_seconds: finiteNonNegOrNull(src.in_flight_seconds),
    incomplete_seconds: finiteNonNegOrNull(src.incomplete_seconds),
    total_seconds: finiteNonNegOrNull(src.total_seconds),
    completed_turns: countOrNull(src.completed_turns),
    incomplete_turns: countOrNull(src.incomplete_turns)
  };
}

function projectDelivery(raw) {
  const src = isRecord(raw) ? raw : {};
  const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) ? v : null;
  const statuses = new Set(['request_observed','ambiguous','unverified','guidance_observed','fallback_observed']);
  const rows = (Array.isArray(src.request_attribution) ? src.request_attribution : []).slice(0,64).map((rawRow,index) => {
    const row=isRecord(rawRow)?rawRow:{},c=isRecord(row.controls)?row.controls:{};
    const validControls=RESPONSE_EXTENTS.has(c.response_extent)&&UNSOLICITED_UPDATES.has(c.unsolicited_update)&&CONVERSATION_STYLES.has(c.conversation_style);
    const readId=uuid(row.read_id),readingId=uuid(row.reading_id);
    let status=enumOr(row.status,statuses,'unverified');
    if(row.ordinal!==index+1||(['guidance_observed','fallback_observed'].includes(status)&&!readId)||status==='guidance_observed'&&(!readingId||!validControls))status='unverified';
    const selected=status==='guidance_observed',rawContract=isRecord(row.collaboration_contract)?row.collaboration_contract:null;let contract=null;if([1,2,3].includes(rawContract?.version)){const bytes=rawContract.added_utf8_bytes,matched=selected&&rawContract.status==='matched'&&Number.isSafeInteger(bytes)&&bytes>0&&bytes<=384,withdrawn=status==='fallback_observed'&&rawContract.status==='withdrawn'&&bytes===0;contract={version:rawContract.version,status:matched?'matched':withdrawn?'withdrawn':'unverified',added_utf8_bytes:matched?bytes:withdrawn?0:null};}
    return {ordinal:index+1,status,...(contract?{collaboration_contract:contract}:{}),model:MODELS.has(row.model)?row.model:null,read_id:readId,reading_id:selected?readingId:null,controls:selected?{response_extent:c.response_extent,unsolicited_update:c.unsolicited_update,conversation_style:c.conversation_style}:null,receipt_age_seconds:selected?finiteNonNegOrNull(row.receipt_age_seconds):null};
  });
  const matched=rows.length>0&&rows.length===src.requests_observed&&new Set(rows.map(x=>x.read_id)).size===rows.length&&rows.every(x=>['guidance_observed','fallback_observed'].includes(x.status));
  const proof=isRecord(src.response_attribution)?src.response_attribution:{};
  const requests=(Array.isArray(proof.requests)?proof.requests:[]).slice(0,64).map((raw,index)=>{
    const source=rows[index],presence=source?.status==='guidance_observed'?'guidance':source?.status==='fallback_observed'?'fallback':null;
    return {ordinal:index+1,status:raw?.ordinal===index+1&&presence&&raw.presence===presence&&raw.status==='response_linked'?'response_linked':raw?.status==='ambiguous'?'ambiguous':'unverified',presence:raw?.ordinal===index+1&&presence&&raw.presence===presence&&raw.status==='response_linked'?presence:null};
  });
  const finals=(Array.isArray(proof.finals)?proof.finals:[]).slice(0,64).map((raw,index)=>{
    const ordinal=Number.isSafeInteger(raw?.request_ordinal)&&raw.request_ordinal>0&&raw.request_ordinal<=rows.length?raw.request_ordinal:null,request=ordinal?requests[ordinal-1]:null;
    const linked=raw?.ordinal===index+1&&raw.status==='final_linked'&&request?.status==='response_linked'&&raw.presence===request.presence;
    return {ordinal:index+1,status:linked?'final_linked':raw?.status==='ambiguous'?'ambiguous':'unverified',request_ordinal:linked?ordinal:null,presence:linked?request.presence:null};
  });
  const responseMatched=matched&&src.turn_completed===true&&src.response_linkage==='public_final_matched'&&['linked','partial'].includes(proof.status)&&Number.isSafeInteger(src.public_finals)&&src.public_finals>0&&src.public_finals<=64&&proof.linked_finals===src.public_finals&&finals.length===src.public_finals&&requests.length===rows.length&&finals.every(x=>x.status==='final_linked')&&new Set(finals.map(x=>x.request_ordinal)).size===finals.length;
  const responseProof={status:enumOr(proof.status,new Set(['linked','partial','unverified','ambiguous']),'unverified'),linked_responses:requests.filter(x=>x.status==='response_linked').length,linked_finals:finals.filter(x=>x.status==='final_linked').length,requests,finals};

  return {
    status: enumOr(src.status, DELIVERY_STATUSES, "unknown"),
    turn_ordinal: countOrNull(src.turn_ordinal),
    request_dispatch_elapsed_ms: finiteNonNegOrNull(src.request_dispatch_elapsed_ms),
    requests_observed: countOrNull(src.requests_observed),
    public_finals: countOrNull(src.public_finals),
    turn_completed: boolOrNull(src.turn_completed),
    shared_quality_observed: boolOrNull(src.shared_quality_observed),
    ...(src.shared_quality_prompt_check_version===1?{shared_quality_prompt_check_version:1,shared_quality_prompt_observed:boolOrNull(src.shared_quality_prompt_observed)}:{}),
    trace_ended: boolOrNull(src.trace_ended),
    request_attribution: rows,
    hook_linkage: src.hook_linkage==='read_marker_matched'&&matched ? 'read_marker_matched' : 'unverified',
    response_linkage: responseMatched?'public_final_matched':'unverified',
    response_attribution: responseProof
  };
}

function projectPublicOutput(rawArm) {
  let finalMessages = 0;
  let finalWords = 0;
  let commentaryMessages = 0;
  let commentaryWords = 0;
  const src = isRecord(rawArm) ? rawArm : {};
  const msgs = src.messages;
  if (Array.isArray(msgs)) {
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (!isRecord(m)) continue;
      if (m.author !== "Muse") continue;
      if (m.phase === "finalAnswer") {
        finalMessages += 1;
        finalWords += countWords(m.text);
      } else if (m.phase === "commentary") {
        commentaryMessages += 1;
        commentaryWords += countWords(m.text);
      }
    }
  }
  return {
    final_messages: finalMessages,
    final_words: finalWords,
    commentary_messages: commentaryMessages,
    commentary_words: commentaryWords
  };
}

function projectModel(raw) {
 const s=isRecord(raw)?raw:{},requested=MODELS.has(s.requested_model)?s.requested_model:null;
 const observed=[...new Set((Array.isArray(s.observed_models)?s.observed_models:[]).filter(x=>MODELS.has(x)))].slice(0,2);
 const total=countOrNull(s.requests_observed),unknown=countOrNull(s.unidentified_requests);
 const coherent=requested&&total!==null&&unknown!==null&&unknown<=total&&observed.length<=total;
 const status=!coherent?'unknown':s.status==='unavailable'?'unavailable':total===0?'not_observed':observed.some(x=>x!==requested)?'mismatch':unknown>0||observed.length!==1?'partial':'observed';
 return {requested_model:requested,observed_models:observed,requests_observed:total,unidentified_requests:unknown,status};
}
const APPROVAL_REASONS=new Set(['invalid_identity','unsupported_subject','missing_subject_details','subject_too_large','unsafe_display_characters','choices_unavailable','choices_ambiguous','unknown']);
function projectApprovalDiagnostics(raw){
 const all=Array.isArray(raw?.events)?raw.events:[],selected=all.slice(-64),events=[];
 for(const row of selected){const at=canonicalTimeOrNull(row?.at);if(!isRecord(row)||!APPROVAL_REASONS.has(row.reason)||!at)continue;events.push({at,reason:row.reason,turn_ordinal:countOrNull(row.turn_ordinal)});}
 return{source:'server_projection',events,events_omitted:countOrNull(raw?.events_omitted),projection_omitted:Math.max(0,all.length-selected.length),rejected_events:selected.length-events.length};
}
function projectArm(raw) {
  const src = isRecord(raw) ? raw : {};
  return {
    status: enumOr(src.status, ARM_STATUSES, "unknown"),
    ...(Object.hasOwn(src,'last_turn_terminal')?{last_turn_terminal:enumOr(src.last_turn_terminal,new Set(['completed','cancelled','failed']),null)}:{}),
    model: projectModel(src.model),
    usage: projectUsage(src.usage),
    elapsed: projectElapsed(src.elapsed),
    delivery: projectDelivery(src.delivery),
    ...(isRecord(src.interactions)?{interactions:projectInteractions(src.interactions)}:{}),
    ...(isRecord(src.approval_diagnostics)?{approval_diagnostics:projectApprovalDiagnostics(src.approval_diagnostics)}:{}),
    ...(Object.hasOwn(src,'approval_decision_pending')?{approval_decision_pending:boolOrNull(src.approval_decision_pending)}:{}),
    public_output: projectPublicOutput(src)
  };
}

function projectInteractions(raw){
 return {enabled:boolOrNull(raw.enabled),...Object.fromEntries(['questions_presented','questions_answered','questions_clarified','questions_cancelled','questions_timed_out','questions_aborted','questions_interrupted','questions_settled_unknown','questions_closed_locally','pending_questions'].map(k=>[k,countOrNull(raw[k])]))};
}
function projectQuestionEffort(raw){
 return Object.fromEntries(['participant','coordinator','unattributed'].map(actor=>[actor,Object.fromEntries(['without','with'].map(arm=>[arm,Object.fromEntries(['accepted','unconfirmed','characters'].map(k=>[k,countOrNull(raw?.[actor]?.[arm]?.[k])]))]))]));
}

function projectTurnActions(raw){return Object.fromEntries(['participant','coordinator','unattributed'].map(actor=>[actor,Object.fromEntries(['without','with'].map(arm=>[arm,Object.fromEntries(['steering_accepted','interrupt_accepted','interrupt_unconfirmed'].map(k=>[k,countOrNull(raw?.[actor]?.[arm]?.[k])]))]))]));}

function projectPair(raw) {
  const src = isRecord(raw) ? raw : {};
  return {
    status: enumOr(src.status, PAIR_STATUSES, "unknown"),
    matched_context: boolOrNull(src.matched_context)
  };
}

function projectActionRole(raw) {
  const src = isRecord(raw) ? raw : {};
  return {
    submissions: countOrNull(src.submissions),
    shared_submissions: countOrNull(src.shared_submissions),
    characters: countOrNull(src.characters),
    partial_submissions: countOrNull(src.partial_submissions),
    partial_characters: countOrNull(src.partial_characters),
    unconfirmed_submissions: countOrNull(src.unconfirmed_submissions),
    unconfirmed_characters: countOrNull(src.unconfirmed_characters),
    unconfirmed_approval_decisions: countOrNull(src.unconfirmed_approval_decisions),
    arms: {without: projectMeasurementArm(src.arms?.without), with: projectMeasurementArm(src.arms?.with)}
  };
}

function projectMeasurementArm(raw) {
  const src = isRecord(raw) ? raw : {};
  return {
    messages: countOrNull(src.messages),
    characters: countOrNull(src.characters),
    approval_decisions: countOrNull(src.approval_decisions)
  };
}

function projectReviewArm(raw) {
  const src = isRecord(raw) ? raw : {};
  return {
    review_window_seconds: finiteNonNegOrNull(src.review_window_seconds),
    completed_review_segments: countOrNull(src.completed_review_segments),
    effort_rating: intInRangeOrNull(src.effort_rating, 1, 5),
    interruption_count: intInRangeOrNull(src.interruption_count, 0, 100)
  };
}

function projectMeasurement(raw) {
  const src = isRecord(raw) ? raw : {};
  const actionsSrc = isRecord(src.actions) ? src.actions : {};
  const reviewSrc = isRecord(src.review) ? src.review : {};
  const reviewArmsSrc = isRecord(reviewSrc.arms) ? reviewSrc.arms : {};
  const activeRaw = reviewSrc.active_arm;
  const activeArm = (activeRaw === "without" || activeRaw === "with") ? activeRaw : null;
  return {
    ...(isRecord(src.question_effort)?{question_effort:projectQuestionEffort(src.question_effort)}:{}),
    ...(isRecord(src.turn_actions)?{turn_actions:projectTurnActions(src.turn_actions)}:{}),
    actions: {
      participant: projectActionRole(actionsSrc.participant),
      coordinator: projectActionRole(actionsSrc.coordinator),
      unattributed: projectActionRole(actionsSrc.unattributed)
    },
    review: {
      active_arm: activeArm,
      arms: {
        without: projectReviewArm(reviewArmsSrc.without),
        with: projectReviewArm(reviewArmsSrc.with)
      }
    },
    attribution: FIXED_ATTRIBUTION
  };
}

function projectPresence(rawPresence) {
  const outer = isRecord(rawPresence) ? rawPresence : {};
  const src = isRecord(outer.source) ? outer.source : null;
  const available = src !== null;
  const eligible = src !== null ? boolOrNull(src.eligible) : null;
  const controlsSrc = (src !== null && isRecord(src.controls)) ? src.controls : {};
  const reRaw = controlsSrc.response_extent;
  const uuRaw = controlsSrc.unsolicited_update;
  const csRaw = controlsSrc.conversation_style;
  const reValid = typeof reRaw === "string" && RESPONSE_EXTENTS.has(reRaw);
  const uuValid = typeof uuRaw === "string" && UNSOLICITED_UPDATES.has(uuRaw);
  const csValid = typeof csRaw === "string" && CONVERSATION_STYLES.has(csRaw);
  let controls;
  if (eligible === true && reValid && uuValid && csValid) {
    controls = {
      response_extent: reRaw,
      unsolicited_update: uuRaw,
      conversation_style: csRaw
    };
  } else {
    controls = null;
  }
  const captureSrc = (src !== null && isRecord(src.capture)) ? src.capture : {};
  const capture = {
    state: enumOr(captureSrc.state, CAPTURE_STATES, "unavailable"),
    reason: (typeof captureSrc.reason === "string" && CAPTURE_REASONS.has(captureSrc.reason)) ? captureSrc.reason : null
  };
  const readAt = src !== null ? canonicalTimeOrNull(src.read_at) : null;
  const receivedAt = src !== null ? canonicalTimeOrNull(src.received_at) : null;
  const latencyMs = src !== null ? finiteNonNegOrNull(src.latency_ms) : null;
  return {
    available,
    eligible,
    controls,
    capture,
    read_at: readAt,
    received_at: receivedAt,
    latency_ms: latencyMs,
    ...(src?.guidance_lifetime === 'active_session' ? {guidance_lifetime: 'active_session', reading_freshness: eligible === true && ['fresh','last_known'].includes(src.reading_freshness) ? src.reading_freshness : 'unavailable'} : {})
  };
}

export function projectEvidence(state = {}, metadata = {}) {
  const s = isRecord(state) ? state : {};
  const m = isRecord(metadata) ? metadata : {};
  const armsSrc = isRecord(s.arms) ? s.arms : {};
  const codeChecks = projectCodeChecks(s.code_checks);
  const hasCheckedResults = !!codeChecks && Object.values(codeChecks.arms).some(arm => arm.reports.some(report => report.summary));
  return {
    metadata: projectMetadata(m),
    pair: projectPair({status:s.status, matched_context:s.comparison?.matched_context}),
    arms: {
      without: projectArm(armsSrc.without),
      with: projectArm(armsSrc.with)
    },
    measurement: projectMeasurement(s.measurement),
    presence: projectPresence(s.presence),
    textbox: projectTextbox(s.textbox),
    ...(codeChecks ? {code_checks: codeChecks} : {}),
    quality: hasCheckedResults ? {state: "checks_recorded", scope: "snapshot_test_results_only"} : {state: "not_verified"},
    limitations: [FIXED_LIMITATIONS[0], FIXED_LIMITATIONS[1], FIXED_LIMITATIONS[2], FIXED_LIMITATIONS[3], FIXED_LIMITATIONS[4]]
  };
}

function projectTextbox(value){
 if(!isRecord(value))return null;
 const reading=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x)?x:null;
 const history=Array.isArray(value.history)?value.history.slice(-200).filter(isRecord).filter(x=>['send','hook'].includes(x.stage)).map(x=>({stage:x.stage,at:canonicalTimeOrNull(x.at),selected:boolOrNull(x.selected),reading_id:reading(x.reading_id),age_ms:finiteNonNegOrNull(x.age_ms),observation_age_ms:finiteNonNegOrNull(x.observation_age_ms)})):[];
 const readings=Array.isArray(value.readings)?normalizePresenceReadings(value.readings):null;
 return{...(value.guidance_lifetime==='active_session'?{guidance_lifetime:'active_session',reading_freshness:value.selected===true&&['fresh','last_known'].includes(value.reading_freshness)?value.reading_freshness:'unavailable'}:{}),...projectOpAttemptHistory(value.attempt_history,value.attempt_history_omitted),service:projectOpDiagnostics(value.service),status:enumOr(value.status,new Set(['waiting_for_consent','waiting_for_input','refreshing','ready','access_rejected','backoff','unavailable']),'unknown'),consented:boolOrNull(value.consented),in_flight:boolOrNull(value.in_flight),receipt_count:countOrNull(value.receipt_count),reading_count:countOrNull(value.reading_count),last_receipt:enumOr(value.last_receipt,new Set(['none','accepted','duplicate','rejected_order','access_rejected','backoff','invalid','unavailable']),'unknown'),policy_change:enumOr(value.policy_change,new Set(['none','first','unchanged','changed']),'unknown'),readings,readings_omitted:countOrNull(value.readings_omitted),refreshing:boolOrNull(value.refreshing),reading_id:reading(value.reading_id),age_ms:finiteNonNegOrNull(value.age_ms),observation_age_ms:finiteNonNegOrNull(value.observation_age_ms),selected:boolOrNull(value.selected),freshness_limit_ms:finiteNonNegOrNull(value.freshness_limit_ms),history,history_omitted:countOrNull(value.history_omitted)};
}
