import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODING_TASKS,
  DEFAULT_CODING_TASK,
  codingTaskProfile,
  codingTaskSpec,
  requireCodingTaskId,
} from '../src/coding-task-catalog.mjs';

const VALID_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const EXPECTED_TASKS = [
  {
    id: 'save-conflicts',
    taskId: 'CODING-save-conflicts',
    title: 'Save conflicts',
    description: 'Preserve the latest draft when a task save conflicts.',
    sourceFile: 'src/save.mjs',
  },
  {
    id: 'booking-rules',
    taskId: 'CODING-booking-rules',
    title: 'Booking rules',
    description: 'Handle reservation capacity, retries and cancellations.',
    sourceFile: 'src/booking.mjs',
  },
  {
    id: 'batch-import',
    taskId: 'CODING-batch-import',
    title: 'Batch import',
    description: 'Keep valid customer imports and explain row errors.',
    sourceFile: 'src/import.mjs',
  },
  {
    id: 'notification-routing',
    taskId: 'CODING-notification-routing',
    title: 'Notification routing',
    description: 'Preserve routing behavior while adding quiet hours.',
    sourceFile: 'src/notify.mjs',
  },
  {id:'shared-expenses',taskId:'CODING-shared-expenses',title:'Split a trip bill',description:'Help friends split dinner, taxis and shared trip costs fairly, down to the last cent.',sourceFile:'src/settle.mjs'},
];

function validInput(overrides = {}) {
  return {
    id: 'save-conflicts',
    repositoryRoot: '/workspace/repository',
    commit: VALID_COMMIT,
    prompt: 'Implement the task.',
    ...overrides,
  };
}

function expectedProfile(row, overrides = {}) {
  const input = validInput({ id: row.id, ...overrides });
  return {
    version: 1,
    kind: 'project',
    repository: { root: input.repositoryRoot, commit: input.commit },
    source: {
      include: [
        'CONTRACT.md',
        'TASK.md',
        'package.json',
        row.sourceFile,
        'test/behavior.test.mjs',
        'test/smoke.test.mjs',
      ],
    },
    task: { id: row.taskId, prompt: input.prompt },
    verification: {
      mode: 'project',
      subset: true,
      own_tests: ['test/behavior.test.mjs', 'test/smoke.test.mjs'],
      trusted: {
        tests: ['test/frozen-acceptance.test.mjs'],
        plan_hash: null,
      },
    },
    limits: { max_files: 32, max_file_bytes: 128000, max_total_bytes: 524288 },
  };
}

const throwsInvalid = (fn) =>
  assert.throws(fn, (error) => error instanceof Error && error.message === 'coding_task_invalid');
const throwsProfileInvalid = (fn) =>
  assert.throws(fn, (error) => error instanceof Error && error.message === 'coding_task_profile_invalid');

test('exports the exact default and catalog rows', () => {
  assert.equal(DEFAULT_CODING_TASK, 'save-conflicts');
  assert.deepEqual(CODING_TASKS, EXPECTED_TASKS);
  assert.deepEqual(
    CODING_TASKS.map((row) => row.id),
    ['save-conflicts', 'booking-rules', 'batch-import', 'notification-routing', 'shared-expenses'],
  );
});

test('task IDs and source files are distinct', () => {
  assert.equal(new Set(CODING_TASKS.map((row) => row.id)).size, 5);
  assert.equal(new Set(CODING_TASKS.map((row) => row.taskId)).size, 5);
  assert.equal(new Set(CODING_TASKS.map((row) => row.sourceFile)).size, 5);
});

test('catalog and returned specs are immutable', () => {
  assert.equal(Object.isFrozen(CODING_TASKS), true);
  for (const row of CODING_TASKS) assert.equal(Object.isFrozen(row), true);
  assert.throws(() => {
    CODING_TASKS.push({ id: 'extra' });
  }, TypeError);
  assert.throws(() => {
    CODING_TASKS[0].title = 'Changed';
  }, TypeError);
  assert.throws(() => {
    codingTaskSpec('booking-rules').sourceFile = 'src/evil.mjs';
  }, TypeError);
  assert.deepEqual(CODING_TASKS, EXPECTED_TASKS);
});

