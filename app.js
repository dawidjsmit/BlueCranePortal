/* ============================================================
   Blue Crane Vistas Portal — multi-user frontend (Supabase)
   ------------------------------------------------------------
   - Magic-link (passwordless) login
   - Role-aware views: trustee / owner / tenant / gardener / service_provider
   - All data access is additionally protected by RLS in the database.

   If config.js has no Supabase keys, the app shows a friendly notice
   instead of breaking, so the live page always loads.
   ============================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const cfg = window.BLUE_CRANE_CONFIG || {};
const CONFIGURED = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

const ROLE_LABEL = {
  trustee: "Trustee",
  owner: "Owner",
  tenant: "Tenant",
  occupant: "Occupant",
  gardener: "Gardener",
  service_provider: "Service provider",
};
const STATUS_LABEL = {
  open: "Open",
  in_progress: "In Progress",
  waiting_on_resident: "Waiting on Resident",
  resolved: "Resolved",
};
const STATUS_ORDER = ["open", "in_progress", "waiting_on_resident", "resolved"];
const RELATION_LABEL = {
  spouse: "Spouse",
  child: "Child",
  live_in_employee: "Live-in employee",
  other: "Other",
};
const PET_TYPE_LABEL = { dog: "Dog", cat: "Cat", other: "Other" };

// Disclaimers for the "Ask the Rules" assistant.
const ASK_DISCLAIMER_TOP =
  "This assistant is an automated guide to the conduct rules — it is not legal " +
  "advice. Asking a question here is NOT a formal interaction with the managing " +
  "agent, the trustees, or anyone else, and it does not grant permission or " +
  "resolve anything. For any approval or action, please still follow the proper " +
  "channels (log a ticket or contact the trustees). Your questions and answers " +
  "are saved so you can refer back to them, and they give the trustees insight " +
  "into how residents are using the assistant.";
const ASK_DISCLAIMER_BELOW =
  "Reminder: this answer is an automated guide to the rules only. It is not legal " +
  "advice, not a decision, and not permission. No formal request has been lodged " +
  "by asking this — to obtain approval or have something actioned, please follow " +
  "the proper channels (log a ticket or contact the trustees / managing agent).";

// Ticket statuses + labels
const TICKET_STATUS_LABEL = {
  create: "Create", sent: "Sent", busy: "Busy", waiting: "Waiting",
  complete: "Complete", cancelled: "Cancelled", parked: "Parked",
};
// The statuses are fixed (the workflow depends on them), in workflow order.
const TICKET_STATUS_ORDER = ["create", "sent", "busy", "waiting", "complete", "cancelled", "parked"];
// Trustee-edited description of a status ("" if none yet).
function statusDesc(status) {
  return (state.ticketStatusInfo.find((x) => x.status === status) || {}).description || "";
}
// A status pill whose description shows as a hint on hover / long-press.
function statusPill(status) {
  const d = statusDesc(status);
  return `<span class="pill ticket-${status}"${d ? ` title="${esc(d)}"` : ""}>${TICKET_STATUS_LABEL[status]}</span>`;
}
// Which role each ticket can be assigned/routed to.
const ROUTE_ROLES = ["trustee", "owner", "tenant", "occupant", "gardener", "service_provider"];

let sb = null;        // supabase client
let me = null;        // current profile row
let state = { units: [], requests: [], profiles: [], layouts: [], owners: [], tenants: [], occupants: [], pets: [], unitPhotos: [], members: [], tickets: [], ticketTypes: [], ticketPhotos: [], conductDoc: null, areaTypes: [], areas: [], areaPhotos: [], registry: { trustees: [], gardeners: [], providers: [] }, unitOwners: [], ticketStatusInfo: [], areaGroups: [], projects: [], projectStatuses: [], projectUnits: [], projectAreas: [], projectProviders: [], planItems: [], planStatuses: [], planItemProjects: [], gardenTasks: [] };
let recovering = false; // true while handling a password-reset link
let aiEngagementRows = []; // cache for the trustee AI-engagement screen

/* ---------- Boot ---------- */
(async function boot() {
  if (!CONFIGURED) return showNotConfigured();
  sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // React to auth changes. A password-reset link fires PASSWORD_RECOVERY:
  // the user is temporarily signed in only to choose a new password.
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recovering = true;
      return showSetPassword();
    }
    route();
  });
  await route();
})();

/* ---------- Mobile nav drawer toggle ---------- */
document.addEventListener("click", (e) => {
  if (e.target.closest("#menu-btn")) {
    document.body.classList.toggle("nav-open");
  } else if (e.target.id === "scrim") {
    document.body.classList.remove("nav-open");
  }
});

function showNotConfigured() {
  $("#app-shell").hidden = false;
  $("#boot-panel").innerHTML = `
    <h2>⚙️ Almost there — connect Supabase</h2>
    <p>This build supports multiple trustees and resident logins, but it needs
    your free Supabase project first.</p>
    <ol>
      <li>Follow <code>supabase/SETUP.md</code> in the repo.</li>
      <li>Paste your Project URL + anon key into <code>config.js</code>.</li>
      <li>Commit &amp; push — this page will then show the login screen.</li>
    </ol>
    <p class="muted">Until then the app stays in this safe "not configured" mode.</p>`;
}

/* ---------- Routing based on auth + approval ---------- */
async function route() {
  // If we're mid password-reset, stay on the set-password screen.
  if (recovering) return showSetPassword();

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();

  // Load my profile (created by the DB trigger on first sign-in).
  const { data: prof } = await sb
    .from("profiles").select("*").eq("id", session.user.id).single();

  if (!prof) {
    // Trigger may lag a moment on very first sign-in.
    return setTimeout(route, 800);
  }
  me = prof;

  if (me.deactivated_at) return showDeactivated();
  if (me.status !== "approved") return showPending();
  return showApp();
}

/* ---------- Login ---------- */
function hideAll() {
  $("#view-login").hidden = true;
  $("#view-pending").hidden = true;
  $("#view-deactivated").hidden = true;
  $("#view-forgot").hidden = true;
  $("#view-set-password").hidden = true;
  $("#app-header").hidden = true;
  $("#app-shell").hidden = true;
  document.body.classList.remove("nav-open");
}
function showLogin() {
  hideAll();
  $("#view-login").hidden = false;
}
function showForgot() {
  hideAll();
  $("#view-forgot").hidden = false;
}
function showSetPassword() {
  hideAll();
  $("#view-set-password").hidden = false;
}
function showPending() {
  hideAll();
  $("#view-pending").hidden = false;
}
function showDeactivated() {
  hideAll();
  $("#view-deactivated").hidden = false;
}
// Supabase refuses sign-in for banned (deactivated) users with code "user_banned".
function isBannedError(err) {
  return !!err && (err.code === "user_banned" || /banned/i.test(err.message || ""));
}
const BANNED_MSG = "⛔ This account has been deactivated. Please contact a trustee if you think this is a mistake.";

const redirectUrl = () => window.location.href.split("#")[0].split("?")[0];
function setMsg(id, text, ok) {
  const el = $("#" + id);
  el.textContent = text;
  el.className = "login-msg " + (ok ? "ok" : "err");
}

/* --- Tab switching on the login card --- */
$$("[data-login-tab]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const tab = btn.dataset.loginTab;
    $$("[data-login-tab]").forEach((b) => b.classList.toggle("active", b === btn));
    $("#login-tab-magic").hidden = tab !== "magic";
    $("#login-tab-password").hidden = tab !== "password";
    $("#login-msg").textContent = "";
  }));

/* --- Magic link sign-in --- */
$("#magic-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("login-msg", "Sending…", true);
  const { error } = await sb.auth.signInWithOtp({
    email: $("#magic-email").value.trim(),
    options: { emailRedirectTo: redirectUrl() },
  });
  if (isBannedError(error)) { setMsg("login-msg", BANNED_MSG, false); return; }
  setMsg("login-msg", error ? "⚠️ " + error.message : "✅ Check your email for the magic link!", !error);
});

/* --- Password sign-in --- */
$("#password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("login-msg", "Signing in…", true);
  const { error } = await sb.auth.signInWithPassword({
    email: $("#pw-email").value.trim(),
    password: $("#pw-password").value,
  });
  if (isBannedError(error)) { setMsg("login-msg", BANNED_MSG, false); return; }
  if (error) {
    setMsg("login-msg",
      "⚠️ " + (error.message.includes("Invalid")
        ? "Email or password is incorrect. If you've never set a password, use the Magic link tab first."
        : error.message), false);
  }
  // On success, onAuthStateChange -> route() takes over.
});

/* --- Forgot password --- */
$("#forgot-link").addEventListener("click", showForgot);
$("#forgot-back").addEventListener("click", showLogin);
$("#forgot-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("forgot-msg", "Sending…", true);
  const { error } = await sb.auth.resetPasswordForEmail(
    $("#forgot-email").value.trim(),
    { redirectTo: redirectUrl() }
  );
  setMsg("forgot-msg",
    error ? "⚠️ " + error.message : "✅ Check your email for a link to reset your password.", !error);
});

/* --- Set / update password --- */
$("#set-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = $("#set-pw1").value, p2 = $("#set-pw2").value;
  if (p1 !== p2) return setMsg("set-pw-msg", "Passwords don't match.", false);
  setMsg("set-pw-msg", "Saving…", true);
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) return setMsg("set-pw-msg", "⚠️ " + error.message, false);
  setMsg("set-pw-msg", "✅ Password saved! You can now sign in with it.", true);
  $("#set-pw1").value = ""; $("#set-pw2").value = "";
  recovering = false; // done; proceed into the app normally
  setTimeout(route, 900);
});
$("#set-pw-skip").addEventListener("click", () => { recovering = false; route(); });

$("#pending-signout").addEventListener("click", () => sb.auth.signOut());
$("#deactivated-signout").addEventListener("click", () => sb.auth.signOut());

/* ---------- Main app ---------- */
async function showApp() {
  hideAll();
  $("#app-header").hidden = false;
  $("#app-shell").hidden = false;
  // Top bar: only the user's email + role (logo is already in the bar).
  $("#user-box").innerHTML = `
    <span class="umail">${esc(me.email)}</span>
    <span class="role-chip ${me.role}">${ROLE_LABEL[me.role]}</span>`;

  buildTabs();
  await loadData();
  showView(defaultView());
}

function isTrustee() { return me.role === "trustee"; }
function isAssignee() { return me.role === "gardener" || me.role === "service_provider"; }
function isResident() { return me.role === "owner" || me.role === "tenant" || me.role === "occupant"; }
function amOccupantOf(unitId) {
  return state.occupants.some((o) => o.unit_id === unitId && o.profile_id === me.id && o.active)
      || state.members.some((m) => m.unit_id === unitId && m.profile_id === me.id && m.relation === "occupant");
}

/* ---- Client-side permission helpers (mirror the DB RLS) ----
   These decide what the UI SHOWS/enables. The database enforces the
   real rules regardless, so these are for UX, not security. */
// Owners are PEOPLE; each owns 1+ units through unit_owners links (which hold
// owner-since, is-occupant, active and left-on for that unit).
function ownerLinks(ownerId) {
  return state.unitOwners.filter((l) => l.owner_id === ownerId);
}
function myOwnerIds() {
  return new Set(state.owners.filter((o) => o.profile_id === me.id).map((o) => o.id));
}
// One row per owner of a unit, shaped like the old per-unit owner rows
// (id = the person's id) so the unit screens can keep using them.
function ownerRowsForUnit(unitId) {
  return state.unitOwners.filter((l) => l.unit_id === unitId).map((l) => {
    const o = state.owners.find((x) => x.id === l.owner_id);
    return o ? { ...o, link_id: l.id, unit_id: l.unit_id, owner_since: l.owner_since,
                 is_occupant: l.is_occupant, active: l.active, left_on: l.left_on } : null;
  }).filter(Boolean);
}
// Checks the unit rows on the owner form. Returns an error message or null.
function validateOwnerRows(rows, isNew) {
  if (isNew && !rows.length) return "Add at least one unit for this owner.";
  if (rows.some((r) => !r.unit_id)) return "Please choose a unit for every row.";
  if (new Set(rows.map((r) => r.unit_id)).size !== rows.length) return "The same unit is listed twice.";
  if (rows.filter((r) => r.is_occupant && r.active).length > 1)
    return "An owner can only live in (be the occupant of) one unit.";
  return null;
}
// Save rows that are NOT the active occupant first, so moving "lives here"
// from one unit to another never briefly breaks the one-occupancy rule.
function orderOwnerRowsForSave(rows) {
  return rows.slice().sort((a, b) => (a.is_occupant && a.active) - (b.is_occupant && b.active));
}
function ownerErrorText(error) {
  const m = (error && error.message) || "";
  if (m.includes("uq_owner_one_occupancy")) return "An owner can only live in (be the occupant of) one unit.";
  if (m.includes("duplicate")) return "This owner is already linked to that unit.";
  return m;
}

function myUnitIds() {
  // Units this user can access.
  const ids = new Set();
  if (isResident()) {
    // Owners/tenants/occupants: via unit_members or a record (profile_id).
    state.members.filter((m) => m.profile_id === me.id).forEach((m) => ids.add(m.unit_id));
    const mineOwner = myOwnerIds();
    state.unitOwners.filter((l) => mineOwner.has(l.owner_id) && l.active).forEach((l) => ids.add(l.unit_id));
    state.tenants.filter((t) => t.profile_id === me.id && t.active).forEach((t) => ids.add(t.unit_id));
    state.occupants.filter((o) => o.profile_id === me.id && o.active).forEach((o) => ids.add(o.unit_id));
  }
  if (isAssignee()) {
    // Gardeners/service providers: units of tickets currently assigned to
    // their role (RLS only returns those to them anyway).
    state.tickets.forEach((t) => ids.add(t.unit_id));
  }
  return ids;
}
function amOwnerOf(unitId) {
  const mineOwner = myOwnerIds();
  return state.unitOwners.some((l) => l.unit_id === unitId && l.active && mineOwner.has(l.owner_id))
      || state.members.some((m) => m.unit_id === unitId && m.profile_id === me.id && m.relation === "owner");
}
function amTenantOf(unitId) {
  return state.tenants.some((t) => t.unit_id === unitId && t.profile_id === me.id && t.active)
      || state.members.some((m) => m.unit_id === unitId && m.profile_id === me.id && m.relation === "tenant");
}
// Edit capabilities per the agreed matrix.
const canEditOwners   = (unitId) => isTrustee() || amOwnerOf(unitId);
const canEditTenants  = (unitId) => isTrustee() || amOwnerOf(unitId) || amTenantOf(unitId);
const canEditOccupants= (unitId) => isTrustee() || amOwnerOf(unitId) || amTenantOf(unitId);
const canEditPets     = (unitId) => isTrustee() || amOwnerOf(unitId) || amTenantOf(unitId);
const canSeeOwners    = (unitId) => isTrustee() || amOwnerOf(unitId); // tenants: NO owner data
const canSeeLinkedUsers = (unitId) => isTrustee() || amOwnerOf(unitId); // owners + trustees only
const canManagePhotos = (unitId) => isTrustee() || amOwnerOf(unitId);
// Residents (owner/tenant) see only ACTIVE registry rows; trustees see all.
const showInactive = () => isTrustee();

function defaultView() {
  if (isTrustee()) return "dashboard";
  // Gardeners / service providers care about jobs assigned to their role.
  if (isAssignee()) return "ticket-feedback";
  return myUnitIds().size ? "myunits" : "dashboard";
}

// Navigation is organised into groups (main menus) with items (sub-menus).
function navGroups() {
  const groups = [
    { items: [
      { id: "dashboard", label: "Dashboard", ico: "🏠" },
    ]},
    { title: "Daily Working", items: [
      ...(canCreateTicket() ? [{ id: "ticket-create", label: "Create a Ticket", ico: "➕" }] : []),
      { id: "ticket-mine", label: "My Tickets", ico: "🎟️" },
      ...(isResident() ? [{ id: "ticket-unit", label: "My Unit's Tickets", ico: "🏢" }] : []),
      { id: "ticket-feedback", label: "Needs my Feedback", ico: "⏳" },
      ...(isTrustee() ? [{ id: "ticket-all", label: "All Tickets", ico: "📋" }] : []),
      ...(isTrustee() || me.role === "gardener" ? [{ id: "garden", label: "Gardening Report", ico: "🌱" }] : []),
    ]},
    { title: "Conduct Rules", items: [
      { id: "conduct", label: "Master Document", ico: "📖" },
      { id: "askrules", label: "Ask the Rules", ico: "✨" },
    ]},
  ];
  if (isTrustee()) {
    groups.push({
      title: "Registry",
      items: [
        { id: "units", label: "Units", ico: "🏢" },
        { id: "owners", label: "Owners", ico: "👤" },
        { id: "tenants", label: "Tenants", ico: "🔑" },
        { id: "occupants", label: "Occupants", ico: "🧑‍🤝‍🧑" },
        { id: "pets", label: "Pets", ico: "🐾" },
        { id: "areas", label: "Communal entities", ico: "🧩" },
        { id: "reg-trustees", label: "Trustees", ico: "🧑‍💼" },
        { id: "reg-gardeners", label: "Gardeners", ico: "🧑‍🌾" },
        { id: "reg-providers", label: "Service providers", ico: "🔧" },
        { id: "projects", label: "Projects", ico: "🏗️" },
        { id: "plan", label: "10 Year Plan", ico: "📅" },
      ],
    });
    groups.push({
      title: "Admin",
      items: [
        { id: "layouts", label: "Layouts", ico: "📐" },
        { id: "areagroups", label: "Communal entity groupings", ico: "🗂️" },
        { id: "areatypes", label: "Communal entity types", ico: "🏷️" },
        { id: "gardentasks", label: "Gardening tasks", ico: "🧰" },
        { id: "planstatuses", label: "Plan statuses", ico: "🚩" },
        { id: "projectstatuses", label: "Project statuses", ico: "📌" },
        { id: "ticketstatuses", label: "Ticket statuses", ico: "🚦" },
        { id: "tickettypes", label: "Ticket types", ico: "🏷️" },
        { id: "aiengagement", label: "AI engagement", ico: "✨" },
        { id: "users", label: "Users", ico: "👥" },
        { id: "activity", label: "User activity", ico: "📜" },
      ],
    });
  } else if (isResident() && myUnitIds().size) {
    // Residents (owner/tenant/occupant) get a 'My unit(s)' entry.
    // Gardeners/service providers don't — they work from Tickets.
    groups[0].items.push({ id: "myunits", label: myUnitIds().size > 1 ? "My units" : "My unit", ico: "🏢" });
  }
  return groups;
}

function buildTabs() {
  const groups = navGroups();
  let first = true;
  const html = groups.map((g) => {
    const items = g.items.map((it) => {
      const active = first ? " active" : "";
      first = false;
      return `<button class="nav-btn${active}" data-view="${it.id}">
        <span class="nav-ico">${it.ico}</span><span>${it.label}</span></button>`;
    }).join("");
    return `<div class="nav-group">
      ${g.title ? `<div class="nav-group-title">${g.title}</div>` : ""}
      ${items}
    </div>`;
  }).join("");

  // Account actions pinned to the bottom of the sidebar.
  const footer = `
    <div class="nav-footer">
      <button class="nav-btn" id="set-pw-btn"><span class="nav-ico">🔑</span><span>Password</span></button>
      <button class="nav-btn" id="signout"><span class="nav-ico">🚪</span><span>Sign out</span></button>
    </div>`;

  $("#nav").innerHTML = html + footer;
  $("#signout").addEventListener("click", () => sb.auth.signOut());
  $("#set-pw-btn").addEventListener("click", () => showSetPassword());
}

/* ---------- Data loading (RLS filters automatically) ---------- */
async function loadData() {
  const [units, tickets, profiles, layouts, owners, tenants, occupants, pets, unitPhotos, members, ticketTypes, ticketPhotos, conductDocs, areaTypes, areas, areaPhotos, regTrustees, regGardeners, regProviders, unitOwners, ticketStatusInfo, lastLogins, areaGroups, projects, projectStatuses, projectUnits, projectAreas, projectProviders, planItems, planStatuses, planItemProjects, gardenTasks] = await Promise.all([
    sb.from("units").select("*").order("number"),
    sb.from("tickets").select("*").order("created_at", { ascending: false }),
    isTrustee() ? sb.from("profiles").select("*").order("created_at") : Promise.resolve({ data: [] }),
    sb.from("unit_layouts").select("*").order("code"),
    sb.from("owners").select("*").order("last_name"),
    sb.from("tenants").select("*").order("last_name"),
    sb.from("occupants").select("*").order("last_name"),
    sb.from("pets").select("*").order("name"),
    sb.from("unit_photos").select("*").order("created_at"),
    sb.from("unit_members").select("*"),
    sb.from("ticket_types").select("*"),
    sb.from("ticket_photos").select("*").order("created_at"),
    sb.from("documents").select("*").eq("kind", "conduct_rules").order("created_at", { ascending: false }).limit(1),
    sb.from("communal_area_types").select("*"),
    sb.from("communal_areas").select("*").order("code"),
    sb.from("communal_area_photos").select("*").order("created_at"),
    isTrustee() ? sb.from("trustees").select("*") : Promise.resolve({ data: [] }),
    isTrustee() ? sb.from("gardeners").select("*") : Promise.resolve({ data: [] }),
    isTrustee() ? sb.from("service_providers").select("*") : Promise.resolve({ data: [] }),
    sb.from("unit_owners").select("*"),
    sb.from("ticket_status_info").select("*"),
    isTrustee() ? sb.from("user_last_login").select("*") : Promise.resolve({ data: [] }),
    sb.from("communal_area_groups").select("*"),
    // Projects (trustee-only; empty until migration 29 is run).
    isTrustee() ? sb.from("projects").select("*") : Promise.resolve({ data: [] }),
    isTrustee() ? sb.from("project_statuses").select("*") : Promise.resolve({ data: [] }),
    isTrustee() ? sb.from("project_units").select("*") : Promise.resolve({ data: [] }),
    isTrustee() ? sb.from("project_areas").select("*") : Promise.resolve({ data: [] }),
    isTrustee() ? sb.from("project_providers").select("*") : Promise.resolve({ data: [] }),
    // 10 Year Plan (trustee-only; empty until migration 30 is run).
    isTrustee() ? sb.from("plan_items").select("*") : Promise.resolve({ data: [] }),
    isTrustee() ? sb.from("plan_statuses").select("*") : Promise.resolve({ data: [] }),
    isTrustee() ? sb.from("plan_item_projects").select("*") : Promise.resolve({ data: [] }),
    // Gardening tasks (trustees + gardeners; empty until migration 35 is run).
    isTrustee() || me.role === "gardener" ? sb.from("gardening_tasks").select("*") : Promise.resolve({ data: [] }),
  ]);
  state.units = (units.data || []).slice().sort(unitCompare);
  state.tickets = tickets.data || [];
  state.profiles = profiles.data || [];
  state.layouts = layouts.data || [];
  state.owners = owners.data || [];
  state.tenants = tenants.data || [];
  state.occupants = occupants.data || [];
  state.pets = pets.data || [];
  state.unitPhotos = unitPhotos.data || [];
  state.members = members.data || [];
  // Ticket types are always shown A–Z by name.
  state.ticketTypes = (ticketTypes.data || []).slice().sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  state.ticketPhotos = ticketPhotos.data || [];
  state.conductDoc = (conductDocs.data && conductDocs.data[0]) || null;
  // Communal entity types are always shown A–Z by name.
  state.areaTypes = (areaTypes.data || []).slice().sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  // Groupings A–Z (empty until migration 28 is run).
  state.areaGroups = (areaGroups.data || []).slice().sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  state.areas = areas.data || [];
  state.projects = (projects.data || []).slice().sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  state.projectStatuses = (projectStatuses.data || []).slice().sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  state.projectUnits = projectUnits.data || [];
  state.projectAreas = projectAreas.data || [];
  state.projectProviders = projectProviders.data || [];
  state.planItems = planItems.data || [];
  state.planStatuses = (planStatuses.data || []).slice().sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  state.planItemProjects = planItemProjects.data || [];
  state.gardenTasks = (gardenTasks.data || []).slice().sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  state.areaPhotos = areaPhotos.data || [];
  state.registry = {
    trustees: regTrustees.data || [],
    gardeners: regGardeners.data || [],
    providers: regProviders.data || [],
  };
  state.unitOwners = unitOwners.data || [];
  state.ticketStatusInfo = ticketStatusInfo.data || [];
  state.lastLogin = Object.fromEntries((lastLogins.data || []).map((r) => [r.profile_id, r.last_login]));
  aiEngagementRows = []; // force AI-engagement list to reload fresh
}

