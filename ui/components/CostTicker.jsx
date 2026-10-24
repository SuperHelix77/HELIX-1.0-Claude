import React, {useEffect, useRef, useState} from 'react';
import {money} from '../format.js';

export default function CostTicker({value, last, title}) {
  const previous = useRef(value);
  const [flash, setFlash] = useState(0);
  useEffect(() => { if (previous.current !== value) { previous.current = value; setFlash(n => n + 1); } }, [value]);
  const known = typeof value === 'number';
  return <div className="cost-ticker" title={title}>
    {known ? <strong key={flash} className={`numeric ${flash ? 'flash' : ''}`}>{money(value)}</strong> : <span className="unpriced" title="No list price for this model">unpriced</span>}
    {typeof last === 'number' && <small className="numeric">+{money(last)} last request</small>}
  </div>;
}
