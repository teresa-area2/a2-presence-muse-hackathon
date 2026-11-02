import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCI, buildCIFeedback } from '../src/coding-ci-report.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = '0123456789abcdef'.repeat(4);
const UNAVAILABLE = { schema_version: 1, state: 'unavailable', reason: 'ci_result_unavailable', exit_code: null, public_tests: null, frozen_tests: null, cases: [], artifact_sha256: null, trusted_plan_hash: null };

function stream(cases, override = {}) {
  const pass = cases.filter((c) => c.ok).length;
  const agg = { tests: cases.length, pass, fail: cases.length - pass, skipped: 0, cancelled: 0, todo: 0, ...override };
  const lines = ['TAP version 13'];
  cases.forEach((c, i) => lines.push(`${c.ok ? 'ok' : 'not ok'} ${i + 1} - ${c.name}`));
  lines.push(`1..${agg.tests}`);
  lines.push(`# tests ${agg.tests}`);
  lines.push(`# pass ${agg.pass}`);
  lines.push(`# fail ${agg.fail}`);
  lines.push(`# skipped ${agg.skipped}`);
  lines.push(`# cancelled ${agg.cancelled}`);
  lines.push(`# todo ${agg.todo}`);
  lines.push('# duration_ms 12.5');
  return lines.join('\n') + '\n';
}
function resultFor(stdout, state, exit_code) {
  return { state, exit_code, stdout, artifact_sha256: HASH_A, trusted_plan_hash: HASH_B };
}
const TRUSTED = ['second trusted case', 'first trusted case'];
const FROZEN_TAP_ORDER = [{ name: 'first trusted case', ok: true }, { name: 'second trusted case', ok: true }];
const PUBLIC_PASS = [{ name: 'public alpha works', ok: true }, { name: 'public beta works', ok: true }];
function validPassStdout() { return stream(PUBLIC_PASS) + stream(FROZEN_TAP_ORDER); }