test('requireCodingTaskId accepts only exact supported IDs', () => {
  assert.equal(requireCodingTaskId(), 'save-conflicts');
  assert.equal(requireCodingTaskId(undefined), 'save-conflicts');
  for (const row of EXPECTED_TASKS) assert.equal(requireCodingTaskId(row.id), row.id);
  const invalid = [
    null,
    '',
    ' ',
    ' save-conflicts',
    'save-conflicts ',
    'SAVE-CONFLICTS',
    'Save-Conflicts',
    'save_conflicts',
    'unknown',
    '../save-conflicts',
    './save-conflicts',
    '/save-conflicts',
    'save-conflicts/extra',
    'save-conflicts\\extra',
    'src/save.mjs',
    0,
    42,
    false,
    true,
    {},
    [],
    ['save-conflicts'],
    { id: 'save-conflicts' },
  ];
  for (const value of invalid) throwsInvalid(() => requireCodingTaskId(value));
});

test('codingTaskSpec returns the corresponding immutable row', () => {
  assert.equal(codingTaskSpec(), CODING_TASKS[0]);
  assert.equal(codingTaskSpec(undefined), CODING_TASKS[0]);
  for (const row of CODING_TASKS) {
    assert.equal(codingTaskSpec(row.id), row);
    assert.deepEqual(codingTaskSpec(row.id), row);
  }
  for (const value of [null, '', 'unknown', '../booking-rules', {}, []]) {
    throwsInvalid(() => codingTaskSpec(value));
  }
});

test('codingTaskProfile returns the exact fixed schema for every task', () => {
  for (const row of EXPECTED_TASKS) {
    const profile = codingTaskProfile(validInput({ id: row.id }));
    assert.deepEqual(profile, expectedProfile(row));
    assert.equal(Object.getPrototypeOf(profile), Object.prototype);
    assert.equal(Object.getPrototypeOf(profile.repository), Object.prototype);
    assert.equal(Object.getPrototypeOf(profile.source), Object.prototype);
  }
  assert.equal(codingTaskProfile(validInput({ repositoryRoot: '/' })).repository.root, '/');
  assert.equal(codingTaskProfile(validInput({ prompt: 'x'.repeat(14000) })).task.prompt.length, 14000);
  assert.equal(codingTaskProfile(validInput({ prompt: '  keep this  ' })).task.prompt, '  keep this  ');
});

test('codingTaskProfile returns fresh objects unaffected by mutation', () => {
  const first = codingTaskProfile(validInput());
  first.repository.root = '/evil';
  first.repository.commit = 'f'.repeat(40);
  first.source.include.push('test/frozen-acceptance.test.mjs');
  first.source.include[3] = 'src/evil.mjs';
  first.task.id = 'CODING-evil';
  first.task.prompt = 'evil';
  first.verification.own_tests.push('test/evil.test.mjs');
  first.verification.trusted.tests.push('test/evil.test.mjs');
  first.verification.trusted.plan_hash = 'evil';
  first.limits.max_files = 9999;
  const second = codingTaskProfile(validInput());
  assert.deepEqual(second, expectedProfile(EXPECTED_TASKS[0]));
  assert.notEqual(first, second);
  assert.notEqual(first.repository, second.repository);
  assert.notEqual(first.source, second.source);
  assert.notEqual(first.source.include, second.source.include);
  assert.notEqual(first.verification.trusted, second.verification.trusted);
  assert.notEqual(first.limits, second.limits);
  assert.deepEqual(CODING_TASKS, EXPECTED_TASKS);
});

