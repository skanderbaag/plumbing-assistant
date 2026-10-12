// Shared role-check helper. The client sends plumber_id on requests, but a client can claim
// anything - so any endpoint that returns data about the whole crew (not just the caller's
// own jobs) must verify the caller's actual role in Supabase before answering.
import { dbFetch } from './db.js';

const MANAGER_ROLES = ['manager', 'GM', 'Owner'];

async function getPlumberRole(plumberId) {
    if (!plumberId) return null;
    const res = await dbFetch(`plumbers?id=eq.${encodeURIComponent(plumberId)}&select=role`);
    if (!res.ok) return null;
    const data = await res.json();
    return data[0]?.role || null;
}

function isManagerRole(role) {
    return MANAGER_ROLES.includes(role);
}

export { getPlumberRole, isManagerRole, MANAGER_ROLES };
