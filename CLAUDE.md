# The Local Plumber: crew portal

Internal web app for a small plumbing shop (crew phones + office). Owner: Shamus. Keep this file short;
details live in `docs/`. **Never put secrets, PINs, or API keys in this repo or these docs.**

## Where things live
- **Local folder:** `/Users/macbook/Desktop/Claude/Local Plumber Website/Journeymen` (moved and renamed from `~/projects/plumbing-assistant`; the GitHub repo is still named `plumbing-assistant`)
- **GitHub:** `skanderbaag/plumbing-assistant` (push to `main` = deploy)
- **Vercel:** project `plumbing-assistant` is the ONLY connected project. The duplicate `plumbing-assistant-1u43` was disconnected (Oct 2026). Moving to Vercel Pro / a company account is planned: ask Shamus before touching Git or env vars.
- **Supabase project ref:** `dnhcnbloghupybdezuas` (Postgres + Storage; the Supabase MCP is usually connected)
- **Housecall Pro:** read-only data for My Day / My Pay / Dashboard / Reporting (`lib/housecall.js`, GET only)

## Layout
- `index.html`: the whole front end (one file: HTML + CSS + JS). Brass & Navy design; mobile = hamburger drawer.
- `api/*.js`: Vercel serverless functions (login, crew, chat, tools, vehicles, training, housecall, paycheck, reports-chat)
- `lib/db.js`: the ONE way server code talks to Supabase (service-role key). `lib/session.js` signed tokens,
  `lib/auth.js` who's asking + admin check, `lib/pin.js` PIN hashing/rules, `lib/housecall.js` Housecall helpers
- `supabase/migrations/`: the database's full history as dated SQL files (read `supabase/README.md` before any DB change). `supabase/legacy/`: old hand-run SQL, reference only. `scripts/`: tests. `docs/`: runbook, changelog, plan

## Security rules (do not undo)
1. **The browser never talks to Supabase.** No supabase-js, no keys in `index.html`. Everything goes through `api/*`.
2. **Identity comes from the signed login token, never from request parameters.** Use `requireUser` / `requireAdmin` from `lib/auth.js`.
3. **Admin roles are defined once** in `lib/auth.js` (`ADMIN_ROLES`: owner, gm, admin, production manager, manager; case-insensitive). The browser reads `is_admin` from login. Never hard-code role lists.
4. **Tokens:** crew ~30 days, admin 12 hours, PIN-change token 10 minutes. Admin role is re-checked in the DB on every admin request.
5. **PINs** are salted + peppered scrypt hashes (`PIN_PEPPER` env var). Admin PINs 6-8 digits, crew 4-8. 5 wrong tries on a name = 15 min lockout.
6. **Do not drop `plumbers.pin` yourself:** `api/login.js` still reads it for people who haven't logged in since hashing began. Ask Claude to remove it once `select count(*) from plumbers where pin is not null` is 0.
7. **Every database change is a new dated file in `supabase/migrations/`** (never edit an applied one; never leave a hand-run change undocumented). New tables get RLS ON with no public policies.
8. Planned (Step 7): RLS ON for every table with no public policies (done so far: plumbers, materials_entries, login_attempts).

## Environment variables (names only; values live in Vercel)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `HOUSECALL_API_KEY`, `SESSION_SECRET`, `PIN_PEPPER`, later `CRON_SECRET`. See `.env.example`.
Losing `PIN_PEPPER` = every PIN must be reset. Rotating `SESSION_SECRET` just logs everyone out.

## How we work (Shamus's rules)
- **One step at a time. Stop after each step** so Shamus can check on his phone. Say what to check, in plain English.
- **Commit after every step** with a plain-English message (what changed and why it matters, not file names). Push so he can test.
- Write/run a test for anything touching auth, PINs, or data access (`node scripts/test-auth.mjs`, `node scripts/test-login.mjs`).
- Shamus is not a developer: explain simply, avoid jargon, give copy-paste commands/SQL, and flag anything only he can do (Vercel/Supabase dashboards).
- Keep `docs/CHANGELOG.md` updated each step; add recurring SQL/how-tos to `docs/RUNBOOK.md`.

## Current status
**Building an admin-only "Office" section** (read-only background agents that write findings; admins can only mark them "seen").
Full plan: `docs/office-plan.md` (Shamus's revisions are at its top).
- Milestone 1 (security): steps 1-6 DONE (env secrets, shared DB helper, sessions + admin roles, `api/crew.js` / browser off Supabase, PIN hashing + lockout, migrations baseline).
  **Next: Step 7** enable RLS on the 9 open tables (`conversations, shop_updates, shop_tools, training_tips, quiz_questions, quiz_results, vehicles, vehicle_service_log, vehicle_issues`) and drop BOTH anonymous storage upload policies ("Anon can upload chat images" and the duplicate "Anon upload chat images"; keep the read policy). Do it as a new migration with rollback SQL ready; check the app on a phone right after.
- Milestone 2: Office tables + `api/office.js` + Office screens + a fake finding. Then real agents one at a time (one dispatcher function `api/agents/run.js`, one cron entry per agent, read-only enforced in code).

## Gotchas learned the hard way
- **iPhone browsers (incl. Chrome) are all WebKit.** A `<button>` with stacked content gets clipped: use `<div role="button" tabindex="0">`. `.card` has `overflow:hidden`, which zeroes a flex/grid item's auto min-size: use `flex-shrink:0` / explicit `min-height`. Use `100dvh`, not `100vh`. Always verify layout changes on a real phone.
- After a deploy, phones can keep showing the OLD page: fully close the tab (or delete and re-add the Home Screen icon). Old pages show "Please log in again" errors because they don't send the token.
- Vercel per-deployment URLs sit behind Vercel login; test against the production domain.
- Supabase `list_tables` row counts are stale estimates.
- `plumbers.name` must match the person's Housecall first name (My Day / My Pay / chat job lookup match on it). Vehicles are matched to crew by `vehicles.name`.
- `materials_entries.plumber_id` is text; other tables use uuid.
