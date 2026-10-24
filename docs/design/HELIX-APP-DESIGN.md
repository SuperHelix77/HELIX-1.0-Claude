# HELIX 1.0 desktop makeover: "See every model, every token, every dollar"

Owner: design (Opus). Status: final spec for Sonnet implementers. One design, no options.
Repo: HELIX-1.0 (Electron `desktop/`, Vite+React `ui/`, service `src/service.mjs`).
Screenshots of the current state: `~/.claude-lean/design/current-*.png`.

---

## 1. Current-state critique

Captured from the dev UI (`vite --mode monitor`, `?demo=1` playback and the plain offline URL), 1280px and 375px.

| # | Finding | Evidence |
|---|---|---|
| C1 | **No tokens or money anywhere.** The UI answers "is the engine up", not "what is each model doing and what does it cost". The only usage view is the dev-only Benchmarks page. | current-overview-desktop.png |
| C2 | **Claude is invisible.** Live Chats reads only Codex rollouts (`codex-chat-index.mjs`); Claude Code sessions, subagents and their models never appear. The model strip shows one synthetic model; it is bound to a single Codex thread via `observe-codex`. | current-chats-desktop.png ("0 captured", "No chats recorded") |
| C3 | **Engine jargon first.** Overview stacks 8 blocks (model phases, chats, 5 counters, engine graph, runtime, compaction policy, active requests, goals, operations). "Model calls 0 / Engine-issued calls", "Threshold override", "Forced early" mean nothing to a user. | current-overview-desktop.png |
| C4 | **Mobile clipping.** Engine flow graph is cut off at the right edge ("Context c..."), runtime and compaction tables are squeezed into two columns. | current-overview-mobile.png |
| C5 | **Copy bug.** The Live Chats page subtitle reads "Paired results, known usage, and evidence limits." (the Benchmarks subtitle). | `ui/main.jsx` App page-heading, `#chats` text dump |
| C6 | **Sidebar does not span full height** in full-page captures; the footer block floats at ~800px. | current-overview-desktop.png |
| C7 | **Dead-end offline state in a browser.** CSP `connect-src 'none'` and the service rejecting any `Origin` header mean the dev URL is always "offline"; the empty state does not point to `?demo=1` or say "open the desktop app". | current-offline-desktop.png |
| C8 | **"Not reported" noise.** `number()`/`time()` print "Not reported" in every empty cell; the eye cannot find real values. | `ui/main.jsx:24-26` |
| C9 | **Benchmarks hidden.** The richest usage data on disk (`new50-full`: $843.97 vanilla vs $7.95 helixy, 467 vs 349 calls, cache hit 99.0% vs 83.6%) is reachable only in the monitor build with a folder picker. | current-benchmarks-desktop.png, `metrics.final.md` |
| C10 | Good bones to keep: theme control, IBM Plex, sandboxed preload with allowlisted IPC, bounded inspector dialog, privacy footer, demo playback for tests. | `desktop/preload.cjs`, `ui/ThemeControl.jsx` |

---

## 2. Information architecture and navigation

Left rail (desktop >= 960px), bottom tab bar (mobile < 960px, 5 icons + "More"). Hash routes. Order is fixed:

| Route | Label | Icon (lucide) | Replaces |
|---|---|---|---|
| `#live` (default) | Live | `Activity` | Overview, Live Chats, Flow |
| `#usage` | Usage | `Coins` | (new) |
| `#runs` | Runs | `FlaskConical` | Benchmarks (now in release build, read-only) |
| `#memory` | Memory | `Database` | Memory (kept, restyled) |
| `#skills` | Skills & flows | `Sparkles` | (new) |
| `#settings` | Settings | `Settings` | Troubleshooting, Evidence table, engine graph, theme |

Persistent **top bar** on every screen (the "plan strip"):
`[HELIX mark] [status dot: Live / Offline / Demo]  5h ▮▮▮▮▯ 70% · resets 18:00   Week ▮▮▮▮▮▯ 84% · resets Thu 09:00   Today $12.40   [pause] [refresh]`
Clicking either meter opens `#usage` scrolled to Plan limits. Clicking "Today" opens `#usage?range=today`.
Old hashes redirect: `#overview`,`#chats`,`#flow` -> `#live`; `#benchmarks` -> `#runs`; `#evidence`,`#troubleshooting` -> `#settings`.

### 2.1 Live (`#live`)
"Who is working right now, on what, with which model, and what is it costing."
- **Session cards** (grid, 1-3 columns): one per Claude Code session active in the last 30 min, plus Codex threads from the existing chat index. Active (file written < 90 s ago) first, then most recent.
- Each card: model chip, title, state line ("Running Bash: Run UI tests" / "Thinking" / "Waiting for you" / "Idle 12 min"), last 5 actions, context meter, cost ticker, nested **subagent rows** (each with own model chip, description, state, tokens, cost).
- **HELIX engine lane** below the cards: recent hx flow runs and HELIX shell activity (RTK rewrites, dedupes) as a compact timeline.
- Click a card -> **Session drawer** (right side, full-screen sheet on mobile): timeline of the last 50 actions, per-model token split, per-request table, subagent list.

