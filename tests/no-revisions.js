// Regra do usuário (16/09/2026): nenhuma revisão neste cronograma e nenhuma sistemática de flashcards.
// Releituras dependem do desempenho em questões e pertencem a outro projeto.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(!/data-tab="cards"/.test(html), 'a aba Cards não existe mais');
assert(!/Flashcards \(/.test(html), 'o botão de flashcards não existe mais');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, planningUnits, unitsOf, unitsOn, allBlocks, DATA, studyMinutesOn, migrateSingleGroup, unitDone, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const DAY = '2026-09-08';
const at = new Date(DAY + 'T12:00:00').getTime();

// 1. Nada de revisão nos dados nem nas atividades planejáveis.
{
  const a = loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]}).app;
  const revBlocks = a.allBlocks.filter(b => /^(Fecho\b|Correção comentada|Véspera: revisão)/i.test(b.t || '') || /\(revisão\)/i.test(b.t || ''));
  assert.equal(revBlocks.length, 0, 'blocos de revisão: ' + JSON.stringify(revBlocks.map(b => b.id)));
  let visibleRev = 0;
  for (const bid in a.DATA.leigroups) for (const g of a.DATA.leigroups[bid]) if (g.rev && !g.x) visibleRev++;
  assert.equal(visibleRev, 0, 'nenhum grupo de lei de revisão visível');
  const units = a.planningUnits(true);
  // "Revisão criminal" (CPP) e a aula "Revisão e extinção dos contratos" são conteúdo, não revisão:
  // só as chaves rv: e o rótulo "Revisão —" de grupo de lei contam como revisão.
  const revUnits = units.filter(u => u.key.startsWith('rv:') || /📜.*—\s*Revisão\s*—/i.test(String(u.title || '')));
  assert.equal(revUnits.length, 0, 'atividades de revisão no plano: ' + JSON.stringify(revUnits.slice(0, 5).map(u => u.key)));
  assert(!/function revPend|function cardsDue|function vCards|const SRS_STEPS|const REV_STEPS/.test(html), 'o gerador de revisões e os flashcards não existem mais no código');
  const day = a.unitsOn ? a.unitsOn(DAY) : [];
  assert(!day.some(u => u.key.startsWith('rv:')), 'nenhum card "Revisar (D+n)" aparece no dia');
  // as seis "revisões" que eram a única leitura do artigo continuam no plano como leitura simples
  const removed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'revisions-removed-2026-09-16.json'), 'utf8'));
  for (const c of removed.convertedGroups) {
    const b = a.allBlocks.find(x => x.id === c.block);
    assert(b, 'bloco da leitura convertida existe: ' + c.block);
    assert(a.unitsOf(b).some(u => u.key.endsWith(':' + c.id) || u.key === 'st:' + c.block), 'a leitura convertida aparece como atividade: ' + c.sub);
  }
  assert.equal(removed.summary.deletedBlocks, 84);
}

// 2. Bloco que ficou com um único grupo visível: o tique feito na chave do grupo migra para a chave do bloco,
//    com os minutos, e o dia não soma em dobro.
{
  const tmp = loadApp({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]}).app;
  const single = Object.keys(tmp.DATA.leigroups).map(bid => ({bid, gs: tmp.DATA.leigroups[bid].filter(g => !g.x)})).find(x => x.gs.length === 1 && tmp.allBlocks.some(b => b.id === x.bid));
  assert(single, 'existe bloco com um único grupo visível');
  const ts = at - 3600000;
  const seeds = {'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at]};
  seeds['lg2:' + single.bid + ':' + single.gs[0].id] = [1, ts];
  seeds['study:lg2:' + single.bid + ':' + single.gs[0].id] = [JSON.stringify({min: 33}), ts];
  const a = loadApp(seeds).app;
  assert.equal(JSON.stringify(a.S.kv['st:' + single.bid]), JSON.stringify(['done', ts]), 'o tique passa para a chave do bloco com o mesmo carimbo');
  assert.equal(a.S.kv['lg2:' + single.bid + ':' + single.gs[0].id][0], null, 'a chave do grupo vira lápide');
  assert.equal(a.studyMinutesOn(DAY), 33, 'os minutos do tique são contados uma vez só');
  const b = a.allBlocks.find(x => x.id === single.bid);
  assert(a.unitsOf(b).every(u => a.unitDone(u)), 'o bloco aparece concluído');
  const before = JSON.stringify(a.S.kv);
  a.migrateSingleGroup();
  assert.equal(JSON.stringify(a.S.kv), before, 'a migração é idempotente');
}
console.log('no-revisions: ok');
