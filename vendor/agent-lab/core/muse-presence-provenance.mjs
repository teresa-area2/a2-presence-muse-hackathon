// Privacy-filtered correlation of Presence guidance to its committed response.
// Never infers linkage from time, next event, text similarity, or fabricated
// identifiers. Only exact validated request_id/attempt/step joins a Pre and a
// Post, and only an exact response_id with owned run/session ownership joins
// the Post to a native assistant_message_committed record.
//
// Official hook reference:
// https://meta-models.github.io/muse-code-sdk/next/guides/plugins/reference/hook-events/
// documents Pre request_id/attempt/step and Post response_id, but its examples
// were verified for Muse 1.3.0. Installed Muse is 1.4.13. Unit fixtures cannot
// prove actual 1.4.13 payloads or that guidance was applied. Every result
// carries qualification:'requires_live_qualification' and must be qualified
// later. Actual overhead, provider spend, and human benefit remain unknown.
//
// The coordinator observed in a real owned Muse 1.4.13 session that committed
// records carry response_id and a distinct message_id matching
// model_response_created, and MSP schema says public agentMessage.itemId is
// the committed message_id. Those observations do not establish that the
// installed Pre/Post hooks expose all fields or that a hook was applied:
// callers must fail closed when IDs, outcomes, records, visibility, or
// mappings are missing, ambiguous, reordered, duplicated, or foreign.
// An ID match alone never claims behavioral adaptation.
export const PROVENANCE_VERSION = 'muse-presence-provenance.1';
export const PRE_EVENT = 'PreLLMCall';
export const POST_EVENT = 'PostLLMCall';
export const HOOK_REFERENCE = 'https://meta-models.github.io/muse-code-sdk/next/guides/plugins/reference/hook-events/';
export const LIVE_QUALIFICATION = 'requires_live_qualification: fixtures cannot prove 1.4.13 payloads or applied guidance';
export const ADAPTATION_NOTE = 'ids_match_only: linkage never claims behavioral adaptation';

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x);
const tokenId = x => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const safeInt = x => Number.isSafeInteger(x) && x >= 0 && x <= 9007199254740991;
const sha256hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const stamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) ? new Date(x).toISOString() : null;
const fallbackReason = x => x === null || (typeof x === 'string' && /^[a-z_]{1,64}$/.test(x));

// Raw hook stdin, messages, response text, previews, capsules, credentials,
// private states, native transcripts, and hidden reasoning must never be
// persisted. Only the allowlisted metadata below may be recorded.
const PRIVATE_SENTINEL_KEYS = new Set([
  'messages', 'message', 'response_text', 'response', 'preview', 'capsule',
  'credentials', 'credential', 'private_state', 'private_states', 'transcript',
  'native_transcript', 'reasoning', 'hidden_reasoning', 'guidance', 'prompt',
  'input', 'output', 'tool_input', 'tool_output', 'stdout', 'stderr',
]);
const PRE_ALLOWLIST = new Set([
  'adapter_revision', 'event', 'read_at', 'eligible', 'fallback_reason',
  'received_at', 'receipt_age_seconds', 'controls', 'guidance_sha256',
  'renderer', 'session_id', 'turn_id', 'run_id',
  'request_id', 'attempt', 'step',
  'probe_outcome', 'probe_duration_ms', 'probe_exit_code', 'probe_attempts',
  'audit_write',
]);
const POST_ALLOWLIST = new Set([
  'adapter_revision', 'event', 'observed_at', 'read_at', 'session_id', 'turn_id',
  'run_id', 'request_id', 'attempt', 'step', 'response_id', 'provider_status',
  'probe_outcome', 'audit_write',
]);
const CONTROL_EXTENTS = new Set(['terse', 'standard', 'full']);
const CONTROL_TIMING = new Set(['send', 'defer']);
const CONTROL_STYLES = new Set(['self_contained', 'conversational']);

function hasPrivateSentinel(value) {
  if (!object(value)) return false;
  return Object.keys(value).some(k => PRIVATE_SENTINEL_KEYS.has(k));
}

