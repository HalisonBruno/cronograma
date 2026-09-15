"""Split published reading groups that exceed CAP_DEVICES (the 15/09/2026 additions).

Usage: python scripts/split-long-groups.py [--apply]

Why: a group above 30 devices can pass 120 min at the learned reading pace; the
scheduler never places an item above the daily cap (LEI has no closing margin),
so the item stays queued forever and the completion forecast cannot finish.
The first generator run merged short tails without re-checking the cap.

What it does (dry run prints the plan; --apply writes):
- leis/<bid>.json and DATA.leigroups: each oversized group becomes 2+ groups of
  at most 30 devices, cut at article boundaries (balanced) or, for a single long
  article, into fractions "(k/n: first–last)" exactly like CF art. 5 / art. 84;
  texts are only re-cut, never edited; audit trail copied with a note.
- DATA.lgmig[bid]["g:<old>"] = [new ids]: a tick on the old group carries to the
  new ones (migrateV4), so nothing already marked is lost.
- scripts/law-additions-report.json (groups/labels/inc keys), auditoria-lei-seca.json
  (counts + additions entry) and scripts/law-splits-2026-09-15.json (old key -> new keys,
  consumed by the priority pipeline in the scratchpad).
"""
from __future__ import annotations
import copy, datetime as dt, hashlib, importlib.util, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('gen', ROOT / 'scripts/add-law-blocks.py')
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
CHECKED = '2026-09-15'
NEW_BLOCK = re.compile(r'^2026-09-15-\d\d+$')


def base_title(r: str) -> str:
    return re.split(r' — arts?\. ', r, maxsplit=1)[0]


