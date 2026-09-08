import test from 'node:test';
import assert from 'node:assert/strict';
import { sealBackup, openBackup, MAX_BACKUP_BYTES } from '../src/backup/crypto.mjs';

const phrase = 'Synthetische back-up wachtzin 2026!';
test('multi-megabyte encrypted backups validate canonical base64 without recursive regular expressions', async () => {
  const original = { synthetic: 'x'.repeat(2 * 1024 * 1024) };
  assert.deepEqual(await openBackup(await sealBackup(original, phrase), phrase), original);
});
test('encrypted backups roundtrip Unicode and produce independent salts, IVs and ciphertext without names in metadata', async () => {
  const original = { format: 'synthetic', name: 'Fictieve geheime club', note: 'é 🎯', value: null };
  const one = await sealBackup(original, phrase), two = await sealBackup(original, phrase);
  assert.deepEqual(await openBackup(one, phrase), original);
  for (const key of ['salt','iv','ciphertext','tag']) assert.notEqual(one[key], two[key]);
  assert.equal(JSON.stringify(one).includes(original.name), false);
  assert.equal(JSON.stringify(one).includes(phrase), false);
});
test('wrong passphrases and altered authenticated ciphertext never return partially decoded data', async () => {
  const original = await sealBackup({ synthetic: 'private fixture' }, phrase);
  const wrong = await openBackup(original, 'Een andere synthetische wachtzin').catch(e => e);
  assert.equal(wrong.status, 400);
  for (const field of ['ciphertext', 'tag', 'iv', 'salt']) {
    const bad = structuredClone(original), bytes = Buffer.from(bad[field], 'base64'); bytes[0] ^= 1; bad[field] = bytes.toString('base64');
    await assert.rejects(openBackup(bad, phrase), e => e.status === 400 && e.message === wrong.message);
  }
});
test('backup crypto refuses caller-selected algorithms, malformed base64, invalid passphrases and excess payloads', async () => {
  const original = await sealBackup({ synthetic: true }, phrase);
  for (const change of [{ version: 2 }, { kdf: 'scrypt-2-1-1' }, { cipher: 'aes-128-cbc' }, { iv: '' }, { tag: original.tag + '\n' }, { extra: 'not authenticated' }]) {
    await assert.rejects(openBackup({ ...original, ...change }, phrase), e => e.status === 400);
  }
  for (const bad of ['short', 'x'.repeat(129), 'x'.repeat(2 * 1024 * 1024), 'x'.repeat(15)+'\0', 'x'.repeat(15)+'\uD800']) await assert.rejects(sealBackup({}, bad), e => e.status === 400);
  await assert.rejects(sealBackup({ excessive: 'x'.repeat(MAX_BACKUP_BYTES) }, phrase), e => e.status === 413);
});
test('backup crypto has a bounded work queue and recovers after rejected operations', async () => {
  const operations = Array.from({ length: 5 }, () => sealBackup({ synthetic: true }, phrase));
  const results = await Promise.allSettled(operations);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 4);
  assert.equal(results[4].reason.status, 429);
  assert.deepEqual(await openBackup(await sealBackup({ recovered: true }, phrase), phrase), { recovered: true });
});
