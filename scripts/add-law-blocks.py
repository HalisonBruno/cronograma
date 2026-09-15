"""Add reading blocks for exam-incidence gaps from captured official legislation.

Usage: python scripts/add-law-blocks.py [--apply] [--spec scripts/law-additions-2026-09-15.json]
Dry run (default) fetches, parses and reports; --apply writes leis/*.json, DATA
(days + leigroups), auditoria-lei-seca.json and scripts/law-additions-report.json.

Rules: every article text comes from a captured official page (sha256 in the
audit manifest); labels that do not resolve are dropped and listed, never
invented; articles already read in another plain group of the same law are
omitted; a group whose devices exceed 28 is split at article boundaries.
"""
from __future__ import annotations
import argparse, copy, datetime as dt, hashlib, importlib.util, json, re, sys
from pathlib import Path
from urllib.parse import urlparse
import requests

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('law', ROOT / 'scripts/refresh-law-sources.py')
law = importlib.util.module_from_spec(spec); spec.loader.exec_module(law)
CACHE = (ROOT.parent / 'law-refresh-audit').resolve()
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CronogramaLawAudit/1.1 (read-only official legislation verification)'


def fetch_official(url: str) -> dict:
    """Same evidence fields as refresh-law-sources.fetch_source, browser-like UA."""
    key = law.digest(url)[:16]
    result = {'url': url, 'key': key, 'retrievedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'status': 'unavailable'}
    if urlparse(url).hostname not in law.ALLOWED_HOSTS:
        return {**result, 'reason': 'non-official-or-unapproved-host'}
    (CACHE / 'raw').mkdir(parents=True, exist_ok=True)
    try:
        r = requests.get(url, timeout=(10, 40), headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'pt-BR,pt;q=0.9'})
        r.raise_for_status()
        if urlparse(r.url).hostname not in law.ALLOWED_HOSTS:
            raise ValueError('redirect outside official source allowlist')
        raw = r.content
        if len(raw) < 150:
            raise ValueError('unexpectedly short source')
        ext = '.pdf' if raw.startswith(b'%PDF') else '.html'
        target = CACHE / 'raw' / (key + ext)
        target.write_bytes(raw)
        result.update(status='fetched', finalUrl=r.url, httpStatus=r.status_code, contentType=r.headers.get('content-type', ''), sha256=law.digest(raw), bytes=len(raw), cacheFile=str(target), sourceKind='official-direct-page')
    except Exception as exc:
        result['reason'] = f'{type(exc).__name__}: {exc}'
    return result


def read_data():
    text = (ROOT / 'index.html').read_text(encoding='utf8')
    line = next(x for x in text.splitlines() if x.startswith('const DATA = '))
    return json.loads(line[13:-1]), line, text


def article_key(label: str):
    m = re.match(r'^(\d+)(?:-([A-Z]+))?$', label)
    return (int(m[1]), m[2] or '') if m else (10**9, label)


def devices(text: str) -> int:
    """caput + paragraphs + incisos (alineas not counted), the convention of the existing groups (3 min each)."""
    n = 0
    for ln in text.split('\n'):
        ln = ln.strip()
        if re.match(r'^(Art(?:igo)?\.?\s*\d|§|Par[áa]grafo [úu]nico|[IVXLCDM]+\s*[-–—])', ln):
            n += 1
    return max(1, n)