test('valid pass: aggregates, hashes, trusted-order cases', () => {
  const s = summarizeCI(resultFor(validPassStdout(), 'passed', 0), TRUSTED);
  assert.equal(s.schema_version, 1);
  assert.equal(s.state, 'passed');
  assert.equal(s.exit_code, 0);
  assert.deepEqual(s.public_tests, { tests: 2, pass: 2, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
  assert.deepEqual(s.frozen_tests, { tests: 2, pass: 2, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
  assert.deepEqual(s.cases, [{ name: 'second trusted case', result: 'passed' }, { name: 'first trusted case', result: 'passed' }]);
  assert.equal(s.artifact_sha256, HASH_A);
  assert.equal(s.trusted_plan_hash, HASH_B);
  assert.deepEqual(Object.keys(s).sort(), ['artifact_sha256', 'cases', 'exit_code', 'frozen_tests', 'public_tests', 'schema_version', 'state', 'trusted_plan_hash']);
});

test('valid fail: frozen failure is reported, public passes', () => {
  const stdout = stream(PUBLIC_PASS) + stream([{ name: 'first trusted case', ok: true }, { name: 'second trusted case', ok: false }]);
  const s = summarizeCI(resultFor(stdout, 'failed', 1), TRUSTED);
  assert.equal(s.state, 'failed');
  assert.equal(s.exit_code, 1);
  assert.deepEqual(s.frozen_tests, { tests: 2, pass: 1, fail: 1, skipped: 0, cancelled: 0, todo: 0 });
  assert.deepEqual(s.cases, [{ name: 'second trusted case', result: 'failed' }, { name: 'first trusted case', result: 'passed' }]);
});

test('CRLF streams are accepted', () => {
  const stdout = validPassStdout().replaceAll('\n', '\r\n');
  const s = summarizeCI(resultFor(stdout, 'passed', 0), TRUSTED);
  assert.equal(s.state, 'passed');
  assert.equal(s.frozen_tests.tests, 2);
});

test('incorrect hashes are unavailable', () => {
  for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), '', null, 42]) {
    assert.deepEqual(summarizeCI({ ...resultFor(validPassStdout(), 'passed', 0), artifact_sha256: bad }, TRUSTED), UNAVAILABLE);
    assert.deepEqual(summarizeCI({ ...resultFor(validPassStdout(), 'passed', 0), trusted_plan_hash: bad }, TRUSTED), UNAVAILABLE);
  }
});

test('duplicate and missing aggregates are unavailable', () => {
  const dup = validPassStdout().replace('# pass 2\n', '# pass 2\n# pass 2\n');
  assert.deepEqual(summarizeCI(resultFor(dup, 'passed', 0), TRUSTED), UNAVAILABLE);
  const missing = validPassStdout().replace('# todo 0\n', '');
  assert.deepEqual(summarizeCI(resultFor(missing, 'passed', 0), TRUSTED), UNAVAILABLE);
  const malformed = validPassStdout().replace('# tests 2', '# tests two');
  assert.deepEqual(summarizeCI(resultFor(malformed, 'passed', 0), TRUSTED), UNAVAILABLE);
});

test('zero, skipped, cancelled and todo counts are unavailable', () => {
  const zero = stream([], { tests: 0, pass: 0, fail: 0 }) + stream(FROZEN_TAP_ORDER);
  assert.deepEqual(summarizeCI(resultFor(zero, 'passed', 0), TRUSTED), UNAVAILABLE);
  for (const key of ['skipped', 'cancelled', 'todo']) {
    const stdout = stream(PUBLIC_PASS, { [key]: 1 }) + stream(FROZEN_TAP_ORDER);
    assert.deepEqual(summarizeCI(resultFor(stdout, 'passed', 0), TRUSTED), UNAVAILABLE);
  }
  const huge = stream(PUBLIC_PASS, { tests: 4097, pass: 4097 }) + stream(FROZEN_TAP_ORDER);
  assert.deepEqual(summarizeCI(resultFor(huge, 'passed', 0), TRUSTED), UNAVAILABLE);
});

test('unknown, duplicate and missing frozen cases and bad ordinals are unavailable', () => {
  const unknown = stream(PUBLIC_PASS) + stream([{ name: 'first trusted case', ok: true }, { name: 'attacker case', ok: true }]);
  assert.deepEqual(summarizeCI(resultFor(unknown, 'passed', 0), TRUSTED), UNAVAILABLE);
  const dupName = stream(PUBLIC_PASS) + stream([{ name: 'first trusted case', ok: true }, { name: 'first trusted case', ok: true }]);
  assert.deepEqual(summarizeCI(resultFor(dupName, 'passed', 0), TRUSTED), UNAVAILABLE);
  const missingCase = stream(PUBLIC_PASS) + stream([{ name: 'first trusted case', ok: true }]);
  assert.deepEqual(summarizeCI(resultFor(missingCase, 'passed', 0), TRUSTED), UNAVAILABLE);
  const dupOrdinal = (stream(PUBLIC_PASS) + stream(FROZEN_TAP_ORDER)).replace('ok 2 - second trusted case', 'ok 1 - second trusted case');
  assert.deepEqual(summarizeCI(resultFor(dupOrdinal, 'passed', 0), TRUSTED), UNAVAILABLE);
  const zeroOrdinal = (stream(PUBLIC_PASS) + stream(FROZEN_TAP_ORDER)).replace('ok 1 - first trusted case', 'ok 0 - first trusted case');
  assert.deepEqual(summarizeCI(resultFor(zeroOrdinal, 'passed', 0), TRUSTED), UNAVAILABLE);
  const substringSpoof = stream(PUBLIC_PASS) + stream([{ name: 'first trusted case extra', ok: true }, { name: 'second trusted case', ok: true }]);
  assert.deepEqual(summarizeCI(resultFor(substringSpoof, 'passed', 0), TRUSTED), UNAVAILABLE);
});

test('nested frozen structures are not counted as flat passes', () => {
  const nestedFrozen = ['TAP version 13', '# Subtest: outer wrapper', '    ok 1 - first trusted case', '    ok 2 - second trusted case', '    1..2', 'ok 1 - outer wrapper', '1..1', '# tests 2', '# pass 2', '# fail 0', '# skipped 0', '# cancelled 0', '# todo 0', ''].join('\n');
  assert.deepEqual(summarizeCI(resultFor(stream(PUBLIC_PASS) + nestedFrozen, 'passed', 0), TRUSTED), UNAVAILABLE);
});

test('inconsistent totals and state/exit disagreement are unavailable', () => {
  const badTotal = stream(PUBLIC_PASS, { tests: 3 }) + stream(FROZEN_TAP_ORDER);
  assert.deepEqual(summarizeCI(resultFor(badTotal, 'passed', 0), TRUSTED), UNAVAILABLE);
  assert.deepEqual(summarizeCI(resultFor(validPassStdout(), 'passed', 1), TRUSTED), UNAVAILABLE);
  assert.deepEqual(summarizeCI(resultFor(validPassStdout(), 'failed', 1), TRUSTED), UNAVAILABLE);
  const failStdout = stream(PUBLIC_PASS) + stream([{ name: 'first trusted case', ok: false }, { name: 'second trusted case', ok: true }]);
  assert.deepEqual(summarizeCI(resultFor(failStdout, 'passed', 0), TRUSTED), UNAVAILABLE);
});

test('setup failure and malformed inputs never throw and are unavailable', () => {
  assert.deepEqual(summarizeCI({ state: 'failed', exit_code: 1, stdout: 'sandbox setup failed', artifact_sha256: HASH_A, trusted_plan_hash: HASH_B }, TRUSTED), UNAVAILABLE);
  for (const bad of [null, undefined, 42, 'x', [], {}, { state: 'passed' }]) {
    assert.deepEqual(summarizeCI(bad, TRUSTED), UNAVAILABLE);
  }
  assert.deepEqual(summarizeCI(resultFor(validPassStdout(), 'passed', 0), null), UNAVAILABLE);
});

test('partial stream and appended arbitrary output are unavailable', () => {
  assert.deepEqual(summarizeCI(resultFor(stream(PUBLIC_PASS), 'passed', 0), TRUSTED), UNAVAILABLE);
  assert.deepEqual(summarizeCI(resultFor(validPassStdout() + 'injected output\n', 'passed', 0), TRUSTED), UNAVAILABLE);
  assert.deepEqual(summarizeCI(resultFor(validPassStdout() + 'ok 99 - first trusted case\n', 'passed', 0), TRUSTED), UNAVAILABLE);
});

test('oversized stdout is unavailable', () => {
  const big = 'x'.repeat(1048577);
  assert.deepEqual(summarizeCI(resultFor(big, 'failed', 1), TRUSTED), UNAVAILABLE);
});

test('invalid trusted names are unavailable', () => {
  const badLists = [[], ['a', 'a'], ['a\nb'], ['a\0b'], ['a\u001fb'], [''], ['x'.repeat(241)], Array.from({ length: 129 }, (_, i) => 'case ' + i), 'not-array', [42]];
  for (const bad of badLists) {
    assert.deepEqual(summarizeCI(resultFor(validPassStdout(), 'passed', 0), bad), UNAVAILABLE);
  }
});

test('secret-looking diagnostics and public names never leak', () => {
  const secret = 'SECRET_DIAGNOSTIC_9f3abc';
  const publicWithDiag = ['TAP version 13', 'not ok 1 - public secret-bearing check', '  ---', `  error: '${secret}'`, '  ...', '1..1', '# tests 1', '# pass 0', '# fail 1', '# skipped 0', '# cancelled 0', '# todo 0', '# duration_ms 3', ''].join('\n');
  const stdout = publicWithDiag + stream(FROZEN_TAP_ORDER);
  const s = summarizeCI(resultFor(stdout, 'failed', 1), TRUSTED);
  assert.equal(s.state, 'failed');
  assert.ok(!JSON.stringify(s).includes(secret));
  assert.ok(!JSON.stringify(s).includes('public secret-bearing check'));
  const fb = buildCIFeedback(s);
  assert.ok(!fb.includes(secret));
  assert.ok(!fb.includes('public secret-bearing check'));
});

test('formatter: passed summary is bounded, has hashes, lists no case names', () => {
  const s = summarizeCI(resultFor(validPassStdout(), 'passed', 0), TRUSTED);
  const fb = buildCIFeedback(s);
  assert.ok(fb.includes('Public tests: 2 tests'));
  assert.ok(fb.includes('Frozen trusted tests: 2 tests'));
  assert.ok(fb.includes(HASH_A));
  assert.ok(fb.includes(HASH_B));
  assert.ok(!fb.includes('first trusted case'));
  assert.ok(!fb.includes('second trusted case'));
  assert.ok(new TextEncoder().encode(fb).length <= 8192);
  assert.match(fb, /public contract/);
  assert.match(fb, /Rerun the public tests/);
  assert.match(fb, /do not claim new frozen results without a new independent check/i);
});

test('formatter: failed summary lists only failed frozen cases', () => {
  const manyTrusted = Array.from({ length: 20 }, (_, i) => `trusted case ${i}`);
  const frozenCases = manyTrusted.map((name, i) => ({ name, ok: i !== 7 }));
  const s = summarizeCI(resultFor(stream(PUBLIC_PASS) + stream(frozenCases), 'failed', 1), manyTrusted);
  assert.equal(s.state, 'failed');
  const fb = buildCIFeedback(s);
  assert.ok(fb.includes('trusted case 7'));
  assert.ok(!fb.includes('trusted case 0'));
  assert.ok(!fb.includes('trusted case 19'));
  assert.ok(new TextEncoder().encode(fb).length <= 8192);
  assert.match(fb, /fix the actual failures/i);
  assert.match(fb, /regression tests/);
  assert.match(fb, /preserving the API and public contract/);
});

test('formatter: rejects unavailable, extra fields and invalid summaries without leaking', () => {
  const s = summarizeCI(resultFor(validPassStdout(), 'passed', 0), TRUSTED);
  assert.throws(() => buildCIFeedback(UNAVAILABLE), { message: 'ci_feedback_unavailable' });
  assert.throws(() => buildCIFeedback(null), { message: 'ci_feedback_unavailable' });
  assert.throws(() => buildCIFeedback({ ...s, diagnostics: 'SECRET_X' }), (err) => err.message === 'ci_feedback_unavailable' && !err.message.includes('SECRET_X'));
  assert.throws(() => buildCIFeedback({ ...s, public_tests: { ...s.public_tests, pass: 99 } }), { message: 'ci_feedback_unavailable' });
  assert.throws(() => buildCIFeedback({ ...s, artifact_sha256: 'Z'.repeat(64) }), { message: 'ci_feedback_unavailable' });
  assert.throws(() => buildCIFeedback({ ...s, state: 'failed', exit_code: 1 }), { message: 'ci_feedback_unavailable' });
  assert.throws(() => buildCIFeedback({ ...s, cases: [{ name: 'first trusted case', result: 'failed' }, { name: 'second trusted case', result: 'passed' }] }), { message: 'ci_feedback_unavailable' });
  const { trusted_plan_hash, ...missingHash } = s;
  assert.throws(() => buildCIFeedback(missingHash), { message: 'ci_feedback_unavailable' });
});

test('real Node TAP: flat frozen diagnostics and nested public suites retain correct pass/fail counts', async t => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const {execFileSync} = await import('node:child_process');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ci-report-real-tap-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const publicFile = path.join(dir,'public.test.mjs'), frozenFile = path.join(dir,'frozen.test.mjs');
  await fs.writeFile(publicFile,"import{describe,it}from'node:test';describe('public suite',()=>{it('one',()=>{});it('two',()=>{});});\n");
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const publicTap = execFileSync(process.execPath,['--test',publicFile],{encoding:'utf8',env});
  for (const shouldFail of [false,true]) {
    await fs.writeFile(frozenFile,"import test from'node:test';test('frozen one',()=>{});test('frozen two',()=>{"+(shouldFail?"throw Error('SECRET_DIAGNOSTIC_TOKEN');":"")+"});\n");
    let frozenTap;
    try {frozenTap=execFileSync(process.execPath,['--test',frozenFile],{encoding:'utf8',env,stdio:['ignore','pipe','pipe']});}
    catch (error) {assert.equal(error.status,1);frozenTap=error.stdout;}
    const summary=summarizeCI(resultFor(publicTap+frozenTap,shouldFail?'failed':'passed',shouldFail?1:0),['frozen one','frozen two']);
    assert.equal(summary.state,shouldFail?'failed':'passed');
    assert.equal(summary.public_tests.tests,2);
    assert.equal(summary.frozen_tests.fail,shouldFail?1:0);
    const feedback=buildCIFeedback(summary);
    assert.ok(!feedback.includes(dir));assert.ok(!feedback.includes('SECRET_DIAGNOSTIC_TOKEN'));
  }
});

test('both exact Node TAP version13 headers are required', () => {
  for (const body of [validPassStdout().replace('TAP version 13\n',''),validPassStdout().replaceAll('TAP version 13','TAP version 12')]) {
    assert.deepEqual(summarizeCI(resultFor(body,'passed',0),TRUSTED),UNAVAILABLE);
  }
});

test('public case outcomes cannot contradict public aggregate success', () => {
  const contradictory=validPassStdout().replace('ok 1 - public alpha works','not ok 1 - public alpha works');
  assert.deepEqual(summarizeCI(resultFor(contradictory,'passed',0),TRUSTED),UNAVAILABLE);
});
