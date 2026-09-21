"""Release-only coherence checks; never imported by operational authority paths."""
import hashlib
import json
import pathlib
import re

VERSION = '1.20.0'
PARENT_HEAD = '5efbcae6a36b76d4a359f3e65e503336576575c7'
PARENT_MANIFEST = '06811f07b422d1cdf30ae6c076bae2bc0b598fc3ac464a0e180a8553a76a2848'
MARKER = re.compile(r'<!-- resolve-current-selector\s+(\{[^\n]+\})\s*-->')
CUES = r'(?:current(?: authority| version| bundle)?|active (?:authority|version)|controlling authority|authoritative version)'

def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

def registration_errors(text, version=VERSION):
    errors=[]; wanted='v'+'.'.join(version.split('.')[:2]); matches=MARKER.findall(text)
    if len(matches)!=1:return ['CURRENT_SELECTOR_CARDINALITY']
    try: sel=json.loads(matches[0])
    except (ValueError,TypeError):return ['CURRENT_SELECTOR_INVALID']
    expected={'version':version,'status':'CURRENT','branch':'docs/resolve-authority-freeze-'+wanted,
              'parent':PARENT_HEAD,'manifest':'docs/resolve-integration/'+wanted+'/FREEZE-MANIFEST.json'}
    if sel!=expected:errors.append('CURRENT_SELECTOR_COHERENCE')
    rows=[]
    for line in text.splitlines():
        m=re.match(r'^\|\s*(1\.\d+\.0)\s*\|',line)
        if m:
            cols=line.split('|');state=cols[4].strip().upper();rows.append((m[1],state))
    current=[v for v,s in rows if re.match(r'^(?:\*\*)?CURRENT\b',s)]
    if current != [version]:errors.append('CURRENT_TABLE_CARDINALITY_OR_VERSION')
    if len({v for v,s in rows})!=len(rows):errors.append('DUPLICATE_VERSION_ROW')
    for v,s in rows:
        if v==version and re.search(r'\b(?:HISTORICAL|REJECTED|SUPERSEDED)\b',s):errors.append('CURRENT_STATUS_CONTRADICTION')
        if v!=version and not re.search(r'\b(?:HISTORICAL|REJECTED|SUPERSEDED)\b',s):errors.append('HISTORY_STATUS_MISSING')
    if {v for v,s in rows}!={'1.'+str(i)+'.0' for i in range(21)}:errors.append('VERSION_UNIVERSE')
    if f'**{wanted} registration** (current):' not in text:errors.append('CANDIDATE_REGISTRATION_MISSING')
    # Registered historical rows/blocks may quote history; ordinary normative prose may not select old versions.
    for line in text.splitlines():
        if MARKER.search(line):continue
        if re.match(r'^\|\s*1\.\d+\.0\s*\|',line):continue
        if re.match(r'^\*\*v1\.\d+ registration\*\* \(historical',line,re.I):continue
        for m in re.finditer(r'v1\.\d+(?:\.0)?',line):
            v=m[0];before=line[max(0,m.start()-95):m.start()];after=line[m.end():m.end()+95]
            selected=(re.search(CUES+r'[^.;|]*$',before,re.I) or
                      re.match(r'\s+(?:is |remains |as )?(?:the )?'+CUES,after,re.I) or
                      re.match(r'/(?:FREEZE-MANIFEST\.json|tools/\w+\.py)`?\s*\(current',after,re.I))
            # A direct historical inventory list is not a current selector.
            if selected and v not in (wanted,wanted+'.0'):errors.append('STALE_CURRENT_PROSE:'+v)
    return sorted(set(errors))

def external_errors(bundle, manifest=None):
    b=pathlib.Path(bundle);m=manifest or json.loads((b/'FREEZE-MANIFEST.json').read_text())
    p=b.parent.parent/'DOC-AUTHORITY.md';pin=m.get('external_pins',{}).get('doc_authority',{})
    errors=[]
    if pin.get('path')!='../../DOC-AUTHORITY.md':errors.append('EXTERNAL_DOC_PATH')
    if pin.get('sha256')!=sha(p):errors.append('EXTERNAL_DOC_SHA256')
    if pin.get('bytes')!=p.stat().st_size:errors.append('EXTERNAL_DOC_SIZE')
    if m.get('version')!=VERSION or m.get('bundle')!='docs/resolve-integration/v1.20':errors.append('MANIFEST_CURRENT_VERSION')
    if m.get('parent',{}).get('head')!=PARENT_HEAD or m.get('parent',{}).get('manifest_sha256')!=PARENT_MANIFEST:errors.append('MANIFEST_PARENT_PIN')
    # v1.20 repair: every external pin (path, sha256, bytes) and the manifest's own version statements (F-120-01, F-120-02)
    return sorted(set(errors+pin_errors(b,m)+version_coherence_errors(b,m,doc_text=p.read_text(),manifest_only=True)+registration_errors(p.read_text())))

