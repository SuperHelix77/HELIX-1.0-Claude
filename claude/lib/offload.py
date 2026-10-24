"""Lossless Bash output offload for PostToolUse. Pure policy: shrink() never touches the host.
Large output -> exact bytes archived (sha256-verified), model sees head + salient lines + tail + exact recovery command.
Repeat of an output already shown in this context epoch -> short reference. Anything unexpected -> None (pass through)."""
import os,re,json,hashlib,tempfile
T_DEFAULT=4000; T_RANGE=int(__import__("os").environ.get("HELIX_T_RANGE","12000"))                    # chars of stdout+stderr before offload
HEAD=1500; TAIL=1000; SALIENT=1000; KEEP_ERR=1000
T_DEDUP=1000                                      # min chars for repeat references
RANGE=re.compile(r"(?:^|[;&|(]\s*|\s)(?:sed\s+-n|head|tail|cat|nl|less|git\s+(?:show|diff|log\s+-p))\b")
OPTOUT=re.compile(r'HELIX_RAW=1|#\s*helix:full')
SAL=re.compile(r'(?i)\b(error|fail(ed|ure|s)?|traceback|exception|assert|panic|fatal|warn(ing)?|denied|not found|✗|✖)\b|^\s*(FAIL|ERROR|E\s)|^not ok')
def sha(s): return hashlib.sha256(s.encode('utf-8','surrogatepass')).hexdigest()
def archive(text,root,ext):
    """write exact bytes once, verify by re-read; returns path or None"""
    h=sha(text); os.makedirs(root,exist_ok=True); p=os.path.join(root,h[:16]+ext)
    b=text.encode('utf-8','surrogatepass')
    if not (os.path.exists(p) and hashlib.sha256(open(p,'rb').read()).hexdigest()==h):
        fd,tmp=tempfile.mkstemp(dir=root); 
        with os.fdopen(fd,'wb') as f: f.write(b)
        os.replace(tmp,p)
    return p if hashlib.sha256(open(p,'rb').read()).hexdigest()==h else None
def _take(lines,budget,rev=False):
    out=[];n=0
    for ln in (reversed(lines) if rev else lines):
        if n+len(ln)+1>budget and out: break
        out.append(ln); n+=len(ln)+1
        if n>=budget: break
    return out[::-1] if rev else out
def preview(text,path,label):
    lines=text.split('\n'); N=len(lines)
    head=_take(lines,HEAD); tail=_take(lines[len(head):],TAIL,rev=True)
    a=len(head)+1; b=N-len(tail)                  # elided 1-based inclusive range
    if b<a: return None
    if len(head[-1])>HEAD: head[-1]=head[-1][:HEAD]+'…'   # single giant line: still bounded
    if tail and len(tail[0])>TAIL: tail[0]='…'+tail[0][-TAIL:]
    sal=[];n=0
    for i in range(a-1,b):
        if SAL.search(lines[i]):
            s=f' {i+1}: {lines[i][:240]}'
            if n+len(s)>SALIENT: break
            sal.append(s); n+=len(s)+1
    elided=sum(len(lines[i])+1 for i in range(a-1,b))
    tip=f"sed -n '{a},{b}p' {path}"
    mid=[f"[helix offload {label}: lines {a}-{b} of {N} elided ({elided} chars), exact bytes kept. Read: {tip} | grep -n PATTERN {path}]"]
    if sal: mid+=['[salient elided lines]']+sal
    return '\n'.join(head+mid+tail)
def shrink(cmd,stdout,stderr,root,seen=None,limit=None,label='stdout'):
    """-> (new_stdout,new_stderr,record) or None. seen: set of sha of outputs already in this context epoch (mutated).
    limit overrides the command-derived threshold; label names the stream in the preview marker."""
    stdout=stdout or ''; stderr=stderr or ''
    if OPTOUT.search(cmd or ''): return None
    if root in (cmd or '') or '.claude-lean/offload' in (cmd or ''): return None
    total=len(stdout)+len(stderr)
    key=sha(stdout+'\x00'+stderr)
    if seen is not None and total>=T_DEDUP and key in seen:
        p=archive(stdout,root,'.out') if stdout else None
        if stdout and not p: return None
        note=f"[helix: output identical to an earlier output in this context ({total} chars, sha {key[:12]}); exact bytes: {p or '(stderr only)'}]"
        rec={'kind':'repeat','chars':total,'kept':len(note),'sha':key,'path':p}
        return (note,'',rec) if stdout else ('',note,rec)
    if seen is not None and total>=T_DEDUP: seen.add(key)
    limit=limit or (T_RANGE if RANGE.search(cmd or '') else T_DEFAULT)
    if total<=limit: return None
    rec={'kind':'offload','chars':total,'range':limit==T_RANGE,'sha':key}
    new_out,new_err=stdout,stderr
    if len(stdout)>limit-min(len(stderr),KEEP_ERR) and len(stdout)>HEAD+TAIL+600:
        p=archive(stdout,root,'.out')
        if not p: return None
        pv=preview(stdout,p,label)
        if pv is None or len(pv)>=len(stdout): return None
        new_out=pv; rec['out']=p
    if len(stderr)>KEEP_ERR+HEAD+TAIL:
        p=archive(stderr,root,'.err')
        if p:
            pv=preview(stderr,p,'stderr')
            if pv and len(pv)<len(stderr): new_err=pv; rec['err']=p
    if new_out is stdout and new_err is stderr: return None
    rec['kept']=len(new_out)+len(new_err)
    return new_out,new_err,rec
