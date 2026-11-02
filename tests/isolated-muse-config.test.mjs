import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createIsolatedMuseConfigs, removeIsolatedMuseConfigs} from '../src/isolated-muse-config.mjs';

test('isolates both settings trees while referencing the original auth and cleans only its own files', async () => {
  const parent = await fs.mkdtemp(path.join(process.cwd(), '.muse-config-test-'));
  try {
    const session = path.join(parent, 'session'), home = path.join(parent, 'home');
    await fs.mkdir(session, {mode: 0o700});
    await fs.mkdir(path.join(home, '.config', 'muse'), {recursive: true, mode: 0o700});
    const auth = path.join(home, '.config', 'muse', 'auth.json');
    await fs.writeFile(auth, 'dummy', {mode: 0o600});
    const sourceSettings = path.join(home, '.config', 'muse', 'settings.json');
    await fs.writeFile(sourceSettings, '{"hooks":{"unwanted":true}}');
    const configs = await createIsolatedMuseConfigs({sessionDir: session, environment: {HOME: home, PATH: '/bin'}});
    assert.notEqual(configs.with.XDG_CONFIG_HOME, configs.without.XDG_CONFIG_HOME);
    for (const arm of ['without', 'with']) {
      const dir = path.join(configs[arm].XDG_CONFIG_HOME, 'muse');
      assert.equal(await fs.readlink(path.join(dir, 'auth.json')), auth);
      await assert.rejects(fs.stat(path.join(dir, 'settings.json')), {code: 'ENOENT'});
    }
    await fs.writeFile(sourceSettings, '{"mcp_servers":{"new":true}}');
    await assert.rejects(fs.stat(path.join(configs.with.XDG_CONFIG_HOME, 'muse', 'settings.json')), {code: 'ENOENT'});
    await removeIsolatedMuseConfigs(configs);
    assert.equal(await fs.readFile(auth, 'utf8'), 'dummy');
    await assert.rejects(fs.stat(configs.root), {code: 'ENOENT'});
    await assert.rejects(removeIsolatedMuseConfigs({root: configs.root}), /not_owned/);
    const native=await createIsolatedMuseConfigs({sessionDir:session,environment:{HOME:home,PATH:'/bin'},nativeProfile:true});
    for(const arm of ['without','with'])assert.deepEqual(JSON.parse(await fs.readFile(path.join(native[arm].XDG_CONFIG_HOME,'muse','settings.json'),'utf8')),{schema_version:1,contributor_mode_enabled:false,context:{foreign_personal_rules:false,foreign_personal_skills:false}});
    await removeIsolatedMuseConfigs(native);assert.equal(await fs.readFile(auth,'utf8'),'dummy');
  } finally { await fs.rm(parent, {recursive: true, force: true}); }
});

test('rejects missing auth, preexisting configs and sandbox-writable temporary roots', async () => {
  const parent = await fs.mkdtemp(path.join(process.cwd(), '.muse-config-test-'));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'muse-config-test-'));
  try {
    const session = path.join(parent, 'session'), home = path.join(parent, 'home');
    await fs.mkdir(session, {mode: 0o700});
    await assert.rejects(createIsolatedMuseConfigs({sessionDir: session, environment: {HOME: home}}), /auth_unavailable/);
    await fs.mkdir(path.join(home, '.config', 'muse'), {recursive: true});
    await fs.writeFile(path.join(home, '.config', 'muse', 'auth.json'), 'dummy');
    await fs.mkdir(path.join(session, 'muse-configs'));
    await assert.rejects(createIsolatedMuseConfigs({sessionDir: session, environment: {HOME: home}}), {code: 'EEXIST'});
    await assert.rejects(createIsolatedMuseConfigs({sessionDir: tmp, environment: {HOME: home}}), /temporary_directory/);
  } finally { await fs.rm(parent, {recursive: true, force: true}); await fs.rm(tmp, {recursive: true, force: true}); }
});
