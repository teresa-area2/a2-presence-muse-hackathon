// artifact-source.mjs — one deterministic file/hash policy (BUILD-04).
//
// Shared by artifact capture (DemoController) and verification snapshots.
// Sample mode preserves the existing regressions byte-for-byte: top-level
// exclusion of .git/.presence/.muse/.verification, extensions
// .m?js/.json/.md/.txt, max 64 files, 128000 bytes/file, 512000 total,
// depth 8. Project mode extends the same shape to the harness public
// source types (CSS/HTML/Python plus safe extensionless public docs and
// new public files) while excluding private control directories at every
// level. Unsafe files are refused (throw) instead of hidden; every
// permitted candidate file is included in the reviewed hash.
//
// Hidden-ancestor rule (project mode): a file is excluded when ANY ancestor
// directory starts with '.', and a dotfile is excluded unless it is a
// narrowly explicit public exception (.gitignore, .env.example). Only the
// leaf name is never enough: src/.aws/config.json, src/.ssh/known_hosts.txt
// and src/.hidden/notes.md are all excluded because of their hidden
// ancestors, even though their leaves look innocuous.
//
// Race rule: directory walks and file reads use lstat (never stat/follow)
// and files are opened with O_NOFOLLOW so a symlink substituted between the
// directory listing and the read refuses instead of leaking outside bytes.
// Callers that need bytes for hashing, snapshot copies and diff text must
// use collectArtifactFilesWithBytes exactly once per review; reopening the
// same path later re-validates and may observe different bytes.

import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const ARTIFACT_LIMITS = Object.freeze({
  maxFiles: 64,
  maxFileBytes: 128000,
  maxTotalBytes: 512000,
  maxDepth: 8,
});
// The real harness already approaches the tiny sample's total-size ceiling.
// Keep sample compatibility while bounding practical project increments.
export const PROJECT_ARTIFACT_LIMITS = Object.freeze({...ARTIFACT_LIMITS,maxFiles:256,maxTotalBytes:4*1024*1024});

export const SAMPLE_EXCLUDED_TOP = Object.freeze(['.git', '.presence', '.muse', '.verification']);
export const PROJECT_EXCLUDED_ANYWHERE = Object.freeze([
  '.git', '.presence', '.muse', '.verification', '.local', '.a2', '.codex',
  '.claude', '.venv', 'node_modules', '__pycache__', 'private', 'evidence', 'recordings',
]);
const SECRET_PATTERNS = [/\.pem$/i, /credential/i, /secret/i, /(^|[._-])token([._-]|$)/i, /(^|[._-])auth([._-]|$)/i];
// Narrowly explicit public dotfile exceptions. Every other dotfile, and any
// file under a hidden (dot-leading) ancestor directory, is excluded.
const PUBLIC_DOTFILES = new Set(['.gitignore', '.env.example']);
const ALLOWED_DOTFILES = PUBLIC_DOTFILES;

const SAMPLE_ALLOWED = /\.(m?js|json|md|txt)$/;
const PROJECT_ALLOWED = /\.(m?js|json|md|txt|css|html|py)$/;
const EXTENSIONLESS_SAFE = /^(LICENSE|LICENCE|README|AGENTS|CLAUDE|NOTICE|CHANGELOG|CONTRIBUTING|Makefile|Dockerfile|[A-Z][A-Z0-9_-]*)$/;

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function isExcludedDir(name, mode) {
  if (mode === 'sample') return false; // caller checks top-level only, matching legacy behavior
  return PROJECT_EXCLUDED_ANYWHERE.includes(name);
}

export function validateRelativePath(rel) {
  if (typeof rel !== 'string' || !rel) throw Error('artifact_path_refused');
  if (path.isAbsolute(rel)) throw Error('artifact_path_refused');
  if (rel.includes('\0') || /[\x00-\x1f\x7f]/.test(rel)) throw Error('artifact_path_refused');
  if (rel.includes('\\')) throw Error('artifact_path_refused');
  if (rel.startsWith('-') || /^\.-|^\.\./.test(rel)) throw Error('artifact_path_refused');
  const parts = rel.split(path.sep);
  if (parts.length > ARTIFACT_LIMITS.maxDepth) throw Error('artifact_path_refused');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') throw Error('artifact_path_refused');
    if (part.startsWith('-')) throw Error('artifact_path_refused');
    if (/[\x00-\x1f\x7f]/.test(part)) throw Error('artifact_path_refused');
  }
  return parts;
}

export function classifyFile(rel, mode = 'sample') {
  const parts = validateRelativePath(rel);
  if (mode === 'sample') {
    if (SAMPLE_ALLOWED.test(rel)) return 'include';
    throw Error('artifact_type_refused');
  }
  for (const part of parts) {
    if (PROJECT_EXCLUDED_ANYWHERE.includes(part)) return 'exclude';
  }
  // Hidden ancestors exclude, with only narrowly explicit public exceptions.
  // The check walks every ancestor part, not just the leaf name.
  const base = parts[parts.length - 1];
  for (const part of parts.slice(0, -1)) {
    if (part.startsWith('.')) return 'exclude';
  }
  if (base.startsWith('.') && !PUBLIC_DOTFILES.has(base)) return 'exclude';
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(rel) && base !== '.env.example') return 'exclude';
  }
  if (PROJECT_ALLOWED.test(rel)) return 'include';
  if (!base.includes('.') && EXTENSIONLESS_SAFE.test(base)) return 'include';
  if (PUBLIC_DOTFILES.has(base)) return 'include';
  throw Error('artifact_type_refused');
}

