// Self-contained static report (inline CSS, no scripts) for phones. Inputs are already redacted; every value is HTML-escaped.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const usd = v => v === null || v === undefined ? 'n/a' : `$${v.toFixed(v < 1 ? 3 : 2)}`;
const pct = v => v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`;
const n = v => Number.isFinite(v) ? v.toLocaleString('en-US') : 'n/a';
const meter = (label, w) => `<div class="m"><b>${esc(label)}</b> <span>${w.state === 'expired' ? 'reset since last observation' : pct(w.utilization)} · ${esc(w.state)}</span>${w.resets_at ? ` <small>resets ${esc(w.resets_at)}</small>` : ''}<div class="bar"><i style="width:${Math.round((w.utilization || 0) * 100)}%"></i></div></div>`;
export function renderSnapshot({live, usage, limits, runs, generated}) {
  const cards = live.sessions.map(s => `<section class="c"><h3>${esc(s.title)}</h3><p>${esc(s.model || 'unknown')} · ${esc(s.status)}${s.active ? ' · active' : ''}</p>
    ${s.current ? `<p>${esc(s.current.label)}</p>` : ''}<p>Context ${n(s.context.tokens)} / ${n(s.context.window)} · ${usd(s.cost.session_usd)} (${esc(s.cost.basis)})</p>
    ${s.subagents.length ? `<p><small>${s.subagents.length} subagent(s): ${s.subagents.map(a => `${esc(a.agent_type || 'agent')} ${esc(a.status)} ${usd(a.cost_usd)}`).join(', ')}</small></p>` : ''}</section>`).join('') || '<p>No active sessions.</p>';
  const rows = usage.rows.slice(0, 12).map(r => `<tr><td>${esc(r.label)}</td><td>${n(r.requests)}</td><td>${n(r.tokens.input + r.tokens.cache_write_5m + r.tokens.cache_write_1h + r.tokens.cache_read)}</td><td>${n(r.tokens.output)}</td><td>${pct(r.cache_hit)}</td><td>${usd(r.cost_usd)}</td></tr>`).join('');
  const lanes = (runs.lanes || []).map(l => `<tr><td>${esc(l.lane)}</td><td>${esc(l.model)}</td><td>${n(l.resolved)}/${n(l.attempted)}</td><td>${n(l.requests)}</td><td>${usd(l.cost_usd)}</td><td>${pct(l.cache_hit)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>HELIX snapshot</title><style>
body{font:15px/1.4 system-ui,sans-serif;margin:0;padding:12px;max-width:720px;margin-inline:auto}h1{font-size:20px}h2{font-size:17px;margin:20px 0 6px}h3{font-size:15px;margin:0}
.c{border:1px solid #8884;border-radius:8px;padding:8px 10px;margin:8px 0}.c p{margin:2px 0}.bar{height:8px;background:#8883;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:#2a9d8f}
.m{margin:8px 0}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:3px 5px;border-bottom:1px solid #8883;text-align:right}td:first-child,th:first-child{text-align:left}small{opacity:.7}.t{overflow-x:auto}
</style></head><body><h1>HELIX snapshot</h1><small>Generated ${esc(generated)} · read-only · no scripts</small>
<h2>Plan limits</h2>${meter('5 hour', limits.windows.five_hour)}${meter('Week', limits.windows.seven_day)}
<h2>Live (${n(live.totals.active_sessions)} active · ${usd(live.totals.cost_today_usd)} today)</h2>${cards}
<h2>Usage (${esc(usage.range)}): ${usd(usage.totals.cost_usd)}, ${n(usage.totals.requests)} requests</h2><div class="t"><table><tr><th>Model</th><th>Req</th><th>In</th><th>Out</th><th>Cache</th><th>Cost</th></tr>${rows}</table></div>
<h2>Runs</h2>${lanes ? `<div class="t"><table><tr><th>Lane</th><th>Model</th><th>Solved</th><th>Req</th><th>Cost</th><th>Cache</th></tr>${lanes}</table></div>` : '<p>No benchmark data.</p>'}
</body></html>`;
}
