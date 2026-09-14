const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
// Run the actual delayed callbacks with the Progress panel absent, as on Home.
const harness=fs.readFileSync(path.join(__dirname,'study-minutes.js'),'utf8').split('async function main()')[0]
  .replace('const nodes = new Map();','const nodes = new Map(); const timers=new Map(); let timerId=0;')
  .replace('getElementById(id) {','getElementById(id) { if(id === "completionForecast") return null;')
  .replace('setTimeout: () => 1, clearTimeout() {}, queueMicrotask,','setTimeout: fn => { const id=++timerId; timers.set(id,fn); return id; }, clearTimeout: id => timers.delete(id), queueMicrotask,')
  .replace('updateStats, unitCard,','refreshStudyDate, scheduleCompletionForecast, forecastFingerprint, forecastCache, setNucleoOnly: value => { nucleoOnly=value; updateStats(); }, updateStats, unitCard,')
  .replace('return { app: context.app, nodes, storage, document };','return { app: context.app, nodes, storage, document, timers, setClock: value => { clock=value; } };');
const {loadApp}=new Function('require','__dirname',harness+';return {loadApp};')(require,__dirname);
const at=d=>new Date(d+'T12:00:00').getTime();
async function step(t){
  await Promise.resolve();
  assert(t.timers.size,'a delayed forecast callback must be queued');
  const [id,fn]=t.timers.entries().next().value;t.timers.delete(id);fn();
}
async function drain(t,afterEach=()=>{}){
  for(let n=0;n<30;n++){
    await Promise.resolve();
    if(!t.timers.size){await Promise.resolve();if(!t.timers.size)return;}
    await step(t);afterEach();
  }
  throw Error('Forecast timer did not settle');
}
async function main(){
  const t=loadApp({'profile:120-weekdays:v1':[1,at('2026-09-08')]});const a=t.app;
  a.allBlocks.splice(0);a.INFOS.splice(0);a.DATA.juris.splice(0);a.DATA.ebooks.splice(0);a.DATA.cursos.splice(0);
  Object.keys(a.EBK).forEach(k=>delete a.EBK[k]);a.DATA.infgem={};a.S.kv={};t.timers.clear();
  for(const id of ['one','two','three'])a.S.kv['ext:'+id]=[JSON.stringify({id,t:id,min:120,tipo:'REV',mat:'Teste',nuc:id!=='three'}),at('2026-09-08')];
  a.updateStats();
  const queued=t.timers.size;a.updateStats();assert.equal(t.timers.size,queued,'re-rendering does not duplicate an in-flight forecast');
  a.setNucleoOnly(true);
  await step(t);
  assert.notEqual(t.nodes.get('stEnd').textContent,'10/09/2026','the completed all-catalog phase stays hidden while the core phase is pending');
  a.setNucleoOnly(false);
  assert.equal(t.nodes.get('stEnd').textContent,'10/09/2026','the pending snapshot already contains a usable all-catalog forecast');
  a.setNucleoOnly(true);
  assert.notEqual(t.nodes.get('stEnd').textContent,'10/09/2026','switching during the core phase never mislabels an all-catalog date as core');
  await drain(t,()=>assert.notEqual(t.nodes.get('stEnd').textContent,'10/09/2026','an in-flight all-catalog calculation must never appear while core is selected'));
  assert.equal(t.nodes.get('stDone').textContent,'0 / 3','core selection never changes the all-catalog block counter');
  assert.equal(t.nodes.get('stEnd').textContent,'09/09/2026','cold Home calculation uses only the selected core');
  assert.equal(t.nodes.get('stEndLabel').textContent,'conclusão do núcleo');
  assert.match(t.nodes.get('stEnd').title,/somente o núcleo/);
  a.setNucleoOnly(false);
  assert.equal(t.nodes.get('stDone').textContent,'0 / 3');
  assert.equal(t.nodes.get('stEnd').textContent,'10/09/2026','switching back restores all-catalog prediction immediately without opening Progress');
  assert.equal(t.nodes.get('stEndLabel').textContent,'conclusão do acervo');
  assert.match(t.nodes.get('stEnd').title,/todo o acervo/);
  assert.equal(t.timers.size,0,'switching scope reuses both cached forecasts');
  assert.equal(a.G('forecast:baseline:v1'),null,'Home does not replace the Progress comparison baseline');

  a.scheduleCompletionForecast(true);await step(t);
  a.setNucleoOnly(true);
  assert.equal(t.nodes.get('stEnd').textContent,'09/09/2026','switching after the all-catalog phase immediately restores the cached core date');
  await drain(t,()=>assert.equal(t.nodes.get('stEnd').textContent,'09/09/2026','finishing a delayed calculation respects the current scope'));
  a.setNucleoOnly(false);
  assert.equal(t.nodes.get('stEnd').textContent,'10/09/2026');

  a.SET('xdone:one',1,{minutes:120});a.SET('xdone:two',1,{minutes:120});await drain(t);
  assert.equal(t.nodes.get('stDone').textContent,'2 / 3');
  assert.equal(t.nodes.get('stEnd').textContent,'09/09/2026','anticipating work updates the header immediately');
  a.setNucleoOnly(true);
  assert.equal(t.nodes.get('stEnd').textContent,'Concluído','the core is finished while the remaining optional block is still pending');
  assert.equal(t.nodes.get('stDone').textContent,'2 / 3','completed core still shows every block in the counter');
  a.SET('xdone:one',null);a.SET('xdone:two',null);await drain(t);
  assert.equal(t.nodes.get('stDone').textContent,'0 / 3');assert.equal(t.nodes.get('stEnd').textContent,'09/09/2026','undoing study restores the core forecast while the filter stays active');

  t.setClock(at('2026-09-09'));a.refreshStudyDate();await drain(t);
  assert.equal(t.nodes.get('stEnd').textContent,'10/09/2026','missed weekday moves the core date even with no network token');
  assert.equal(t.nodes.get('stDone').textContent,'0 / 3','passage of time never alters completed or total blocks');
  a.setNucleoOnly(false);
  assert.equal(t.nodes.get('stEnd').textContent,'11/09/2026','all-catalog date is also refreshed after the missed weekday');
  assert(!Object.keys(a.S.kv).some(k=>k.startsWith('mvu:')||k==='cfg:plan-end'),'forecast does not reschedule the actual agenda');
  console.log(JSON.stringify({status:'ok',cases:8,suite:'live-header-forecast'}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