def fmt_sub(sg: str, labels: list[str], adct=False) -> str:
    nums = [article_key(l) for l in labels]
    # compress consecutive plain numbers into ranges; suffixed labels stay explicit
    parts = []
    i = 0
    while i < len(labels):
        j = i
        while j + 1 < len(labels) and nums[j][1] == '' and nums[j + 1][1] == '' and nums[j + 1][0] == nums[j][0] + 1:
            j += 1
        parts.append(labels[i] if i == j else f'{labels[i]}–{labels[j]}')
        i = j + 1
    prefix = 'art.' if len(labels) == 1 else 'arts.'
    return f'{sg} · {"ADCT " if adct else ""}{prefix} {", ".join(parts)}'


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--apply', action='store_true')
    cli.add_argument('--spec', type=Path, default=ROOT / 'scripts/law-additions-2026-09-15.json')
    args = cli.parse_args()
    S = json.loads(args.spec.read_text(encoding='utf8'))
    data, old_line, html = read_data()
    checked = S['checkedAt']
    urls = S['urls']
    # existing coverage per law url (plain groups only)
    covered = {}
    all_gids = set()
    for bid, gs in data['leigroups'].items():
        for g in gs:
            all_gids.add(g['id'])
            if g.get('x') or g.get('rev') or g.get('dir'):
                continue
            covered.setdefault(g.get('u', ''), set()).update(str(a) for a in g.get('a', []))
    # fetch + parse every needed url once
    needed = sorted({urls[g['lei']] for b in S['blocks'] for g in b['groups']})
    read_source = {urls[k]: v for k, v in S.get('readSource', {}).items()}   # official mirror when Planalto's page does not parse
    sources, parsed = {}, {}
    for u in needed:
        s = fetch_official(read_source.get(u, u))
        s['url'] = u
        sources[u] = s
        if s['status'] == 'fetched':
            parsed[u] = law.parse_html(Path(s['cacheFile']).read_bytes(), s['finalUrl'])
        print(('OK  ' if s['status'] == 'fetched' else 'FAIL'), u, s.get('finalUrl', s.get('reason', ''))[:80], file=sys.stderr)
    days = {d['d']: d for d in data['days']}
    last_day = {}
    for d in data['days']:
        for b in d['blocks']:
            last_day[b['mat']] = d['d']
    existing_ids = {b['id'] for d in data['days'] for b in d['blocks']}
    report = {'checkedAt': checked, 'blocks': [], 'skipped': [], 'dropped': [], 'inc': {}}
    new_files = {}
    for B in S['blocks']:
        if B['id'] in existing_ids:
            raise SystemExit('block id already exists: ' + B['id'])
        metas, groups, oi = [], [], 0
        for G in B['groups']:
            u = urls[G['lei']]
            if u not in parsed:
                report['skipped'].append({'block': B['id'], 'r': G['r'], 'reason': 'source-unavailable', 'url': u}); continue
            P = parsed[u]
            if 'range' in G:
                a, b = [int(x) for x in G['range'].split('-')]
                labels = []
                for n in range(a, b + 1):
                    for k in P['articles']:
                        m = re.match(r'^(\d+)(?:-([A-Z]+))?$', k)
                        # suffixed articles (10-A) enter only inside the range; at the last number
                        # only when the spec says so, never a whole chain like 167-A..167-Y
                        if m and int(m[1]) == n and (not m[2] or n < b or G.get('suffixes')):
                            labels.append(k)
                labels = sorted(set(labels), key=article_key)
            else:
                labels = list(G['list'])
            adct = bool(G.get('adct'))
            fresh = [l for l in labels if adct or l not in covered.get(u, set())]   # ADCT numbering is separate from the main text
            if not fresh:
                report['skipped'].append({'block': B['id'], 'r': G['r'], 'reason': 'already-covered', 'labels': labels}); continue
            if len(fresh) < len(labels):
                report['dropped'].append({'block': B['id'], 'r': G['r'], 'reason': 'already-covered', 'labels': [l for l in labels if l not in fresh]})
            arts, notes = [], []
            for label in fresh:
                occ = {'label': label, 'scope': ('ADCT ' if adct else '') + G['r'], 'url': u}
                cand, status = law.select_candidate(P, occ)
                if not cand:
                    report['dropped'].append({'block': B['id'], 'r': G['r'], 'label': label, 'reason': status}); continue
                if '�' in cand['text']:
                    report['dropped'].append({'block': B['id'], 'r': G['r'], 'label': label, 'reason': 'invalid-source-encoding'}); continue
                if status == 'source-warning-review-required':
                    notes.append(f'Art. {label}: {", ".join(cand["warnings"])} (texto mantido conforme a fonte; vigência conferir).')
                arts.append({'n': label, 't': cand['text'], 'v': [], 'sourceUrl': sources[u]['finalUrl'], 'sourceLinks': cand.get('links', [])})
            if not arts:
                report['skipped'].append({'block': B['id'], 'r': G['r'], 'reason': 'no-resolvable-article'}); continue
            # split by devices (cap 30) at article boundaries; a short leftover joins the previous chunk
            chunks, cur, cur_d = [], [], 0
            for a in arts:
                d = devices(a['t'])
                if cur and cur_d + d > 30:
                    chunks.append(cur); cur, cur_d = [], 0
                cur.append(a); cur_d += d
            if cur:
                chunks.append(cur)
            if len(chunks) > 1 and sum(devices(a['t']) for a in chunks[-1]) <= 10:
                chunks[-2].extend(chunks.pop())
            for ci, chunk in enumerate(chunks):
                labels_c = [a['n'] for a in chunk]
                d = sum(devices(a['t']) for a in chunk)
                m = max(5, round(3 * d))
                seed = B['id'] + '|' + u + '|' + ','.join(labels_c)
                gid = hashlib.sha1(seed.encode('utf8')).hexdigest()[:6]
                while gid in all_gids:
                    seed += '#'; gid = hashlib.sha1(seed.encode('utf8')).hexdigest()[:6]
                all_gids.add(gid)
                r = G['r'] if len(chunks) == 1 else f"{G['r']} — arts. {labels_c[0]}–{labels_c[-1]}" if len(labels_c) > 1 else f"{G['r']} — art. {labels_c[0]}"
                sub = fmt_sub(G['lei'], labels_c, adct)
                meta = {'r': r, 'sub': sub, 'u': u, 'a': labels_c, 'm': m, 'd': d, 'sg': G['lei'], 'nl': G['lei'], 'oi': oi, 'id': gid}
                if sources[u]['finalUrl'] != u:
                    meta['readSourceUrl'] = sources[u]['finalUrl']
                metas.append(meta); oi += 1
                audit = {'checkedAt': checked, 'status': 'source-reviewed', 'sourceUrl': sources[u]['finalUrl'], 'notes': ['Bloco criado em ' + checked + ' pela auditoria de incidência de banca (FGV/CP Iuris/Cebraspe).'] + notes, 'sourceHash': sources[u]['sha256'], 'retrievedAt': sources[u]['retrievedAt']}
                groups.append({'id': gid, 'r': r, 'u': u, 'a': chunk, 'sub': sub, 'audit': audit})
                key = f'lg2:{B["id"]}:{gid}'
                report['inc'][key] = G['inc']
        if not metas:
            report['skipped'].append({'block': B['id'], 'reason': 'no-groups'}); continue
        if len(metas) == 1:   # single visible group: the app keys it as st:<block>
            report['inc'][f'st:{B["id"]}'] = report['inc'].pop(f'lg2:{B["id"]}:{metas[0]["id"]}')
        block = {'id': B['id'], 'mat': B['mat'], 'tipo': 'LEI', 'min': sum(x['m'] for x in metas), 't': B['t'], 'det': B['det']}
        day = days[last_day[B['mat']]]
        report['blocks'].append({'id': B['id'], 'mat': B['mat'], 'day': day['d'], 'groups': len(metas), 'min': block['min'], 'labels': [x['sub'] for x in metas]})
        if args.apply:
            day['blocks'].append(block)
            data['leigroups'][B['id']] = metas
            new_files[B['id']] = {'id': B['id'], 'g': groups}
    # e-book chapters brought into the plan
    EB = {e['k']: e for e in data['ebooks']}
    ei = 0
    for E in S.get('ebooks', []):
        c = next((c for c in EB[E['eb']]['caps'] if c['n'] == E['cap']), None)
        if not c:
            report['skipped'].append({'ebook': E, 'reason': 'chapter-not-found'}); continue
        bid = f'2026-09-15-e{ei}'; ei += 1
        block = {'id': bid, 'mat': E['mat'], 'tipo': 'EBOOK', 'min': (c['pf'] - c['pi'] + 1) * 2, 't': f"E-book {EB[E['eb']]['nome']} — p. {c['pi']}-{c['pf']}", 'det': f"Cap.{c['n']} {c['t']}. Incluído no plano em {checked}: {E['why']}.", 'eb': E['eb'], 'pg': [c['pi'], c['pf']]}
        report['blocks'].append({'id': bid, 'mat': E['mat'], 'day': last_day[E['mat']], 'ebook': E['eb'], 'cap': c['n'], 'min': block['min']})
        report['inc'][f"eb:{E['eb']}:{c['n']}"] = E['inc']
        if args.apply:
            days[last_day[E['mat']]]['blocks'].append(block)
    report['summary'] = {'blocks': len(report['blocks']), 'groups': sum(b.get('groups', 0) for b in report['blocks']), 'skipped': len(report['skipped']), 'dropped': len(report['dropped'])}
    (ROOT / 'scripts/law-additions-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf8')
    print(json.dumps(report['summary'], ensure_ascii=False))
    for s in report['skipped']:
        print('SKIP', json.dumps(s, ensure_ascii=False)[:160])
    if args.apply:
        for bid, j in new_files.items():
            (ROOT / 'leis' / (bid + '.json')).write_text(json.dumps(j, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
        new_line = 'const DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
        (ROOT / 'index.html').write_text(html.replace(old_line, new_line, 1), encoding='utf8')
        ev = json.loads((ROOT / 'auditoria-lei-seca.json').read_text(encoding='utf8'))
        files = {p.stem: json.loads(p.read_text(encoding='utf8')) for p in (ROOT / 'leis').glob('*.json')}
        ev['files'] = len(files)
        ev['groups'] = sum(len(j['g']) for j in files.values())
        ev['articleOccurrences'] = sum(len(g['a']) for j in files.values() for g in j['g'])
        known = {s['url'] for s in ev['sourceManifest']}
        for u, s in sources.items():
            if s['status'] == 'fetched' and u not in known:
                ev['sourceManifest'].append({k: s.get(k) for k in ['url', 'finalUrl', 'retrievedAt', 'sha256', 'sourceKind']})
        ev['sources'] = len(ev['sourceManifest'])
        ev.setdefault('additions', []).append({'checkedAt': checked, 'spec': str(args.spec.relative_to(ROOT)).replace('\\', '/'), 'report': 'scripts/law-additions-report.json', 'blocks': report['summary']['blocks'], 'groups': report['summary']['groups'], 'sourcesRefetched': [{'url': u, 'sha256': s.get('sha256'), 'retrievedAt': s.get('retrievedAt')} for u, s in sources.items() if s['status'] == 'fetched']})
        (ROOT / 'auditoria-lei-seca.json').write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding='utf8')
        print('APPLIED', len(new_files), 'law files')


if __name__ == '__main__':
    main()
