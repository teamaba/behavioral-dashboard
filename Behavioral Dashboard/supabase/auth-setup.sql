-- ============================================================
-- AUTH SETUP — run this in Supabase SQL Editor
-- ============================================================

-- 1. Profiles table — links auth.users to a role and (for clients) a domain/client scope
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('staff','client')),
  client_name text,            -- only meaningful for role = 'client'
  created_at timestamptz default now()
);

-- 2. Allowed emails table — the "guest list" you control manually
--    A row here must exist before someone can sign up / set a password
create table if not exists allowed_emails (
  email text primary key,
  role text not null check (role in ('staff','client')),
  client_name text,
  added_at timestamptz default now()
);

-- ============================================================
-- Seed your initial staff + client emails here.
-- Edit this list any time in the Supabase Table Editor instead
-- of re-running SQL.
-- ============================================================
insert into allowed_emails (email, role, client_name) values
  ('bdean@teamaballc.com', 'staff', null)
on conflict (email) do nothing;

-- 3. Auto-create a profile row when someone signs up,
--    but ONLY if their email is on the allowed list.
create or replace function handle_new_user()
returns trigger as $$
declare
  allowed record;
begin
  select * into allowed from allowed_emails where email = new.email;

  if allowed is null then
    raise exception 'Email % is not authorized to create an account', new.email;
  end if;

  insert into profiles (id, email, role, client_name)
  values (new.id, new.email, allowed.role, allowed.client_name);

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY — lock down data_points and chart_meta
-- ============================================================

alter table data_points enable row level security;
alter table chart_meta enable row level security;
alter table profiles enable row level security;

-- Drop the old "allow all" policies if they exist
drop policy if exists "allow all" on data_points;
drop policy if exists "allow all" on chart_meta;

-- Staff: full read/write on everything
create policy "staff full access points" on data_points
  for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'staff'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'staff'));

create policy "staff full access meta" on chart_meta
  for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'staff'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'staff'));

-- Clients: read-only, and only for now (no client_name scoping yet since
-- charts are currently one-per-domain, not one-per-client — see note below)
create policy "client read points" on data_points
  for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'client'));

create policy "client read meta" on chart_meta
  for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'client'));

-- Profiles: users can read their own profile (needed to check their role client-side)
create policy "read own profile" on profiles
  for select
  using (id = auth.uid());

-- NOTE: Once charts are scoped per-client (not just per-domain), update the
-- client policies above to also filter on a client_id/client_name match.

-- ============================================================
-- INVITE FEATURE — run this block once to add supervisor role
-- ============================================================

-- Extend the role check to include 'supervisor'
alter table profiles
  drop constraint if exists profiles_role_check,
  add constraint profiles_role_check check (role in ('staff','client','supervisor'));

alter table allowed_emails
  drop constraint if exists allowed_emails_role_check,
  add constraint allowed_emails_role_check check (role in ('staff','client','supervisor'));

-- Supervisors get the same full data access as staff
create policy "supervisor full access points" on data_points
  for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'supervisor'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'supervisor'));

create policy "supervisor full access meta" on chart_meta
  for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'supervisor'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'supervisor'));

-- Lock down allowed_emails — only supervisors can read or add to it
alter table allowed_emails enable row level security;

create policy "supervisor read allowed_emails" on allowed_emails
  for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'supervisor'));

create policy "supervisor insert allowed_emails" on allowed_emails
  for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'supervisor'));

-- To seed your first supervisor, update the row manually in the Table Editor:
--   UPDATE allowed_emails SET role = 'supervisor' WHERE email = 'you@example.com';
-- Then update your existing profile row the same way if you've already signed up.
