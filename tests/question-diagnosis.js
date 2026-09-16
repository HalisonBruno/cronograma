// Itens 4 e 8 (16/09/2026): métricas de acerto vêm dos registros do card "Questões do dia" (qd:), não das
// chaves mortas pct:/err:; o registro aceita um assunto opcional do caderno TEC e o Progresso mostra um
// diagnóstico por assunto que é só leitura (crítico < 50%, fraco 50–75%, forte > 75%, a partir de 10 questões).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, tecStudied, tecPick, tecTopicsOf, diagnosticoAssuntos, DIAG_MIN_Q, qdCard, qRegistros, TECMAP, allBlocks, unitsOf, SET, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const DAY = '2026-09-08';
const at = new Date(DAY + 'T12:00:00').getTime();
const base = () => ({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]});

// Uma atividade estudada com assuntos TEC mapeados.
const probe = loadApp(base()).app;
const unit = probe.allBlocks.flatMap(b => probe.unitsOf(b)).find(u => (probe.TECMAP[u.key] || []).length >= 1);
assert(unit, 'atividade com assunto TEC');
const mat = unit.b.mat, [topic] = probe.TECMAP[unit.key];

// 1. Assunto testado e acerto vêm dos registros qd: com assunto; chaves antigas pct:/err: não influem mais.
{
  const seeds = base();
  seeds[unit.key] = [unit.key.startsWith('st:') ? 'done' : 1, at];
  seeds['qd:' + DAY + ':1'] = [JSON.stringify({mat, banca: 'FGV', n: 20, ac: 8, assunto: topic}), at];
  seeds['err:bloco-antigo'] = ['assunto que não existe mais', at];
  const a = loadApp(seeds).app;
  const st = a.tecStudied(mat)[topic];
  assert(st && st.tested, 'o assunto registrado conta como testado');
  assert.equal(st.qn, 20); assert.equal(st.qac, 8);
  assert.deepEqual(Array.from(a.tecPick(mat, 'pior')), [topic], '40% de acerto entra entre os piores; chave err: é ignorada');
  const ordered = a.tecPick(mat, 'fgv');
  assert(ordered.includes(topic));
}

// 2. Lista de assuntos para o registro: estudados primeiro, depois os demais da matéria.
{
  const seeds = base();
  seeds[unit.key] = [unit.key.startsWith('st:') ? 'done' : 1, at];
  const a = loadApp(seeds).app;
  const tp = a.tecTopicsOf(mat);
  assert(tp.studied.includes(topic), 'o assunto da atividade estudada aparece em "estudados"');
  assert(!tp.others.includes(topic), 'sem repetir em "demais"');
  assert(tp.studied.length + tp.others.length >= tp.studied.length);
  const html = a.qdCard(DAY).innerHTML;
  assert(/id="qdass"/.test(html), 'o card "Questões do dia" tem o campo de assunto opcional');
}

// 3. Diagnóstico por assunto: faixas, mínimo de questões, ordem e registros sem assunto.
{
  const seeds = base();
  const reg = (i, o) => { seeds['qd:' + DAY + ':' + i] = [JSON.stringify(Object.assign({mat: 'Penal', banca: 'FGV'}, o)), at + i]; };
  reg(1, {n: 12, ac: 5, assunto: 'A'});    // 42% crítico
  reg(2, {n: 20, ac: 13, assunto: 'B'});   // 65% fraco
  reg(3, {n: 6, ac: 5, assunto: 'C'});     // soma com o próximo
  reg(4, {n: 4, ac: 3, assunto: 'C'});     // C: 10 questões, 80% forte
  reg(5, {n: 4, ac: 1, assunto: 'D'});     // poucas questões
  reg(6, {n: 7, ac: 7});                   // sem assunto
  const a = loadApp(seeds).app;
  assert.equal(a.DIAG_MIN_Q, 10);
  const {rows, semAssunto} = a.diagnosticoAssuntos();
  assert.equal(semAssunto, 7);
  assert.deepEqual(Array.from(rows, r => r.assunto + ':' + r.faixa + ':' + r.n + ':' + r.pct), ['A:critico:12:42', 'B:fraco:20:65', 'C:forte:10:80', 'D:poucas:4:25']);
  // Acerto por matéria ponderado pelo número de questões (Onde estou): (5+13+5+3+1+7)/(12+20+6+4+4+7)
  const regs = a.qRegistros().filter(r => r.mat === 'Penal');
  const nq = regs.reduce((s, r) => s + r.n, 0), avg = Math.round(regs.reduce((s, r) => s + r.pct * r.n, 0) / nq);
  assert.equal(nq, 53);
  assert(Math.abs(avg - Math.round(100 * 34 / 53)) <= 1, 'média ponderada: ' + avg);
}
// 4. O código não lê mais as chaves mortas.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(!/G\("pct:"\+b\.id\)|G\("err:"|startsWith\("err:"\)/.test(html), 'nenhuma leitura de pct:/err: por bloco');
assert(!/o tópico volta no Ciclo 2/.test(html), 'a nota que remetia a revisão no antigo Ciclo 2 saiu');
console.log('question-diagnosis: ok');
