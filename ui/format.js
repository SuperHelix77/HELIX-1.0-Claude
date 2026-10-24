export const MONO = {opus: 'O', sonnet: 'S', haiku: 'H', codex: 'Cx', other: '?'};
export const FAMILIES = ['opus', 'sonnet', 'haiku', 'codex', 'other'];
export const FAMILY_NAME = {opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', codex: 'Codex', other: 'Other'};
export const family = model => {
  const m = String(model || '');
  if (/opus/i.test(m)) return 'opus';
  if (/sonnet/i.test(m)) return 'sonnet';
  if (/haiku/i.test(m)) return 'haiku';
  if (/^(gpt|o\d|codex)/i.test(m)) return 'codex';
  return 'other';
};
export function modelName(model, fam = family(model)) {
  const m = String(model || '');
  const hit = /^claude-(opus|sonnet|haiku)-([\d-]+)/i.exec(m);
  if (hit) {
    const version = hit[2].split('-').filter(part => part && part.length <= 2).join('.');
    return `${FAMILY_NAME[fam]}${version ? ` ${version}` : ''}`;
  }
  return m || 'Unknown model';
}
export const isNum = value => typeof value === 'number' && Number.isFinite(value);
export function tokens(value) {
  if (!isNum(value)) return '—';
  const a = Math.abs(value);
  if (a < 1000) return String(Math.round(value));
  if (a < 1e6) return `${(value / 1e3).toFixed(a < 1e5 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(value / 1e6).toFixed(2)}M`;
}
export function money(value) {
  if (!isNum(value)) return '—';
  if (value < 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}
export function pct(value) {
  if (!isNum(value)) return '—';
  const v = value * 100;
  return v > 0 && v < 1 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
}
export const full = value => isNum(value) ? new Intl.NumberFormat('en-US').format(value) : 'Not reported by source';
export const sumTokens = t => !t ? 0 : (t.input || 0) + (t.cache_write_5m || 0) + (t.cache_write_1h || 0) + (t.cache_read || 0) + (t.cached || 0) + (t.output || 0);
// Defence in depth: the service redacts, the UI never renders paths or emails.
export const scrub = value => String(value ?? '')
  .replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, '~/').replace(/\/(?:Users|home)\/[^\s/]+\//g, '~/')
  .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');
const hm = new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
const hms = new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
const wd = new Intl.DateTimeFormat(undefined, {weekday: 'short'});
export const clock = value => isNum(Date.parse(value)) || isNum(value) ? hm.format(new Date(value)) : '—';
export const clockSeconds = value => value ? hms.format(new Date(value)) : '—';
export function resetLabel(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!isNum(t)) return '—';
  return t - now > 864e5 ? `${wd.format(new Date(t))} ${hm.format(new Date(t))}` : hm.format(new Date(t));
}
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!isNum(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}
export function elapsed(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!isNum(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}
export function inRel(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!isNum(t)) return '';
  const m = Math.round((t - now) / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  if (m < 1440) return `in ${Math.floor(m / 60)} h ${m % 60} min`;
  return `in ${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}
