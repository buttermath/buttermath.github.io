-- Error report limits (Hayley OK'd, Nov 20, 2026; applied in Supabase the same day). Deletes nothing.
-- Adds a rate cap and two indexes.
-- A second size check (error_log_sizes) was added here on Nov 20 and removed the same day (Hayley OK'd):
-- it repeated error_log_len, the size limit that was already there. See error-reports.sql.

create index if not exists error_log_at on public.error_log (at);
create index if not exists error_log_user_at on public.error_log (user_id, at);

-- At most 50 reports an hour from one member, and 500 an hour from everyone together.
-- Reports past the cap are skipped quietly, so the site never shows an error for it.
create or replace function public.error_log_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and (select count(*) from error_log where user_id = new.user_id and at > now() - interval '1 hour') >= 50 then
    return null;
  end if;
  if (select count(*) from error_log where at > now() - interval '1 hour') >= 500 then
    return null;
  end if;
  return new;
end $$;

revoke all on function public.error_log_rate() from public, anon, authenticated;

create or replace trigger error_log_rate
  before insert on public.error_log
  for each row execute function public.error_log_rate();
