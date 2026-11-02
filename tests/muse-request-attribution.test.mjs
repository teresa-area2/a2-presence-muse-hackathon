import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attributeMuseRequests } from '../src/muse-request-attribution.mjs';

const OBS = 1700000000000;
const EARLY = '2023-11-14T22:13:19.000Z';
const FUTURE = '2023-11-14T22:13:21.000Z';

const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';
const ID_C = '33333333-3333-3333-3333-333333333333';
const ID_D = '44444444-4444-4444-4444-444444444444';
const ID_E = '55555555-5555-5555-5555-555555555555';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_SAME = 'c'.repeat(64);

const CONTROLS_A = { response_extent: 'terse', unsolicited_update: 'send', conversation_style: 'conversational' };
const CONTROLS_B = { response_extent: 'full', unsolicited_update: 'defer', conversation_style: 'self_contained' };

describe('muse request attribution', () => {
  it('matches A->B->fallback out of order by exact ID', () => {
    const requests = [
      { read_id: ID_A, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: ID_B, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_B], fallback: false },
      { read_id: ID_C, prompt_match: true, observed_at: OBS, guidance_hashes: [], fallback: true },
    ];
    const hooks = [
      { read_id: ID_C, eligible: false, digest: null, controls: null, read_at: EARLY, reading_id: 'r-c', receipt_age_seconds: 5 },
      { read_id: ID_B, eligible: true, digest: DIGEST_B, controls: { ...CONTROLS_B }, read_at: EARLY, reading_id: 'read-b-1', receipt_age_seconds: 7 },
      { read_id: ID_A, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'read-a-1', receipt_age_seconds: 3 },
    ];
    assert.deepStrictEqual(attributeMuseRequests(requests, hooks), [
      { ordinal: 1, status: 'guidance_observed', read_id: ID_A, reading_id: 'read-a-1', controls: { ...CONTROLS_A }, receipt_age_seconds: 3 },
      { ordinal: 2, status: 'guidance_observed', read_id: ID_B, reading_id: 'read-b-1', controls: { ...CONTROLS_B }, receipt_age_seconds: 7 },
      { ordinal: 3, status: 'fallback_observed', read_id: ID_C, reading_id: null, controls: null, receipt_age_seconds: null },
    ]);
  });

  it('same digest across different IDs still distinguishes', () => {
    const requests = [
      { read_id: ID_D, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_SAME], fallback: false },
      { read_id: ID_E, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_SAME], fallback: false },
    ];
    const hooks = [
      { read_id: ID_D, eligible: true, digest: DIGEST_SAME, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'same-1', receipt_age_seconds: 1 },
      { read_id: ID_E, eligible: true, digest: DIGEST_SAME, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'same-2', receipt_age_seconds: 2 },
    ];
    assert.deepStrictEqual(attributeMuseRequests(requests, hooks), [
      { ordinal: 1, status: 'guidance_observed', read_id: ID_D, reading_id: 'same-1', controls: { ...CONTROLS_A }, receipt_age_seconds: 1 },
      { ordinal: 2, status: 'guidance_observed', read_id: ID_E, reading_id: 'same-2', controls: { ...CONTROLS_A }, receipt_age_seconds: 2 },
    ]);
  });

  it('duplicate request IDs are ambiguous', () => {
    const requests = [
      { read_id: ID_A, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: ID_A, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
    ];
    const hooks = [
      { read_id: ID_A, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'dup', receipt_age_seconds: 1 },
    ];
    assert.deepStrictEqual(attributeMuseRequests(requests, hooks), [
      { ordinal: 1, status: 'ambiguous', read_id: ID_A, reading_id: null, controls: null, receipt_age_seconds: null },
      { ordinal: 2, status: 'ambiguous', read_id: ID_A, reading_id: null, controls: null, receipt_age_seconds: null },
    ]);
  });

  it('duplicate hook IDs are ambiguous', () => {
    const requests = [
      { read_id: ID_A, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
    ];
    const hooks = [
      { read_id: ID_A, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'h1', receipt_age_seconds: 1 },
      { read_id: ID_A, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'h2', receipt_age_seconds: 2 },
    ];
    assert.deepStrictEqual(attributeMuseRequests(requests, hooks), [
      { ordinal: 1, status: 'ambiguous', read_id: ID_A, reading_id: null, controls: null, receipt_age_seconds: null },
    ]);
  });

  it('missing and malformed IDs are request_observed and cannot match', () => {
    const requests = [
      { read_id: null, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: 'not-a-uuid', prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { prompt_match: true, observed_at: OBS, guidance_hashes: [], fallback: true },
      { read_id: 123, prompt_match: true, observed_at: OBS, guidance_hashes: [], fallback: true },
    ];
    const hooks = [
      { read_id: 'not-a-uuid', eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'x', receipt_age_seconds: 1 },
      { read_id: null, eligible: false, digest: null, controls: null, read_at: EARLY, reading_id: 'y', receipt_age_seconds: 1 },
    ];
    assert.deepStrictEqual(attributeMuseRequests(requests, hooks), [
      { ordinal: 1, status: 'request_observed', read_id: null, reading_id: null, controls: null, receipt_age_seconds: null },
      { ordinal: 2, status: 'request_observed', read_id: null, reading_id: null, controls: null, receipt_age_seconds: null },
      { ordinal: 3, status: 'request_observed', read_id: null, reading_id: null, controls: null, receipt_age_seconds: null },
      { ordinal: 4, status: 'request_observed', read_id: null, reading_id: null, controls: null, receipt_age_seconds: null },
      { ordinal: 5, status: 'request_observed', read_id: null, reading_id: null, controls: null, receipt_age_seconds: null },
    ]);
  });

  it('bad prompt, clock, controls, digest, reading, and mixed fallback are unverified', () => {
    const f1 = '66666666-6666-6666-6666-666666666666';
    const f2 = '77777777-7777-7777-7777-777777777777';
    const f3 = '88888888-8888-8888-8888-888888888888';
    const f4 = '99999999-9999-9999-9999-999999999999';
    const f5 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const f6 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const f7 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const f8 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const badDigest = 'A'.repeat(64);
    const requests = [
      { read_id: f1, prompt_match: false, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: f2, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: f3, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: f4, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: f5, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: f6, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: f7, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: true },
      { read_id: f8, prompt_match: true, observed_at: OBS, guidance_hashes: [], fallback: true },
    ];
    const hooks = [
      { read_id: f1, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'ok-1', receipt_age_seconds: 1 },
      { read_id: f2, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: FUTURE, reading_id: 'ok-2', receipt_age_seconds: 1 },
      { read_id: f3, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: 'not-a-date', reading_id: 'ok-3', receipt_age_seconds: 1 },
      { read_id: f4, eligible: true, digest: DIGEST_A, controls: { response_extent: 'huge', unsolicited_update: 'send', conversation_style: 'conversational' }, read_at: EARLY, reading_id: 'ok-4', receipt_age_seconds: 1 },
      { read_id: f5, eligible: true, digest: badDigest, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'ok-5', receipt_age_seconds: 1 },
      { read_id: f6, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: null, receipt_age_seconds: 1 },
      { read_id: f7, eligible: false, digest: null, controls: null, read_at: EARLY, reading_id: 'ok-7', receipt_age_seconds: 1 },
      { read_id: f8, eligible: false, digest: DIGEST_A, controls: null, read_at: EARLY, reading_id: 'ok-8', receipt_age_seconds: 1 },
    ];
    assert.deepStrictEqual(attributeMuseRequests(requests, hooks), [f1, f2, f3, f4, f5, f6, f7, f8].map((read_id, i) => ({
      ordinal: i + 1, status: 'unverified', read_id, reading_id: null, controls: null, receipt_age_seconds: null,
    })));
  });

  it('omits unknown sentinel fields and detaches controls', () => {
    const hookControls = { response_extent: 'terse', unsolicited_update: 'send', conversation_style: 'conversational', PRIVATE: 'hook-secret', raw: 'x' };
    const requests = [
      { read_id: ID_A, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false, text: 'raw', capsule: { id: 1 }, credentials: 's', PRIVATE: 'req-secret' },
    ];
    const hooks = [
      { read_id: ID_A, eligible: true, digest: DIGEST_A, controls: hookControls, read_at: EARLY, reading_id: 'safe_1-abc', receipt_age_seconds: 4, text: 'raw', credentials: 'c', PRIVATE: 'h-secret' },
    ];
    const rows = attributeMuseRequests(requests, hooks);
    assert.deepStrictEqual(rows, [
      { ordinal: 1, status: 'guidance_observed', read_id: ID_A, reading_id: 'safe_1-abc', controls: { ...CONTROLS_A }, receipt_age_seconds: 4 },
    ]);
    assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['controls', 'ordinal', 'read_id', 'reading_id', 'receipt_age_seconds', 'status']);
    assert.deepStrictEqual(Object.keys(rows[0].controls).sort(), ['conversation_style', 'response_extent', 'unsolicited_update']);
    assert.notStrictEqual(rows[0].controls, hookControls);
    rows[0].controls.response_extent = 'full';
    assert.strictEqual(hookControls.response_extent, 'terse');
  });

  it('copies receipt age only when finite and nonnegative', () => {
    const g1 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const g2 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const g3 = 'abababab-abab-abab-abab-abababababab';
    const g4 = 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd';
    const requests = [
      { read_id: g1, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: g2, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: g3, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
      { read_id: g4, prompt_match: true, observed_at: OBS, guidance_hashes: [DIGEST_A], fallback: false },
    ];
    const hooks = [
      { read_id: g1, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'age-1', receipt_age_seconds: undefined },
      { read_id: g2, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'age-2', receipt_age_seconds: -2 },
      { read_id: g3, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'age-3', receipt_age_seconds: Infinity },
      { read_id: g4, eligible: true, digest: DIGEST_A, controls: { ...CONTROLS_A }, read_at: EARLY, reading_id: 'age-4', receipt_age_seconds: 0 },
    ];
    assert.deepStrictEqual(attributeMuseRequests(requests, hooks), [
      { ordinal: 1, status: 'guidance_observed', read_id: g1, reading_id: 'age-1', controls: { ...CONTROLS_A }, receipt_age_seconds: null },
      { ordinal: 2, status: 'guidance_observed', read_id: g2, reading_id: 'age-2', controls: { ...CONTROLS_A }, receipt_age_seconds: null },
      { ordinal: 3, status: 'guidance_observed', read_id: g3, reading_id: 'age-3', controls: { ...CONTROLS_A }, receipt_age_seconds: null },
      { ordinal: 4, status: 'guidance_observed', read_id: g4, reading_id: 'age-4', controls: { ...CONTROLS_A }, receipt_age_seconds: 0 },
    ]);
  });

  it('handles empty arrays and rejects invalid inputs', () => {
    assert.deepStrictEqual(attributeMuseRequests([], []), []);
    assert.throws(() => attributeMuseRequests(null, []), /request_attribution_invalid/);
    assert.throws(() => attributeMuseRequests([], null), /request_attribution_invalid/);
    assert.throws(() => attributeMuseRequests('x', []), /request_attribution_invalid/);
    assert.throws(() => attributeMuseRequests([], {}), /request_attribution_invalid/);
    const bigRequests = Array.from({ length: 65 }, () => ({ read_id: null }));
    assert.throws(() => attributeMuseRequests(bigRequests, []), /request_attribution_invalid/);
    const bigHooks = Array.from({ length: 65 }, () => ({ read_id: ID_A }));
    assert.throws(() => attributeMuseRequests([], bigHooks), /request_attribution_invalid/);
  });

  it('does not qualify a request carrying both guidance and fallback', () => {
    const request={read_id:ID_A,prompt_match:true,observed_at:OBS,guidance_hashes:[DIGEST_A],fallback:true};
    const hook={read_id:ID_A,eligible:true,digest:DIGEST_A,controls:CONTROLS_A,reading_id:'reading-a',read_at:EARLY};
    assert.equal(attributeMuseRequests([request],[hook])[0].status,'unverified');
  });
});
