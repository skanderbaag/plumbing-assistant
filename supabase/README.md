# Database history (Supabase)

`migrations/` is the complete, ordered history of the database. Files run in filename order:

| File | What it is |
|---|---|
| `20260101000000_baseline_schema.sql` | The database as it was before history began (snapshot Oct 2026). Already in production; recorded as applied, never re-run. Safe to run by accident (`IF NOT EXISTS`). |
| `20261019165338_pin_hardening.sql` | Hashed PINs + `login_attempts`. Applied. |

## Rules for every future database change
1. **Never change the database by hand-typing SQL and forgetting it.** Put the change in a new file here:
   `YYYYMMDDHHMMSS_short_name.sql` (the date/time makes it sort after everything before it).
2. Apply it with Claude (Supabase connection, which records it in Supabase's history table) or paste it in the Supabase SQL Editor. If you use the SQL Editor, tell Claude so the history is recorded.
3. The filename's number should match the version Supabase records. Claude checks this (`select version, name from supabase_migrations.schema_migrations order by version;`).
4. Every new table gets row-level security ON with no public policies, like `plumbers` and `login_attempts`. Only the server (service-role key) reads or writes data.
5. Never edit a migration that has already been applied: add a new one instead.

`legacy/` holds the old loose SQL files that were run by hand before this history existed. They are kept only for reference; do not run them.
