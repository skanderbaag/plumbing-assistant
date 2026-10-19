// Crew login, handled on the server so PINs never travel to or through the browser.
// ?action=names (GET, public list for the dropdown) | me (GET) | change_pin (POST) | (no action) POST = log in
import { dbFetch } from '../lib/db.js';
import { createSession, createPinChangeSession } from '../lib/session.js';
import { isAdminRole, requireUser, requirePinChangeUser } from '../lib/auth.js';
import { hashPin, verifyHashedPin, verifyLegacyPin, looksLikePin, validateNewPin, ADMIN_MIN_DIGITS } from '../lib/pin.js';

// Online guessing protection: a 4-digit PIN has only 10,000 combinations, so wrong tries are limited.
const LOCKOUT_MINUTES = 15;
const MAX_FAILS_PER_NAME = 5;
const MAX_FAILS_PER_IP = 20;

function clientIp(req) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || String(req.headers?.['x-real-ip'] || '') || null;
}

const windowStart = () => encodeURIComponent(new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString());

async function countRecentFailures(column, value, limit) {
    const r = await dbFetch(`login_attempts?${column}=eq.${encodeURIComponent(value)}&success=eq.false&created_at=gte.${windowStart()}&select=id&limit=${limit}`);
    if (!r.ok) throw new Error(`login_attempts lookup failed (${r.status})`);
    const rows = await r.json();
    return Array.isArray(rows) ? rows.length : 0;
}

// If the attempt log is unreachable we log it and let people in rather than lock the whole crew out.
async function isLockedOut(name, ip) {
    try {
        if (await countRecentFailures('name', name, MAX_FAILS_PER_NAME) >= MAX_FAILS_PER_NAME) return true;
        if (ip && await countRecentFailures('ip', ip, MAX_FAILS_PER_IP) >= MAX_FAILS_PER_IP) return true;
    } catch (err) {
        console.error('Lockout check skipped:', err.message);
    }
    return false;
}

async function recordAttempt(name, ip, success) {
    try {
        await dbFetch('login_attempts', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ name, ip, success })
        });
        if (success) await dbFetch(`login_attempts?name=eq.${encodeURIComponent(name)}&success=eq.false`, { method: 'DELETE' });
    } catch (err) {
        console.error('Could not record login attempt:', err.message);
    }
}

async function savePinHash(userId, pin) {
    const { pin_hash, pin_salt } = await hashPin(pin);
    const r = await dbFetch(`plumbers?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        // The old plain-text copy is blanked in the same single update that stores the hash.
        body: JSON.stringify({ pin_hash, pin_salt, pin: null })
    });
    if (!r.ok) throw new Error(`Could not save PIN (${r.status})`);
}

function loginPayload(user) {
    const is_admin = isAdminRole(user.role);
    return { id: user.id, name: user.name, role: user.role, is_admin, token: createSession(user.id, is_admin) };
}

export default async function handler(req, res) {
    if (req.method === 'GET' && req.query.action === 'names') {
        // Only ever returns names, for the login dropdown - never pin, role, or id.
        const response = await dbFetch('plumbers?select=name&order=name');
        const data = await response.json();
        return res.status(200).json(Array.isArray(data) ? data.map(p => ({ name: p.name })) : []);
    }

    // "Am I still logged in?" - lets the app restore a session from a saved token on page load.
    if (req.method === 'GET' && req.query.action === 'me') {
        const user = await requireUser(req, res);
        if (!user) return;
        return res.status(200).json({ id: user.id, name: user.name, role: user.role, is_admin: user.is_admin });
    }

    // Step two of a forced PIN change: choose the new PIN, then you're logged straight in.
    if (req.method === 'POST' && req.query.action === 'change_pin') {
        const user = await requirePinChangeUser(req, res);
        if (!user) return;
        const newPin = String(req.body?.new_pin ?? '');
        const problem = validateNewPin(newPin, user.is_admin);
        if (problem) return res.status(400).json({ error: problem });
        try {
            await savePinHash(user.id, newPin);
            return res.status(200).json(loginPayload(user));
        } catch (err) {
            console.error('PIN change failed:', err.message);
            return res.status(500).json({ error: 'Could not save your new PIN. Please try again.' });
        }
    }

    if (req.method === 'POST') {
        const name = String(req.body?.name ?? '').slice(0, 100);
        const pin = String(req.body?.pin ?? '');
        if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
        const ip = clientIp(req);

        if (await isLockedOut(name, ip)) {
            return res.status(429).json({ error: `Too many incorrect tries. Please wait ${LOCKOUT_MINUTES} minutes and try again.` });
        }

        const r = await dbFetch(`plumbers?name=eq.${encodeURIComponent(name)}&select=id,name,role,pin,pin_hash,pin_salt`);
        const candidates = r.ok ? await r.json() : [];

        let user = null;
        let wasLegacy = false;
        if (Array.isArray(candidates) && looksLikePin(pin)) {
            for (const c of candidates) {
                if (c.pin_hash) {
                    if (await verifyHashedPin(pin, c.pin_hash, c.pin_salt)) { user = c; break; }
                } else if (verifyLegacyPin(pin, c.pin)) {
                    user = c; wasLegacy = true; break;
                }
            }
        }

        if (!user) {
            await recordAttempt(name, ip, false);
            return res.status(401).json({ error: 'Incorrect PIN' });
        }
        await recordAttempt(name, ip, true);

        try {
            // Admin roles need a 6-8 digit PIN. If they typed a shorter one, they must pick a new one first.
            if (isAdminRole(user.role) && pin.length < ADMIN_MIN_DIGITS) {
                return res.status(200).json({ must_change_pin: true, name: user.name, min_digits: ADMIN_MIN_DIGITS, token: createPinChangeSession(user.id) });
            }
            // First login since hashing was added: store the hash and blank the plain-text PIN.
            if (wasLegacy) {
                try { await savePinHash(user.id, pin); } catch (err) { console.error('PIN upgrade skipped:', err.message); }
            }
            // Only id/name/role/is_admin/token ever leave this function - never any PIN data.
            return res.status(200).json(loginPayload(user));
        } catch (err) {
            console.error('Could not create session:', err.message);
            return res.status(500).json({ error: 'Login is temporarily unavailable.' });
        }
    }

    res.status(405).end();
}
