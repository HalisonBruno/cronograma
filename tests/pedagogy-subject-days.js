// Pedagogia de 22/09/2026 (pedido do usuário: nada de uma matéria inteira na frente das outras, nem várias matérias
// no mesmo dia). Roda o replanejador real sobre o acervo real e confere as garantias do desenho.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, planRegen, applyRegen, undoRegen, planningUnits, unitsOn, unitDone, pedSubject, pedQueues, pedTables, pedServed, ensurePrioOrder, ensurePlanMarco, minRestante, coreStudyMinutesOn, planMarco, buildPlanMarco, PLAN_MARCO_KEY, isStudyDay, DATA, G, SET, S, unitCard,')
  .replace('return { app: context.app, nodes, storage, document };', 'return { app: context.app, nodes, storage, document, setClock: value => { clock = value; } };');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const DAY = '2026-09-22', noon = d => new Date(d + 'T12:00:00').getTime();
const fresh = () => { const t = loadApp({'profile:120-weekdays:v1': [1, noon(DAY)], 'profile:90-weekdays:v1': [1, noon(DAY)], 'cfg:cap': [120, noon(DAY)], 'profile:prio-bancas:v1': [8, noon(DAY)]}); t.setClock(noon(DAY)); return t; };
const t = fresh(), a = t.app;
const units = new Map(a.planningUnits(true).map(u => [u.key, u]));
const subj = m => a.pedSubject(units.get(m.key));
const plan = a.planRegen();
const byDay = new Map();
plan.moves.forEach(m => { if (!byDay.has(m.to)) byDay.set(m.to, []); byDay.get(m.to).push(m); });
const days = plan.days.filter(d => byDay.has(d));
const daySubj = d => [...new Set(byDay.get(d).map(subj))];

// 1. Um dia, uma matéria (informativos inclusive; Complementares é uma categoria só).
for (const d of days) assert.equal(daySubj(d).length, 1, d + ': um dia tem uma matéria só: ' + daySubj(d).join(' + '));
assert(days.every((d, i) => d === plan.days[i]), 'dias seguidos a partir de amanhã, sem buracos');

// 2. A mesma matéria não se repete em dias úteis seguidos (há trabalho de sobra em outras matérias).
for (let i = 1; i < days.length; i++) assert.notEqual(daySubj(days[i])[0], daySubj(days[i - 1])[0], days[i] + ': matéria repetida em dias seguidos');

// 3. Nenhuma matéria na frente das outras: as oito grandes nos 12 primeiros dias, todas as 11 nos 45 primeiros, e as
//    grandes com dias na proporção do edital até a prova.
// a matéria preservada hoje (22/09) conta como estudada e volta só na vez dela
const todaySubj = new Set(plan.preservedToday.map(m => m.subj));
assert(todaySubj.size <= 1, 'hoje preservado tem uma matéria');
const first = n => new Set([...todaySubj, ...days.slice(0, n).map(d => daySubj(d)[0])]);
assert(!todaySubj.has(daySubj(days[0])[0]), 'amanhã não repete a matéria de hoje');
for (const m of ['Penal', 'Proc. Civil', 'Civil', 'Administrativo', 'Constitucional', 'Direitos Humanos', 'Empresarial', 'Humanística']) assert(first(12).has(m), m + ' aparece nos 12 primeiros dias úteis');
for (const m of Object.keys(a.DATA.prio.q)) assert(first(45).has(m), m + ' aparece nos 45 primeiros dias úteis (Trabalho, peso 1,9, entra por volta do 41º)');
const count = {}; days.forEach(d => { const k = daySubj(d)[0]; count[k] = (count[k] || 0) + 1; });
assert(count.Penal <= count.Administrativo * 1.6 && count['Direitos Humanos'] >= 6, 'Penal não domina: ' + JSON.stringify(count));

