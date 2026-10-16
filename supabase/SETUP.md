# 🔧 Supabase setup — one-time, ~10 minutes

This turns Blue Crane Vistas Portal from a single-device notebook into a real
multi-user app with magic-link logins and role-based access.

Everything here is free for a complex your size.

---

## Step 1 — Create a Supabase project

1. Go to **https://supabase.com** and sign up (free). You can sign in with GitHub.
2. Click **New project**.
   - **Name:** `BlueCranePortal` (anything you like)
   - **Database password:** generate one and save it somewhere (you rarely need it)
   - **Region:** pick the one closest to your complex
3. Wait ~2 minutes for it to provision.

## Step 2 — Create the database

1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Paste the contents of **`01_schema.sql`** → click **Run**.
3. New query again → paste **`02_policies.sql`** → **Run**.
4. (Optional) New query → paste **`03_seed.sql`** → **Run** for 3 example units.

### Migrations (run each once, in order, as the app grows)
The app is built in phases. When you pull a new phase, run its migration
in the SQL Editor the same way:

- **`04_phase1_layouts.sql`** — Unit Layouts + a layout link on Units.
  (Includes 5 starter layouts; edit or remove them in the app.)
- **`05_phase2_owners_tenants.sql`** — Owners & Tenants registry tables
  (many per unit; full contact fields, "since" dates, is-occupant,
  active/left-on history, and tenant lease-with owner/agency).
- **`06_phase3_occupants_pets.sql`** — Occupants (household members, with
  relationship + related owner/tenant) and Pets (type/breed/gender/colour/
  sterilised; photo reserved for Phase 4). Owners/tenants flagged
  "is occupant" are auto-listed as occupants in the app (not duplicated).
- **`07_phase4_photos.sql`** — Unit photos (many per unit), plus RLS so
  trustees manage all photos and owners manage their own unit's photos.
  **Also requires the Storage bucket setup in Step 6 above.**
- **`09_phase5_resident_permissions.sql`** — role-based resident editing:
  owners can edit their unit's owners/tenants/occupants/pets/photos (active);
  tenants can edit tenants/occupants/pets and view photos (no owner data);
  gardeners/service providers view unit basics + photos only. Residents
  only ever see ACTIVE records; trustees keep full access incl. history.
- **`10a_add_occupant_role.sql`** — adds the 6th login role `occupant`.
  **Run this FIRST, on its own, and let it finish**, before the next file.
- **`10_phase_t1_tickets.sql`** — the Ticket system data model: ticket
  types (trustee-managed), tickets (status + assigned role), a feedback
  conversation, ticket & feedback photos, and all their RLS. Run this
  **after** `10a`. (The old `requests` tables are removed in Phase T2.)
- **`11_phase_t2_drop_requests.sql`** — removes the old `requests` /
  `request_log` tables now that the app uses Tickets. Run this **after**
  the Phase T2 app is deployed and you've confirmed tickets work.
- **`12_fix_assignee_ticket_visibility.sql`** — fix so gardeners /
  service providers can see tickets assigned to their role (the old check
  referenced the dropped `requests` table). Run this once.
- **`13_conduct_rules.sql`** — a `documents` table holding the current
  conduct-rules PDF reference. Trustees upload/replace it; every signed-in
  user can read it on the new "Conduct rules" screen.

If each run says *Success. No rows returned*, you're good.

## Step 3 — Turn on email login (magic link + password)

1. Left sidebar → **Authentication** → **Providers**.
2. Make sure **Email** is enabled.
3. Under email settings, **enable "Magic Link"**. Leave the standard
   **email + password** option enabled too — the app offers BOTH:
   - **Magic link** — passwordless, a one-time link by email
   - **Password** — residents who prefer a password can set one from
     their account menu (after a first magic-link sign-in), and there's
     a **Forgot password** reset flow.
   You do NOT need any extra setting for passwords — email/password is on
   by default in Supabase.
4. Left sidebar → **Authentication → URL Configuration**:
   - Set **Site URL** to your live app, e.g.
     `https://dawidjsmit.github.io/BlueCranePortal/`
   - Add the same URL under **Redirect URLs**.
   (This is what makes both the magic link AND the password-reset link
   bring people back to your app.)

## Step 4 — Get your two public keys

1. Left sidebar → **Project Settings** (gear) → **API**.
2. Copy these two values:
   - **Project URL** → looks like `https://abcdxyz.supabase.co`
   - **anon public** key → a long string starting `eyJ...`

> These two are **safe to put in frontend code** — that's exactly what
> the "anon public" key is designed for. Your data is protected by the
> RLS policies, not by hiding this key.

3. Paste them into **`config.js`** in the project root (see that file's
   comments). Commit + push, and your live app will connect.

## Step 5 — Make yourself the first trustee

Because everyone starts as a *pending owner*, you need to promote your
own account once, manually:

1. Open your live app and **sign in with your email** (magic link).
2. Back in Supabase → **SQL Editor**, run (use your real email):

   ```sql
   update profiles
   set role = 'trustee', status = 'approved'
   where email = 'you@example.com';
   ```

3. Refresh the app — you now have the full trustee dashboard, including
   the screen to approve everyone else and link them to units.

## Step 6 — Storage for photos (needed for Phase 4)

Photos (unit photos, pet photos, layout drawings) are files, so they live
in **Supabase Storage**. The easiest way — no clicking through policy
screens — is just two SQL runs:

1. Open the **SQL Editor** (the same place you ran the other migrations).
2. New query → paste all of **`08_storage_policies.sql`** → **Run**.
   (This creates the public `photos` bucket **and** its three access
   policies in one go.)
3. New query → paste all of **`07_phase4_photos.sql`** → **Run**.
   (This creates the `unit_photos` table + the finer "owners manage their
   own unit's photos" rules.)

That's it — the app's upload/delete buttons will now work. You can confirm
the bucket exists under **Storage** in the sidebar.

> Why two files? `08` sets up the file **storage** (where images live);
> `07` sets up the **database** records that link photos to units. The app
> layer + `07`'s policies enforce the finer rule (trustees manage all
> photos; owners manage their own unit's).

---

## 🔐 How "who sees what" is enforced

| Role | Sees |
|---|---|
| **trustee** | everything; approves accounts; assigns work |
| **owner / tenant** | only their own unit(s) + requests |
| **gardener / service_provider** | only requests assigned to them |

These rules live in `02_policies.sql` as **Row-Level Security**. They are
enforced by the database — a tenant literally cannot fetch another unit's
rows, even with a modified app.

## 👥 Two ways to onboard people

- **They self-serve:** share the app link. They sign in with their email,
  which creates a *pending* account. You approve + link them to a unit.
- **You create them:** from the trustee screen you can pre-create a person
  and link them to a unit, then share the link so they sign in.