def relabel(data, apply: bool):
    """Second pass (review of 15/09): titles of non-contiguous runs list the gaps (106, 125–126) and a
    fraction that ends on an inciso nested under a paragraph gets an explicit readTitle naming that
    paragraph ("caput–§ 10-B, II"); the sub keeps the form parsed by apply-law-refresh."""
    changed = 0
    for bid, metas in data['leigroups'].items():
        if not NEW_BLOCK.match(bid):
            continue
        path = ROOT / 'leis' / (bid + '.json')
        j = json.loads(path.read_text(encoding='utf8'))
        by_id = {g['id']: g for g in j['g']}
        # full article text per fraction label, in part order, to locate the paragraph enclosing each cut
        parts = {}
        for meta in metas:
            if meta.get('fa'):
                parts.setdefault(meta['fa'], []).append(meta)
        for meta in metas:
            g = by_id[meta['id']]
            if meta.get('x') or meta.get('rev') or meta.get('dir'):
                continue
            adct = 'ADCT ' in meta['sub']
            if meta.get('fa'):
                m = re.search(r'\((\d+)/(\d+): (.*?)[–—](.*?)\)$', meta['sub'])
                if not m:
                    continue
                k, n, first, last = int(m[1]), int(m[2]), m[3], m[4]
                seq = sorted(parts[meta['fa']], key=lambda x: int(re.search(r'\((\d+)/', x['sub'])[1]))
                labels = []
                for prev in seq[:k]:
                    text = by_id[prev['id']]['a'][0]['t']
                    labels += [gen.device_label(ln) for ln in text.split('\n') if gen.DEVICE.match(ln.strip())]
                title = gen.fraction_read_title(meta['sg'], {'label': meta['fa'], 'k': k, 'n': n, 'first': first, 'last': last, 'lastParent': gen.enclosing_paragraph(labels)}, adct)
                if title and meta.get('readTitle') != title:
                    meta['readTitle'] = title
                    changed += 1
                    print(bid, meta['id'], 'readTitle:', title)
            elif len(meta['a']) > 1 and ' — arts. ' in meta['r']:
                r = re.split(r' — arts\. ', meta['r'], maxsplit=1)[0] + ' — arts. ' + ', '.join(gen.compress_labels(meta['a']))
                if r != meta['r']:
                    print(bid, meta['id'], 'r:', meta['r'], '->', r)
                    meta['r'] = r
                    g['r'] = r
                    changed += 1
                    if apply:
                        path.write_text(json.dumps(j, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
        # oi (ordem de inclusão) volta a ser único dentro do bloco depois da divisão
        for i, meta in enumerate(metas):
            if meta.get('oi') != i:
                meta['oi'] = i
                changed += 1
    print(json.dumps({'relabelled': changed}))
    return changed


def main():
    apply = '--apply' in sys.argv
    data, old_line, html = gen.read_data()
    if '--relabel' in sys.argv:
        if relabel(data, apply) and apply:
            new_line = 'const DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
            (ROOT / 'index.html').write_text(html.replace(old_line, new_line, 1), encoding='utf8')
            print('APPLIED relabel')
        return
    all_gids = {g['id'] for gs in data['leigroups'].values() for g in gs}
    mapping, plan = {}, []
    files = {}
    for bid, metas in data['leigroups'].items():
        if not NEW_BLOCK.match(bid):
            continue
        path = ROOT / 'leis' / (bid + '.json')
        j = json.loads(path.read_text(encoding='utf8'))
        by_id = {g['id']: g for g in j['g']}
        visible_before = [m for m in metas if not m.get('x')]
        new_metas, new_groups, changed = [], [], False
        for meta in metas:
            g = by_id[meta['id']]
            if meta.get('x') or meta.get('rev') or meta.get('dir') or meta.get('d', 0) <= gen.CAP_DEVICES:
                new_metas.append(meta); new_groups.append(g); continue
            chunks = gen.split_chunk(g['a'], gen.CAP_DEVICES)
            assert len(chunks) > 1, (bid, meta['id'])
            adct = 'ADCT ' in meta['sub']
            old_key = f"lg2:{bid}:{meta['id']}" if len(visible_before) > 1 else f'st:{bid}'
            new_keys = []
            for chunk in chunks:
                arts_c, frac = chunk['arts'], chunk.get('frac')
                labels_c = [a['n'] for a in arts_c]
                d = sum(gen.devices(a['t']) for a in arts_c)
                assert d <= gen.CAP_DEVICES, (bid, meta['id'], d)
                seed = bid + '|' + meta['u'] + '|' + ','.join(labels_c) + (f"|{frac['k']}/{frac['n']}" if frac else '') + '|split'
                gid = hashlib.sha1(seed.encode('utf8')).hexdigest()[:6]
                while gid in all_gids:
                    seed += '#'; gid = hashlib.sha1(seed.encode('utf8')).hexdigest()[:6]
                all_gids.add(gid)
                r, sub = gen.chunk_labels(base_title(meta['r']), meta['sg'], chunk, False, adct)
                m2 = {**meta, 'r': r, 'sub': sub, 'a': labels_c, 'm': max(5, round(3 * d)), 'd': d, 'id': gid}
                m2.pop('fa', None)
                if frac:
                    m2['fa'] = frac['label']
                audit = copy.deepcopy(g['audit'])
                audit['notes'] = list(audit.get('notes', [])) + [f'Dividido em {len(chunks)} partes em {CHECKED} para respeitar o teto de {gen.CAP_DEVICES} dispositivos por grupo (120 min); texto apenas recortado, nunca editado.']
                new_metas.append(m2)
                new_groups.append({'id': gid, 'r': r, 'u': g['u'], 'a': arts_c, 'sub': sub, 'audit': audit})
                new_keys.append(f'lg2:{bid}:{gid}')
            data.setdefault('lgmig', {}).setdefault(bid, {})['g:' + meta['id']] = [k.split(':')[-1] for k in new_keys]
            mapping[old_key] = new_keys
            plan.append({'block': bid, 'old': meta['id'], 'devices': meta['d'], 'parts': [(m['sub'], m['d']) for m in new_metas[-len(chunks):]]})
            changed = True
        if changed:
            data['leigroups'][bid] = new_metas
            j['g'] = new_groups
            files[bid] = (path, j)
            for day in data['days']:
                for b in day['blocks']:
                    if b['id'] == bid:
                        b['min'] = sum(m['m'] for m in new_metas if not m.get('x'))
    for p in plan:
        print(p['block'], p['old'], p['devices'], '->', ' | '.join(f'{s} [{d}]' for s, d in p['parts']))
    print(json.dumps({'groupsSplit': len(plan), 'newGroups': sum(len(p['parts']) for p in plan)}))
    if not apply:
        return
    for bid, (path, j) in files.items():
        path.write_text(json.dumps(j, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    new_line = 'const DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
    (ROOT / 'index.html').write_text(html.replace(old_line, new_line, 1), encoding='utf8')
    report = json.loads((ROOT / 'scripts/law-additions-report.json').read_text(encoding='utf8'))
    for b in report['blocks']:
        if b['id'] in files:
            metas = [m for m in data['leigroups'][b['id']] if not m.get('x')]
            b['groups'] = len(metas)
            b['labels'] = [m['sub'] for m in metas]
    for old_key, new_keys in mapping.items():
        inc = report['inc'].pop(old_key)
        for k in new_keys:
            report['inc'][k] = inc
    report['summary']['groups'] = sum(b.get('groups', 0) for b in report['blocks'])
    report.setdefault('splits', []).append({'checkedAt': CHECKED, 'mapping': mapping})
    (ROOT / 'scripts/law-additions-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf8')
    ev = json.loads((ROOT / 'auditoria-lei-seca.json').read_text(encoding='utf8'))
    all_files = {p.stem: json.loads(p.read_text(encoding='utf8')) for p in (ROOT / 'leis').glob('*.json')}
    ev['files'] = len(all_files)
    ev['groups'] = sum(len(j['g']) for j in all_files.values())
    ev['articleOccurrences'] = sum(len(g['a']) for j in all_files.values() for g in j['g'])
    ev.setdefault('additions', []).append({'checkedAt': CHECKED, 'kind': 'split-long-groups', 'script': 'scripts/split-long-groups.py', 'groupsSplit': len(plan), 'newGroups': sum(len(p['parts']) for p in plan), 'capDevices': gen.CAP_DEVICES})
    (ROOT / 'auditoria-lei-seca.json').write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding='utf8')
    (ROOT / 'scripts/law-splits-2026-09-15.json').write_text(json.dumps({'checkedAt': CHECKED, 'capDevices': gen.CAP_DEVICES, 'mapping': mapping}, ensure_ascii=False, indent=1), encoding='utf8')
    print('APPLIED', len(files), 'law files;', len(plan), 'groups split')


if __name__ == '__main__':
    main()
