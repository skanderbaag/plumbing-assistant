// Everything the browser used to do by talking to Supabase directly, now done here on the server
// where we can check WHO is asking: chat history, shop updates, and chat-photo uploads.
// ?action=conversations (GET) | conversation (POST) | updates (GET, POST admin-only) | chat-image (POST)
import { dbFetch, dbHeaders } from '../lib/db.js';
import { requireUser, requireAdmin } from '../lib/auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const BUCKET = 'chat-images';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;     // decoded size; keeps the request under Vercel's 4.5 MB body limit
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_MESSAGE_CHARS = 20000;
const MAX_TITLE_CHARS = 200;
const MAX_UPDATE_CHARS = 5000;

function publicImagePrefix() {
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
}

export default async function handler(req, res) {
    const { action } = req.query;

    // Posting a shop update is admin-only, enforced here (the app also hides the form from crew).
    if (req.method === 'POST' && action === 'updates') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        const title = String(req.body?.title || '').trim();
        const content = String(req.body?.content || '').trim();
        if (!title || !content) return res.status(400).json({ error: 'Title and content are required.' });
        if (title.length > MAX_TITLE_CHARS || content.length > MAX_UPDATE_CHARS) {
            return res.status(400).json({ error: 'That update is too long.' });
        }
        const r = await dbFetch('shop_updates', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ title, content, posted_by: admin.name })
        });
        if (!r.ok) return res.status(500).json({ error: 'Could not post the update.' });
        return res.status(200).json({ ok: true });
    }

    const user = await requireUser(req, res);
    if (!user) return;

    // Your own assistant chat history. Newest 50, shown oldest-first.
    if (req.method === 'GET' && action === 'conversations') {
        const r = await dbFetch(
            `conversations?plumber_id=eq.${encodeURIComponent(user.id)}&channel=eq.assistant&select=role,content,image_url,created_at&order=created_at.desc&limit=50`
        );
        const rows = r.ok ? await r.json() : [];
        return res.status(200).json(Array.isArray(rows) ? rows.reverse() : []);
    }

    // Save one chat message under the logged-in person.
    if (req.method === 'POST' && action === 'conversation') {
        const { role, content, image_url } = req.body || {};
        if (role !== 'user' && role !== 'assistant') return res.status(400).json({ error: 'Bad role.' });
        if (typeof content !== 'string' || content.length > MAX_MESSAGE_CHARS) return res.status(400).json({ error: 'Bad message.' });
        if (image_url != null && !(typeof image_url === 'string' && image_url.startsWith(publicImagePrefix()))) {
            return res.status(400).json({ error: 'Bad image link.' });
        }
        const r = await dbFetch('conversations', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ plumber_id: user.id, role, content, channel: 'assistant', image_url: image_url || null })
        });
        if (!r.ok) return res.status(500).json({ error: 'Could not save the message.' });
        return res.status(200).json({ ok: true });
    }

    // Everyone logged in can read shop updates.
    if (req.method === 'GET' && action === 'updates') {
        const r = await dbFetch('shop_updates?select=*&order=created_at.desc');
        const rows = r.ok ? await r.json() : [];
        return res.status(200).json(Array.isArray(rows) ? rows : []);
    }

    // Upload a chat photo. The browser sends it here; this stores it under the person's own folder.
    if (req.method === 'POST' && action === 'chat-image') {
        const { data, type } = req.body || {};
        const ext = IMAGE_TYPES[type];
        if (!ext || typeof data !== 'string') return res.status(400).json({ error: 'Unsupported image type.' });
        const bytes = Buffer.from(data, 'base64');
        if (!bytes.length) return res.status(400).json({ error: 'Empty image.' });
        if (bytes.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'That photo is too large.' });

        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
            method: 'POST',
            headers: dbHeaders({ 'Content-Type': type }),
            body: bytes
        });
        if (!r.ok) {
            console.error('Image upload failed:', r.status, await r.text().catch(() => ''));
            return res.status(502).json({ error: 'Could not store the photo.' });
        }
        return res.status(200).json({ url: publicImagePrefix() + path });
    }

    res.status(405).end();
}
