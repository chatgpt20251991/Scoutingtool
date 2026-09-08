import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
export const MAX_ENVELOPE_BYTES = 46 * 1024 * 1024;
const derive = promisify(scrypt);
const HEADER = Object.freeze({ format: 'omniscout-encrypted', version: 1, kdf: 'scrypt-131072-8-1', cipher: 'aes-256-gcm' });
const AAD = Buffer.from(JSON.stringify(HEADER));
const FIELDS = [...Object.keys(HEADER), 'salt', 'iv', 'tag', 'ciphertext'].sort();
const fail = (status, message) => Object.assign(new Error(message), { status });
const plain = object => object && typeof object === 'object' && !Array.isArray(object) && [Object.prototype, null].includes(Object.getPrototypeOf(object));
let serial = Promise.resolve(), pending = 0;
function bounded(operation) {
  if (pending >= 4) return Promise.reject(fail(429, 'Te veel back-upbewerkingen. Probeer later opnieuw.'));
  pending++;
  const result = serial.then(operation);
  serial = result.catch(() => {});
  return result.finally(() => { pending--; });
}
function passphraseBytes(value) {
  // Bound UTF-16 length before allocating a Unicode iterator array or UTF-8 buffer.
  if (typeof value !== 'string' || value.length < 15 || value.length > 256 || Buffer.byteLength(value) > 512
    || [...value].length < 15 || [...value].length > 128
    || /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw fail(400, 'De back-upwachtzin moet 15 tot 128 tekens bevatten.');
  }
  return Buffer.from(value, 'utf8');
}
function base64(value, length, max = length) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 !== 0) throw fail(400, 'Ongeldig versleuteld back-upbestand.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < length || bytes.length > max || bytes.toString('base64') !== value) throw fail(400, 'Ongeldig versleuteld back-upbestand.');
  return bytes;
}
async function keyFor(passphrase, salt) {
  const bytes = passphraseBytes(passphrase);
  try { return await derive(bytes, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }); }
  finally { bytes.fill(0); }
}
/** A passphrase-protected download; no salt/key/algorithm parameters are caller-selectable. */
export function sealBackup(bundle, passphrase) {
  return bounded(async () => {
    if (!plain(bundle)) throw fail(400, 'Een geldig back-upobject is vereist.');
    let encoded;
    try { encoded = JSON.stringify(bundle); } catch { throw fail(400, 'Ongeldig back-upobject.'); }
    if (Buffer.byteLength(encoded) > MAX_BACKUP_BYTES) throw fail(413, 'Back-up overschrijdt de limiet van 32 MiB.');
    const plaintext = Buffer.from(encoded), salt = randomBytes(16), iv = randomBytes(12);
    let key;
    try {
      key = await keyFor(passphrase, salt);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 }); cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { ...HEADER, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
    } finally { key?.fill(0); plaintext.fill(0); }
  });
}
export function openBackup(envelope, passphrase) {
  return bounded(async () => {
    if (!plain(envelope) || Object.keys(envelope).sort().join(',') !== FIELDS.join(',') || Object.entries(HEADER).some(([key, value]) => envelope[key] !== value)) throw fail(400, 'Onbekend of ongeldig versleuteld back-upformaat.');
    const salt = base64(envelope.salt, 16), iv = base64(envelope.iv, 12), tag = base64(envelope.tag, 16), ciphertext = base64(envelope.ciphertext, 2, MAX_BACKUP_BYTES);
    let key, plaintext;
    try {
      key = await keyFor(passphrase, salt);
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 }); decipher.setAAD(AAD); decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
        if (!plain(result)) throw new Error('Invalid plaintext');
        return result;
      } catch { throw fail(400, 'Back-up niet geopend. Controleer de wachtzin en het oorspronkelijke bestand.'); }
    } finally { key?.fill(0); plaintext?.fill(0); }
  });
}
