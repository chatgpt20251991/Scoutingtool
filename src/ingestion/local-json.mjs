import { MAX_IMPORT_BYTES } from '../import/index.mjs';

const invalid = (message, status = 400) => Object.assign(new Error(message), { status });

/** Adapter boundary: caller supplies local bytes; this adapter never fetches a locator. */
export const LOCAL_JSON_ADAPTER = Object.freeze({
  id: 'local-json-v1',
  transport: 'local-file',
  live: false,
  permissionsVerified: false,
  schemaVersion: 1,
  parse(input) {
    if (typeof input !== 'string' && !(input instanceof Uint8Array)) {
      throw invalid('De lokale JSON-adapter verwacht tekst of bytes.');
    }
    const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
    if (bytes.byteLength > MAX_IMPORT_BYTES) throw invalid('Importbestand is groter dan 1 MiB.', 413);
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw invalid('Importbestand bevat geen geldige UTF-8 JSON.'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw invalid('Importbestand moet één JSON-envelop bevatten.');
    }
    return payload;
  }
});

export function getImportAdapter(id = LOCAL_JSON_ADAPTER.id) {
  if (id !== LOCAL_JSON_ADAPTER.id) throw invalid('Bronadapter niet aangesloten. Alleen lokale JSON-import is beschikbaar.', 404);
  return LOCAL_JSON_ADAPTER;
}
