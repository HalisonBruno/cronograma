// Nenhum dispositivo de lei seca visível é lido duas vezes (revisão de 22/09/2026). O replanejador só descarta um grupo
// cuja seleção é idêntica a outra já colocada (fonte + artigos + recorte, lawSignature); recortes sobrepostos do mesmo
// texto passavam: Lei 14.133 art. 6 caput–XXII duas vezes no mesmo bloco, CF art. 7 inteiro em Const. Trabalho e em
// Constitucional, CDC art. 103 em Civil e em Proc. Civil. Agora cada dispositivo visível pertence a um único grupo
// visível, o plano real não agenda nenhum deles duas vezes e os grupos recortados são cópia literal do texto oficial.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const harness = fs.readFileSync(path.join(__dirname, 'study-minutes.js'), 'utf8')
  .split('async function main()')[0]
  .replace('updateStats, unitCard,', 'updateStats, planRegen, planningUnits, lawGroupMeta, unitCard,');
const {loadApp} = new Function('require', '__dirname', harness + '\nreturn {loadApp};')(require, __dirname);
const PRIO_V = +(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/"versao":([0-9]+)/) || [0, 1])[1];
const DAY = '2026-09-08', at = new Date(DAY + 'T12:00:00').getTime();
const seeds = () => ({'profile:120-weekdays:v1': [1, at], 'profile:90-weekdays:v1': [1, at], 'cfg:cap': [120, at], 'profile:prio-bancas:v1': [PRIO_V, at]});

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const line = html.split('\n').find(l => l.startsWith('const DATA = '));
const DATA = JSON.parse(line.slice(13, line.lastIndexOf('}') + 1));
const FILES = {};
const file = bid => FILES[bid] || (FILES[bid] = JSON.parse(fs.readFileSync(path.join(ROOT, 'leis', bid + '.json'), 'utf8')));

