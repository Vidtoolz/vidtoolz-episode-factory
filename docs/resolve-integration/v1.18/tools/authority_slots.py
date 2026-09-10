"""Release tooling: independent inclusion, symbol extraction, and role classification.
No attachment, eligibility, evidence, or commit authority is implemented here.
"""
import hashlib
import json
import pathlib
import re
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import authority_lib as L
import release_authority as RELEASE
AUTHORITY_CLASS='INTERNAL_NON_AUTHORIZING'
ROLE_AUTHORIZING='AUTHORIZING_DESIGNATION'
ROLE_DIAGNOSTIC='DIAGNOSTIC_DECLARATION'
ROLE_HISTORICAL='HISTORICAL_STATEMENT'
ROLE_MENTION='MENTION'
ROLE_AMBIGUOUS='AMBIGUOUS_CURRENT_REFERENCE'
ROLES=(ROLE_AUTHORIZING,ROLE_DIAGNOSTIC,ROLE_HISTORICAL,ROLE_MENTION,ROLE_AMBIGUOUS)
CURRENT_ROLES=('NORMATIVE_AUTHORITY','CORRECTION_RECORD')
CLASS_TOKENS=('DIAGNOSTIC','diagnostic','NON_AUTHORIZING','non-authorizing','PROVISIONAL_UNTIL_M3')
# Vocabulary assists prose only. Unknown predicates fail ambiguous; metadata is primary for frozen machine fields.
AUTHORITY_TOKENS=('authoritative','authorizing','authority','refuses','refusal','refusing','decides','derived by','derives','evaluated by','enforces','governs','controls','determines','adjudicates','authorizes','blocks','permits','certifies','rejects','establishes','gates','validates','loader')
HISTORY_TOKENS=('formerly','historically','was then')
NEGATION_CUES=('no longer','not','never','cannot')
_CLAUSE_BREAKS='.;:,\n'

def function_pattern(names):
    return re.compile(r'(?<![\w])(?:[\w/]+(?:\.\w+)*[.#])?('+ '|'.join(re.escape(n) for n in sorted(names,key=len,reverse=True))+r')(?![\w])')

def normalize_reference(raw):
    s=raw.strip('`\'" ').split('(')[0]
    if '#' in s:
        head,name=s.rsplit('#',1);module=head.rsplit('/',1)[-1].removesuffix('.py');return module,name
    if '.' in s:
        head,name=s.rsplit('.',1);return head.removesuffix('.py'),name
    return None,s

def clauses(text):
    out=[];start=0;depth=0
    for i,ch in enumerate(text):
        if ch in '([{':depth+=1
        elif ch in ')]}':depth=max(0,depth-1)
        if ch in _CLAUSE_BREAKS and depth==0 and (i+1==len(text) or text[i+1].isspace()):
            if text[start:i].strip():out.append(text[start:i].strip())
            start=i+1
    if text[start:].strip():out.append(text[start:].strip())
    return out

def logical_lines(text):
    units=[];buf='';line_number=0
    def flush():
        nonlocal buf
        if buf:units.append((f'line {line_number}',buf));buf=''
    for n,line in enumerate(text.splitlines(),1):
        s=line.strip()
        if not s:flush();continue
        block=bool(re.match(r'^(?:\||#{1,6}\s|```|[-*+]\s|\d+\.\s|>)',s))
        if block:flush();line_number=n;buf=s
        elif buf:buf+=' '+s
        else:line_number=n;buf=s
    flush();return units

def _walk_json(node,keypath,out):
    if isinstance(node,dict):
        for k,v in node.items():_walk_json(v,keypath+(str(k),),out)
    elif isinstance(node,list):
        for i,v in enumerate(node):_walk_json(v,keypath+(f'[{i}]',),out)
    elif isinstance(node,str):out.append(('.'.join(keypath),node))

