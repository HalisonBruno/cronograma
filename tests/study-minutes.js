const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the real page code and its checkbox handlers with a fixed local day.
const DAY = "2026-09-08";
let clock = new Date(`${DAY}T12:00:00`).getTime();
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
class Element {
  constructor() {
    this.style = { setProperty() {} };
    this.dataset = {};
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.options = [];
    this.children = [];
    this.listeners = new Map();
    this.selectors = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.scrollWidth = this.scrollLeft = this.clientWidth = 0;
  }
  addEventListener(name, fn) {
    const handlers = this.listeners.get(name) || [];
    handlers.push(fn);
    this.listeners.set(name, handlers);
  }
  dispatch(name) {
    for (const fn of this.listeners.get(name) || []) fn({ target: this, preventDefault() {} });
  }
  appendChild(child) { this.children.push(child); return child; }
  insertAdjacentHTML() {}
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element());
    return this.selectors.get(selector);
  }
  querySelectorAll() { return []; }
  setAttribute() {}
  focus() {}
  remove() {}
  click() { this.dispatch("click"); }
  scrollIntoView() {}
}

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(source, "script principal não encontrado");
function loadApp(initial = {}) {
  const nodes = new Map();
  const storage = new Map([["enam-cron-v2", JSON.stringify({ kv: initial })]]);
  const document = {
    body: new Element(), documentElement: new Element(), visibilityState: "visible",
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, new Element());
      return nodes.get(id);
    },
    createElement: () => new Element(), querySelector: () => new Element(),
    querySelectorAll: () => [], addEventListener() {},
  };
  const context = {
    console, document,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    navigator: {}, location: { protocol: "file:" },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, setInterval: () => 1, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {}, queueMicrotask,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    confirm: () => false, prompt: () => null, alert() {}, scrollTo() {}, scrollY: 0,
    URL, Blob, Date: TestDate, Math, JSON, Set, Map, Intl, Promise, encodeURIComponent,
  };
  context.window = context;
  vm.runInNewContext(source + `
    ;globalThis.app = {
      studyMinutesOn, SET, G, S, unitsOf, allBlocks, INFOS, DATA, LG, EBK,
      updateStats, unitCard, pitem, syncEquiv, render, abrirFoco,
      setFocusDate: d => { curDate = d; }
    };`, context, { filename: "index.html" });
  return { app: context.app, nodes, storage, document };
}

