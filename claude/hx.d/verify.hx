# include verify 'TEST CMD' 'SCRATCH FILES': test; on a pass remove the scratch files (and pyrun's git add -N staging) and show the diff
t: test {{$1}}
clean: sh for f in {{$2}}; do rm -f -- $f; git rm -q --cached --ignore-unmatch -- $f >/dev/null 2>&1; done; git status --short; git diff --stat | tail -3
  when: {{t.code}} == 0
