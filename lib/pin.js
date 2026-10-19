// PIN storage and rules. PINs are never stored as typed: each is run through HMAC with a secret
// "pepper" (PIN_PEPPER, lives only in Vercel) and then scrypt with a per-person random salt.
// Why the pepper matters: a 4-digit PIN has only 10,000 possibilities, so a stolen database alone
// could be brute-forced in a blink - but without the pepper the stolen hashes are useless.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const ADMIN_MIN_DIGITS = 6;
const CREW_MIN_DIGITS = 4;
const MAX_DIGITS = 8;

function pepper() {
    const p = process.env.PIN_PEPPER;
    if (!p || p.length < 32) throw new Error('PIN_PEPPER is missing or too short');
    return p;
}

async function derive(pin, salt) {
    const keyed = crypto.createHmac('sha256', pepper()).update(String(pin)).digest();
    return scrypt(keyed, salt, 32);
}

async function hashPin(pin) {
    const salt = crypto.randomBytes(16);
    const hash = await derive(pin, salt);
    return { pin_hash: hash.toString('base64url'), pin_salt: salt.toString('base64url') };
}

async function verifyHashedPin(pin, pin_hash, pin_salt) {
    if (!pin_hash || !pin_salt) return false;
    const expected = Buffer.from(pin_hash, 'base64url');
    const actual = await derive(pin, Buffer.from(pin_salt, 'base64url'));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// For people who haven't logged in since hashing was added: their PIN is still stored as typed.
function verifyLegacyPin(pin, stored) {
    if (typeof stored !== 'string' || !stored) return false;
    const a = Buffer.from(String(pin));
    const b = Buffer.from(stored);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function looksLikePin(pin) {
    return typeof pin === 'string' && new RegExp(`^\\d{${CREW_MIN_DIGITS},${MAX_DIGITS}}$`).test(pin);
}

function minDigitsFor(isAdmin) {
    return isAdmin ? ADMIN_MIN_DIGITS : CREW_MIN_DIGITS;
}

// Returns an error message for a PIN someone is trying to SET, or null if it's acceptable.
function validateNewPin(pin, isAdmin) {
    const min = minDigitsFor(isAdmin);
    if (typeof pin !== 'string' || !/^\d+$/.test(pin)) return 'A PIN can only contain numbers.';
    if (pin.length < min || pin.length > MAX_DIGITS) {
        return isAdmin ? `Admin PINs must be ${ADMIN_MIN_DIGITS}-${MAX_DIGITS} digits.` : `PINs must be ${CREW_MIN_DIGITS}-${MAX_DIGITS} digits.`;
    }
    if (/^(\d)\1+$/.test(pin)) return 'That PIN is too easy to guess (all the same number).';
    const digits = [...pin].map(Number);
    const step = digits[1] - digits[0];
    if ((step === 1 || step === -1) && digits.every((d, i) => i === 0 || d - digits[i - 1] === step)) {
        return 'That PIN is too easy to guess (a straight run of numbers).';
    }
    return null;
}

export { hashPin, verifyHashedPin, verifyLegacyPin, looksLikePin, validateNewPin, minDigitsFor, ADMIN_MIN_DIGITS, CREW_MIN_DIGITS, MAX_DIGITS };
