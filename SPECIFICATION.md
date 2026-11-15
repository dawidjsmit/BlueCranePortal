# Blue Crane Vistas Portal — System Specification

> A snapshot of the system as currently built. Compiled from the codebase,
> not from memory. Use it as the reference document for the application and,
> if ever needed, as the blueprint to rebuild it.

---

## 1. Overview

**Blue Crane Vistas Portal** is a web application for a residential complex
(a sectional-title scheme). It replaces ad-hoc per-unit WhatsApp chats with a
single, centralised, trackable system where a trustee manages the unit
registry and residents log and track tickets.

- **Front end:** a static single-page app (plain HTML + CSS + vanilla
  JavaScript — no build step). Hosted on **GitHub Pages**.
- **Back end:** **Supabase** (hosted PostgreSQL + Auth + Storage). The browser
  talks to Supabase directly using the public "anon" key; all access control
  is enforced by **Row-Level Security (RLS)** in the database.
- **Auth:** passwordless **magic link** or **email + password** (optional,
  with a reset flow).

### Files
| File | Purpose |
|------|---------|
| `index.html` | Page structure, auth screens, all modals |
| `styles.css` | Styling (responsive, tablet + desktop) |
| `app.js` | All application logic (auth, routing, role-aware views, data access) |
| `config.js` | Public Supabase URL + anon key |
| `assets/logo.svg` | Blue crane logo (used in header, login, favicon) |
| `supabase/*.sql` | Database migrations (run in order) |
| `supabase/SETUP.md` | One-time setup guide |

---

## 2. Roles

Six login roles (enum `app_role`):

| Role | Purpose |
|------|---------|
| `trustee` | Full administrator — sees and does everything |
| `owner` | Owner of one or more units |
| `tenant` | Tenant (contract signer) of one or more units |
| `occupant` | A household member who logs in |
| `gardener` | Service worker; sees tickets routed to the gardener role |
| `service_provider` | External provider; sees tickets routed to their role |

**Account lifecycle** (enum `account_status`): `pending → approved → rejected`.
New sign-ups start `pending`; a trustee approves them and links them to a unit.
The first trustee is promoted manually once via SQL.

**Logging a ticket:** the user picks what it relates to: a unit ("Unit 01"…),
a communal entity (type then entity), or neither (shown as "General"). Never
both (check `ticket_target_at_most_one`, migration 32). Any approved, active
user may log a ticket in their own name.

**Ticket window:** a **Reassign** box (trustees, or whoever holds the assigned
role) sends the ticket to another role via RPC `reassign_ticket` (adds a
"Reassigned from X to Y" note to the history, status Waiting). Below it,
**Feedback**: the composer (text + optional photo + Post feedback in one box),
then the history newest first. Posting as the holder marks the ticket Busy
(RPC `mark_ticket_busy`) only from Sent or Waiting; Parked stays Parked. Trustees
reopen a Parked / Complete / Cancelled ticket with ▶️ Mark Busy. "This ticket relates to" is picked with icon tiles.

**Adding users:** a trustee can create a login on the Users screen
(**+ Add user**: role, an unlinked registry record, name, email, password of at
least 6 characters). The user is approved and linked straight away. This runs
in the `manage-users` Edge Function (service role stays server-side).

**Editing a user** (✏️): full name, sign-in email, role and registry record.
An email change goes through `manage-users` (`update_email`): Supabase Auth
email is changed immediately without a confirmation email, `profiles.email`
is kept in step, password and sessions are unaffected. The registry record's
own email is maintained separately.

**Deactivation:** a trustee can deactivate a user (`profiles.deactivated_at`
set + Supabase Auth ban), and reactivate them later. A deactivated user cannot
sign in, sees an "Account deactivated" screen if a session is still open, and
a deactivated trustee loses `is_trustee()` at once. An already-issued access
token can stay valid until it expires (up to ~1 hour). Guards (trigger
`profiles_guard_role_status`): only trustees change role/status/active state,
no self-deactivation, never the last active trustee.

---

## 3. Data model

### Core / registry

- **profiles** — one row per login user: `id` (= auth user), `email`,
  `full_name`, `phone`, `role` (`app_role`), `status` (`account_status`).
  Auto-created on first sign-in by a trigger.
- **units** — `number` (unique whole number, >= 1), `notes`, `layout_id` → `unit_layouts`.
- **unit_layouts** — `code` (unique), `description`, `drawing_path` (image in
  Storage). ~5 house layouts; a maintenance screen shows which units use each.
- **User ↔ registry link** — each login user is linked to exactly one registry
  record for their role (`trustees`, `owners`, `tenants`, `occupants`,
  `gardeners`, `service_providers`; the record's `profile_id` = the user). A
  user's units are derived from that record (trustee: its unit; owner: its
  active unit links; tenant/occupant: its unit; gardener / service provider:
  none). Linking is done by the trustee-only `link_user_to_record()` function.
- **unit_members** — legacy hand-made user↔unit links; kept only where the
  registry doesn't yet cover a user.

### People per unit (many per unit; separate from login users)

