// Handles crew login server-side so PINs never travel to or through the browser.
// Uses the service-role key via lib/db.js - the `plumbers` table itself has NO
// anon-accessible policies (see supabase_lock_down_plumbers.sql).
import { dbFetch } from '../lib/db.js';
import { createSession } from '../lib/session.js';
import { isAdminRole, requireUser } from '../lib/auth.js';

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

    if (req.method === 'POST') {
        const { name, pin } = req.body;
        if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });

        const response = await dbFetch(
            `plumbers?name=eq.${encodeURIComponent(name)}&pin=eq.${encodeURIComponent(pin)}&select=id,name,role`
        );
        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            return res.status(401).json({ error: 'Incorrect PIN' });
        }

        // Only id/name/role/is_admin/token ever leave this function - the pin column never does.
        const user = data[0];
        const is_admin = isAdminRole(user.role);
        let token;
        try {
            token = createSession(user.id, is_admin);
        } catch (err) {
            console.error('Could not create session:', err.message);
            return res.status(500).json({ error: 'Login is temporarily unavailable.' });
        }
        return res.status(200).json({ id: user.id, name: user.name, role: user.role, is_admin, token });
    }

    res.status(405).end();
}