### 2.2 Usage (`#usage`)
Range tabs: `5h` · `Today` · `7d` · `30d`. Group tabs: `By model` · `By session` · `By project`.
- **Plan limits card**: 5-hour and weekly meters with reset times and observation age.
- **Totals row**: cost, total tokens, requests, cache-hit share.
- **Stacked bar over time** (hourly for 5h/Today, daily for 7d/30d) colored by model family.
- **Breakdown table** for the chosen grouping, sortable, with main vs subagent split.

### 2.3 Runs (`#runs`)
- **Lane comparison** header: one column per lane (vanilla-continuous, helixy): resolved, calls, cost, ctx p50/p90/max, cache hit, savings vs baseline.
- **Driver status** strip: phase, current task/lane, last utilization, updated time.
- **new50 results table**: 50 rows x lanes, resolved tick, requests, processed tokens, output, cost, per-task delta.
- **Per-model table** per lane (from metrics.final.json models).

### 2.4 Memory (`#memory`)
Search box (project select + query) on top, results list, **Recent notes** list below (browse, newest first), note reader in the drawer. Claude-Mem connect moves to Settings > Sources.

### 2.5 Skills & flows (`#skills`)
One searchable list with filter chips `All · Skills · Plugin skills · hx flows`. Each row: name, one-line description, source badge, **Copy** button (copies `/skill-name` or `hx <flow> <args>`). Drawer shows full description and, for flows, the step list (`as`, kind, quiet/digest flags).

### 2.6 Settings (`#settings`)
Sections: Appearance (theme) · Privacy · Sources · Pricing (read-only table + "as of" date) · Diagnostics (existing checks + restart core) · Engine internals (existing engine graph, counters, operations/evidence table, goals, compaction policy) · About.

---

## 3. Visual system

New file `ui/tokens.css`, imported first by `ui/main.jsx`. Existing `styles.css` variables are re-pointed to these tokens (keep old names as aliases so nothing breaks in WP1).

```css
:root {
  /* type */
  --font-body: 'IBM Plex Sans', system-ui, sans-serif;
  --font-data: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --fs-xs: 12px; --fs-sm: 13px; --fs-md: 14px; --fs-lg: 16px; --fs-xl: 20px; --fs-2xl: 28px;
  --lh-tight: 1.2; --lh-body: 1.5;
  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600;
  /* spacing (4px grid) */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px; --sp-7: 48px;
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-pill: 999px;
  --rail-w: 224px; --topbar-h: 56px; --drawer-w: 480px;
  /* neutrals (light) */
  --bg: #ffffff; --bg-subtle: #f6f8f7; --surface: #ffffff; --surface-2: #f0f4f2;
  --border: #dde4e1; --border-strong: #c2ccc8;
  --text: #121a18; --text-2: #4d5d57; --text-3: #7d8c86;
  /* brand + status */
  --brand: #1c8370; --brand-strong: #146957; --focus: #1c8370;
  --ok: #1f7a4d; --ok-bg: #e6f4ee; --warn: #9a6200; --warn-bg: #fff4dd;
  --danger: #b33a3a; --danger-bg: #fdeceb; --info: #3b6fd1; --info-bg: #e9f0fd;
  --demo: #62488e; --demo-bg: #f2eef9;
  /* model identity: color + monogram, never color alone */
  --m-opus: #c4552d;   --m-opus-bg: #fbeae3;    /* O  */
  --m-sonnet: #3b6fd1; --m-sonnet-bg: #e9f0fd;  /* S  */
  --m-haiku: #a87800;  --m-haiku-bg: #fbf2d9;   /* H  */
  --m-codex: #4e5864;  --m-codex-bg: #eceff2;   /* Cx */
  --m-other: #7d8c86;  --m-other-bg: #f0f4f2;   /* ?  dashed border */
  /* meters */
  --meter-track: #e6ece9; --meter-ok: var(--brand); --meter-warn: #d08a00; --meter-hot: #c43d3d;
  --shadow-1: 0 1px 2px #121a1814; --shadow-2: 0 8px 24px #121a1824;
  --dur-fast: 120ms; --dur-med: 200ms;
}
:root[data-theme='dark'] {
  --bg: #121615; --bg-subtle: #171c1b; --surface: #1b211f; --surface-2: #222a27;
  --border: #2c3532; --border-strong: #3d4945;
  --text: #e9efec; --text-2: #a9b6b1; --text-3: #75837e;
  --brand: #4cc2a6; --brand-strong: #6fd3bb; --focus: #6fd3bb;
  --ok: #5cc98f; --ok-bg: #173226; --warn: #f0b54a; --warn-bg: #352a12;
  --danger: #f07a7a; --danger-bg: #3a1c1c; --info: #8aaef5; --info-bg: #1b2a45;
  --demo: #b9a3e3; --demo-bg: #2a2340;
  --m-opus: #ee8e68;   --m-opus-bg: #3b2219;
  --m-sonnet: #8aaef5; --m-sonnet-bg: #1b2a45;
  --m-haiku: #e6bd4f;  --m-haiku-bg: #352a12;
  --m-codex: #aab4bf;  --m-codex-bg: #262c32;
  --m-other: #75837e;  --m-other-bg: #222a27;
  --meter-track: #2c3532;
}
@media (prefers-reduced-motion: reduce) { :root { --dur-fast: 0ms; --dur-med: 0ms; } }
```

