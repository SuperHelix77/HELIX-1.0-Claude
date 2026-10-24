// Synthetic, public fixture (helix.usage.v1). Codex rows are unpriced on purpose.
const SCALE = {'5h': 0.3, today: 1, '7d': 5, '30d': 20};
const tk = (k, hit = 0.9) => ({input: Math.round(1200 * k), cache_write_5m: Math.round(40000 * k), cache_write_1h: Math.round(8000 * k), cache_read: Math.round(900000 * k * hit), output: Math.round(30000 * k)});
const row = (id, label, family, k, cost, extra = {}) => ({id, label, family, requests: Math.round(100 * k), tokens: tk(k), cache_hit: 0.9, cost_usd: cost == null ? null : +(cost * k).toFixed(4), basis: cost == null ? 'unpriced' : 'list',
  main: {requests: Math.round(90 * k), cost_usd: cost == null ? null : +(cost * k * 0.9).toFixed(4)}, subagents: {requests: Math.round(10 * k), cost_usd: cost == null ? null : +(cost * k * 0.1).toFixed(4)}, ...extra});
export function usageFixture({range = 'today', group = 'model'} = {}, now = Date.now()) {
  const k = SCALE[range] ?? 1;
  let rows;
  if (group === 'session') {
    rows = [row('9f2c41d0a1b2c3d4', 'Checkout redesign', 'opus', k * 2, 5.1, {children: [{id: 'a033c34f', label: 'lean · Trace pricing rules', family: 'haiku', requests: Math.round(8 * k), cost_usd: +(0.03 * k).toFixed(4)}, {id: 'b1', label: 'explore · Find cart reducers', family: 'sonnet', requests: Math.round(4 * k), cost_usd: +(0.19 * k).toFixed(4)}]}),
      row('1a2b3c4d5e6f7a8b', 'API pagination fix', 'sonnet', k, 1.4, {children: []}), row('c0dec0dec0dec0de', 'Refactor build script', 'codex', k, null, {children: []})];
  } else if (group === 'project') {
    rows = [row('demo-shop', 'demo-shop', 'opus', k * 2, 5.1), row('demo-api', 'demo-api', 'sonnet', k, 1.4), row('demo-tools', 'demo-tools', 'codex', k, null)];
  } else {
    rows = [row('claude-opus-5-5', 'Opus 5.5', 'opus', k * 3, 3.9), row('claude-sonnet-5-5', 'Sonnet 5.5', 'sonnet', k, 1.9), row('claude-haiku-5-5', 'Haiku 5.5', 'haiku', k * 2, 0.012), row('gpt-5.5-codex', 'gpt-5.5-codex', 'codex', k, null)];
  }
  const priced = rows.filter(r => r.cost_usd != null);
  const sum = key => rows.reduce((a, r) => a + (r.tokens[key] || 0), 0);
  const n = range === '30d' ? 30 : range === '7d' ? 7 : range === 'today' ? 8 : 5;
  const step = range === '7d' || range === '30d' ? 864e5 : 36e5;
  const series = Array.from({length: n}, (_, i) => ({bucket: new Date(Math.floor(now / step) * step - (n - 1 - i) * step).toISOString(),
    by_family: {opus: +((1 + (i % 4)) * 0.8 * (range === '5h' ? 0.5 : 1)).toFixed(2), sonnet: +(0.3 + (i % 3) * 0.2).toFixed(2), haiku: 0.01, ...(i % 2 ? {codex: 0} : {})}}));
  return {schema: 'helix.usage.v1', range, group, from: new Date(now - 864e5).toISOString(), to: new Date(now).toISOString(),
    totals: {requests: rows.reduce((a, r) => a + r.requests, 0), input: sum('input'), cache_write_5m: sum('cache_write_5m'), cache_write_1h: sum('cache_write_1h'), cache_read: sum('cache_read'), output: sum('output'), thinking: 0,
      cache_hit: 0.9, cost_usd: +priced.reduce((a, r) => a + r.cost_usd, 0).toFixed(4), basis: 'list', unpriced_requests: rows.filter(r => r.cost_usd == null).reduce((a, r) => a + r.requests, 0)},
    series, rows};
}
