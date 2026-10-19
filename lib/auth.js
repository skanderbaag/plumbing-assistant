// Who is asking, and are they allowed? Every endpoint that needs to know calls requireUser()
// (any logged-in crew member) or requireAdmin() (admin roles only). Identity comes from the
// signed token (lib/session.js) - never from a name or id the browser sends.
import { dbFetch } from './db.js';
import { verifySession } from './session.js';

// The ONE list of admin roles. Compared trimmed + lowercase, so 'Owner', 'owner' and ' OWNER '
// all match. 'manager' is included because it's an existing role that already has admin access.
const ADMIN_ROLES = ['owner', 'gm', 'admin', 'production manager', 'manager'];

function isAdminRole(role) {
    return ADMIN_ROLES.includes(String(role || '').trim().toLowerCase());
}

async function getUserById(id) {
    if (!id) return null;
    const res = await dbFetch(`plumbers?id=eq.${encodeURIComponent(id)}&select=id,name,role`);
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
}

// Returns { id, name, role, is_admin, session } for a valid logged-in user. Otherwise sends
// the error response itself (401/500) and returns null - callers just `if (!user) return;`.
async function requireUser(req, res) {
    let session;
    try {
        session = verifySession(req);
    } catch (err) {
        console.error('Session check failed:', err.message);
        res.status(500).json({ error: 'Server is not configured correctly.' });
        return null;
    }
    if (!session) {
        res.status(401).json({ error: 'Please log in again.' });
        return null;
    }
    if (session.chg) {
        // Mid-way through setting a new PIN: this token can't be used for anything else.
        res.status(403).json({ error: 'Finish setting your new PIN first.' });
        return null;
    }
    // Look the person up on every request so a deleted or demoted account loses access at once.
    const user = await getUserById(session.sub);
    if (!user) {
        res.status(401).json({ error: 'Please log in again.' });
        return null;
    }
    return { ...user, is_admin: isAdminRole(user.role), session };
}

// For the "set your new PIN" step only: needs a token issued for exactly that purpose.
async function requirePinChangeUser(req, res) {
    let session;
    try {
        session = verifySession(req);
    } catch (err) {
        console.error('Session check failed:', err.message);
        res.status(500).json({ error: 'Server is not configured correctly.' });
        return null;
    }
    if (!session || !session.chg) {
        res.status(401).json({ error: 'Please log in again.' });
        return null;
    }
    const user = await getUserById(session.sub);
    if (!user) {
        res.status(401).json({ error: 'Please log in again.' });
        return null;
    }
    return { ...user, is_admin: isAdminRole(user.role) };
}

// Admin roles only, and only with a token that was issued to an admin (the short-lived kind).
async function requireAdmin(req, res) {
    const user = await requireUser(req, res);
    if (!user) return null;
    if (!user.is_admin) {
        res.status(403).json({ error: 'Not allowed.' });
        return null;
    }
    if (!user.session.adm) {
        // Promoted since they logged in: they hold a long-lived crew token. Make them log in again.
        res.status(401).json({ error: 'Please log in again to use admin features.' });
        return null;
    }
    return user;
}

export { ADMIN_ROLES, isAdminRole, requireUser, requireAdmin, requirePinChangeUser };