function checkControls(controls) {
  if (controls === null || controls === undefined) return null;
  if (!object(controls)) return false;
  const keys = Object.keys(controls).sort().join(',');
  if (keys !== 'conversation_style,response_extent,unsolicited_update') return false;
  return CONTROL_EXTENTS.has(controls.response_extent)
    && CONTROL_TIMING.has(controls.unsolicited_update)
    && CONTROL_STYLES.has(controls.conversation_style);
}

function checkOwnedScope(normalized, owned) {
  if (!owned || typeof owned.sessionId !== 'string' || !uuid(owned.sessionId)) return 'invalid_owned_scope';
  if (normalized.session_id !== owned.sessionId) return 'cross_session_record';
  if (owned.runId !== undefined && owned.runId !== null) {
    if (!uuid(owned.runId)) return 'invalid_owned_scope';
    // A run-scoped record must carry the owned run. A turn-only record
    // (run_id null) is accepted only when its turn matches an explicitly
    // mapped owned turn; otherwise it is unbound.
    if (normalized.run_id !== undefined && normalized.run_id !== null && normalized.run_id !== owned.runId) return 'cross_run_record';
    if ((normalized.run_id === undefined || normalized.run_id === null) && owned.turnId) {
      if (normalized.turn_id !== owned.turnId) return 'cross_turn_record';
    } else if ((normalized.run_id === undefined || normalized.run_id === null) && !owned.turnId) {
      return 'unbound_legacy_audit';
    }
  }
  if (owned.turnId !== undefined && owned.turnId !== null && normalized.turn_id !== undefined && normalized.turn_id !== null && normalized.turn_id !== owned.turnId) return 'cross_turn_record';
  return null;
}

export function validatePreAudit(raw, owned = {}) {
  if (!object(raw)) return { ok: false, reason: 'malformed_pre_observation' };
  if (hasPrivateSentinel(raw)) return { ok: false, reason: 'private_data_present' };
  const unknownKeys = Object.keys(raw).filter(k => !PRE_ALLOWLIST.has(k));
  // Forward-compatibility: refuse unknown keys rather than silently keeping them.
  if (unknownKeys.length) return { ok: false, reason: 'unreviewed_pre_field' };
  if (raw.event !== PRE_EVENT) return { ok: false, reason: 'unexpected_hook_event' };
  const { request_id, attempt, step } = raw;
  if (!tokenId(request_id) || !safeInt(attempt) || !safeInt(step)) return { ok: false, reason: 'missing_generation_binding' };
  if (raw.session_id !== undefined && raw.session_id !== null && !uuid(raw.session_id)) return { ok: false, reason: 'malformed_session_binding' };
  if (raw.turn_id !== undefined && raw.turn_id !== null && !uuid(raw.turn_id)) return { ok: false, reason: 'malformed_turn_binding' };
  if (raw.run_id !== undefined && raw.run_id !== null && !uuid(raw.run_id)) return { ok: false, reason: 'malformed_run_binding' };
  if (!uuid(raw.session_id)) return { ok: false, reason: 'missing_session_binding' };
  if (typeof raw.eligible !== 'boolean') return { ok: false, reason: 'malformed_eligibility' };
  if (raw.eligible) {
    if (raw.fallback_reason !== null && raw.fallback_reason !== undefined) return { ok: false, reason: 'malformed_fallback' };
    if (!sha256hex(raw.guidance_sha256)) return { ok: false, reason: 'missing_guidance_digest' };
    if (checkControls(raw.controls) !== true) return { ok: false, reason: 'invalid_controls' };
  } else {
    if (!fallbackReason(raw.fallback_reason)) return { ok: false, reason: 'malformed_fallback' };
    if (raw.guidance_sha256 !== null && raw.guidance_sha256 !== undefined) return { ok: false, reason: 'stale_guidance_digest' };
    if (raw.controls !== null && raw.controls !== undefined) return { ok: false, reason: 'stale_guidance_controls' };
  }
  const readAt = stamp(raw.read_at);
  if (!readAt) return { ok: false, reason: 'missing_read_timestamp' };
  if (Date.parse(readAt) > Date.now()) return { ok: false, reason: 'future_read_timestamp' };
  if (raw.eligible && (!stamp(raw.received_at) || Date.parse(raw.received_at) > Date.parse(readAt))) return { ok: false, reason: 'invalid_receipt_timestamp' };
  // A readable row establishes an observation, not successful complete write
  // or host acceptance. Legacy explicit failures are still rejected.
  if (raw.audit_write !== undefined && raw.audit_write !== 'ok') return { ok: false, reason: 'audit_write_failure' };
  const scopeError = owned.sessionId ? checkOwnedScope(raw, owned) : null;
  if (scopeError) return { ok: false, reason: scopeError };
  return {
    ok: true,
    normalized: {
      event: PRE_EVENT, session_id: raw.session_id,
      turn_id: raw.turn_id ?? null, run_id: raw.run_id ?? null,
      request_id, attempt, step, eligible: raw.eligible,
      fallback_reason: raw.eligible ? null : (raw.fallback_reason ?? null),
      guidance_sha256: raw.eligible ? raw.guidance_sha256 : null,
      controls: raw.eligible ? { ...raw.controls } : null,
      received_at: stamp(raw.received_at) ?? null,
      receipt_age_seconds: typeof raw.receipt_age_seconds === 'number' && Number.isFinite(raw.receipt_age_seconds) ? raw.receipt_age_seconds : null,
      renderer: raw.renderer ?? null, read_at: readAt,
    },
  };
}

