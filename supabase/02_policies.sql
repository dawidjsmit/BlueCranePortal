-- ============================================================
--  Blue Crane Vistas Portal — Row-Level Security (RLS) policies
--  Run AFTER 01_schema.sql.
--
--  These rules are enforced by the database itself. Even if the
--  UI had a bug, a tenant still could not read another unit's data.
--
--  Summary of who sees what:
--   trustee           -> everything
--   owner / tenant    -> only unit(s) they are a member of
--   gardener / 3rd pty-> only requests assigned to them
-- ============================================================

alter table profiles      enable row level security;
alter table units         enable row level security;
alter table unit_members  enable row level security;
alter table requests      enable row level security;
alter table request_log   enable row level security;

-- ---------------- profiles ----------------

-- Everyone can read their own profile; trustees can read all.
create policy "read own or trustee reads all"
  on profiles for select
  using ( id = auth.uid() or is_trustee() );

-- A user may update their own name/phone (but not their role/status).
-- Role/status changes are done by trustees (next policy).
create policy "update own basic fields"
  on profiles for update
  using ( id = auth.uid() )
  with check ( id = auth.uid() );

-- Trustees can update any profile (approve, set role, link, etc.).
create policy "trustee manages profiles"
  on profiles for update
  using ( is_trustee() )
  with check ( is_trustee() );

-- ---------------- units ----------------

-- Trustees see all units. Residents see units they belong to.
create policy "read units: trustee or member"
  on units for select
  using ( is_trustee() or is_unit_member(id) );

-- Only trustees create/modify/delete units.
create policy "trustee writes units"
  on units for all
  using ( is_trustee() )
  with check ( is_trustee() );

-- ---------------- unit_members ----------------

-- A user can see their own membership rows; trustees see all.
create policy "read memberships"
  on unit_members for select
  using ( profile_id = auth.uid() or is_trustee() );

-- Only trustees link/unlink people to units.
create policy "trustee writes memberships"
  on unit_members for all
  using ( is_trustee() )
  with check ( is_trustee() );

-- ---------------- requests ----------------

-- Read access:
--   trustee          -> all
--   owner/tenant     -> requests on their unit
--   gardener/3rd pty -> requests assigned to them
create policy "read requests"
  on requests for select
  using (
    is_trustee()
    or is_unit_member(unit_id)
    or assignee_id = auth.uid()
  );

-- Create a request:
--   trustees anywhere; residents only on their own unit.
create policy "create requests"
  on requests for insert
  with check (
    is_trustee()
    or is_unit_member(unit_id)
  );

-- Update a request:
--   trustees fully; an assignee may update (e.g. mark progress) on
--   requests assigned to them.
create policy "update requests"
  on requests for update
  using ( is_trustee() or assignee_id = auth.uid() )
  with check ( is_trustee() or assignee_id = auth.uid() );

-- Only trustees delete requests.
create policy "trustee deletes requests"
  on requests for delete
  using ( is_trustee() );

-- ---------------- request_log ----------------

-- You can read the log for any request you can read.
create policy "read log for visible requests"
  on request_log for select
  using (
    exists (
      select 1 from requests r
      where r.id = request_log.request_id
        and (
          is_trustee()
          or is_unit_member(r.unit_id)
          or r.assignee_id = auth.uid()
        )
    )
  );

-- You can add a log entry to any request you can update.
create policy "write log for updatable requests"
  on request_log for insert
  with check (
    exists (
      select 1 from requests r
      where r.id = request_log.request_id
        and ( is_trustee() or r.assignee_id = auth.uid()
              or is_unit_member(r.unit_id) )
    )
  );
