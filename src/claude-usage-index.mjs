import fs from 'node:fs';
import path from 'node:path';
import {priceRequest, familyOf, modelLabel, contextWindow, normalizeModel} from './pricing.mjs';
import {opaqueKey} from './redact.mjs';

const MAX_FILES = 4000, MAX_READ = 64 * 1024 * 1024, MAX_LINE = 256 * 1024, DAY = 86400000;
const ZERO = () => ({input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0, thinking: 0});
const add = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k] || 0; return a; };
const clip = s => String(s).length > 80 ? String(s).slice(0, 79) + '…' : String(s);
const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

export function actionLabel(name, input = {}) {
  let kind = 'tool', label = name, short = name;
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) { kind = 'mcp'; label = `${mcp[1]} · ${mcp[2]}`; short = mcp[1]; }
  else if (name === 'Bash') label = input.description ? `Bash · ${input.description}` : 'Bash';
  else if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(name)) label = `${name} · ${base(input.file_path || input.notebook_path)}`;
  else if (['Grep', 'Glob'].includes(name)) label = 'Search';
  else if (name === 'Agent' || name === 'Task') { kind = 'agent'; label = ['Agent', input.subagent_type, input.description].filter(Boolean).join(' · '); short = 'Agent'; }
  else if (name === 'Skill') { kind = 'skill'; label = `Skill · ${input.skill || input.name || ''}`.replace(/ · $/, ''); }
  else if (name === 'WebSearch') label = 'Web search';
  else if (name === 'WebFetch') { let host = ''; try { host = new URL(input.url).hostname; } catch {} label = host ? `Fetch · ${host}` : 'Fetch'; }
  return {kind, label: clip(label), short: clip(short)};
}

class Actor {
  constructor(id, meta = {}) { Object.assign(this, {id, agent_type: meta.agent_type ?? null, description: meta.description ?? null, finished: !!meta.finished,
    mtimeMs: 0, lastType: null, lastStop: null, pending: new Map(), actions: [], lastReq: null, lastTs: 0, replyId: null}); }
  push(a) { this.actions.push(a); if (this.actions.length > 50) this.actions.shift(); }
}

