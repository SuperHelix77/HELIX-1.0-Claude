import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {privateJSON, readPrivateJSON} from './local-state.mjs';
import {pricingRows, PRICING_AS_OF} from './pricing.mjs';
const PRIVACY = ['show_project_names', 'show_action_details', 'show_prompts', 'show_full_paths'];
const SOURCES = ['claude', 'codex', 'helix_logs', 'plan_limits'];
const DEFAULTS = {privacy: {show_project_names: true, show_action_details: true, show_prompts: false, show_full_paths: false},
  sources: {claude: true, codex: true, helix_logs: true, plan_limits: true, bench_root: null}};
export function defaultBenchRoot(home) { return path.join(home, '.claude-lean', 'bench', 'new50-full'); }
export class UiSettings {
  constructor({directory, home = os.homedir()}) { this.file = path.join(directory, 'ui-settings.json'); this.home = home; }
  load() {
    let saved = {}; try { saved = readPrivateJSON(this.file); } catch {}
    return {privacy: {...DEFAULTS.privacy, ...(saved.privacy || {})},
      sources: {...DEFAULTS.sources, ...(saved.sources || {}), bench_root: saved.sources?.bench_root || defaultBenchRoot(this.home)}};
  }
  view(tilde) {
    const s = this.load();
    return {schema: 'helix.settings.v1', privacy: s.privacy, sources: {...s.sources, bench_root: tilde(s.sources.bench_root)}, pricing: {as_of: PRICING_AS_OF, rows: pricingRows()}};
  }
  save(patch) {
    const bad = (m) => { throw new Error(m); };
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !['privacy', 'sources'].includes(k))) bad('Unknown settings key');
    const current = this.load(), next = structuredClone(current);
    for (const [group, allowed] of [['privacy', PRIVACY], ['sources', [...SOURCES, 'bench_root']]]) {
      const value = patch[group]; if (value === undefined) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value)) bad(`Invalid ${group}`);
      for (const [k, v] of Object.entries(value)) {
        if (!allowed.includes(k)) bad(`Unknown settings key ${group}.${k}`);
        if (k === 'bench_root') {
          if (typeof v !== 'string' || !v || v.length > 1024) bad('Invalid bench_root');
          const abs = path.resolve(v.startsWith('~') ? path.join(this.home, v.slice(1)) : v);
          let real; try { real = fs.realpathSync(abs); } catch { bad('bench_root must exist'); }
          const base = fs.realpathSync(this.home);
          if (real !== base && !real.startsWith(base + path.sep)) bad('bench_root must be inside the home directory');
          if (!fs.statSync(real).isDirectory()) bad('bench_root must be a directory');
          next.sources.bench_root = real;
        } else { if (typeof v !== 'boolean') bad(`${group}.${k} must be boolean`); next[group][k] = v; }
      }
    }
    privateJSON(this.file, next);
    return next;
  }
}
