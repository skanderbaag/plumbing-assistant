// Run: node scripts/test-login.mjs
// Exercises the real login handler against an in-memory fake database: PIN hashing and upgrade,
// lockouts, admin 6-8 digit rule, forced PIN change. No network, no real secrets.
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.PIN_PEPPER = 'pepper-pepper-pepper-pepper-pepper-12345';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';

const db = {
    plumbers: [
        { id: 'u-micah', name: 'Micah', role: 'plumber', pin: '1111', pin_hash: null, pin_salt: null },
        { id: 'u-caleb', name: 'Caleb', role: 'plumber', pin: '1111', pin_hash: null, pin_salt: null },
        { id: 'u-titus', name: 'Titus', role: 'helper', pin: '2222', pin_hash: null, pin_salt: null },
        { id: 'u-trevor', name: 'Trevor', role: 'Owner', pin: '3333', pin_hash: null, pin_salt: null },
        { id: 'u-travis', name: 'Travis', role: 'GM', pin: '735201', pin_hash: null, pin_salt: null }
    ],
    login_attempts: []
};
let attemptsTableBroken = false;
let fakeNow = Date.now();
Date.now = () => fakeNow;

globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const table = u.pathname.split('/rest/v1/')[1];
    const method = opts.method || 'GET';
    if (table === 'login_attempts' && attemptsTableBroken) return { ok: false, status: 500, json: async () => ({}) };
    const filters = [];
    for (const [k, v] of u.searchParams) {
        if (['select', 'order', 'limit'].includes(k)) continue;
        const m = /^(eq|gte)\.(.*)$/.exec(v);
        filters.push([k, m[1], m[2]]);
    }
    const match = row => filters.every(([k, op, val]) => (op === 'eq' ? String(row[k]) === val : String(row[k]) >= val));
    const rows = db[table];
    if (method === 'GET') {
        let out = rows.filter(match);
        const limit = u.searchParams.get('limit');
        if (limit) out = out.slice(0, Number(limit));
        return { ok: true, status: 200, json: async () => out.map(r => ({ ...r })) };
    }
    if (method === 'POST') { rows.push({ ...JSON.parse(opts.body), created_at: new Date(fakeNow).toISOString() }); return { ok: true, status: 201, json: async () => [] }; }
    if (method === 'PATCH') { const body = JSON.parse(opts.body); rows.filter(match).forEach(r => Object.assign(r, body)); return { ok: true, status: 204, json: async () => [] }; }
    if (method === 'DELETE') { db[table] = rows.filter(r => !match(r)); return { ok: true, status: 204, json: async () => [] }; }
};

const { default: login } = await import('../api/login.js');
const { requireUser, requireAdmin } = await import('../lib/auth.js');
const { validateNewPin } = await import('../lib/pin.js');

let failures = 0;
const check = (label, ok) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label); if (!ok) failures++; };
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
async function call(method, query, body, headers = {}) { const res = fakeRes(); await login({ method, query, body, headers }, res); return res; }
const logIn = (name, pin, ip = '10.0.0.1') => call('POST', {}, { name, pin }, { 'x-forwarded-for': ip });
const bearer = t => ({ authorization: 'Bearer ' + t });
const row = id => db.plumbers.find(p => p.id === id);
const gate = async (fn, token) => { const res = fakeRes(); const out = await fn({ headers: bearer(token) }, res); return out ? 200 : res.code; };

// ---- crew login, hashing, upgrade ----
let r = await logIn('Micah', '1111');
check('crew legacy PIN logs in', r.code === 200 && r.body.token && r.body.is_admin === false);
check('response never contains PIN data', !('pin' in r.body) && !('pin_hash' in r.body) && !('pin_salt' in r.body));
check('PIN was upgraded to a hash', row('u-micah').pin_hash && row('u-micah').pin_salt);
check('plain-text PIN was blanked', row('u-micah').pin === null);
check('stored hash does not contain the PIN', !JSON.stringify(row('u-micah')).includes('1111'));
r = await logIn('Micah', '1111'); check('logs in again using the hash', r.code === 200 && r.body.token);
r = await logIn('Caleb', '1111'); await logIn('Caleb', '1111');
check('same PIN for two people -> different hashes (salted)', row('u-caleb').pin_hash && row('u-caleb').pin_hash !== row('u-micah').pin_hash);
r = await logIn('Micah', '9999'); check('wrong PIN -> 401', r.code === 401);
r = await logIn('Nobody', '1111'); check('unknown name -> 401', r.code === 401);
r = await logIn('Micah', '12ab'); check('non-numeric PIN -> 401', r.code === 401);
r = await logIn('Micah', '1111'); check('correct PIN still works after a few wrong ones', r.code === 200);

