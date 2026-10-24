import React from 'react';

export const level = value => value == null ? 'none' : value >= 0.9 ? 'hot' : value >= 0.7 ? 'warn' : 'ok';

// Always render a numeric label next to the meter; colour alone never carries the value.
export default function Meter({value, label, valueText}) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const now = known ? Math.round(value * 100) : undefined;
  return <span className={`meter m-${level(known ? value : null)}`}>
    <span className="meter-track" role={known ? 'meter' : undefined} aria-label={label} aria-valuemin={known ? 0 : undefined} aria-valuemax={known ? 100 : undefined} aria-valuenow={now} aria-valuetext={valueText}>
      <span className="meter-fill" style={{width: `${Math.min(100, now ?? 0)}%`}} />
    </span>
  </span>;
}
