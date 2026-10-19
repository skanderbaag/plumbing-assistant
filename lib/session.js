// Signed login tokens. After a correct PIN, login.js hands the browser a token; the browser
// sends it back on every request, and the server works out WHO is asking from the token
// instead of trusting a name or id the browser claims. Signed with SESSION_SECRET (HMAC-SHA256),
// so it can't be forged or edited without that secret, which only lives in Vercel.
import crypto from 'node:crypto';

const CREW_LIFETIME_SECONDS = 30 * 24 * 60 * 60;   // crew stay logged in ~30 days
const ADMIN_LIFETIME_SECONDS = 12 * 60 * 60;       // admin roles must log in again after 12 hours
const PIN_CHANGE_LIFETIME_SECONDS = 10 * 60;       // "set your new PIN" tokens expire in 10 minutes

function secret() {
    const s = process.env.SESSION_SECRET;
    if (!s || s.length < 32) throw new Error('SESSION_SECRET is missing or too short');
    return s;
}

function sign(payloadB64) {
    return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

// adm = "this token was issued to an admin role" (short-lived). The role is ALSO re-checked
// in the database on every admin request, so demoting someone takes effect immediately.
function createSession(userId, isAdmin) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: userId, adm: !!isAdmin, iat: now, exp: now + (isAdmin ? ADMIN_LIFETIME_SECONDS : CREW_LIFETIME_SECONDS) };
    return encode(payload);
}

// A token that can ONLY be used to set a new PIN (chg = true). Every normal endpoint rejects it,
// so someone who has typed their old PIN but not yet chosen a new one can't get into anything.
function createPinChangeSession(userId) {
    const now = Math.floor(Date.now() / 1000);
    return encode({ sub: userId, adm: false, chg: true, iat: now, exp: now + PIN_CHANGE_LIFETIME_SECONDS });
}

function encode(payload) {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${payloadB64}.${sign(payloadB64)}`;
}

// Returns the token's payload, or null if there's no token / it's forged / it's expired.
// Throws only if the server itself is misconfigured (no SESSION_SECRET).
function verifySession(req) {
    const match = /^Bearer (.+)$/.exec(req.headers?.authorization || '');
    if (!match) return null;
    const parts = match[1].split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payloadB64, sig] = parts;

    const given = Buffer.from(sig);
    const expected = Buffer.from(sign(payloadB64));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

    let payload;
    try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()); } catch { return null; }
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}

export { createSession, createPinChangeSession, verifySession, CREW_LIFETIME_SECONDS, ADMIN_LIFETIME_SECONDS, PIN_CHANGE_LIFETIME_SECONDS };
