import {buildObserverExperience,projectObserverExperience} from './observer-comparison.mjs';
import { projectEvidence } from './evidence-projection.mjs';
import { presenceView } from '../web/terminal-presence-view.mjs';
import {projectMechanismMetrics} from '../web/session-evidence.mjs';

const SCHEMA_VERSION = 1;
// Only catalogues created here may enter the model boundary. Public returned
// objects are editable display copies, never authority for prompt text or claims.
const catalogues = new WeakMap();

const OBSERVER_LIMITATIONS = [
  'evidence_explanation_only_no_personal_state',
  'no_causal_benefit_or_savings_inference',
  'unknown_is_not_zero'
];

const RESPONSE_EXTENTS = new Set(['terse', 'standard', 'full']);
const UNSOLICITED_UPDATES = new Set(['send', 'defer']);
const CONVERSATION_STYLES = new Set(['self_contained', 'conversational']);

function isRecord(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isSafeNonNegInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isPositiveInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

function safeControls(c) {
  if (!isRecord(c)) return null;
  if (typeof c.response_extent !== 'string' || !RESPONSE_EXTENTS.has(c.response_extent)) return null;
  if (typeof c.unsolicited_update !== 'string' || !UNSOLICITED_UPDATES.has(c.unsolicited_update)) return null;
  if (typeof c.conversation_style !== 'string' || !CONVERSATION_STYLES.has(c.conversation_style)) return null;
  return {
    response_extent: c.response_extent,
    unsolicited_update: c.unsolicited_update,
    conversation_style: c.conversation_style
  };
}

function currentControls(rawPresence, now) {
  try {
    const value = isRecord(rawPresence) || rawPresence === null || rawPresence === undefined ? rawPresence ?? null : null;
    const view = presenceView(value, null, now);
    return safeControls(view ? view.controls : null);
  } catch {
    return null;
  }
}

function sessionGenerationOf(state) {
  if (!isRecord(state)) return null;
  const direct = state.session_generation;
  if (isPositiveInt(direct)) return direct;
  const nested = isRecord(state.session) ? state.session.generation : undefined;
  if (isPositiveInt(nested)) return nested;
  return null;
}

function withDeliveryOf(safe) {
  if (!isRecord(safe)) return {};
  const arms = isRecord(safe.arms) ? safe.arms : {};
  const withArm = isRecord(arms.with) ? arms.with : {};
  const delivery = isRecord(withArm.delivery) ? withArm.delivery : {};
  return delivery;
}

function deliveryCorrelation(delivery) {
  const rows = Array.isArray(delivery.request_attribution) ? delivery.request_attribution : [];
  const matching = rows.filter((r) => isRecord(r) && (r.status === 'guidance_observed' || r.status === 'fallback_observed'));
  const guidanceCount = rows.filter((r) => isRecord(r) && r.status === 'guidance_observed').length;
  const fallbackCount = rows.filter((r) => isRecord(r) && r.status === 'fallback_observed').length;
  const hookOk = delivery.hook_linkage === 'read_marker_matched';
  const readIds = matching.map((r) => r.read_id);
  const allHaveId = matching.length > 0 && readIds.every((id) => typeof id === 'string' && id !== null);
  const unique = new Set(readIds).size === readIds.length;
  const correlated = hookOk && matching.length > 0 && allHaveId && unique;
  return { matchingCount: matching.length, guidanceCount, fallbackCount, correlated };
}

function metricsView(metrics) {
  metrics=projectMechanismMetrics(metrics);
  if (!isRecord(metrics)) return null;
  if (metrics.schema_version !== 1) return null;
  const heldCurrent = metrics.held_current;
  const heldTotal = metrics.held_total;
  const releasedManual = metrics.released_manual;
  const releasedAutomatic = metrics.released_automatic;
  const historyResets = metrics.history_resets;
  const coverage = metrics.coverage;
  if (!isSafeNonNegInt(heldCurrent)) return null;
  if (!isSafeNonNegInt(heldTotal)) return null;
  if (!isSafeNonNegInt(releasedManual)) return null;
  if (!isSafeNonNegInt(releasedAutomatic)) return null;
  if (!isSafeNonNegInt(historyResets)) return null;
  if (!['observed','partial'].includes(coverage)) return null;
  return {
    heldCurrent,
    heldTotal,
    releasedManual,
    releasedAutomatic,
    historyResets,
    coverageLabel: coverage === 'observed' ? 'observed' : 'partial'
  };
}

function describeCount(v) {
  return isSafeNonNegInt(v) ? String(v) : 'unknown';
}

export function buildObserverEvidence(state, { metrics = null, now = Date.now() } = {}) {
  const safe = projectEvidence(isRecord(state) ? state : {});
  const effectiveNow = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const rawPresence = isRecord(state) ? state.presence ?? null : null;
  const controls = currentControls(rawPresence, effectiveNow);
  const facts = [];

  if (controls !== null) {
    facts.push({
      id: 'source_current',
      kind: 'source',
      text: rawPresence?.source?.guidance_lifetime === 'active_session' && rawPresence?.source?.reading_freshness === 'last_known' ? `Using the last accepted policy in this session: ${controls.response_extent} response · ${controls.unsolicited_update} optional updates · ${controls.conversation_style.replace(/_/g, ' ')}. This is retained collaboration guidance, not a new typing observation.` : `Current presence policy: ${controls.response_extent} response \u00b7 ${controls.unsolicited_update} optional updates \u00b7 ${controls.conversation_style.replace(/_/g, ' ')}. Source reading is current and eligible; policy reflects the current source only.`
    });
  } else {
    facts.push({
      id: 'source_fallback',
      kind: 'source',
      text: 'Presence source is ordinary fallback (no current eligible reading); policy is ordinary behavior, not a current source policy.'
    });
  }

  const delivery = withDeliveryOf(safe);
  const corr = deliveryCorrelation(delivery);
  if (corr.correlated) {
    facts.push({
      id: 'delivery_correlated',
      kind: 'delivery',
      text: `Current-turn request correlation: ${corr.matchingCount} request(s) observed (${corr.guidanceCount} guidance, ${corr.fallbackCount} fallback) with matched read markers. This describes request observation for the current turn only, not provider execution or model compliance.`
    });
  } else {
    facts.push({
      id: 'delivery_unverified',
      kind: 'delivery',
      text: 'Current-turn request correlation unverified (no matched read markers for this turn); request observation only, not provider execution or model compliance.'
    });
  }

  const dStatus = safe.arms.without.delivery.status;
  if (dStatus === 'baseline_isolated') {
    facts.push({
      id: 'baseline_isolated',
      kind: 'baseline',
      text: 'Baseline isolation observed for this turn; mechanism counts are scoped to this browser projection.'
    });
  } else if (dStatus === 'baseline_contaminated') {
    facts.push({
      id: 'baseline_contaminated',
      kind: 'baseline',
      text: 'Presence was detected in the baseline request; this comparison is invalid.'
    });
  } else {
    facts.push({
      id: 'baseline_unverified',
      kind: 'baseline',
      text: 'Baseline isolation unverified for this turn; counts are descriptive and scoped to this browser projection.'
    });
  }

  const mv = metricsView(metrics);
  if (mv !== null) {
    facts.push({
      id: 'browser_updates',
      kind: 'presentation',
      text: `Browser projection (${mv.coverageLabel} coverage): ${mv.heldCurrent} current held of ${mv.heldTotal} total held; ${mv.releasedManual} manual releases, ${mv.releasedAutomatic} automatic releases; ${mv.historyResets} history resets. Counts describe presentation only; automatic release cause unknown; no interruption claim.`
    });
  } else {
    facts.push({
      id: 'browser_unavailable',
      kind: 'presentation',
      text: 'Browser update holds/releases unavailable (metrics missing or invalid); unknown is not zero; no interruption claim.'
    });
  }

  const withPub = isRecord(safe.arms) && isRecord(safe.arms.with) && isRecord(safe.arms.with.public_output)
    ? safe.arms.with.public_output
    : {};
  const withoutPub = isRecord(safe.arms) && isRecord(safe.arms.without) && isRecord(safe.arms.without.public_output)
    ? safe.arms.without.public_output
    : {};
  const output = (arm, value) => Array.isArray(state?.arms?.[arm]?.messages) ? `${value.final_words} words / ${value.final_messages} final messages` : 'unavailable';
  facts.push({
    id: 'output_totals',
    kind: 'output',
    text: `Public output session totals — Without: ${output('without',withoutPub)}; With: ${output('with',withPub)}. Word counts do not establish quality.`
  });

  const withUsage = isRecord(safe.arms) && isRecord(safe.arms.with) && isRecord(safe.arms.with.usage)
    ? safe.arms.with.usage
    : {};
  const withoutUsage = safe.arms.without.usage;
  const knownUsage = usage => usage.status === 'observed' && ['native','provider_trace'].includes(usage.source);
  const usageObserved = knownUsage(withUsage) || knownUsage(withoutUsage);
  if (usageObserved) {
    facts.push({
      id: 'resources_observed',
      kind: 'resources',
      text: 'Reported session resources — '+[['Without',withoutUsage],['With',withUsage]].map(([arm,u])=>arm+': '+(knownUsage(u)?`${describeCount(u.model_calls)} calls, ${describeCount(u.input_tokens)} input tokens, ${describeCount(u.output_tokens)} output tokens, ${describeCount(u.cache_read_tokens)} cached tokens`:'unavailable')).join('; ')+'. Observer usage is separate; no cost or savings inferred.'
    });
  } else {
    facts.push({
      id: 'resources_unreported',
      kind: 'resources',
      text: 'Resource usage unreported or unavailable; unknown is not zero; no cost inference.'
    });
  }

  const reviewArms = isRecord(safe.measurement) && isRecord(safe.measurement.review) && isRecord(safe.measurement.review.arms)
    ? safe.measurement.review.arms
    : {};
  const withReview = isRecord(reviewArms.with) ? reviewArms.with : {};
  const withoutReview = isRecord(reviewArms.without) ? reviewArms.without : {};
  const withEffort = Number.isInteger(withReview.effort_rating) ? withReview.effort_rating : null;
  const withoutEffort = Number.isInteger(withoutReview.effort_rating) ? withoutReview.effort_rating : null;
  if (withEffort !== null || withoutEffort !== null) {
    const withLabel = withEffort === null ? 'unknown' : `${withEffort} of 5`;
    const withoutLabel = withoutEffort === null ? 'unknown' : `${withoutEffort} of 5`;
    facts.push({
      id: 'effort_reported',
      kind: 'effort',
      text: `Self-reported user effort: with arm ${withLabel}, without arm ${withoutLabel}. Ratings are self-reported, not attention.`
    });
  }

  const matchedContext = isRecord(safe.pair) ? safe.pair.matched_context : null;
  let hasComparison = false;
  if (matchedContext === false) {
    facts.push({
      id: 'comparison_unmatched',
      kind: 'comparison',
      text: 'Histories are unmatched (different contexts); session totals are descriptive only, not a controlled comparison.'
    });
    hasComparison = true;
  }

  facts.push({
    id: 'benefit_unverified',
    kind: 'limitation',
    text: 'Delivery and presentation evidence alone does not establish response quality or human/resource benefit; benefit unverified, no causal or savings inference.'
  });

  const required_fact_ids = ['benefit_unverified'];
  if (hasComparison) required_fact_ids.push('comparison_unmatched');
  if (dStatus === 'baseline_contaminated') required_fact_ids.push('baseline_contaminated');

  // Both live UI and provider facts use the same bounded structural observer.
  // Use normalized metadata, retaining raw assistant text only for local analysis.
  const experience = buildObserverExperience({...state,arms:Object.fromEntries(['without','with'].map(arm=>[arm,{...safe.arms[arm],messages:state?.arms?.[arm]?.messages}])),measurement:safe.measurement,textbox:safe.textbox},{metrics,now:effectiveNow});
  facts.push({id:'response_scope',kind:'comparison',text:experience.scope+' '+experience.link});
  for(const row of experience.dimensions) facts.push({id:'dimension_'+row.id,kind:row.id,text:`${row.title} (${row.status.replaceAll('_',' ')}): Without ${row.without}; With ${row.with}. ${row.summary} ${row.detail}`});

  const evidence = {
    schema_version: SCHEMA_VERSION,
    session_generation: sessionGenerationOf(state),
    facts: facts.map((f) => ({ id: f.id, kind: f.kind, text: f.text })),
    required_fact_ids: required_fact_ids.slice(),
    limitations: OBSERVER_LIMITATIONS.slice()
  };
  catalogues.set(evidence,structuredClone({facts:evidence.facts,required_fact_ids,experience:projectObserverExperience(experience)}));
  return evidence;
}

export function observerExperience(evidence) {
  return structuredClone(catalogues.get(evidence)?.experience ?? null);
}

function allowlistedFacts(evidence) {
  return catalogues.get(evidence)?.facts.map(f=>({...f})) ?? [];
}

function allowedIds(evidence) {
  return allowlistedFacts(evidence).map((f) => f.id);
}

function invalidSelection() {
  const err = new Error('observer_selection_invalid');
  err.code = 'observer_selection_invalid';
  throw err;
}

export function observerSelectionSchema(evidence) {
  const ids = allowedIds(evidence);
  return {
    type: 'object',
    properties: {
      fact_ids: {
        type: 'array',
        items: { type: 'string', enum: ids.slice() },
        minItems: 1,
        maxItems: 6,
        uniqueItems: true
      }
    },
    required: ['fact_ids'],
    additionalProperties: false
  };
}

const OBSERVER_INSTRUCTIONS = 'You are a Muse-curated Presence observer. Select up to 6 relevant facts by ID from the catalogue below, in a useful order highlighting concrete dimension observations. Prefer dimension_interaction, dimension_interruptions, dimension_resources, dimension_presentation, dimension_depth, dimension_conversation and response_scope when relevant. Structural syntax does not establish depth, usefulness or adaptation. Your selection is a model interpretation of relevance, not an independent verification. Do not attach current policy to older responses.\nRules:\n- Reply with JSON only: {"fact_ids": [...]} (1 to 6 unique known catalogue IDs, no free text).\n- No causal or savings inference. Do not infer personal state or model obedience.\n- Unknown is not zero; do not claim provider execution or model compliance from request correlation.\n- Only locally validated catalogue sentences will be displayed; model prose is never displayed.';

export function observerPrompt(evidence) {
  const catalogue = allowlistedFacts(evidence);
  return `${OBSERVER_INSTRUCTIONS}\n\nCatalogue:\n${JSON.stringify(catalogue, null, 2)}\n\nSelection schema:\n${JSON.stringify({ fact_ids: catalogue.map((f) => f.id) }, null, 2)}`;
}

export function validateObserverSelection(value, evidence) {
  if (!isRecord(value)) invalidSelection();
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'fact_ids') invalidSelection();
  const ids = value.fact_ids;
  if (!Array.isArray(ids)) invalidSelection();
  if (ids.length < 1 || ids.length > 6) invalidSelection();
  const catalogue = allowlistedFacts(evidence);
  const byId = new Map();
  for (let i = 0; i < catalogue.length; i++) byId.set(catalogue[i].id, catalogue[i].text);
  const seen = new Set();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== 'string') invalidSelection();
    if (!byId.has(id)) invalidSelection();
    if (seen.has(id)) invalidSelection();
    seen.add(id);
  }
  let required = catalogues.get(evidence)?.required_fact_ids.slice() ?? [];
  if (byId.has('benefit_unverified') && !required.includes('benefit_unverified')) {
    required = ['benefit_unverified', ...required];
  }
  const fact_ids = [...ids.filter(id=>!required.includes(id)).slice(0,6-required.length),...required];
  const sentences = fact_ids.map((id) => byId.get(id));
  return { fact_ids, sentences };
}
