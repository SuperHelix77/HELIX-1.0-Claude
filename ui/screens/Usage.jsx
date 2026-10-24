import React, {Fragment, useContext, useEffect, useMemo, useState} from 'react';
import {ChevronDown, ChevronRight, Copy} from 'lucide-react';
import {AppContext, expectSchema, usePoll} from '../hooks.js';
import {FAMILIES, FAMILY_NAME, MONO, clock, inRel, money, pct, resetLabel, scrub, sumTokens, tokens, full, isNum} from '../format.js';
import ModelChip from '../components/ModelChip.jsx';
import Meter from '../components/Meter.jsx';
import {Dash, EmptyState, ErrorBanner, LastUpdated, OfflinePanel, Skeleton} from '../components/States.jsx';

const RANGES = [['5h', '5h'], ['today', 'Today'], ['7d', '7d'], ['30d', '30d']];
const GROUPS = [['model', 'By model'], ['session', 'By session'], ['project', 'By project']];
const SOURCE = {statusline: 'from status line', stream: 'from session stream', benchmark: 'from benchmark stream'};

function PlanLimitsCard({limits}) {
  const now = Date.now();
  const rows = [['five_hour', '5-hour limit'], ['seven_day', 'Weekly limit']];
  return <section className="card plan-card" id="limits" aria-labelledby="limits-h"><h2 id="limits-h">Plan limits</h2>
    <div className="plan-grid">{rows.map(([key, label]) => {
      const w = limits?.windows?.[key];
      const expired = w?.state === 'expired';
      const value = w && !expired && isNum(w.utilization) ? w.utilization : null;
      const age = w?.observed_at ? Math.max(0, Math.round((now - Date.parse(w.observed_at)) / 60000)) : null;
      return <div key={key} className="plan-row"><div className="plan-top"><span>{label}</span><strong className="numeric big">{!w || w.state === 'unknown' ? '—' : expired ? 'reset' : pct(value)}</strong></div>
        <Meter value={value} label={label} valueText={pct(value)} />
        <p className="muted">{w?.resets_at ? `Resets ${resetLabel(w.resets_at, now)} (${inRel(w.resets_at, now)})` : 'Never observed'}{expired ? ' · reset since last observation' : ''}</p>
        {w && <p className="muted">{SOURCE[w.source] || 'observed'}, {age < 1 ? 'just now' : `${age} min ago`}{w.state === 'stale' && ` · as of ${clock(w.observed_at)}`}</p>}</div>;
    })}</div></section>;
}

function Chart({series, range}) {
  const [active, setActive] = useState(null);
  const daily = range === '7d' || range === '30d';
  const label = b => daily ? new Date(b).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : clock(b);
  const totals = series.map(s => Object.values(s.by_family || {}).reduce((a, v) => a + (v || 0), 0));
  const max = Math.max(0.0001, ...totals);
  const W = 640, H = 180, pad = 34, slot = (W - pad * 2) / Math.max(1, series.length), bw = Math.max(4, slot * 0.7);
  return <div className="card chart-card"><h2>Cost over time</h2>
    <svg viewBox={`0 0 ${W} ${H + 22}`} className="chart" role="group" aria-label="Cost over time, stacked by model family">
      {series.map((s, i) => { let y = H; const x = pad + i * slot + (slot - bw) / 2;
        const parts = FAMILIES.filter(f => (s.by_family?.[f] || 0) > 0);
        const aria = `${label(s.bucket)}, ${parts.map(f => `${FAMILY_NAME[f]} ${money(s.by_family[f])}`).join(', ') || 'no cost'}`;
        return <g key={s.bucket} tabIndex={0} role="img" aria-label={aria} className="bar" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
          <rect x={x - 2} y={0} width={bw + 4} height={H} fill="transparent" />
          {parts.map(f => { const h = (s.by_family[f] / max) * (H - 8); y -= h; return <rect key={f} x={x} y={y} width={bw} height={Math.max(1, h)} className={`fill-${f}`} rx="2" />; })}
          {(series.length <= 8 || i % Math.ceil(series.length / 6) === 0) && <text x={x + bw / 2} y={H + 16} textAnchor="middle" className="axis">{label(s.bucket)}</text>}</g>; })}
      <line x1={pad} x2={W - 8} y1={H} y2={H} className="axis-line" />
      <text x={pad - 6} y={12} textAnchor="end" className="axis y-max">{money(max < 0.001 ? 0 : max)}</text><text x={pad - 6} y={H} textAnchor="end" className="axis">$0</text>
      <line x1={pad} x2={W - 8} y1={8} y2={8} className="grid-line" />
      {active != null && series[active] && (() => { const t = series[active], parts = FAMILIES.filter(f => (t.by_family?.[f] || 0) > 0), lines = [label(t.bucket), `Total ${money(totals[active])}`, ...parts.map(f => `${FAMILY_NAME[f]} ${money(t.by_family[f])}`)];
        const w = 128, h = 10 + lines.length * 15, cx = pad + active * slot + slot / 2, x = Math.min(Math.max(cx - w / 2, pad), W - 8 - w), y = Math.max(0, H - (totals[active] / max) * (H - 8) - h - 6);
        return <g className="chart-tip" role="presentation" pointerEvents="none"><rect x={x} y={y} width={w} height={h} rx="6" />{lines.map((l, k) => <text key={k} x={x + 8} y={y + 16 + k * 15} className={k === 0 ? 'tip-head' : ''}>{l}</text>)}</g>; })()}
    </svg>
    <ul className="legend">{FAMILIES.filter(f => f !== 'other' || series.some(s => s.by_family?.other)).map(f => <li key={f}><span className={`chip-mono fam-${f}`} aria-hidden="true">{MONO[f]}</span>{FAMILY_NAME[f]}</li>)}</ul></div>;
}

