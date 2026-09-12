const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Reuse the DOM/storage harness; execute the actual page, never a copied planner.
const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('studyMinutesOn, SET, G, S, unitsOf, allBlocks, INFOS, DATA, LG, EBK,',
    'studyMinutesOn, SET, G, S, unitsOf, allBlocks, INFOS, DATA, LG, EBK, CALENDAR, planRegen, applyRegen, undoRegen, planningUnits, unitsOn, unitDate, unitDone, minRestante, capMin, isStudyDay, coreStudyMinutesOn, revPend, ensureStudyProfile,');
const {loadApp, setClock} = new Function('require', '__dirname', harness + '\nreturn {loadApp, setClock: value => { clock = value; }};')(require, __dirname);
const DAY = '2026-09-08';
const at = d => new Date(d + 'T12:00:00').getTime();
const {app} = loadApp({'cfg:cap': [300, at(DAY)]});
let cases = 0;
assert.equal(app.capMin(), 90);
assert.equal(app.G('cfg:cap'), 90, 'legacy profile migrated automatically');
assert.equal(app.G('profile:previous-cap'), 300);
cases++;

const dataBefore = JSON.stringify(app.DATA);
const infoCount = app.INFOS.length;
// This suite checks the full budget rebuild used by migration/settings.
// The toolbar's tomorrow-only behavior has its own regression suite.
let plan = app.planRegen({includeToday:true});
assert(plan.days.length > 100);
assert(plan.days.includes('2027-03-04'), 'missing calendar weeks restored without changing DATA');
assert(plan.days.every(app.isStudyDay));
assert(Object.values(plan.load).every(n => n <= 90));
assert.equal(plan.info.total, infoCount);
assert.equal(plan.info.scheduled, infoCount, 'all informativos have real dates within current capacity');
assert.equal(plan.info.unscheduled, 0);
assert.equal(new Set(plan.moves.map(m => m.key)).size, plan.moves.length);
assert.equal(plan.moves.filter(m => m.tipo === 'INFO').length, infoCount);
assert(plan.days.every(d => plan.moves.some(m => m.to === d && m.tipo === 'INFO')), 'continuous informativo reserve');
cases++;

const pending = app.planningUnits().filter(u => !app.unitDone(u));
const represented = [...plan.moves, ...plan.fila, ...plan.library].map(m => m.key);
assert.equal(new Set(represented).size, pending.length, 'every pending unit gets a date or an explicit reason');
assert.equal(represented.length, pending.length);
assert(plan.fila.every(m => m.reason));
assert(plan.library.every(m => m.reason));
assert(!plan.moves.some(m => m.tipo === 'QUEST'));
assert(!plan.moves.some(m => m.tipo === 'SIM' && m.min > 90));
cases++;

app.applyRegen(plan);
for (const d of app.CALENDAR.map(x => x.d).filter(d => d >= DAY)) {
  const units = app.unitsOn(d).filter(u => !app.unitDone(u));
  if (!app.isStudyDay(d)) assert.equal(units.length, 0, `weekend ${d} has no tasks`);
  assert(units.reduce((n, u) => n + app.minRestante(u), 0) + app.coreStudyMinutesOn(d) <= 90,
    `${d}: the actual Home list, not just the preview, respects the budget`);
}
cases++;

const future = plan.moves.find(m => m.to > '2026-09-15' && m.tipo === 'INFO');
assert(future);
app.SET(future.key, 1, {minutes: future.min});
app.syncEquiv();
const completion = JSON.stringify(app.S.kv[future.key]);
const oldDate = app.G('mvu:' + future.key);
const oldPlan = JSON.stringify(app.G('planner:details'));
const newPlan = app.planRegen({includeToday:true});
assert(!newPlan.moves.some(m => m.key === future.key), 'future activity already studied is not rescheduled');
assert(newPlan.moves.some(m => m.from > m.to), 'future pending activities are pulled forward into gaps');
app.applyRegen(newPlan);
assert.equal(JSON.stringify(app.S.kv[future.key]), completion, 'tick and timestamp survive apply');
assert.equal(app.G('mvu:' + future.key), oldDate, 'completed item placement stays intact');
app.undoRegen();
assert.equal(JSON.stringify(app.G('planner:details')), oldPlan, 'undo restores the previous plan');
assert.equal(JSON.stringify(app.S.kv[future.key]), completion, 'undo never erases completion');
cases++;

const beforeQuestions = app.planRegen({includeToday:true});
app.SET('qd:' + DAY + ':1', JSON.stringify({mat:'Civil', banca:'FGV', n:30, ac:20}));
const afterQuestions = app.planRegen({includeToday:true});
assert.equal(app.coreStudyMinutesOn(DAY), future.min, '60 minutes of questions remain outside 90 minutes');
assert.equal(afterQuestions.initialLoad[DAY], beforeQuestions.initialLoad[DAY]);
cases++;

assert.equal(JSON.stringify(app.DATA), dataBefore, 'no priorities, topics, dates or source data rewritten');
cases++;

// Existing future and overdue cards may be arbitrarily overloaded in legacy state.
app.SET('mvu:' + newPlan.moves[10].key, '2026-09-12');
app.SET('mvu:' + newPlan.moves[11].key, '2026-09-11');
const rebuilt = app.planRegen({includeToday:true});
assert(rebuilt.moves.every(m => app.isStudyDay(m.to)));
assert(Object.values(rebuilt.load).every(n => n <= 90));
cases++;

setClock(at('2027-04-16'));
const deadline = app.planRegen({includeToday:true});
assert(deadline.info.unscheduled > 0, 'insufficient capacity is not hidden');
assert.equal(deadline.info.scheduled + deadline.info.unscheduled, infoCount - 1);
assert(deadline.fila.filter(m => m.tipo === 'INFO').every(m => /obrigatório/.test(m.reason)));
assert(Object.values(deadline.load).every(n => n <= 90));
cases++;

console.log(JSON.stringify({status:'ok', cases, studyDays:plan.days.length, scheduledInformativos:plan.info.scheduled, maxMinutes:Math.max(...Object.values(plan.load))}));
