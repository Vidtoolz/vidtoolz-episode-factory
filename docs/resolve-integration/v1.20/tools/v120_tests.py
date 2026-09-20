"""Implementation-author release/scanner regressions. Not independent adjudication."""
import ast
import copy
import hashlib
import json
import pathlib
import random
import re
import tempfile
import shutil
import authority_slots as S
import release_authority as RELEASE

def independent_references(bundle):
    """Separate source walker and regex; neither reads inventory nor calls scanner extraction/classification."""
    b=pathlib.Path(bundle);meta=json.loads((b/'AUTHORITY-REFERENCE-METADATA.json').read_text());prec=json.loads((b/'AUTHORITY-PRECEDENCE.json').read_text());out=[]
    classes=json.loads((b/'AUTHORITY-FUNCTION-CLASSES.json').read_text());names=set().union(*(set(classes[k]) for k in ('authorizing','diagnostic_non_authorizing','provisional_until_m3_non_authorizing','internal_non_authorizing')))
    def walk(v,path=''):
        if isinstance(v,dict):
            for k,x in v.items():
                loc=path+'.'+k if path else k
                if any(tok in names for tok in re.findall(r'[A-Za-z_][A-Za-z_0-9]*',k)):yield loc+'.@key',k
                yield from walk(x,loc)
        elif isinstance(v,list):
            for i,x in enumerate(v):yield from walk(x,path+f'.[{i}]')
        elif isinstance(v,str):yield path,v
    def prose(txt):
        result=[];buf=[];start=0
        for n,line in enumerate(txt.splitlines(),1):
            stripped=line.strip();new=bool(re.match(r'^(?:\||#{1,6}\s|```|[-*+]\s|\d+\.\s|>)',stripped))
            if not stripped or new:
                if buf:result.append((f'line {start}',' '.join(buf)));buf=[]
            if stripped:
                if not buf:start=n
                buf.append(stripped)
        if buf:result.append((f'line {start}',' '.join(buf)))
        return result
    for e in prec['documents']:
        f=b/e['path']
        if '/' in e['path'] or e['status']!='STILL_ACTIVE' or e['role'] not in S.CURRENT_ROLES:continue
        if f.name in ('AUTHORITY-REFERENCE-METADATA.json','AUTHORITY-DOCUMENT-UNIVERSE.json','REQUIRED-VALIDATION-CHECKS.json'):continue
        units=walk(json.loads(f.read_text())) if f.suffix=='.json' else prose(f.read_text())
        for loc,text in units:
            occurrence=0
            for m in re.finditer(r'(?<!\w)[A-Za-z_][A-Za-z_0-9]*(?!\w)',text):
                if m[0] not in names:continue
                prefix=re.search(r'([A-Za-z_][\w/]*(?:\.[A-Za-z_]\w*)*[.#])$',text[:m.start()])
                module=meta['document_modules'].get(f.name)
                if prefix:
                    q=prefix[1][:-1];module=q.rsplit('/',1)[-1].removesuffix('.py') if prefix[1].endswith('#') else q.removesuffix('.py')
                spec=meta['fields'].get(f.name+'#'+loc,{}).get(str(occurrence),{})
                out.append({'artifact':f.name,'location':loc,'module':module,'function':m[0],'occurrence':occurrence,'source_sha256':hashlib.sha256(text.encode()).hexdigest(),'authority_role':spec.get('authority_role')})
                occurrence+=1
    return out

