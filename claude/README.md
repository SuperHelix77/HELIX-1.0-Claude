# HELIX for Claude Code (claude/)

Lean tooling that lets a Claude Code session do a whole job in few tool calls and keep its context small.
Everything is keyed on two env vars: `HELIX_LEAN_HOME` (install dir, default `~/.claude-lean`) and
`HELIX_ENGINE` (this repo root, default resolved from the script location).

## Tools (`claude/bin`)
- `hx`: run a multi-step plan in one Bash call. Script on stdin, one step per line, optionally `name:` prefixed:
  `read FILE [A-B]`, `read FILE:SYMBOL`, `grep REGEX [-- PATHS]`, `edit FILE` (body `OLD`, `=====`, `NEW`; `%%%%%` between blocks),
  `write FILE`, `test CMD`, `sh CMD`, `fetch URL`, `browse URL`, `search QUERY`, `haiku|sonnet|opus TASK`, `memory|context|goal {json}`,
  `include FLOW 'arg'`, `wait BGID`, `skill NAME` (a skill's SKILL.md body without frontmatter, 12k chars shown, rest via `hx log`), `glob PATTERN` (git-aware, capped at 200) and `ls DIR`. `hx skill list [QUERY]` lists installed skills (project, `~/.claude/skills`, plugins; deduped) and `hx skill NAME` prints one. Indented `key: value` lines set options (`when:`/`unless:`, `allow_fail:`, `bg:`, `digest:`, `fresh:`, `quiet:`).
  `{{name.path}}` passes earlier results. Stops at the first failure. Also `hx resume|stats|wait|chain|save|log`. `hx -h` prints the full syntax.
  Saved flows live in `$HELIX_LEAN_HOME/hx.d/*.hx` (shipped: `contract`, `verify`, `design`: `include design 'GOAL' 'SPEC_PATH' 'CHECK_CMD'` has Opus write the spec, Sonnet implement it with the check and Opus escalation, and Opus review deviations); logs in `$HELIX_LEAN_HOME/offload`.
- `contract [-C REPO] FILE:SYMBOL ...`: contract pass. Prints a symbol's source, its callers, called helpers and tests (capped ~15k chars). Run before editing.
- `lean-run [-m MODEL] [-e EFFORT] [-d DIR] [-t TURNS] [-b USD] TASKFILE|-`: run one task in a full lean Claude session (via `helix`); prints the result and one stats line, full JSON goes to `logs/`.
- `q 'CMD'`: run tests/builds with elastic output (one-line pass receipt; trimmed failure; fuller log on repeat failure).
- `sym F NAME`, `outline F...`: numbered source of one symbol; symbol map of files.
- `pat`, `rep`, `bk`: exact-once patch/replace with optional backup; backup copies to `$BK` (default `$HELIX_LEAN_HOME/backups/current`).
- `sp`: print the session scratchpad dir. `hmem`: query the lossless memory archive and claims. `web`: headless Playwright browser (needs `playwright`; set `WEB_PW_ROOT`). `sim`: iOS simulator helper (simctl). `toolgate`: allow/block a tool in `.claude/settings.local.json`.
- `helix` (zsh): launcher for a lean session (`prompt.d/` system prompt parts). Some subcommands (`doctor`, `prompt`, `watch`, `lm-up`) need files that are not part of this pack.

## Hook adapter (`adapters/claude_code.py`, `lib/`)
Claude Code hooks (SessionStart, PreToolUse, PostToolUse, PreCompact, PostCompact, Stop, UserPromptSubmit) call it. It provides:
- capsule: on compaction/stop it consolidates the transcript into a lossless memory DB plus a short capsule re-injected on resume/compact.
- offload: large Bash/WebFetch/MCP results are written to `offload/` and replaced in context by a short handle (`hmem raw SEQ` restores bytes).
- context guard: warns on UserPromptSubmit when the context fills; also substitutes cheaper equivalents for known wasteful commands.
A hook never breaks the session (errors go to stderr). State is under `$HELIX_LEAN_HOME/{run,offload,memory.db}` (not shipped).

## Output style (`output-styles/lean95v.md`)
A terse working style: dense chained Bash calls, targeted reads, heredoc patches, `q` for test output, `hx` for plans, short reports.
The installer renders `$HELIX_LEAN_HOME` in it to the real path. Select it with `/output-style lean95v`.

## Install
```sh
claude/install.sh            # symlinks into $HELIX_LEAN_HOME and renders the style into ~/.claude/output-styles
claude/install.sh --copy     # copy instead (then export HELIX_ENGINE=<repo root>)
```
Idempotent; anything it would replace is moved to `$HELIX_LEAN_HOME/backups/install-<stamp>/`. It prints the hooks JSON; merge it into
`~/.claude/settings.json` yourself (it never writes that file). Requires node 20+, python3, zsh (for `helix`).
Optional: add `$HELIX_LEAN_HOME/bin` to PATH. Check: `node --test test/claude-pack.test.mjs`.

## Uninstall
`claude/install.sh --uninstall` removes the links it made (only links pointing into this checkout) and the rendered style, then remove the hooks block
from `settings.json`. Copies (`--copy`) and data in `$HELIX_LEAN_HOME` (run/, offload/, backups/, memory.db) are left; delete the directory by hand if wanted.