test('source.include never contains broad or private forbidden paths', () => {
  const forbiddenFragments = [
    'frozen-acceptance',
    'private',
    'facilitator',
    'reference',
    'solution',
    'answer',
    'hidden',
  ];
  for (const row of EXPECTED_TASKS) {
    const include = codingTaskProfile(validInput({ id: row.id })).source.include;
    assert.deepEqual(include, [
      'CONTRACT.md',
      'TASK.md',
      'package.json',
      row.sourceFile,
      'test/behavior.test.mjs',
      'test/smoke.test.mjs',
    ]);
    for (const entry of include) {
      assert.notEqual(entry, 'test');
      assert.notEqual(entry, 'test/');
      assert.notEqual(entry, 'src');
      assert.notEqual(entry, 'src/');
      assert.equal(entry.endsWith('/'), false);
      assert.equal(entry.startsWith('/'), false);
      assert.equal(entry.startsWith('../'), false);
      assert.equal(entry.includes('..'), false);
      for (const fragment of forbiddenFragments) assert.equal(entry.toLowerCase().includes(fragment), false);
    }
  }
});

test('codingTaskProfile requires a known explicit id', () => {
  for (const id of [undefined, null, '', 'unknown', 'SAVE-CONFLICTS', '../save-conflicts', 'save-conflicts/extra', 42, {}, []]) {
    throwsInvalid(() => codingTaskProfile(validInput({ id })));
  }
  const { id: _omitted, ...withoutId } = validInput();
  throwsInvalid(() => codingTaskProfile(withoutId));
});

test('codingTaskProfile rejects invalid repository roots', () => {
  const invalidRoots = [
    undefined,
    null,
    '',
    'repository',
    'relative/repository',
    './repository',
    '../repository',
    'C:/repository',
    'C:\\repository',
    '\\\\server\\repository',
    42,
    {},
    [],
    '/workspace/repository\n',
    '/workspace/repository\r',
    '/workspace/repository\t',
    '/workspace/repository\u0000',
    '/workspace/repository\u001f',
    '/workspace/repository\u007f',
  ];
  for (const repositoryRoot of invalidRoots) {
    throwsProfileInvalid(() => codingTaskProfile(validInput({ repositoryRoot })));
  }
});

test('codingTaskProfile rejects invalid commits', () => {
  const invalidCommits = [
    undefined,
    null,
    '',
    'abc',
    'a'.repeat(39),
    'a'.repeat(41),
    'A'.repeat(40),
    'g'.repeat(40),
    'z123456789abcdef0123456789abcdef012345',
    `${VALID_COMMIT}\n`,
    ` ${VALID_COMMIT}`,
    42,
    {},
    [],
  ];
  for (const commit of invalidCommits) {
    throwsProfileInvalid(() => codingTaskProfile(validInput({ commit })));
  }
});

test('codingTaskProfile rejects invalid prompts', () => {
  const invalidPrompts = [undefined, null, '', ' ', '   ', '\n\t', 42, false, {}, [], 'x'.repeat(14001)];
  for (const prompt of invalidPrompts) {
    throwsProfileInvalid(() => codingTaskProfile(validInput({ prompt })));
  }
});

test('codingTaskProfile rejects malformed profile inputs', () => {
  throwsProfileInvalid(() => codingTaskProfile());
  throwsProfileInvalid(() => codingTaskProfile(null));
  throwsProfileInvalid(() => codingTaskProfile('save-conflicts'));
  throwsProfileInvalid(() => codingTaskProfile([]));
});

test('codingTaskProfile does not mutate its input', () => {
  const input = validInput({ id: 'batch-import' });
  const snapshot = JSON.parse(JSON.stringify(input));
  const profile = codingTaskProfile(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(profile, expectedProfile(EXPECTED_TASKS[2], { id: 'batch-import' }));
  const frozenInput = Object.freeze(validInput({ id: 'notification-routing' }));
  assert.deepEqual(
    codingTaskProfile(frozenInput),
    expectedProfile(EXPECTED_TASKS[3], { id: 'notification-routing' }),
  );
  assert.deepEqual(frozenInput, validInput({ id: 'notification-routing' }));
});
