export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { messages } = req.body;

    try {
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
                system: `You are an expert plumbing assistant for a small plumbing company in Ohio. You have deep knowledge of the Ohio Revised Plumbing Code, International Plumbing Code, DWV systems, water supply lines, gas lines, pipe sizing, fittings, materials, hole saw sizing, strapping intervals, and best practices. Give practical job-site-ready answers.`,
                messages
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            console.error('Anthropic error:', JSON.stringify(data));
            return res.status(500).json({ error: JSON.stringify(data) });
        }

        res.status(200).json({ reply: data.content[0].text });

    } catch (err) {
        console.error('Caught error:', err.message);
        res.status(500).json({ error: err.message });
    }
}
