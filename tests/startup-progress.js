const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, catalogUnits, progressSummary, jurisSemBloco, jkey, unitDone, unitsOn, minRestante, coreStudyMinutesOn, qdCard, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const DAY = '2026-09-08';
const now = new Date(DAY + 'T12:00:00').getTime();
const old = now - 86400000;
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
const progress = t => {
  t.app.syncEquiv(); t.app.updateStats();
  const summary = t.app.progressSummary();
  assert.equal(t.nodes.get('stDone').textContent, String(summary.done), 'headline is completed blocks, not a misleading fraction of the whole library');
  assert.equal(summary.done, summary.manual + summary.group + summary.equivalent);
  assert.equal(summary.total, summary.done + summary.pending);
  return [summary.done, summary.total];
};
let cases = 0;

async function main() {
  {
    const t=loadApp({'profile:120-weekdays:v1':[1,now]});
    const a=t.app;
    const civil=a.allBlocks.filter(b=>b.mat==='Civil').flatMap(b=>a.unitsOf(b)).find(u=>u.key.startsWith('eb:'));
    assert(civil);
    a.SET(civil.key,1);
    const note=a.qdCard(DAY).innerHTML.match(/<div class="note"[^>]*>([\s\S]*?)<\/div>/)[1];
    assert(note.includes('estudou nesta data'));
    assert(note.includes('Civil'));
    assert(!note.includes('Proc. Civil'), 'a sugestão não fica presa à matéria do calendário antigo');
    cases++;
  }
  {
    const t = loadApp({'profile:120-weekdays:v1':[1,now]});
    const a = t.app;
    const original = a.allBlocks.filter(b => !b.opt).flatMap(b => a.unitsOf(b));
    const originalKeys = new Set(original.map(u => u.key));
    const twinIds = new Set(Object.keys(a.DATA.infgem || {}).concat(Object.values(a.DATA.infgem || {}).flat()));
    const extra = a.INFOS.find(o => !originalKeys.has('inf:' + o.id) && !o.pids?.length && !twinIds.has(o.id));
    assert(extra);
    const before = progress(t);
    a.SET('inf:' + extra.id, 1);
    assert.equal(progress(t)[0], before[0] + 1, 'informativo fora das 12 fatias avança um bloco');
    a.SET('inf:' + extra.id, null);
    assert.deepEqual(progress(t), before, 'desmarcar desfaz o bloco, sem alterar o denominador');
    const expected = new Set(originalKeys);
    a.allBlocks.filter(b => b.opt).flatMap(b => a.unitsOf(b)).forEach(u => expected.add(u.key));
    Object.values(a.EBK).forEach(b => b.caps.forEach(c => expected.add(`eb:${b.k}:${c.n}`)));
    a.DATA.cursos.forEach(c => c.aulas.forEach(v => expected.add(`au:${c.curso}:${v.n}`)));
    a.DATA.juris.forEach((j, i) => expected.add(a.jkey(i)));
    a.INFOS.forEach(o => expected.add('inf:' + o.id));
    a.jurisSemBloco().forEach(o => expected.add(a.jkey(o.i)));
    assert.equal(before[1], expected.size, 'each catalog key counts once, including chapters/videos outside the old calendar and all informativos');
    a.SET('eb:civil-gerais:2', 1);
    a.syncEquiv();
    const completed = new Set([...expected].filter(key => [1, 'done', 'auto', 'grupo', 'done-auto'].includes(a.G(key))));
    assert(completed.size >= 2, 'original e equivalente continuam sendo blocos distintos');
    assert.equal(progress(t)[0], completed.size, 'capítulos repetidos em mais de uma data não duplicam progresso');
    cases++;
  }

  {
    let release;
    const calls = [];
    const t = loadApp({}, {token:'test-only', localMode:false, fetch:(_, options) => {
      calls.push(options.method);
      return new Promise(resolve => { release = resolve; });
    }});
    const a = t.app;
    assert.deepEqual(calls, ['GET']);
    assert.equal(a.G('profile:90-weekdays:v1'), null);
    assert.equal(a.G('profile:120-weekdays:v1'), null);
    assert(!Object.keys(a.S.kv).some(k => k.startsWith('mvu:')), 'nenhuma data criada antes da nuvem');
    const remoteKey = 'inf:' + a.INFOS[0].id;
    const localKey = 'inf:' + a.INFOS.at(-1).id;
    a.SET(localKey, 1);
    const localCompletion = JSON.stringify(a.S.kv[localKey]);
    await a.push();
    assert.deepEqual(calls, ['GET'], 'POST não atropela a primeira leitura');
    const remotePlan = JSON.stringify({generatedAt:old, cap:120, days:['2026-10-01'], fila:[], library:[]});
    const remote = {
      'profile:90-weekdays:v1':[1,old], 'profile:120-weekdays:v1':[1,old], 'cfg:cap':[120,old],
      'planner:details':[remotePlan,old],
      [remoteKey]:[1,old], ['mvu:' + remoteKey]:['2026-10-01',old]
    };
    release({ok:true, status:200, json:async () => ({kv:remote})});
    await flush();
    assert.equal(a.G('planner:details'), remotePlan, 'plano remoto já migrado não é regenerado');
    assert.equal(JSON.stringify(a.S.kv['mvu:' + remoteKey]), JSON.stringify(remote['mvu:' + remoteKey]));
    assert.equal(JSON.stringify(a.S.kv[remoteKey]), JSON.stringify(remote[remoteKey]));
    assert.equal(JSON.stringify(a.S.kv[localKey]), localCompletion, 'conclusão feita offline sobrevive ao merge');
    cases++;
  }

  {
    let release;
    const t = loadApp({}, {token:'test-only', localMode:false, fetch:() => new Promise(resolve => { release=resolve; })});
    const a = t.app;
    const key = 'inf:' + a.INFOS[0].id;
    release({ok:true, status:200, json:async () => ({kv:{
      'cfg:cap':[300,old], [key]:[1,now], ['mvu:' + key]:['2026-10-01',old],
      ['study:' + key]:[JSON.stringify({min:a.INFOS[0].min}),now]
    }})});
    await flush();
    assert.equal(a.G('profile:90-weekdays:v1'), 1, 'perfil antigo só migra depois da nuvem');
    assert.equal(a.G('profile:120-weekdays:v1'), 1, 'the newly authorized 120-minute migration waits for the cloud too');
    assert.equal(a.G('profile:previous-cap'), 300);
    assert.equal(a.G('cfg:cap'), 120);
    const backup = JSON.parse(t.storage.get('enam-backup-before-120-v1'));
    assert.equal(backup.kv['cfg:cap'][0], 300, 'recoverable local backup precedes the profile change');
    assert.deepEqual(backup.kv[key], [1, now]);
    assert.equal(a.G('mvu:' + key), '2026-10-01', 'atividade concluída não recebe outra data');
    assert.equal(a.S.kv[key][1], now, 'carimbo real de conclusão é preservado');
    const load = a.unitsOn(DAY).filter(u => !a.unitDone(u)).reduce((n,u) => n+a.minRestante(u),0);
    const plan = JSON.parse(a.G('planner:details'));
    const maximum = plan.extensions.some(x => x.day === DAY) ? 135 : 120;
    assert(load + a.coreStudyMinutesOn(DAY) <= maximum, 'migration includes completed minutes just loaded from cloud; any extra needs its recorded pedagogical explanation');
    cases++;
  }

  {
    const calls = [];
    const t = loadApp({}, {token:'test-only', localMode:false, fetch:async(_, options) => { calls.push(options.method); throw Error('offline'); }});
    await flush();
    assert.equal(t.app.G('profile:90-weekdays:v1'), null, 'falha de rede não carimba migração');
    assert.equal(t.app.G('profile:120-weekdays:v1'), null);
    assert.equal(t.storage.get('enam-backup-before-120-v1'), undefined, 'a failed first sync does not back up a fake empty remote profile');
    assert(!Object.keys(t.app.S.kv).some(k => k.startsWith('mvu:')));
    const key='inf:' + t.app.INFOS[0].id;
    t.app.SET(key,1);
    const saved=JSON.stringify(t.app.S.kv[key]);
    await t.app.push();
    assert.deepEqual(calls,['GET'], 'offline não envia substituição de estado');
    assert.equal(JSON.stringify(t.app.S.kv[key]),saved, 'conclusão local permanece salva');
    cases++;
  }

  {
    const t=loadApp({}, {localMode:false});
    assert.equal(t.app.G('profile:90-weekdays:v1'),null, 'primeiro uso aguarda escolha de sincronização');
    assert.equal(t.app.G('profile:120-weekdays:v1'),null);
    t.nodes.get('tokenSkip').click();
    assert.equal(t.app.G('profile:90-weekdays:v1'),1, 'escolha explícita de uso local permite preparar o plano');
    assert.equal(t.app.G('profile:120-weekdays:v1'),1);
    assert.equal(t.storage.get('enam-local-mode'),'1');
    cases++;
  }
  console.log(JSON.stringify({status:'ok', cases, suite:'startup-sync-and-complete-progress'}));
}
main().catch(error => { console.error(error); process.exitCode=1; });
