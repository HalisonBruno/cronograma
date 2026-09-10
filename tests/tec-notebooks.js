const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const NOW = new Date("2026-09-09T12:34:56").getTime();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map(); this.selectors = new Map();
    this.style = { setProperty() {} }; this.dataset = {}; this.classList = { add() {}, remove() {}, toggle() {} };
    this.textContent = this.innerHTML = this.value = ""; this.checked = false; this.options = [];
    this.scrollWidth = this.scrollLeft = this.clientWidth = 0;
  }
  appendChild(el) { this.children.push(el); return el; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]); }
  dispatch(name) { for (const fn of this.listeners.get(name) || []) fn({ target: this, preventDefault() {} }); }
  click() { this.dispatch("click"); }
  querySelector(s) { if (!this.selectors.has(s)) this.selectors.set(s, new Element()); return this.selectors.get(s); }
  querySelectorAll() { return []; }
  insertAdjacentHTML() {} setAttribute() {} focus() {} remove() {} scrollIntoView() {}
}
const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
function load(initial = {}) {
  const storage = new Map([["enam-cron-v2", JSON.stringify({ kv: initial })]]), nodes = new Map();
  const document = {
    body: new Element(), documentElement: new Element(), visibilityState: "visible",
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
    createElement: tag => new Element(tag), querySelector: () => new Element(), querySelectorAll: () => [], addEventListener() {},
  };
  const context = {
    document, console, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    navigator: {}, location: { protocol: "file:" }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, queueMicrotask() {},
    fetch: async () => ({ ok: false, json: async () => ({}) }), confirm: () => false, prompt: () => null, alert() {}, scrollTo() {}, scrollY: 0,
    URL, Blob, Date: Clock, Math, JSON, Set, Map, Intl, Promise, encodeURIComponent,
  };
  context.window = context;
  vm.runInNewContext(source + `;globalThis.app={S,G,SET,DATA,TECMAP,EB2MAT,tecStudied,tecPick,tecBook,tecBooks,tecSaveBook,tecNewBook,tecSelectBook,tecGenerations,tecApplications,tecApplied,tecGenerate,tecConfirm,tecUndo,tecNotebookPanel,tecUrl};`, context);
  return { app: context.app, storage };
}
const plain = x => JSON.parse(JSON.stringify(x));
const walk = el => [el, ...el.children.flatMap(walk)];
const texts = el => walk(el).map(x => x.textContent).join("\n");
let cases = 0;
const test = (name, fn) => { fn(); cases++; console.log("ok", cases, name); };
const { app, storage } = load({ "qd:2026-09-08:legacy": [JSON.stringify({ mat: "Civil", n: 20, ac: 12 }), NOW], "tecg:broken": ["not JSON", NOW] });
const mat = "Civil";
const mark = key => { app.S.kv[key] = [1, NOW]; };
const bookKeys = Object.keys(app.TECMAP).filter(k => k.startsWith("eb:") && app.EB2MAT[k.split(":")[1]] === mat);
assert(bookKeys.length > 2);
let first, g, selected, panel;

