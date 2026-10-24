import React, {useContext, useEffect, useState} from 'react';
import {Bot, Check, ChevronDown, CircleAlert, LoaderCircle, MessageSquare, Plug, Sparkles, User, Wrench} from 'lucide-react';
import {AppContext, expectSchema, usePoll} from '../hooks.js';
import {ago, clockSeconds, elapsed, money, pct, scrub, sumTokens, tokens} from '../format.js';
import ModelChip from '../components/ModelChip.jsx';
import Meter from '../components/Meter.jsx';
import CostTicker from '../components/CostTicker.jsx';
import Drawer from '../components/Drawer.jsx';
import {Dash, EmptyState, ErrorBanner, LastUpdated, OfflinePanel, Skeleton} from '../components/States.jsx';

const KIND = {tool: Wrench, agent: Bot, skill: Sparkles, mcp: Plug, reply: MessageSquare, user: User};
const STATUS = {ok: [Check, 'ok'], error: [CircleAlert, 'failed'], running: [LoaderCircle, 'running']};
const FILTERS = [['all', 'All'], ['working', 'Working'], ['claude', 'Claude'], ['codex', 'Codex']];

function Action({action, now}) {
  const Icon = KIND[action.kind] || Wrench;
  const [StatusIcon, statusText] = STATUS[action.status] || STATUS.ok;
  return <li className={`action st-${action.status}`}><Icon size={14} aria-hidden="true" /><span className="action-label">{scrub(action.label)}</span>
    <span className="action-time">{ago(action.at, now)}</span><StatusIcon size={13} aria-hidden="true" /><span className="hx-sr">{statusText}</span></li>;
}

function pill(session, now) {
  if (session.status === 'working') return ['working', 'Working'];
  if (session.status === 'waiting') return ['waiting', 'Waiting for you'];
  if (session.status === 'done') return ['idle', 'Done'];
  const minutes = Math.max(1, Math.round((now - Date.parse(session.updated_at)) / 60000));
  return ['idle', `Idle ${minutes} min`];
}

