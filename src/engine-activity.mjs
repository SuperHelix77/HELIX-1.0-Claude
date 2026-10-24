import fs from 'node:fs';
import path from 'node:path';
function recent(dir, re, count) {
  try { return fs.readdirSync(dir).filter(n => re.test(n)).map(n => { const f = path.join(dir, n); return {f, m: fs.statSync(f).mtimeMs}; }).sort((a, b) => b.m - a.m).slice(0, count); } catch { return []; }
}
function verb(cmd) {
  const t = String(cmd || '').trim().split(/\s+/).filter(x => !/^\w+=/.test(x));
  const first = path.posix.basename(t[0] || '');
  return first === 'rtk' && t[1] && /^[\w-]+$/.test(t[1]) ? `rtk ${t[1]}` : first;
}
// Only kind and first command token leave this module; command text, cwd and results never do.
export function engineActivity(home, {now = Date.now(), shell = true} = {}) {
  const lean = path.join(home, '.claude-lean'), out = {flows: [], shell: []};
  for (const {f, m} of recent(path.join(lean, 'offload'), /^hx-.*\.json$/, 10)) {
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8')), failed = Number.isFinite(d.failed) ? d.failed : -1;
      out.flows.push({id: String(d.id || path.basename(f, '.json')).slice(0, 32), steps: Array.isArray(d.steps) ? d.steps.length : 0, failed: Math.max(0, failed),
        status: failed > 0 ? 'failed' : failed === 0 ? 'ok' : 'unknown', at: new Date(m).toISOString()});
    } catch {}
  }
  if (!shell) return out;
  const events = [];
  for (const {f} of recent(path.join(lean, 'logs'), /^activity-.*\.jsonl$/, 3)) {
    let text; try { const size = fs.statSync(f).size, fd = fs.openSync(f, 'r'); const len = Math.min(size, 131072), b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, size - len); fs.closeSync(fd); text = b.toString('utf8'); } catch { continue; }
    const starts = new Map();
    for (const line of text.split('\n')) { let d; try { d = JSON.parse(line); } catch { continue; }
      if (d.ev === 'start') starts.set(d.n, d.t);
      else if (d.ev === 'end') events.push({t: d.t, kind: String(d.kind || ''), verb: verb(d.rewritten || d.cmd), ms: Number.isFinite(d.secs) ? Math.round(d.secs * 1000) : starts.has(d.n) ? Math.round((d.t - starts.get(d.n)) * 1000) : null,
        dup: !!d.dup, rewritten: !!d.rewritten, lines: Number.isFinite(d.lines) ? d.lines : null, chars: Number.isFinite(d.chars) ? d.chars : null}); }
  }
  out.shell = events.sort((a, b) => b.t - a.t).slice(0, 30).map(({t, ...e}) => ({at: new Date(t * 1000).toISOString(), ...e}));
  return out;
}
