# include contract 'FILE:SYMBOL FILE:SYMBOL': source, callers, helpers and tests of the symbols you will change, digested
c: sh ${HELIX_LEAN_HOME:-$HOME/.claude-lean}/bin/contract {{$1}}
 quiet: true
 digest: From this code-contract dump, list in at most 12 lines: (1) every caller path of the target symbols and what each caller needs from the result (types, ordering, empty cases, SQL contexts such as SELECT/WHERE/GROUP BY), (2) every assumption a fix could make about the called helpers, each with the evidence line that confirms or refutes it, (3) the existing test files to run. Quote file:line.
