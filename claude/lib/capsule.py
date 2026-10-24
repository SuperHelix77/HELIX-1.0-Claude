"""Deterministic context capsule: dense, typed, handle-addressed. No model required (optional triage plug-in).
Principle: user directives verbatim; everything else extractive (never paraphrased), each line carries a #seq handle into lossless memory."""
import re,os,sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import hmem
CUE_DEC=re.compile(r'\b(decid|chose|choose|going with|root cause|finding|verdict|fix(ed)?:|so (the|we)|because|instead of|conclusion|result:|key (finding|point)|won.t|will not|rejected|not worth|better than|worse than|floor|can.t|cannot|blocked|denied)\b',re.I)
CUE_FACT=re.compile(r'(\d[\d,._]*\s?(%|ms|tokens?|x\b|MB|GB|KB|k\b|s\b|turns?)|[-−+]\d+(\.\d+)?%|\b\d+/\d+\b)')
CUE_PROB=re.compile(r'\b(bug|error|fail(ed|ure|s)?|denied|blocked|broke|wrong|false route|unsafe|missing|not found|crash|mismatch|incorrect|misrout)\w*',re.I)
def sents(t):
    t=re.sub(r'```.*?```','',t,flags=re.S)
    parts=re.split(r'(?<=[.!?])\s+|\n+',t)
    return [p.strip(' -*|#>') for p in parts if len(p.strip())>25]
def clip(s,n): s=re.sub(r'\s+',' ',s).strip(); return s if len(s)<=n else s[:n-1]+'…'
def build(units,budget_tokens=1500,user_cap=360,labeler=None):
    """units: [{seq,kind,text}]. labeler(text)->'decision'|'result'|'problem'|'plan'|'chatter' (optional, e.g. Laya)."""
    users=[u for u in units if u['kind']=='user']
    asst=[u for u in units if u['kind']=='assistant']
    L=['CAPSULE (extractive; #N = handle: `hmem raw N`; search: `hmem q "terms"`)']
    L.append('USER DIRECTIVES (verbatim):')
    for u in users: L.append(f" #{u['seq']} {clip(u['text'],user_cap)}")
    dec=[];fact=[];prob=[];seen=set()
    for u in asst:
        for s in sents(u['text']):
            k=re.sub(r'\W+','',s.lower())[:60]
            if k in seen: continue
            lab=labeler(s) if labeler else None
            isd=(lab=='decision') if lab else bool(CUE_DEC.search(s))
            isf=(lab=='result') if lab else bool(CUE_FACT.search(s))
            isp=(lab=='problem') if lab else bool(CUE_PROB.search(s))
            sc=len(CUE_FACT.findall(s))
            if isf and sc: fact.append((sc,u['seq'],s)); seen.add(k)
            elif isp: prob.append((1,u['seq'],s)); seen.add(k)
            elif isd: dec.append((1,u['seq'],s)); seen.add(k)
    files=[]
    for u in units:
        if u['kind']=='call' and u['text'].startswith('WRITE '):
            files.append((u['seq'],u['text'].split('\n')[0][6:]))
    # calls that ran benchmarks/tests -> state lines (command heads)
    def take(lst,n,cap): 
        lst=sorted(lst,key=lambda x:(-x[0],x[1]))[:n]; return [f" #{q} {clip(s,cap)}" for _,q,s in sorted(lst,key=lambda x:x[1])]
    budget=lambda: sum(len(x) for x in L)//3.6
    if files: L.append('FILES WRITTEN: '+'; '.join(f'{p.split("/")[-1]}#{q}' for q,p in files[:14]))
    L.append('KEY NUMBERS/RESULTS:'); nf=0
    for line in take(fact,30,170): L.append(line)
    L.append('DECISIONS/FINDINGS:'); 
    for line in take(dec,16,170): L.append(line)
    L.append('PROBLEMS/BLOCKERS:')
    for line in take(prob,12,170): L.append(line)
    if asst: L.append(f'LAST STATE #{asst[-1]["seq"]}: '+clip(asst[-1]['text'],320))
    out='\n'.join(L)
    # trim to budget by dropping lowest-ranked tail lines of numbered sections
    while len(out)/3.6>budget_tokens and len(L)>8:
        for i in range(len(L)-2,0,-1):
            if L[i].startswith(' #') and not any(L[i].startswith(f' #{u["seq"]} ') for u in users): L.pop(i); break
        else: break
        out='\n'.join(L)
    return out

RE_COMPACT=re.compile(r'^\s*This session is being continued from a previous conversation')
RE_SHELL=re.compile(r'^\s*<bash-input>(.*?)</bash-input>',re.S)
RE_PASTE=re.compile(r'<pasted_content[^>]*>(.*?)(?:</pasted_content>|$)',re.S)
def _paste(m):
    body=m.group(1).strip(); return f"[pasted {len(body)} chars: {clip(body.split(chr(10),1)[0],80)}]"
def directive(text,cap):
    """(kind,line): compaction summaries become pointers, shell echoes keep only the command, pastes become stubs; the user's own words stay verbatim. Exact text stays in hmem."""
    if RE_COMPACT.match(text): return 'compact',''
    m=RE_SHELL.match(text)
    if m: return 'shell','$ '+clip(m.group(1),120)
    return 'user',clip(RE_PASTE.sub(_paste,text),cap)

