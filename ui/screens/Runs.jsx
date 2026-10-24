import React, {useContext, useMemo, useState} from 'react';
import {Check, Minus, X} from 'lucide-react';
import {AppContext, expectSchema, usePoll} from '../hooks.js';
import {ago, isNum, money, pct, scrub, tokens} from '../format.js';
import ModelChip from '../components/ModelChip.jsx';
import {EmptyState, ErrorBanner, LastUpdated, OfflinePanel, Skeleton} from '../components/States.jsx';

const isContinuous = lane => /continuous/i.test(lane || '');
const FILTERS = [['all', 'All'], ['both', 'Both solved'], ['base', 'Only baseline'], ['other', 'Only helixy'], ['neither', 'Neither']];
const pctPoints = v => isNum(v) ? `${v.toFixed(1)}%` : '—';

function Tick({value}) {
  if (value === true) return <span className="tick ok"><Check size={14} aria-hidden="true" /><span className="hx-sr">resolved</span></span>;
  if (value === false) return <span className="tick bad"><X size={14} aria-hidden="true" /><span className="hx-sr">not resolved</span></span>;
  return <span className="tick"><Minus size={14} aria-hidden="true" /><span className="hx-sr">not graded</span></span>;
}

function LaneCompare({lanes, baseline}) {
  return <section className="card" aria-labelledby="lanes-h"><h2 id="lanes-h">Lane comparison</h2>
    <div className="lane-grid">{lanes.map(l => {
      const base = l.lane === baseline, cont = isContinuous(l.lane);
      return <article className="lane-col" key={l.lane} aria-label={`Lane ${l.lane}`}>
        <h3>{scrub(l.lane)}{base && <span className="mini-pill">baseline</span>}</h3><ModelChip model={l.model} />
        <dl className="kv">
          <div><dt>Resolved</dt><dd className="numeric">{l.resolved ?? '—'} / {l.attempted ?? '—'}</dd></div>
          <div><dt>Graded</dt><dd className="numeric">{l.graded ?? '—'}</dd></div>
          <div><dt>Requests</dt><dd className="numeric">{l.requests ?? '—'}</dd></div>
          <div><dt>Cost{cont ? ' (sum of per-task deltas)' : ''}</dt><dd className="numeric">{money(l.cost_usd)}</dd></div>
          <div><dt>Context p50 / p90 / max</dt><dd className="numeric">{tokens(l.ctx?.p50)} / {tokens(l.ctx?.p90)} / {tokens(l.ctx?.max)}</dd></div>
          <div><dt>Cache hit</dt><dd className="numeric">{pct(l.cache_hit)}</dd></div>
          <div><dt>Savings vs baseline</dt><dd className="numeric">{base ? '—' : `${pctPoints(l.savings?.processed_pct)} processed, ${pctPoints(l.savings?.cost_pct)} cost`}</dd></div>
        </dl></article>; })}</div>
    {lanes.some(l => isContinuous(l.lane)) && <p className="muted small note-line">Continuous lanes run every task in one running session, so each task cost is a per-task delta of that session, not an independent run.</p>}
  </section>;
}

function DriverStrip({driver}) {
  if (!driver) return <section className="card driver-strip" aria-label="Driver status"><span className="muted">No driver status reported.</span></section>;
  const active = !['finished', 'idle', null, undefined].includes(driver.phase), u = driver.last_utilization || {};
  return <section className="card driver-strip" aria-label="Driver status"><span className={`mini-pill ${active ? 'ok' : ''}`}>{driver.phase ?? 'unknown'}</span>
    <span>Task <strong>{scrub(driver.task) || '—'}</strong></span><span>Lane <strong>{scrub(driver.lane) || '—'}</strong></span>
    <span>Utilization 5h <strong className="numeric">{pct(u.five_hour)}</strong>, 7d <strong className="numeric">{pct(u.seven_day)}</strong></span>
    <span className="muted">Updated {ago(driver.updated_at)}</span></section>;
}

