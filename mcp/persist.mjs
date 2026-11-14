// persist.mjs — the bridge's files under /data and their encryption. No store access, so the tests and the
// operator's graveyard tool can import it without loading the app's module singletons.
//
//   key           {code, tz} of the connected vault (0600). Present = connected.
//   owner         sha256(auth token) of the vault that owns this bridge, hex (0600). Survives disconnect.
//   replica.bin   AES-GCM {records, cursor, outbox, dev, hlc, meta, baseline, clean}
//   graveyard.bin one line per delete_forever/empty_trash: "<ms>\t<base64url AES-GCM {t, ids, records}>"
//   audit.jsonl   request metadata only (never arguments or results), rotated 1 MB × 3
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const FILES = { key: 'key', owner: 'owner', replica: 'replica.bin', graveyard: 'graveyard.bin', audit: 'audit.jsonl' };

/** sha256 of the hex auth token, as lists-sync stores it (vaults.token_sha256), in hex. */
export const tokenDigest = (tok) => createHash('sha256').update(tok).digest('hex');
export function sameDigest(a, b) {
  const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
  return x.length === 32 && y.length === 32 && timingSafeEqual(x, y);
}

/** The bridge's own file key: HKDF from the 32-byte vault key, domain-separated from the sync keys. */
export const localKey = (raw) => Buffer.from(hkdfSync('sha256', raw, Buffer.alloc(32), 'lists/mcp-local/v1', 32));

/** obj → 0x01 ‖ iv(12) ‖ ciphertext ‖ tag(16). `aad` binds the blob to its file. */
export function seal(key, obj, aad) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, ct, c.getAuthTag()]);
}
export function unseal(key, buf, aad) {
  if (buf[0] !== 1 || buf.length < 29) throw Error('bad blob');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(13, buf.length - 16)), d.final()]).toString('utf8'));
}

/**
 * seal() for a big value, straight to disk: string chunks go through the cipher one by one, so the whole
 * plaintext and ciphertext never sit in memory at once (a 10k-item replica is ~4 MB of JSON). Same format
 * as seal(), written atomically like atomicWrite().
 */
export function sealChunksTo(path, key, aad, chunks) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const tmp = path + '.tmp', fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, Buffer.concat([Buffer.from([1]), iv]));
    for (const s of chunks) { const b = c.update(s); if (b.length) writeSync(fd, b); }
    writeSync(fd, Buffer.concat([c.final(), c.getAuthTag()]));
    fsyncSync(fd);
  } finally { closeSync(fd); }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}

const fsyncDir = (dir) => { const fd = openSync(dir, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } };

/** Write tmp, fsync, rename over, fsync the directory: a crash leaves the old file or the new one, never half. */
export function atomicWrite(path, data) {
  const tmp = path + '.tmp', fd = openSync(tmp, 'w', 0o600);
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}

/** Remove files (missing ones are fine) and make the removal durable. */
export function wipe(dir, names) {
  for (const n of names) { rmSync(join(dir, n), { force: true }); rmSync(join(dir, n + '.tmp'), { force: true }); }
  fsyncDir(dir);
}

export function readOr(path, fallback) {
  try { return readFileSync(path); } catch { return fallback; }
}

/* ---------------- graveyard ---------------- */
const GRAVE_AAD = 'lists-mcp/graveyard';

/**
 * Append one entry, dropping entries older than `days`. Never evicts a younger one: when the kept entries plus
 * this one pass `maxBytes`, it throws GRAVE_FULL and writes nothing (one entry alone may pass the cap).
 */
export function graveAppend(path, key, entry, { days, maxBytes, now = Date.now() }) {
  const line = `${now}\t${seal(key, entry, GRAVE_AAD).toString('base64url')}`;
  const keep = String(readOr(path, '')).split('\n').filter((l) => l && +l.split('\t', 1)[0] > now - days * 864e5);
  const size = keep.reduce((s, l) => s + l.length + 1, 0) + line.length + 1;
  if (keep.length && size > maxBytes) throw Object.assign(new Error('graveyard full'), { code: 'GRAVE_FULL' });
  keep.push(line);
  atomicWrite(path, keep.join('\n') + '\n');
}
export function graveRead(path, key) {
  return String(readOr(path, '')).split('\n').filter(Boolean).map((l) => unseal(key, Buffer.from(l.split('\t')[1], 'base64url'), GRAVE_AAD));
}
