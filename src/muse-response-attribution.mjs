// Conservative local correlation, not behavioral or causal evidence. Provider
// completion facts must originate from completed native response events; text is
// compared only as ephemeral digests. Exported rows contain no native IDs/digests.
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const TOKEN = /^[A-Za-z0-9_.:-]{1,160}$/;
const SHA = /^[a-f0-9]{64}$/;
const EMPTY_TEXT_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const isUuid = value => typeof value === 'string' && UUID.test(value);
const isToken = value => typeof value === 'string' && TOKEN.test(value);
const isSha = value => typeof value === 'string' && SHA.test(value);
const isTextSha = value => isSha(value) && value !== EMPTY_TEXT_SHA;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const countBy = (rows, key, valid) => {
  const counts = new Map();
  for (const row of rows) {const value = row?.[key];if (valid(value)) counts.set(value, (counts.get(value) ?? 0) + 1);}
  return counts;
};
const inScope = (row, sessionId, turnId) => record(row) && isUuid(row.session_id) && isUuid(row.turn_id) && row.session_id === sessionId && row.turn_id === turnId;
function attemptsMatch(pre, post) {
  for (const key of ['attempt', 'step']) {
    const before = pre[key], after = post[key];
    if (before === undefined && after === undefined) continue;
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 0) || after !== undefined && (!Number.isSafeInteger(after) || after < 0) || before !== undefined && after !== undefined && before !== after) return false;
  }
  return true;
}
function presenceKind(row) {
  if (row?.status === 'fallback_observed' && row.reading_id === null && row.controls === null) return 'fallback';
  const c = row?.controls;
  if (row?.status !== 'guidance_observed' || !isToken(row.reading_id) || !record(c)) return null;
  return ['terse','standard','full'].includes(c.response_extent) && ['send','defer'].includes(c.unsolicited_update) && ['self_contained','conversational'].includes(c.conversation_style) ? 'guidance' : null;
}

export function attributeMuseResponses({requestAttribution = [], preHooks = [], postHooks = [], responses = [], finals = [], sessionId, turnId} = {}) {
  if ([requestAttribution, preHooks, postHooks, responses, finals].some(rows => !Array.isArray(rows) || rows.length > 64)) throw Error('response_attribution_invalid');
  const requestReads = countBy(requestAttribution, 'read_id', isUuid), ordinals = countBy(requestAttribution, 'ordinal', x => Number.isSafeInteger(x) && x > 0 && x <= 64);
  const preReads = countBy(preHooks, 'read_id', isUuid), preRequests = countBy(preHooks, 'request_id', isToken);
  const postRequests = countBy(postHooks, 'request_id', isToken), postResponses = countBy(postHooks, 'response_id', isToken);
  const responseIds = countBy(responses, 'response_id', isToken), responseHashes = countBy(responses, 'public_text_sha256', isTextSha), finalHashes = countBy(finals, 'public_text_sha256', isTextSha);
  const linked = new Map();
  const scoped = isUuid(sessionId) && isUuid(turnId);
  const requests = requestAttribution.map((row, index) => {
    const ordinalValid = Number.isSafeInteger(row?.ordinal) && row.ordinal > 0 && row.ordinal <= 64;
    const result = {ordinal: ordinalValid ? row.ordinal : index + 1, status: 'unverified', presence: null};
    const kind = presenceKind(row);
    if (!scoped || !ordinalValid || !isUuid(row?.read_id) || !kind) return result;
    if (ordinals.get(row.ordinal) !== 1 || requestReads.get(row.read_id) !== 1 || (preReads.get(row.read_id) ?? 0) > 1) return {...result, status: 'ambiguous'};
    const pre = preHooks.find(x => x?.read_id === row.read_id);
    if (!inScope(pre, sessionId, turnId) || !isToken(pre.request_id)) return result;
    if (preRequests.get(pre.request_id) !== 1 || (postRequests.get(pre.request_id) ?? 0) > 1) return {...result, status: 'ambiguous'};
    const post = postHooks.find(x => x?.request_id === pre.request_id);
    if (!inScope(post, sessionId, turnId) || !isToken(post.response_id)) return result;
    if (postResponses.get(post.response_id) !== 1 || (responseIds.get(post.response_id) ?? 0) > 1) return {...result, status: 'ambiguous'};
    if (post.provider_status !== 'successful' || !attemptsMatch(pre, post)) return result;
    const response = responses.find(x => x?.response_id === post.response_id);
    if (!record(response) || !(response.public_text_sha256 === null || isSha(response.public_text_sha256))) return result;
    linked.set(post.response_id, {ordinal: row.ordinal, presence: kind});
    return {...result, status: 'response_linked', presence: kind};
  });
  const publicFinals = finals.map((row, index) => {
    const result = {ordinal: index + 1, status: 'unverified', request_ordinal: null, presence: null};
    const hash = row?.public_text_sha256;
    if (!scoped || !record(row) || row.truncated !== false || !isTextSha(hash)) return result;
    if (finalHashes.get(hash) !== 1 || (responseHashes.get(hash) ?? 0) > 1) return {...result, status: 'ambiguous'};
    const response = responses.find(x => x?.public_text_sha256 === hash);
    if (!response || !isToken(response.response_id)) return result;
    if (responseIds.get(response.response_id) !== 1 || (postResponses.get(response.response_id) ?? 0) > 1) return {...result, status: 'ambiguous'};
    const association = linked.get(response.response_id);
    if (!association) return result;
    return {...result, status: 'final_linked', request_ordinal: association.ordinal, presence: association.presence};
  });
  const linkedResponses = requests.filter(row => row.status === 'response_linked').length;
  const linkedFinals = publicFinals.filter(row => row.status === 'final_linked').length;
  const ambiguous = [...requests, ...publicFinals].some(row => row.status === 'ambiguous');
  const complete = requests.length > 0 && publicFinals.length > 0 && linkedResponses === requests.length && linkedFinals === publicFinals.length;
  return {status: ambiguous ? 'ambiguous' : complete ? 'linked' : linkedResponses || linkedFinals ? 'partial' : 'unverified', linked_responses: linkedResponses, linked_finals: linkedFinals, requests, finals: publicFinals};
}
