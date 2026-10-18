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
// Which role each ticket can be assigned/routed to.
const ROUTE_ROLES = ["trustee", "owner", "tenant", "occupant", "gardener", "service_provider"];

let sb = null;        // supabase client
let me = null;        // current profile row
let state = { units: [], requests: [], profiles: [], layouts: [], owners: [], tenants: [], occupants: [], pets: [], unitPhotos: [], members: [], tickets: [], ticketTypes: [], ticketPhotos: [], conductDoc: null, areaTypes: [], areas: [], areaPhotos: [] };
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

  if (me.status !== "approved") return showPending();
  return showApp();
}

/* ---------- Login ---------- */
function hideAll() {
  $("#view-login").hidden = true;
  $("#view-pending").hidden = true;
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
function myUnitIds() {
  // Units this user can access.
  const ids = new Set();
  if (isResident()) {
    // Owners/tenants/occupants: via unit_members or a record (profile_id).
    state.members.filter((m) => m.profile_id === me.id).forEach((m) => ids.add(m.unit_id));
    state.owners.filter((o) => o.profile_id === me.id && o.active).forEach((o) => ids.add(o.unit_id));
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
  if (me.role !== "owner" && me.role !== "trustee") {
    // allow owner role check regardless, but typical owners have role 'owner'
  }
  return state.owners.some((o) => o.unit_id === unitId && o.profile_id === me.id && o.active)
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
  // Gardeners / service providers care about jobs, not units -> land on Tickets.
  if (isAssignee()) return "tickets";
  return myUnitIds().size ? "myunits" : "dashboard";
}

// Navigation is organised into groups (main menus) with items (sub-menus).
function navGroups() {
  const groups = [
    { items: [
      { id: "dashboard", label: "Dashboard", ico: "🏠" },
      { id: "tickets", label: "Tickets", ico: "🎟️" },
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
        { id: "areas", label: "Communal areas", ico: "🌳" },
      ],
    });
    groups.push({
      title: "Admin",
      items: [
        { id: "layouts", label: "Layouts", ico: "📐" },
        { id: "areatypes", label: "Communal area types", ico: "🏷️" },
        { id: "tickettypes", label: "Ticket types", ico: "🏷️" },
        { id: "aiengagement", label: "AI engagement", ico: "✨" },
        { id: "users", label: "Users", ico: "👥" },
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
  const [units, tickets, profiles, layouts, owners, tenants, occupants, pets, unitPhotos, members, ticketTypes, ticketPhotos, conductDocs, areaTypes, areas, areaPhotos] = await Promise.all([
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
    sb.from("ticket_types").select("*").order("sort_order"),
    sb.from("ticket_photos").select("*").order("created_at"),
    sb.from("documents").select("*").eq("kind", "conduct_rules").order("created_at", { ascending: false }).limit(1),
    sb.from("communal_area_types").select("*").order("sort_order"),
    sb.from("communal_areas").select("*").order("code"),
    sb.from("communal_area_photos").select("*").order("created_at"),
  ]);
  state.units = units.data || [];
  state.tickets = tickets.data || [];
  state.profiles = profiles.data || [];
  state.layouts = layouts.data || [];
  state.owners = owners.data || [];
  state.tenants = tenants.data || [];
  state.occupants = occupants.data || [];
  state.pets = pets.data || [];
  state.unitPhotos = unitPhotos.data || [];
  state.members = members.data || [];
  state.ticketTypes = ticketTypes.data || [];
  state.ticketPhotos = ticketPhotos.data || [];
  state.conductDoc = (conductDocs.data && conductDocs.data[0]) || null;
  state.areaTypes = areaTypes.data || [];
  state.areas = areas.data || [];
  state.areaPhotos = areaPhotos.data || [];
  aiEngagementRows = []; // force AI-engagement list to reload fresh
}

/* ---------- Storage helpers (Phase 4) ---------- */
const BUCKET = "photos";
// Public URL for a stored file path.
function publicUrl(path) {
  if (!path) return "";
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
// Upload a File to a folder; returns the stored path (or throws).
async function uploadFile(file, folder) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false });
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
    tickets: renderTickets,
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
    areatypes: renderAreaTypes,
    areas: renderAreas,
    areadetail: renderAreaDetail,
    aiengagement: renderAiEngagement,
    users: renderPeople,
  }[name];
  if (render) render();
}

function unitNum(id) {
  return state.units.find((u) => u.id === id)?.number || "?";
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
    </div>`;
}

function renderTickets() {
  // Build filtered groups.
  const all = state.tickets.slice();
  const mine = all.filter(needsMyAction);
  const drafts = all.filter((t) => t.status === "create" && t.logged_by === me.id);
  const others = all.filter((t) => !mine.includes(t) && !drafts.includes(t));

  const section = (title, list, hint) => `
    <div class="panel">
      <div class="panel-head"><h2>${title}</h2>${hint ? `<span class="hint">${hint}</span>` : ""}</div>
      <div class="request-list">
        ${list.length ? list.map(ticketCard).join("") : `<div class="empty">None.</div>`}
      </div>
    </div>`;

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🎟️ Tickets</h2>
        ${canCreateTicket() ? `<button class="btn primary" data-new-ticket>+ Log a ticket</button>` : ""}
      </div>
    </div>
    ${drafts.length ? section("📝 My drafts (not yet sent)", drafts) : ""}
    ${section("⏳ Needs my feedback", mine, "Tickets currently assigned to a role you hold")}
    ${section(isTrustee() ? "📋 All other tickets" : "📋 Other tickets on my unit(s)", others)}`;
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
          const owners = state.owners.filter((o) => o.unit_id === u.id && o.active).length;
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
  $("#unit-number").value = unit?.number || "";
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

// Read-only: login users linked to a unit (via unit_members).
function unitUsersTable(unitId) {
  const links = state.members.filter((m) => m.unit_id === unitId);
  if (!links.length) return `<div class="empty">No login users linked to this unit.</div>`;
  return `<div class="table-wrap"><table><thead><tr>
      <th>User</th><th>Account role</th><th>Linked as</th>
    </tr></thead><tbody>
    ${links.map((m) => {
      const p = state.profiles.find((x) => x.id === m.profile_id);
      const name = p ? (p.full_name || p.email) : "(unknown user)";
      const role = p ? (ROLE_LABEL[p.role] || p.role) : "—";
      return `<tr>
        <td><strong>${esc(name)}</strong>${p && p.full_name ? `<div class="muted tiny">${esc(p.email)}</div>` : ""}</td>
        <td><span class="role-chip ${p ? p.role : ""}">${esc(role)}</span></td>
        <td>${esc(ROLE_LABEL[m.relation] || m.relation)}</td>
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
  const owners = activeOnly(state.owners.filter((o) => o.unit_id === unitId));
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
        ${canEditOwners(unitId) ? `<button class="btn primary small" data-add-owner>+ Add owner</button>` : ""}</div>
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
  state.owners
    .filter((o) => o.unit_id === unitId && o.is_occupant)
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
      <td><strong>${esc(p.name)}</strong></td>
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
      <td><strong>${esc(fullName(p))}</strong></td>
      <td>${contactLine(p)}</td>
      <td>${fmtDay(kind === "tenant" ? p.tenant_since : p.owner_since)}</td>
      ${kind === "tenant" ? `<td>${p.lease_with === "agency" ? "Agency: " + esc(p.agency_name || "—") : "Direct with owner"}</td>` : ""}
      <td>${p.is_occupant ? "Yes" : "No"}</td>
      <td>${p.active ? '<span class="pill approved">Active</span>' : `<span class="pill rejected">Left ${fmtDay(p.left_on)}</span>`}</td>
      ${canEdit ? `<td style="text-align:right"><button class="btn ghost small" data-edit-${kind}="${p.id}">Edit</button></td>` : ""}
    </tr>`).join("")}
  </tbody></table></div>`;
}

/* ----- Owner modal ----- */
function openOwnerModal(owner) {
  $("#owner-modal-title").textContent = owner ? "Edit owner" : "Add owner";
  $("#owner-id").value = owner?.id || "";
  $("#owner-first").value = owner?.first_name || "";
  $("#owner-last").value = owner?.last_name || "";
  $("#owner-cell").value = owner?.cell || "";
  $("#owner-email").value = owner?.email || "";
  $("#owner-since").value = owner?.owner_since || "";
  $("#owner-occupant").checked = !!owner?.is_occupant;
  $("#owner-active").checked = owner ? !!owner.active : true;
  $("#owner-left").value = owner?.left_on || "";
  $("#owner-msg").textContent = "";
  toggleLeftOn("owner");
  $("#owner-modal").classList.add("active");
}

$("#owner-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#owner-id").value;
  const active = $("#owner-active").checked;
  const payload = {
    unit_id: currentUnitId,
    first_name: $("#owner-first").value.trim(),
    last_name: $("#owner-last").value.trim(),
    cell: $("#owner-cell").value.trim() || null,
    email: $("#owner-email").value.trim() || null,
    owner_since: $("#owner-since").value || null,
    is_occupant: $("#owner-occupant").checked,
    active,
    left_on: active ? null : ($("#owner-left").value || null),
  };
  const { error } = id
    ? await sb.from("owners").update(payload).eq("id", id)
    : await sb.from("owners").insert(payload);
  if (error) { setMsg("owner-msg", "⚠️ " + error.message, false); return; }
  closeOverlays();
  await loadData();
  renderUnitDetail(currentUnitId);
});

/* ----- Tenant modal ----- */
function openTenantModal(tenant) {
  $("#tenant-modal-title").textContent = tenant ? "Edit tenant" : "Add tenant";
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
  const owners = state.owners.filter((o) => o.unit_id === currentUnitId && o.active);
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
    state.owners.filter((o) => o.unit_id === currentUnitId && o.active && o.is_occupant).forEach((o) =>
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
  const rows = state.owners.slice()
    .sort((a, b) => (b.active - a.active) || fullName(a).localeCompare(fullName(b)))
    .map((o) => `<tr class="${o.active ? "" : "inactive-row"}">
      <td><strong>${esc(fullName(o))}</strong></td>
      <td>${unitLinkChip(o.unit_id)}</td>
      <td>${contactLine(o)}</td>
      <td>${fmtDay(o.owner_since)}</td>
      <td>${o.is_occupant ? "Yes" : "No"}</td>
      <td>${o.active ? '<span class="pill approved">Active</span>' : `<span class="pill rejected">Left ${fmtDay(o.left_on)}</span>`}</td>
    </tr>`).join("");
  $("#main").innerHTML = listPanel("👤 Owners",
    ["Name", "Unit", "Contact", "Since", "Occupant", "Status"], rows);
}

function renderTenantsList() {
  const rows = state.tenants.slice()
    .sort((a, b) => (b.active - a.active) || fullName(a).localeCompare(fullName(b)))
    .map((t) => `<tr class="${t.active ? "" : "inactive-row"}">
      <td><strong>${esc(fullName(t))}</strong></td>
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
      <td><strong>${esc(fullName(oc))}</strong></td>
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
function unitsForUser(profileId) {
  const links = state.members.filter((m) => m.profile_id === profileId);
  if (!links.length) return `<span class="muted tiny">—</span>`;
  return links.map((m) => {
    const u = state.units.find((x) => x.id === m.unit_id);
    return u ? `<span class="chip">${esc(u.number)}</span>` : "";
  }).join(" ");
}

function renderTicketTypes() {
  const rows = state.ticketTypes.map((tt) => `<tr class="${tt.active ? "" : "inactive-row"}">
    <td><strong>${esc(tt.name)}</strong></td>
    <td>${tt.sort_order}</td>
    <td>${tt.active ? '<span class="pill approved">Active</span>' : '<span class="pill rejected">Hidden</span>'}</td>
    <td style="text-align:right"><button class="btn ghost small" data-edit-type="${tt.id}">Edit</button></td>
  </tr>`).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🏷️ Ticket types</h2>
        <button class="btn primary small" id="add-type-btn">+ Add type</button></div>
      <p class="muted tiny">The list of types users choose from when logging a ticket.</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Order</th><th>Status</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">No types yet.</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-type-btn").addEventListener("click", () => openTypeModal(null));
}

function openTypeModal(type) {
  $("#type-modal-title").textContent = type ? "Edit type" : "Add type";
  $("#type-id").value = type?.id || "";
  $("#type-name").value = type?.name || "";
  $("#type-order").value = type?.sort_order ?? state.ticketTypes.length + 1;
  $("#type-active").checked = type ? !!type.active : true;
  $("#type-msg").textContent = "";
  $("#type-modal").classList.add("active");
}

$("#type-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#type-id").value;
  const payload = {
    name: $("#type-name").value.trim(),
    sort_order: parseInt($("#type-order").value, 10) || 0,
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

/* ---------- Communal area types (trustee) ---------- */
function areaTypeName(id) {
  return state.areaTypes.find((t) => t.id === id)?.name || "—";
}

function renderAreaTypes() {
  const rows = state.areaTypes.map((tt) => `<tr class="${tt.active ? "" : "inactive-row"}">
    <td><strong>${esc(tt.name)}</strong></td>
    <td>${tt.sort_order}</td>
    <td>${tt.active ? '<span class="pill approved">Active</span>' : '<span class="pill rejected">Hidden</span>'}</td>
    <td style="text-align:right"><button class="btn ghost small" data-edit-areatype="${tt.id}">Edit</button></td>
  </tr>`).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🏷️ Communal area types</h2>
        <button class="btn primary small" id="add-areatype-btn">+ Add type</button></div>
      <p class="muted tiny">Types of communal area (Road, Gate, Grass, Flower Bed, Lamp pole, …).</p>
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Order</th><th>Status</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">No types yet.</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-areatype-btn").addEventListener("click", () => openAreaTypeModal(null));
}

function openAreaTypeModal(tt) {
  $("#areatype-modal-title").textContent = tt ? "Edit type" : "Add type";
  $("#areatype-id").value = tt?.id || "";
  $("#areatype-name").value = tt?.name || "";
  $("#areatype-order").value = tt?.sort_order ?? state.areaTypes.length + 1;
  $("#areatype-active").checked = tt ? !!tt.active : true;
  $("#areatype-msg").textContent = "";
  $("#areatype-modal").classList.add("active");
}

$("#areatype-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#areatype-id").value;
  const payload = {
    name: $("#areatype-name").value.trim(),
    sort_order: parseInt($("#areatype-order").value, 10) || 0,
    active: $("#areatype-active").checked,
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

/* ---------- Communal areas (trustee) ---------- */
function renderAreas() {
  const rows = state.areas.map((a) => {
    const photos = state.areaPhotos.filter((p) => p.area_id === a.id).length;
    return `<tr>
      <td><strong>${esc(a.code)}</strong></td>
      <td>${esc(a.name)}</td>
      <td>${esc(areaTypeName(a.type_id))}</td>
      <td>${photos} photo${photos === 1 ? "" : "s"}</td>
      <td style="text-align:right">
        <button class="btn ghost small" data-open-area="${a.id}">Open</button></td>
    </tr>`;
  }).join("");
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🌳 Communal areas</h2>
        <button class="btn primary small" id="add-area-btn">+ Add area</button></div>
      <div class="table-wrap"><table><thead><tr>
        <th>Code</th><th>Name</th><th>Type</th><th>Photos</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">No communal areas yet.</td></tr>`}</tbody></table></div>
    </div>`;
  $("#add-area-btn").addEventListener("click", () => openAreaModal(null));
}

function openAreaModal(area) {
  $("#area-modal-title").textContent = area ? "Edit communal area" : "Add communal area";
  $("#area-id").value = area?.id || "";
  $("#area-code").value = area?.code || "";
  $("#area-name").value = area?.name || "";
  $("#area-description").value = area?.description || "";
  $("#area-type").innerHTML = `<option value="">— type —</option>` +
    state.areaTypes.filter((t) => t.active || t.id === area?.type_id)
      .map((t) => `<option value="${t.id}" ${area?.type_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
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

/* ---------- Communal area detail + photos ---------- */
let currentAreaId = null;

function renderAreaDetail(areaId) {
  currentAreaId = areaId || currentAreaId;
  const a = state.areas.find((x) => x.id === currentAreaId);
  if (!a) return renderAreas();
  const photos = state.areaPhotos.filter((p) => p.area_id === a.id);

  $("#main").innerHTML = `
    <button class="link-btn" data-back-view="areas">← Back to communal areas</button>
    <div class="panel">
      <div class="panel-head"><h2>🌳 ${esc(a.name)}</h2>
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
        <span class="muted tiny">Send this to yourself:</span>
        <button class="btn ghost small" data-share-wa="${item.id}">📲 WhatsApp</button>
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
function shareViaWhatsApp(item) {
  const url = "https://wa.me/?text=" + encodeURIComponent(shareTextFor(item));
  window.open(url, "_blank", "noopener");
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
  const rows = state.profiles.map((p) => `
    <tr>
      <td>${esc(p.full_name || "—")}<div class="muted tiny">${esc(p.email)}</div></td>
      <td>
        <select data-role-for="${p.id}">
          ${Object.keys(ROLE_LABEL).map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}
        </select>
      </td>
      <td>${unitsForUser(p.id)}</td>
      <td><span class="pill ${p.status}">${p.status}</span></td>
      <td style="text-align:right">
        ${p.status !== "approved" ? `<button class="btn primary small" data-approve="${p.id}">Approve</button>` : ""}
        <button class="btn ghost small" data-link-unit="${p.id}">Link unit</button>
      </td>
    </tr>`).join("");

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>👥 Users &amp; approvals</h2>
        <span class="hint">Approve new sign-ups, set their role, link them to units</span></div>
      <div class="table-wrap"><table><thead><tr>
        <th>User</th><th>Role</th><th>Linked units</th><th>Status</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">No one yet.</td></tr>`}</tbody></table></div>
    </div>`;
}

/* ---------- Reusable bits ---------- */
function statCard(num, label, cls) {
  return `<div class="stat-card ${cls}"><div class="num">${num}</div><div class="label">${label}</div></div>`;
}
function ticketTypeName(id) {
  return state.ticketTypes.find((t) => t.id === id)?.name || "—";
}
// Where a ticket is about: a unit, or a communal area.
function ticketTargetLabel(t) {
  if (t.unit_id) return "Unit " + unitNum(t.unit_id);
  if (t.communal_area_id) {
    const a = state.areas.find((x) => x.id === t.communal_area_id);
    return a ? (a.name) : "Communal area";
  }
  return "—";
}
function ticketCard(t) {
  const assigned = t.assigned_role ? `· to <strong>${ROLE_LABEL[t.assigned_role] || t.assigned_role}</strong>` : "";
  return `<div class="request-card" data-open-ticket="${t.id}">
    <div class="rc-top">
      <div><div class="rc-title">${esc(t.heading)}</div>
        <div class="rc-meta"><strong>${esc(ticketTargetLabel(t))}</strong>
          · <span class="rc-cat">${esc(ticketTypeName(t.type_id))}</span> ${assigned}</div></div>
      <span class="pill ticket-${t.status}">${TICKET_STATUS_LABEL[t.status]}</span>
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

  // Trustee-only status transitions for Complete/Cancelled/Parked.
  const trusteeStatusBtns = isTrustee() && !isDraft
    ? ["complete", "cancelled", "parked"].filter((s) => s !== t.status)
        .map((s) => `<button class="btn small ghost" data-ticket-status="${t.id}|${s}">Mark ${TICKET_STATUS_LABEL[s]}</button>`).join(" ")
    : "";

  $("#detail-content").innerHTML = `
    <h3>${esc(t.heading)}</h3>
    <span class="pill ticket-${t.status}">${TICKET_STATUS_LABEL[t.status]}</span>
    <span class="rc-cat">${esc(ticketTypeName(t.type_id))}</span>
    <dl class="detail-grid">
      <dt>${t.communal_area_id ? "Communal area" : "Unit"}</dt><dd>${esc(ticketTargetLabel(t))}</dd>
      <dt>Logged by</dt><dd>${esc(loggerName(t))}${t.logged_by_role ? " (" + (ROLE_LABEL[t.logged_by_role] || t.logged_by_role) + ")" : ""}</dd>
      <dt>Logged</dt><dd>${fmtDate(t.created_at)}</dd>
      <dt>Assigned to</dt><dd>${t.assigned_role ? (ROLE_LABEL[t.assigned_role] || t.assigned_role) : "—"}</dd>
    </dl>
    <p>${esc(t.description) || "<em>No description.</em>"}</p>

    ${photos.length ? `<div class="photo-grid">${photos.map((p) =>
      `<figure class="photo-item"><a href="${publicUrl(p.storage_path)}" target="_blank" rel="noopener">
        <img src="${publicUrl(p.storage_path)}" loading="lazy" /></a>
        ${loggerCanEdit || isTrustee() ? `<button class="photo-del" data-del-ticket-photo="${p.id}">✕</button>` : ""}
      </figure>`).join("")}</div>` : ""}

    <div class="detail-actions">
      ${loggerCanEdit ? `
        <label class="btn ghost small upload-label">+ Photo<input type="file" accept="image/*" id="ticket-photo-input" hidden /></label>
        <button class="btn ghost small" data-edit-ticket="${t.id}">Edit</button>
        <button class="btn primary small" data-submit-ticket="${t.id}">Submit &amp; send</button>
        <button class="btn ghost small" data-delete-ticket="${t.id}" style="color:var(--open)">Delete</button>` : ""}
      ${isTrustee() && !isDraft ? `<button class="btn ghost small" data-edit-ticket="${t.id}">Edit details</button>` : ""}
      ${trusteeStatusBtns}
    </div>
    <p id="ticket-photo-msg" class="login-msg"></p>

    <h4 style="margin:14px 0 0">Feedback</h4>
    <div id="feedback-thread"><p class="muted tiny">Loading…</p></div>
    ${feedbackComposer(t, isDraft)}`;

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

function feedbackComposer(t, isDraft) {
  // No feedback while still a draft (not yet sent) or once closed.
  if (isDraft) return `<p class="muted tiny">Submit the ticket to start the conversation.</p>`;
  if (["complete", "cancelled"].includes(t.status)) {
    return `<p class="muted tiny">This ticket is ${TICKET_STATUS_LABEL[t.status].toLowerCase()}. ${isTrustee() ? "Reopen by setting another status to add feedback." : "No further feedback can be added."}</p>`;
  }
  // Can the current user route the ticket onward?
  //  - trustees always
  //  - a user currently holding the assigned role
  const canRoute = isTrustee() || iHoldAssignedRole(t);
  const roleOptions = ROUTE_ROLES
    .map((r) => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join("");
  // Default "send to" suggestion: back to the logger's role.
  return `
    <form id="feedback-form" class="feedback-form">
      <textarea id="feedback-body" rows="2" placeholder="Add feedback…" required></textarea>
      <div class="feedback-controls">
        <label class="feedback-photo-label btn ghost small">📎 Photo
          <input type="file" accept="image/*" id="feedback-photo-input" hidden />
          <span id="feedback-photo-name" class="muted tiny"></span>
        </label>
        ${canRoute ? `
        <label class="send-to-wrap">
          <input type="checkbox" id="feedback-send-check" />
          send to
          <select id="feedback-send-role" disabled>${roleOptions}</select>
        </label>` : ""}
        <button type="submit" class="btn primary small">Post feedback</button>
      </div>
      <p id="feedback-msg" class="login-msg"></p>
    </form>`;
}

async function renderFeedbackThread(ticketId) {
  const { data: fb } = await sb.from("ticket_feedback")
    .select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true });
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

async function deleteTicket(id) {
  if (!confirm("Delete this draft ticket?")) return;
  // Remove its photos from storage first.
  const photos = state.ticketPhotos.filter((p) => p.ticket_id === id);
  for (const p of photos) await deleteFile(p.storage_path);
  await sb.from("tickets").delete().eq("id", id);
  closeOverlays();
  await loadData();
  refreshActiveView();
}

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
// Enable the send-to dropdown only when the checkbox is ticked.
document.addEventListener("change", (e) => {
  if (e.target.id === "feedback-send-check") {
    $("#feedback-send-role").disabled = !e.target.checked;
  }
  if (e.target.id === "feedback-photo-input") {
    const f = e.target.files[0];
    $("#feedback-photo-name").textContent = f ? " " + f.name : "";
  }
});

document.addEventListener("submit", async (e) => {
  if (e.target.id !== "feedback-form") return;
  e.preventDefault();
  const t = state.tickets.find((x) => x.id === currentTicketId);
  if (!t) return;

  const body = $("#feedback-body").value.trim();
  if (!body) return;

  const sendChecked = $("#feedback-send-check") && $("#feedback-send-check").checked;
  const sendRole = sendChecked ? $("#feedback-send-role").value : null;
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

  // 3) Status automation:
  //    - rerouted  -> status Waiting, assigned_role changes
  //    - else, if poster holds the assigned role -> status Busy
  const updates = {};
  if (sendRole && sendRole !== t.assigned_role) {
    updates.assigned_role = sendRole;
    updates.status = "waiting";
  } else if (iHoldAssignedRole(t) && t.status !== "busy") {
    updates.status = "busy";
  }
  if (Object.keys(updates).length) {
    await sb.from("tickets").update(updates).eq("id", t.id);
  }

  await loadData();
  openTicket(t.id);       // re-render detail (thread + fresh status)
  refreshActiveView();     // refresh the list behind the modal
});

/* ---------- Ticket create / edit ---------- */
function openTicketModal(ticket) {
  $("#ticket-modal-title").textContent = ticket ? "Edit ticket" : "Log a ticket";
  $("#ticket-id").value = ticket?.id || "";

  // Logged by (read-only) — the current user.
  $("#ticket-loggedby").value = me.full_name || me.email;

  // Type dropdown (active types).
  $("#ticket-type").innerHTML = state.ticketTypes.filter((tt) => tt.active || tt.id === ticket?.type_id)
    .map((tt) => `<option value="${tt.id}" ${ticket?.type_id === tt.id ? "selected" : ""}>${esc(tt.name)}</option>`).join("");

  // Unit dropdown: ALL units for every role (optional). Default to the
  // resident's own unit when creating a new ticket (not for gardeners/SPs,
  // whose "units" come from assigned tickets and aren't a sensible default).
  const myUnits = isResident() ? [...myUnitIds()] : [];
  const defaultUnit = ticket ? ticket.unit_id : (myUnits.length ? myUnits[0] : "");
  $("#ticket-unit").innerHTML = `<option value="">— none —</option>` +
    state.units.map((u) => `<option value="${u.id}" ${defaultUnit === u.id ? "selected" : ""}>${esc(u.number)}</option>`).join("");

  // Communal area type (filters the area list) + area (both optional).
  $("#ticket-areatype").innerHTML = `<option value="">— type —</option>` +
    state.areaTypes.filter((t) => t.active).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  // If editing a communal-area ticket, preselect its type.
  if (ticket?.communal_area_id) {
    const a = state.areas.find((x) => x.id === ticket.communal_area_id);
    if (a?.type_id) $("#ticket-areatype").value = a.type_id;
  }
  populateTicketAreas(ticket?.communal_area_id || "");

  $("#ticket-heading").value = ticket?.heading || "";
  $("#ticket-description").value = ticket?.description || "";
  $("#ticket-msg").textContent = "";
  $("#ticket-modal").classList.add("active");
}

// Fill the communal-area dropdown based on the chosen type.
function populateTicketAreas(selectedId) {
  const typeId = $("#ticket-areatype").value;
  const areas = state.areas.filter((a) => !typeId || a.type_id === typeId);
  $("#ticket-area").innerHTML = `<option value="">— none —</option>` +
    areas.map((a) => `<option value="${a.id}" ${selectedId === a.id ? "selected" : ""}>${esc(a.code)} — ${esc(a.name)}</option>`).join("");
}

$("#ticket-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#ticket-id").value;
  const unitId = $("#ticket-unit").value || null;
  const areaId = $("#ticket-area").value || null;

  // Enforce: exactly one of Unit / Communal area.
  if (unitId && areaId) {
    setMsg("ticket-msg", "⚠️ Choose either a Unit or a Communal area — not both.", false);
    return;
  }
  if (!unitId && !areaId) {
    setMsg("ticket-msg", "⚠️ Please choose either a Unit or a Communal area.", false);
    return;
  }

  const payload = {
    unit_id: unitId,
    communal_area_id: areaId,
    type_id: $("#ticket-type").value || null,
    heading: $("#ticket-heading").value.trim(),
    description: $("#ticket-description").value.trim(),
  };
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
  const payload = {
    number: $("#unit-number").value.trim(),
    notes: $("#unit-notes").value.trim(),
    layout_id: $("#unit-layout").value || null,
  };
  const { error } = id
    ? await sb.from("units").update(payload).eq("id", id)
    : await sb.from("units").insert(payload);
  if (error) { alert(error.message); return; }
  closeOverlays();
  await loadData();
  refreshActiveView();
});

/* ---------- Trustee: approvals / roles / linking ---------- */
async function approve(id) {
  await sb.from("profiles").update({ status: "approved" }).eq("id", id);
  await loadData(); renderPeople();
}
async function setRole(id, role) {
  await sb.from("profiles").update({ role }).eq("id", id);
  await loadData();
}
function openLinkModal(profileId) {
  const person = state.profiles.find((p) => p.id === profileId);
  if (!state.units.length) {
    $("#link-person-label").textContent = "";
    $("#link-msg").textContent = "⚠️ Add a unit first (Units tab), then link people to it.";
    $("#link-msg").className = "login-msg err";
  } else {
    $("#link-msg").textContent = "";
    $("#link-msg").className = "login-msg";
    $("#link-person-label").textContent =
      "Linking " + (person?.full_name || person?.email || "this person");
  }
  $("#link-profile-id").value = profileId;
  $("#link-unit").innerHTML = state.units
    .map((u) => `<option value="${u.id}">${esc(u.number)}</option>`)
    .join("");
  $("#link-relation").value = "owner";
  $("#link-modal").classList.add("active");
}

$("#link-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const profileId = $("#link-profile-id").value;
  const unitId = $("#link-unit").value;
  const relation = $("#link-relation").value; // 'owner' | 'tenant'
  if (!unitId) return;
  const msg = $("#link-msg");
  const profile = state.profiles.find((p) => p.id === profileId);

  // 1) Record membership (used for permission checks + Linked-users view).
  const { error: memErr } = await sb.from("unit_members").insert({
    unit_id: unitId, profile_id: profileId, relation,
  });
  if (memErr && !memErr.message.includes("duplicate")) {
    msg.textContent = "⚠️ " + memErr.message;
    msg.className = "login-msg err";
    return;
  }

  // 2) Option (a): attach to an existing matching record on this unit
  //    (same email, not yet linked), else create a new registry record.
  const table = relation === "tenant" ? "tenants" : "owners";
  const pool = relation === "tenant" ? state.tenants : state.owners;
  const email = (profile?.email || "").toLowerCase();

  const existing = pool.find((r) =>
    r.unit_id === unitId && !r.profile_id &&
    (r.email || "").toLowerCase() === email && email);

  let regErr = null;
  if (existing) {
    ({ error: regErr } = await sb.from(table).update({ profile_id: profileId }).eq("id", existing.id));
  } else {
    // Derive first/last name from the profile's full name.
    const parts = (profile?.full_name || "").trim().split(/\s+/);
    const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] || profile?.email || "User");
    const last = parts.length > 1 ? parts[parts.length - 1] : "";
    const base = {
      unit_id: unitId, profile_id: profileId,
      first_name: first, last_name: last,
      email: profile?.email || null, is_occupant: true, active: true,
    };
    ({ error: regErr } = await sb.from(table).insert(base));
  }
  if (regErr) {
    msg.textContent = "Linked, but could not create the " + relation + " record: " + regErr.message;
    msg.className = "login-msg err";
    await loadData();
    return;
  }

  msg.textContent = `✅ Linked and created ${relation} record!`;
  msg.className = "login-msg ok";
  await loadData();
  setTimeout(() => { closeOverlays(); renderPeople(); }, 900);
});

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
  if (t.dataset.ticketStatus) {
    const [id, s] = t.dataset.ticketStatus.split("|");
    setTicketStatus(id, s);
  }
  if (t.dataset.delTicketPhoto) deleteTicketPhoto(t.dataset.delTicketPhoto);

  if (t.dataset.approve) approve(t.dataset.approve);
  if (t.dataset.linkUnit) openLinkModal(t.dataset.linkUnit);
  if (t.dataset.editUnit) openUnitModal(state.units.find((u) => u.id === t.dataset.editUnit));
  if (t.dataset.editLayout) openLayoutModal(state.layouts.find((l) => l.id === t.dataset.editLayout));

  // Unit detail (owners & tenants)
  if (t.dataset.openUnit) renderUnitDetail(t.dataset.openUnit);
  if (t.dataset.backView) showView(t.dataset.backView);
  if (t.hasAttribute("data-add-owner")) openOwnerModal(null);
  if (t.hasAttribute("data-add-tenant")) openTenantModal(null);
  if (t.dataset.editOwner) openOwnerModal(state.owners.find((o) => o.id === t.dataset.editOwner));
  if (t.dataset.editTenant) openTenantModal(state.tenants.find((tn) => tn.id === t.dataset.editTenant));
  if (t.hasAttribute("data-add-occupant")) openOccupantModal(null);
  if (t.dataset.editOccupant) openOccupantModal(state.occupants.find((oc) => oc.id === t.dataset.editOccupant));
  if (t.hasAttribute("data-add-pet")) openPetModal(null);
  if (t.dataset.editPet) openPetModal(state.pets.find((p) => p.id === t.dataset.editPet));
  if (t.dataset.delUnitPhoto) deleteUnitPhoto(t.dataset.delUnitPhoto);
  if (t.dataset.editType) openTypeModal(state.ticketTypes.find((x) => x.id === t.dataset.editType));

  // Communal areas
  if (t.dataset.editAreatype) openAreaTypeModal(state.areaTypes.find((x) => x.id === t.dataset.editAreatype));
  if (t.dataset.editArea) openAreaModal(state.areas.find((x) => x.id === t.dataset.editArea));
  if (t.dataset.openArea) renderAreaDetail(t.dataset.openArea);
  if (t.dataset.delAreaPhoto) deleteAreaPhoto(t.dataset.delAreaPhoto);

  // Ask-the-Rules: select a historical question
  const histBtn = t.closest("[data-ask-select]");
  if (histBtn) { askSelectedId = histBtn.dataset.askSelect; renderAskHistory(); renderAskAnswer(); }

  // Ask-the-Rules: share buttons
  if (t.dataset.shareWa) {
    const item = askHistory.find((q) => q.id === t.dataset.shareWa);
    if (item) shareViaWhatsApp(item);
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
  if (e.target.dataset.roleFor) setRole(e.target.dataset.roleFor, e.target.value);
  if (e.target.id === "tenant-lease") toggleAgencyFields();
  if (e.target.id === "owner-active") toggleLeftOn("owner");
  if (e.target.id === "tenant-active") toggleLeftOn("tenant");
  if (e.target.id === "occupant-active") toggleLeftOn("occupant");
  if (e.target.id === "pet-type") togglePetOther();
  if (e.target.id === "ticket-areatype") populateTicketAreas("");
  // Picking a Unit clears any communal-area selection, and vice versa.
  if (e.target.id === "ticket-unit" && e.target.value) {
    $("#ticket-areatype").value = ""; populateTicketAreas("");
  }
  if (e.target.id === "ticket-area" && e.target.value) {
    $("#ticket-unit").value = "";
  }
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
