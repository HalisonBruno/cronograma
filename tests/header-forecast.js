const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
// Run the actual delayed callbacks with the Progress panel absent, as on Home.
const harness=fs.readFileSync(path.join(__dirname,'study-minutes.js'),'utf8').split('async function main()')[0]
  .replace('const nodes = new Map();','const nodes = new Map(); const timers=new Map(); let timerId=0;')
  .replace('getElementById(id) {','getElementById(id) { if(id === "completionForecast") return null;')
  .replace('setTimeout: () => 1, clearTimeout() {}, queueMicrotask,','setTimeout: fn => { const id=++timerId; timers.set(id,fn); return id; }, clearTimeout: id => timers.delete(id), queueMicrotask,')
  .replace('updateStats, unitCard,','refreshStudyDate, scheduleCompletionForecast, forecastFingerprint, forecastCache, updateStats, unitCard,')
  .replace('return { app: context.app, nodes, storage, document };','return { app: context.app, nodes, storage, document, timers, setClock: value => { clock=value; } };');
const {loadApp}=new Function('require','__dirname',harness+';return {loadApp};')(require,__dirname);
const at=d=>new Date(d+'T12:00:00').getTime();
async function drain(t){
  for(let n=0;n<30;n++){
    await Promise.resolve();
    if(!t.timers.size){await Promise.resolve();if(!t.timers.size)return;}
    const [id,fn]=t.timers.entries().next().value;t.timers.delete(id);fn();
  }
  throw Error('Forecast timer did not settle');
}
async function main(){
  const t=loadApp({'profile:120-weekdays:v1':[1,at('2026-09-08')]});const a=t.app;
  a.allBlocks.splice(0);a.INFOS.splice(0);a.DATA.juris.splice(0);a.DATA.ebooks.splice(0);a.DATA.cursos.splice(0);
  Object.keys(a.EBK).forEach(k=>delete a.EBK[k]);a.DATA.infgem={};a.S.kv={};t.timers.clear();
  for(const id of ['one','two','three'])a.S.kv['ext:'+id]=[JSON.stringify({id,t:id,min:120,tipo:'REV',mat:'Teste',nuc:true}),at('2026-09-08')];
  a.updateStats();
  const queued=t.timers.size;a.updateStats();assert.equal(t.timers.size,queued,'re-rendering does not duplicate an in-flight forecast');
  await drain(t);
  assert.equal(t.nodes.get('stDone').textContent,'0 / 3');
  assert.equal(t.nodes.get('stEnd').textContent,'10/09/2026','Home forecasts without opening Progress');
  assert.equal(a.G('forecast:baseline:v1'),null,'Home does not replace the Progress comparison baseline');

  a.SET('xdone:one',1,{minutes:120});a.SET('xdone:two',1,{minutes:120});await drain(t);
  assert.equal(t.nodes.get('stDone').textContent,'2 / 3');
  assert.equal(t.nodes.get('stEnd').textContent,'09/09/2026','anticipating work updates the header immediately');
  a.SET('xdone:one',null);a.SET('xdone:two',null);await drain(t);
  assert.equal(t.nodes.get('stDone').textContent,'0 / 3');assert.equal(t.nodes.get('stEnd').textContent,'10/09/2026');

  t.setClock(at('2026-09-09'));a.refreshStudyDate();await drain(t);
  assert.equal(t.nodes.get('stEnd').textContent,'11/09/2026','missed weekday moves the date even with no network token');
  assert.equal(t.nodes.get('stDone').textContent,'0 / 3','passage of time never alters completed or total blocks');
  assert(!Object.keys(a.S.kv).some(k=>k.startsWith('mvu:')||k==='cfg:plan-end'),'forecast does not reschedule the actual agenda');
  console.log(JSON.stringify({status:'ok',cases:4,suite:'live-header-forecast'}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
