// Toda atividade planejável recebe data: até o teto (120 min) entra em qualquer dia com espaço; entre o
// teto e a margem pedagógica (135 min) ocupa um dia inteiro sozinha (roomFor). Simulados são sessões
// especiais (biblioteca) e a única aula acima da margem tem alternativa em capítulos (biblioteca).
// Sem isso o item fica na fila para sempre e a previsão de conclusão perde a data (regressão de 15/09/2026).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, planningUnits, minRestante, capMin, queueFits, forecastSoftQueue, renderHeaderForecast, planRegen, ritmoLei, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const DAY = '2026-09-08';
const at = new Date(DAY + 'T12:00:00').getTime();
const allowed = new Set(['au:Direito empresarial:13']);   // aula de 229 min coberta por capítulos equivalentes (biblioteca)

function overCap(a, limit) {
  return a.planningUnits(true)
    .map(u => ({key: u.key, min: Math.ceil(+a.minRestante(u) || 0), tipo: u.b.tipo, catalog: !!u.catalogOnly}))
    .filter(x => x.tipo !== 'SIM' && !x.catalog && x.min > limit && !allowed.has(x.key));
}

const t = loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]});
const a = t.app;
const cap = a.capMin();
assert.equal(cap, 120);
assert(a.planningUnits(true).length > 3000, 'o acervo inteiro entra na verificação');
// No ritmo declarado (3 min por dispositivo) nenhuma lei seca passa do teto; capítulos podem usar a margem.
const bad = overCap(a, cap).filter(x => x.tipo !== 'EBOOK' || x.min > cap + 15);
// arrays vêm do contexto vm do app: comparar por conteúdo, não por protótipo
assert.equal(bad.length, 0, 'atividades acima do teto diário: ' + JSON.stringify(bad));

// No ritmo mais lento que o app aprende (4,5 min por dispositivo) todo grupo ainda cabe na margem.
const slow = loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at], 'spd:lei': [4.5, at]}).app;
assert.equal(slow.ritmoLei(), 4.5);
const badSlow = overCap(slow, cap + 15);
assert.equal(badSlow.length, 0, 'atividades acima da margem no ritmo lento: ' + JSON.stringify(badSlow));
// Um ritmo já sincronizado acima do teto (gravado antes do limite) é lido com o teto.
const stored = loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at], 'spd:lei': [6, at]}).app;
assert.equal(stored.ritmoLei(), 4.5, 'o teto vale também para o valor já gravado');
assert.equal(overCap(stored, cap + 15).length, 0);

// A fila "macia" só contém o que ainda cabe em algum dia; o resto é "sem encaixe" e não
// arrasta o horizonte da previsão.
assert.equal(a.queueFits({min: 120, tipo: 'LEI'}, cap), true);
assert.equal(a.queueFits({min: 135, tipo: 'LEI'}, cap), true);
assert.equal(a.queueFits({min: 136, tipo: 'LEI'}, cap), false);
assert.equal(a.queueFits({min: 136, tipo: 'EBOOK'}, cap), false);
assert.equal(JSON.stringify(a.forecastSoftQueue({cap, fila: [{min: 140, tipo: 'LEI'}, {min: 90, tipo: 'LEI'}, {min: 130, tipo: 'EBOOK'}]}).map(m => m.min)), '[90,130]');

// Um bloco longo (121–135 min) ocupa um dia inteiro em vez de ficar na fila.
{
  const s = loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]});
  const b = s.app;
  b.allBlocks.splice(0); b.INFOS.splice(0); b.DATA.juris.splice(0); b.DATA.ebooks.splice(0); b.DATA.cursos.splice(0);
  Object.keys(b.EBK).forEach(k => delete b.EBK[k]); b.DATA.infgem = {}; b.S.kv = {};
  b.S.kv['ext:longo'] = [JSON.stringify({id: 'longo', t: 'Grupo longo', min: 126, tipo: 'REV', mat: 'Teste', day: '', nuc: true}), at];
  b.S.kv['ext:curto'] = [JSON.stringify({id: 'curto', t: 'Grupo curto', min: 60, tipo: 'REV', mat: 'Teste', day: '', nuc: true}), at];
  const plan = b.planRegen({includeToday: true, end: '2026-09-11', skipSync: true, skipState: true});
  const longo = plan.moves.find(m => m.key === 'xdone:longo');
  assert(longo, 'o bloco de 126 min recebe data: ' + JSON.stringify(plan.fila));
  assert.match(longo.finishReason, /dia inteiro/);
  assert(!plan.moves.some(m => m.to === longo.to && m.key !== longo.key), 'nenhum outro bloco entra no dia do bloco longo');
  assert.equal(plan.fila.length, 0);
}

// O cabeçalho mantém a data viva quando há bloco sem encaixe: data do que cabe + rótulo "parcial".
const partial = {all: {end: '2027-12-10', complete: false, tasks: 2000, unresolved: 1}, core: {end: '2027-07-05', complete: true, tasks: 1500, unresolved: 0}};
a.renderHeaderForecast(partial);
assert.equal(t.nodes.get('stEnd').textContent, '10/12/2027');
assert.equal(t.nodes.get('stEndLabel').textContent, 'conclusão do acervo · parcial');
assert.match(t.nodes.get('stEnd').title, /1 bloco\(s\) ainda precisam de encaixe/);
a.renderHeaderForecast({all: {end: '', complete: false, tasks: 0, unresolved: 3, blocks: 3}, core: partial.core});
assert.equal(t.nodes.get('stEnd').textContent, 'Concluído', 'tudo o que cabe foi feito: concluído, com rótulo parcial');
assert.equal(t.nodes.get('stEndLabel').textContent, 'conclusão do acervo · parcial');
a.renderHeaderForecast({all: {end: '2027-12-10', complete: true, tasks: 2000, unresolved: 0}, core: partial.core});
assert.equal(t.nodes.get('stEndLabel').textContent, 'conclusão do acervo');
console.log('unit-cap: ok (' + a.planningUnits(true).length + ' atividades)');
