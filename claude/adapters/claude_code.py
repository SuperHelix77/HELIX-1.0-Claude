#!/usr/bin/env python3
"""HELIX host adapter for Claude Code. Thin: it maps hook events onto helix-core operations and decides NONE of the policy.
Host operations: inject_context, intercept_tool, observe_boundary (consolidate). Reads the hook JSON on stdin, writes the hook JSON on stdout.
  python3 adapters/claude_code.py SessionStart|PreToolUse|PostToolUse|PreCompact|Stop|SessionEnd|UserPromptSubmit
Print the settings snippet (never writes settings): python3 adapters/claude_code.py --print-settings"""
import os,re,sys,json,hashlib,subprocess
HOME=os.environ.get('HELIX_HOME') or os.environ.get('HELIX_LEAN_HOME') or os.path.expanduser('~/.claude-lean')
sys.path.insert(0,os.path.join(HOME,'lib'))
import hmem,consolidate,intercept,offload
def project_key(cwd): return 'p-'+hashlib.sha256(os.path.abspath(cwd).encode()).hexdigest()[:10]
def db_path(): return os.environ.get('HELIX_MEM_DB',os.path.join(HOME,'memory.db'))
def out(o): print(json.dumps(o))
def ctx_state(): 
    p=os.path.join(HOME,'run','ctx.json')
    try: return json.load(open(p))
    except Exception: return {}
