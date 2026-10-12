import { dbFetch } from '../lib/db.js';
import { requireUser } from '../lib/auth.js';

export default async function handler(req, res) {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === 'GET' && req.query.action === 'tip') {
        const today = new Date().toISOString().split('T')[0];
        const existing = await dbFetch(`training_tips?tip_date=eq.${today}&select=*`);
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
        await dbFetch('training_tips', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify({ tip, tip_date: today })
        });
        return res.status(200).json({ tip });
    }

    if (req.method === 'GET' && req.query.action === 'questions') {
        const { level, topic } = req.query;
        const response = await dbFetch(`quiz_questions?level=eq.${level}&topic=eq.${encodeURIComponent(topic)}&select=*`);
        const data = await response.json();
        const shuffled = data.sort(() => Math.random() - 0.5).slice(0, 10);
        return res.status(200).json(shuffled);
    }

    if (req.method === 'POST' && req.query.action === 'result') {
        const { level, topic, score, total } = req.body;
        await dbFetch('quiz_results', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify({ plumber_id: user.id, level, topic, score, total })
        });
        return res.status(200).json({ success: true });
    }

    res.status(405).end();
}
