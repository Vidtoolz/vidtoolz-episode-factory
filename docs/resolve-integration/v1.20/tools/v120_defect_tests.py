"""Defect-specific author regressions derived from the rejected review and pinned SDK.
Counts are outcomes, not acceptance criteria. No live API calls.
"""
import copy
import hashlib
import json
import pathlib
import re
import authority_slots as S
import sdk_contracts as SDK

def run(bundle,rec):
    b=pathlib.Path(bundle)
    def check(name,ok,detail=''):rec('v120-defect-regressions',name,bool(ok),detail)
    inv=S.build_inventory(b);fc=json.loads((b/'AUTHORITY-FUNCTION-CLASSES.json').read_text())
    classes={n:k for k in ('authorizing','diagnostic_non_authorizing','provisional_until_m3_non_authorizing','internal_non_authorizing') for n in fc[k]}
    check('M1-canonical-map-equals-runtime',classes==S.L.authority_function_classes())
    for cls in ('authorizing','diagnostic_non_authorizing','provisional_until_m3_non_authorizing','internal_non_authorizing'):
        for i,fn in enumerate(fc[cls]):
            matching=[r for r in inv['references'] if r['artifact']=='AUTHORITY-FUNCTION-CLASSES.json' and r['location']==f'{cls}.[{i}]' and r['function']==fn]
            check('M1-class-array-'+fn,len(matching)==1 and matching[0]['role']==(S.ROLE_AUTHORIZING if cls=='authorizing' else S.ROLE_DIAGNOSTIC))
    for fn,c in fc['decision_functions'].items():
        matching=[r for r in inv['references'] if r['artifact']=='AUTHORITY-FUNCTION-CLASSES.json' and r['location']==f'decision_functions.{fn}.@key' and r['function']==fn]
        check('M1-function-key-'+fn,len(matching)==1 and matching[0]['role']==(S.ROLE_AUTHORIZING if c['authority_class']=='authorizing' else S.ROLE_DIAGNOSTIC))
    old=json.loads((b/'fixtures/scanner/v118-omissions.json').read_text())
    omitted=old['authorizing_array_omissions']+old['decision_key_omissions']
    for n,row in enumerate(omitted):
        loc=row['location'];loc=loc+'.@key' if loc.startswith('decision_functions.') else loc
        check(f'M1-exact-omission-{n:02}',any(r['artifact']==row['artifact'] and r['location']==loc and r['function']==row['function'] for r in inv['references']),row)
    for i,fn in enumerate(classes):
        units=[];S._walk_json({'unfamiliar':[{fn:{'nested':fn+' is authoritative.'}}]},(),units)
        rs=[r for loc,txt in units for r in S.scan_text(txt,location=loc,module_context='authority_lib')]
        colliding=[];S._walk_json({'a.b':fn+' is authoritative.','a':{'b':fn+' is authoritative.'}},(),colliding)
        cr=[r for loc,txt in colliding for r in S.scan_text(txt,location=loc,module_context='authority_lib')]
        check('M1-nested-key-value-'+fn,len(rs)==2 and {r['function'] for r in rs}=={fn} and any(r['violation']=='AMBIGUOUS_REFERENCE_LOCATION' for r in S.violations(cr)))
    def declaration(text,roles):
        rows=S.scan_text(text,module_context='authority_lib')
        return {str(i):{'module':r['module'],'function':r['function'],'source_sha256':hashlib.sha256(text.encode()).hexdigest(),'authority_role':roles[i]} for i,r in enumerate(rows)}
    for verb in ['governs eligibility','controls eligibility','is authoritative','decides readiness','authorizes commits','refuses invalid authority','determines eligibility','establishes authority','permits eligibility']:
        text='derive_attachment_state '+verb+'.'
        check('M2-no-annotation-'+verb,bool(S.violations(S.scan_text(text,module_context='authority_lib'))))
        for role in [S.ROLE_DIAGNOSTIC,S.ROLE_HISTORICAL,S.ROLE_MENTION]:
            check('M2-conflicting-'+role+'-'+verb,bool(S.violations(S.scan_text(text,module_context='authority_lib',structured=declaration(text,[role])))))
    for text in ['derive_attachment_state is diagnostic and governs eligibility.', 'derive_attachment_state is diagnostic but is authoritative.', 'derive_attachment_state governs eligibility; evaluate_eligibility controls eligibility.', 'derive_attachment_state is diagnostic and derive_attachment_state is authoritative.', 'derive_attachment_state controls eligibility, and evaluate_eligibility is diagnostic.']:
        raw=S.scan_text(text,module_context='authority_lib');sp=declaration(text,[S.ROLE_DIAGNOSTIC]*len(raw));rs=S.scan_text(text,module_context='authority_lib',structured=sp)
        check('M2-multiple-'+hashlib.sha256(text.encode()).hexdigest()[:10],bool(S.violations(rs)))
    for text in ['derive_attachment_state is diagnostic.','derive_attachment_state is diagnostic; evaluate_eligibility is diagnostic.','derive_attachment_state is diagnostic; derive_attachment_state_authorizing is authoritative.']:
        rs=S.scan_text(text,module_context='authority_lib');sp=declaration(text,[r['role'] for r in rs]);check('M2-benign-'+hashlib.sha256(text.encode()).hexdigest()[:10],not S.violations(S.scan_text(text,module_context='authority_lib',structured=sp)))
    text='derive_attachment_state controls eligibility.'
    for key,value in [('authority_role','UNKNOWN'),('source_sha256','0'*64),('module','other'),('function','other'),('unexpected',True)]:
        sp=declaration(text,[S.ROLE_DIAGNOSTIC]);sp['0'][key]=value;check('M2-malformed-'+key,bool(S.violations(S.scan_text(text,module_context='authority_lib',structured=sp))))
    for sep in ['; ','. ',': ', ', ', '\n']:
        text='derive_attachment_state is diagnostic'+sep+'unrelated_loader refuses invalid authority.'
        check('N1-own-clause-'+repr(sep),S.scan_text(text,module_context='authority_lib')[0]['role']==S.ROLE_DIAGNOSTIC)
    for form in ['derive_attachment_state(a, b)','`derive_attachment_state`','authority_lib.derive_attachment_state','tools/authority_lib.py#derive_attachment_state']:
        check('N1-name-form-'+form,S.scan_text(form+' is diagnostic; unrelated_loader refuses invalid authority.',module_context='authority_lib')[0]['role']==S.ROLE_DIAGNOSTIC)
    for sid in ['S18','S28','S32','S37','S61']:
        rs=[r for r in inv['references'] if r['artifact']=='AUTHORITY-PRECEDENCE.md' and re.match(r'^\|\s*'+sid+r'\s*\|',r['clause']) and r['function_class']!='FOREIGN_MODULE_SYMBOL']
        check('N2-history-'+sid,bool(rs) and all(r['role']==S.ROLE_HISTORICAL for r in rs))
    target=json.loads((b/'TARGET-CONTRACT.json').read_text());milestones=(b/'MILESTONES.md').read_text()
    check('N3-current-target-version',target['required_future_observations'][2]['source'].endswith('FREEZE-MANIFEST.json '+S.L.AUTHORITY_VERSION))
    check('N3-current-milestone-version','authority '+S.L.AUTHORITY_VERSION in milestones and 'authority 1.6.0' not in milestones and 'with a schema validator, no default' not in milestones and 'internally resolves the pinned schema validator' in milestones)
    check('N1-law-precedence','Reject a conflicting metadata declaration.' in fc['slot_discovery_law']['signal_precedence'][1])
    rp=json.loads((b/'READ-PRIMITIVES.json').read_text());check('M3-M4-all-primitive-sdk-contracts',not SDK.errors(b,rp),SDK.errors(b,rp))
    sdk=SDK.contracts(b)
    c=sdk[('MediaPoolItem','GetClipProperty')];check('M3-source-optional-property-dict',c['arguments']==[{'name':'propertyName','type':'str | None','required':False}] and 'dict of all clip properties' in c['documentation'])
    c=sdk[('ProjectManager','GetProjectLastModifiedTime')];check('M4-source-name-int-epoch',c['arguments']==[{'name':'projectName','type':'str','required':True}] and c['returns']=='int' and 'epoch timestamp' in c['documentation'])
    for op,row in rp['logical_operations'].items():
        for i,p in enumerate(row['primitives']):
            if p['method'] not in ['GetClipProperty','GetProjectLastModifiedTime']:continue
            muts=[('receiver','TimelineItem','SDK_RECEIVER_METHOD'),('expected_type','str','SDK_CALL_SHAPE_RETURN')] if p['method']=='GetClipProperty' else [('receiver','Project','SDK_RECEIVER_METHOD'),('arg_types',[],'SDK_ARGUMENT_ARITY'),('expected_type','str','SDK_RETURN_TYPE')]
            for key,value,error in muts:
                mutant=copy.deepcopy(rp);mutant['logical_operations'][op]['primitives'][i][key]=value
                check(p['method']+'-'+op+'-wrong-'+key,any(error in e for e in SDK.errors(b,mutant)))
    check('final-zero-inventory-violations',not inv['violations'],inv['violations'][:2])

if __name__=='__main__':
    import sys
    results=[]
    run(pathlib.Path(__file__).resolve().parent.parent,lambda sec,name,ok,detail='':results.append({'section':sec,'name':name,'pass':ok,'detail':detail}))
    print(json.dumps({'passed':sum(r['pass'] for r in results),'total':len(results),'results':results},indent=2))
    sys.exit(0 if all(r['pass'] for r in results) else 1)