- **owners** — one row per PERSON: `first_name`, `last_name`, `cell`, `email`,
  optional `profile_id` (login link).
- **unit_owners** — links an owner to each unit they own: `owner_since`,
  `is_occupant`, `active`, `left_on`. An owner is the occupant of at most one
  unit (while active); an owner appears on a given unit at most once.
- **tenants** — same personal fields plus `tenant_since`, `lease_with`
  (`owner`/`agency`), `agency_name`/`agency_cell`/`agency_email`,
  `active`, `left_on`, optional `profile_id`.
- **occupants** — household members: personal fields, `occupant_since`,
  `relationship` (`spouse`/`child`/`live_in_employee`/`other`),
  `related_owner_id`, `related_tenant_id`, `active`, `left_on`,
  optional `profile_id`.
- **pets** — `name`, `pet_type` (`dog`/`cat`/`other`+`type_other`), `breed`,
  `gender`, `colour`, `sterilised`, `photo_path`; a polymorphic holder
  (`holder_kind` = owner/tenant/occupant + `holder_id`).

**Occupant auto-listing:** owners/tenants flagged `is_occupant` are shown in a
unit's Occupants list by combining lists (computed, not duplicated). The
`occupants` table holds only the *other* household members.

### Trustee-only registries
- **trustees** — name, surname, cell, linked unit (at most one), service start/end, optional `profile_id`.
- **gardeners** — name, surname, gender, ID number, date of birth, cell, email, service start/end, optional `profile_id`.
- **service_providers** — person or company (name + surname, or company name + contact person), phone, email, service start/end, optional `profile_id`.
A service end date that is empty means current. Readable and writable by trustees only (they hold personal data such as ID numbers).

### Photos (Supabase Storage bucket `photos`)

- **unit_photos** — many per unit (`storage_path`, `caption`, `uploaded_by`).
- `unit_layouts.drawing_path`, `pets.photo_path` — single images.

### Tickets (the request workflow)

- **ticket_types** — trustee-managed list (`name`, `description`, `sort_order`, `active`).
  Seeded: Question, Problem, Request, Complaint, Maintenance.
- **tickets** — `unit_id`, `type_id`, `logged_by` (+`logged_by_role`),
  `heading`, `description`, `status` (`ticket_status`), `assigned_role`
  (`app_role`), `created_at`, `updated_at`.
- **ticket_feedback** — the conversation: `author_id`, `author_role`, `body`,
  `created_at`.
- **ticket_photos** — images on a ticket (added while draft, by logger/trustee).
- **feedback_photos** — evidence images attached to a feedback entry.

Ticket status enum: `create · sent · busy · waiting · complete · cancelled · parked`.
The statuses are fixed (the workflow and security rules depend on them).
`ticket_status_info` holds a trustee-editable description per status, shown as
a hint wherever a status appears.

---

> Naming: screens say "Communal entity"; the database still uses the original
> names (`communal_areas`, `communal_area_types`, `communal_area_photos`,
> `tickets.communal_area_id`). This is intentional — renaming tables adds risk
> with no benefit to users.

## 4. Permissions (enforced by RLS + mirrored in the UI)

For a user acting on a unit **they are linked to**:

| Data | Trustee | Owner | Tenant | Occupant | Gardener / Service Provider |
|------|---------|-------|--------|----------|------------------------------|
| Unit basics (nr/notes/layout) | edit | view | view | view | view |
| Unit photos | all | upload/delete | view | view | view |
| Owner details | all | edit (active) | none | none | none |
| Tenant details | all | edit (active) | edit (active) | — | none |
| Occupants | all | edit (active) | edit (active) | — | none |
| Pets | all | edit | edit | — | none |

- **Residents see only ACTIVE records**; trustees see history (inactive too).
- **Tenants** never see owner data; their pet "belongs to" list excludes owners.
- **Linked-users** section is visible to **owners + trustees** only.
- **Gardeners / service providers** see a unit's **basics + photos** only, and
  only for units where they have a ticket assigned to their role.

Key DB helper functions: `is_trustee()`, `is_unit_member()`, `is_unit_owner()`,
`is_unit_tenant()`, `is_unit_assignee()`, `has_unit_role()`, `can_see_ticket()`.

---

## 5. Ticket workflow

**Who can log:** trustee, owner, tenant, occupant, gardener, service_provider.

**Fields:** unit, type (managed list), logged-by (current user), heading,
detailed description, 0+ photos, status, assigned-to role, feedback thread.

**Lifecycle:**
1. **Create** — a draft owned by the logger; only they see it. They may edit,
   add/remove photos, or delete it.
2. **Submit & send** → status **Sent**, `assigned_role` = `trustee`.
3. After submit, only **trustees** edit ticket details; everyone who can see
   it may add **feedback**.
4. **Feedback** = a conversation (author, role, time, text, optional photo),
   addable by anyone who can see the ticket.
5. **Routing** — a trustee, or a user holding the ticket's current
   `assigned_role`, may optionally **"send to"** another role.