PARENT_DIR = 'v1.19'
PARENT_PIN_KEY = 'v1_19_parent_manifest'
PARENT_FINDING_IDS = ('V118-M1', 'V118-M2', 'V118-M3', 'V118-M4', 'V118-N1', 'V118-N2', 'V118-N3')
MATRIX_PREFIX = 'FINDING-RESOLUTION-MATRIX-'
NO_SCHEMA_PREFIX = 'NO_REGISTERED_SCHEMA:'
RULE_VERSION_RE = re.compile(r'authority version (1\.\d+\.0)')
VERSIONED_RECORDS = (('TARGET-CONTRACT.json', 'version'), ('AUTHORITY-PRECEDENCE.json', 'version'),
                     ('AUTHORITY-DOCUMENT-UNIVERSE.json', 'authority_version'), ('AUTHORITY-REFERENCE-METADATA.json', 'authority_version'),
                     ('AUTHORITY-SLOT-INVENTORY.json', 'authority_version'), ('SCHEMA-REGISTRY.json', 'authority_version'),
                     ('REQUIRED-VALIDATION-CHECKS.json', 'authority_version'), ('PHASE1-SOURCE-PIN.json', 'authority_version'),
                     ('PHASE1-QUALIFICATION-RECORD.json', 'authority_version'), (MATRIX_PREFIX + 'v1.20.json', 'authority_version'))


def pin_errors(bundle, manifest=None):
    """v1.20 repair, F-120-01. Every external pin must name a file that exists, whose sha256 AND byte count both match;
    the parent pin must name ../v1.19/FREEZE-MANIFEST.json with the accepted digest; every ancestor manifest digest and the
    parent digest must be pinned. A pin whose byte count was read from another file (the frozen e65ed5a4 defect) fails."""
    b=pathlib.Path(bundle);m=manifest or json.loads((b/'FREEZE-MANIFEST.json').read_text());pins=m.get('external_pins');errors=[]
    if not isinstance(pins,dict) or not pins:return ['EXTERNAL_PINS_MISSING']
    for key,pin in sorted(pins.items()):
        if not isinstance(pin,dict) or set(pin)!={'path','sha256','bytes'}:errors.append('EXTERNAL_PIN_SHAPE:'+key);continue
        if not isinstance(pin['path'],str) or pin['path'].startswith('/') or not pin['path']:errors.append('EXTERNAL_PIN_PATH:'+key);continue
        p=b/pin['path']
        if not p.is_file():errors.append('EXTERNAL_PIN_ABSENT:'+key);continue
        if pin['sha256']!=sha(p):errors.append('EXTERNAL_PIN_SHA256:'+key)
        if pin['bytes']!=p.stat().st_size:errors.append('EXTERNAL_PIN_SIZE:'+key)
    parent=pins.get(PARENT_PIN_KEY)
    if not isinstance(parent,dict) or parent.get('path')!='../'+PARENT_DIR+'/FREEZE-MANIFEST.json' or parent.get('sha256')!=PARENT_MANIFEST:errors.append('PARENT_PIN_IDENTITY')
    pinned={v.get('sha256') for k,v in pins.items() if isinstance(v,dict) and k!='doc_authority'}
    par=m.get('parent') or {}
    if par.get('manifest_sha256') not in pinned:errors.append('PARENT_UNPINNED')
    for a in par.get('ancestors') or []:
        if a.get('manifest_sha256') not in pinned:errors.append('ANCESTOR_UNPINNED:'+str(a.get('version')))
    return sorted(set(errors))


