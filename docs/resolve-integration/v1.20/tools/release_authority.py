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
    return errors+registration_errors(p.read_text())

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
