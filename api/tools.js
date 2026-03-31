export default async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

    const headers = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
    };

    if (req.method === 'GET') {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/shop_tools?select=*&order=category,name`, { headers });
        const data = await response.json();
        return res.status(200).json(data);
    }

    if (req.method === 'POST') {
        const { id, action, plumber_name } = req.body;
        const payload = action === 'checkout'
            ? { checked_out_by: plumber_name, checked_out_at: new Date().toISOString() }
            : { checked_out_by: null, checked_out_at: null };

        const response = await fetch(`${SUPABASE_URL}/rest/v1/shop_tools?id=eq.${id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        return res.status(200).json(data);
    }

    res.status(405).end();
}
