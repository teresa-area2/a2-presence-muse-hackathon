// Inspired by the Muse-generated proposal. Settings are per arm; the normal
// credential store is referenced, not copied. This is not a secrecy boundary.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const owned = new WeakMap();
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

export async function createIsolatedMuseConfigs({sessionDir, environment, nativeProfile=false} = {}) {
  if (!environment || !path.isAbsolute(environment.HOME ?? '') ||
      !path.isAbsolute(sessionDir ?? '') ||
      (environment.XDG_CONFIG_HOME && !path.isAbsolute(environment.XDG_CONFIG_HOME))) {
    throw Error('muse_config_invalid');
  }
  const session = await fs.realpath(sessionDir);
  const info = await fs.lstat(sessionDir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) ||
      (process.getuid && info.uid !== process.getuid())) throw Error('muse_config_session_unsafe');
  for (const p of [os.tmpdir(), '/tmp', '/private/tmp', environment.TMPDIR].filter(Boolean)) {
    const temp = await fs.realpath(p).catch(() => null);
    if (temp && inside(temp, session)) throw Error('muse_config_in_temporary_directory');
  }
  const auth = path.join(environment.XDG_CONFIG_HOME || path.join(environment.HOME, '.config'), 'muse', 'auth.json');
  const authStat = await fs.stat(auth).catch(() => null);
  if (!authStat?.isFile()) throw Error('muse_auth_unavailable');
  const root = path.join(session, 'muse-configs');
  await fs.mkdir(root, {mode: 0o700}); // Refuses an existing root.
  try {
    const value = {root};
    for (const name of ['without', 'with']) {
      const dir = path.join(root, name);
      await fs.mkdir(dir, {mode: 0o700});
      await fs.mkdir(path.join(dir, 'muse'), {mode: 0o700});
      await fs.symlink(auth, path.join(dir, 'muse', 'auth.json'));
      if(nativeProfile===true)await fs.writeFile(path.join(dir,'muse','settings.json'),JSON.stringify({schema_version:1,contributor_mode_enabled:false,context:{foreign_personal_rules:false,foreign_personal_skills:false}}),{flag:'wx',mode:0o600});
      value[name] = {...environment, XDG_CONFIG_HOME: dir};
    }
    const stat = await fs.lstat(root);
    owned.set(value, {root, dev: stat.dev, ino: stat.ino});
    return value;
  } catch (error) {
    await fs.rm(root, {recursive: true, force: true});
    throw error;
  }
}

export async function removeIsolatedMuseConfigs(configs) {
  const entry = owned.get(configs);
  if (!entry) throw Error('muse_config_not_owned');
  const stat = await fs.lstat(entry.root).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== entry.dev || stat.ino !== entry.ino)) {
    throw Error('muse_config_ownership_changed');
  }
  if (stat) await fs.rm(entry.root, {recursive: true});
  owned.delete(configs);
}