def _fit(items,room,keep_first=True):
    """items chronological [(seq_lo,seq_hi,line)]; keep the first and the newest that fit in room chars; omitted runs become markers."""
    if not items: return []
    keep=set(); used=0
    order=([0] if keep_first else [])+[i for i in range(len(items)-1,-1,-1) if not (keep_first and i==0)]
    for i in order:
        n=len(items[i][2])+1
        if used+n>room and keep: continue
        keep.add(i); used+=n
    out=[];run=[]
    def flush():
        if run: out.append(f" … {len(run)} older omitted #{items[run[0]][0]}-#{items[run[-1]][1]}"+('' if any(o.startswith(' … ') for o in out) else ' (hmem q "terms" | hmem raw N)'))
    for i,it in enumerate(items):
        if i in keep: flush(); run=[]; out.append(it[2])
        else: run.append(i)
    flush(); return out

def build_map(units,user_cap=420,top_ents=8,claim_list=None,claim_cap=14,max_chars=None):
    """v1 capsule = verbatim user directives + phase map (entities per phase) + files written + last state. No extractive 'facts' (they mislead when superseded).
    max_chars: keep #0 plus the newest directives/phases that fit; older ones become retrievable omission markers."""
    from collections import Counter
    users=[u for u in units if u['kind']=='user']
    groups={};compacts=[];real=[]
    for u in users:
        k,line=directive(u['text'],user_cap)
        if k=='compact': compacts.append(u['seq']); real.append(u['seq']); continue
        if k=='user': real.append(u['seq'])
        g=groups.setdefault(re.sub(r'\s+','',line.lower()),[[],line]); g[0].append(u['seq']); g[1]=line
    dirs=sorted(((v[0],v[-1],' '+','.join(f'#{q}' for q in v)+' '+l) for v,l in groups.values()),key=lambda x:x[1])
    head=['MEMORY MAP (everything is archived losslessly; query it: hmem q "terms" -k 4 | hmem raw N)','USER DIRECTIVES (verbatim, #seq):']
    mid=[]
    if compacts: mid.append(f'COMPACTIONS ({len(compacts)} prior summaries, exact text: hmem raw N): '+('… ' if len(compacts)>12 else '')+' '.join(f'#{q}' for q in compacts[-12:]))
    if claim_list:
        import claims as _cl
        order={'FALSIFIED':0,'CONFIRMED':1,'OPEN':2}
        cur=[d for d in claim_list if d['effective']!='SUPERSEDED']
        cur.sort(key=lambda d:(d['effective']=='STALE',order.get(d['status'],3)))
        mid.append('CLAIMS hot index (F=falsified dead end, A=active, O=open, X=stale; card: hmem claim show Cxxxxxx):')
        parts=[_cl.short(d) for d in cur[:claim_cap]]
        while max_chars and len(parts)>3 and len(' | '.join(parts))>max_chars//5: parts.pop()
        mid.append(' '+' | '.join(parts))
    bounds=sorted(set(real or [units[0]['seq']]))+[units[-1]['seq']+1]
    phases=[]
    for a,b in zip(bounds,bounds[1:]):
        ph=[u for u in units if a<=u['seq']<b]; cnt=Counter()
        for u in ph:
            if u['kind'] in('assistant','call'):
                for t in hmem.RE_TICK.findall(u['text']):
                    if 3<=len(t)<=40 and not re.fullmatch(r'[\d.,%\s−-]+',t) and sum(c.isalnum() for c in t)>=len(t)/2: cnt[t]+=1
        if cnt: phases.append((a,b-1,f" #{a}-{b-1}: "+', '.join(t for t,_ in cnt.most_common(top_ents))))
    tail=[]
    files=[(u['seq'],u['text'].split('\n')[0][6:].split('/')[-1]) for u in units if u['kind']=='call' and u['text'].startswith('WRITE ')]
    if files: tail.append('FILES WRITTEN: '+(f'+{len(files)-8} older; ' if len(files)>8 else '')+'; '.join(f'{p}#{q}' for q,p in files[-8:]))
    asst=[u for u in units if u['kind']=='assistant']
    if asst: tail.append(f'LAST STATE #{asst[-1]["seq"]}: '+clip(asst[-1]['text'],300))
    if max_chars is None: D=[d[2] for d in dirs]; P=[p[2] for p in phases]
    else:
        room=max_chars-len('\n'.join(head+mid+['PHASES (seq range: top entities):']+tail))-2
        size=lambda xs: sum(len(x)+1 for x in xs)
        budget=room
        while True:
            D=_fit(dirs,int(room*.6)); P=_fit(phases,room-size(D),keep_first=False)
            if len(D)<len(dirs) and room-size(D+P)>0: D=_fit(dirs,room-size(P))
            if size(D+P)<=budget or room<=0: break
            room-=size(D+P)-budget
    return '\n'.join(head+D+mid+['PHASES (seq range: top entities):']+P+tail)
