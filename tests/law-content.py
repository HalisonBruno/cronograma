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
        self.assertEqual(len(GROUPS),467)
        for bid,gs in DATA['leigroups'].items():
            self.assertEqual(FILES[bid]['id'],bid)
            self.assertEqual([g['id'] for g in gs],[g['id'] for g in FILES[bid]['g']])
            for g in FILES[bid]['g']:
                self.assertTrue(g['a'], (bid,g['id']))
                self.assertEqual(g['audit']['status'],'source-reviewed')
                self.assertEqual(g['audit']['checkedAt'],'2026-09-11')
                for a in g['a']:
                    self.assertTrue(a['t'].strip())
                    self.assertNotIn('\ufffd',a['t'])
                    self.assertTrue(a['sourceUrl'].startswith('https://'))

    def test_researched_data_and_completion_ids_preserved(self):
        old=data(subprocess.check_output(['git','show','adf6de9:index.html'],cwd=ROOT).decode('utf8'))
        current=json.loads(json.dumps(DATA))
        for gs in current['leigroups'].values():
            for g in gs:
                g.pop('readTitle',None)
                g.pop('readSourceUrl',None)
        self.assertEqual(current,old, 'Only display titles and direct sources may change DATA')

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
        self.assertEqual(report['groups'],467)
        self.assertEqual(len(report['sourceManifest']),80)

if __name__=='__main__':unittest.main(verbosity=2)
