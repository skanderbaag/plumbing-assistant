export default async function handler(req, res) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

    const headers = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
    };

    if (req.method === 'GET' && req.query.action === 'tip') {
        const today = new Date().toISOString().split('T')[0];
        const existing = await fetch(`${SUPABASE_URL}/rest/v1/training_tips?tip_date=eq.${today}&select=*`, { headers });
        const existingData = await existing.json();
        if (existingData.length > 0) return res.status(200).json({ tip: existingData[0].tip });

        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 300,
                messages: [{ role: 'user', content: 'Give me one practical plumbing tip or trick of the trade that would be useful for a plumber on the job site. Keep it to 2-4 sentences. Make it specific and actionable — something a journeyman would tell an apprentice. No intro, just the tip itself.' }]
            })
        });
        const aiData = await aiRes.json();
        const tip = aiData.content[0].text;
        await fetch(`${SUPABASE_URL}/rest/v1/training_tips`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ tip, tip_date: today })
        });
        return res.status(200).json({ tip });
    }

    if (req.method === 'GET' && req.query.action === 'questions') {
        const { level, topic } = req.query;
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/quiz_questions?level=eq.${level}&topic=eq.${encodeURIComponent(topic)}&select=*`,
            { headers }
        );
        const data = await response.json();
        const shuffled = data.sort(() => Math.random() - 0.5).slice(0, 10);
        return res.status(200).json(shuffled);
    }

    if (req.method === 'POST' && req.query.action === 'result') {
        const { plumber_id, level, topic, score, total } = req.body;
        await fetch(`${SUPABASE_URL}/rest/v1/quiz_results`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify({ plumber_id, level, topic, score, total })
        });
        return res.status(200).json({ success: true });
    }

    res.status(405).end();
}
