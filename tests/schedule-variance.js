// Ritmo frente ao cronograma original (16/09/2026): o marco fotografa as datas do plano em vigor; o saldo
// diz quantos dias úteis do marco o que foi concluído cobre, contra os dias úteis já passados.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, planRegen, applyRegen, ensurePlanMarco, buildPlanMarco, planMarco, scheduleVariance, planVarianceEl, PLAN_MARCO_KEY, planningUnits, unitDate, unitDone, SET, G, unitCard,')
  .replace('return { app: context.app, nodes, storage, document };', 'return { app: context.app, nodes, storage, document, setClock: value => { clock = value; } };');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const DAY = '2026-09-08';
const noon = d => new Date(d + 'T12:00:00').getTime();
const t = loadApp({'profile:120-weekdays:v1': [1, noon(DAY)], 'profile:90-weekdays:v1': [1, noon(DAY)], 'cfg:cap': [120, noon(DAY)]});
const a = t.app;

a.applyRegen(a.planRegen({includeToday: true}));
assert.equal(a.planMarco(), null, 'sem marco antes da primeira abertura');
a.ensurePlanMarco();
const marco = a.planMarco();
assert(marco && marco.on === DAY && marco.days[0] === DAY, 'o marco fotografa o plano a partir de hoje');
assert(Object.keys(marco.u).length > 1000, 'o marco guarda as atividades datadas');
const sizeKB = a.G(a.PLAN_MARCO_KEY).length / 1024;
assert(sizeKB < 200, 'o marco é compacto para sincronizar: ' + Math.round(sizeKB) + ' KB');
const raw = a.G(a.PLAN_MARCO_KEY);
a.ensurePlanMarco();
assert.equal(a.G(a.PLAN_MARCO_KEY), raw, 'o marco não é refeito sozinho');

const unitsOfDay = i => a.planningUnits(false).filter(u => marco.u[u.key] && marco.u[u.key][0] === i);
const finish = i => unitsOfDay(i).forEach(u => a.SET(u.key, u.key.startsWith('st:') ? 'done' : 1));

let v = a.scheduleVariance();
assert.equal(v.diff, 0, 'nada feito no primeiro dia: em dia');
finish(0);
v = a.scheduleVariance();
assert.equal(v.covered, 1); assert.equal(v.diff, 0, 'o dia de hoje feito: em dia');
finish(1); finish(2);
v = a.scheduleVariance();
assert.equal(v.covered, 3); assert.equal(v.diff, 2, 'dois dias do marco além de hoje: 2 dias úteis adiantado');

// Passam quatro dias úteis sem estudar: o saldo vira atraso.
t.setClock(noon(marco.days[5]));
v = a.scheduleVariance();
assert.equal(v.before, 5); assert.equal(v.diff, -2, 'feito até o 3º dia, já no 6º: 2 dias úteis atrasado');

// Replanejar não mexe no marco nem no saldo.
a.applyRegen(a.planRegen({}));
assert.equal(a.G(a.PLAN_MARCO_KEY), raw, 'replanejar não altera o marco');
assert.equal(a.scheduleVariance().diff, -2);

// Conclusões fora da ordem também contam, pelo tempo: fazer o 7º e o 8º dias cobre o 4º.
finish(6); finish(7);
v = a.scheduleVariance();
assert(v.covered >= 4, 'minutos concluídos fora da ordem avançam o saldo: ' + v.covered);

// A seção do Progresso mostra o saldo.
const el = a.planVarianceEl();
assert.match(el.innerHTML, /Ritmo frente ao cronograma de 08\/09\/2026/);
assert.match(el.innerHTML, /(dias úteis|dia útil) (adiantado|atrasado)|em dia/);

// Redefinir o marco recomeça a contagem no dia de hoje.
a.SET(a.PLAN_MARCO_KEY, JSON.stringify(a.buildPlanMarco()));
v = a.scheduleVariance();
assert.equal(v.on, marco.days[5]); assert.equal(v.diff, 0, 'novo marco: em dia');
console.log('schedule-variance: ok (' + Object.keys(marco.u).length + ' atividades no marco, ' + Math.round(sizeKB) + ' KB)');
