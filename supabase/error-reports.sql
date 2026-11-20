-- Error reports: what's in the database, read from Supabase on Nov 20, 2026 (nothing was changed).
-- Kept here so future chats can check the setup without opening Supabase. The app side is logErr() in app.js.

-- The table. Row-level security is on.
--   id bigint, at timestamptz default now(), user_id uuid default auth.uid(),
--   kind text, msg text, detail text, page text, ua text, ver text
-- alter table public.error_log enable row level security;

-- Anyone (signed in or not) can add a report, but only as themselves or with no account attached.
-- create policy "anyone can report errors" on public.error_log for insert to anon, authenticated
--   with check ((user_id is null) or (user_id = auth.uid()));

-- Only admins can read reports. There are no update or delete policies, so nobody can change or remove one through the site.
-- create policy "admin reads errors" on public.error_log for select to authenticated using (is_admin());

-- The Admin page reads reports through this function: the newest 50, with the member's name (or email).
CREATE OR REPLACE FUNCTION public.admin_errors()
 RETURNS TABLE(at timestamp with time zone, kind text, msg text, detail text, page text, ua text, ver text, who text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.at, e.kind, e.msg, e.detail, e.page, e.ua, e.ver, coalesce(nullif(u.raw_user_meta_data->>'name',''), u.email::text)
  from public.error_log e left join auth.users u on u.id = e.user_id
  where public.is_admin() order by e.at desc limit 50 $function$;
