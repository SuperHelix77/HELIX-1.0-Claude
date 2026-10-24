import fs from 'node:fs';
import path from 'node:path';
const iso = sec => new Date(sec * 1000).toISOString();
function tail(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try { const size = fs.fstatSync(fd).size, start = Math.max(0, size - bytes), buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start); return buf.toString('utf8').split('\n').slice(start ? 1 : 0); }
  finally { fs.closeSync(fd); }
}
function streamFiles(roots) {
  const found = [];
  const walk = (dir, depth) => {
    let entries; try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const e of entries) {
      const f = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory() && depth < 3) walk(f, depth + 1);
      else if (e.isFile() && e.name.endsWith('.stream.jsonl')) { try { found.push({f, m: fs.statSync(f).mtimeMs}); } catch {} }
    }
  };
  for (const r of roots) walk(r, 0);
  return found.sort((a, b) => b.m - a.m).slice(0, 3);
}
// Newest observation per window across statusline log, stream rate_limit_event lines and benchmark driver status.
export function planLimits({home, benchRoot, now = Date.now()}) {
  const best = {five_hour: null, seven_day: null};
  const offer = (w, utilization, resetsSec, observedMs, source) => {
    if (!(w in best) || !Number.isFinite(utilization) || !Number.isFinite(observedMs)) return;
    if (!best[w] || observedMs >= best[w].observed) best[w] = {utilization, resets: Number.isFinite(resetsSec) ? resetsSec : null, observed: observedMs, source};
  };
  const usageLog = path.join(home, '.claude', 'usage-log.jsonl');
  try { for (const line of tail(usageLog, 65536)) { try {
    const d = JSON.parse(line);
    for (const [w, v] of Object.entries(d.rate_limits || {})) offer(w, Number(v.used_percentage) / 100, Number(v.resets_at), Number(d.t) * 1000, 'statusline');
  } catch {} } } catch {}
  const roots = [path.join(home, '.claude-lean', 'logs'), benchRoot].filter(Boolean);
  for (const {f, m} of streamFiles(roots)) { try { for (const line of tail(f, 262144)) {
    if (!line.includes('rate_limit_event')) continue;
    try { const d = JSON.parse(line); for (const [w, v] of Object.entries(d.rate_limit_info?.unifiedWindows || {})) offer(w, Number(v.utilization), Number(v.resetsAt), m, 'stream'); } catch {}
  } } catch {} }
  if (benchRoot) try {
    const s = JSON.parse(fs.readFileSync(path.join(benchRoot, 'driver-status.json'), 'utf8')), u = s.last_utilization || {};
    const at = Date.parse(u.observed_at || s.updated_at);
    for (const w of ['five_hour', 'seven_day']) offer(w, Number(u[w]), Number(u[`${w}_resets_at`]), at, 'benchmark');
  } catch {}
  const windows = {};
  for (const w of Object.keys(best)) {
    const b = best[w];
    if (!b) { windows[w] = {utilization: null, resets_at: null, observed_at: null, state: 'unknown', source: null}; continue; }
    const expired = b.resets !== null && now > b.resets * 1000;
    windows[w] = {utilization: expired ? null : Math.round(b.utilization * 10000) / 10000, resets_at: b.resets === null ? null : iso(b.resets), observed_at: new Date(b.observed).toISOString(),
      state: expired ? 'expired' : now - b.observed < 600000 ? 'fresh' : 'stale', source: b.source, ...(expired ? {label: 'reset since last observation'} : {})};
  }
  return {schema: 'helix.limits.v1', windows};
}