// 4. Dentro da matéria, faixa de incidência nunca volta atrás; na mesma faixa, capítulos na ordem do livro.
const content = [...units.values()].filter(u => !a.unitDone(u) && u.b.tipo !== 'INFO' && u.b.tipo !== 'SIM' && !u.b.opt && !u.catalogOnly && u.b.mat !== 'Véspera' && u.b.mat !== 'Simulado');
const {pass} = a.pedQueues(content);
// Cada visita da matéria abre com o assunto de maior incidência ainda pendente. Item de faixa menor só entra
// depois, na sobra do dia que ficaria ociosa (o de faixa maior não coube nela), sem atrasar nenhum outro.
const bySubj = {};
for (const m of plan.moves) if (pass.has(m.key)) (bySubj[subj(m)] = bySubj[subj(m)] || []).push(m);
for (const [k, ms] of Object.entries(bySubj)) {
  ms.forEach((m, i) => {
    if (i > 0 && ms[i - 1].to === m.to) return;
    const minRest = Math.min(...ms.slice(i).map(x => pass.get(x.key)));
    assert.equal(pass.get(m.key), minRest, m.to + ' ' + k + ': a visita abre com a faixa ' + minRest + ', não com ' + pass.get(m.key));
  });
}
const books = {};
for (const m of plan.moves) { const x = m.key.match(/^eb:(.+):(\d+)$/); if (!x) continue; const g = x[1] + '|' + pass.get(m.key); (books[g] = books[g] || []).push(+x[2]); }
for (const [g, caps] of Object.entries(books)) assert.deepEqual(caps, caps.slice().sort((p, q) => p - q), g + ': capítulos na ordem do livro');
// capítulo de base entra antes do primeiro capítulo principal do livro (Penal Parte Geral: 1 e 2 antes do 5)
const when = k => (plan.moves.find(m => m.key === k) || {}).to;
assert(when('eb:penal-geral:1') && when('eb:penal-geral:1') <= when('eb:penal-geral:5'), 'Parte Geral começa pela base');
// grupo de lei só pega carona no grupo de maior nota do bloco se estiver a até 2 pontos dele (regra fixa)
const notaPass = n => n >= 9 ? 0 : n >= 7 ? 1 : n >= 5 ? 2 : 3;
for (const [key, p] of pass) { const n = a.DATA.inc[key], u = units.get(key); if (n == null || !u || u.b.tipo !== 'LEI') continue;
  const bid = key.match(/^(?:lg2|st):([^:]+)/)[1], top = a.pedTables().top.get(bid);
  if (top != null && n < top - 2) assert.equal(p, notaPass(n), key + ': nota ' + n + ' não pega carona no bloco de nota ' + top); }

// bloco de lei com um só grupo visível (unidade st:) herda a nota do grupo: CF arts. 61-62, nota 10, na faixa 0
assert.equal(pass.get('st:2026-09-07-0~2'), 0, 'st: de um grupo só usa a nota do grupo');

// 5. Informativos: só no dia da própria matéria (item 1) e do semestre mais recente ao mais antigo.
const infoArq = {};
for (const m of plan.moves) if (m.tipo === 'INFO') { const k = subj(m), arq = units.get(m.key).info.arq; if (infoArq[k]) assert(arq <= infoArq[k], m.key + ': informativo mais antigo antes de um mais recente'); infoArq[k] = arq; }
assert(plan.moves.some(m => m.tipo === 'INFO' && /^2026/.test(units.get(m.key).info.arq)), 'os de 2026 entram primeiro');