const cw = r => (r.tokens?.cache_write_5m || 0) + (r.tokens?.cache_write_1h || 0);
const COLS = [['label', 'Name', r => r.label, false], ['requests', 'Requests', r => r.requests, true], ['input', 'Input', r => r.tokens?.input, true, 'col-detail'], ['cw', 'Cache write', cw, true, 'col-detail'],
  ['cr', 'Cache read', r => r.tokens?.cache_read, true, 'col-detail'], ['output', 'Output', r => r.tokens?.output, true, 'col-detail'], ['hit', 'Cache hit', r => r.cache_hit, true, 'col-detail'], ['cost', 'Cost', r => r.cost_usd ?? -1, true]];

function Breakdown({rows, group, totalCost, unpriced}) {
  const [sort, setSort] = useState({key: 'cost', dir: -1});
  const [openRows, setOpen] = useState({});
  const col = COLS.find(c => c[0] === sort.key);
  const sorted = useMemo(() => [...rows].sort((a, b) => { const x = col[2](a), y = col[2](b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; }), [rows, sort, col]);
  const toggle = id => setOpen(v => ({...v, [id]: !v[id]}));
  return <div className="card"><h2>Breakdown</h2><div className="table-wrap"><table className="hx-table"><thead><tr>
    {COLS.map(([key, label, , numeric, cls]) => <th key={key} className={`${numeric ? 'num' : ''} ${cls || ''}`} aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-btn" onClick={() => setSort(s => ({key, dir: s.key === key ? -s.dir : key === 'label' ? 1 : -1}))}>{label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>)}
    <th>Share</th></tr></thead><tbody>
    {sorted.map(r => { const expandable = group === 'session'; const isOpen = openRows[r.id];
      return <Fragment key={r.id}><tr>
        <td className="name-cell">{expandable && <button type="button" className="icon-btn small" aria-expanded={!!isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} main and subagent split for ${scrub(r.label)}`} onClick={() => toggle(r.id)}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}
          {group === 'model' ? <ModelChip model={r.id} family={r.family} /> : <span>{scrub(r.label)}</span>}</td>
        <td className="num numeric">{r.requests}</td><td className="num numeric col-detail" title={full(r.tokens?.input)}>{tokens(r.tokens?.input)}</td><td className="num numeric col-detail" title={full(cw(r))}>{tokens(cw(r))}</td>
        <td className="num numeric col-detail" title={full(r.tokens?.cache_read)}>{tokens(r.tokens?.cache_read)}</td><td className="num numeric col-detail" title={full(r.tokens?.output)}>{tokens(r.tokens?.output)}</td>
        <td className="num numeric col-detail">{pct(r.cache_hit)}</td>
        <td className="num numeric">{r.cost_usd == null ? <span className="mini-pill unpriced" title="Unknown model price">unpriced</span> : money(r.cost_usd)}</td>
        <td className="share-cell">{r.cost_usd != null && totalCost > 0 && <span className="share"><i className={`fill-${r.family}`} style={{width: `${Math.min(100, (r.cost_usd / totalCost) * 100)}%`}} /></span>}</td></tr>
        {expandable && isOpen && <><tr className="sub-row"><td className="name-cell indent">Main session</td><td className="num numeric">{r.main?.requests ?? <Dash />}</td><td colSpan="5" /><td className="num numeric">{money(r.main?.cost_usd)}</td><td /></tr>
          <tr className="sub-row"><td className="name-cell indent">All subagents</td><td className="num numeric">{r.subagents?.requests ?? <Dash />}</td><td colSpan="5" /><td className="num numeric">{money(r.subagents?.cost_usd)}</td><td /></tr>
          {(r.children || []).map(c => <tr className="sub-row" key={c.id}><td className="name-cell indent2"><ModelChip model={c.model} family={c.family} /> {scrub(c.label)}</td><td className="num numeric">{c.requests}</td><td colSpan="5" /><td className="num numeric">{money(c.cost_usd)}</td><td /></tr>)}</>}
      </Fragment>; })}</tbody></table></div>
    {unpriced > 0 && <p className="muted footnote">{unpriced} requests unpriced (unknown model)</p>}</div>;
}

const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');

export default function UsageScreen() {
  const {api, limits} = useContext(AppContext);
  const [range, setRange] = useState(() => RANGES.some(([k]) => k === hashQuery().get('range')) ? hashQuery().get('range') : 'today');
  const [group, setGroup] = useState('model');
  const [copied, setCopied] = useState('');
  useEffect(() => { const sync = () => { const r = hashQuery().get('range'); if (RANGES.some(([k]) => k === r)) setRange(r); if (hashQuery().get('section') === 'limits') document.getElementById('limits')?.scrollIntoView?.(); }; addEventListener('hashchange', sync); sync(); return () => removeEventListener('hashchange', sync); }, []);
  const {data, error, receivedAt, refresh} = usePoll(async () => expectSchema(await api.usage({range, group}), 'helix.usage.v1'), {interval: 30000, enabled: !!api, deps: [range, group]});
  if (!api) return <OfflinePanel />;
  const current = data && data.range === range && data.group === group;
  async function copyCsv() {
    const lines = [['name', 'requests', 'input', 'cache_write', 'cache_read', 'output', 'cost_usd'], ...data.rows.map(r => [scrub(r.label), r.requests, r.tokens?.input ?? '', cw(r), r.tokens?.cache_read ?? '', r.tokens?.output ?? '', r.cost_usd ?? ''])];
    const csv = lines.map(l => l.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
    try { if (api.copy) await api.copy(csv); else await navigator.clipboard.writeText(csv); setCopied('Copied usage table as CSV.'); } catch { setCopied('Copy failed.'); }
  }
  const t = data?.totals;
  return <div>
    <PlanLimitsCard limits={limits} />
    <div className="tab-row"><div className="seg" role="tablist" aria-label="Range">{RANGES.map(([k, l]) => <button type="button" role="tab" key={k} aria-selected={range === k} onClick={() => setRange(k)}>{l}</button>)}</div>
      <div className="seg" role="tablist" aria-label="Group">{GROUPS.map(([k, l]) => <button type="button" role="tab" key={k} aria-selected={group === k} onClick={() => setGroup(k)}>{l}</button>)}</div></div>
    {error && <ErrorBanner message="Could not refresh usage." onRetry={refresh} lastUpdated={receivedAt} />}
    {!data ? (error ? null : <Skeleton count={3} label="Loading usage" />) : data.rows.length === 0 ? <EmptyState>No usage recorded in this range.</EmptyState> : <div className={`${error || !current ? 'stale-data' : ''}`} aria-busy={!current}>
      <section className="totals" aria-label="Totals">
        <div className="card stat"><span>Cost</span><strong className="numeric big" id="total-cost">{money(t.cost_usd)}</strong><small>API list-price equivalent; subscription plans are not billed per token</small></div>
        <div className="card stat"><span>Tokens</span><strong className="numeric big" title={full(sumTokens(t))}>{tokens(sumTokens(t))}</strong></div>
        <div className="card stat"><span>Requests</span><strong className="numeric big">{full(t.requests)}</strong></div>
        <div className="card stat"><span>Cache hit</span><strong className="numeric big">{pct(t.cache_hit)}</strong></div></section>
      <Chart series={data.series} range={range} />
      <Breakdown rows={data.rows} group={group} totalCost={t.cost_usd} unpriced={t.unpriced_requests} />
      <div className="export-row"><button type="button" className="hx-button" onClick={copyCsv}><Copy size={14} aria-hidden="true" />Copy as CSV</button><span role="status" className="muted">{copied}</span></div></div>}
    <LastUpdated at={receivedAt} />
  </div>;
}
