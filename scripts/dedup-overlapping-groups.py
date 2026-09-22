"""Hide reading groups that repeat devices already in another visible group (review of 22/09/2026).

Usage: python scripts/dedup-overlapping-groups.py [--apply]

Why: the scheduler only drops a law group when its signature (source + articles + fraction label) is
identical to one already placed. Overlapping cuts of the same text passed that check and were read twice:
- Lei 14.133 art. 6 (block 2026-08-28-0): 24d17a (caput–XXIX) repeated 323683 (caput–XV) + d75476 (XVI–XXII);
- CF art. 7: whole article in 2026-09-04-0 (Const. Trabalho) and again in 2026-09-28-0 (Constitucional),
  cut at different points (caput–XXIV / XXV–p.u. against caput–XVII / XVIII–p.u.);
- CDC art. 103: in 2026-09-29-0~2 (Civil, arts. 103–104) and in 2026-10-07-0~2 (Proc. Civil, arts. 81–82, 103).

What it does (dry run prints the plan; --apply writes):
- the redundant group gets x:1 (hidden, kept in the file). Where the hidden group also held devices that no
  other group has, those devices become a new group re-cut from its own text (lines or whole articles are
  copied verbatim; the script asserts every overlap line by line, nothing is typed or edited);
- art. 7 stays in Const. Trabalho (the article is the core of that subject); its first part is re-cut at XVII|XVIII
  so every old cut is an exact union of the visible ones and a tick carries without crediting unread devices;
- DATA.lgmig[bid]["d:<hidden>"] = visible groups the hidden one covers entirely ("<bid>:<gid>" when in
  another block): migrateV4 carries a manual tick to the ones not yet studied (see the app);
- the old sibling links g:919931 <-> g:b61e3d (a tick on one fraction marked the other) are removed, so a tick on
  XXV–p.u. can no longer reach caput–XXIV through the hidden group;
- fraction labels renumbered (k/n) where a part was added; block minutes = sum of visible groups;
  DATA.inc of each new group = inc of the group it was cut from; DATA.prio.versao + 1 (plan re-applied once,
  marcoDesde untouched); audit counts; scripts/law-overlaps-2026-09-22.json records every change.
"""
from __future__ import annotations
import copy, hashlib, importlib.util, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('gen', ROOT / 'scripts/add-law-blocks.py')
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
CHECKED = '2026-09-22'
RECORD = ROOT / 'scripts/law-overlaps-2026-09-22.json'


def lines(g):
    return [ln for a in g['a'] for ln in a['t'].split('\n')]


def new_id(seed, taken):
    gid = hashlib.sha1(seed.encode('utf8')).hexdigest()[:6]
    while gid in taken:
        seed += '#'
        gid = hashlib.sha1(seed.encode('utf8')).hexdigest()[:6]
    taken.add(gid)
    return gid