def version_coherence_errors(bundle, manifest=None, doc_text=None, overrides=None, manifest_only=False, version=VERSION):
    """v1.20 repair, F-120-02. One authority version, everywhere it is stated: manifest version, the manifest rule that binds
    records (exactly one 'authority version X' phrase, X = the current version), the DOC-AUTHORITY current selector,
    TARGET-CONTRACT (version and the verifier source), MILESTONES and every release-metadata record. `overrides` maps a
    file name to a replacement document for negative tests; `manifest_only` checks only the manifest (used by the build)."""
    b=pathlib.Path(bundle);m=manifest or json.loads((b/'FREEZE-MANIFEST.json').read_text());ov=overrides or {};v=version;errors=[]
    if m.get('version')!=v:errors.append('MANIFEST_VERSION')
    hits=[x for r in (m.get('rules') or []) if isinstance(r,str) for x in RULE_VERSION_RE.findall(r)]
    if hits!=[v]:errors.append('MANIFEST_RULE_VERSION:'+(','.join(hits) or 'none'))
    if manifest_only:return sorted(set(errors))
    def doc(name):
        if name in ov:return ov[name]
        p=b/name
        return json.loads(p.read_text()) if p.is_file() else None
    for name,key in VERSIONED_RECORDS:
        d=doc(name)
        if d is None:errors.append('VERSION_DOCUMENT_ABSENT:'+name);continue
        if d.get(key)!=v:errors.append('VERSION_MISMATCH:'+name)
    tc=doc('TARGET-CONTRACT.json')
    try:
        if not tc['required_future_observations'][2]['source'].endswith('FREEZE-MANIFEST.json '+v):errors.append('TARGET_CONTRACT_SOURCE_VERSION')
    except (KeyError,IndexError,TypeError):errors.append('TARGET_CONTRACT_SOURCE_VERSION')
    ms=ov.get('MILESTONES.md') if 'MILESTONES.md' in ov else ((b/'MILESTONES.md').read_text() if (b/'MILESTONES.md').is_file() else '')
    found=set(re.findall(r'authority (1\.\d+\.0)',ms))
    if found!={v}:errors.append('MILESTONES_VERSION:'+(','.join(sorted(found)) or 'none'))
    text=doc_text if doc_text is not None else (b.parent.parent/'DOC-AUTHORITY.md').read_text()
    sel=MARKER.findall(text)
    try:
        if len(sel)!=1 or json.loads(sel[0]).get('version')!=v:errors.append('DOC_AUTHORITY_SELECTOR_VERSION')
    except (ValueError,TypeError):errors.append('DOC_AUTHORITY_SELECTOR_VERSION')
    return sorted(set(errors))


def inherited_matrix_errors(bundle, active=None, overrides=None, parent_dir=None, version=VERSION):
    """v1.20 repair, F-120-03. Every matrix the active matrix inherits must be the accepted parent's frozen copy, equal in
    every field except the authority_version stamp (which must be the current version), and the parent's own matrix must
    still enumerate exactly the accepted parent findings. Regenerating an inherited matrix from a stale literal fails."""
    b=pathlib.Path(bundle);pb=pathlib.Path(parent_dir) if parent_dir else b.parent/PARENT_DIR;ov=overrides or {};errors=[]
    act=active or json.loads((b/(MATRIX_PREFIX+'v1.20.json')).read_text());names=act.get('inherited_matrices') or []
    if not names:errors.append('NO_INHERITED_MATRICES')
    pm=json.loads((pb/'FREEZE-MANIFEST.json').read_text());pf={e['path']:e for e in pm['files']}
    def cur(name):
        if name in ov:return ov[name]
        p=b/name
        return json.loads(p.read_text()) if p.is_file() else None
    for name in names:
        c=cur(name)
        if c is None:errors.append('INHERITED_MATRIX_ABSENT:'+name);continue
        q=pb/name
        if name not in pf or not q.is_file():errors.append('INHERITED_MATRIX_NOT_IN_PARENT:'+name);continue
        if sha(q)!=pf[name]['sha256'] or q.stat().st_size!=pf[name]['bytes']:errors.append('PARENT_MATRIX_TAMPERED:'+name);continue
        par=json.loads(q.read_text())
        if c.get('authority_version')!=version:errors.append('INHERITED_MATRIX_VERSION:'+name)
        if {k:x for k,x in c.items() if k!='authority_version'}!={k:x for k,x in par.items() if k!='authority_version'}:errors.append('INHERITED_MATRIX_CONTENT:'+name)
    pname=MATRIX_PREFIX+PARENT_DIR+'.json'
    if pname not in names:errors.append('PARENT_MATRIX_NOT_INHERITED')
    else:
        c=cur(pname);ids=sorted(f.get('id') for f in (c or {}).get('findings') or [])
        if ids!=sorted(PARENT_FINDING_IDS):errors.append('PARENT_FINDINGS_CHANGED:'+','.join(sorted(set(PARENT_FINDING_IDS)^set(ids))))
    return sorted(set(errors))



