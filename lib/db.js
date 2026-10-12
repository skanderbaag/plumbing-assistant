// The one place server code talks to Supabase. Uses the service-role key, which bypasses
// Row Level Security, so tables can be locked down for the public (anon) key while the
// app keeps working through these serverless functions. This key must never reach the browser.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function dbHeaders(extra = {}) {
    return {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        ...extra
    };
}

// path is everything after /rest/v1/, e.g. 'shop_tools?select=*&order=name'.
// Returns the raw fetch Response so callers handle status/JSON exactly as before.
function dbFetch(path, options = {}) {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: dbHeaders(options.headers)
    });
}

export { dbFetch, dbHeaders };
