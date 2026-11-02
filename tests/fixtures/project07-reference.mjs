export async function resolveConflict({ base, readRemote, readLatestDraft } = {}) {
  if (typeof readRemote !== 'function') throw new TypeError('readRemote must be a function');
  if (typeof readLatestDraft !== 'function') throw new TypeError('readLatestDraft must be a function');
  assertSnapshot(base, 'base');
  const remote = await readRemote();
  assertSnapshot(remote, 'remote');
  const latest = readLatestDraft();
  assertDraft(latest, 'draft');
  const ORDER = ['title', 'done'];
  const overlaps = [];
  for (const key of ORDER) {
    const b = base.fields[key];
    const r = remote.fields[key];
    const l = latest[key];
    const localChanged = l !== b;
    const remoteChanged = r !== b;
    if (localChanged && remoteChanged && l !== r) overlaps.push(key);
  }
  const draftCopy = { title: latest.title, done: latest.done };
  if (overlaps.length > 0) {
    return { kind: 'conflict', fields: [...overlaps], draft: draftCopy };
  }
  const patch = {};
  for (const key of ORDER) {
    const localChanged = latest[key] !== base.fields[key];
    if (localChanged && latest[key] !== remote.fields[key]) {
      patch[key] = latest[key];
    }
  }
  if (Object.keys(patch).length > 0) {
    return { kind: 'retry', expectedRevision: remote.revision, patch, draft: draftCopy };
  }
  return { kind: 'clean', draft: draftCopy };
}

function isPlainRecord(v) {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function assertNoSymbols(obj, name) {
  if (Object.getOwnPropertySymbols(obj).length !== 0) throw new TypeError(name + ' must not have symbol keys');
}

function assertSnapshot(snap, name) {
  if (!isPlainRecord(snap)) throw new TypeError(name + ' snapshot must be a plain object');
  assertNoSymbols(snap, name);
  const keys = Object.getOwnPropertyNames(snap);
  if (keys.length !== 2 || !keys.includes('revision') || !keys.includes('fields')) {
    throw new TypeError(name + ' snapshot must have exactly {revision, fields}');
  }
  if (typeof snap.revision !== 'string' || snap.revision.length === 0) {
    throw new TypeError(name + '.revision must be a non-empty string');
  }
  const f = snap.fields;
  if (!isPlainRecord(f)) throw new TypeError(name + '.fields must be a plain object');
  assertNoSymbols(f, name + '.fields');
  const fkeys = Object.getOwnPropertyNames(f);
  if (fkeys.length !== 2 || !fkeys.includes('title') || !fkeys.includes('done')) {
    throw new TypeError(name + '.fields must have exactly {title, done}');
  }
  if (typeof f.title !== 'string') throw new TypeError(name + '.fields.title must be a string');
  if (typeof f.done !== 'boolean') throw new TypeError(name + '.fields.done must be a boolean');
}

function assertDraft(d, name) {
  if (!isPlainRecord(d)) throw new TypeError(name + ' must be a plain object');
  assertNoSymbols(d, name);
  const keys = Object.getOwnPropertyNames(d);
  if (keys.length !== 2 || !keys.includes('title') || !keys.includes('done')) {
    throw new TypeError(name + ' must have exactly {title, done}');
  }
  if (typeof d.title !== 'string') throw new TypeError(name + '.title must be a string');
  if (typeof d.done !== 'boolean') throw new TypeError(name + '.done must be a boolean');
}
