const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real application code, isolated storage and a fake cloud. Forecast calculation
// has its own suite; here its writes are exercised without a full catalog search.
const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('const source = html.match', 'let source = html.match')
  .replace('function loadApp(initial = {}, options = {}) {', 'source = source.replace("function scheduleCompletionForecast(force){", "function scheduleCompletionForecast(force){return;");\nfunction loadApp(initial = {}, options = {}) {')
  .replace('const nodes = new Map();', 'const nodes = new Map(), timers = new Map(), intervals = new Map(), events = new Map(); let timerId = 0;')
  .replace('querySelectorAll: () => [], addEventListener() {},', 'querySelectorAll: () => [], addEventListener: (event, fn) => { const rows = events.get(event) || []; rows.push(fn); events.set(event, rows); },')
  .replace('addEventListener() {}, setInterval: () => 1, clearInterval() {},', 'addEventListener() {}, setInterval: fn => { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),')
  .replace('setTimeout: () => 1, clearTimeout() {}, queueMicrotask,', 'setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), queueMicrotask,')
  .replace('updateStats, unitCard,', 'syncNow, markSyncPending, state: () => ({syncState, syncDirty, localRevision, liveStudyDate}), updateStats, unitCard,')
  .replace('return { app: context.app, nodes, storage, document };', 'return { app: context.app, nodes, storage, document, timers, intervals, events, setClock: value => { clock = value; } };');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const at = day => new Date(day + 'T12:00:00').getTime();