def artifact_scope(bundle_dir):
    b=pathlib.Path(bundle_dir);p=json.loads((b/'AUTHORITY-PRECEDENCE.json').read_text());roles={r['path']:r for r in p['documents']};scanned=[];skipped=[]
    for f in sorted(b.iterdir()):
        if not f.is_file() or f.suffix not in ('.md','.json'):continue
        r=roles.get(f.name,{});row={'artifact':f.name,'status':r.get('status','UNREGISTERED'),'role':r.get('role','UNKNOWN')}
        # Unknown entries stay visible and fail universe validation, never disappear silently.
        (scanned if not r or (r.get('status')=='STILL_ACTIVE' and r.get('role') in CURRENT_ROLES) else skipped).append(row)
    return scanned,skipped

def _is_earlier_era(v):
    try:return tuple(map(int,v.split('.')))<tuple(map(int,L.AUTHORITY_VERSION.split('.')))
    except (ValueError,AttributeError):return False

def keypath_role(artifact,keypath,prec_statements=None):
    # Only schema-defined canonical class arrays have class semantics; no arbitrary substring hints.
    if artifact=='AUTHORITY-FUNCTION-CLASSES.json':
        if re.match(r'^authorizing\.\[\d+\]$',keypath):return ROLE_AUTHORIZING
        if re.match(r'^(?:diagnostic_non_authorizing|provisional_until_m3_non_authorizing|internal_non_authorizing)\.\[\d+\]$',keypath):return ROLE_DIAGNOSTIC
    if artifact=='AUTHORITY-PRECEDENCE.json' and keypath.startswith('superseded_statements.'):
        m=re.search(r'\[(\d+)\]',keypath)
        if m and prec_statements and int(m[1])<len(prec_statements):
            row=prec_statements[int(m[1])]
            if row.get('status')=='SUPERSEDED' and _is_earlier_era(row.get('effective_version','')):return ROLE_HISTORICAL
    return None

def classify_reference(text,match,matches):
    """Predicate-local fallback; absence of a confident role is a validation error, not harmless MENTION."""
    idx=matches.index(match);left=text[(matches[idx-1].end() if idx else 0):match.start()]
    right=text[match.end():(matches[idx+1].start() if idx+1<len(matches) else len(text))]
    # A prefix immediately before the NEXT symbol belongs to that symbol.
    right=re.split(r'(?:[;,]|\band\b|\bthe\b)\s+(?:(?:bare|legacy)[- ]\w+\s+)?(?:diagnostic|provisional|non[-_]authorizing)\s*$',right,flags=re.I)[0]
    prefix=re.split(r'[.;:,]|\band\b',left)[-1].strip().strip('`\" ').lower();suffix=right.strip().lstrip('`\" ').lower()
    # Call arguments are data, not predicate language; strip a balanced leading argument list.
    if suffix.startswith('('):
        depth=0
        for i,ch in enumerate(suffix):
            if ch=='(':depth+=1
            elif ch==')':
                depth-=1
                if depth==0:suffix=suffix[i+1:].strip();break
    own=prefix+' '+suffix
    explicit_current=bool(re.search(r'\b(?:is|remains)\s+(?:the\s+)?(?:current\s+)?(?:authoritative|authorizing|authority)\b',suffix) )
    class_neg=bool(re.match(r'(?:is|remains)\s+(?:no longer\s+(?:merely\s+)?|not\s+)(?:diagnostic|provisional|non[-_]authorizing)',suffix))
    auth_neg=bool(re.match(r'(?:is|remains)\s+(?:no longer\s+|not\s+)(?:the\s+)?(?:authoritative|authorizing|authority|evaluator)',suffix))
    if class_neg:return ROLE_AUTHORIZING
    if auth_neg:return ROLE_DIAGNOSTIC
    predicate_authority=bool(re.match(r'(?:is\s+(?:the\s+)?(?:current\s+)?(?:authoritative|authorizing|authority)|refuses\b|decides\b|governs\b|controls\b|determines\b|adjudicates\b|authorizes\b|blocks\b|permits\b|certifies\b|rejects\b|establishes\b|enforces\b|gates\b|validates\b|derives\b)',suffix))
    predicate_authority |= bool(re.search(r'\brefuses\s+invalid\s+authority\b',suffix))
    own_class=bool(re.match(r'(?:is|remains|stays)\s+(?:the\s+)?(?:diagnostic|provisional|internal_non_authorizing|non[-_]authorizing)',suffix) or re.search(r'(?:diagnostic|provisional(?:_until_m3_non_authorizing)?|non[-_]authorizing)\s*$',prefix))
    historical=bool(re.match(r'(?:was|formerly|historically)\b',suffix) or re.search(r'\b(?:formerly|historically|historical rule was|in v1\.\d+ the old authority)\b',prefix))
    if historical and not explicit_current and not re.match(r'is\b',suffix):return ROLE_HISTORICAL
    if predicate_authority or explicit_current:return ROLE_AUTHORIZING
    if own_class:return ROLE_DIAGNOSTIC
    if re.search(r'\b(?:authorizing|authoritative|authority|refusal)\b',prefix) or re.search(r'\b(?:evaluated(?:\s+\w+){0,3}\s+by|derived by|computed by|only|must use)\s*$',prefix):return ROLE_AUTHORIZING
    if re.search(r'\b(?:diagnostic|non[-_/ ]authorizing|provisional_until_m3)\b',suffix) and not re.search(r'\b(?:and|but)\b',suffix):return ROLE_DIAGNOSTIC
    return ROLE_AMBIGUOUS

