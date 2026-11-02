const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;
const LINE_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const HASH_RE = /^[0-9a-f]{64}$/;
const AGG_KEYS = ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'];
const MAX_STDOUT_BYTES = 1048576;
const MAX_COUNT = 4096;

function unavailable() {
  return { schema_version: 1, state: 'unavailable', reason: 'ci_result_unavailable', exit_code: null, public_tests: null, frozen_tests: null, cases: [], artifact_sha256: null, trusted_plan_hash: null };
}
function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function byteLength(s) { return new TextEncoder().encode(s).length; }
function canonicalNum(s) {
  if (!/^(0|[1-9]\d*)$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
function validTrustedNames(names) {
  if (!Array.isArray(names) || names.length < 1 || names.length > 128) return false;
  const seen = new Set();
  for (const n of names) {
    if (typeof n !== 'string' || n.length < 1 || n.length > 240) return false;
    if (CONTROL_RE.test(n)) return false;
    if (seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}

function parseSegment(seg, isFrozen) {
  const aggregates = new Map();
  let plan = null;
  let planCount = 0;
  let aggStarted = false;
  let seenSuites = false;
  let seenDuration = false;
  let versionSeen = false;
  const topCases = [];
  for (const line of seg) {
    if (line === '') continue;
    if (line[0] === ' ' || line[0] === '\t') {
      if (aggStarted) return null;
      if (isFrozen && /^\s+(?:not )?ok(?:\s|$)/.test(line)) return null;
      if (isFrozen && /^\s+# Subtest:/.test(line)) return null;
      continue;
    }
    if (/^TAP version \d+$/.test(line)) {
      if (versionSeen || aggStarted || topCases.length > 0 || planCount > 0 || aggregates.size > 0) return null;
      versionSeen = true;
      continue;
    }
    if (line.startsWith('# Subtest:')) {
      if (aggStarted) return null;
      // Flat Node TAP emits this diagnostic before each case. It is never exported.
      continue;
    }
    const aggPref = line.match(/^# (tests|pass|fail|skipped|cancelled|todo)(?:\s|$)/);
    if (aggPref) {
      const m = line.match(/^# (tests|pass|fail|skipped|cancelled|todo) (\S+)$/);
      if (!m) return null;
      const val = canonicalNum(m[2]);
      if (val === null) return null;
      aggStarted = true;
      if (aggregates.has(m[1])) return null;
      aggregates.set(m[1], val);
      continue;
    }
    if (line.startsWith('# suites')) {
      const m = line.match(/^# suites (\S+)$/);
      if (!m || canonicalNum(m[1]) === null) return null;
      if (!aggStarted || seenSuites) return null;
      seenSuites = true;
      continue;
    }
    if (line.startsWith('# duration_ms')) {
      if (!/^# duration_ms \d+(?:\.\d+)?$/.test(line)) return null;
      if (!aggStarted || seenDuration) return null;
      seenDuration = true;
      continue;
    }
    if (line.startsWith('#')) {
      if (aggStarted) return null;
      if (!line.startsWith('# ') && line !== '#') return null;
      continue;
    }
    if (line.startsWith('1..')) {
      const m = line.match(/^1\.\.(\S+)$/);
      if (!m) return null;
      const v = canonicalNum(m[1]);
      if (v === null) return null;
      if (aggStarted) return null;
      planCount += 1;
      if (planCount > 1) return null;
      plan = v;
      continue;
    }
    if (/^(?:not )?ok(?:\s|$)/.test(line)) {
      const m = line.match(/^(not )?ok (\S+)(?: - (.*))?$/);
      if (!m) return null;
      const ord = canonicalNum(m[2]);
      if (ord === null || ord <= 0) return null;
      if (aggStarted) return null;
      if (isFrozen && m[3] === undefined) return null;
      topCases.push({ ordinal: ord, name: m[3] === undefined ? '' : m[3], ok: !m[1] });
      continue;
    }
    return null;
  }
  if (aggregates.size !== AGG_KEYS.length) return null;
  if (planCount !== 1) return null;
  const agg = {};
  for (const k of AGG_KEYS) {
    const v = aggregates.get(k);
    if (!Number.isInteger(v) || v < 0 || v > MAX_COUNT) return null;
    agg[k] = v;
  }
  if (agg.tests <= 0) return null;
  if (plan !== (isFrozen ? agg.tests : topCases.length)) return null;
  if (!isFrozen && (plan <= 0 || new Set(topCases.map(c => c.ordinal)).size !== topCases.length || topCases.some(c => c.ordinal < 1 || c.ordinal > plan))) return null;
  if (agg.skipped !== 0 || agg.cancelled !== 0 || agg.todo !== 0) return null;
  if (agg.pass + agg.fail !== agg.tests) return null;
  if (!isFrozen && ((agg.fail === 0) !== topCases.every(c => c.ok))) return null;
  return { agg, topCases };
}

export function summarizeCI(result, trustedNames) {
  try {
    if (!validTrustedNames(trustedNames)) return unavailable();
    if (!isObject(result)) return unavailable();
    const { state, exit_code, stdout, artifact_sha256, trusted_plan_hash } = result;
    if (state !== 'passed' && state !== 'failed') return unavailable();
    if (exit_code !== 0 && exit_code !== 1) return unavailable();
    if ((state === 'passed') !== (exit_code === 0)) return unavailable();
    if (typeof artifact_sha256 !== 'string' || !HASH_RE.test(artifact_sha256)) return unavailable();
    if (typeof trusted_plan_hash !== 'string' || !HASH_RE.test(trusted_plan_hash)) return unavailable();
    if (typeof stdout !== 'string' || stdout.length === 0) return unavailable();
    if (byteLength(stdout) > MAX_STDOUT_BYTES) return unavailable();
    if (stdout.includes('\0')) return unavailable();
    const lines = stdout.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
    for (const l of lines) {
      if (l.includes('\r') || l.includes('\0') || LINE_CONTROL_RE.test(l)) return unavailable();
    }
    const versionIdx = [];
    lines.forEach((l, i) => { if (/^TAP version \d+$/.test(l)) versionIdx.push(i); });
    if (versionIdx.length !== 2 || versionIdx[0] !== 0 || versionIdx.some(i => lines[i] !== 'TAP version 13')) return unavailable();
    const seg1 = lines.slice(0, versionIdx[1]);
    const seg2 = lines.slice(versionIdx[1]);
    if (!seg1 || seg1.length === 0 || !seg2 || seg2.length === 0) return unavailable();
    const pub = parseSegment(seg1, false);
    if (!pub) return unavailable();
    const frozen = parseSegment(seg2, true);
    if (!frozen) return unavailable();
    const trustedSet = new Set(trustedNames);
    if (frozen.topCases.length !== frozen.agg.tests) return unavailable();
    if (frozen.agg.tests !== trustedNames.length) return unavailable();
    const seenNames = new Set();
    const seenOrds = new Set();
    const resultByName = new Map();
    let okCount = 0;
    let notOkCount = 0;
    for (const c of frozen.topCases) {
      if (c.ordinal < 1 || c.ordinal > frozen.agg.tests) return unavailable();
      if (seenOrds.has(c.ordinal)) return unavailable();
      seenOrds.add(c.ordinal);
      if (!trustedSet.has(c.name)) return unavailable();
      if (seenNames.has(c.name)) return unavailable();
      seenNames.add(c.name);
      if (c.ok) { okCount += 1; resultByName.set(c.name, 'passed'); } else { notOkCount += 1; resultByName.set(c.name, 'failed'); }
    }
    if (seenNames.size !== trustedNames.length) return unavailable();
    if (okCount !== frozen.agg.pass || notOkCount !== frozen.agg.fail) return unavailable();
    const totalFail = pub.agg.fail + frozen.agg.fail;
    if (state === 'passed' && totalFail !== 0) return unavailable();
    if (state === 'failed' && totalFail === 0) return unavailable();
    const cases = trustedNames.map((name) => ({ name, result: resultByName.get(name) }));
    return { schema_version: 1, state, exit_code, public_tests: pub.agg, frozen_tests: frozen.agg, cases, artifact_sha256, trusted_plan_hash };
  } catch {
    return unavailable();
  }
}

function validAggregate(a) {
  if (!isObject(a)) return false;
  const keys = Object.keys(a);
  if (keys.length !== AGG_KEYS.length) return false;
  for (const k of AGG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(a, k)) return false;
    if (!Number.isInteger(a[k]) || a[k] < 0 || a[k] > MAX_COUNT) return false;
  }
  if (a.tests <= 0) return false;
  if (a.skipped !== 0 || a.cancelled !== 0 || a.todo !== 0) return false;
  if (a.pass + a.fail !== a.tests) return false;
  return true;
}

export function buildCIFeedback(summary) {
  const fail = () => { throw new Error('ci_feedback_unavailable'); };
  if (!isObject(summary)) fail();
  const expected = ['schema_version', 'state', 'exit_code', 'public_tests', 'frozen_tests', 'cases', 'artifact_sha256', 'trusted_plan_hash'];
  const keys = Object.keys(summary);
  if (keys.length !== expected.length || !expected.every((k) => Object.prototype.hasOwnProperty.call(summary, k))) fail();
  if (summary.schema_version !== 1) fail();
  if (summary.state !== 'passed' && summary.state !== 'failed') fail();
  if (summary.exit_code !== 0 && summary.exit_code !== 1) fail();
  if ((summary.state === 'passed') !== (summary.exit_code === 0)) fail();
  if (!validAggregate(summary.public_tests)) fail();
  if (!validAggregate(summary.frozen_tests)) fail();
  if (typeof summary.artifact_sha256 !== 'string' || !HASH_RE.test(summary.artifact_sha256)) fail();
  if (typeof summary.trusted_plan_hash !== 'string' || !HASH_RE.test(summary.trusted_plan_hash)) fail();
  if (!Array.isArray(summary.cases)) fail();
  if (summary.cases.length !== summary.frozen_tests.tests) fail();
  const seen = new Set();
  let passedCases = 0;
  let failedCases = 0;
  const failedNames = [];
  for (const c of summary.cases) {
    if (!isObject(c)) fail();
    const ck = Object.keys(c);
    if (ck.length !== 2 || !Object.prototype.hasOwnProperty.call(c, 'name') || !Object.prototype.hasOwnProperty.call(c, 'result')) fail();
    if (typeof c.name !== 'string' || c.name.length < 1 || c.name.length > 240 || CONTROL_RE.test(c.name)) fail();
    if (seen.has(c.name)) fail();
    seen.add(c.name);
    if (c.result === 'passed') passedCases += 1;
    else if (c.result === 'failed') { failedCases += 1; failedNames.push(c.name); }
    else fail();
  }
  if (passedCases !== summary.frozen_tests.pass || failedCases !== summary.frozen_tests.fail) fail();
  const totalFail = summary.public_tests.fail + summary.frozen_tests.fail;
  if (summary.state === 'passed' && totalFail !== 0) fail();
  if (summary.state === 'failed' && totalFail === 0) fail();
  const p = summary.public_tests;
  const f = summary.frozen_tests;
  const header = summary.state === 'passed' ? 'Independent CI check passed for this artifact.' : 'Independent CI check failed for this artifact.';
  const lines = [
    header,
    `Public tests: ${p.tests} tests, ${p.pass} passed, ${p.fail} failed, ${p.skipped} skipped, ${p.cancelled} cancelled, ${p.todo} todo.`,
    `Frozen trusted tests: ${f.tests} tests, ${f.pass} passed, ${f.fail} failed, ${f.skipped} skipped, ${f.cancelled} cancelled, ${f.todo} todo.`
  ];
  if (summary.state === 'failed') {
    if (failedNames.length > 0) {
      lines.push('Failed frozen trusted cases:');
      for (const n of failedNames) lines.push(`- ${n}`);
    } else {
      lines.push('No frozen trusted cases failed; the failure is reflected in the public test counts above.');
    }
  }
  lines.push(`Artifact SHA-256: ${summary.artifact_sha256}`);
  lines.push(`Trusted plan SHA-256: ${summary.trusted_plan_hash}`);
  if (summary.state === 'passed') {
    lines.push('Please review the actual public contract and add or adjust meaningful tests only if needed.');
  } else {
    lines.push('Please fix the actual failures and add regression tests, preserving the API and public contract.');
  }
  lines.push('Rerun the public tests yourself and distinguish those executions from these independent results; do not claim new frozen results without a new independent check.');
  let message = lines.join('\n');
  if (byteLength(message) > 8192) {
    const bullets = lines.filter((l) => l.startsWith('- '));
    const nonBullets = lines.filter((l) => !l.startsWith('- '));
    let kept = [];
    for (const b of bullets) {
      const candidate = [...nonBullets.slice(0, 3), ...kept, b, ...nonBullets.slice(3)].join('\n');
      if (byteLength(candidate) > 8000) break;
      kept.push(b);
    }
    const omitted = bullets.length - kept.length;
    const rebuilt = [...nonBullets.slice(0, 3), ...kept];
    if (omitted > 0) rebuilt.push(`- ... (${omitted} additional failed cases omitted to keep this message bounded)`);
    rebuilt.push(...nonBullets.slice(3));
    message = rebuilt.join('\n');
    while (byteLength(message) > 8192 && kept.length > 0) {
      kept = kept.slice(0, -1);
      const again = [...nonBullets.slice(0, 3), ...kept, `- ... (${bullets.length - kept.length} additional failed cases omitted to keep this message bounded)`, ...nonBullets.slice(3)];
      message = again.join('\n');
    }
  }
  return message;
}
