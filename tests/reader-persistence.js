const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

// Exercise the actual DOM, asynchronous readers and pull() implementation.
// No account, user backup, real token or external network is used.
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    const type = {'.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css'}[path.extname(file)] || 'application/octet-stream';
    // The all-catalog forecast is independently covered by forecast tests and
    // dominates startup with an empty profile; keep this DOM suite focused.
    if (file === path.join(root, 'index.html')) data = data.toString('utf8').replace('function scheduleCompletionForecast(force){', 'function scheduleCompletionForecast(force){return;');
    res.writeHead(200, {'content-type': type}); res.end(data);
  });
});
let browser, cases = 0;
const cardSelector = key => '[data-reader-key=' + JSON.stringify(key) + ']';

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block'});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('enam-local-mode', '1');
    localStorage.setItem('enam-cron-v2', JSON.stringify({kv: {
      'profile:120-weekdays:v1': [1, 1], 'profile:90-weekdays:v1': [1, 1], 'mig:v7': [1, 1]
    }}));
  });
  await page.goto(base + '/');
  const fixture = await page.evaluate(() => {
    hideSetup(); clearTimeout(forecastTimer); forecastRun++; scheduleCompletionForecast = () => {};
    token = 'isolated-reader-regression'; profileReady = true;
    window.__remoteKv = {};
    apiCall = async () => ({status: 200, ok: true, json: async () => ({kv: window.__remoteKv})});
    const units = catalogUnits();
    const law = units.find(u => u.b.tipo === 'LEI' && lawGroupMeta(u)?.group);
    const info = units.find(u => u.key.startsWith('inf:'));
    const juris = units.find(u => u.key.startsWith('jur:') || u.key.startsWith('js:'));
    if (!law || !info || !juris) throw Error('Reader fixtures missing from catalog');
    const date = '2026-09-14';
    for (const u of [law, info, juris]) S.kv['mvu:' + u.key] = [date, Date.now()];
    curTab = 'hoje'; curDate = date; render();
    return {law: law.key, info: info.key, juris: juris.key};
  });
  const law = page.locator(cardSelector(fixture.law));
  const info = page.locator(cardSelector(fixture.info));
  const juris = page.locator(cardSelector(fixture.juris));
  const changedPull = async () => page.evaluate(async () => {
    window.__syncRound = (window.__syncRound || 0) + 1;
    window.__remoteKv = {'nt:reader-test': ['remote-' + window.__syncRound, Date.now() + window.__syncRound]};
    return pull();
  });
  const loaded = async locator => {
    await locator.waitFor({state: 'visible'});
    await page.waitForFunction(selector => {
      const el = document.querySelector(selector);
      return el && el.textContent.length > 80 && !/^carregando/.test(el.textContent);
    }, await locator.evaluate(el => {
      const card = el.closest('[data-reader-key]');
      return '[data-reader-key=' + JSON.stringify(card.dataset.readerKey) + '] .' + el.classList[0];
    }));
  };

  await law.locator('.lerbt').click();
  await loaded(law.locator('.inlinetxt'));
  await page.evaluate(key => {
    window.__lawCard = document.querySelector('[data-reader-key=' + JSON.stringify(key) + ']');
    window.__lawBox = window.__lawCard.querySelector('.inlinetxt');
  }, fixture.law);
  assert.equal(await page.evaluate(() => pull()), true);
  assert(await page.evaluate(key => window.__lawCard === document.querySelector('[data-reader-key=' + JSON.stringify(key) + ']'), fixture.law), 'unchanged sync must keep the existing card DOM');
  cases++;

  await changedPull();
  assert(await page.evaluate(key => window.__lawBox === document.querySelector('[data-reader-key=' + JSON.stringify(key) + '] .inlinetxt'), fixture.law), 'changed sync must reattach the loaded law reader, not fetch/recreate it');
  assert.match(await page.evaluate(() => G('nt:reader-test')), /^remote-/);
  cases++;

  const before = await page.evaluate(() => {
    const box = window.__lawBox;
    scrollTo(0, scrollY + box.getBoundingClientRect().top + Math.min(80, box.offsetHeight / 3));
    return {done: progressSummary().done, y: scrollY, top: box.getBoundingClientRect().top};
  });
  await page.evaluate(async key => {
    window.__remoteKv = {[key]: [1, Date.now() + 10000]};
    await pull();
  }, fixture.law);
  assert.equal(await law.locator('.ck').isChecked(), true, 'remote completion must reach the visible checkbox');
  assert((await page.evaluate(() => progressSummary().done)) > before.done, 'reader protection must not hide remote progress');
  assert(await page.evaluate(key => window.__lawBox === document.querySelector('[data-reader-key=' + JSON.stringify(key) + '] .inlinetxt'), fixture.law), 'remote completion retains the reader node');
  assert(Math.abs((await page.evaluate(() => window.__lawBox.getBoundingClientRect().top)) - before.top) <= 3, 'reading position must not jump when remote progress redraws Home');
  cases++;

  await info.locator('.lerbt').click();
  await loaded(info.locator('.inlinetxt'));
  await page.evaluate(key => { window.__infoBox = document.querySelector('[data-reader-key=' + JSON.stringify(key) + '] .inlinetxt'); }, fixture.info);
  await changedPull();
  assert(await page.evaluate(key => window.__infoBox === document.querySelector('[data-reader-key=' + JSON.stringify(key) + '] .inlinetxt'), fixture.info), 'Home informativo must remain loaded');
  cases++;

  await juris.locator('.exp').click();
  await changedPull();
  assert.match(await juris.getAttribute('class'), /\bopen\b/, 'Home thesis remains expanded');
  await juris.locator('.exp').click();
  await changedPull();
  assert(!/\bopen\b/.test(await juris.getAttribute('class')), 'explicitly closed Home thesis stays closed');
  cases++;

  await law.locator('.lerbt').click();
  await changedPull();
  assert.equal(await law.locator('.inlinetxt').count(), 0, 'explicitly closed law reader stays closed');
  cases++;

  await info.locator('.lerbt').click();
  await page.evaluate(() => {
    window.__originalInfoTexto = infoTexto;
    infoTexto = () => new Promise(resolve => { window.__resolveReader = resolve; });
  });
  await info.locator('.lerbt').click();
  assert.match(await info.locator('.inlinetxt').innerText(), /carregando/);
  await page.evaluate(key => { window.__pendingBox = document.querySelector('[data-reader-key=' + JSON.stringify(key) + '] .inlinetxt'); }, fixture.info);
  await changedPull();
  assert(await page.evaluate(key => window.__pendingBox === document.querySelector('[data-reader-key=' + JSON.stringify(key) + '] .inlinetxt'), fixture.info), 'in-flight reader must remain the same node');
  await page.evaluate(key => {
    window.__resolveReader({[key.slice(4)]: 'Texto tardio do informativo: resposta iniciada antes de a sincronização redesenhar a página.'});
    infoTexto = window.__originalInfoTexto;
  }, fixture.info);
  await page.waitForFunction(key => document.querySelector('[data-reader-key=' + JSON.stringify(key) + '] .inlinetxt').textContent.includes('Texto tardio'), fixture.info);
  cases++;

  await page.evaluate(() => {
    window.__remoteKv = {'nt:reader-return': ['returned', Date.now() + 20000]};
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => G('nt:reader-return') === 'returned');
  assert(await page.evaluate(key => window.__pendingBox === document.querySelector('[data-reader-key=' + JSON.stringify(key) + '] .inlinetxt'), fixture.info), 'returning to the browser tab must not close its reader');
  cases++;

  await page.evaluate(() => { matSel = 'Civil'; curTab = 'mats'; render(); });
  const materialLaw = page.locator('#view [data-reader-key]').filter({has: page.locator('.lerbt')}).first();
  const materialInfo = page.locator('#view [data-reader-key]').filter({has: page.locator('.lerinf')}).first();
  const materialJuris = page.locator('#view [data-reader-key]').filter({has: page.locator('.vtese')}).first();
  await materialLaw.locator('.lerbt').click();
  await loaded(materialLaw.locator('.inlinetxt'));
  await materialInfo.locator('.lerinf').click();
  await loaded(materialInfo.locator('.inftxt'));
  await materialJuris.locator('.vtese').click();
  await page.evaluate(() => {
    window.__materialLaw = document.querySelector('#view .inlinetxt');
    window.__materialInfo = document.querySelector('#view .inftxt');
  });
  const materialTop = await materialInfo.locator('.inftxt').evaluate(el => {
    scrollTo(0, scrollY + el.getBoundingClientRect().top + 50);
    return el.getBoundingClientRect().top;
  });
  await changedPull();
  // Check again after a browser paint so a late layout jump cannot pass unnoticed.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert(await page.evaluate(() => window.__materialLaw === document.querySelector('#view .inlinetxt')), 'subject law reader stays loaded');
  assert(await page.evaluate(() => window.__materialInfo === document.querySelector('#view .inftxt')), 'subject informativo reader stays loaded');
  assert.equal(await materialJuris.locator('.tesebox').isVisible(), true, 'subject thesis remains expanded');
  assert(Math.abs((await materialInfo.locator('.inftxt').evaluate(el => el.getBoundingClientRect().top)) - materialTop) <= 3, 'subject reader position survives sync and section-navigation enhancement');
  cases++;

  await materialInfo.locator('.lerinf').click();
  await materialJuris.locator('.vtese').click();
  await changedPull();
  assert.equal(await materialInfo.locator('.inftxt').count(), 0, 'explicitly closed subject informativo stays closed');
  assert.equal(await materialJuris.locator('.tesebox').isVisible(), false, 'explicitly closed subject thesis stays closed');
  cases++;

  await page.evaluate(() => { matSel = 'Informativos 10x'; curTab = 'mats'; render(); });
  const generalInfo = page.locator('#view [data-reader-key]').filter({has: page.locator('.lerinf')}).first();
  await generalInfo.locator('.lerinf').click();
  await loaded(generalInfo.locator('.inftxt'));
  await page.evaluate(() => { window.__generalInfo = document.querySelector('#view .inftxt'); });
  await changedPull();
  assert(await page.evaluate(() => window.__generalInfo === document.querySelector('#view .inftxt')), 'general informativo catalog retains its loaded reader');
  cases++;

  await generalInfo.locator('.lerinf').click();
  await page.evaluate(() => {
    window.__originalInfoTexto = infoTexto;
    infoTexto = () => new Promise(resolve => { window.__resolveClosedReader = resolve; });
  });
  await generalInfo.locator('.lerinf').click();
  assert.match(await generalInfo.locator('.inftxt').innerText(), /carregando/);
  const generalKey = await generalInfo.getAttribute('data-reader-key');
  await generalInfo.locator('.lerinf').click();
  await changedPull();
  await page.evaluate(async key => {
    window.__resolveClosedReader({[key.slice(4)]: 'A resposta atrasada não deve reabrir um leitor fechado pelo usuário.'});
    infoTexto = window.__originalInfoTexto;
    await Promise.resolve(); await Promise.resolve();
  }, generalKey);
  assert.equal(await generalInfo.locator('.inftxt').count(), 0, 'finishing a closed pending request must not reopen its reader');
  cases++;

  await generalInfo.locator('.lerinf').click();
  await loaded(generalInfo.locator('.inftxt'));
  await page.evaluate(() => { curTab = 'hoje'; render(); });
  assert.equal(await page.locator('#view .inftxt, #view .inlinetxt').count(), 0, 'explicit navigation must not transplant readers from another view');
  cases++;

  await page.evaluate(() => {
    const infos = planningUnits().filter(u => u.key.startsWith('inf:') && !unitDone(u)).slice(0, 65);
    if (infos.length < 31) throw Error('Queue pagination fixture requires 31 pending informativos');
    for (const u of infos) S.kv['mvu:' + u.key] = ['fila', Date.now()];
    render();
  });
  await page.locator('.backlog > summary').click();
  await page.locator('.backlog .next').click();
  const queuedInfo = page.locator('.backlog [data-reader-key]').filter({has: page.locator('.lerbt')}).first();
  await queuedInfo.locator('.lerbt').click();
  await loaded(queuedInfo.locator('.inlinetxt'));
  await page.evaluate(() => { window.__queuedInfo = document.querySelector('.backlog .inlinetxt'); });
  await changedPull();
  // Restoring details.open queues a native toggle event; it must not rebuild
  // the list a second time and discard the just-restored reading node.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.backlog').evaluate(el => el.open), true, 'pending panel stays expanded during sync');
  assert.match(await page.locator('.backlog .page').innerText(), /^Página 2 de /, 'pending panel keeps its selected page');
  assert(await page.evaluate(() => window.__queuedInfo === document.querySelector('.backlog .inlinetxt')), 'queued informativo reader survives list reconstruction and its delayed toggle event');
  cases++;

  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('reader-persistence: ' + cases + ' cases passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