// Open a workspace-relative file without following symlinks, validate the
// opened descriptor with fstat, and read at most maxBytes. The workspace
// root itself is canonically resolved once by the caller; every ancestor of
// the target mustBe an owned directory (lstat: not a symlink). Returns the
// exact bytes that were hashed. Any symlink, type change, size violation or
// ancestor escape refuses.
export async function readFileNoFollow(workspaceRoot, rel, {maxBytes = ARTIFACT_LIMITS.maxFileBytes} = {}) {
  const parts = validateRelativePath(rel);
  const root = await fs.realpath(workspaceRoot);
  // Validate each ancestor through lstat: directories only, never symlinks.
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor = path.join(cursor, part);
    const st = await fs.lstat(cursor);
    if (st.isSymbolicLink() || !st.isDirectory()) throw Error('artifact_path_refused');
  }
  const full = path.join(root, rel);
  const assertContained = async () => {
    const real = await fs.realpath(full);
    if (real !== full || !real.startsWith(root + path.sep)) throw Error('artifact_path_refused');
  };
  await assertContained();
  const expected = await fs.lstat(full);
  if (expected.isSymbolicLink() || !expected.isFile()) throw Error('artifact_path_refused');
  let handle;
  try {
    handle = await fs.open(full, fssync.constants.O_RDONLY | fssync.constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === 'ELOOP') throw Error('artifact_path_refused');
    throw error;
  }
  try {
    const st = await handle.stat();
    await assertContained();
    if (!st.isFile() || st.dev !== expected.dev || st.ino !== expected.ino) throw Error('artifact_path_refused');
    if (st.size > maxBytes) throw Error('artifact_size_limit');
    // Bounded read of the opened descriptor (no path reopen).
    const chunks = [];
    let remaining = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(Math.min(65536, Math.max(1, remaining)));
    while (remaining > 0) {
      const {bytesRead} = await handle.read(buf, 0, Math.min(buf.length, remaining));
      if (!bytesRead) break;
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
      remaining -= bytesRead;
    }
    const body = Buffer.concat(chunks);
    const after = await handle.stat();
    await assertContained();
    if (body.length !== st.size || after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs) throw Error('artifact_path_refused');
    return body;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function walkValidated(workspace, mode, onFile) {
  const limits=mode==='project'?PROJECT_ARTIFACT_LIMITS:ARTIFACT_LIMITS;
  const files = [];
  let total = 0;
  async function walk(relative = '') {
    const entries = await fs.readdir(path.join(workspace, relative), {withFileTypes: true});
    for (const entry of entries) {
      const rel = path.join(relative, entry.name);
      if (!relative && SAMPLE_EXCLUDED_TOP.includes(entry.name)) continue;
      if (mode === 'project' && isExcludedDir(entry.name, 'project')) continue;
      const full = path.join(workspace, rel);
      const info = await fs.lstat(full);
      if (info.isSymbolicLink()) throw Error('artifact_path_refused');
      if (rel.split(path.sep).length > ARTIFACT_LIMITS.maxDepth) throw Error('artifact_path_refused');
      if (info.isDirectory()) {
        if (mode === 'project') {
          // Private control directories at any depth are excluded, never hashed.
          if (PROJECT_EXCLUDED_ANYWHERE.includes(entry.name)) continue;
          // Hidden directories at any depth are excluded, never hashed.
          if (entry.name.startsWith('.')) continue;
          // Submodule boundary: a nested .git entry means foreign history.
          try {
            const inner = await fs.lstat(path.join(full, '.git'));
            if (inner) throw Error('artifact_path_refused');
          } catch (error) {
            if (error.message === 'artifact_path_refused') throw error;
          }
        }
        await walk(rel);
        continue;
      }
      if (!info.isFile()) throw Error('artifact_path_refused');
      if (info.size > limits.maxFileBytes) throw Error('artifact_size_limit');
      if (mode === 'sample') {
        if (!SAMPLE_ALLOWED.test(rel)) throw Error('artifact_type_refused');
      } else {
        const verdict = classifyFile(rel, 'project');
        if (verdict === 'exclude') continue;
      }
      if (files.length >= limits.maxFiles) throw Error('artifact_size_limit');
      // Single no-follow read: these exact bytes are hashed, snapshotted and
      // diffed. Never reopened unchecked elsewhere for the same review.
      const body = await readFileNoFollow(workspace, rel);
      total += body.length;
      if (total > limits.maxTotalBytes) throw Error('artifact_size_limit');
      const record = {path: rel, sha256: sha256(body)};
      files.push(record);
      if (onFile) await onFile(record, body);
    }
  }
  await walk();
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {files, total};
}

export async function collectArtifactFiles(workspace, mode = 'sample') {
  const {files} = await walkValidated(workspace, mode, null);
  return files;
}

// Capture once: returns sorted file records plus a Map of path -> exact
// bytes read for those records. The bytes carried here must feed the
// manifest hash, the snapshot copy and any untracked diff text for the
// same review instead of reopening unchecked paths.
export async function collectArtifactFilesWithBytes(workspace, mode = 'sample') {
  const bytes = new Map();
  const {files} = await walkValidated(workspace, mode, (record, body) => {
    bytes.set(record.path, body);
  });
  return {files, bytes};
}

export function hashArtifactFiles(files) {
  return sha256(JSON.stringify(files));
}

export async function hashWorkspace(workspace, mode = 'sample') {
  return hashArtifactFiles(await collectArtifactFiles(workspace, mode));
}