def classify_clause(clause):
    ms=list(function_pattern(L.CLASSIFIED_DECISION_FUNCTIONS).finditer(clause))
    if not ms:return ROLE_MENTION
    roles={classify_reference(clause,m,ms) for m in ms}
    return next(iter(roles)) if len(roles)==1 else ROLE_AMBIGUOUS

def scan_text(text,artifact='SYNTHETIC.json',location='law',module_context=None,structured=None,status='STILL_ACTIVE',document_role='NORMATIVE_AUTHORITY',key_role=None):
    rows=[];pat=function_pattern(L.CLASSIFIED_DECISION_FUNCTIONS);matches=list(pat.finditer(text));classes=L.authority_function_classes()
    for occurrence,m in enumerate(matches):
        module,fn=normalize_reference(m[0]);module=module or module_context
        foreign=module is not None and module!='authority_lib';role=classify_reference(text,m,matches);basis='PROSE'
        if foreign:role=ROLE_MENTION
        elif module is None:role=ROLE_AMBIGUOUS
        elif key_role:role=key_role;basis='KEY_PATH'
        spec=(structured or {}).get(str(occurrence))
        if spec:
            # Source-bound declarations must match this exact occurrence and independent extraction.
            expected={'module':module,'function':fn,'source_sha256':hashlib.sha256(text.encode()).hexdigest()}
            if any(spec.get(k)!=v for k,v in expected.items()):role=ROLE_AMBIGUOUS
            else:
                declared=spec.get('authority_role')
                # An explicit conflicting authority predicate cannot be erased by a non-authorizing annotation.
                if declared in (ROLE_DIAGNOSTIC,ROLE_HISTORICAL) and re.match(r"[` ]*(?:is (?:the )?(?:current )?(?:authoritative|authorizing|authority)|refuses invalid authority)\b", text[m.end():], re.I):role=ROLE_AMBIGUOUS
                elif declared in ROLES and declared!=ROLE_MENTION:role=declared;basis='STRUCTURED'
                elif foreign and declared==ROLE_MENTION:role=declared;basis='STRUCTURED'
                else:role=ROLE_AMBIGUOUS
        rows.append({'artifact':artifact,'location':location,'reference':m[0],'module':module,'function':fn,'occurrence':occurrence,'clause':text,'role':role,'function_class':'FOREIGN_MODULE_SYMBOL' if foreign else classes.get(fn,'UNCLASSIFIED'),'status':status,'document_role':document_role,'basis':basis,'confidence':'AMBIGUOUS' if role==ROLE_AMBIGUOUS else 'CLASSIFIED'})
    return rows

