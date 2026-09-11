"""Build exact reading files from captured official legislation.

Dry run is the default. The review report records every unresolved scope; --apply
refuses unresolved content. No priorities, calendar IDs or progress keys change.
"""
from __future__ import annotations
import argparse
import copy
import datetime as dt
import importlib.util
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REVIEW_DATE = '2026-09-11'
spec = importlib.util.spec_from_file_location('law_sources', ROOT / 'scripts/refresh-law-sources.py')
law = importlib.util.module_from_spec(spec)
spec.loader.exec_module(law)


def read_data():
    text = (ROOT / 'index.html').read_text(encoding='utf8')
    line = next(x for x in text.splitlines() if x.startswith('const DATA = '))
    return json.loads(line[13:-1]), line


def clean_compare(text):
    text = re.sub(r'\([^)]*(?:Reda[çc][ãa]o|Inclu[íi]do|Acrescido|Vide|Vig[êe]ncia)[^)]*\)', '', text, flags=re.I)
    return re.sub(r'\W+', '', text).casefold()


def structural_lines(text):
    """Keep an inciso's alíneas with that inciso when selecting a fragment."""
    out = []
    parent = 'caput'
    for line in text.splitlines():
        line = law.normalized(line)
        if not line:
            continue
        m = re.match(r'^(§\s*\d+[º°o]?(?:-[A-Z])?|Parágrafo único|[IVXLCDM]+(?=\s*[-–—]))', line)
        marker = re.sub(r'\s+', '', m[1]) if m else 'caput' if law.ARTICLE.match(line) else None
        if marker and marker.startswith('§'):
            marker = re.sub(r'(?<=\d)[º°o]', '', marker)
        if marker or not out:
            if marker == 'caput' or marker and (marker.startswith('§') or marker=='Parágrafoúnico'):
                parent = marker
            path = marker if marker==parent else parent+'/'+str(marker)
            out.append({'marker': marker or 'caput', 'path':path,'text': line})
        else:
            out[-1]['text'] += '\n' + line
    return out