// 6. Itens com âncora: Ponte AGU no dia da matéria do título; correção de simulado acompanha o simulado; véspera
//    no último dia útil antes da prova, sozinha.
// (Ponte AGU não tem nota de incidência: entra no fim da fila da matéria, fora do horizonte até a prova.)
const ponte = [...units.values()].filter(u => u.b.mat === 'Ponte AGU').map(u => a.pedSubject(u)).sort();
assert.deepEqual(ponte, ['Administrativo', 'Civil', 'Const. Tributário'], 'Ponte AGU vai para a matéria do título');
assert(plan.fila.filter(m => units.get(m.key).b.mat === 'Ponte AGU').every(m => /vez da matéria/.test(m.reason)));
assert(plan.library.some(m => /Correção do simulado/.test(m.reason)));
const eve = plan.moves.find(m => units.get(m.key).b.mat === 'Véspera');
assert(eve && eve.to === '2027-04-16' && byDay.get(eve.to).length === 1, 'véspera sozinha em 16/04/2027');

// 6b. Julgado de nota alta não vai ao acervo por causa de um informativo que ficou sem data; aula longa que é
//     alternativa de um capítulo vai ao acervo, não à fila.
for (const m of plan.library.filter(x => /Julgado incluído/.test(x.reason))) {
  const pid = m.key.replace(/^jur:/, '');
  assert(plan.moves.some(x => x.tipo === 'INFO' && (units.get(x.key).info.pids || []).includes(pid)), m.key + ': só é coberto quando o informativo dele tem data');
}
assert(plan.library.some(m => m.key === 'au:Direito empresarial:13'), 'aula de 229 min coberta pelo capítulo vai ao acervo');
assert(!plan.fila.some(m => m.key === 'au:Direito empresarial:13'));

// 7. O rodízio continua depois de replanejar: estudado o dia de amanhã, o replanejamento seguinte não repete a
//    matéria e não volta a começar por ela.
{
  const t2 = fresh(), b = t2.app;
  let p = b.planRegen(); b.applyRegen(p);
  const seq = [];
  for (let i = 0; i < 6; i++) {
    const d = p.days[0], us = b.unitsOn(d).filter(u => !b.unitDone(u));
    seq.push(b.pedSubject(us.find(u => u.b.tipo !== 'INFO') || us[0]));
    t2.setClock(noon(d));
    us.forEach(u => b.SET(u.key, u.key.startsWith('st:') ? 'done' : 1, {minutes: 1}));
    p = b.planRegen(); b.applyRegen(p);
    const next = b.unitsOn(p.days[0]).filter(u => !b.unitDone(u));
    assert.notEqual(b.pedSubject(next[0]), seq[seq.length - 1], 'replanejar não repete a matéria de hoje amanhã');
  }
  assert(new Set(seq).size >= 5, 'seis replanejamentos diários passam por várias matérias: ' + seq.join(', '));
  assert(seq.filter(x => x === 'Penal').length <= 2, 'replanejar todo dia não volta sempre a Penal: ' + seq.join(', '));
  // Replanejando todo dia por 45 dias úteis, nenhuma matéria é esquecida (o rodízio guarda a dívida de cada uma).
  for (let i = 6; i < 45; i++) {
    const d = p.days[0], us = b.unitsOn(d).filter(u => !b.unitDone(u));
    seq.push(b.pedSubject(us.find(u => u.b.tipo !== 'INFO') || us[0]));
    t2.setClock(noon(d));
    us.forEach(u => b.SET(u.key, u.key.startsWith('st:') ? 'done' : 1, {minutes: 1}));
    p = b.planRegen(); b.applyRegen(p);
  }
  const c = {}; seq.forEach(x => c[x] = (c[x] || 0) + 1);
  for (const m of Object.keys(b.DATA.prio.q)) assert(c[m] > 0, m + ' aparece em 45 dias de replanejamento diário: ' + JSON.stringify(c));
  assert(c['Direitos Humanos'] >= 3 && c.Humanística >= 2 && c.Penal <= 9, 'proporção do edital: ' + JSON.stringify(c));
}

