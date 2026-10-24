import React from 'react';
import {family as familyOf, modelName, MONO} from '../format.js';

export default function ModelChip({model, family}) {
  const fam = family || familyOf(model);
  return <span className={`chip fam-${fam}`} title={model || 'Unknown model'}><span className="chip-mono" aria-hidden="true">{MONO[fam]}</span><span className="chip-name">{modelName(model, fam)}</span></span>;
}
