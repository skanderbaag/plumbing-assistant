# Legacy SQL (reference only, do not run)

These were run by hand in the Supabase SQL Editor before migration history existed. Their effects are
already captured in `../migrations/20260101000000_baseline_schema.sql`, so running them again is unnecessary
and one is actively wrong:

- `supabase_chat_images_setup.sql`: created the chat photo bucket and its anonymous policies (a second,
  duplicate upload policy was added separately by hand). Step 7 removes the upload policies.
- `supabase_lock_down_plumbers.sql`: turned security on for `plumbers`.
- `supabase_weekly_pay_entries.sql`: **outdated.** Created `weekly_pay_entries`, which was later dropped and
  replaced by `materials_entries` (same file, edited in place). Running it again would recreate the old table
  and drop nothing.
