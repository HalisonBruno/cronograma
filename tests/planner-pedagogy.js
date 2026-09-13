const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const harness=fs.readFileSync(path.join(__dirname,'study-minutes.js'),'utf8').split('async function main()')[0]
  .replace('updateStats, unitCard,','planRegen, applyRegen, undoRegen, planningUnits, unitsOn, unitDone, minRestante, capMin, planEnd, CALENDAR, lawGroupMeta, pendingPanel, updateStats, unitCard,');
const {loadApp}=new Function('require','__dirname',harness+';return {loadApp};')(require,__dirname);
const DAY='2026-09-08',at=new Date(DAY+'T12:00:00').getTime();let cases=0;
function empty(){const t=loadApp({'profile:120-weekdays:v1':[1,at],'profile:90-weekdays:v1':[1,at],'cfg:cap':[120,at]}, {localMode:false});const a=t.app;a.allBlocks.splice(0);a.INFOS.splice(0);a.DATA.juris.splice(0);a.DATA.infgem={};return t}
function extra(a,id,min,tipo='REV'){a.S.kv['ext:'+id]=[JSON.stringify({id,t:id,min,tipo,mat:'Teste',day:''}),at];return 'xdone:'+id}
function audit(a,p){
  const represented=[...p.moves,...p.fila,...p.library,...p.preservedToday];
  assert.equal(new Set(represented.map(m=>m.key)).size,represented.length);
  for(const [d,min]of Object.entries(p.load)){
    assert(![0,6].includes(new Date(d+'T12:00:00').getDay()));
    assert(min<=120+(p.extensions.some(x=>x.day===d)?15:0));
  }
}
// A chapter can finish in up to 135 minutes, with an explicit pedagogical reason.
{
  const {app:a}=empty();const key=extra(a,'long-chapter',130,'EBOOK');
  const p=a.planRegen({end:'2026-09-09'});audit(a,p);
  assert.equal(p.fila.length,0);assert.equal(p.moves[0].key,key);assert.equal(p.load['2026-09-09'],130);
  assert.match(p.extensions[0].reason,/capítulo/);cases++;
}
// Unrelated ordinary tasks cannot use the margin just because they fit in 135.
{
  const {app:a}=empty();extra(a,'one',70);extra(a,'two',60);
  const p=a.planRegen({end:'2026-09-09'});audit(a,p);assert.equal(p.fila.length,1);assert.equal(p.extensions.length,0);cases++;
}
// Finish the last adjacent group of the same law sequence, without changing priorities.
{
  const {app:a}=empty();const b={id:'ped-law',tipo:'LEI',mat:'Civil',min:130,day:'2026-10-01',t:'Lei',wk:1};
  a.allBlocks.push(b);a.LG[b.id]=[{id:'aaaaaa',u:'https://example.test/law',r:'Mesma seção',a:['1'],m:70},{id:'bbbbbb',u:'https://example.test/law',r:'Mesma seção — arts. 2',a:['2'],m:60}];
  const p=a.planRegen({end:'2026-09-09'});audit(a,p);assert.equal(p.moves.length,2);assert.equal(p.fila.length,0);assert.equal(p.load['2026-09-09'],130);assert.equal(p.extensions.length,1);cases++;
}
// A long chapter does not lose its date solely because the info reserve fragments every day.
{
  const {app:a}=empty();for(let i=0;i<10;i++)a.INFOS.push({id:'synthetic-'+i,min:4,mat:'Civil',tit:'Info '+i,trib:'STF',arq:'test',pg:i+1});
  extra(a,'chapter-106',106,'EBOOK');const p=a.planRegen({end:'2026-09-10'});audit(a,p);
  assert.equal(p.fila.length,0);assert.equal(p.info.scheduled,10);assert(p.moves.some(x=>x.tipo==='EBOOK'));cases++;
}
// Complete plan is an explicit scenario, not a silent extension of the exam horizon.
{
  const {app:a}=empty();a.S.kv['cfg:plan-end']=['2026-09-09',at];for(let i=0;i<5;i++)extra(a,'continue-'+i,90);
  const normal=a.planRegen();assert(normal.fila.length>0);const before=JSON.stringify(a.S.kv);
  const complete=a.planRegen({extend:true});audit(a,complete);assert.equal(complete.fila.length,0);assert(complete.end>'2026-09-09');
  assert.equal(JSON.stringify(a.S.kv),before,'preview does not mutate dates or chosen horizon');
  a.applyRegen(complete);assert.equal(a.planEnd(),complete.end);assert(a.CALENDAR.some(x=>x.d===complete.end));
  assert(complete.moves.every(m=>a.unitsOn(m.to).some(u=>u.key===m.key)),'preview is executable in Home');
  a.undoRegen();assert.equal(a.planEnd(),'2026-09-09');assert.equal(a.CALENDAR.at(-1).d,a.DATA.prova,'undo removes the temporary post-exam calendar tail');cases++;
}
// More than 60 pending items remain accessible through pagination and direct actions.
{
  const t=empty(),a=t.app;for(let i=0;i<75;i++){const k=extra(a,'queue-'+i,30);a.S.kv['mvu:'+k]=['fila',at]}
  const root=t.document.createElement('div');a.pendingPanel(root);const panel=root.children[0];
  assert(panel.innerHTML.includes('Ver data para concluir tudo'));panel.open=true;panel.dispatch('toggle');
  assert(panel.querySelector('.page').textContent.includes('Página 1 de 3'));
  panel.querySelector('.next').click();panel.querySelector('.next').click();assert(panel.querySelector('.page').textContent.includes('Página 3 de 3'));cases++;
}
console.log(JSON.stringify({status:'ok',cases,suite:'120-minute-pedagogy-and-actionable-pending'}));
