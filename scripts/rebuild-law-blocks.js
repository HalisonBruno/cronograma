const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const INDEX = path.join(ROOT, "index.html");
const LAW_DIR = path.join(ROOT, "leis");
const LAW_SOURCE_DIR = path.join(LAW_DIR, "sources");
const MAX_DEVICES = 15;
const MINUTES_PER_DEVICE = 3;
const sourceRefArg = process.argv.find(value => value.startsWith("--from="));
const SOURCE_REF = sourceRefArg ? sourceRefArg.slice("--from=".length) : "";

function readSource(relativePath) {
  if (!SOURCE_REF) return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  return childProcess.execFileSync("git", ["show", `${SOURCE_REF}:${relativePath.replaceAll("\\", "/")}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });
}

const targetHtml = fs.readFileSync(INDEX, "utf8");
const html = readSource("index.html");
const dataMatch = html.match(/const DATA = (.*);\r?\nconst API/s);
if (!dataMatch) throw new Error("Não foi possível localizar DATA em index.html");
const data = JSON.parse(dataMatch[1]);
const oldMigration = data.lgmig || {};

const lawBlocks = new Map();
for (const day of data.days) {
  for (const block of day.blocks) {
    if (block.tipo === "LEI") lawBlocks.set(block.id, { ...block, day: day.d, week: day.wk });
  }
}

const oldMeta = data.leigroups || {};
const lugSource = JSON.parse(fs.readFileSync(path.join(LAW_SOURCE_DIR, "lug-selected.json"), "utf8"));
const tstSource = JSON.parse(fs.readFileSync(path.join(LAW_SOURCE_DIR, "tst-sumulas-selected.json"), "utf8"));
const files = fs.readdirSync(LAW_DIR).filter(name => name.endsWith(".json")).sort();
const sourceByBlock = new Map();
for (const file of files) {
  const source = JSON.parse(readSource(path.join("leis", file)));
  sourceByBlock.set(source.id, source);
}

const urlCodes = [
  [/constituicao/i, "CF"], [/l10406|10406compilada/i, "CC"], [/l13105/i, "CPC"],
  [/del2848/i, "CP"], [/del3689/i, "CPP"], [/l8078/i, "CDC"],
  [/l5172/i, "CTN"], [/l14133/i, "Lei 14.133"], [/l6404/i, "Lei 6.404"],
  [/l11101/i, "LRF"], [/l8112/i, "Lei 8.112"], [/l8429/i, "LIA"],
  [/l9784/i, "Lei 9.784"], [/l12016/i, "Lei 12.016"], [/l9507/i, "Lei 9.507"],
  [/l4717/i, "Lei 4.717"], [/l7357/i, "Lei 7.357"], [/l5474/i, "Lei 5.474"],
  [/l9492/i, "Lei 9.492"], [/d57663/i, "LUG"], [/l13775/i, "Lei 13.775"],
  [/l9099/i, "Lei 9.099"], [/l8069/i, "ECA"], [/l13146/i, "EPD"],
  [/l10741/i, "Estatuto do Idoso"], [/l11340/i, "Lei 11.340"], [/l11343/i, "Lei 11.343"],
  [/l12850/i, "Lei 12.850"], [/l9605/i, "Lei 9.605"], [/l13709/i, "LGPD"],
  [/l12965/i, "Marco Civil"], [/l6015/i, "LRP"], [/l8245/i, "Lei 8.245"],
  [/l8987/i, "Lei 8.987"], [/l9279/i, "Lei 9.279"], [/l9610/i, "Lei 9.610"],
  [/l5764/i, "Lei 5.764"], [/l5869/i, "CPC/1973"], [/l9868/i, "Lei 9.868"],
  [/l9882/i, "Lei 9.882"], [/l7347/i, "Lei 7.347"], [/l14195/i, "Lei 14.195"],
  [/l13303/i, "Lei 13.303"], [/l13848/i, "Lei 13.848"], [/l12846/i, "Lei 12.846"],
  [/l12529/i, "Lei 12.529"], [/l12527/i, "LAI"], [/l10180/i, "Lei 10.180"],
  [/l4320/i, "Lei 4.320"], [/lcp101/i, "LRF"], [/l6938/i, "Lei 6.938"],
  [/l9433/i, "Lei 9.433"], [/l12651/i, "Código Florestal"], [/l10257/i, "Estatuto da Cidade"],
  [/l4504/i, "Estatuto da Terra"], [/del3365/i, "Decreto-Lei 3.365"],
];

function hash6(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 6);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function metaFor(blockId, groupId) {
  return (oldMeta[blockId] || []).find(group => group.id === groupId) || {};
}

function codeFor(group, meta) {
  if (group.code) return group.code;
  if (meta.sg) return meta.sg;
  const matches = [...String(group.r || "").matchAll(/—\s*([^—·]+?)\s*·\s*art/gi)];
  if (matches.length) return matches[matches.length - 1][1].trim();
  for (const [pattern, code] of urlCodes) if (pattern.test(group.u || "")) return code;
  return meta.nl || "Lei seca";
}

function kindFor(group, meta) {
  if (group.kind) return group.kind;
  const value = `${group.r || ""} ${meta.r || ""}`;
  if (/revis[aã]o|já lidos/i.test(value) || meta.rev) return "review";
  if (/consulta|fora do tempo/i.test(value)) return "reference";
  if (/leitura dirigida/i.test(value) || meta.dir) return "directed";
  return "required";
}

function themeFor(group, meta, code) {
  if (group.theme) return group.theme;
  let value = String(group.r || meta.r || "Leitura da legislação");
  value = value.replace(new RegExp(`\\s*—\\s*${escapeRegex(code)}\\s*·\\s*arts?[\\s\\S]*$`, "i"), "");
  value = value.replace(new RegExp(`^${escapeRegex(code)}\\s*—\\s*`, "i"), "");
  value = value.replace(/^Revisão\s*—\s*/i, "");
  value = value.replace(/\s*·\s*(consulta|leitura dirigida).*$/i, "");
  value = value.replace(/\s*…\s*$/u, "").trim();
  return value || "Leitura da legislação";
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rankFor(kind) {
  return { required: 4, directed: 3, reference: 2, review: 1 }[kind] || 0;
}

function articleKey(block, group, article) {
  const textHash = crypto.createHash("sha1").update(normalizeText(article.t)).digest("hex").slice(0, 12);
  return `${block.mat}|${String(group.u || "").toLowerCase()}|${normalizeText(article.n)}|${textHash}`;
}

function markerCount(text) {
  const value = String(text || "");
  const structural = value.match(/(?:^|\n)\s*(?:§\s*\d+|Parágrafo único|[IVXLCDM]+\s*[-–]|[a-z]\)\s)/g) || [];
  // Um inciso ou parágrafo curto não equivale sozinho a um artigo de leitura.
  // A ponderação só aumenta para dispositivos realmente longos, preservando
  // blocos de cerca de 10 a 15 artigos e dividindo os artigos excepcionais.
  return Math.max(1, Math.ceil((structural.length + 1) / 5), Math.ceil(value.length / 1200));
}

function segmentText(text) {
  const prepared = String(text || "")
    .replace(/\s+(?=(?:§\s*\d+|Parágrafo único|[IVXLCDM]+\s*[-–]|[a-z]\)\s))/g, "\n")
    .split(/\n+/)
    .map(value => value.trim())
    .filter(Boolean);
  const out = [];
  for (const segment of prepared) {
    if (markerCount(segment) <= MAX_DEVICES && segment.length <= 5000) {
      out.push(segment);
      continue;
    }
    const sentences = segment.split(/(?<=[.;:])\s+/).filter(Boolean);
    let current = "";
    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence}` : sentence;
      if (current && (markerCount(next) > MAX_DEVICES || next.length > 5000)) {
        out.push(current);
        current = sentence;
      } else current = next;
    }
    if (current) out.push(current);
  }
  return out.length ? out : [String(text || "")];
}

