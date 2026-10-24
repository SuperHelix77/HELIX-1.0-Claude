export function catalogFixture() {
  return {schema: 'helix.catalog.v1', items: [
    {kind: 'skill', source: 'user', plugin: null, name: 'brainstorming', description: 'Explore requirements and design before implementation.', invoke: '/brainstorming'},
    {kind: 'skill', source: 'user', plugin: null, name: 'code-review', description: 'Review a diff for correctness, risk and missing tests.', invoke: '/code-review'},
    {kind: 'skill', source: 'plugin', plugin: 'superpowers', name: 'debugging', description: 'Systematic root-cause debugging before proposing fixes.', invoke: '/superpowers:debugging'},
    {kind: 'skill', source: 'plugin', plugin: 'superpowers', name: 'writing-plans', description: 'Turn a spec into a step-by-step implementation plan.', invoke: '/superpowers:writing-plans'},
    {kind: 'flow', name: 'contract', description: 'Extract the public contract of a symbol with evidence.', invoke: 'hx contract FILE:SYMBOL', args: ['$1'], steps: [{as: 'find', kind: 'search', quiet: true, has_digest: false}, {as: 'read', kind: 'read', quiet: false, has_digest: true}]},
    {kind: 'flow', name: 'verify', description: 'Run the project checks and digest the output.', invoke: 'hx verify', args: [], steps: [{as: 'test', kind: 'shell', quiet: true, has_digest: true}]},
  ]};
}
