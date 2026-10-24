// Synthetic, public fixture (helix.limits.v1).
export function limitsFixture(now = Date.now()) {
  return {schema: 'helix.limits.v1', windows: {
    five_hour: {utilization: 0.7, resets_at: new Date(now + 134 * 60000).toISOString(), observed_at: new Date(now - 3 * 60000).toISOString(), state: 'fresh', source: 'statusline'},
    seven_day: {utilization: 0.84, resets_at: new Date(now + 50 * 3600000).toISOString(), observed_at: new Date(now - 3 * 60000).toISOString(), state: 'fresh', source: 'statusline'}}};
}
