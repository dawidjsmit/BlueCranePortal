# 🔧 Supabase setup — one-time, ~10 minutes

This turns Complex Comms from a single-device notebook into a real
multi-user app with magic-link logins and role-based access.

Everything here is free for a complex your size.

---

## Step 1 — Create a Supabase project

1. Go to **https://supabase.com** and sign up (free). You can sign in with GitHub.
2. Click **New project**.
   - **Name:** `complex-comms` (anything you like)
   - **Database password:** generate one and save it somewhere (you rarely need it)
   - **Region:** pick the one closest to your complex
3. Wait ~2 minutes for it to provision.

## Step 2 — Create the database

1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Paste the contents of **`01_schema.sql`** → click **Run**.
3. New query again → paste **`02_policies.sql`** → **Run**.
4. (Optional) New query → paste **`03_seed.sql`** → **Run** for 3 example units.

If each run says *Success. No rows returned*, you're good.

## Step 3 — Turn on magic-link email login

1. Left sidebar → **Authentication** → **Providers**.
2. Make sure **Email** is enabled.
3. Under email settings, **enable "Magic Link"** (and you can turn OFF
   "Confirm password" since we're passwordless).
4. Left sidebar → **Authentication → URL Configuration**:
   - Set **Site URL** to your live app, e.g.
     `https://dawidjsmit.github.io/complex-comms/`
   - Add the same URL under **Redirect URLs**.
   (This is what makes the magic link bring people back to your app.)

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
