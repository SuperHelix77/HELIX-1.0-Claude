// Synthetic, public benchmark-style data. Not a real run.
const repos = ['django', 'sympy', 'flask', 'pytest', 'sphinx'];
const lcg = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
export function runsFixture() {
  const rnd = lcg(7), tasks = [];
  const lanes = [['vanilla-continuous', 'claude-opus-5-5', 1.0], ['helixy', 'claude-opus-5-5', 0.7]].map(([lane, model, k]) => ({lane, model, effort: 'medium', k}));
  for (let i = 0; i < 50; i++) {
    const row = {task: `task-${String(i + 1).padStart(2, '0')}`, instance: `${repos[i % repos.length]}-${15000 + i * 37}`, lanes: {}};
    const base = 0.25 + rnd() * 0.9;
    for (const l of lanes) {
      const resolved = i % 9 === 8 ? null : rnd() < (l.lane === 'helixy' ? 0.62 : 0.58);
      const cost = base * l.k * (0.85 + rnd() * 0.3);
      row.lanes[l.lane] = {resolved, requests: Math.round(20 + rnd() * 40 * l.k), processed: Math.round((300 + rnd() * 700) * 1000 * l.k), output: Math.round(8000 + rnd() * 20000), cost_usd: resolved === null ? null : cost, status: resolved === null ? 'ungraded' : 'graded'};
    }
    tasks.push(row);
  }
  const sum = (lane, f) => tasks.reduce((s, t) => s + (t.lanes[lane][f] || 0), 0);
  const out = lanes.map(l => {
    const graded = tasks.filter(t => t.lanes[l.lane].resolved !== null);
    return {lane: l.lane, model: l.model, effort: l.effort, attempted: 50, resolved: graded.filter(t => t.lanes[l.lane].resolved).length, graded: graded.length, requests: sum(l.lane, 'requests'),
      cost_usd: sum(l.lane, 'cost_usd'), processed: sum(l.lane, 'processed'), output: sum(l.lane, 'output'), ctx: {p50: 92000 * l.k, p90: 168000 * l.k, max: 241000 * l.k}, cache_hit: l.lane === 'helixy' ? 0.91 : 0.86,
      savings: l.lane === 'helixy' ? {processed_pct: 31.2, cost_pct: 29.4} : {processed_pct: null, cost_pct: null},
      models: [{model: l.model, input: 1200000 * l.k, output: sum(l.lane, 'output'), cache_read: 38000000 * l.k, cache_write: 2100000 * l.k, cost_usd: sum(l.lane, 'cost_usd')}]};
  });
  return {schema: 'helix.runs.v1', root: '~/.claude-lean/bench/new50-full', driver: {phase: 'finished', task: null, lane: null, updated_at: new Date(Date.now() - 3600e3).toISOString(), last_utilization: {five_hour: 0.42, seven_day: 0.61}},
    baseline: 'vanilla-continuous', lanes: out, tasks};
}
