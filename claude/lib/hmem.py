"""Helix Memory: lossless archive + dense retrieval for context compaction.
Own SQLite DB (never ~/.claude-mem). Observation-style rows (claude-mem-compatible shape: kind/title/text/files/concepts),
raw bodies zlib-compressed and exact. No model needed for ingest/search; semantic triage (Laya) is optional and pluggable.
"""
import os,re,json,sqlite3,zlib,time,hashlib

HOME=os.environ.get('HELIX_HOME',os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB=os.environ.get('HELIX_MEM_DB',os.path.join(HOME,'memory.db'))
RE_CMD=re.compile(r'<command-name>(.*?)</command-name>.*?<command-args>(.*?)</command-args>',re.S)
RE_TAG=re.compile(r'<(system-reminder|local-command-caveat|command-name|command-message|command-args|local-command-stdout|task-notification)[^>]*>.*?</\1>',re.S)
RE_FILE=re.compile(r'(?<![\w/])((?:[\w.-]+/)*[\w.-]+\.(?:py|js|ts|md|json|jsonl|sh|txt|csv|toml|yaml|yml|html|css|cjs|rs|go))\b')
RE_NUM=re.compile(r'[-+−]?\d[\d,_.]*\s?(?:%|ms|s\b|x\b|tokens?|MB|GB|KB|k\b)?')
RE_TICK=re.compile(r'`([^`\n]{2,60})`')
RE_ERR=re.compile(r'(Traceback|Error|error:|FAIL|denied|blocked|not found|Exception|refused)',re.I)

def connect(path=None):
    c=sqlite3.connect(path or DB); c.row_factory=sqlite3.Row
    try: c.executescript('''
    CREATE TABLE IF NOT EXISTS unit(id INTEGER PRIMARY KEY, session TEXT, seq INTEGER, ts TEXT, kind TEXT, importance INTEGER DEFAULT 1,
        label TEXT, title TEXT, files TEXT, concepts TEXT, nbytes INTEGER, raw BLOB);
    CREATE VIRTUAL TABLE IF NOT EXISTS unit_fts USING fts5(title, body, files, concepts, content='', tokenize="unicode61 remove_diacritics 2 tokenchars '_'");
    CREATE TABLE IF NOT EXISTS passage(id INTEGER PRIMARY KEY, session TEXT, seq INTEGER, kind TEXT, idx INTEGER, text TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts USING fts5(text, content='', tokenize="unicode61 remove_diacritics 2 tokenchars '_'");
    CREATE TABLE IF NOT EXISTS meta(session TEXT, key TEXT, value TEXT, PRIMARY KEY(session,key));
    CREATE INDEX IF NOT EXISTS unit_sess ON unit(session,seq);
    ''')
    except sqlite3.OperationalError: pass      # read-only / sandboxed DB: reads must never require write access
    return c

def _clean(t):
    if isinstance(t,list): t=' '.join(b.get('text','') if isinstance(b,dict) else str(b) for b in t)   # queued prompts can be content blocks
    return RE_TAG.sub('',t or '').strip()

def units_from_transcript(path,upto=None):
    """Claude Code JSONL -> ordered semantic units (user / assistant text / tool call / tool result). Thinking blocks dropped."""
    out=[]; seq=0
    for line in open(path):
        try: d=json.loads(line)
        except Exception: continue
        t=d.get('type'); ts=d.get('timestamp','')
        if t=='attachment':
            a=d.get('attachment') or {}
            if a.get('type')=='queued_command' and a.get('prompt'):
                x=_clean(a['prompt'])
                if x: out.append({'seq':seq,'ts':ts,'kind':'user','text':x}); seq+=1
            continue
        if t not in('user','assistant'): continue
        if d.get('isMeta') and not (isinstance((d.get('message') or {}).get('content'),str) and '<command-args>' in d['message']['content']): continue
        m=d.get('message') or {}; c=m.get('content')
        if t=='user':
            if isinstance(c,str):
                mm=RE_CMD.search(c)
                x=(f"{mm.group(1).strip()} {mm.group(2).strip()}".strip() if mm and mm.group(2).strip() else ('' if mm else _clean(c)))
                if x: out.append({'seq':seq,'ts':ts,'kind':'user','text':x}); seq+=1
            elif isinstance(c,list):
                for b in c:
                    if b.get('type')=='text':
                        x=_clean(b.get('text',''))
                        if x: out.append({'seq':seq,'ts':ts,'kind':'user','text':x}); seq+=1
                    elif b.get('type')=='tool_result':
                        cc=b.get('content'); x=cc if isinstance(cc,str) else ' '.join(y.get('text','') for y in (cc or []) if isinstance(y,dict))
                        x=_clean(x)
                        if x: out.append({'seq':seq,'ts':ts,'kind':'result','text':x}); seq+=1
        else:
            if not isinstance(c,list): continue
            for b in c:
                if b.get('type')=='text' and b.get('text','').strip(): out.append({'seq':seq,'ts':ts,'kind':'assistant','text':b['text'].strip()}); seq+=1
                elif b.get('type')=='tool_use':
                    i=b.get('input') or {}; x=i.get('command') or i.get('file_path') or i.get('content') or json.dumps(i)[:600]
                    if i.get('file_path') and i.get('content'): x=f"WRITE {i['file_path']}\n{i['content'][:1500]}"
                    out.append({'seq':seq,'ts':ts,'kind':'call','text':str(x)}); seq+=1
        if upto is not None and seq>=upto: break
    return out

def entities(text):
    files=list(dict.fromkeys(RE_FILE.findall(text)))[:12]
    ticks=list(dict.fromkeys(RE_TICK.findall(text)))[:14]
    return files,ticks

def title_of(u):
    t=u['text'].strip().split('\n')[0]; return (t[:110]+'…') if len(t)>110 else t

def passages(text,maxc=360):
    """split a unit into retrievable passages: lines, long lines further split on sentences"""
    out=[]
    for ln in re.split(r'\n+',text):
        ln=ln.strip()
        if len(ln)<12: continue
        if len(ln)<=maxc: out.append(ln); continue
        buf=''
        for sn in re.split(r'(?<=[.!?;])\s+',ln):
            if len(buf)+len(sn)>maxc and buf: out.append(buf); buf=''
            buf=(buf+' '+sn).strip()
            while len(buf)>maxc*1.6: out.append(buf[:maxc]); buf=buf[maxc:]
        if buf: out.append(buf)
    return out[:160]

def ingest(units,session='s0',path=None,labeler=None):
    """Store units losslessly. labeler(unit)->(label,importance) optional (e.g. Laya)."""
    c=connect(path); n=0
    for u in units:
        files,ticks=entities(u['text']); lab,imp=('',1)
        if labeler: lab,imp=labeler(u)
        raw=zlib.compress(u['text'].encode(),6)
        cur=c.execute('INSERT INTO unit(session,seq,ts,kind,importance,label,title,files,concepts,nbytes,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            (session,u['seq'],u.get('ts',''),u['kind'],imp,lab,title_of(u),' '.join(files),' '.join(ticks),len(u['text']),raw))
        body=u['text'][:6000]
        c.execute('INSERT INTO unit_fts(rowid,title,body,files,concepts) VALUES(?,?,?,?,?)',(cur.lastrowid,title_of(u),body,' '.join(files),' '.join(ticks)))
        for i,ps in enumerate(passages(u['text'])):
            pc=c.execute('INSERT INTO passage(session,seq,kind,idx,text) VALUES(?,?,?,?,?)',(session,u['seq'],u['kind'],i,ps))
            c.execute('INSERT INTO passage_fts(rowid,text) VALUES(?,?)',(pc.lastrowid,ps))
        n+=1
    c.commit(); return n

def _fts_query(q):
    toks=re.findall(r'[A-Za-z0-9_][A-Za-z0-9_.\-/]*',q)
    toks=[t.replace('"','') for t in toks if len(t)>1]
    return ' OR '.join(f'"{t}"' for t in dict.fromkeys(toks)) or '""'

def search(q,k=5,session=None,kinds=None,path=None,snip=220):
    c=connect(path); w=''; a=[_fts_query(q)]
    if session: w+=' AND u.session=?'; a.append(session)
    if kinds: w+=' AND u.kind IN (%s)'%','.join('?'*len(kinds)); a+=list(kinds)
    rows=c.execute(f'''SELECT u.id,u.seq,u.kind,u.title,u.nbytes,bm25(unit_fts,5.0,1.0,2.0,3.0) AS s FROM unit_fts JOIN unit u ON u.id=unit_fts.rowid
        WHERE unit_fts MATCH ?{w} ORDER BY s LIMIT ?''',a+[k]).fetchall()
    return [dict(r) for r in rows]

def raw(uid,path=None,maxc=None):
    r=connect(path).execute('SELECT raw,kind,seq FROM unit WHERE id=?',(uid,)).fetchone()
    if not r: return None
    t=zlib.decompress(r['raw']).decode(); return t[:maxc] if maxc else t

def stats(path=None,session=None):
    c=connect(path); q='SELECT kind,count(*) n,sum(nbytes) b FROM unit'+(' WHERE session=?' if session else '')+' GROUP BY kind'
    return [dict(r) for r in c.execute(q,(session,) if session else ())]

def search_passages(q,k=6,session=None,path=None,kinds=None):
    c=connect(path); w=''; a=[_fts_query(q)]
    if session: w+=' AND p.session=?'; a.append(session)
    if kinds: w+=' AND p.kind IN (%s)'%','.join('?'*len(kinds)); a+=list(kinds)
    rows=c.execute(f"""SELECT p.seq,p.kind,p.idx,p.text,bm25(passage_fts) AS s FROM passage_fts JOIN passage p ON p.id=passage_fts.rowid
        WHERE passage_fts MATCH ?{w} ORDER BY s LIMIT ?""",a+[k]).fetchall()
    return [dict(r) for r in rows]

def meta_get(session,key,default=None,path=None):
    r=connect(path).execute('SELECT value FROM meta WHERE session=? AND key=?',(session,key)).fetchone(); return r['value'] if r else default
def meta_set(session,key,value,path=None):
    c=connect(path); c.execute('INSERT OR REPLACE INTO meta VALUES(?,?,?)',(session,key,str(value))); c.commit()