function ResultsTable({tasks, lanes, baseline}) {
  const base = lanes.find(l => l.lane === baseline) || lanes[0], other = lanes.find(l => l !== base);
  const [filter, setFilter] = useState('all'), [sort, setSort] = useState({key: 'task', dir: 1});
  const delta = t => other && isNum(t.lanes[other.lane]?.cost_usd) && isNum(t.lanes[base.lane]?.cost_usd) ? t.lanes[other.lane].cost_usd - t.lanes[base.lane].cost_usd : null;
  const value = (t, key) => key === 'task' ? t.task : key === 'instance' ? t.instance : key === 'delta' ? delta(t) : (([lane, f]) => t.lanes[lane]?.[f])(key.split('|'));
  const rows = useMemo(() => {
    const keep = t => { const b = t.lanes[base.lane]?.resolved === true, o = other ? t.lanes[other.lane]?.resolved === true : false;
      return filter === 'all' || (filter === 'both' && b && o) || (filter === 'base' && b && !o) || (filter === 'other' && !b && o) || (filter === 'neither' && !b && !o); };
    return tasks.filter(keep).sort((a, b) => { const x = value(a, sort.key), y = value(b, sort.key);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : Number(x) - Number(y)) * sort.dir; });
  }, [tasks, filter, sort, base, other]);
  const head = (key, label, cls = '', title) => <th className={`${cls} ${typeof label === 'string' ? '' : ''}`} aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'} title={title}>
    <button type="button" className="th-btn" onClick={() => setSort(s => ({key, dir: s.key === key ? -s.dir : 1}))}>{label}</button></th>;
  return <section className="card" aria-labelledby="results-h"><h2 id="results-h">Results by task</h2>
    <div className="chips" role="group" aria-label="Filter results">{FILTERS.map(([k, l]) => <button type="button" key={k} className="filter-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
    {rows.length === 0 ? <EmptyState>No tasks match this filter.</EmptyState> : <div className="table-wrap"><table className="hx-table results-table"><caption className="hx-sr">Per-task results for each lane</caption>
      <thead><tr>{head('task', 'Task')}{head('instance', 'Instance', 'col-detail')}
        {lanes.map(l => <React.Fragment key={l.lane}>{head(`${l.lane}|resolved`, <>{scrub(l.lane)} solved</>)}{head(`${l.lane}|requests`, 'Requests', 'num col-detail')}{head(`${l.lane}|processed`, 'Processed', 'num col-detail')}
          {head(`${l.lane}|cost_usd`, isContinuous(l.lane) ? 'Cost (per-task delta)' : 'Cost', 'num', isContinuous(l.lane) ? 'Continuous lane: cost of this task as a delta of the running session' : undefined)}</React.Fragment>)}
        {other && head('delta', 'Cost difference', 'num', `${other.lane} cost minus ${base.lane} cost`)}</tr></thead>
      <tbody>{rows.map(t => { const d = delta(t); return <tr key={t.task}><td>{scrub(t.task)}</td><td className="col-detail">{scrub(t.instance) || '—'}</td>
        {lanes.map(l => { const c = t.lanes[l.lane] || {}; return <React.Fragment key={l.lane}><td><Tick value={c.resolved} /></td><td className="num numeric col-detail">{c.requests ?? '—'}</td><td className="num numeric col-detail">{tokens(c.processed)}</td><td className="num numeric">{money(c.cost_usd)}</td></React.Fragment>; })}
        {other && <td className={`num numeric ${d != null && d < 0 ? 'good' : ''}`}>{d == null ? '—' : `${d < 0 ? '-' : '+'}${money(Math.abs(d))}`}</td>}</tr>; })}</tbody></table></div>}
  </section>;
}

function ModelSplit({lanes}) {
  return <section className="card" aria-labelledby="models-h"><h2 id="models-h">Models per lane</h2>
    <div className="table-wrap"><table className="hx-table"><thead><tr><th>Lane</th><th>Model</th><th className="num">Input</th><th className="num">Cache read</th><th className="num">Cache write</th><th className="num">Output</th><th className="num">Cost</th></tr></thead>
      <tbody>{lanes.flatMap(l => (l.models || []).map(m => <tr key={`${l.lane}:${m.model}`}><td>{scrub(l.lane)}</td><td><ModelChip model={m.model} /></td><td className="num numeric">{tokens(m.input)}</td><td className="num numeric">{tokens(m.cache_read)}</td><td className="num numeric">{tokens(m.cache_write)}</td><td className="num numeric">{tokens(m.output)}</td><td className="num numeric">{money(m.cost_usd)}</td></tr>))}</tbody></table></div></section>;
}

export default function RunsScreen() {
  const {api} = useContext(AppContext);
  const [phase, setPhase] = useState(null);
  const active = phase && !['finished', 'idle'].includes(phase);
  const {data, error, receivedAt, refresh} = usePoll(async () => { const d = expectSchema(await api.runs(), 'helix.runs.v1'); setPhase(d.driver?.phase ?? null); return d; }, {interval: active ? 10000 : 300000, enabled: !!api});
  if (!api) return <OfflinePanel />;
  if (!data) return error ? <ErrorBanner message="Could not read benchmark results." onRetry={refresh} /> : <Skeleton count={2} label="Loading runs" />;
  if (!data.lanes.length) return <><DriverStrip driver={data.driver} /><EmptyState>No benchmark results in the configured folder{data.root ? ` (${scrub(data.root)})` : ''}. <a href="#settings">Open Settings &gt; Sources</a></EmptyState></>;
  const baseline = data.baseline || data.lanes.find(l => /vanilla/i.test(l.lane))?.lane || data.lanes[0].lane;
  return <div className={error ? 'stale-data' : ''}>
    {error && <ErrorBanner message="Runs update failed." onRetry={refresh} lastUpdated={receivedAt} />}
    <p className="muted small root-line">Source folder <code>{scrub(data.root) || 'not configured'}</code></p>
    <DriverStrip driver={data.driver} /><LaneCompare lanes={data.lanes} baseline={baseline} />
    <ResultsTable tasks={data.tasks} lanes={data.lanes} baseline={baseline} /><ModelSplit lanes={data.lanes} />
    <LastUpdated at={receivedAt} />
  </div>;
}
