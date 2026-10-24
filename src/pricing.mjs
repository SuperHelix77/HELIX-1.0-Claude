// USD per million tokens. Opus/Sonnet/Haiku 5.5 rates per the corrected brief (as_of 2026-10).
export const PRICING_AS_OF = '2026-10';
export const PRICING_SOURCE = 'https://www.anthropic.com/pricing';
const row = (input, output, read, w5, w1) => ({input, output, read, write_5m: w5, write_1h: w1});
const haiku = (input, output, read) => row(input, output, read, input * 1.25, input * 2);
export const PRICES = {
  'claude-opus-5-5': {family: 'opus', context_window: 1000000, tiers: [{up_to: Infinity, ...row(4, 20, 0.2, 5, 8)}]},
  'claude-sonnet-5-5': {family: 'sonnet', context_window: 1000000, tiers: [{up_to: Infinity, ...row(2, 10, 0.1, 2.5, 4)}]},
  'claude-haiku-5-5': {family: 'haiku', context_window: 1000000, tiers: [{up_to: 100000, ...haiku(0.1, 0.5, 0.01)}, {up_to: Infinity, ...haiku(0.5, 2.5, 0.05)}]},
};
export function normalizeModel(model) { return typeof model === 'string' ? model.replace(/-\d{8}$/, '').replace(/\[.*\]$/, '') : ''; }
export function familyOf(model) {
  const m = normalizeModel(model);
  if (PRICES[m]) return PRICES[m].family;
  const hit = /(opus|sonnet|haiku)/.exec(m); if (hit) return hit[1];
  return /gpt|codex/.test(m) ? 'codex' : 'other';
}
export function contextWindow(model) { return PRICES[normalizeModel(model)]?.context_window || 200000; }
export function modelLabel(model) {
  const m = /^claude-(opus|sonnet|haiku)-(\d+(?:-\d+)*)/.exec(normalizeModel(model));
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace(/-/g, '.')}` : String(model || 'unknown');
}
// tokens: {input, cache_write_5m, cache_write_1h, cache_read, output}; returns USD or null for unknown models.
export function priceRequest(model, tokens, {speed, geo} = {}) {
  const entry = PRICES[normalizeModel(model)]; if (!entry) return null;
  const prompt = tokens.input + tokens.cache_write_5m + tokens.cache_write_1h + tokens.cache_read;
  const p = entry.tiers.find(t => prompt <= t.up_to);
  let usd = (tokens.input * p.input + tokens.cache_write_5m * p.write_5m + tokens.cache_write_1h * p.write_1h + tokens.cache_read * p.read + tokens.output * p.output) / 1e6;
  if (speed === 'fast') usd *= 2;
  if (geo === 'us') usd *= 1.1;
  return usd;
}
export function pricingRows() {
  return Object.entries(PRICES).flatMap(([model, e]) => e.tiers.map((t, i) => ({model, tier: e.tiers.length > 1 ? (i ? '>100K prompt' : '<=100K prompt') : 'all',
    input: t.input, cache_write_5m: t.write_5m, cache_write_1h: t.write_1h, cache_read: t.read, output: t.output, as_of: PRICING_AS_OF, source: PRICING_SOURCE})));
}
