// ============================================================
//  Blue Crane Vistas Portal — "manage-users" Edge Function
//
//  Trustee-only actions that need Supabase's admin rights (which must
//  never be in the public app):
//    create     — add a login (email + password) and link it to a
//                 registry record, in one go
//    deactivate — block a user from using the system (sign-in banned)
//    reactivate — undo a deactivation
//
//  DEPLOY (no command line needed):
//    Supabase Dashboard -> Edge Functions -> Create a new function
//    -> name it exactly:  manage-users
//    -> paste this whole file -> Deploy.
//  No extra secrets needed: SUPABASE_URL, SUPABASE_ANON_KEY and
//  SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
//
//  Requires migration 25_deactivate_users.sql.
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? SERVICE_ROLE;
const ROLES = ["trustee", "owner", "tenant", "occupant", "gardener", "service_provider"];
const BAN_FOREVER = "876000h"; // ~100 years

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
// All errors go back as { error } with HTTP 200 so the app can show the message.
const fail = (message: string) => json({ error: message });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return fail("Not signed in.");

    // Admin client (bypasses row-level security) — used only for Auth admin
    // calls and for reading the caller's profile.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Client acting AS the caller — database writes go through this one, so
    // every database rule (trustee-only, last-trustee guard, ...) still applies.
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) The caller must be an active, approved trustee.
    const { data: callerData, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerData?.user) return fail("Your session has expired. Please sign in again.");
    const callerId = callerData.user.id;
    const { data: callerProfile } = await admin.from("profiles")
      .select("role, status, deactivated_at").eq("id", callerId).single();
    if (!callerProfile || callerProfile.role !== "trustee"
        || callerProfile.status !== "approved" || callerProfile.deactivated_at) {
      return fail("Only an active trustee can manage users.");
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ---------------- create ----------------
    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const fullName = String(body.full_name ?? "").trim();
      const role = String(body.role ?? "");
      const recordId = String(body.record_id ?? "");

      if (!/^\S+@\S+\.\S+$/.test(email)) return fail("Please enter a valid email address.");
      if (password.length < 6) return fail("The password must be at least 6 characters.");
      if (!ROLES.includes(role)) return fail("Please choose a role.");
      if (!recordId) return fail("Please choose the registry record to link this user to.");

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // no confirmation email needed (works for made-up addresses)
        user_metadata: fullName ? { full_name: fullName } : {},
      });
      if (createErr || !created?.user) {
        const msg = createErr?.message ?? "";
        if (/already|registered|exists/i.test(msg)) return fail("A user with that email address already exists.");
        if (/password/i.test(msg)) return fail("Supabase rejected the password: " + msg);
        return fail("Could not create the user: " + msg);
      }
      const newId = created.user.id;

      // The sign-up trigger creates the profile; set the display name.
      if (fullName) await admin.from("profiles").update({ full_name: fullName }).eq("id", newId);

      // Link to the registry record (also sets the role and approves).
      const { error: linkErr } = await asCaller.rpc("link_user_to_record", {
        p_user: newId, p_role: role, p_record: recordId,
      });
      if (linkErr) {
        // Undo: don't leave a half-made login behind.
        await admin.auth.admin.deleteUser(newId);
        return fail("Could not link the user, so nothing was saved: " + linkErr.message);
      }
      return json({ ok: true, user_id: newId });
    }

    // ---------------- deactivate / reactivate ----------------
    if (action === "deactivate" || action === "reactivate") {
      const userId = String(body.user_id ?? "");
      if (!userId) return fail("No user chosen.");
      if (action === "deactivate" && userId === callerId) return fail("You cannot deactivate your own account.");

      const deactivating = action === "deactivate";
      // Database first: its rules decide (e.g. never the last active trustee).
      const { data: rows, error: updErr } = await asCaller.from("profiles")
        .update({ deactivated_at: deactivating ? new Date().toISOString() : null })
        .eq("id", userId).select("id");
      if (updErr) return fail(updErr.message);
      if (!rows || !rows.length) return fail("User not found.");

      // Then the login itself.
      const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: deactivating ? BAN_FOREVER : "none",
      });
      if (banErr) {
        // Put the profile back so the two never disagree.
        await asCaller.from("profiles")
          .update({ deactivated_at: deactivating ? null : new Date().toISOString() })
          .eq("id", userId);
        return fail("Could not update the login: " + banErr.message);
      }
      return json({ ok: true });
    }

    return fail("Unknown action.");
  } catch (e) {
    console.error(e);
    return fail("Something went wrong: " + (e instanceof Error ? e.message : String(e)));
  }
});
