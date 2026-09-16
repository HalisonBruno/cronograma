// Estrelas de incidência por artigo no leitor de lei seca (16/09/2026): o grupo é identificado pela URL
// oficial e casa com as siglas variadas do mapa de calor; nada de casar CP com CPC/CPP por substring,
// nem de dar ao ADCT a estrela do artigo de mesmo número do corpo da CF.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, heatOf, heatLawIdOfGroup, heatLawIdOfSig, artHtml, LG, DATA, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const at = new Date('2026-09-08T12:00:00').getTime();
const a = loadApp({'profile:120-weekdays:v1': [1, at]}).app;

// Siglas do mapa e URLs dos grupos convergem para o mesmo identificador.
assert.equal(a.heatLawIdOfSig('CP'), '2848');
assert.equal(a.heatLawIdOfSig('LEI 8.429'), '8429');
assert.equal(a.heatLawIdOfSig('L8429'), '8429');
assert.equal(a.heatLawIdOfSig('LREF'), '11101');
assert.equal(a.heatLawIdOfGroup({u: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm', sub: 'CP · arts. 1–8'}), '2848');
assert.equal(a.heatLawIdOfGroup({u: 'https://www.planalto.gov.br/ccivil_03/leis/l8429.htm', sub: 'LIA · art. 17'}), '8429');
assert.equal(a.heatLawIdOfGroup({u: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm', sub: 'CF · ADCT art. 10'}), '', 'ADCT não herda o calor do corpo da CF');
assert.equal(a.heatLawIdOfGroup({u: 'https://www.planalto.gov.br/ccivil_03/leis/l8987cons.htm', sub: 'Lei 8.987 · art. 6'}), '8987');

// Continuação de artigo dividido entre blocos ("6 (cont.)") tem a mesma estrela do artigo.
const hot14133 = Object.keys(a.DATA.heat).find(k => a.heatLawIdOfSig(k.split('|')[0]) === '14133' && +a.DATA.heat[k] > 0);
assert(hot14133, 'mapa tem artigo da Lei 14.133 com incidência');
const art14133 = hot14133.split('|')[1];
assert(a.heatOf('14133', art14133) > 0);
assert.equal(a.heatOf('14133', art14133 + ' (cont.)'), a.heatOf('14133', art14133), 'o (cont.) herda a estrela do artigo');

// Nenhum casamento por substring: CPC e CPP não recebem o calor do CP.
const cpArticles = Object.keys(a.DATA.heat).filter(k => k.startsWith('CP|')).map(k => k.slice(3));
const cpcId = a.heatLawIdOfGroup({u: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm'});
for (const art of cpArticles) {
  const cpcHeat = Object.keys(a.DATA.heat).some(k => a.heatLawIdOfSig(k.split('|')[0]) === '13105' && k.split('|')[1] === art);
  if (!cpcHeat) assert.equal(a.heatOf(cpcId, art), 0, 'CPC art. ' + art + ' não herda o calor do CP');
}

// Cobertura real no acervo visível: todo dispositivo com chave no mapa ganha estrela.
let devices = 0, starred = 0, expected = 0;
// Conta esperada sem passar por heatOf: mapa normalizado direto de DATA.heat (valor > 0).
const hotBySig = new Set(Object.entries(a.DATA.heat).filter(([, v]) => +v > 0).map(([k]) => a.heatLawIdOfSig(k.split('|')[0]) + '|' + k.split('|')[1]));
const baseArt = n => String(n).replace(/\s*\(cont\.?\)\s*$/i, '').trim();
for (const [bid, groups] of Object.entries(a.LG)) {
  const file = path.join(__dirname, '..', 'leis', bid + '.json');
  if (!fs.existsSync(file)) continue;
  const byId = new Map(JSON.parse(fs.readFileSync(file, 'utf8')).g.map(g => [g.id, g]));
  for (const meta of groups.filter(g => !g.x)) {
    const g = byId.get(meta.id); if (!g) continue;
    const id = a.heatLawIdOfGroup(meta);
    for (const art of g.a) {
      devices++;
      if (id && hotBySig.has(id + '|' + baseArt(art.n))) expected++;
      if (a.heatOf(id, art.n) > 0) {
        starred++;
        assert(/class="star"/.test(a.artHtml(g.r, art, g.audit, g.u, id)), bid + '/' + meta.id + ' art. ' + art.n + ': a estrela aparece no leitor');
      }
    }
  }
}
assert.equal(starred, expected, 'toda chave do mapa presente no acervo vira estrela');
assert(starred > 300, 'as estrelas voltaram a aparecer: ' + starred + ' de ' + devices);
console.log('law-heat-stars: ok (' + starred + ' de ' + devices + ' dispositivos com estrela)');
