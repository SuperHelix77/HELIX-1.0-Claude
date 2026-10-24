// Synthetic, public fixture (helix.live.v1). Fields the UI must never render (prompt, cwd) are included on purpose.
export const SENTINEL_PROMPT = 'SENTINEL_PROMPT_DO_NOT_RENDER';
const iso = (now, seconds) => new Date(now - seconds * 1000).toISOString();
const act = (now, s, kind, label, status = 'ok') => ({at: iso(now, s), kind, label, status});
export function liveFixture(now = Date.now()) {
  const opus = {key: '9f2c41d0a1b2c3d4', source: 'claude', title: 'Checkout redesign', project: 'demo-shop', model: 'claude-opus-5-5', family: 'opus',
    status: 'working', active: true, updated_at: iso(now, 4), prompt: SENTINEL_PROMPT, cwd: '~/projects/demo',
    current: {kind: 'tool', label: 'Running Bash · Run UI tests', since: iso(now, 12)},
    actions: [act(now, 30, 'tool', 'Read · Cart.jsx'), act(now, 22, 'tool', 'Edit · Cart.jsx'), act(now, 18, 'skill', 'brainstorming'), act(now, 15, 'agent', 'lean · Trace pricing rules'), act(now, 12, 'tool', 'Running Bash · Run UI tests', 'running'), act(now, 90, 'user', 'Prompt received'), act(now, 80, 'reply', 'Reply')],
    context: {tokens: 72018, window: 1000000},
    tokens: {input: 2, cache_write_5m: 72018, cache_write_1h: 0, cache_read: 411200, output: 10040, thinking: 424},
    cost: {session_usd: 4.82, last_request_usd: 0.031, basis: 'list'},
    subagents: [
      {id: 'a033c34f', agent_type: 'lean', description: 'Trace pricing rules', model: 'claude-haiku-5-5', family: 'haiku', status: 'working', tokens: {input: 12, cache_write_1h: 876, cache_read: 1891, output: 44}, cost_usd: 0.002},
      {id: 'b1', agent_type: 'explore', description: 'Find cart reducers', model: 'claude-sonnet-5-5', family: 'sonnet', status: 'done', tokens: {input: 40, cache_read: 52000, output: 1800}, cost_usd: 0.19},
      {id: 'b2', agent_type: 'lean', description: 'Summarise test output', model: 'claude-haiku-5-5', family: 'haiku', status: 'done', tokens: {input: 8, cache_read: 3000, output: 90}, cost_usd: 0.001},
      {id: 'b3', agent_type: 'lean', description: 'List changed files', model: 'claude-haiku-5-5', family: 'haiku', status: 'done', tokens: {input: 8, output: 30}, cost_usd: 0.0004},
      {id: 'b4', agent_type: 'lean', description: 'Check lint config', model: 'claude-haiku-5-5', family: 'haiku', status: 'done', tokens: {input: 8, output: 30}, cost_usd: 0.0004}]};
  const sonnet = {key: '1a2b3c4d5e6f7a8b', source: 'claude', title: 'API pagination fix', project: 'demo-api', model: 'claude-sonnet-5-5', family: 'sonnet',
    status: 'waiting', active: false, updated_at: iso(now, 300), current: null,
    actions: [act(now, 320, 'tool', 'Edit · paginate.mjs'), act(now, 310, 'tool', 'Running Bash · Run node tests'), act(now, 305, 'mcp', 'github · create_pr', 'error'), act(now, 302, 'reply', 'Reply')],
    context: {tokens: 780000, window: 1000000}, tokens: {input: 30, cache_write_5m: 90000, cache_read: 2400000, output: 22000},
    cost: {session_usd: 1.37, last_request_usd: 0.12, basis: 'list'}, subagents: []};
  const codex = {key: 'c0dec0dec0dec0de', source: 'codex', title: 'Refactor build script', project: 'demo-tools', model: 'gpt-5.5-codex', family: 'codex',
    status: 'idle', active: false, updated_at: iso(now, 14 * 60), current: null, actions: [act(now, 840, 'reply', 'Reply')],
    tokens: {input: 120000, cached: 90000, output: 4000}, cost: {session_usd: null, basis: 'unpriced'}, subagents: []};
  return {schema: 'helix.live.v1', generated_at: new Date(now).toISOString(), totals: {active_sessions: 1, cost_today_usd: 12.4}, sessions: [sonnet, codex, opus],
    engine: {flows: [{id: 'mluy02td', steps: 3, failed: 0, status: 'ok', at: iso(now, 100)}, {id: 'k2x9aa01', steps: 1, failed: 1, status: 'failed', at: iso(now, 900)}],
      shell: [{at: iso(now, 20), kind: 'sh', verb: 'rtk find', ms: 3580, dup: false, rewritten: true, lines: 40}, {at: iso(now, 50), kind: 'sh', verb: 'rtk git', ms: 120, dup: true, rewritten: false, lines: 0}]},
    stats: {files_scanned: 12, skipped_lines: 0, read_ms: 18}};
}
export function liveSessionFixture(key, now = Date.now()) {
  const session = liveFixture(now).sessions.find(item => item.key === key) || liveFixture(now).sessions[0];
  const timeline = Array.from({length: 12}, (_, i) => act(now, 20 + i * 25, i % 3 ? 'tool' : 'reply', i % 3 ? `Read · file-${i}.mjs` : 'Reply'));
  const req = (i, model, fam, side) => ({at: iso(now, 30 + i * 40), model, family: fam, sidechain: side, agent: side ? 'lean' : null, input: 2, cache_write_5m: 1200 * i, cache_write_1h: 0, cache_read: 40000 + i * 900, output: 300 + i * 20, cost_usd: 0.02 + i / 100, basis: 'list'});
  return {schema: 'helix.live-session.v1', session, timeline,
    requests: [req(1, session.model, session.family, false), req(2, session.model, session.family, false), req(3, 'claude-haiku-5-5', 'haiku', true)],
    by_model: [{model: session.model, family: session.family, requests: 2, tokens: {input: 4, output: 640}, cost_usd: 0.05}, {model: 'claude-haiku-5-5', family: 'haiku', requests: 1, tokens: {input: 2, output: 360}, cost_usd: 0.002}]};
}