Rules
- Numbers: `font-variant-numeric: tabular-nums`, data font for token counts and money. Format: tokens `1.2k`, `48.6k`, `2.53M` (full value in `title`); money `$0.004` (< $0.01: 3 decimals), `$12.40`, `$843.97`; percent integers except < 1% (`0.4%`).
- Model family from model id: `/opus/` Opus, `/sonnet/` Sonnet, `/haiku/` Haiku, `/^(gpt|o\d|codex)/i` Codex, else Other. `ModelChip` = monogram circle + display name ("Opus 5.5", from id `claude-opus-5-5` -> family + version digits joined with "."), tinted bg.
- Meters: < 70% `--meter-ok`, 70-89% `--meter-warn`, >= 90% `--meter-hot`; always paired with the numeric label.
- Cost ticker: animates digits only when value changes (opacity flash `--dur-fast`), disabled under reduced motion.
- Focus ring: 2px `--focus` outline, offset 2px, on every interactive element. Hit targets >= 32px desktop, 44px mobile.

States (one component each, `ui/components/States.jsx`)
- **Loading**: skeleton blocks with the final layout's shape (cards, rows), `aria-busy="true"`, no spinners longer than 300 ms before skeleton.
- **Empty**: icon + one sentence + one action. Live: "No Claude or Codex session active in the last 30 minutes." action "Show last 7 days in Usage". Usage: "No usage recorded in this range." Runs: "No benchmark folder configured." action "Open Settings > Sources". Skills: "No skills found in ~/.claude/skills or plugins." (tilde form only).
- **Error**: `--danger-bg` banner, sentence + "Retry"; keep last good data visible below with "Last updated HH:MM:SS" (stale data is shown dimmed, never blanked).
- **Offline**: full-panel: "HELIX engine not connected. Open the HELIX desktop app, or view the demo." with link `?demo=1` (fixes C7).
- **Demo**: purple top-bar badge "DEMO / PLAYBACK" and the existing synthetic notice; all screens have fixtures.
- **Unknown values**: em dash `—` with tooltip reason ("Not reported by source"), replacing "Not reported" text (fixes C8).

---

## 4. Component specs per screen

Shared hook `usePoll(fn, {interval, hiddenInterval, enabled})` in `ui/hooks.js`: in-flight guard, pause when `document.visibilityState==='hidden'` (uses hiddenInterval or stops), global pause button respected, returns `{data, error, state, receivedAt, refresh}`.

### 4.1 Top bar `PlanStrip` (all screens)
- Data: `GET /limits` (`helix.limits.v1`) + `today.cost_usd` from `GET /usage?range=today&group=model`.
- Refresh: 60 s (hidden: stop).
- Shows: two `Meter`s (5h, Week) with `resets_at` as local time ("18:00", or "Thu 09:00" if > 24 h), stale marker "as of 14:02" when `observed_at` > 10 min old, "—" if never observed. Today cost.
- Interactions: click meter -> `#usage` limits card; pause toggles all polling; refresh triggers all hooks.

### 4.2 Live
`LiveScreen`
- Data: `GET /live` (`helix.live.v1`). Refresh 2 s visible, stopped when hidden. Codex threads come inside the same payload (service merges the existing chat index).
- `SessionCard` (per `sessions[]`):
  - Header: `ModelChip(model)`, `title`, `project` (basename only), status pill (`working` green pulse dot, `waiting` amber "Waiting for you", `idle` grey "Idle 12 min").
  - State line: `current.label` (e.g. "Running Bash · Run UI tests", "Thinking", "Writing reply", "Spawning agent · lean"). Elapsed `current.since` as "12 s".
  - Actions list: last 5 `actions[]`: icon by `kind` (tool/agent/skill/mcp/reply/user), `label`, relative time, status icon (ok/error/running).
  - `ContextMeter`: `context.tokens / context.window` with percent; warn at 70%, hot at 90%; tooltip "Last request prompt size: input + cache read + cache write".
  - `CostTicker`: `cost.session_usd` big, `cost.last_request_usd` small "+$0.031 last request", tokens in/out/cached on hover.
  - Subagents: up to 4 `SubagentRow` (chip, `agent_type`, `description`, state, tokens, cost); "+N more" opens drawer.
- `SessionDrawer`: `GET /live/session?id=<sessionKey>` on open, 2 s while open. Tabs: Timeline (50 actions), Requests (per request: time, model, input, cache write, cache read, output, cost, sidechain flag), Models (per-model totals), Subagents.
- `EngineLane`: `engine.flows[]` (hx runs: id, step count, failed count, ok/failed pill, age) and `engine.shell[]` (HELIX activity: kind, verb only e.g. "rtk find", duration, `dup`/`rewritten` badges, lines/chars saved). Collapsible, collapsed by default on mobile.
- Interactions: card click/Enter opens drawer; `Esc` closes; filter chips `All · Working · Claude · Codex`; "Follow active" toggle (existing `selectChat` for Codex) moves to the Codex card menu.

