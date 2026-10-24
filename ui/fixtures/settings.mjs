import {pricingRows, PRICING_AS_OF} from '../../src/pricing.mjs';
export function settingsFixture(saved = {}) {
  return {schema: 'helix.settings.v1', privacy: {show_project_names: true, show_action_details: true, show_prompts: false, show_full_paths: false, ...(saved.privacy || {})},
    sources: {claude: true, codex: true, helix_logs: true, plan_limits: true, bench_root: '~/.claude-lean/bench/new50-full', ...(saved.sources || {})}, pricing: {as_of: PRICING_AS_OF, rows: pricingRows()}};
}
export const memoryDemo = {
  memoryProjects: async () => [{project: 'helix-demo', notes: 3, source: 'helix'}],
  memorySearch: async () => ({notes: [{id: 'd1', title: 'Usage cache decision', preview: 'Cache reads are priced separately from fresh input.', source: 'helix', created: '2026-10-20T10:00:00Z'}]}),
  memoryBrowse: async () => ({notes: [
    {id: 'd1', title: 'Usage cache decision', preview: 'Cache reads are priced separately from fresh input.', source: 'helix', created: '2026-10-20T10:00:00Z'},
    {id: 'd2', title: 'Plan limit source', preview: 'Limits come from the status line log only.', source: 'helix', created: '2026-10-18T09:30:00Z'},
    {id: 'd3', title: 'Release checklist', preview: 'Build, test, check and privacy audit before packaging.', source: 'helix', created: '2026-10-15T16:10:00Z'}], next_cursor: null}),
  memoryRead: async ({id}) => ({id, title: 'Demo note', body: 'Stored only; synthetic public demo text.', source: 'helix', created: '2026-10-20T10:00:00Z'}),
};
