const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Real production reconciliation, isolated from browser storage and sync.
// The sandbox fallback allows this suite to run before the generated PDF manifest
// is embedded; when present, the real constant is the one exported and exercised.
const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('console, document,', 'console, document, LAW_EVIDENCE: {records:[]},')
  .replace('updateStats, unitCard,', 'LAW_EVIDENCE, unitDone, updateStats, unitCard,');
const context = { require, console, __dirname, queueMicrotask, URL, Blob };
vm.runInNewContext(harness + ';globalThis.loadTestApp=loadApp;', context);
const stamp = new Date('2026-09-08T12:00:00').getTime();
const lawUrl = 'https://www.planalto.gov.br/example-test-law';
let cases = 0;
function load(initial = {}) {
  const t = context.loadTestApp({ 'profile:120-weekdays:v1': [1, stamp], ...initial });
  t.app.LAW_EVIDENCE.records = [];
  return t;
}
function law(a, id, articles = ['1'], extra = {}) {
  const b = { id, tipo: 'LEI', mat: 'Constitucional', day: '2026-09-08', wk: 1, min: 10, t: 'Lei de teste' };
  const g = { id: id + '-group', a: articles, u: lawUrl, sub: 'Lei · arts. ' + articles.join(', '), m: 10, ...extra };
  a.allBlocks.push(b); a.LG[id] = [g];
  return { b, g, key: 'st:' + id };
}
function evidence(a, target, eq) {
  const c = a.EBK[eq.eb].caps.find(c => c.n === eq.cap);
  const e = { blockId: target.b.id, groupId: target.g.id, eb: eq.eb, cap: c.n,
    pages: [c.pi, c.pf], verified: true, method: 'full-normalized-text',
    source: { url: 'https://drive.google.com/file/d/test-pdf/view', sha256: 'a'.repeat(64) } };
  a.LAW_EVIDENCE.records.push(e);
  return e;
}

