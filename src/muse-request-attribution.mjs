const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const READING_RE = /^[A-Za-z0-9_.:-]{1,160}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

const EXTENTS = new Set(['terse', 'standard', 'full']);
const UPDATES = new Set(['send', 'defer']);
const STYLES = new Set(['conversational', 'self_contained']);

function isValidId(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function copyControls(c) {
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return null;
  const { response_extent, unsolicited_update, conversation_style } = c;
  if (!EXTENTS.has(response_extent)) return null;
  if (!UPDATES.has(unsolicited_update)) return null;
  if (!STYLES.has(conversation_style)) return null;
  return { response_extent, unsolicited_update, conversation_style };
}

function copyAge(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

// IDs are local correlation markers, not proof of provider execution,
// model compliance, or causal benefit.
export function attributeMuseRequests(requests, hooks) {
  if (!Array.isArray(requests) || !Array.isArray(hooks)) {
    throw new Error('request_attribution_invalid');
  }
  if (requests.length > 64 || hooks.length > 64) {
    throw new Error('request_attribution_invalid');
  }

  const validIds = requests.map((r) => {
    const v = r !== null && typeof r === 'object' ? r.read_id : undefined;
    return isValidId(v) ? v : null;
  });

  const reqCounts = new Map();
  for (const id of validIds) {
    if (id !== null) reqCounts.set(id, (reqCounts.get(id) ?? 0) + 1);
  }
  const hookCounts = new Map();
  for (const h of hooks) {
    const v = h !== null && typeof h === 'object' ? h.read_id : undefined;
    if (typeof v === 'string') hookCounts.set(v, (hookCounts.get(v) ?? 0) + 1);
  }

  const rows = [];
  for (let i = 0; i < requests.length; i++) {
    const ordinal = i + 1;
    const req = requests[i] !== null && typeof requests[i] === 'object' ? requests[i] : {};
    const id = validIds[i];
    if (id === null) {
      rows.push({ ordinal, status: 'request_observed', read_id: null, reading_id: null, controls: null, receipt_age_seconds: null });
      continue;
    }
    if ((reqCounts.get(id) ?? 0) > 1 || (hookCounts.get(id) ?? 0) > 1) {
      rows.push({ ordinal, status: 'ambiguous', read_id: id, reading_id: null, controls: null, receipt_age_seconds: null });
      continue;
    }
    const hook = hooks.find((h) => h !== null && typeof h === 'object' && h.read_id === id);
    if (!hook) {
      rows.push({ ordinal, status: 'unverified', read_id: id, reading_id: null, controls: null, receipt_age_seconds: null });
      continue;
    }
    const promptOk = req.prompt_match === true;
    const obs = req.observed_at;
    const obsOk = typeof obs === 'number' && Number.isFinite(obs) && obs >= 0;
    let clockOk = false;
    if (typeof hook.read_at === 'string') {
      const t = Date.parse(hook.read_at);
      if (Number.isFinite(t) && t >= 0 && obsOk && t <= obs) clockOk = true;
    }
    const eligibleOk = typeof hook.eligible === 'boolean';
    if (!promptOk || !obsOk || !clockOk || !eligibleOk) {
      rows.push({ ordinal, status: 'unverified', read_id: id, reading_id: null, controls: null, receipt_age_seconds: null });
      continue;
    }
    if (hook.eligible === true) {
      const controls = copyControls(hook.controls);
      const readingOk = typeof hook.reading_id === 'string' && READING_RE.test(hook.reading_id);
      const digestOk = typeof hook.digest === 'string' && HEX64_RE.test(hook.digest);
      const hashes = req.guidance_hashes;
      const hashOk = digestOk && Array.isArray(hashes) && hashes.includes(hook.digest);
      if (!controls || !readingOk || !hashOk || req.fallback === true) {
        rows.push({ ordinal, status: 'unverified', read_id: id, reading_id: null, controls: null, receipt_age_seconds: null });
        continue;
      }
      rows.push({ ordinal, status: 'guidance_observed', read_id: id, reading_id: hook.reading_id, controls, receipt_age_seconds: copyAge(hook.receipt_age_seconds) });
      continue;
    }
    if (hook.digest !== null) {
      rows.push({ ordinal, status: 'unverified', read_id: id, reading_id: null, controls: null, receipt_age_seconds: null });
      continue;
    }
    if (req.fallback !== true) {
      rows.push({ ordinal, status: 'unverified', read_id: id, reading_id: null, controls: null, receipt_age_seconds: null });
      continue;
    }
    if (!Array.isArray(req.guidance_hashes) || req.guidance_hashes.length !== 0) {
      rows.push({ ordinal, status: 'unverified', read_id: id, reading_id: null, controls: null, receipt_age_seconds: null });
      continue;
    }
    rows.push({ ordinal, status: 'fallback_observed', read_id: id, reading_id: null, controls: null, receipt_age_seconds: null });
  }
  return rows;
}