def run(bundle,rec):
    b=pathlib.Path(bundle);doc=(b.parent.parent/'DOC-AUTHORITY.md').read_text();rng=random.Random(20261118)
    def check(id,ok,detail=''):rec('v120-release-scanner',id,bool(ok),detail)
    check('registration-current',not RELEASE.registration_errors(doc),RELEASE.registration_errors(doc))
    check('external-final-bytes',not RELEASE.external_errors(b),RELEASE.external_errors(b))
    check('document-universe',not RELEASE.universe_errors(b),RELEASE.universe_errors(b))
    finding_map=json.loads((b/'FINDING-RESOLUTION-MATRIX-v1.20.json').read_text())
    matrix_errors=S.L.internal_schema_errors('resolveFindingResolutionMatrix',finding_map)
    check('active-finding-map-schema',not matrix_errors and {r['id'] for r in finding_map['findings']}=={'V119-F'+str(i) for i in range(1,6)}|{'P1-F%02d'%i for i in range(7,13)}|{'P1-R%02d'%i for i in range(1,6)},matrix_errors)
    sel=RELEASE.MARKER.search(doc)
    for id,mutant in [
        ('zero-current',doc[:sel.start()]+doc[sel.end():]),
        ('duplicate-selector',doc+'\n'+sel[0]),
        ('old-current',doc.replace('"version":"1.20.0"','"version":"1.13.0"')),
        ('missing-registration',doc.replace('**v1.20 registration** (current):','')),
        ('stale-prose',doc+'\nv1.13 is the current authority.\n'),
        ('both-current',doc.replace('| HISTORICAL — REJECTED: intake incoherence','| CURRENT — REJECTED: intake incoherence')),
        ('current-rejected',doc.replace('**CURRENT** — implementation-author','**CURRENT** — REJECTED implementation-author'))]:
        check(id,bool(RELEASE.registration_errors(mutant)))
    for cue in ['current authority','current version','active authority','active version','controlling authority','authoritative version']:
        check('stale-prose-'+cue,bool(RELEASE.registration_errors(doc+'\nv1.13 is the '+cue+'.\n')))
    manifest=json.loads((b/'FREEZE-MANIFEST.json').read_text());parent=json.loads((b.parent/'v1.19/FREEZE-MANIFEST.json').read_text())
    stale=copy.deepcopy(manifest);stale['external_pins']['doc_authority']['sha256']=hashlib.sha256((b.parent.parent/'DOC-AUTHORITY.md').read_bytes()+b'changed').hexdigest()
    check('external-digest-negative','EXTERNAL_DOC_SHA256' in RELEASE.external_errors(b,stale))
    stale['external_pins']['doc_authority']['sha256']='144ccf740b34ed12aa805d8c82ca03e17aa4704f2584234365d79334f9242fcb'
    check('parent-document-pin-negative','EXTERNAL_DOC_SHA256' in RELEASE.external_errors(b,stale))
    required=json.loads((b/'REQUIRED-VALIDATION-CHECKS.json').read_text())['check_ids']
    check('check-omission-negative',bool(RELEASE.required_errors(['a'],['a','b'])))
    check('check-duplicate-negative',bool(RELEASE.required_errors(['a','a'],['a'])))
    check('actual-required-check-omission',bool(RELEASE.required_errors(required[:-1],required)) if required else True,'author bootstrap empty plan is never release validation')
    inv=json.loads((b/'AUTHORITY-SLOT-INVENTORY.json').read_text());actual=S.build_inventory(b)
    check('inventory-full-equality',inv==actual)
    independent=independent_references(b);keys=lambda rows:sorted((r['artifact'],r['location'],str(r['module']),r['function'],r['occurrence']) for r in rows)
    check('independent-reference-equality',keys(independent)==keys(actual['references']))
    metadata=json.loads((b/'AUTHORITY-REFERENCE-METADATA.json').read_text());declared={(k,int(i)) for k,rs in metadata['fields'].items() for i in rs};discovered={(r['artifact']+'#'+r['location'],r['occurrence']) for r in independent}
    check('metadata-reference-set-equality',declared==discovered)
    mismatch=[]
    for row in independent:
        sp=metadata['fields'].get(row['artifact']+'#'+row['location'],{}).get(str(row['occurrence']),{})
        if any(sp.get(k)!=row[k] for k in ['module','function','source_sha256']):mismatch.append(row)
    check('independent-source-role-bindings',not mismatch,str(mismatch[:1]))
    indroles={(r['artifact'],r['location'],r['module'],r['function'],r['occurrence']):r['authority_role'] for r in independent}
    check('source-declaration-role-equality',all(indroles.get((r['artifact'],r['location'],r['module'],r['function'],r['occurrence']))==r['role'] for r in actual['references']))
    indslots={(r['artifact'],r['location']) for r in independent if r['authority_role']==S.ROLE_AUTHORIZING}
    check('source-declaration-slot-equality',indslots=={(r['artifact'],r['location']) for r in inv['authorizing_slots']})
    check('all-current-reference-roles',not actual['violations'],str(actual['violations'][:1]))
    missing=['PERMISSIONS.json#law','M0A-BINDING-VALUES.json#values.verification_result_law','M0A-BINDING-VALUES.json#values.toctou_law','FREEZE-MANIFEST.json#rules.[4]']
    pindex=next(i for i,e in enumerate(manifest['files']) if e['path']=='PERMISSIONS.json');missing.append(f'FREEZE-MANIFEST.json#files.[{pindex}].qualification_note')
    for i,s in enumerate(missing):check('former-slot-'+str(i),s in {r['slot'] for r in inv['authorizing_slots']},s)
    for i in range(24):
        altered=copy.deepcopy(inv);del altered['authorizing_slots'][rng.randrange(len(altered['authorizing_slots']))]
        check(f'slot-omission-{i:02}',altered!=actual)
    # Scratch-only scope/registration mutants, no runtime tools or evidence-root access.
    with tempfile.TemporaryDirectory(prefix='v120-publication-tests-') as td:
        t=pathlib.Path(td);dest=t/'docs/resolve-integration/v1.20';dest.mkdir(parents=True)
        # Parent is read-only source input; copy only the registration needed by independent universe derivation.
        (dest.parent/'v1.19').mkdir();shutil.copyfile(b.parent/'v1.19/AUTHORITY-PRECEDENCE.json',dest.parent/'v1.19/AUTHORITY-PRECEDENCE.json')
        for f in b.iterdir():
            if f.is_file() and f.suffix in ('.md','.json'):shutil.copyfile(f,dest/f.name)
        shutil.copyfile(b.parent.parent/'DOC-AUTHORITY.md',dest.parent.parent/'DOC-AUTHORITY.md')
        dp=dest.parent.parent/'DOC-AUTHORITY.md';dp.write_text(dp.read_text()+'\nchanged after manifest\n')
        check('edit-after-manifest','EXTERNAL_DOC_SHA256' in RELEASE.external_errors(dest))
        original=json.loads((dest/'AUTHORITY-PRECEDENCE.json').read_text());norm=[e for e in original['documents'] if e['status']=='STILL_ACTIVE' and e['role']=='NORMATIVE_AUTHORITY']
        for i in range(24):
            p=copy.deepcopy(original);e=rng.choice(norm);p['documents']=[r for r in p['documents'] if r['path']!=e['path']];(dest/'AUTHORITY-PRECEDENCE.json').write_text(json.dumps(p))
            check(f'registration-omission-{i:02}',bool(RELEASE.universe_errors(dest)))
        p=copy.deepcopy(original);next(e for e in p['documents'] if e['path']=='IDENTITY-BINDING.md')['role']='GENERATED_EVIDENCE';(dest/'AUTHORITY-PRECEDENCE.json').write_text(json.dumps(p))
        (dest/'IDENTITY-BINDING.md').write_text((dest/'IDENTITY-BINDING.md').read_text()+'\nCURRENT NORMATIVE LAW: derive_attachment_state is authoritative.\n')
        check('exact-misregistration-mutant-refused',bool(RELEASE.universe_errors(dest)))
        (dest/'AUTHORITY-PRECEDENCE.json').write_text(json.dumps(original));(dest/'UNREGISTERED.json').write_text('{"law":"derive_attachment_state is authoritative"}')
        check('extra-unregistered-normative',bool(RELEASE.universe_errors(dest)))
    cases=json.loads((b/'fixtures/scanner/v117-failures.json').read_text())
    check('thirty-case-corpus-size',len(cases)==30)
    for c in cases:
        bind=c.get('binding',{});units=S.logical_lines(c['text']) if bind.get('name','').endswith('.md') else [('law',c['text'])]
        rows=[r for loc,txt in units for r in S.scan_text(txt,module_context='authority_lib')]
        if c['id']=='MODULE-unfamiliar_module':ok=all(r['function_class']=='FOREIGN_MODULE_SYMBOL' for r in rows)
        elif c['id']=='SAFE-KEY-WITHOUT-CLASS':ok=bool(S.violations(rows))
        else:
            expected=c.get('expect_roles') or {k:('AUTHORIZING_DESIGNATION' if v=='AUTHORITATIVE' else 'DIAGNOSTIC_DECLARATION') for k,v in c.get('expected',{}).items()}
            ok=all(any(r['function']==f and r['role']==role for r in rows) for f,role in expected.items())
            if c.get('expect_violation') is not None:ok &= bool(S.violations(rows))==c['expect_violation']
        check('v117-regression-'+c['id'],ok,[(r['function'],r['role']) for r in rows])
    for i in range(64):
        fn=rng.choice(['derive_attachment_state','evaluate_eligibility']);fmt=rng.choice(['{}','`{}`','authority_lib.{}','tools/authority_lib.py#{}','{}(a, b)']);text=fmt.format(fn)+' is authoritative.'
        rows=S.scan_text(text,location='unknown_'+str(rng.randrange(1<<24))+'.diagnostic_notes',module_context='authority_lib')
        check(f'unknown-key-{i:02}',bool(S.violations(rows)) and rows[0]['role']==S.ROLE_AUTHORIZING)
    for i in range(24):
        mod='foreign_'+str(rng.randrange(1<<24));rows=S.scan_text(mod+'.derive_attachment_state is authoritative.',module_context='authority_lib')
        check(f'foreign-module-{i:02}',rows[0]['module']==mod and not S.violations(rows))
    check('bare-name-no-context',S.scan_text('derive_attachment_state is authoritative.')[0]['role']==S.ROLE_AMBIGUOUS)
    check('unlisted-predicate-ambiguous',S.scan_text('derive_attachment_state_authorizing frobniculates readiness.',module_context='authority_lib')[0]['role']==S.ROLE_AMBIGUOUS)
    check('diagnostic-negation-not',S.scan_text('derive_attachment_state is not diagnostic.',module_context='authority_lib')[0]['role']==S.ROLE_AUTHORIZING)
    text='- derive_attachment_state_authorizing is authoritative and derive_attachment_state is diagnostic.'
    for i in range(1,len(text.split())):
        words=text.split();wrapped=' '.join(words[:i])+'\n  '+' '.join(words[i:]);units=S.logical_lines(wrapped);rs=[r for _,t in units for r in S.scan_text(t,module_context='authority_lib')]
        check(f'wrap-property-{i:02}',[(r['function'],r['role']) for r in rs]==[('derive_attachment_state_authorizing',S.ROLE_AUTHORIZING),('derive_attachment_state',S.ROLE_DIAGNOSTIC)])
    # AST operational tripwire: only authority version/docstrings and manifest lineage helper differ.
    for name in ['evidence_authoring.py','a2_prepare.py','a2_verify.py','evidence_store.py']:
        check('runtime-byte-'+name,(b/'tools'/name).read_bytes()==(b.parent/'v1.19/tools'/name).read_bytes())
    def semantics(path):
        tree=ast.parse(path.read_text())
        tree.body=[n for n in tree.body if not (isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name=='semantic_manifest')]
        for n in ast.walk(tree):
            if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='AUTHORITY_VERSION' for t in n.targets):n.value=ast.Constant('VERSION')
            if isinstance(n,(ast.Module,ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and n.body and isinstance(n.body[0],ast.Expr) and isinstance(n.body[0].value,ast.Constant) and isinstance(n.body[0].value.value,str):n.body=n.body[1:]
        return ast.dump(tree,include_attributes=False)
    check('runtime-authority-ast',semantics(b/'tools/authority_lib.py')==semantics(b.parent/'v1.19/tools/authority_lib.py'))
    check('receipt-ten-fields',len(S.L.RECEIPT_BOUND_FIELDS)==10)
    for v in ['v1']+['v1.'+str(i) for i in range(1,20)]:
        pb=b.parent/v;pm=json.loads((pb/'FREEZE-MANIFEST.json').read_text());check('history-'+v,all((pb/e['path']).is_file() and RELEASE.sha(pb/e['path'])==e['sha256'] for e in pm['files']))
