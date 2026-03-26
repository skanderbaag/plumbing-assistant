export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const { messages } = req.body;

    const systemPrompt = `You are an expert plumbing assistant for a small plumbing company in Ohio. 
You have deep knowledge of:
- Ohio Revised Plumbing Code
- International Plumbing Code (IPC)
- DWV (drain, waste, vent) systems
- Water supply lines
- Gas lines
- Pipe sizing, fittings, and materials (PVC, CPVC, copper, PEX, cast iron)
- Hole saw sizing for various pipe ODs
- Proper strapping and support intervals by material
- Best practices for residential and commercial plumbing

Always give practical, job-site-ready answers. Be concise but thorough. 
If code sections are relevant, cite them. 
If you're unsure about a specific local amendment, say so and recommend verifying with the AHJ.`;

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
                system: systemPrompt,
                messages
            })
        });

        const data = await response.json();
        res.status(200).json({ reply: data.content[0].text });

    } catch (err) {
        res.status(500).json({ error: 'Something went wrong' });
    }
}
