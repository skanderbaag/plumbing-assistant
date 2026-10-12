import { dbFetch } from '../lib/db.js';
import { requireUser } from '../lib/auth.js';

export default async function handler(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === 'GET' && req.query.action === 'vehicles') {
        const response = await dbFetch('vehicles?select=*&order=name');
        const data = await response.json();
        return res.status(200).json(data);
    }

    if (req.method === 'GET' && req.query.action === 'history') {
        const { vehicle_id } = req.query;
        const response = await dbFetch(`vehicle_service_log?vehicle_id=eq.${vehicle_id}&select=*&order=created_at.desc`);
        const data = await response.json();
        return res.status(200).json(data);
    }

    if (req.method === 'GET' && req.query.action === 'issues') {
        const { vehicle_id } = req.query;
        const path = vehicle_id
            ? `vehicle_issues?vehicle_id=eq.${vehicle_id}&status=eq.open&select=*&order=created_at.desc`
            : 'vehicle_issues?status=eq.open&select=*&order=created_at.desc';
        const response = await dbFetch(path);
        const data = await response.json();
        return res.status(200).json(data);
    }

    if (req.method === 'POST' && req.query.action === 'update_mileage') {
        const { vehicle_id, mileage } = req.body;
        await dbFetch(`vehicles?id=eq.${vehicle_id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify({ current_mileage: mileage })
        });
        return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && req.query.action === 'log_service') {
        const { vehicle_id, service_type, mileage_at_service, notes } = req.body;
        const logged_by = user.name;
        await dbFetch('vehicle_service_log', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify({ vehicle_id, service_type, mileage_at_service, notes, logged_by })
        });
        await dbFetch(`vehicles?id=eq.${vehicle_id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify({ current_mileage: mileage_at_service })
        });
        return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && req.query.action === 'report_issue') {
        const { vehicle_id, description } = req.body;
        const reported_by = user.name;
        await dbFetch('vehicle_issues', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify({ vehicle_id, description, reported_by, status: 'open' })
        });
        return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && req.query.action === 'resolve_issue') {
        if (!user.is_admin) return res.status(403).json({ error: 'Not allowed.' });
        const { issue_id } = req.body;
        await dbFetch(`vehicle_issues?id=eq.${issue_id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify({ status: 'resolved' })
        });
        return res.status(200).json({ success: true });
    }

    res.status(405).end();
}