const initialTime = at('2026-09-08');
const profile = {
  'profile:120-weekdays:v1': [1, initialTime - 1000],
  'profile:90-weekdays:v1': [1, initialTime - 1000],
  'mig:v7': [1, initialTime - 1000],
  'cfg:cap': [120, initialTime - 1000]
};
const copy = value => JSON.parse(JSON.stringify(value));
const ok = kv => ({ok: true, status: 200, json: async () => ({kv: copy(kv)})});
const deferred = () => { let resolve; const promise = new Promise(fn => {resolve = fn;}); return {promise, resolve}; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
async function drainTimers(t) {
  for (let i = 0; i < 40; i++) {
    await flush();
    if (!t.timers.size) return;
    const [id, fn] = t.timers.entries().next().value;
    t.timers.delete(id); fn();
  }
  throw Error('Timers did not settle');
}
function cloud(initial = profile) {
  const c = {remote: copy(initial), calls: [], handler: null};
  c.fetch = async (_, options) => {
    const request = {method: options.method, body: options.body ? JSON.parse(options.body) : null};
    c.calls.push(request);
    if (c.handler) return c.handler(request);
    if (request.method === 'POST') {
      for (const [key, entry] of Object.entries(request.body.kv))
        if (!c.remote[key] || entry[1] >= c.remote[key][1]) c.remote[key] = copy(entry);
    }
    return ok(c.remote);
  };
  return c;
}
const methods = c => c.calls.map(r => r.method);
async function connected(c = cloud(), local = profile) {
  const t = loadApp(copy(local), {token: 'isolated-test-token', localMode: false, fetch: c.fetch});
  t.setClock(initialTime); await flush();
  assert.deepEqual(methods(c), ['GET', 'POST'], 'opening/reloading merges the cloud before uploading');
  assert.equal(t.app.state().syncState, 'ok');
  c.calls.length = 0;
  return {t, c, a: t.app};
}

async function main() {
  let cases = 0;
  {
    const c = cloud({...profile, 'nt:remote': ['loaded', initialTime - 100]});
    const {t, a} = await connected(c, {...profile, 'nt:offline': ['preserved', initialTime]});
    assert.equal(a.G('nt:remote'), 'loaded');
    assert.equal(c.remote['nt:offline'][0], 'preserved');
    assert.equal(t.app.state().syncDirty, false);
    cases++;

    a.SET('nt:manual-only', 'local change');
    assert.equal(JSON.parse(t.storage.get('enam-cron-v2')).kv['nt:manual-only'][0], 'local change');
    await drainTimers(t);
    assert.deepEqual(methods(c), [], 'edits and elapsed debounce delays never sync');
    assert.equal(a.state().syncDirty, true);
    assert.notEqual(a.state().syncState, 'ok', 'unsent progress must not look cloud-saved');
    cases++;

    c.remote['nt:new-remote'] = ['incoming', initialTime + 10];
    t.nodes.get('syncpill').click(); await flush();
    assert.deepEqual(methods(c), ['GET', 'POST'], 'the header button both downloads and uploads');
    assert.equal(a.G('nt:new-remote'), 'incoming');
    assert.equal(c.remote['nt:manual-only'][0], 'local change');
    assert.equal(a.state().syncState, 'ok');
    cases++;

    c.calls.length = 0;
    t.document.visibilityState = 'hidden';
    (t.events.get('visibilitychange') || []).forEach(fn => fn());
    t.setClock(at('2026-09-09'));
    t.document.visibilityState = 'visible';
    (t.events.get('visibilitychange') || []).forEach(fn => fn());
    assert.equal(a.state().liveStudyDate, '2026-09-09', 'returning to the tab still refreshes the local study date');
    t.setClock(at('2026-09-10'));
    t.intervals.forEach(fn => fn()); await drainTimers(t);
    assert.equal(a.state().liveStudyDate, '2026-09-10', 'the daily forecast clock remains live');
    assert.deepEqual(methods(c), [], 'visibility and periodic date checks never contact the cloud');
    cases++;
  }

  for (const failure of ['offline', 'unauthorized']) {
    const {t, c, a} = await connected();
    a.SET('nt:unsent', 'keep me');
    c.handler = async () => { if (failure === 'offline') throw Error('offline'); return {ok:false, status:401}; };
    assert.equal(await a.syncNow(), false);
    assert.deepEqual(methods(c), ['GET'], 'a failed read must prevent upload even with a previously loaded profile');
    assert.equal(a.G('nt:unsent'), 'keep me');
    assert.equal(a.state().syncDirty, true);
    await drainTimers(t);
    assert.deepEqual(methods(c), ['GET'], 'failed sync is not retried by a timer');
    cases++;
  }

  {
    const c = cloud();
    c.handler = async () => { throw Error('offline during first load'); };
    const t = loadApp({}, {token: 'isolated-test-token', localMode: false, fetch: c.fetch});
    await flush(); await drainTimers(t);
    assert.deepEqual(methods(c), ['GET']);
    assert.equal(t.app.G('profile:120-weekdays:v1'), null, 'no fake empty profile is created before first successful merge');
    cases++;
  }

  {
    const c = cloud(), gate = deferred();
    c.handler = request => request.method === 'GET' ? gate.promise : Promise.resolve(ok(request.body.kv));
    const t = loadApp(copy(profile), {token:'isolated-test-token', localMode:false, fetch:c.fetch});
    t.setClock(initialTime);
    t.app.SET('nt:during-first-get', 'written while reading cloud');
    assert.deepEqual(methods(c), ['GET']);
    gate.resolve(ok({...profile, 'nt:first-remote': ['from cloud', initialTime - 20]}));
    await flush();
    assert.deepEqual(methods(c), ['GET', 'POST']);
    assert.equal(c.calls[1].body.kv['nt:during-first-get'][0], 'written while reading cloud');
    assert.equal(c.calls[1].body.kv['nt:first-remote'][0], 'from cloud');
    cases++;
  }

  {
    const {c, a} = await connected();
    const gate = deferred();
    c.handler = request => request.method === 'GET' ? gate.promise : Promise.resolve(ok(request.body.kv));
    const first = a.syncNow(), second = a.syncNow(), third = a.syncNow();
    assert.deepEqual(methods(c), ['GET'], 'overlapping clicks share the current sync');
    gate.resolve(ok(c.remote));
    const results = await Promise.all([first, second, third]);
    assert(results.every(Boolean));
    assert.deepEqual(methods(c), ['GET', 'POST']);
    cases++;
  }

  {
    const {t, c, a} = await connected();
    const gate = deferred(); let sent;
    c.handler = request => {
      if (request.method === 'GET') return Promise.resolve(ok(c.remote));
      sent = copy(request.body.kv); return gate.promise;
    };
    a.SET('nt:race', 'before upload');
    const syncing = a.syncNow(); await flush();
    assert.deepEqual(methods(c), ['GET', 'POST']);
    t.setClock(initialTime + 50);
    a.SET('nt:race', 'edited while uploading');
    gate.resolve(ok(sent)); await syncing; await drainTimers(t);
    assert.equal(a.G('nt:race'), 'edited while uploading', 'POST response cannot overwrite a newer local edit');
    assert.equal(a.state().syncDirty, true, 'an edit made after the upload snapshot remains pending');
    assert.notEqual(a.state().syncState, 'ok');
    assert.deepEqual(methods(c), ['GET', 'POST'], 'concurrent edit waits for the next explicit sync');
    cases++;
  }

  {
    const {t, c, a} = await connected();
    a.SET('forecast:last:v1', JSON.stringify({derived:true}));
    await drainTimers(t);
    assert.deepEqual(methods(c), []);
    assert.equal(a.state().syncDirty, false, 'a derived forecast cache alone does not advertise unsent study progress');
    a.SET('forecast:baseline:v1', JSON.stringify({capturedOn:'2026-09-08'}));
    await drainTimers(t);
    assert.deepEqual(methods(c), []);
    assert.equal(a.state().syncDirty, true, 'the user baseline is saved locally until explicit sync');
    cases++;
  }

  {
    const {t, c, a} = await connected();
    a.SET('nt:reload-offline', 'unsent local progress'); await drainTimers(t);
    assert.deepEqual(methods(c), []);
    const saved = JSON.parse(t.storage.get('enam-cron-v2')).kv;
    const reloaded = loadApp(saved, {token: 'isolated-test-token', localMode: false, fetch:c.fetch});
    await flush();
    assert.deepEqual(methods(c), ['GET', 'POST'], 'a reload is an authorized sync opportunity');
    assert.equal(reloaded.app.G('nt:reload-offline'), 'unsent local progress');
    assert.equal(c.remote['nt:reload-offline'][0], 'unsent local progress');
    cases++;
  }
  console.log(JSON.stringify({status:'ok', cases, suite:'manual-sync'}));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
