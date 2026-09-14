const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Read-only, isolated browser harness: no real token, progress or network.
const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('studyMinutesOn, SET, G, S, unitsOf, allBlocks, INFOS, DATA, LG, EBK,',
    'studyMinutesOn, SET, G, S, unitsOf, allBlocks, INFOS, DATA, LG, EBK, catalogUnits, progressSummary, progressoPorMateria, MATLIST, MATJURIS, jkey,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const {app:a, nodes} = loadApp({}, {localMode:false});
const stamp = new Date('2026-09-08T12:00:00').getTime();
const set = (k, v) => { a.S.kv[k] = [v, stamp]; };
const reset = () => { a.S.kv = {}; };
let cases = 0;

// Every visible source material has exactly one canonical catalog entry even
// when it was never selected for the old schedule.
const catalog = a.catalogUnits();
const keys = new Set(catalog.map(u => u.key));
assert.equal(catalog.length, keys.size);
for (const bk of Object.values(a.EBK)) for (const c of bk.caps) assert(keys.has(`eb:${bk.k}:${c.n}`));
for (const c of a.DATA.cursos) for (const lesson of c.aulas) assert(keys.has(`au:${c.curso}:${lesson.n}`));
for (const info of a.INFOS) assert(keys.has(`inf:${info.id}`));
for (let i = 0; i < a.DATA.juris.length; i++) assert(keys.has(a.jkey(i)));
assert(!catalog.some(u => u.b.tipo === 'QUEST'));
cases++;

const plannedKeys = new Set(a.allBlocks.filter(b => !b.opt).flatMap(b => a.unitsOf(b)).map(u => u.key));
const unplannedChapter = catalog.find(u => u.key.startsWith('eb:') && !plannedKeys.has(u.key));
assert(unplannedChapter, 'fixture has chapter absent from the previous counter');
set(unplannedChapter.key, 1);
let summary = a.progressSummary();
assert.equal(summary.manual, 1);
assert.equal(summary.done, 1);
a.updateStats();
assert.equal(nodes.get('stDone').textContent, '1 / '+summary.total, 'main counter shows completed blocks and the full catalog total');
assert(nodes.get('stCatalog').innerHTML.includes('Não significa'));
assert(nodes.get('stOrigins').textContent.includes('1 marcados por você'));
cases++;

reset();
const allCounts = new Map();
for (const b of a.allBlocks) for (const u of a.unitsOf(b)) allCounts.set(u.key, (allCounts.get(u.key) || 0) + 1);
const duplicate = [...allCounts].find(([k, count]) => k.startsWith('eb:') && count > 1);
assert(duplicate, 'real repeated chapter fixture');
set(duplicate[0], 1);
assert.equal(a.catalogUnits().filter(u => u.key === duplicate[0]).length, 1);
assert.equal(a.progressSummary().done, 1, 'same material on multiple original dates counts once');
cases++;

reset();
const chapter = catalog.find(u => u.key.startsWith('eb:'));
const lecture = catalog.find(u => u.key.startsWith('au:'));
set(chapter.key, 1);
set(lecture.key, 'auto');
set('study:' + chapter.key, JSON.stringify({min:19}));
summary = a.progressSummary();
assert.equal(summary.done, 2);
assert.equal(summary.manual, 1);
assert.equal(summary.equivalent, 1);
assert.equal(a.studyMinutesOn('2026-09-08'), 19, 'equivalent block advances coverage but never duplicates minutes');
cases++;

reset();
const grouped = a.allBlocks.find(b => b.tipo === 'LEI' && a.unitsOf(b).length > 1);
const child = a.unitsOf(grouped)[0];
set('st:' + grouped.id, 'done-auto');
assert.equal(a.progressSummary().done, 0, 'a stale automatic parent cannot fabricate child completion');
set(child.key, 'grupo');
summary = a.progressSummary();
assert.equal(summary.done, 1);
assert.equal(summary.group, 1);
assert.equal(summary.manual + summary.group + summary.equivalent, summary.done);
cases++;

reset();
const beforeReview = a.progressSummary().total;
set('mvu:rv:' + chapter.key + ':3', '2026-09-09');
assert.equal(a.progressSummary().total, beforeReview, 'an orphaned review date does not invent a catalog block');
set('rv:' + chapter.key + ':3', 1);
summary = a.progressSummary();
assert.equal(summary.total, beforeReview + 1);
assert.equal(summary.done, 1, 'completed dynamic review remains counted after it leaves revPend');
assert.equal(a.catalogUnits().filter(u => u.key === 'rv:' + chapter.key + ':3').length, 1);
set('rv:eb:unknown-book:900:3', 1);
assert.equal(a.progressSummary().total, beforeReview + 1, 'unknown obsolete keys do not invent catalog blocks');
cases++;

reset();
const before = a.progressSummary();
const fixtures = [['dated','2026-09-09'],['overdue','2026-09-07'],['queue','fila'],['alternative','biblioteca'],['undated','']];
for (const [id, date] of fixtures) {
  set('ext:catalog-' + id, JSON.stringify({mat:'Extra', tipo:'REV', min:10, t:id}));
  if (date) set('mvu:xdone:catalog-' + id, date);
}
summary = a.progressSummary();
assert.equal(summary.scheduledPending, before.scheduledPending + 1);
assert.equal(summary.overduePending, before.overduePending + 1);
assert.equal(summary.queuedPending, before.queuedPending + 1);
assert.equal(summary.alternativePending, before.alternativePending + 1);
assert.equal(summary.undatedPending, before.undatedPending + 1);
assert.equal(summary.pending, summary.scheduledPending + summary.overduePending + summary.queuedPending + summary.alternativePending + summary.undatedPending + summary.optionalPending);
set('xdone:catalog-dated', 1);
assert.equal(a.progressSummary().scheduledPending, before.scheduledPending, 'completed anticipated activity stops consuming pending-date count');
cases++;

const totalBeforeMove = a.progressSummary().total;
set('mvu:xdone:catalog-queue', '2026-09-10');
set('mvu:xdone:catalog-alternative', '2026-10-01');
set('mvu:' + unplannedChapter.key, '2026-11-02');
assert.equal(a.progressSummary().total, totalBeforeMove, 'rearranging dates does not grow the acervo');
cases++;

reset();
set(unplannedChapter.key, 1);
let subjects = a.progressoPorMateria();
assert.equal(subjects[unplannedChapter.b.mat].dn, 1, 'subject progress includes the same previously omitted chapter as the header');
reset();
const subjectName = mat => a.MATLIST.includes(mat) ? mat : a.MATLIST.find(m => (a.MATJURIS[m] || []).includes(mat)) || mat;
const shared = a.catalogUnits().find(u => u.key.startsWith('jur:') && new Set(u.subjects.map(subjectName)).size > 1);
assert(shared, 'real judgment has aliases in more than one subject');
set(shared.key, 1);
subjects = a.progressoPorMateria();
for (const mat of new Set(shared.subjects.map(subjectName))) assert.equal(subjects[mat].dn, 1);
assert.equal(a.progressSummary().done, 1, 'subject aliases do not inflate the global counter');
cases++;

console.log(`progress-catalog: ${cases} cases passed`);
