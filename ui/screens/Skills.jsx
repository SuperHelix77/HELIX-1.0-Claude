import React, {useContext, useMemo, useState} from 'react';
import {Copy, Search} from 'lucide-react';
import {AppContext, expectSchema, usePoll} from '../hooks.js';
import {scrub} from '../format.js';
import Drawer from '../components/Drawer.jsx';
import {EmptyState, ErrorBanner, OfflinePanel, Skeleton} from '../components/States.jsx';

const FILTERS = [['all', 'All'], ['user', 'Skills'], ['plugin', 'Plugin skills'], ['flow', 'hx flows']];
const kindOf = i => i.kind === 'flow' ? 'flow' : i.source === 'plugin' ? 'plugin' : 'user';
const badge = i => i.kind === 'flow' ? 'hx flow' : i.source === 'plugin' ? `plugin: ${i.plugin}` : 'user skill';
// Every query word must be a substring of name+description, or a subsequence of the name.
const subseq = (needle, hay) => { let i = 0; for (const c of hay) if (c === needle[i]) i++; return i === needle.length; };
const matches = (i, q) => !q || q.toLowerCase().split(/\s+/).filter(Boolean).every(w => `${i.name} ${i.description}`.toLowerCase().includes(w) || subseq(w, i.name.toLowerCase()));

export default function SkillsScreen() {
  const {api} = useContext(AppContext);
  const [q, setQ] = useState(''), [filter, setFilter] = useState('all'), [open, setOpen] = useState(null), [toast, setToast] = useState('');
  const {data, error, refresh} = usePoll(async () => expectSchema(await api.catalog(), 'helix.catalog.v1'), {interval: 0, enabled: !!api});
  const items = data?.items || [];
  const shown = useMemo(() => items.filter(i => (filter === 'all' || kindOf(i) === filter) && matches(i, q)), [items, q, filter]);
  if (!api) return <OfflinePanel />;
  async function copy(item) {
    try { if (api.copy) await api.copy(item.invoke); else await navigator.clipboard.writeText(item.invoke); setToast(`Copied ${item.invoke}. Paste it into Claude Code.`); }
    catch { setToast('Copy failed.'); }
  }
  if (!data) return error ? <ErrorBanner message="Could not read skills and flows." onRetry={refresh} /> : <Skeleton count={3} label="Loading skills and flows" />;
  const current = items.find(i => `${i.kind}:${i.invoke}` === open);
  return <div>
    <div className="skills-tools"><label className="search-field"><Search size={16} aria-hidden="true" /><span className="hx-sr">Search skills and flows</span>
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search skills and flows" autoComplete="off" /></label>
      <div className="chips" role="group" aria-label="Filter by source">{FILTERS.map(([k, l]) => <button type="button" key={k} className="filter-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div></div>
    <p className="muted small note-line">HELIX never runs a skill or flow. Copy the command and paste it into your Claude Code session.</p>
    <p className="hx-toast" role="status" aria-live="polite">{toast}</p>
    {shown.length === 0 ? <EmptyState>{items.length ? 'Nothing matches this search.' : 'No skills or flows found.'}</EmptyState> :
      <ul className="catalog-list">{shown.map(i => <li className="catalog-row" key={`${i.kind}:${i.invoke}`}>
        <button type="button" className="catalog-open" onClick={() => setOpen(`${i.kind}:${i.invoke}`)} aria-label={`Details for ${scrub(i.name)}`}>
          <span className="catalog-name"><strong>{scrub(i.name)}</strong><span className="mini-pill">{badge(i)}</span></span><span className="catalog-desc">{scrub(i.description) || 'No description.'}</span></button>
        <button type="button" className="hx-button primary" onClick={() => copy(i)} aria-label={`Copy ${i.invoke}`}><Copy size={14} aria-hidden="true" />Copy</button></li>)}</ul>}
    <Drawer open={!!current} title={current ? scrub(current.name) : ''} onClose={() => setOpen(null)}>{current && <div className="catalog-detail">
      <p><span className="mini-pill">{badge(current)}</span></p><p>{scrub(current.description) || 'No description.'}</p>
      <p><code>{current.invoke}</code> <button type="button" className="hx-button primary" onClick={() => copy(current)}><Copy size={14} aria-hidden="true" />Copy</button></p>
      {current.kind === 'flow' && <><h3>Arguments</h3><p>{current.args?.length ? current.args.join(', ') : 'None declared.'}</p><h3>Steps</h3>
        <table className="hx-table"><thead><tr><th>Name</th><th>Kind</th><th>Quiet</th><th>Digest</th></tr></thead><tbody>{(current.steps || []).map((s, k) => <tr key={k}><td>{scrub(s.as)}</td><td>{scrub(s.kind)}</td><td>{s.quiet ? 'yes' : 'no'}</td><td>{s.has_digest ? 'yes' : 'no'}</td></tr>)}</tbody></table></>}</div>}</Drawer>
  </div>;
}
