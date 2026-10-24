import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const DROP = new Set(['ownerAccountUuid', 'ownerOrganizationUuid', 'accountUuid', 'organizationUuid', 'bridgeSessionId', 'cwd', 'cmd', 'prompt', 'prompts', 'email']);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function redactString(value, {home = os.homedir(), fullPaths = false} = {}) {
  let s = String(value);
  for (const h of new Set([home, os.homedir()].filter(x => x && x.length > 1))) s = s.replace(new RegExp(escapeRe(h.replace(/\/$/, '')) + '(?=/|$|[^\\w.-])', 'g'), '~');
  s = s.replace(/\/(?:Users|home)\/[^/\s'"`]+\//g, '~/').replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, '~/');
  s = s.replace(/[^\s@'"`<>]+@[^\s@'"`<>]+\.[^\s@'"`<>]+/g, '[email]');
  if (!fullPaths) s = s.replace(/(?<![\w:/.])(?:~\/[^\s"'`<>|;,)]*|\/[^\s"'`<>|;,)]*\/[^\s"'`<>|;,)]*)/g, m => path.posix.basename(m.replace(/\/+$/, '')) || m);
  return s;
}
// Tilde-form root keys are shown by design (spec 5.4); everything else obeys show_full_paths.
const TILDE_KEYS = new Set(['root', 'bench_root']);
export function redact(value, options = {}) {
  if (typeof value === 'string') return redactString(value, options);
  if (Array.isArray(value)) return value.map(v => redact(v, options));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!DROP.has(k)) out[k] = TILDE_KEYS.has(k) && typeof v === 'string' ? redactString(v, {...options, fullPaths: true}) : redact(v, options);
    return out;
  }
  return value;
}
export const tildePath = (file, home = os.homedir()) => file.startsWith(home) ? '~' + file.slice(home.length) : file;
export const opaqueKey = file => createHash('sha256').update(file).digest('hex').slice(0, 16);
