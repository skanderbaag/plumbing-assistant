// Handles crew login server-side so PINs never travel to or through the browser.
// Uses the Supabase service role key, which bypasses Row Level Security - the `plumbers`
// table itself should have NO anon-accessible policies (see supabase_lock_down_plumbers.sql).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function serviceHeaders() {
    return {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
    };
}

export default async function handler(req, res) {
    if (req.method === 'GET' && req.query.action === 'names') {
        // Only ever returns names, for the login dropdown - never pin, role, or id.
        const response = await fetch(`${SUPABASE_URL}/rest/v1/plumbers?select=name&order=name`, {
            headers: serviceHeaders()
        });
        const data = await response.json();
        return res.status(200).json(Array.isArray(data) ? data.map(p => ({ name: p.name })) : []);
    }

    if (req.method === 'POST') {
        const { name, pin } = req.body;
        if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });

        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/plumbers?name=eq.${encodeURIComponent(name)}&pin=eq.${encodeURIComponent(pin)}&select=id,name,role`,
            { headers: serviceHeaders() }
        );
        const data = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
            return res.status(401).json({ error: 'Incorrect PIN' });
        }

        // Only id/name/role ever leave this function - the pin column is never in the response.
        return res.status(200).json(data[0]);
    }

    res.status(405).end();
}