def fragment(candidate, meta, old, override=None):
    if override:
        lines = structural_lines(candidate['text'])
        starts = [i for i,x in enumerate(lines) if x['path']==override['start']]
        ends = [i for i,x in enumerate(lines) if x['path']==override['end']]
        if override.get('startOccurrence') and len(starts)>=override['startOccurrence']:
            starts=[starts[override['startOccurrence']-1]]
        if len(starts)!=1 or len(ends)!=1 or ends[0]<starts[0]:
            return None,'reviewed-boundary-not-found'
        result=copy.deepcopy(candidate)
        result['text']='\n'.join(x['text'] for x in lines[starts[0]:ends[0]+1])
        return result,None
    scope = meta.get('sub', '')
    match = re.search(r'\((\d+)/(\d+)\s*:\s*(.*?)\)', scope)
    if not match:
        # Pre-existing fraction-only labels must be reviewed, never replaced
        # by an entire article in every card.
        return None, 'fragment-without-exact-boundaries'
    part, total, bounds = int(match[1]), int(match[2]), match[3]
    bounds = bounds.replace('º', '').replace('°', '')
    bounds = re.sub(r'caput\s+e\s+[^–—]+[–—]', 'caput–', bounds)
    limits = re.split(r'[–—]', bounds, maxsplit=1)
    if len(limits) == 1:
        return None, 'fragment-without-range'
    first, last = [re.sub(r'\s+', '', s.replace('§ único', 'Parágrafo único')) for s in limits]
    # Scope ending "XXXIV e § único" includes the paragraph, not just inciso.
    if 'e§único' in last or 'eParágrafoúnico' in last:
        last = 'Parágrafoúnico'
    lines = structural_lines(candidate['text'])
    starts = [i for i, x in enumerate(lines) if x['marker'] == first]
    if first == 'caput':
        starts = [0]
    pairs = [(i,j) for i in starts for j in range(i,len(lines)) if lines[j]['marker'] == last]
    # The last card still stops at its explicit final device. Its fraction
    # number is not permission to append the remainder of a giant article.
    pairs = list(dict.fromkeys(pairs))
    if len(pairs) != 1:
        if old and pairs:
            old_clean = clean_compare(old.get('t',''))
            matches = [(i,j) for i,j in pairs if clean_compare('\n'.join(x['text'] for x in lines[i:j+1])) == old_clean]
            if len(matches) == 1:
                pairs = matches
            else:
                old_parts = structural_lines(old.get('t',''))
                if old_parts:
                    first_text, last_text = clean_compare(old_parts[0]['text']), clean_compare(old_parts[-1]['text'])
                    matches = [(i,j) for i,j in pairs if clean_compare(lines[i]['text']).startswith(first_text[:90]) and clean_compare(lines[j]['text']).startswith(last_text[:90])]
                    if len(matches) == 1:
                        pairs = matches
        if len(pairs) != 1:
            return None, 'ambiguous-fragment-boundaries'
    i,j = pairs[0]
    result = copy.deepcopy(candidate)
    result['text'] = '\n'.join(x['text'] for x in lines[i:j+1])
    return result, None


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--cache', type=Path, default=ROOT.parent/'law-refresh-audit')
    cli.add_argument('--apply', action='store_true')
    cli.add_argument('--fallback', type=Path)
    args = cli.parse_args()
    cache = args.cache.resolve()
    data, old_line = read_data()
    before = copy.deepcopy(data)
    specials = json.loads((ROOT/'scripts/law-special-review.json').read_text(encoding='utf8'))
    overrides = json.loads((ROOT/'scripts/law-reading-overrides.json').read_text(encoding='utf8'))
    sources = {}
    for directory in ([args.fallback.resolve()] if args.fallback else []) + [cache]:
        for name in ['sources.json','mirror-sources.json']:
            p = directory/name
            if not p.exists():
                continue
            for s in json.loads(p.read_text(encoding='utf8')):
                if s.get('status') == 'fetched':
                    f = directory/'raw'/Path(s.get('cacheFile','').replace('\\','/')).name
                    if f.exists():
                        sources[s['url']] = {**s, 'path': f}
    parsed = {}
    for url,s in sources.items():
        if str(s['path']).endswith('.html'):
            parse_file = cache/(s['key']+'.parsed.json')
            parser_hash = law.digest((ROOT/'scripts/refresh-law-sources.py').read_bytes())
            saved = json.loads(parse_file.read_text(encoding='utf8')) if parse_file.exists() else {}
            if saved.get('parserHash') == parser_hash and saved.get('rawHash') == s['sha256']:
                p = saved['parsed']
            else:
                p = law.parse_html(s['path'].read_bytes(), s.get('finalUrl',url))
                parse_file.write_text(json.dumps({'rawHash':s['sha256'],'parserHash':parser_hash,'parsed':p},ensure_ascii=False),encoding='utf8')
            parsed[url] = p
    old_files = {p.stem: json.loads(p.read_text(encoding='utf8')) for p in (ROOT/'leis').glob('*.json')}
    unresolved, edits, generated, summaries = [], [], {}, []
    for bid, metas in data['leigroups'].items():
        old_file = old_files.get(bid, {'id':bid,'g':[]})
        old_groups = {g['id']:g for g in old_file.get('g',[])}
        groups = []
        for meta in metas:
            gid, url = meta['id'], meta.get('u','')
            correction = overrides.get(gid,{})
            read_url = correction.get('readSource',url)
            if correction.get('readTitle'):
                meta['readTitle'] = correction['readTitle']
            special = specials.get(url) or next((s for s in specials.values() if gid in s.get('groupIds',[])), {})
            special_articles = {a['n']:a for a in special.get('specialArticles',[])}
            labels = [str(n) for n in meta.get('a',[]) if str(n) not in correction.get('omit',[])] or list(special_articles)
            old_group = old_groups.get(gid,{})
            old_articles = {a['n']:a for a in old_group.get('a',[])}
            s = sources.get(read_url,{})
            source_url = special.get('sourceUrl') or s.get('finalUrl') or url
            if source_url and source_url != url:
                meta['readSourceUrl'] = source_url
            audit = {'checkedAt':REVIEW_DATE,'status':'source-reviewed','sourceUrl':source_url,'notes':special.get('notes',[])[:]+correction.get('notes',[]), 'sourceHash':s.get('sha256'), 'retrievedAt':s.get('retrievedAt')}
            if 'l13105' in url.lower() and any(str(n) in ['196','529','913'] for n in labels):
                audit['notes'].append('Vigência futura: a Lei 15.479/2026 (DOU 30/07/2026, art. 4º) tem vacância de um ano. As alterações nos arts. 196 e 913 e o novo art. 529-A não são tratados aqui como vigentes em 11/09/2026. Consulte a lei alteradora para esse regime futuro.')
            result = {**copy.deepcopy(old_group), 'id':gid, 'r':meta.get('r',''), 'sub':meta.get('sub',''), 'u':url, 'a':[], 'audit':audit}
            for label in labels:
                n = re.match(r'^(\d+(?:\.\d{3})*(?:-[A-Z]+)?)',label,re.I)
                n = law.number(n[1]) if n else label
                old = old_articles.get(label)
                issue, candidate = None, None
                if n in special_articles:
                    candidate = {'text':special_articles[n]['t'], 'links':[], 'warnings':[]}
                elif read_url not in parsed:
                    issue = 'source-unavailable'
                else:
                    occurrence = {'label':label, 'scope':meta.get('sub','')+' '+meta.get('r',''), 'url':read_url}
                    candidate, status = law.select_candidate(parsed[read_url],occurrence)
                    if not candidate:
                        issue = status
                    if candidate and (meta.get('fa') or re.search(r'\(\d+/\d+', label+' '+meta.get('sub',''))):
                        candidate, issue = fragment(candidate, meta, old, correction.get('fragment'))
                if issue:
                    unresolved.append({'blockId':bid, 'groupId':gid,'label':label,'url':url,'scope':meta.get('sub',''),'issue':issue,'hidden':bool(meta.get('x'))})
                    result['audit']['status'] = 'needs-review'
                    if old:
                        result['a'].append({**old,'audit':{'status':'needs-review','sourceUrl':source_url,'notes':['Trecho anterior preservado: atualização ainda não validada.']}})
                    continue
                if candidate:
                    article = {'n':label, 't':candidate['text'], 'v':(old or {}).get('v',[]), 'sourceUrl':source_url, 'sourceLinks':candidate.get('links',[])}
                    if '\ufffd' in article['t']:
                        unresolved.append({'blockId':bid,'groupId':gid,'label':label,'issue':'invalid-source-encoding'})
                        result['audit']['status']='needs-review'
                    if any('lcp236' in link['url'].lower() for link in article['sourceLinks']):
                        article['audit']={**audit,'notes':audit['notes']+['CTN atualizado pela LC 236/2026, vigente desde a publicação em 04/09/2026. Os prazos de adaptação de dois anos dos arts. 211-A e 211-B não se confundem com a vigência da lei.']}
                    if 'l13105' in url.lower() and label in ['196','529','913']:
                        article['sourceLinks'].append({'text':'Vigência futura — Lei 15.479/2026, art. 4º','url':'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/l15479.htm#art4'})
                    result['a'].append(article)
                    if not old or clean_compare(old.get('t','')) != clean_compare(article['t']):
                        edits.append({'blockId':bid, 'groupId':gid,'label':label,'new':not bool(old),'oldHash':law.digest((old or {}).get('t','')), 'newHash':law.digest(article['t'])})
            if not result['a']:
                result['audit']['status'] = 'needs-review'
                if not labels:
                    unresolved.append({'blockId':bid,'groupId':gid,'issue':'empty-scope','url':url})
            groups.append(result)
        generated[bid] = {'id':bid,'g':groups}
    report = {'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(), 'checkedAt':REVIEW_DATE, 'files':len(generated), 'groups':sum(len(x['g']) for x in generated.values()), 'articleOccurrences':sum(len(g['a']) for x in generated.values() for g in x['g']), 'sources':len(sources),'changedArticles':len(edits),'unresolved':unresolved,'issues':dict(Counter(x['issue'] for x in unresolved)),'changes':edits}
    (cache/'application-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    stage = cache/'generated'
    stage.mkdir(exist_ok=True)
    for bid,j in generated.items():
        (stage/(bid+'.json')).write_text(json.dumps(j,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k not in ['unresolved','changes']},ensure_ascii=False,indent=2))
    if args.apply:
        if unresolved:
            raise SystemExit('REFUSED: unresolved source/scope failures; see application-report.json')
        expected = copy.deepcopy(data)
        for bid,gs in expected['leigroups'].items():
            for g in gs:
                original=next(x for x in before['leigroups'][bid] if x['id']==g['id'])
                for field in ['readTitle','readSourceUrl']:
                    if field not in original:
                        g.pop(field,None)
        assert expected == before, 'Only reading labels may change; priorities/calendar must remain untouched'
        for bid,j in generated.items():
            (ROOT/'leis'/(bid+'.json')).write_text(json.dumps(j,ensure_ascii=False,separators=(',',':')),encoding='utf8')
        html=(ROOT/'index.html').read_text(encoding='utf8')
        new_line='const DATA = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';'
        (ROOT/'index.html').write_text(html.replace(old_line,new_line,1),encoding='utf8')
        # Reproducible provenance without publishing large raw HTML/PDF caches.
        evidence={k:v for k,v in report.items() if k!='changes'}
        evidence['sourceManifest']=[{k:s.get(k) for k in ['url','finalUrl','retrievedAt','sha256','sourceKind']} for s in sources.values()]
        evidence['specialReview']=str((ROOT/'scripts/law-special-review.json').relative_to(ROOT)).replace('\\','/')
        (ROOT/'auditoria-lei-seca.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf8')


if __name__ == '__main__':
    main()
