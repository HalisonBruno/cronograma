const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Reuse the existing isolated page harness; no real browser state is read or changed.
const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', '_LEICACHE, leiTexto, textoDe, lawGroupMeta, lawAuditHtml, lawDocLink, artHtml, updateStats, unitCard,');
const context = { require, console, __dirname, queueMicrotask, URL, Blob };
vm.runInNewContext(harness + ';globalThis.loadTestApp=loadApp;', context);

async function main() {
  const { app: a } = context.loadTestApp();
  let cases = 0;
  const source = 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm';
  const audited = { status: 'source-reviewed', checkedAt: '2026-09-10T13:00:00Z', sourceUrl: source };
  const block = { id: 'test-law', tipo: 'LEI', min: 10, mat: 'Constitucional', t: 'Lei seca' };
  const unit = key => ({ key, b: block });
  const visible = { id: 'bbbbbb', r: 'CF', sub: 'CF · art. 5 (2/4: XXV–XLV)', a: ['5 (2/4)'], fa: '5', u: source, m: 10 };
  const hidden = { id: 'aaaaaa', r: 'CC', sub: 'CC · art. 1', a: ['1'], x: true };
  a.LG[block.id] = [hidden, visible];
  a._LEICACHE[block.id] = {
    id: block.id, audit: audited,
    g: [
      { id: hidden.id, r: 'CC', a: [{ n: '1', t: 'WRONG_FIRST_GROUP' }] },
      { id: visible.id, r: 'CF', u: source, a: [{ n: '5 (2/4)', t: 'XXV — EXACT_FRAGMENT\nXLV — FRAGMENT_END' }] },
    ],
  };

  let html = await a.textoDe(unit('lg2:test-law:bbbbbb'));
  assert(html.includes('EXACT_FRAGMENT'));
  assert(!html.includes('WRONG_FIRST_GROUP'), 'explicit group never falls back to the first group');
  assert(html.includes('2/4: XXV–XLV'), 'exact fragment scope is visible before its text');
  cases++;

  html = await a.textoDe(unit('st:test-law'));
  assert(html.includes('EXACT_FRAGMENT'), 'atomic key uses the sole visible metadata group');
  assert(!html.includes('WRONG_FIRST_GROUP'), 'hidden first JSON group must not replace an atomic task');
  cases++;

  a.LG[block.id].push({ ...visible, id: 'cccccc' });
  html = await a.textoDe(unit('st:test-law'));
  assert(html.includes('law-missing'), 'ambiguous atomic task is reported, not guessed');
  assert(!html.includes('EXACT_FRAGMENT'));
  a.LG[block.id].pop();
  cases++;

  a._LEICACHE[block.id].g.pop();
  html = await a.textoDe(unit('lg2:test-law:bbbbbb'));
  assert(html.includes('Nenhum outro trecho foi colocado no lugar'));
  assert(html.includes(source));
  assert(!html.includes('WRONG_FIRST_GROUP'), 'missing group with a nonempty sibling file still cannot fall back');
  cases++;

  a._LEICACHE[block.id].g = [];
  html = await a.textoDe(unit('st:test-law'));
  assert(html.includes('law-missing'), 'empty JSON has an actionable exact-scope message');
  assert(html.includes('CF · art. 5 (2/4: XXV–XLV)'));
  cases++;

  html = a.artHtml('CF', { n: '5', t: 'VALID_TEXT' }, audited, source);
  assert(html.includes('data-law-status="source-reviewed"'));
  assert(html.includes('10/09/2026'));
  assert(html.includes('fonte oficial'));
  assert(!html.includes('Conferência legislativa pendente'));
  cases++;

  html = a.artHtml('CF', { n: '5', t: 'NEEDS_REVIEW', audit: { status: 'needs-review', notes: ['Fragmento pendente <revisão>.'] } }, audited, source);
  assert(html.includes('data-law-status="needs-review"'), 'article-level warning overrides reviewed parent');
  assert(html.includes('Fragmento pendente &lt;revisão&gt;.'));
  assert(!html.includes('Texto conferido na fonte oficial'));
  assert(html.includes(source));
  cases++;

  html = a.artHtml('CF', { n: '5', t: 'LEGACY_TEXT' }, undefined, source);
  assert(html.includes('Conferência legislativa pendente'), 'legacy content is never silently labeled current');
  assert(html.includes('LEGACY_TEXT'), 'unverified local text remains accessible with a clear warning');
  cases++;

  html = a.lawAuditHtml({ status: 'needs-review', sourceUrl: 'javascript:alert(1)', notes: '<script>alert(1)</script>' });
  assert(!html.includes('href="javascript:'));
  assert(html.includes('&lt;script&gt;'));
  cases++;

  html = a.lawDocLink('test-drive-file');
  assert(html.includes('DOCX anterior — não revisado'));
  assert(html.includes('não se aplica a este DOCX anterior'));
  cases++;

  const planned = a.unitsOf(block)[0];
  assert.equal(planned.key, 'st:test-law');
  html = a.unitCard(planned, false).innerHTML;
  assert(html.includes('abrir lei oficial'), 'atomic law card retains the exact selected group link');
  assert(html.includes('2/4: XXV–XLV'));
  assert(html.includes('ler aqui'));
  cases++;

  // The page must never change priority inputs while rendering source provenance.
  const priorities = JSON.stringify([a.DATA.peso, a.DATA.rend, a.DATA.heat]);
  await a.textoDe(unit('st:test-law'));
  assert.equal(JSON.stringify([a.DATA.peso, a.DATA.rend, a.DATA.heat]), priorities);
  cases++;

  visible.readTitle='CF · art. 5, incisos XXV–XLV — recorte conferido';
  visible.readSourceUrl=source+'#art5';
  html=a.unitCard(a.unitsOf(block)[0],false).innerHTML;
  assert(html.includes(visible.readTitle));
  assert(html.includes(source+'#art5'));
  cases++;

  html=a.artHtml('CPC',{n:'196',t:'Texto atual',sourceLinks:[{text:'Vigência futura',url:source+'#art5'}]},audited,source);
  assert(html.includes('Alterações e vigência'));
  assert(html.includes('Vigência futura ↗'));
  cases++;

  console.log(JSON.stringify({ cases, status: 'ok', suite: 'law-exact-scope-and-source-audit' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
