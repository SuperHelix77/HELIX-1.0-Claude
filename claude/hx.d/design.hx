# include design 'GOAL' 'SPEC_PATH' 'CHECK_CMD': Opus writes the spec, Sonnet implements it, Opus reviews the deviations
spec: opus Write a decisive design spec for this goal to {{$2}} (create parent dirs; no hedging, no alternatives). Goal: {{$1}}
    Include: information architecture, visual system (layout, type, color, spacing), exact acceptance criteria that can be checked, and the files to touch. Do not implement it. Reply with only the path written.
 brief: 3
build: sonnet Implement the spec in {{$2}} exactly: read it first, touch only the files it lists, and do not redesign. Reply with the files changed and the check result.
 check: {{$3}}
 escalate: opus
 brief: 5
review: opus Review the implementation against the spec in {{$2}}: read the spec and the files it lists, run nothing destructive. List every deviation from its acceptance criteria in at most 10 lines, or reply "no deviations".
 brief: 10
