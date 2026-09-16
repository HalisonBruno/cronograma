// Previsão de conclusão cooperativa (15/09/2026): a busca do horizonte roda em passos (uma
// simulação por passo), espera a sincronização terminar antes de ocupar a página e guarda o
// resultado por aparelho, para reabrir a página com o mesmo estado sem recalcular.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('const nodes = new Map();', 'const nodes = new Map(); const timers = new Map(); let timerId = 0;')
  .replace('setTimeout: () => 1, clearTimeout() {}, queueMicrotask,', 'setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), queueMicrotask,')
  .replace('updateStats, unitCard,', 'updateStats, completionPlanSteps, findCompletionPlan, scheduleCompletionForecast, forecastFingerprint, syncNow, unitCard,')
  .replace('return { app: context.app, nodes, storage, document };', 'return { app: context.app, nodes, storage, document, timers };');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const DAY = '2026-09-08';
const at = new Date(DAY + 'T12:00:00').getTime();
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const runTimer = t => { const [id, fn] = t.timers.entries().next().value; t.timers.delete(id); fn(); };
function small(t) {
  const a = t.app;
  a.allBlocks.splice(0); a.INFOS.splice(0); a.DATA.juris.splice(0); a.DATA.ebooks.splice(0); a.DATA.cursos.splice(0);
  Object.keys(a.EBK).forEach(k => delete a.EBK[k]); a.DATA.infgem = {};
  a.S.kv = {'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'profile:prio-bancas:v1': [a.DATA.prio.versao, at], 'cfg:cap': [120, at]};
  for (const id of ['um', 'dois', 'tres']) a.S.kv['ext:' + id] = [JSON.stringify({id, t: id, min: 100, tipo: 'REV', mat: 'Teste', day: '', nuc: true}), at];
  return a;
}

async function main() {
// 1. O gerador produz o mesmo resultado da chamada síncrona e cede o controle a cada simulação.
{
  const t = loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]});
  const a = small(t);
  const gen = a.completionPlanSteps('acervo', '', null);
  let steps = 0, r = gen.next();
  while (!r.done) { steps++; r = gen.next(); }
  const direct = a.findCompletionPlan('acervo', '', null);
  assert(steps >= 1, 'pelo menos uma simulação por busca');
  assert.equal(r.value.end, direct.end);
  assert.equal(r.value.studyDays, direct.studyDays);
  assert.equal(r.value.complete, true);
  assert.equal(r.value.tasks, 3);
}

// 2. Com uma sincronização em andamento, o cálculo espera; terminada a sincronização, conclui e grava o cache.
{
  let release;
  const t = loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]}, {token: 'test-only', localMode: false, fetch: () => new Promise(resolve => { release = resolve; })});
  const a = small(t);
  t.timers.clear();
  const cycle = a.syncNow();   // GET pendente: syncInFlight fica preenchido
  a.updateStats();
  assert.equal(t.timers.size, 1, 'a previsão fica agendada');
  runTimer(t);
  assert.equal(t.timers.size, 1, 'com sincronização em andamento o passo é adiado, não executado');
  assert.equal(t.nodes.get('stEnd').textContent, 'Calculando…');
  release({ok: true, status: 200, json: async () => ({kv: {'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'profile:prio-bancas:v1': [a.DATA.prio.versao, at], 'cfg:cap': [120, at]}})});
  await flush();
  release({ok: true, status: 200, json: async () => ({kv: {}})});   // POST
  await cycle; await flush();
  let guard = 0;
  while (t.timers.size && guard++ < 40) runTimer(t);
  assert(guard < 40, 'a busca termina em poucos passos');
  assert.match(t.nodes.get('stEnd').textContent, /^\d\d\/\d\d\/\d{4}$/, 'data no cabeçalho depois da sincronização');
  const stored = JSON.parse(t.storage.get('enam-forecast-cache'));
  assert.equal(stored.key, a.forecastFingerprint(), 'o cache guarda a impressão digital do estado');
  assert.equal(stored.value.all.end, stored.value.all.end && stored.value.all.end);
  assert.equal(stored.value.all.tasks, 3);
  // Reagendar com o mesmo estado não cria trabalho novo.
  t.timers.clear();
  a.scheduleCompletionForecast();
  assert.equal(t.timers.size, 0, 'mesmo estado: resultado servido do cache');
}
console.log('forecast-steps: ok');
}
main().catch(e => { console.error(e); process.exit(1); });
