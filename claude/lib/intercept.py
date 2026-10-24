"""Pre-tool interception under an EQUIVALENCE CONTRACT. A requested operation R is replaced by a cheaper R' only if
 (a) the information requirement Q is established (from the active GoalStep or the grounded user prompt), (b) R' satisfies Q,
 (c) the information loss is declared, (d) the raw R stays addressable as fallback. No inferable Q -> no substitution (conservative).
Metric: SEMANTIC SUBSTITUTION FAILURE RATE (the frontier later re-requests what the substitution removed)."""
import re,os,json,shlex,time
ID=re.compile(r'^[A-Za-z_]\w*$')
INTENT_CALLERS=re.compile(r'\b(who|what|which)\b.{0,30}\b(call|calls|uses?|used|references?|depends?)\b|\bcallers?\b|\busages?\b|\bwhere\b.{0,20}\b(used|called)\b',re.I)
INTENT_SYMBOL=re.compile(r'\b(show|print|read|display|inspect|what does|how does|explain)\b',re.I)
def _tokens(cmd):
    try: return shlex.split(cmd)
    except ValueError: return None
def infer_requirement(tool,tool_input,ctx):
    """-> Q dict or None. ctx={'step':GoalStep|None,'prompt':str}"""
    step=(ctx or {}).get('step') or {}; prompt=(ctx or {}).get('prompt','')
    reqs=step.get('required_evidence',[])
    if tool=='Bash':
        t=_tokens(tool_input.get('command',''))
        if not t: return None
        if t[0] in('grep','rg') and len(t)>=2:
            pat=[a for a in t[1:] if not a.startswith('-')]
            if pat and ID.match(pat[0]):
                name=pat[0]
                if any(r.get('kind') in('callers','impact') and r.get('name')==name for r in reqs): return {'kind':'callers','name':name,'basis':'goal_step'}
                if name in prompt and INTENT_CALLERS.search(prompt): return {'kind':'callers','name':name,'basis':'prompt'}
        if t[0] in('cat','head','tail') and len(t)==2 and t[1].endswith('.py'):
            for r in reqs:
                if r.get('kind')=='symbol' and r.get('file')==t[1]: return {'kind':'symbol','file':t[1],'name':r['name'],'basis':'goal_step'}
    if tool=='Read':
        f=tool_input.get('file_path','')
        if f.endswith('.py') and not tool_input.get('limit') and not tool_input.get('offset'):
            for r in reqs:
                if r.get('kind')=='symbol' and f.endswith(r.get('file','\0')): return {'kind':'symbol','file':f,'name':r['name'],'basis':'goal_step'}
    return None
def substitute(tool,tool_input,ctx=None):
    """-> Substitution record or None. A command carrying HELIX_BYPASS=1 is an explicit raw-fallback request and is never substituted."""
    if tool=='Bash' and tool_input.get('command','').startswith('HELIX_BYPASS=1 '): return None
    q=infer_requirement(tool,tool_input,ctx)
    if not q: return None
    if q['kind']=='callers':
        t=_tokens(tool_input['command']); d=[a for a in t[1:] if not a.startswith('-')]; root=d[1] if len(d)>1 else '.'
        return {'requested':tool_input['command'],'requirement':q,'replacement':f"callers -l {q['name']} {shlex.quote(root)}",'equivalence':'import/def/scope-resolved callers of the function (python AST)',
                'loss':'text matches in comments, strings, docs and non-python files; same-named unrelated symbols are excluded','fallback':'HELIX_BYPASS=1 '+tool_input['command'],'tool':tool}
    if q['kind']=='symbol':
        f=q['file']; return {'requested':tool_input.get('command') or f"Read {f}",'requirement':q,'replacement':f"sym {shlex.quote(f)} {q['name']}",'equivalence':'exact numbered source of the requested symbol',
                'loss':'rest of the file (other symbols, imports, module docstring) omitted','fallback':f"full {shlex.quote(f)}",'tool':tool}
    return None
def apply_bash(tool_input,ctx=None):
    """returns (new_input, substitution|None). Only Bash is rewritten in place; Read gets advice (a host cannot swap tools)."""
    s=substitute('Bash',tool_input,ctx)
    return ({**tool_input,'command':s['replacement']},s) if s else (tool_input,None)
class Ledger:
    """append-only substitution ledger; failure = same target re-requested raw within `window` seconds/turns"""
    def __init__(s,path): s.path=path
    def record(s,sub,turn=0):
        with open(s.path,'a') as f: f.write(json.dumps({'t':time.time(),'turn':turn,'target':sub['requirement'].get('name') or sub['requirement'].get('file'),'kind':sub['requirement']['kind'],'replacement':sub['replacement'],'fallback':sub['fallback'],'failed':False})+'\n')
    def _rows(s): return [json.loads(l) for l in open(s.path)] if os.path.exists(s.path) else []
    def observe_request(s,cmd,turn=None):
        """call for every later raw request; marks matching substitutions as failed if the raw fallback was needed after all"""
        rows=s._rows(); hit=False
        for r in rows:
            if not r['failed'] and cmd.strip()==r['fallback'].strip(): r['failed']=True; hit=True
        if hit: open(s.path,'w').write('\n'.join(json.dumps(r) for r in rows)+'\n')
        return hit
    def failure_rate(s):
        rows=s._rows(); return (sum(r['failed'] for r in rows)/len(rows)) if rows else 0.0