### 4.3 Usage
- Data: `GET /usage?range=<5h|today|7d|30d>&group=<model|session|project>`. Refresh 30 s; range/group change fetches immediately. `GET /limits` shared with top bar.
- `PlanLimitsCard`: two large meters, `resets_at` absolute + relative ("in 2 h 14 min"), `source` caption ("from status line, 3 min ago" / "from benchmark stream"), stale/unknown rules from 4.1.
- `TotalsRow`: cost (with basis caption "API list-price equivalent; subscription plans are not billed per token"), tokens total, requests, cache-hit share (`cache_read / (input + cache_write + cache_read)`).
- `UsageChart`: stacked bars `series[]` by family color, legend with chip monograms, SVG, no chart library; keyboard focusable bars with `aria-label` "14:00, Opus $1.20, Haiku $0.01".
- `BreakdownTable` (`rows[]`): columns Name (chip for model / title for session / basename for project), Requests, Input, Cache write, Cache read, Output, Cache hit, Cost, Share bar. Sort by cost desc default; click header sorts. Session rows expand to main vs each subagent. Rows with `cost_usd: null` show "unpriced" tag and are excluded from cost totals but counted in tokens; footer line "N requests unpriced (unknown model)".
- Export: "Copy as CSV" (to clipboard, privacy-filtered values only).

### 4.4 Runs
- Data: `GET /runs` (`helix.runs.v1`). Refresh 10 s while `driver.phase` not in (`finished`,`idle`), else 5 min; manual refresh.
- `LaneCompare`: columns per `lanes[]`: resolved/attempted, graded, requests, cost, ctx p50/p90/max, cache hit, `vs_baseline` savings (processed %, cost %). Baseline lane labelled "baseline".
- `DriverStrip`: phase pill, task, lane, `last_utilization` (5h/7d), `updated_at`, `paused_until`.
- `ResultsTable`: 50 rows from `tasks[]`, columns Task, Instance (repo short form `django-15061`), then per lane: resolved tick/cross/—, requests, processed tokens, cost; delta column (cost helixy - baseline). Filters: `All · Both solved · Only baseline · Only helixy · Neither`. Sort any column.
- `ModelSplit`: per lane per model tokens and cost (from metrics `models`).
- Release vs monitor: release build reads the configured root only (Settings > Sources). Monitor build additionally keeps "Choose evidence" picker. Never shows patches, streams, prompts or the absolute root (root shown as `~/.claude-lean/bench/new50-full` tilde form).

### 4.5 Memory
- Data (existing): `memoryProjects()` -> `/memory/projects`; `memorySearch()` -> memory search RPC; `memoryBrowse()` -> `POST /memory/browse`; `memoryRead()` -> `POST /memory/read`.
- `MemorySearch`: project select (default: most recent project), query, Enter searches, results with title, project, date, source badge (`helix` / `claude-mem`).
- `RecentNotes`: `memoryBrowse({project, limit: 20})` on mount and project change; "Load more" uses cursor.
- `NoteReader` drawer: literal text, "Stored only; no request implied" notice kept.
- Refresh: on demand only.

### 4.6 Skills & flows
- Data: `GET /catalog` (`helix.catalog.v1`). Refresh on screen open + manual; service caches 60 s.
- `CatalogSearch`: client-side fuzzy filter on name + description; chips filter `source`.
- `CatalogRow`: name, description (1 line, ellipsis), source badge (`user skill`, `plugin: <plugin>`, `hx flow`), **Copy** primary button: `invoke` string (`/brainstorming`, `/plugin:skill`, `hx contract FILE:SYMBOL`). Toast "Copied /brainstorming. Paste it into Claude Code."
- Drawer: full description, for flows the `steps[]` (`as`, `kind`, `quiet`, `has_digest`) and declared arguments.
- HELIX never runs a skill or flow itself (AGENTS.md: no background model workers; mutations stay with the session). Copy is the one-click action.

### 4.7 Settings
- Appearance: existing `ThemeControl` (system/light/dark), density (comfortable/compact).
- Privacy (persisted in `<STATE_DIR>/ui-settings.json` via `POST /settings`): `show_project_names` (default on, basename only), `show_action_details` (default on: tool descriptions, file basenames), `show_prompts` (default **off**, never sent unless on), `show_full_paths` (default **off**; even when on, home dir is rendered `~`).
- Sources: toggles for Claude transcripts, Codex threads, HELIX logs, plan-limit log, benchmark root (text input, tilde form shown), Claude-Mem connect (existing).
- Pricing: read-only table from `GET /settings` `pricing` (model, input, cache write 5m/1h, cache read, output, as-of date, source URL).
- Diagnostics: existing `diagnostics()` checks + restart core (existing confirm flow).
- Engine internals: existing EngineGraph, counters, Operations table with search/filter/sort, Goals, Compaction (moved verbatim from Overview/Evidence/Flow so current tests keep a home).

---

## 5. Backend contract

All endpoints: loopback, existing bearer capability, `Origin` rejected (unchanged), `GET` read-only, JSON, `cache-control: no-store`. Every string leaving the service passes `redact()` (see 5.3). Renderer access only through new preload methods + `trusted()` IPC handlers in `desktop/main.cjs`.

