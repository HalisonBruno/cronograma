// Item 6 (16/09/2026): informativos não têm nota de incidência; recebem cor própria (roxo) fora da escala
// vermelho → azul, em vez de aparecerem com a cor da menor prioridade, e o ponto explica o motivo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, prioCorDe, prioDot, prioColor, prioAbs, INFO_COR, INFOS, DATA, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const at = new Date('2026-09-08T12:00:00').getTime();
const a = loadApp({'profile:120-weekdays:v1': [1, at]}).app;

const info = 'inf:' + a.INFOS[0].id;
assert.equal(a.prioCorDe(info), 'var(--juris)', 'informativo usa a cor própria');
assert.notEqual(a.prioCorDe(info), a.prioColor(0), 'e não a cor da menor prioridade');
assert.match(a.prioDot(info), /reserva obrigatória do plano/, 'o ponto explica que informativo é reserva obrigatória');
const weighted = Object.keys(a.DATA.peso).find(k => !k.startsWith('inf:'));
assert.equal(a.prioCorDe(weighted), a.prioColor(a.prioAbs(weighted)), 'as demais atividades seguem a escala de incidência');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(/roxo = informativos/.test(html), 'a legenda da aba Matérias explica o roxo');
console.log('info-color: ok');