def main():
    apply = '--apply' in sys.argv
    data, old_line, html = gen.read_data()
    if RECORD.exists():
        sys.exit('already applied: ' + str(RECORD.relative_to(ROOT)))
    files = {bid: json.loads((ROOT / 'leis' / (bid + '.json')).read_text(encoding='utf8'))
             for bid in ('2026-08-28-0', '2026-09-04-0', '2026-09-28-0', '2026-09-29-0~2', '2026-10-07-0~2')}
    taken = {g['id'] for gs in data['leigroups'].values() for g in gs}
    record = {'checkedAt': CHECKED, 'script': 'scripts/dedup-overlapping-groups.py',
              'rule': 'Cada dispositivo visivel fica em um unico grupo visivel; o grupo que repetia leitura fica oculto (x) e o que so ele tinha vira grupo recortado do proprio texto, sem edicao.',
              'hidden': [], 'created': [], 'relabeled': [], 'lgmig': {'added': {}, 'removed': {}}, 'blockMinutes': {}}

    def meta(bid, gid):
        return next(m for m in data['leigroups'][bid] if m['id'] == gid)

    def grp(bid, gid):
        return next(g for g in files[bid]['g'] if g['id'] == gid)

    def hide(bid, gid, reason):
        m = meta(bid, gid)
        assert not m.get('x') and not m.get('rev') and not m.get('dir'), (bid, gid)
        m['x'] = 1
        record['hidden'].append({'block': bid, 'id': gid, 'sub': m['sub'], 'm': m['m'], 'reason': reason})

    def relabel(bid, gid, sub, r=None):
        m, g = meta(bid, gid), grp(bid, gid)
        entry = {'block': bid, 'id': gid, 'sub': [m['sub'], sub]}
        m['sub'] = g['sub'] = sub
        if r is not None:
            entry['r'] = [m['r'], r]
            m['r'] = g['r'] = r
        record['relabeled'].append(entry)

    def create(bid, parent, after, arts, sub, r, a_labels, fa, note, source):
        """New group right after `after`, articles copied from the parent group (text already sliced verbatim)."""
        pm, pg = meta(bid, parent), grp(bid, parent)
        d = sum(gen.devices(a['t']) for a in arts)
        assert d <= gen.CAP_DEVICES, (bid, parent, d)
        gid = new_id(f"{bid}|{pm['u']}|{','.join(a_labels)}|{sub}|dedup", taken)
        m = {k: v for k, v in pm.items() if k not in ('x', 'fa', 'readTitle')}
        m.update({'r': r, 'sub': sub, 'a': a_labels, 'd': d, 'm': max(5, round(3 * d)), 'id': gid})
        if fa:
            m['fa'] = fa
        audit = copy.deepcopy(pg['audit'])
        audit['notes'] = list(audit.get('notes', [])) + [note]
        g = {'id': gid, 'r': r, 'u': pg['u'], 'a': arts, 'sub': sub, 'audit': audit}
        metas, groups = data['leigroups'][bid], files[bid]['g']
        metas.insert(next(i for i, x in enumerate(metas) if x['id'] == after) + 1, m)
        groups.insert(next(i for i, x in enumerate(groups) if x['id'] == after) + 1, g)
        inc = data['inc'].get(f'lg2:{bid}:{parent}')
        if inc is not None:
            data['inc'][f'lg2:{bid}:{gid}'] = inc
        record['created'].append({'block': bid, 'id': gid, 'from': parent, 'sub': sub, 'd': d, 'm': m['m'], 'source': source, 'inc': inc})
        return gid

    def link(bid, key, targets):
        data['lgmig'].setdefault(bid, {})
        assert key not in data['lgmig'][bid], (bid, key)
        data['lgmig'][bid][key] = targets
        record['lgmig']['added'].setdefault(bid, {})[key] = targets

    # ---- 1. Lei 14.133 art. 6: 24d17a (caput–XXIX) = 323683 + d75476 + XXIII–XXIX ----
    bid = '2026-08-28-0'
    big, p1, p2 = lines(grp(bid, '24d17a')), lines(grp(bid, '323683')), lines(grp(bid, 'd75476'))
    assert big[:len(p1)] == p1 and big[len(p1):len(p1) + len(p2)] == p2, 'art. 6: caput–XXII must repeat verbatim'
    rest = big[len(p1) + len(p2):]
    assert rest[0].startswith('XXIII -') and rest[-1].startswith('XXIX -'), rest[0][:20]
    art = grp(bid, '24d17a')['a']
    assert len(art) == 1
    hide(bid, '24d17a', 'caput–XXII repetia 323683 e d75476 (~93 min lidos duas vezes)')
    n3 = create(bid, '24d17a', '24d17a', [{**art[0], 'n': '6', 't': '\n'.join(rest)}],
                'Lei 14.133 · art. 6 (3/5: XXIII–XXIX)', meta(bid, '24d17a')['r'], ['6'], '6',
                f'Recortado em {CHECKED} do grupo 24d17a (caput–XXIX), que repetia caput–XXII de outros grupos; texto apenas recortado, nunca editado.',
                {'group': '24d17a', 'lines': [len(p1) + len(p2), len(big)]})
    for gid, sub in [('323683', '(1/5: caput–XV)'), ('d75476', '(2/5: XVI–XXII)'), ('8810fa', '(4/5: XXX–XXXVII)'), ('982575', '(5/5: XXXVIII–LX)')]:
        relabel(bid, gid, 'Lei 14.133 · art. 6 ' + sub)
    link(bid, 'd:24d17a', ['323683', 'd75476', n3])

    # ---- 2. CF art. 7: stays in Const. Trabalho, cut caput–XVII | XVIII–XXIV | XXV–p.u. ----
    bt, bc = '2026-09-04-0', '2026-09-28-0'
    t1, t2 = lines(grp(bt, '919931')), lines(grp(bt, 'b61e3d'))
    c1, c2 = lines(grp(bc, '2a34bf')), lines(grp(bc, 'a8537d'))
    assert t1 + t2 == c1 + c2, 'art. 7 must be the same text in both blocks'
    assert t1[:len(c1)] == c1 and t1[len(c1):] + t2 == c2
    assert t1[len(c1)].startswith('XVIII -') and t1[-1].startswith('XXIV -')
    art = grp(bt, '919931')['a']
    assert len(art) == 1
    hide(bt, '919931', 'recortado em caput–XVII e XVIII–XXIV para que cada leitura antiga do art. 7 corresponda a grupos inteiros')
    base = meta(bt, '919931')['r']
    na = create(bt, '919931', '919931', [{**art[0], 't': '\n'.join(c1)}], 'CF · art. 7 (1/3: caput e I–XVII)',
                base + ' — art. 7 (1/3: caput e I–XVII)', ['7'], '7',
                f'Recortado em {CHECKED} do grupo 919931 (caput–XXIV) no ponto em que o art. 7 era dividido em outro bloco; texto apenas recortado, nunca editado.',
                {'group': '919931', 'lines': [0, len(c1)]})
    nb = create(bt, '919931', na, [{**art[0], 't': '\n'.join(t1[len(c1):])}], 'CF · art. 7 (2/3: XVIII–XXIV)',
                base + ' — art. 7 (2/3: XVIII–XXIV)', ['7'], '7',
                f'Recortado em {CHECKED} do grupo 919931 (caput–XXIV) no ponto em que o art. 7 era dividido em outro bloco; texto apenas recortado, nunca editado.',
                {'group': '919931', 'lines': [len(c1), len(t1)]})
    relabel(bt, 'b61e3d', 'CF · art. 7 (3/3: XXV–Parágrafo único)', base + ' — art. 7 (3/3: XXV–Parágrafo único)')
    hide(bc, '2a34bf', 'art. 7 inteiro já está no bloco de Const. Trabalho (2026-09-04-0)')
    hide(bc, 'a8537d', 'art. 7 inteiro já está no bloco de Const. Trabalho (2026-09-04-0)')
    # a tick on one fraction must not mark the sibling any more (it would reach the new parts through 919931)
    for key in ('g:919931', 'g:b61e3d'):
        record['lgmig']['removed'].setdefault(bt, {})[key] = data['lgmig'][bt].pop(key)
    link(bt, 'd:919931', [na, nb])
    link(bc, 'd:2a34bf', [f'{bt}:{na}'])
    link(bc, 'd:a8537d', [f'{bt}:{nb}', f'{bt}:b61e3d'])

    # ---- 3. CDC art. 103: stays with art. 104 (Civil); Proc. Civil keeps arts. 81–82 ----
    bcv, bpc = '2026-09-29-0~2', '2026-10-07-0~2'
    a103 = next(a for a in grp(bcv, '28bfae')['a'] if a['n'] == '103')
    arts = grp(bpc, 'a49af4')['a']
    assert [a['n'] for a in arts] == ['81', '82', '103'] and arts[2]['t'] == a103['t'], 'CDC art. 103 must be the same text'
    hide(bpc, 'a49af4', 'art. 103 já está com o art. 104 no bloco de Civil (28bfae)')
    nc = create(bpc, 'a49af4', 'a49af4', copy.deepcopy(arts[:2]), 'CDC · arts. 81–82', meta(bpc, 'a49af4')['r'], ['81', '82'], None,
                f'Recortado em {CHECKED} do grupo a49af4 (arts. 81–82, 103) sem o art. 103, que já é lido com o art. 104; artigos copiados inteiros, sem edição.',
                {'group': 'a49af4', 'articles': ['81', '82']})
    link(bpc, 'd:a49af4', [nc])

    # ---- block minutes, version, audit counts ----
    for day in data['days']:
        for b in day['blocks']:
            if b['id'] in files and b['id'] in data['leigroups']:
                new_min = sum(m['m'] for m in data['leigroups'][b['id']] if not m.get('x'))
                if new_min != b['min']:
                    record['blockMinutes'][b['id']] = [b['min'], new_min]
                    b['min'] = new_min
    record['prioVersao'] = [data['prio']['versao'], data['prio']['versao'] + 1]
    data['prio']['versao'] += 1
    record['minutesSaved'] = sum(h['m'] for h in record['hidden']) - sum(c['m'] for c in record['created'])
    print(json.dumps(record, ensure_ascii=False, indent=1))
    if not apply:
        return
    for bid, j in files.items():
        (ROOT / 'leis' / (bid + '.json')).write_text(json.dumps(j, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    new_line = 'const DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
    (ROOT / 'index.html').write_text(html.replace(old_line, new_line, 1), encoding='utf8')
    ev = json.loads((ROOT / 'auditoria-lei-seca.json').read_text(encoding='utf8'))
    all_files = {p.stem: json.loads(p.read_text(encoding='utf8')) for p in (ROOT / 'leis').glob('*.json')}
    ev['groups'] = sum(len(j['g']) for j in all_files.values())
    ev['articleOccurrences'] = sum(len(g['a']) for j in all_files.values() for g in j['g'])
    ev.setdefault('additions', []).append({'checkedAt': CHECKED, 'kind': 'dedup-overlapping-groups', 'script': 'scripts/dedup-overlapping-groups.py',
                                           'hidden': len(record['hidden']), 'newGroups': len(record['created']), 'minutesSaved': record['minutesSaved']})
    (ROOT / 'auditoria-lei-seca.json').write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding='utf8')
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding='utf8')
    print('APPLIED', len(files), 'law files;', len(record['hidden']), 'hidden;', len(record['created']), 'new')


if __name__ == '__main__':
    main()
