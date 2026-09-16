"""Remove every revision from the plan (user rule of 16/09/2026: revisions belong to another project,
driven by question performance, never to this schedule).

Usage: python scripts/remove-revisions.py [--apply]

What it does (dry run prints; --apply writes index.html and scripts/revisions-removed-2026-09-16.json):
- law groups flagged `rev` become hidden (`x:1`): the text stays in leis/*.json for the other
  project, the app never shows them again; a group whose articles have NO first reading anywhere
  is not a revision at all: it becomes a plain reading (rev dropped, minutes at 3 min/device);
- LEI blocks left without any visible group are deleted from the calendar;
- REV blocks that are revisions (Fecho (erros + flashcards), Fecho da semana, Correção comentada
  do último simulado, Véspera: revisão leve) are deleted; the simulado correction session, the
  final checklists and the active rest before the exam stay;
- block minutes are recomputed from the visible groups; DATA.prio.versao is bumped so the plan is
  rebuilt once on the next cloud load (ticks, dates of done items and settings untouched).
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECKED = '2026-09-16'
REV_BLOCK = re.compile(r'^(Fecho\b|Correção comentada do último simulado|Véspera: revisão)', re.I)


def read_data():
    text = (ROOT / 'index.html').read_text(encoding='utf8')
    line = next(x for x in text.splitlines() if x.startswith('const DATA = '))
    return json.loads(line[13:-1]), line, text


def main():
    apply = '--apply' in sys.argv
    data, old_line, html = read_data()
    blocks = {b['id']: b for d in data['days'] for b in d['blocks']}
    # first readings: (url, article) covered by a plain visible group anywhere
    plain = set()
    for bid, gs in data['leigroups'].items():
        for g in gs:
            if g.get('x') or g.get('rev') or g.get('dir'):
                continue
            for a in g.get('a', []):
                plain.add((g.get('u', ''), str(a)))
    hidden, converted = [], []
    visible_before = {bid: sum(1 for g in gs if not g.get('x')) for bid, gs in data['leigroups'].items()}
    for bid, gs in data['leigroups'].items():
        for g in gs:
            if g.get('x') or not g.get('rev'):
                continue
            missing = [a for a in g.get('a', []) if (g.get('u', ''), str(a)) not in plain]
            if missing:
                g.pop('rev', None)
                if g.get('d'):
                    g['m'] = max(5, round(3 * g['d']))
                for k in ('sub', 'r'):
                    if isinstance(g.get(k), str):
                        g[k] = re.sub(r'\s*\(revisão\)', '', g[k])
                converted.append({'block': bid, 'id': g['id'], 'sub': g['sub'], 'm': g['m'], 'onlyReadingOf': missing})
                for a in g.get('a', []):
                    plain.add((g.get('u', ''), str(a)))
            else:
                g['x'] = 1
                hidden.append({'block': bid, 'id': g['id'], 'sub': g['sub'], 'm': g.get('m')})
    # blocks: recompute minutes; delete LEI blocks with nothing visible; delete revision REV blocks
    deleted = []
    for d in data['days']:
        keep = []
        for b in d['blocks']:
            if b['tipo'] == 'LEI' and b['id'] in data['leigroups']:
                visible = [g for g in data['leigroups'][b['id']] if not g.get('x')]
                # only blocks emptied BY this pass go away; blocks that were already empty stay as they were
                if not visible and visible_before.get(b['id'], 0) > 0:
                    deleted.append({'id': b['id'], 'day': d['d'], 'mat': b['mat'], 't': b['t'], 'min': b.get('min'), 'why': 'only revision groups'}); continue
                if visible:
                    b['min'] = sum(int(g.get('m') or 0) for g in visible)
            if b['tipo'] == 'REV' and REV_BLOCK.match(b.get('t', '')):
                deleted.append({'id': b['id'], 'day': d['d'], 'mat': b['mat'], 't': b['t'], 'min': b.get('min'), 'why': 'revision block'}); continue
            keep.append(b)
        d['blocks'] = keep
    data['prio']['versao'] = int(data['prio'].get('versao', 1)) + 1
    summary = {'hiddenGroups': len(hidden), 'convertedGroups': len(converted), 'deletedBlocks': len(deleted),
               'deletedMinutes': sum(int(x.get('min') or 0) for x in deleted), 'prioVersao': data['prio']['versao']}
    print(json.dumps(summary))
    for x in converted:
        print('CONVERTIDO', x['block'], x['sub'], x['m'], 'min')
    for x in deleted:
        print('APAGADO', x['id'], x['day'], x['mat'], '|', x['t'][:60])
    if not apply:
        return
    new_line = 'const DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';'
    (ROOT / 'index.html').write_text(html.replace(old_line, new_line, 1), encoding='utf8')
    (ROOT / 'scripts/revisions-removed-2026-09-16.json').write_text(json.dumps({'checkedAt': CHECKED, 'summary': summary, 'hiddenGroups': hidden, 'convertedGroups': converted, 'deletedBlocks': deleted}, ensure_ascii=False, indent=1), encoding='utf8')
    print('APPLIED')


if __name__ == '__main__':
    main()
