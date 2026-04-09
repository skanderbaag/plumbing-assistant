export default async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

    const headers = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
    };

    if (req.method === 'GET' && req.query.action === 'vehicles') {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?select=*&order=name`, { headers });
        const data = await response.json();
        return res.status(200).json(data);
    }

    if (req.method === 'GET' && req.query.action === 'history') {
        const { vehicle_id } = req.query;
        const response = await fetch(`${SUPABASE_URL}/rest/v1/vehicle_service_log?vehicle_id=eq.${vehicle_id}&select=*&order=created_at.desc`, { headers });
        const data = await response.json();
        return res.status(200).json(data);
    }

    if (req.method === 'GET' && req.query.action === 'issues') {
        const { vehicle_id } = req.query;
        const url = vehicle_id
            ? `${SUPABASE_URL}/rest/v1/vehicle_issues?vehicle_id=eq.${vehicle_id}&status=eq.open&select=*&order=created_at.desc`
            : `${SUPABASE_URL}/rest/v1/vehicle_issues?status=eq.open&select=*&order=created_at.desc`;
        const response = await fetch(url, { headers });
        const data = await response.json();
        return res.status(200).json(data);
    }

    if (req.method === 'POST' && req.query.action === 'update_mileage') {
        const { vehicle_id, mileage } = req.body;
        await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicle_id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ current_mileage: mileage })
        });
        return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && req.query.action === 'log_service') {
        const { vehicle_id, service_type, mileage_at_service, notes, logged_by } = req.body;
        await fetch(`${SUPABASE_URL}/rest/v1/vehicle_service_log`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ vehicle_id, service_type, mileage_at_service, notes, logged_by })
        });
        await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicle_id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ current_mileage: mileage_at_service })
        });
        return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && req.query.action === 'report_issue') {
        const { vehicle_id, description, reported_by } = req.body;
        await fetch(`${SUPABASE_URL}/rest/v1/vehicle_issues`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ vehicle_id, description, reported_by, status: 'open' })
        });
        return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && req.query.action === 'resolve_issue') {
        const { issue_id } = req.body;
        await fetch(`${SUPABASE_URL}/rest/v1/vehicle_issues?id=eq.${issue_id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ status: 'resolved' })
        });
        return res.status(200).json({ success: true });
    }

    res.status(405).end();
}
