"""Auditable official-law inventory/refresh proposals; never edits app data.

Usage: python scripts/refresh-law-sources.py --fetch --out ../law-refresh-audit
Dependencies: requests, beautifulsoup4 (only for this maintenance tool).

The report deliberately distinguishes fetched, parsed and verified. Automatic
extraction is NOT legal certification. Ambiguous article numbers, partial
articles and unavailable sources remain review-required, never silently dropped.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
ALLOWED_HOSTS = {"www.planalto.gov.br", "planalto.gov.br", "atos.cnj.jus.br", "www2.camara.leg.br", "www.tst.jus.br"}
ARTICLE = re.compile(r"^(?:Art(?:igo)?\s*\.?\s*)(\d+(?:\.\d{3})*(?:[º°o])?(?:[-–][A-Z]{1,2})*)[º°o.]?(?:\s|[-–:]|$)", re.I)
HEADING = re.compile(r"^(?:PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O|ANEXO)\b", re.I)


def digest(value: bytes | str) -> str:
    return hashlib.sha256(value.encode("utf8") if isinstance(value, str) else value).hexdigest()


def normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ").replace("\ufeff", "").replace("\u200b", "")).strip()


def number(value: str) -> str:
    return re.sub(r"[.\sº°o]", "", value).replace("–", "-").upper()


def read_inventory(root: Path = ROOT) -> dict:
    html = (root / "index.html").read_text(encoding="utf8")
    match = re.search(r"const DATA = (.*);\r?\nconst API", html, re.S)
    if not match:
        raise ValueError("DATA not found")
    data = json.loads(match[1])
    occurrences = []
    groups = []
    disk_by_id = {}
    for file in sorted((root / "leis").glob("*.json")):
        law = json.loads(file.read_text(encoding="utf8"))
        for group in law.get("g", []):
            item = {"file": str(file.relative_to(root)).replace("\\", "/"), "blockId": law["id"], "groupId": group["id"], "url": group.get("u", ""), "scope": group.get("sub", group.get("r", "")), "origin": "local-json", "articleCount": len(group.get("a", []))}
            groups.append(item)
            disk_by_id[(law["id"], group["id"])] = group
            for index, article in enumerate(group.get("a", [])):
                occurrences.append({**item, "articleIndex": index, "label": article["n"], "text": article.get("t", ""), "oldHash": digest(article.get("t", ""))})
    metadata_missing = []
    for block, metas in data.get("leigroups", {}).items():
        for group in metas:
            # The app loads the exact block ID, including its ~ suffix.
            resolved = block
            if (block, group["id"]) in disk_by_id:
                continue
            item = {"file": None, "blockId": block, "resolvedBlockId": resolved, "groupId": group["id"], "url": group.get("u", ""), "scope": group.get("sub", group.get("r", "")), "origin": "metadata-only", "articleCount": len(group.get("a", []))}
            groups.append(item)
            metadata_missing.append(item)
            for index, label in enumerate(group.get("a", [])):
                occurrences.append({**item, "articleIndex": index, "label": label, "text": None, "oldHash": None})
    sources = defaultdict(lambda: {"groups": [], "articleOccurrences": 0})
    for group in groups:
        sources[group["url"]]["groups"].append({k: group[k] for k in ("blockId", "groupId", "origin", "scope")})
        sources[group["url"]]["articleOccurrences"] += group["articleCount"]
    return {"dataHash": digest(match[1]), "metadataGroups": sum(map(len, data.get("leigroups", {}).values())), "lawFiles": len(list((root / "leis").glob("*.json"))), "groups": groups, "metadataMissing": metadata_missing, "sources": dict(sources), "occurrences": occurrences}


def decode_html(raw: bytes) -> tuple[str, str]:
    # Planalto commonly declares ISO-8859-1; newer pages use UTF-8. Strict UTF-8
    # first avoids turning valid CNJ accents into "Ã..." mojibake.
    try:
        return raw.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace"), "windows-1252"


def fetch_source(url: str, cache: Path) -> dict:
    key = digest(url)[:16]
    result = {"url": url, "key": key, "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "status": "unavailable"}
    if not url:
        return {**result, "reason": "missing-source-url"}
    if urlparse(url).hostname not in ALLOWED_HOSTS:
        return {**result, "reason": "non-official-or-unapproved-host"}
    try:
        response = requests.get(url, timeout=(8, 18), headers={"User-Agent": "CronogramaLawAudit/1.0 (+read-only official legislation verification)"})
        response.raise_for_status()
        if urlparse(response.url).hostname not in ALLOWED_HOSTS:
            raise ValueError("redirect outside official source allowlist")
        raw = response.content
        if len(raw) < 150:
            raise ValueError("unexpectedly short source")
        extension = ".pdf" if raw.startswith(b"%PDF") else ".html"
        target = cache / (key + extension)
        target.write_bytes(raw)
        result.update(status="fetched", finalUrl=response.url, httpStatus=response.status_code, contentType=response.headers.get("content-type", ""), sha256=digest(raw), bytes=len(raw), cacheFile=target.name)
    except Exception as exc:
        result["reason"] = f"{type(exc).__name__}: {exc}"
    return result


def parse_html(raw: bytes, url: str) -> dict:
    html, encoding = decode_html(raw)
    soup = BeautifulSoup(html, "html.parser")
    removed = []
    for node in list(soup.find_all(["strike", "s", "del"])):
        if node.parent:
            removed.append(normalized(node.get_text(" ")))
            node.decompose()
    for node in list(soup.find_all(style=True)):
        if node.parent and re.search(r"(?:line-through|text-decoration\s*:\s*line-through)", node.get("style", ""), re.I):
            removed.append(normalized(node.get_text(" ")))
            node.decompose()
    for node in soup(["script", "style", "noscript"]):
        node.decompose()
    content = soup
    if "atos.cnj.jus.br" in url:
        # Exact page selectors are optional: fallback still requires article IDs.
        content = soup.select_one(".integra, #integra, .ato-conteudo, .conteudo-ato") or soup
    # Some Camara originals put the entire law in a single DIV with BRs,
    # whereas consolidated texts use P. Preserve both structures, not just P.
    separator = "\n\u241e\n"
    anchors = content.find_all("a", href=True)
    all_links = [{"text": normalized(a.get_text(" ")), "url": urljoin(url, a["href"])} for a in anchors]
    for i, anchor in enumerate(anchors):
        anchor.insert_after(f'\u241f{i}\u241f')
    for node in list(content.find_all(["br", "p", "div", "dir", "tr", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"])):
        node.insert_before(separator)
        node.insert_after(separator)
    paragraphs = content.get_text("").split("\u241e")
    lines = []
    for paragraph in paragraphs:
        link_ids = [int(i) for i in re.findall(r'\u241f(\d+)\u241f', paragraph)]
        text = normalized(re.sub(r'\u241f\d+\u241f', '', paragraph))
        # SUP/FONT boundaries in legacy Planalto HTML may introduce spaces
        # inside an ordinal/suffix or even a two-digit article number.
        text = re.sub(r'^(Art(?:igo)?\.?\s*\d+(?:\.\d{3})*)\s+([oº°])\s*(-[A-Z])', r'\1\2\3', text)
        text = re.sub(r'^(Art(?:igo)?\.?\s*\d)\s+(\d+[.º°])', r'\1\2', text)
        if text:
            links = [all_links[i] for i in link_ids]
            lines.append((text, links))
    if not lines:
        lines = [(normalized(line), []) for line in content.get_text("\n").splitlines() if normalized(line)]
    articles = defaultdict(list)
    current = None
    section = "main"
    quoted = False
    for text, links in lines:
        if articles and re.match(r"^ATO DAS DISPOSI[ÇC][ÕO]ES CONSTITUCIONAIS TRANSIT[ÓO]RIAS", text, re.I):
            current = None
            section = "adct"
        if articles and re.match(r"^(?:CONVEN[ÇC][ÃA]O AMERICANA SOBRE DIREITOS HUMANOS|PACTO INTERNACIONAL SOBRE DIREITOS CIVIS E POL[ÍI]TICOS)", text, re.I):
            current = None
            section = "treaty"
        if articles and re.match(r"^C[ÓO]DIGO DE [ÉE]TICA DA MAGISTRATURA NACIONAL$", text, re.I):
            current = None
            section = "ethics"
        # Quoted redactions belong to the amending article, NOT to this law's
        # article index (e.g. CC 1.783-A quoted inside EPD art. 116).
        opens_quote = bool(re.match(r'^[“"«]', text))
        was_quoted = quoted or opens_quote
        if opens_quote:
            quoted = True
        closes_quote = bool(re.search(r'[”»]|"\s*\(NR\)|"\s*[.;]?\s*$', text)) or (opens_quote and text.startswith('"') and text.count('"') % 2 == 0)
        # The official HTML omits a closing quotation immediately before these
        # outer articles. Their own article anchors and legal sequence identify
        # the boundary; quoted inner Art. 44 uses an HREF, not that own anchor.
        forced_outer = bool((re.search(r'l14195(?:compilad[ao])?\.htm', url, re.I) and re.match(r'^Art\. 44\.',text)) or (re.search(r'l14711(?:compilad[ao])?\.htm',url,re.I) and re.match(r'^Art\. 7[º°.]',text)))
        if forced_outer:
            quoted = False
            was_quoted = False
        match = ARTICLE.match(text) if not was_quoted else None
        if match:
            n = number(match[1])
            current = {"number": n, "section": section, "lines": [text], "links": links[:], "warnings": []}
            articles[n].append(current)
            continue
        if current:
            if not was_quoted and (HEADING.match(text) or re.match(r"^(?:Bras[íi]lia,|Rio de Janeiro,|Pal[áa]cio|Este texto n[ãa]o substitui|©|Presid[êe]ncia da Rep[úu]blica)", text, re.I)):
                current = None
                continue
            current["lines"].append(text)
            current["links"].extend(links)
        if closes_quote:
            quoted = False
    for candidates in articles.values():
        for candidate in candidates:
            candidate["text"] = "\n".join(candidate.pop("lines"))
            if "\ufffd" in candidate["text"]:
                candidate["warnings"].append("replacement-character-in-source")
            if re.search(r"\b(?:produ[çc][ãa]o de efeitos|vig[êe]ncia|vigorar[áa]|entra em vigor)\b", candidate["text"], re.I):
                candidate["warnings"].append("effective-date-review-required")
    return {"url": url, "encoding": encoding, "removedHistoricalRuns": len(removed), "removedHistoricalSamples": removed[:8], "articleNumbers": len(articles), "articles": dict(articles), "allLinks": [{"text": normalized(a.get_text(" ")), "url": urljoin(url, a["href"])} for a in soup.find_all("a", href=True) if re.search(r"compilad|consolidad", a.get_text(), re.I)]}


def select_candidate(parsed: dict, occurrence: dict) -> tuple[dict | None, str]:
    label = str(occurrence["label"])
    match = re.match(r"^(\d+(?:\.\d{3})*(?:-[A-Z]+)?)", label, re.I)
    if not match:
        return None, "unrecognized-article-label"
    n = number(match[1])
    candidates = parsed["articles"].get(n, [])
    url = occurrence["url"]
    if "constituicao" in url:
        section = "adct" if re.search(r"\bADCT\b", occurrence["scope"], re.I) else "main"
        candidates = [c for c in candidates if c["section"] == section]
    elif re.search(r"d0(?:678|592)\.htm", url, re.I):
        candidates = [c for c in candidates if c["section"] == "treaty"]
    elif "atos.cnj.jus.br/atos/detalhar/127" in url:
        candidates = [c for c in candidates if c["section"] == "ethics"]
    if not candidates:
        return None, "article-not-found-or-nested-amendment"
    if len(candidates) != 1:
        return None, "ambiguous-article-number"
    candidate = candidates[0]
    if re.search(r"\(\d+/\d+", label + " " + occurrence["scope"]):
        return candidate, "partial-article-requires-scope-review"
    if candidate["warnings"]:
        return candidate, "source-warning-review-required"
    return candidate, "candidate-ready-for-review"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="Fetch official sources; otherwise reuse existing cache manifest.")
    parser.add_argument("--out", type=Path, default=ROOT.parent / "law-refresh-audit")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    cache = out / "raw"
    cache.mkdir(exist_ok=True)
    inventory = read_inventory()
    (out / "inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf8")
    manifest_file = out / "sources.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf8")) if manifest_file.exists() else []
    by_url = {item["url"]: item for item in manifest}
    if args.fetch:
        pending = [url for url in inventory["sources"] if by_url.get(url, {}).get("status") != "fetched"]
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(8, args.workers))) as pool:
            for result in pool.map(lambda url: fetch_source(url, cache), pending):
                by_url[result["url"]] = result
                manifest_file.write_text(json.dumps(list(by_url.values()), ensure_ascii=False, indent=2), encoding="utf8")
                print(result["status"], result["url"], flush=True)
    parsed_sources = {}
    for url, source in by_url.items():
        if source.get("status") != "fetched" or not source.get("cacheFile", "").endswith(".html"):
            continue
        parsed = parse_html((cache / source["cacheFile"]).read_bytes(), source.get("finalUrl", url))
        parsed_sources[url] = parsed
        (out / (source["key"] + ".parsed.json")).write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf8")
    proposals = []
    for occurrence in inventory["occurrences"]:
        parsed = parsed_sources.get(occurrence["url"])
        result = {k: v for k, v in occurrence.items() if k != "text"}
        if not parsed:
            result.update(status="source-unavailable-or-unparsed", reason=by_url.get(occurrence["url"], {}).get("reason", "not fetched or PDF"))
        else:
            candidate, status = select_candidate(parsed, occurrence)
            result["status"] = status
            if candidate:
                result.update(candidateText=candidate["text"], candidateHash=digest(candidate["text"]), sourceLinks=candidate["links"], warnings=candidate["warnings"])
                if occurrence["text"] is not None and normalized(candidate["text"]) == normalized(occurrence["text"]):
                    result["status"] = "text-equal-source"
        proposals.append(result)
    (out / "proposals.json").write_text(json.dumps(proposals, ensure_ascii=False, indent=2), encoding="utf8")
    summary = {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "scope": "Every local law group plus metadata-only groups; no app files modified", "lawFiles": inventory["lawFiles"], "metadataGroups": inventory["metadataGroups"], "unionGroups": len(inventory["groups"]), "metadataGroupsWithoutLocalContent": len(inventory["metadataMissing"]), "articleOccurrences": len(proposals), "sourceCount": len(inventory["sources"]), "sourceStatus": dict(Counter(by_url.get(url, {}).get("status", "not-fetched") for url in inventory["sources"])), "proposalStatus": dict(Counter(p["status"] for p in proposals)), "limitations": ["Downloading and parsing are not verification of legal effectiveness.", "Partial articles, nested amendments, duplicated article identities and dates of effect require explicit review.", "Priorities, IDs, user progress and every app source file are untouched."]}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
