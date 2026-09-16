// Item 14 (16/09/2026): ligações informativo → tese conferidas e fichas corrigidas só com dado verificado.
// pids = o item do informativo é o próprio julgado (ler um marca o outro); rel = o item aplica ou amplia a
// tese e só mostra a ligação. Fichas que a conferência não sustentou exibem aviso em vez de dado inventado.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, infoJuris, infoUnit, jurisFicha, jkey, INFOS, DATA, G, SET, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const at = new Date('2026-09-08T12:00:00').getTime();
const a = loadApp({'profile:120-weekdays:v1': [1, at]}).app;

const pids = new Set(a.DATA.juris.map(j => j.pid));
// A mesma tese aparece em mais de uma matéria com o mesmo pid (mesma chave de progresso): as cópias
// corrigidas ficam iguais nos campos conferidos.
for (const pid of pids) {
  const copies = a.DATA.juris.filter(j => j.pid === pid);
  for (const f of ['aviso']) assert(copies.every(c => c[f] === copies[0][f]), pid + ': ' + f + ' igual em todas as cópias');
}
const tema642 = a.DATA.juris.filter(j => j.pid === 'juris:STF:TEMA:642');
assert(tema642.length > 1 && tema642.every(j => j.inf), 'tese ligada a informativo ganha a marca em todas as matérias');
let full = 0, rel = 0;
for (const o of a.INFOS) {
  for (const p of o.pids || []) { assert(pids.has(p), o.id + ': pid ligado existe'); full++; }
  for (const p of o.rel || []) { assert(pids.has(p), o.id + ': tese relacionada existe'); rel++; }
  assert(!(o.rel || []).some(p => (o.pids || []).includes(p)), o.id + ': a mesma tese não fica nos dois campos');
}
assert.equal(full, 13, '11 ligações antigas + 2 itens que são o próprio julgado');
assert.equal(rel, 17, 'ligações só de exibição');
const byId = id => a.INFOS.find(o => o.id === id);
assert.deepEqual([...byId('58d03310').pids], ['juris:STF:TEMA:1068']);
assert.deepEqual([...byId('4b4baf8a').pids], ['juris:STF:TEMA:931']);
assert.equal(byId('2e15b10f').pids, undefined, 'precedente diferente (Tema 1129) não é ligado');
assert.equal(byId('2e15b10f').rel, undefined);

// rel não propaga conclusão; pids propaga.
const relInfo = byId('aad64891');
assert.deepEqual([...relInfo.rel], ['juris:STJ:SUM:308']);
a.SET('inf:' + relInfo.id, 1); a.syncEquiv();
assert.equal(a.G('jur:juris:STJ:SUM:308'), null, 'ler item que só aplica a súmula não marca a súmula');
a.SET('jur:juris:STJ:SUM:308', 1); a.syncEquiv();
assert.equal(a.G('inf:780b2178'), null, 'estudar a súmula não marca como lido o item que a amplia');
a.SET('inf:58d03310', 1); a.syncEquiv();
assert.equal(a.G('jur:juris:STF:TEMA:1068'), 'auto', 'o próprio julgado marca a tese');
assert.equal(a.G('inf:7eb1290e'), null, 'e não arrasta outro informativo que só a aplica');

// Contagem na tela inclui as duas ligações.
assert.equal(a.infoJuris(relInfo).length, 1);
assert.match(a.infoUnit(relInfo).meta, /1 juris/);

// Fichas corrigidas (conferidas no STF/STJ) e avisos onde nada foi confirmado.
const j = pid => a.DATA.juris.find(x => x.pid === pid);
assert.equal(j('juris:STJ:RHC:165003').ref, 'HC 165.003/SP (STJ)');
assert.equal(j('juris:STJ:RHC:165003').orgao, 'Sexta Turma');
assert.equal(j('juris:STJ:RE:999425').ref, 'HC 155.347/PR (STF)');
assert.equal(j('juris:STJ:RE:999425').data, '2018-04-17');
assert.match(j('juris:STF:TEMA:931').ref, /^Tema 931\/STJ/);
assert.equal(j('juris:STJ:TEMA:228').ref, 'Tema 228 (STF)');
assert.equal(j('juris:STF:SV:14').data, '2009-02-02');
assert.equal(j('juris:STJ:TEMA:1129').relator, undefined, 'Tema 1129: nada preenchido sem conferência');
assert(!j('juris:STJ:TEMA:1129').inf, 'Tema 1129: o informativo com esse número trata de outro assunto, sem marca de informativo');
assert(!a.DATA.juris.some(x => /scon\.stj\.jus\.br\/SCON\/pesquisar\.jsp\?b=SUMU/.test(x.url)), 'súmulas do STJ com endereço que abre a súmula');
for (const x of a.DATA.juris) assert(/^https:\/\//.test(x.url), x.pid + ': url https');
const i1129 = a.DATA.juris.findIndex(x => x.pid === 'juris:STJ:TEMA:1129');
assert.match(a.jurisFicha(a.jkey(i1129)), /Número do tema não confere/);
assert(a.DATA.juris.filter(x => x.aviso).length === 3);
console.log('juris-links: ok (' + full + ' ligações de equivalência, ' + rel + ' de exibição)');