export function SessionCard({session, now, onOpen}) {
  const [tone, pillText] = pill(session, now);
  const ctx = session.context;
  const ratio = ctx?.window ? ctx.tokens / ctx.window : null;
  const actions = [...(session.actions || [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  const subs = session.subagents || [];
  const t = session.tokens || {};
  const tip = session.source === 'codex' ? `in ${tokens(t.input)} · cached ${tokens(t.cached)} · out ${tokens(t.output)}`
    : `in ${tokens(t.input)} · cache write ${tokens((t.cache_write_5m || 0) + (t.cache_write_1h || 0))} · cache read ${tokens(t.cache_read)} · out ${tokens(t.output)}`;
  return <article className={`session-card tone-${tone}`} data-source={session.source} onClick={event => { if (!event.target.closest('a,button')) onOpen(session.key); }}>
    <header><ModelChip model={session.model} family={session.family} />
      <h3><button type="button" className="card-open" onClick={() => onOpen(session.key)} aria-label={`Open session ${scrub(session.title)}`}>{scrub(session.title)}</button></h3>
      <span className={`status-pill ${tone}`}><span className="dot" />{pillText}</span></header>
    {session.project && <p className="card-project">{scrub(session.project)}</p>}
    {session.status === 'working' && <p className="state-line"><strong>{scrub(session.current?.label || 'Working')}</strong>{session.current?.since && <span className="numeric"> · {elapsed(session.current.since, now)}</span>}</p>}
    {actions.length > 0 && <ol className="actions" aria-label="Last actions">{actions.map((a, i) => <Action key={`${a.at}-${i}`} action={a} now={now} />)}</ol>}
    <div className="card-metrics">
      {ctx ? <div className="ctx" title="Last request prompt size: input + cache read + cache write"><span className="mlabel">Context</span>
        <Meter value={ratio} label="Context used" valueText={`${pct(ratio)} of ${tokens(ctx.window)}`} /><span className="numeric">{pct(ratio)} <small>{tokens(ctx.tokens)} / {tokens(ctx.window)}</small></span></div>
        : <div className="ctx"><span className="mlabel">Context</span><Dash /></div>}
      <CostTicker value={session.cost?.session_usd} last={session.cost?.last_request_usd} title={tip} />
    </div>
    {subs.length > 0 && <ul className="subagents" aria-label="Subagents">{subs.slice(0, 4).map(s => <li className="subagent-row" key={s.id}>
      <ModelChip model={s.model} family={s.family} /><span className="sub-desc"><strong>{scrub(s.agent_type)}</strong> {scrub(s.description)}</span>
      <span className={`sub-state ${s.status}`}>{s.status}</span><span className="numeric sub-num sub-tok" title={`${sumTokens(s.tokens)} tokens`}>{tokens(sumTokens(s.tokens))}</span><span className="numeric sub-num sub-cost">{typeof s.cost_usd === 'number' ? money(s.cost_usd) : <span className="unpriced">unpriced</span>}</span></li>)}
      {subs.length > 4 && <li><button type="button" className="link-btn" onClick={() => onOpen(session.key)}>+{subs.length - 4} more</button></li>}</ul>}
  </article>;
}

function EngineLane({engine, now}) {
  const flows = engine?.flows || [], shell = engine?.shell || [];
  const [open] = useState(() => !matchMedia('(max-width: 959px)').matches);
  return <details className="engine-lane" open={open}><summary><ChevronDown size={16} aria-hidden="true" /> HELIX engine <small>{flows.length} flow runs · {shell.length} shell events</small></summary>
    {!flows.length && !shell.length ? <p className="muted">No HELIX flow or shell activity recently.</p> : <ul>
      {flows.map(f => <li key={f.id}><span className="verb">hx flow</span> <code>{scrub(f.id)}</code> <span>{f.steps} steps{f.failed ? `, ${f.failed} failed` : ''}</span><span className={`mini-pill ${f.status === 'ok' ? 'ok' : 'bad'}`}>{f.status === 'ok' ? 'ok' : 'failed'}</span><span className="muted">{ago(f.at, now)}</span></li>)}
      {shell.map((s, i) => <li key={i}><span className="verb">{scrub(s.verb)}</span> <span className="numeric">{s.ms} ms</span>{s.dup && <span className="mini-pill">dup</span>}{s.rewritten && <span className="mini-pill">rewritten</span>}{s.lines ? <span className="muted">{s.lines} lines saved</span> : null}<span className="muted">{ago(s.at, now)}</span></li>)}
    </ul>}</details>;
}

function SessionDrawerBody({id}) {
  const {api} = useContext(AppContext);
  const {data, error, refresh} = usePoll(async () => expectSchema(await api.liveSession(id), 'helix.live-session.v1'), {interval: 2000, deps: [id]});
  const [tab, setTab] = useState('timeline');
  if (error && !data) return <ErrorBanner message="Could not load this session." onRetry={refresh} />;
  if (!data) return <Skeleton count={1} label="Loading session" />;
  const tabs = [['timeline', 'Timeline'], ['requests', 'Requests'], ['models', 'Models'], ['subagents', 'Subagents']];
  return <>
    <div className="seg" role="tablist" aria-label="Session details">{tabs.map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
    {error && <ErrorBanner message="Update failed." onRetry={refresh} />}
    {tab === 'timeline' && <ol className="actions timeline">{data.timeline.slice(0, 50).map((a, i) => <Action key={i} action={a} now={Date.now()} />)}</ol>}
    {tab === 'requests' && <div className="table-wrap"><table className="hx-table"><thead><tr><th>Time</th><th>Model</th><th className="num">Input</th><th className="num">Cache write</th><th className="num">Cache read</th><th className="num">Output</th><th className="num">Cost</th></tr></thead>
      <tbody>{data.requests.map((r, i) => <tr key={i}><td>{clockSeconds(r.at)}</td><td><ModelChip model={r.model} family={r.family} />{r.sidechain && <span className="mini-pill">subagent</span>}</td><td className="num numeric">{tokens(r.input)}</td><td className="num numeric">{tokens((r.cache_write_5m || 0) + (r.cache_write_1h || 0))}</td><td className="num numeric">{tokens(r.cache_read)}</td><td className="num numeric">{tokens(r.output)}</td><td className="num numeric">{money(r.cost_usd)}</td></tr>)}</tbody></table></div>}
    {tab === 'models' && <ul className="plain-list">{data.by_model.map(m => <li key={m.model}><ModelChip model={m.model} family={m.family} /><span className="numeric">{m.requests} requests</span><span className="numeric">{tokens(sumTokens(m.tokens))} tokens</span><strong className="numeric">{money(m.cost_usd)}</strong></li>)}</ul>}
    {tab === 'subagents' && (data.session.subagents?.length ? <ul className="plain-list">{data.session.subagents.map(s => <li key={s.id}><ModelChip model={s.model} family={s.family} /><span>{scrub(s.agent_type)} {scrub(s.description)}</span><strong className="numeric">{money(s.cost_usd)}</strong></li>)}</ul> : <p className="muted">No subagents in this session.</p>)}
  </>;
}

export default function LiveScreen() {
  const {api} = useContext(AppContext);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const {data, error, state, receivedAt, refresh} = usePoll(async () => expectSchema(await api.live(), 'helix.live.v1'), {interval: 2000, enabled: !!api});
  useEffect(() => { document.title = 'Live | HELIX'; }, []);
  if (!api) return <OfflinePanel />;
  const now = Date.now();
  if (!data) return error ? <ErrorBanner message="Could not read live sessions." onRetry={refresh} /> : <Skeleton count={3} label="Loading sessions" />;
  const sessions = [...(data.sessions || [])].sort((a, b) => (b.active - a.active) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const shown = sessions.filter(s => filter === 'all' || (filter === 'working' ? s.status === 'working' : s.source === filter));
  const title = sessions.find(s => s.key === open)?.title || 'Session';
  return <div className={state === 'error' ? 'stale-data' : ''}>
    {error && <ErrorBanner message="Live update failed." onRetry={refresh} lastUpdated={receivedAt} />}
    <div className="chips" role="group" aria-label="Filter sessions">{FILTERS.map(([key, label]) => <button type="button" key={key} className="filter-chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    {sessions.length === 0 ? <EmptyState action={<a className="hx-button" href="#usage?range=7d">Show last 7 days in Usage</a>}>No Claude or Codex session active in the last 30 minutes.</EmptyState>
      : shown.length === 0 ? <EmptyState>No sessions match this filter.</EmptyState>
      : <div className="card-grid">{shown.map(s => <SessionCard key={s.key} session={s} now={now} onOpen={setOpen} />)}</div>}
    <EngineLane engine={data.engine} now={now} />
    <LastUpdated at={receivedAt} />
    <Drawer open={!!open} title={scrub(title)} onClose={() => setOpen(null)}>{open && <SessionDrawerBody id={open} />}</Drawer>
  </div>;
}
