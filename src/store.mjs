import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';

/** Preserve atomic replacement even when Windows temporarily denies file sharing.
 * Never unlink the destination or rerun the transaction callback. Six attempts,
 * at most 620 ms of backoff; permission/path failures still propagate unchanged.
 * Dependency arguments allow deterministic failure-path tests on every OS.
 */
export async function replaceFileAtomically(source, destination, { platform = process.platform, renameFile = rename, delay = pause } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { await renameFile(source, destination); return; }
    catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
      await delay(20 * 2 ** attempt);
    }
  }
}

export const emptyState = () => ({ version: 1, decisions: [], tasks: [], brief: { role: '', minAge: 18, maxAge: 23, task: '', budgetScope: '' }, audit: [] });
/** One scoped state file. The account server authorizes access; the organization manager supplies isolation and a process lock. */
export async function createStore(path = null) {
  let state = emptyState();
  if (path) {
    try {
      state = JSON.parse(await readFile(path, 'utf8'));
      if (state.version !== 1 || !['decisions', 'tasks', 'audit'].every(k => Array.isArray(state[k]))) throw new Error('Ongeldig lokaal state-formaat.');
      if (state.importJobs !== undefined && !Array.isArray(state.importJobs)) throw new Error('Ongeldige lokale importqueue.');
      if (state.imports !== undefined && (!state.imports || typeof state.imports !== 'object' || Array.isArray(state.imports))) throw new Error('Ongeldige lokale imports.');
      if (state.importWorkspace !== undefined && (state.importWorkspace?.version !== 1 || !['decisions', 'tasks', 'audit'].every(k => Array.isArray(state.importWorkspace[k])))) throw new Error('Ongeldig importwerkgebied.');
    } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Lokaal bestand niet geladen: ${error.message}. Bewaar het bestand en herstel het handmatig; niet automatisch gewist.`); }
  }
  let queue = Promise.resolve();
  return {
    async read() { await queue; return structuredClone(state); },
    async update(fn) {
      const run = queue.then(async () => {
        const next = structuredClone(state);
        const result = fn(next);
        if (result && typeof result.then === 'function') throw new Error('Store-mutaties moeten synchroon en atomair zijn.');
        if (next.audit.length + (next.importWorkspace?.audit?.length || 0) > 20000) throw new Error('Limiet lokaal beslislog bereikt. Exporteer en archiveer eerst.');
        if (path) {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          const temp = `${path}.${randomUUID()}.tmp`;
          try {
            await writeFile(temp, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600, flush: true });
            await replaceFileAtomically(temp, path);
          } catch (error) { await unlink(temp).catch(() => {}); throw error; }
        }
        state = next;
        return structuredClone(result);
      });
      queue = run.catch(() => {});
      return run;
    }
  };
}
