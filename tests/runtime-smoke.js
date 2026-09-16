// Teste de fumaça do app inteiro num contexto vm, contra a API atual (reescrito em 16/09/2026: a versão
// anterior exercitava funções de uma arquitetura abandonada, como revisão por desempenho e grupos de
// até 15 dispositivos, e quebrava com ReferenceError). Cobre: lei seca com texto local e sem sobreposição,
// replanejador (tudo recebe data, fila ou biblioteca; teto respeitado; concluído não volta), aplicar e
// desfazer preservando conclusões, e caderno TEC a partir do que foi estudado.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const harness = fs.readFileSync(path.join(__dirname, "study-minutes.js"), "utf8")
  .split("async function main()")[0]
  .replace("updateStats, unitCard,", "updateStats, planRegen, applyRegen, undoRegen, unitsOn, capMin, minRestante, unitDone, unitsOf, planningUnits, unitDate, tecPick, TECMAP, LG, INFOS, DATA, allBlocks, G, S, SET, unitCard,");
const {loadApp} = new Function("require", "__dirname", harness + "\nreturn {loadApp};")(require, __dirname);
const DAY = "2026-09-08";
const at = new Date(DAY + "T12:00:00").getTime();
const app = loadApp({"profile:120-weekdays:v1": [1, at], "profile:90-weekdays:v1": [1, at], "cfg:cap": [120, at]}).app;

// 1. Lei seca: todo grupo visível tem texto local; nenhum texto se repete entre grupos visíveis da mesma matéria.
const visibleGroups = Object.entries(app.LG).flatMap(([bid, gs]) => gs.filter(g => !g.x).map(g => ({bid, g})));
assert(visibleGroups.length > 400, "a fumaça cobre os grupos de lei visíveis: " + visibleGroups.length);
// Blocos cujos grupos estão todos ocultos (consultas excedentes antigas) não geram tarefa fantasma.
assert(app.allBlocks.filter(b => b.tipo === "LEI" && !(app.LG[b.id] || []).some(g => !g.x)).every(b => app.unitsOf(b).length === 0), "bloco de lei sem grupo visível não gera atividade");
const seenText = new Map();
for (const block of app.allBlocks.filter(b => b.tipo === "LEI")) {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "leis", block.id + ".json"), "utf8"));
  const byId = new Map(source.g.map(g => [g.id, g]));
  for (const meta of app.LG[block.id].filter(g => !g.x)) {
    const group = byId.get(meta.id);
    assert(group, block.id + "/" + meta.id + ": o leitor encontra o texto do grupo");
    assert(group.a.length && group.a.every(a => String(a.t || "").trim()), block.id + "/" + meta.id + ": todo dispositivo tem texto local");
    for (const article of group.a) {
      const digest = crypto.createHash("sha1").update(String(article.t).replace(/\s+/g, " ").trim()).digest("hex");
      const key = block.mat + "|" + meta.u + "|" + article.n + "|" + digest;
      assert(!seenText.has(key), block.id + "/" + meta.id + ": sobreposição com " + seenText.get(key));
      seenText.set(key, block.id + "/" + meta.id);
    }
  }
  const units = app.unitsOf(block);
  assert.equal(units.length, app.LG[block.id].filter(g => !g.x).length, block.id + ": cada grupo visível vira uma atividade");
}
assert.equal(visibleGroups.filter(({g}) => /^CF · art\. 5 \([1-4]\/4:/.test(g.sub || "")).length, 4, "o art. 5º da CF segue em quatro partes");
const tst = visibleGroups.find(({g}) => /Súmulas TST 331 e 425/.test(g.sub || ""));
const tstText = tst && JSON.parse(fs.readFileSync(path.join(__dirname, "..", "leis", tst.bid + ".json"), "utf8")).g.find(g => g.id === tst.g.id);
assert(tstText && ["331", "425"].every(n => tstText.a.some(a => a.n === n)), "as súmulas 331 e 425 do TST seguem num bloco, com texto local");

// 2. Replanejador.
const cap = app.capMin();
const first = app.planRegen({includeToday: true});
const pending = app.planningUnits(false).filter(u => !app.unitDone(u)).length;
const placed = new Set(first.moves.concat(first.fila, first.library).map(m => m.key));
assert(first.moves.length > 1000, "o plano distribui as atividades: " + first.moves.length);
assert(placed.size >= pending - first.preservedToday.length, "toda pendência recebe data, fila ou biblioteca");
const extDays = new Set(first.extensions.map(x => x.day));
for (const [day, load] of Object.entries(first.load)) assert(load <= cap + (extDays.has(day) ? 15 : 0), day + " passou do teto: " + load);
const infoPlaced = first.moves.concat(first.fila, first.library).filter(m => m.key.startsWith("inf:")).length;
assert.equal(infoPlaced, first.info.total, "todos os informativos participam do plano");

const completedKey = first.moves.find(m => !m.key.startsWith("inf:") && !m.key.startsWith("st:")).key;
app.SET(completedKey, 1);
const withCompleted = app.planRegen({});
assert(!withCompleted.moves.concat(withCompleted.fila).some(m => m.key === completedKey), "atividade concluída não volta ao plano");
app.applyRegen(withCompleted);
assert.equal(app.G(completedKey), 1, "aplicar o plano preserva a conclusão");
const futureDay = withCompleted.days.find(d => d > DAY);
const futureLoad = app.unitsOn(futureDay).filter(u => !app.unitDone(u)).reduce((n, u) => n + app.minRestante(u), 0);
assert(futureLoad <= cap + 15, futureDay + " depois de aplicar: " + futureLoad + " min");
app.undoRegen();
assert.equal(app.G(completedKey), 1, "desfazer o plano preserva a conclusão");

// 3. Caderno TEC: estudar uma atividade mapeada libera assuntos para filtro.
const mapped = app.allBlocks.flatMap(b => app.unitsOf(b)).find(u => (app.TECMAP[u.key] || []).length && !app.unitDone(u));
assert(mapped, "atividade mapeada para o TEC");
app.SET(mapped.key, mapped.key.startsWith("st:") ? "done" : 1);
const topics = app.tecPick(mapped.b.mat, "fgv");
assert(app.TECMAP[mapped.key].every(t => topics.includes(t)), "os assuntos da atividade estudada entram na lista do TEC");

console.log(JSON.stringify({lawGroups: visibleGroups.length, scheduled: first.moves.length, queue: first.fila.length, library: first.library.length, informativos: infoPlaced, maxDailyMinutes: Math.max(...Object.values(first.load)), tecTopics: topics.length}, null, 2));
