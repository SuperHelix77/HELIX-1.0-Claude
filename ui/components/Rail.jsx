import React, {useState} from 'react';
import {Activity, Coins, Database, Ellipsis, FlaskConical, Settings, Sparkles} from 'lucide-react';
import ThemeControl from '../ThemeControl.jsx';

export const ROUTES = [['live', 'Live', Activity], ['usage', 'Usage', Coins], ['runs', 'Runs', FlaskConical], ['memory', 'Memory', Database], ['skills', 'Skills & flows', Sparkles], ['settings', 'Settings', Settings]];
const TABS = ROUTES.slice(0, 4);
const MORE = ROUTES.slice(4);

export function Rail({route, mark, demo}) {
  return <aside className="rail-hx"><div className="rail-inner">
    <div className="rail-brand"><img src={mark} alt="" width="24" height="24" /><strong>HELIX</strong></div>
    <nav aria-label="Primary">{ROUTES.map(([id, label, Icon]) => <a key={id} href={`#${id}`} aria-current={route === id ? 'page' : undefined}><Icon size={18} aria-hidden="true" /><span>{label}</span></a>)}</nav>
    <div className="rail-foot"><p className="rail-privacy">{demo ? 'Public fixture only' : 'Local only. No prompts, paths or emails are shown.'}</p><ThemeControl /></div>
  </div></aside>;
}

export function TabBar({route}) {
  const [more, setMore] = useState(false);
  const moreActive = MORE.some(([id]) => id === route);
  return <>
    {more && <div className="more-sheet" role="group" aria-label="More">
      {MORE.map(([id, label, Icon]) => <a key={id} href={`#${id}`} aria-current={route === id ? 'page' : undefined} onClick={() => setMore(false)}><Icon size={18} aria-hidden="true" />{label}</a>)}
      <ThemeControl /></div>}
    <nav className="tabbar-hx" aria-label="Primary mobile">
      {TABS.map(([id, label, Icon]) => <a key={id} href={`#${id}`} aria-current={route === id ? 'page' : undefined}><Icon size={20} aria-hidden="true" /><span>{label}</span></a>)}
      <button type="button" aria-expanded={more} aria-current={moreActive ? 'page' : undefined} onClick={() => setMore(v => !v)}><Ellipsis size={20} aria-hidden="true" /><span>More</span></button>
    </nav></>;
}
