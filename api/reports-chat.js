import { buildRecallReport } from '../lib/reports.js';

const TOOLS = [
    {
        name: 'recall_report',
        description: "Get a recall-rate report for every plumber over a range of months. Returns, per plumber per month: jobs completed, installation-error recalls, total recalls of any category, and the recall rate (installation-error recalls ÷ jobs completed). Recalls are attributed to the MONTH THE ORIGINAL JOB WAS COMPLETED, not the month the recall visit happens - e.g. a January install recalled in September counts toward January (and toward 2024's running total), not September. Use this for any request involving recall rate, recall counts, or comparing plumbers on recalls/callbacks.",
        input_schema: {
            type: 'object',
            properties: {
                start_month: { type: 'string', description: "First month to include, format YYYY-MM" },
                end_month: { type: 'string', description: "Last month to include (inclusive), format YYYY-MM. Same as start_month for a single month." }
            },
            required: ['start_month', 'end_month']
        }
    }
];

async function runTool(name, input) {
    if (name !== 'recall_report') return { error: 'Unknown tool' };
    try {
        return await buildRecallReport(input.start_month, input.end_month);
    } catch (err) {
        return { error: err.message };
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { messages } = req.body;
    const today = new Date().toISOString().slice(0, 10);

    try {
        let workingMessages = [...messages];
        let finalReply = null;

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
                    max_tokens: 1536,
                    system: `You are a reporting assistant for the management team of a small plumbing company (manager, GM, and owner only use this tool - it is not available to field plumbers). Today's date is ${today}. You have a recall_report tool backed by real Housecall Pro job data. When asked for a report, always use the tool rather than guessing, present results as a clean markdown table, and state the date range you used at the top of your answer if it required interpretation (e.g. "this month" or "last quarter"). Sort tables by recall rate descending unless asked otherwise. If a plumber has 0 jobs completed in a period, show their recall rate as "—" rather than dividing by zero. Be concise - the table should do most of the talking, with at most a couple sentences of commentary.`,
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
                    const result = await runTool(block.name, block.input);
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
