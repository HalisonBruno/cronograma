// Aba Matérias, modo "na ordem do material": a lei seca aparece agrupada por código e em ordem crescente
// de artigo (com sufixo e frações), e o caderno TEC fica dentro de "ferramentas da matéria" (16/09/2026).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, ord, ordChave, artRank, devicePos, lawIdOf, lawGroupMeta, unitsOf, allBlocks, LG, MATLIST, setOrdModo: v => { ordModo = v; }, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const at = new Date('2026-09-08T12:00:00').getTime();
const a = loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]}).app;
a.setOrdModo('mat');

// 1. Peças da chave.
assert(a.artRank('121') < a.artRank('121-A') && a.artRank('121-A') < a.artRank('121-B') && a.artRank('121-B') < a.artRank('122'), 'sufixo entre o artigo e o seguinte');
assert(a.artRank('6 (cont.)') === a.artRank('6'));
assert.equal(a.devicePos('CF · art. 5 (1/4: caput e I–XXIV)'), 0);
assert.equal(a.devicePos('CF · art. 5 (2/4: XXV–XLV)'), 25);
assert(a.devicePos('CF · art. 155, § 2º, VIII–XII; §§ 3º–5º; § 6º, caput e I') < a.devicePos('CF · art. 155, § 6º, incisos II–III e alíneas'), 'o parágrafo do título de leitura manda na ordem');
assert(a.devicePos('LIA · art. 17 (2/2: § 10-C–§ 21)') > a.devicePos('LIA · art. 17 (1/2: caput–§ 10-B, II)'));
assert(a.devicePos('Lei 8.072 · art. 1º, parágrafo único, incisos I–VIII') > a.devicePos('Lei 8.072 · art. 1 (1/2: caput e I–Parágrafo único)'));
assert.equal(a.lawIdOf({u: 'https://www.planalto.gov.br/ccivil_03/leis/l6404compilada.htm', sub: 'LSA · art. 110-A'}), a.lawIdOf({u: 'https://www.planalto.gov.br/ccivil_03/leis/l6404.htm', sub: 'Lei 6.404 · arts. 129'}), 'a mesma lei com rótulos diferentes é o mesmo código');
assert.notEqual(a.lawIdOf({u: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm', sub: 'CF · ADCT art. 10'}), a.lawIdOf({u: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm', sub: 'CF · art. 10'}), 'ADCT é um código à parte');

// 2. Todas as matérias: cada código aparece num único trecho, com artigos em ordem crescente.
const seg = g => { const u = String(g.u || '').toLowerCase(); return (u.split('/').pop() || '').replace(/\.html?$/, '').replace(/compilad[oa]$/, '') + (/\bADCT\b/.test(g.sub || '') ? ':adct' : ''); };
const kPart = sub => { const m = String(sub || '').match(/\((\d+)\/\d+/); return m ? +m[1] : 0; };
let checked = 0, stKeys = 0;
for (const m of a.MATLIST) {
  const items = [];
  a.allBlocks.filter(b => b.mat === m && b.tipo === 'LEI' && !b.opt).forEach(b => a.unitsOf(b).forEach(u => items.push({k: u.key, s: 0, dn: false, r: 0, u})));
  if (!items.length) continue;
  const rows = a.ord(items).map(x => { const g = a.lawGroupMeta(x.u).group; return {k: x.k, law: seg(g), sub: g.sub, art: a.artRank((g.a || [])[0]), part: kPart(g.sub)}; });
  const closed = new Set();
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (prev && prev.law !== r.law) { closed.add(prev.law); assert(!closed.has(r.law), m + ': ' + r.law + ' reaparece em "' + r.sub + '"'); }
    if (prev && prev.law === r.law) assert(prev.art < r.art || (prev.art === r.art && prev.part <= r.part), m + ': fora de ordem "' + prev.sub + '" -> "' + r.sub + '"');
    if (r.k.startsWith('st:')) stKeys++;
  });
  checked += rows.length;
}
assert(checked > 500, 'todas as matérias com lei seca verificadas: ' + checked);
assert(stKeys > 0, 'o caso do bloco com um único grupo (chave st:) está coberto');

// 3. O caderno TEC é anexado dentro de "ferramentas da matéria", não solto na página.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(/ferr\.appendChild\(tecNotebookPanel\(m\)\)/.test(html), 'o painel TEC entra no details das ferramentas');
assert(!/root\.appendChild\(tecNotebookPanel\(/.test(html), 'o painel TEC não fica solto na página');
console.log('law-material-order: ok (' + checked + ' grupos de lei, ' + stKeys + ' chaves st:)');
