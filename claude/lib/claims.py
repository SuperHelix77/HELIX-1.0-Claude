"""Helix claim ledger: typed, hash-bound, supersession-aware experiment/decision records.

Record (JSON-compatible):
  {"type":"experiment_result","claim":str,"status":"CONFIRMED|FALSIFIED|OPEN","scope":str,
   "evidence":["unit:#N"|"report:..."],"files":[paths],"code_hash":str,"supersedes":id|null}
Derived (never stored as truth), effective status:
  SUPERSEDED  a newer claim names this one in `supersedes`
  STALE       bound files changed since the claim (code_hash mismatch) or are missing
Falsified claims are kept and surfaced: they stop the agent from re-running dead ends.
"""
import os,sys,json,hashlib,time,re,sqlite3
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import hmem

STATUSES=('CONFIRMED','FALSIFIED','OPEN')
import ast as _ast
def dep_hash(spec,root='.'):
    """spec: symbol://path#name | file://path | bench://path | config://path. Hash of exactly what the claim depends on; None if unknown."""
    kind,_,rest=spec.partition('://')
    if kind=='symbol':
        path,_,name=rest.partition('#')
        try:
            src=open(os.path.join(root,path)).read(); t=_ast.parse(src)
            for n in _ast.walk(t):
                if isinstance(n,(_ast.FunctionDef,_ast.AsyncFunctionDef,_ast.ClassDef)) and n.name==name:
                    seg=_ast.get_source_segment(src,n) or ''; return hashlib.sha256(_ast.dump(n,include_attributes=False).encode()).hexdigest()[:12]   # formatting/comments don't invalidate
        except Exception: pass
        return 'missing'
    if kind in('file','bench','config'):
        try: return hashlib.sha256(open(os.path.join(root,rest),'rb').read()).hexdigest()[:12]
        except OSError: return 'missing'
    return 'unknown'
TYPES=('experiment_result','decision','constraint','measurement')

def _init(c):
    try: c.execute('ALTER TABLE claim ADD COLUMN deps TEXT')
    except Exception: pass
    try: c.executescript('''
    CREATE TABLE IF NOT EXISTS claim(id TEXT PRIMARY KEY, ts REAL, session TEXT, type TEXT, claim TEXT, status TEXT, scope TEXT,
        evidence TEXT, files TEXT, code_hash TEXT, supersedes TEXT, deps TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS claim_fts USING fts5(id UNINDEXED, claim, scope, tokenize="unicode61 remove_diacritics 2 tokenchars '_'");
    ''')
    except sqlite3.OperationalError: pass

def file_hash(paths,root='.'):
    """order-independent digest of the current contents of `paths`; None if no files bound."""
    if not paths: return None
    h=hashlib.sha256()
    for p in sorted(paths):
        fp=os.path.join(root,p)
        try: d=hashlib.sha256(open(fp,'rb').read()).hexdigest()
        except OSError: d='missing'
        h.update(f'{p}:{d}\n'.encode())
    return h.hexdigest()[:16]

def claim_id(claim,scope): return hashlib.sha256(f'{scope}\n{claim}'.encode()).hexdigest()[:12]

