-- Mixing Bowl: snapshot of the live database code (functions and access rules), exported from Supabase on 2026-11-16.
-- Tables are created by schema.sql and friends.sql. Run those first, then this file, to rebuild the database code.
-- Safe to re-run: every function uses create or replace.

-- Table columns at export time (for reference):
--   public.admins: user_id uuid not null
--   public.friendships: id uuid default gen_random_uuid() not null, requester uuid not null, addressee uuid not null, status text default 'pending'::text not null, created_at timestamp with time zone default now() not null
--   public.invite_links: token uuid default gen_random_uuid() not null, inviter uuid not null, created_at timestamp with time zone default now() not null
--   public.kitchens: user_id uuid default auth.uid() not null, shopping jsonb default '{"items": [], "sections": []}'::jsonb not null, progress jsonb default '{"cook": {}, "shop": {}, "active": {}}'::jsonb not null, updated_at timestamp with time zone default now() not null
--   public.pending_invites: id uuid default gen_random_uuid() not null, inviter uuid not null, email text not null, created_at timestamp with time zone default now() not null
--   public.recipe_shares: id uuid default gen_random_uuid() not null, sender uuid not null, recipient uuid not null, data jsonb not null, note text, created_at timestamp with time zone default now() not null, dismissed boolean default false not null
--   public.recipes: id uuid default gen_random_uuid() not null, user_id uuid default auth.uid() not null, sort double precision default EXTRACT(epoch FROM now()) not null, data jsonb not null, created_at timestamp with time zone default now() not null
--   public.save_notices: id uuid default gen_random_uuid() not null, owner uuid not null, saver uuid not null, recipe uuid not null, title text not null, created_at timestamp with time zone default now() not null, dismissed boolean default false not null  

-- ===== Functions =====

