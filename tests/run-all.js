// Executa toda a suíte (JavaScript e Python) em sequência e falha se qualquer arquivo falhar.
// Uso: npm test   (ou node tests/run-all.js [filtro])
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname, filter = process.argv[2] || '';
const files = fs.readdirSync(dir).filter(f => /\.(js|py)$/.test(f) && f !== 'run-all.js' && f.includes(filter)).sort();
let failed = 0;
const t0 = Date.now();
for (const f of files) {
  const [cmd, args] = f.endsWith('.py') ? [process.platform === 'win32' ? 'python' : 'python3', [path.join(dir, f)]] : [process.execPath, [path.join(dir, f)]];
  const start = Date.now();
  const r = spawnSync(cmd, args, {cwd: path.join(dir, '..'), encoding: 'utf8', timeout: 15 * 60 * 1000});
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + f + ' (' + ((Date.now() - start) / 1000).toFixed(1) + 's)');
  if (!ok) console.log(String((r.stderr || '') + (r.stdout || '')).split('\n').filter(l => !/^\s+at /.test(l)).slice(-12).join('\n'));
}
console.log((failed ? failed + ' falha(s)' : 'tudo verde') + ' em ' + files.length + ' arquivos, ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
process.exit(failed ? 1 : 0);
