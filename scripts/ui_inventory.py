#!/usr/bin/env python3
"""Reproducible source inventory; no application code is executed.

Records source declarations, not computed browser styles or expanded user data.
Template expressions remain verbatim. Every scanned source is hash-checked so
dynamic constructions outside the recognizers also require inventory refresh.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'design-system/ui-inventory.json'
ATTR = re.compile(r'''([\w:@-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?''')
TAG = re.compile(r'<([a-zA-Z][\w-]*)\b((?:"[^"]*"|\x27[^\x27]*\x27|[^\x27">])*)>', re.S)
CREATE = re.compile(r'''createElement(?:NS)?\(\s*(?:['"][^'"]+['"]\s*,\s*)?['"]([\w-]+)['"]\s*\)''')

def category(tag, attrs):
    role = attrs.get('role', '')
    if role in ('dialog','alertdialog'): return 'popup'
    if role in ('tab','tablist','menu','menuitem','switch','progressbar','status','alert'): return role
    if tag == 'input': return 'input.' + attrs.get('type','text')
    return {'label':'label','button':'button','textarea':'textarea','select':'dropdown','option':'dropdown-option','optgroup':'dropdown-group','dialog':'popup','details':'collapsible','summary':'collapse-toggle','a':'link','svg':'icon','path':'icon-path','img':'image','video':'video','audio':'audio','canvas':'canvas','progress':'progress','meter':'meter','table':'table','thead':'table-head','tbody':'table-body','tr':'table-row','th':'table-heading','td':'table-cell','ul':'list','ol':'list','li':'list-item','form':'form','fieldset':'field-group','legend':'field-group-label','nav':'navigation','aside':'sidebar','header':'header','footer':'footer','section':'section','main':'main','h1':'heading','h2':'heading','h3':'heading','h4':'heading','h5':'heading','h6':'heading','p':'text','span':'text','strong':'text','small':'text','pre':'code','code':'code','hr':'divider','br':'line-break','div':'container'}.get(tag, 'element.'+tag)

def generate():
    files = sorted(p for p in ROOT.rglob('*') if p.suffix in ('.js','.css','.html') and not any(x in p.relative_to(ROOT).parts for x in ('.git','node_modules','design-system','scripts','tests')))
    result = {'schemaVersion':1,'coverage':'Static source declarations, creation calls and style evidence. Not computed styles or a runtime DOM census. Dynamic expressions retained; repeated instances represented by their template.','sources':[], 'objects':[], 'styleBlocks':[], 'propertyAssignments':[]}
    for p in files:
        source = p.read_text(); name = p.relative_to(ROOT).as_posix()
        result['sources'].append({'path':name,'sha256':hashlib.sha256(source.encode()).hexdigest()})
        def location(pos): return {'file':name,'line':source.count('\n',0,pos)+1,'offset':pos}
        if p.suffix != '.css':
            for m in TAG.finditer(source):
                tag = m[1].lower()
                if tag in ('script','style','meta','link','html','head','body','title'): continue
                attrs = {a[1]:next((v for v in a.groups()[1:] if v is not None),True) for a in ATTR.finditer(m[2])}
                result['objects'].append({'key':f'{name}:{m.start()}',**location(m.start()),'kind':category(tag,attrs),'tag':tag,'attributes':attrs,'declaration':m[0]})
            for m in CREATE.finditer(source):
                result['objects'].append({'key':f'{name}:{m.start()}',**location(m.start()),'kind':category(m[1],{}),'tag':m[1],'construction':'createElement','declaration':m[0]})
            # Keep complete source lines: assignment targets and values may be dynamic.
            for m in re.finditer(r'^.*(?:\.style\b|\.className\s*=|\.classList\.|\.setAttribute\(|\.textContent\s*=|\.innerHTML\s*=|\.disabled\s*=|\.hidden\s*=|\.onclick\s*=|addEventListener\().*$', source, re.M):
                result['propertyAssignments'].append({**location(m.start()),'source':m[0]})
        if p.suffix == '.css':
            result['styleBlocks'].append({'file':name,'line':1,'kind':'stylesheet','source':source})
        else:
            for m in re.finditer(r'<style[^>]*>([\s\S]*?)</style>|(?:\.textContent|\.innerHTML)\s*=\s*(`(?:\\.|[^`])*`)',source):
                css = m[1] or m[2][1:-1]
                if '{' in css and re.search(r'(?:color|padding|background|font|display|width)\s*:',css):
                    result['styleBlocks'].append({**location(m.start()),'kind':'embedded-or-template','source':css})
    result['counts']={'sources':len(result['sources']),'objects':len(result['objects']),'styleBlocks':len(result['styleBlocks']),'propertyAssignments':len(result['propertyAssignments'])}
    return result

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--check',action='store_true'); args=ap.parse_args()
    data=generate(); content=json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n'
    contract=json.loads((ROOT/'design-system/ui-contract.json').read_text())
    required={'identity','appearance','layout','content','states','interaction','accessibility','usage'}
    assert required <= set(contract['propertyGroups'])
    assert len(contract['components']) == len({c['id'] for c in contract['components']})
    if args.check:
        if not OUT.exists() or OUT.read_text()!=content:
            raise SystemExit('UI inventory is stale. Review new/changed objects and properties, update ui-contract.json if needed, then run python3 scripts/ui_inventory.py and commit the result.')
    else:
        OUT.parent.mkdir(exist_ok=True); OUT.write_text(content)
    print(json.dumps(data['counts']))

if __name__=='__main__': main()