def inject_context(event,text): out({'hookSpecificOutput':{'hookEventName':event,'additionalContext':text}})
def log_session(p):
    """measure only: record effort/model/window per session start so hscore can attribute differences (transcripts do not store effort). Never raises."""
    try:
        e=os.environ; row={'ts':__import__('time').time(),'session':p.get('session_id'),'source':p.get('source'),'model':p.get('model') or e.get('ANTHROPIC_MODEL'),
         'effort':e.get('CLAUDE_EFFORT') or e.get('CLAUDE_CODE_EFFORT_LEVEL'),'window':e.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW'),'think':e.get('MAX_THINKING_TOKENS'),'cap':e.get('HELIX_SUMMARY_CAP','1'),'class':e.get('HELIX_CLASS')}
        with open(os.path.join(HOME,'run','sessions.jsonl'),'a') as f: f.write(json.dumps(row)+chr(10))
    except Exception: pass
def on_session_start(p):
    """once per session start/resume/clear/compact: the capsule replaces replayed history. Never per turn."""
    log_session(p); reset_seen(p); reset_hx_seen()
    key=project_key(p.get('cwd','.'))
    if p.get('source')=='startup':
        # clear-continue: inject the capsule on a fresh start only when HELIX_CONTINUE=1 or a one-shot marker (see --mark-continue) exists
        marker=os.path.join(HOME,'run','continue.'+key); marked=os.path.exists(marker)
        if marked:
            try: os.remove(marker)
            except OSError: pass
        if not (marked or os.environ.get('HELIX_CONTINUE')=='1'): return
    t=consolidate.session_start_context(key,db_path())
    if t: inject_context('SessionStart','HELIX MEMORY (addressable; query with hmem q / hmem raw N):\n'+t)
def on_pre_tool_use(p):
    if p.get('tool_name')!='Bash': return
    ti=p.get('tool_input') or {}; cmd=ti.get('command','')
    new,sub=intercept.apply_bash(ti,ctx_state())
    if sub: 
        intercept.Ledger(os.path.join(HOME,'run','substitutions.jsonl')).record(sub)
        out({'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'allow','updatedInput':new,'permissionDecisionReason':f"HELIX substitution: {sub['equivalence']}; loss: {sub['loss']}; fallback: {sub['fallback']}"}})
    else: intercept.Ledger(os.path.join(HOME,'run','substitutions.jsonl')).observe_request(cmd)
OFFLOAD_ROOT=os.path.join(HOME,'offload')
def seen_path(p):
    k=re.sub(r'[^\w-]','',str(p.get('session_id') or 'none'))[:64]+('-'+re.sub(r'[^\w-]','',str(p['agent_id']))[:40] if p.get('agent_id') else '')
    return os.path.join(HOME,'run','offload-seen',k+'.json')
def reset_seen(p):
    """context epoch ended (compaction/clear/resume): earlier outputs are no longer in context, so repeat references must not point at them"""
    d=os.path.dirname(seen_path(p)); sid=re.sub(r'[^\w-]','',str(p.get('session_id') or 'none'))[:64]
    try:
        for f in os.listdir(d):
            if f.startswith(sid): os.remove(os.path.join(d,f))
    except OSError: pass
def tool_text(name,tr):
    """-> (text,rebuild) for offloadable non-Bash results, else None. rebuild(new_text) returns a result of the same shape."""
    if name=='WebFetch':
        if isinstance(tr,dict) and isinstance(tr.get('result'),str): return tr['result'],lambda t:{**tr,'result':t}
        return None
    if name=='Read':   # text reads only; images/PDFs/notebooks pass through
        f=tr.get('file') if isinstance(tr,dict) and tr.get('type')=='text' else None
        if isinstance(f,dict) and isinstance(f.get('content'),str): return f['content'],lambda t:{**tr,'file':{**f,'content':t}}
        return None
    if name=='Grep':   # content mode only; file lists and counts are already bounded
        if isinstance(tr,dict) and tr.get('mode')=='content' and isinstance(tr.get('content'),str): return tr['content'],lambda t:{**tr,'content':t}
        return None
    if not name.startswith('mcp__') or name.startswith('mcp__helix__'): return None   # helix raw restores must stay exact
    if isinstance(tr,str): return tr,lambda t:t
    if isinstance(tr,list) and tr and all(isinstance(b,dict) and b.get('type')=='text' and isinstance(b.get('text'),str) and set(b)<={'type','text'} for b in tr):
        return '\n\n'.join(b['text'] for b in tr),lambda t:[{'type':'text','text':t}]
    return None
def on_post_tool_use(p):
    """lossless offload: large Bash/WebFetch/MCP output -> archived exact bytes + preview with exact recovery command. Pass through on any doubt."""
    name=p.get('tool_name') or ''
    if os.environ.get('HELIX_OFFLOAD','1')=='0': return
    tr=p.get('tool_response'); ti=p.get('tool_input') or {}
    if name=='Bash':
        cmd=ti.get('command','')
        if not isinstance(tr,dict) or not isinstance(tr.get('stdout'),str) or tr.get('isImage') or tr.get('backgroundTaskId') or tr.get('persistedOutputPath'): return
        args=(cmd,tr.get('stdout'),tr.get('stderr') if isinstance(tr.get('stderr'),str) else ''); kw={}
        rebuild=lambda o,e:{**tr,'stdout':o,'stderr':e}
    else:
        got=tool_text(name,tr)
        if not got: return
        text,rb=got; cmd=name+':'+str(ti.get('url') or ti.get('file_path') or ti.get('path') or '')[:200]
        if offload.OPTOUT.search(json.dumps(ti)): return
        args=(cmd,text,''); kw={'limit':offload.T_RANGE,'label':'result'}   # explicit reads: same threshold as Bash range reads
        rebuild=lambda o,e:rb(o or e)
    sp=seen_path(p)
    try: seen=set(json.load(open(sp)))
    except Exception: seen=set()
    n0=len(seen); r=offload.shrink(*args,OFFLOAD_ROOT,seen,**kw)
    if len(seen)!=n0:
        os.makedirs(os.path.dirname(sp),exist_ok=True); json.dump(sorted(seen)[-400:],open(sp,'w'))
    if not r: return
    new_out,new_err,rec=r
    rec.update(ts=__import__('time').time(),session=p.get('session_id'),tool=name,keys=sorted(tr) if isinstance(tr,dict) else type(tr).__name__,cmd=cmd[:120])
    with open(os.path.join(HOME,'run','offloads.jsonl'),'a') as f: f.write(json.dumps(rec)+chr(10))
    out({'hookSpecificOutput':{'hookEventName':'PostToolUse','updatedToolOutput':rebuild(new_out,new_err)}})
def on_boundary(p):
    """PreCompact / Stop / SessionEnd (including reason 'clear'): archive + promote BEFORE any lossy compaction or clear"""
    tp=p.get('transcript_path')
    if tp and os.path.exists(tp): consolidate.consolidate(tp,project_key(p.get('cwd','.')),db=db_path(),root=p.get('cwd','.'),last_text=p.get('last_assistant_message'))
SUMMARY_CAP=("HELIX: this conversation is archived losslessly (hmem q / hmem raw N) and a memory capsule is re-injected after compaction. "
 "Write the summary in <=2500 tokens: the user's current objective and latest instructions (verbatim, short), hard constraints, decisions with the reason, "
 "exact paths/IDs/commands needed to continue, open tasks, failed approaches. Omit narration, tool output, code bodies and anything recoverable from files or hmem; reference by path or #seq.")
def on_pre_compact(p):
    on_boundary(p)
    if os.environ.get('HELIX_SUMMARY_CAP','1')=='0' or (p.get('custom_instructions') or '').strip(): return
    print(SUMMARY_CAP)
def reset_hx_seen():
    """hx withholds unchanged re-reads; after compaction or clear the model may no longer hold that text"""
    import shutil; shutil.rmtree(os.path.join(HOME,'run','hx-seen'),ignore_errors=True)
def on_post_compact(p):
    """measure only: log summary size per compaction (no policy, never raises into the host)"""
    reset_seen(p); reset_hx_seen(); t=p.get('compact_summary') or ''
    with open(os.path.join(HOME,'run','compactions.jsonl'),'a') as f:
        f.write(json.dumps({'ts':__import__('time').time(),'trigger':p.get('trigger'),'summary_chars':len(t),'approx_tokens':len(t)//4,'cap':os.environ.get('HELIX_SUMMARY_CAP','1')})+chr(10))
ROTATE=int(os.environ.get('HELIX_ROTATE_TOKENS','300000'))
def last_context_tokens(tp):
    """measure only: size of the latest main-thread request, from the transcript tail; None when unknown"""
    try:
        with open(tp,'rb') as f:
            f.seek(0,2); n=f.tell(); f.seek(max(0,n-2000000)); lines=f.read().decode('utf-8','ignore').splitlines()
    except OSError: return None
    for l in reversed(lines):
        if '"usage"' not in l: continue
        try: r=json.loads(l)
        except ValueError: continue
        m=r.get('message')
        if r.get('isSidechain') or r.get('type')!='assistant' or not isinstance(m,dict) or not m.get('usage'): continue
        u=m['usage']; return u.get('input_tokens',0)+u.get('cache_creation_input_tokens',0)+u.get('cache_read_input_tokens',0)
    return None
def context_guard(p):
    """the 1M window removes compaction; above ROTATE a large context is rotated at a task boundary instead. Emits once per 100k step, never per turn."""
    n=last_context_tokens(p.get('transcript_path') or '')
    mp=os.path.join(HOME,'run','guard.'+re.sub(r'[^\w-]','',str(p.get('session_id') or 'x'))[:40])
    if not n or n<ROTATE:
        if os.path.exists(mp): os.remove(mp)
        return ''
    try: last=int(open(mp).read())
    except (OSError,ValueError): last=0
    step=n//100000
    if step<=last: return ''
    open(mp,'w').write(str(step))
    return (f'HELIX context guard: this conversation is {n//1000}k tokens; every request rereads it and a cache expiry rewrites it. '
      'If this prompt starts a new task or a loop tick: put a kind "state" note with mcp__helix__memory, then mcp__ccd_session_mgmt__clear_session {session_id "self"}. If the clear is refused (Remote Control), run `python3 $HELIX_LEAN_HOME/adapters/claude_code.py --mark-continue "$PWD"` and propose continuing in a fresh session (start_session, own_initiative, fresh, with a short brief); the new session picks up the capsule. Mid-task: finish first.')
def on_user_prompt(p):
    """mid-work injection: scheduler state only when it CHANGED since last emission, plus the context guard (never a per-turn constant)"""
    parts=[]; sp=os.path.join(HOME,'run','state.txt'); mp=os.path.join(HOME,'run','state.emitted')
    try: txt=open(sp).read()
    except OSError: txt=None
    if txt is not None:
        h=hashlib.sha256(txt.encode()).hexdigest()[:12]
        if not (os.path.exists(mp) and open(mp).read().strip()==h): open(mp,'w').write(h); parts.append(txt)
    g=context_guard(p)
    if g: parts.append(g)
    if parts: inject_context('UserPromptSubmit','\n'.join(parts))
DISPATCH={'SessionStart':on_session_start,'PreToolUse':on_pre_tool_use,'PostToolUse':on_post_tool_use,'PreCompact':on_pre_compact,'PostCompact':on_post_compact,'Stop':on_boundary,'SessionEnd':on_boundary,'UserPromptSubmit':on_user_prompt}
def settings_snippet(py='/usr/bin/python3'):
    c=lambda ev:{'type':'command','command':f'{py} {os.path.join(HOME,"adapters","claude_code.py")} {ev}','timeout':20}
    return {'hooks':{'SessionStart':[{'matcher':'startup|resume|clear|compact','hooks':[c('SessionStart')]}],'PreToolUse':[{'matcher':'Bash','hooks':[c('PreToolUse')]}],'PostToolUse':[{'matcher':'Bash|WebFetch|mcp__.*','hooks':[c('PostToolUse')]}],
                     'PreCompact':[{'hooks':[c('PreCompact')]}],'PostCompact':[{'hooks':[c('PostCompact')]}],'Stop':[{'hooks':[c('Stop')]}],'SessionEnd':[{'hooks':[c('SessionEnd')]}],'UserPromptSubmit':[{'hooks':[c('UserPromptSubmit')]}]}}
def main():
    # Grok runs this file too, because it loads ~/.claude/settings.json hooks.
    # That host has its own Helix home. Skip here unless that home opted in.
    if os.environ.get('GROK_SESSION_ID') and not os.environ.get('HELIX_FOR_GROK'):
        return
    a=sys.argv[1:]
    if a[:1]==['--print-settings']: print(json.dumps(settings_snippet(),indent=1)); return
    if a[:1]==['--mark-continue']:
        cwd=a[1] if len(a)>1 else '.'; key=project_key(cwd)
        if len(a)>2: on_boundary({'transcript_path':a[2],'cwd':cwd})
        os.makedirs(os.path.join(HOME,'run'),exist_ok=True); open(os.path.join(HOME,'run','continue.'+key),'w').write('1')
        print(f'HELIX: continue marker set for {key}; the next fresh session in {os.path.abspath(cwd)} gets the capsule'); return
    ev=a[0] if a else ''
    try: p=json.load(sys.stdin)
    except Exception: p={}
    fn=DISPATCH.get(ev or p.get('hook_event_name',''))
    if fn:
        try: fn(p)
        except Exception as e: sys.stderr.write(f'helix adapter {ev}: {type(e).__name__}: {e}\n')   # a hook must never break the host session
if __name__=='__main__': main()
