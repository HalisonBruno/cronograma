const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const harness=fs.readFileSync(path.join(__dirname,'study-minutes.js'),'utf8').split('async function main()')[0]
  .replace('updateStats, unitCard,','findCompletionPlan, workdayDelta, endForStudyDays, studyDaysThrough, forecastCatalogCounts, makeForecastBaseline, ensureForecastBaseline, FORECAST_BASELINE_KEY, inPlanningScope, planningUnits, planRegen, capMin, updateStats, unitCard,')
  .replace('return { app: context.app, nodes, storage, document };','return { app: context.app, nodes, storage, document, setClock: value => { clock = value; } };');
const {loadApp}=new Function('require','__dirname',harness+';return {loadApp};')(require,__dirname);
const DAY='2026-09-08',at=d=>new Date(d+'T12:00:00').getTime();let cases=0;
function empty(){
  const t=loadApp({'profile:120-weekdays:v1':[1,at(DAY)],'profile:90-weekdays:v1':[1,at(DAY)],'cfg:cap':[120,at(DAY)]});
  const a=t.app;a.allBlocks.splice(0);a.INFOS.splice(0);a.DATA.juris.splice(0);a.DATA.ebooks.splice(0);a.DATA.cursos.splice(0);Object.keys(a.EBK).forEach(k=>delete a.EBK[k]);a.DATA.infgem={};a.S.kv={};return t;
}
function extra(a,id,min,nuc=false){a.S.kv['ext:'+id]=[JSON.stringify({id,t:id,min,tipo:'REV',mat:'Teste',day:'',nuc}),at(DAY)];return 'xdone:'+id}

// Diferenças são em dias úteis, nunca em dias corridos.
{
  const {app:a}=empty();
  assert.equal(a.workdayDelta('2026-09-11','2026-09-14'),1);
  assert.equal(a.workdayDelta('2026-09-14','2026-09-11'),-1);
  assert.equal(a.endForStudyDays(2,'2026-09-11'),'2026-09-14');
  assert.equal(a.studyDaysThrough('2026-09-14','2026-09-11'),2);cases++;
}

// Núcleo é planejado separadamente e herda extras explicitamente nucleares.
{
  const {app:a}=empty();extra(a,'core',80,true);extra(a,'ordinary',80,false);
  const core=a.findCompletionPlan('nucleo','2026-09-09'),all=a.findCompletionPlan('acervo','2026-09-09');
  assert.equal(core.tasks,1);assert.equal(all.tasks,2);assert.equal(all.blocks,all.tasks+all.library);assert(core.end<=all.end);
  assert(core.plan.moves.every(m=>m.to>='2026-09-08'&&![0,6].includes(new Date(m.to+'T12:00:00').getDay())));cases++;
}

// Todo o acervo inclui também o que era opcional, sempre depois da rota comum.
{
  const {app:a}=empty();
  a.allBlocks.push({id:'required',mat:'Teste',tipo:'REV',min:120,t:'Obrigatório',day:DAY});
  a.allBlocks.push({id:'optional',mat:'Teste',tipo:'REV',min:120,t:'Opcional',day:DAY,opt:true});
  a.EBK['catalog-extra']={k:'catalog-extra',nome:'Catálogo',caps:[{n:1,t:'Só no catálogo',pi:1,pf:2}]};
  const core=a.findCompletionPlan('nucleo','2026-09-09'),all=a.findCompletionPlan('acervo','2026-09-09');
  assert.equal(core.tasks,0);assert.equal(all.tasks,3);assert.equal(all.blocks,3);
  assert.equal(all.plan.moves[0].key,'st:required');assert.deepEqual(new Set(all.plan.moves.slice(1).map(x=>x.key)),new Set(['st:optional','eb:catalog-extra:1']));cases++;
}

// Um dia útil perdido empurra um dia; estudar uma sessão extra recupera-o.
{
  const t=empty(),a=t.app,k1=extra(a,'day-one',120),k2=extra(a,'day-two',120);
  const base=a.findCompletionPlan('acervo','2026-09-09');assert.equal(base.end,'2026-09-09');
  t.setClock(at('2026-09-09'));const missed=a.findCompletionPlan('acervo',base.end);
  assert.equal(missed.end,'2026-09-10');assert.equal(a.workdayDelta(base.end,missed.end),1);
  t.setClock(at(DAY));a.SET(k1,1,{minutes:120});a.SET(k2,1,{minutes:120});const ahead=a.findCompletionPlan('acervo',base.end);
  assert.equal(ahead.tasks,0);assert.equal(ahead.studyDays,0);assert.equal(a.workdayDelta(base.end,ahead.end),-1);cases++;
}

// Questões registradas não consomem os 120 minutos nem mudam a previsão.
{
  const {app:a}=empty();extra(a,'study',120);const before=a.findCompletionPlan('acervo','2026-09-08');
  a.S.kv['qx:'+at(DAY)]=[JSON.stringify({mat:'Teste',n:60,pct:80}),at(DAY)];
  const after=a.findCompletionPlan('acervo',before.end);assert.equal(after.end,before.end);assert.equal(after.minutes,before.minutes);cases++;
}

// A projeção é pura: não grava calendário, horizonte, undo ou conclusão.
{
  const {app:a}=empty();extra(a,'pure',70,true);a.S.kv['st:orphan-auto']=['auto',at(DAY)];const before=JSON.stringify(a.S.kv);
  a.findCompletionPlan('nucleo','2026-09-08');assert.equal(JSON.stringify(a.S.kv),before);cases++;
}

// O marco é criado uma vez e não é redefinido por um novo render/estudo.
{
  const {app:a}=empty();const k=extra(a,'baseline',120,true),core=a.findCompletionPlan('nucleo','2026-09-08'),all=a.findCompletionPlan('acervo','2026-09-08');
  const snapshot={version:1,today:DAY,cap:120,counts:a.forecastCatalogCounts(),core,all};
  const first=a.ensureForecastBaseline(snapshot);a.SET(k,1,{minutes:120});
  const second=a.ensureForecastBaseline({...snapshot,today:'2026-09-09'});
  assert.equal(JSON.stringify(second),JSON.stringify(first));assert.equal(JSON.parse(a.G(a.FORECAST_BASELINE_KEY)).capturedOn,DAY);cases++;
}

console.log(JSON.stringify({status:'ok',cases,suite:'live-completion-forecast'}));
