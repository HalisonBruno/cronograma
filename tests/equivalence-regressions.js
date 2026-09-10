const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'unitsOn, dayLoad, planRegen, updateStats, unitCard,');
const context = { require, console, __dirname, queueMicrotask, URL, Blob };
vm.runInNewContext(harness + ';globalThis.loadTestApp=loadApp;', context);
const load = context.loadTestApp;
const day = '2026-09-08';
const timestamp = new Date(day + 'T12:00:00').getTime();
let cases = 0;
function progress(test) { test.app.syncEquiv(); test.app.updateStats(); return Number(test.nodes.get('stDone').textContent.split('/')[0]); }

// Exact reported regression: a chapter gave 12 blocks; undo previously left six.
{
  const t = load(); const a = t.app;
  assert.equal(progress(t), 0);
  a.SET('eb:civil-gerais:2', 1);
  assert(progress(t) >= 2);
  assert.equal(a.studyMinutesOn(day), 32);
  a.SET('eb:civil-gerais:2', null);
  assert.equal(progress(t), 0, 'undo clears all unsupported parents and children');
  assert.equal(a.studyMinutesOn(day), 0);
  cases++;
}
// Existing corrupt derived state is repaired at startup, without touching a manual tick.
{
  const t = load({
    'st:2026-08-25-1': ['done-auto', timestamp],
    'st:2026-08-25-4': ['done-auto', timestamp],
    'eb:civil-gerais:2': ['auto', timestamp],
    'au:Direito Civil:2': ['auto', timestamp],
    'jur:juris:STF:ADPF:347': [1, timestamp - 10000]
  });
  const a = t.app;
  a.syncEquiv();
  assert.equal(a.G('eb:civil-gerais:2'), null);
  assert.equal(a.G('st:2026-08-25-1'), null);
  assert.equal(a.G('st:2026-08-25-4'), null);
  assert.equal(a.G('au:Direito Civil:2'), null);
  assert.equal(a.G('jur:juris:STF:ADPF:347'), 1);
  assert.equal(a.S.kv['jur:juris:STF:ADPF:347'][1], timestamp - 10000);
  cases++;
}
// A real independently completed alternative remains a valid root after undo.
{
  const t = load(); const a = t.app;
  const eq = a.DATA.equiv.find(e => e.grau === 'total');
  const cap = `eb:${eq.eb}:${eq.cap}`, video = `au:${eq.aula}`;
  a.SET(cap, 1); a.SET(video, 1); a.syncEquiv();
  const saved = JSON.stringify(a.S.kv[video]);
  a.SET(cap, null); a.syncEquiv();
  assert.equal(a.G(video), 1);
  assert.equal(a.G(cap), 'auto');
  assert.equal(JSON.stringify(a.S.kv[video]), saved);
  a.SET(video, null); a.syncEquiv();
  assert.equal(a.G(cap), null);
  assert.equal(a.studyMinutesOn(day), 0);
  cases++;
}
// Reconciliation is idempotent: no timestamp churn and no endless synchronization.
{
  const t = load(); const a = t.app;
  a.SET('eb:civil-gerais:2', 1); a.syncEquiv();
  const first = JSON.stringify(a.S.kv);
  a.syncEquiv(); a.syncEquiv();
  assert.equal(JSON.stringify(a.S.kv), first);
  const reopened = load(a.S.kv); reopened.app.syncEquiv();
  assert.equal(progress(reopened), progress(t));
  assert.equal(reopened.app.studyMinutesOn(day), a.studyMinutesOn(day));
  cases++;
}
// Informativo twins and linked judgments form one coverage graph, without auto-only cycles.
{
  const t = load(); const a = t.app;
  const info = a.INFOS.find(i => i.pids && i.pids.length);
  a.SET('inf:' + info.id, 1); a.syncEquiv();
  info.pids.forEach(pid => assert.equal(a.G('jur:' + pid), 'auto'));
  assert.equal(a.studyMinutesOn(day), info.min);
  a.SET('inf:' + info.id, null); a.syncEquiv();
  info.pids.forEach(pid => assert.equal(a.G('jur:' + pid), null));
  assert.equal(a.G('inf:' + info.id), null);
  cases++;
}
// Reproduce three subject aliases of ADPF 347 relocated to September 10.
{
  const t = load(); const a = t.app; const key = 'jur:juris:STF:ADPF:347';
  assert.equal(a.DATA.juris.filter(j => 'jur:' + j.pid === key).length, 3);
  a.SET('mvu:' + key, '2026-09-10');
  const units = a.unitsOn('2026-09-10');
  const matches = units.filter(u => u.key === key);
  assert.equal(matches.length, 1, 'one judgment is one task in the daily agenda');
  for (const mat of ['Constitucional', 'Proc. Civil', 'Direitos Humanos'])
    assert(matches[0].jurisMats.includes(mat), 'subject association remains available: ' + mat);
  assert.equal(new Set(matches[0].jurisMats).size, matches[0].jurisMats.length);
  const before = a.dayLoad('2026-09-10');
  a.SET(key, 1); a.syncEquiv();
  assert.equal(before - a.dayLoad('2026-09-10'), 10, 'daily load subtracts the judgment only once');
  assert.equal(a.studyMinutesOn(day), 10);
  a.SET(key, null); a.syncEquiv();
  assert.equal(a.unitsOn('2026-09-10').filter(u => u.key === key).length, 1);
  assert.equal(a.dayLoad('2026-09-10'), before);
  cases++;
}
console.log(JSON.stringify({ cases, status: 'ok', suite: 'equivalence-and-duplicate-judgments' }));