async function main() {
  const { app, nodes, storage } = loadApp();
  const header = () => Number(nodes.get("stHoje").textContent);
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  const reset = async () => {
    app.S.kv = {};
    clock = new Date(`${DAY}T12:00:00`).getTime();
    app.updateStats();
    await flush();
  };
  const allUnits = () => app.allBlocks.flatMap(b => app.unitsOf(b));
  const pick = prefix => allUnits().find(u => u.key.startsWith(prefix));
  const law = pick("lg2:");
  const ebook = pick("eb:");
  const lecture = pick("au:");
  const juris = pick("jur:");
  const atom = app.allBlocks.find(b => b.tipo === "REV" && !b.opt);
  assert(law && ebook && lecture && juris && atom, "amostras reais de cada material são necessárias");
  let cases = 0;

  for (const [label, key, expected, value] of [
    ["lei seca", law.key, law.min, 1],
    ["capítulo", ebook.key, ebook.min, 1],
    ["vídeo a 1,5x", lecture.key, lecture.min, 1],
    ["jurisprudência", juris.key, 10, 1],
    ["informativo", `inf:${app.INFOS[0].id}`, app.INFOS[0].min, 1],
    ["revisão espaçada", `rv:${law.key}:3`, 10, 1],
    ["bloco simples", `st:${atom.id}`, atom.min, "done"],
  ]) {
    await reset();
    app.SET(key, value);
    await flush();
    assert.equal(app.studyMinutesOn(DAY), expected, `${label}: conclusão soma o tempo`);
    assert.equal(header(), expected, `${label}: cabeçalho atualiza sem trocar de tela`);
    app.SET(key, null);
    await flush();
    assert.equal(app.studyMinutesOn(DAY), 0, `${label}: desmarcar retira o tempo`);
    assert.equal(header(), 0, `${label}: cabeçalho também desfaz o tempo`);
    cases++;
  }

  await reset();
  app.SET("ext:test-extra", JSON.stringify({ mat: "Civil", tipo: "REV", min: 17, t: "Extra" }));
  app.SET("xdone:test-extra", 1);
  await flush();
  assert.equal(header(), 17, "material extra não agendado soma sua duração");
  cases++;

  await reset();
  const plannedKeys = new Set(allUnits().map(u => u.key));
  const unplanned = Object.values(app.EBK).flatMap(b => b.caps.map(c => ({ b, c })))
    .find(({ b, c }) => !plannedKeys.has(`eb:${b.k}:${c.n}`));
  assert(unplanned, "há capítulos fora do cronograma para testar");
  app.SET(`eb:${unplanned.b.k}:${unplanned.c.n}`, 1);
  assert.equal(app.studyMinutesOn(DAY), (unplanned.c.pf - unplanned.c.pi + 1) * 2,
    "capítulo fora do plano usa a extensão real e o ritmo de leitura");
  cases++;

  await reset();
  app.SET(`mvu:${law.key}`, "2027-03-01");
  app.SET(law.key, 1);
  assert.equal(app.studyMinutesOn(DAY), law.min, "atividade futura estudada hoje conta hoje");
  assert.equal(app.studyMinutesOn("2027-03-01"), 0, "data do cronograma não vira data de estudo");
  cases++;

  await reset();
  app.S.kv[law.key] = [1, new Date("2026-09-07T23:59:59").getTime()];
  assert.equal(app.studyMinutesOn(DAY), 0, "conclusão de ontem não entra hoje");
  assert.equal(app.studyMinutesOn("2026-09-07"), law.min, "histórico preserva data real");
  app.S.kv[law.key] = [1, new Date("2026-09-09T00:00:00").getTime()];
  assert.equal(app.studyMinutesOn(DAY), 0, "carimbo futuro não entra hoje");
  cases++;

  await reset();
  for (const value of ["auto", "grupo", "done-auto"]) {
    app.S.kv[law.key] = [value, clock];
    app.S.kv[`st:${law.b.id}`] = ["done-auto", clock];
    assert.equal(app.studyMinutesOn(DAY), 0, `${value}: equivalência não inventa tempo estudado`);
  }
  const siblings = app.unitsOf(law.b).filter(u => u.key.startsWith("lg2:"));
  assert(siblings.length > 1, "bloco de lei com várias atividades para simular conclusão final");
  app.S.kv = {};
  siblings.forEach(u => { app.S.kv[u.key] = [1, new Date("2026-09-07T12:00:00").getTime()]; });
  app.SET(siblings.at(-1).key, 1);
  app.syncEquiv();
  assert.equal(app.G(`st:${law.b.id}`), "done-auto", "último filho conclui o bloco-pai");
  assert.equal(app.studyMinutesOn(DAY), siblings.at(-1).min,
    "último filho não relança hoje o tempo de todos os estudos anteriores");
  cases++;

  await reset();
  const counts = new Map();
  allUnits().filter(u => u.key.startsWith("jur:")).forEach(u => counts.set(u.key, (counts.get(u.key) || 0) + 1));
  const sharedJuris = [...counts].find(([, n]) => n > 1)?.[0];
  assert(sharedJuris, "há jurisprudência repetida em matérias distintas para testar");
  app.SET(sharedJuris, 1);
  assert.equal(app.studyMinutesOn(DAY), 10, "mesmo julgado em várias matérias conta uma vez");
  cases++;

  await reset();
  const linkedInfo = app.INFOS.find(o => o.pids?.length);
  assert(linkedInfo, "informativo com equivalência de jurisprudência");
  app.SET(`inf:${linkedInfo.id}`, 1);
  app.syncEquiv();
  assert.equal(app.G(`jur:${linkedInfo.pids[0]}`), "auto", "informativo propaga conclusão para jurisprudência");
  assert.equal(app.studyMinutesOn(DAY), linkedInfo.min, "informativo e seus equivalentes não somam tempo duplicado");
  cases++;

  await reset();
  const equivalent = (app.DATA.equiv || []).find(e => e.grau === "total"
    && plannedKeys.has(`au:${e.aula}`) && plannedKeys.has(`eb:${e.eb}:${e.cap}`));
  assert(equivalent, "equivalência aula/capítulo presente no plano");
  const aulaKey = `au:${equivalent.aula}`;
  const capKey = `eb:${equivalent.eb}:${equivalent.cap}`;
  const expectedLecture = allUnits().find(u => u.key === aulaKey).min;
  app.updateStats();
  const progressBefore = Number(nodes.get("stDone").textContent.split("/")[0]);
  app.SET(aulaKey, 1);
  app.syncEquiv();
  app.updateStats();
  const progressAfter = Number(nodes.get("stDone").textContent.split("/")[0]);
  assert.equal(app.G(capKey), "auto", "aula conclui o capítulo equivalente");
  assert(progressAfter >= progressBefore + 2, "atividade original e equivalente contam no progresso de blocos");
  assert.equal(app.studyMinutesOn(DAY), expectedLecture, "minutos contam somente a aula efetivamente assistida");
  cases++;

  await reset();
  app.SET(`tm:${law.key}`, 7);
  clock += 200;
  app.SET(law.key, 1);
  assert.equal(app.studyMinutesOn(DAY), 7, "cronômetro substitui a estimativa, não soma sobre ela");
  app.SET(law.key, null);
  assert.equal(app.studyMinutesOn(DAY), 0, "desmarcar conclusão cronometrada zera seu crédito");
  assert.equal(app.G(`tm:${law.key}`), null, "desmarcar limpa cronômetro da sessão antiga");
  clock += 10000;
  app.SET(law.key, 1);
  assert.equal(app.studyMinutesOn(DAY), law.min, "nova conclusão não reutiliza medição apagada");
  cases++;

  await reset();
  app.S.kv[`tm:${law.key}`] = [7, clock - 60000];
  app.SET(law.key, 1);
  assert.equal(app.studyMinutesOn(DAY), law.min, "medição antiga não substitui nova conclusão manual");
  cases++;

  await reset();
  app.SET(`qd:${DAY}:test`, JSON.stringify({ mat: "Civil", banca: "FGV", n: 12, ac: 9 }));
  await flush();
  assert.equal(header(), 24, "questões registradas somam dois minutos por questão no cabeçalho");
  app.SET("qd:2026-09-07:past", JSON.stringify({ mat: "Civil", banca: "FGV", n: 5, ac: 4 }));
  assert.equal(app.studyMinutesOn(DAY), 24, "registro retroativo de questões respeita a data do estudo");
  assert.equal(app.studyMinutesOn("2026-09-07"), 10, "questões ficam no dia indicado");
  app.SET(`qd:${DAY}:test`, null);
  await flush();
  assert.equal(header(), 0, "remover questões desfaz seu tempo");
  cases++;

  await reset();
  const item = app.pitem(law.key, "Lei", "", 100);
  const checkbox = item.querySelector("input");
  checkbox.checked = true;
  checkbox.dispatch("change");
  await flush();
  assert.equal(header(), law.min, "checkbox da página de matéria atualiza o cabeçalho imediatamente");
  checkbox.checked = false;
  checkbox.dispatch("change");
  await flush();
  assert.equal(header(), 0, "desmarcar na página de matéria atualiza o cabeçalho");
  cases++;

  await reset();
  const card = app.unitCard(app.unitsOf(law.b).find(u => u.key === law.key), true);
  const homeCheckbox = card.querySelector(".ck");
  homeCheckbox.checked = true;
  homeCheckbox.dispatch("change");
  await flush();
  assert.equal(header(), law.min, "checkbox da Home contabiliza o tempo exibido");
  const persisted = JSON.parse(storage.get("enam-cron-v2")).kv;
  const reloaded = loadApp(persisted);
  assert.equal(reloaded.app.studyMinutesOn(DAY), law.min, "reabrir o aplicativo conserva os minutos");
  cases++;

  const beforePatch = loadApp({ [law.key]: [1, clock], [juris.key]: [1, clock] });
  assert.equal(beforePatch.app.studyMinutesOn(DAY), law.min + 10,
    "marcações existentes antes da correção recuperam minutos sem precisar ticar novamente");
  cases++;

  await reset();
  app.SET(law.key, 1);
  app.SET("spd:lei", 8);
  assert.equal(app.studyMinutesOn(DAY), law.min, "mudar o ritmo não altera tempo de conclusão já registrado");
  cases++;

  await reset();
  const legacyJurisIndex = app.DATA.juris.findIndex(j => `jur:${j.pid}` === juris.key);
  assert(legacyJurisIndex >= 0, "índice legado do julgado existe");
  app.S.kv[`js:${legacyJurisIndex}`] = [1, clock];
  app.S.kv[juris.key] = [1, clock];
  assert.equal(app.studyMinutesOn(DAY), 10, "estado legado e identificador permanente não duplicam o julgado");
  cases++;

  await reset();
  const focus = loadApp();
  focus.app.setFocusDate("2030-01-01");
  const focusKey = "xdone:test-focus";
  focus.app.SET("ext:test-focus", JSON.stringify({ mat: "Civil", tipo: "REV", min: 17, t: "Extra" }));
  await focus.app.abrirFoco({ key: focusKey, title: "Extra", min: 17,
    b: { id: "ext:test-focus", mat: "Civil", tipo: "REV", min: 17, t: "Extra", day: "", det: "" } });
  const overlay = focus.document.body.children.findLast(el => el.className === "focus");
  assert(overlay, "modo foco abriu");
  clock += 120000;
  overlay.querySelector("#fpause").click();
  clock += 300000;
  overlay.querySelector("#fok").click();
  await flush();
  assert.equal(focus.app.G(`tm:${focusKey}`), 2, "concluir durante a pausa conta só os dois minutos ativos");
  assert.equal(focus.app.studyMinutesOn(DAY), 2, "tempo pausado não entra no cabeçalho");
  cases++;

  console.log(JSON.stringify({ cases, status: "ok", date: DAY, lawMinutes: law.min, lectureMinutes: lecture.min }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
