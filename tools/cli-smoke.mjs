import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, cp, access, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const temp = await mkdtemp(join(tmpdir(), 'omniscout-cli-start-'));
const blocker = http.createServer();
let child;
try {
  await cp(resolve('src'), join(temp, 'src'), { recursive: true });
  await new Promise(done => blocker.listen(0, '127.0.0.1', done));
  child = spawn(process.execPath, [join(temp, 'src/server.mjs')], { windowsHide: true, env: { ...process.env, PORT: String(blocker.address().port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', part => { stderr += part; });
  const timeout = setTimeout(() => child.kill(), 15000);
  const [code] = await once(child, 'exit'); clearTimeout(timeout);
  assert.equal(code, 1, stderr); assert.match(stderr, /EADDRINUSE/);
  await assert.rejects(access(join(temp, '.local/.organization-manager.lock')), error => error.code === 'ENOENT');
  console.log('PASS: actual CLI rejects occupied port with exit 1 and releases its data-directory lock');
} finally {
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  await new Promise(done => blocker.close(done));
  const inside = relative(resolve(tmpdir()), resolve(temp)); assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
  await rm(temp, { recursive: true, force: true });
}
