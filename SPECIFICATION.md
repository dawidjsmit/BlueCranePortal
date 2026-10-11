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

---

## 3. Data model

### Core / registry

- **profiles** — one row per login user: `id` (= auth user), `email`,
  `full_name`, `phone`, `role` (`app_role`), `status` (`account_status`).
  Auto-created on first sign-in by a trigger.
- **units** — `number` (unique), `notes`, `layout_id` → `unit_layouts`.
- **unit_layouts** — `code` (unique), `description`, `drawing_path` (image in
  Storage). ~5 house layouts; a maintenance screen shows which units use each.
- **unit_members** — links a user (`profile_id`) to a `unit_id` with a
  `relation` (owner/tenant/occupant). Drives permission checks + the
  "Linked users" view.

### People per unit (many per unit; separate from login users)

- **owners** — `first_name`, `last_name`, `cell`, `email`, `owner_since`,
  `is_occupant`, `active`, `left_on`, optional `profile_id` (login link).
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

### Photos (Supabase Storage bucket `photos`)

- **unit_photos** — many per unit (`storage_path`, `caption`, `uploaded_by`).
- `unit_layouts.drawing_path`, `pets.photo_path` — single images.

### Tickets (the request workflow)

- **ticket_types** — trustee-managed list (`name`, `sort_order`, `active`).
  Seeded: Question, Problem, Request, Complaint, Maintenance.
- **tickets** — `unit_id`, `type_id`, `logged_by` (+`logged_by_role`),
  `heading`, `description`, `status` (`ticket_status`), `assigned_role`
  (`app_role`), `created_at`, `updated_at`.
- **ticket_feedback** — the conversation: `author_id`, `author_role`, `body`,
  `created_at`.
- **ticket_photos** — images on a ticket (added while draft, by logger/trustee).
- **feedback_photos** — evidence images attached to a feedback entry.

Ticket status enum: `create · sent · busy · waiting · complete · cancelled · parked`.

---

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

## 9. Possible future enhancements

- WhatsApp / email quick-reply links per contact.
- Email/push notifications on ticket status changes.
- Due dates & overdue flags on tickets.
- Search/filter on the global list screens.
- Bulk import of units and residents.
