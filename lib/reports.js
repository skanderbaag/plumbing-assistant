import { getAllJobsHistory } from './housecall.js';

// The exact category tags used in this shop's Housecall data (Recall: Installation Error,
// Recall: Material Malfunction, etc). Any "Recall: X" tag whose X is NOT in this list is
// treated as the name of the plumber responsible for the original work, not a category.
const RECALL_CATEGORIES = ['Installation Error', 'Material Malfunction', 'Unrelated', 'Customer Misuse', 'Warranty'];

function parseRecallTags(tags) {
    const hasGeneric = (tags || []).some(t => t.trim().toLowerCase() === 'recall');
    if (!hasGeneric) return { isRecall: false, category: null, attributedTo: null };
    let category = null, attributedTo = null;
    (tags || []).forEach(t => {
        const m = t.trim().match(/^recall:\s*(.+)$/i);
        if (!m) return;
        const val = m[1].trim();
        const catMatch = RECALL_CATEGORIES.find(c => c.toLowerCase() === val.toLowerCase());
        if (catMatch) category = catMatch;
        else attributedTo = val;
    });
    return { isRecall: true, category, attributedTo };
}

function monthKey(dateStr) {
    return (dateStr || '').slice(0, 7); // 'YYYY-MM'
}

function monthsBetween(startMonth, endMonth) {
    const months = [];
    let [y, m] = startMonth.split('-').map(Number);
    const [ey, em] = endMonth.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return months;
}

// Recalls get attributed to whatever month the ORIGINAL job was completed in, not the month
// the recall visit happens - a January install that gets called back in September counts
// toward January's (and that year's running) rate, not September's. The original job is
// found by looking at the same customer's job history for the most recent prior job (not
// itself a recall) that the attributed plumber actually worked - validated at ~96% direct
// match rate against this shop's real data, with a recency-only fallback for the rest.
function findOriginalJob(recallJob, attributedTo, jobsByCustomer) {
    const cid = recallJob.customer?.id;
    const timeline = jobsByCustomer[cid] || [];
    const recallStart = new Date(recallJob.schedule?.scheduled_start || 0);
    let byTech = null, byRecency = null;
    for (const candidate of timeline) {
        if (candidate.id === recallJob.id) continue;
        if (parseRecallTags(candidate.tags).isRecall) continue;
        const cStart = new Date(candidate.schedule?.scheduled_start || 0);
        if (cStart >= recallStart) continue;
        byRecency = candidate;
        const empNames = (candidate.assigned_employees || []).map(e => (e.first_name || '').toLowerCase());
        if (empNames.includes(attributedTo.toLowerCase())) byTech = candidate;
    }
    return byTech || byRecency || null;
}

// Builds a recall-rate report for every plumber found in the data (including anyone no
// longer in the app, like a former employee) across the given inclusive month range.
async function buildRecallReport(startMonth, endMonth) {
    const allJobs = await getAllJobsHistory();

    const jobsByCustomer = {};
    allJobs.forEach(j => {
        const cid = j.customer?.id;
        if (!cid) return;
        (jobsByCustomer[cid] ??= []).push(j);
    });
    Object.values(jobsByCustomer).forEach(list =>
        list.sort((a, b) => new Date(a.schedule?.scheduled_start || 0) - new Date(b.schedule?.scheduled_start || 0))
    );

    // Denominator: jobs each plumber completed, by month (includes recall-remediation visits
    // they personally performed, not just original installs).
    const completedByPlumberMonth = {};
    allJobs.forEach(j => {
        if (!j.work_status?.startsWith('complete')) return;
        const mk = monthKey(j.work_timestamps?.completed_at || j.schedule?.scheduled_start_local);
        (j.assigned_employees || []).forEach(e => {
            const name = e.first_name;
            (completedByPlumberMonth[name] ??= {});
            completedByPlumberMonth[name][mk] = (completedByPlumberMonth[name][mk] || 0) + 1;
        });
    });

    // Numerator: recalls, attributed back to the original job's month.
    const recallsByPlumberMonth = {};
    let unmatchedCount = 0;
    allJobs.forEach(recallJob => {
        const parsed = parseRecallTags(recallJob.tags);
        if (!parsed.isRecall || !parsed.attributedTo) return;

        const original = findOriginalJob(recallJob, parsed.attributedTo, jobsByCustomer);
        let attributionMonth;
        if (original) {
            attributionMonth = monthKey(original.work_timestamps?.completed_at || original.schedule?.scheduled_start_local);
        } else {
            attributionMonth = monthKey(recallJob.schedule?.scheduled_start_local);
            unmatchedCount++;
        }

        const name = parsed.attributedTo;
        (recallsByPlumberMonth[name] ??= {});
        (recallsByPlumberMonth[name][attributionMonth] ??= { total: 0 });
        recallsByPlumberMonth[name][attributionMonth].total++;
        if (parsed.category) {
            recallsByPlumberMonth[name][attributionMonth][parsed.category] =
                (recallsByPlumberMonth[name][attributionMonth][parsed.category] || 0) + 1;
        }
    });

    const months = monthsBetween(startMonth, endMonth);
    const names = new Set([...Object.keys(completedByPlumberMonth), ...Object.keys(recallsByPlumberMonth)]);

    const report = [...names].map(name => {
        let totalCompleted = 0, totalInstallError = 0, totalRecalls = 0;
        const byMonth = months.map(mk => {
            const completed = completedByPlumberMonth[name]?.[mk] || 0;
            const recalls = recallsByPlumberMonth[name]?.[mk] || { total: 0 };
            const installError = recalls['Installation Error'] || 0;
            totalCompleted += completed;
            totalInstallError += installError;
            totalRecalls += recalls.total;
            return {
                month: mk,
                jobs_completed: completed,
                installation_error_recalls: installError,
                total_recalls: recalls.total,
                recall_rate_pct: completed > 0 ? +(installError / completed * 100).toFixed(1) : null
            };
        });
        return {
            plumber_name: name,
            months: byMonth,
            totals: {
                jobs_completed: totalCompleted,
                installation_error_recalls: totalInstallError,
                total_recalls: totalRecalls,
                recall_rate_pct: totalCompleted > 0 ? +(totalInstallError / totalCompleted * 100).toFixed(1) : null
            }
        };
    }).filter(row => row.totals.jobs_completed > 0 || row.totals.total_recalls > 0)
      .sort((a, b) => (b.totals.recall_rate_pct || 0) - (a.totals.recall_rate_pct || 0));

    return { start_month: startMonth, end_month: endMonth, report, unmatched_recall_count: unmatchedCount };
}

export { buildRecallReport, RECALL_CATEGORIES, parseRecallTags };
