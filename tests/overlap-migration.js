// Recortes sobrepostos ocultados em 22/09/2026 (scripts/law-overlaps-2026-09-22.json, DATA.lgmig "d:<oculto>"): o tique
// de quem já leu o grupo oculto vai, com o carimbo original, para os grupos visíveis que ele contém por inteiro (no
// mesmo bloco ou em outro) e nunca para um grupo com dispositivo não lido. Os minutos continuam no dia em que a leitura
// aconteceu, contados uma vez; o histórico de um grupo já estudado ou desmarcado depois não é reescrito.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, studyMinutesOn, estimateStudyMinutes, migrateV4, unitDone, planningUnits, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const PRIO_V = +(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/"versao":([0-9]+)/) || [0, 1])[1];
const DAY = '2026-09-08', YESTERDAY = '2026-09-07';
const at = new Date(DAY + 'T12:00:00').getTime(), ts = at - 3600000, early = new Date(YESTERDAY + 'T10:00:00').getTime();
const L = (bid, gid) => 'lg2:' + bid + ':' + gid;
const ADM = '2026-08-28-0', TRAB = '2026-09-04-0', CONST = '2026-09-28-0', PC = '2026-10-07-0~2';
const load = extra => loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at], 'profile:prio-bancas:v1': [PRIO_V, at], ...extra}).app;
const study = (a, k) => a.S.kv['study:' + k] && a.S.kv['study:' + k][0] ? JSON.parse(a.S.kv['study:' + k][0]).min : null;
const done = (a, k) => { const u = a.planningUnits(true).find(x => x.key === k); assert(u, 'atividade visível: ' + k); return a.unitDone(u); };
// (arrays do contexto vm do app: copiados para comparar por conteúdo)
const ids = (bid, n) => Array.from(a0.DATA.lgmig[bid]['d:' + n], t => t.includes(':') ? 'lg2:' + t : L(bid, t));
const a0 = load({});
const [P1, P2, P3] = ids(ADM, '24d17a');                 // caput–XV, XVI–XXII, XXIII–XXIX
const [T1, T2] = ids(TRAB, '919931');                    // CF art. 7 caput–XVII, XVIII–XXIV
const T3 = L(TRAB, 'b61e3d');                            // XXV–parágrafo único
assert.deepEqual([P1, P2], [L(ADM, '323683'), L(ADM, 'd75476')]);
assert.deepEqual(ids(CONST, '2a34bf'), [T1], 'caput–XVII lido em Constitucional vale só para caput–XVII');
assert.deepEqual(ids(CONST, 'a8537d'), [T2, T3], 'XVIII–p.u. lido em Constitucional vale para XVIII–XXIV e XXV–p.u.');
assert(!a0.DATA.lgmig[TRAB]['g:919931'] && !a0.DATA.lgmig[TRAB]['g:b61e3d'], 'um recorte do art. 7 não tica mais o outro');