export function validatePostAudit(raw, owned = {}) {
  if (!object(raw)) return { ok: false, reason: 'malformed_post_observation' };
  if (hasPrivateSentinel(raw)) return { ok: false, reason: 'private_data_present' };
  const unknownKeys = Object.keys(raw).filter(k => !POST_ALLOWLIST.has(k));
  if (unknownKeys.length) return { ok: false, reason: 'unreviewed_post_field' };
  if (raw.event !== POST_EVENT) return { ok: false, reason: 'unexpected_hook_event' };
  const { request_id, attempt, step } = raw;
  if (!tokenId(request_id) || !safeInt(attempt) || !safeInt(step)) return { ok: false, reason: 'missing_generation_binding' };
  if (!uuid(raw.session_id)) return { ok: false, reason: 'missing_session_binding' };
  if (raw.turn_id !== undefined && raw.turn_id !== null && !uuid(raw.turn_id)) return { ok: false, reason: 'malformed_turn_binding' };
  if (raw.run_id !== undefined && raw.run_id !== null && !uuid(raw.run_id)) return { ok: false, reason: 'malformed_run_binding' };
  // A Post record can exist without a recognized provider result. Its IDs may
  // associate records, but neither provider success nor context delivery can
  // be inferred. Never retain an unrecognized raw status value.
  const status = ['successful','failed','conflicting'].includes(raw.provider_status) ? raw.provider_status : 'unknown';
  if (raw.response_id !== undefined && raw.response_id !== null && !tokenId(raw.response_id)) return { ok: false, reason: 'malformed_response_binding' };
  if (raw.audit_write !== undefined && raw.audit_write !== 'ok') return { ok: false, reason: 'audit_write_failure' };
  const observedAt = stamp(raw.observed_at ?? raw.read_at);
  if (!observedAt) return { ok: false, reason: 'missing_observation_timestamp' };
  if (Date.parse(observedAt) > Date.now()) return { ok: false, reason: 'future_observation_timestamp' };
  const scopeError = owned.sessionId ? checkOwnedScope(raw, owned) : null;
  if (scopeError) return { ok: false, reason: scopeError };
  return {
    ok: true,
    normalized: {
      event: POST_EVENT, session_id: raw.session_id,
      turn_id: raw.turn_id ?? null, run_id: raw.run_id ?? null,
      request_id, attempt, step,
      response_id: raw.response_id ?? null,
      provider_status: status, observed_at: observedAt,
    },
  };
}

const tripleKey = (request_id, attempt, step) => `${request_id}:${attempt}:${step}`;

export function validateCommittedMessage(raw, owned = {}) {
  if (!object(raw)) return { ok: false, reason: 'malformed_committed_record' };
  if (hasPrivateSentinel(raw)) return { ok: false, reason: 'private_data_present' };
  const { message_id, response_id, run_id } = raw;
  if (!tokenId(message_id)) return { ok: false, reason: 'missing_message_binding' };
  if (response_id !== undefined && response_id !== null && !tokenId(response_id)) return { ok: false, reason: 'malformed_response_binding' };
  if (owned.sessionId && raw.session_id !== owned.sessionId) return { ok: false, reason: raw.session_id ? 'cross_session_record' : 'unbound_session_record' };
  if (owned.runId && run_id !== owned.runId) return { ok: false, reason: run_id ? 'cross_run_record' : 'unbound_run_record' };
  return { ok: true, normalized: { message_id, response_id: response_id ?? null, run_id: run_id ?? null } };
}

