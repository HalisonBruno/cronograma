const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Run the production scheduler and Home renderer in the established isolated
// browser harness. No real progress or curriculum fixture is rewritten.
const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('studyMinutesOn, SET, G, S, unitsOf, allBlocks, INFOS, DATA, LG, EBK,',
    'studyMinutesOn, SET, G, S, unitsOf, allBlocks, INFOS, DATA, LG, EBK, CALENDAR, planRegen, applyRegen, undoRegen, planningUnits, unitsOn, unitDate, unitDone, minRestante, capMin, isStudyDay, coreStudyMinutesOn, vHoje, setNucleo: value => { nucleoOnly = value; },');
const {loadApp, setClock} = new Function('require', '__dirname', harness + '\nreturn {loadApp, setClock: value => { clock = value; }};')(require, __dirname);
const DAY = '2026-09-08';
const at = d => new Date(d + 'T12:00:00').getTime();
const pendingOn = (a, d) => a.unitsOn(d).filter(u => !a.unitDone(u));
const assignment = (a, keys) => JSON.stringify(keys.map(k => [k, a.G('mvu:' + k)]));
let cases = 0;

function isolated() {
  setClock(at(DAY));
  const result = loadApp({'profile:90-weekdays:v1': [1, at(DAY)], 'cfg:cap': [90, at(DAY)]});
  const a = result.app;
  // A finished curriculum leaves a controlled set of pending extra tasks. This
  // specifically exercises the phase after the informativo reserve is finished.
  for (const u of a.planningUnits()) {
    a.S.kv[u.key] = [u.key.startsWith('st:') ? 'done' : 1, at(DAY)];
    // Imported legacy completions without duration snapshots trigger expensive
    // estimates for the full curriculum; this fixture is not testing estimates.
    a.S.kv['study:' + u.key] = [JSON.stringify({min:0}), at(DAY)];
  }
  a.syncEquiv();
  return result;
}
function extra(a, id, day, min = 10, done = false) {
  const key = 'xdone:' + id;
  a.S.kv['ext:' + id] = [JSON.stringify({mat:'Extra', tipo:'REV', min, t:'Task ' + id, day}), at(DAY)];
  a.S.kv['mvu:' + key] = [day, at(DAY)];
  if (done) a.S.kv[key] = [1, at(DAY)];
  return key;
}
function assertFuture(a, days, expectDaily) {
  for (const d of days) {
    const pending = pendingOn(a, d);
    const minutes=pending.reduce((sum,u)=>sum+a.minRestante(u),0);
    const extensions=JSON.parse(a.G('planner:details')||'{}').extensions||[];
    assert(minutes <= a.capMin() + (extensions.some(x=>x.day===d)?15:0), d + ': real Home respects base120 and documented pedagogical margin');
    if (expectDaily) assert(pending.length > 0, d + ': pending work, not just already-completed cards');
  }
  for (const d of a.CALENDAR.map(x => x.d).filter(d => d > DAY && !a.isStudyDay(d))) {
    assert.equal(pendingOn(a, d).length, 0, d + ': weekends remain free');
  }
}

// All future dates are disposable; today's pending tasks and completed cards
// keep their dates. First-fit must not pack 180 tasks into only the first weeks.
{
  const {app:a, document} = isolated();
  const curriculum = JSON.stringify(a.DATA);
  const todayKey = extra(a, 'today-preserved', DAY, 25);
  const completedKey = extra(a, 'completed-future', '2026-10-01', 10, true);
  const completion = JSON.stringify(a.S.kv[completedKey]);
  const dates = assignment(a, [todayKey, completedKey]);
  for (let i = 0; i < 180; i++) extra(a, 'spread-' + i, i % 2 ? '2027-04-16' : '2026-09-12');
  const overdueKey = extra(a, 'overdue', '2026-09-07');
  const plan = a.planRegen();
  assert(plan.days.length > 100 && plan.days.every(d => d > DAY && a.isStudyDay(d)));
  assert(!plan.moves.some(m => m.key === todayKey), 'reorganizing tomorrow does not move today');
  assert(plan.moves.some(m => m.key === overdueKey), 'overdue work is rescued into the future');
  assert(plan.days.every(d => plan.moves.some(m => m.to === d)), 'enough eligible tasks fill every future weekday');
  a.applyRegen(plan);
  assert.equal(a.G('mvu:' + todayKey), DAY, 'today is preserved');
  assert(a.G('mvu:' + completedKey) <= DAY, 'completed future item moves back to its completion day (never a future day)');
  assert.equal(JSON.stringify(a.S.kv[completedKey]), completion);
  assertFuture(a, plan.days, true);
  assert.equal(JSON.stringify(a.DATA), curriculum, 'curriculum and researched priorities are unchanged');
  cases++;

  // The library's core-only filter may not hide an explicitly scheduled task.
  const m = plan.moves.find(m => m.key.startsWith('xdone:spread-'));
  a.setFocusDate(m.to);
  a.setNucleo(true);
  const root = document.createElement('div');
  a.vHoje(root);
  assert(root.children.some(child => child.className === 'card' && child.innerHTML.includes('Task ' + m.key.slice(6))),
    'Home displays pending dated task even when library core-only filter is enabled');
  cases++;

  const before = a.planRegen();
  a.S.kv['qd:' + DAY + ':regression'] = [JSON.stringify({mat:'Extra', banca:'FGV', n:90, ac:60}), at(DAY)];
  const after = a.planRegen();
  assert.equal(JSON.stringify(after.moves), JSON.stringify(before.moves), 'questions outside the budget do not consume future capacity');
  assertFuture(a, after.days, true);
  cases++;
}

