import fs from 'node:fs';
import path from 'node:path';
const read = (root, names) => { for (const n of names) try { return JSON.parse(fs.readFileSync(path.join(root, n), 'utf8')); } catch {} return null; };
const pct = (arr, p) => { if (!arr?.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const num = v => Number.isFinite(v) ? v : null;
export function runsView(root, tilde = x => x) {
  const base = {schema: 'helix.runs.v1', root: root ? tilde(root) : null, driver: null, baseline: null, lanes: [], tasks: []};
  if (!root) return base;
  const results = read(root, ['results.final.json', 'results.partial.json']), metrics = read(root, ['metrics.final.json', 'metrics.json']) || {};
  const status = read(root, ['driver-status.json']);
  if (status) { const u = status.last_utilization || {}; base.driver = {phase: status.phase ?? null, task: status.task ?? null, lane: status.lane ?? null, updated_at: status.updated_at ?? null, last_utilization: {five_hour: num(u.five_hour), seven_day: num(u.seven_day)}}; }
  base.baseline = results?.baseline ?? null;
  const tasks = new Map();
  for (const l of results?.lanes || []) {
    const m = metrics[l.lane] || {}, models = Object.entries(m.models || {}).map(([model, v]) => ({model, input: num(v.input), output: num(v.output), cache_read: num(v.cache_read), cache_write: num(v.cache_write), cost_usd: num(v.cost)}));
    const denom = models.reduce((s, x) => s + (x.input || 0) + (x.cache_read || 0) + (x.cache_write || 0), 0);
    const read_ = models.reduce((s, x) => s + (x.cache_read || 0), 0);
    base.lanes.push({lane: l.lane, model: l.model ?? null, effort: l.effort ?? null, attempted: num(l.attempted), resolved: num(l.resolved),
      graded: num(m.graded) ?? (Number.isFinite(l.attempted) ? l.attempted - (l.ungraded || 0) : null), requests: num(m.calls), cost_usd: num(l.cost_usd), processed: num(l.processed), output: num(l.output),
      ctx: {p50: num(pct(m.ctx, 0.5)), p90: num(pct(m.ctx, 0.9)), max: num(m.ctx?.length ? Math.max(...m.ctx) : null)}, cache_hit: denom ? read_ / denom : null,
      savings: {processed_pct: num(l.processed_savings_percent), cost_pct: num(l.cost_savings_percent)}, models});
    for (const t of l.tasks || []) {
      const row = tasks.get(t.task) || {task: t.task, instance: t.instance_id ?? null, lanes: {}}; tasks.set(t.task, row);
      row.lanes[l.lane] = {resolved: typeof t.resolved === 'boolean' ? t.resolved : null, requests: num(t.requests), processed: num(t.processed), output: num(t.output), cost_usd: num(t.cost_usd), status: t.status ?? null};
    }
  }
  base.tasks = [...tasks.values()].sort((a, b) => String(a.task).localeCompare(String(b.task)));
  return base;
}
