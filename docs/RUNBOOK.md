# Runbook: copy-paste recipes

Run SQL in **Supabase dashboard -> SQL Editor** (project `dnhcnbloghupybdezuas`). Change the parts in CAPITALS/quotes.
These never show real PINs (they can't: PINs are hashed).

## See who is in the app
```sql
select name, role,
       (pin_hash is not null) as pin_is_hashed,
       (pin is not null)      as old_plain_pin_still_stored
from plumbers order by name;
```
Roles that count as **admin** (case doesn't matter): `owner`, `GM`, `admin`, `production manager`, `manager`. Anything else (`plumber`, `helper`, ...) is regular crew.

## Add a new member
```sql
insert into plumbers (name, pin, role)
values ('Firstname', '1234', 'plumber');
```
- The parentheses after the table name are the **column names**; only the line after `values` holds the person's info.
- `name` must match their **first name in Housecall Pro** exactly (capitalization doesn't matter), or My Day / My Pay will be empty.
- Crew PIN: 4-8 digits, as a quoted string (keeps a leading zero). **Admin roles need 6-8 digits** (a shorter one forces a "Set a new PIN" screen at first login).
- The PIN you type here is temporary: it's turned into a hash the first time they log in.
- If they have a truck, set the truck's `name` in the `vehicles` table to match their name.

## Someone forgot their PIN (reset it)
PINs can't be looked up. Set a temporary one, tell them, and they can keep using it (crew) or will be asked to pick a better one (admin if under 6 digits):
```sql
update plumbers
set pin = 'TEMP_PIN', pin_hash = null, pin_salt = null
where name = 'Firstname';

-- if they were also locked out by wrong tries:
delete from login_attempts where name = 'Firstname' and success = false;
```

## Someone is locked out ("Too many incorrect tries")
Automatic after 5 wrong tries (15 minutes) or 20 from one network address. To clear it now:
```sql
delete from login_attempts where name = 'Firstname' and success = false;
```
See recent tries (who, from where, worked or not):
```sql
select name, ip, success, created_at from login_attempts order by created_at desc limit 30;
```

## Change someone's role
```sql
update plumbers set role = 'production manager' where name = 'Firstname';
```
If they were crew and are now admin, they must **log out and back in** (admin access needs a fresh 12-hour admin login). Demoting takes effect immediately.

## Remove someone for good (permanent; deletes their chat history and pay entries)
Their phone is logged out right away. Order matters because other tables point at them:
```sql
delete from materials_entries where plumber_id = (select id::text from plumbers where name = 'Firstname');
delete from conversations     where plumber_id = (select id from plumbers where name = 'Firstname');
delete from quiz_results      where plumber_id = (select id from plumbers where name = 'Firstname');
delete from plumbers          where name = 'Firstname';
```
To just block someone without deleting anything: `update plumbers set pin = null, pin_hash = null, pin_salt = null where name = 'Firstname';` (they'll still appear in the name list but can't log in).

## Is the old plain-text PIN column finished?
```sql
select count(*) from plumbers where pin is not null;
```
When that is **0**, ask Claude to remove the old `pin` column. **Don't drop it yourself:** the login code still reads it.

## Secrets: what happens if they change
| Variable (Vercel -> Settings -> Environment Variables) | If lost or changed |
|---|---|
| `PIN_PEPPER` | Every hashed PIN stops working. Reset each person with the SQL above. Keep a copy in a password manager. |
| `SESSION_SECRET` | Everyone is logged out once. Harmless, and a good fix if you think a token leaked. |
| `SUPABASE_SERVICE_ROLE_KEY` | The whole app stops working until the new value is saved and redeployed. |

Generate a new random value in your own Terminal (not in a chat): `openssl rand -hex 32`. Set it for Production, Preview and Development, then redeploy.

## Deploying and checking a change
- Push to `main` -> Vercel `plumbing-assistant` builds automatically (about a minute).
- On phones: **fully close the tab** and reopen (or delete and re-add the Home Screen icon) so the old page isn't reused.
- If everyone suddenly can't log in: check `SESSION_SECRET` and `PIN_PEPPER` exist for **Production**, then redeploy.

## Run the safety tests (on the Mac, in the project folder)
```bash
node scripts/test-auth.mjs
node scripts/test-login.mjs
```
Both should end with "All passed".