/* ---------- Storage helpers (Phase 4) ---------- */
const BUCKET = "photos";
// Public URL for a stored file path.
function publicUrl(path) {
  if (!path) return "";
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
/* ---------- Automatic image resizing (every upload goes through here) ----------
   Photos from phones are often 3-5 MB and are re-downloaded on every view.
   Before uploading, images are scaled down and re-compressed in the browser.
   Non-images (e.g. the conduct-rules PDF) are uploaded untouched. */
const IMAGE_LIMITS = {
  photo:   { maxSide: 1600, quality: 0.82 }, // unit, pet, area, ticket, feedback photos
  drawing: { maxSide: 2400, quality: 0.9 },  // layout floor plans: keep fine lines readable
};
const RESIZABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Target size: longest side capped at maxSide, aspect ratio kept, never enlarged.
function scaledSize(w, h, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

async function resizeImage(file, limits) {
  if (!RESIZABLE_TYPES.includes(file.type)) return file;   // PDFs, GIFs, HEIC etc.: as-is
  try {
    // imageOrientation "from-image" applies the phone's EXIF rotation,
    // so portrait photos are not saved sideways.
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { w, h } = scaledSize(bmp.width, bmp.height, limits.maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    // PNGs/WebPs may have transparency, which JPEG can't hold: use white.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", limits.quality));
    // Keep the original if resizing failed or didn't actually save space.
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch (err) {
    console.warn("Image resize skipped:", err);
    return file;   // never block an upload because resizing failed
  }
}

// Upload a File to a folder; returns the stored path (or throws).
// Images are resized first; layouts use the higher 'drawing' limits.
async function uploadFile(file, folder) {
  const limits = folder.startsWith("layouts") ? IMAGE_LIMITS.drawing : IMAGE_LIMITS.photo;
  const toSend = await resizeImage(file, limits);
  const ext = (toSend.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET)
    .upload(path, toSend, { upsert: false, contentType: toSend.type || undefined });
  if (error) throw error;
  return path;
}
async function deleteFile(path) {
  if (path) await sb.storage.from(BUCKET).remove([path]);
}

/* ---------- Views ---------- */
function showView(name) {
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.body.classList.remove("nav-open"); // close mobile drawer on navigate
  const render = {
    dashboard: renderDashboard,
    "ticket-create": renderTicketCreate,
    "ticket-mine": renderMyTickets,
    "ticket-unit": renderUnitTickets,
    "ticket-feedback": renderNeedsFeedback,
    "ticket-all": renderAllTickets,
    conduct: renderConductRules,
    askrules: renderAskRules,
    units: renderUnits,
    myunits: renderMyUnits,
    owners: renderOwnersList,
    tenants: renderTenantsList,
    occupants: renderOccupantsList,
    pets: renderPetsList,
    layouts: renderLayouts,
    tickettypes: renderTicketTypes,
    ticketstatuses: renderTicketStatuses,
    areagroups: renderAreaGroups,
    areatypes: renderAreaTypes,
    areas: renderAreas,
    areadetail: renderAreaDetail,
    "reg-trustees": () => renderRegistry("trustees"),
    "reg-gardeners": () => renderRegistry("gardeners"),
    "reg-providers": () => renderRegistry("providers"),
    aiengagement: renderAiEngagement,
    users: renderPeople,
    projects: renderProjects,
    projectdetail: renderProjectDetail,
    projectstatuses: renderProjectStatuses,
    plan: renderPlan,
    planstatuses: renderPlanStatuses,
    garden: renderGarden,
    gardentasks: renderGardenTasks,
    activity: renderActivity,
  }[name];
  if (render) render();
}

// Sort units by their number, numerically (2 before 10). Falls back to text
// for any legacy non-numeric value (e.g. "12A").
function unitCompare(a, b) {
  return (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0)
    || String(a.number).localeCompare(String(b.number));
}
function unitNum(id) {
  return state.units.find((u) => u.id === id)?.number ?? "?";
}
function layoutById(id) {
  return state.layouts.find((l) => l.id === id);
}
function layoutLabel(id) {
  const l = layoutById(id);
  return l ? l.code : "—";
}

// Is this ticket currently waiting on a role I hold on its unit?
function needsMyAction(t) {
  if (t.status === "complete" || t.status === "cancelled") return false;
  if (isTrustee()) return t.assigned_role === "trustee";
  if (!t.assigned_role) return false;
  if (t.assigned_role === "owner") return amOwnerOf(t.unit_id);
  if (t.assigned_role === "tenant") return amTenantOf(t.unit_id);
  if (t.assigned_role === "occupant") return amOccupantOf(t.unit_id);
  if (t.assigned_role === "gardener" || t.assigned_role === "service_provider")
    return me.role === t.assigned_role;
  return false;
}

function renderDashboard() {
  const open = state.tickets.filter((t) => !["complete", "cancelled"].includes(t.status));
  const mine = state.tickets.filter(needsMyAction);
  const myDrafts = state.tickets.filter((t) => t.status === "create" && t.logged_by === me.id);

  $("#main").innerHTML = `
    <div class="stats-grid">
      ${isTrustee() ? statCard(state.units.length, "Units", "") : ""}
      ${statCard(open.length, "Open tickets", "open")}
      ${statCard(mine.length, "Needs my feedback", "waiting")}
      ${statCard(myDrafts.length, "My drafts", "progress")}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>⏳ Needs my feedback</h2>
        ${canCreateTicket() ? `<button class="btn primary" data-new-ticket>+ Log a ticket</button>` : ""}
      </div>
      <div class="request-list">
        ${mine.length ? mine.map(ticketCard).join("")
          : `<div class="empty">🎉 Nothing waiting on you right now.</div>`}
      </div>
      ${mine.length ? `<div style="margin-top:12px"><button class="link-btn" data-view="ticket-feedback">View all →</button></div>` : ""}
    </div>`;
}

// Shared helper: a titled panel listing ticket cards.
function ticketListPanel(title, list, hint, emptyMsg) {
  return `<div class="panel">
    <div class="panel-head"><h2>${title}</h2>${hint ? `<span class="hint">${hint}</span>` : ""}</div>
    <div class="request-list">
      ${list.length ? list.map(ticketCard).join("") : `<div class="empty">${emptyMsg || "None."}</div>`}
    </div>
  </div>`;
}

// "Create a Ticket" — open the form directly (and show a hint behind it).
function renderTicketCreate() {
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>➕ Create a Ticket</h2></div>
      <p class="muted">Log a new ticket about your unit or a communal entity.</p>
      <button class="btn primary" data-new-ticket>+ Log a ticket</button>
    </div>`;
  openTicketModal(null);
}

// "My Tickets" — tickets I literally created (drafts first).
function renderMyTickets() {
  const mine = state.tickets
    .filter((t) => t.logged_by === me.id)
    .sort((a, b) => (a.status === "create" ? -1 : 0) - (b.status === "create" ? -1 : 0));
  const drafts = mine.filter((t) => t.status === "create");
  const sent = mine.filter((t) => t.status !== "create");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🎟️ My Tickets</h2>
        ${canCreateTicket() ? `<button class="btn primary small" data-new-ticket>+ Log a ticket</button>` : ""}
      </div>
      <p class="muted tiny">Tickets you created.</p>
    </div>
    ${drafts.length ? ticketListPanel("📝 Drafts (not yet sent)", drafts) : ""}
    ${ticketListPanel("Submitted", sent, "", "You haven't submitted any tickets yet.")}`;
}

// "My Unit's Tickets" — tickets on a chosen unit I'm linked to.
let unitTicketsSelectedUnit = null;
function renderUnitTickets() {
  const ids = myUnitIds();
  const myUnits = state.units.filter((u) => ids.has(u.id)).sort(unitCompare);
  if (!myUnits.length) {
    $("#main").innerHTML = `<div class="panel"><div class="panel-head"><h2>🏢 My Unit's Tickets</h2></div>
      <div class="empty">No units are linked to you yet.</div></div>`;
    return;
  }
  if (!unitTicketsSelectedUnit || !ids.has(unitTicketsSelectedUnit)) {
    unitTicketsSelectedUnit = myUnits[0].id;
  }
  const list = state.tickets
    .filter((t) => t.unit_id === unitTicketsSelectedUnit)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const picker = myUnits.length > 1
    ? `<select id="unit-ticket-picker">
        ${myUnits.map((u) => `<option value="${u.id}" ${u.id === unitTicketsSelectedUnit ? "selected" : ""}>Unit ${esc(u.number)}</option>`).join("")}
      </select>`
    : `<span class="chip">Unit ${esc(myUnits[0].number)}</span>`;

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🏢 My Unit's Tickets</h2>${picker}</div>
      <p class="muted tiny">All tickets logged by anyone on this unit.</p>
    </div>
    ${ticketListPanel("Tickets", list, "", "No tickets for this unit yet.")}`;

  const sel = $("#unit-ticket-picker");
  if (sel) sel.addEventListener("change", (e) => { unitTicketsSelectedUnit = e.target.value; renderUnitTickets(); });
}

// "Needs my Feedback" — tickets assigned to a role I hold.
function renderNeedsFeedback() {
  const mine = state.tickets.filter(needsMyAction)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>⏳ Needs my Feedback</h2>
        <span class="hint">Tickets currently assigned to a role you hold</span></div>
    </div>
    ${ticketListPanel("Awaiting your feedback", mine, "", "🎉 Nothing waiting on you right now.")}`;
}

// "All Tickets" — trustee complex-wide view, with a status filter.
let allTicketsStatus = "";
function renderAllTickets() {
  let list = state.tickets.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (allTicketsStatus) list = list.filter((t) => t.status === allTicketsStatus);
  const statusOpts = ["", "create", "sent", "busy", "waiting", "complete", "cancelled", "parked"]
    .map((s) => `<option value="${s}" ${s === allTicketsStatus ? "selected" : ""}${s && statusDesc(s) ? ` title="${esc(statusDesc(s))}"` : ""}>${s ? TICKET_STATUS_LABEL[s] : "All statuses"}</option>`).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>📋 All Tickets</h2>
        <button class="btn primary small" data-new-ticket>+ Log a ticket</button></div>
      <div class="filters"><label>Status <select id="all-ticket-status">${statusOpts}</select></label>
        ${allTicketsStatus && statusDesc(allTicketsStatus) ? `<span class="muted tiny">${esc(statusDesc(allTicketsStatus))}</span>` : ""}</div>
      <div class="table-wrap"><table class="ticket-grid"><thead><tr>
        <th>Logged</th><th>Heading</th><th>Unit / entity</th><th>Type</th><th>Assigned to</th><th>Logged by</th><th>Status</th><th></th>
      </tr></thead><tbody>
        ${list.length ? list.map(ticketRow).join("") : `<tr><td colspan="8" class="empty">No tickets match.</td></tr>`}
      </tbody></table></div>
    </div>`;
  const sel = $("#all-ticket-status");
  if (sel) sel.addEventListener("change", (e) => { allTicketsStatus = e.target.value; renderAllTickets(); });
}

// One row of the All Tickets grid. Clicking the row opens the ticket;
// the 🗑️ button (trustees only) deletes it after an in-app confirmation.
function ticketRow(t) {
  const open = `data-open-ticket="${t.id}"`;
  return `<tr class="clickable-row">
    <td ${open} style="white-space:nowrap">${fmtDay(t.created_at)}</td>
    <td ${open}><strong>${esc(t.heading)}</strong></td>
    <td ${open}>${esc(ticketTargetLabel(t))}</td>
    <td ${open}>${esc(ticketTypeName(t.type_id))}</td>
    <td ${open}>${t.assigned_role ? esc(ROLE_LABEL[t.assigned_role] || t.assigned_role) : "—"}</td>
    <td ${open}>${esc(loggerName(t))}</td>
    <td ${open}>${statusPill(t.status)}</td>
    <td style="text-align:right">${isTrustee()
      ? `<button class="icon-btn" data-del-ticket-row="${t.id}" title="Delete ticket" aria-label="Delete ticket">🗑️</button>` : ""}</td>
  </tr>`;
}

function renderUnits() {
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🏠 Units</h2>
        <button class="btn primary" id="add-unit-btn">+ Add unit</button></div>
      <div class="table-wrap"><table><thead><tr>
        <th>Unit</th><th>Layout</th><th>People</th><th>Open tickets</th><th></th>
      </tr></thead><tbody>
        ${state.units.map((u) => {
          const open = state.tickets.filter((r) => r.unit_id === u.id && !["complete", "cancelled"].includes(r.status)).length;
          const owners = state.unitOwners.filter((l) => l.unit_id === u.id && l.active).length;
          const tenants = state.tenants.filter((tn) => tn.unit_id === u.id && tn.active).length;
          return `<tr>
            <td><strong>${esc(u.number)}</strong></td>
            <td>${esc(layoutLabel(u.layout_id))}</td>
            <td>${owners} owner${owners === 1 ? "" : "s"}, ${tenants} tenant${tenants === 1 ? "" : "s"}</td>
            <td><span class="badge-count ${open ? "" : "zero"}">${open}</span></td>
            <td style="text-align:right">
              <button class="btn ghost small" data-open-unit="${u.id}">Open</button></td></tr>`;
        }).join("") || `<tr><td colspan="5" class="empty">No units yet.</td></tr>`}
      </tbody></table></div>
    </div>`;
  $("#add-unit-btn").addEventListener("click", () => openUnitModal(null));
}

function renderMyUnits() {
  const ids = myUnitIds();
  const mine = state.units.filter((u) => ids.has(u.id));
  if (mine.length === 1) return renderUnitDetail(mine[0].id); // jump straight in
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🏠 My units</h2></div>
      <div class="table-wrap"><table><thead><tr>
        <th>Unit</th><th>Layout</th><th></th>
      </tr></thead><tbody>
        ${mine.map((u) => `<tr>
          <td><strong>${esc(u.number)}</strong></td>
          <td>${esc(layoutLabel(u.layout_id))}</td>
          <td style="text-align:right"><button class="btn ghost small" data-open-unit="${u.id}">Open</button></td>
        </tr>`).join("") || `<tr><td colspan="3" class="empty">No units linked to you yet.</td></tr>`}
      </tbody></table></div>
    </div>`;
}

function openUnitModal(unit) {
  $("#unit-modal-title").textContent = unit ? "Edit unit" : "Add unit";
  $("#unit-id").value = unit?.id || "";
  $("#unit-number").value = unit?.number ?? "";
  $("#unit-msg").textContent = "";
  $("#unit-notes").value = unit?.notes || "";
  // Layout dropdown
  $("#unit-layout").innerHTML =
    `<option value="">— none —</option>` +
    state.layouts.map((l) =>
      `<option value="${l.id}" ${unit?.layout_id === l.id ? "selected" : ""}>${esc(l.code)}${l.description ? " — " + esc(l.description) : ""}</option>`
    ).join("");
  $("#unit-modal").classList.add("active");
}

/* ---------- Unit detail (drill-in): owners & tenants ---------- */
let currentUnitId = null;

function fullName(p) { return `${p.first_name || ""} ${p.last_name || ""}`.trim() || "—"; }
function fmtDay(d) { return d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"; }
function contactLine(p) {
  const bits = [];
  if (p.cell) bits.push(`<a href="tel:${esc(p.cell)}">${esc(p.cell)}</a>`);
  if (p.email) bits.push(`<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`);
  return bits.join(" · ") || '<span class="muted">no contact</span>';
}

// Read-only: login users linked to this unit through their registry record.
function unitUsersTable(unitId) {
  const rows = [];
  state.unitOwners.filter((l) => l.unit_id === unitId && l.active).forEach((l) => {
    const o = state.owners.find((x) => x.id === l.owner_id);
    if (o && o.profile_id) rows.push({ pid: o.profile_id, as: "owner", rec: o });
  });
  state.tenants.filter((t) => t.unit_id === unitId && t.active && t.profile_id)
    .forEach((t) => rows.push({ pid: t.profile_id, as: "tenant", rec: t }));
  state.occupants.filter((o) => o.unit_id === unitId && o.active && o.profile_id)
    .forEach((o) => rows.push({ pid: o.profile_id, as: "occupant", rec: o }));
  (state.registry.trustees || []).filter((t) => t.unit_id === unitId && t.profile_id)
    .forEach((t) => rows.push({ pid: t.profile_id, as: "trustee", rec: t }));
  if (!rows.length) return `<div class="empty">No login users linked to this unit.</div>`;
  return `<div class="table-wrap"><table><thead><tr>
      <th>User</th><th>Account role</th><th>Linked as</th>
    </tr></thead><tbody>
    ${rows.map(({ pid, as, rec }) => {
      const p = state.profiles.find((x) => x.id === pid);
      const name = p ? (p.full_name || p.email) : fullName(rec);
      return `<tr>
        <td><strong>${esc(name)}</strong>${p && realName(p) ? `<div class="muted tiny">${esc(p.email)}</div>` : ""}</td>
        <td>${p ? `<span class="role-chip ${p.role}">${esc(ROLE_LABEL[p.role] || p.role)}</span>` : "—"}</td>
        <td>${esc(ROLE_LABEL[as])}</td>
      </tr>`;
    }).join("")}
  </tbody></table></div>`;
}

function renderUnitDetail(unitId) {
  currentUnitId = unitId;
  const u = state.units.find((x) => x.id === unitId);
  if (!u) return isTrustee() ? renderUnits() : renderMyUnits();

  // Residents see only ACTIVE rows; trustees see everything.
  const activeOnly = (arr) => showInactive() ? arr : arr.filter((x) => x.active);
  const owners = activeOnly(ownerRowsForUnit(unitId));
  const tenants = activeOnly(state.tenants.filter((t) => t.unit_id === unitId));
  const layout = layoutById(u.layout_id);

  const assigneeOnly = isAssignee(); // gardener / service provider: basics + photos only
  const backView = isTrustee() ? "units" : "myunits";

  $("#main").innerHTML = `
    <button class="link-btn" data-back-view="${backView}">← Back</button>
    <div class="panel">
      <div class="panel-head">
        <h2>🏠 Unit ${esc(u.number)}</h2>
        ${isTrustee() ? `<button class="btn ghost small" data-edit-unit="${u.id}">Edit unit</button>` : ""}
      </div>
      <dl class="detail-grid">
        <dt>Layout</dt><dd>${layout ? esc(layout.code) + (layout.description ? " — " + esc(layout.description) : "") : "—"}</dd>
        <dt>Notes</dt><dd>${esc(u.notes || "—")}</dd>
      </dl>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>📷 Photos</h2>
        ${canManagePhotos(unitId)
          ? `<label class="btn primary small upload-label">+ Add photo
               <input type="file" accept="image/*" id="unit-photo-input" hidden /></label>`
          : ""}
      </div>
      <p class="muted tiny">Photos of the unit and its exclusive-use area.</p>
      <p id="unit-photo-msg" class="login-msg"></p>
      ${unitPhotoGallery(unitId)}
    </div>

    ${assigneeOnly ? "" : `
    ${canSeeOwners(unitId) ? `
    <div class="panel">
      <div class="panel-head"><h2>👤 Owners</h2>
        ${canEditOwners(unitId) ? `${isTrustee() ? `<button class="btn ghost small" data-link-owner>Link existing owner</button> ` : ""}<button class="btn primary small" data-add-owner>+ Add new owner</button>` : ""}</div>
      ${personTable(owners, "owner", canEditOwners(unitId))}
    </div>` : ""}

    <div class="panel">
      <div class="panel-head"><h2>🔑 Tenants</h2>
        ${canEditTenants(unitId) ? `<button class="btn primary small" data-add-tenant>+ Add tenant</button>` : ""}</div>
      ${personTable(tenants, "tenant", canEditTenants(unitId))}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>🧑‍🤝‍🧑 Occupants</h2>
        ${canEditOccupants(unitId) ? `<button class="btn primary small" data-add-occupant>+ Add occupant</button>` : ""}</div>
      <p class="muted tiny">Owners &amp; tenants marked “is occupant” appear here automatically. Add other household members below.</p>
      ${occupantTable(unitId)}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>🐾 Pets</h2>
        ${canEditPets(unitId) ? `<button class="btn primary small" data-add-pet>+ Add pet</button>` : ""}</div>
      ${petTable(unitId)}
    </div>

    ${canSeeLinkedUsers(unitId) ? `
    <div class="panel">
      <div class="panel-head"><h2>🔐 Linked users</h2>
        <span class="hint">Login accounts linked to this unit${isTrustee() ? " (manage on the Users tab)" : ""}</span></div>
      ${unitUsersTable(unitId)}
    </div>` : ""}
    `}`;

  // Wire the hidden file input (added fresh each render).
  const input = $("#unit-photo-input");
  if (input) input.addEventListener("change", (e) => onUnitPhotoChosen(e, unitId));
}

// Trustees always; owners of this unit too. (Delegates to canManagePhotos.)
function canManageUnitPhotos(unitId) { return canManagePhotos(unitId); }

function unitPhotoGallery(unitId) {
  const photos = state.unitPhotos.filter((p) => p.unit_id === unitId);
  if (!photos.length) return `<div class="empty">No photos yet.</div>`;
  const canManage = canManageUnitPhotos(unitId);
  return `<div class="photo-grid">
    ${photos.map((p) => `<figure class="photo-item">
      <a href="${publicUrl(p.storage_path)}" target="_blank" rel="noopener">
        <img src="${publicUrl(p.storage_path)}" alt="${esc(p.caption || "Unit photo")}" loading="lazy" />
      </a>
      ${canManage ? `<button class="photo-del" title="Delete" data-del-unit-photo="${p.id}">✕</button>` : ""}
    </figure>`).join("")}
  </div>`;
}

async function onUnitPhotoChosen(e, unitId) {
  const file = e.target.files[0];
  if (!file) return;
  setMsg("unit-photo-msg", "Uploading…", true);
  try {
    const path = await uploadFile(file, `units/${unitId}`);
    const { error } = await sb.from("unit_photos").insert({
      unit_id: unitId, storage_path: path, uploaded_by: me.id,
    });
    if (error) { await deleteFile(path); throw error; }
    await loadData();
    renderUnitDetail(unitId);
  } catch (err) {
    setMsg("unit-photo-msg", "⚠️ " + (err.message || "Upload failed"), false);
  }
}

async function deleteUnitPhoto(photoId) {
  const photo = state.unitPhotos.find((p) => p.id === photoId);
  if (!photo) return;
  if (!confirm("Delete this photo?")) return;
  await sb.from("unit_photos").delete().eq("id", photoId);
  await deleteFile(photo.storage_path);
  await loadData();
  renderUnitDetail(photo.unit_id);
}

/* Build the combined list of occupants for a unit:
   - auto: owners & tenants with is_occupant = true (read-only here)
   - real: rows from the occupants table (editable)
   Returns [{kind, id, name, detail, active, record}] */
function occupantsFor(unitId) {
  const list = [];
  ownerRowsForUnit(unitId)
    .filter((o) => o.is_occupant)
    .forEach((o) => list.push({ kind: "owner", id: o.id, name: fullName(o),
      detail: "Owner", active: o.active, auto: true }));
  state.tenants
    .filter((t) => t.unit_id === unitId && t.is_occupant)
    .forEach((t) => list.push({ kind: "tenant", id: t.id, name: fullName(t),
      detail: "Tenant", active: t.active, auto: true }));
  state.occupants
    .filter((oc) => oc.unit_id === unitId)
    .forEach((oc) => list.push({ kind: "occupant", id: oc.id, name: fullName(oc),
      detail: RELATION_LABEL[oc.relationship] || "Occupant", active: oc.active, auto: false, record: oc }));
  return list;
}

function occupantTable(unitId) {
  let list = occupantsFor(unitId);
  if (!showInactive()) list = list.filter((p) => p.active); // residents: active only
  if (!list.length) return `<div class="empty">No occupants yet.</div>`;
  const canEdit = canEditOccupants(unitId);
  const sorted = list.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  return `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Role / relationship</th><th>Source</th><th>Status</th>${canEdit ? "<th></th>" : ""}
    </tr></thead><tbody>
    ${sorted.map((p) => `<tr class="${p.active ? "" : "inactive-row"}">
      <td><strong>${esc(p.name)}</strong> ${p.record ? userBadge(p.record) : ""}</td>
      <td>${esc(p.detail)}</td>
      <td>${p.auto ? '<span class="muted tiny">auto (from ' + p.kind + ')</span>' : '<span class="chip">added</span>'}</td>
      <td>${p.active ? '<span class="pill approved">Active</span>' : '<span class="pill rejected">Inactive</span>'}</td>
      ${canEdit ? `<td style="text-align:right">${p.auto
        ? '<span class="muted tiny">edit on their ' + p.kind + ' record</span>'
        : `<button class="btn ghost small" data-edit-occupant="${p.id}">Edit</button>`}</td>` : ""}
    </tr>`).join("")}
  </tbody></table></div>`;
}

function petTable(unitId) {
  const pets = state.pets.filter((p) => p.unit_id === unitId);
  if (!pets.length) return `<div class="empty">No pets recorded.</div>`;
  const canEdit = canEditPets(unitId);
  return `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Type</th><th>Breed</th><th>Belongs to</th><th>Sterilised</th>${canEdit ? "<th></th>" : ""}
    </tr></thead><tbody>
    ${pets.map((p) => `<tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.pet_type === "other" ? (p.type_other || "Other") : capitalize(p.pet_type))}</td>
      <td>${esc(p.breed || "—")}</td>
      <td>${esc(holderName(p))}</td>
      <td>${p.sterilised == null ? "—" : (p.sterilised ? "Yes" : "No")}</td>
      ${canEdit ? `<td style="text-align:right"><button class="btn ghost small" data-edit-pet="${p.id}">Edit</button></td>` : ""}
    </tr>`).join("")}
  </tbody></table></div>`;
}

function holderName(pet) {
  const arr = pet.holder_kind === "owner" ? state.owners
    : pet.holder_kind === "tenant" ? state.tenants : state.occupants;
  const rec = arr.find((x) => x.id === pet.holder_id);
  return rec ? fullName(rec) : "—";
}
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function personTable(people, kind, canEdit = true) {
  if (!people.length) return `<div class="empty">No ${kind}s recorded.</div>`;
  // Active first, then by name.
  const sorted = people.slice().sort((a, b) => (b.active - a.active) || fullName(a).localeCompare(fullName(b)));
  return `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Contact</th><th>Since</th>
      ${kind === "tenant" ? "<th>Lease</th>" : ""}
      <th>Occupant</th><th>Status</th>${canEdit ? "<th></th>" : ""}
    </tr></thead><tbody>
    ${sorted.map((p) => `<tr class="${p.active ? "" : "inactive-row"}">
      <td><strong>${esc(fullName(p))}</strong> ${userBadge(p)}</td>
      <td>${contactLine(p)}</td>
      <td>${fmtDay(kind === "tenant" ? p.tenant_since : p.owner_since)}</td>
      ${kind === "tenant" ? `<td>${p.lease_with === "agency" ? "Agency: " + esc(p.agency_name || "—") : "Direct with owner"}</td>` : ""}
      <td>${p.is_occupant ? "Yes" : "No"}</td>
      <td>${p.active ? '<span class="pill approved">Active</span>' : `<span class="pill rejected">Left ${fmtDay(p.left_on)}</span>`}</td>
      ${canEdit ? `<td style="text-align:right"><button class="btn ghost small" data-edit-${kind}="${p.id}">Edit</button></td>` : ""}
    </tr>`).join("")}
  </tbody></table></div>`;
}

/* ----- Owner modal: a person + the units they own ----- */
let ownerCtx = { unitCtx: null };

function ownerUnitRowHtml(link, locked) {
  const l = link || { active: true };
  const opts = `<option value="">— choose unit —</option>` + state.units.map((u) =>
    `<option value="${u.id}" ${l.unit_id === u.id ? "selected" : ""}>Unit ${esc(u.number)}</option>`).join("");
  return `<div class="ou-row" data-link-id="${l.id || ""}">
    <div class="ou-top">
      <select class="ou-unit" ${locked ? "disabled" : ""}>${opts}</select>
      ${locked ? "" : `<button type="button" class="btn ghost small" data-ou-remove>Remove</button>`}
    </div>
    <div class="row">
      <label>Owner since <input type="date" class="ou-since" value="${esc(l.owner_since || "")}" /></label>
      <label class="ou-left-wrap" ${l.active === false ? "" : "hidden"}>Left on <input type="date" class="ou-left" value="${esc(l.left_on || "")}" /></label>
    </div>
    <label class="check"><input type="checkbox" class="ou-occ" ${l.is_occupant ? "checked" : ""} /> Lives in this unit (occupant)</label>
    <label class="check"><input type="checkbox" class="ou-active" ${l.active === false ? "" : "checked"} /> Active (still the owner of this unit)</label>
  </div>`;
}

// owner: the person (or null for new). unitCtx: the unit screen it was opened
// from. Trustees see/edit every unit link; an owner (resident) only the link
// for the unit they are looking at.
function openOwnerModal(owner, unitCtx) {
  const trustee = isTrustee();
  ownerCtx = { unitCtx: unitCtx || null };
  $("#owner-modal-title").textContent = owner ? "Edit owner" : "Add owner";
  $("#owner-modal-title-user").innerHTML = owner && owner.profile_id
    ? `🔐 Also a user${userForRecord(owner).email ? ": " + esc(userForRecord(owner).email) : ""}` : "";
  $("#owner-id").value = owner?.id || "";
  $("#owner-first").value = owner?.first_name || "";
  $("#owner-last").value = owner?.last_name || "";
  $("#owner-cell").value = owner?.cell || "";
  $("#owner-email").value = owner?.email || "";
  let links = owner ? ownerLinks(owner.id) : [];
  if (!trustee) links = links.filter((l) => l.unit_id === unitCtx);
  if (!owner && !links.length) links = [{ unit_id: unitCtx || "", active: true }];
  const locked = !trustee;
  links = links.slice().sort((a, b) => (parseInt(unitNum(a.unit_id), 10) || 0) - (parseInt(unitNum(b.unit_id), 10) || 0));
  $("#owner-units").innerHTML = links.map((l) => ownerUnitRowHtml(l, locked)).join("");
  $("#owner-add-unit").hidden = locked;
  $("#owner-msg").textContent = "";
  $("#owner-modal").classList.add("active");
}

$("#owner-add-unit").addEventListener("click", () => {
  $("#owner-units").insertAdjacentHTML("beforeend", ownerUnitRowHtml(null, false));
});

$("#owner-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const trustee = isTrustee();
  const existingId = $("#owner-id").value;
  const personId = existingId || crypto.randomUUID();
  const person = {
    first_name: $("#owner-first").value.trim(),
    last_name: $("#owner-last").value.trim(),
    cell: $("#owner-cell").value.trim() || null,
    email: $("#owner-email").value.trim() || null,
  };
  const rows = [...document.querySelectorAll("#owner-units .ou-row")].map((r) => {
    const active = r.querySelector(".ou-active").checked;
    return {
      id: r.dataset.linkId || null,
      unit_id: r.querySelector(".ou-unit").value,
      owner_since: r.querySelector(".ou-since").value || null,
      is_occupant: r.querySelector(".ou-occ").checked,
      active,
      left_on: active ? null : (r.querySelector(".ou-left").value || null),
    };
  });
  const problem = validateOwnerRows(rows, !existingId);
  if (problem) { setMsg("owner-msg", "⚠️ " + problem, false); return; }

  // 1) the person
  const personRes = existingId
    ? await sb.from("owners").update(person).eq("id", existingId)
    : await sb.from("owners").insert({ id: personId, ...person });
  if (personRes.error) { setMsg("owner-msg", "⚠️ " + ownerErrorText(personRes.error), false); return; }
  $("#owner-id").value = personId;   // a retry after a later failure updates, not re-inserts

  // 2) their unit links: removed ones (trustees only), then changed/new ones
  const keep = new Set(rows.filter((r) => r.id).map((r) => r.id));
  const removed = trustee ? ownerLinks(personId).filter((l) => !keep.has(l.id)) : [];
  for (const l of removed) {
    const { error } = await sb.from("unit_owners").delete().eq("id", l.id);
    if (error) { setMsg("owner-msg", "⚠️ " + ownerErrorText(error), false); await loadData(); return; }
  }
  for (const r of orderOwnerRowsForSave(rows)) {
    const { id, ...fields } = r;
    const { error } = id
      ? await sb.from("unit_owners").update(fields).eq("id", id)
      : await sb.from("unit_owners").insert({ ...fields, owner_id: personId });
    if (error) { setMsg("owner-msg", "⚠️ " + ownerErrorText(error), false); await loadData(); return; }
  }
  closeOverlays();
  await loadData();
  if (ownerCtx.unitCtx) renderUnitDetail(ownerCtx.unitCtx); else refreshActiveView();
});

/* ----- Link an existing owner to this unit (so nobody is entered twice) ----- */
function openLinkOwnerModal() {
  const linked = new Set(state.unitOwners.filter((l) => l.unit_id === currentUnitId).map((l) => l.owner_id));
  const options = state.owners.filter((o) => !linked.has(o.id))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map((o) => {
      const units = ownerLinks(o.id).map((l) => unitNum(l.unit_id)).join(", ");
      return `<option value="${o.id}">${esc(fullName(o))}${units ? " (unit " + esc(units) + ")" : ""}</option>`;
    }).join("");
  $("#linkowner-owner").innerHTML = `<option value="">— choose an owner —</option>` + options;
  $("#linkowner-since").value = "";
  $("#linkowner-occ").checked = false;
  $("#linkowner-msg").textContent = "";
  $("#linkowner-modal").classList.add("active");
}

$("#linkowner-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ownerId = $("#linkowner-owner").value;
  if (!ownerId) { setMsg("linkowner-msg", "⚠️ Please choose an owner.", false); return; }
  const { error } = await sb.from("unit_owners").insert({
    unit_id: currentUnitId, owner_id: ownerId,
    owner_since: $("#linkowner-since").value || null,
    is_occupant: $("#linkowner-occ").checked, active: true,
  });
  if (error) { setMsg("linkowner-msg", "⚠️ " + ownerErrorText(error), false); return; }
  closeOverlays();
  await loadData();
  renderUnitDetail(currentUnitId);
});

/* ----- Tenant modal ----- */
function openTenantModal(tenant) {
  $("#tenant-modal-title").textContent = tenant ? "Edit tenant" : "Add tenant";
  $("#tenant-modal-title-user").innerHTML = tenant && tenant.profile_id
    ? `🔐 Also a user${userForRecord(tenant).email ? ": " + esc(userForRecord(tenant).email) : ""}` : "";
  $("#tenant-id").value = tenant?.id || "";
  $("#tenant-first").value = tenant?.first_name || "";
  $("#tenant-last").value = tenant?.last_name || "";
  $("#tenant-cell").value = tenant?.cell || "";
  $("#tenant-email").value = tenant?.email || "";
  $("#tenant-since").value = tenant?.tenant_since || "";
  $("#tenant-occupant").checked = tenant ? !!tenant.is_occupant : true;
  $("#tenant-lease").value = tenant?.lease_with || "owner";
  $("#tenant-agency-name").value = tenant?.agency_name || "";
  $("#tenant-agency-cell").value = tenant?.agency_cell || "";
  $("#tenant-agency-email").value = tenant?.agency_email || "";
  $("#tenant-active").checked = tenant ? !!tenant.active : true;
  $("#tenant-left").value = tenant?.left_on || "";
  $("#tenant-msg").textContent = "";
  toggleAgencyFields();
  toggleLeftOn("tenant");
  $("#tenant-modal").classList.add("active");
}

$("#tenant-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#tenant-id").value;
  const active = $("#tenant-active").checked;
  const viaAgency = $("#tenant-lease").value === "agency";
  const payload = {
    unit_id: currentUnitId,
    first_name: $("#tenant-first").value.trim(),
    last_name: $("#tenant-last").value.trim(),
    cell: $("#tenant-cell").value.trim() || null,
    email: $("#tenant-email").value.trim() || null,
    tenant_since: $("#tenant-since").value || null,
    is_occupant: $("#tenant-occupant").checked,
    lease_with: viaAgency ? "agency" : "owner",
    agency_name: viaAgency ? ($("#tenant-agency-name").value.trim() || null) : null,
    agency_cell: viaAgency ? ($("#tenant-agency-cell").value.trim() || null) : null,
    agency_email: viaAgency ? ($("#tenant-agency-email").value.trim() || null) : null,
    active,
    left_on: active ? null : ($("#tenant-left").value || null),
  };
  const { error } = id
    ? await sb.from("tenants").update(payload).eq("id", id)
    : await sb.from("tenants").insert(payload);
  if (error) { setMsg("tenant-msg", "⚠️ " + error.message, false); return; }
  closeOverlays();
  await loadData();
  renderUnitDetail(currentUnitId);
});

/* ----- Occupant modal ----- */
function openOccupantModal(occupant) {
  $("#occupant-modal-title").textContent = occupant ? "Edit occupant" : "Add occupant";
  $("#occupant-modal-title-user").innerHTML = occupant && occupant.profile_id
    ? `🔐 Also a user${userForRecord(occupant).email ? ": " + esc(userForRecord(occupant).email) : ""}` : "";
  $("#occupant-id").value = occupant?.id || "";
  $("#occupant-first").value = occupant?.first_name || "";
  $("#occupant-last").value = occupant?.last_name || "";
  $("#occupant-cell").value = occupant?.cell || "";
  $("#occupant-email").value = occupant?.email || "";
  $("#occupant-since").value = occupant?.occupant_since || "";
  $("#occupant-relationship").value = occupant?.relationship || "other";
  $("#occupant-active").checked = occupant ? !!occupant.active : true;
  $("#occupant-left").value = occupant?.left_on || "";
  // Related owner / tenant dropdowns, scoped to the current unit (active).
  // Tenants cannot see owners, so hide the "related to owner" field for them.
  const owners = ownerRowsForUnit(currentUnitId).filter((o) => o.active);
  const tenants = state.tenants.filter((t) => t.unit_id === currentUnitId && t.active);
  const seeOwners = canSeeOwners(currentUnitId);
  $("#occupant-owner-wrap").hidden = !seeOwners;
  $("#occupant-owner").innerHTML = `<option value="">— none —</option>` +
    (seeOwners ? owners.map((o) => `<option value="${o.id}" ${occupant?.related_owner_id === o.id ? "selected" : ""}>${esc(fullName(o))}</option>`).join("") : "");
  $("#occupant-tenant").innerHTML = `<option value="">— none —</option>` +
    tenants.map((t) => `<option value="${t.id}" ${occupant?.related_tenant_id === t.id ? "selected" : ""}>${esc(fullName(t))}</option>`).join("");
  $("#occupant-msg").textContent = "";
  toggleLeftOn("occupant");
  $("#occupant-modal").classList.add("active");
}

$("#occupant-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#occupant-id").value;
  const active = $("#occupant-active").checked;
  const payload = {
    unit_id: currentUnitId,
    first_name: $("#occupant-first").value.trim(),
    last_name: $("#occupant-last").value.trim(),
    cell: $("#occupant-cell").value.trim() || null,
    email: $("#occupant-email").value.trim() || null,
    occupant_since: $("#occupant-since").value || null,
    related_owner_id: $("#occupant-owner").value || null,
    related_tenant_id: $("#occupant-tenant").value || null,
    relationship: $("#occupant-relationship").value,
    active,
    left_on: active ? null : ($("#occupant-left").value || null),
  };
  const { error } = id
    ? await sb.from("occupants").update(payload).eq("id", id)
    : await sb.from("occupants").insert(payload);
  if (error) { setMsg("occupant-msg", "⚠️ " + error.message, false); return; }
  closeOverlays();
  await loadData();
  renderUnitDetail(currentUnitId);
});

/* ----- Pet modal ----- */
function openPetModal(pet) {
  $("#pet-modal-title").textContent = pet ? "Edit pet" : "Add pet";
  $("#pet-id").value = pet?.id || "";
  $("#pet-name").value = pet?.name || "";
  $("#pet-type").value = pet?.pet_type || "dog";
  $("#pet-type-other").value = pet?.type_other || "";
  $("#pet-breed").value = pet?.breed || "";
  $("#pet-gender").value = pet?.gender || "unknown";
  $("#pet-colour").value = pet?.colour || "";
  $("#pet-sterilised").value = pet?.sterilised == null ? "" : (pet.sterilised ? "yes" : "no");
  // Holder dropdown = OCCUPANTS of the unit: real occupant records PLUS
  // owners/tenants flagged is_occupant (active). Tenants never see owners,
  // so owner-occupants won't appear in a tenant's dropdown.
  const holders = [];
  const seeOwners = canSeeOwners(currentUnitId); // tenants: false
  if (seeOwners) {
    ownerRowsForUnit(currentUnitId).filter((o) => o.active && o.is_occupant).forEach((o) =>
      holders.push({ v: `owner|${o.id}`, label: fullName(o) + " (owner)" }));
  }
  state.tenants.filter((t) => t.unit_id === currentUnitId && t.active && t.is_occupant).forEach((t) =>
    holders.push({ v: `tenant|${t.id}`, label: fullName(t) + " (tenant)" }));
  state.occupants.filter((oc) => oc.unit_id === currentUnitId && oc.active).forEach((oc) =>
    holders.push({ v: `occupant|${oc.id}`, label: fullName(oc) + " (occupant)" }));
  const currentVal = pet ? `${pet.holder_kind}|${pet.holder_id}` : "";
  $("#pet-holder").innerHTML = `<option value="">— choose —</option>` +
    holders.map((h) => `<option value="${h.v}" ${h.v === currentVal ? "selected" : ""}>${esc(h.label)}</option>`).join("");
  $("#pet-photo-input").value = "";
  $("#pet-photo-preview").innerHTML = pet?.photo_path
    ? `<img src="${publicUrl(pet.photo_path)}" alt="${esc(pet.name)}" />`
    : `<span class="muted tiny">No photo yet.</span>`;
  $("#pet-msg").textContent = "";
  togglePetOther();
  $("#pet-modal").classList.add("active");
}

$("#pet-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#pet-id").value;
  const existing = id ? state.pets.find((p) => p.id === id) : null;
  const [holderKind, holderId] = ($("#pet-holder").value || "|").split("|");
  const sterVal = $("#pet-sterilised").value;

  // Handle a newly chosen photo (optional).
  let photoPath = existing?.photo_path || null;
  const file = $("#pet-photo-input").files[0];
  if (file) {
    setMsg("pet-msg", "Uploading photo…", true);
    try {
      const newPath = await uploadFile(file, `pets`);
      if (photoPath) await deleteFile(photoPath); // replace old
      photoPath = newPath;
    } catch (err) { setMsg("pet-msg", "⚠️ " + (err.message || "Upload failed"), false); return; }
  }

  const payload = {
    unit_id: currentUnitId,
    holder_kind: holderKind || "occupant",
    holder_id: holderId || null,
    name: $("#pet-name").value.trim(),
    pet_type: $("#pet-type").value,
    type_other: $("#pet-type").value === "other" ? ($("#pet-type-other").value.trim() || null) : null,
    breed: $("#pet-breed").value.trim() || null,
    gender: $("#pet-gender").value,
    colour: $("#pet-colour").value.trim() || null,
    sterilised: sterVal === "" ? null : (sterVal === "yes"),
    photo_path: photoPath,
  };
  const { error } = id
    ? await sb.from("pets").update(payload).eq("id", id)
    : await sb.from("pets").insert(payload);
  if (error) { setMsg("pet-msg", "⚠️ " + error.message, false); return; }
  closeOverlays();
  await loadData();
  renderUnitDetail(currentUnitId);
});

function togglePetOther() {
  $("#pet-type-other-wrap").hidden = $("#pet-type").value !== "other";
}

// Show/hide agency fields based on lease type.
function toggleAgencyFields() {
  const show = $("#tenant-lease").value === "agency";
  $("#agency-fields").hidden = !show;
}
// Show/hide "left on" date based on active checkbox.
function toggleLeftOn(kind) {
  $(`#${kind}-left-wrap`).hidden = $(`#${kind}-active`).checked;
}

function renderLayouts() {
  const cards = state.layouts.map((l) => {
    const units = state.units.filter((u) => u.layout_id === l.id);
    const unitChips = units.length
      ? units.map((u) => `<span class="chip">${esc(u.number)}</span>`).join(" ")
      : `<span class="muted tiny">No units use this layout yet.</span>`;
    return `<div class="layout-card">
      <div class="rc-top">
        <div><div class="rc-title">${esc(l.code)}</div>
          <div class="rc-meta">${esc(l.description || "No description")}</div></div>
        <button class="btn ghost small" data-edit-layout="${l.id}">Edit</button>
      </div>
      ${l.drawing_path ? `<a href="${publicUrl(l.drawing_path)}" target="_blank" rel="noopener" class="layout-drawing"><img src="${publicUrl(l.drawing_path)}" alt="${esc(l.code)} drawing" loading="lazy" /></a>` : ""}
      <div class="linked-row">
        <span class="muted tiny">Units with this layout (${units.length}):</span> ${unitChips}
      </div>
    </div>`;
  }).join("");

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>📐 Unit layouts</h2>
        <button class="btn primary" id="add-layout-btn">+ Add layout</button></div>
      <div class="layout-list">
        ${cards || `<div class="empty">No layouts yet. Add your first layout.</div>`}
      </div>
    </div>`;
  $("#add-layout-btn").addEventListener("click", () => openLayoutModal(null));
}

function openLayoutModal(layout) {
  $("#layout-modal-title").textContent = layout ? "Edit layout" : "Add layout";
  $("#layout-id").value = layout?.id || "";
  $("#layout-code").value = layout?.code || "";
  $("#layout-description").value = layout?.description || "";
  $("#layout-drawing-input").value = "";
  $("#layout-drawing-preview").innerHTML = layout?.drawing_path
    ? `<img src="${publicUrl(layout.drawing_path)}" alt="${esc(layout.code)} drawing" />`
    : `<span class="muted tiny">No drawing yet.</span>`;
  $("#layout-msg").textContent = "";
  $("#layout-modal").classList.add("active");
}

$("#layout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#layout-id").value;
  const existing = id ? layoutById(id) : null;

  // Optional drawing upload.
  let drawingPath = existing?.drawing_path || null;
  const file = $("#layout-drawing-input").files[0];
  if (file) {
    setMsg("layout-msg", "Uploading drawing…", true);
    try {
      const newPath = await uploadFile(file, `layouts`);
      if (drawingPath) await deleteFile(drawingPath);
      drawingPath = newPath;
    } catch (err) { setMsg("layout-msg", "⚠️ " + (err.message || "Upload failed"), false); return; }
  }

  const payload = {
    code: $("#layout-code").value.trim(),
    description: $("#layout-description").value.trim(),
    drawing_path: drawingPath,
  };
  const { error } = id
    ? await sb.from("unit_layouts").update(payload).eq("id", id)
    : await sb.from("unit_layouts").insert(payload);
  if (error) {
    setMsg("layout-msg",
      error.message.includes("duplicate") ? "A layout with that code already exists." : "⚠️ " + error.message,
      false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Global list screens (link back to their unit) ---------- */
// A clickable unit chip that opens that unit's detail page.
function unitLinkChip(unitId) {
  const u = state.units.find((x) => x.id === unitId);
  if (!u) return `<span class="muted tiny">—</span>`;
  return `<button class="chip chip-btn" data-open-unit="${u.id}">${esc(u.number)}</button>`;
}

function listPanel(title, headers, rows) {
  return `<div class="panel">
    <div class="panel-head"><h2>${title}</h2>
      <span class="hint">Click a unit to open it</span></div>
    <div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${headers.length}" class="empty">Nothing to show yet.</td></tr>`}</tbody></table></div>
  </div>`;
}

function renderOwnersList() {
  const isActive = (o) => ownerLinks(o.id).some((l) => l.active);
  const unitSort = (x, y) => (parseInt(unitNum(x.unit_id), 10) || 0) - (parseInt(unitNum(y.unit_id), 10) || 0);
  const rows = state.owners.slice()
    .sort((a, b) => (isActive(b) - isActive(a)) || fullName(a).localeCompare(fullName(b)))
    .map((o) => {
      const links = ownerLinks(o.id).slice().sort(unitSort);
      const chips = links.length
        ? links.map((l) => l.active
            ? unitLinkChip(l.unit_id) + (l.is_occupant ? '<span title="Lives here"> 🏠</span>' : "")
            : `<span class="chip chip-dim" title="No longer an owner of this unit">${esc(unitNum(l.unit_id))}</span>`).join(" ")
        : '<span class="muted tiny">no units</span>';
      return `<tr class="${isActive(o) ? "" : "inactive-row"}">
        <td><strong>${esc(fullName(o))}</strong> ${userBadge(o)}</td>
        <td>${chips}</td>
        <td>${contactLine(o)}</td>
        <td>${isActive(o) ? '<span class="pill approved">Active</span>' : '<span class="pill rejected">Former</span>'}</td>
        <td style="text-align:right"><button class="btn ghost small" data-edit-owner-global="${o.id}">Edit</button></td>
      </tr>`;
    }).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>👤 Owners</h2>
        <button class="btn primary small" data-add-owner-global>+ Add owner</button></div>
      <p class="muted tiny">One entry per person. An owner of several units is entered once and linked to each unit (🏠 = lives in that unit).</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Units</th><th>Contact</th><th>Status</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">No owners yet.</td></tr>`}</tbody></table></div>
    </div>`;
}

function renderTenantsList() {
  const rows = state.tenants.slice()
    .sort((a, b) => (b.active - a.active) || fullName(a).localeCompare(fullName(b)))
    .map((t) => `<tr class="${t.active ? "" : "inactive-row"}">
      <td><strong>${esc(fullName(t))}</strong> ${userBadge(t)}</td>
      <td>${unitLinkChip(t.unit_id)}</td>
      <td>${contactLine(t)}</td>
      <td>${fmtDay(t.tenant_since)}</td>
      <td>${t.lease_with === "agency" ? "Agency: " + esc(t.agency_name || "—") : "Direct with owner"}</td>
      <td>${t.active ? '<span class="pill approved">Active</span>' : `<span class="pill rejected">Left ${fmtDay(t.left_on)}</span>`}</td>
    </tr>`).join("");
  $("#main").innerHTML = listPanel("🔑 Tenants",
    ["Name", "Unit", "Contact", "Since", "Lease", "Status"], rows);
}

function renderOccupantsList() {
  // Combine real occupant records across all units (auto-listed owners/tenants
  // are shown on their own screens; here we list the household-member records).
  const rows = state.occupants.slice()
    .sort((a, b) => (b.active - a.active) || fullName(a).localeCompare(fullName(b)))
    .map((oc) => `<tr class="${oc.active ? "" : "inactive-row"}">
      <td><strong>${esc(fullName(oc))}</strong> ${userBadge(oc)}</td>
      <td>${unitLinkChip(oc.unit_id)}</td>
      <td>${esc(RELATION_LABEL[oc.relationship] || "Occupant")}</td>
      <td>${contactLine(oc)}</td>
      <td>${oc.active ? '<span class="pill approved">Active</span>' : '<span class="pill rejected">Inactive</span>'}</td>
    </tr>`).join("");
  $("#main").innerHTML = listPanel("🧑‍🤝‍🧑 Occupants (household members)",
    ["Name", "Unit", "Relationship", "Contact", "Status"], rows);
}

function renderPetsList() {
  const rows = state.pets.slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((p) => `<tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${unitLinkChip(p.unit_id)}</td>
      <td>${esc(p.pet_type === "other" ? (p.type_other || "Other") : capitalize(p.pet_type))}</td>
      <td>${esc(p.breed || "—")}</td>
      <td>${esc(holderName(p))}</td>
      <td>${p.sterilised == null ? "—" : (p.sterilised ? "Yes" : "No")}</td>
    </tr>`).join("");
  $("#main").innerHTML = listPanel("🐾 Pets",
    ["Name", "Unit", "Type", "Breed", "Belongs to", "Sterilised"], rows);
}

// Units a given user (profile) is linked to, as chips.
/* ---------- Ticket statuses (fixed; trustees edit the descriptions) ---------- */
function renderTicketStatuses() {
  const rows = TICKET_STATUS_ORDER.map((st) => `<tr>
      <td>${statusPill(st)}</td>
      <td>${statusDesc(st) ? esc(statusDesc(st)) : '<span class="muted">No description yet</span>'}</td>
      <td style="text-align:right"><button class="btn ghost small" data-edit-status="${st}">Edit</button></td>
    </tr>`).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🚦 Ticket statuses</h2></div>
      <p class="muted tiny">These statuses are fixed — the ticket workflow depends on them, so they can't be added, renamed or removed. You can edit each description; it is shown as a hint wherever the status appears.</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Status</th><th>Description</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}

let editingStatus = null;
function openStatusModal(status) {
  editingStatus = status;
  $("#status-modal-name").innerHTML = statusPill(status);
  $("#status-description").value = statusDesc(status);
  $("#status-msg").textContent = "";
  $("#status-modal").classList.add("active");
}

$("#status-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const description = $("#status-description").value.trim() || null;
  const { data, error } = await sb.from("ticket_status_info")
    .update({ description }).eq("status", editingStatus).select();
  if (error) { setMsg("status-msg", "⚠️ " + error.message, false); return; }
  if (!data || !data.length) {
    setMsg("status-msg", "⚠️ Not saved. Run supabase/24_ticket_status_descriptions.sql first.", false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

function renderTicketTypes() {
  const rows = state.ticketTypes.map((tt) => `<tr class="${tt.active ? "" : "inactive-row"}">
    <td><strong>${esc(tt.name)}</strong></td>
    <td class="muted">${esc(tt.description || "—")}</td>
    <td>${tt.active ? '<span class="pill approved">Active</span>' : '<span class="pill rejected">Hidden</span>'}</td>
    <td style="text-align:right"><button class="btn ghost small" data-edit-type="${tt.id}">Edit</button></td>
  </tr>`).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🏷️ Ticket types</h2>
        <button class="btn primary small" id="add-type-btn">+ Add type</button></div>
      <p class="muted tiny">The list of types users choose from when logging a ticket.</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Description</th><th>Status</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">No types yet.</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-type-btn").addEventListener("click", () => openTypeModal(null));
}

function openTypeModal(type) {
  $("#type-modal-title").textContent = type ? "Edit type" : "Add type";
  $("#type-id").value = type?.id || "";
  $("#type-name").value = type?.name || "";
  $("#type-description").value = type?.description || "";
  $("#type-active").checked = type ? !!type.active : true;
  $("#type-msg").textContent = "";
  $("#type-modal").classList.add("active");
}

$("#type-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#type-id").value;
  const payload = {
    name: $("#type-name").value.trim(),
    description: $("#type-description").value.trim() || null,
    active: $("#type-active").checked,
  };
  const { error } = id
    ? await sb.from("ticket_types").update(payload).eq("id", id)
    : await sb.from("ticket_types").insert(payload);
  if (error) {
    setMsg("type-msg", error.message.includes("duplicate") ? "That type name already exists." : "⚠️ " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Project statuses (trustee) — maintained like ticket types ---------- */
function projectStatusName(id) {
  return state.projectStatuses.find((s) => s.id === id)?.name || "—";
}

function renderProjectStatuses() {
  const rows = state.projectStatuses.map((s) => {
    const n = state.projects.filter((p) => p.status_id === s.id).length;
    return `<tr class="${s.active ? "" : "inactive-row"}">
    <td><strong>${esc(s.name)}</strong></td>
    <td class="muted">${esc(s.description || "—")}</td>
    <td>${n} project${n === 1 ? "" : "s"}</td>
    <td>${s.active ? '<span class="pill approved">Active</span>' : '<span class="pill rejected">Hidden</span>'}</td>
    <td style="text-align:right"><button class="btn ghost small" data-edit-projstatus="${s.id}">Edit</button></td>
  </tr>`;
  }).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>📌 Project statuses</h2>
        <button class="btn primary small" id="add-projstatus-btn">+ Add status</button></div>
      <p class="muted tiny">The statuses a project can have. Hidden statuses can't be chosen for new changes, but projects that already have them keep them.</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Description</th><th>Used by</th><th>Status</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">No statuses yet. Run supabase/29_projects.sql first.</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-projstatus-btn").addEventListener("click", () => openProjectStatusModal(null));
}

function openProjectStatusModal(s) {
  $("#projstatus-modal-title").textContent = s ? "Edit project status" : "Add project status";
  $("#projstatus-id").value = s?.id || "";
  $("#projstatus-name").value = s?.name || "";
  $("#projstatus-description").value = s?.description || "";
  $("#projstatus-active").checked = s ? !!s.active : true;
  $("#projstatus-msg").textContent = "";
  $("#projstatus-modal").classList.add("active");
}

$("#projstatus-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#projstatus-id").value;
  const payload = {
    name: $("#projstatus-name").value.trim(),
    description: $("#projstatus-description").value.trim() || null,
    active: $("#projstatus-active").checked,
  };
  if (!payload.name) { setMsg("projstatus-msg", "\u26a0\ufe0f Please enter a name.", false); return; }
  const { error } = id
    ? await sb.from("project_statuses").update(payload).eq("id", id)
    : await sb.from("project_statuses").insert(payload);
  if (error) {
    setMsg("projstatus-msg", error.message.includes("duplicate") ? "That status name already exists."
      : /project_statuses/.test(error.message) ? "\u26a0\ufe0f Run supabase/29_projects.sql first."
      : "\u26a0\ufe0f " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Projects (trustee-only registry) ---------- */
let projectStatusFilter = "";   // "" = all, else a status id
let currentProjectId = null;

const projUnitIds = (pid) => state.projectUnits.filter((x) => x.project_id === pid).map((x) => x.unit_id);
const projAreaIds = (pid) => state.projectAreas.filter((x) => x.project_id === pid).map((x) => x.area_id);
const projProviderIds = (pid) => state.projectProviders.filter((x) => x.project_id === pid).map((x) => x.provider_id);
const projTickets = (pid) => state.tickets.filter((t) => t.project_id === pid);

function projectName(id) {
  return state.projects.find((p) => p.id === id)?.name || "";
}
function trusteeName(id) {
  const t = state.registry.trustees.find((x) => x.id === id);
  return t ? fullName(t) : "";
}
function areaLabel(a) {
  return `${a.code} — ${a.name}`;
}
function projectStatusPill(p) {
  const s = state.projectStatuses.find((x) => x.id === p.status_id);
  return `<span class="pill proj-status"${s?.description ? ` title="${esc(s.description)}"` : ""}>${esc(s ? s.name : "—")}</span>`;
}

function renderProjects() {
  const all = state.projects;
  const count = (id) => all.filter((p) => p.status_id === id).length;
  const opts = [{ value: "", label: `All statuses (${all.length})` }]
    .concat(state.projectStatuses.filter((s) => s.active || count(s.id) > 0)
      .map((s) => ({ value: s.id, label: `${s.name} (${count(s.id)})` })));
  if (!opts.some((o) => o.value === projectStatusFilter)) projectStatusFilter = "";
  const f = projectStatusFilter;
  const shown = all.filter((p) => !f || p.status_id === f);

  const rows = shown.map((p) => {
    const n = projTickets(p.id).length;
    return `<tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${projectStatusPill(p)}</td>
      <td>${esc(trusteeName(p.run_by_trustee_id) || "—")}</td>
      <td style="white-space:nowrap">${fmtDay(p.start_date)}</td>
      <td style="white-space:nowrap">${p.due_date ? fmtDay(p.due_date) : "—"}</td>
      <td style="white-space:nowrap">${p.finish_date ? fmtDay(p.finish_date) : "—"}</td>
      <td>${n}</td>
      <td style="text-align:right"><button class="btn ghost small" data-open-project="${p.id}">Open</button></td>
    </tr>`;
  }).join("");

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🏗️ Projects</h2>
        <button class="btn primary small" id="add-project-btn">+ Add project</button></div>
      <p class="muted tiny">Projects for the complex. Each can be linked to units, communal entities, service providers and tickets. Visible to trustees only.</p>
      <div class="filters">
        <label>Status
          <select id="project-status-filter">
            ${opts.map((o) => `<option value="${o.value}" ${o.value === f ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
          </select>
        </label>
        ${f ? `<span class="muted tiny">Showing ${shown.length} of ${all.length}</span>` : ""}
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Status</th><th>Run by</th><th>Start</th><th>Due</th><th>Finished</th><th>Tickets</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="8" class="empty">${all.length ? "No projects with this status." : "No projects yet."}</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-project-btn").addEventListener("click", () => openProjectModal(null));
  $("#project-status-filter").addEventListener("change", (e) => {
    projectStatusFilter = e.target.value;
    renderProjects();
  });
}

function renderProjectDetail(projectId) {
  currentProjectId = projectId || currentProjectId;
  const p = state.projects.find((x) => x.id === currentProjectId);
  if (!p) return renderProjects();
  const status = state.projectStatuses.find((s) => s.id === p.status_id);

  const units = projUnitIds(p.id).map((id) => state.units.find((u) => u.id === id)).filter(Boolean)
    .sort(unitCompare);
  const areas = projAreaIds(p.id).map((id) => state.areas.find((a) => a.id === id)).filter(Boolean)
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  const providers = projProviderIds(p.id).map((id) => state.registry.providers.find((r) => r.id === id))
    .filter(Boolean).sort((a, b) => providerName(a).localeCompare(providerName(b)));
  const tickets = projTickets(p.id);
  const linkable = state.tickets.filter((t) => !t.project_id && t.status !== "create");

  $("#main").innerHTML = `
    <button class="link-btn" data-back-view="projects">← Back to projects</button>
    <div class="panel">
      <div class="panel-head"><h2>🏗️ ${esc(p.name)}</h2>
        <button class="btn ghost small" data-edit-project="${p.id}">Edit</button></div>
      ${projectStatusPill(p)}
      ${status?.description ? `<p class="status-hint">ℹ️ ${esc(status.description)}</p>` : ""}
      <dl class="detail-grid">
        <dt>Created</dt><dd>${fmtDay(p.created_at)}</dd>
        <dt>Start date</dt><dd>${fmtDay(p.start_date)}</dd>
        <dt>Due date</dt><dd>${p.due_date ? fmtDay(p.due_date) : "—"}</dd>
        <dt>Finish date</dt><dd>${p.finish_date ? fmtDay(p.finish_date) : "—"}</dd>
        <dt>Run by</dt><dd>${esc(trusteeName(p.run_by_trustee_id) || "—")}</dd>
        <dt>Description</dt><dd>${esc(p.description || "—")}</dd>
      </dl>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>🏢 Units (${units.length})</h2></div>
      ${units.length ? `<div class="linked-row">${units.map((u) => unitLinkChip(u.id)).join(" ")}</div>`
        : `<div class="empty">No units. Use Edit to add some.</div>`}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>🧩 Communal entities (${areas.length})</h2></div>
      ${areas.length ? `<div class="linked-row">${areas.map((a) =>
          `<button class="chip chip-btn" data-open-area="${a.id}" title="${esc(areaTypeName(a.type_id))}">${esc(areaLabel(a))}</button>`).join(" ")}</div>`
        : `<div class="empty">No communal entities. Use Edit to add some.</div>`}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>🔧 Service providers (${providers.length})</h2></div>
      ${providers.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact person</th><th>Phone</th><th>Email</th></tr></thead><tbody>
          ${providers.map((r) => `<tr class="${regIsCurrent(r) ? "" : "inactive-row"}">
            <td><strong>${esc(providerName(r))}</strong></td><td>${esc(r.contact_person || "—")}</td>
            <td>${telLink(r.phone)}</td><td>${mailLink(r.email)}</td></tr>`).join("")}
        </tbody></table></div>`
        : `<div class="empty">No service providers. Use Edit to add some.</div>`}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>🎟️ Tickets (${tickets.length})</h2></div>
      <div class="filters">
        <label>Link a ticket
          <select id="project-link-ticket">
            <option value="">— choose a ticket not in a project —</option>
            ${linkable.map((t) => `<option value="${t.id}">${esc(t.heading)} · ${esc(ticketTargetLabel(t))} · ${esc(TICKET_STATUS_LABEL[t.status] || t.status)}</option>`).join("")}
          </select>
        </label>
      </div>
      <p id="project-ticket-msg" class="login-msg"></p>
      ${tickets.length ? `<div class="request-list">${tickets.map((t) => `
        <div class="project-ticket">${ticketCard(t)}
          <button class="icon-btn" data-unlink-project-ticket="${t.id}" title="Remove this ticket from the project" aria-label="Remove this ticket from the project">✕</button>
        </div>`).join("")}</div>`
        : `<div class="empty">No tickets in this project yet.</div>`}
    </div>`;

  $("#project-link-ticket").addEventListener("change", (e) => {
    if (e.target.value) setTicketProject(e.target.value, p.id);
  });
}

async function setTicketProject(ticketId, projectId) {
  const { error } = await sb.from("tickets").update({ project_id: projectId }).eq("id", ticketId);
  if (error) { setMsg("project-ticket-msg", "\u26a0\ufe0f " + error.message, false); return; }
  await loadData();
  renderProjectDetail(currentProjectId);
}

// Checkbox list for the project form.
function checklistHtml(name, items, selected) {
  if (!items.length) return `<p class="muted tiny">None available.</p>`;
  return items.map((it) => `<label class="check"><input type="checkbox" name="${name}" value="${it.value}" ${selected.includes(it.value) ? "checked" : ""} /> ${esc(it.label)}</label>`).join("");
}
const checkedValues = (name) => [...$$(`#project-form input[name="${name}"]:checked`)].map((i) => i.value);

function openProjectModal(p) {
  $("#project-modal-title").textContent = p ? "Edit project" : "Add project";
  $("#project-id").value = p?.id || "";
  $("#project-name").value = p?.name || "";
  $("#project-description").value = p?.description || "";
  $("#project-created").value = p ? fmtDay(p.created_at) : "(set when saved)";

  const statuses = state.projectStatuses.filter((s) => s.active || s.id === p?.status_id);
  $("#project-status").innerHTML = `<option value="">— choose —</option>` +
    statuses.map((s) => `<option value="${s.id}" ${p?.status_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");

  $("#project-start").value = p?.start_date || isoDay(new Date());
  $("#project-due").value = p?.due_date || "";
  $("#project-finish").value = p?.finish_date || "";

  const trustees = state.registry.trustees.filter((t) => regIsCurrent(t) || t.id === p?.run_by_trustee_id)
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  $("#project-trustee").innerHTML = `<option value="">— none —</option>` +
    trustees.map((t) => `<option value="${t.id}" ${p?.run_by_trustee_id === t.id ? "selected" : ""}>${esc(fullName(t))}</option>`).join("");

  const selUnits = p ? projUnitIds(p.id) : [];
  const selAreas = p ? projAreaIds(p.id) : [];
  const selProviders = p ? projProviderIds(p.id) : [];
  $("#project-units").innerHTML = checklistHtml("proj-unit",
    state.units.map((u) => ({ value: u.id, label: String(u.number) })), selUnits);
  $("#project-areas").innerHTML = checklistHtml("proj-area",
    areasByGrouping(state.areas).map((a) => ({ value: a.id, label: areaFullLabel(a) })), selAreas);
  $("#project-providers").innerHTML = checklistHtml("proj-provider",
    state.registry.providers.filter((r) => regIsCurrent(r) || selProviders.includes(r.id))
      .sort((a, b) => providerName(a).localeCompare(providerName(b)))
      .map((r) => ({ value: r.id, label: providerName(r) + (regIsCurrent(r) ? "" : " (former)") })), selProviders);

  $("#project-msg").textContent = "";
  $("#project-modal").classList.add("active");
}

$("#project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#project-id").value || null;
  const name = $("#project-name").value.trim();
  const status = $("#project-status").value;
  const start = $("#project-start").value;
  const due = $("#project-due").value || null;
  const finish = $("#project-finish").value || null;
  if (!name) { setMsg("project-msg", "\u26a0\ufe0f Please enter the project name.", false); return; }
  if (!status) { setMsg("project-msg", "\u26a0\ufe0f Please choose a status.", false); return; }
  if (!start) { setMsg("project-msg", "\u26a0\ufe0f Please enter the start date.", false); return; }
  if (due && due < start) { setMsg("project-msg", "\u26a0\ufe0f The due date can't be before the start date.", false); return; }
  if (finish && finish < start) { setMsg("project-msg", "\u26a0\ufe0f The finish date can't be before the start date.", false); return; }

  const { data, error } = await sb.rpc("save_project", {
    p_id: id, p_name: name, p_description: $("#project-description").value.trim(),
    p_status: status, p_start: start, p_due: due, p_finish: finish,
    p_trustee: $("#project-trustee").value || null,
    p_units: checkedValues("proj-unit"), p_areas: checkedValues("proj-area"),
    p_providers: checkedValues("proj-provider"),
  });
  if (error) {
    setMsg("project-msg", /save_project|projects/.test(error.message) && /not find|does not exist/.test(error.message)
      ? "\u26a0\ufe0f Run supabase/29_projects.sql first." : "\u26a0\ufe0f " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  renderProjectDetail(data || id);
});

/* ---------- 10 Year Plan: plan statuses (trustee) ---------- */
function planStatusName(id) {
  return state.planStatuses.find((s) => s.id === id)?.name || "—";
}

function renderPlanStatuses() {
  const rows = state.planStatuses.map((s) => {
    const n = state.planItems.filter((i) => i.status_id === s.id).length;
    return `<tr>
    <td><strong>${esc(s.name)}</strong></td>
    <td class="muted">${esc(s.description || "—")}</td>
    <td>${n} item${n === 1 ? "" : "s"}</td>
    <td style="text-align:right"><button class="btn ghost small" data-edit-planstatus="${s.id}">Edit</button></td>
  </tr>`;
  }).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🚩 Plan statuses</h2>
        <button class="btn primary small" id="add-planstatus-btn">+ Add status</button></div>
      <p class="muted tiny">The statuses a 10 Year Plan item can have (e.g. Planned, Done, Postponed).</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Description</th><th>Used by</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">No statuses yet. Run supabase/30_ten_year_plan.sql first.</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-planstatus-btn").addEventListener("click", () => openPlanStatusModal(null));
}

function openPlanStatusModal(s) {
  $("#planstatus-modal-title").textContent = s ? "Edit plan status" : "Add plan status";
  $("#planstatus-id").value = s?.id || "";
  $("#planstatus-name").value = s?.name || "";
  $("#planstatus-description").value = s?.description || "";
  $("#planstatus-msg").textContent = "";
  $("#planstatus-modal").classList.add("active");
}

$("#planstatus-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#planstatus-id").value;
  const payload = {
    name: $("#planstatus-name").value.trim(),
    description: $("#planstatus-description").value.trim() || null,
  };
  if (!payload.name) { setMsg("planstatus-msg", "\u26a0\ufe0f Please enter a name.", false); return; }
  const { error } = id
    ? await sb.from("plan_statuses").update(payload).eq("id", id)
    : await sb.from("plan_statuses").insert(payload);
  if (error) {
    setMsg("planstatus-msg", error.message.includes("duplicate") ? "That status name already exists."
      : /plan_statuses/.test(error.message) ? "\u26a0\ufe0f Run supabase/30_ten_year_plan.sql first."
      : "\u26a0\ufe0f " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- 10 Year Plan: the matrix (rows = groupings, columns = years) ---------- */
const PLAN_YEARS = 10;
let planStartYear = new Date().getFullYear();

const moneyFmt = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 });
function fmtMoney(n) { return moneyFmt.format(Number(n) || 0); }
const planItemProjectIds = (id) => state.planItemProjects.filter((x) => x.plan_item_id === id).map((x) => x.project_id);

function renderPlan() {
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: PLAN_YEARS }, (_, i) => planStartYear + i);
  const lastYear = years[years.length - 1];
  // Rows: every grouping A–Z, then "No grouping".
  const rows = state.areaGroups.map((g) => ({ id: g.id, name: g.name }))
    .concat([{ id: "", name: "No grouping" }]);
  const groupKey = (i) => (i.group_id && areaGroupName(i.group_id) ? i.group_id : "");
  const inCell = (gid, y) => state.planItems
    .filter((i) => groupKey(i) === gid && i.year === y)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));

  const card = (i) => {
    const s = state.planStatuses.find((x) => x.id === i.status_id);
    const n = planItemProjectIds(i.id).length;
    return `<button type="button" class="plan-card" data-edit-plan="${i.id}" title="${esc(i.description || i.name)}">
      ${i.type_id && areaTypeName(i.type_id) !== "—" ? `<span class="plan-card-type">${esc(areaTypeName(i.type_id))}</span>` : ""}
      <span class="plan-card-name">${esc(i.name)}</span>
      <span class="plan-card-meta">Budget ${fmtMoney(i.budget)}${n ? ` · 🏗️ ${n}` : ""}</span>
      ${Number(i.actual_spend) ? `<span class="plan-card-meta">Spent ${fmtMoney(i.actual_spend)}</span>` : ""}
      <span class="pill plan-status"${s?.description ? ` title="${esc(s.description)}"` : ""}>${esc(s ? s.name : "—")}</span>
    </button>`;
  };

  const body = rows.map((r) => `<tr>
      <th class="plan-group">${esc(r.name)}</th>
      ${years.map((y) => `<td class="plan-cell${y === thisYear ? " plan-now" : ""}">
        ${inCell(r.id, y).map(card).join("")}
        <button type="button" class="plan-add" data-add-plan="${r.id}|${y}" title="Add a plan item for ${esc(r.name)} in ${y}" aria-label="Add a plan item for ${esc(r.name)} in ${y}">+</button>
      </td>`).join("")}
    </tr>`).join("");

  const total = (y, field) => state.planItems.filter((i) => i.year === y).reduce((s, i) => s + (Number(i[field]) || 0), 0);
  const before = state.planItems.filter((i) => i.year < planStartYear).length;
  const after = state.planItems.filter((i) => i.year > lastYear).length;

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>📅 10 Year Plan</h2>
        <button class="btn primary small" data-add-plan="|${thisYear}">+ Add plan item</button></div>
      <p class="muted tiny">One row per communal entity grouping, one column per year. Click an item to edit it (you can also change its year), or + to add one in that cell. If an item isn't achieved in its year, the idea is to mark it e.g. Postponed and add a new item in a later year.</p>
      <div class="filters">
        <button class="btn ghost small" id="plan-prev">◀ Earlier</button>
        <strong>${years[0]} – ${lastYear}</strong>
        <button class="btn ghost small" id="plan-next">Later ▶</button>
        ${planStartYear !== thisYear ? `<button class="btn ghost small" id="plan-now">Back to ${thisYear}</button>` : ""}
        ${before || after ? `<span class="muted tiny">${[before ? `${before} item${before === 1 ? "" : "s"} before ${years[0]}` : "", after ? `${after} item${after === 1 ? "" : "s"} after ${lastYear}` : ""].filter(Boolean).join(" · ")}</span>` : ""}
      </div>
      <div class="table-wrap plan-wrap"><table class="plan-matrix"><thead><tr>
        <th class="plan-group">Grouping</th>
        ${years.map((y) => `<th class="${y === thisYear ? "plan-now" : ""}">${y}</th>`).join("")}
      </tr></thead><tbody>${body}</tbody>
      <tfoot><tr><th class="plan-group">Budget total</th>
        ${years.map((y) => `<td class="plan-total${y === thisYear ? " plan-now" : ""}">${fmtMoney(total(y, "budget"))}</td>`).join("")}
      </tr><tr><th class="plan-group">Actual spend total</th>
        ${years.map((y) => `<td class="plan-total${y === thisYear ? " plan-now" : ""}">${fmtMoney(total(y, "actual_spend"))}</td>`).join("")}
      </tr></tfoot></table></div>
    </div>`;
  $("#plan-prev").addEventListener("click", () => { planStartYear -= 1; renderPlan(); });
  $("#plan-next").addEventListener("click", () => { planStartYear += 1; renderPlan(); });
  const now = $("#plan-now");
  if (now) now.addEventListener("click", () => { planStartYear = thisYear; renderPlan(); });
}

function openPlanModal(item, preset = {}) {
  $("#plan-modal-title").textContent = item ? "Edit plan item" : "Add plan item";
  $("#plan-id").value = item?.id || "";
  $("#plan-name").value = item?.name || "";
  $("#plan-description").value = item?.description || "";
  $("#plan-year").value = item?.year ?? preset.year ?? new Date().getFullYear();
  $("#plan-budget").value = item ? Number(item.budget) : "";
  $("#plan-actual").value = item ? Number(item.actual_spend || 0) : "";
  const gid = item ? (item.group_id || "") : (preset.group || "");
  $("#plan-group").innerHTML = `<option value="">— no grouping —</option>` +
    state.areaGroups.map((g) => `<option value="${g.id}" ${gid === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("");
  fillPlanTypes(item?.type_id || "");
  const firstStatus = state.planStatuses.find((s) => /^planned$/i.test(s.name));
  const sid = item?.status_id || firstStatus?.id || "";
  $("#plan-status").innerHTML = `<option value="">— choose —</option>` +
    state.planStatuses.map((s) => `<option value="${s.id}" ${sid === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const sel = item ? planItemProjectIds(item.id) : [];
  $("#plan-projects").innerHTML = state.projects.length
    ? state.projects.map((p) => `<label class="check"><input type="checkbox" name="plan-project" value="${p.id}" ${sel.includes(p.id) ? "checked" : ""} /> ${esc(p.name)} <span class="muted tiny">· ${esc(projectStatusName(p.status_id))}</span></label>`).join("")
    : `<p class="muted tiny">No projects yet.</p>`;
  $("#plan-msg").textContent = "";
  $("#plan-modal").classList.add("active");
}

// Type list for the plan item form. With a grouping chosen: that grouping's
// types. With no grouping: every type, shown as "Grouping – Type".
function fillPlanTypes(selectedId) {
  const gid = $("#plan-group").value;
  const types = typesByGrouping(state.areaTypes.filter((t) =>
    (t.active || t.id === selectedId) && (!gid || t.group_id === gid)));
  if (selectedId && !types.some((t) => t.id === selectedId)) selectedId = "";
  $("#plan-type").innerHTML = `<option value="">— no type (whole grouping) —</option>` +
    types.map((t) => `<option value="${t.id}" ${selectedId === t.id ? "selected" : ""}>${esc(gid ? t.name : areaTypeLabel(t))}</option>`).join("");
}
$("#plan-group").addEventListener("change", () => fillPlanTypes($("#plan-type").value));
// Choosing a type sets the grouping to that type's grouping.
$("#plan-type").addEventListener("change", () => {
  const t = state.areaTypes.find((x) => x.id === $("#plan-type").value);
  if (!t) return;
  const g = t.group_id && areaGroupName(t.group_id) ? t.group_id : "";
  if ($("#plan-group").value !== g) { $("#plan-group").value = g; fillPlanTypes(t.id); }
});

$("#plan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#plan-id").value || null;
  const name = $("#plan-name").value.trim();
  const year = Number($("#plan-year").value);
  const budgetRaw = $("#plan-budget").value.trim().replace(/[\s,]/g, "");
  const budget = budgetRaw === "" ? 0 : Number(budgetRaw);
  const actualRaw = $("#plan-actual").value.trim().replace(/[\s,]/g, "");
  const actual = actualRaw === "" ? 0 : Number(actualRaw);
  const status = $("#plan-status").value;
  if (!name) { setMsg("plan-msg", "\u26a0\ufe0f Please enter the plan item name.", false); return; }
  if (!Number.isInteger(year) || year < 2000 || year > 2200) { setMsg("plan-msg", "\u26a0\ufe0f Please enter a year such as " + new Date().getFullYear() + ".", false); return; }
  if (!Number.isFinite(budget) || budget < 0) { setMsg("plan-msg", "\u26a0\ufe0f The budget must be an amount of 0 or more.", false); return; }
  if (!Number.isFinite(actual) || actual < 0) { setMsg("plan-msg", "\u26a0\ufe0f The actual spend must be an amount of 0 or more.", false); return; }
  if (!status) { setMsg("plan-msg", "\u26a0\ufe0f Please choose a status.", false); return; }

  const { error } = await sb.rpc("save_plan_item", {
    p_id: id, p_name: name, p_description: $("#plan-description").value.trim(),
    p_year: year, p_budget: Math.round(budget * 100) / 100, p_actual: Math.round(actual * 100) / 100,
    p_group: $("#plan-group").value || null, p_type: $("#plan-type").value || null, p_status: status,
    p_projects: [...$$('#plan-form input[name="plan-project"]:checked')].map((i) => i.value),
  });
  if (error) {
    setMsg("plan-msg", /save_plan_item|plan_items/.test(error.message) && /not find|does not exist/.test(error.message)
      ? "\u26a0\ufe0f Run supabase/30_ten_year_plan.sql and 31_plan_item_type.sql first." : "\u26a0\ufe0f " + error.message, false);
    return;
  }
  // Keep the moved/added item's year in view.
  if (year < planStartYear) planStartYear = year;
  if (year >= planStartYear + PLAN_YEARS) planStartYear = year - PLAN_YEARS + 1;
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Gardening tasks (trustee maintenance) ---------- */
function renderGardenTasks() {
  const rows = state.gardenTasks.map((g) => `<tr>
    <td><strong>${esc(g.name)}</strong></td>
    <td class="muted">${esc(g.description || "—")}</td>
    <td style="text-align:right"><button class="btn ghost small" data-edit-gtask="${g.id}">Edit</button></td>
  </tr>`).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🧰 Gardening tasks</h2>
        <button class="btn primary small" id="add-gtask-btn">+ Add task</button></div>
      <p class="muted tiny">The typical tasks gardeners choose from on the Gardening Report.</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Description</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="3" class="empty">No tasks yet. Run supabase/35_gardening_report.sql first.</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-gtask-btn").addEventListener("click", () => openGardenTaskModal(null));
}

function openGardenTaskModal(g) {
  $("#gtask-modal-title").textContent = g ? "Edit gardening task" : "Add gardening task";
  $("#gtask-id").value = g?.id || "";
  $("#gtask-name").value = g?.name || "";
  $("#gtask-description").value = g?.description || "";
  $("#gtask-msg").textContent = "";
  $("#gtask-modal").classList.add("active");
}

$("#gtask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#gtask-id").value;
  const payload = { name: $("#gtask-name").value.trim(), description: $("#gtask-description").value.trim() || null };
  if (!payload.name) { setMsg("gtask-msg", "\u26a0\ufe0f Please enter a name.", false); return; }
  const { error } = id
    ? await sb.from("gardening_tasks").update(payload).eq("id", id)
    : await sb.from("gardening_tasks").insert(payload);
  if (error) {
    setMsg("gtask-msg", error.message.includes("duplicate") ? "That task already exists."
      : /gardening_tasks/.test(error.message) ? "\u26a0\ufe0f Run supabase/35_gardening_report.sql first."
      : "\u26a0\ufe0f " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Gardening Report ---------- */
// Lists the screen needs (all units + gardener names), loaded via a database
// function because gardeners can't read the full registries.
let gardenLookup = null;        // { units: [{id, number}], gardeners: [{id, name, current, profile_id}] }
let gardenFilter = null;        // { from, to, gardener, task }
let gardenRows = [];            // report lines for the current filter
let gardenEditing = null;       // the line being edited (null = adding)
let gardenCommentsFor = null;   // report id whose comments are open
let gardenDeleting = null;

const gardenTaskName = (id) => state.gardenTasks.find((t) => t.id === id)?.name || "—";
const gardenerName = (id) => gardenLookup?.gardeners.find((g) => g.id === id)?.name || "—";
const myGardenerId = () => gardenLookup?.gardeners.find((g) => g.profile_id === me.id)?.id || null;
const todayISO_ = () => isoDay(new Date());
function gardenUnitLabel(id) {
  const u = gardenLookup?.units.find((x) => x.id === id);
  return u ? unitChoiceLabel(u) : "Unit ?";
}
// Gardeners: only today's lines that weren't captured late. Trustees: any line.
function canEditGarden(r) {
  return isTrustee() || (me.role === "gardener" && r.action_date === todayISO_() && !r.captured_late);
}
const rowIds = (r, rel, key) => (r[rel] || []).map((x) => x[key]);

async function ensureGardenLookup() {
  if (gardenLookup) return true;
  const { data, error } = await sb.rpc("garden_lookups");
  if (error) {
    $("#main").innerHTML = `<div class="panel"><div class="empty">⚠️ ${esc(/garden_lookups/.test(error.message)
      ? "The Gardening Report isn't set up yet — run supabase/35_gardening_report.sql (see SETUP.md)." : error.message)}</div></div>`;
    return false;
  }
  gardenLookup = data || { units: [], gardeners: [] };
  return true;
}

async function renderGarden() {
  if (!(await ensureGardenLookup())) return;
  if (!gardenFilter) { const d = defaultActivityFilter(); gardenFilter = { from: d.from, to: d.to, gardener: "", task: "" }; }
  const f = gardenFilter;
  const gOpts = `<option value="">All gardeners</option>` + gardenLookup.gardeners.map((g) =>
    `<option value="${g.id}" ${f.gardener === g.id ? "selected" : ""}>${esc(g.name)}${g.current ? "" : " (former)"}</option>`).join("");
  const tOpts = `<option value="">All tasks</option>` + state.gardenTasks.map((t) =>
    `<option value="${t.id}" ${f.task === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🌱 Gardening Report</h2>
        <button class="btn primary small" id="garden-add-btn">+ Add report</button></div>
      <p class="muted tiny">What the gardeners did. Gardeners can change or delete today's lines; lines for earlier dates are locked${isTrustee() ? " (trustees can still change them)" : ""}. Lines captured for an earlier date are marked ⏱.</p>
      <div class="filters">
        <label>Date from <input type="date" id="gr-from" value="${esc(f.from)}" max="${todayISO_()}" /></label>
        <label>Date to <input type="date" id="gr-to" value="${esc(f.to)}" max="${todayISO_()}" /></label>
        <label>Gardener <select id="gr-gardener">${gOpts}</select></label>
        <label>Task <select id="gr-task">${tOpts}</select></label>
      </div>
      <div id="gr-list"><div class="empty">Loading…</div></div>
    </div>`;
  $("#garden-add-btn").addEventListener("click", () => openGardenModal(null));
  const onChange = () => {
    gardenFilter = { from: $("#gr-from").value, to: $("#gr-to").value, gardener: $("#gr-gardener").value, task: $("#gr-task").value };
    loadGardenList();
  };
  ["#gr-from", "#gr-to", "#gr-gardener", "#gr-task"].forEach((s) => $(s).addEventListener("change", onChange));
  loadGardenList();
}

async function loadGardenList() {
  const f = gardenFilter;
  if (f.from && f.to && f.from > f.to) { $("#gr-list").innerHTML = `<div class="empty">"Date from" is after "Date to".</div>`; return; }
  let q = sb.from("garden_reports")
    .select("*, garden_report_gardeners(gardener_id), garden_report_units(unit_id), garden_report_areas(area_id), garden_report_comments(id)")
    .order("action_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
  if (f.from) q = q.gte("action_date", f.from);
  if (f.to) q = q.lte("action_date", f.to);
  if (f.task) q = q.eq("task_id", f.task);
  const { data, error } = await q;
  if (gardenFilter !== f || !$("#gr-list")) return;
  if (error) { $("#gr-list").innerHTML = `<div class="empty">⚠️ ${esc(error.message)}</div>`; return; }
  gardenRows = (data || []).filter((r) => !f.gardener || rowIds(r, "garden_report_gardeners", "gardener_id").includes(f.gardener));
  renderGardenRows();
}

function chipList(labels, max = 12) {
  if (!labels.length) return `<span class="muted">—</span>`;
  const shown = labels.slice(0, max).map((l) => `<span class="chip">${esc(l)}</span>`).join(" ");
  return shown + (labels.length > max ? ` <span class="muted tiny" title="${esc(labels.slice(max).join(", "))}">+${labels.length - max} more</span>` : "");
}

function renderGardenRows() {
  const rows = gardenRows.map((r) => {
    const units = rowIds(r, "garden_report_units", "unit_id").map((id) => gardenLookup.units.find((u) => u.id === id))
      .filter(Boolean).sort(unitCompare).map(unitChoiceLabel);
    const areas = areasByGrouping(rowIds(r, "garden_report_areas", "area_id").map((id) => state.areas.find((a) => a.id === id)).filter(Boolean))
      .map((a) => `${a.code} — ${a.name}`);
    const gardeners = rowIds(r, "garden_report_gardeners", "gardener_id").map(gardenerName).sort();
    const nComments = (r.garden_report_comments || []).length;
    const late = r.captured_late
      ? `<div><span class="late-badge" title="Captured on ${esc(fmtDateTimeFull(r.created_at))}${r.created_by_name ? " by " + esc(r.created_by_name) : ""}">⏱ captured later</span></div>` : "";
    const edit = canEditGarden(r);
    return `<tr>
      <td style="white-space:nowrap">${fmtDay(r.action_date)}${late}</td>
      <td><strong>${esc(gardenTaskName(r.task_id))}</strong>${r.description ? `<div class="muted tiny">${esc(r.description)}</div>` : ""}</td>
      <td>${chipList(gardeners)}</td>
      <td>${chipList(units)}</td>
      <td>${chipList(areas, 6)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="icon-btn" data-gr-comments="${r.id}" title="Comments" aria-label="Comments">💬${nComments ? `<span class="tiny">${nComments}</span>` : ""}</button>
        <button class="icon-btn" data-gr-copy="${r.id}" title="Use as a starting point for a new report" aria-label="Copy">📋</button>
        ${edit ? `<button class="icon-btn" data-gr-edit="${r.id}" title="Edit" aria-label="Edit">✏️</button>
        <button class="icon-btn" data-gr-delete="${r.id}" title="Delete" aria-label="Delete">🗑️</button>` : ""}
      </td>
    </tr>`;
  }).join("");
  $("#gr-list").innerHTML = `
    <p class="muted tiny">${gardenRows.length} line${gardenRows.length === 1 ? "" : "s"}</p>
    <div class="table-wrap"><table class="garden-grid"><thead><tr>
      <th>Date</th><th>Task</th><th>Gardeners</th><th>Units</th><th>Communal entities</th><th></th>
    </tr></thead><tbody>${rows || `<tr><td colspan="6" class="empty">Nothing reported in this period.</td></tr>`}</tbody></table></div>`;
}

/* --- Add / edit form --- */
function gardenChecklist(name, items, selected, cls = "") {
  if (!items.length) return `<p class="muted tiny">None available.</p>`;
  return `<div class="checklist ${cls}">` + items.map((it) =>
    `<label class="check"><input type="checkbox" name="${name}" value="${it.value}" ${selected.includes(it.value) ? "checked" : ""} /> ${esc(it.label)}</label>`).join("") + `</div>`;
}
const gardenChecked = (name) => [...$$(`#garden-form input[name="${name}"]:checked`)].map((i) => i.value);

// prefill: { date, tasks[], description, gardeners[], units[], areas[] }
function openGardenModal(row, prefill = null) {
  gardenEditing = row;
  const src = row ? {
    date: row.action_date, tasks: [row.task_id], description: row.description || "",
    gardeners: rowIds(row, "garden_report_gardeners", "gardener_id"),
    units: rowIds(row, "garden_report_units", "unit_id"), areas: rowIds(row, "garden_report_areas", "area_id"),
  } : (prefill || { date: todayISO_(), tasks: [], description: "", gardeners: myGardenerId() ? [myGardenerId()] : [], units: [], areas: [] });

  $("#garden-modal-title").textContent = row ? "Edit report line" : "Add to the gardening report";
  $("#garden-date").value = src.date;
  $("#garden-date").max = todayISO_();
  $("#garden-date").readOnly = !!row && !isTrustee();   // gardeners can't move a line to another date
  $("#garden-description").value = src.description;

  // Tasks: tick several when adding (one line each); one dropdown when editing.
  $("#garden-tasks").innerHTML = row
    ? `<select id="garden-task-one">${state.gardenTasks.map((t) => `<option value="${t.id}" ${t.id === row.task_id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`
    : gardenChecklist("gr-task", state.gardenTasks.map((t) => ({ value: t.id, label: t.name })), src.tasks, "tasks");
  $("#garden-tasks-hint").hidden = !!row;

  const gardeners = gardenLookup.gardeners.filter((g) => g.current || src.gardeners.includes(g.id));
  $("#garden-gardeners").innerHTML = gardenChecklist("gr-gardener",
    gardeners.map((g) => ({ value: g.id, label: g.name + (g.current ? "" : " (former)") })), src.gardeners, "tasks");
  $("#garden-units").innerHTML = gardenChecklist("gr-unit",
    gardenLookup.units.slice().sort(unitCompare).map((u) => ({ value: u.id, label: unitChoiceLabel(u).replace("Unit ", "") })), src.units, "units");
  $("#garden-areas").innerHTML = gardenChecklist("gr-area",
    areasByGrouping(state.areas).map((a) => ({ value: a.id, label: areaFullLabel(a) })), src.areas);
  $("#garden-last").hidden = !!row;
  $("#garden-msg").textContent = "";
  updateGardenSaveLabel();
  $("#garden-modal").classList.add("active");
}

function updateGardenSaveLabel() {
  if (gardenEditing) { $("#garden-save").textContent = "Save"; return; }
  const n = gardenChecked("gr-task").length;
  $("#garden-save").textContent = n > 1 ? `Save ${n} report lines` : "Save report line";
}

// "Same as my last report": copy gardeners, units and entities from my latest line.
async function gardenUseLast() {
  const { data } = await sb.from("garden_reports")
    .select("*, garden_report_gardeners(gardener_id), garden_report_units(unit_id), garden_report_areas(area_id)")
    .eq("created_by", me.id).order("created_at", { ascending: false }).limit(1);
  const last = data && data[0];
  if (!last) { setMsg("garden-msg", "You haven't captured a report yet.", false); return; }
  const set = (name, ids) => $$(`#garden-form input[name="${name}"]`).forEach((i) => { i.checked = ids.includes(i.value); });
  set("gr-gardener", rowIds(last, "garden_report_gardeners", "gardener_id"));
  set("gr-unit", rowIds(last, "garden_report_units", "unit_id"));
  set("gr-area", rowIds(last, "garden_report_areas", "area_id"));
  setMsg("garden-msg", `Copied the gardeners, units and entities from your report of ${fmtDay(last.action_date)}.`, true);
}

document.addEventListener("click", (e) => {
  const all = e.target.closest("[data-gr-all]");
  if (all) $$(`#garden-form input[name="${all.dataset.grAll}"]`).forEach((i) => { i.checked = true; });
  const none = e.target.closest("[data-gr-none]");
  if (none) $$(`#garden-form input[name="${none.dataset.grNone}"]`).forEach((i) => { i.checked = false; });
  if (e.target.id === "garden-last") gardenUseLast();
});
document.addEventListener("change", (e) => {
  if (e.target.name === "gr-task") updateGardenSaveLabel();
});

$("#garden-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = $("#garden-date").value;
  const tasks = gardenEditing ? [$("#garden-task-one").value] : gardenChecked("gr-task");
  const gardeners = gardenChecked("gr-gardener");
  if (!date) { setMsg("garden-msg", "\u26a0\ufe0f Please choose the action date.", false); return; }
  if (date > todayISO_()) { setMsg("garden-msg", "\u26a0\ufe0f You can't report work for a future date.", false); return; }
  if (!tasks.length || !tasks[0]) { setMsg("garden-msg", "\u26a0\ufe0f Please tick at least one task.", false); return; }
  if (!gardeners.length) { setMsg("garden-msg", "\u26a0\ufe0f Please tick at least one gardener.", false); return; }
  const btn = $("#garden-save"); btn.disabled = true;
  const { data, error } = await sb.rpc("save_garden_reports", {
    p_id: gardenEditing ? gardenEditing.id : null, p_date: date, p_tasks: tasks,
    p_description: $("#garden-description").value.trim(), p_gardeners: gardeners,
    p_units: gardenChecked("gr-unit"), p_areas: gardenChecked("gr-area"),
  });
  btn.disabled = false;
  if (error) { setMsg("garden-msg", "\u26a0\ufe0f " + error.message, false); return; }
  // Make sure the saved date is inside the list's dates.
  if (gardenFilter && (date < gardenFilter.from || date > gardenFilter.to)) gardenFilter = { ...gardenFilter, from: date < gardenFilter.from ? date : gardenFilter.from, to: date > gardenFilter.to ? date : gardenFilter.to };
  closeOverlays();
  renderGarden();
  if (!gardenEditing && data > 1) setTimeout(() => { const l = $("#gr-list p"); if (l) l.textContent += ` · ${data} lines added`; }, 600);
});

/* --- Delete --- */
function openGardenDelete(r) {
  gardenDeleting = r;
  $("#grdel-text").innerHTML = `<strong>${esc(gardenTaskName(r.task_id))}</strong> on ${esc(fmtDay(r.action_date))} will be deleted, with its comments. This can't be undone.`;
  $("#grdel-msg").textContent = "";
  $("#grdel-modal").classList.add("active");
}
$("#grdel-confirm").addEventListener("click", async () => {
  const { error } = await sb.rpc("delete_garden_report", { p_id: gardenDeleting.id });
  if (error) { setMsg("grdel-msg", "\u26a0\ufe0f " + error.message, false); return; }
  closeOverlays();
  loadGardenList();
});

/* --- Comments --- */
async function openGardenComments(r) {
  gardenCommentsFor = r.id;
  const units = rowIds(r, "garden_report_units", "unit_id").map((id) => gardenLookup.units.find((u) => u.id === id)).filter(Boolean).sort(unitCompare).map(unitChoiceLabel);
  const areas = areasByGrouping(rowIds(r, "garden_report_areas", "area_id").map((id) => state.areas.find((a) => a.id === id)).filter(Boolean)).map(areaFullLabel);
  $("#grc-head").innerHTML = `
    <h3>${esc(gardenTaskName(r.task_id))} · ${esc(fmtDay(r.action_date))}</h3>
    ${r.captured_late ? `<span class="late-badge">⏱ captured later, on ${esc(fmtDateTimeFull(r.created_at))}</span>` : ""}
    <dl class="detail-grid">
      <dt>Gardeners</dt><dd>${esc(rowIds(r, "garden_report_gardeners", "gardener_id").map(gardenerName).sort().join(", ") || "—")}</dd>
      <dt>Units</dt><dd>${esc(units.join(", ") || "—")}</dd>
      <dt>Communal entities</dt><dd>${esc(areas.join("; ") || "—")}</dd>
      <dt>Description</dt><dd>${esc(r.description || "—")}</dd>
      <dt>Captured by</dt><dd>${esc(r.created_by_name || "—")}</dd>
    </dl>`;
  $("#grc-body").value = "";
  $("#grc-msg").textContent = "";
  $("#grc-modal").classList.add("active");
  loadGardenComments();
}

async function loadGardenComments() {
  const { data } = await sb.from("garden_report_comments").select("*")
    .eq("report_id", gardenCommentsFor).order("created_at", { ascending: false });
  $("#grc-list").innerHTML = (data || []).length ? data.map((c) => `
    <div class="fb-item" data-grc-item="${c.id}">
      <div class="fb-head"><strong>${esc(c.author_id === me.id ? "You" : (c.author_name || "User"))}</strong>${c.author_role ? ` <span class="muted tiny">· ${esc(ROLE_LABEL[c.author_role] || c.author_role)}</span>` : ""}
        <span class="tl-time">${fmtDate(c.created_at)}${c.updated_at ? " · edited" : ""}
        ${c.author_id === me.id ? `<button class="icon-btn" data-grc-edit="${c.id}" title="Edit comment" aria-label="Edit comment">✏️</button>` : ""}</span></div>
      <div class="fb-body" id="grc-text-${c.id}">${esc(c.body)}</div>
    </div>`).join("") : `<p class="muted tiny">No comments yet.</p>`;
}

$("#grc-post").addEventListener("click", async () => {
  const body = $("#grc-body").value.trim();
  if (!body) return;
  const { error } = await sb.from("garden_report_comments").insert({ report_id: gardenCommentsFor, body });
  if (error) { setMsg("grc-msg", "\u26a0\ufe0f " + error.message, false); return; }
  $("#grc-body").value = "";
  $("#grc-msg").textContent = "";
  loadGardenComments();
  const r = gardenRows.find((x) => x.id === gardenCommentsFor);
  if (r) { r.garden_report_comments = [...(r.garden_report_comments || []), { id: "new" }]; renderGardenRows(); }
});

document.addEventListener("click", async (e) => {
  const ed = e.target.closest("[data-grc-edit]");
  if (ed) {
    const id = ed.dataset.grcEdit, box = $(`#grc-text-${id}`);
    if (!box || box.querySelector("textarea")) return;
    const text = box.textContent;
    box.innerHTML = `<textarea rows="3" class="grc-edit-box">${esc(text)}</textarea>
      <div class="fb-compose-bar" style="border:0;background:none;padding:4px 0">
        <button type="button" class="btn ghost small" data-grc-cancel="${id}">Cancel</button>
        <button type="button" class="btn primary small" data-grc-save="${id}">Save</button></div>`;
    box.querySelector("textarea").focus();
  }
  const cancel = e.target.closest("[data-grc-cancel]");
  if (cancel) loadGardenComments();
  const save = e.target.closest("[data-grc-save]");
  if (save) {
    const id = save.dataset.grcSave;
    const body = $(`#grc-text-${id} textarea`).value.trim();
    if (!body) return;
    const { error } = await sb.from("garden_report_comments").update({ body }).eq("id", id);
    if (error) { setMsg("grc-msg", "\u26a0\ufe0f " + error.message, false); return; }
    loadGardenComments();
  }
  // Row icons on the Gardening Report grid.
  const find = (attr) => { const b = e.target.closest(`[${attr}]`); return b ? gardenRows.find((r) => r.id === b.getAttribute(attr)) : null; };
  const rc = find("data-gr-comments"); if (rc) openGardenComments(rc);
  const re = find("data-gr-edit"); if (re) openGardenModal(re);
  const rd = find("data-gr-delete"); if (rd) openGardenDelete(rd);
  const rp = find("data-gr-copy");
  if (rp) openGardenModal(null, {
    date: todayISO_(), tasks: [], description: "",
    gardeners: rowIds(rp, "garden_report_gardeners", "gardener_id"),
    units: rowIds(rp, "garden_report_units", "unit_id"), areas: rowIds(rp, "garden_report_areas", "area_id"),
  });
});

/* ---------- Trustee-only registries: Trustees, Gardeners, Service providers ---------- */
// One shared list + add/edit form, driven by the definitions below.
const GENDER_LABEL = { male: "Male", female: "Female", other: "Other" };
const todayISO = () => new Date().toISOString().slice(0, 10);
const regIsCurrent = (r) => !r.service_end || r.service_end >= todayISO();
const regStatusPill = (r) => regIsCurrent(r)
  ? '<span class="pill approved">Current</span>'
  : `<span class="pill rejected">Ended ${fmtDay(r.service_end)}</span>`;
const mailLink = (e) => (e ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : "—");
const telLink = (p) => (p ? `<a href="tel:${esc(p)}">${esc(p)}</a>` : "—");
const providerName = (r) => (r.kind === "company" ? (r.company_name || "—") : fullName(r));

const END_LABEL = "Service end date (leave empty if current)";
const REGISTRIES = {
  trustees: {
    table: "trustees", title: "Trustees", ico: "🧑‍💼", noun: "trustee",
    hint: "Trustees of the complex. A trustee lives in the complex, so is linked to the unit they live in. Leave the service end date empty while they are current.",
    displayName: (r) => fullName(r),
    fields: [
      { key: "first_name", label: "Name", type: "text", required: true },
      { key: "last_name", label: "Surname", type: "text", required: true },
      { key: "cell", label: "Cell number", type: "tel" },
      { key: "unit_id", label: "Lives in unit", type: "unit" },
      { key: "service_start", label: "Service start date", type: "date", required: true },
      { key: "service_end", label: END_LABEL, type: "date" },
    ],
    columns: [
      ["Name", (r) => `<strong>${esc(fullName(r))}</strong>`],
      ["Unit", (r) => (r.unit_id ? unitLinkChip(r.unit_id) : "—")],
      ["Cell", (r) => telLink(r.cell)],
    ],
  },
  gardeners: {
    table: "gardeners", title: "Gardeners", ico: "🧑‍🌾", noun: "gardener",
    hint: "Visible to trustees only. ID numbers and dates of birth are personal information — they are shown on the edit form, not in this list.",
    displayName: (r) => fullName(r),
    fields: [
      { key: "first_name", label: "Name", type: "text", required: true },
      { key: "last_name", label: "Surname", type: "text", required: true },
      { key: "gender", label: "Gender", type: "select",
        options: [["", "— choose —"], ["male", "Male"], ["female", "Female"], ["other", "Other"]] },
      { key: "id_number", label: "ID number", type: "text" },
      { key: "date_of_birth", label: "Date of birth", type: "date" },
      { key: "cell", label: "Cell number", type: "tel" },
      { key: "email", label: "Email address", type: "email" },
      { key: "service_start", label: "Service start date", type: "date", required: true },
      { key: "service_end", label: END_LABEL, type: "date" },
    ],
    columns: [
      ["Name", (r) => `<strong>${esc(fullName(r))}</strong>`],
      ["Gender", (r) => esc(GENDER_LABEL[r.gender] || "—")],
      ["Cell", (r) => telLink(r.cell)],
      ["Email", (r) => mailLink(r.email)],
    ],
  },
  providers: {
    table: "service_providers", title: "Service providers", ico: "🔧", noun: "service provider",
    hint: "Companies or individuals who provide services to the complex. Leave the service end date empty while they are current.",
    displayName: (r) => providerName(r),
    fields: [
      { key: "kind", label: "This service provider is a", type: "select", required: true, default: "company",
        options: [["company", "Company"], ["person", "Person"]] },
      { key: "first_name", label: "Name", type: "text", required: true, showIf: (v) => v.kind === "person" },
      { key: "last_name", label: "Surname", type: "text", required: true, showIf: (v) => v.kind === "person" },
      { key: "company_name", label: "Company name", type: "text", required: true, showIf: (v) => v.kind === "company" },
      { key: "contact_person", label: "Contact person", type: "text", showIf: (v) => v.kind === "company" },
      { key: "phone", label: "Phone number", type: "tel" },
      { key: "email", label: "Email address", type: "email" },
      { key: "service_start", label: "Service start date", type: "date", required: true },
      { key: "service_end", label: END_LABEL, type: "date" },
    ],
    columns: [
      ["Name", (r) => `<strong>${esc(providerName(r))}</strong>`],
      ["Type", (r) => (r.kind === "company" ? "Company" : "Person")],
      ["Contact person", (r) => esc(r.contact_person || "—")],
      ["Phone", (r) => telLink(r.phone)],
      ["Email", (r) => mailLink(r.email)],
    ],
  },
};

function renderRegistry(key) {
  const cfg = REGISTRIES[key];
  // Current first, then by name.
  const rows = (state.registry[key] || []).slice().sort((a, b) =>
    (regIsCurrent(b) - regIsCurrent(a)) || cfg.displayName(a).localeCompare(cfg.displayName(b)));
  const head = [...cfg.columns.map((c) => c[0]), "Service start", "Status", ""];
  const body = rows.map((r) => `<tr class="${regIsCurrent(r) ? "" : "inactive-row"}">
      ${cfg.columns.map((c, i) => `<td>${c[1](r)}${i === 0 ? " " + userBadge(r) : ""}</td>`).join("")}
      <td>${fmtDay(r.service_start)}</td>
      <td>${regStatusPill(r)}</td>
      <td style="text-align:right"><button class="btn ghost small" data-reg-edit="${key}" data-id="${r.id}">Edit</button></td>
    </tr>`).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>${cfg.ico} ${cfg.title}</h2>
        <button class="btn primary small" data-reg-add="${key}">+ Add ${cfg.noun}</button></div>
      <p class="muted tiny">${cfg.hint}</p>
      <div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${body || `<tr><td colspan="${head.length}" class="empty">Nothing here yet — use the Add button.</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

let regCtx = { key: null, id: null };

function regFieldHtml(f, rec) {
  const v = rec?.[f.key] ?? f.default ?? "";
  const id = `reg-f-${f.key}`;
  let input;
  if (f.type === "select") {
    input = `<select id="${id}">${f.options.map(([val, label]) =>
      `<option value="${val}" ${String(v) === val ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
  } else if (f.type === "unit") {
    input = `<select id="${id}"><option value="">— none —</option>${state.units.map((u) =>
      `<option value="${u.id}" ${v === u.id ? "selected" : ""}>Unit ${esc(u.number)}</option>`).join("")}</select>`;
  } else {
    input = `<input id="${id}" type="${f.type}" value="${esc(v)}" autocomplete="off" />`;
  }
  return `<label data-reg-field="${f.key}">${esc(f.label)}${f.required ? " *" : ""} ${input}</label>`;
}

function regValues() {
  const cfg = REGISTRIES[regCtx.key];
  const out = {};
  cfg.fields.forEach((f) => { const el = $("#reg-f-" + f.key); out[f.key] = el ? el.value.trim() : ""; });
  return out;
}
const regFieldVisible = (f, vals) => (f.showIf ? f.showIf(vals) : true);

// Show/hide fields that depend on another field (e.g. person vs company).
function applyRegVisibility() {
  const cfg = REGISTRIES[regCtx.key];
  const vals = regValues();
  cfg.fields.forEach((f) => {
    const wrap = document.querySelector(`[data-reg-field="${f.key}"]`);
    if (wrap) wrap.hidden = !regFieldVisible(f, vals);
  });
}

function openRegModal(key, id) {
  const cfg = REGISTRIES[key];
  const rec = id ? (state.registry[key] || []).find((r) => r.id === id) : null;
  regCtx = { key, id: rec ? rec.id : null };
  $("#reg-modal-title").textContent = (rec ? "Edit " : "Add ") + cfg.noun;
  $("#reg-modal-title-user").innerHTML = rec && rec.profile_id
    ? `🔐 Also a user${userForRecord(rec).email ? ": " + esc(userForRecord(rec).email) : ""}` : "";
  $("#reg-fields").innerHTML = cfg.fields.map((f) => regFieldHtml(f, rec)).join("");
  applyRegVisibility();
  $("#reg-msg").textContent = "";
  $("#reg-modal").classList.add("active");
}

document.addEventListener("change", (e) => {
  if (e.target.id && e.target.id.startsWith("reg-f-") && regCtx.key) applyRegVisibility();
});

$("#reg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cfg = REGISTRIES[regCtx.key];
  const vals = regValues();
  const payload = {};
  for (const f of cfg.fields) {
    const visible = regFieldVisible(f, vals);
    const val = vals[f.key];
    if (visible && f.required && !val) {
      setMsg("reg-msg", `⚠️ ${f.label.replace(/\s*\(.*\)$/, "")} is required.`, false);
      return;
    }
    if (visible && f.type === "email" && val && !/^\S+@\S+\.\S+$/.test(val)) {
      setMsg("reg-msg", "⚠️ Please enter a valid email address.", false);
      return;
    }
    payload[f.key] = visible && val !== "" ? val : null;   // hidden fields are cleared
  }
  if (payload.service_end && payload.service_start && payload.service_end < payload.service_start) {
    setMsg("reg-msg", "⚠️ The service end date cannot be before the start date.", false);
    return;
  }
  const { error } = regCtx.id
    ? await sb.from(cfg.table).update(payload).eq("id", regCtx.id)
    : await sb.from(cfg.table).insert(payload);
  if (error) {
    setMsg("reg-msg", error.message.includes("duplicate")
      ? "⚠️ A record with that ID number already exists." : "⚠️ " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Communal entity groupings (trustee) ---------- */
function areaGroupName(id) {
  return state.areaGroups.find((g) => g.id === id)?.name || "";
}
// "Grouping – Type" wherever a type is chosen (just the type if it has no grouping).
function areaTypeLabel(t) {
  const g = areaGroupName(t.group_id);
  return g ? `${g} – ${t.name}` : t.name;
}
// Types ordered by grouping, then type (types without a grouping last).
function typesByGrouping(types) {
  return types.slice().sort((a, b) => {
    const ga = areaGroupName(a.group_id), gb = areaGroupName(b.group_id);
    if (!ga !== !gb) return ga ? -1 : 1;
    return ga.localeCompare(gb, undefined, { sensitivity: "base" })
      || String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
  });
}
// <option>s for a type picker.
function areaTypeOptions(types, selectedId) {
  return typesByGrouping(types).map((t) =>
    `<option value="${t.id}" ${selectedId === t.id ? "selected" : ""}>${esc(areaTypeLabel(t))}</option>`).join("");
}

function renderAreaGroups() {
  const rows = state.areaGroups.map((g) => {
    const n = state.areaTypes.filter((t) => t.group_id === g.id).length;
    return `<tr>
    <td><strong>${esc(g.name)}</strong></td>
    <td class="muted">${esc(g.description || "—")}</td>
    <td>${n} type${n === 1 ? "" : "s"}</td>
    <td style="text-align:right"><button class="btn ghost small" data-edit-areagroup="${g.id}">Edit</button></td>
  </tr>`;
  }).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🗂️ Communal entity groupings</h2>
        <button class="btn primary small" id="add-areagroup-btn">+ Add grouping</button></div>
      <p class="muted tiny">Groupings for communal entity types (e.g. Garden, Infrastructure). Link a type to a grouping on the Communal entity types screen.</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Description</th><th>Types</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">No groupings yet.</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-areagroup-btn").addEventListener("click", () => openAreaGroupModal(null));
}

function openAreaGroupModal(g) {
  $("#areagroup-modal-title").textContent = g ? "Edit grouping" : "Add grouping";
  $("#areagroup-id").value = g?.id || "";
  $("#areagroup-name").value = g?.name || "";
  $("#areagroup-description").value = g?.description || "";
  $("#areagroup-msg").textContent = "";
  $("#areagroup-modal").classList.add("active");
}

$("#areagroup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#areagroup-id").value;
  const payload = {
    name: $("#areagroup-name").value.trim(),
    description: $("#areagroup-description").value.trim() || null,
  };
  if (!payload.name) { setMsg("areagroup-msg", "\u26a0\ufe0f Please enter a name.", false); return; }
  const { error } = id
    ? await sb.from("communal_area_groups").update(payload).eq("id", id)
    : await sb.from("communal_area_groups").insert(payload);
  if (error) {
    setMsg("areagroup-msg", error.message.includes("duplicate") ? "That grouping name already exists."
      : /communal_area_groups/.test(error.message) ? "\u26a0\ufe0f Run supabase/28_communal_entity_groupings.sql first."
      : "\u26a0\ufe0f " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Communal entity types (trustee) ---------- */
// "Grouping – Type" for a type id (as in the type dropdowns).
function areaTypeFullName(id) {
  const t = state.areaTypes.find((x) => x.id === id);
  return t ? areaTypeLabel(t) : "—";
}
// "Grouping – Type – Code – Name" for a communal entity.
function areaFullLabel(a) {
  const t = state.areaTypes.find((x) => x.id === a.type_id);
  return [t ? areaTypeLabel(t) : "", a.code, a.name].filter(Boolean).join(" – ");
}
// Entities ordered by grouping, then type, then code (no type last).
function areasByGrouping(areas) {
  const order = new Map(typesByGrouping(state.areaTypes).map((t, i) => [t.id, i]));
  const rank = (a) => (order.has(a.type_id) ? order.get(a.type_id) : 1e9);
  return areas.slice().sort((a, b) => rank(a) - rank(b)
    || String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
}

function areaTypeName(id) {
  return state.areaTypes.find((t) => t.id === id)?.name || "—";
}

// Grouping filter on the types screen ("" = all, "none" = no grouping, else a grouping id).
let areaTypeGroupFilter = "";

function renderAreaTypes() {
  const all = state.areaTypes;
  const count = (id) => all.filter((t) => t.group_id === id).length;
  const ungrouped = all.filter((t) => !t.group_id || !areaGroupName(t.group_id)).length;
  const opts = [{ value: "", label: `All groupings (${all.length})` }]
    .concat(state.areaGroups.map((g) => ({ value: g.id, label: `${g.name} (${count(g.id)})` })));
  if (ungrouped) opts.push({ value: "none", label: `No grouping (${ungrouped})` });
  if (!opts.some((o) => o.value === areaTypeGroupFilter)) areaTypeGroupFilter = "";
  const f = areaTypeGroupFilter;
  const shown = typesByGrouping(all.filter((t) =>
    !f || (f === "none" ? !areaGroupName(t.group_id) : t.group_id === f)));

  const rows = shown.map((tt) => `<tr class="${tt.active ? "" : "inactive-row"}">
    <td>${esc(areaGroupName(tt.group_id)) || '<span class="muted">—</span>'}</td>
    <td><strong>${esc(tt.name)}</strong></td>
    <td class="muted">${esc(tt.description || "—")}</td>
    <td>${tt.active ? '<span class="pill approved">Active</span>' : '<span class="pill rejected">Hidden</span>'}</td>
    <td style="text-align:right"><button class="btn ghost small" data-edit-areatype="${tt.id}">Edit</button></td>
  </tr>`).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🏷 Communal entity types</h2>
        <button class="btn primary small" id="add-areatype-btn">+ Add type</button></div>
      <p class="muted tiny">Types of communal entity (Road, Gate, Grass, Flower Bed, Lamp pole, …), each optionally in a grouping.</p>
      <div class="filters">
        <label>Grouping
          <select id="areatype-group-filter">
            ${opts.map((o) => `<option value="${o.value}" ${o.value === f ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
          </select>
        </label>
        ${f ? `<span class="muted tiny">Showing ${shown.length} of ${all.length}</span>` : ""}
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>Grouping</th><th>Name</th><th>Description</th><th>Status</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">${all.length ? "No types in this grouping." : "No types yet."}</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-areatype-btn").addEventListener("click", () => openAreaTypeModal(null));
  $("#areatype-group-filter").addEventListener("change", (e) => {
    areaTypeGroupFilter = e.target.value;
    renderAreaTypes();
  });
}

function openAreaTypeModal(tt) {
  $("#areatype-modal-title").textContent = tt ? "Edit type" : "Add type";
  $("#areatype-id").value = tt?.id || "";
  $("#areatype-name").value = tt?.name || "";
  $("#areatype-description").value = tt?.description || "";
  // New types default to the grouping being filtered on.
  const gid = tt ? tt.group_id : (areaTypeGroupFilter && areaTypeGroupFilter !== "none" ? areaTypeGroupFilter : "");
  $("#areatype-group").innerHTML = `<option value="">— no grouping —</option>` +
    state.areaGroups.map((g) => `<option value="${g.id}" ${gid === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("");
  $("#areatype-active").checked = tt ? !!tt.active : true;
  $("#areatype-msg").textContent = "";
  $("#areatype-modal").classList.add("active");
}

$("#areatype-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#areatype-id").value;
  const payload = {
    name: $("#areatype-name").value.trim(),
    description: $("#areatype-description").value.trim() || null,
    active: $("#areatype-active").checked,
    group_id: $("#areatype-group").value || null,
  };
  const { error } = id
    ? await sb.from("communal_area_types").update(payload).eq("id", id)
    : await sb.from("communal_area_types").insert(payload);
  if (error) {
    setMsg("areatype-msg", error.message.includes("duplicate") ? "That type name already exists." : "⚠️ " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Communal entities (trustee) ---------- */
// Filter for the Communal entities list ("" = all, "none" = no type, else a type id).
// Kept between visits so it survives adding/editing an entity.
let areaTypeFilter = "";

// Entities matching the chosen type filter.
function filterAreasByType(areas, filter) {
  if (!filter) return areas;
  if (filter === "none") return areas.filter((a) => !a.type_id);
  return areas.filter((a) => a.type_id === filter);
}

// Dropdown options: every active type, plus any hidden type still in use,
// each with how many entities it has.
function areaTypeFilterOptions(areas, types) {
  const count = (id) => areas.filter((a) => a.type_id === id).length;
  const opts = [{ value: "", label: `All types (${areas.length})` }];
  typesByGrouping(types.filter((t) => t.active || count(t.id) > 0))
    .forEach((t) => opts.push({ value: t.id, label: `${areaTypeLabel(t)} (${count(t.id)})` }));
  const untyped = areas.filter((a) => !a.type_id).length;
  if (untyped) opts.push({ value: "none", label: `No type (${untyped})` });
  return opts;
}

function renderAreas() {
  const opts = areaTypeFilterOptions(state.areas, state.areaTypes);
  if (!opts.some((o) => o.value === areaTypeFilter)) areaTypeFilter = "";  // type removed
  const shown = filterAreasByType(state.areas, areaTypeFilter);

  const rows = shown.map((a) => {
    const photos = state.areaPhotos.filter((p) => p.area_id === a.id).length;
    return `<tr>
      <td><strong>${esc(a.code)}</strong></td>
      <td>${esc(a.name)}</td>
      <td>${esc(areaTypeFullName(a.type_id))}</td>
      <td>${photos} photo${photos === 1 ? "" : "s"}</td>
      <td style="text-align:right">
        <button class="btn ghost small" data-open-area="${a.id}">Open</button></td>
    </tr>`;
  }).join("");

  const empty = state.areas.length
    ? "No communal entities of this type."
    : "No communal entities yet.";

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🧩 Communal entities</h2>
        <button class="btn primary small" id="add-area-btn">+ Add entity</button></div>
      <div class="filters">
        <label>Type
          <select id="area-type-filter">
            ${opts.map((o) => `<option value="${o.value}" ${o.value === areaTypeFilter ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
          </select>
        </label>
        ${areaTypeFilter ? `<span class="muted tiny">Showing ${shown.length} of ${state.areas.length}</span>` : ""}
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>Code</th><th>Name</th><th>Type</th><th>Photos</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">${empty}</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-area-btn").addEventListener("click", () => openAreaModal(null));
  $("#area-type-filter").addEventListener("change", (e) => {
    areaTypeFilter = e.target.value;
    renderAreas();
  });
}

function openAreaModal(area) {
  $("#area-modal-title").textContent = area ? "Edit communal entity" : "Add communal entity";
  $("#area-id").value = area?.id || "";
  $("#area-code").value = area?.code || "";
  $("#area-name").value = area?.name || "";
  $("#area-description").value = area?.description || "";
  $("#area-type").innerHTML = `<option value="">— type —</option>` +
    areaTypeOptions(state.areaTypes.filter((t) => t.active || t.id === area?.type_id), area?.type_id);
  $("#area-msg").textContent = "";
  $("#area-modal").classList.add("active");
}

$("#area-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#area-id").value;
  const payload = {
    code: $("#area-code").value.trim(),
    name: $("#area-name").value.trim(),
    description: $("#area-description").value.trim(),
    type_id: $("#area-type").value || null,
  };
  const { error } = id
    ? await sb.from("communal_areas").update(payload).eq("id", id)
    : await sb.from("communal_areas").insert(payload);
  if (error) {
    setMsg("area-msg", error.message.includes("duplicate") ? "That code already exists." : "⚠️ " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Communal entity detail + photos ---------- */
let currentAreaId = null;

function renderAreaDetail(areaId) {
  currentAreaId = areaId || currentAreaId;
  const a = state.areas.find((x) => x.id === currentAreaId);
  if (!a) return renderAreas();
  const photos = state.areaPhotos.filter((p) => p.area_id === a.id);

  $("#main").innerHTML = `
    <button class="link-btn" data-back-view="areas">← Back to communal entities</button>
    <div class="panel">
      <div class="panel-head"><h2>🧩 ${esc(a.name)}</h2>
        <button class="btn ghost small" data-edit-area="${a.id}">Edit</button></div>
      <dl class="detail-grid">
        <dt>Code</dt><dd>${esc(a.code)}</dd>
        <dt>Type</dt><dd>${esc(areaTypeName(a.type_id))}</dd>
        <dt>Description</dt><dd>${esc(a.description || "—")}</dd>
      </dl>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>📷 Photos</h2>
        <label class="btn primary small upload-label">+ Add photo
          <input type="file" accept="image/*" id="area-photo-input" hidden /></label></div>
      <p id="area-photo-msg" class="login-msg"></p>
      ${photos.length ? `<div class="photo-grid">${photos.map((p) =>
        `<figure class="photo-item"><a href="${publicUrl(p.storage_path)}" target="_blank" rel="noopener">
          <img src="${publicUrl(p.storage_path)}" loading="lazy" /></a>
          <button class="photo-del" data-del-area-photo="${p.id}">✕</button></figure>`).join("")}</div>`
        : `<div class="empty">No photos yet.</div>`}
    </div>`;
  const input = $("#area-photo-input");
  if (input) input.addEventListener("change", (e) => onAreaPhotoChosen(e, a.id));
}

async function onAreaPhotoChosen(e, areaId) {
  const file = e.target.files[0];
  if (!file) return;
  setMsg("area-photo-msg", "Uploading…", true);
  try {
    const path = await uploadFile(file, `areas/${areaId}`);
    const { error } = await sb.from("communal_area_photos").insert({
      area_id: areaId, storage_path: path, uploaded_by: me.id,
    });
    if (error) { await deleteFile(path); throw error; }
    await loadData();
    renderAreaDetail(areaId);
  } catch (err) {
    setMsg("area-photo-msg", "⚠️ " + (err.message || "Upload failed"), false);
  }
}

async function deleteAreaPhoto(photoId) {
  const photo = state.areaPhotos.find((p) => p.id === photoId);
  if (!photo) return;
  if (!confirm("Delete this photo?")) return;
  await sb.from("communal_area_photos").delete().eq("id", photoId);
  await deleteFile(photo.storage_path);
  await loadData();
  renderAreaDetail(photo.area_id);
}

/* ---------- AI engagement (trustee admin) ---------- */
async function renderAiEngagement(filter = "") {
  // Trustees can read all rows (RLS). Join author name from profiles.
  if (!aiEngagementRows.length) {
    const { data } = await sb.from("rule_questions")
      .select("*").order("created_at", { ascending: false });
    aiEngagementRows = data || [];
  }
  const f = filter.toLowerCase().trim();
  const rows = aiEngagementRows.filter((q) => {
    if (!f) return true;
    const who = (askUserName(q.user_id) || "").toLowerCase();
    return who.includes(f) || (q.question || "").toLowerCase().includes(f);
  });

  // Simple engagement summary: questions per user.
  const counts = {};
  aiEngagementRows.forEach((q) => { counts[q.user_id] = (counts[q.user_id] || 0) + 1; });
  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([uid, n]) => `<span class="chip">${esc(askUserName(uid))}: ${n}</span>`).join(" ");

  $("#main").innerHTML = `
    <div class="stats-grid">
      ${statCard(aiEngagementRows.length, "Questions asked", "")}
      ${statCard(Object.keys(counts).length, "Users engaging", "waiting")}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>✨ AI engagement</h2>
        <span class="hint">Every question residents asked the assistant</span></div>
      <div class="linked-row" style="margin-bottom:12px">${summary || '<span class="muted tiny">No questions yet.</span>'}</div>
      <div class="filters">
        <input type="search" id="ai-filter" placeholder="Filter by person or question…" value="${esc(filter)}" />
      </div>
      <div id="ai-list" class="request-list"></div>
    </div>`;

  const list = $("#ai-list");
  list.innerHTML = rows.length ? rows.map((q) => `
    <div class="request-card" data-ai-expand="${q.id}">
      <div class="rc-top">
        <div>
          <div class="rc-title">${esc(q.question)}</div>
          <div class="rc-meta">${esc(askUserName(q.user_id))} · ${fmtDate(q.created_at)}</div>
        </div>
      </div>
      <div class="ai-admin-answer" id="ai-ans-${q.id}" hidden>${esc(q.answer || "(no answer recorded)")}</div>
    </div>`).join("") : `<div class="empty">No questions match.</div>`;

  $("#ai-filter").addEventListener("input", (e) => {
    // Re-render just the list, keeping focus/caret feel simple.
    const val = e.target.value;
    renderAiEngagement(val);
    const inp = $("#ai-filter"); if (inp) { inp.focus(); inp.setSelectionRange(val.length, val.length); }
  });
}

// The user's name, or "" when none was captured (older accounts had their
// email copied into full_name when they first signed in).
function realName(p) {
  const n = String((p && p.full_name) || "").trim();
  return n && n.toLowerCase() !== String(p.email || "").toLowerCase() ? n : "";
}

function askUserName(uid) {
  const p = state.profiles.find((x) => x.id === uid);
  return p ? (p.full_name || p.email) : "(unknown user)";
}

/* ---------- Conduct rules (visible to all users) ---------- */
function renderConductRules() {
  const doc = state.conductDoc;
  const url = doc ? publicUrl(doc.storage_path) : "";

  const viewer = doc
    ? `<p class="muted tiny">Uploaded ${fmtDate(doc.created_at)}</p>
       <div class="detail-actions">
         <a class="btn primary" href="${url}" target="_blank" rel="noopener">📖 Open / download the rules</a>
       </div>
       <div class="doc-embed">
         <iframe title="Conduct rules" src="${url}#view=FitH"></iframe>
       </div>`
    : `<div class="empty">The conduct-rules document hasn't been uploaded yet.${isTrustee() ? " Use the button above to add it." : " Please check back soon."}</div>`;

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h2>📖 Master Document</h2>
        ${isTrustee()
          ? `<label class="btn primary small upload-label">${doc ? "Replace document" : "+ Upload document"}
               <input type="file" accept="application/pdf,.pdf" id="conduct-input" hidden /></label>`
          : ""}
      </div>
      <p class="muted tiny">The complex's conduct rules. ${isTrustee() ? "Upload a PDF; every resident can read it and the “Ask the Rules” assistant answers from it." : "Tap below to read them, or use “Ask the Rules” to ask a question."}</p>
      <p id="conduct-msg" class="login-msg"></p>
      ${viewer}
    </div>`;

  const input = $("#conduct-input");
  if (input) input.addEventListener("change", onConductChosen);
}

/* ---------- Ask the Rules (AI, with per-user history) ---------- */
let askHistory = [];      // this user's questions (newest first)
let askSelectedId = null; // currently shown history item

async function renderAskRules() {
  // Load this user's history (RLS returns only their own rows for residents).
  const { data } = await sb.from("rule_questions")
    .select("*").eq("user_id", me.id).order("created_at", { ascending: false });
  askHistory = data || [];
  if (!askSelectedId && askHistory.length) askSelectedId = askHistory[0].id;

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>✨ Ask the Rules</h2>
        <span class="hint">AI assistant — answers from the conduct rules</span></div>
      <p class="muted tiny">e.g. “my neighbour’s cat keeps coming into my yard — what do the rules say?”</p>
      <form id="ask-form" class="ask-form">
        <input id="ask-input" placeholder="Ask a question about the conduct rules…" autocomplete="off" />
        <button class="btn primary" type="submit" id="ask-send">Ask ✨</button>
      </form>
      <p class="ask-disclaimer">⚠️ ${esc(ASK_DISCLAIMER_TOP)}</p>
    </div>

    <div class="ask-layout">
      <div class="panel ask-history-panel">
        <div class="panel-head"><h2>🕑 Your questions</h2></div>
        <div id="ask-history" class="ask-history"></div>
      </div>
      <div class="panel ask-answer-panel">
        <div class="panel-head"><h2>💬 Answer</h2></div>
        <div id="ask-answer" class="ask-answer-box"></div>
      </div>
    </div>`;

  $("#ask-form").addEventListener("submit", onAskRules);
  renderAskHistory();
  renderAskAnswer();
}

function renderAskHistory() {
  const el = $("#ask-history");
  if (!el) return;
  if (!askHistory.length) {
    el.innerHTML = `<p class="muted tiny">No questions yet. Ask one above!</p>`;
    return;
  }
  el.innerHTML = askHistory.map((q) => `
    <button class="ask-hist-item ${q.id === askSelectedId ? "active" : ""}" data-ask-select="${q.id}">
      <div class="ask-hist-q">${esc(q.question)}</div>
      <div class="ask-hist-time">${fmtDate(q.created_at)}</div>
    </button>`).join("");
}

function renderAskAnswer() {
  const el = $("#ask-answer");
  if (!el) return;
  const item = askHistory.find((q) => q.id === askSelectedId);
  if (!item) {
    el.innerHTML = `<p class="muted tiny">Ask a question, or pick one from your history to see its answer.</p>`;
    return;
  }
  const hasAnswer = !!item.answer;
  el.innerHTML = `
    <div class="ask-shown-q">${esc(item.question)}</div>
    <div class="ask-answer ${hasAnswer ? "" : "thinking"}">${hasAnswer ? esc(item.answer) : "…"}</div>
    ${hasAnswer ? `
      <p class="ask-disclaimer below">${esc(ASK_DISCLAIMER_BELOW)}</p>
      <div class="ask-share">
        <span class="muted tiny">Keep this:</span>
        <button class="btn ghost small" data-share-copy="${item.id}">📋 Copy</button>
        <button class="btn ghost small" data-share-email="${item.id}">✉️ Email</button>
      </div>` : ""}`;
}

// Build the shareable text (question + answer + disclaimer).
function shareTextFor(item) {
  return `Blue Crane Vistas — Conduct Rules assistant\n\n` +
    `Question:\n${item.question}\n\n` +
    `Answer:\n${item.answer}\n\n` +
    `— ${ASK_DISCLAIMER_BELOW}`;
}
async function copyShare(item, btn) {
  const text = shareTextFor(item);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older/locked-down browsers.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
  }
  if (btn) {
    const original = btn.textContent;
    btn.textContent = "✓ Copied!";
    setTimeout(() => { btn.textContent = original; }, 1600);
  }
}
function shareViaEmail(item) {
  const subject = "Blue Crane Vistas — Conduct Rules answer";
  const url = "mailto:?subject=" + encodeURIComponent(subject) +
    "&body=" + encodeURIComponent(shareTextFor(item));
  window.location.href = url;
}

async function onAskRules(e) {
  e.preventDefault();
  const q = $("#ask-input").value.trim();
  if (!q) return;
  const btn = $("#ask-send");
  btn.disabled = true;
  $("#ask-input").value = "";

  // 1) Log the question immediately (answer filled in after the AI replies).
  const { data: row, error: insErr } = await sb.from("rule_questions")
    .insert({ user_id: me.id, question: q }).select().single();
  if (insErr) {
    btn.disabled = false;
    return;
  }
  // Show it at the top of history right away, selected, with a "thinking" answer.
  askHistory.unshift(row);
  askSelectedId = row.id;
  renderAskHistory();
  $("#ask-answer").innerHTML =
    `<div class="ask-shown-q">${esc(q)}</div><div class="ask-answer thinking">🤔 Reading the rules…</div>`;

  // 2) Call the AI.
  let answer = "";
  try {
    const { data, error } = await sb.functions.invoke("ask-rules", { body: { question: q } });
    if (error) throw error;
    answer = data.error ? "⚠️ " + data.error : (data.answer || "No answer returned.");
  } catch (err) {
    answer = "⚠️ The assistant couldn't be reached. Please try again shortly.";
  }

  // 3) Save the answer + update the view.
  await sb.from("rule_questions").update({ answer }).eq("id", row.id);
  row.answer = answer;
  renderAskAnswer();
  btn.disabled = false;
}

async function onConductChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type && file.type !== "application/pdf") {
    setMsg("conduct-msg", "⚠️ Please upload a PDF file.", false);
    return;
  }
  setMsg("conduct-msg", "Uploading…", true);
  try {
    const path = await uploadFile(file, "documents/conduct");
    // Insert the new document reference (keeps history; newest is shown).
    const { error } = await sb.from("documents").insert({
      kind: "conduct_rules", title: file.name, storage_path: path, uploaded_by: me.id,
    });
    if (error) { await deleteFile(path); throw error; }
    // Optionally clean up the previous file from storage.
    if (state.conductDoc) await deleteFile(state.conductDoc.storage_path);
    await loadData();
    renderConductRules();
  } catch (err) {
    setMsg("conduct-msg", "⚠️ " + (err.message || "Upload failed"), false);
  }
}

function renderPeople() {
  // Pending first, then active users, then deactivated ones.
  const rank = (p) => (p.deactivated_at ? 2 : p.status === "approved" ? 1 : 0);
  const people = state.profiles.slice().sort((a, b) =>
    rank(a) - rank(b)
    || String(a.full_name || a.email).localeCompare(String(b.full_name || b.email)));
  const rows = people.map((p) => {
    const rec = recordForUser(p);
    const reg = ROLE_REGISTRY[p.role];
    const recCell = rec
      ? `<strong>${esc(recordLabel(p.role, rec))}</strong><div class="muted tiny">${esc(reg.noun)}</div>`
      : `<span class="pill rejected">Needs a ${esc(reg ? reg.noun : "registry")} record</span>`;
    const units = unitsFromRecord(p);
    const unitCell = units.length
      ? units.map((id) => unitLinkChip(id)).join(" ")
      : `<span class="muted tiny">${["gardener", "service_provider"].includes(p.role) ? "not unit-linked" : "—"}</span>`;
    return `<tr>
      <td>${esc(realName(p) || "—")}${p.id === me.id ? ' <span class="muted tiny">(you)</span>' : ""}<div class="muted tiny">${esc(p.email)}</div></td>
      <td><span class="role-chip ${p.role}">${esc(ROLE_LABEL[p.role] || p.role)}</span></td>
      <td>${recCell}</td>
      <td>${unitCell}</td>
      <td>${p.deactivated_at
        ? `<span class="pill rejected">Deactivated</span><div class="muted tiny">${fmtDay(p.deactivated_at)}</div>`
        : `<span class="pill ${p.status}">${p.status}</span>`}</td>
      <td style="white-space:nowrap">${state.lastLogin && state.lastLogin[p.id]
        ? fmtDateTimeFull(state.lastLogin[p.id]) : '<span class="muted tiny">never</span>'}
        <button class="icon-btn" data-user-activity="${p.id}" title="View this user's activity" aria-label="View this user's activity">📜</button></td>
      <td style="text-align:right;white-space:nowrap">
        ${p.deactivated_at
          ? `<button class="icon-btn" data-user-reactivate="${p.id}" title="Reactivate user" aria-label="Reactivate user">♻️</button>`
          : `${rec && p.status === "approved"
            ? `<button class="icon-btn" data-user-link="${p.id}" title="Edit user" aria-label="Edit user">✏️</button>`
            : `<button class="btn primary small" data-user-link="${p.id}">${p.status !== "approved" ? "Approve & link" : "Link record"}</button>`}
        ${p.id !== me.id ? `<button class="icon-btn" data-user-deactivate="${p.id}" title="Deactivate user" aria-label="Deactivate user">🚫</button>` : ""}`}
      </td>
    </tr>`;
  }).join("");

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>👥 Users &amp; approvals</h2><button class="btn primary small" data-user-add>+ Add user</button></div>
      <p class="muted tiny">Each user is linked to one registry record that matches their role. Their units come from that record — to change a user's units, edit the record. Add the person to the right registry first, then link them here or use + Add user. A deactivated user can no longer sign in or use the system.</p>
      <div class="table-wrap"><table><thead><tr>
        <th>User</th><th>Role</th><th>Registry record</th><th>Units (from record)</th><th>Status</th><th>Last log in</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="7" class="empty">No one yet.</td></tr>`}</tbody></table></div>
    </div>`;
}

/* ---------- User activity log (trustee) ----------
   For now only log-ins are recorded (by a database trigger, migration 26). */
const ACTIVITY_LABEL = { login: "Logged in" };
let activityFilter = null;     // { from: "yyyy-mm-dd", to: "yyyy-mm-dd", user: "" }
let activityPreset = false;    // true when opened from a user's row on the Users screen

function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Default: the last 7 days (today and the 6 days before).
function defaultActivityFilter(user = "") {
  const today = new Date();
  const from = new Date(today); from.setDate(today.getDate() - 6);
  return { from: isoDay(from), to: isoDay(today), user };
}
// Local midnight at the start of a yyyy-mm-dd day.
function dayStart(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function fmtDateTimeFull(ts) {
  return new Date(ts).toLocaleString(undefined,
    { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function openUserActivity(userId) {
  activityFilter = defaultActivityFilter(userId);
  activityPreset = true;
  showView("activity");
}

function renderActivity() {
  if (!activityPreset || !activityFilter) activityFilter = defaultActivityFilter();
  activityPreset = false;
  const f = activityFilter;
  const users = state.profiles.slice().sort((a, b) =>
    String(a.full_name || a.email).localeCompare(String(b.full_name || b.email)));
  const userOpts = `<option value="">All users</option>` + users.map((p) =>
    `<option value="${p.id}" ${f.user === p.id ? "selected" : ""}>${esc(p.full_name || p.email)}${realName(p) ? " · " + esc(p.email) : ""}${p.deactivated_at ? " (deactivated)" : ""}</option>`).join("");

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>📜 User activity</h2>
        <span class="hint">Latest first</span></div>
      <div class="filters">
        <label>Date from <input type="date" id="act-from" value="${esc(f.from)}" /></label>
        <label>Date to <input type="date" id="act-to" value="${esc(f.to)}" /></label>
        <label>User <select id="act-user">${userOpts}</select></label>
      </div>
      <div id="act-list"><div class="empty">Loading…</div></div>
    </div>`;

  const onChange = () => {
    activityFilter = { from: $("#act-from").value, to: $("#act-to").value, user: $("#act-user").value };
    loadActivityList();
  };
  ["#act-from", "#act-to", "#act-user"].forEach((s) => $(s).addEventListener("change", onChange));
  loadActivityList();
}

async function loadActivityList() {
  const f = activityFilter;
  const box = $("#act-list");
  if (f.from && f.to && f.from > f.to) {
    box.innerHTML = `<div class="empty">"Date from" is after "Date to".</div>`;
    return;
  }
  let q = sb.from("user_activity").select("*").order("occurred_at", { ascending: false }).limit(2000);
  if (f.from) q = q.gte("occurred_at", dayStart(f.from).toISOString());
  if (f.to) { const end = dayStart(f.to); end.setDate(end.getDate() + 1); q = q.lt("occurred_at", end.toISOString()); }
  if (f.user) q = q.eq("profile_id", f.user);
  const { data, error } = await q;
  if (activityFilter !== f || !$("#act-list")) return; // filters changed while loading
  if (error) {
    box.innerHTML = `<div class="empty">⚠️ ${esc(/user_activity/.test(error.message)
      ? "The activity log isn't set up yet — run 26_user_activity_log.sql (see SETUP.md)." : error.message)}</div>`;
    return;
  }
  const rows = (data || []).map((a) => {
    const p = state.profiles.find((x) => x.id === a.profile_id);
    return `<tr>
      <td style="white-space:nowrap">${fmtDateTimeFull(a.occurred_at)}</td>
      <td>${esc(p ? (p.full_name || p.email) : "(unknown user)")}${p && realName(p) ? `<div class="muted tiny">${esc(p.email)}</div>` : ""}</td>
      <td>${esc(ACTIVITY_LABEL[a.activity] || a.activity)}</td>
    </tr>`;
  }).join("");
  box.innerHTML = `
    <p class="muted tiny">${(data || []).length} ${(data || []).length === 1 ? "entry" : "entries"}${(data || []).length === 2000 ? " (showing the latest 2000 — narrow the dates to see older ones)" : ""}</p>
    <div class="table-wrap"><table><thead><tr>
      <th>When</th><th>User</th><th>Activity</th>
    </tr></thead><tbody>${rows || `<tr><td colspan="3" class="empty">No activity in this period.</td></tr>`}</tbody></table></div>`;
}

/* ---------- Link a user to their registry record (role + record) ---------- */
let userLinkCtx = { userId: null };

function openUserLinkModal(userId) {
  const p = state.profiles.find((x) => x.id === userId);
  if (!p) return;
  userLinkCtx = { userId };
  $("#userlink-email").value = p.email || "";
  const curRec = recordForUser(p);
  $("#userlink-name").value = realName(p) || (curRec ? recordLabel(p.role, curRec) : "");
  $("#userlink-role").innerHTML = ROLE_ORDER.map((r) =>
    `<option value="${r}" ${p.role === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("");
  $("#userlink-msg").textContent = "";
  fillUserLinkRecords();
  $("#userlink-modal").classList.add("active");
}

function fillUserLinkRecords() {
  const p = state.profiles.find((x) => x.id === userLinkCtx.userId);
  const role = $("#userlink-role").value;
  const recs = linkableRecords(role, p.id);
  const current = recordForUser({ ...p, role });
  const reg = ROLE_REGISTRY[role];
  $("#userlink-record").innerHTML = `<option value="">— choose the ${esc(reg.noun)} —</option>` +
    recs.map((r) => {
      const hint = recordHint(role, r);
      return `<option value="${r.id}" ${current && current.id === r.id ? "selected" : ""}>${esc(recordLabel(role, r))}${hint ? " · " + esc(hint) : ""}</option>`;
    }).join("");
  $("#userlink-none").hidden = recs.length > 0;
  $("#userlink-none-text").textContent =
    `There is no unlinked ${reg.noun} record yet. Add the person to the ${reg.noun} registry first.`;
  $("#userlink-goto").dataset.view = reg.view;
  if (role !== p.role) {
    setMsg("userlink-msg", `Changing role from ${ROLE_LABEL[p.role] || p.role} to ${ROLE_LABEL[role]} will unlink their current record.`, true);
  } else {
    $("#userlink-msg").textContent = "";
  }
}

$("#userlink-role").addEventListener("change", fillUserLinkRecords);
$("#userlink-record").addEventListener("change", () => {
  const role = $("#userlink-role").value;
  const rec = (ROLE_REGISTRY[role].list() || []).find((r) => r.id === $("#userlink-record").value);
  if (rec && !$("#userlink-name").value.trim()) $("#userlink-name").value = recordLabel(role, rec);
});

$("#userlink-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const role = $("#userlink-role").value;
  const recordId = $("#userlink-record").value;
  if (!recordId) {
    setMsg("userlink-msg", `⚠️ Choose the ${ROLE_REGISTRY[role].noun} record to link this user to.`, false);
    return;
  }
  const p = state.profiles.find((x) => x.id === userLinkCtx.userId);
  const name = $("#userlink-name").value.trim();
  if (!name) { setMsg("userlink-msg", "⚠️ Please enter the user's full name.", false); return; }
  const email = $("#userlink-email").value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) { setMsg("userlink-msg", "\u26a0\ufe0f Please enter a valid email address.", false); return; }
  if (email !== String(p.email || "").toLowerCase()) {
    // The sign-in email lives in Supabase Auth, so this goes via the Edge Function.
    setMsg("userlink-msg", "Changing the email\u2026", true);
    const res = await manageUsers({ action: "update_email", user_id: p.id, email });
    if (res.error) { setMsg("userlink-msg", "\u26a0\ufe0f " + res.error, false); return; }
  }
  if (name !== (p.full_name || "")) {
    const { error: nameErr } = await sb.from("profiles").update({ full_name: name }).eq("id", p.id);
    if (nameErr) { setMsg("userlink-msg", "⚠️ " + nameErr.message, false); return; }
  }
  const { error } = await sb.rpc("link_user_to_record", {
    p_user: userLinkCtx.userId, p_role: role, p_record: recordId,
  });
  if (error) { setMsg("userlink-msg", "⚠️ " + error.message, false); return; }
  closeOverlays();
  await loadData();
  renderPeople();
});

/* ---------- Add a user (trustee) — via the manage-users Edge Function ---------- */
// The function holds the admin rights needed to create a login; the app never does.
async function manageUsers(payload) {
  try {
    const { data, error } = await sb.functions.invoke("manage-users", { body: payload });
    if (error) {
      return { error: /not found|404|Failed to send/i.test(error.message || "")
        ? "The manage-users function isn't deployed yet (see SETUP.md)." : error.message };
    }
    return data || { error: "No response from the server." };
  } catch (e) {
    return { error: "Could not reach the server: " + (e.message || e) };
  }
}

function openAddUserModal() {
  $("#adduser-form").reset();
  $("#adduser-role").innerHTML = ROLE_ORDER.map((r) =>
    `<option value="${r}" ${r === "owner" ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("");
  $("#adduser-msg").textContent = "";
  fillAddUserRecords();
  $("#adduser-modal").classList.add("active");
}

function fillAddUserRecords() {
  const role = $("#adduser-role").value;
  const reg = ROLE_REGISTRY[role];
  const recs = linkableRecords(role, null);   // only records nobody is linked to yet
  $("#adduser-record").innerHTML = `<option value="">— choose the ${esc(reg.noun)} —</option>` +
    recs.map((r) => {
      const hint = recordHint(role, r);
      return `<option value="${r.id}">${esc(recordLabel(role, r))}${hint ? " · " + esc(hint) : ""}</option>`;
    }).join("");
  $("#adduser-none").hidden = recs.length > 0;
  $("#adduser-none-text").textContent =
    `There is no unlinked ${reg.noun} record yet. Add the person to the ${reg.noun} registry first.`;
  $("#adduser-goto").dataset.view = reg.view;
}

// Picking a record pre-fills name and email (only into empty boxes).
function prefillAddUserFromRecord() {
  const role = $("#adduser-role").value;
  const rec = (ROLE_REGISTRY[role].list() || []).find((r) => r.id === $("#adduser-record").value);
  if (!rec) return;
  if (!$("#adduser-name").value.trim()) $("#adduser-name").value = recordLabel(role, rec);
  if (!$("#adduser-email").value.trim() && rec.email) $("#adduser-email").value = rec.email;
}

$("#adduser-role").addEventListener("change", fillAddUserRecords);
$("#adduser-record").addEventListener("change", prefillAddUserFromRecord);

$("#adduser-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    action: "create",
    role: $("#adduser-role").value,
    record_id: $("#adduser-record").value,
    full_name: $("#adduser-name").value.trim(),
    email: $("#adduser-email").value.trim(),
    password: $("#adduser-password").value,
  };
  if (!payload.record_id) { setMsg("adduser-msg", "⚠️ Choose the registry record for this user.", false); return; }
  if (!/^\S+@\S+\.\S+$/.test(payload.email)) { setMsg("adduser-msg", "⚠️ Please enter a valid email address.", false); return; }
  if (payload.password.length < 6) { setMsg("adduser-msg", "⚠️ The password must be at least 6 characters.", false); return; }
  const btn = $("#adduser-save"); btn.disabled = true;
  setMsg("adduser-msg", "Creating the user…", true);
  const res = await manageUsers(payload);
  btn.disabled = false;
  if (res.error) { setMsg("adduser-msg", "⚠️ " + res.error, false); return; }
  closeOverlays();
  await loadData();
  renderPeople();
});

/* ---------- Deactivate / reactivate a user (in-app confirmation) ---------- */
let userActiveCtx = { userId: null, action: null };

function openUserActiveModal(userId, action) {
  const p = state.profiles.find((x) => x.id === userId);
  if (!p) return;
  userActiveCtx = { userId, action };
  const who = esc(p.full_name || p.email);
  const off = action === "deactivate";
  $("#useractive-title").textContent = off ? "Deactivate user" : "Reactivate user";
  $("#useractive-text").innerHTML = off
    ? `<strong>${who}</strong> will no longer be able to sign in or use the system in any way. Their registry record and history are kept, and you can reactivate them later.`
    : `<strong>${who}</strong> will be able to sign in and use the system again with their existing role and record.`;
  $("#useractive-confirm").textContent = off ? "Deactivate" : "Reactivate";
  $("#useractive-confirm").className = off ? "btn danger" : "btn primary";
  $("#useractive-msg").textContent = "";
  $("#useractive-modal").classList.add("active");
}

$("#useractive-confirm").addEventListener("click", async () => {
  const btn = $("#useractive-confirm"); btn.disabled = true;
  setMsg("useractive-msg", "Saving…", true);
  const res = await manageUsers({ action: userActiveCtx.action, user_id: userActiveCtx.userId });
  btn.disabled = false;
  if (res.error) { setMsg("useractive-msg", "⚠️ " + res.error, false); return; }
  closeOverlays();
  await loadData();
  renderPeople();
});

/* ---------- Users <-> registry records ----------
   A user's role decides which registry they belong to; they are linked to
   exactly one record there (record.profile_id = user id). */
const ROLE_REGISTRY = {
  trustee:          { list: () => state.registry.trustees,  noun: "trustee",          view: "reg-trustees" },
  owner:            { list: () => state.owners,             noun: "owner",            view: "owners" },
  tenant:           { list: () => state.tenants,            noun: "tenant",           view: "tenants" },
  occupant:         { list: () => state.occupants,          noun: "occupant",         view: "occupants" },
  gardener:         { list: () => state.registry.gardeners, noun: "gardener",         view: "reg-gardeners" },
  service_provider: { list: () => state.registry.providers, noun: "service provider", view: "reg-providers" },
};
const ROLE_ORDER = ["trustee", "owner", "tenant", "occupant", "gardener", "service_provider"];

// The registry record linked to this user for their current role (or null).
function recordForUser(p) {
  const reg = ROLE_REGISTRY[p.role];
  return reg ? (reg.list() || []).find((r) => r.profile_id === p.id) || null : null;
}
// Readable name for any registry record.
function recordLabel(role, r) {
  if (!r) return "—";
  if (role === "service_provider") return r.kind === "company" ? (r.company_name || "—") : fullName(r);
  return fullName(r);
}
// Extra context shown in the record picker (unit numbers etc.).
function recordHint(role, r) {
  if (role === "owner") {
    const u = ownerLinks(r.id).filter((l) => l.active).map((l) => unitNum(l.unit_id));
    return u.length ? "unit " + u.join(", ") : "no units";
  }
  if (["tenant", "occupant", "trustee"].includes(role)) return r.unit_id ? "unit " + unitNum(r.unit_id) : "";
  return "";
}
// Units a user is linked to, worked out from their registry record (read-only).
function unitsFromRecord(p) {
  const r = recordForUser(p);
  if (!r) return [];
  if (p.role === "owner") return ownerLinks(r.id).filter((l) => l.active).map((l) => l.unit_id);
  if (["trustee", "tenant", "occupant"].includes(p.role)) return r.unit_id ? [r.unit_id] : [];
  return []; // gardeners and service providers are not linked to units
}
// Records a user may be linked to: unlinked ones, plus their own current one.
function linkableRecords(role, userId) {
  return ((ROLE_REGISTRY[role] && ROLE_REGISTRY[role].list()) || [])
    .filter((r) => !r.profile_id || r.profile_id === userId)
    .sort((a, b) => recordLabel(role, a).localeCompare(recordLabel(role, b)));
}
// Which user (if any) is linked to this registry record.
function userForRecord(r) {
  return r && r.profile_id ? state.profiles.find((p) => p.id === r.profile_id) || { id: r.profile_id } : null;
}
// "Also a user" badge for registry screens.
function userBadge(r) {
  const u = userForRecord(r);
  if (!u) return "";
  const who = u.email ? ` (${esc(u.email)})` : "";
  return `<span class="user-badge" title="Has a login${who}">🔐 user</span>`;
}

/* ---------- Reusable bits ---------- */
function statCard(num, label, cls) {
  return `<div class="stat-card ${cls}"><div class="num">${num}</div><div class="label">${label}</div></div>`;
}
function ticketTypeName(id) {
  return state.ticketTypes.find((t) => t.id === id)?.name || "—";
}
// Where a ticket is about: a unit, or a communal entity.
function ticketTargetLabel(t) {
  if (t.unit_id) return "Unit " + unitNum(t.unit_id);
  if (t.communal_area_id) {
    const a = state.areas.find((x) => x.id === t.communal_area_id);
    return a ? (a.name) : "Communal entity";
  }
  return "General";
}
function ticketCard(t) {
  const assigned = t.assigned_role ? `· to <strong>${ROLE_LABEL[t.assigned_role] || t.assigned_role}</strong>` : "";
  return `<div class="request-card" data-open-ticket="${t.id}">
    <div class="rc-top">
      <div><div class="rc-title">${esc(t.heading)}</div>
        <div class="rc-meta"><strong>${esc(ticketTargetLabel(t))}</strong>
          · <span class="rc-cat">${esc(ticketTypeName(t.type_id))}</span> ${assigned}</div></div>
      ${statusPill(t.status)}
    </div></div>`;
}
// Trustees, residents (owner/tenant/occupant), and assignees can log tickets.
function canCreateTicket() {
  return isTrustee() || isResident() || isAssignee();
}

/* ---------- Ticket detail ---------- */
let currentTicketId = null;

async function openTicket(id) {
  currentTicketId = id;
  const t = state.tickets.find((x) => x.id === id);
  if (!t) return;
  const photos = state.ticketPhotos.filter((p) => p.ticket_id === id);
  const isLogger = t.logged_by === me.id;
  const isDraft = t.status === "create";
  const loggerCanEdit = isLogger && isDraft;
  const canEditDetails = isTrustee() || loggerCanEdit;

  // Trustee-only status transitions for Complete/Cancelled/Parked (icons).
  const STATUS_ICON = { busy: "▶️", complete: "✅", cancelled: "❌", parked: "⏸️" };
  // Which status a trustee can move the ticket to from here.
  //   Parked    -> Busy or Cancelled (not straight to Complete)
  //   Cancelled -> Busy only
  //   Complete  -> Busy, Cancelled or Parked
  //   otherwise -> Complete, Cancelled or Parked
  const NEXT_STATUSES = { parked: ["busy", "cancelled"], cancelled: ["busy"], complete: ["busy", "cancelled", "parked"] };
  const trusteeStatusBtns = isTrustee() && !isDraft
    ? (NEXT_STATUSES[t.status] || ["complete", "cancelled", "parked"])
        .map((s) => {
          const tip = `Mark ${TICKET_STATUS_LABEL[s]}` + (statusDesc(s) ? ` — ${statusDesc(s)}` : "");
          return `<button class="icon-btn ticket-act" data-ticket-status="${t.id}|${s}" title="${esc(tip)}" aria-label="${esc(tip)}">${STATUS_ICON[s]}</button>`;
        }).join("")
    : "";

  $("#detail-content").innerHTML = `
    <h3>${esc(t.heading)}</h3>
    ${statusPill(t.status)}
    <span class="rc-cat">${esc(ticketTypeName(t.type_id))}</span>
    ${statusDesc(t.status) ? `<p class="status-hint">ℹ️ ${esc(statusDesc(t.status))}</p>` : ""}
    <dl class="detail-grid">
      <dt>${t.communal_area_id ? "Communal entity" : t.unit_id ? "Unit" : "Relates to"}</dt><dd>${esc(ticketTargetLabel(t))}</dd>
      <dt>Logged by</dt><dd>${esc(loggerName(t))}${t.logged_by_role ? " (" + (ROLE_LABEL[t.logged_by_role] || t.logged_by_role) + ")" : ""}</dd>
      <dt>Logged</dt><dd>${fmtDate(t.created_at)}</dd>
      <dt>Assigned to</dt><dd>${t.assigned_role ? (ROLE_LABEL[t.assigned_role] || t.assigned_role) : "—"}</dd>
      ${isTrustee() && t.project_id ? `<dt>Project</dt><dd>${esc(projectName(t.project_id) || "—")}</dd>` : ""}
    </dl>
    <p>${esc(t.description) || "<em>No description.</em>"}</p>

    ${photos.length ? `<div class="photo-grid">${photos.map((p) =>
      `<figure class="photo-item"><a href="${publicUrl(p.storage_path)}" target="_blank" rel="noopener">
        <img src="${publicUrl(p.storage_path)}" loading="lazy" /></a>
        ${loggerCanEdit || isTrustee() ? `<button class="photo-del" data-del-ticket-photo="${p.id}">✕</button>` : ""}
      </figure>`).join("")}</div>` : ""}

    <div class="detail-actions">
      ${loggerCanEdit ? `
        <label class="icon-btn ticket-act upload-label" title="Add a photo" aria-label="Add a photo">📷<input type="file" accept="image/*" id="ticket-photo-input" hidden /></label>
        <button class="icon-btn ticket-act" data-edit-ticket="${t.id}" title="Edit" aria-label="Edit">✏️</button>
        <button class="icon-btn ticket-act ticket-send" data-submit-ticket="${t.id}" title="Submit &amp; send" aria-label="Submit &amp; send">📤</button>
        <button class="icon-btn ticket-act" data-delete-ticket="${t.id}" title="Delete" aria-label="Delete">🗑️</button>` : ""}
      ${isTrustee() && !isDraft ? `<button class="icon-btn ticket-act" data-edit-ticket="${t.id}" title="Edit details" aria-label="Edit details">✏️</button>` : ""}
      ${trusteeStatusBtns}
    </div>
    <p id="ticket-photo-msg" class="login-msg"></p>

    ${reassignPanel(t, isDraft)}

    <h4 style="margin:14px 0 0">Feedback</h4>
    ${feedbackComposer(t, isDraft)}
    <div id="feedback-thread"><p class="muted tiny">Loading…</p></div>`;

  $("#detail-modal").classList.add("active");
  const input = $("#ticket-photo-input");
  if (input) input.addEventListener("change", (e) => onTicketPhotoChosen(e, id));

  // Load + render the conversation (feedback is only meaningful once sent).
  await renderFeedbackThread(id);
}

// True if the current user holds the ticket's assigned role on its unit.
function iHoldAssignedRole(t) {
  if (!t.assigned_role) return false;
  if (t.assigned_role === "trustee") return isTrustee();
  if (t.assigned_role === "owner") return amOwnerOf(t.unit_id);
  if (t.assigned_role === "tenant") return amTenantOf(t.unit_id);
  if (t.assigned_role === "occupant") return amOccupantOf(t.unit_id);
  if (t.assigned_role === "gardener" || t.assigned_role === "service_provider")
    return me.role === t.assigned_role;
  return false;
}

// Reassign the ticket to another role (its own action, not part of feedback).
// Trustees always; otherwise whoever holds the role it's assigned to.
function reassignPanel(t, isDraft) {
  if (isDraft || ["complete", "cancelled"].includes(t.status)) return "";
  if (!(isTrustee() || iHoldAssignedRole(t))) return "";
  const opts = ROUTE_ROLES.filter((r) => r !== t.assigned_role)
    .map((r) => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join("");
  return `
    <div class="reassign-line">
      <strong>Reassign:</strong>
      <span>from <strong>${esc(ROLE_LABEL[t.assigned_role] || "—")}</strong> to</span>
      <select id="reassign-role" aria-label="Reassign to">${opts}</select>
      <button type="button" class="reassign-go" id="reassign-btn" data-reassign-ticket="${t.id}" title="Reassign now" aria-label="Reassign now">→</button>
    </div>
    <p id="reassign-msg" class="login-msg"></p>`;
}

function feedbackComposer(t, isDraft) {
  // No feedback while still a draft (not yet sent) or once closed.
  if (isDraft) return `<p class="muted tiny">Submit the ticket to start the conversation.</p>`;
  if (["complete", "cancelled"].includes(t.status)) {
    return `<p class="muted tiny">This ticket is ${TICKET_STATUS_LABEL[t.status].toLowerCase()}. ${isTrustee() ? "To add feedback, click ▶️ (Mark Busy) above to reopen it." : "No further feedback can be added."}</p>`;
  }
  // The photo sits inside the same box as the text: it belongs to this
  // feedback and is only uploaded when Post feedback is clicked.
  // Collapsed at first so the history is visible straight away.
  return `
    <button type="button" class="btn ghost small fb-open" id="fb-open">💬 Add feedback</button>
    <form id="feedback-form" class="feedback-form" hidden>
      <div class="fb-compose">
        <textarea id="feedback-body" rows="3" placeholder="Write your feedback…" required></textarea>
        <div class="fb-compose-bar">
          <label class="fb-attach" title="Attach a photo to this feedback">📎 Attach photo
            <input type="file" accept="image/*" id="feedback-photo-input" hidden /></label>
          <span id="feedback-photo-chip" class="fb-photo-chip" hidden>
            <img id="feedback-photo-thumb" alt="" />
            <span id="feedback-photo-name"></span>
            <button type="button" id="feedback-photo-clear" title="Remove photo" aria-label="Remove photo">✕</button>
          </span>
          <button type="button" class="btn ghost small fb-post" id="fb-cancel">Cancel</button>
          <button type="submit" class="btn primary small">Post feedback</button>
        </div>
      </div>
      <p class="muted tiny" style="margin:4px 0 0">A photo you attach is uploaded with this feedback when you click Post feedback.</p>
      <p id="feedback-msg" class="login-msg"></p>
    </form>
    <h5 class="fb-history-title">History <span class="muted tiny">(latest first)</span></h5>`;
}

async function renderFeedbackThread(ticketId) {
  const { data: fb } = await sb.from("ticket_feedback")
    .select("*").eq("ticket_id", ticketId).order("created_at", { ascending: false });
  const { data: fphotos } = await sb.from("feedback_photos")
    .select("*").in("feedback_id", (fb || []).map((f) => f.id).length ? (fb || []).map((f) => f.id) : ["00000000-0000-0000-0000-000000000000"]);
  const photosByFb = {};
  (fphotos || []).forEach((p) => { (photosByFb[p.feedback_id] ||= []).push(p); });

  const el = $("#feedback-thread");
  if (!el) return;
  if (!fb || !fb.length) {
    el.innerHTML = `<p class="muted tiny">No feedback yet.</p>`;
    return;
  }
  el.innerHTML = fb.map((f) => {
    const who = f.author_id === me.id ? "You" : authorName(f.author_id);
    const role = f.author_role ? (ROLE_LABEL[f.author_role] || f.author_role) : "";
    const imgs = (photosByFb[f.id] || []).map((p) =>
      `<a href="${publicUrl(p.storage_path)}" target="_blank" rel="noopener"><img src="${publicUrl(p.storage_path)}" class="fb-img" loading="lazy" /></a>`).join("");
    return `<div class="fb-item">
      <div class="fb-head"><strong>${esc(who)}</strong>${role ? ` <span class="muted tiny">· ${esc(role)}</span>` : ""}
        <span class="tl-time">${fmtDate(f.created_at)}</span></div>
      <div class="fb-body">${esc(f.body)}</div>
      ${imgs ? `<div class="fb-imgs">${imgs}</div>` : ""}
    </div>`;
  }).join("");
}

function authorName(id) {
  const p = state.profiles.find((x) => x.id === id);
  return p ? (p.full_name || p.email) : "User";
}

function loggerName(t) {
  const p = state.profiles.find((x) => x.id === t.logged_by);
  return p ? (p.full_name || p.email) : (t.logged_by === me.id ? "You" : "—");
}

async function submitTicket(id) {
  // Create -> Sent, assigned to Trustees.
  await sb.from("tickets").update({ status: "sent", assigned_role: "trustee" }).eq("id", id);
  await loadData();
  openTicket(id);
  refreshActiveView();
}

async function setTicketStatus(id, status) {
  await sb.from("tickets").update({ status }).eq("id", id);
  await loadData();
  openTicket(id);
  refreshActiveView();
}

let deletingTicketId = null;

function deleteTicket(id) {
  const t = state.tickets.find((x) => x.id === id);
  if (!t) return;
  deletingTicketId = id;
  $("#ticketdel-text").innerHTML = `<strong>${esc(t.heading)}</strong> (${esc(ticketTargetLabel(t))}) will be deleted for good, together with its feedback and photos. This can't be undone.`;
  $("#ticketdel-msg").textContent = "";
  $("#ticketdel-confirm").disabled = false;
  $("#ticketdel-modal").classList.add("active");
}

$("#ticketdel-cancel").addEventListener("click", () => $("#ticketdel-modal").classList.remove("active"));
$("#ticketdel-confirm").addEventListener("click", async () => {
  const id = deletingTicketId;
  const btn = $("#ticketdel-confirm"); btn.disabled = true;
  setMsg("ticketdel-msg", "Deleting…", true);
  // Collect photo files (ticket + feedback) before the rows are gone.
  const paths = state.ticketPhotos.filter((p) => p.ticket_id === id).map((p) => p.storage_path);
  const { data: fb } = await sb.from("ticket_feedback").select("id").eq("ticket_id", id);
  const fbIds = (fb || []).map((f) => f.id);
  if (fbIds.length) {
    const { data: fphotos } = await sb.from("feedback_photos").select("storage_path").in("feedback_id", fbIds);
    (fphotos || []).forEach((p) => paths.push(p.storage_path));
  }
  // Delete the ticket (feedback and photo records go with it).
  const { data, error } = await sb.from("tickets").delete().eq("id", id).select("id");
  if (error || !data || !data.length) {
    btn.disabled = false;
    setMsg("ticketdel-msg", "\u26a0\ufe0f " + (error ? error.message : "You're not allowed to delete this ticket."), false);
    return;
  }
  for (const p of paths) { try { await deleteFile(p); } catch (_) { /* leftover file is harmless */ } }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

async function onTicketPhotoChosen(e, ticketId) {
  const file = e.target.files[0];
  if (!file) return;
  setMsg("ticket-photo-msg", "Uploading…", true);
  try {
    const path = await uploadFile(file, `tickets/${ticketId}`);
    const { error } = await sb.from("ticket_photos").insert({
      ticket_id: ticketId, storage_path: path, uploaded_by: me.id,
    });
    if (error) { await deleteFile(path); throw error; }
    await loadData();
    openTicket(ticketId);
  } catch (err) {
    setMsg("ticket-photo-msg", "⚠️ " + (err.message || "Upload failed"), false);
  }
}

async function deleteTicketPhoto(photoId) {
  const photo = state.ticketPhotos.find((p) => p.id === photoId);
  if (!photo) return;
  await sb.from("ticket_photos").delete().eq("id", photoId);
  await deleteFile(photo.storage_path);
  await loadData();
  openTicket(photo.ticket_id);
}

/* ---------- Feedback conversation + routing + status automation ---------- */
// Show the chosen photo (thumbnail + name) inside the feedback box.
let feedbackThumbUrl = null;
function showFeedbackPhoto() {
  const input = $("#feedback-photo-input");
  const f = input && input.files[0];
  if (feedbackThumbUrl) { URL.revokeObjectURL(feedbackThumbUrl); feedbackThumbUrl = null; }
  $("#feedback-photo-chip").hidden = !f;
  if (f) {
    feedbackThumbUrl = URL.createObjectURL(f);
    $("#feedback-photo-thumb").src = feedbackThumbUrl;
    $("#feedback-photo-name").textContent = f.name;
  }
}
document.addEventListener("change", (e) => {
  if (e.target.id === "feedback-photo-input") showFeedbackPhoto();
});
document.addEventListener("click", async (e) => {
  // Open / close the feedback box.
  if (e.target.id === "fb-open") {
    $("#feedback-form").hidden = false;
    e.target.hidden = true;
    $("#feedback-body").focus();
  }
  if (e.target.id === "fb-cancel") {
    $("#feedback-form").reset();
    showFeedbackPhoto();
    $("#feedback-msg").textContent = "";
    $("#feedback-form").hidden = true;
    $("#fb-open").hidden = false;
  }
  if (e.target.id === "feedback-photo-clear") {
    $("#feedback-photo-input").value = "";
    showFeedbackPhoto();
  }
  if (e.target.id === "reassign-btn") {
    const id = e.target.dataset.reassignTicket;
    const role = $("#reassign-role").value;
    e.target.disabled = true;
    setMsg("reassign-msg", "Reassigning…", true);
    const { error } = await sb.rpc("reassign_ticket", { p_ticket: id, p_role: role });
    if (error) {
      e.target.disabled = false;
      setMsg("reassign-msg", "\u26a0\ufe0f " + (/reassign_ticket/.test(error.message)
        ? "Run supabase/33_ticket_reassign.sql first." : error.message), false);
      return;
    }
    await loadData();
    if (state.tickets.some((x) => x.id === id)) openTicket(id);
    else closeOverlays(); // you may no longer see it once it's with another role
    refreshActiveView();
  }
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "feedback-form") return;
  e.preventDefault();
  const t = state.tickets.find((x) => x.id === currentTicketId);
  if (!t) return;

  const body = $("#feedback-body").value.trim();
  if (!body) return;

  const file = $("#feedback-photo-input") ? $("#feedback-photo-input").files[0] : null;

  setMsg("feedback-msg", "Posting…", true);

  // 1) Insert the feedback entry.
  const { data: fb, error: fbErr } = await sb.from("ticket_feedback").insert({
    ticket_id: t.id, author_id: me.id, author_role: me.role, body,
  }).select().single();
  if (fbErr) { setMsg("feedback-msg", "⚠️ " + fbErr.message, false); return; }

  // 2) Optional evidence photo on the feedback.
  if (file) {
    try {
      const path = await uploadFile(file, `feedback/${t.id}`);
      await sb.from("feedback_photos").insert({ feedback_id: fb.id, storage_path: path });
    } catch (err) {
      setMsg("feedback-msg", "Feedback saved, but photo upload failed: " + (err.message || ""), false);
    }
  }

  // 3) If the poster holds the ticket, it becomes Busy (done in the database,
  //    so it also works for gardeners, service providers and residents).
  //    A Parked ticket stays Parked.
  if (iHoldAssignedRole(t) && ["sent", "waiting"].includes(t.status)) {
    await sb.rpc("mark_ticket_busy", { p_ticket: t.id });
  }

  await loadData();
  openTicket(t.id);       // re-render detail (thread + fresh status)
  refreshActiveView();     // refresh the list behind the modal
});

/* ---------- Ticket create / edit ---------- */
function openTicketModal(ticket) {
  closeOverlays(); // e.g. the ticket window when clicking its Edit button
  $("#ticket-modal-title").textContent = ticket ? "Edit ticket" : "Log a ticket";
  $("#ticket-id").value = ticket?.id || "";

  // Logged by (read-only) — the current user.
  $("#ticket-loggedby").value = me.full_name || me.email;

  // Type dropdown (active types).
  $("#ticket-type").innerHTML = state.ticketTypes.filter((tt) => tt.active || tt.id === ticket?.type_id)
    .map((tt) => `<option value="${tt.id}" ${ticket?.type_id === tt.id ? "selected" : ""}>${esc(tt.name)}</option>`).join("");

  // What it relates to: a unit, a communal entity, or neither. New tickets
  // start with nothing chosen, so the user has to pick.
  setRelates(!ticket ? ""
    : ticket.unit_id ? "unit" : ticket.communal_area_id ? "area" : "none");

  // Unit dropdown: ALL units for every role. Residents get their own unit
  // pre-selected (not gardeners/SPs, for whom it isn't a sensible default).
  const myUnits = isResident() ? [...myUnitIds()] : [];
  const defaultUnit = ticket ? ticket.unit_id : (myUnits.length ? myUnits[0] : "");
  $("#ticket-unit").innerHTML = `<option value="">— choose the unit —</option>` +
    state.units.map((u) => `<option value="${u.id}" ${defaultUnit === u.id ? "selected" : ""}>${esc(unitChoiceLabel(u))}</option>`).join("");

  // Communal entity type (filters the entity list) + entity (both optional).
  $("#ticket-areatype").innerHTML = `<option value="">— type —</option>` +
    areaTypeOptions(state.areaTypes.filter((t) => t.active), null);
  // If editing a communal-entity ticket, preselect its type.
  if (ticket?.communal_area_id) {
    const a = state.areas.find((x) => x.id === ticket.communal_area_id);
    if (a?.type_id) $("#ticket-areatype").value = a.type_id;
  }
  populateTicketAreas(ticket?.communal_area_id || "");
  showTicketRelates();

  // Project (trustees only, optional).
  $("#ticket-project-wrap").hidden = !isTrustee();
  if (isTrustee()) {
    $("#ticket-project").innerHTML = `<option value="">— none —</option>` +
      state.projects.map((p) => `<option value="${p.id}" ${ticket?.project_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  }

  $("#ticket-heading").value = ticket?.heading || "";
  $("#ticket-description").value = ticket?.description || "";
  $("#ticket-msg").textContent = "";
  $("#ticket-modal").classList.add("active");
}

// "Unit 01", "Unit 02", … for the unit dropdown.
function unitChoiceLabel(u) {
  const n = parseInt(u.number, 10);
  return "Unit " + (Number.isFinite(n) ? String(n).padStart(2, "0") : u.number);
}
// The "This ticket relates to" tiles (radio buttons).
function getRelates() {
  const r = document.querySelector('input[name="ticket-relates"]:checked');
  return r ? r.value : "";
}
function setRelates(v) {
  document.querySelectorAll('input[name="ticket-relates"]').forEach((i) => { i.checked = i.value === v; });
}
// Show only the part of the form that matches "This ticket relates to".
function showTicketRelates() {
  const r = getRelates();
  // Highlight the chosen tile (also for browsers without CSS :has).
  document.querySelectorAll(".relates-opt").forEach((l) =>
    l.classList.toggle("checked", !!l.querySelector("input:checked")));
  $("#ticket-unit-wrap").hidden = r !== "unit";
  $("#ticket-area-wrap").hidden = r !== "area";
}

// Fill the communal-entity dropdown based on the chosen type.
function populateTicketAreas(selectedId) {
  const typeId = $("#ticket-areatype").value;
  const areas = state.areas.filter((a) => !typeId || a.type_id === typeId);
  $("#ticket-area").innerHTML = `<option value="">— none —</option>` +
    areas.map((a) => `<option value="${a.id}" ${selectedId === a.id ? "selected" : ""}>${esc(a.code)} — ${esc(a.name)}</option>`).join("");
}

$("#ticket-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#ticket-id").value;
  const relates = getRelates();
  // Only the chosen kind is saved, so a ticket never has both.
  const unitId = relates === "unit" ? ($("#ticket-unit").value || null) : null;
  const areaId = relates === "area" ? ($("#ticket-area").value || null) : null;

  if (!relates) {
    setMsg("ticket-msg", "\u26a0\ufe0f Please choose what this ticket relates to.", false);
    return;
  }
  if (relates === "unit" && !unitId) {
    setMsg("ticket-msg", "\u26a0\ufe0f Please choose the unit.", false);
    return;
  }
  if (relates === "area" && !areaId) {
    setMsg("ticket-msg", "\u26a0\ufe0f Please choose the communal entity.", false);
    return;
  }

  const payload = {
    unit_id: unitId,
    communal_area_id: areaId,
    type_id: $("#ticket-type").value || null,
    heading: $("#ticket-heading").value.trim(),
    description: $("#ticket-description").value.trim(),
  };
  if (isTrustee()) payload.project_id = $("#ticket-project").value || null;
  let savedId = id;
  if (id) {
    const { error } = await sb.from("tickets").update(payload).eq("id", id);
    if (error) { setMsg("ticket-msg", "⚠️ " + error.message, false); return; }
  } else {
    const { data, error } = await sb.from("tickets").insert({
      ...payload, logged_by: me.id, logged_by_role: me.role, status: "create",
    }).select().single();
    if (error) { setMsg("ticket-msg", "⚠️ " + error.message, false); return; }
    savedId = data.id;
  }
  closeOverlays();
  await loadData();
  openTicket(savedId); // open so logger can add photos / submit
});

$("#unit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#unit-id").value;
  const num = Number($("#unit-number").value);
  if (!Number.isInteger(num) || num < 1) {
    setMsg("unit-msg", "⚠️ The unit number must be a whole number, 1 or higher.", false);
    return;
  }
  const payload = {
    number: num,
    notes: $("#unit-notes").value.trim(),
    layout_id: $("#unit-layout").value || null,
  };
  const { error } = id
    ? await sb.from("units").update(payload).eq("id", id)
    : await sb.from("units").insert(payload);
  if (error) {
    setMsg("unit-msg", error.message.includes("duplicate")
      ? "A unit with that number already exists." : "⚠️ " + error.message, false);
    return;
  }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Trustee: approvals / roles / linking ---------- */
/* ---------- Delegated events ---------- */
document.addEventListener("click", async (e) => {
  const t = e.target;
  // Nav/view buttons contain inner <span>s, so match the nearest [data-view].
  const viewBtn = t.closest("[data-view]");
  if (viewBtn) showView(viewBtn.dataset.view);
  if (t.hasAttribute("data-close")) closeOverlays();
  if (t.hasAttribute("data-new-ticket")) openTicketModal(null);

  const tcard = t.closest("[data-open-ticket]");
  if (tcard) openTicket(tcard.dataset.openTicket);

  if (t.dataset.editTicket) openTicketModal(state.tickets.find((x) => x.id === t.dataset.editTicket));
  if (t.dataset.submitTicket) submitTicket(t.dataset.submitTicket);
  if (t.dataset.deleteTicket) deleteTicket(t.dataset.deleteTicket);
  const delRow = t.closest("[data-del-ticket-row]");
  if (delRow) deleteTicket(delRow.dataset.delTicketRow);
  if (t.dataset.ticketStatus) {
    const [id, s] = t.dataset.ticketStatus.split("|");
    setTicketStatus(id, s);
  }
  if (t.dataset.delTicketPhoto) deleteTicketPhoto(t.dataset.delTicketPhoto);

  const ulBtn = t.closest("[data-user-link]");
  if (ulBtn) openUserLinkModal(ulBtn.dataset.userLink);
  if (t.closest("[data-user-add]")) openAddUserModal();
  const uaBtn = t.closest("[data-user-activity]");
  if (uaBtn) openUserActivity(uaBtn.dataset.userActivity);
  const udBtn = t.closest("[data-user-deactivate]");
  if (udBtn) openUserActiveModal(udBtn.dataset.userDeactivate, "deactivate");
  const urBtn = t.closest("[data-user-reactivate]");
  if (urBtn) openUserActiveModal(urBtn.dataset.userReactivate, "reactivate");
  if (t.dataset.editUnit) openUnitModal(state.units.find((u) => u.id === t.dataset.editUnit));
  if (t.dataset.editLayout) openLayoutModal(state.layouts.find((l) => l.id === t.dataset.editLayout));

  // Unit detail (owners & tenants)
  if (t.dataset.openUnit) renderUnitDetail(t.dataset.openUnit);
  if (t.dataset.backView) showView(t.dataset.backView);
  if (t.hasAttribute("data-add-owner")) openOwnerModal(null, currentUnitId);
  if (t.hasAttribute("data-add-owner-global")) openOwnerModal(null, null);
  if (t.hasAttribute("data-link-owner")) openLinkOwnerModal();
  if (t.dataset.editOwnerGlobal) openOwnerModal(state.owners.find((o) => o.id === t.dataset.editOwnerGlobal), null);
  if (t.hasAttribute("data-ou-remove")) t.closest(".ou-row").remove();
  if (t.hasAttribute("data-add-tenant")) openTenantModal(null);
  if (t.dataset.editOwner) openOwnerModal(state.owners.find((o) => o.id === t.dataset.editOwner), currentUnitId);
  if (t.dataset.editTenant) openTenantModal(state.tenants.find((tn) => tn.id === t.dataset.editTenant));
  if (t.hasAttribute("data-add-occupant")) openOccupantModal(null);
  if (t.dataset.editOccupant) openOccupantModal(state.occupants.find((oc) => oc.id === t.dataset.editOccupant));
  if (t.hasAttribute("data-add-pet")) openPetModal(null);
  if (t.dataset.editPet) openPetModal(state.pets.find((p) => p.id === t.dataset.editPet));
  if (t.dataset.delUnitPhoto) deleteUnitPhoto(t.dataset.delUnitPhoto);
  if (t.dataset.editType) openTypeModal(state.ticketTypes.find((x) => x.id === t.dataset.editType));
  if (t.dataset.editStatus) openStatusModal(t.dataset.editStatus);

  // Communal entities
  if (t.dataset.editAreagroup) openAreaGroupModal(state.areaGroups.find((x) => x.id === t.dataset.editAreagroup));
  if (t.dataset.editAreatype) openAreaTypeModal(state.areaTypes.find((x) => x.id === t.dataset.editAreatype));
  if (t.dataset.editArea) openAreaModal(state.areas.find((x) => x.id === t.dataset.editArea));
  if (t.dataset.openArea) renderAreaDetail(t.dataset.openArea);
  // Projects
  if (t.dataset.editProjstatus) openProjectStatusModal(state.projectStatuses.find((x) => x.id === t.dataset.editProjstatus));
  if (t.dataset.openProject) renderProjectDetail(t.dataset.openProject);
  if (t.dataset.editProject) openProjectModal(state.projects.find((x) => x.id === t.dataset.editProject));
  if (t.dataset.unlinkProjectTicket) setTicketProject(t.dataset.unlinkProjectTicket, null);
  // 10 Year Plan
  if (t.dataset.editGtask) openGardenTaskModal(state.gardenTasks.find((x) => x.id === t.dataset.editGtask));
  if (t.dataset.editPlanstatus) openPlanStatusModal(state.planStatuses.find((x) => x.id === t.dataset.editPlanstatus));
  const planCard = t.closest("[data-edit-plan]");
  if (planCard) openPlanModal(state.planItems.find((x) => x.id === planCard.dataset.editPlan));
  if (t.dataset.addPlan !== undefined) {
    const [group, year] = t.dataset.addPlan.split("|");
    openPlanModal(null, { group, year: Number(year) });
  }
  if (t.dataset.delAreaPhoto) deleteAreaPhoto(t.dataset.delAreaPhoto);

  // Trustee registries (Trustees / Gardeners / Service providers)
  const regAdd = t.closest("[data-reg-add]");
  if (regAdd) openRegModal(regAdd.dataset.regAdd, null);
  const regEdit = t.closest("[data-reg-edit]");
  if (regEdit) openRegModal(regEdit.dataset.regEdit, regEdit.dataset.id);

  // Ask-the-Rules: select a historical question
  const histBtn = t.closest("[data-ask-select]");
  if (histBtn) { askSelectedId = histBtn.dataset.askSelect; renderAskHistory(); renderAskAnswer(); }

  // Ask-the-Rules: share buttons
  if (t.dataset.shareCopy) {
    const item = askHistory.find((q) => q.id === t.dataset.shareCopy);
    if (item) copyShare(item, t);
  }
  if (t.dataset.shareEmail) {
    const item = askHistory.find((q) => q.id === t.dataset.shareEmail);
    if (item) shareViaEmail(item);
  }

  // AI engagement admin: expand/collapse an answer
  const aiCard = t.closest("[data-ai-expand]");
  if (aiCard) {
    const ans = $("#ai-ans-" + aiCard.dataset.aiExpand);
    if (ans) ans.hidden = !ans.hidden;
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "tenant-lease") toggleAgencyFields();
  if (e.target.classList && e.target.classList.contains("ou-active")) {
    // Show "Left on" only when the unit link is marked not active.
    e.target.closest(".ou-row").querySelector(".ou-left-wrap").hidden = e.target.checked;
  }
  if (e.target.id === "tenant-active") toggleLeftOn("tenant");
  if (e.target.id === "occupant-active") toggleLeftOn("occupant");
  if (e.target.id === "pet-type") togglePetOther();
  if (e.target.id === "ticket-areatype") populateTicketAreas("");
  if (e.target.name === "ticket-relates") showTicketRelates();
});
$$(".modal-overlay").forEach((ov) =>
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("active"); }));

function closeOverlays() { $$(".modal-overlay").forEach((o) => o.classList.remove("active")); }
function refreshActiveView() {
  const active = $(".nav-btn.active")?.dataset.view || "dashboard";
  showView(active);
}

/* ---------- Utils ---------- */
function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined,
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
