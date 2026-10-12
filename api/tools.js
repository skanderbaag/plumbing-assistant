import { dbFetch } from '../lib/db.js';
import { requireUser } from '../lib/auth.js';

export default async function handler(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === 'GET') {
        const response = await dbFetch('shop_tools?select=*&order=category,name');
        const data = await response.json();
        return res.status(200).json(data);
    }

    if (req.method === 'POST') {
        const { id, action } = req.body;
        const plumber_name = user.name;
        const payload = action === 'checkout'
            ? { checked_out_by: plumber_name, checked_out_at: new Date().toISOString() }
            : { checked_out_by: null, checked_out_at: null };

        const response = await dbFetch(`shop_tools?id=eq.${id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        return res.status(200).json(data);
    }

    res.status(405).end();
}
