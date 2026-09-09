import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const pairs = [
  ...['learning.js', 'learning-support.js', 'learning-updates.css'].flatMap(file => [
    [`platforms/desktop/${file}`, `public/${file}`],
    [`platforms/desktop/${file}`, `platforms/android/www/${file}`],
  ]),
  ['public/mobile-bridge.js', 'platforms/android/www/mobile-bridge.js'],
  ['public/cloud-account.js', 'platforms/android/www/cloud-account.js'],
  ['public/cloud-account.css', 'platforms/android/www/cloud-account.css'],
  ['public/mobile.html', 'platforms/android/www/index.html'],
];

let stale = false;
for (const [source, target] of pairs) {
  const from = path.join(root, source), to = path.join(root, target);
  if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) continue;
  stale = true;
  if (!checkOnly) copyFileSync(from, to);
  else console.error(`需要同步：${target}`);
}

for (const file of ['learning.js', 'learning-support.js']) {
  new Function(readFileSync(path.join(root, 'platforms/desktop', file), 'utf8'));
}

if (checkOnly && stale) process.exitCode = 1;
else console.log(checkOnly ? '跨平台共享文件一致。' : '跨平台共享文件已同步。');