// 1. Tique no recorte antigo (caput–XXIX): as três partes, com o carimbo e os minutos gravados repartidos.
{
  const a = load({[L(ADM, '24d17a')]: [1, ts], ['study:' + L(ADM, '24d17a')]: [JSON.stringify({min: 90}), ts]});
  for (const k of [P1, P2, P3]) { assert.equal(JSON.stringify(a.S.kv[k]), JSON.stringify([1, ts]), k); assert(done(a, k), k + ' concluída'); }
  assert.equal(study(a, P1) + study(a, P2) + study(a, P3), 90, 'minutos repartidos, não duplicados');
  assert.equal(a.S.kv[L(ADM, '24d17a')][0], null, 'a chave oculta vira lápide');
  assert.equal(a.studyMinutesOn(DAY), 90, 'o dia soma a leitura uma vez');
  const before = JSON.stringify(a.S.kv); a.migrateV4();
  assert.equal(JSON.stringify(a.S.kv), before, 'idempotente');
}
// 2. Grupo já estudado mantém o próprio histórico (carimbo e minutos do dia em que foi lido).
{
  const a = load({[P1]: [1, early], ['study:' + P1]: [JSON.stringify({min: 40}), early],
    [L(ADM, '24d17a')]: [1, ts], ['study:' + L(ADM, '24d17a')]: [JSON.stringify({min: 90}), ts],
    [P3]: [null, at - 60000]});   // XXIII–XXIX desmarcado depois da leitura antiga: continua desmarcado
  assert.equal(JSON.stringify(a.S.kv[P1]), JSON.stringify([1, early]));
  assert.equal(study(a, P1), 40);
  assert.equal(JSON.stringify(a.S.kv[P2]), JSON.stringify([1, ts]));
  assert.equal(a.S.kv[P3][0], null, 'o desmarcar posterior vence');
  assert.equal(a.studyMinutesOn(YESTERDAY), 40, 'o dia anterior não perde minutos');
  assert.equal(a.studyMinutesOn(DAY), 90, 'a leitura de hoje fica toda em XVI–XXII');
}
// 3. Todos os destinos já estudados: nada muda, e a leitura repetida continua contada no dia dela.
{
  const a = load({[P1]: [1, early], [P2]: [1, early], [P3]: [1, early], [L(ADM, '24d17a')]: [1, ts], ['study:' + L(ADM, '24d17a')]: [JSON.stringify({min: 90}), ts]});
  assert.equal(JSON.stringify(a.S.kv[L(ADM, '24d17a')]), JSON.stringify([1, ts]));
  assert.equal(a.studyMinutesOn(DAY), 90);
}
// 4. CF art. 7 em Const. Trabalho (caput–XXIV, sem minutos gravados): as duas partes, com a estimativa do grupo; XXV–p.u. não.
{
  const a = load({[L(TRAB, '919931')]: [1, ts]});
  const est = a0.estimateStudyMinutes(L(TRAB, '919931'));
  assert(done(a, T1) && done(a, T2) && !done(a, T3), 'caput–XXIV não conclui XXV–p.u.');
  assert.equal(study(a, T1) + study(a, T2), est);
  assert.equal(a.studyMinutesOn(DAY), est);
}
// 5. Entre blocos: o que foi lido em Constitucional leva só os recortes que contém por inteiro.
{
  const a = load({[L(CONST, '2a34bf')]: [1, ts]});
  assert(done(a, T1) && !done(a, T2) && !done(a, T3), 'caput–XVII não conclui XVIII–XXIV');
  const b = load({[L(CONST, 'a8537d')]: ['done', ts], ['study:' + L(CONST, 'a8537d')]: [JSON.stringify({min: 61}), ts]});
  assert(!done(b, T1) && done(b, T2) && done(b, T3));
  assert.equal(b.S.kv[T3][0], 'done', 'o valor do tique é preservado');
  assert.equal(study(b, T2) + study(b, T3), 61);
  assert.equal(b.studyMinutesOn(DAY), 61);
  const c = load({[L(CONST, '2a34bf')]: [1, early], [L(CONST, 'a8537d')]: [1, ts]});
  assert(done(c, T1) && done(c, T2) && done(c, T3), 'o art. 7 lido inteiro em Constitucional conclui o de Const. Trabalho');
  assert.equal(c.S.kv[T1][1], early);
}
// 6. Ticar XXV–p.u. não marca nenhuma parte de caput–XXIV (antes g:b61e3d copiava o tique para 919931).
{
  const a = load({[T3]: [1, ts]});
  for (const k of [T1, T2, L(TRAB, '919931')]) assert(!a.S.kv[k] || a.S.kv[k][0] == null, k + ' continua pendente');
  a.migrateV4();
  assert(!a.S.kv[T1] && !a.S.kv[T2]);
}
// 7. CDC: arts. 81–82 e 103 lidos em Proc. Civil concluem arts. 81–82; o 103 é lido com o 104 em Civil (não é crédito).
{
  const [N] = ids(PC, 'a49af4');
  const a = load({[L(PC, 'a49af4')]: [1, ts]});
  assert(done(a, N));
  assert(!done(a, L('2026-09-29-0~2', '28bfae')), 'arts. 103–104 continuam pendentes: o 104 não foi lido');
}
// 8. Encadeamento com o mapeamento antigo (g:f9757d -> 24d17a, 8810fa): chega às partes visíveis numa passada só.
{
  const a = load({[L(ADM, 'f9757d')]: [1, ts]});
  for (const k of [P1, P2, P3, L(ADM, '8810fa')]) assert(done(a, k), k);
  assert.equal(a.S.kv[L(ADM, '24d17a')][0], null);
  const before = JSON.stringify(a.S.kv); a.migrateV4();
  assert.equal(JSON.stringify(a.S.kv), before, 'idempotente');
}
console.log('overlap-migration: ok');