def registered_json_errors(bundle, manifest=None, schema_errors=None, overrides=None):
    """v1.20 repair, F-120-05. Every top-level JSON member (and the manifest itself) either validates against the schema its
    `schema` field names in SCHEMA-REGISTRY.json, or the manifest entry carries an explicit governed reason
    (qualification_note starting NO_REGISTERED_SCHEMA:). Nothing is silently schema-invalid and nothing is silently
    unschematized. `schema_errors(name, doc)` is the authority's own registry-bound validator."""
    b=pathlib.Path(bundle);m=manifest or json.loads((b/'FREEZE-MANIFEST.json').read_text());ov=overrides or {};errors=[]
    if schema_errors is None:
        import authority_lib as _L
        schema_errors=_L.internal_schema_errors
    reg=json.loads((b/'SCHEMA-REGISTRY.json').read_text());ids={}
    for name,e in reg['schemas'].items():ids[json.loads((b/e['path']).read_text()).get('$id')]=name
    notes={e['path']:e.get('qualification_note','') for e in m['files']}
    members={p.name:None for p in sorted(b.glob('*.json')) if p.name!='FREEZE-MANIFEST.json'};members.update(ov)
    for name in sorted(members):
        d=members[name] if members[name] is not None else json.loads((b/name).read_text())
        sid=d.get('schema') if isinstance(d,dict) else None;reg_name=ids.get(sid);note=notes.get(name,'')
        if reg_name is None:
            if not note.startswith(NO_SCHEMA_PREFIX):errors.append('UNREGISTERED_SCHEMA_WITHOUT_REASON:'+name)
            continue
        if note.startswith(NO_SCHEMA_PREFIX):errors.append('REASON_CONTRADICTS_REGISTRATION:'+name)
        errs=schema_errors(reg_name,d)
        if errs:errors.append('SCHEMA_INVALID:'+name+':'+str(errs[0])[:80])
    merrs=schema_errors(ids.get(m.get('schema')),m) if ids.get(m.get('schema')) else ['SCHEMA_NOT_REGISTERED']
    if merrs:errors.append('SCHEMA_INVALID:FREEZE-MANIFEST.json:'+str(merrs[0])[:80])
    return errors


def git_tree_sha1(directory):
    """Recompute a git tree object id from bytes and modes on disk (no git needed). Skips __pycache__ and .pyc."""
    import os
    d=pathlib.Path(directory);entries=[]
    for name in sorted(os.listdir(d)):
        if name=='__pycache__':continue
        p=d/name
        if p.is_symlink():continue
        if p.is_dir():
            h=git_tree_sha1(p)
            if h:entries.append((name,b'40000',bytes.fromhex(h)))
        elif p.is_file() and p.suffix!='.pyc':
            data=p.read_bytes();mode=b'100755' if os.access(p,os.X_OK) else b'100644'
            entries.append((name,mode,hashlib.sha1(b'blob %d\0'%len(data)+data).digest()))
    if not entries:return None
    entries.sort(key=lambda e:(e[0]+'/') if e[1]==b'40000' else e[0])
    body=b''.join(mode+b' '+name.encode()+b'\0'+h for name,mode,h in entries)
    return hashlib.sha1(b'tree %d\0'%len(body)+body).hexdigest()


