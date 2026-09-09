import { getEmployees, getTodaysJobs, jobsForEmployee, matchEmployee, findJobsByCustomerName, getLineItems } from '../lib/housecall.js';

const TOOLS = [
    {
        name: 'lookup_job',
        description: "Look up a specific job on the current plumber's schedule for today by the customer's name, to give an informed update on that job's status, materials/line items, or notes. Only use this when the plumber is asking about a specific customer or job by name — not for general plumbing knowledge questions.",
        input_schema: {
            type: 'object',
            properties: {
                customer_name: { type: 'string', description: "The customer's name as mentioned, e.g. 'Jane Doe' or just 'Jane'" }
            },
            required: ['customer_name']
        }
    }
];

async function runTool(name, input, plumberName) {
    if (name !== 'lookup_job') return { error: 'Unknown tool' };
    try {
        const [employees, jobs] = await Promise.all([getEmployees(), getTodaysJobs()]);
        const employee = matchEmployee(employees, plumberName);
        const scoped = employee ? jobsForEmployee(jobs, employee.id) : jobs;
        const matches = findJobsByCustomerName(scoped, input.customer_name);

        if (!matches.length) {
            return { found: false, message: `No job found today for a customer matching "${input.customer_name}".` };
        }

        const job = matches[0];
        const lineItems = await getLineItems(job.id);
        return {
            found: true,
            job_type: job.description,
            customer_name: `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim(),
            address: job.address ? `${job.address.street}, ${job.address.city}, ${job.address.state} ${job.address.zip}` : null,
            work_status: job.work_status,
            scheduled_start: job.schedule?.scheduled_start_local,
            scheduled_end: job.schedule?.scheduled_end_local,
            notes: (job.notes || []).map(n => n.content),
            line_items: lineItems.map(li => ({ name: li.name, description: li.description, quantity: li.quantity })),
            total_amount: (job.total_amount || 0) / 100,
            outstanding_balance: (job.outstanding_balance || 0) / 100
        };
    } catch (err) {
        return { error: err.message };
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { messages, plumber_name } = req.body;

    try {
        let workingMessages = [...messages];
        let finalReply = null;

        // Loop to support Claude calling the lookup_job tool before giving a final answer.
        // Capped at 3 rounds so a misbehaving tool call can't loop forever.
        for (let round = 0; round < 3; round++) {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 1024,
                    system: `You are an expert plumbing assistant for a small plumbing company in Ohio. You have deep knowledge of the Ohio Revised Plumbing Code, International Plumbing Code, DWV systems, water supply lines, gas lines, pipe sizing, fittings, materials, hole saw sizing, strapping intervals, and best practices. Give practical job-site-ready answers. You also have a lookup_job tool to check the plumber's own job board for today if they ask about a specific customer or job by name.`,
                    messages: workingMessages,
                    tools: TOOLS
                })
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('Anthropic error:', JSON.stringify(data));
                return res.status(500).json({ error: JSON.stringify(data) });
            }

            if (data.stop_reason === 'tool_use') {
                workingMessages.push({ role: 'assistant', content: data.content });
                const toolResults = [];
                for (const block of data.content) {
                    if (block.type !== 'tool_use') continue;
                    const result = await runTool(block.name, block.input, plumber_name);
                    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
                }
                workingMessages.push({ role: 'user', content: toolResults });
                continue;
            }

            const textBlock = data.content?.find(block => block.type === 'text');
            finalReply = textBlock ? textBlock.text : null;
            break;
        }

        if (!finalReply) {
            return res.status(500).json({ error: 'No text content in response' });
        }

        res.status(200).json({ reply: finalReply });

    } catch (err) {
        console.error('Caught error:', err.message);
        res.status(500).json({ error: err.message });
    }
}
