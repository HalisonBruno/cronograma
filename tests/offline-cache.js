// Service worker (16/09/2026): a resposta é copiada para o cache ANTES de ser entregue à página; sem rede,
// as leituras já baixadas abrem do cache; com rede lenta, texto de lei e informativo com cópia guardada
// não fica preso; navegação sem rede cai no index.html; requisições de outra origem não são interceptadas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Resp {
  constructor(body, ok = true) { this.body = body; this.ok = ok; this.status = ok ? 200 : 503; this.bodyUsed = false; }
  clone() { if (this.bodyUsed) throw new TypeError('Response body is already used'); return new Resp(this.body, this.ok); }
}
const ioDelay = () => new Promise(r => setImmediate(r));   // gravação em cache é assíncrona, como no navegador

function loadSW({network, timersFireNow = false, cacheNames = []}) {
  const store = new Map(), listeners = {}, deleted = [];
  const keyOf = (req, opts) => { const u = typeof req === 'string' ? new URL(req, 'https://app.test/cronograma/').href : req.url; return opts && opts.ignoreSearch ? u.split('?')[0] : u; };
  const cache = {
    put: async (req, resp) => { await ioDelay(); store.set(keyOf(req), resp); },
    addAll: async urls => { for (const u of urls) store.set(keyOf(u), new Resp('core:' + u)); },
    match: async (req, opts) => { await ioDelay(); const k = keyOf(req, opts); for (const [sk, v] of store) if ((opts && opts.ignoreSearch ? sk.split('?')[0] : sk) === k) return v; return undefined; },
  };
  const context = {
    self: {addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting() {}, clients: {claim() {}}},
    caches: {open: async () => { await ioDelay(); return cache; }, match: (req, opts) => cache.match(req, opts), keys: async () => cacheNames, delete: async name => { deleted.push(name); return true; }},
    fetch: req => network(req),
    location: {origin: 'https://app.test'},
    URL, Promise, setTimeout: timersFireNow ? (fn => setImmediate(fn)) : setTimeout, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);
  const dispatch = async (url, mode = 'cors') => {
    let responded = null; const waits = [];
    listeners.fetch({request: {method: 'GET', url, mode}, respondWith: p => { responded = p; }, waitUntil: p => waits.push(p)});
    const resp = responded ? await responded : null;
    if (resp) resp.bodyUsed = true;   // a página consome o corpo assim que recebe
    // Não esperar a rede que nunca responde (caso da rede lenta): só dar tempo às gravações em cache.
    void waits; for (let i = 0; i < 8; i++) await ioDelay();
    return {resp, intercepted: !!responded};
  };
  return {store, dispatch, listeners, cache, deleted};
}
const LAW = 'https://app.test/cronograma/leis/2026-09-15-50.json';

async function main() {
  // 1. Online: a resposta chega à página e uma cópia é guardada, mesmo com o corpo consumido depois.
  {
    const sw = loadSW({network: async () => new Resp('lei-online')});
    const {resp} = await sw.dispatch(LAW);
    assert.equal(resp.body, 'lei-online');
    assert(sw.store.has(LAW), 'a cópia foi gravada no cache');
    assert.equal(sw.store.get(LAW).body, 'lei-online');
    assert.equal(sw.store.get(LAW).bodyUsed, false, 'o cache guarda uma cópia própria, não o corpo consumido pela página');
  }
  // 2. Sem rede: a leitura já baixada abre do cache.
  {
    const sw = loadSW({network: async () => { throw new TypeError('offline'); }});
    sw.store.set(LAW, new Resp('lei-guardada'));
    const {resp} = await sw.dispatch(LAW);
    assert.equal(resp.body, 'lei-guardada');
  }
  // 3. Rede lenta: com cópia guardada, o texto de lei não fica preso esperando a rede.
  {
    const sw = loadSW({network: () => new Promise(() => {}), timersFireNow: true});
    sw.store.set(LAW, new Resp('lei-guardada'));
    const {resp} = await sw.dispatch(LAW);
    assert.equal(resp.body, 'lei-guardada');
  }
  // 4. Navegação sem rede (mesmo com parâmetros na URL) cai no index.html guardado.
  {
    const sw = loadSW({network: async () => { throw new TypeError('offline'); }});
    await sw.listeners.install({waitUntil: async p => p});
    for (let i = 0; i < 5; i++) await ioDelay();
    const {resp} = await sw.dispatch('https://app.test/cronograma/?tab=prog', 'navigate');
    assert(resp && /core:\.\/(index\.html)?$/.test(resp.body), 'a página abre do cache sem rede: ' + (resp && resp.body));
  }
  // 6. Rede rápida com cópia guardada: vale o texto novo, e a cópia é atualizada (não vira cache primeiro).
  {
    const sw = loadSW({network: async () => new Resp('lei-nova')});
    sw.store.set(LAW, new Resp('lei-guardada'));
    const {resp} = await sw.dispatch(LAW);
    assert.equal(resp.body, 'lei-nova', 'online, a lei nova chega à página');
    assert.equal(sw.store.get(LAW).body, 'lei-nova', 'e substitui a cópia guardada');
  }
  // 7. Erro do servidor (404/5xx) não substitui a cópia guardada; sem cópia, a página recebe o erro original.
  {
    const sw = loadSW({network: async () => new Resp('erro 503', false)});
    sw.store.set(LAW, new Resp('lei-guardada'));
    const {resp} = await sw.dispatch(LAW);
    assert.equal(resp.body, 'lei-guardada', 'erro HTTP cai na cópia');
    const other = 'https://app.test/cronograma/leis/sem-copia.json';
    const r2 = await sw.dispatch(other);
    assert(r2.resp && r2.resp.ok === false, 'sem cópia, a resposta de erro do servidor chega à página');
  }
  // 8. Ativação apaga só os caches de versões anteriores.
  {
    const sw = loadSW({network: async () => new Resp('x'), cacheNames: ['enam-v13-manual-sync', 'enam-v14-offline']});
    const waits = [];
    sw.listeners.activate({waitUntil: p => waits.push(p)});
    await Promise.all(waits);
    assert.deepEqual(sw.deleted, ['enam-v13-manual-sync']);
  }
  // 5. Outra origem (sincronização na nuvem) não é interceptada.
  {
    const sw = loadSW({network: async () => new Resp('x')});
    const {intercepted} = await sw.dispatch('https://lubgatvudjtfphtgzdgo.supabase.co/functions/v1/cronograma/state');
    assert.equal(intercepted, false);
  }
  console.log('offline-cache: ok');
}
let finished = false;
// Uma promessa pendente esvazia o laço de eventos e o Node sai com 0 sem terminar: isso é falha.
process.on('exit', () => { if (!finished) { console.error('offline-cache: incompleto'); process.exitCode = 1; } });
main().then(() => { finished = true; }).catch(e => { console.error(e); process.exit(1); });
