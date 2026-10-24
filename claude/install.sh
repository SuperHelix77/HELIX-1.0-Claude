#!/bin/sh
# Install the Claude-side HELIX tooling. Idempotent. Never edits ~/.claude/settings.json.
#   claude/install.sh [--copy] [--uninstall]
# Env: HELIX_LEAN_HOME (default ~/.claude-lean), CLAUDE_HOME (default ~/.claude)
# Default is symlinks into this checkout (hx resolves the repo root through the link); --copy copies instead
# (then set HELIX_ENGINE to the repo root). Anything it would replace is moved to $HELIX_LEAN_HOME/backups/install-<stamp>/.
set -eu
SRC=$(cd "$(dirname "$0")" && pwd -P)
LEAN=${HELIX_LEAN_HOME:-$HOME/.claude-lean}
STYLES=${CLAUDE_HOME:-$HOME/.claude}/output-styles
MODE=link; UN=0
for a in "$@"; do case $a in --copy) MODE=copy;; --uninstall) UN=1;; -h|--help) sed -n 2,7p "$0"; exit 0;; *) echo "unknown option $a" >&2; exit 2;; esac; done
STAMP=$(date +%Y%m%d-%H%M%S); BKD=$LEAN/backups/install-$STAMP
ITEMS="bin/hx bin/contract bin/lean-run bin/sp bin/q bin/rep bin/pat bin/bk bin/sym bin/outline bin/web bin/hmem bin/sim bin/toolgate bin/package.json helix adapters/claude_code.py hx.d/contract.hx hx.d/verify.hx prompt.d/00-core.txt prompt.d/50-chain.txt prompt.d/90-handle.txt prompt.d/92-show.txt prompt.d/lean95u.txt lib/hmem.py lib/consolidate.py lib/intercept.py lib/offload.py lib/capsule.py lib/claims.py"

put() { # put SRCFILE DESTFILE
  s=$1; d=$2
  if [ "$MODE" = link ] && [ -L "$d" ] && [ "$(readlink "$d")" = "$s" ]; then return; fi
  if [ "$MODE" = copy ] && [ -f "$d" ] && [ ! -L "$d" ] && cmp -s "$s" "$d"; then return; fi
  if [ -e "$d" ] || [ -L "$d" ]; then
    mkdir -p "$BKD/$(dirname "${d#$LEAN/}")" 2>/dev/null || mkdir -p "$BKD"
    mv "$d" "$BKD/${d#$LEAN/}" 2>/dev/null || mv "$d" "$BKD/$(basename "$d")"
    echo "backed up $d -> $BKD"
  fi
  mkdir -p "$(dirname "$d")"
  if [ "$MODE" = link ]; then ln -s "$s" "$d"; else cp -p "$s" "$d"; fi
  echo "installed $d"
}

if [ "$UN" = 1 ]; then
  for i in $ITEMS; do d=$LEAN/$i; if [ -L "$d" ] && case $(readlink "$d") in "$SRC"/*) true;; *) false;; esac; then rm "$d"; echo "removed $d"; fi; done
  s=$STYLES/lean95v.md; [ -f "$s" ] && grep -q '^name: lean95v' "$s" 2>/dev/null && { rm "$s"; echo "removed $s"; }
  echo "Remove the helix hooks block from your settings.json by hand. Backups and data in $LEAN are untouched."; exit 0
fi

for i in $ITEMS; do put "$SRC/$i" "$LEAN/$i"; done
chmod +x "$SRC"/bin/* "$SRC/helix" 2>/dev/null || true

# Output style: rendered (not linked) so $HELIX_LEAN_HOME becomes the real path.
mkdir -p "$STYLES"; T=$(mktemp)
sed "s|\\\$HELIX_LEAN_HOME|$LEAN|g" "$SRC/output-styles/lean95v.md" > "$T"
if [ -f "$STYLES/lean95v.md" ] && cmp -s "$T" "$STYLES/lean95v.md"; then :; else
  if [ -e "$STYLES/lean95v.md" ]; then mkdir -p "$BKD"; mv "$STYLES/lean95v.md" "$BKD/lean95v.md"; echo "backed up $STYLES/lean95v.md -> $BKD"; fi
  cp "$T" "$STYLES/lean95v.md"; echo "installed $STYLES/lean95v.md"
fi
rm -f "$T"

echo
echo "Merge this into ~/.claude/settings.json (not written by this script):"
HELIX_HOME=$LEAN python3 "$LEAN/adapters/claude_code.py" --print-settings
echo
echo "Put $LEAN/bin on PATH if you want bare 'hx', 'q', 'pat' (optional). HELIX_LEAN_HOME=$LEAN"
