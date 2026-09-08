import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const emptyState = () => ({ version: 1, decisions: [], tasks: [], brief: { role: '', minAge: 18, maxAge: 23, task: '', budgetScope: '' }, audit: [] });
/** Single-local-user state. Not production auth, tenant isolation or a tamper-proof audit. */
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
            await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600, flush: true });
            await rename(temp, path);
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