def add(claim,status,scope='',evidence=(),files=(),supersedes=None,type='experiment_result',session='s0',root='.',path=None,code_hash='auto',deps=()):
    if status not in STATUSES: raise ValueError(f'status must be one of {STATUSES}')
    if type not in TYPES: raise ValueError(f'type must be one of {TYPES}')
    if not claim.strip(): raise ValueError('empty claim')
    c=hmem.connect(path); _init(c)
    if supersedes and not c.execute('SELECT 1 FROM claim WHERE id=?',(supersedes,)).fetchone(): raise ValueError(f'unknown supersedes id {supersedes}')
    cid=claim_id(claim,scope); ch=file_hash(list(files),root) if code_hash=='auto' else code_hash
    dj=json.dumps({d:dep_hash(d,root) for d in deps}) if deps else None
    c.execute('INSERT OR REPLACE INTO claim(id,ts,session,type,claim,status,scope,evidence,files,code_hash,supersedes,deps) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(cid,time.time(),session,type,claim,status,scope,json.dumps(list(evidence)),json.dumps(list(files)),ch,supersedes,dj))
    c.execute('DELETE FROM claim_fts WHERE id=?',(cid,)); c.execute('INSERT INTO claim_fts(id,claim,scope) VALUES(?,?,?)',(cid,claim,scope))
    c.commit(); return cid

def _row(r,root='.',superseded=()):
    d=dict(r); d['evidence']=json.loads(d['evidence'] or '[]'); d['files']=json.loads(d['files'] or '[]')
    eff=d['status']; d['deps']=json.loads(d.get('deps') or 'null') or {}; d['changed_deps']=[]
    if d['id'] in superseded: eff='SUPERSEDED'
    elif d['deps']:   # dependency-driven: only changes to what the claim depends on invalidate it
        d['changed_deps']=[k for k,h in d['deps'].items() if dep_hash(k,root)!=h]
        if d['changed_deps']: eff='STALE'
    elif d['files'] and d['code_hash'] and file_hash(d['files'],root)!=d['code_hash']: eff='STALE'
    d['effective']=eff; d['superseded_by']=superseded.get(d['id']); return d

def all_claims(root='.',path=None,session=None):
    c=hmem.connect(path); _init(c)
    try: rows=c.execute('SELECT * FROM claim'+(' WHERE session=?' if session else '')+' ORDER BY ts',(session,) if session else ()).fetchall()
    except sqlite3.OperationalError: return []      # no ledger in this DB (and it is read-only)
    sup={r['supersedes']:r['id'] for r in rows if r['supersedes']}
    return [_row(r,root,sup) for r in rows]

def current(root='.',path=None,session=None,include_stale=True):
    out=[d for d in all_claims(root,path,session) if d['effective']!='SUPERSEDED']
    return out if include_stale else [d for d in out if d['effective']!='STALE']

def search(q,k=5,root='.',path=None):
    c=hmem.connect(path); _init(c)
    toks=[t for t in re.findall(r'[A-Za-z0-9_][A-Za-z0-9_.\-/]*',q) if len(t)>1]
    if not toks: return []
    m=' OR '.join(f'"{t}"' for t in dict.fromkeys(toks))
    try: ids=[r[0] for r in c.execute('SELECT id FROM claim_fts WHERE claim_fts MATCH ? ORDER BY bm25(claim_fts) LIMIT ?',(m,k)).fetchall()]
    except sqlite3.OperationalError: return []
    by={d['id']:d for d in all_claims(root,path)}; return [by[i] for i in ids if i in by]

def fmt(d,evcap=3):
    ev=','.join(d['evidence'][:evcap]); f=','.join(os.path.basename(x) for x in d['files'][:3])
    return f"[{d['effective']}] {d['claim']}"+(f" | scope: {d['scope']}" if d['scope'] else '')+(f" | ev: {ev}" if ev else '')+(f" | files: {f}" if f else '')+f" | id:{d['id']}"

def short(d):
    """HOT index form: C<id6>:<S|F|A|O|X> <slug> (~10-30 tokens). F=FALSIFIED A=CONFIRMED(active) O=OPEN S=SUPERSEDED X=STALE"""
    code={'FALSIFIED':'F','CONFIRMED':'A','OPEN':'O'}
    eff=d['effective']; c='S' if eff=='SUPERSEDED' else ('X' if eff=='STALE' else code.get(d['status'],'?'))
    slug=re.sub(r'[^A-Za-z0-9]+','_',d['claim'])[:44].strip('_')
    return f"C{d['id'][:6]}:{c} {slug}"

def card(d):
    """CLAIM CARD: full record, retrieved on demand (50-150 tokens)"""
    lines=[f"C{d['id'][:6]} [{d['effective']}] {d['claim']}"]
    if d['scope']: lines.append(f"  scope: {d['scope']}")
    if d['evidence']: lines.append('  evidence: '+', '.join(d['evidence']))
    if d['files']: lines.append(f"  bound: {', '.join(d['files'])} @{d['code_hash']}")
    if d.get('supersedes'): lines.append(f"  supersedes: C{d['supersedes'][:6]}")
    if d.get('superseded_by'): lines.append(f"  superseded_by: C{d['superseded_by'][:6]}")
    if d.get('deps'): lines.append('  depends: '+', '.join(d['deps'])+(f"  CHANGED: {', '.join(d['changed_deps'])}" if d.get('changed_deps') else ''))
    return '\n'.join(lines)

def find(prefix,root='.',path=None):
    p=prefix.lstrip('Cc')
    m=[d for d in all_claims(root,path) if d['id'].startswith(p)]
    return m[0] if len(m)==1 else None

def as_record(d):
    """the user-facing JSON shape"""
    return {'type':d['type'],'claim':d['claim'],'status':d['status'],'scope':d['scope'],'evidence':d['evidence'],'files':d['files'],'code_hash':d['code_hash'],'supersedes':d['supersedes']}
