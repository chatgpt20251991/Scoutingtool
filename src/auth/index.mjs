import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const HEX = /^[0-9a-f]{64}$/;
const ROLES = new Set(['owner', 'scout', 'viewer']);
const SCRYPT = Object.freeze({ N: 2 ** 17, r: 8, p: 1, maxmem: 160 * 1024 * 1024 });
export const AUTH_LIMITS = Object.freeze({ users: 100, organizations: 50, sessions: 100, invitations: 100,
  passwordMin: 15, passwordMax: 128, passwordBytes: 512, sessionMs: 12 * 60 * 60 * 1000,
  invitationMs: 48 * 60 * 60 * 1000, loginWindowMs: 15 * 60 * 1000, loginPerUsername: 8,
  loginGlobal: 120, pendingOperations: 128, fileBytes: 2 * 1024 * 1024 });

function fail(status, message) { return Object.assign(new Error(message), { status }); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function opaque() { return randomBytes(32).toString('base64url'); }
function safeUser(user) { return { id: user.id, username: user.username, displayName: user.displayName }; }
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function username(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value)) {
    throw fail(400, 'Gebruikersnaam: 3–64 letters, cijfers, punten, streepjes of underscores.');
  }
  return value.toLowerCase();
}
function name(value, label) {
  if (typeof value !== 'string' || value.length > 200 || !value.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(value)
    || [...value.trim()].length < 1 || [...value.trim()].length > 100) {
    throw fail(400, `${label}: gebruik 1–100 tekens zonder controletekens.`);
  }
  return value.trim();
}
function password(value) {
  if (typeof value !== 'string' || value.length > AUTH_LIMITS.passwordBytes
    || Buffer.byteLength(value, 'utf8') > AUTH_LIMITS.passwordBytes || !value.isWellFormed() || value.includes('\0')
    || [...value].length < AUTH_LIMITS.passwordMin || [...value].length > AUTH_LIMITS.passwordMax) {
    throw fail(400, 'Wachtwoord: gebruik 15–128 tekens (maximaal 512 UTF-8-bytes).');
  }
  return value;
}
function credentials(input) {
  if (!record(input)) throw fail(400, 'Accountgegevens ontbreken.');
  const normalized = username(input.username);
  return { username: normalized, password: password(input.password),
    displayName: input.displayName === undefined || input.displayName === '' ? normalized : name(input.displayName, 'Weergavenaam') };
}
function role(value) {
  if (!ROLES.has(value)) throw fail(400, 'Kies owner, scout of viewer.');
  return value;
}
async function hashPassword(value) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(value, Buffer.from(salt, 'hex'), 32, SCRYPT);
  return { algorithm: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt, hash: hash.toString('hex') };
}
async function matchesPassword(value, stored) {
  const actual = await derive(value, Buffer.from(stored.salt, 'hex'), 32, SCRYPT);
  return timingSafeEqual(actual, Buffer.from(stored.hash, 'hex'));
}

