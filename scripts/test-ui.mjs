import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer, preview} from 'vite';
import {chromium} from 'playwright';
import {playback, modelPhases} from '../ui/playback.mjs';
import {liveFixture, liveSessionFixture, SENTINEL_PROMPT} from '../ui/fixtures/live.mjs';
import {usageFixture} from '../ui/fixtures/usage.mjs';
import {limitsFixture} from '../ui/fixtures/limits.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'docs/assets');
await fs.mkdir(assets, {recursive: true});
// Test inputs are immutable; native watching can stall on macOS parent paths.
const server = await createServer({root, mode: 'monitor', server: {host: '127.0.0.1', port: 0},
  plugins: [{name: 'helix-immutable-ui-test', configResolved(config) { config.server.watch = null; }}]});
assert.equal(server.config.server.watch, null, 'Automated UI checks must not create native watchers');
let browser, releaseServer;
const errors = [];
try {
  await server.listen();
  console.log('UI check: local development server ready');
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const channel = process.env.HELIX_UI_BROWSER_CHANNEL || (process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? 'chrome' : undefined);
  browser = await chromium.launch({headless: true, channel, timeout: 30000});
  console.log('UI check: isolated headless browser ready');
  const page = await browser.newPage({viewport: {width: 1440, height: 1080}, reducedMotion: 'reduce'});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/?demo=1#settings`);
  await page.getByRole('heading', {name: 'Engine overview'}).waitFor();
  await page.getByText('DEMO / PLAYBACK', {exact: true}).first().waitFor();
  console.log('UI check: playback loaded');
  assert.equal(await page.getByText('Synthetic fixture. No live engine, model calls, or benchmark results.').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path: path.join(assets, 'monitor-dark-desktop.png'), fullPage: true});
  await page.getByRole('radio', {name: 'Light theme'}).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.screenshot({path: path.join(assets, 'monitor-desktop.png'), fullPage: true});
  await page.getByRole('radio', {name: 'Light theme'}).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('radio', {name: 'Dark theme'}).getAttribute('aria-checked'), 'true');
  await page.reload();
  assert.equal(await page.evaluate(() => localStorage.getItem('helix.theme')), 'dark');
  await page.getByRole('radio', {name: 'Light theme'}).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Desktop must not overflow horizontally');
  await page.getByRole('button', {name: 'Inspect tool-flow resume'}).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').getByText('playback-event-08', {exact: true}).count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('link', {name: 'Evidence'}).click();
  await page.getByRole('heading', {name: 'Operation evidence'}).waitFor();
  assert.equal(new URL(page.url()).hash, '#settings/evidence');
  await page.getByLabel('Operation status', {exact: true}).selectOption('failed');
  assert.equal(await page.locator('.operations tbody tr').count(), 1);
  assert.match(await page.locator('.operations tbody').textContent(), /failed/);
  await page.getByLabel('Search operations', {exact: true}).fill('nonexistent');
  await page.getByText('No matching operations', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Clear operation search'}).click();
  await page.getByLabel('Operation status', {exact: true}).selectOption('all');
  await page.getByLabel('Sort operations', {exact: true}).selectOption('slowest');
  assert.match(await page.locator('.operations tbody tr').first().textContent(), /126 ms/);
  await page.screenshot({path: path.join(assets, 'monitor-evidence.png'), fullPage: true});
  await page.getByRole('link', {name: 'Memory', exact: true}).click();
  await page.getByRole('heading', {name: 'Deterministic memory'}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Search memory', exact: true}).isDisabled(), true);
  await page.getByRole('button', {name: /Verify a deterministic tool result/}).click();
  assert.equal(await page.getByRole('dialog').getByText('Stored only; no request implied', {exact: true}).count(), 1);
  await page.getByRole('button', {name: 'Close inspector'}).click();
  await page.getByRole('link', {name: 'Runs', exact: true}).click();
  await page.getByText('No benchmark loaded', {exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Choose evidence'}).isDisabled(), true);

  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`${url}/?demo=1#settings`);
  await page.getByRole('heading', {name: 'Engine overview'}).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile must not overflow horizontally');
  await page.screenshot({path: path.join(assets, 'monitor-mobile.png'), fullPage: true});
  await page.getByRole('button', {name: 'More', exact: true}).click();
  await page.getByRole('radio', {name: 'Dark theme'}).click();
  await page.getByRole('button', {name: 'More', exact: true}).click();
  await page.getByRole('link', {name: 'Flow', exact: true}).click();
  await page.getByRole('heading', {name: 'Flow', exact: true}).waitFor();
  assert.equal(await page.locator('.sidebar.mobile-open').count(), 0);
  await page.screenshot({path: path.join(assets, 'monitor-dark-mobile.png'), fullPage: true});
  await page.locator('.node-memory').click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').getByText('In use by a current request', {exact: true}).count(), 1);
  await page.keyboard.press('Escape');

  const offline = await browser.newPage({viewport: {width: 1280, height: 800}});
  await offline.goto(`${url}/#settings`);
  await offline.getByText('Local engine is offline', {exact: true}).waitFor();
  assert.equal(await offline.getByText('DEMO / PLAYBACK', {exact: true}).count(), 0);
  await offline.screenshot({path: path.join(assets, 'monitor-offline.png'), fullPage: true});
  await offline.close();
  console.log('UI check: responsive playback and offline states passed');

  const loading = await browser.newPage();
  await loading.addInitScript(() => { window.helix = {snapshot: () => new Promise(() => {})}; });
  await loading.goto(`${url}/#settings`);
  await loading.getByText('Waiting for engine snapshot', {exact: true}).waitFor();
  assert.equal(await loading.getByText('Connecting to engine', {exact: true}).count(), 1);
  await loading.close();

  const malformed = await browser.newPage();
  await malformed.addInitScript(() => { window.helix = {snapshot: async () => ({schema: 'unsupported'})}; });
  await malformed.goto(`${url}/#settings`);
  await malformed.getByRole('alert').waitFor();
  assert.match(await malformed.getByRole('alert').textContent(), /No snapshot available/);
  await malformed.close();

  const connected = await browser.newPage({viewport: {width: 1440, height: 1000}});
  connected.on('pageerror', error => errors.push(error.message));
  const empty = {...playback, active: [], events: [], goals: [], counters: {...playback.counters, operations: 0, failed: 0, memory_lookups: 0}, memory: {...playback.memory, notes: 0}, graph: {...playback.graph, active: []}, monitored_benchmark: {status: 'prepared', phase: 'Waiting for explicit launch', current: 0, requests: 0}};
  const aggregate = {name: 'Public test aggregate', complete: false, model: 'test-model', effort: 'high', lanes: {vanilla: {solves: 1, submitted: 2, graded: 2, requests: 4, input: 100, output: 50, reasoning: 20, tokens: 150, unknown: 1, failed_requests: 1, failed_issues: 1, failed_issue_requests: 1, compactions: 0}, modified: {solves: 1, submitted: 2, graded: 2, requests: 3, input: 80, output: 40, reasoning: 10, tokens: 120, unknown: 0, failed_requests: 0, failed_issues: 1, failed_issue_requests: 1, compactions: 0}}, pairs: [{order: 'vanilla-first', instance_id: 'public-sample-01', vanilla_pass: false, modified_pass: true, vanilla_tokens: 150, modified_tokens: 120}], known_savings_percent: 20, output_savings_percent: 20, complete_savings_percent: null, limitations: ['Public synthetic test data only.']};
  await connected.addInitScript(({snapshot, benchmark}) => {
    window.testCalls = {snapshots: 0, memory: [], browse: [], reads: [], connections: 0, diagnostics: 0, restarts: 0, benchmark: 0, currentReads: 0, maxReads: 0};
    window.testSnapshot = snapshot;
    window.failSnapshot = false;
    window.failBenchmark = false;
    window.testBenchmark = null;
    window.helix = {
      snapshot: async () => { window.testCalls.snapshots++; if (window.failSnapshot) throw new Error('Test disconnect'); return window.testSnapshot; },
      benchmark: async () => { window.testCalls.benchmark++; window.testCalls.currentReads++; window.testCalls.maxReads = Math.max(window.testCalls.maxReads, window.testCalls.currentReads); try { await new Promise(resolve => setTimeout(resolve, 30)); if (window.failBenchmark) throw new Error('Test benchmark read failed'); return window.testBenchmark; } finally { window.testCalls.currentReads--; } },
      chooseBenchmark: async () => { window.testBenchmark = {...benchmark, live: {status: 'prepared', current: 0, instance_id: null, requests: 0, known_input: 0, known_output: 0, known_tokens: 0, unknown_usage: 0, graded: 0, submitted: 0, solved: 0, phase: 'Awaiting explicit benchmark launch', activity: []}}; return window.testBenchmark; },
      memorySearch: async args => { window.testCalls.memory.push(args); return {content: [{type: 'text', text: 'PUBLIC TEST MEMORY RESULT'}]}; },
      memoryProjects: async () => [{project: 'public-test', notes: 1, source: 'helix'}],
      memoryBrowse: async args => { window.testCalls.browse.push(args); return {notes: [{id: args.cursor ? 'public-note-2' : 'public-note-1', title: args.cursor ? 'Second public note' : 'Public exact note', preview: 'Public preview', created: 1792023000000, source: args.source}], next_cursor: args.cursor ? null : 20}; },
      memoryRead: async args => { window.testCalls.reads.push(args); return {id: args.id, body: 'EXACT_STORED_TEXT\n  preserve spacing'}; },
      connectClaudeMem: async () => { window.testCalls.connections++; return {status: 'Public Claude-Mem connected'}; },
      diagnostics: async () => { window.testCalls.diagnostics++; return {checks: [{id: 'public-core', label: 'Local core connection', status: 'ok', detail: 'Public core reachable', remedy: null}], checked_at: Date.now(), model_calls: 0}; },
      restartCore: async () => { window.testCalls.restarts++; return {status: 'Public restart completed'}; },
      onModelState: listener => { window.testModelListener = listener; return () => { window.testModelListener = null; }; },
    };
  }, {snapshot: empty, benchmark: aggregate});
  await connected.goto(`${url}/#settings`);
  await connected.getByText('No requests running', {exact: true}).waitFor();
  await connected.getByText('No operations recorded', {exact: true}).waitFor();
  await connected.getByText('No stored goals', {exact: true}).waitFor();
  await connected.getByRole('region', {name: 'Development run observation'}).getByText('Pending', {exact: true}).waitFor();
  for (const model of modelPhases) {
    await connected.evaluate(value => { window.testSnapshot.model_state = value; }, model);
    await connected.getByRole('button', {name: 'Refresh snapshot'}).click();
    await connected.waitForFunction(value => document.querySelector('.model-section .badge')?.textContent === value, model.state);
    assert.equal(await connected.getByRole('status', {name: 'Observed reasoning'}).getAttribute('data-active'), String(model.state === 'reasoning'), `Reasoning lamp during ${model.state}`);
  }
  for (const phase of ['reasoning', 'generating', 'idle']) {
    await connected.evaluate(value => window.testModelListener({state: value, observed: true, model: 'Public native fixture', source: 'codex-native', updated_at: Date.now(), detail: 'Synthetic native phase event'}), phase);
    await connected.waitForFunction(value => document.querySelector('.model-section .badge')?.textContent === value, phase, {timeout: 1000});
    assert.equal(await connected.getByRole('status', {name: 'Observed reasoning'}).getAttribute('data-active'), String(phase === 'reasoning'));
  }
  await connected.evaluate(() => { window.testSnapshot.model_state = {...window.testSnapshot.model_state, state: 'reasoning', observed: false}; });
  await connected.getByRole('button', {name: 'Refresh snapshot'}).click();
  await connected.waitForFunction(() => document.querySelector('.model-section .badge')?.textContent === 'reasoning');
  assert.equal(await connected.getByRole('status', {name: 'Observed reasoning'}).getAttribute('data-active'), 'false', 'Unobserved reasoning must not illuminate the lamp');
  await connected.evaluate(() => { window.testSnapshot.model_state.observed = true; });
  await connected.getByRole('button', {name: 'Refresh snapshot'}).click();
  await connected.waitForFunction(() => document.querySelector('.reasoning-panel')?.dataset.active === 'true');
  await connected.getByRole('button', {name: 'Pause updates'}).click();
  assert.equal(await connected.getByRole('status', {name: 'Observed reasoning'}).getAttribute('data-active'), 'false', 'Paused observations cannot claim live reasoning');
  const pausedCalls = await connected.evaluate(() => window.testCalls.snapshots);
  await connected.waitForTimeout(2200);
  assert.equal(await connected.evaluate(() => window.testCalls.snapshots), pausedCalls, 'Paused monitor must not poll');
  await connected.evaluate(() => { window.failSnapshot = true; });
  await connected.getByRole('button', {name: 'Refresh snapshot'}).click();
  await connected.getByRole('alert').waitFor();
  assert.match(await connected.getByRole('alert').textContent(), /Last snapshot retained/);
  assert.equal(await connected.getByText('Engine unavailable', {exact: true}).count(), 1);
  await connected.evaluate(() => { window.failSnapshot = false; });
  await connected.getByRole('button', {name: 'Refresh snapshot'}).click();
  await connected.getByText('Engine online', {exact: true}).waitFor();
  await connected.getByRole('link', {name: 'Memory', exact: true}).click();
  assert.deepEqual(await connected.evaluate(() => window.testCalls.memory), [], 'Memory must not search automatically');
  await connected.getByLabel('Project', {exact: true}).fill('public-test');
  await connected.getByLabel('Query', {exact: true}).fill('literal note');
  await connected.getByRole('button', {name: 'Search memory', exact: true}).click();
  await connected.getByText('PUBLIC TEST MEMORY RESULT', {exact: true}).waitFor();
  assert.deepEqual(await connected.evaluate(() => window.testCalls.memory), [{project: 'public-test', query: 'literal note', source: 'helix', limit: 20}]);
  assert.deepEqual(await connected.evaluate(() => window.testCalls.browse), [], 'Memory browsing requires an explicit request');
  await connected.getByRole('button', {name: 'Browse notes', exact: true}).click();
  await connected.getByRole('button', {name: /Public exact note/}).click();
  await connected.getByRole('dialog').waitFor();
  assert.match(await connected.locator('.exact-note').textContent(), /EXACT_STORED_TEXT/);
  assert.match(await connected.locator('.exact-note').textContent(), /preserve spacing/);
  assert.equal(await connected.locator('.exact-note').textContent(), 'EXACT_STORED_TEXT\n  preserve spacing', 'Exact note bodies preserve newlines and spacing');
  assert.deepEqual(await connected.evaluate(() => window.testCalls.reads), [{id: 'public-note-1', project: 'public-test', source: 'helix'}]);
  await connected.getByRole('button', {name: 'Close inspector'}).click();
  await connected.getByRole('button', {name: 'Load more notes', exact: true}).click();
  await connected.getByRole('button', {name: /Second public note/}).waitFor();
  assert.equal(await connected.locator('.memory-note').count(), 2, 'Memory pagination retains the earlier page');
  assert.equal(await connected.evaluate(() => window.testCalls.browse.at(-1).cursor), 20);
  await connected.getByLabel('Memory source', {exact: true}).selectOption('claude-mem');
  assert.equal(await connected.locator('.memory-note').count(), 0, 'Changing source clears earlier results');
  await connected.getByRole('button', {name: 'Browse notes', exact: true}).click();
  await connected.getByRole('button', {name: /Public exact note/}).waitFor();
  assert.equal(await connected.evaluate(() => window.testCalls.browse.at(-1).source), 'claude-mem');
  assert.equal(await connected.evaluate(() => window.testCalls.connections), 0, 'Claude-Mem connection requires an explicit request');
  await connected.getByRole('button', {name: 'Connect Claude-Mem', exact: true}).click();
  await connected.getByText('Public Claude-Mem connected', {exact: true}).waitFor();
  assert.equal(await connected.evaluate(() => window.testCalls.connections), 1);
  assert.equal(await connected.getByLabel('Memory source', {exact: true}).inputValue(), 'claude-mem');
  await connected.getByRole('link', {name: 'Settings', exact: true}).click();
  await connected.getByRole('link', {name: 'Troubleshooting', exact: true}).click();
  await connected.getByText('Public core reachable', {exact: true}).waitFor();
  assert.equal(await connected.evaluate(() => window.testCalls.restarts), 0, 'Diagnostics must not repair automatically');
  await connected.getByRole('button', {name: 'Restart core', exact: true}).click();
  assert.equal(await connected.evaluate(() => window.testCalls.restarts), 0, 'Restart requires explicit confirmation');
  await connected.getByRole('button', {name: 'Cancel', exact: true}).click();
  assert.equal(await connected.evaluate(() => window.testCalls.restarts), 0);
  await connected.getByRole('button', {name: 'Restart core', exact: true}).click();
  await connected.getByRole('button', {name: 'Confirm restart', exact: true}).click();
  await connected.getByText('Public restart completed', {exact: true}).waitFor();
  assert.equal(await connected.evaluate(() => window.testCalls.restarts), 1, 'A confirmed restart executes once');
  await connected.getByRole('link', {name: 'Runs', exact: true}).click();
  await connected.getByText('No benchmark loaded', {exact: true}).waitFor();
  await connected.getByRole('button', {name: 'Choose evidence'}).click();
  await connected.getByText('Public test aggregate', {exact: true}).waitFor();
  await connected.getByText('Not established', {exact: true}).waitFor();
  await connected.getByText('Failed issue requests', {exact: true}).waitFor();
  assert.equal(await connected.getByText('public-sample-01', {exact: true}).count(), 1);
  await connected.getByText('Pending', {exact: true}).waitFor();
  await connected.getByText('Prepared. Execution has not started.', {exact: true}).waitFor();
  await connected.evaluate(() => { window.testBenchmark.live = {status: 'running', current: 3, instance_id: 'public-live-test-03', requests: 9, known_input: 210, known_output: 111, known_tokens: 321, unknown_usage: 1, graded: 2, submitted: 3, solved: 1, phase: 'Evaluating public issue', activity: [{id: 'public-activity-1', at: Date.now(), kind: 'model', action: 'response', status: 'complete', input_tokens: 210, output_tokens: 111}]}; });
  await connected.getByText('Evaluating public issue', {exact: true}).waitFor();
  await connected.getByText('public-live-test-03', {exact: true}).waitFor();
  await connected.getByText('321', {exact: true}).waitFor();
  assert.equal(await connected.evaluate(() => window.testCalls.maxReads), 1, 'Benchmark reads must not overlap');
  await connected.getByRole('button', {name: 'Pause benchmark updates'}).click();
  const benchmarkReads = await connected.evaluate(() => window.testCalls.benchmark);
  await connected.waitForTimeout(2200);
  assert.equal(await connected.evaluate(() => window.testCalls.benchmark), benchmarkReads, 'Paused benchmark must not poll');
  await connected.evaluate(() => { window.failBenchmark = true; });
  await connected.getByRole('button', {name: 'Refresh benchmark'}).click();
  await connected.getByText('Stale observation', {exact: true}).waitFor();
  assert.equal(await connected.getByText('public-live-test-03', {exact: true}).count(), 1, 'Stale benchmark must retain prior data');
  await connected.evaluate(() => { window.failBenchmark = false; window.testBenchmark.live.status = 'completed'; });
  await connected.getByRole('button', {name: 'Refresh benchmark'}).click();
  await connected.getByText('completed', {exact: true}).waitFor();
  await connected.getByRole('link', {name: 'Settings', exact: true}).click();
  const inactiveReads = await connected.evaluate(() => window.testCalls.benchmark);
  await connected.waitForTimeout(2200);
  assert.equal(await connected.evaluate(() => window.testCalls.benchmark), inactiveReads, 'Hidden benchmark view must not poll');


  // ---- WP2: shell, Live and Usage (fixtures only) ----
  const designDir = path.join(root, 'docs/design');
  await fs.mkdir(designDir, {recursive: true});
  const privacyOK = async page => {
    const text = await page.evaluate(() => document.body.innerText);
    assert.equal(/\/Users\/|\/home\/|[^\s@]+@[^\s@]+\.[^\s@]+/.test(text), false, 'No local paths or emails rendered');
    assert.equal(text.includes(SENTINEL_PROMPT), false, 'Prompt sentinel must not render');
  };
  const noOverflow = async (page, label) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal overflow`);
  const shoot = async (page, file) => { const style = await page.addStyleTag({content: '.topbar-hx,.tabbar-hx{position:static!important}.skip-link{display:none!important}'}); await page.evaluate(() => { document.activeElement?.blur?.(); scrollTo(0, 0); }); await page.screenshot({path: file, fullPage: true}); await style.evaluate(node => node.remove()); };
  const matrix = [['desktop', {width: 1440, height: 1080}], ['mobile', {width: 375, height: 812}]];
  for (const theme of ['light', 'dark']) for (const [size, viewport] of matrix) {
    const page = await browser.newPage({viewport, reducedMotion: 'reduce'});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => localStorage.setItem('helix.theme', value), theme);
    await page.goto(`${url}/?demo=1`);
    await page.getByRole('heading', {name: 'Live', exact: true}).waitFor();
    await page.locator('.session-card').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
    assert.ok(await page.locator('.session-card').count() >= 2, 'Live shows >= 2 session cards');
    const opus = page.locator('.session-card', {hasText: 'Opus 5.5'}).first();
    assert.match(await opus.textContent(), /Running Bash/);
    assert.ok(await opus.locator('.subagent-row', {hasText: 'Haiku'}).count() >= 1, 'Haiku subagent row');
    assert.equal(await opus.locator('.chip-mono').first().textContent(), 'O', 'Model chip carries a monogram');
    const meter = opus.locator('[role=meter]').first();
    assert.ok(await meter.getAttribute('aria-valuenow') !== null, 'Context meter has aria-valuenow');
    assert.match(await opus.locator('.cost-ticker strong').first().textContent(), /^\$\d/);
    assert.equal(await opus.locator('.actions li').count(), 5, 'Last 5 actions');
    assert.match(await page.locator('.plan-meter').nth(0).textContent(), /5h.*70%.*resets/);
    assert.match(await page.locator('.plan-meter').nth(1).textContent(), /Week.*84%.*resets|Week.*84%/);
    assert.match(await page.locator('.today-cost').textContent(), /Today\s*\$\d/);
    assert.equal(await page.getByText('Synthetic fixture. No live engine, model calls, or benchmark results.').count(), 1);
    await noOverflow(page, `live ${size} ${theme}`); await privacyOK(page);
    assert.equal(await page.locator('.hx-page-sub').textContent(), 'What every model is doing right now, and what it costs.');
    for (const icon of await page.locator('button:visible').all()) {
      const named = (await icon.getAttribute('aria-label')) || (await icon.textContent()).trim();
      assert.ok(named, 'Every button has an accessible name');
    }
    if (size === 'desktop') {
      const [rail, doc] = await page.evaluate(() => [document.querySelector('.rail-hx').getBoundingClientRect().height, document.documentElement.scrollHeight]);
      assert.ok(Math.abs(rail - doc) <= 1, `Rail spans document height (${rail} vs ${doc})`);
    }
    await page.evaluate(() => document.fonts.ready);
    await shoot(page, path.join(assets, size === 'desktop' ? `live-${theme}-desktop.png` : `live-${theme}-mobile.png`));
    if (theme === 'light') await shoot(page, path.join(designDir, `after-live-${size}.png`));
    // keyboard: Tab reaches a session card, Enter opens the drawer, Escape closes it
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement?.classList.contains('card-open')); }
    assert.ok(reached, 'Tab order reaches session cards');
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor();
    await page.getByRole('tab', {name: 'Requests'}).click();
    await page.getByRole('dialog').getByText('Cache write').first().waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0, 'Escape closes the drawer');
    // top bar -> usage
    await page.locator('.plan-meter').first().click();
    await page.getByRole('heading', {name: 'Plan limits'}).waitFor();
    assert.match(new URL(page.url()).hash, /^#usage/);
    await page.getByRole('heading', {name: 'Usage', exact: true}).waitFor();
    await page.getByText('API list-price equivalent').waitFor();
    assert.notEqual(await page.locator('.hx-page-sub').textContent(), 'What every model is doing right now, and what it costs.');
    assert.equal((await page.locator('.chart .bar').count()) > 0, true);
    await noOverflow(page, `usage ${size} ${theme}`); await privacyOK(page);
    await page.evaluate(() => document.fonts.ready);
    await shoot(page, path.join(assets, `usage-${theme}-${size}.png`));
    if (theme === 'light') await shoot(page, path.join(designDir, `after-usage-${size}.png`));
    // redirects
    for (const [from, to] of [['overview', '#live'], ['chats', '#live'], ['flow', '#live'], ['benchmarks', '#runs'], ['evidence', '#settings'], ['troubleshooting', '#settings']]) {
      await page.goto(`${url}/?demo=1#${from}`);
      await page.waitForFunction(expected => location.hash === expected, to);
    }
    await page.close();
  }
  console.log('UI check: Live and Usage demo, desktop and mobile, light and dark passed');

  // ---- WP3: Runs, Memory, Skills, Settings, polish fixes, share ----
  for (const theme of ['light', 'dark']) for (const [size, viewport] of matrix) {
    const page = await browser.newPage({viewport, reducedMotion: 'reduce'});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => localStorage.setItem('helix.theme', value), theme);
    const open = async (route, heading) => { await page.goto(`${url}/?demo=1#${route}`); await page.getByRole('heading', {name: heading, exact: true}).first().waitFor(); await page.evaluate(() => document.fonts.ready); };
    const finish = async (name, label) => {
      await noOverflow(page, `${name} ${label}`); await privacyOK(page);
      for (const b of await page.locator('button:visible').all()) assert.ok(((await b.getAttribute('aria-label')) || (await b.textContent())).trim(), `${name}: every button has a name`);
      if (theme === 'light') await shoot(page, path.join(designDir, `after-${name}-${size}.png`));
    };
    const label = `${size} ${theme}`;
    // top bar: share action, and on mobile both meters on one compact row (fix d)
    await open('live', 'Live');
    const share = page.getByRole('button', {name: 'Share snapshot'});
    assert.equal(await share.count(), 1, 'Top bar has Share snapshot'); assert.equal(await share.isDisabled(), true, 'Share needs the desktop bridge');
    if (size === 'mobile') {
      const [a, b, bar] = await Promise.all([page.locator('.plan-meter').nth(0).boundingBox(), page.locator('.plan-meter').nth(1).boundingBox(), page.locator('.topbar-hx').boundingBox()]);
      assert.ok(Math.abs(a.y - b.y) <= 2 && b.x > a.x + a.width - 1, 'Meters share one row');
      assert.ok(b.x + b.width <= 375 && bar.height <= 120, `Compact mobile top bar (${bar.height}px)`);
      // fix a: two-line subagent rows, no orphan wrap
      const row = page.locator('.subagent-row').first();
      const box = async sel => row.locator(sel).first().boundingBox();
      const [chip, desc, tok, cost, whole] = [await box('.chip'), await box('.sub-desc'), await box('.sub-tok'), await box('.sub-cost'), await row.boundingBox()];
      assert.ok(Math.abs(chip.y - desc.y) <= 6, 'Chip and label on the first line');
      assert.ok(tok.y > desc.y + 6 && Math.abs(tok.y - cost.y) <= 2, 'Tokens and cost on the second line');
      assert.ok(whole.x + whole.width - (cost.x + cost.width) <= 2, 'Cost is right-aligned');
      assert.ok(whole.height <= 64, `Subagent row stays two lines (${whole.height}px)`);
    }
    // fix b: unpriced is small muted text, not the large ticker
    const unpriced = page.locator('.cost-ticker .unpriced').first();
    assert.equal(await unpriced.count(), 1, 'Unpriced session shows muted text');
    const sizes = await page.evaluate(() => [parseFloat(getComputedStyle(document.querySelector('.cost-ticker .unpriced')).fontSize), parseFloat(getComputedStyle(document.querySelector('.cost-ticker strong')).fontSize)]);
    assert.ok(sizes[0] < sizes[1] && sizes[0] <= 13, `unpriced is small (${sizes[0]}px vs ${sizes[1]}px)`);
    assert.equal(await page.locator('.cost-ticker strong', {hasText: 'unpriced'}).count(), 0, 'unpriced is not in the large mono ticker');
    // fix c: y-axis max label and per-bar tooltips on hover and focus
    await open('usage', 'Usage');
    assert.match(await page.locator('.chart .y-max').textContent(), /^\$\d/, 'Chart y-axis max label');
    await page.locator('.chart .bar').nth(1).hover();
    assert.match(await page.locator('.chart-tip').textContent(), /Total \$\d/, 'Hover tooltip shows the bar value');
    await page.mouse.move(0, 0);
    assert.equal(await page.locator('.chart-tip').count(), 0, 'Tooltip hides on leave');
    await page.locator('.chart .bar').nth(2).focus();
    assert.match(await page.locator('.chart-tip').textContent(), /Total \$\d/, 'Focus tooltip shows the bar value');
    // Runs
    await open('runs', 'Runs');
    await page.getByRole('heading', {name: 'Lane comparison'}).waitFor();
    assert.equal(await page.locator('.lane-col').count(), 2, 'Runs: one column per lane');
    assert.equal(await page.locator('.lane-col h3 .mini-pill', {hasText: 'baseline'}).count(), 1);
    assert.equal(await page.locator('.results-table tbody tr').count(), 50, 'Runs: 50 task rows');
    assert.ok(await page.locator('.results-table th', {hasText: 'Cost (per-task delta)'}).count() >= 1, 'Continuous-lane cost is labelled as a per-task delta');
    assert.equal(await page.locator('.results-table th', {hasText: /^helixy solved/}).count(), 1);
    assert.match(await page.locator('.note-line').first().textContent(), /per-task delta/);
    await page.getByRole('button', {name: 'Both solved'}).click();
    const both = await page.locator('.results-table tbody tr').count(); assert.ok(both > 0 && both < 50, `Filter narrows rows (${both})`);
    await page.getByRole('button', {name: 'All', exact: true}).click();
    await page.locator('.results-table th .th-btn', {hasText: 'Cost difference'}).click();
    assert.equal(await page.locator('.results-table th', {hasText: 'Cost difference'}).getAttribute('aria-sort'), 'ascending');
    assert.equal(await page.locator('.root-line code').textContent(), '~/.claude-lean/bench/new50-full');
    assert.equal(await page.locator('.hx-page-sub').textContent(), 'Benchmark results from the configured folder.');
    await finish('runs', label);
    // Memory
    await open('memory', 'Memory');
    await page.getByRole('heading', {name: 'Deterministic memory'}).waitFor();
    await page.locator('.memory-note').first().waitFor();
    assert.equal(await page.locator('.memory-note').count(), 3, 'Memory: recent notes listed');
    await page.getByLabel('Memory source', {exact: true}).waitFor();
    await page.locator('input[name=query]').fill('cache'); await page.getByRole('button', {name: 'Search memory'}).click();
    await page.getByText('1 notes returned').waitFor();
    await page.locator('.memory-note').first().click();
    await page.getByRole('dialog').getByText('Stored only; synthetic public demo text.').waitFor();
    await page.keyboard.press('Escape');
    await finish('memory', label);
    // Skills & flows
    await open('skills', 'Skills & flows');
    assert.equal(await page.locator('.catalog-row').count(), 6);
    await page.getByRole('searchbox').fill('debug');
    assert.equal(await page.locator('.catalog-row').count(), 1);
    await page.getByRole('searchbox').fill('');
    await page.getByRole('button', {name: 'hx flows'}).click();
    assert.equal(await page.locator('.catalog-row').count(), 2);
    await page.getByRole('button', {name: 'All', exact: true}).click();
    await page.getByRole('button', {name: 'Copy /brainstorming'}).click();
    await page.getByText('Copied /brainstorming. Paste it into Claude Code.').waitFor();
    assert.equal(await page.getByRole('button', {name: /^Copy hx contract/}).count(), 1, 'Flow copy is hx invocation');
    await page.getByRole('button', {name: 'Details for contract'}).click();
    await page.getByRole('dialog').getByRole('heading', {name: 'Steps'}).waitFor();
    assert.equal(await page.getByRole('dialog').locator('tbody tr').count(), 2);
    await page.keyboard.press('Escape');
    await finish('skills', label);
    // Settings
    await open('settings', 'Settings');
    await page.getByRole('heading', {name: 'Pricing'}).waitFor();
    const pricing = await page.locator('.pricing-table tbody tr').allTextContents();
    assert.equal(pricing.length, 4, 'Pricing: opus, sonnet, haiku x2');
    assert.match(pricing[0], /Opus.*\$4\.00.*\$20\.00.*\$0\.20.*\$5\.00.*\$8\.00/);
    assert.match(pricing[1], /Sonnet.*\$2\.00.*\$10\.00.*\$0\.10.*\$2\.50.*\$4\.00/);
    assert.match(pricing[2], /Haiku.*<=100K.*\$0\.10.*\$0\.50.*\$0\.01\b/); assert.match(pricing[3], /Haiku.*>100K.*\$0\.50.*\$2\.50.*\$0\.05\b/);
    assert.equal(await page.getByRole('switch').count(), 8);
    assert.equal(await page.getByRole('switch', {name: /Show prompts/}).isChecked(), false);
    assert.equal(await page.getByRole('switch', {name: /Show full paths/}).isChecked(), false);
    await page.getByRole('switch', {name: /Show full paths/}).click();
    await page.getByText('Show full paths: on.').waitFor();
    await page.getByRole('heading', {name: 'Engine overview'}).waitFor();
    assert.equal(await page.getByRole('link', {name: 'Open diagnostics'}).getAttribute('href'), '#settings/troubleshooting');
    await finish('settings', label);
    await page.close();
  }
  console.log('UI check: Runs, Memory, Skills, Settings, polish fixes and share action, desktop and mobile, light and dark passed');
  // Share action calls the preload bridge and reports without leaking the path
  const sharePage = await browser.newPage({viewport: {width: 1440, height: 900}});
  await sharePage.addInitScript(() => { window.helix = {live: async () => ({schema: 'helix.live.v1', sessions: [], totals: {}, engine: {}}), limits: async () => ({schema: 'helix.limits.v1', windows: {}}), usage: async () => ({schema: 'helix.usage.v1', totals: {}, rows: [], series: []}), shareSnapshot: async () => { window.shared = true; return {saved: true}; }}; });
  await sharePage.goto(`${url}/#live`);
  await sharePage.getByRole('button', {name: 'Share snapshot'}).click();
  await sharePage.getByText(/Snapshot saved/).waitFor();
  assert.equal(await sharePage.evaluate(() => window.shared), true);
  await sharePage.close();

  // Stubbed preload: recorded calls, unpriced rows, session split
  const usageMap = {};
  for (const range of ['5h', 'today', '7d', '30d']) for (const group of ['model', 'session', 'project']) usageMap[`${range}:${group}`] = usageFixture({range, group});
  const stubInit = ({live, limits, usage, session}) => {
    window.testCalls = {usage: [], live: 0, session: []};
    window.failLive = false;
    window.helix = {
      live: async () => { window.testCalls.live++; if (window.failLive) return {schema: 'broken'}; return live; },
      liveSession: async key => { window.testCalls.session.push(key); return session; },
      limits: async () => limits,
      usage: async args => { window.testCalls.usage.push(args); return usage[`${args.range}:${args.group}`]; },
      copy: async text => { window.copied = text; },
    };
  };
  const stub = await browser.newPage({viewport: {width: 1440, height: 1000}});
  stub.on('pageerror', error => errors.push(error.message));
  const liveData = liveFixture();
  await stub.addInitScript(stubInit, {live: liveData, limits: limitsFixture(), usage: usageMap, session: liveSessionFixture(liveData.sessions[2].key)});
  await stub.goto(`${url}/#usage`);
  await stub.getByRole('heading', {name: 'Usage', exact: true}).waitFor();
  await stub.getByRole('tab', {name: '7d'}).click();
  await stub.waitForFunction(() => window.testCalls.usage.some(c => c.range === '7d' && c.group === 'model'));
  await stub.getByRole('tab', {name: 'By session'}).click();
  await stub.waitForFunction(() => window.testCalls.usage.some(c => c.range === '7d' && c.group === 'session'));
  await stub.getByRole('button', {name: /Show main and subagent split for Checkout redesign/}).click();
  await stub.getByText('Main session', {exact: true}).waitFor();
  await stub.getByText('All subagents', {exact: true}).waitFor();
  await stub.getByRole('tab', {name: 'By model'}).click();
  await stub.getByText('unpriced', {exact: true}).first().waitFor();
  const shownCost = await stub.locator('#total-cost').textContent();
  const expected = usageMap['7d:model'].rows.filter(r => r.cost_usd != null).reduce((a, r) => a + r.cost_usd, 0);
  assert.equal(shownCost, `$${expected.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 'Totals exclude unpriced rows');
  await stub.getByText(/requests unpriced \(unknown model\)/).waitFor();
  await stub.getByRole('button', {name: 'Copy as CSV'}).click();
  assert.match(await stub.evaluate(() => window.copied), /^"name","requests"/);
  // sortable header
  await stub.getByRole('button', {name: /^Requests/}).click();
  assert.equal(await stub.locator('th[aria-sort="descending"]').count(), 1);
  // error with prior data
  await stub.goto(`${url}/#live`);
  await stub.locator('.session-card').first().waitFor();
  await stub.evaluate(() => { window.failLive = true; });
  await stub.getByRole('alert').waitFor({timeout: 6000});
  assert.ok(await stub.locator('.session-card').count() >= 2, 'Prior data stays visible on error');
  await stub.evaluate(() => { window.failLive = false; });
  await stub.getByRole('button', {name: 'Retry'}).click();
  await stub.waitForFunction(() => !document.querySelector('[role=alert]'));
  await stub.close();

  const hang = await browser.newPage();
  await hang.addInitScript(() => { window.helix = {live: () => new Promise(() => {}), usage: () => new Promise(() => {}), limits: () => new Promise(() => {})}; });
  await hang.goto(`${url}/#live`);
  await hang.locator('[aria-busy="true"]').first().waitFor();
  await hang.close();

  const emptyPage = await browser.newPage();
  await emptyPage.addInitScript(({limits}) => { window.helix = {live: async () => ({schema: 'helix.live.v1', sessions: [], engine: {flows: [], shell: []}}), limits: async () => limits,
    usage: async args => ({schema: 'helix.usage.v1', range: args.range, group: args.group, totals: {requests: 0}, series: [], rows: []})}; }, {limits: limitsFixture()});
  await emptyPage.goto(`${url}/#live`);
  await emptyPage.getByText('No Claude or Codex session active in the last 30 minutes.').waitFor();
  await emptyPage.getByRole('link', {name: 'Show last 7 days in Usage'}).click();
  await emptyPage.getByText('No usage recorded in this range.').waitFor();
  await emptyPage.close();

  const noApi = await browser.newPage();
  await noApi.goto(`${url}/#live`);
  await noApi.getByText(/HELIX engine not connected/).waitFor();
  assert.equal(await noApi.getByRole('link', {name: 'view the demo'}).getAttribute('href'), '?demo=1');
  await noApi.close();
  console.log('UI check: usage refetch, session split, unpriced rows, loading, error, empty and offline states passed');

  // The dev server sets NODE_ENV. Isolate production compilation so React's
  // development transform cannot embed absolute source filenames in release JS.
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'production', '--logLevel', 'error'],
    {cwd: root, env: {...process.env, NODE_ENV: 'production'}, stdio: 'pipe', timeout: 60000});
  const files = await fs.readdir(path.join(root, 'dist/assets'));
  const releaseJS = (await Promise.all(files.filter(file => file.endsWith('.js')).map(file => fs.readFile(path.join(root, 'dist/assets', file), 'utf8')))).join('\n');
  assert.equal(/jsxDEV|jsx-dev-runtime|react\.development|\/Users\/[A-Za-z0-9._-]+\//.test(releaseJS), false, 'Release JS must exclude development transforms and personal source paths');
  assert.equal(releaseJS.includes('Development benchmark monitor'), false, 'Release bundle must exclude benchmark component');
  assert.equal(releaseJS.includes('Vanilla (historical)'), false, 'Release bundle must exclude benchmark aggregate UI');
  assert.equal(releaseJS.includes('Development run observation'), false, 'Release bundle must exclude benchmark overview strip');
  releaseServer = await preview({root, mode: 'production', logLevel: 'error', preview: {host: '127.0.0.1', port: 0}});
  const releaseURL = `http://127.0.0.1:${releaseServer.httpServer.address().port}`;
  const release = await browser.newPage({viewport: {width: 1440, height: 1000}});
  release.on('pageerror', error => errors.push(error.message));
  await release.goto(`${releaseURL}/?demo=1#benchmarks`);
  await release.getByRole('heading', {name: 'Runs', exact: true}).waitFor();
  assert.equal(new URL(release.url()).hash, '#runs');
  await release.getByRole('link', {name: 'Settings', exact: true}).click();
  await release.getByRole('heading', {name: 'Engine overview'}).waitFor();
  assert.equal(await release.getByRole('link', {name: 'Benchmarks', exact: true}).count(), 0, 'Release navigation must exclude Benchmarks');
  assert.equal(await release.getByRole('heading', {name: 'Development benchmark monitor'}).count(), 0, 'Release deep link must not expose benchmark view');
  assert.equal(await release.getByRole('heading', {name: 'Engine overview'}).count(), 1);
  await release.getByRole('radio', {name: 'System theme'}).click();
  await release.emulateMedia({colorScheme: 'light'});
  await release.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await release.emulateMedia({colorScheme: 'dark'});
  await release.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await release.screenshot({path: path.join(assets, 'release-dark-desktop.png'), fullPage: true});
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('UI verified: monitor-only benchmarks; real release build/preview excludes benchmark component, navigation and deep link; dark/light/system theme, keyboard selection and persistence; read-only benchmark polling, no overlapping reads, pause, stale retention, recovery and stop-on-leave; existing playback/layout/evidence/memory checks. Public fixture screenshots in docs/assets.');
} finally {
  await browser?.close();
  await server.close();
  if (releaseServer) await new Promise(resolve => releaseServer.httpServer.close(resolve));
}
