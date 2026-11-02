import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {judgePlatform, assertJudgePlatform, judgePlatformMessage} from '../src/judge-platform.mjs';
import {runJudgeInstall} from '../src/judge-install-runner.mjs';

test('only macOS and Linux pass the preflight; unsupported systems are distinct', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(judgePlatform(platform), {allowed: true, code: null});
    assert.doesNotThrow(() => assertJudgePlatform(platform));
  }
  assert.throws(() => assertJudgePlatform('win32'), /judge_install_process_group_unavailable/);
  assert.throws(() => assertJudgePlatform('freebsd'), /judge_platform_unsupported/);
  assert.match(judgePlatformMessage(Error('judge_install_process_group_unavailable'), 'win32'), /WSL2.*docs\/JUDGE-QUICKSTART\.md/);
  assert.equal(judgePlatformMessage(Error('judge_install_process_group_unavailable'), 'linux'), null);
  assert.match(judgePlatformMessage(Error('judge_platform_unsupported'), 'freebsd'), /operating system/);
});

test('direct installer rejects Windows before argument validation or reading credentials', async () => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {value: 'win32'});
  try {
    await assert.rejects(runJudgeInstall({}), /judge_install_process_group_unavailable/);
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
});

async function runCliFixture(t, script, platform) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'judge-platform-test-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  await fs.mkdir(path.join(dir, 'scripts'));
  await fs.mkdir(path.join(dir, 'src'));
  await fs.copyFile(new URL(`../scripts/${script}`, import.meta.url), path.join(dir, 'scripts', script));
  await fs.copyFile(new URL('../src/judge-platform.mjs', import.meta.url), path.join(dir, 'src/judge-platform.mjs'));
  // Any evaluation of these modules, including before credential read or task
  // preparation, creates a marker and fails; no real credentials or services.
  const marker = path.join(dir, 'should-not-import');
  const trap = `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)}, 'imported');throw Error('unexpected_import');`;
  for (const file of ['src/judge-access.mjs', 'src/judge-install-runner.mjs', 'src/coding-task-profiles.mjs', 'structured-live.mjs']) await fs.writeFile(path.join(dir, file), trap);
  const preload = path.join(dir, 'platform-override.mjs');
  await fs.writeFile(preload, `Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});`);
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, path.join(dir, 'scripts', script), '--consent-typing', '--access', path.join(dir, 'missing.json')], {cwd: dir, env: {PATH: process.env.PATH, HOME: dir}, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', x => output += x);
  child.stderr.on('data', x => output += x);
  const exit = await new Promise((resolve, reject) => {child.once('error', reject);child.once('close', (code, signal) => resolve({code, signal}));});
  assert.deepEqual(exit, {code: 1, signal: null});
  await assert.rejects(fs.stat(marker), {code: 'ENOENT'});
  assert.doesNotMatch(output, /unexpected_import|missing\.json/);
  return output;
}

for (const script of ['judge-start.mjs', 'judge-install.mjs']) {
  test(`${script} fails before access and runtime imports on native Windows`, async t => {
    assert.match(await runCliFixture(t, script, 'win32'), /Native Windows is not supported.*WSL2.*docs\/JUDGE-QUICKSTART\.md/);
  });
  test(`${script} distinguishes an unsupported non-Windows OS`, async t => {
    assert.match(await runCliFixture(t, script, 'freebsd'), /This operating system is not supported/);
  });
}