function validateState(state) {
  const invalid = () => { throw fail(500, 'Accountopslag is ongeldig; herstel een gecontroleerde back-up.'); };
  const keys = (obj, allowed) => record(obj) && Object.keys(obj).every(key => allowed.includes(key));
  if (!keys(state, ['version', 'users', 'organizations', 'memberships', 'invitations']) || state.version !== 1
    || !Array.isArray(state.users) || state.users.length > AUTH_LIMITS.users
    || !Array.isArray(state.organizations) || state.organizations.length > AUTH_LIMITS.organizations
    || !Array.isArray(state.memberships) || state.memberships.length > AUTH_LIMITS.users * AUTH_LIMITS.organizations
    || !Array.isArray(state.invitations) || state.invitations.length > AUTH_LIMITS.invitations) invalid();
  const userIds = new Set(), usernames = new Set(), orgIds = new Set(), memberships = new Set(), invitationIds = new Set();
  for (const user of state.users) {
    if (!keys(user, ['id', 'username', 'displayName', 'password', 'createdAt', 'updatedAt']) || !UUID.test(user.id)
      || userIds.has(user.id) || usernames.has(user.username) || !validDate(user.createdAt) || !validDate(user.updatedAt)) invalid();
    try { if (username(user.username) !== user.username || name(user.displayName, 'Naam') !== user.displayName) invalid(); } catch { invalid(); }
    const secret = user.password;
    if (!keys(secret, ['algorithm', 'N', 'r', 'p', 'salt', 'hash']) || secret.algorithm !== 'scrypt'
      || secret.N !== SCRYPT.N || secret.r !== SCRYPT.r || secret.p !== SCRYPT.p
      || typeof secret.salt !== 'string' || !/^[0-9a-f]{32}$/.test(secret.salt)
      || typeof secret.hash !== 'string' || !HEX.test(secret.hash)) invalid();
    userIds.add(user.id); usernames.add(user.username);
  }
  for (const org of state.organizations) {
    if (!keys(org, ['id', 'name', 'createdAt']) || !UUID.test(org.id) || orgIds.has(org.id) || !validDate(org.createdAt)) invalid();
    try { if (name(org.name, 'Organisatie') !== org.name) invalid(); } catch { invalid(); }
    orgIds.add(org.id);
  }
  for (const member of state.memberships) {
    const key = `${member?.orgId}:${member?.userId}`;
    if (!keys(member, ['orgId', 'userId', 'role', 'createdAt', 'updatedAt'])
      || !userIds.has(member.userId) || !orgIds.has(member.orgId) || !ROLES.has(member.role)
      || memberships.has(key) || !validDate(member.createdAt) || !validDate(member.updatedAt)) invalid();
    memberships.add(key);
  }
  if (state.organizations.some(org => !state.memberships.some(member => member.orgId === org.id && member.role === 'owner'))
    || (!state.users.length && state.organizations.length) || (state.users.length && !state.organizations.length)) invalid();
  for (const invite of state.invitations) {
    if (!keys(invite, ['digest', 'orgId', 'role', 'createdBy', 'createdAt', 'expiresAt']) || !HEX.test(invite.digest)
      || invitationIds.has(invite.digest) || !orgIds.has(invite.orgId) || !userIds.has(invite.createdBy)
      || !ROLES.has(invite.role) || !validDate(invite.createdAt) || !validDate(invite.expiresAt)
      || Date.parse(invite.expiresAt) <= Date.parse(invite.createdAt)
      || Date.parse(invite.expiresAt) - Date.parse(invite.createdAt) > AUTH_LIMITS.invitationMs
      || !state.memberships.some(member => member.orgId === invite.orgId && member.userId === invite.createdBy && member.role === 'owner')) invalid();
    invitationIds.add(invite.digest);
  }
  return state;
}

/** Validate a detached account document without opening storage or creating sessions. */
export function validateAccountState(value) {
  return validateState(structuredClone(value));
}

