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

// Nenhum casamento por substring: CPC e CPP não recebem o calor do CP.
const cpArticles = Object.keys(a.DATA.heat).filter(k => k.startsWith('CP|')).map(k => k.slice(3));
const cpcId = a.heatLawIdOfGroup({u: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm'});
for (const art of cpArticles) {
  const cpcHeat = Object.keys(a.DATA.heat).some(k => a.heatLawIdOfSig(k.split('|')[0]) === '13105' && k.split('|')[1] === art);
  if (!cpcHeat) assert.equal(a.heatOf(cpcId, art), 0, 'CPC art. ' + art + ' não herda o calor do CP');
}

// Cobertura real no acervo visível: todo dispositivo com chave no mapa ganha estrela.
let devices = 0, starred = 0, expected = 0;
const idsBySig = new Set(Object.keys(a.DATA.heat).map(k => a.heatLawIdOfSig(k.split('|')[0]) + '|' + k.split('|')[1]));
for (const [bid, groups] of Object.entries(a.LG)) {
  const file = path.join(__dirname, '..', 'leis', bid + '.json');
  if (!fs.existsSync(file)) continue;
  const byId = new Map(JSON.parse(fs.readFileSync(file, 'utf8')).g.map(g => [g.id, g]));
  for (const meta of groups.filter(g => !g.x)) {
    const g = byId.get(meta.id); if (!g) continue;
    const id = a.heatLawIdOfGroup(meta);
    for (const art of g.a) {
      devices++;
      if (id && idsBySig.has(id + '|' + art.n) && (a.DATA.heat && a.heatOf(id, art.n) > 0)) expected++;
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
