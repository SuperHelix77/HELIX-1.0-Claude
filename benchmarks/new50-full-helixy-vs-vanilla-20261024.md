# new50 full run: helixy vs vanilla-continuous (2026-10-24)

The 50 frozen new50 SWE-bench tasks were graded with the official SWE-bench grader (swebench 5.0.2, the harness's native grading). Both lanes ran Claude Opus 5.5 at high effort with stock Claude Code defaults, isolated settings (`--setting-sources project --strict-mcp-config`) and identical task prompts.
- **vanilla-continuous** is default Claude Code in one session resumed across all 50 tasks.
- **helixy** runs a fresh session per task, with a Bash-only scaffold, the lean95v working rules, a "plan your tools before you start" rule and the hx documentation.

Before its lanes ran, every task image was pinned by id, and the task's gold patch was checked with the same grader.

| lane | resolved | tokens (per request, deduplicated) | cost (Claude Code reported) | model calls | tool calls | wall time | failures | compactions | context p50 / p90 / max |
|---|---|---|---|---|---|---|---|---|---|
| vanilla-continuous | 45/50 | 129,381,259 | $38.23 | 467 | 422 | 122 min | 1 (60-min time limit, task 24) | 0 | 258k / 499k / 541k |
| helixy | 43/50 | 3,370,242 | $7.95 | 349 | 298 | 110 min | 0 | 0 | 8k / 15k / 21k |

- **Savings over the 50 matched tasks:** helixy used 97.4% fewer tokens and cost 79.2% less. Counting input only, it used 97.6% fewer input tokens and cost 93.7% less.
- **Resolution:** helixy resolved 43, which is 95.6% of vanilla's 45.
- **Overlap:** both lanes resolved 42 tasks. Vanilla alone resolved 3 (tasks 02, 31 and 38) and helixy alone resolved 1 (task 24, where vanilla hit the time limit). Neither resolved 4 (tasks 16, 27, 30 and 32).

## Accounting basis (and a correction)
- **Cumulative session totals:** a resumed `claude -p --resume` process reports `total_cost_usd` and `modelUsage` for the whole session so far.
  - Per-task cost in the continuous lane is therefore the delta from the previous task.
  - Tokens are counted from per-request usage, deduplicated by message id, plus the remainder of `modelUsage` that has no matching stream message (internal Haiku calls).
- **Correction:** an earlier draft of this note summed those cumulative totals and overstated vanilla at $843.97 and 2.53B tokens. Every earlier vanilla-continuous comparison in this lane family had the same inflation: the 6-task vanilla run was $2.93, not $10.41. The harness now computes deltas, and a regression test covers it.
- **Cost basis:** costs are Claude Code's reported API-equivalent figures. The run used a Pro subscription with extra usage disabled.

## Caveats
- **This comparison is a long-session scenario:** one unreset session across 50 unrelated tasks.
  - It grows context: vanilla's p90 context was 499k.
  - Prompt caching also makes it cheaper per task than fresh sessions. On the tasks they shared in an earlier 6-task run, vanilla in fresh sessions cost about 31% more than vanilla-continuous.
  - A vanilla-fresh 50-task baseline, and a continuous-workflow HELIX lane, have not been run yet.
- **Known helixy failure mode:** in both of its two analysed misses (tasks 02 and 31), the fix was correct for the case the issue named but was applied too narrowly (a helper's dict-order assumption; a SELECT-only fix that missed GROUP BY). A follow-up contract pass (the helixc lane) targets this, and it has not been measured yet.
- **Shared turns:** neither lane rewrites earlier turns. History is append-only, so prompt-cache prefixes stay valid.
