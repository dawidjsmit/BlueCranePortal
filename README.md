# 🏢 Complex Comms — Unit Communication Tracker

> Application to assist communications in Sectional Title Complexes.

A simple, self-contained web app for a **body-corporate / complex trustee** to
replace a pile of per-unit WhatsApp chats with one centralized, trackable place.

Built as an example project to demonstrate the Kiro Web → GitHub workflow.

## Why

If you manage a residential complex, each unit's owner and tenant tends to message
you separately. It's hard to answer *"who is waiting on what right now?"* at a glance.
This app centralizes it:

- **📋 Unit directory** — every unit with owner + tenant contacts.
- **🎫 Requests** — log each maintenance request, complaint, billing query, etc.
  against a unit, with a status.
- **🔄 Status workflow** — `Open → In Progress → Waiting on Resident → Resolved`.
- **🕒 History timeline** — every status change is timestamped automatically, so you
  always have an audit trail of what happened and when.
- **📊 Dashboard** — totals plus a *"who is waiting on what"* list (open items,
  oldest first) so nothing slips through the cracks.

## Multi-user (Supabase) — real logins and shared data

The app is now a **multi-user** tool backed by [Supabase](https://supabase.com)
(a free hosted database + auth):

- **🔑 Magic-link login** — people sign in with just their email, no passwords.
- **👥 Five roles** — `trustee`, `owner`, `tenant`, `gardener`, `service_provider`.
- **🔐 Role-based access**, enforced in the database (Row-Level Security):
  - **Trustee** → everything; approves accounts; assigns work
  - **Owner / Tenant** → only their own unit(s) + requests
  - **Gardener / Service provider** → only requests assigned to them
- **✅ Onboarding both ways** — people self-sign-up (then a trustee approves &
  links them to a unit), or a trustee sets them up directly.
- **☁️ One shared dataset** — all trustees and residents see the same live data.

### Setup

See **[`supabase/SETUP.md`](supabase/SETUP.md)** — a ~10-minute, one-time setup.
In short:
1. Create a free Supabase project.
2. Run `supabase/01_schema.sql`, then `02_policies.sql` (and optionally `03_seed.sql`).
3. Enable magic-link email auth and set your site URL.
4. Paste your Project URL + anon key into `config.js`.
5. Sign in, then promote your own account to `trustee` once (SQL snippet in SETUP.md).

Until `config.js` is filled in, the live page loads in a safe "not configured"
mode with setup instructions.

## Files

| File                     | Purpose                                              |
|--------------------------|------------------------------------------------------|
| `index.html`             | Page structure, auth screens, modals                 |
| `styles.css`             | Responsive styling (tablet + desktop)                |
| `app.js`                 | Auth, role-aware views, Supabase data access         |
| `config.js`              | Your public Supabase URL + anon key                  |
| `supabase/01_schema.sql` | Tables, enums, triggers                              |
| `supabase/02_policies.sql`| Row-Level Security (who sees what)                  |
| `supabase/03_seed.sql`   | Optional example units                               |
| `supabase/SETUP.md`      | Step-by-step setup guide                             |

## Ideas for next steps

- WhatsApp quick-reply / email links per contact
- Due dates & automatic reminders on open requests
- Push/email notifications when a request's status changes
- A trustee screen to pre-create accounts and bulk-import 35 units

---

*Built as a Kiro Web demo for a 35-unit complex.*
