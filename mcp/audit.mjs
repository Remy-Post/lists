// audit.mjs — one JSON line per request in /data/audit.jsonl: time, client IP, user agent, MCP client name,
// JSON-RPC method, tool, the ids it touched (existing ids only) and counts. Never arguments, never results,
// never item text. Rotates at 1 MB, keeping 3 files. Refused requests (429/503) are summed per IP and
// minute, so a flood can't roll the evidence away.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { L } from './limits.mjs';

const ctx = new AsyncLocalStorage();
const printableIp = (ip) => String(ip).replace(/[^0-9a-fA-F.:]/g, '?').slice(0, 45);
let path = null, size = 0;

export function openAudit(dir) {
  path = join(dir, 'audit.jsonl');
  try { size = statSync(path).size; } catch { size = 0; }
}

const LINE_MAX = 4096; // a normal line (50 ids, ua, client) stays well under this
function write(entry, max = LINE_MAX) {
  if (!path) return;
  let line = JSON.stringify(entry) + '\n';
  // No single entry may rotate the files: an oversized one keeps who, when and how big, nothing else.
  if (line.length > max) line = JSON.stringify({ t: entry.t, id: entry.id, ip: entry.ip, ua: entry.ua, status: entry.status, oversize: line.length }) + '\n';
  try {
    if (size + line.length > L.auditBytes) {
      try { renameSync(path + '.1', path + '.2'); } catch { /* first rotation */ }
      try { renameSync(path, path + '.1'); } catch { /* nothing yet */ }
      size = 0;
    }
    appendFileSync(path, line, { mode: 0o600 });
    size += line.length;
  } catch (e) { console.log(`[audit] write failed: ${e.code || e.name}`); }
}

/** Run `fn` with a fresh audit entry for this request; the entry is written when `fn` settles. */
export async function withAudit(base, fn) {
  const entry = { t: new Date().toISOString(), id: randomBytes(4).toString('hex'), ...base };
  try { return await ctx.run(entry, fn); } finally { write(entry); }
}
/** Add fields to the current request's entry (no-op outside a request). */
export const note = (fields) => { const e = ctx.getStore(); if (e) Object.assign(e, fields); };
export const currentAuditId = () => ctx.getStore()?.id ?? null;

/* Refusals: counted per minute and IP, written as one summary line per minute (at most 200 keys a line;
   past that, new IPs are summed under "other <status>"). */
const REFUSED_KEYS = 200;
let refused = new Map(), flushTimer = 0;
export function refusedOnce(ip, status) {
  let k = `${printableIp(ip)} ${status}`;
  if (!refused.has(k) && refused.size >= REFUSED_KEYS) k = `other ${status}`;
  refused.set(k, (refused.get(k) || 0) + 1);
  if (!flushTimer) flushTimer = setTimeout(flushRefused, 60_000).unref();
}
function flushRefused() {
  flushTimer = 0;
  if (!refused.size) return;
  const counts = Object.fromEntries(refused);
  refused = new Map();
  write({ t: new Date().toISOString(), refused: counts }, REFUSED_KEYS * 64); // bounded by the key cap
}
export { flushRefused };
