"""Proactive memory consolidation: BEFORE native compaction, classify state hot/warm/cold, promote durable information to memory,
turn raw material into handles, drop transient context. Native lossy summarization becomes the emergency fallback, not the persistence mechanism.
hot  = still needed verbatim next turn (recent window, user directives, unresolved errors)   -> stays in the capsule/context
warm = durable conclusions (assistant decisions/results, claims)                              -> claim ledger + hot index
cold = raw tool I/O                                                                          -> lossless archive, addressable by #seq handle only"""
import os,sys,re,json
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import hmem,capsule
try: import claims as hclaims
except Exception: hclaims=None
def classify(units,window=12):
    last=units[-1]['seq'] if units else 0; hot=[];warm=[];cold=[]
    for u in units:
        recent=u['seq']>last-window
        err=u['kind']=='result' and capsule.CUE_PROB.search(u['text'][:600]) is not None and recent
        if u['kind']=='user' or recent or err: hot.append(u['seq'])
        elif u['kind']=='assistant' and (capsule.CUE_DEC.search(u['text']) or capsule.CUE_FACT.search(u['text'])): warm.append(u['seq'])
        else: cold.append(u['seq'])
    return {'hot':hot,'warm':warm,'cold':cold}
def consolidate(transcript,session,db=None,root='.',budget_tokens=1150,out_dir=None,last_text=None):
    """incremental: only units newer than the stored watermark are ingested; returns stats and writes capsule.<session>.txt"""
    db=db or hmem.DB; units=hmem.units_from_transcript(transcript)
    od=out_dir or os.path.dirname(db) or '.'; path=os.path.join(od,f'capsule.{session}.txt')
    # seq is per transcript but the archive is per project: give each transcript a stable offset so #seq handles stay unique,
    # and keep one watermark per transcript (a clear starts a new transcript at seq 0)
    tx=os.path.basename(transcript); off=hmem.meta_get(session,'off:'+tx,None,db)
    if off is None:
        c=hmem.connect(db); legacy=units and c.execute('SELECT 1 FROM unit WHERE session=? AND seq=? AND ts=? LIMIT 1',(session,units[0]['seq'],units[0]['ts'])).fetchone()
        if legacy: off,done0=0,int(hmem.meta_get(session,'last_seq',-1,db))
        else:
            mx=c.execute('SELECT MAX(seq) FROM unit WHERE session=?',(session,)).fetchone()[0]; off,done0=(0 if mx is None else mx+1),-1
            hmem.meta_set(session,'carry:'+tx,carry_from(open(path).read()) if mx is not None and os.path.exists(path) else '',db)
        hmem.meta_set(session,'off:'+tx,off,db); hmem.meta_set(session,'last_seq:'+tx,done0,db)
    off=int(off); units=[dict(u,seq=u['seq']+off) for u in units]
    done=int(hmem.meta_get(session,'last_seq:'+tx,-1,db)); new=[u for u in units if u['seq']>done]
    n=hmem.ingest(new,session=session,path=db) if new else 0
    if units: hmem.meta_set(session,'last_seq:'+tx,units[-1]['seq'],db)
    carry=hmem.meta_get(session,'carry:'+tx,'',db)
    units=[u for u in units if not (u['kind']=='user' and CLEARED.match(u['text']))]
    cl=hclaims.all_claims(root,db,session=None) if hclaims else []
    cap=capsule.build_map(units,claim_list=cl,claim_cap=18,max_chars=int(budget_tokens*3.6)) if units else ''
    # budget: trim claim hot index first (claims are retrievable), then phases
    while len(cap)/3.6>budget_tokens and '\n PHASES' not in cap[:0]:
        lines=cap.split('\n'); i=next((k for k,l in enumerate(lines) if l.startswith(' C') and ' | ' in l),None)
        if i is None: break
        parts=lines[i].split(' | ')
        if len(parts)<=3: break
        lines[i]=' | '.join(parts[:-2]); cap='\n'.join(lines)
    if last_text and last_text.strip():   # Stop payload: the transcript can lag the final reply
        line='LAST STATE (final reply): '+' '.join(last_text.split())[:300]
        cap=re.sub(r'(?m)^LAST STATE.*$',lambda m:line,cap,count=1) if re.search(r'(?m)^LAST STATE',cap) else cap+'\n'+line
    if carry: cap+='\n'+carry
    open(path,'w').write(cap)
    cls=classify(units)
    return {'ingested':n,'total_units':len(units),'hot':len(cls['hot']),'warm':len(cls['warm']),'cold':len(cls['cold']),'capsule_chars':len(cap),'capsule_path':path}
CLEARED=re.compile(r'\s*Session cleared\.?\s*Continue\.?\s*$',re.I)
def carry_from(cap,ndir=4):
    """after a clear: the previous thread's latest state and last directives, one level deep (its own carry is dropped)"""
    ls=cap.split('\nPREVIOUS THREAD')[0].splitlines(); sec=''; d=[]; last=''
    for l in ls:
        if not l.startswith(' '): sec=l
        if l.startswith('LAST STATE'): last=l[:340]
        elif sec.startswith('USER DIRECTIVES') and l.startswith(' ') and not CLEARED.search(l): d.append(l[:200])
    if not (last or d): return ''
    return 'PREVIOUS THREAD (before the last clear; hmem raw N still works): '+(last or '')+('\n'+'\n'.join(d[-ndir:]) if d else '')
def trim_capsule(t,line=220,ents=3):
    """injection view only (the capsule file and hmem keep everything): phases keep their seq range and top entities, long lines are cut"""
    o=[];sec=''
    for l in t.splitlines():
        if not l.startswith(' '): sec=l; o.append(l if len(l)<=2*line else l[:2*line]+'…'); continue
        if sec.startswith('PHASES') and ': ' in l: h,_,e=l.partition(': '); l=h+': '+', '.join(e.split(', ')[:ents])
        o.append(l if len(l)<=line else l[:line]+'…')
    return '\n'.join(o)
def session_start_context(session,db=None,out_dir=None,max_chars=2600):
    od=out_dir or os.path.dirname(db or hmem.DB) or '.'; p=os.path.join(od,f'capsule.{session}.txt')
    if not os.path.exists(p): return ''
    t=trim_capsule(open(p).read()); h,s,tail=t.partition('\nLAST STATE')   # over budget: cut the middle, keep the latest state
    return t if len(t)<=max_chars else h[:max(0,max_chars-len(s+tail)-2)]+'\n…'+(s+tail)[:max_chars]