// Dispositivo = caput, parágrafo ou inciso (mesma regra de scripts/add-law-blocks.py; alínea acompanha o inciso).
// Identidade: lei (arquivo do Planalto, com ou sem "compilado") + artigo + texto da linha sem as notas de redação.
const DEVICE = /^(Art(?:igo)?\.?\s*\d|§|Par[áa]grafo [úu]nico|[IVXLCDM]+\s*[-–—])/;
const lawOf = u => { const s = String(u || '').toLowerCase(), m = s.match(/\/([^\/#?]+?)(?:compilad[oa])?\.html?(?:[#?].*)?$/); return m ? m[1] : s; };
const artOf = n => (String(n).match(/^\d+(?:-[A-Z]+)?/i) || [String(n)])[0].toUpperCase();
const norm = s => s.normalize('NFKC').toLowerCase()
  .replace(/\((?:[^()]*(?:reda[çc][ãa]o|inclu[íi]d|revogad|vide|acrescid|renumerad|vetad)[^()]*)\)/g, '')
  .replace(/[–—‐-]/g, '-').replace(/\s+/g, ' ').trim();
function devicesOf(bid, gid) {
  const meta = DATA.leigroups[bid].find(g => g.id === gid), g = file(bid).g.find(x => x.id === gid);
  assert(meta && g, 'grupo sem texto: ' + bid + ':' + gid);
  const law = lawOf(meta.u || meta.readSourceUrl || g.u);
  return g.a.flatMap(a => a.t.split('\n').map(l => l.trim()).filter(l => DEVICE.test(l)).map(l => law + '|' + artOf(a.n) + '|' + norm(l)));
}
const visible = g => !g.x && !g.rev && !g.dir;

// 1. Nos dados: cada dispositivo visível está em um único grupo visível, em todos os blocos.
const owner = new Map(), clash = new Map();
let groups = 0, devices = 0;
for (const bid in DATA.leigroups) for (const g of DATA.leigroups[bid]) {
  if (!visible(g)) continue;
  groups++;
  for (const dev of new Set(devicesOf(bid, g.id))) {
    devices++;
    const other = owner.get(dev), me = bid + ':' + g.id;
    if (other && other !== me) { const k = [other, me].sort().join(' & '); clash.set(k, (clash.get(k) || 0) + 1); }
    else owner.set(dev, me);
  }
}
assert(groups > 500 && devices > 5000, 'o acervo inteiro entra na verificação');
assert.equal(clash.size, 0, 'dispositivos em mais de um grupo visível: ' + JSON.stringify([...clash]));

// 2. Os grupos recortados em 22/09 são cópia literal do grupo oculto de onde vieram (texto nunca inventado), cada
//    grupo oculto é inteiro coberto pelos visíveis, e o tique dele só vai para grupos que ele contém por inteiro.
const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'law-overlaps-2026-09-22.json'), 'utf8'));
const textLines = (bid, gid) => file(bid).g.find(x => x.id === gid).a.flatMap(a => a.t.split('\n'));
for (const c of rec.created) {
  const mine = file(c.block).g.find(x => x.id === c.id), from = file(c.block).g.find(x => x.id === c.from);
  if (c.source.lines) assert.deepEqual(textLines(c.block, c.id), textLines(c.block, c.from).slice(...c.source.lines), c.id + ': recorte literal de ' + c.from);
  else assert.deepEqual(mine.a, from.a.filter(a => c.source.articles.includes(a.n)), c.id + ': artigos copiados inteiros de ' + c.from);
  assert.equal(JSON.stringify(mine.audit.sourceHash), JSON.stringify(from.audit.sourceHash), c.id + ': mesma conferência oficial');
  assert(DATA.leigroups[c.block].find(g => g.id === c.id).d <= 30, c.id + ': teto de 30 dispositivos');
}
for (const h of rec.hidden) {
  assert.equal(DATA.leigroups[h.block].find(g => g.id === h.id).x, 1, h.id + ' oculto');
  for (const dev of devicesOf(h.block, h.id)) assert(owner.has(dev), h.id + ': dispositivo oculto sem leitura visível: ' + dev);
  const targets = DATA.lgmig[h.block]['d:' + h.id] || [];
  const mine = new Set(devicesOf(h.block, h.id));
  for (const t of targets) {
    const i = t.lastIndexOf(':'), bid = i < 0 ? h.block : t.slice(0, i), gid = t.slice(i + 1);
    assert(visible(DATA.leigroups[bid].find(g => g.id === gid)), t + ' é visível');
    assert(DATA.leigroups[bid].filter(visible).length > 1, t + ': destino é tique lg2 (bloco com mais de um grupo)');
    assert(devicesOf(bid, gid).every(d => mine.has(d)), h.id + ' -> ' + t + ': o tique só vai para grupo lido por inteiro');
  }
}

// 3. No replanejador real: tudo o que recebe data ou fica na fila, de todas as matérias, sem dispositivo repetido.
function duplicated(app) {
  const units = new Map(app.planningUnits(true).map(u => [u.key, u]));
  const plan = app.planRegen({includeToday: true, skipSync: true, skipState: true});
  const seen = new Map(), dup = [];
  let law = 0;
  for (const m of [...plan.moves, ...plan.fila]) {
    const s = units.get(m.key) && app.lawGroupMeta(units.get(m.key));
    if (!s || !s.group) continue;
    law++;
    assert(visible(s.group), 'grupo oculto agendado: ' + m.key);
    for (const dev of new Set(devicesOf(s.bid, s.group.id))) {
      if (seen.has(dev) && seen.get(dev) !== m.key) dup.push(seen.get(dev) + ' & ' + m.key);
      else seen.set(dev, m.key);
    }
  }
  return {dup: [...new Set(dup)], law, plan};
}
const {dup, law, plan} = duplicated(loadApp(seeds()).app);
assert(law > 400, 'as leituras de lei seca pendentes entram no plano: ' + law);
assert.equal(dup.length, 0, 'dispositivo agendado duas vezes: ' + JSON.stringify(dup));
assert(plan.days.every(d => plan.load[d] <= plan.cap + 15), 'teto diário com a margem pedagógica');

// Controle: com o recorte antigo visível de novo (24d17a, caput–XXIX), o mesmo teste acusa a leitura repetida.
{
  const old = loadApp(seeds()).app;
  delete old.LG['2026-08-28-0'].find(g => g.id === '24d17a').x;
  const r = duplicated(old);
  assert(r.dup.some(p => p.includes('24d17a')), 'sem a correção, caput–XXII do art. 6 entraria duas vezes: ' + JSON.stringify(r.dup));
}
console.log('law-device-once: ok (' + groups + ' grupos visíveis, ' + devices + ' dispositivos, ' + law + ' leituras no plano, 0 repetidas)');