def references(bundle_dir,names=None):
    b=pathlib.Path(bundle_dir);meta_path=b/'AUTHORITY-REFERENCE-METADATA.json';meta=json.loads(meta_path.read_text()) if meta_path.exists() else {'document_modules':{},'fields':{}}
    prec=json.loads((b/'AUTHORITY-PRECEDENCE.json').read_text());rows=[]
    for entry in artifact_scope(b)[0]:
        f=b/entry['artifact']
        # Metadata is declarative source, not prose containing further normative function references.
        if f.name in ('AUTHORITY-REFERENCE-METADATA.json','AUTHORITY-DOCUMENT-UNIVERSE.json','REQUIRED-VALIDATION-CHECKS.json'):continue
        if f.suffix=='.json':units=[];_walk_json(json.loads(f.read_text()),(),units)
        else:units=logical_lines(f.read_text())
        for location,text in units:
            kp=keypath_role(f.name,location,prec.get('superseded_statements'))
            rows.extend(scan_text(text,f.name,location,meta['document_modules'].get(f.name),meta['fields'].get(f.name+'#'+location),entry['status'],entry['role'],kp))
    return rows

def violations(rows):
    out=[]
    for r in rows:
        if r['function_class']=='FOREIGN_MODULE_SYMBOL':continue
        v=None
        if r['role']==ROLE_AMBIGUOUS:v=ROLE_AMBIGUOUS
        elif r['role']==ROLE_AUTHORIZING and r['function_class']!='authorizing':v='DEMOTED_FUNCTION_DESIGNATED_AUTHORITATIVE'
        elif r['function_class']!='authorizing' and r['role'] not in (ROLE_DIAGNOSTIC,ROLE_HISTORICAL):v='UNMARKED_DEMOTED_REFERENCE'
        if v:out.append(dict(r,violation=v))
    return out

def declared_slots(rows,role):
    grouped={}
    for r in rows:
        if r['role']!=role:continue
        key=(r['artifact'],r['location']);g=grouped.setdefault(key,{'artifact':r['artifact'],'location':r['location'],'slot':'#'.join(key),'functions':[],'classes':[],'status':r['status'],'document_role':r['document_role']})
        fn=r['function'] if r['module']=='authority_lib' else str(r['module'])+'.'+r['function']
        if fn not in g['functions']:g['functions'].append(fn);g['classes'].append(r['function_class'])
    return [grouped[k] for k in sorted(grouped)]

def slots(rows):return declared_slots(rows,ROLE_AUTHORIZING)
def build_inventory(bundle_dir):
    rows=references(bundle_dir);scanned,skipped=artifact_scope(bundle_dir)
    inv={'schema':'vidtoolz.resolveAuthoritySlotInventory.v2','authority_version':L.AUTHORITY_VERSION,'generator':'tools/authority_slots.py#build_inventory','law':'Complete registered universe and independently extracted references; each current decision reference classified from source-bound metadata, schema semantics, or local predicate; unresolved references fail AMBIGUOUS_CURRENT_REFERENCE. No operational authority.','roles':list(ROLES),'scanned_artifacts':scanned,'not_scanned':skipped,'authorizing_slots':slots(rows),'diagnostic_slots':declared_slots(rows,ROLE_DIAGNOSTIC),'historical_statements':declared_slots(rows,ROLE_HISTORICAL),'mentions':declared_slots(rows,ROLE_MENTION),'references':rows,'violations':violations(rows)}
    inv['counts']={k:len(inv[k]) for k in ['scanned_artifacts','not_scanned','authorizing_slots','diagnostic_slots','historical_statements','mentions','references','violations']};return inv
inventory=build_inventory
