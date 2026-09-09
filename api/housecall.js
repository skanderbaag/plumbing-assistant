import { getEmployees, getTodaysJobs, getLineItems, getInvoiceInfo, matchEmployee, jobsForEmployee, simplifyJob } from '../lib/housecall.js';

// A scheduled job counts as "running late" if its arrival window has fully elapsed
// and the tech hasn't marked "on my way" or started it yet. Adjust the grace logic
// here if the crew wants a stricter/looser definition.
function isRunningLate(job, now) {
    if (job.work_status !== 'scheduled' || job.on_my_way_at || job.started_at) return false;
    if (!job.scheduled_start) return false;
    const windowEnd = new Date(new Date(job.scheduled_start).getTime() + (job.arrival_window_minutes || 0) * 60000);
    return now > windowEnd;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end();
    const { action } = req.query;

    try {
        if (action === 'my_day') {
            const { plumber_name } = req.query;
            if (!plumber_name) return res.status(400).json({ error: 'plumber_name is required' });

            const [employees, jobs] = await Promise.all([getEmployees(), getTodaysJobs()]);
            const employee = matchEmployee(employees, plumber_name);
            if (!employee) {
                return res.status(200).json({ jobs: [], warning: 'No matching Housecall Pro employee found for this name.' });
            }

            const myJobs = jobsForEmployee(jobs, employee.id)
                .sort((a, b) => new Date(a.schedule?.scheduled_start || 0) - new Date(b.schedule?.scheduled_start || 0));

            const withLineItems = await Promise.all(myJobs.map(async (job) => {
                const simplified = simplifyJob(job);
                const lineItems = await getLineItems(job.id);
                simplified.line_items = lineItems.map(li => ({
                    name: li.name,
                    description: li.description,
                    quantity: li.quantity,
                    kind: li.kind
                }));
                return simplified;
            }));

            return res.status(200).json({ jobs: withLineItems });
        }

        if (action === 'dashboard') {
            const [employees, jobs] = await Promise.all([getEmployees(), getTodaysJobs()]);
            const now = new Date();

            const board = await Promise.all(employees.map(async (emp) => {
                const empJobs = jobsForEmployee(jobs, emp.id)
                    .sort((a, b) => new Date(a.schedule?.scheduled_start || 0) - new Date(b.schedule?.scheduled_start || 0))
                    .map(simplifyJob);

                // Attach payment info (status + actual paid_at timestamp) to every job today
                const withPayment = await Promise.all(empJobs.map(async (job) => {
                    const invoice = await getInvoiceInfo(job.id);
                    job.payment_status = invoice.status; // e.g. 'paid', 'sent', 'unsent'...
                    job.paid_at = invoice.paid_at;
                    return job;
                }));

                const current = withPayment.find(j => j.work_status === 'in progress') || null;
                const next = withPayment.find(j => j.work_status === 'scheduled') || null;
                const completed = withPayment.filter(j => j.work_status.startsWith('complete'));
                const unpaid = completed.filter(j => j.outstanding_balance > 0);
                const runningLate = withPayment.some(j => isRunningLate(j, now));

                return {
                    plumber_name: emp.first_name,
                    jobs_today: withPayment.length,
                    jobs_completed: completed.length,
                    current_job: current,
                    next_job: next,
                    running_late: runningLate,
                    unpaid_jobs: unpaid.map(j => ({
                        customer_name: j.customer_name,
                        amount: j.outstanding_balance,
                        invoice_number: j.invoice_number
                    })),
                    jobs: withPayment
                };
            }));

            return res.status(200).json({ board: board.filter(row => row.jobs_today > 0), generated_at: now.toISOString() });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('Housecall endpoint error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
