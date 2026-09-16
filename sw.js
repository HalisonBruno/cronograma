// Rede primeiro com fallback de cache: online voce SEMPRE ve a versao mais nova (o cache so entra
// sem rede). Correcao de 16/09/2026: a copia da resposta era feita depois de entrega-la a pagina, quando
// o corpo ja tinha sido consumido; o clone falhava e nada era guardado, entao nao havia uso offline.
// Agora a copia sai antes de devolver a resposta, e textos de lei e informativos tem um limite de espera
// quando ja existe copia guardada (rede lenta nao prende a leitura).
const CACHE = "enam-v14-offline";
const CORE = ["./", "./index.html", "./ebook-law-evidence.js", "./manifest.webmanifest", "./icon-192.png", "./icon-180.png"];
const DATA_FILE = /\/(leis|infos)\/[^/]+\.json$/;
const DATA_TIMEOUT_MS = 4000;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const network = fetch(req).then(r => {
    if (r.ok) {
      const copy = r.clone();   // antes de a pagina consumir o corpo
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return r;
  });
  // O service worker pode continuar vivo ate a copia ser gravada, mesmo que a pagina ja tenha a resposta.
  e.waitUntil(network.then(() => {}, () => {}));
  e.respondWith((async () => {
    const isData = DATA_FILE.test(new URL(req.url).pathname);
    const cached = isData ? await caches.match(req) : null;
    if (cached) {
      const timeout = new Promise(res => setTimeout(() => res(cached), DATA_TIMEOUT_MS));
      return Promise.race([network.catch(() => cached), timeout]);
    }
    try {
      return await network;
    } catch (err) {
      const hit = await caches.match(req, {ignoreSearch: req.mode === "navigate"});
      if (hit) return hit;
      if (req.mode === "navigate") {
        const page = await caches.match("./index.html");
        if (page) return page;
      }
      throw err;
    }
  })());
});