test("abrir painel não cria caderno nem considera filtros aplicados", () => {
  const before = JSON.stringify(app.S.kv); panel = app.tecNotebookPanel(mat);
  assert.equal(JSON.stringify(app.S.kv), before); assert.match(texts(panel), /Gerar novos filtros/);
  assert.match(texts(panel), /Gerar não aplica filtros/); assert.equal(app.tecApplied(mat, app.tecBook(mat).id).size, 0);
});
test("geração vazia recebe data e hora e permanece no histórico", () => {
  const empty = app.tecGenerate(mat); assert.equal(empty.createdAt, NOW); assert.equal(empty.topics.length, 0);
  assert.equal(app.tecGenerations(mat, empty.bookId).length, 1); assert.match(texts(app.tecNotebookPanel(mat)), /Nenhum filtro novo/);
});
test("identificação persistente e link exclusivo HTTPS do TEC", () => {
  first = app.tecSaveBook(mat, "Meu caderno Civil", "https://www.tecconcursos.com.br/cadernos/123");
  assert.equal(app.tecBook(mat).name, "Meu caderno Civil");
  for (const url of ["javascript:alert(1)", "https://tecconcursos.com.br.evil.test/", "https://other.test/", "https://user:pass@www.tecconcursos.com.br/", "http://tecconcursos.com.br/"]) assert.throws(() => app.tecSaveBook(mat, "Civil", url));
  assert.equal(app.tecUrl("javascript:alert(1)"), null);
});
test("somente conteúdo marcado gera assuntos; não aplica automaticamente", () => {
  mark(bookKeys[0]); g = app.tecGenerate(mat); assert(g.topics.length > 0);
  assert.deepEqual(plain(g.topics), plain(app.tecPick(mat, "fgv"))); assert.equal(app.tecApplied(mat, first.id).size, 0);
  assert.deepEqual(plain(g.base.years), [2022, 2023, 2024, 2025, 2026]);
});
test("gerar novamente sem confirmar preserva propostas e ordena corretamente no mesmo milissegundo", () => {
  const next = app.tecGenerate(mat); assert.deepEqual(plain(next.topics), plain(g.topics));
  assert.equal(app.tecGenerations(mat, first.id)[0].id, next.id); g = next;
});
test("confirmar exige ação explícita, base conferida e assuntos da geração", () => {
  assert.throws(() => app.tecConfirm(mat, g.id, g.topics, false));
  assert.throws(() => app.tecConfirm(mat, g.id, ["assunto inventado"], true));
  assert.throws(() => app.tecConfirm(mat, g.id, [], true));
  assert.equal(app.tecApplied(mat, first.id).size, 0);
});
test("confirmação parcial registra horário e exclui somente assuntos confirmados", () => {
  selected = g.topics[0]; const a = app.tecConfirm(mat, g.id, [selected], true);
  assert.equal(a.appliedAt, NOW); assert.equal(app.tecApplied(mat, first.id).size, 1);
  const next = app.tecGenerate(mat); assert(!next.topics.includes(selected));
  assert.deepEqual(new Set(next.topics), new Set(g.topics.filter(t => t !== selected))); g = next;
});
test("não há corte artificial de 6 ou 8 assuntos e cada nova geração é incremental", () => {
  bookKeys.forEach(mark); g = app.tecGenerate(mat); assert(g.topics.length > 8);
  assert.equal(g.topics.length, new Set(app.tecPick(mat, "fgv")).size - 1);
  assert(!g.topics.includes(selected)); assert.equal(new Set(g.topics).size, g.topics.length);
});
test("geração não mistura outra matéria e não permite confirmar em outro caderno", () => {
  assert.equal(app.tecGenerate("Penal").topics.length, 0);
  assert.throws(() => app.tecConfirm("Penal", g.id, g.topics, true));
});
test("confirmar tudo zera apenas o delta, sem apagar o histórico", () => {
  app.tecConfirm(mat, g.id, g.topics, true); const empty = app.tecGenerate(mat);
  assert.equal(empty.topics.length, 0); assert(app.tecGenerations(mat, first.id).length > 4);
});
test("retirar marcação de estudo não finge remover filtro do TEC", () => {
  const before = app.tecApplied(mat, first.id).size; app.S.kv[bookKeys[0]] = [null, NOW];
  assert.equal(app.tecApplied(mat, first.id).size, before); assert.equal(app.tecGenerate(mat).topics.length, 0);
});
test("desfazer confirmação é reversível sem apagar auditoria ou agir no TEC", () => {
  const a = app.tecApplications(mat, first.id).find(a => a.topics.includes(selected));
  app.tecUndo(mat, a.id); assert(!app.tecApplied(mat, first.id).has(selected));
  mark(bookKeys[0]); assert(app.tecGenerate(mat).topics.includes(selected));
  assert(app.G("tecaundo:" + a.id)); assert(app.tecApplications(mat, first.id).some(x => x.id === a.id));
});
test("outro link não herda filtros já confirmados", () => {
  assert.throws(() => app.tecSaveBook(mat, "Outro", "https://www.tecconcursos.com.br/cadernos/999"));
  const other = app.tecNewBook(mat); assert.notEqual(other.id, first.id); assert.equal(app.tecApplied(mat, other.id).size, 0);
  assert(app.tecGenerate(mat).topics.length > 8); app.tecSelectBook(mat, first.id);
  assert(app.tecApplied(mat, first.id).size > 0); assert.equal(app.tecBook(mat).url, first.url);
});
test("histórico, cadernos, aplicação e dados antigos sobrevivem ao recarregamento", () => {
  const persisted = JSON.parse(storage.get("enam-cron-v2")).kv; const again = load(persisted).app;
  assert.deepEqual(plain(again.tecBook(mat)), plain(app.tecBook(mat)));
  assert.deepEqual(plain(again.tecGenerations(mat, first.id)), plain(app.tecGenerations(mat, first.id)));
  assert.deepEqual([...again.tecApplied(mat, first.id)].sort(), [...app.tecApplied(mat, first.id)].sort());
  assert.equal(again.G("qd:2026-09-08:legacy"), app.G("qd:2026-09-08:legacy"));
});
test("interface gera, lista sem truncar, confirma parcialmente e atualiza sem colagem", () => {
  app.tecNewBook(mat); panel = app.tecNotebookPanel(mat);
  const click = label => { const b = walk(panel).find(x => x.tagName === "BUTTON" && x.textContent === label); assert(b, label); b.click(); };
  click("Gerar novos filtros do que estudei");
  const pending = app.tecGenerations(mat, app.tecBook(mat).id)[0].topics;
  const checks = walk(panel).filter(x => x.tagName === "INPUT" && x.type === "checkbox");
  assert.equal(checks.length, pending.length + 1); assert(checks.every(c => !c.checked));
  checks[0].checked = true; checks.at(-1).checked = true;
  click("Confirmar os filtros marcados como incluídos no TEC");
  assert.equal(app.tecApplied(mat, app.tecBook(mat).id).size, 1);
  assert.match(texts(panel), /Histórico de gerações e confirmações/); assert(!texts(panel).includes("cole no TEC"));
  assert.equal(walk(panel).filter(x => x.tagName === "INPUT" && x.type === "checkbox").length, pending.length);
});
test("cadernos importados não executam links ou HTML arbitrários", () => {
  const b = app.tecBook(mat); app.S.kv["tecb:" + b.id] = [JSON.stringify({ ...b, url: "javascript:alert(1)", name: '<img src=x onerror="alert(1)">' }), NOW];
  panel = app.tecNotebookPanel(mat); assert(!walk(panel).some(el => el.tagName === "A" && el.href === "javascript:alert(1)"));
  assert(!walk(panel).some(el => String(el.innerHTML).includes("onerror")));
});
console.log(`TEC notebooks: ${cases} tests passed.`);