| Endpoint | Status | Preload method |
|---|---|---|
| `GET /health`, `/snapshot`, `/diagnostics`, `/chat/active`, `/model/events`, `/benchmark`; `POST /model/native`, `/memory/browse`, `/memory/read`, `/memory/connect`, `/core/restart`, `/rpc` | **existing** | existing |
| `GET /live` | **to build** | `live()` |
| `GET /live/session?id=` | **to build** | `liveSession(id)` |
| `GET /usage?range=&group=` | **to build** | `usage({range, group})` |
| `GET /limits` | **to build** | `limits()` |
| `GET /runs` | **to build** | `runs()` |
| `GET /catalog` | **to build** | `catalog()` |
| `GET /settings`, `POST /settings` | **to build** (POST writes only `ui-settings.json`, allowlisted keys) | `settings()`, `saveSettings(patch)` |
| (main process) clipboard | **to build** | `copy(text)` (string <= 4096 chars, main uses `clipboard.writeText`) |

### 5.1 Sources (read-only; never read credentials, keychain, `~/.claude/.credentials*`, or `~/.claude.json`)
| Source | Path | Used by |
|---|---|---|
| Claude transcripts | `~/.claude/projects/<proj>/<session>.jsonl` | live, usage |
| Claude subagents | `~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl` + `.meta.json` (`agentType`, `description`, `finished`) | live, usage |
| Codex threads | existing `CodexChatIndex` (`thread.input/output/cachedInput/total`) | live, usage |
| HELIX activity | `~/.claude-lean/logs/activity-<pid>.jsonl` (`ev` start/end, `kind`, `cmd`, `chars`, `lines`, `dup`, `rewritten`, `t`) | live.engine.shell |
| hx chains | `~/.claude-lean/offload/hx-*.json` (`id`, `failed`, `steps[]`, `results[].code`) | live.engine.flows |
| lean-run results | `~/.claude-lean/logs/lean-run-*.json` (`modelUsage[*].costUSD`, `total_cost_usd`, `session_id`) | usage (reported cost) |
| Plan limits | `~/.claude/usage-log.jsonl` (statusline tap: `{t, rate_limits:{five_hour|seven_day:{used_percentage, resets_at}}}`); `rate_limit_event` lines in `*.stream.jsonl` (`rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization 0-1, resetsAt}`); `driver-status.json.last_utilization` | limits |
| Benchmarks | `<bench root>/results.final.json`, `metrics.final.json` (fallback `metrics.json`, `results.partial.json`), `driver-status.json`, tail of `driver-events.jsonl` | runs |
| Skills | `~/.claude/skills/*/SKILL.md`, `~/.claude/plugins/cache/**/skills/*/SKILL.md` (front-matter `name`, `description`) | catalog |
| Flows | `~/.claude-lean/hx.d/*.hx` (leading `#` comment = description, step lines `as: kind ...`) | catalog |

Indexing: new `src/claude-usage-index.mjs` keeps per-file `{size, mtimeMs, offset, partialLine}` and appends only new bytes; files considered only if `mtime >= now - 31 d` (usage) or `- 30 min` (live). Bounds: 4,000 files, 64 MB read per refresh, 256 KB per line (longer lines skipped and counted in `stats.skipped_lines`). No SQLite in WP1; in-memory, rebuilt on service start.

