export const DEFAULT_COMPARISON_MODEL = 'muse-spark-1.3';

export const COMPARISON_MODELS = Object.freeze([
  Object.freeze({ id: 'muse-spark-1.3', label: 'Spark 1.3' }),
  Object.freeze({ id: 'muse-wonder-1.0', label: 'Wonder 1.0' }),
]);

const KNOWN_MODEL_IDS = new Set(COMPARISON_MODELS.map((model) => model.id));
const MAX_OBSERVATIONS = 8192;

export function requireComparisonModel(value = DEFAULT_COMPARISON_MODEL) {
  if (typeof value !== 'string' || !KNOWN_MODEL_IDS.has(value)) {
    throw new Error('comparison_model_invalid');
  }
  return value;
}

export function modelEvidence(requested, observations = []) {
  const requested_model = requireComparisonModel(requested);

  if (!Array.isArray(observations) || observations.length > MAX_OBSERVATIONS) {
    throw new Error('comparison_model_evidence_invalid');
  }

  const observed_models = [];
  const seen = new Set();
  let unidentified_requests = 0;
  let hasMismatch = false;

  for (const observation of observations) {
    if (typeof observation === 'string' && KNOWN_MODEL_IDS.has(observation)) {
      if (!seen.has(observation)) {
        seen.add(observation);
        observed_models.push(observation);
      }
      if (observation !== requested_model) hasMismatch = true;
    } else {
      unidentified_requests += 1;
    }
  }

  const status =
    observations.length === 0
      ? 'not_observed'
      : hasMismatch
        ? 'mismatch'
        : unidentified_requests > 0
          ? 'partial'
          : 'observed';

  return {
    requested_model,
    observed_models,
    requests_observed: observations.length,
    unidentified_requests,
    status,
  };
}
