// Shared role-check helper. The client sends plumber_id on requests, but a client can claim
// anything - so any endpoint that returns data about the whole crew (not just the caller's
// own jobs) must verify the caller's actual role in Supabase before answering.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MANAGER_ROLES = ['manager', 'GM', 'Owner'];

async function getPlumberRole(plumberId) {
    if (!plumberId) return null;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/plumbers?id=eq.${encodeURIComponent(plumberId)}&select=role`, {
        headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`
        }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data[0]?.role || null;
}

function isManagerRole(role) {
    return MANAGER_ROLES.includes(role);
}

export { getPlumberRole, isManagerRole, MANAGER_ROLES };