CREATE OR REPLACE FUNCTION public.accept_invite_link(t uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv uuid; me uuid := auth.uid();
begin
  select inviter into inv from invite_links where token = t;
  if inv is null or me is null or inv = me then return null; end if;
  insert into friendships(requester, addressee, status) values (inv, me, 'accepted')
    on conflict ((least(requester, addressee)), (greatest(requester, addressee))) do update set status = 'accepted';
  return mb_name(inv);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_backup()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not exists(select 1 from public.admins where user_id = auth.uid()) then raise exception 'not allowed'; end if;
  return json_build_object(
    'exported_at', now(),
    'version', 2,
    'members', (select coalesce(json_agg(json_build_object('id', id, 'email', email, 'name', raw_user_meta_data->>'name', 'created_at', created_at)), '[]'::json) from auth.users),
    'recipes', (select coalesce(json_agg(r), '[]'::json) from public.recipes r),
    'kitchens', (select coalesce(json_agg(k), '[]'::json) from public.kitchens k),
    'friendships', (select coalesce(json_agg(f), '[]'::json) from public.friendships f),
    'pending_invites', (select coalesce(json_agg(p), '[]'::json) from public.pending_invites p),
    'invite_links', (select coalesce(json_agg(i), '[]'::json) from public.invite_links i),
    'recipe_shares', (select coalesce(json_agg(s), '[]'::json) from public.recipe_shares s),
    'save_notices', (select coalesce(json_agg(n), '[]'::json) from public.save_notices n));
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_friend_counts()
 RETURNS TABLE(email text, friends bigint, pending bigint, shared bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not exists(select 1 from public.admins where user_id = auth.uid()) then raise exception 'not allowed'; end if;
  return query
    select u.email::text,
      (select count(*) from friendships f where f.status = 'accepted' and u.id in (f.requester, f.addressee)),
      (select count(*) from friendships f where f.status <> 'accepted' and u.id in (f.requester, f.addressee))
        + (select count(*) from pending_invites p where p.inviter = u.id),
      (select count(*) from recipe_shares s where s.sender = u.id)
    from auth.users u;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_restore(bk jsonb, apply boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  umap jsonb := '{}'::jsonb;      -- old user id -> current user id
  matched jsonb := '[]'::jsonb;
  waiting jsonb := '[]'::jsonb;
  add_ids jsonb := '[]'::jsonb;   -- recipes that were (or would be) added
  m record; r record; k record; f record; x record;
  cur uuid; d jsonb;
  n_rec int := 0; n_have int := 0; n_wait int := 0;
  n_kit int := 0; n_fr int := 0; n_inv int := 0; n_lnk int := 0; n_sh int := 0; n_sn int := 0;
  c int;
begin
  if not exists(select 1 from public.admins where user_id = auth.uid()) then raise exception 'not allowed'; end if;
  if bk is null or jsonb_typeof(bk->'members') is distinct from 'array' or jsonb_typeof(bk->'recipes') is distinct from 'array' then
    raise exception 'That does not look like a Mixing Bowl backup';
  end if;

  -- Match people in the backup to accounts that exist now, by email
  for m in select * from jsonb_to_recordset(bk->'members') as t(id uuid, email text, name text) loop
    select u.id into cur from auth.users u where lower(u.email) = lower(m.email) limit 1;
    if cur is null then
      waiting := waiting || to_jsonb(coalesce(m.email, ''));
    else
      umap := umap || jsonb_build_object(m.id::text, cur::text);
      matched := matched || jsonb_build_object('email', m.email, 'name', m.name);
    end if;
  end loop;

  begin
    -- Recipes (keep the same id so shares and links still point at them)
    for r in select * from jsonb_to_recordset(bk->'recipes') as t(id uuid, user_id uuid, sort double precision, data jsonb, created_at timestamptz) loop
      if not (umap ? r.user_id::text) then n_wait := n_wait + 1; continue; end if;
      if exists(select 1 from public.recipes where id = r.id) then n_have := n_have + 1; continue; end if;
      cur := (umap->>r.user_id::text)::uuid;
      d := r.data;
      if cur <> r.user_id then d := replace(d::text, r.user_id::text, cur::text)::jsonb; end if;  -- photo paths live in the owner's folder
      insert into public.recipes(id, user_id, sort, data, created_at)
        values (r.id, cur, coalesce(r.sort, extract(epoch from now())), d, coalesce(r.created_at, now()));
      n_rec := n_rec + 1; add_ids := add_ids || to_jsonb(r.id::text);
    end loop;

    -- Shopping list and progress: add if missing, or fill in a kitchen that is still empty (a brand-new account has one)
    for k in select * from jsonb_to_recordset(bk->'kitchens') as t(user_id uuid, shopping jsonb, progress jsonb) loop
      if not (umap ? k.user_id::text) then continue; end if;
      cur := (umap->>k.user_id::text)::uuid;
      if not exists(select 1 from public.kitchens where user_id = cur) then
        insert into public.kitchens(user_id, shopping, progress)
          values (cur, coalesce(k.shopping, '{"sections":[],"items":[]}'::jsonb), coalesce(k.progress, '{"shop":{},"active":{},"cook":{}}'::jsonb));
        n_kit := n_kit + 1;
      elsif exists(select 1 from public.kitchens e where e.user_id = cur
                   and jsonb_array_length(coalesce(e.shopping->'items', '[]'::jsonb)) = 0
                   and not exists(select 1 from jsonb_each(e.progress) j where j.value not in ('{}'::jsonb, '[]'::jsonb, 'null'::jsonb))
                   and (e.shopping, e.progress) is distinct from (k.shopping, k.progress)) then
        update public.kitchens set shopping = coalesce(k.shopping, shopping), progress = coalesce(k.progress, progress), updated_at = now() where user_id = cur;
        n_kit := n_kit + 1;
      end if;
    end loop;

    -- Friend connections
    for f in select * from jsonb_to_recordset(coalesce(bk->'friendships', '[]'::jsonb)) as t(id uuid, requester uuid, addressee uuid, status text, created_at timestamptz) loop
      if not (umap ? f.requester::text and umap ? f.addressee::text) then continue; end if;
      insert into public.friendships(id, requester, addressee, status, created_at)
        values (f.id, (umap->>f.requester::text)::uuid, (umap->>f.addressee::text)::uuid, f.status, coalesce(f.created_at, now()))
        on conflict do nothing;
      get diagnostics c = row_count; n_fr := n_fr + c;
    end loop;

    for x in select * from jsonb_to_recordset(coalesce(bk->'pending_invites', '[]'::jsonb)) as t(id uuid, inviter uuid, email text, created_at timestamptz) loop
      if not (umap ? x.inviter::text) then continue; end if;
      insert into public.pending_invites(id, inviter, email, created_at)
        values (x.id, (umap->>x.inviter::text)::uuid, x.email, coalesce(x.created_at, now())) on conflict do nothing;
      get diagnostics c = row_count; n_inv := n_inv + c;
    end loop;

    for x in select * from jsonb_to_recordset(coalesce(bk->'invite_links', '[]'::jsonb)) as t(token uuid, inviter uuid, created_at timestamptz) loop
      if not (umap ? x.inviter::text) then continue; end if;
      insert into public.invite_links(token, inviter, created_at)
        values (x.token, (umap->>x.inviter::text)::uuid, coalesce(x.created_at, now())) on conflict do nothing;
      get diagnostics c = row_count; n_lnk := n_lnk + c;
    end loop;

    for x in select * from jsonb_to_recordset(coalesce(bk->'recipe_shares', '[]'::jsonb)) as t(id uuid, sender uuid, recipient uuid, data jsonb, note text, created_at timestamptz, dismissed boolean) loop
      if not (umap ? x.sender::text and umap ? x.recipient::text) then continue; end if;
      insert into public.recipe_shares(id, sender, recipient, data, note, created_at, dismissed)
        values (x.id, (umap->>x.sender::text)::uuid, (umap->>x.recipient::text)::uuid, x.data, x.note, coalesce(x.created_at, now()), coalesce(x.dismissed, false))
        on conflict do nothing;
      get diagnostics c = row_count; n_sh := n_sh + c;
    end loop;

    for x in select * from jsonb_to_recordset(coalesce(bk->'save_notices', '[]'::jsonb)) as t(id uuid, owner uuid, saver uuid, recipe uuid, title text, created_at timestamptz, dismissed boolean) loop
      if not (umap ? x.owner::text and umap ? x.saver::text) then continue; end if;
      insert into public.save_notices(id, owner, saver, recipe, title, created_at, dismissed)
        values (x.id, (umap->>x.owner::text)::uuid, (umap->>x.saver::text)::uuid, x.recipe, x.title, coalesce(x.created_at, now()), coalesce(x.dismissed, false))
        on conflict do nothing;
      get diagnostics c = row_count; n_sn := n_sn + c;
    end loop;

    -- A preview undoes everything it just did
    if not apply then raise exception 'preview only' using errcode = 'MB001'; end if;
  exception when sqlstate 'MB001' then null;
  end;

  return json_build_object(
    'applied', apply,
    'matched', matched, 'waiting', waiting, 'user_map', umap, 'recipe_ids', add_ids,
    'add', json_build_object('recipes', n_rec, 'kitchens', n_kit, 'friendships', n_fr, 'invites', n_inv + n_lnk, 'shares', n_sh, 'notices', n_sn),
    'recipes_already_there', n_have, 'recipes_waiting_for_signup', n_wait);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_usage()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'storage'
AS $function$
begin
  if not exists(select 1 from public.admins where user_id = auth.uid()) then raise exception 'not allowed'; end if;
  return json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0),
    'users', (select count(*) from auth.users),
    'last_active', (select max(last_sign_in_at) from auth.users));
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_users()
 RETURNS TABLE(email text, name text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, recipes bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not exists(select 1 from public.admins where user_id = auth.uid()) then raise exception 'not allowed'; end if;
  return query select u.email::text, (u.raw_user_meta_data->>'name')::text, u.created_at, u.last_sign_in_at, (select count(*) from public.recipes r where r.user_id = u.id) from auth.users u order by u.created_at desc;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_invite_link()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t uuid;
begin
  select token into t from invite_links where inviter = auth.uid() order by created_at desc limit 1;
  if t is null then insert into invite_links(inviter) values (auth.uid()) returning token into t; end if;
  return t;
end $function$
;

CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.recipes where user_id = auth.uid();
  delete from public.kitchens where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dismiss_save_notice(notice uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update save_notices set dismissed = true where id = notice and owner = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.dismiss_share(share uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update recipe_shares set dismissed = true where id = share and recipient = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.friend_recipes(friend uuid)
 RETURNS TABLE(id uuid, sort double precision, data jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not mb_are_friends(auth.uid(), friend) then return; end if;
  return query
    select r.id, r.sort, r.data from recipes r left join kitchens k on k.user_id = r.user_id
    where r.user_id = friend
      and coalesce((k.progress->'archived'->>r.id::text)::boolean, false) = false
      and coalesce((k.progress->'private'->>r.id::text)::boolean, false) = false
    order by r.sort;
end $function$
;

CREATE OR REPLACE FUNCTION public.invite_link_info(t uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when inviter = auth.uid() then '__self' else mb_name(inviter) end from invite_links where token = t
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists(select 1 from public.admins where user_id = auth.uid()) $function$
;

CREATE OR REPLACE FUNCTION public.mb_are_friends(a uuid, b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from friendships where status = 'accepted'
    and ((requester = a and addressee = b) or (requester = b and addressee = a)))
$function$
;

CREATE OR REPLACE FUNCTION public.mb_claim_invites()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare me uuid := auth.uid(); my_email text;
begin
  if me is null then return; end if;
  select lower(email) into my_email from auth.users where id = me;
  insert into friendships(requester, addressee)
    select p.inviter, me from pending_invites p
    where p.email = my_email and p.inviter <> me
    on conflict do nothing;
  delete from pending_invites where email = my_email;
end $function$
;

CREATE OR REPLACE FUNCTION public.mb_name(uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select coalesce(nullif(trim(raw_user_meta_data->>'name'), ''), split_part(email, '@', 1)) from auth.users where id = uid
$function$
;

CREATE OR REPLACE FUNCTION public.my_friends()
 RETURNS TABLE(friend_id uuid, name text, status text, incoming boolean, recipes bigint, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform mb_claim_invites();
  return query
    select case when f.requester = auth.uid() then f.addressee else f.requester end,
           mb_name(case when f.requester = auth.uid() then f.addressee else f.requester end),
           case when f.status = 'declined' then 'pending' else f.status end, f.addressee = auth.uid(),
           case when f.status = 'accepted' then (
             select count(*) from recipes r left join kitchens k on k.user_id = r.user_id
             where r.user_id = case when f.requester = auth.uid() then f.addressee else f.requester end
               and coalesce((k.progress->'archived'->>r.id::text)::boolean, false) = false
               and coalesce((k.progress->'private'->>r.id::text)::boolean, false) = false)
           else 0 end,
           f.created_at
    from friendships f where auth.uid() in (f.requester, f.addressee)
      and not (f.status = 'declined' and f.addressee = auth.uid())
    order by f.created_at desc;
end $function$
;

CREATE OR REPLACE FUNCTION public.my_inbox()
 RETURNS TABLE(id uuid, sender_name text, data jsonb, note text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, mb_name(s.sender), s.data, s.note, s.created_at from recipe_shares s
  where s.recipient = auth.uid() and not s.dismissed order by s.created_at desc
$function$
;

CREATE OR REPLACE FUNCTION public.my_save_notices()
 RETURNS TABLE(id uuid, saver_id uuid, saver_name text, title text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.saver, mb_name(s.saver), s.title, s.created_at from save_notices s
  where s.owner = auth.uid() and not s.dismissed order by s.created_at desc limit 50
$function$
;

CREATE OR REPLACE FUNCTION public.note_saved(owner uuid, recipe uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text;
begin
  if note_saved.owner = auth.uid() or not mb_are_friends(auth.uid(), note_saved.owner) then return; end if;
  select left(coalesce(r.data->>'title', 'A recipe'), 200) into t from recipes r left join kitchens k on k.user_id = r.user_id
    where r.id = note_saved.recipe and r.user_id = note_saved.owner
      and coalesce((k.progress->'archived'->>r.id::text)::boolean, false) = false
      and coalesce((k.progress->'private'->>r.id::text)::boolean, false) = false;
  if t is null then return; end if;
  insert into save_notices(owner, saver, recipe, title) values (note_saved.owner, auth.uid(), note_saved.recipe, t)
    on conflict do nothing;
end $function$
;

CREATE OR REPLACE FUNCTION public.remove_friend(friend uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from friendships where (requester = auth.uid() and addressee = friend) or (requester = friend and addressee = auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.respond_friend_request(friend uuid, accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if accept then
    update friendships set status = 'accepted' where requester = friend and addressee = auth.uid() and status = 'pending';
  else
    update friendships set status = 'declined' where requester = friend and addressee = auth.uid() and status = 'pending';
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.send_friend_request(target_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare me uuid := auth.uid(); them uuid; em text := lower(trim(target_email));
begin
  if me is null or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad email'; end if;
  if (select count(*) from friendships where requester = me and created_at > now() - interval '1 day')
   + (select count(*) from pending_invites where inviter = me and created_at > now() - interval '1 day') > 30 then raise exception 'slow down'; end if;
  select id into them from auth.users where lower(email) = em;
  if them = me then return 'sent'; end if;
  if them is null then
    insert into pending_invites(inviter, email) values (me, em) on conflict do nothing;
    return 'invited';
  end if;
  -- They already asked me: accept instead
  update friendships set status = 'accepted' where requester = them and addressee = me and status in ('pending', 'declined');
  if found then return 'sent'; end if;
  insert into friendships(requester, addressee) values (me, them) on conflict do nothing;
  return 'sent';
end $function$
;

CREATE OR REPLACE FUNCTION public.send_recipe(recipe uuid, friends uuid[], msg text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d jsonb; f uuid; n int := 0;
begin
  select data into d from recipes where id = recipe and user_id = auth.uid();
  if d is null then raise exception 'not found'; end if;
  foreach f in array friends loop
    if mb_are_friends(auth.uid(), f) then
      insert into recipe_shares(sender, recipient, data, note) values (auth.uid(), f, d, nullif(left(trim(coalesce(msg, '')), 280), ''));
      n := n + 1;
    end if;
  end loop;
  return n;
end $function$
;  

-- ===== Access rules (row-level security policies) at export time =====
-- Recreate with: drop policy if exists <name> on <table>; then the line below.
create policy "own kitchen" on public.kitchens as PERMISSIVE for ALL to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "own recipes" on public.recipes as PERMISSIVE for ALL to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy "photos: admin upload" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'photos'::text) AND is_admin()));
create policy "photos: delete own" on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "photos: read own" on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "photos: upload own" on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));  
