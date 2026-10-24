import React from 'react';
import {Pause, Play, RefreshCw, Share2} from 'lucide-react';
import Meter from './Meter.jsx';
import {clock, money, pct, resetLabel} from '../format.js';

function PlanMeter({label, window: w, now}) {
  const observed = Date.parse(w?.observed_at);
  const stale = w && (w.state === 'stale' || (Number.isFinite(observed) && now - observed > 600000));
  const expired = w?.state === 'expired';
  const value = w && !expired && typeof w.utilization === 'number' ? w.utilization : null;
  const text = !w || w.state === 'unknown' ? '—' : expired ? 'reset' : pct(value);
  const reset = w?.resets_at ? `resets ${resetLabel(w.resets_at, now)}` : '';
  return <a className="plan-meter" href="#usage?section=limits" aria-label={`${label} plan limit ${text}${reset ? `, ${reset}` : ''}${stale ? `, as of ${clock(observed)}` : ''}`}
    title={w ? (expired ? 'Reset since last observation' : stale ? `Observed at ${clock(observed)}` : 'Open plan limits') : 'Never observed'}>
    <span className="pm-label">{label}</span><Meter value={value} label={`${label} plan limit`} valueText={text} />
    <span className="pm-val numeric">{text}</span>{reset && <span className="pm-reset">{reset}</span>}{stale && <span className="pm-stale">as of {clock(observed)}</span>}
  </a>;
}

export default function PlanStrip({limits, todayCost, status, tone, paused, onPause, onRefresh, pauseDisabled, onShare, shareDisabled}) {
  const now = Date.now();
  const w = limits?.windows || {};
  return <header className="topbar-hx">
    <a className="tb-brand" href="#live" aria-label="HELIX Live">HELIX</a>
    <span className={`hx-badge tone-${tone}`}><span className="dot" />{status}</span>
    <div className="tb-meters">
      <PlanMeter label="5h" window={w.five_hour} now={now} />
      <PlanMeter label="Week" window={w.seven_day} now={now} />
    <a className="today-cost" href="#usage?range=today" aria-label={`Today ${money(todayCost)}`}>Today <strong className="numeric">{typeof todayCost === 'number' ? money(todayCost) : '—'}</strong></a>
    </div>
    <span className="tb-actions">
      <button type="button" className="icon-btn" aria-label={paused ? 'Resume updates' : 'Pause updates'} onClick={onPause} disabled={pauseDisabled}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
      <button type="button" className="icon-btn" aria-label="Share snapshot" title={shareDisabled ? 'Available in the HELIX desktop app' : 'Save a privacy-filtered snapshot'} onClick={onShare} disabled={shareDisabled}><Share2 size={16} /></button>
      <button type="button" className="icon-btn" aria-label="Refresh snapshot" onClick={onRefresh}><RefreshCw size={16} /></button>
    </span>
  </header>;
}
