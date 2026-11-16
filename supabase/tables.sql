-- Mixing Bowl: tables added after schema.sql (friends, sharing, admins).
-- Rebuild order: schema.sql, then this file, then supabase/database-functions.sql. Safe to run more than once.

-- Friend connections (one row per pair; requester asked, addressee answers)
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- 'declined' stays hidden from the person who declined and still reads as "waiting" to the sender
alter table public.friendships drop constraint if exists friendships_status_check;
alter table public.friendships add constraint friendships_status_check check (status in ('pending','accepted','declined'));
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));

-- Requests sent to an email that has no account yet. They turn into a request when that person signs up.
create table if not exists public.pending_invites (
  id uuid primary key default gen_random_uuid(),
  inviter uuid not null references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (inviter, email)
);

-- Invite links
create table if not exists public.invite_links (
  token uuid primary key default gen_random_uuid(),
  inviter uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Recipes sent to a friend (a snapshot, so later edits by the sender don't change it)
create table if not exists public.recipe_shares (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  dismissed boolean not null default false
);

alter table public.friendships enable row level security;
alter table public.pending_invites enable row level security;
alter table public.invite_links enable row level security;
alter table public.recipe_shares enable row level security;
-- No policies on purpose: only the functions below can touch these tables.

-- Save notices: tell a friend when you save one of their recipes
create table if not exists public.save_notices (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  saver uuid not null references auth.users(id) on delete cascade,
  recipe uuid not null,
  title text not null,
  created_at timestamptz not null default now(),
  dismissed boolean not null default false,
  unique (owner, saver, recipe)
);
alter table public.save_notices enable row level security;

-- Site administrators (add your own user id here by hand in the Table Editor)
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
-- No policies on purpose: only is_admin() and the admin_* functions read it.
