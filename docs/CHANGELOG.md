# Change history

Plain-English log, newest first. Commit ids link to GitHub (`https://github.com/skanderbaag/plumbing-assistant/commit/<id>`).
Update this at the end of every step.

## Oct 2026: Security hardening + "Office" groundwork (Milestone 1)
Goal: make the data layer safe before adding an admin-only Office section for read-only background agents.
Plan: `docs/office-plan.md`.

- **Step 6, database history kept in the repo** (Oct 19). `supabase/migrations/` now holds a **baseline** snapshot of the whole database plus the PIN migration, so the schema can be rebuilt from the repo and every future change is a dated file. Proven accurate by rebuilding it in a throwaway scratch area and comparing to the live database (77 columns, all constraints, indexes and security settings identical; scratch area rolled back). The baseline is recorded as "applied" in Supabase's history table (metadata only, no data changed). The PIN migration file was renamed to match the version Supabase recorded (`20261019165338`). The three loose root-level `.sql` files moved to `supabase/legacy/` (reference only; one was outdated). New `supabase/README.md` has the rules for future changes. **Found for Step 7:** Storage has THREE anonymous policies (read, upload, and a duplicate upload named "Anon upload chat images"); both upload policies must be removed.
- **Step 5, PIN hashing and lockout** (`1954c88`, Oct 19). PINs are now salted + peppered hashes instead of plain text; everyone upgrades silently at next login. 5 wrong tries lock a name for 15 minutes (20 from one address). Admin roles must use 6-8 digit PINs and get a "Set a new PIN" screen if theirs is shorter; crew keep 4. New `login_attempts` table and `plumbers.pin_hash/pin_salt` columns (`supabase/migrations/20261019165338_pin_hardening.sql`, applied). Tests: `scripts/test-login.mjs`.
- **Step 4, browser stops talking to the database** (`95090a6`, Oct 19). New `api/crew.js` handles chat history, shop updates (posting is admin-only, enforced on the server) and photo uploads (photos shrunk on the phone first). Removed all Supabase code and keys from `index.html`. Fixed: chat history loaded the 50 *oldest* messages; shop update text was inserted unescaped.
- **Step 3, signed login tokens + one admin list** (`fc0550b`, Oct 12). After login the server issues a signed token (crew 30 days, admin 12 hours); every request proves who it's from. `ADMIN_ROLES` defined once (owner, GM, admin, production manager, manager). Dashboard, Reporting, and "mark vehicle issue resolved" are admin-only on the server. Tools, vehicles, training, My Day, My Pay and the AI chat now require login (the chat spends Anthropic credits). The app remembers you between visits. Tests: `scripts/test-auth.mjs`.
- **Step 2, one shared database helper** (`0ca7593`, Oct 12). `lib/db.js`; tools/vehicles/training moved from the public key to the server key. No visible change.
- **Step 1, housekeeping** (`dd857b8`, Oct 12). `.env.example`; `SESSION_SECRET` and `PIN_PEPPER` added in Vercel; duplicate Vercel project `plumbing-assistant-1u43` disconnected.
- Decisions: `manager` role counts as admin (Shamus keeps access); moving to Vercel Pro (no cron workarounds); read-only role check on Oct 12 found 9 people (Owner Trevor, GM Travis, manager Shamus, helper Titus, plumbers Caleb/Cole/Daniel/Jereme/Micah), all with 4-digit plain-text PINs at that time.

## Sep 2026: Design refresh, mobile fixes, My Pay
- `e4d066a`, `297c9d3`, `77dcb78` (Sep 20): tool tiles / level cards were clipped on iPhones. Root causes: `<button>` sizing in WebKit and `overflow:hidden` zeroing the auto min-size. Fixed with `<div role="button">` and explicit min-heights.
- `a577c24` (Sep 20): fixed content overlapping the bottom bar (100vh -> 100dvh), restored the hamburger slide-out menu, trimmed mobile font sizes.
- `e044c45` (Sep 18): **Brass & Navy** design refresh (new fonts, colors, cards, status chips, job cards with navy time band, SVG icons, no emoji).
- `57bb5ec`, `118b732`, `12f45e0` (Sep 18): **My Pay** weekly take-home estimate (revenue from completed Housecall jobs, minus 10% sales commission, minus receipts, x 25%, minus $50 vehicle and $50 tool fees). Receipts accumulate through the week. Found and fixed: Dashboard/Reporting data was returned to anyone who called the API directly; now admin-only on the server.
- `c64158b`, `fa6c45f`, `a3b55cc` (Sep 16-18): chat opens on the newest message; app opens on My Day; nav order My day, My pay, Dashboard, Assistant, Shop tools, Shop updates, Training, Vehicle maintenance.
- `08c1cd9` (Sep 16): **crew login moved to the server** (the `plumbers` table with PINs had been readable with the public key). `supabase_lock_down_plumbers.sql` (now in `supabase/legacy/`) turned on row-level security for it.

## Sep 9 2026: Housecall Pro integration
`226389e` and follow-ups: My Day (your jobs), team Dashboard (live status, per-job breakdown, unpaid jobs), recall-rate Reporting chat, AI chat can look up today's jobs. Also: chat photos saved to Supabase Storage (`4663f25`, `ae5bc6c`).

## Mar-Apr 2026: original app
Built in small steps via GitHub web edits (`Update index.html`): AI plumbing assistant chat (Ohio code), shop tools check-out, training tips and quizzes, vehicle maintenance, shop updates board, PIN login by name.
