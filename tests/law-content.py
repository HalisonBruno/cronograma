"""Validate every published reading group and preserve researched priorities."""
import json
import pathlib
import subprocess
import unittest
import importlib.util

ROOT=pathlib.Path(__file__).resolve().parent.parent
def data(text):
    return json.loads(next(l for l in text.splitlines() if l.startswith('const DATA = '))[13:-1])
DATA=data((ROOT/'index.html').read_text(encoding='utf8'))
FILES={p.stem:json.loads(p.read_text(encoding='utf8')) for p in (ROOT/'leis').glob('*.json')}
GROUPS={g['id']:g for j in FILES.values() for g in j['g']}

class PublishedLawTests(unittest.TestCase):
    def test_all_exact_files_and_scopes_exist(self):
        self.assertEqual(set(DATA['leigroups']),set(FILES))
        self.assertEqual(len(GROUPS),638)
        for bid,gs in DATA['leigroups'].items():
            self.assertEqual(FILES[bid]['id'],bid)
            self.assertEqual([g['id'] for g in gs],[g['id'] for g in FILES[bid]['g']])
            for g in FILES[bid]['g']:
                self.assertTrue(g['a'], (bid,g['id']))
                self.assertEqual(g['audit']['status'],'source-reviewed')
                self.assertIn(g['audit']['checkedAt'],{'2026-09-11','2026-09-15'})
                for a in g['a']:
                    self.assertTrue(a['t'].strip())
                    self.assertNotIn('\ufffd',a['t'])
                    self.assertTrue(a['sourceUrl'].startswith('https://'))

    def test_researched_data_and_completion_ids_preserved(self):
        old=data(subprocess.check_output(['git','show','adf6de9:index.html'],cwd=ROOT).decode('utf8'))
        current=json.loads(json.dumps(DATA))
        # 16/09/2026: grupos de revisao ficaram ocultos (x) e seis "revisoes" que eram a unica leitura
        # do artigo viraram leitura simples (scripts/revisions-removed-2026-09-16.json).
        removed=json.loads((ROOT/'scripts/revisions-removed-2026-09-16.json').read_text(encoding='utf8'))
        converted={c['id'] for c in removed['convertedGroups']}
        self.assertEqual(len(converted),6)
        for gs in current['leigroups'].values():
            for g in gs:
                g.pop('readTitle',None)
                g.pop('readSourceUrl',None)
                if g.get('rev'):
                    self.assertTrue(g.get('x'),('revisao visivel',g['id']))
                if g.get('x') and g.get('rev'):
                    g.pop('x',None)
        for gs in old['leigroups'].values():
            for g in gs:
                g.pop('readTitle',None)
                g.pop('readSourceUrl',None)
                if g.get('x') and g.get('rev'):
                    g.pop('x',None)
        # Blocos criados em 15/09/2026 (scripts/law-additions-2026-09-15.json) sao novos; os antigos
        # so podem mudar rotulos de leitura e fonte direta.
        for bid,gs in old['leigroups'].items():
            cur=[g for g in current['leigroups'][bid] if g['id'] not in converted]
            exp=[g for g in gs if g['id'] not in converted]
            self.assertEqual(cur,exp,bid)
            for g in current['leigroups'][bid]:
                if g['id'] in converted:
                    self.assertFalse(g.get('rev'));self.assertFalse(g.get('x'));self.assertNotIn('revisão',g['sub'])
        for bid in current['leigroups']:
            if bid not in old['leigroups']:
                self.assertTrue(bid.startswith('2026-09-15-'),bid)

    def test_last_fragment_does_not_append_remainder(self):
        spec=importlib.util.spec_from_file_location('apply',ROOT/'scripts/apply-law-refresh.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        article={'text':'Art. 5º Texto.\nI - primeiro.\nII - segundo.\nIII - terceiro.','links':[]}
        selected,error=module.fragment(article,{'sub':'CF art. 5 (2/2: II–II)'},None)
        self.assertIsNone(error)
        self.assertEqual(selected['text'],'II - segundo.')
        definitions=GROUPS['d75476']['a'][0]['t']
        self.assertTrue(definitions.startswith('XVI'))
        self.assertNotIn('\nXXIII',definitions)

    def test_nested_amendments_do_not_create_false_article_numbers(self):
        for gid,invalid in [('d56e47',['17-A','17-B']),('4a026f',['1783-A']),('e97510',['121-A','129','141','147']),('35db7f',['288'])]:
            self.assertFalse(set(invalid)&{a['n'] for a in GROUPS[gid]['a']})
        self.assertTrue(GROUPS['ad71ab']['audit']['sourceUrl'].endswith('del2848compilado.htm'))

    def test_current_cpc_and_ctn_amendments_are_present(self):
        cpc=[g for g in GROUPS.values() if 'l13105' in g['u'].lower()]
        art927=next(a for g in cpc for a in g['a'] if a['n']=='927')
        self.assertIn('III-A',art927['t'])
        self.assertIn('15.484',art927['t'])
        art196=next(a for g in cpc for a in g['a'] if a['n']=='196')
        self.assertNotIn('coleta e o compartilhamento',art196['t'])
        self.assertTrue(any('15.479' in n for g in cpc for n in g['audit']['notes']))
        ctn=[g for g in GROUPS.values() if 'l5172' in g['u'].lower()]
        self.assertTrue(any('236' in a['t'] for g in ctn for a in g['a']))

    def test_special_sources_and_provenance(self):
        self.assertEqual(len(GROUPS['fd1758']['a']),24)
        tst=GROUPS['1dd01e']
        self.assertEqual({a['n'] for a in tst['a']},{'331','425'})
        self.assertIn('cancelad',json.dumps(tst,ensure_ascii=False).lower())
        report=json.loads((ROOT/'auditoria-lei-seca.json').read_text(encoding='utf8'))
        self.assertEqual(report['unresolved'],[])
        self.assertEqual(report['groups'],638)
        self.assertEqual(len(report['sourceManifest']),84)

    def test_groups_fit_the_daily_cap(self):
        # 120 min por dia a ate 4 min por dispositivo: nenhum grupo de leitura passa de 30 dispositivos
        # (os grupos antigos vao ate 29). Acima disso o replanejador nunca encaixa o item e a previsao
        # de conclusao para (15/09/2026: LIA art. 17 com 42 dispositivos = 126 min).
        for bid,gs in DATA['leigroups'].items():
            for g in gs:
                if g.get('x') or g.get('rev') or g.get('dir'):
                    continue
                self.assertLessEqual(g.get('d',0),30,(bid,g['id'],g['sub']))
                self.assertLessEqual(g.get('m',0),120,(bid,g['id'],g['sub']))
        # os grupos divididos em 15/09 carregam o tique do grupo original (lgmig) e a fracao de artigo
        splits=json.loads((ROOT/'scripts/law-splits-2026-09-15.json').read_text(encoding='utf8'))['mapping']
        self.assertEqual(len(splits),20)
        for old,new in splits.items():
            bid=old.split(':')[1]
            gid=old.split(':')[2] if old.startswith('lg2:') else None
            if gid:
                self.assertEqual(DATA['lgmig'][bid]['g:'+gid],[k.split(':')[2] for k in new])
            for k in new:
                meta=next(g for g in DATA['leigroups'][bid] if g['id']==k.split(':')[2])
                if meta.get('fa'):
                    self.assertRegex(meta['sub'],r'\(\d/\d: .+[–—].+\)')
                    self.assertEqual(meta['a'],[meta['fa']])

if __name__=='__main__':unittest.main(verbosity=2)
