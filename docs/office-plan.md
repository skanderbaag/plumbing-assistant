# Plan: Admin-only "Office" section + security hardening first

## Context
We want read-only background agents (reviews, mentions, briefs) whose findings show up in an admin-only "Office" screen. Before building, the data layer has to be safe: the database check found RLS off on 9 tables, and reading the code shows the gate we'd need for admin-only isn't trustworthy yet. So: security first (Milestone 1), then the Office shell with a fake finding (Milestone 2), then real agents one at a time.

Decisions already made with you: **Vercel Hobby plan**; **`plumbing-assistant` is the real project** (`plumbing-assistant-1u43` gets disconnected).

## REVISIONS after your review (these override anything below that conflicts)
- **Scope:** build **Milestone 1 only**, one step at a time; **stop after each step** for a phone check; **commit after each step** with a plain-English message.
- **Sessions move into Milestone 1** (before RLS): signed tokens, server-side identity, central `ADMIN_ROLES`, `is_admin` from login, so the shop-update POST is truly admin-gated.
- **PIN length:** admin roles require **6-8 digits**; crew can keep 4. Login input cap raised to 8. Existing admins with 4-digit PINs get a forced "set a longer PIN" on next login (detail decided at that step).
- **Token lifetime:** crew **~30 days**, admin **12 hours**. Admin role is still re-checked in the DB on every admin request.
- **Vercel Pro (company account):** no cron workarounds. Keep the single dispatcher design; assume Pro limits (frequent cron, no 12-function cap, longer timeouts).
- **Before Step 1:** run the read-only role check and show results; **no role names change until you've seen them.**

**Revised Milestone 1 order:** 1 Housekeeping (+ role check) -> 2 `lib/db.js` onto service key -> 3 Sessions + `ADMIN_ROLES` + `is_admin` -> 4 `api/crew.js` (conversations / updates admin-gated / image upload) + remove browser Supabase -> 5 PIN hardening (hash, lockout, admin 6-8 digits) -> 6 Migrations folder -> 7 Enable RLS + drop storage anon policy.

## What I found in the codebase (drives the plan)
- **Browser talks to Supabase directly in exactly 3 places** (`index.html`): `conversations` (select + insert), `shop_updates` (select + insert), and Storage upload to `chat-images`. Publishable key is hard-coded at line ~624.
- **Every other table goes through serverless functions, but with the anon key** (`api/tools.js`, `api/vehicles.js`, `api/training.js`). Turning RLS on without changing these **breaks the app**.
- **No sessions.** After login the client just sends `plumber_id` / `plumber_name` as plain parameters, and `lib/auth.js` `getPlumberRole()` trusts them. Fine for a crew app; not acceptable as the only gate for Office.
- **PINs are stored as plain text** (`api/login.js:30` matches `pin=eq.<pin>`). Not hashed. No attempt limiting, and PINs are only 4 digits (10,000 combos).
- **Admin roles are hard-coded, case-sensitive `['manager','GM','Owner']` in 4 places** (`index.html` x3, `lib/auth.js`). `admin` and `production manager` aren't recognized; DB default role is `'plumber'`.
- `plumbers.id` is `uuid`; `materials_entries.plumber_id` is `text` (inconsistent; new tables will use uuid FKs).
- `lib/housecall.js` `hcFetch()` is **GET-only** today, a good base for "read-only".
- Supabase MCP is connected, so migrations can be applied with history recorded (`list_migrations` is empty now).

---

## 0. Security first (Milestone 1: crew app keeps working throughout)
Order matters. RLS goes **last**, after nothing in the browser or anon path needs it.

1. **Housekeeping.** Disconnect `plumbing-assistant-1u43` from the repo (Vercel -> Settings -> Git) so cron never runs twice. Add env vars on the real project: `SESSION_SECRET`, `PIN_PEPPER`, `CRON_SECRET` (random 32+ chars).
2. **One server-side DB helper** `lib/db.js` (service-role key; select/insert/update/delete over REST). Switch `tools.js`, `vehicles.js`, `training.js`, `login.js`, `paycheck.js`, `auth.js` onto it. No behavior change; RLS still off. Deploy and check.
3. **Move the 3 browser DB calls into one function** `api/crew.js` (`?action=`: `conversations` GET/POST, `updates` GET + admin-only POST, `chat-image` returns a signed upload URL). Update `index.html` to call it. Finally delete the supabase-js script tag and hard-coded key, so the browser never touches Supabase. (`updates` POST becomes admin-gated server-side; today any crew member could post via the anon key.)
4. **PIN hardening** (touches `login.js` only). Add `pin_hash`; store `scrypt(pin + PIN_PEPPER, per-user salt)`, compare with `timingSafeEqual`. **Upgrade on login:** verify the legacy plaintext once, write the hash, blank the old `pin`. Once everyone has logged in (or a one-off script), drop the `pin` column. Add a `login_attempts` table (name, ip, ts) and lock out after 5 failures / 15 min. Raise the input cap from 4 to 8 digits so admins can choose longer PINs. *Honest note:* hashing a 4-digit PIN alone doesn't stop an attacker who has the DB (10k guesses is instant); the **pepper in an env var** and **rate limiting** are what actually help.
5. **Enable RLS** on the 9 tables via a migration (no policies = default-deny; the service role bypasses it, same pattern already used on `plumbers` and `materials_entries`). Also drop the Storage policy `Anon can upload chat images`; keep the bucket public-read for now because chat sends image URLs to Anthropic (photos stay readable by URL; private bucket + signed read URLs is a later hardening). Rollback SQL (`disable row level security`) prepared per table.
6. **Migrations in the repo:** `supabase/migrations/` with a baseline snapshot of the current schema, the three loose root `.sql` files moved in as idempotent early migrations, then the RLS + PIN + Office migrations. Apply through Supabase (MCP `apply_migration` or SQL editor) so history is recorded.

