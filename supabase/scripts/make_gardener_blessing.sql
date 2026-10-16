-- ============================================================
--  Blue Crane Vistas Portal — set up a Gardener login
--  for Blessing@BlueCrane.zaaz.co.za
--
--  PREREQUISITE (do this FIRST, once):
--  In the Supabase dashboard -> Authentication -> Users -> Add user
--  -> Create new user:
--      Email:    Blessing@BlueCrane.zaaz.co.za
--      Password: abc123
--      [x] Auto Confirm User   <-- important (fake email, no inbox)
--  Then run this script in the SQL Editor.
--
--  This script:
--   1. ensures a profile row exists for that login,
--   2. sets the role to 'gardener',
--   3. marks the account 'approved' (so they can use the app),
--   4. gives them a display name.
-- ============================================================

-- Upsert the profile for the auth user with that email.
insert into public.profiles (id, email, full_name, role, status)
select u.id,
       u.email,
       'Blessing (Gardener)',
       'gardener'::app_role,
       'approved'::account_status
from auth.users u
where lower(u.email) = lower('Blessing@BlueCrane.zaaz.co.za')
on conflict (id) do update
  set role      = 'gardener'::app_role,
      status    = 'approved'::account_status,
      full_name = coalesce(public.profiles.full_name, 'Blessing (Gardener)');

-- Confirm the result (should show one row: gardener / approved).
select email, full_name, role, status
from public.profiles
where lower(email) = lower('Blessing@BlueCrane.zaaz.co.za');
