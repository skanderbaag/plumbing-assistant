import { getEmployees, getJobsInRange, matchEmployee, jobsForEmployee, simplifyJob } from '../lib/housecall.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function serviceHeaders() {
    return {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
    };
}

// Company pay structure: 10% off the top goes to whoever sold the job (almost never the
// installing plumber), materials are subtracted from what's left, then the plumber gets a
// flat 25% of that, minus a flat $50 vehicle fee and $50 tool account fee.
const SALES_COMMISSION_RATE = 0.10;
const PLUMBER_COMMISSION_RATE = 0.25;
const VEHICLE_FEE = 50;
const TOOL_FEE = 50;

// Monday-Friday of the current week, in the shop's local (Eastern) time.
function weekBoundsLocal() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    }).formatToParts(now);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const todayNoonUTC = new Date(`${map.year}-${map.month}-${map.day}T12:00:00Z`);
    const mondayOffset = dowMap[map.weekday] === 0 ? -6 : (1 - dowMap[map.weekday]);
    const monday = new Date(todayNoonUTC);
    monday.setUTCDate(monday.getUTCDate() + mondayOffset);
    const friday = new Date(monday);
    friday.setUTCDate(friday.getUTCDate() + 4);
    const fmt = d => d.toISOString().slice(0, 10);
    return { weekStart: fmt(monday), weekEnd: fmt(friday) };
}

async function getMaterialEntries(plumberId, weekStart) {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/materials_entries?plumber_id=eq.${encodeURIComponent(plumberId)}&week_start=eq.${weekStart}&select=id,amount,created_at&order=created_at.asc`,
        { headers: serviceHeaders() }
    );
    if (!res.ok) return [];
    return res.json();
}

async function addMaterialEntry(plumberId, weekStart, amount) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/materials_entries`, {
        method: 'POST',
        headers: { ...serviceHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({ plumber_id: String(plumberId), week_start: weekStart, amount })
    });
    const data = await res.json();
    return data[0];
}

async function deleteMaterialEntry(plumberId, entryId) {
    await fetch(
        `${SUPABASE_URL}/rest/v1/materials_entries?id=eq.${encodeURIComponent(entryId)}&plumber_id=eq.${encodeURIComponent(plumberId)}`,
        { method: 'DELETE', headers: serviceHeaders() }
    );
}

export default async function handler(req, res) {
    try {
        if (req.method === 'GET' && req.query.action === 'summary') {
            const { plumber_id, plumber_name } = req.query;
            if (!plumber_id || !plumber_name) return res.status(400).json({ error: 'plumber_id and plumber_name are required' });

            const { weekStart, weekEnd } = weekBoundsLocal();
            // Wide buffer around the week to safely absorb the UTC/Eastern offset, then we
            // filter down to the exact Mon-Fri local dates below.
            const minISO = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000).toISOString();
            const maxISO = new Date(new Date(`${weekEnd}T00:00:00Z`).getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

            const [employees, jobs, materialsEntries] = await Promise.all([
                getEmployees(),
                getJobsInRange(minISO, maxISO),
                getMaterialEntries(plumber_id, weekStart)
            ]);
            const materials = materialsEntries.reduce((sum, e) => sum + Number(e.amount), 0);

            const employee = matchEmployee(employees, plumber_name);
            const myJobs = employee ? jobsForEmployee(jobs, employee.id) : [];
            const completed = myJobs
                .map(simplifyJob)
                .filter(j => (j.work_status || '').startsWith('complete')
                    && j.scheduled_start
                    && j.scheduled_start.slice(0, 10) >= weekStart
                    && j.scheduled_start.slice(0, 10) <= weekEnd);

            const revenue = completed.reduce((sum, j) => sum + j.total_amount, 0);
            const afterSales = revenue * (1 - SALES_COMMISSION_RATE);
            const afterMaterials = afterSales - materials;
            const commissionAmount = afterMaterials * PLUMBER_COMMISSION_RATE;
            const takeHome = commissionAmount - VEHICLE_FEE - TOOL_FEE;

            return res.status(200).json({
                week_start: weekStart,
                week_end: weekEnd,
                jobs_completed: completed.length,
                revenue,
                materials,
                materials_entries: materialsEntries,
                sales_commission_rate: SALES_COMMISSION_RATE,
                after_sales: afterSales,
                after_materials: afterMaterials,
                commission_rate: PLUMBER_COMMISSION_RATE,
                commission_amount: commissionAmount,
                vehicle_fee: VEHICLE_FEE,
                tool_fee: TOOL_FEE,
                take_home: takeHome
            });
        }

        if (req.method === 'POST' && req.query.action === 'add_material') {
            const { plumber_id, amount } = req.body;
            if (!plumber_id || typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
                return res.status(400).json({ error: 'plumber_id and a positive amount are required' });
            }
            const { weekStart } = weekBoundsLocal();
            const entry = await addMaterialEntry(plumber_id, weekStart, amount);
            return res.status(200).json({ ok: true, entry });
        }

        if (req.method === 'POST' && req.query.action === 'delete_material') {
            const { plumber_id, entry_id } = req.body;
            if (!plumber_id || !entry_id) {
                return res.status(400).json({ error: 'plumber_id and entry_id are required' });
            }
            await deleteMaterialEntry(plumber_id, entry_id);
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('Paycheck endpoint error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
