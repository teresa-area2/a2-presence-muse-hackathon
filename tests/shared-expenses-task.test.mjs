import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const task = fileURLToPath(new URL('../coding-tasks/tasks/shared-expenses/', import.meta.url));
const acceptance = path.join(task, 'checks/acceptance.test.mjs');
function run(files, workspace, override = true) {
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT; delete env.TASK_PROJECT_DIR;
  if (override) env.TASK_PROJECT_DIR = workspace;
  return spawnSync(process.execPath, ['--test', ...files], {cwd: workspace, env, encoding: 'utf8', timeout: 10000});
}
function passed(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
function intendedFailure(result) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /apartment and subgroup dinner settle the worked trip correctly/);
  assert.match(result.stdout, /AssertionError/);
  assert.doesNotMatch(result.stdout + result.stderr, /ERR_MODULE_NOT_FOUND|SyntaxError/);
}

test('shared expenses starter is runnable and fails the actual expense behavior', () => {
  const project = path.join(task, 'project');
  passed(run(['test/smoke.test.mjs'], project));
  const publicResult = run(['test/behavior.test.mjs'], project);
  assert.equal(publicResult.status, 1, publicResult.stdout + publicResult.stderr);
  assert.doesNotMatch(publicResult.stdout + publicResult.stderr, /ERR_MODULE_NOT_FOUND|SyntaxError/);
  intendedFailure(run([acceptance], project));
});

test('independent reference passes all public and frozen cases in a candidate-only copy', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shared expenses reference '));
  t.after(() => fs.rm(folder, {recursive: true, force: true}));
  await fs.cp(path.join(task, 'project'), folder, {recursive: true});
  await fs.copyFile(path.join(task, 'reference/src/settle.mjs'), path.join(folder, 'src/settle.mjs'));
  passed(run(['test/smoke.test.mjs', 'test/behavior.test.mjs'], folder));
  const frozen = run([acceptance], folder);
  passed(frozen); assert.match(frozen.stdout, /# tests 10/); assert.match(frozen.stdout, /# fail 0/);
  const publicFiles = await fs.readdir(folder);
  assert.ok(!publicFiles.includes('checks') && !publicFiles.includes('reference') && !publicFiles.includes('FACILITATOR.md'));
});

test('task imports portably without an override from paths containing spaces', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shared expenses portable '));
  t.after(() => fs.rm(folder, {recursive: true, force: true}));
  await fs.cp(task, folder, {recursive: true});
  const check = path.join(folder, 'checks/acceptance.test.mjs');
  intendedFailure(run([check], folder, false));
  await fs.copyFile(path.join(folder, 'reference/src/settle.mjs'), path.join(folder, 'project/src/settle.mjs'));
  passed(run([check], folder, false));
});
