// Run: node scripts/test-auth.mjs
// Checks the login-token and admin-gate logic with a fake database (no network, no real secrets).
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';

const PEOPLE = {
    'owner-id': { id: 'owner-id', name: 'Trevor', role: 'Owner' },
    'gm-id': { id: 'gm-id', name: 'Travis', role: 'GM' },
    'mgr-id': { id: 'mgr-id', name: 'Shamus', role: 'manager' },
    'crew-id': { id: 'crew-id', name: 'Micah', role: 'plumber' },
    'helper-id': { id: 'helper-id', name: 'Titus', role: 'helper' }
};
globalThis.fetch = async (url) => {
    const id = new URL(url).searchParams.get('id')?.replace('eq.', '');
    const person = PEOPLE[id];
    return { ok: true, json: async () => (person ? [person] : []) };
};

const { createSession, verifySession } = await import('../lib/session.js');
const { requireUser, requireAdmin, isAdminRole } = await import('../lib/auth.js');

let failures = 0;
function check(label, ok) { console.log((ok ? 'PASS  ' : 'FAIL  ') + label); if (!ok) failures++; }
const reqWith = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
function fakeRes() { return { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; }
async function status(fn, token) { const res = fakeRes(); const out = await fn(reqWith(token), res); return out ? 200 : res.code; }

// Roles
for (const r of ['Owner', 'owner', ' OWNER ', 'GM', 'gm', 'admin', 'Production Manager', 'manager']) check(`isAdminRole("${r}") is true`, isAdminRole(r));
for (const r of ['plumber', 'helper', '', null, undefined, 'apprentice']) check(`isAdminRole(${JSON.stringify(r)}) is false`, !isAdminRole(r));

// Token basics
const crewToken = createSession('crew-id', false);
const adminToken = createSession('owner-id', true);
check('valid token verifies', verifySession(reqWith(crewToken))?.sub === 'crew-id');
check('crew token lasts about 30 days', (verifySession(reqWith(crewToken)).exp - verifySession(reqWith(crewToken)).iat) === 30 * 24 * 3600);
check('admin token lasts 12 hours', (verifySession(reqWith(adminToken)).exp - verifySession(reqWith(adminToken)).iat) === 12 * 3600);
check('no token -> null', verifySession(reqWith(null)) === null);
check('garbage token -> null', verifySession(reqWith('not.a.token')) === null && verifySession(reqWith('abc')) === null);

// Tampering: swap the payload to claim a different user / admin, keeping the old signature
const [, sig] = crewToken.split('.');
const forgedPayload = Buffer.from(JSON.stringify({ sub: 'owner-id', adm: true, iat: 1, exp: 9999999999 })).toString('base64url');
check('forged payload rejected', verifySession(reqWith(`${forgedPayload}.${sig}`)) === null);
check('tampered signature rejected', verifySession(reqWith(crewToken.slice(0, -2) + 'xx')) === null);

// Expired
const realNow = Date.now;
Date.now = () => realNow() + 31 * 24 * 3600 * 1000;
check('crew token expired after 31 days', verifySession(reqWith(crewToken)) === null);
Date.now = () => realNow() + 13 * 3600 * 1000;
check('admin token expired after 13 hours', verifySession(reqWith(adminToken)) === null);
check('crew token still fine after 13 hours', verifySession(reqWith(crewToken)) !== null);
Date.now = realNow;

// Gates
check('requireUser: no token -> 401', (await status(requireUser, null)) === 401);
check('requireUser: crew token -> ok', (await status(requireUser, crewToken)) === 200);
check('requireAdmin: no token -> 401', (await status(requireAdmin, null)) === 401);
check('requireAdmin: crew token -> 403', (await status(requireAdmin, crewToken)) === 403);
check('requireAdmin: helper token -> 403', (await status(requireAdmin, createSession('helper-id', false))) === 403);
for (const id of ['owner-id', 'gm-id', 'mgr-id']) check(`requireAdmin: ${id} admin token -> ok`, (await status(requireAdmin, createSession(id, true))) === 200);
check('requireAdmin: admin role but long-lived crew-style token -> 401 (must re-login)', (await status(requireAdmin, createSession('owner-id', false))) === 401);
check('requireAdmin: crew member holding an admin-flagged token -> 403 (role checked in DB, not trusted from token)', (await status(requireAdmin, createSession('crew-id', true))) === 403);
check('requireUser: token for a deleted user -> 401', (await status(requireUser, createSession('ghost-id', false))) === 401);

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
