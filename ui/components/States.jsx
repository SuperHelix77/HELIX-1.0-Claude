import React from 'react';
import {CircleAlert, Inbox, Unplug, RefreshCw} from 'lucide-react';
import {clockSeconds} from '../format.js';

export function Skeleton({count = 3, label = 'Loading'}) {
  return <div className="skeleton-grid" aria-busy="true" aria-label={label} role="status">{Array.from({length: count}, (_, i) => <div className="skeleton-card" key={i}><i /><i /><i /><i /></div>)}</div>;
}
export function EmptyState({icon: Icon = Inbox, children, action}) {
  return <div className="empty-state"><Icon size={26} strokeWidth={1.4} aria-hidden="true" /><p>{children}</p>{action}</div>;
}
export function ErrorBanner({message, onRetry, lastUpdated}) {
  return <div className="error-banner" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{message || 'Something went wrong.'}{lastUpdated ? ` Showing data from ${clockSeconds(lastUpdated)}.` : ''}</span>
    <button type="button" className="hx-button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Retry</button></div>;
}
export function LastUpdated({at}) { return at ? <p className="last-updated">Last updated {clockSeconds(at)}</p> : null; }
export function OfflinePanel() {
  return <div className="empty-state offline-panel"><Unplug size={28} strokeWidth={1.4} aria-hidden="true" />
    <p>HELIX engine not connected. Open the HELIX desktop app, or <a href="?demo=1">view the demo</a>.</p></div>;
}
export const Dash = ({why = 'Not reported by source'}) => <span className="dash" title={why}>—</span>;