function splitArticle(article, preserveWhole) {
  const weight = markerCount(article.t);
  if (preserveWhole || weight <= MAX_DEVICES) return [{ ...article, weight: Math.min(preserveWhole ? 25 : MAX_DEVICES, weight) }];
  const segments = segmentText(article.t);
  const parts = [];
  let current = [];
  let currentWeight = 0;
  for (const segment of segments) {
    const weightSegment = Math.min(MAX_DEVICES, markerCount(segment));
    if (current.length && currentWeight + weightSegment > MAX_DEVICES) {
      parts.push({ text: current.join("\n"), weight: currentWeight });
      current = [];
      currentWeight = 0;
    }
    current.push(segment);
    currentWeight += weightSegment;
  }
  if (current.length) parts.push({ text: current.join("\n"), weight: currentWeight });
  return parts.map((part, index) => ({
    n: `${article.n} (${index + 1}/${parts.length})`,
    t: part.text,
    v: article.v || [],
    ownerKey: article.ownerKey,
    weight: Math.max(1, Math.min(MAX_DEVICES, part.weight)),
  }));
}

function numericBase(label) {
  const match = String(label).match(/^(\d+)(?:-([A-Z]))?/i);
  return match ? { number: Number(match[1]), suffix: match[2] || "", raw: match[0] } : null;
}

