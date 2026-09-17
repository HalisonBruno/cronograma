// Penal Parte Geral (17/09/2026): as 33 aulas ligadas aos capítulos onde o e-book desenvolve o tema, conferido no
// texto do PDF (sumário e páginas). Corrigidos: omissivos (cap. 6), conflito aparente (cap. 5), erro na execução
// (cap. 7), extinção da punibilidade e prescrição (cap. 8, não Ação Penal), medidas de segurança (cap. 11).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, altCapsHtml, altAulasHtml, unitsOf, allBlocks, EBK, DATA, G, SET, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const at = new Date('2026-09-08T12:00:00').getTime();
const a = loadApp({'profile:120-weekdays:v1': [1, at]}).app;

const CURSO = 'Direito Penal Geral';
const ESPERADO = {1: [5], 2: [5], 3: [5], 4: [5], 5: [5], 6: [5], 7: [7], 8: [7], 9: [6], 10: [7], 11: [9], 12: [9],
  13: [8], 14: [8], 15: [8], 16: [8], 17: [8], 18: [8], 19: [8], 20: [11, 12], 21: [12], 22: [12], 23: [13], 24: [5],
  25: [7], 26: [14], 27: [8, 14], 28: [8], 29: [8], 30: [11], 31: [15], 32: [10], 33: [10]};
const eq = a.DATA.equiv.filter(e => e.aula.startsWith(CURSO + ':'));
assert(eq.every(e => e.eb === 'penal-geral' && e.grau === 'parcial'), 'curso de Penal Geral liga só ao e-book da Parte Geral, grau parcial');
const got = {};
eq.forEach(e => { const n = +e.aula.split(':').pop(); (got[n] = got[n] || []).push(e.cap); });
for (const n in got) got[n].sort((x, y) => x - y);
assert.equal(JSON.stringify(got), JSON.stringify(ESPERADO), 'mapeamento aula → capítulo conferido no e-book');
const cursos = a.DATA.cursos.find(c => c.curso === CURSO);
assert.equal(cursos.aulas.length, 33);
for (const cap of [1, 3, 4, 16]) assert(!eq.some(e => e.cap === cap), 'cap. ' + cap + ' não tem aula no curso');

// O aluno vê a correspondência nos dois sentidos.
assert.match(a.altCapsHtml(CURSO + ':24'), /Parte Geral · Cap\. 5 \(43-54\)/);
assert.match(a.altCapsHtml(CURSO + ':28'), /Parte Geral · Cap\. 8 \(84-105\)/);
assert.doesNotMatch(a.altCapsHtml(CURSO + ':28'), /Cap\. 15/);
assert.match(a.altAulasHtml('penal-geral', 8), /10 aulas equivalentes/, 'cap. 8: excludentes, culpabilidade, extinção e prescrição');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(html.slice(html.indexOf('function vAulas('), html.indexOf('function vJuris(')), /altCapsHtml\(c\.curso\+":"\+a\.n\)/, 'a aba Aulas mostra os capítulos equivalentes');

// Assistir as aulas de prescrição não marca o capítulo de Ação Penal.
a.SET('au:' + CURSO + ':28', 1); a.SET('au:' + CURSO + ':29', 1); a.syncEquiv();
assert.equal(a.G('eb:penal-geral:15'), null, 'prescrição não é o capítulo de Ação Penal');
a.SET('au:' + CURSO + ':31', 1); a.syncEquiv();
assert.equal(a.G('eb:penal-geral:15'), 'auto', 'a aula de Ação Penal cobre o capítulo');

// Selo "fora do plano" só em capítulo sem bloco de leitura; capítulo 2 (Princípios) entrou no plano.
const blocks = a.allBlocks;
for (const k in a.EBK) for (const c of a.EBK[k].caps) {
  const temBloco = blocks.some(b => b.tipo === 'EBOOK' && ((b.eb === k && b.pg && b.pg[0] <= c.pf && b.pg[1] >= c.pi) || ((b.eb2 || b.eb) === k && b.pg2 && b.pg2[0] <= c.pf && b.pg2[1] >= c.pi)));
  if (temBloco) assert(!c.out, k + ':' + c.n + ' tem bloco e não pode aparecer como fora do plano');
}
const b2 = blocks.find(b => b.id === '2026-09-17-e0');
assert(b2 && b2.eb === 'penal-geral' && b2.pg[0] === 25 && b2.pg[1] === 34 && b2.min === 20, 'bloco do cap. 2');
assert.equal(JSON.stringify(a.unitsOf(b2).map(u => u.key)), JSON.stringify(['eb:penal-geral:2']));
// A pedido (17/09/2026), toda a Parte Geral entra no plano, e também Constitucional cap. 17 e Tributário caps. 11 e 17
// (nota 8). Páginas conferidas no sumário dos PDFs.
const incluidos = {'2026-09-17-e1': ['penal-geral', 14, 24], '2026-09-17-e2': ['penal-geral', 35, 39], '2026-09-17-e3': ['penal-geral', 40, 42],
  '2026-09-17-e4': ['penal-geral', 180, 187], '2026-09-17-e5': ['constitucional', 404, 422], '2026-09-17-e6': ['tributario', 201, 229], '2026-09-17-e7': ['tributario', 290, 299]};
for (const [id, [eb, pi, pf]] of Object.entries(incluidos)) {
  const b = blocks.find(x => x.id === id);
  assert(b && b.eb === eb && b.pg[0] === pi && b.pg[1] === pf && b.min === (pf - pi + 1) * 2, id + ': bloco de leitura');
  const cap = a.EBK[eb].caps.find(c => c.pi === pi && c.pf === pf);
  assert(cap && !cap.out, id + ': capítulo inteiro, sem selo "fora do plano"');
  assert.equal(JSON.stringify(a.unitsOf(b).map(u => u.key)), JSON.stringify(['eb:' + eb + ':' + cap.n]));
}
assert.equal(a.EBK['penal-geral'].caps.filter(c => c.out).length, 0, 'Parte Geral inteira no plano');
for (const [eb, n] of [['constitucional', 17], ['tributario', 11], ['tributario', 17]]) assert(!a.EBK[eb].caps.find(c => c.n === n).out);
assert(a.DATA.prio.versao >= 7, 'blocos novos reaplicam o plano');

// Textos de sugestão de vídeo coerentes com a correspondência.
const acao = blocks.find(b => b.id === '2026-09-03-2');
assert.equal(JSON.stringify(acao.alt), JSON.stringify([{c: CURSO, n: 31}]));
assert.doesNotMatch(acao.det, /prescri/i);
assert.doesNotMatch(blocks.find(b => b.id === '2026-08-27-2').det, /Cap\.14|24-26/);
assert(a.DATA.prio.versao >= 6, 'bloco novo reaplica o plano');
console.log('penal-geral-equiv: ok (' + eq.length + ' ligações, 33 aulas)');
