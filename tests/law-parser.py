"""Offline extraction regressions; passing is not certification of legal currency.

Run: python tests/law-parser.py
Optional transport/extraction evidence inventory: python tests/law-parser.py --cache
The cache report never downloads sources or writes application data.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("law_refresh_under_test", ROOT / "scripts" / "refresh-law-sources.py")
LAW = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAW)
CAMARA = "https://www2.camara.leg.br/legin/fed/lei/2015/lei-13105-16-marco-2015-780273-normaatualizada-pl.html"
CF = "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm"
CNJ = "https://atos.cnj.jus.br/atos/detalhar/127"


def parse(text, url=CAMARA, encoding="utf8"):
    return LAW.parse_html(text.encode(encoding), url)


def one(parsed, n, section=None):
    candidates = parsed["articles"].get(str(n), [])
    if section:
        candidates = [a for a in candidates if a["section"] == section]
    if len(candidates) != 1:
        raise AssertionError(f"Expected one {section or '*'} article {n}, got {len(candidates)}")
    return candidates[0]


class LawParserTests(unittest.TestCase):
    def test_separator_dash_is_not_article_suffix(self):
        result = parse('<p>Art. 3º - A lei excepcional.</p><p>Art. 32 - As penas são.</p><p>Art. 3º-A. Novo dispositivo.</p>')
        self.assertEqual(set(result['articles']), {'3','32','3-A'})

    def test_cf_navigation_adct_link_does_not_change_main_section(self):
        result = parse('<p>ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS</p><p>Art. 1º REPUBLICA.</p><p>ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS</p><p>Art. 1º TRANSITORIO.</p>', CF)
        self.assertIn('REPUBLICA', one(result, 1, 'main')['text'])

    def test_historical_strike_del_s_and_inline_style_are_removed(self):
        result = parse('''<p>Art. 63. Cabeçalho atual.</p>
            <p><strike>§ 1º REDACAO_ANTIGA_A</strike></p>
            <p><del>§ 1º REDACAO_ANTIGA_B</del></p>
            <p><s>§ 1º REDACAO_ANTIGA_C</s></p>
            <p style="text-decoration: line-through">§ 1º REDACAO_ANTIGA_D</p>
            <p>§ 1º REDACAO_ATUAL</p><p>§ 5º PARAGRAFO_NOVO</p>''')
        text = one(result, 63)["text"]
        self.assertNotIn("REDACAO_ANTIGA", text)
        self.assertIn("REDACAO_ATUAL", text)
        self.assertIn("PARAGRAFO_NOVO", text)
        self.assertEqual(result["removedHistoricalRuns"], 4)

    def test_nested_historical_tags_do_not_crash(self):
        result = parse('<strike><s><span style="text-decoration:line-through">Art. 1. OLD</span></s></strike><p>Art. 1. CURRENT</p>')
        self.assertEqual(one(result, 1)["text"], "Art. 1. CURRENT")

    def test_repealed_marker_is_kept_instead_of_old_content(self):
        result = parse('<p><strike>Art. 5º REDACAO_ANTIGA</strike></p><p>Art. 5º (Revogado).</p>')
        self.assertEqual(one(result, 5)["text"], "Art. 5º (Revogado).")

    def test_article_ordinals_and_suffixes(self):
        result = parse('<p>Art. 1º PRIMEIRO.</p><p>Art. 2° SEGUNDO.</p><p>Art. 3o TERCEIRO.</p><p>Art.4. QUARTO.</p><p>Art. 19-A. SUFIXO.</p><p>Art. 1.783-A. MILHAR.</p><p>Artigo 78 ÚLTIMO.</p>')
        self.assertEqual(set(result["articles"]), {"1", "2", "3", "4", "19-A", "1783-A", "78"})

    def test_normalized_number_preserves_letter_suffix(self):
        self.assertEqual(LAW.number("1.783 – A"), "1783-A")

    def test_ordinal_before_letter_suffix_is_not_base_article(self):
        # Actual Câmara formatting: Lei 13.848 arts. 3º-A/3º-B; Lei 11.101
        # arts. 6º-A/6º-B/6º-C. A greedy base-number match creates duplicates.
        result = parse('<p>Art. 3º BASE.</p><p>Art. 3º-A. SUFIXO_A.</p><p>Art. 3º-B. SUFIXO_B.</p><p>Art. 6o-C. SUFIXO_C.</p>')
        self.assertEqual(set(result["articles"]), {"3", "3-A", "3-B", "6-C"})
        self.assertEqual(len(result["articles"]["3"]), 1)

    def test_cf_and_adct_remain_distinct(self):
        result = parse('<p>Art. 1º CONSTITUICAO.</p><p>ATO DAS DISPOSIÇÕES CONSTITUCIONAIS TRANSITÓRIAS</p><p>Art. 1º TRANSITORIO.</p>', CF)
        self.assertIn("CONSTITUICAO", one(result, 1, "main")["text"])
        self.assertIn("TRANSITORIO", one(result, 1, "adct")["text"])
        for scope, marker in [("CF · arts. 1–4", "CONSTITUICAO"), ("ADCT · arts. 1–4", "TRANSITORIO")]:
            candidate, _ = LAW.select_candidate(result, {"label": "1", "scope": scope, "url": CF})
            self.assertIn(marker, candidate["text"])

    def test_treaty_is_not_promulgating_decree(self):
        url = "https://www.planalto.gov.br/ccivil_03/decreto/d0678.htm"
        result = parse('<p>Art. 1º PROMULGACAO.</p><p>CONVENÇÃO AMERICANA SOBRE DIREITOS HUMANOS</p><p>Artigo 1. TRATADO.</p>', url)
        candidate, _ = LAW.select_candidate(result, {"label": "1", "scope": "CADH", "url": url})
        self.assertIn("TRATADO", candidate["text"])
        self.assertNotIn("PROMULGACAO", candidate["text"])

    def test_cnj_approval_is_not_ethics_code(self):
        result = parse('<div class="integra"><p>Art. 1º APROVA_CODIGO.</p><p>Art. 2º APROVA_VIGENCIA.</p><h2>CÓDIGO DE ÉTICA DA MAGISTRATURA NACIONAL</h2><p>Art. 1º ETICA_INICIO.</p><p>Art. 2º ETICA_DOIS.</p><p>Art. 42. ETICA_FINAL.</p></div>', CNJ)
        candidate, _ = LAW.select_candidate(result, {"label": "1", "scope": "Código de Ética", "url": CNJ})
        self.assertIn("ETICA_INICIO", candidate["text"])
        self.assertNotIn("APROVA", candidate["text"])
        self.assertEqual(one(result, 42, "ethics")["text"], "Art. 42. ETICA_FINAL.")

    def test_quoted_epd_amendment_is_not_standalone_article(self):
        result = parse('''<p>Art. 116. O Título recebe a seguinte redação:</p>
            <p>“TÍTULO IV</p><p>DA TOMADA DE DECISÃO APOIADA</p>
            <p>Art. 1.783-A. CONTEUDO_DO_CODIGO_CIVIL.</p>
            <p>§ 1º PARAGRAFO_DO_CODIGO_CIVIL.” (NR)</p>
            <p>Art. 117. ARTIGO_SEGUINTE_DA_LEI.</p>''')
        self.assertNotIn("1783-A", result["articles"])
        self.assertIn("CONTEUDO_DO_CODIGO_CIVIL", one(result, 116)["text"])
        self.assertIn("PARAGRAFO_DO_CODIGO_CIVIL", one(result, 116)["text"])
        self.assertIn("ARTIGO_SEGUINTE_DA_LEI", one(result, 117)["text"])

    def test_single_paragraph_quote_closes_before_next_article(self):
        result = parse('<p>Art. 10. Altera outra lei.</p><p>"Art. 999. TRECHO_CITADO." (NR)</p><p>Art. 11. PROXIMO_ARTIGO.</p>')
        self.assertNotIn("999", result["articles"])
        self.assertIn("TRECHO_CITADO", one(result, 10)["text"])
        self.assertIn("PROXIMO_ARTIGO", one(result, 11)["text"])

    def test_camara_original_div_and_br_preserve_article_boundaries(self):
        result = parse('<div>Art. 1º CABECALHO.<br>Parágrafo único. PARAGRAFO.<br>Art. 2º SEGUNDO.<br>Brasília, 1 de janeiro de 2000.<br>ASSINATURA.</div>')
        self.assertIn("PARAGRAFO", one(result, 1)["text"])
        self.assertNotIn("SEGUNDO", one(result, 1)["text"])
        self.assertNotIn("ASSINATURA", one(result, 2)["text"])

    def test_dir_original_does_not_lose_amendment_lines(self):
        result = parse('<div>Art. 1º Dispositivo:<dir>I — PRIMEIRO;<br>II — SEGUNDO.</dir>Art. 2º PRÓXIMO.</div>')
        self.assertIn("PRIMEIRO", one(result, 1)["text"])
        self.assertIn("SEGUNDO", one(result, 1)["text"])
        self.assertNotIn("PRÓXIMO", one(result, 1)["text"])

    def test_inline_links_resolve_to_official_amending_url(self):
        result = parse('<p>Art. 1º Redação. <a href="../lei-2.html">Redação dada pela Lei 2</a></p>')
        links = one(result, 1)["links"]
        self.assertTrue(any(a["url"] == "https://www2.camara.leg.br/legin/fed/lei/lei-2.html" for a in links))

    def test_scripts_and_styles_are_not_legal_text(self):
        result = parse('<p>Art. 1º TEXTO.</p><script>TRACKING_CODE</script><style>.bogus {}</style>')
        self.assertNotIn("TRACKING_CODE", one(result, 1)["text"])
        self.assertNotIn("bogus", one(result, 1)["text"])

    def test_utf8_and_cp1252_have_same_accents(self):
        text = '<p>Art. 1º A função jurisdicional é pública.</p>'
        utf8 = parse(text, encoding="utf8")
        legacy = parse(text, encoding="cp1252")
        self.assertEqual(one(utf8, 1)["text"], one(legacy, 1)["text"])
        self.assertNotIn("Ã", one(utf8, 1)["text"])
        self.assertNotIn("\ufffd", one(legacy, 1)["text"])

    def test_future_effect_warning_is_not_silently_verified(self):
        result = parse('<p>Art. 1º Norma que entra em vigor um ano após a publicação.</p>')
        candidate, status = LAW.select_candidate(result, {"label": "1", "scope": "LEI", "url": CAMARA})
        self.assertIn("effective-date-review-required", candidate["warnings"])
        self.assertEqual(status, "source-warning-review-required")

    def test_quoted_heading_does_not_swallow_following_articles(self):
        result = parse('<p>Art. 124. Convocação.</p><p>"Quorum" de instalação</p><p>Art. 125. Instalação.</p><p>Art. 129. Deliberações.</p>')
        self.assertTrue(one(result, 125)['text'].startswith('Art. 125.'))
        self.assertTrue(one(result, 129)['text'].startswith('Art. 129.'))

    def test_paragraph_ordinal_before_suffix_preserves_fragment(self):
        spec = importlib.util.spec_from_file_location('apply_law_test', ROOT/'scripts/apply-law-refresh.py')
        apply = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(apply)
        lines = apply.structural_lines('Art. 44. Alteração.\n§ 4º Primeiro.\n§ 4º-A Segundo.\n§ 7º Final.')
        self.assertEqual([x['marker'] for x in lines], ['caput', '§4', '§4-A', '§7'])

    def test_ambiguous_articles_are_not_guessed(self):
        result = parse('<p>Art. 1º TEXTO_A.</p><p>Art. 1º TEXTO_B.</p>')
        candidate, status = LAW.select_candidate(result, {"label": "1", "scope": "LEI", "url": CAMARA})
        self.assertIsNone(candidate)
        self.assertEqual(status, "ambiguous-article-number")

    def test_fragments_are_never_marked_ready_as_full_article(self):
        result = parse('<p>Art. 5º CABECALHO.</p><p>I — PRIMEIRO.</p>', CF)
        _, status = LAW.select_candidate(result, {"label": "5 (1/4)", "scope": "CF · art. 5 (1/4: I–XXIV)", "url": CF})
        self.assertEqual(status, "partial-article-requires-scope-review")

    def test_missing_article_is_not_replaced_by_another(self):
        result = parse('<p>Art. 1º PRIMEIRO.</p>')
        candidate, status = LAW.select_candidate(result, {"label": "2", "scope": "LEI", "url": CAMARA})
        self.assertIsNone(candidate)
        self.assertEqual(status, "article-not-found-or-nested-amendment")

    def test_error_page_never_yields_readable_law_candidate(self):
        result = parse('<html><title>503 Service Unavailable</title><h1>503 Service Unavailable</h1><p>Servidor indisponível.</p></html>')
        self.assertEqual(result["articles"], {})
        candidate, status = LAW.select_candidate(result, {"label": "1", "scope": "LEI", "url": CAMARA})
        self.assertIsNone(candidate)
        self.assertEqual(status, "article-not-found-or-nested-amendment")


def audit_cache():
    cache = ROOT.parent / "law-refresh-audit"
    manifests = [cache / "sources.json", cache / "mirror-sources.json"]
    items = {}
    for manifest in manifests:
        if manifest.exists():
            for source in json.loads(manifest.read_text(encoding="utf8")):
                if source.get("status") == "fetched" and str(source.get("cacheFile", "")).endswith(".html"):
                    items[source["url"]] = source
    results = []
    for url, source in items.items():
        file = Path(source["cacheFile"])
        if not file.is_absolute():
            file = cache / "raw" / file
        if not file.exists():
            results.append({"url": url, "problem": "cache-file-not-found", "file": str(file)})
            continue
        raw = file.read_bytes()
        parsed = LAW.parse_html(raw, source.get("finalUrl", url))
        text, _ = LAW.decode_html(raw)
        issues = []
        if not parsed["articleNumbers"]:
            issues.append("no-articles-extracted")
        if re.search(r'<title>\s*(?:50\d|40\d|Gateway|Access Denied)|<h1>\s*503', text, re.I):
            issues.append("http-error-payload")
        if any("\ufffd" in a["text"] or "funÃ§" in a["text"] for cs in parsed["articles"].values() for a in cs):
            issues.append("text-encoding-warning")
        repeated = [n for n, cs in parsed["articles"].items() if len(cs) > len({a["section"] for a in cs})]
        results.append({"url": url, "sourceUrl": source.get("finalUrl"), "file": str(file), "articleNumbers": parsed["articleNumbers"], "issues": issues, "same-section-duplicates": repeated[:30], "sections": dict(Counter(a["section"] for cs in parsed["articles"].values() for a in cs))})
    print(json.dumps({"scope": "Offline transport and parser diagnostics only; not legal verification", "sources": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    if "--cache" in sys.argv:
        audit_cache()
    else:
        unittest.main(verbosity=2)