// ---- lockout ----
db.login_attempts.length = 0;
for (let i = 0; i < 5; i++) await logIn('Titus', '0000');
r = await logIn('Titus', '2222'); check('5 wrong tries -> even the CORRECT PIN is refused (429)', r.code === 429);
r = await logIn('Micah', '1111', '10.0.0.2'); check('lockout is per person: others unaffected', r.code === 200);
fakeNow += 16 * 60 * 1000;
r = await logIn('Titus', '2222'); check('lockout ends after 15 minutes', r.code === 200);
for (let i = 0; i < 3; i++) await logIn('Micah', '0000');
await logIn('Micah', '1111');
for (let i = 0; i < 3; i++) await logIn('Micah', '0000');
r = await logIn('Micah', '1111'); check('a successful login resets the failure count', r.code === 200);

db.login_attempts.length = 0;
for (let i = 0; i < 20; i++) await logIn('Name' + i, '0000', '6.6.6.6');
r = await logIn('Micah', '1111', '6.6.6.6'); check('20 failures from one address -> that address locked out', r.code === 429);
r = await logIn('Micah', '1111', '7.7.7.7'); check('a different address is fine', r.code === 200);

db.login_attempts.length = 0; attemptsTableBroken = true;
r = await logIn('Micah', '1111'); check('if the attempt log is down, login still works (fail open)', r.code === 200);
attemptsTableBroken = false;

// ---- admin rule: 6-8 digits ----
r = await logIn('Travis', '735201');
check('admin with a 6-digit PIN logs in normally', r.code === 200 && r.body.is_admin && !r.body.must_change_pin);
check('...and that PIN was hashed', row('u-travis').pin === null && row('u-travis').pin_hash);

r = await logIn('Trevor', '3333');
const chg = r.body;
check('admin with a 4-digit PIN must change it', r.code === 200 && chg.must_change_pin === true && chg.min_digits === 6 && chg.token);
check('...and gets no normal login data', !('is_admin' in chg) && !('id' in chg));
check('...old PIN not touched yet', row('u-trevor').pin === '3333' && !row('u-trevor').pin_hash);
check('PIN-change token is refused by every normal endpoint', (await gate(requireUser, chg.token)) === 403 && (await gate(requireAdmin, chg.token)) === 403);
r = await call('GET', { action: 'me' }, null, bearer(chg.token)); check('...including the "who am I" check', r.code === 403);

const change = (token, pin) => call('POST', { action: 'change_pin' }, { new_pin: pin }, token ? bearer(token) : {});
r = await change(null, '482916'); check('change PIN without a token -> 401', r.code === 401);
const crewToken = (await logIn('Micah', '1111')).body.token;
r = await change(crewToken, '482916'); check('change PIN with a normal login token -> 401', r.code === 401);
for (const [label, pin] of [['4 digits', '1234'], ['5 digits', '48291'], ['9 digits', '482916573'], ['letters', 'abcdef'], ['all the same', '111111'], ['straight run up', '123456'], ['straight run down', '987654'], ['mixed text', '48291a']]) {
    r = await change(chg.token, pin); check(`admin new PIN rejected: ${label}`, r.code === 400 && r.body.error);
}
check('nothing saved by the rejected attempts', row('u-trevor').pin === '3333' && !row('u-trevor').pin_hash);
r = await change(chg.token, '482916');
check('valid 6-digit PIN accepted and logs straight in', r.code === 200 && r.body.is_admin && r.body.token);
check('...new token works as an admin', (await gate(requireAdmin, r.body.token)) === 200);
check('...PIN stored hashed, old plain text blanked', row('u-trevor').pin === null && row('u-trevor').pin_hash);
r = await logIn('Trevor', '3333'); check('old 4-digit PIN no longer works', r.code === 401);
r = await logIn('Trevor', '482916'); check('new PIN logs in with no further prompts', r.code === 200 && !r.body.must_change_pin && r.body.is_admin);

// ---- someone promoted to admin who has a short hashed PIN ----
row('u-micah').role = 'production manager';
r = await logIn('Micah', '1111');
check('promoted to admin with a short (hashed) PIN -> must change', r.code === 200 && r.body.must_change_pin === true);
row('u-micah').role = 'plumber';

// ---- the pepper really matters ----
const stolen = { ...row('u-trevor') };
process.env.PIN_PEPPER = 'a-different-pepper-a-different-pepper-99';
const { verifyHashedPin } = await import('../lib/pin.js');
check('a stolen hash does NOT verify without the real pepper', (await verifyHashedPin('482916', stolen.pin_hash, stolen.pin_salt)) === false);
process.env.PIN_PEPPER = 'pepper-pepper-pepper-pepper-pepper-12345';
check('...but verifies with it', (await verifyHashedPin('482916', stolen.pin_hash, stolen.pin_salt)) === true);

// ---- other ----
r = await call('GET', { action: 'names' }, null); check('names list unchanged and has no PINs', r.code === 200 && r.body.every(p => Object.keys(p).join() === 'name'));
check('validateNewPin: crew may use 4 digits', validateNewPin('4821', false) === null && validateNewPin('1111', false) !== null);

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