export class ClaudeUsageIndex {
  constructor({home, now = () => Date.now()} = {}) {
    this.projects = path.join(home, '.claude', 'projects'); this.lean = path.join(home, '.claude-lean'); this.now = now;
    this.files = new Map(); this.sessions = new Map(); this.requests = new Map();
    this.stats = {files_scanned: 0, skipped_lines: 0, read_ms: 0, bytes_read: 0, compactions: 0, indexing: false};
    this.reported = new Map(); this.scaleCache = null; this.dirty = true;
  }
  _session(key, init) {
    let s = this.sessions.get(key);
    if (!s) { s = {key, id: init.id, project: init.project, title: null, agentName: null, mtimeMs: 0, main: new Actor('main'), agents: new Map(), compactions: 0, ...init}; this.sessions.set(key, s); }
    return s;
  }
  _discover() {
    const cutoff = this.now() - 31 * DAY, found = [];
    let projects; try { projects = fs.readdirSync(this.projects, {withFileTypes: true}); } catch { return found; }
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const dir = path.join(this.projects, p.name); let entries; try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { continue; }
      for (const e of entries) {
        const f = path.join(dir, e.name);
        if (e.isFile() && e.name.endsWith('.jsonl')) found.push({f, project: p.name, session: e.name.slice(0, -6), sub: null});
        else if (e.isDirectory()) { const sd = path.join(f, 'subagents'); let subs; try { subs = fs.readdirSync(sd); } catch { continue; }
          for (const n of subs) if (/^agent-.+\.jsonl$/.test(n)) found.push({f: path.join(sd, n), project: p.name, session: e.name, sub: n.slice(6, -6), dir: sd}); }
      }
    }
    const withStat = [];
    for (const c of found) { try { const st = fs.statSync(c.f); if (st.mtimeMs >= cutoff) withStat.push({...c, size: st.size, mtimeMs: st.mtimeMs}); } catch {} }
    return withStat.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_FILES);
  }
  _loadReported() {
    this.reported.clear();
    let names; try { names = fs.readdirSync(path.join(this.lean, 'logs')).filter(n => /^lean-run-.*\.json$/.test(n)); } catch { return; }
    for (const n of names) { try {
      const d = JSON.parse(fs.readFileSync(path.join(this.lean, 'logs', n), 'utf8'));
      if (!d.session_id || !d.modelUsage) continue;
      // Resumed sessions report CUMULATIVE totals: keep only the largest (latest) per session, never sum.
      const prev = this.reported.get(d.session_id);
      if (!prev || (d.total_cost_usd || 0) >= (prev.total || 0)) this.reported.set(d.session_id, {total: d.total_cost_usd || 0, models: Object.fromEntries(Object.entries(d.modelUsage).filter(([, v]) => Number.isFinite(v.costUSD)).map(([m, v]) => [normalizeModel(m), v.costUSD]))});
    } catch {} }
  }
  refresh() {
    const t0 = Date.now(); let budget = MAX_READ, bytes = 0; this.stats.skipped_lines = this.stats.skipped_lines; this.stats.indexing = false;
    this._loadReported();
    const list = this._discover(); this.stats.files_scanned = list.length;
    for (const c of list) {
      let rec = this.files.get(c.f);
      if (!rec) { rec = {offset: 0, size: 0, mtimeMs: 0}; this.files.set(c.f, rec); }
      const mainPath = c.sub ? path.join(path.dirname(path.dirname(c.dir)), c.session + '.jsonl') : c.f;
      const s = this._session(opaqueKey(mainPath), {id: c.session, project: c.project});
      s.mtimeMs = Math.max(s.mtimeMs, c.mtimeMs);
      let actor = s.main;
      if (c.sub) {
        actor = s.agents.get(c.sub);
        if (!actor) { actor = new Actor(c.sub); s.agents.set(c.sub, actor); }
        try { const m = JSON.parse(fs.readFileSync(path.join(c.dir, `agent-${c.sub}.meta.json`), 'utf8')); actor.agent_type = m.agentType ?? null; actor.description = m.description ?? null; actor.finished = !!m.finished; } catch {}
      }
      actor.mtimeMs = Math.max(actor.mtimeMs, c.mtimeMs);
      rec.mtimeMs = c.mtimeMs;
      if (c.size < rec.offset) { rec.offset = 0; }
      if (c.size === rec.offset) continue;
      if (budget <= 0) { this.stats.indexing = true; continue; }
      const want = Math.min(c.size - rec.offset, budget);
      const buf = Buffer.alloc(want), fd = fs.openSync(c.f, 'r');
      let got; try { got = fs.readSync(fd, buf, 0, want, rec.offset); } finally { fs.closeSync(fd); }
      budget -= got; bytes += got;
      let end = buf.lastIndexOf(10, got - 1) + 1;
      if (end === 0) { if (got < want || want === c.size - rec.offset) continue; end = got; }
      if (rec.offset + end < c.size) this.stats.indexing = true;
      let pos = 0;
      while (pos < end) {
        let nl = buf.indexOf(10, pos); if (nl < 0 || nl > end) nl = end;
        const len = nl - pos;
        if (len > MAX_LINE) this.stats.skipped_lines++;
        else if (len > 2) this._line(buf.toString('utf8', pos, nl), s, actor, !!c.sub);
        pos = nl + 1;
      }
      rec.offset += end; this.dirty = true;
    }
    this.stats.bytes_read = bytes; this.stats.read_ms = Date.now() - t0;
    this.lastBytes = bytes; if (bytes) this.dirty = true;
    return {bytes_read: bytes};
  }
  _line(text, s, fileActor, fromSub) {
    if (text.startsWith('{"type":"api-request') || text.startsWith('{"type":"file-history')) return;
    let d; try { d = JSON.parse(text); } catch { return; }
    const t = d.type, ts = Date.parse(d.timestamp) || 0;
    if (t === 'custom-title' && d.customTitle) { s.title = String(d.customTitle); return; }
    if (t === 'agent-name' && d.agentName) { s.agentName = String(d.agentName); return; }
    if (t === 'system') { if (d.subtype === 'compact_boundary') { s.compactions++; this.stats.compactions++; } return; }
    if (d.cwd && !s.cwdBase) s.cwdBase = base(d.cwd);
    if (t !== 'assistant' && t !== 'user') return;
    let actor = fileActor;
    if (!fromSub && d.isSidechain === true) { actor = s.agents.get('sidechain'); if (!actor) { actor = new Actor('sidechain', {agent_type: 'sidechain', description: 'Sidechain'}); s.agents.set('sidechain', actor); } }
    const msg = d.message || {}, content = Array.isArray(msg.content) ? msg.content : [];
    if (ts) actor.mtimeMs = Math.max(actor.mtimeMs, ts);
    if (t === 'assistant') {
      if (msg.model === '<synthetic>') return;
      const u = msg.usage;
      if (u && typeof u === 'object') this._request(msg, d, u, ts, s, actor, fromSub);
      for (const b of content) if (b && b.type === 'tool_use') {
        if (actor.pending.has(b.id)) continue;
        const l = actionLabel(b.name, b.input || {}), a = {at: d.timestamp, id: b.id, kind: l.kind, tool: b.name, label: l.label, short: l.short, status: 'running'};
        actor.pending.set(b.id, a); actor.push(a);
      }
      actor.lastType = 'assistant'; actor.lastStop = msg.stop_reason ?? null;
      if (msg.stop_reason === 'end_turn' && actor.replyId !== msg.id) { actor.replyId = msg.id; actor.push({at: d.timestamp, kind: 'reply', label: 'Reply', short: 'Reply', status: 'ok'}); }
    } else {
      if (d.isMeta) return;
      const results = content.filter(b => b && b.type === 'tool_result');
      for (const r of results) { const a = actor.pending.get(r.tool_use_id); if (a) { a.status = r.is_error ? 'error' : 'ok'; actor.pending.delete(r.tool_use_id); } }
      if (!results.length) actor.push({at: d.timestamp, kind: 'user', label: 'Prompt', short: 'Prompt', status: 'ok'});
      actor.lastType = 'user'; actor.lastStop = null;
    }
  }
  _request(msg, d, u, ts, s, actor, fromSub) {
    const key = msg.id || d.requestId || d.uuid; if (!key) return;
    const cc = u.cache_creation;
    const tokens = {input: u.input_tokens || 0, cache_read: u.cache_read_input_tokens || 0, output: u.output_tokens || 0, thinking: u.output_tokens_details?.thinking_tokens || 0,
      cache_write_5m: cc ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0, cache_write_1h: cc ? cc.ephemeral_1h_input_tokens || 0 : 0};
    const model = msg.model || 'unknown';
    const req = {key, ts, model, family: familyOf(model), tokens, speed: u.speed, geo: u.inference_geo, sessionKey: s.key, sessionId: s.id, actor: actor.id, sidechain: actor.id === 'sidechain', fromSub, project: s.project,
      list: priceRequest(model, tokens, {speed: u.speed, geo: u.inference_geo})};
    const old = this.requests.get(key);
    if (old) {
      if (old.fromSub && !req.fromSub) return;
      if (!(req.fromSub && !old.fromSub) && req.tokens.output <= old.tokens.output) return;
    }
    this.requests.set(key, req); this.dirty = true;
    if (ts >= actor.lastTs) { actor.lastTs = ts; actor.lastReq = req; }
  }
  // Effective per-request cost: reported cost allocated by list-price share inside (session, model); otherwise list.
  _costs() {
    if (!this.dirty && this.scaleCache) return this.scaleCache;
    const groups = new Map();
    for (const r of this.requests.values()) { const g = `${r.sessionId}|${normalizeModel(r.model)}`; const e = groups.get(g) || {list: 0, n: 0}; e.list += r.list || 0; e.n++; groups.set(g, e); }
    const cost = new Map();
    for (const r of this.requests.values()) {
      const rep = this.reported.get(r.sessionId)?.models[normalizeModel(r.model)];
      if (rep !== undefined) { const g = groups.get(`${r.sessionId}|${normalizeModel(r.model)}`); cost.set(r.key, {usd: g.list > 0 ? rep * (r.list || 0) / g.list : rep / g.n, basis: 'reported'}); }
      else cost.set(r.key, {usd: r.list, basis: r.list === null ? 'unpriced' : 'list'});
    }
    this.scaleCache = cost; this.dirty = false; return cost;
  }
  cost(r) { return this._costs().get(r.key) || {usd: r.list, basis: 'list'}; }
  static basisOf(set) { return set.size === 0 ? 'list' : set.size === 1 ? [...set][0] : 'mixed'; }
  _bucketAgg(reqs) {
    const tokens = ZERO(); let usd = 0, priced = 0, unpriced = 0; const bases = new Set();
    for (const r of reqs) { add(tokens, r.tokens); const c = this.cost(r); if (c.usd === null) unpriced++; else { usd += c.usd; priced++; bases.add(c.basis); } }
    const denom = tokens.input + tokens.cache_write_5m + tokens.cache_write_1h + tokens.cache_read;
    return {requests: reqs.length, tokens, cache_hit: denom ? tokens.cache_read / denom : null, cost_usd: priced || !reqs.length ? usd : null, basis: ClaudeUsageIndex.basisOf(bases), unpriced_requests: unpriced};
  }
  _title(s) { return s.title || s.agentName || `${s.cwdBase || s.project.split('-').filter(Boolean).pop() || 'project'} · ${s.id.slice(0, 8)}`; }
  _state(actor, now, isSub) {
    if (isSub && actor.finished) return 'done';
    if (actor.pending.size) return 'working';
    if (actor.lastType === 'user' || (actor.lastType === 'assistant' && actor.lastStop !== 'end_turn')) return 'working';
    return now - actor.mtimeMs < 30 * 60000 ? 'waiting' : 'idle';
  }
  _actorView(s, actor, now, isSub) {
    const status = this._state(actor, now, isSub), pend = [...actor.pending.values()].at(-1);
    const reqs = [...this.requests.values()].filter(r => r.sessionKey === s.key && (isSub ? r.actor === actor.id : r.actor === 'main'));
    const agg = this._bucketAgg(reqs), last = actor.lastReq;
    return {status, active: now - actor.mtimeMs < 90000, updated_at: new Date(actor.mtimeMs || s.mtimeMs).toISOString(), agg, last,
      current: status === 'working' ? (pend ? {kind: pend.kind, label: `Running ${pend.label}`, short: `Running ${pend.short}`, since: pend.at} : {kind: 'reply', label: 'Thinking', short: 'Thinking', since: new Date(actor.mtimeMs).toISOString()}) : null,
      model: last?.model ?? null, family: last ? last.family : null,
      context: last ? {tokens: last.tokens.input + last.tokens.cache_write_5m + last.tokens.cache_write_1h + last.tokens.cache_read, window: contextWindow(last.model)} : {tokens: 0, window: 200000}};
  }
  sessionCard(s, opts, now = this.now()) {
    const main = this._actorView(s, s.main, now, false), subs = [...s.agents.values()].map(a => ({a, v: this._actorView(s, a, now, true)}));
    const all = [...this.requests.values()].filter(r => r.sessionKey === s.key), total = this._bucketAgg(all);
    const lastMain = main.last || subs.map(x => x.v.last).filter(Boolean).sort((a, b) => b.ts - a.ts)[0] || null;
    const lastReqCost = main.last ? this.cost(main.last).usd : null;
    const det = opts.details !== false, name = x => det ? x.label : x.short;
    const actions = [...s.main.actions].reverse().slice(0, 5).map(a => ({at: a.at, kind: a.kind, label: det ? a.label : a.short, status: a.status}));
    const active = main.active || subs.some(x => x.v.active);
    return {key: s.key, source: 'claude', title: this._title(s), project: opts.projects === false ? null : (s.cwdBase || s.project.split('-').filter(Boolean).pop() || null),
      model: lastMain?.model ?? null, family: lastMain?.family ?? null, status: main.status, active, updated_at: new Date(s.mtimeMs).toISOString(),
      current: main.current ? {kind: main.current.kind, label: name(main.current), since: main.current.since} : null, actions,
      context: main.context, tokens: total.tokens, cost: {session_usd: total.cost_usd, last_request_usd: lastReqCost, basis: total.basis},
      split: {main: {requests: main.agg.requests, cost_usd: main.agg.cost_usd}, subagents: {requests: total.requests - main.agg.requests, cost_usd: total.cost_usd === null || main.agg.cost_usd === null ? null : total.cost_usd - main.agg.cost_usd}},
      subagents: subs.slice(0, 20).map(({a, v}) => ({id: a.id.slice(0, 8), agent_type: a.agent_type, description: det ? a.description : null, model: v.model, family: v.family, status: v.status, tokens: v.agg.tokens, cost_usd: v.agg.cost_usd}))};
  }
  live(opts = {}) {
    const now = this.now(), cutoff = now - 30 * 60000, mid = new Date(now); mid.setHours(0, 0, 0, 0);
    const cards = [...this.sessions.values()].filter(s => s.mtimeMs >= cutoff && (s.main.lastReq || s.agents.size)).map(s => this.sessionCard(s, opts, now))
      .sort((a, b) => (b.active - a.active) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
    let today = 0, any = false; for (const r of this.requests.values()) if (r.ts >= mid.getTime()) { const c = this.cost(r).usd; if (c !== null) { today += c; any = true; } }
    return {sessions: cards, totals: {active_sessions: cards.filter(c => c.active).length, cost_today_usd: any ? today : 0}, stats: this.publicStats()};
  }
  publicStats() { const {files_scanned, skipped_lines, read_ms, compactions, indexing} = this.stats; return {files_scanned, skipped_lines, read_ms, compactions, indexing}; }
  liveSession(key, opts = {}) {
    const s = this.sessions.get(key); if (!s) return null;
    const det = opts.details !== false, card = this.sessionCard(s, opts);
    const timeline = [s.main, ...s.agents.values()].flatMap(a => a.actions.map(x => ({at: x.at, kind: x.kind, label: det ? x.label : x.short, status: x.status, agent: a.id === 'main' ? null : a.id.slice(0, 8)})))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50);
    const reqs = [...this.requests.values()].filter(r => r.sessionKey === s.key).sort((a, b) => b.ts - a.ts);
    const requests = reqs.slice(0, 200).map(r => { const c = this.cost(r); return {at: new Date(r.ts).toISOString(), model: r.model, family: r.family, sidechain: r.sidechain, agent: r.actor === 'main' ? null : r.actor.slice(0, 8),
      input: r.tokens.input, cache_write_5m: r.tokens.cache_write_5m, cache_write_1h: r.tokens.cache_write_1h, cache_read: r.tokens.cache_read, output: r.tokens.output, cost_usd: c.usd, basis: c.basis}; });
    const by = new Map(); for (const r of reqs) { const l = by.get(r.model) || []; l.push(r); by.set(r.model, l); }
    const by_model = [...by].map(([model, l]) => { const a = this._bucketAgg(l); return {model, family: familyOf(model), requests: a.requests, tokens: a.tokens, cost_usd: a.cost_usd}; });
    return {schema: 'helix.live-session.v1', session: card, timeline, requests, by_model};
  }
  range(range, now = this.now()) {
    const to = now; let from;
    if (range === 'today') { const m = new Date(now); m.setHours(0, 0, 0, 0); from = m.getTime(); }
    else from = now - ({'5h': 5 * 3600000, '7d': 7 * DAY, '30d': 30 * DAY}[range] ?? 7 * DAY);
    return {from, to, hourly: range === '5h' || range === 'today'};
  }
  usage({range = '7d', group = 'model'} = {}, opts = {}) {
    if (!['5h', 'today', '7d', '30d'].includes(range)) throw new Error('Invalid range');
    if (!['model', 'session', 'project', 'family'].includes(group)) throw new Error('Invalid group');
    const {from, to, hourly} = this.range(range), reqs = [...this.requests.values()].filter(r => r.ts >= from && r.ts <= to);
    const step = hourly ? 3600000 : DAY, series = new Map();
    for (const r of reqs) { const c = this.cost(r).usd; if (c === null) continue; let b = Math.floor(r.ts / step) * step;
      if (!hourly) { const d = new Date(r.ts); d.setHours(0, 0, 0, 0); b = d.getTime(); }
      const e = series.get(b) || {}; e[r.family] = (e[r.family] || 0) + c; series.set(b, e); }
    const groups = new Map();
    for (const r of reqs) {
      const s = this.sessions.get(r.sessionKey);
      const id = group === 'model' ? r.model : group === 'family' ? r.family : group === 'session' ? r.sessionKey : (s?.cwdBase || s?.project || 'unknown');
      const label = group === 'model' ? modelLabel(r.model) : group === 'family' ? r.family : group === 'session' ? (s ? this._title(s) : id) : id;
      if (!groups.has(id)) groups.set(id, {id, label, family: group === 'model' || group === 'family' ? r.family : null, reqs: []}); groups.get(id).reqs.push(r);
    }
    const rows = [...groups.values()].map(g => {
      const a = this._bucketAgg(g.reqs), main = g.reqs.filter(r => r.actor === 'main'), sub = g.reqs.filter(r => r.actor !== 'main');
      const row = {id: g.id, label: g.label, family: g.family, requests: a.requests, tokens: a.tokens, cache_hit: a.cache_hit, cost_usd: a.cost_usd, basis: a.basis,
        main: {requests: main.length, cost_usd: this._bucketAgg(main).cost_usd}, subagents: {requests: sub.length, cost_usd: this._bucketAgg(sub).cost_usd}};
      if (group === 'session') {
        const kids = new Map(); for (const r of sub) { const l = kids.get(r.actor) || []; l.push(r); kids.set(r.actor, l); }
        const s = this.sessions.get(g.id);
        row.children = [...kids].map(([aid, l]) => { const k = this._bucketAgg(l), ag = s?.agents.get(aid); return {id: aid.slice(0, 8), label: opts.details === false ? (ag?.agent_type || 'subagent') : (ag?.description || ag?.agent_type || 'subagent'), requests: k.requests, tokens: k.tokens, cost_usd: k.cost_usd}; });
      }
      return row;
    }).sort((a, b) => (b.cost_usd ?? -1) - (a.cost_usd ?? -1) || b.requests - a.requests);
    const t = this._bucketAgg(reqs);
    return {schema: 'helix.usage.v1', range, group, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
      totals: {requests: t.requests, ...t.tokens, cache_hit: t.cache_hit, cost_usd: t.cost_usd, basis: t.basis, unpriced_requests: t.unpriced_requests},
      series: [...series].sort((a, b) => a[0] - b[0]).map(([b, by_family]) => ({bucket: new Date(b).toISOString(), by_family})), rows, stats: this.publicStats()};
  }
}