// MSP schema: public agentMessage.itemId is the committed message_id. This
// helper checks that identity without exposing raw hook identifiers. It does
// not establish that guidance was applied.
export function publicItemMatchesCommitted(publicItemId, committedMessageId) {
  if (!tokenId(publicItemId) || !tokenId(committedMessageId)) return false;
  return publicItemId === committedMessageId;
}

export function buildGenerationLinks({ pres = [], posts = [], committed = [], owned = {} } = {}) {
  if (!owned.sessionId || !uuid(owned.sessionId) || !uuid(owned.runId) || (owned.turnId != null && !uuid(owned.turnId))) {
    return { links: [], summary: { total: 0, linked: 0, unverified: 0, unknown: 0 }, limitations: ['Owned session identity missing; provenance unknown.'], qualification: LIVE_QUALIFICATION };
  }
  const preByKey = new Map(), postByKey = new Map();
  const preProblems = new Map(), postProblems = new Map();
  for (const raw of pres) {
    const parsed = validatePreAudit(raw, owned);
    if (!parsed.ok) {
      const fallbackKey = object(raw) && tokenId(raw.request_id) && safeInt(raw.attempt) && safeInt(raw.step)
        ? tripleKey(raw.request_id, raw.attempt, raw.step) : `malformed_pre_${preProblems.size}`;
      if (!preProblems.has(fallbackKey)) preProblems.set(fallbackKey, []);
      preProblems.get(fallbackKey).push(parsed.reason);
      continue;
    }
    const key = tripleKey(parsed.normalized.request_id, parsed.normalized.attempt, parsed.normalized.step);
    if (!preByKey.has(key)) preByKey.set(key, []);
    preByKey.get(key).push(parsed.normalized);
  }
  for (const raw of posts) {
    const parsed = validatePostAudit(raw, owned);
    if (!parsed.ok) {
      const fallbackKey = object(raw) && tokenId(raw.request_id) && safeInt(raw.attempt) && safeInt(raw.step)
        ? tripleKey(raw.request_id, raw.attempt, raw.step) : `malformed_post_${postProblems.size}`;
      if (!postProblems.has(fallbackKey)) postProblems.set(fallbackKey, []);
      postProblems.get(fallbackKey).push(parsed.reason);
      continue;
    }
    const key = tripleKey(parsed.normalized.request_id, parsed.normalized.attempt, parsed.normalized.step);
    if (!postByKey.has(key)) postByKey.set(key, []);
    postByKey.get(key).push(parsed.normalized);
  }
  const committedByResponse = new Map(), committedProblems = [];
  for (const raw of committed) {
    const parsed = validateCommittedMessage(raw, owned);
    if (!parsed.ok) { committedProblems.push(parsed.reason); continue; }
    if (!parsed.normalized.response_id) continue;
    if (!committedByResponse.has(parsed.normalized.response_id)) committedByResponse.set(parsed.normalized.response_id, []);
    committedByResponse.get(parsed.normalized.response_id).push(parsed.normalized);
  }
  const keys = new Set([...preByKey.keys(), ...postByKey.keys(), ...preProblems.keys(), ...postProblems.keys()]);
  const responseOwners = new Map(), messageOwners = new Map();
  for (const [key, observations] of postByKey) for (const observation of observations) {
    if (!observation.response_id) continue;
    if (!responseOwners.has(observation.response_id)) responseOwners.set(observation.response_id, new Set());
    responseOwners.get(observation.response_id).add(key);
  }
  for (const [responseId, observations] of committedByResponse) for (const observation of observations) {
    if (!messageOwners.has(observation.message_id)) messageOwners.set(observation.message_id, new Set());
    messageOwners.get(observation.message_id).add(responseId);
  }
  const links = [];
  let ordinal = 0;
  for (const key of keys) {
    ordinal += 1;
    const base = { generation_ordinal: ordinal, triple_key_present: preByKey.has(key) && postByKey.has(key), qualification: LIVE_QUALIFICATION, adaptation_claim: ADAPTATION_NOTE };
    const presForKey = preByKey.get(key) ?? [];
    const postsForKey = postByKey.get(key) ?? [];
    const preErrs = preProblems.get(key) ?? [];
    const postErrs = postProblems.get(key) ?? [];
    if (preErrs.length || postErrs.length) {
      links.push({ ...base, linkage_status: 'unverified', reason: [...preErrs, ...postErrs][0] ?? 'malformed_observation', request_key: key });
      continue;
    }
    if (!presForKey.length) { links.push({ ...base, linkage_status: 'unknown', reason: 'missing_pre_observation', request_key: key }); continue; }
    if (!postsForKey.length) { links.push({ ...base, linkage_status: 'unknown', reason: 'missing_post_observation', request_key: key }); continue; }
    // Duplicate/conflicting records for the same generation triple fail closed.
    // A fallback guidance is a current distinct observation: differing
    // eligibility or digests for the same triple is a conflict, never a reuse.
    const preSignature = new Set(presForKey.map(p => JSON.stringify(p)));
    if (preSignature.size > 1) { links.push({ ...base, linkage_status: 'unverified', reason: 'conflicting_pre_observations', request_key: key }); continue; }
    const postSignature = new Set(postsForKey.map(p => JSON.stringify(p)));
    if (postSignature.size > 1) { links.push({ ...base, linkage_status: 'unverified', reason: 'conflicting_post_observations', request_key: key }); continue; }
    if (presForKey.length > 1 || postsForKey.length > 1) {
      // Exact duplicates are harmless and collapse to one observation.
    }
    const pre = presForKey[0], post = postsForKey[0];
    if (pre.session_id !== post.session_id) { links.push({ ...base, linkage_status: 'unverified', reason: 'cross_session_record', request_key: key }); continue; }
    if (pre.turn_id && post.turn_id && pre.turn_id !== post.turn_id) { links.push({ ...base, linkage_status: 'unverified', reason: 'cross_turn_record', request_key: key }); continue; }
    if (pre.run_id && post.run_id && pre.run_id !== post.run_id) { links.push({ ...base, linkage_status: 'unverified', reason: 'cross_run_record', request_key: key }); continue; }
    if (post.provider_status === 'failed' || post.provider_status === 'conflicting') {
      links.push({ ...base, linkage_status: 'unverified', reason: post.provider_status === 'failed' ? 'unsuccessful_provider_call' : 'conflicting_provider_outcome', eligible: pre.eligible, fallback_reason: pre.fallback_reason, request_key: key });
      continue;
    }
    if (!post.response_id) { links.push({ ...base, linkage_status: 'unknown', reason: 'missing_response_binding', request_key: key }); continue; }
    if (responseOwners.get(post.response_id)?.size !== 1) { links.push({ ...base, linkage_status: 'unverified', reason: 'reused_response_id', request_key: key }); continue; }
    if (committedProblems.length) { links.push({ ...base, linkage_status: 'unverified', reason: 'ambiguous_committed_evidence', request_key: key }); continue; }
    // Unsafe reorder: a Post observed before its Pre read cannot safely join.
    if (Date.parse(post.observed_at) < Date.parse(pre.read_at)) {
      links.push({ ...base, linkage_status: 'unverified', reason: 'reordered_observation', request_key: key });
      continue;
    }
    const candidates = (committedByResponse.get(post.response_id) ?? []).filter(c => !owned.runId || !c.run_id || c.run_id === owned.runId);
    // The request/response pair is complete even when this generation did not
    // commit public text (for example a tool call). Do not infer its output.
    if (!candidates.length) { links.push({ ...base, linkage_status: 'unknown', reason: 'missing_committed_record', response_id:post.response_id, eligible: pre.eligible, fallback_reason: pre.fallback_reason, request_key: key }); continue; }
    const messageIds = new Set(candidates.map(c => c.message_id));
    if (messageIds.size > 1) { links.push({ ...base, linkage_status: 'unverified', reason: 'conflicting_committed_records', request_key: key }); continue; }
    const committedRecord = candidates[0];
    if (messageOwners.get(committedRecord.message_id)?.size !== 1) { links.push({ ...base, linkage_status: 'unverified', reason: 'reused_message_id', request_key: key }); continue; }
    if (owned.runId && committedRecord.run_id && committedRecord.run_id !== owned.runId) {
      links.push({ ...base, linkage_status: 'unverified', reason: 'foreign_run_record', request_key: key });
      continue;
    }
    links.push({
      ...base,
      linkage_status: 'linked',
      context_delivery: 'unknown',
      provider_outcome: 'unknown',
      eligible: pre.eligible,
      fallback_reason: pre.fallback_reason,
      guidance_sha256_present: pre.guidance_sha256 !== null,
      request_id: pre.request_id, attempt: pre.attempt, step: pre.step,
      response_id: post.response_id, message_id: committedRecord.message_id,
      session_id: pre.session_id,
    });
  }
  // Committed records never create links alone: without both hook sides the
  // correlation is unknown, not inferred from the record.
  const summary = {
    total: links.length,
    linked: links.filter(l => l.linkage_status === 'linked').length,
    unverified: links.filter(l => l.linkage_status === 'unverified').length,
    unknown: links.filter(l => l.linkage_status === 'unknown').length,
  };
  const limitations = [];
  if (committedProblems.length) limitations.push('Some committed records were malformed and excluded.');
  if (!links.length) limitations.push('No scoped Pre/Post generation triples; correlation unknown.');
  if (links.some(l => l.linkage_status !== 'linked')) limitations.push('Unlinked generations remain unverified/unknown; IDs alone never prove adaptation.');
  limitations.push(LIVE_QUALIFICATION);
  return { links, summary, limitations, qualification: LIVE_QUALIFICATION };
}