**Status automation:**
- A user **in the assigned role** posts feedback **without** rerouting → **Busy**.
- Ticket **rerouted** to another role → **Waiting** (+ `assigned_role` changes).
- **Trustees only** set **Complete / Cancelled / Parked**.

**Ticket visibility:**
- Trustee: all tickets.
- Owner/tenant/occupant: all tickets on units they belong to.
- Gardener/service provider: a ticket **only while assigned to their role**.
- Logger: always their own.
- "**Needs my feedback**" = tickets currently assigned to a role the user holds.

---

## 6. Screens

**All users:** Dashboard, Tickets. Residents also get **My unit(s)**.

**Trustee-only tabs:** Units, Owners, Tenants, Occupants, Pets, Layouts,
Ticket types, Users.

- **Dashboard** — counts + "Needs my feedback" list.
- **Tickets** — grouped: my drafts, needs my feedback, other tickets; opens a
  ticket detail with photos, status controls, and the feedback conversation.
- **Units** → **unit detail**: basics, photos, owners, tenants, occupants,
  pets, and (owners/trustees) linked users. Global **Owners/Tenants/Occupants/
  Pets** tabs list across all units with a clickable chip back to the unit.
- **Layouts / Ticket types / Users** — trustee maintenance screens.
- **Projects** (Registry, trustee-only) — name, description, created (automatic),
  start date, optional due and finish dates, status (`project_statuses`, managed on
  **Project statuses** under Admin like ticket types), optional run-by trustee.
  Links: units (`project_units`), communal entities (`project_areas`), service
  providers (`project_providers`) — saved together via RPC `save_project`.
  A ticket can belong to one project (`tickets.project_id`), set from the project
  screen or the ticket's Edit details; only trustees can change it (trigger
  `tickets_guard_project`). List filter: status.
- **10 Year Plan** (Registry, trustee-only) — plan items (`plan_items`: name,
  description, year, budget, actual spend, optional grouping, optional
  communal entity type (`type_id`, must belong to the grouping; shown on the tile above the name), status from `plan_statuses`, managed
  on **Plan statuses** under Admin) with zero or more projects (`plan_item_projects`,
  saved via RPC `save_plan_item`). Shown as a matrix: rows = groupings (A–Z, then
  "No grouping"), columns = 10 years starting this year (Earlier/Later to shift),
  budget total and actual spend total per year. An item's year can be changed freely; the intended
  practice (not enforced) is to mark an unachieved item Postponed and add a new
  item in a later year.
- Communal entities list shows the type as "Grouping – Type"; the project form's
  entity tick boxes show "Grouping – Type – Code – Name".
- **Communal entity groupings** (Admin) — name + description (`communal_area_groups`).
  Each communal entity type may have one grouping (`communal_area_types.group_id`);
  the types screen has a Grouping column and filter. Every type picker shows
  "Grouping – Type", ordered by grouping then type (ungrouped types last).
- **Users** — list (pending, active, deactivated), approve & link, **+ Add
  user**, Deactivate / Reactivate (in-app confirmation), Last log in column with
  a 📜 shortcut to that user's activity.
- **User activity** (Admin) — log of sign-ins, latest first; defaults to the
  last 7 days; filters: date from, date to, user (including deactivated users).
  Rows come from `user_activity`, written only by trigger `on_auth_user_login`
  (fires when `auth.users.last_sign_in_at` changes; migration 26). Later this
  table can hold other activity types.

---

## 7. Setup (summary — see `supabase/SETUP.md` for full detail)

1. Create a Supabase project.
2. Run the SQL migrations **in order**:
   `01_schema` → `02_policies` → `03_seed` (optional) → `04` → `05` → `06`
   → `07` → `08_storage_policies` → `09` → `10a_add_occupant_role` (alone,
   first) → `10_phase_t1_tickets` → `11_phase_t2_drop_requests` (after T2 live).
3. Enable email auth (magic link + password); set Site URL + Redirect URLs to
   the live app URL.
4. Create the `photos` Storage bucket (public) — `08_storage_policies.sql`
   does the bucket + policies.
5. Paste the Supabase URL + anon key into `config.js`.
6. Sign in once, then promote your account to `trustee` via SQL.

---

## 8. Deployment

- Hosted on **GitHub Pages** via `.github/workflows/deploy-pages.yml` — every
  push to `main` publishes the site.
- The live URL must be present in Supabase **Auth → URL Configuration**
  (Site URL + Redirect URLs) for magic-link / password-reset links to return
  to the app.

---

## 8b. Housekeeping

- **Image resizing:** every image upload is scaled down in the browser before
  it is stored (photos: longest side 1600 px, JPEG quality 0.82; layout
  drawings: 2400 px, quality 0.9). PDFs and other files are stored as-is.
- **Keep-alive:** a daily GitHub Actions workflow runs one small database
  query so the free Supabase project is not paused for inactivity.

## 9. Possible future enhancements

- WhatsApp / email quick-reply links per contact.
- Email/push notifications on ticket status changes.
- Due dates & overdue flags on tickets.
- Search/filter on the global list screens.
- Bulk import of units and residents.
