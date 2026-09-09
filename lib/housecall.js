// Shared helpers for talking to the Housecall Pro API.
// Used by api/housecall.js (My Day + Dashboard pages) and api/chat.js (job lookup tool).
const HC_BASE = 'https://api.housecallpro.com';

async function hcFetch(path) {
    const res = await fetch(`${HC_BASE}${path}`, {
        headers: {
            'Authorization': `Token ${process.env.HOUSECALL_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Housecall API error (${res.status}): ${body}`);
    }
    return res.json();
}

// The shop operates on Eastern time (Columbus, OH). Housecall's date filters are UTC,
// so we pull a wide window and then match jobs to "today" using the local date Housecall
// already computed for each job (scheduled_start_local) — sidesteps DST math entirely.
function todayLocalDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

async function getEmployees() {
    const data = await hcFetch('/employees?page_size=100');
    return data.employees || [];
}

async function getJobsInWideWindow() {
    const now = new Date();
    const min = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const max = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    let jobs = [];
    let page = 1;
    while (true) {
        const data = await hcFetch(`/jobs?scheduled_start_min=${min}&scheduled_start_max=${max}&page_size=100&page=${page}`);
        jobs = jobs.concat(data.jobs || []);
        if (!data.total_pages || page >= data.total_pages) break;
        page++;
    }
    return jobs;
}

async function getTodaysJobs() {
    const today = todayLocalDate();
    const jobs = await getJobsInWideWindow();
    return jobs.filter(j => (j.schedule?.scheduled_start_local || '').slice(0, 10) === today);
}

async function getInvoiceInfo(jobId) {
    try {
        const data = await hcFetch(`/jobs/${jobId}/invoices`);
        const invoice = (data.invoices || [])[0];
        if (!invoice) return { status: null, paid_at: null, due_amount: 0 };
        return {
            status: invoice.status || null,
            paid_at: invoice.paid_at || null,
            due_amount: (invoice.due_amount || 0) / 100
        };
    } catch (err) {
        console.error(`Failed to load invoice for ${jobId}:`, err.message);
        return { status: null, paid_at: null, due_amount: 0 };
    }
}

async function getLineItems(jobId) {
    try {
        const data = await hcFetch(`/jobs/${jobId}/line_items`);
        return data.data || [];
    } catch (err) {
        console.error(`Failed to load line items for ${jobId}:`, err.message);
        return [];
    }
}

function matchEmployee(employees, name) {
    const n = (name || '').trim().toLowerCase();
    return employees.find(e => (e.first_name || '').trim().toLowerCase() === n);
}

function jobsForEmployee(jobs, employeeId) {
    return jobs.filter(j => (j.assigned_employees || []).some(e => e.id === employeeId));
}

function findJobsByCustomerName(jobs, customerName) {
    const n = (customerName || '').trim().toLowerCase();
    if (!n) return [];
    return jobs.filter(j => {
        const full = `${j.customer?.first_name || ''} ${j.customer?.last_name || ''}`.trim().toLowerCase();
        return full.includes(n) || n.includes(full);
    });
}

function simplifyJob(job) {
    return {
        id: job.id,
        job_type: job.description || 'Job',
        customer_name: `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim(),
        customer_phone: job.customer?.mobile_number || null,
        address: job.address ? `${job.address.street}${job.address.street_line_2 ? ' ' + job.address.street_line_2 : ''}, ${job.address.city}, ${job.address.state} ${job.address.zip}` : null,
        work_status: job.work_status,
        scheduled_start: job.schedule?.scheduled_start_local || null,
        scheduled_end: job.schedule?.scheduled_end_local || null,
        arrival_window_minutes: job.schedule?.arrival_window ?? null,
        on_my_way_at: job.work_timestamps?.on_my_way_at || null,
        started_at: job.work_timestamps?.started_at || null,
        completed_at: job.work_timestamps?.completed_at || null,
        notes: (job.notes || []).map(n => n.content),
        total_amount: (job.total_amount || 0) / 100,
        outstanding_balance: (job.outstanding_balance || 0) / 100,
        invoice_number: job.invoice_number || null
    };
}

export {
    getEmployees,
    getTodaysJobs,
    getLineItems,
    getInvoiceInfo,
    matchEmployee,
    jobsForEmployee,
    findJobsByCustomerName,
    simplifyJob
};
