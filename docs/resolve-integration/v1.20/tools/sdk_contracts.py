"""Documentary SDK checks. Parse pinned source without importing Resolve or its SDK.
The source proves declared signatures, not successful calls, error behavior or qualification.
"""
import ast
import hashlib
import pathlib
import json

SDK_SHA256='00078fa1256851b9807621a4eea5e670f4266b0e7003763cba4a62655543f0ec'

def contracts(bundle):
    path=pathlib.Path(bundle)/'evidence/sdk/DaVinciResolveScript.pyi'
    raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=SDK_SHA256:raise ValueError('SDK_SOURCE_PIN')
    tree=ast.parse(raw);out={};aliases={}
    for node in tree.body:
        if isinstance(node,ast.Assign) and isinstance(node.value,ast.Subscript) and ast.unparse(node.value.value)=='Literal':
            values=node.value.slice.elts if isinstance(node.value.slice,ast.Tuple) else [node.value.slice]
            kinds={type(v.value).__name__ for v in values if isinstance(v,ast.Constant)}
            for name in node.targets:
                if isinstance(name,ast.Name):aliases[name.id]=' | '.join(sorted(kinds))
    for cls in tree.body:
        if not isinstance(cls,ast.ClassDef):continue
        for fn in cls.body:
            if not isinstance(fn,ast.FunctionDef):continue
            args=fn.args.args[1:];required=len(args)-len(fn.args.defaults)
            out[(cls.name,fn.name)]={'receiver':cls.name,'method':fn.name,'arguments':[{'name':a.arg,'type':aliases.get(ast.unparse(a.annotation),ast.unparse(a.annotation)) if a.annotation else None,'required':i<required} for i,a in enumerate(args)],'returns':ast.unparse(fn.returns) if fn.returns else None,'documentation':ast.get_docstring(fn),'line':fn.lineno}
    return out

def errors(bundle, primitives):
    sdk=contracts(bundle);errs=[]
    fixture=json.loads((pathlib.Path(bundle)/'fixtures/sdk/canonical-read-contracts.json').read_text())
    if fixture.get('sdk_sha256')!=SDK_SHA256:errs.append('CANONICAL_FIXTURE_SOURCE_PIN')
    exact={}
    for row in fixture['contracts']:
        receiver,name=row['symbol'].split('.')
        if sdk.get((receiver,name))!=row['sdk_contract']:errs.append('CANONICAL_FIXTURE_SOURCE_DRIFT')
        exact[(receiver,name,tuple(row['arg_types']))]=row['expected_type']
    for op,row in primitives['logical_operations'].items():
        for i,p in enumerate(row['primitives']):
            name=p['method'].split('(')[0].split('.')[-1];loc=f'{op}.primitives.[{i}]';c=sdk.get((p['receiver'],name))
            if not c:errs.append(loc+':SDK_RECEIVER_METHOD');continue
            args=p['arg_types'];sig=c['arguments'];minimum=sum(a['required'] for a in sig)
            if not minimum<=len(args)<=len(sig):errs.append(loc+':SDK_ARGUMENT_ARITY')
            for supplied,declared in zip(args,sig):
                if declared['type'] and supplied not in declared['type'].split(' | '):errs.append(loc+':SDK_ARGUMENT_TYPE')
            if (p['receiver'],name,tuple(args)) in exact and p['expected_type']!=exact[p['receiver'],name,tuple(args)]:errs.append(loc+':SDK_CALL_SHAPE_RETURN')
            # Unambiguous primitive scalar contracts can be checked directly. Float source with integer
            # whole-frame hypotheses is deliberately not promoted to a verified concrete runtime type.
            if c['returns'] in ('str','int','bool') and p['expected_type']!=c['returns']:errs.append(loc+':SDK_RETURN_TYPE')
    return errs
