const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class ElementStub {
  constructor() {
    this.style = { setProperty() {} };
    this.dataset = {};
    this.className = "";
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.scrollWidth = 0;
    this.scrollLeft = 0;
    this.clientWidth = 0;
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener() {}
  appendChild() {}
  insertAdjacentHTML() {}
  querySelector() { return new ElementStub(); }
  querySelectorAll() { return []; }
  setAttribute() {}
  focus() {}
  remove() {}
  click() {}
  scrollIntoView() {}
}

const storage = new Map();
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, new ElementStub());
  return elements.get(id);
};
const document = {
  body: new ElementStub(),
  visibilityState: "visible",
  getElementById: element,
  createElement: () => new ElementStub(),
  querySelector: () => new ElementStub(),
  querySelectorAll: () => [],
  addEventListener() {},
};
const localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
};

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert(match, "script principal não encontrado");
const expose = `
;globalThis.__appTest = {
  planRegen, applyRegen, undoRegen, infoPlanStats, pendentes, cargaPorTipo, unitsOn,
  capMin, minRestante, unitDone, unitsOf, leiEscopo, questionResult, setQuestionResult,
  performanceDetail, performanceMap, revStepsFor, tecHistory, tecGeneratedSet, tecNewSubjects,
  tecRecordGeneration, tecHistKey, G, S, INFOS, DATA, LG, TECMAP, allBlocks
};`;
const context = {
  console,
  document,
  localStorage,
  navigator: {},
  location: { protocol: "file:" },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
  setInterval: () => 1,
  clearInterval() {},
  setTimeout: () => 1,
  clearTimeout() {},
  fetch: async () => ({ ok: false, json: async () => ({}) }),
  confirm: () => false,
  prompt: () => null,
  alert() {},
  URL,
  Blob,
  Date,
  Math,
  JSON,
  Set,
  Map,
  Intl,
  encodeURIComponent,
};
context.window = context;
vm.runInNewContext(match[1] + expose, context, { filename: "index.html" });

const app = context.__appTest;
const infoMinutes = app.INFOS.reduce((sum, item) => sum + item.min, 0);
assert.equal(app.cargaPorTipo().info.tot, infoMinutes, "o painel deve contabilizar o acervo integral de informativos");
assert(!match[1].includes("itensI.slice(0,40)"), "a página da matéria não pode truncar informativos em 40");
assert(!match[1].includes("lista.slice(0,300).forEach"), "a página geral deve permitir carregar além de 300 itens");