// Safe scoped representation for public telemetry/UI: no raw request,
// response, session, turn, run identifiers and no private path.
export function toScopedProvenance(link) {
  if (!link || typeof link !== 'object') return { linkage_status: 'unknown', reason: 'missing_linkage', qualification: LIVE_QUALIFICATION };
  return {
    linkage_status: ['linked', 'unverified', 'unknown'].includes(link.linkage_status) ? link.linkage_status : 'unknown',
    reason: typeof link.reason === 'string' ? link.reason : (link.linkage_status === 'linked' ? null : 'unspecified'),
    generation_ordinal: Number.isSafeInteger(link.generation_ordinal) ? link.generation_ordinal : null,
    eligible: link.eligible === true ? true : link.eligible === false ? false : null,
    fallback_reason: typeof link.fallback_reason === 'string' ? link.fallback_reason : null,
    guidance_digest_present: link.guidance_sha256_present === true ? true : link.linkage_status === 'linked' ? false : null,
    context_delivery: 'unknown',
    provider_outcome: 'unknown',
    adaptation_claim: ADAPTATION_NOTE,
    qualification: LIVE_QUALIFICATION,
  };
}

// This can be attached to an already-displayed MSP item only after the caller
// has independently verified complete owned session, run and audit evidence.
// It intentionally exposes no hook request, response, run or session IDs.
export function provenanceForPublicItem(built, itemId) {
  const safeId = tokenId(itemId) ? itemId : null;
  const unknown = {item_id: safeId, linkage_status: 'unknown', eligible: null, fallback_reason: null, context_delivery: 'unknown', provider_outcome: 'unknown'};
  if (!safeId || !Array.isArray(built?.links)) return unknown;
  const matches = built.links.filter(link => link.linkage_status === 'linked' && link.message_id === safeId);
  if (matches.length !== 1) return unknown;
  const link = matches[0];
  return {item_id: safeId, linkage_status: 'linked', eligible: link.eligible === true ? true : link.eligible === false ? false : null,
    fallback_reason: typeof link.fallback_reason === 'string' ? link.fallback_reason : null, context_delivery: 'unknown', provider_outcome: 'unknown'};
}

export function summarizeProvenance(buildResult) {
  const links = buildResult?.links ?? [];
  return {
    total_generations: links.length,
    linked: links.filter(l => l.linkage_status === 'linked').length,
    unverified: links.filter(l => l.linkage_status === 'unverified').length,
    unknown: links.filter(l => l.linkage_status === 'unknown').length,
    scoped: links.map(toScopedProvenance),
    limitations: buildResult?.limitations ?? ['Provenance unknown.'],
    qualification: LIVE_QUALIFICATION,
  };
}