// Completing every task of a future date (including equivalence coverage) must
// release the date for still-pending material, without moving completed history.
{
  setClock(at(DAY));
  const {app:a} = loadApp();
  const first = a.planRegen();
  a.applyRegen(first);
  const date = first.days.find(d => d >= '2026-10-01');
  const doneKeys = pendingOn(a, date).map(u => u.key);
  assert(doneKeys.length > 0);
  for (const key of doneKeys) a.S.kv[key] = [key.startsWith('st:') ? 'done' : 1, at(DAY)];
  const twin = Object.entries(a.DATA.infgem || {}).find(([id, siblings]) => siblings.length && !a.G('inf:' + id));
  assert(twin, 'real informativo equivalence is available');
  a.S.kv['inf:' + twin[0]] = [1, at(DAY)];
  const dates = assignment(a, doneKeys);
  const manual = JSON.stringify(doneKeys.map(key => a.S.kv[key]));
  // No explicit reconciliation: pressing reorganize must do it synchronously.
  const rebuilt = a.planRegen();
  assert(!rebuilt.moves.some(m => doneKeys.includes(m.key)));
  for (const id of [twin[0], ...twin[1]]) assert(!rebuilt.moves.some(m => m.key === 'inf:' + id), 'equivalent informativo is not assigned again');
  a.applyRegen(rebuilt);
  for (const key of doneKeys) assert.equal(a.G('mvu:' + key), DAY, 'completed future work is recorded on its completion day, not left in the future');
  assert.equal(JSON.stringify(doneKeys.map(key => a.S.kv[key])), manual);
  assert(pendingOn(a, date).length > 0, 'the fully anticipated date gets new pending tasks');
  assertFuture(a, rebuilt.days, true);
  cases++;
}

// A preview is not a lock: activity may be completed or synchronized while open.
{
  const {app:a} = isolated();
  for (let i = 0; i < 180; i++) extra(a, 'race-' + i, '2027-04-16');
  const preview = a.planRegen();
  const targetDate = preview.days.find(d => preview.moves.filter(m => m.to === d).length === 1);
  assert(targetDate, 'balanced preview has a one-task date for the race regression');
  const completed = preview.moves.find(m => m.to === targetDate);
  a.S.kv[completed.key] = [1, at(DAY)];
  const stamp = JSON.stringify(a.S.kv[completed.key]);
  const oldDate = a.G('mvu:' + completed.key);
  a.applyRegen(preview);
  assert(pendingOn(a, targetDate).length > 0, 'apply refreshes stale preview rather than leaving a one-task date empty');
  assert.equal(JSON.stringify(a.S.kv[completed.key]), stamp);
  assert.equal(a.G('mvu:' + completed.key), DAY, 'activity completed while the preview was open is recorded on its completion day, never left in a future day');
  assert.notEqual(a.G('mvu:' + completed.key), oldDate);
  assertFuture(a, preview.days, true);
  a.undoRegen();
  assert.equal(JSON.stringify(a.S.kv[completed.key]), stamp, 'undo does not undo actual study');
  assert.equal(a.G('mvu:xdone:race-0'), '2027-04-16', 'undo restores pending assignments from before apply');
  cases++;
}

// If there are fewer tasks than remaining days, finish at the start of the
// window. No fake repetition, duplicate task, weekend task, or internal gap.
{
  const {app:a} = isolated();
  const keys = [extra(a, 'last-a', '2027-04-16'), extra(a, 'last-b', '2027-04-16')];
  const plan = a.planRegen();
  assert.equal(plan.moves.length, 2);
  assert.equal(new Set(plan.moves.map(m => m.key)).size, 2);
  assert.deepEqual([...plan.moves.map(m => m.to).sort()], [...plan.days.slice(0, 2)]);
  a.applyRegen(plan);
  assert.equal(plan.days.flatMap(d => pendingOn(a, d)).length, keys.length);
  cases++;
}

// A preview left open overnight must honor the new current day when applied.
{
  const {app:a} = isolated();
  for (let i = 0; i < 180; i++) extra(a, 'overnight-' + i, '2027-04-16');
  const preview = a.planRegen();
  setClock(at('2026-09-09'));
  a.applyRegen(preview);
  assert.equal(pendingOn(a, '2026-09-09').length, 0, 'stale preview cannot begin on the new today');
  assert(pendingOn(a, '2026-09-10').length > 0, 'new tomorrow begins the rebuilt plan');
  cases++;
}

// A short study simulation is not a dated exam event. Its old April date must
// not survive a complete rebuild when tomorrow has capacity.
{
  const {app:a} = isolated();
  const key = extra(a, 'short-simulation', '2027-04-16', 30);
  const record = JSON.parse(a.G('ext:short-simulation'));
  record.tipo = 'SIM';
  a.S.kv['ext:short-simulation'] = [JSON.stringify(record), at(DAY)];
  const plan = a.planRegen();
  assert.equal(plan.moves.length, 1);
  assert.equal(plan.moves[0].key, key);
  assert.equal(plan.moves[0].to, plan.days[0], 'short simulation is rebuilt from the first available weekday');
  cases++;
}

console.log(JSON.stringify({status:'ok', cases, scope:'reorganize future, daily pending work, preview races, equivalence, Home filter'}));
