import React, {useContext, useState} from 'react';
import {ShieldCheck, Wrench} from 'lucide-react';
import {AppContext, expectSchema, usePoll} from '../hooks.js';
import {scrub} from '../format.js';
import ModelChip from '../components/ModelChip.jsx';
import {ErrorBanner, Skeleton} from '../components/States.jsx';

const PRIVACY = [['show_project_names', 'Show project names', 'Folder name only, never the full path.'], ['show_action_details', 'Show action details', 'Tool descriptions and file base names.'],
  ['show_prompts', 'Show prompts', 'Off by default. Prompt text is never sent to this screen unless enabled.'], ['show_full_paths', 'Show full paths', 'Off by default. Even when on, your home folder is shown as ~.']];
const SOURCES = [['claude', 'Claude Code transcripts'], ['codex', 'Codex threads'], ['helix_logs', 'HELIX logs'], ['plan_limits', 'Plan-limit log']];
const rate = v => `$${v.toFixed(3).replace(/0$/, "")}`;

function Toggle({id, label, hint, checked, onChange, disabled}) {
  return <label className="toggle-row" htmlFor={id}><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
    <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /></label>;
}

export default function SettingsScreen() {
  const {api} = useContext(AppContext);
  const {data, error, refresh} = usePoll(async () => expectSchema(await api.settings(), 'helix.settings.v1'), {interval: 0, enabled: !!api && typeof api.settings === 'function'});
  const [message, setMessage] = useState(''), [root, setRoot] = useState(null);
  if (!api?.settings) return <p className="muted small note-line">Privacy, sources and pricing settings are available in the HELIX desktop app.</p>;
  if (!data) return error ? <ErrorBanner message="Could not read settings." onRetry={refresh} /> : <Skeleton count={2} label="Loading settings" />;
  async function save(patch, ok) {
    try { await api.saveSettings(patch); setMessage(ok); refresh(); } catch { setMessage('Could not save that setting.'); }
  }
  const rows = data.pricing?.rows || [];
  return <div className="settings-sections">
    <section className="card" aria-labelledby="privacy-h"><h2 id="privacy-h"><ShieldCheck size={16} aria-hidden="true" /> Privacy</h2>
      {PRIVACY.map(([key, label, hint]) => <Toggle key={key} id={`p-${key}`} label={label} hint={hint} checked={!!data.privacy[key]} onChange={v => save({privacy: {[key]: v}}, `${label}: ${v ? 'on' : 'off'}.`)} />)}</section>
    <section className="card" aria-labelledby="sources-h"><h2 id="sources-h">Data sources</h2>
      {SOURCES.map(([key, label]) => <Toggle key={key} id={`s-${key}`} label={label} checked={!!data.sources[key]} onChange={v => save({sources: {[key]: v}}, `${label}: ${v ? 'on' : 'off'}.`)} />)}
      <form className="root-form" onSubmit={e => { e.preventDefault(); if (root) save({sources: {bench_root: root}}, 'Benchmark folder saved.'); }}>
        <label>Benchmark folder<input value={root ?? data.sources.bench_root ?? ''} onChange={e => setRoot(e.target.value)} autoComplete="off" /></label>
        <button type="submit" className="hx-button" disabled={!root || root === data.sources.bench_root}>Save folder</button></form>
      <p className="muted small">Must be inside your home folder. Shown in ~ form.</p></section>
    <p className="hx-toast" role="status" aria-live="polite">{message}</p>
    <section className="card" aria-labelledby="pricing-h"><h2 id="pricing-h">Pricing</h2>
      <p className="muted small">USD per 1M tokens, as of {scrub(data.pricing?.as_of)}. Cost is an API list-price equivalent, not a bill.</p>
      <div className="table-wrap"><table className="hx-table pricing-table"><caption className="hx-sr">Model pricing in USD per million tokens</caption>
        <thead><tr><th>Model</th><th>Prompt size</th><th className="num">Input</th><th className="num">Output</th><th className="num">Cache read</th><th className="num">Cache write 5m</th><th className="num">Cache write 1h</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td><ModelChip model={r.model} /></td><td>{r.tier === 'all' ? 'Any' : r.tier}</td><td className="num numeric">{rate(r.input)}</td><td className="num numeric">{rate(r.output)}</td><td className="num numeric">{rate(r.cache_read)}</td><td className="num numeric">{rate(r.cache_write_5m)}</td><td className="num numeric">{rate(r.cache_write_1h)}</td></tr>)}</tbody></table></div>
      {rows[0]?.source && <p className="muted small">Source: {scrub(rows[0].source)}</p>}</section>
    <section className="card" aria-labelledby="diag-h"><h2 id="diag-h"><Wrench size={16} aria-hidden="true" /> Diagnostics</h2>
      <p className="muted small">Environment checks and a guarded restart of the local core.</p><a className="hx-button" href="#settings/troubleshooting">Open diagnostics</a></section>
    <section className="card" aria-labelledby="about-h"><h2 id="about-h">About</h2><p className="muted small">HELIX 1.0. Local only: this app reads files on your machine and sends nothing anywhere. Stored context is evidence, never authorization to resume work.</p></section>
  </div>;
}