function displayNumber(value) {
  return String(value).replace(/^\d{4,}/, digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, "."));
}

function scopeFor(code, labels) {
  const unique = [...new Set(labels.map(value => String(value).trim()).filter(Boolean))];
  if (!unique.length) return code;
  if (unique.some(value => /\(/.test(value))) {
    const prefix = unique.length === 1 ? "art." : "arts.";
    return `${code} · ${prefix} ${unique.map(displayNumber).join(", ")}`;
  }
  const tokens = [];
  let index = 0;
  while (index < unique.length) {
    const start = numericBase(unique[index]);
    if (!start || start.suffix) {
      tokens.push(displayNumber(unique[index++]));
      continue;
    }
    let end = index;
    while (end + 1 < unique.length) {
      const next = numericBase(unique[end + 1]);
      const previous = numericBase(unique[end]);
      if (!next || next.suffix || !previous || next.number !== previous.number + 1) break;
      end++;
    }
    if (end - index >= 2) tokens.push(`${displayNumber(unique[index])}–${displayNumber(unique[end])}`);
    else for (let cursor = index; cursor <= end; cursor++) tokens.push(displayNumber(unique[cursor]));
    index = end + 1;
  }
  return `${code} · ${unique.length === 1 ? "art." : "arts."} ${tokens.join(", ")}`;
}

function heatFor(code, labels) {
  return labels.reduce((total, label) => {
    const base = String(label).match(/^\d+(?:-[A-Z])?/i)?.[0];
    return total + Number((data.heat || {})[`${String(code).toUpperCase()}|${base}`] || 0);
  }, 0);
}

function chunkParts(parts, preserveWhole) {
  if (preserveWhole) return parts.map(part => [part]);
  const chunks = [];
  let current = [];
  let weight = 0;
  for (const part of parts) {
    if (current.length && (weight + part.weight > MAX_DEVICES || current.length >= MAX_DEVICES)) {
      chunks.push(current);
      current = [];
      weight = 0;
    }
    current.push(part);
    weight += part.weight;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const occurrences = [];
for (const [blockId, source] of sourceByBlock) {
  const block = lawBlocks.get(blockId);
  if (!block) continue;
  (source.g || []).forEach((group, groupOrder) => {
    const meta = metaFor(blockId, group.id);
    const kind = kindFor(group, meta);
    const code = codeFor(group, meta);
    const theme = themeFor(group, meta, code);
    (group.a || []).forEach((article, articleOrder) => occurrences.push({
      block, blockId, group, groupOrder, article, articleOrder, meta, kind, code, theme,
      key: articleKey(block, group, article),
    }));
  });
}

const owners = new Map();
for (const occurrence of occurrences) {
  const current = owners.get(occurrence.key);
  if (!current) {
    owners.set(occurrence.key, occurrence);
    continue;
  }
  const candidateScore = [rankFor(occurrence.kind), -(occurrence.group.a || []).length, -Number(occurrence.block.day.replaceAll("-", ""))];
  const currentScore = [rankFor(current.kind), -(current.group.a || []).length, -Number(current.block.day.replaceAll("-", ""))];
  if (candidateScore.some((value, index) => value !== currentScore[index] && value > currentScore[index] && candidateScore.slice(0, index).every((prior, i) => prior === currentScore[i]))) {
    owners.set(occurrence.key, occurrence);
  }
}

const selectedByGroup = new Map();
for (const occurrence of owners.values()) {
  const key = `${occurrence.blockId}|${occurrence.group.id}`;
  if (!selectedByGroup.has(key)) selectedByGroup.set(key, []);
  selectedByGroup.get(key).push(occurrence);
}
for (const list of selectedByGroup.values()) list.sort((a, b) => a.articleOrder - b.articleOrder);

function manualGroups(blockId, group, kind, code, theme) {
  if (/Súmulas TST 331 e 425/i.test(group.r || "")) {
    const labels = ["331", "425"];
    return [{
      id: hash6(`${blockId}|sumulas-tst-331-425`), r: theme, sub: "Súmulas TST 331 e 425 — leitura integral",
      u: tstSource.source, a: labels, sourceA: labels.map(n => ({ n, t: tstSource.sumulas[n], v: [] })),
      m: 20, d: 2, fixedMin: 1, kind, manual: 1, src: group.id,
    }];
  }
  if (/57\.663|LUG/i.test(`${group.r || ""} ${group.u || ""}`)) {
    const ranges = [
      ["1", "2", "11", "12", "13", "14", "15", "16", "17", "30", "31", "32", "33"],
      ["34", "38", "39", "40", "43", "44", "70", "71", "75", "76", "77", "78"],
    ];
    return ranges.map((articles, index) => ({
      id: hash6(`${blockId}|lug|${index}`), r: "Lei Uniforme de Genebra — letras de câmbio e notas promissórias",
      sub: scopeFor("LUG (Anexo I)", articles), u: group.u || lugSource.source, a: articles,
      sourceA: articles.map(n => ({ n, t: lugSource.articles[n], v: [] })), m: articles.length * MINUTES_PER_DEVICE,
      d: articles.length, fixedMin: 1, kind: "directed", manual: 1, src: group.id,
    }));
  }
  return [];
}

const rebuiltMeta = {};
const targetKeysByArticleKey = new Map();
const migrationTargetsBySourceGroup = new Map();
const audit = { blocks: 0, groups: 0, required: 0, directed: 0, reference: 0, review: 0, manual: 0, maxDevices: 0, maxMinutes: 0 };

for (const [blockId, block] of lawBlocks) {
  const source = sourceByBlock.get(blockId) || { id: blockId, g: [] };
  const outputGroups = [];
  const outputMeta = [];
  const targetRefs = [];

  for (const group of source.g || []) {
    const meta = metaFor(blockId, group.id);
    const kind = kindFor(group, meta);
    const code = codeFor(group, meta);
    const theme = themeFor(group, meta, code);
    if (!(group.a || []).length) {
      for (const manual of manualGroups(blockId, group, kind, code, theme)) {
        const { sourceA, ...manualMeta } = manual;
        if (!sourceA?.length || sourceA.some(article => !normalizeText(article.t))) {
          throw new Error(`Conteúdo local incompleto para o grupo manual ${manual.id} (${blockId})`);
        }
        outputGroups.push({ ...manualMeta, a: sourceA });
        outputMeta.push(manualMeta);
      }
      continue;
    }
    const selected = selectedByGroup.get(`${blockId}|${group.id}`) || [];
    if (!selected.length) continue;
    if (kind === "review") {
      const reviewItems = selected
        .slice()
        .sort((a, b) => heatFor(code, [b.article.n]) - heatFor(code, [a.article.n]) || a.articleOrder - b.articleOrder)
        .slice(0, 10)
        .sort((a, b) => a.articleOrder - b.articleOrder);
      const labels = reviewItems.map(item => item.article.n);
      const id = hash6(`${blockId}|${group.src || group.id}|review|${labels.join("|")}`);
      const rebuilt = {
        id, r: `Revisão programada — ${theme}`, sub: scopeFor(code, labels), u: group.u || meta.u || "",
        a: labels, m: 30, d: Math.min(10, labels.length || 1), kind: "review", rev: 1, fixedMin: 1,
        src: group.src || group.id, pri: 50 - block.week / 100, heat: heatFor(code, labels),
      };
      outputMeta.push(rebuilt);
      outputGroups.push({ ...rebuilt, a: reviewItems.map(item => item.article) });
      targetRefs.push({ id, articleKeys: reviewItems.map(item => item.key) });
      continue;
    }
    const preserveArt5 = /CF\s*·\s*art\.\s*5\s*\([1-4]\/4:/i.test(meta.sub || group.r || "");
    const parts = selected.flatMap(item => splitArticle({ ...item.article, ownerKey: item.key }, preserveArt5));
    for (const [chunkIndex, chunk] of chunkParts(parts, preserveArt5).entries()) {
      const labels = chunk.map(part => part.n);
      const devices = Math.max(1, chunk.reduce((total, part) => total + part.weight, 0));
      const art5Scope = String(group.r || "").match(/CF\s*·\s*art\.\s*5\s*\([1-4]\/4:[^)]+\)/i)?.[0];
      const sub = preserveArt5 ? (meta.sub || art5Scope || scopeFor(code, labels)) : scopeFor(code, labels);
      const id = hash6(`${blockId}|${group.src || group.id}|${chunkIndex}|${labels.join("|")}`);
      const minutes = preserveArt5 ? 45 : Math.min(45, Math.max(5, devices * MINUTES_PER_DEVICE));
      const heat = heatFor(code, labels);
      const priorityBase = { required: 300, directed: 200, reference: 100, review: 50 }[kind] || 0;
      const rebuilt = {
        id, r: theme, sub, u: group.u || meta.u || "", a: labels, m: minutes, d: devices,
        kind, src: group.src || group.id, pri: priorityBase + Math.min(80, heat) - block.week / 100,
        heat,
      };
      if (kind === "directed" || kind === "reference") rebuilt.dir = 1;
      if (kind === "review") rebuilt.rev = 1;
      if (preserveArt5) { rebuilt.fa = "5"; rebuilt.fixedMin = 1; }
      outputMeta.push(rebuilt);
      targetRefs.push({ id, articleKeys: [...new Set(chunk.map(part => part.ownerKey).filter(Boolean))] });
      outputGroups.push({ ...rebuilt, a: chunk.map(({ weight, ownerKey, ...article }) => article) });
    }
  }

  if (!outputGroups.length) {
    const candidates = occurrences.filter(item => item.blockId === blockId).slice(0, 10);
    if (candidates.length) {
      const code = candidates[0].code;
      const labels = candidates.map(item => item.article.n);
      const id = hash6(`${blockId}|review-fallback|${labels.join("|")}`);
      const devices = Math.min(MAX_DEVICES, candidates.reduce((sum, item) => sum + Math.min(2, markerCount(item.article.t)), 0));
      const rebuilt = {
        id, r: "Revisão programada dos dispositivos já estudados", sub: scopeFor(code, labels),
        u: candidates[0].group.u || "", a: labels, m: Math.min(30, Math.max(10, devices * 2)), d: devices,
        kind: "review", rev: 1, fixedMin: 1, src: "review-fallback", pri: 49 - block.week / 100,
      };
      outputMeta.push(rebuilt);
      outputGroups.push({ ...rebuilt, a: candidates.map(item => item.article) });
      targetRefs.push({ id, articleKeys: candidates.map(item => item.key) });
    }
  }

  const targetKeyFor = groupId => outputMeta.length > 1 ? `lg2:${blockId}:${groupId}` : `st:${blockId}`;
  for (const ref of targetRefs) {
    const targetKey = targetKeyFor(ref.id);
    for (const articleKeyValue of ref.articleKeys) {
      if (!targetKeysByArticleKey.has(articleKeyValue)) targetKeysByArticleKey.set(articleKeyValue, new Set());
      targetKeysByArticleKey.get(articleKeyValue).add(targetKey);
    }
  }
  for (const group of source.g || []) {
    const manualTargets = outputMeta.filter(meta => meta.manual && meta.src === group.id).map(meta => targetKeyFor(meta.id));
    if (manualTargets.length) migrationTargetsBySourceGroup.set(`${blockId}|${group.id}`, new Set(manualTargets));
  }

  rebuiltMeta[blockId] = outputMeta;
  fs.writeFileSync(path.join(LAW_DIR, `${blockId}.json`), `${JSON.stringify({ id: blockId, g: outputGroups })}\n`);
  audit.blocks++;
  for (const group of outputMeta) {
    audit.groups++;
    audit[group.kind] = (audit[group.kind] || 0) + 1;
    if (group.manual) audit.manual++;
    audit.maxDevices = Math.max(audit.maxDevices, group.d || 0);
    audit.maxMinutes = Math.max(audit.maxMinutes, group.m || 0);
  }
}

data.leigroups = rebuiltMeta;
const migrationV5 = {};
const recordMigration = (sourceKey, targets) => {
  const unique = [...new Set(targets)].filter(Boolean).sort();
  if (unique.length) migrationV5[sourceKey] = unique;
};
for (const [blockId, source] of sourceByBlock) {
  const block = lawBlocks.get(blockId);
  if (!block) continue;
  const sourceTargets = new Map();
  (source.g || []).forEach((group, index) => {
    const targets = new Set(migrationTargetsBySourceGroup.get(`${blockId}|${group.id}`) || []);
    for (const article of group.a || []) {
      const key = articleKey(block, group, article);
      for (const target of targetKeysByArticleKey.get(key) || []) targets.add(target);
    }
    sourceTargets.set(group.id, targets);
    recordMigration(`lg2:${blockId}:${group.id}`, targets);
    recordMigration(`lg:${blockId}:${index}`, targets);
  });
  recordMigration(`st:${blockId}`, [...sourceTargets.values()].flatMap(targets => [...targets]));
  for (const [legacyId, currentIds] of Object.entries(oldMigration[blockId] || {})) {
    const targets = currentIds.flatMap(currentId => [...(sourceTargets.get(currentId) || [])]);
    const legacyKey = legacyId.startsWith("g:") ? `lg2:${blockId}:${legacyId.slice(2)}` : `lg:${blockId}:${legacyId}`;
    recordMigration(legacyKey, targets);
  }
}
data.lgmig2 = migrationV5;
const targetDataMatch = targetHtml.match(/const DATA = (.*);\r?\nconst API/s);
if (!targetDataMatch) throw new Error("Não foi possível atualizar DATA no index.html de destino");
const nextHtml = targetHtml.replace(targetDataMatch[1], JSON.stringify(data));
fs.writeFileSync(INDEX, nextHtml);

const examples = ["2026-09-22-0", "2026-08-25-0", "2026-09-15-0", "2026-09-29-0", "2026-09-08-0"]
  .map(id => ({ id, groups: (rebuiltMeta[id] || []).length, maxDevices: Math.max(0, ...(rebuiltMeta[id] || []).map(group => group.d || 0)) }));
console.log(JSON.stringify({ ...audit, examples }, null, 2));
