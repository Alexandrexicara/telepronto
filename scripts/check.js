const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const roots = ['server.js', 'netlify/functions', 'scripts'];
const files = [];
function collect(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) collect(path.join(target, name));
  } else if (target.endsWith('.js')) files.push(target);
}
for (const root of roots) collect(root);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
    process.stderr.write('Falha de sintaxe: ' + file + '\n');
  }
}
if (failed) process.exit(1);
(async () => {
  for (const dependency of ['@modelcontextprotocol/server', 'zod/v4', 'pg', 'bcryptjs', 'jsonwebtoken']) {
    await import(dependency);
  }
  console.log('OK: ' + files.length + ' arquivos JavaScript verificados; dependências e SDK MCP carregados.');
})().catch(error => {
  console.error('Falha ao carregar dependência:', error.message);
  process.exit(1);
});