**Verify Milestone 1:** (a) re-run Supabase advisors -> zero ERROR lints; (b) `curl` the REST API with the old publishable key against each of the 9 tables -> empty/denied, inserts denied; (c) on your phone: log in, chat (incl. photo), shop updates, tools check-out, vehicles, training quiz, My Pay all still work; (d) a pre-migration login still works and upgrades to a hash.

## 1. Admin-only gate (checked on the server for every Office request)
- **Sessions:** `login.js` returns `{id, name, is_admin, token}`; token = `base64url(payload).HMAC-SHA256(SESSION_SECRET)` with payload `{sub: id, exp}` (12h). `lib/session.js` `verifySession(req)` reads `Authorization: Bearer`. Built with `node:crypto`, no dependencies. This replaces the client-supplied `plumber_id` / `plumber_name` on all existing endpoints too (closes today's spoofing gaps).
- **One role list in one place:** `lib/auth.js` `ADMIN_ROLES = ['owner','gm','admin','production manager']`, compared trimmed + lowercase. The client reads `is_admin` from the login response instead of keeping its own lists (replaces the 4 hard-coded spots).
- **`requireAdmin(req,res)`:** verify token -> look up role **fresh in the DB on every request** (demoting someone takes effect immediately) -> 401 no/bad token, 403 not admin (generic body). **Every `api/office.js` action calls it first, no exceptions.** The Office nav item hidden in the UI is cosmetic only.
- **Cron endpoint is separate:** agents aren't called by users; `api/agents/run.js` requires `Authorization: Bearer CRON_SECRET` (Vercel adds it automatically), constant-time compare.
- **Open check before coding:** a read-only `select role, count(*) from plumbers group by role` to see real role values and decide whether today's `manager` users map to `production manager` (they currently see Dashboard).
- **Test matrix (script):** every Office action x {no token, crew token, admin token} -> 401 / 403 / 200.

## 2. Supabase tables (RLS on, zero policies, service-role access only via admin-gated functions)
```sql
agent_runs(id uuid pk, agent text, started_at timestamptz, finished_at timestamptz,
           status text check in ('running','ok','error','skipped'), summary text, error text)
findings(id uuid pk, agent text, found_at timestamptz default now(),
         type text, title text, body text, link text, source text,
         dedupe_key text,                       -- ADDED: unique(agent, dedupe_key) so reruns don't duplicate
         status text default 'new' check in ('new','seen'),
         seen_by uuid references plumbers(id), seen_at timestamptz)
reports(id uuid pk, agent text, period text, period_start date, content text,
        created_at timestamptz default now(), unique(agent, period, period_start))
-- indexes: findings(status, found_at desc), findings(type), agent_runs(agent, started_at desc)
```
Additions to your list (small, deliberate): `dedupe_key` (idempotent reruns), `seen_at`, and the unique constraint on reports. "Expected run interval" lives in code (`agents/registry.js`), not the DB.

## 3. Office screens (admin only; one write action: mark as seen)
Nav item "Office" after Dashboard (shown only when `is_admin`), one channel-view with 5 tabs, same card/chip styling as the rest:
- **Today:** newest findings, status `new` first, grouped by day. **Reviews / Mentions:** findings filtered by `type`. **Briefs:** `reports` newest first. **Agent health:** per agent: last run time, status chip, and a "stale" flag if no `ok` run within 2x its expected interval.
- Endpoints (all in `api/office.js`): GET `today`, `findings?type=`, `reports`, `health`; POST `seen {ids}` (sets `status='seen'`, `seen_by`, `seen_at`; nothing else is writable).
- v1 simplification: "seen" is shared (first admin to mark it hides it for others).

## 4. Folder structure
```
api/crew.js            conversations / updates / chat-image upload
api/office.js          admin-gated reads + mark-seen
api/agents/run.js      cron dispatcher: ?agent=<name>, CRON_SECRET only
agents/                NOT routed; one module per agent
  registry.js          name -> { run, expectedEveryHours, sources }
  reviews.js  mentions.js  briefs.js ...
lib/db.js  lib/session.js  lib/auth.js (requireAdmin)
lib/readonly.js        guardedFetch: GET/HEAD only + host allow-list, throws otherwise
lib/agentKit.js        runAgent(name, fn): writes agent_runs, catches errors, never throws
supabase/migrations/   schema history
vercel.json            crons + maxDuration
.env.example           variable NAMES only
```
- **Hobby constraints shape this:** 12 functions/project (we'd use 11: the existing 8 + `crew`, `office`, `agents/run`) and very limited cron (currently ~2 jobs, once a day; I'll re-check Vercel's docs when building since limits change). So **each agent is its own module + its own cron entry, but they share one dispatcher function** (`/api/agents/run?agent=reviews`). If you need more than the cron allowance, free triggers (a GitHub Actions schedule or Supabase `pg_cron`) call the same URL with the same secret. Moving to Pro later changes only `vercel.json`. Set `maxDuration` for the dispatcher.
- **API keys:** per-agent env vars in Vercel only; never in the browser or the DB.
- **Read-only enforced in code, not by convention:**
  1. Agents get a `ctx` object, not raw access: `ctx.fetchSource()` (goes through `guardedFetch`, GET/HEAD only), `ctx.addFinding()`, `ctx.saveReport()`. `agentKit` is the only code that writes, and only to those 3 tables.
  2. Housecall via the existing GET-only `hcFetch`. Note the Housecall API key can't be scoped read-only, so the code guard is the only protection there; for other sources use read-only scopes/keys where the provider offers them.
  3. A check script (`scripts/check-readonly.sh`, run before deploy): fails if anything under `agents/` imports `lib/db`, uses `method:` other than GET, or imports a send/post library.
  4. Agents never message, post, or call a write endpoint anywhere.

## 5. Build order (each step checkable on your phone)
**Milestone 1 - security fixed, crew app unchanged**
1. Disconnect duplicate project; add env vars. *(Vercel dashboard; app unchanged)*
2. `lib/db.js` + switch existing functions to service key. *(whole crew app still works)*
3. `api/crew.js` + client change; remove supabase-js from the browser. *(chat, photo, updates work)*
4. PIN hashing + lockout. *(log in; try 6 wrong PINs -> locked)*
5. Migrations folder (baseline). *(nothing visible)*
6. **Enable RLS (+ storage policy).** *(re-test everything; advisors clean; anon-key curl denied)* -> **Milestone 1 done**

**Milestone 2 - Office shell with a fake finding**
7. Sessions: `session.js`, tokens in login response, endpoints read identity from token. *(crew app still works)*
8. `requireAdmin` + central `ADMIN_ROLES` + `is_admin` in login; test matrix. *(crew account: no Office; direct call -> 403)*
9. Office migrations (3 tables). 10. `api/office.js` + Office screens + one hand-inserted fake finding. *(admin phone: sees it, "mark as seen" works; crew: nothing)* -> **Milestone 2 done**

**After:** 11. Agent kit + dispatcher + `agent_runs` heartbeat agent (does nothing but log a run) -> Agent health shows it. 12. First real read-only agent. 13+. One agent at a time.

## 6. Other things that make this harder than it sounds
- **Hobby limits** (above): 12 functions, tiny cron allowance, short timeouts. Cron runs in **UTC only**, so Eastern schedules drift an hour with daylight saving.
- **Heavy Housecall calls:** `getAllJobsHistory()` pulls ~5-6k jobs; agents must use windowed queries or they'll time out and hit rate limits.
- **Preview deployment URLs sit behind Vercel auth**, so API tests (and `curl`) must target the production domain or use a protection-bypass header.
- **Single 100KB `index.html`**, no `package.json`, no tests, no CI. I'd add a minimal `package.json` (`type: module`, no dependencies) and the check scripts, and keep Office code in the same file/patterns for now.
- **iOS WebKit quirks we already hit** (stacked-content `<button>` clipping, `overflow:hidden` + min-size): build Office cards as `<div>`s with explicit min-heights and test on your actual phone.
- **Role mismatch:** existing case-sensitive `manager/GM/Owner` vs your `owner/GM/admin/production manager`: needs the role-values check in step 1 above.
- **Privacy:** findings may contain customer or reviewer names; admin-only, and worth a retention rule later.
- `list_tables` row counts are stale estimates (e.g. `shop_tools` shows 0 but has data); don't use them for sizing.
- If agents later use an LLM to summarize, add a per-run cost cap.

## Critical files to change
`index.html` (remove direct Supabase, add Office + `is_admin`), `api/login.js`, `lib/auth.js`, `api/tools.js`, `api/vehicles.js`, `api/training.js`, `api/chat.js`, `api/housecall.js`, `api/paycheck.js`, `api/reports-chat.js`. New: `lib/db.js`, `lib/session.js`, `lib/readonly.js`, `lib/agentKit.js`, `api/crew.js`, `api/office.js`, `api/agents/run.js`, `agents/*`, `supabase/migrations/*`, `vercel.json`.

## End-to-end verification
Advisors clean; anon-key `curl` denied on all 9 tables; crew app full pass on phone after RLS; Office auth matrix (no token / crew / admin); fake finding visible and markable as seen by admin only; heartbeat agent shows in Agent health and goes "stale" if its cron is paused; `check-readonly.sh` passes and fails when a write is deliberately added.