// 7b. Estudo adiantado hoje: replanejar incluindo hoje não põe uma segunda matéria no dia já começado.
{
  const t4 = fresh(), e = t4.app;
  let p = e.planRegen(); e.applyRegen(p);
  const tomorrow = e.unitsOn(p.days[0]).filter(u => !e.unitDone(u) && u.b.tipo !== 'INFO').slice(0, 2);
  tomorrow.forEach(u => e.SET(u.key, u.key.startsWith('st:') ? 'done' : 1, {minutes: e.minRestante(u)}));
  assert(e.coreStudyMinutesOn(DAY) > 0);
  const q = e.planRegen({includeToday: true});
  const hoje = [...q.moves.filter(m => m.to === DAY).map(m => m.subj), ...tomorrow.map(u => e.pedSubject(u))];
  assert.equal(new Set(hoje).size, 1, 'hoje continua com a matéria estudada: ' + hoje.join(', '));
}

// 7c. Rodízio pelo carimbo da própria marcação: fechar hoje um bloco lido semanas antes não conta o bloco inteiro
//     como estudo de hoje. E concluir um capítulo não traz de volta a aula equivalente (a previsão não piora).
{
  const t5 = fresh(), f = t5.app;
  f.S.kv['plan:rodizio:v1'] = [DAY, noon(DAY)];
  const block = [...new Set(f.planningUnits(false).filter(u => u.b.tipo === 'LEI' && u.b.mat === 'Civil' && u.key.startsWith('lg2:')).map(u => u.b.id))]
    .map(id => f.planningUnits(false).filter(u => u.b.id === id)).find(g => g.length >= 3);
  block.slice(0, -1).forEach(u => { f.S.kv[u.key] = [1, noon('2026-09-10')]; });
  f.SET(block[block.length - 1].key, 1, {minutes: 1}); f.syncEquiv();
  const {served, doneToday} = f.pedServed(f.planningUnits(false), DAY, []);
  assert.equal(served.get('Civil'), block[block.length - 1].min, 'só o grupo lido hoje conta no rodízio');
  assert.equal(doneToday.length, 1);
  const g = fresh(), h = g.app, before = h.planRegen();
  const aulas = before.library.filter(m => /^au:Direito Penal Geral:[1-6]$/.test(m.key)).map(m => m.key);
  h.SET('eb:penal-geral:5', 1, {minutes: 22});
  const after = h.planRegen();
  assert(aulas.length >= 6, 'aulas 1-6 eram alternativa do capítulo 5');
  for (const k of aulas) assert(!after.moves.some(m => m.key === k) && !after.fila.some(m => m.key === k), k + ': ler o capítulo não traz a aula de volta como pendência');
}

// 8. Marco do saldo: refeito uma única vez, quando a pedagogia nova é aplicada (ensurePrioOrder); só criar o que
//    falta não o refaz; o desfazer devolve plano e marco antigos e nada o refaz de novo.
{
  const t3 = fresh(), c = t3.app;
  const old = JSON.stringify({v: 1, on: '2026-09-16', cap: 120, days: ['2026-09-16'], u: {}});
  c.S.kv[c.PLAN_MARCO_KEY] = [old, noon(DAY)];
  c.ensurePlanMarco();
  assert.equal(c.G(c.PLAN_MARCO_KEY), old, 'abrir o Progresso não refaz o marco');
  c.S.kv['profile:prio-bancas:v1'] = [7, noon(DAY)];
  c.ensurePrioOrder();
  const marco = c.planMarco();
  assert(marco.on === DAY && marco.pv === c.DATA.prio.versao && c.G('plan:rodizio:v1') === DAY, 'pedagogia nova aplicada: marco refeito e rodízio ancorado hoje');
  c.undoRegen();
  assert.equal(c.G(c.PLAN_MARCO_KEY), old, 'desfazer devolve o marco anterior');
  c.ensurePlanMarco(); c.ensurePrioOrder();
  assert.equal(c.G(c.PLAN_MARCO_KEY), old, 'e nada o refaz depois do desfazer');
}
console.log('pedagogy-subject-days: ok (' + days.length + ' dias, ' + JSON.stringify(count) + ')');
