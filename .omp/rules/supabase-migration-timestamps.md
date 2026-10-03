---
description: Supabase migration filenames carry the system clock's current UTC time; a rename only ever takes a fresh one
condition: 'supabase[\\/]+migrations[\\/]+\d{14}_'
scope: tool
interruptMode: always
---

# Supabase migration timestamps are the system's UTC time

Files in `supabase/migrations/` are named `<YYYYMMDDHHMMSS>_<name>.sql`, and the
CLI applies them in timestamp order. That timestamp MUST be the current **UTC**
time read from the **system clock** when the file is created:

- not local time (Melbourne is 10–11 hours ahead, so a local stamp sorts into
  the future),
- not a rounded or invented time such as `…000000`,
- not copied or shifted from another migration's timestamp.

## Creating

Create migrations only with:

```
npx supabase migration new <name>
```

It stamps the file from the clock in UTC. If a name truly has to be built by
hand, take the timestamp from `date -u +%Y%m%d%H%M%S` in the same step, never
from memory, the conversation, or another file.

## Renaming

A migration's timestamp may only change to a **fresh** one from the system
clock, obtained exactly as above at the time of the rename. Hand-editing the
digits, reusing an old value, or picking one to force an order is not allowed.

Never rename or edit a migration that has already been pushed: it shows under
**Remote** in `npx supabase migration list --linked`, and the project will not
run it again. Change the schema with a new migration instead.

After a rename, update every reference to the old name (DEPLOY.md step 10a
names the first migration in its `migration repair` command).
