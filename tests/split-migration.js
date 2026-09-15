// Grupos de lei divididos em 15/09/2026 (scripts/law-splits-2026-09-15.json): um tique feito no grupo
// antigo passa para as partes novas com o mesmo carimbo, os minutos registrados são repartidos entre
// elas e a chave antiga vira lápide, para o dia não somar em dobro (revisão de 15/09).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, studyMinutesOn, estimateStudyMinutes, migrateV4, unitDone, planningUnits, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const DAY = '2026-09-08';
const at = new Date(DAY + 'T12:00:00').getTime();
const splits = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'law-splits-2026-09-15.json'), 'utf8')).mapping;
const [oldKey, newKeys] = Object.entries(splits).find(([k]) => k.startsWith('lg2:'));
const ts = at - 3600000;   // ticado uma hora antes do "agora" do teste, no mesmo dia

const seeds = {'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]};
seeds[oldKey] = [1, ts];
seeds['study:' + oldKey] = [JSON.stringify({min: 126}), ts];
const t = loadApp(seeds);
const a = t.app;

for (const k of newKeys) {
  assert.equal(JSON.stringify(a.S.kv[k]), JSON.stringify([1, ts]), 'a parte nova herda o tique e o carimbo do grupo antigo: ' + k);
  const rec = a.S.kv['study:' + k];
  assert(rec && rec[0] && rec[1] === ts, 'a parte nova recebe registro de minutos com o carimbo do tique: ' + k);
}
const minutes = newKeys.map(k => JSON.parse(a.S.kv['study:' + k][0]).min);
assert.equal(minutes.reduce((s, m) => s + m, 0), 126, 'os minutos registrados são repartidos, não duplicados: ' + JSON.stringify(minutes));
assert.equal(a.S.kv[oldKey][0], null, 'a chave antiga vira lápide');
assert.equal(a.S.kv['study:' + oldKey][0], null, 'o registro de minutos antigo vira lápide');
assert(a.S.kv[oldKey][1] > ts, 'a lápide vence o valor antigo na sincronização');
assert.equal(a.studyMinutesOn(DAY), 126, 'o dia soma os minutos uma vez só');

const units = a.planningUnits(true).filter(u => newKeys.includes(u.key));
assert.equal(units.length, newKeys.length, 'as partes novas existem como atividades');
assert(units.every(u => a.unitDone(u)), 'as partes novas aparecem concluídas');

const before = JSON.stringify(a.S.kv);
a.migrateV4();
assert.equal(JSON.stringify(a.S.kv), before, 'a migração é idempotente');

// Sem registro de minutos no grupo antigo, cada parte fica com a própria estimativa.
const seeds2 = {'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]};
seeds2[oldKey] = [1, ts];
const b = loadApp(seeds2).app;
const est = newKeys.map(k => JSON.parse(b.S.kv['study:' + k][0]).min);
assert.equal(JSON.stringify(est), JSON.stringify(newKeys.map(k => b.estimateStudyMinutes(k))), 'sem minutos gravados vale a estimativa de cada parte');
assert.equal(b.studyMinutesOn(DAY), est.reduce((s, m) => s + m, 0));
console.log('split-migration: ok (' + oldKey + ' -> ' + newKeys.length + ' partes, ' + minutes.join('+') + ' min)');
