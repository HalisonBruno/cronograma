"""Retrieve official Camara consolidated legislation when Planalto is unavailable.

This script only writes raw evidence and retrieval manifests under --out. It does
not certify legal currency or modify the app. Discovery follows official search
results and official "Texto Atualizado" links; originals remain marked original.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import importlib.util
import json
import re
from pathlib import Path
from urllib.parse import urlparse, urljoin
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
HOSTS = {'www.camara.leg.br', 'www2.camara.leg.br', 'atos.cnj.jus.br', 'www.tst.jus.br', 'www.planalto.gov.br', 'planalto.gov.br'}
# Numbers of decrees repeat across periods. A number-only match can silently
# select an Imperial decree instead of the modern human-rights treaty.
SPECIAL_YEARS = {
    ('declei', '2848'): '1940', ('declei', '4657'): '1942',
    ('declei', '3689'): '1941', ('declei', '5452'): '1943',
    ('declei', '3365'): '1941', ('declei', '25'): '1937',
    ('decret', '678'): '1992', ('decret', '592'): '1992',
    ('decret', '57663'): '1966', ('decret', '20910'): '1932',
    ('leicom', '35'): '1979', ('leicom', '123'): '2006',
}
CONSTITUTION = 'https://www2.camara.leg.br/legin/fed/consti/1988/constituicao-1988-5-outubro-1988-322142-normaatualizada-pl.html'

def digest(s):
    return hashlib.sha256(s.encode('utf8') if isinstance(s, str) else s).hexdigest()

def get(url):
    if urlparse(url).hostname not in HOSTS:
        raise ValueError('Non-official URL: ' + url)
    r = requests.get(url, timeout=(8, 22), headers={'User-Agent': 'Mozilla/5.0 LawReadingAudit/1.0'})
    r.raise_for_status()
    if urlparse(r.url).hostname not in HOSTS:
        raise ValueError('Non-official redirect: ' + r.url)
    return r

def soup_of(r):
    # Camara publishes both UTF-8 and Windows-1252; BeautifulSoup detects the
    # declared charset from bytes and preserves paragraph/break markup.
    return BeautifulSoup(r.content, 'html.parser')

def details(url):
    path = urlparse(url).path.lower()
    fname = path.split('/')[-1]
    if 'constituicao' in path:
        return {'special': 'constitution'}
    if 'atos.cnj' in url:
        return {'special': 'cnj'}
    if not url:
        return {'special': 'tst'}
    year = re.search(r'/(\d{4})/', path)
    if '/decreto-lei/' in path:
        typ, pat = 'declei', r'del0*([\d.]+)'
    elif '/lcp/' in path:
        typ, pat = 'leicom', r'lcp0*([\d.]+)'
    elif '/decreto/' in path:
        typ, pat = 'decret', r'(?:an|d)0*([\d.]+)'
    else:
        typ, pat = 'lei', r'l0*([\d.]+)'
    match = re.match(pat, fname)
    if not match:
        raise ValueError('Unknown law identifier: ' + url)
    num = match[1].rstrip('.').replace('.', '')
    return {'type': typ, 'number': num, 'year': year[1] if year else SPECIAL_YEARS.get((typ, num))}

def validate_content(original_url, final_url, raw):
    """Check transport payload and norm identity, not legal correctness."""
    if len(raw) < 300 or re.search(br'(?:<title>|<h1>)\s*(?:50[0-9]|40[0-9]|Gateway|Access Denied)', raw, re.I):
        raise ValueError('Official URL returned an error page, not legislation')
    d = details(original_url)
    if d.get('special'):
        return {'kind': d['special'], 'status': 'special-source-requires-review'}
    file_pattern = (r'/(?:lei|decreto-lei|decreto|leicomplementar)-' + re.escape(d['number'])
                    + r'-\d{1,2}-[a-z]+-(\d{4})-\d+-')
    identity = re.search(file_pattern, urlparse(final_url).path)
    if not identity or d.get('year') and identity[1] != d['year']:
        raise ValueError('Norm identity/year mismatch: ' + final_url + ' expected ' + str(d))
    if not raw.startswith(b'%PDF'):
        parsed = BeautifulSoup(raw, 'html.parser')
        text = re.sub(r'\s+', ' ', parsed.get_text(' ', strip=True))
        if not re.search(r'\bArt(?:igo)?\.?\s*1\b', text, re.I):
            raise ValueError('No opening article in official content: ' + final_url)
        # Verify a legal header in the actual response in addition to its URL.
        num_pattern = r'\.?'.join(re.escape(c) for c in d['number'])
        header = re.search(r'\b(?:LEI(?:\s+COMPLEMENTAR)?|DECRETO(?:[- ]LEI)?)\s*(?:N[º°oO.]*\s*)?'
                           + num_pattern + r'\s*,?\s*DE\s*\d{1,2}\s*DE\s*[A-ZÇÃÉ]+\s*DE\s*' + identity[1], text, re.I)
        if not header:
            raise ValueError('Norm header missing from response: ' + final_url)
    return {**d, 'year': identity[1], 'status': 'number-year-and-header-checked'}

def discover(url):
    d = details(url)
    if d.get('special') == 'cnj':
        return url, 'official-consolidated-page', None, None
    if d.get('special') == 'constitution':
        return CONSTITUTION, 'camara-texto-atualizado', None, None
    if d.get('special'):
        raise ValueError('Special source needs explicit official URL: ' + d['special'])
    params = {'abrangencia': 'Legislação Federal', 'numero': d['number']}
    if d.get('year'):
        params['ano'] = d['year']
    query = requests.Request('GET', 'https://www.camara.leg.br/legislacao/busca', params=params).prepare().url
    result = get(query)
    soup = soup_of(result)
    type_name = {'lei': 'lei', 'declei': 'decreto-lei', 'decret': 'decreto', 'leicom': 'leicomplementar'}[d['type']]
    year_part = d['year'] if d.get('year') else r'\d{4}'
    pattern = re.compile(r'/legin/fed/' + d['type'] + r'/[^/]+/' + type_name + '-' + d['number']
                         + r'-\d{1,2}-[a-z]+-' + year_part + r'-\d+-norma-(?:pl|pe)\.html$')
    links = list(dict.fromkeys(urljoin(result.url, a['href']) for a in soup.select('a[href]') if pattern.search(a['href'])))
    if len(links) != 1:
        raise ValueError('Expected one official norm, got ' + str(links))
    norm = get(links[0])
    ns = soup_of(norm)
    candidates = [(a.get_text(' ', strip=True), urljoin(norm.url, a['href'])) for a in ns.select('a[href]')]
    updated = list(dict.fromkeys(u for t, u in candidates if re.search(r'normaatualizada-(?:pl|pe)\.html$', u)))
    original = list(dict.fromkeys(u for t, u in candidates if 'publicacaooriginal' in u and u.endswith('.html')))
    if len(updated) == 1:
        return updated[0], 'camara-texto-atualizado', norm, query
    if not updated and len(original) == 1:
        return original[0], 'camara-publicacao-original-review-required', norm, query
    raise ValueError('No unambiguous updated/original text links: ' + str(candidates))

def fetch(url, out, explicit=None):
    key = digest(url)[:16]
    item = {'url': url, 'key': key, 'retrievedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'status': 'unavailable'}
    try:
        if explicit:
            target, source_kind, norm, query = explicit, 'official-explicit-source-review-required', None, None
        else:
            target, source_kind, norm, query = discover(url)
        r = get(target)
        if not r.content.startswith(b'%PDF'):
            compilations = [urljoin(r.url,a['href']) for a in soup_of(r).select('a[href]')
                            if re.search(r'texto\s+compilado',a.get_text(' ',strip=True),re.I)]
            compilations = list(dict.fromkeys(u for u in compilations if urlparse(u).hostname in HOSTS and u.lower()!=r.url.lower()))
            if len(compilations)==1:
                r = get(compilations[0])
        raw = r.content
        identity = validate_content(url, r.url, raw)
        ext = '.pdf' if raw.startswith(b'%PDF') else '.html'
        file = out / 'raw' / (key + ext)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(raw)
        if norm is not None:
            (out / 'raw' / (key + '.norma.html')).write_bytes(norm.content)
        parsed = soup_of(r) if ext == '.html' else None
        text = parsed.get_text(' ', strip=True) if parsed else ''
        notes = []
        if parsed:
            for tag in parsed.find_all(['p', 'div', 'td']):
                if tag.find(['p', 'div', 'td']):
                    continue
                t = re.sub(r'\s+', ' ', tag.get_text(' ', strip=True))
                if re.search(r'(202[56]|vig[eê]ncia|revoga[çc][ãa]o)', t, re.I) and len(t) < 2500:
                    notes.append(t)
        return {**item, 'status': 'fetched', 'finalUrl': r.url, 'sourceKind': source_kind, 'searchUrl': query,
                'normUrl': norm.url if norm is not None else None, 'httpStatus': r.status_code,
                'contentType': r.headers.get('Content-Type', ''), 'sha256': digest(raw), 'bytes': len(raw),
                'cacheFile': str(file), 'encoding': parsed.original_encoding if parsed else None,
                'title': parsed.title.get_text(' ', strip=True) if parsed and parsed.title else None,
                'identity': identity,
                'currentLegislationNotes': notes,
                'reviewStatus': 'retrieved-not-legally-certified'}
    except Exception as exc:
        return {**item, 'reason': f'{type(exc).__name__}: {exc}'}


def fetch_direct(url, out):
    key = digest(url)[:16]
    try:
        if not url:
            raise ValueError('Special source without URL')
        target = url.replace('l7347orig.htm', 'l7347compilada.htm')
        r = get(target)
        if not r.content.startswith(b'%PDF'):
            compilations = [urljoin(r.url,a['href']) for a in soup_of(r).select('a[href]')
                            if re.search(r'texto\s+compilado',a.get_text(' ',strip=True),re.I)]
            compilations = list(dict.fromkeys(u for u in compilations if urlparse(u).hostname in HOSTS and u.lower()!=r.url.lower()))
            if len(compilations)==1:
                r = get(compilations[0])
        raw = r.content
        if len(raw) < 300 or re.search(br'(?:<title>|<h1>)\s*(?:50[0-9]|40[0-9]|Gateway|Access Denied)', raw, re.I):
            raise ValueError('Error payload instead of legislation')
        if not raw.startswith(b'%PDF'):
            text = soup_of(r).get_text(' ', strip=True)
            if not re.search(r'Art(?:igo)?\.?\s*\d', text, re.I):
                raise ValueError('No legislation articles in payload')
        ext = '.pdf' if raw.startswith(b'%PDF') else '.html'
        file = out / 'raw' / (key + ext)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(raw)
        return {'url': url, 'key': key, 'status': 'fetched', 'finalUrl': r.url,
                'retrievedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'sourceKind': 'official-direct-page', 'httpStatus': r.status_code,
                'contentType': r.headers.get('Content-Type', ''), 'sha256': digest(raw),
                'bytes': len(raw), 'cacheFile': str(file), 'reviewStatus': 'retrieved-not-legally-certified'}
    except Exception:
        return fetch(url, out)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=ROOT.parent / 'law-refresh-audit')
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--retry', action='store_true')
    parser.add_argument('--explicit', type=Path)
    parser.add_argument('--revalidate', action='store_true')
    parser.add_argument('--direct-first', action='store_true')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    initial_file = args.out / 'sources.json'
    if not initial_file.exists():
        spec = importlib.util.spec_from_file_location('law_inventory', ROOT / 'scripts' / 'refresh-law-sources.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        initial_file.write_text(json.dumps([{'url': url} for url in module.read_inventory()['sources']], ensure_ascii=False, indent=2), encoding='utf8')
    initial = json.loads(initial_file.read_text(encoding='utf8'))
    manifest_file = args.out / 'mirror-sources.json'
    previous = {s['url']: s for s in json.loads(manifest_file.read_text(encoding='utf8'))} if manifest_file.exists() else {}
    explicit = json.loads(args.explicit.read_text(encoding='utf8')) if args.explicit else {}
    if args.revalidate:
        for item in previous.values():
            if item['status'] != 'fetched':
                continue
            try:
                item['identity'] = validate_content(item['url'], item['finalUrl'], Path(item['cacheFile']).read_bytes())
            except Exception as exc:
                item.update(status='unavailable', reason=f'Validation failed: {exc}')
        manifest_file.write_text(json.dumps(list(previous.values()), ensure_ascii=False, indent=2), encoding='utf8')
    todo = [s['url'] for s in initial if s['url'] not in previous or args.retry and previous[s['url']]['status'] != 'fetched']
    def task(u):
        return fetch_direct(u, args.out) if args.direct_first and u not in explicit else fetch(u, args.out, explicit.get(u))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for item in pool.map(task, todo):
            previous[item['url']] = item
            manifest_file.write_text(json.dumps(list(previous.values()), ensure_ascii=False, indent=2), encoding='utf8')
            print(item['status'], item['url'], item.get('finalUrl', item.get('reason', '')), flush=True)
    print('Fetched:', sum(s['status'] == 'fetched' for s in previous.values()), '/', len(initial))

if __name__ == '__main__':
    main()