def phase1_pin_errors(bundle, repo_root=None, pin=None):
    """v1.20 repair, F-120-06. resolve-control/** on disk must equal PHASE1-SOURCE-PIN.json: same file set, every sha256
    and byte count, the pinned file count, the worker digest and the git tree id. Fail-closed when the source is absent."""
    b=pathlib.Path(bundle);root=pathlib.Path(repo_root) if repo_root else b.parent.parent.parent
    pin=pin or json.loads((b/'PHASE1-SOURCE-PIN.json').read_text());errors=[];src=root/'resolve-control'
    if not src.is_dir():return ['PHASE1_SOURCE_ABSENT']
    files={f['path']:f for f in pin.get('files') or []}
    disk={str(p.relative_to(root)):p for p in sorted(src.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc'}
    if set(disk)!=set(files):errors.append('PHASE1_FILE_SET:'+','.join(sorted(set(disk)^set(files))))
    for rel,f in sorted(files.items()):
        p=disk.get(rel)
        if p is None:continue
        if sha(p)!=f.get('sha256'):errors.append('PHASE1_SHA256:'+rel)
        if p.stat().st_size!=f.get('bytes'):errors.append('PHASE1_SIZE:'+rel)
    if pin.get('file_count')!=len(files):errors.append('PHASE1_FILE_COUNT')
    w=files.get('resolve-control/worker/resolve_worker.py')
    if not w or w.get('sha256')!=pin.get('worker_sha256'):errors.append('PHASE1_WORKER_SHA256')
    if not str(pin.get('implementation_commit_full','')).startswith(str(pin.get('implementation_commit','?'))):errors.append('PHASE1_COMMIT_PREFIX')
    if git_tree_sha1(src)!=pin.get('git_tree_sha1_resolve_control'):errors.append('PHASE1_TREE_SHA1')
    return sorted(set(errors))


def expected_documents(bundle):
    """Independently frozen parent universe plus explicit successor tooling artifacts.
    Directory membership is checked separately; registration cannot shrink its own oracle."""
    b=pathlib.Path(bundle);parent=json.loads((b.parent/'v1.19/AUTHORITY-PRECEDENCE.json').read_text())
    expected={e['path']:(e['status'],e['role']) for e in parent['documents']}
    for name in expected:
        if name in ['CHANGELOG-v1.19.md','FINDING-RESOLUTION-MATRIX-v1.19.md','FINDING-RESOLUTION-MATRIX-v1.19.json']:
            expected[name]=('HISTORICAL','HISTORICAL_INPUT')
    for name in ['CHANGELOG-v1.20.md','FINDING-RESOLUTION-MATRIX-v1.20.md','FINDING-RESOLUTION-MATRIX-v1.20.json']:
        expected[name]=('STILL_ACTIVE','CORRECTION_RECORD')
    for name in ['CONTROL-PLANE.md','KNOWN-LIMITATIONS-PHASE1.md','LINEAGE.md','PHASE1-SOURCE-PIN.json','PHASE1-QUALIFICATION-RECORD.json']:
        expected[name]=('STILL_ACTIVE','NORMATIVE_AUTHORITY')
    for name in ['AUTHORITY-REFERENCE-METADATA.json','AUTHORITY-DOCUMENT-UNIVERSE.json','REQUIRED-VALIDATION-CHECKS.json','RELEASE-AUTHORITY.md']:
        expected[name]=('STILL_ACTIVE','NORMATIVE_AUTHORITY')
    for name in ['V117-REPRODUCTION.json','AUTHOR-REGRESSION-RESULTS.json']:
        expected[name]=('STILL_ACTIVE','GENERATED_EVIDENCE')
    return expected

def universe_errors(bundle):
    b=pathlib.Path(bundle);exp=expected_documents(b);p=json.loads((b/'AUTHORITY-PRECEDENCE.json').read_text());rows=p['documents'];got={e['path']:(e.get('status'),e.get('role')) for e in rows}
    errs=[]
    if len(got)!=len(rows):errs.append('DUPLICATE_DOCUMENT_REGISTRATION')
    disk={f.name for f in b.iterdir() if f.is_file() and f.suffix in ('.md','.json')}
    expected_top={n for n in exp if '/' not in n}
    if disk!=expected_top:errs.append('DOCUMENT_DISK_UNIVERSE:'+str(sorted(disk^expected_top)))
    if got!=exp:errs.append('DOCUMENT_REGISTRATION_PARITY:'+str(sorted(k for k in set(got)|set(exp) if got.get(k)!=exp.get(k))))
    u=json.loads((b/'AUTHORITY-DOCUMENT-UNIVERSE.json').read_text())
    if u.get('documents')!=[{'path':k,'status':v[0],'role':v[1]} for k,v in sorted(exp.items())]:errs.append('PUBLISHED_UNIVERSE_PARITY')
    return errs

def required_errors(actual, required):
    if len(actual)!=len(set(actual)):return ['DUPLICATE_CHECK_ID']
    return [] if set(actual)==set(required) and len(required)==len(set(required)) else ['REQUIRED_CHECK_SET_MISMATCH']
