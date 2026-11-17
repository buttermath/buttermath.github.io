-- Recipe links: send a recipe to someone who isn't on Butter Math yet.
-- Adds new tables and functions only; nothing existing changes.

create table if not exists public.recipe_links (
  token uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users(id) on delete cascade,
  recipe uuid not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists recipe_links_sender_recipe on public.recipe_links(sender, recipe);

-- Who has already opened a link, so each person gets the recipe once
create table if not exists public.recipe_link_claims (
  token uuid not null references public.recipe_links(token) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (token, recipient)
);

alter table public.recipe_links enable row level security;
alter table public.recipe_link_claims enable row level security;

-- Make (or refresh) the link for one of my recipes. The link carries a copy of the recipe as it is now.
create or replace function public.create_recipe_link(rid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d jsonb; t uuid;
begin
  select data into d from recipes where id = rid and user_id = auth.uid();
  if d is null then raise exception 'not found'; end if;
  select token into t from recipe_links where sender = auth.uid() and recipe = rid order by created_at desc limit 1;
  if t is null then
    if (select count(*) from recipe_links where sender = auth.uid() and created_at > now() - interval '1 day') >= 50 then
      raise exception 'slow down';
    end if;
    insert into recipe_links(sender, recipe, data) values (auth.uid(), rid, d) returning token into t;
  else
    update recipe_links set data = d where token = t;
  end if;
  return t;
end $$;

-- Shown on the sign-up page (works signed out): who sent it and the recipe title
create or replace function public.recipe_link_info(t uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', case when sender = auth.uid() then '__self' else mb_name(sender) end, 'title', data->>'title')
  from recipe_links where token = t
$$;

-- After sign-in: put the recipe in my Sent to you list
create or replace function public.accept_recipe_link(t uuid) returns json
language plpgsql security definer set search_path = public as $$
declare s uuid; d jsonb; me uuid := auth.uid(); n int; sid uuid;
begin
  select sender, data into s, d from recipe_links where token = t;
  if s is null or me is null then return null; end if;
  if s = me then return json_build_object('self', true); end if;
  insert into recipe_link_claims(token, recipient) values (t, me) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    insert into recipe_shares(sender, recipient, data) values (s, me, d) returning id into sid;
    -- and a friend request from the sender, unless they're already connected
    insert into friendships(requester, addressee) values (s, me) on conflict do nothing;
  end if;
  return json_build_object('name', mb_name(s), 'title', d->>'title', 'again', n = 0, 'share', sid);
end $$;

revoke all on function public.create_recipe_link(uuid), public.recipe_link_info(uuid), public.accept_recipe_link(uuid) from public, anon;
grant execute on function public.create_recipe_link(uuid), public.recipe_link_info(uuid), public.accept_recipe_link(uuid) to authenticated;
grant execute on function public.recipe_link_info(uuid) to anon;
