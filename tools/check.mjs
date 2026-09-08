import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function check(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) await check(path);
    else if (/\.(mjs|js)$/.test(path)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
      console.log(`Syntax OK: ${path}`);
    }
  }
}
for (const dir of ['src', 'public', 'worker', 'tests', 'tools']) await check(dir);