// Reported incident: theory chapters 1-5 are not the entire CF article 5.
// (bloco 2026-08-13-1~2 = CF art. 5 partes 2-4; o bloco de revisao 2026-10-12-0 foi apagado em 16/09/2026)
{
  const { app: a } = load();
  for (let c = 1; c <= 5; c++) a.SET('eb:constitucional:' + c, 1);
  a.syncEquiv();
  assert.equal(a.G('st:2026-08-13-1~2'), null);
  assert(a.unitsOf(a.allBlocks.find(b => b.id === '2026-08-13-1~2')).every(u => !a.unitDone(u)));
  cases++;
}
// A manual law parent must not be reinterpreted as reading its theory supplement.
{
  const { app: a } = load();
  a.SET('st:2026-08-13-1~2', 'done'); a.syncEquiv();
  for (let c = 1; c <= 5; c++) assert.equal(a.G('eb:constitucional:' + c), null);
  const ebook = a.allBlocks.find(b => b.tipo === 'EBOOK' && b.eb === 'constitucional');
  assert(a.unitsOf(ebook).every(u => !a.unitDone(u)), 'planIv cannot infer reading from a law parent');
  cases++;
}
// Manual video and manual chapter each mark their equivalent, without double time.
for (const fromVideo of [true, false]) {
  const { app: a } = load();
  const eq = a.DATA.equiv.find(e => e.grau === 'total');
  const cap = `eb:${eq.eb}:${eq.cap}`, video = `au:${eq.aula}`;
  const original = fromVideo ? video : cap, other = fromVideo ? cap : video;
  a.SET(original, 1);
  const minutes = a.studyMinutesOn('2026-09-08');
  const originalState = JSON.stringify(a.S.kv[original]);
  a.syncEquiv();
  assert.equal(a.G(other), 'auto');
  assert.equal(a.studyMinutesOn('2026-09-08'), minutes);
  assert.equal(JSON.stringify(a.S.kv[original]), originalState);
  cases++;
}
// A complete verified group is credited by manually reading the exact chapter.
{
  const { app: a } = load();
  const eq = a.DATA.equiv.find(e => e.grau === 'total');
  const target = law(a, 'evidence-target', ['1', '2']);
  const unverified = law(a, 'not-evidenced', ['1', '2']);
  evidence(a, target, eq);
  a.SET(`eb:${eq.eb}:${eq.cap}`, 1);
  const minutes = a.studyMinutesOn('2026-09-08');
  a.syncEquiv();
  assert.equal(a.G(target.key), 'done-auto');
  assert.equal(a.G(unverified.key), null, 'evidence is exact-group-specific, not a theme-level association');
  assert.equal(a.studyMinutesOn('2026-09-08'), minutes);
  a.SET(`eb:${eq.eb}:${eq.cap}`, null); a.syncEquiv();
  assert.equal(a.G(target.key), null, 'removing the reading root removes derived law credit');
  cases++;
}
// Even a verified PDF match cannot be credited from a video-derived ebook tick.
{
  const { app: a } = load();
  const eq = a.DATA.equiv.find(e => e.grau === 'total');
  const target = law(a, 'video-is-not-law'); evidence(a, target, eq);
  a.SET('au:' + eq.aula, 1); a.syncEquiv();
  assert.equal(a.G(`eb:${eq.eb}:${eq.cap}`), 'auto');
  assert.equal(a.G(target.key), null);
  cases++;
}
// The manifest must identify an actual chapter, complete source, exact group and pages.
{
  const { app: a } = load();
  const eq = a.DATA.equiv.find(e => e.grau === 'total');
  a.SET(`eb:${eq.eb}:${eq.cap}`, 1);
  const patches = [ { verified: false }, { method: 'topic-match' }, { source: {} },
    { groupId: 'different' }, { pages: [0, 1] }, { cap: 999999 } ];
  patches.forEach((patch, i) => {
    const target = law(a, 'invalid-evidence-' + i);
    Object.assign(evidence(a, target, eq), patch);
    a.syncEquiv(); assert.equal(a.G(target.key), null);
  });
  cases++;
}
// Manually reading an EBOOK parent can cover verified pages, not pages outside it.
{
  const { app: a } = load();
  const eq = a.DATA.equiv.find(e => e.grau === 'total');
  const target = law(a, 'parent-reading');
  const e = evidence(a, target, eq);
  const b = { id: 'manual-ebook-parent', tipo: 'EBOOK', mat: 'Administrativo', eb: eq.eb,
    pg: [...e.pages], min: 20, day: '2026-09-08', wk: 1, t: 'Leitura' };
  a.allBlocks.push(b); a.SET('st:' + b.id, 'done'); a.syncEquiv();
  assert.equal(a.G(target.key), 'done-auto');
  b.pg = [e.pages[0], e.pages[1] - 1]; a.syncEquiv();
  assert.equal(a.G(target.key), null);
  cases++;
}
// Derived migration repair preserves every manual key and its original timestamp.
{
  const initial = { 'st:2026-08-13-1~2': ['done-auto', stamp],
    'lg2:2026-08-13-1~2:1dd748': ['auto', stamp] };
  for (let c = 1; c <= 5; c++) initial['eb:constitucional:' + c] = [1, stamp - c];
  const { app: a } = load(initial);
  a.syncEquiv();
  assert.equal(a.G('st:2026-08-13-1~2'), null);
  assert.equal(a.G('lg2:2026-08-13-1~2:1dd748'), null);
  for (let c = 1; c <= 5; c++)
    assert.equal(JSON.stringify(a.S.kv['eb:constitucional:' + c]), JSON.stringify(initial['eb:constitucional:' + c]));
  const saved = JSON.stringify(a.S.kv); a.syncEquiv();
  assert.equal(JSON.stringify(a.S.kv), saved, 'repair is idempotent');
  cases++;
}
// An old partial/dynamic chapter tick does not attest to every law passage.
{
  const { app: a } = load();
  const eq = a.DATA.equiv.find(e => e.grau === 'total');
  const target = law(a, 'partial-chapter-is-not-full');
  evidence(a, target, eq);
  a.EBK[eq.eb].caps.find(c => c.n === eq.cap).part = 1;
  a.SET(`eb:${eq.eb}:${eq.cap}`, 1); a.syncEquiv();
  assert.equal(a.G('au:' + eq.aula), 'auto', 'video/ebook equivalence is unchanged');
  assert.equal(a.G(target.key), null);
  cases++;
}
// Complete article reading still covers another exact selection.
{
  const { app: a } = load();
  const first = law(a, 'full-source', ['1', '2']);
  const target = law(a, 'full-target', ['2']);
  a.SET(first.key, 'done'); a.syncEquiv();
  assert.equal(a.G(target.key), 'done-auto');
  cases++;
}
// One article fragment is neither its other fragment nor the entire article.
{
  const { app: a } = load();
  const first = law(a, 'fragment-source', ['5'], { fa: '5', sub: 'Lei · art. 5 (1/2: I–III)' });
  const same = law(a, 'fragment-twin', ['5'], { fa: '5', sub: first.g.sub });
  const other = law(a, 'fragment-other', ['5'], { fa: '5', sub: 'Lei · art. 5 (2/2: IV–VI)' });
  const full = law(a, 'fragment-not-full', ['5']);
  a.SET(first.key, 'done'); a.syncEquiv();
  assert.equal(a.G(same.key), 'done-auto');
  assert.equal(a.G(other.key), null);
  assert.equal(a.G(full.key), null);
  cases++;
}
console.log(JSON.stringify({ cases, status: 'ok', suite: 'law-equivalence-evidence' }));
