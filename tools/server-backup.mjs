import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_ENVELOPE_BYTES } from '../src/backup/crypto.mjs';
import { createServerBackup, previewServerBackup, restoreServerBackup } from '../src/backup/server.mjs';

const HELP = `Omni-Scout: offline volledige serverback-up

node tools/server-backup.mjs create --data-dir ABSOLUUT_PAD --output NIEUW_BESTAND [--passphrase-file PRIVÉBESTAND]
node tools/server-backup.mjs inspect --input BACKUP_BESTAND [--passphrase-file PRIVÉBESTAND]
node tools/server-backup.mjs restore --input BACKUP_BESTAND --destination NIEUWE_MAP --confirm DIGEST [--passphrase-file PRIVÉBESTAND]

Stop de server vóór create. Restore schrijft alleen naar een nog niet bestaande map.
Zonder passphrase-file wordt de wachtzin onzichtbaar gevraagd in een interactieve terminal.
Een wachtzinbestand moet buiten iedere Git-werkmap staan en alleen voor jezelf leesbaar zijn.
Geef de wachtzin nooit als argument of omgevingsvariabele mee. Zie docs/SERVER_BACKUP.md.
`;
const fail = message => Object.assign(new Error(message), { expected: true });
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function localPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\0-\x1f]/.test(value)
    || value.split(/[\\/]/).includes('..')) throw fail('Gebruik een geldig lokaal pad zonder bovenliggende padsegmenten.');
  return resolve(value);
}
async function safePath(path, kind, optional = false) {
  const absolute = localPath(path), root = parse(absolute).root;
  const pieces = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root, info = await lstat(root);
  for (let index = 0; index < pieces.length; index += 1) {
    current = join(current, pieces[index]);
    try { info = await lstat(current); }
    catch (error) { if (optional && error.code === 'ENOENT' && index === pieces.length - 1) return null; throw fail('Een vereist bestand of de bovenliggende map ontbreekt.'); }
    if (info.isSymbolicLink() || (index < pieces.length - 1 && !info.isDirectory())) throw fail('Koppelingen zijn niet toegestaan in back-uppaden.');
  }
  if ((kind === 'directory' && !info.isDirectory()) || (kind === 'file' && (!info.isFile() || info.nlink !== 1))) throw fail('Gebruik gewone bestanden en mappen zonder koppelingen.');
  if (!samePath(await realpath(absolute), absolute)) throw fail('Het pad verwijst naar een andere locatie.');
  return info;
}
async function readBounded(path, maximum) {
  const expected = await safePath(path, 'file'), handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (info.dev !== expected.dev || info.ino !== expected.ino || !info.isFile() || info.nlink !== 1 || info.size > maximum) throw fail('Bestand is gewijzigd, onveilig of te groot.');
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) { const result = await handle.read(bytes, length, bytes.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
    if (length !== info.size || (await handle.stat()).size !== info.size) throw fail('Bestand is gewijzigd tijdens het lezen.');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally { await handle.close(); }
}
async function passphrase(file) {
  if (file) {
    const path = localPath(file), info = await safePath(path, 'file');
    let current = dirname(path);
    while (true) {
      try { await lstat(join(current, '.git')); throw fail('Het wachtzinbestand moet buiten iedere Git-werkmap staan.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const parent = dirname(current); if (parent === current) break; current = parent;
    }
    if (process.platform !== 'win32' && (info.mode & 0o077)) throw fail('Het wachtzinbestand moet uitsluitend voor de eigenaar leesbaar zijn (modus 0600).');
    const value = (await readBounded(path, 516)).replace(/\r?\n$/, '');
    if (/[\r\n]/.test(value)) throw fail('Het wachtzinbestand moet precies één regel bevatten.');
    return value;
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw fail('Gebruik een privé-wachtzinbestand buiten Git of een interactieve terminal.');
  const hidden = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const prompt = createInterface({ input: process.stdin, output: hidden, terminal: true });
  process.stderr.write('Back-upwachtzin (onzichtbaar): ');
  try { return await prompt.question(''); }
  finally { prompt.close(); process.stderr.write('\n'); }
}
function argumentsFor(args) {
  const [command, ...rest] = args;
  if (!['create', 'inspect', 'restore'].includes(command)) throw fail('Kies create, inspect of restore; gebruik --help voor de opties.');
  const allowed = command === 'create' ? ['data-dir', 'output', 'passphrase-file']
    : command === 'inspect' ? ['input', 'passphrase-file'] : ['input', 'destination', 'confirm', 'passphrase-file'];
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const option = rest[index], value = rest[index + 1], name = option?.slice(2);
    if (!option?.startsWith('--') || !allowed.includes(name) || Object.hasOwn(options, name)
      || typeof value !== 'string' || !value || value.startsWith('--')) throw fail('Onbekende, dubbele of onvolledige CLI-optie.');
    options[name] = value;
  }
  const required = command === 'create' ? ['data-dir', 'output'] : command === 'inspect' ? ['input'] : ['input', 'destination', 'confirm'];
  if (required.some(name => !options[name])) throw fail('Een vereiste optie ontbreekt; gebruik --help.');
  if (options.confirm && !/^[a-f0-9]{64}$/.test(options.confirm)) throw fail('Gebruik de exacte digest uit inspect als herstelbevestiging.');
  return { command, options };
}
async function writeNew(path, envelope) {
  await safePath(dirname(path), 'directory');
  if (await safePath(path, 'file', true)) throw fail('Het uitvoerbestand bestaat al en wordt niet overschreven.');
  let handle, owned;
  try {
    handle = await open(path, 'wx', 0o600); owned = await handle.stat();
    const value = `${JSON.stringify(envelope)}\n`;
    if (Buffer.byteLength(value) > MAX_ENVELOPE_BYTES) throw fail('Versleutelde back-up is te groot.');
    await handle.writeFile(value); await handle.sync();
    await handle.close(); handle = null;
  } catch (error) {
    await handle?.close();
    if (owned) {
      const current = await safePath(path, 'file', true);
      if (current && current.ino === owned.ino && current.dev === owned.dev) await unlink(path);
    }
    throw error;
  }
}
export async function runServerBackupCLI(args) {
  if (!args.length || (args.length === 1 && ['help', '--help', '-h'].includes(args[0]))) { process.stdout.write(HELP); return; }
  const { command, options } = argumentsFor(args);
  let output, root;
  if (command === 'create') {
    root = localPath(options['data-dir']); output = localPath(options.output);
    const within = relative(root, output);
    const outside = within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within);
    if (!outside) throw fail('Bewaar het back-upbestand buiten de actieve datamap.');
    await safePath(dirname(output), 'directory');
    if (await safePath(output, 'file', true)) throw fail('Het uitvoerbestand bestaat al en wordt niet overschreven.');
  }
  let phrase = await passphrase(options['passphrase-file']);
  try {
    if (command === 'create') {
      const envelope = await createServerBackup({ dataDir: root, passphrase: phrase });
      await writeNew(output, envelope);
      process.stdout.write(`${JSON.stringify({ created: true, format: 'omniscout-encrypted', scope: 'active-server-state', exclusions: ['sessions', 'invitations', 'private_recovery_copies', 'legacy_source', 'original_migration_registry', 'internal_migration_and_restore_receipts'] })}\n`);
      return;
    }
    let envelope;
    try { envelope = JSON.parse(await readBounded(localPath(options.input), MAX_ENVELOPE_BYTES)); }
    catch (error) { if (error.expected) throw error; throw fail('Het invoerbestand bevat geen geldige versleutelde back-up.'); }
    const result = command === 'inspect'
      ? await previewServerBackup({ envelope, passphrase: phrase })
      : await restoreServerBackup({ envelope, passphrase: phrase, destination: options.destination, confirmDigest: options.confirm });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { phrase = ''; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runServerBackupCLI(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.expected || error.status ? error.message : 'Serverback-upverwerking mislukt; bestaande bestanden blijven behouden.'}\n`);
    process.exitCode = 1;
  });
}
