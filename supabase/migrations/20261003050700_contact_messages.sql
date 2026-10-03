-- The contact form's messages. Written only by the API (server/src/contact),
-- which holds the project's secret key; nothing in the browser can reach this
-- table. Applied with `npm run db:push` (DEPLOY.md, step 10a).

create table public.contact_messages (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  name         text not null check (char_length(name) between 1 and 100),
  email        text not null check (char_length(email) between 3 and 254),
  message      text not null check (char_length(message) between 1 and 5000),
  -- The sender's address, kept only as long as the rate limit needs it: the
  -- job at the bottom clears it after 30 days.
  ip           inet,
  -- Set by the API once each notification has gone out; a row with neither
  -- and a notify_error is a message that arrived but was never announced.
  emailed_at   timestamptz,
  texted_at    timestamptz,
  notify_error text
);

create index contact_messages_ip_created_at on public.contact_messages (ip, created_at desc);
create index contact_messages_created_at on public.contact_messages (created_at desc);

-- RLS on with no policies: the publishable key gets nothing, the secret key
-- (which bypasses RLS) gets everything. The revoke is the same rule twice.
alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from anon, authenticated;

/*
 * Stores a message unless its sender is over the limit, in one transaction so
 * two submissions arriving together cannot both slip under it.
 *
 * Senders are counted by network, not address: an IPv6 host can hop between
 * addresses inside its /64 at will, so that is the unit for IPv6. The site-wide
 * cap bounds what a botnet spread across many addresses can cost in email and
 * SMS.
 *
 * Returns the new row's id, or null when the message was refused.
 */
create function public.submit_contact(p_name text, p_email text, p_message text, p_ip inet)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender  inet := network(set_masklen(p_ip, case when family(p_ip) = 6 then 64 else 32 end));
  new_id  bigint;
begin
  perform pg_advisory_xact_lock(hashtext('contact_messages'));

  if (select count(*) from public.contact_messages
      where ip <<= sender and created_at > now() - interval '1 hour') >= 3 then
    return null;
  end if;

  if (select count(*) from public.contact_messages
      where created_at > now() - interval '1 day') >= 30 then
    return null;
  end if;

  insert into public.contact_messages (name, email, message, ip)
  values (p_name, p_email, p_message, p_ip)
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.submit_contact(text, text, text, inet) from public, anon, authenticated;
grant execute on function public.submit_contact(text, text, text, inet) to service_role;

-- Forget senders' addresses once they no longer count towards any limit.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'contact-messages-forget-ips',
  '17 3 * * *',
  $$update public.contact_messages set ip = null where ip is not null and created_at < now() - interval '30 days'$$
);