const lawGroups = Object.values(app.LG).flat();
assert(lawGroups.length >= 200, "o teste deve cobrir o plano viável de lei seca");
assert(lawGroups.every(g => app.leiEscopo(g)), "todo bloco de lei deve ter escopo explícito");
assert(!lawGroups.some(g => /seleção/i.test(app.leiEscopo(g))), "nenhum bloco pode mandar ler uma seleção indefinida");
const primaryLawGroups = lawGroups.filter(g => !g.dir && !g.rev);
assert(Math.max(...primaryLawGroups.map(g => g.d || 0)) <= 30, "nenhum bloco obrigatório de lei deve ultrapassar a faixa de leitura adotada");
for (const block of app.allBlocks.filter(b => b.tipo === "LEI" && app.LG[b.id]?.length)) {
  const groups = app.LG[block.id];
  const units = app.unitsOf(block);
  assert.equal(units.length, groups.length, `${block.id}: cada recorte deve gerar uma atividade própria`);
  groups.forEach((group, index) => assert(units[index].title.includes(app.leiEscopo(group)), `${block.id}: o título deve mostrar ${app.leiEscopo(group)}`));
}
const cpcBlock = app.allBlocks.find(b => b.id === "2026-08-19-0");
const cpcUnits = app.unitsOf(cpcBlock);
assert(cpcUnits[0].title.includes("CPC · arts. 1–11"), "o cartão do CPC deve mostrar os artigos exatos no título");
assert(cpcUnits[0].chips.includes("lei completa") && cpcUnits[0].chips.includes("referência"), "links integrais não podem parecer o trecho específico");
const cfArt5 = lawGroups.filter(g => /^CF · art\. 5 \([1-4]\/4:/.test(g.sub || ""));
assert.equal(cfArt5.length, 4, "o art. 5º da CF deve continuar dividido em quatro blocos manejáveis no aplicativo");
const habeas = lawGroups.filter(g => g.sub === "CPP · arts. 647–650");
assert.equal(habeas.length, 1, "o trecho curto de habeas corpus deve permanecer em um só bloco");
const lug = lawGroups.find(g => g.id === "7198e2" || g.id === "fd1758");
assert(app.leiEscopo(lug).includes("arts. 1–2") && app.leiEscopo(lug).includes("75–78"), "a antiga seleção vaga da LUG deve indicar os artigos exatos");

const questionBlock = app.allBlocks.find(b => b.tipo === "QUEST");
assert(app.allBlocks.filter(b => b.tipo === "QUEST").every(b => !/registre o %/i.test(b.det)), "nenhum bloco deve pedir o antigo percentual manual");
app.setQuestionResult(questionBlock, "total", 20);
app.setQuestionResult(questionBlock, "hits", 14);
const result = app.questionResult(questionBlock);
assert.deepEqual([result.total, result.hits, result.errors, result.pct], [20, 14, 6, 70], "o resultado deve fechar resolvidas, acertos, erros e percentual");
const matterPerformance = app.performanceDetail(questionBlock.mat);
assert.deepEqual([matterPerformance.total, matterPerformance.hits, Math.round(matterPerformance.pct)], [20, 14, 70], "o desempenho da matéria deve ser ponderado pelo número de questões");
assert.deepEqual(Array.from(app.revStepsFor(questionBlock.mat)), [3, 7, 14, 30], "70% deve produzir uma revisão intermediária orientada pelo desempenho");
for (const prefix of ["qtot:", "qhit:", "qerr:", "pct:"]) delete app.S.kv[prefix + questionBlock.id];

let mapped;
for (const block of app.allBlocks) {
  const unit = app.unitsOf(block).find(u => app.TECMAP[u.key]?.length);
  if (unit) { mapped = { block, unit }; break; }
}
assert(mapped, "atividade mapeada para o TEC não encontrada");
app.S.kv[mapped.unit.key] = [mapped.unit.key.startsWith("st:") ? "done" : 1, Date.now()];
const firstFilters = app.tecNewSubjects(mapped.block.mat, "fgv");
assert(firstFilters.length, "uma atividade estudada deve liberar filtros do TEC");
const generatedAt = "2026-08-19T14:35:00.000Z";
app.tecRecordGeneration(mapped.block.mat, "fgv", [firstFilters[0]], generatedAt);
assert.equal(app.tecHistory(mapped.block.mat)[0].at, generatedAt, "a geração deve preservar data e hora");
assert(app.tecGeneratedSet(mapped.block.mat).has(firstFilters[0]), "o filtro gerado deve ficar registrado no caderno");
assert(!app.tecNewSubjects(mapped.block.mat, "fgv").includes(firstFilters[0]), "a geração seguinte não pode repetir filtro já registrado");
assert(!match[1].includes("navigator.clipboard"), "o gerador não deve depender de copiar e colar texto");
delete app.S.kv[mapped.unit.key];
delete app.S.kv[app.tecHistKey(mapped.block.mat)];

const first = app.planRegen();
assert.equal(first.moves.length + first.fila.length, first.total, "toda pendência deve receber data ou fila");
assert(first.total > app.INFOS.length, "o plano deve recolher também as demais atividades futuras");
assert(Object.values(first.load).every(minutes => minutes <= first.cap), "nenhum dia pode ultrapassar o teto");
const infoMoves = first.moves.filter(x => x.tipo === "info");
const infoQueue = first.fila.filter(x => x.tipo === "info");
assert.equal(infoMoves.length + infoQueue.length, app.INFOS.length, "todos os informativos devem participar do plano");
assert.equal(infoQueue.length, 0, "no perfil limpo atual, todos os informativos devem caber antes da prova");

const completedKey = first.moves.find(x => !x.key.startsWith("inf:"))?.key;
assert(completedKey, "atividade comum para testar preservação não encontrada");
app.S.kv[completedKey] = [1, Date.now()];
const withCompleted = app.planRegen();
assert(!withCompleted.moves.concat(withCompleted.fila).some(x => x.key === completedKey), "atividade concluída não pode ser replanejada");

app.applyRegen(withCompleted);
assert.equal(app.G(completedKey), 1, "aplicar o plano não pode apagar atividade concluída");
const plannedInfo = app.infoPlanStats();
assert.equal(plannedInfo.agendados, app.INFOS.length, "todos os informativos devem ganhar data após aplicar");
assert.equal(plannedInfo.semData, 0, "não pode restar informativo sem classificação");
const activeDays = app.DATA.days.map(x => x.d).filter(d => d >= "2026-08-19" && d < app.DATA.prova);
for (const day of activeDays) {
  const minutes = app.unitsOn(day).filter(u => !app.unitDone(u)).reduce((sum, u) => sum + app.minRestante(u), 0);
  assert(minutes <= first.cap, `${day} ultrapassou o teto após aplicar: ${minutes}min`);
}
app.undoRegen();
assert.equal(app.G(completedKey), 1, "desfazer o plano não pode apagar atividade concluída");
const restoredInfo = app.infoPlanStats();
assert.equal(restoredInfo.semData, app.INFOS.length, "desfazer deve restaurar o estado anterior");

console.log(JSON.stringify({
  pending: first.total,
  scheduled: first.moves.length,
  queue: first.fila.length,
  informativosScheduled: infoMoves.length,
  maxDailyMinutes: Math.max(...Object.values(first.load)),
  undoRestored: restoredInfo.semData,
  lawGroups: lawGroups.length,
  maxRequiredLawDevices: Math.max(...primaryLawGroups.map(g => g.d || 0)),
  constitutionArticle5Blocks: cfArt5.length,
  performanceSample: `${result.hits}/${result.total}`,
  incrementalTecHistory: true,
}, null, 2));