/** Local authentication domain. The caller must hold the data-directory process lock. */
export async function createAuth({ path = null, now = () => new Date().toISOString() } = {}) {
  if (path !== null && (typeof path !== 'string' || !path.trim())) throw fail(400, 'Ongeldig accountopslagpad.');
  if (typeof now !== 'function') throw fail(400, 'Ongeldige klok.');
  const storagePath = path === null ? null : resolve(path);
  let state = { version: 1, users: [], organizations: [], memberships: [], invitations: [] };
  if (storagePath) {
    try {
      const info = await lstat(storagePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > AUTH_LIMITS.fileBytes) throw fail(500, 'Accountopslag is ongeldig.');
      state = validateState(JSON.parse(await readFile(storagePath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw fail(500, 'Accountopslag kan niet veilig worden gelezen; bestaande gegevens blijven behouden.');
    }
  }
  const sessions = new Map(), attempts = new Map();
  const dummyPassword = { salt: randomBytes(16).toString('hex'), hash: randomBytes(32).toString('hex') };
  let tail = Promise.resolve(), pending = 0, loginGlobal = { start: 0, count: 0 };
  function clock() {
    const value = Date.parse(now());
    if (!Number.isFinite(value)) throw fail(500, 'Ongeldige accountklok.');
    return value;
  }
  function enqueue(action) {
    if (pending >= AUTH_LIMITS.pendingOperations) return Promise.reject(fail(503, 'Accountverwerking is bezet; probeer later opnieuw.'));
    pending += 1;
    const result = tail.then(action);
    tail = result.catch(() => {}).finally(() => { pending -= 1; });
    return result;
  }
  async function commit(next) {
    validateState(next);
    if (storagePath) {
      const temporary = `${storagePath}.${randomUUID()}.tmp`;
      let handle;
      try {
        await mkdir(dirname(storagePath), { recursive: true, mode: 0o700 });
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
        await handle.sync();
        await handle.close(); handle = null;
        await rename(temporary, storagePath);
      } catch {
        throw fail(503, 'Accountwijziging is niet opgeslagen; probeer opnieuw.');
      } finally {
        await handle?.close().catch(() => {});
        await rm(temporary, { force: true }).catch(() => {});
      }
    }
    state = next;
  }
  function pruneSessions(at) {
    for (const [key, session] of sessions) if (session.expiresAt <= at) sessions.delete(key);
  }
  function findSession(token, at = clock()) {
    pruneSessions(at);
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const current = sessions.get(digest(token));
    return current && state.users.some(user => user.id === current.userId) ? current : null;
  }
  function viewSession(current) {
    const user = state.users.find(item => item.id === current.userId);
    return { user: safeUser(user), organizations: state.memberships.filter(member => member.userId === user.id).map(member => {
      const org = state.organizations.find(item => item.id === member.orgId);
      return { id: org.id, name: org.name, role: member.role };
    }), csrf: current.csrf, expiresAt: new Date(current.expiresAt).toISOString() };
  }
  function issueSession(userId, at = clock()) {
    pruneSessions(at);
    // Bounded sessions: a new successful login evicts the oldest remaining session.
    while (sessions.size >= AUTH_LIMITS.sessions) sessions.delete(sessions.keys().next().value);
    const token = opaque(), current = { userId, csrf: randomBytes(32).toString('hex'), expiresAt: at + AUTH_LIMITS.sessionMs };
    sessions.set(digest(token), current);
    return { token, ...viewSession(current) };
  }
  function requireSession(token) {
    const current = findSession(token);
    if (!current) throw fail(401, 'Meld je opnieuw aan.');
    return current;
  }
  function authorize(token, orgId, { write = false, owner = false } = {}) {
    const current = requireSession(token);
    if (typeof orgId !== 'string' || !UUID.test(orgId)) throw fail(404, 'Organisatie niet beschikbaar.');
    const member = state.memberships.find(item => item.orgId === orgId && item.userId === current.userId);
    if (!member) throw fail(403, 'Geen toegang tot deze organisatie.');
    if ((owner && member.role !== 'owner') || (write && member.role === 'viewer')) throw fail(403, 'Je rol staat deze actie niet toe.');
    const org = state.organizations.find(item => item.id === orgId);
    return { user: safeUser(state.users.find(item => item.id === current.userId)), organization: { id: org.id, name: org.name, role: member.role } };
  }
  function loginAttempt(key, at) {
    for (const [name, entry] of attempts) if (entry.start + AUTH_LIMITS.loginWindowMs <= at) attempts.delete(name);
    if (loginGlobal.start + AUTH_LIMITS.loginWindowMs <= at) loginGlobal = { start: at, count: 0 };
    const entry = attempts.get(key) || { start: at, count: 0 };
    if (entry.count >= AUTH_LIMITS.loginPerUsername || loginGlobal.count >= AUTH_LIMITS.loginGlobal) {
      throw fail(429, 'Te veel aanmeldpogingen; probeer over 15 minuten opnieuw.');
    }
    entry.count += 1; loginGlobal.count += 1; attempts.set(key, entry);
  }
  function liveInvites(at) { return state.invitations.filter(invite => Date.parse(invite.expiresAt) > at); }
  function invitationError() { return fail(400, 'Uitnodiging is ongeldig, verlopen of al gebruikt.'); }
  function issuerAuthorized(invitation) {
    return state.memberships.some(member => member.orgId === invitation.orgId
      && member.userId === invitation.createdBy && member.role === 'owner');
  }
  function resolveInvitation(input, at = clock()) {
    if (typeof input?.inviteToken !== 'string' || !TOKEN.test(input.inviteToken)) throw invitationError();
    const key = Buffer.from(digest(input.inviteToken), 'hex');
    const invitation = liveInvites(at).find(item => timingSafeEqual(Buffer.from(item.digest, 'hex'), key));
    if (!invitation || !issuerAuthorized(invitation)) throw invitationError();
    return invitation;
  }
  function newMembership(orgId, userId, assignedRole, timestamp) {
    return { orgId, userId, role: assignedRole, createdAt: timestamp, updatedAt: timestamp };
  }
  function protectLastOwner(member, nextRole) {
    if (member.role === 'owner' && nextRole !== 'owner'
      && state.memberships.filter(item => item.orgId === member.orgId && item.role === 'owner').length <= 1) {
      throw fail(409, 'De laatste eigenaar kan niet worden verwijderd of gedegradeerd.');
    }
  }
  return Object.freeze({
    status: () => enqueue(() => ({ setupRequired: state.users.length === 0 })),
    setup: input => enqueue(async () => {
      if (state.users.length) throw fail(409, 'De eerste account is al ingesteld.');
      const values = credentials(input), organizationName = name(input.organizationName, 'Organisatienaam');
      const secret = await hashPassword(values.password), at = clock(), timestamp = new Date(at).toISOString();
      const user = { id: randomUUID(), username: values.username, displayName: values.displayName, password: secret, createdAt: timestamp, updatedAt: timestamp };
      const org = { id: randomUUID(), name: organizationName, createdAt: timestamp };
      const next = { version: 1, users: [user], organizations: [org], memberships: [newMembership(org.id, user.id, 'owner', timestamp)], invitations: [] };
      await commit(next);
      return issueSession(user.id, at);
    }),
    login: input => enqueue(async () => {
      const at = clock();
      let values, attemptKey = '__invalid__';
      try { attemptKey = username(input?.username); } catch { /* malformed names share a bounded bucket */ }
      loginAttempt(attemptKey, at);
      try { values = credentials(input); } catch { throw fail(401, 'Gebruikersnaam of wachtwoord onjuist.'); }
      const user = state.users.find(item => item.username === values.username);
      const matched = await matchesPassword(values.password, user?.password || dummyPassword);
      if (!matched || !user) throw fail(401, 'Gebruikersnaam of wachtwoord onjuist.');
      attempts.delete(values.username);
      return issueSession(user.id);
    }),
    session: token => enqueue(() => { const current = findSession(token); return current ? viewSession(current) : null; }),
    logout: token => enqueue(() => { if (typeof token === 'string' && TOKEN.test(token)) sessions.delete(digest(token)); }),
    authorize: (token, orgId, options) => enqueue(() => authorize(token, orgId, options)),
    createOrganization: (token, input) => enqueue(async () => {
      const current = requireSession(token), orgName = name(input?.name, 'Organisatienaam');
      if (state.organizations.length >= AUTH_LIMITS.organizations) throw fail(409, 'Het maximum aantal organisaties is bereikt.');
      const timestamp = new Date(clock()).toISOString(), org = { id: randomUUID(), name: orgName, createdAt: timestamp };
      const next = structuredClone(state);
      next.organizations.push(org); next.memberships.push(newMembership(org.id, current.userId, 'owner', timestamp));
      await commit(next);
      return { id: org.id, name: org.name, role: 'owner' };
    }),
    invite: (token, orgId, input) => enqueue(async () => {
      const access = authorize(token, orgId, { owner: true }), assignedRole = role(input?.role), at = clock();
      const invitations = liveInvites(at);
      if (invitations.length >= AUTH_LIMITS.invitations) throw fail(409, 'Het maximum aantal uitnodigingen is bereikt.');
      const inviteToken = opaque(), expiresAt = new Date(at + AUTH_LIMITS.invitationMs).toISOString();
      invitations.push({ digest: digest(inviteToken), orgId, role: assignedRole, createdBy: access.user.id, createdAt: new Date(at).toISOString(), expiresAt });
      await commit({ ...structuredClone(state), invitations });
      return { id: digest(inviteToken), token: inviteToken, expiresAt, role: assignedRole };
    }),
    invitations: (token, orgId) => enqueue(() => {
      authorize(token, orgId, { owner: true });
      return liveInvites(clock()).filter(item => item.orgId === orgId && issuerAuthorized(item)).map(item => ({
        id: item.digest, role: item.role, createdAt: item.createdAt, expiresAt: item.expiresAt,
      }));
    }),
    revokeInvitation: (token, orgId, inviteId) => enqueue(async () => {
      authorize(token, orgId, { owner: true });
      if (typeof inviteId !== 'string' || !HEX.test(inviteId)
        || !state.invitations.some(item => item.orgId === orgId && item.digest === inviteId)) {
        throw fail(404, 'Uitnodiging niet beschikbaar.');
      }
      const next = structuredClone(state);
      next.invitations = next.invitations.filter(item => item.orgId !== orgId || item.digest !== inviteId);
      await commit(next);
      return { revoked: true };
    }),
    invitePreview: (token, input) => enqueue(() => {
      const current = requireSession(token), invitation = resolveInvitation(input);
      const organization = state.organizations.find(item => item.id === invitation.orgId);
      const member = state.memberships.find(item => item.orgId === invitation.orgId && item.userId === current.userId);
      return { organization: { id: organization.id, name: organization.name }, role: member?.role || invitation.role,
        expiresAt: invitation.expiresAt, alreadyMember: !!member };
    }),
    acceptInvite: (token, input) => enqueue(async () => {
      const current = requireSession(token), at = clock(), invitation = resolveInvitation(input, at);
      const organization = state.organizations.find(item => item.id === invitation.orgId);
      const member = state.memberships.find(item => item.orgId === invitation.orgId && item.userId === current.userId);
      const next = structuredClone(state);
      if (!member) next.memberships.push(newMembership(invitation.orgId, current.userId, invitation.role, new Date(at).toISOString()));
      next.invitations = next.invitations.filter(item => item.digest !== invitation.digest && Date.parse(item.expiresAt) > at);
      await commit(next);
      return { organization: { id: organization.id, name: organization.name, role: member?.role || invitation.role }, alreadyMember: !!member };
    }),
    register: input => enqueue(async () => {
      const invitation = resolveInvitation(input);
      const values = credentials(input);
      if (state.users.some(user => user.username === values.username)) throw fail(409, 'Deze gebruikersnaam is niet beschikbaar.');
      if (state.users.length >= AUTH_LIMITS.users) throw fail(409, 'Het maximum aantal accounts is bereikt.');
      const secret = await hashPassword(values.password), finishedAt = clock();
      if (Date.parse(invitation.expiresAt) <= finishedAt) throw invitationError();
      const timestamp = new Date(finishedAt).toISOString();
      const user = { id: randomUUID(), username: values.username, displayName: values.displayName, password: secret, createdAt: timestamp, updatedAt: timestamp };
      const next = structuredClone(state);
      next.users.push(user); next.memberships.push(newMembership(invitation.orgId, user.id, invitation.role, timestamp));
      next.invitations = next.invitations.filter(item => item.digest !== invitation.digest && Date.parse(item.expiresAt) > finishedAt);
      await commit(next);
      return issueSession(user.id, finishedAt);
    }),
    members: (token, orgId) => enqueue(() => {
      authorize(token, orgId, { owner: true });
      return state.memberships.filter(member => member.orgId === orgId).map(member => ({
        ...safeUser(state.users.find(user => user.id === member.userId)), role: member.role,
      }));
    }),
    setRole: (token, orgId, userId, input) => enqueue(async () => {
      authorize(token, orgId, { owner: true });
      const nextRole = role(input?.role), member = state.memberships.find(item => item.orgId === orgId && item.userId === userId);
      if (!member) throw fail(404, 'Lid niet gevonden.');
      protectLastOwner(member, nextRole);
      const next = structuredClone(state), target = next.memberships.find(item => item.orgId === orgId && item.userId === userId);
      target.role = nextRole; target.updatedAt = new Date(clock()).toISOString();
      if (nextRole !== 'owner') next.invitations = next.invitations.filter(item => item.orgId !== orgId || item.createdBy !== userId);
      await commit(next);
      return { ...safeUser(state.users.find(user => user.id === userId)), role: nextRole };
    }),
    removeMember: (token, orgId, userId) => enqueue(async () => {
      authorize(token, orgId, { owner: true });
      const member = state.memberships.find(item => item.orgId === orgId && item.userId === userId);
      if (!member) throw fail(404, 'Lid niet gevonden.');
      protectLastOwner(member, null);
      const next = structuredClone(state);
      next.memberships = next.memberships.filter(item => item.orgId !== orgId || item.userId !== userId);
      next.invitations = next.invitations.filter(item => item.orgId !== orgId || item.createdBy !== userId);
      await commit(next);
      return { removed: true };
    }),
    changePassword: (token, input) => enqueue(async () => {
      const current = requireSession(token), user = state.users.find(item => item.id === current.userId);
      let oldPassword;
      try { oldPassword = password(input?.currentPassword); } catch { throw fail(400, 'Huidig wachtwoord onjuist.'); }
      const nextPassword = password(input?.newPassword);
      loginAttempt(user.username, clock());
      if (!await matchesPassword(oldPassword, user.password)) throw fail(400, 'Huidig wachtwoord onjuist.');
      const secret = await hashPassword(nextPassword);
      requireSession(token);
      const next = structuredClone(state), updated = next.users.find(item => item.id === user.id);
      updated.password = secret; updated.updatedAt = new Date(clock()).toISOString();
      await commit(next);
      // Invalidate every device only after durable success; return a freshly generated session.
      for (const [key, value] of sessions) if (value.userId === user.id) sessions.delete(key);
      attempts.delete(user.username);
      return issueSession(user.id);
    }),
  });
}