### 5.2 Aggregation rules (normative)
1. **Request identity**: key = `message.id`; fallback `requestId`; fallback entry `uuid`. Claude Code writes one assistant line per content block with the same `message.id` (observed: 1,138 lines, 564 unique ids in one session). Count each key once globally; keep the usage object with the largest `output_tokens`.
2. **Exclusions**: `message.model === '<synthetic>'`, entries without `message.usage`, `api-request*` lines (no usage). Compaction boundaries are counted as events, not priced (`stats.compactions`).
3. **Attribution**: lines from `.../subagents/agent-<id>.jsonl` belong to subagent `<id>` of parent `<session>` (meta gives `agent_type`, `description`). Lines with `isSidechain: true` inside a main session file go to a synthetic subagent `sidechain` of that session. If a key appears in both a main and a subagent file, the subagent wins. Session totals = main + subagents, always reported split (`main`, `subagents`).
4. **Token classes**: `input = input_tokens`, `cache_write_5m = cache_creation.ephemeral_5m_input_tokens`, `cache_write_1h = cache_creation.ephemeral_1h_input_tokens` (if `cache_creation` absent: all `cache_creation_input_tokens` as 5m), `cache_read = cache_read_input_tokens`, `output = output_tokens` (includes thinking; `thinking` reported separately from `output_tokens_details.thinking_tokens`).
5. **Cost**: if a reported cost exists for the same run (`modelUsage[model].costUSD` in lean-run logs, stream-json `result` lines, bench ledgers), use it and set `cost_basis: "reported"`. Otherwise `cost_basis: "list"`: price per token class from `src/pricing.mjs`; multiply x2 when `usage.speed === 'fast'`, x1.1 when `inference_geo === 'us'`; Haiku 5.5 uses the >100K tier when `input + cache_write + cache_read > 100,000` for that request. Unknown model: `cost_usd: null`, tokens still counted, `unpriced_requests++`. Never mix: a row's `cost_basis` is `reported`, `list` or `mixed`.
6. **Pricing table** (`src/pricing.mjs`, USD per MTok, `as_of: "2026-10"`; implementer must re-verify against Anthropic's pricing page and keep a test that prices the lean-run fixture within 1% of its reported `costUSD`):
   | model | input | write 5m | write 1h | read | output |
   |---|---|---|---|---|---|
   | claude-opus-5-5 | 4.00 | 5.00 | 8.00 | 0.40 | 20.00 |
   | claude-sonnet-5-5 | 2.00 | 2.50 | 4.00 | 0.10 | 10.00 |
   | claude-haiku-5-5 (<=100K) | 0.10 | 0.125 | 0.20 | 0.01 | 0.50 |
   | claude-haiku-5-5 (>100K) | 0.50 | 0.625 | 1.00 | 0.05 | 2.50 |
   Haiku rows were verified locally: lean-run `2 in / 876 1h-write / 1891 read / 4 out` = $0.000196 reported. Codex models: unpriced unless added.
7. **Cache-hit share** = `cache_read / (input + cache_write_5m + cache_write_1h + cache_read)`; null when denominator is 0.
8. **Context size** of a session/subagent = prompt size of its latest request (`input + cache_write + cache_read`); `window` from pricing table `context_window` (1,000,000 for 5.5 models; else 200,000).
9. **Live state** (per session/subagent, from the last non-meta entries): last assistant has a `tool_use` without a later matching `tool_result` -> `working` / "Running <Tool> · <label>"; last entry is a user prompt or tool_result -> `working` / "Thinking"; last assistant `stop_reason === 'end_turn'` -> `waiting` if file mtime < 30 min else `idle`. `active = now - mtime < 90 s`. Subagent `finished: true` in meta -> `done`.
10. **Action labels** (privacy-safe): Bash -> `input.description` (never `command`); Read/Edit/Write/NotebookEdit -> file basename; Grep/Glob -> "Search"; Agent/Task -> `subagent_type` + `description`; Skill -> skill name; WebSearch -> "Web search"; WebFetch -> hostname; `mcp__<server>__<tool>` -> "<server> · <tool>"; anything else -> tool name. Max 80 chars.
11. **Title**: latest `custom-title.customTitle`, else `agent-name.agentName`, else `<project basename> · <first 8 of session id>`.
12. **Limits**: per window take the newest observation across sources; `utilization` normalized to 0-1 (`used_percentage / 100`). `state`: `fresh` (< 10 min), `stale` (older), `expired` (now > resets_at: utilization reported as null, label "reset since last observation"), `unknown` (none).
13. **Ranges**: `5h` = rolling 5 h, `today` = local midnight, `7d`, `30d` rolling. Time buckets: 1 h for 5h/today, 1 d otherwise.

### 5.3 Privacy (`src/redact.mjs`, applied to every new endpoint)
- Replace `os.homedir()` prefix with `~`; then replace any remaining macOS, Linux and Windows user-home prefixes with `~/`. With `show_full_paths` off, paths reduce to basename.
- Drop emails (`/[^\s@]+@[^\s@]+\.[^\s@]+/` -> `[email]`), `org`/`account` uuids, `ownerAccountUuid`, `bridgeSessionId`, hostnames other than WebFetch host.
- Never emit prompt text, assistant text, tool inputs other than rule 10 labels, tool results, `cwd`, `root`, or `cmd` strings (engine shell shows only `kind` + first token, e.g. `rtk find`).
- Session ids are emitted as opaque `key = sha256(path).slice(0,16)`; the drawer requests by key.

### 5.4 JSON shapes

`GET /live` -> 
```json
{"schema":"helix.live.v1","generated_at":"2026-10-24T16:05:00Z","totals":{"active_sessions":2,"cost_today_usd":12.4},
 "sessions":[{"key":"9f2c41d0a1b2c3d4","source":"claude","title":"HELIX app design","project":"HELIX-1.0",
   "model":"claude-opus-5-5","family":"opus","status":"working","active":true,"updated_at":"...",
   "current":{"kind":"tool","label":"Running Bash · Screenshot dev UI","since":"..."},
   "actions":[{"at":"...","kind":"tool","label":"Read · main.jsx","status":"ok"}],
   "context":{"tokens":72018,"window":1000000},
   "tokens":{"input":2,"cache_write_5m":72018,"cache_write_1h":0,"cache_read":0,"output":1004,"thinking":424},
   "cost":{"session_usd":0.41,"last_request_usd":0.031,"basis":"list"},
   "subagents":[{"id":"a033c34f","agent_type":"lean","description":"Trace compaction knobs","model":"claude-haiku-5-5","family":"haiku","status":"done","tokens":{},"cost_usd":0.002}]},
  {"key":"...","source":"codex","title":"...","model":"gpt-5.5-codex","family":"codex","status":"idle","tokens":{"input":1,"cached":1,"output":1},"cost":{"session_usd":null,"basis":"unpriced"}}],
 "engine":{"flows":[{"id":"mluy02td","steps":1,"failed":0,"status":"failed","at":"..."}],
           "shell":[{"at":"...","kind":"sh","verb":"rtk find","ms":3580,"dup":false,"rewritten":true,"lines":40}]},
 "stats":{"files_scanned":12,"skipped_lines":0,"read_ms":18}}
```
`GET /live/session?id=<key>` -> `{"schema":"helix.live-session.v1","session":{...same as card...},"timeline":[50 actions],"requests":[{"at","model","family","sidechain":false,"agent":null,"input","cache_write_5m","cache_write_1h","cache_read","output","cost_usd","basis"}],"by_model":[{"model","family","requests","tokens":{},"cost_usd"}]}`

`GET /usage?range=today&group=model` ->
```json
{"schema":"helix.usage.v1","range":"today","group":"model","from":"...","to":"...",
 "totals":{"requests":564,"input":1200,"cache_write_5m":0,"cache_write_1h":0,"cache_read":0,"output":0,"thinking":0,"cache_hit":0.83,"cost_usd":12.4,"basis":"list","unpriced_requests":0},
 "series":[{"bucket":"2026-10-24T14:00:00Z","by_family":{"opus":3.1,"haiku":0.01}}],
 "rows":[{"id":"claude-opus-5-5","label":"Opus 5.5","family":"opus","requests":400,"tokens":{},"cache_hit":0.9,"cost_usd":11.9,"basis":"list","main":{"requests":380,"cost_usd":11.0},"subagents":{"requests":20,"cost_usd":0.9}}]}
```
(`group=session`: `id` = session key, `label` = title, `children[]` per subagent; `group=project`: `id`/`label` = basename.)

`GET /limits` -> `{"schema":"helix.limits.v1","windows":{"five_hour":{"utilization":0.7,"resets_at":"2026-10-24T18:00:00Z","observed_at":"...","state":"fresh","source":"statusline|stream|benchmark"},"seven_day":{...}}}`

`GET /runs` -> `{"schema":"helix.runs.v1","root":"~/.claude-lean/bench/new50-full","driver":{"phase":"finished","task":null,"lane":null,"updated_at":"...","last_utilization":{"five_hour":0.7,"seven_day":0.84}},"baseline":"vanilla-continuous","lanes":[{"lane","model","effort","attempted","resolved","graded","requests","cost_usd","processed","output","ctx":{"p50","p90","max"},"cache_hit","savings":{"processed_pct","cost_pct"},"models":[{"model","input","output","cache_read","cache_write","cost_usd"}]}],"tasks":[{"task":"01","instance":"django__django-15061","lanes":{"helixy":{"resolved":true,"requests":5,"processed":32987,"output":2096,"cost_usd":0.078,"status":"done"}}}]}` (lane `requests` from metrics `calls`; values the source lacks are `null`.)

`GET /catalog` -> `{"schema":"helix.catalog.v1","items":[{"kind":"skill","source":"user|plugin","plugin":null,"name":"brainstorming","description":"...","invoke":"/brainstorming"},{"kind":"flow","name":"contract","description":"source, callers, helpers and tests ...","invoke":"hx contract FILE:SYMBOL","args":["$1"],"steps":[{"as":"c","kind":"sh","quiet":true,"has_digest":true}]}]}`

`GET /settings` -> `{"schema":"helix.settings.v1","privacy":{"show_project_names":true,"show_action_details":true,"show_prompts":false,"show_full_paths":false},"sources":{"claude":true,"codex":true,"helix_logs":true,"plan_limits":true,"bench_root":"~/.claude-lean/bench/new50-full"},"pricing":{"as_of":"2026-10","rows":[...]}}`. `POST /settings` accepts only those keys (booleans; `bench_root` must resolve inside the home dir and exist), writes `ui-settings.json` with `privateJSON`.

---

## 6. Acceptance criteria and tests

### 6.1 Node tests (`npm test`)
New `test/claude-usage.test.mjs` with public synthetic fixtures under `test/fixtures/claude-home/` (fake `projects/`, `subagents/`, `usage-log.jsonl`, `lean-run-*.json`, `hx.d/`, `skills/`; fixture paths use home-style fixture-user path strings to exercise redaction). Index takes a `home` option so tests never touch the real home.
1. Dedupe: 3 lines with one `message.id` -> 1 request; max `output_tokens` kept.
2. `<synthetic>` and usage-less lines excluded.
3. Subagent file attribution; `isSidechain` main-file lines -> `sidechain` subagent; key in both -> counted once under subagent; session total = main + subagents.
4. Pricing: Opus/Sonnet/Haiku list costs exact to 1e-9; Haiku >100K tier; fast x2; `us` x1.1; unknown model -> `cost_usd: null`, `unpriced_requests: 1`.
5. Reported basis: lean-run fixture `costUSD` wins over list price; list price of the same tokens within 1% of reported (Haiku case 0.000196).
6. Cache-hit share and context size per rule 7/8.
7. Live state machine: pending tool_use -> working "Running Bash · <description>"; end_turn + mtime 5 min -> waiting; 40 min -> idle; subagent `finished` -> done.
8. Labels: Bash label never contains the fixture `command` string; Read shows basename only.
9. Limits: newest observation wins across statusline + stream fixture; `used_percentage 70` -> 0.7; past `resets_at` -> `expired`, utilization null.
10. Privacy: `JSON.stringify` of every endpoint response contains no user-home paths, `@`-email, `ownerAccountUuid`, prompt fixture sentinel `SECRET-PROMPT-SENTINEL`.
11. Service routes: `/live`, `/usage`, `/limits`, `/runs`, `/catalog`, `/settings` return 403 without capability and 403 with an `Origin` header; `POST /settings` rejects unknown keys and a `bench_root` outside home.
12. Bounds: a 300 KB line is skipped and counted; incremental read only parses appended bytes (second call reads 0 bytes when unchanged).

### 6.2 UI tests (`npm run test:ui`, extend `scripts/test-ui.mjs`)
Add `ui/fixtures/live.mjs`, `usage.mjs`, `limits.mjs`, `runs.mjs`, `catalog.mjs` (synthetic, labelled), used by `?demo=1` and by `addInitScript` stubs of the new preload methods.
1. Default route `#live` shows heading "Live"; demo shows >= 2 session cards, one Opus card with "Running Bash" state, one Haiku subagent row, a context meter with `role="meter"` and `aria-valuenow`, and a cost ticker matching `/^\$\d/`.
2. Top bar shows "5h" and "Week" meters with reset times; click 5h meter -> `#usage` and "Plan limits" visible.
3. Usage: switching range tabs refetches (stub records calls); group `By session` shows expandable row with main/subagent split; an unpriced row shows "unpriced" tag; totals cost excludes it.
4. Runs: lane comparison shows `43/50` and `45/50`-style resolved cells from fixture; results table filter "Only baseline" reduces rows; sorting by cost works.
5. Memory: existing assertions kept (search disabled until query, note reader dialog); "Recent notes" lists browse results.
6. Skills & flows: typing "contract" leaves 1 row; Copy calls `window.helix.copy` with `hx contract FILE:SYMBOL`; toast visible.
7. Settings: theme radios (existing assertions), privacy toggle `show_prompts` default unchecked; Engine internals contains existing "Operation evidence" table with its search/filter/sort assertions (moved).
8. Redirects: `#overview`, `#chats` -> `#live`; `#benchmarks` -> `#runs`; `#evidence`, `#troubleshooting` -> `#settings`.
9. States: loading (never-resolving stub) shows skeleton with `aria-busy`; malformed payload shows error banner with Retry and keeps prior data; offline (no `window.helix`) shows link "view the demo" pointing to `?demo=1`.
10. Privacy: on every screen, `document.body.innerText` has no user-home paths, email pattern; fixture sentinel prompt text absent.
11. Layout: no horizontal overflow at 1440x1080 and 390x844 on all six screens (fixes C4); sidebar/rail height equals document height (C6); page subtitle per route matches its own copy (C5).
12. Accessibility: every icon button has `aria-label`; tab order reaches cards; drawer traps focus and closes on Escape; model chips include monogram text (not color only).
13. Screenshots written by test:ui to `docs/assets/` (existing names kept, plus `live-dark-desktop.png`, `live-mobile.png`, `usage-desktop.png`, `runs-desktop.png`).

Release checks unchanged: `npm test`, `npm run check`, `npm run build`, `npm run privacy` (no user-home paths in the bundle), `npm run test:ui`, visual inspection.

---

## 7. Implementation plan (3 Sonnet work packages)

**WP1 Backend data plane** (no UI changes; independently testable)
- New: `src/claude-usage-index.mjs` (incremental reader, rules 1-4, 7-11), `src/pricing.mjs` (table + `priceRequest`), `src/plan-limits.mjs`, `src/runs-view.mjs` (reads results/metrics/driver files), `src/catalog.mjs` (skills + hx.d parser), `src/engine-activity.mjs` (activity + hx offload), `src/redact.mjs`, `src/ui-settings.mjs`.
- Edit: `src/service.mjs` (routes `/live`, `/live/session`, `/usage`, `/limits`, `/runs`, `/catalog`, `/settings`), `desktop/main.cjs` (IPC handlers with `trusted()` and argument validation, `clipboard`), `desktop/preload.cjs` (new methods; `runs` available in release build).
- Tests: `test/claude-usage.test.mjs`, `test/fixtures/claude-home/**`.
- Done when: 6.1 passes, `npm test` and `npm run privacy` green.

**WP2 Shell, visual system, Live and Usage**
- New: `ui/tokens.css`, `ui/hooks.js` (`usePoll`), `ui/format.js`, `ui/components/{ModelChip,Meter,CostTicker,States,Drawer,PlanStrip,Rail}.jsx`, `ui/screens/{Live,Usage}.jsx`, `ui/fixtures/{live,usage,limits}.mjs`.
- Edit: `ui/main.jsx` (router, rail, redirects; Overview/Flow/LiveChats content moved into Settings > Engine internals components unchanged), `ui/styles.css` (alias old vars to tokens, rail full height, mobile tab bar), `ui/playback.mjs` (demo hooks), `scripts/test-ui.mjs` (6.2 items 1-3, 8-13), `ui/LiveChats.jsx` reused inside Codex card menu.
- Done when: 6.2 items 1-3 and 8-13 pass; screenshots inspected light/dark, desktop/mobile.

**WP3 Runs, Memory, Skills & flows, Settings, docs**
- New: `ui/screens/{Runs,Memory,Skills,Settings}.jsx`, `ui/fixtures/{runs,catalog}.mjs`.
- Edit: `ui/BenchmarkMonitor.jsx` (becomes monitor-only "Choose evidence" add-on inside Runs), `ui/main.jsx` (mount screens), `scripts/test-ui.mjs` (6.2 items 4-7), `README.md` (new screenshots + sections), `docs/ARCHITECTURE.md` (new read-only observers and privacy rules), `vite.config.mjs` only if needed for the monitor flag.
- Done when: full 6.2 passes, all release checks green, README screenshots regenerated from fixtures only.

Order: WP1 and WP2 in parallel (WP2 builds against fixtures that follow 5.4 exactly), then WP3.
