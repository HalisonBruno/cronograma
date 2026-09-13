"""Conservative, reproducible PDF -> exact law-reading evidence (no app writes).

Usage:
  python scripts/verify-ebook-law-evidence.py --pdf-dir PATH
  python scripts/verify-ebook-law-evidence.py --pdf-dir PATH --validate

Only complete normalized article/fragment text can match. Topic similarity,
citations, summaries, fuzzy matching and video-derived progress are NOT evidence.
The generated public manifest contains references/hashes, never copyrighted PDF
text or local absolute paths. Missing matches mean unverified, not absent.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
METHOD = "full-normalized-text"
VERSION = 1
EDITORIAL = re.compile(
    r"\((?:Vide\b|Vig[eê]ncia\b|Reda[çc][aã]o dada\b|Inclu[ií]d[oa]s?\b|"
    r"Acrescentad[oa]s?\b|Alterad[oa]s?\b|Regulamento\b|Produ[çc][aã]o de efeitos\b)"
    r"[^()]*\)", re.I
)


def digest(value: str | bytes) -> str:
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def normalize(text: str) -> str:
    """Typography only; preserve every word, digit, accent and paragraph sign.

    Known Planalto editorial parentheticals are metadata, not legal provisions.
    Substantive parentheses, omissions (...), revoked/vetoed text remain tokens.
    No stop-word removal, stemming, accent folding, paraphrase or fuzzy matching.
    """
    text = EDITORIAL.sub(" ", text)
    text = re.sub(r"(?<=\d)[º°]", "", text)
    text = unicodedata.normalize("NFKC", text).casefold()
    text = re.sub(r"(?<=\d)o(?=\s|[.,;:])", "", text)
    text = re.sub(r"\bartigo\b", "art", text)
    text = re.sub(r"(?<=\d)\.(?=\d{3}(?:\D|$))", "", text)
    text = text.replace("\u00ad", "").replace("\u200b", "")
    return " ".join(re.findall(r"\w+|§|\.{3}|…", text))


def file_key(name: str) -> str:
    text = unicodedata.normalize("NFKD", name.casefold())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " ".join(re.findall(r"\w+", text))


def load_data() -> dict:
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    return json.loads(re.search(r"const DATA\s*=\s*(\{[^\n]+\});", source)[1])


def find_pdf(pdf_dir: Path, ebook: dict) -> Path | None:
    expected = file_key(ebook["nome"])
    candidates = []
    for path in pdf_dir.glob("*.pdf"):
        stem = file_key(path.stem)
        if stem.startswith(expected + " ") and ("colecao enam" in stem or "e book 2026" in stem):
            candidates.append(path)
    # Prefer the revision used by this catalog; never silently choose old editions.
    candidates.sort(key=lambda p: ("13.07.2026" not in p.name, p.name))
    return candidates[0] if candidates else None


def page_text(page, number: int) -> str:
    lines = (page.extract_text() or "").splitlines()
    # CPIuris puts author/chapter + page number above the text. This is the only
    # header removal. It cannot remove a substantive line in the body of a page.
    if lines and "•" in lines[0]:
        lines = lines[1:]
    while lines and not lines[0].strip():
        lines = lines[1:]
    if lines and lines[0].strip() == str(number):
        lines = lines[1:]
    return "\n".join(lines)


def law_groups(data: dict) -> list[dict]:
    result = []
    for block_id, metadata in data["leigroups"].items():
        path = ROOT / "leis" / f"{block_id}.json"
        if not path.exists():
            continue
        raw = json.loads(path.read_text(encoding="utf-8"))
        by_id = {group["id"]: group for group in raw.get("g", [])}
        for meta in metadata:
            group = by_id.get(meta["id"])
            if not group:
                continue
            articles = group.get("a", [])
            # Refuse empty/vetoed-only/broken references; a block cannot be
            # proven merely by finding a generic word such as "Revogado".
            normalized = [normalize(article["t"]) for article in articles]
            # Hidden/excess groups do not create an activity in the app and
            # therefore cannot receive runtime credit even if their text matches.
            eligible = not meta.get("x") and bool(articles) and all(len(text.split()) >= 8 for text in normalized)
            eligible = eligible and sorted(a["n"] for a in articles) == sorted(meta["a"])
            result.append({
                "blockId": block_id, "groupId": meta["id"], "rot": meta.get("sg", meta.get("nl", "")),
                "title": meta.get("readTitle", meta.get("sub", "")),
                "sourceUrl": group.get("audit", {}).get("sourceUrl", group.get("u", "")),
                "sourceHash": group.get("audit", {}).get("sourceHash"),
                "lawHash": digest(json.dumps([{"n": a["n"], "t": a["t"]} for a in articles], ensure_ascii=False, separators=(",", ":"))),
                "scope": "fragment" if meta.get("fa") or re.search(r"\(\d+/\d+:", meta.get("sub", "")) else "full-article",
                "articles": articles, "normalized": normalized, "eligible": eligible,
            })
    return result


def chapter_index(pages: list[str], lo: int, hi: int) -> tuple[str, list[tuple[int, int, int]]]:
    full = " "
    offsets = []
    for number in range(lo, hi + 1):
        text = normalize(pages[number - 1])
        start = len(full)
        full += text + " "
        offsets.append((start, len(full) - 1, number))
    return full, offsets


def locate(full: str, offsets: list[tuple[int, int, int]], needle: str) -> list[int] | None:
    # Explicit token boundaries: a match for art. 1 must not match art. 11.
    start = full.find(" " + needle + " ")
    if start < 0:
        return None
    start += 1
    end = start + len(needle)
    return [page for lo, hi, page in offsets if hi > start and lo < end]


def build(pdf_dir: Path) -> dict:
    data = load_data()
    groups = law_groups(data)
    sources, records, matches, unavailable = [], [], [], []
    for ebook in data["ebooks"]:
        path = find_pdf(pdf_dir, ebook)
        if path is None:
            unavailable.append({"ebook": ebook["k"], "reason": "pdf-not-found"})
            continue
        reader = PdfReader(path)
        if len(reader.pages) != ebook["total"]:
            unavailable.append({"ebook": ebook["k"], "reason": "page-count-mismatch", "catalog": ebook["total"], "pdf": len(reader.pages)})
            continue
        pages = [page_text(page, i + 1) for i, page in enumerate(reader.pages)]
        source = {
            "ebook": ebook["k"], "file": path.name, "sha256": digest(path.read_bytes()),
            "pages": len(pages), "url": f"https://drive.google.com/file/d/{data['eblinks'][ebook['k']]}/view",
        }
        sources.append(source)
        for chapter in ebook["caps"]:
            lo, hi = chapter["pi"], chapter["pf"]
            full, offsets = chapter_index(pages, lo, hi)
            for group in groups:
                if not group["eligible"]:
                    continue
                group_matches = []
                for article, needle in zip(group["articles"], group["normalized"]):
                    found = locate(full, offsets, needle)
                    if not found:
                        continue
                    match = {
                        "ebook": ebook["k"], "chapter": chapter["n"], "key": f"eb:{ebook['k']}:{chapter['n']}",
                        "blockId": group["blockId"], "groupId": group["groupId"], "rot": group["rot"],
                        "article": article["n"], "scope": group["scope"], "lawHash": digest(article["t"]),
                        "normalizedHash": digest(needle), "pageStart": lo, "pageEnd": hi, "pdfPages": found,
                        "match": METHOD,
                    }
                    group_matches.append(match)
                matches.extend(group_matches)
                if len(group_matches) != len(group["articles"]):
                    continue
                record = {
                    "blockId": group["blockId"], "groupId": group["groupId"], "eb": ebook["k"], "cap": chapter["n"],
                    "pages": [lo, hi], "pdfPages": sorted({p for m in group_matches for p in m["pdfPages"]}),
                    "source": {"url": source["url"], "sha256": source["sha256"], "file": path.name},
                    "lawSourceUrl": group["sourceUrl"], "lawSourceHash": group["sourceHash"], "lawHash": group["lawHash"],
                    "articles": [a["n"] for a in group["articles"]], "scope": group["scope"],
                    "verified": True, "method": METHOD,
                }
                records.append(record)
        print(json.dumps({"ebook": ebook["k"], "pages": len(pages), "chapters": len(ebook["caps"]), "recordsSoFar": len(records)}, ensure_ascii=False), flush=True)

    verified_groups = {(r["blockId"], r["groupId"]) for r in records}
    return {
        "version": VERSION, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "method": METHOD,
        "policy": {
            "requiresManualEbookReading": True, "videoNeverProvesLaw": True,
            "requiresEveryArticleAndFragmentInTargetGroup": True,
            "noMatchMeans": "unverified-not-inferred", "matchesAreDiagnosticOnly": True,
            "normalization": "Unicode NFKC, case, punctuation/whitespace/ordinal typography; only explicitly recognized editorial parentheticals removed. Words, digits, accents and paragraph markers preserved; no fuzzy matching.",
            "bounds": "Exact match against committed law-reading text and catalog chapter page intervals, not independent legal validity certification or a guarantee that unverified articles are absent from a book.",
        },
        "summary": {
            "catalogEbooks": len(data["ebooks"]), "checkedEbooks": len(sources),
            "checkedChapters": sum(len(e["caps"]) for e in data["ebooks"] if e["k"] in {s["ebook"] for s in sources}),
            "lawGroups": len(groups), "verifiedGroups": len(verified_groups), "unverifiedGroups": len(groups) - len(verified_groups),
            "evidenceRecords": len(records), "individualArticleMatches": len(matches),
        },
        "sources": sources, "unavailable": unavailable, "records": records, "matches": matches,
        "unverified": [{"blockId": g["blockId"], "groupId": g["groupId"], "reason": "complete-target-text-not-proven-in-one-chapter" if g["eligible"] else "source-group-incomplete-or-too-short"} for g in groups if (g["blockId"], g["groupId"]) not in verified_groups],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=ROOT / "ebook-law-evidence.json")
    parser.add_argument("--app-out", type=Path, default=ROOT / "ebook-law-evidence.js",
                        help="Deterministic runtime subset; contains no extracted PDF text")
    parser.add_argument("--validate", action="store_true", help="Re-extract PDFs and verify saved evidence, without rewriting it")
    args = parser.parse_args()
    result = build(args.pdf_dir)
    if args.validate:
        saved = json.loads(args.out.read_text(encoding="utf-8"))
        for field in ("version", "method", "policy", "summary", "sources", "unavailable", "records", "matches", "unverified"):
            if saved[field] != result[field]:
                raise SystemExit(f"Evidence differs in {field}; regenerate and review before enabling new coverage")
        print("Validated: every saved full-group record reproduced exactly from current PDF and law bytes.")
    else:
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    runtime = {
        "version": result["version"], "generatedAt": result["generatedAt"],
        "method": result["method"], "policy": result["policy"],
        "summary": result["summary"], "sources": result["sources"],
        "records": result["records"],
    }
    args.app_out.write_text("const LAW_EVIDENCE=" + json.dumps(runtime, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
