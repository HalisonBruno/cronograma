const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert(/<script src="ebook-law-evidence\.js"><\/script>\s*<script>/.test(html),'evidence loads before the application');
const evidenceContext={};vm.runInNewContext(fs.readFileSync(path.join(root,'ebook-law-evidence.js'),'utf8')+';globalThis.out=LAW_EVIDENCE',evidenceContext);
const runtimeEvidence=evidenceContext.out;
assert.equal(runtimeEvidence.records.length,runtimeEvidence.summary.evidenceRecords);assert(runtimeEvidence.records.length>0);assert.equal(runtimeEvidence.sources.length,14);
const harness=fs.readFileSync(path.join(__dirname,'study-minutes.js'),'utf8').split('async function main()')[0]
  .replace('console, document,','console, document, LAW_EVIDENCE: runtimeEvidence,')
  .replace('updateStats, unitCard,','LAW_EVIDENCE, updateStats, unitCard,');
const {loadApp}=new Function('require','__dirname','runtimeEvidence',harness+';return {loadApp};')(require,__dirname,runtimeEvidence);
const stamp=new Date('2026-09-08T12:00:00').getTime(),{app:a}=loadApp({'profile:120-weekdays:v1':[1,stamp]});
for(const record of runtimeEvidence.records){
  const block=a.allBlocks.find(b=>b.id===record.blockId);assert(block&&block.tipo==='LEI');
  const blockUnits=a.unitsOf(block),unit=blockUnits.find(u=>u.key.endsWith(':'+record.groupId)||u.key==='st:'+record.blockId);assert(unit,record.blockId+'/'+record.groupId+' not in '+blockUnits.map(u=>u.key).join(','));
  const chapter='eb:'+record.eb+':'+record.cap;a.S.kv={ 'profile:120-weekdays:v1':[1,stamp], [chapter]:[1,stamp] };
  const before=a.studyMinutesOn('2026-09-08');
  a.syncEquiv();assert(['auto','done-auto'].includes(a.G(unit.key)),record.eb+' chapter '+record.cap+' covers verified '+record.groupId);
  assert.equal(a.studyMinutesOn('2026-09-08'),before,'derived law adds no minutes');
}
console.log(JSON.stringify({status:'ok',records:runtimeEvidence.records.length,sources:runtimeEvidence.sources.length,suite:'production ebook-law evidence'}));
