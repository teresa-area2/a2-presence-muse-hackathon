export const DEFAULT_CODING_TASK = 'save-conflicts';

export const CODING_TASKS = Object.freeze([
  Object.freeze({
    id: 'save-conflicts',
    taskId: 'CODING-save-conflicts',
    title: 'Save conflicts',
    description: 'Preserve the latest draft when a task save conflicts.',
    sourceFile: 'src/save.mjs',
  }),
  Object.freeze({
    id: 'booking-rules',
    taskId: 'CODING-booking-rules',
    title: 'Booking rules',
    description: 'Handle reservation capacity, retries and cancellations.',
    sourceFile: 'src/booking.mjs',
  }),
  Object.freeze({
    id: 'batch-import',
    taskId: 'CODING-batch-import',
    title: 'Batch import',
    description: 'Keep valid customer imports and explain row errors.',
    sourceFile: 'src/import.mjs',
  }),
  Object.freeze({
    id: 'notification-routing',
    taskId: 'CODING-notification-routing',
    title: 'Notification routing',
    description: 'Preserve routing behavior while adding quiet hours.',
    sourceFile: 'src/notify.mjs',
  }),
  Object.freeze({id:'shared-expenses',taskId:'CODING-shared-expenses',title:'Split a trip bill',description:'Help friends split dinner, taxis and shared trip costs fairly, down to the last cent.',sourceFile:'src/settle.mjs'}),
]);

const TASKS_BY_ID = new Map(CODING_TASKS.map((row) => [row.id, row]));
const HEX_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F]/;

export function requireCodingTaskId(value = DEFAULT_CODING_TASK) {
  if (typeof value !== 'string' || !TASKS_BY_ID.has(value)) {
    throw new Error('coding_task_invalid');
  }
  return value;
}

export function codingTaskSpec(value = DEFAULT_CODING_TASK) {
  return TASKS_BY_ID.get(requireCodingTaskId(value));
}

export function codingTaskProfile(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('coding_task_profile_invalid');
  }
  const { id, repositoryRoot, commit, prompt } = input;
  if (id === undefined) {
    throw new Error('coding_task_invalid');
  }
  const row = TASKS_BY_ID.get(requireCodingTaskId(id));
  if (
    typeof repositoryRoot !== 'string' ||
    repositoryRoot.length === 0 ||
    !repositoryRoot.startsWith('/') ||
    CONTROL_CHAR_PATTERN.test(repositoryRoot)
  ) {
    throw new Error('coding_task_profile_invalid');
  }
  if (typeof commit !== 'string' || !HEX_COMMIT_PATTERN.test(commit)) {
    throw new Error('coding_task_profile_invalid');
  }
  if (
    typeof prompt !== 'string' ||
    prompt.length === 0 ||
    prompt.length > 14000 ||
    prompt.trim().length === 0
  ) {
    throw new Error('coding_task_profile_invalid');
  }
  return {
    version: 1,
    kind: 'project',
    repository: {
      root: repositoryRoot,
      commit,
    },
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
    task: {
      id: row.taskId,
      prompt,
    },
    verification: {
      mode: 'project',
      subset: true,
      own_tests: ['test/behavior.test.mjs', 'test/smoke.test.mjs'],
      trusted: {
        tests: ['test/frozen-acceptance.test.mjs'],
        plan_hash: null,
      },
    },
    limits: {
      max_files: 32,
      max_file_bytes: 128000,
      max_total_bytes: 524288,
    },
  };
}

// A browser may select this closed ID, never an arbitrary repository or path.
export const FREE_CODING_TASK = Object.freeze({id:'free-task',taskId:'USER-free-task',title:'Your own task',description:'Start with a clean workspace and tell Muse what you want to build.'});
export function requireWorkspaceTaskId(value = DEFAULT_CODING_TASK) {
  return value === FREE_CODING_TASK.id ? value : requireCodingTaskId(value);
}
export function workspaceTaskSpec(value = DEFAULT_CODING_TASK) {
  return value === FREE_CODING_TASK.id ? FREE_CODING_TASK : codingTaskSpec(value);
}
