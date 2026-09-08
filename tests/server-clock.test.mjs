import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { validateWorkspaceState } from '../src/backup/workspace.mjs';

test('scouting decisions, task creation/completion and audit use the same injected clock as backup validation', async t => {
  let clock = '2026-09-08T12:00:00.000Z';
  const app = await createApp({ authRequired: false, now: () => clock });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.importQueue.idle(); await new Promise(resolve => app.server.close(resolve)); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const { csrf } = await (await fetch(base + '/api/session')).json();
  async function write(path, payload, method = 'POST') {
    const response = await fetch(base + path, { method, headers: { origin: base, 'content-type': 'application/json', 'x-omniscout-csrf': csrf }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  }

  const decision = await write('/api/decisions', { playerId: 'p01', action: 'follow', reason: 'positive', note: 'Fictieve klokregressie' });
  assert.equal(decision.status, 201);
  assert.equal(decision.body.at, clock);
  const taskInput = { playerId: 'p01', question: 'Fictieve onderzoeksopdracht voor klokcontrole', requestId: 'synthetic-clock-regression' };
  const task = await write('/api/tasks', taskInput);
  assert.equal(task.status, 201);
  assert.equal(task.body.at, clock);
  assert.equal(task.body.completedAt, null);
  const createdAt = clock;

  clock = '2026-09-08T12:01:00.000Z';
  const retry = await write('/api/tasks', taskInput);
  assert.equal(retry.body.id, task.body.id);
  assert.equal(retry.body.at, createdAt);
  const completed = await write(`/api/tasks/${task.body.id}`, { status: 'done', result: 'Fictieve waarneming voor de klokregressie' }, 'PATCH');
  assert.equal(completed.status, 200);
  assert.equal(completed.body.at, createdAt);
  assert.equal(completed.body.completedAt, clock);
  const state = await app.store.read();
  assert.deepEqual(state.audit.map(event => [event.action, event.at]), [
    ['decision.created', createdAt], ['task.created', createdAt], ['task.updated', clock]
  ]);
  assert.doesNotThrow(() => validateWorkspaceState(state, { now: clock }));
});
