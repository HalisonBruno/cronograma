"""Safety regressions for literal ebook/law evidence; no PDF data required."""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("evidence", ROOT / "scripts/verify-ebook-law-evidence.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class EvidenceTests(unittest.TestCase):
    def test_typography_not_substance(self):
        self.assertEqual(MOD.normalize("Art. 5º É assegurado o direito."), MOD.normalize("ARTIGO 5 É assegurado o direito"))
        self.assertEqual(MOD.normalize("Art. 1.511. Texto."), MOD.normalize("Art. 1511 Texto"))
        self.assertNotEqual(MOD.normalize("Art. 5 É assegurado."), MOD.normalize("Art. 5 Não é assegurado."))
        self.assertNotEqual(MOD.normalize("prazo de 15 dias"), MOD.normalize("prazo de 30 dias"))

    def test_only_editorial_parentheses_removed(self):
        self.assertEqual(MOD.normalize("Texto (Redação dada pela Lei nº 1/2026)"), "texto")
        self.assertIn("salvo", MOD.normalize("Texto (salvo disposição em contrário)"))
        self.assertIn("revogado", MOD.normalize("Art. 1º (Revogado)"))
        self.assertIn("...", MOD.normalize("Art. 1º Texto (...)"))

    def test_literal_citation_or_summary_does_not_prove_full_article(self):
        text, pages = MOD.chapter_index(["O art. 1º regula assunto. Texto abreviado."], 1, 1)
        self.assertIsNone(MOD.locate(text, pages, MOD.normalize("Art. 1º Texto integral e obrigatório.")))

    def test_number_boundary_and_complete_target(self):
        text, pages = MOD.chapter_index(["Art. 11º Texto integral e obrigatório."], 1, 1)
        self.assertIsNone(MOD.locate(text, pages, MOD.normalize("Art. 1º Texto integral e obrigatório.")))
        self.assertEqual(MOD.locate(text, pages, MOD.normalize("Art. 11º Texto integral e obrigatório.")), [1])

    def test_match_pages_and_chapter_boundary(self):
        pages = ["Art. 1º Texto integral", "e obrigatório.", "Art. 2º Outra norma."]
        text, offsets = MOD.chapter_index(pages, 1, 2)
        self.assertEqual(MOD.locate(text, offsets, MOD.normalize("Art. 1º Texto integral e obrigatório.")), [1, 2])
        self.assertIsNone(MOD.locate(text, offsets, MOD.normalize("Art. 2º Outra norma.")))

    def test_manifest_records_cover_whole_target(self):
        path = ROOT / "ebook-law-evidence.json"
        if not path.exists():
            self.skipTest("Generate the evidence manifest first")
        manifest = json.loads(path.read_text(encoding="utf-8"))
        groups = {(g["blockId"], g["groupId"]): g for g in MOD.law_groups(MOD.load_data())}
        self.assertTrue(manifest["policy"]["videoNeverProvesLaw"])
        self.assertTrue(manifest["policy"]["requiresManualEbookReading"])
        for record in manifest["records"]:
            group = groups[(record["blockId"], record["groupId"])]
            self.assertEqual(record["lawHash"], group["lawHash"])
            self.assertEqual(record["articles"], [a["n"] for a in group["articles"]])
            found = [m for m in manifest["matches"] if m["blockId"] == record["blockId"] and m["groupId"] == record["groupId"] and m["ebook"] == record["eb"] and m["chapter"] == record["cap"]]
            self.assertEqual(len(found), len(group["articles"]))
            self.assertTrue(record["verified"])
            self.assertEqual(record["method"], "full-normalized-text")
            self.assertTrue(all(record["pages"][0] <= p <= record["pages"][1] for p in record["pdfPages"]))


if __name__ == "__main__":
    unittest.main()
