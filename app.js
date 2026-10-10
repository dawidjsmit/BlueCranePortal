/* ============================================================
   Complex Comms — multi-user frontend (Supabase)
   ------------------------------------------------------------
   - Magic-link (passwordless) login
   - Role-aware views: trustee / owner / tenant / gardener / service_provider
   - All data access is additionally protected by RLS in the database.

   If config.js has no Supabase keys, the app shows a friendly notice
   instead of breaking, so the live page always loads.
   ============================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const cfg = window.COMPLEX_COMMS_CONFIG || {};
const CONFIGURED = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

const ROLE_LABEL = {
  trustee: "Trustee",
  owner: "Owner",
  tenant: "Tenant",
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

let sb = null;        // supabase client
let me = null;        // current profile row
let state = { units: [], requests: [], profiles: [], layouts: [], owners: [], tenants: [], occupants: [], pets: [], unitPhotos: [], members: [] };
let recovering = false; // true while handling a password-reset link

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

function showNotConfigured() {
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
  $("#main").hidden = true;
  $("#tabs").hidden = true;
  $("#user-box").hidden = true;
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
  $("#user-box").hidden = false;
  $("#user-box").innerHTML = `<span>${esc(me.email)}</span>`;
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
  $("#main").hidden = false;
  $("#user-box").hidden = false;
  $("#user-box").innerHTML = `
    <span class="role-chip ${me.role}">${ROLE_LABEL[me.role]}</span>
    <span class="umail">${esc(me.full_name || me.email)}</span>
    <button class="btn ghost small" id="set-pw-btn" title="Set or change your password">Set password</button>
    <button class="btn ghost small" id="signout">Sign out</button>`;
  $("#signout").addEventListener("click", () => sb.auth.signOut());
  $("#set-pw-btn").addEventListener("click", () => {
    // Reuse the set-password screen; skipping returns here.
    showSetPassword();
  });

  buildTabs();
  await loadData();
  showView(defaultView());
}

function isTrustee() { return me.role === "trustee"; }
function isAssignee() { return me.role === "gardener" || me.role === "service_provider"; }
function isResident() { return me.role === "owner" || me.role === "tenant"; }

function defaultView() {
  return "dashboard";
}

function buildTabs() {
  const tabs = [{ id: "dashboard", label: "Dashboard" }, { id: "requests", label: "Requests" }];
  if (isTrustee()) {
    tabs.push({ id: "units", label: "Units" });
    tabs.push({ id: "owners", label: "Owners" });
    tabs.push({ id: "tenants", label: "Tenants" });
    tabs.push({ id: "occupants", label: "Occupants" });
    tabs.push({ id: "pets", label: "Pets" });
    tabs.push({ id: "layouts", label: "Layouts" });
    tabs.push({ id: "users", label: "Users" });
  }
  const el = $("#tabs");
  el.hidden = false;
  el.innerHTML = tabs
    .map((t, i) => `<button class="tab-btn ${i === 0 ? "active" : ""}" data-view="${t.id}">${t.label}</button>`)
    .join("");
}

/* ---------- Data loading (RLS filters automatically) ---------- */
async function loadData() {
  const [units, requests, profiles, layouts, owners, tenants, occupants, pets, unitPhotos, members] = await Promise.all([
    sb.from("units").select("*").order("number"),
    sb.from("requests").select("*").order("created_at", { ascending: false }),
    isTrustee() ? sb.from("profiles").select("*").order("created_at") : Promise.resolve({ data: [] }),
    sb.from("unit_layouts").select("*").order("code"),
    sb.from("owners").select("*").order("last_name"),
    sb.from("tenants").select("*").order("last_name"),
    sb.from("occupants").select("*").order("last_name"),
    sb.from("pets").select("*").order("name"),
    sb.from("unit_photos").select("*").order("created_at"),
    sb.from("unit_members").select("*"),
  ]);
  state.units = units.data || [];
  state.requests = requests.data || [];
  state.profiles = profiles.data || [];
  state.layouts = layouts.data || [];
  state.owners = owners.data || [];
  state.tenants = tenants.data || [];
  state.occupants = occupants.data || [];
  state.pets = pets.data || [];
  state.unitPhotos = unitPhotos.data || [];
  state.members = members.data || [];
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
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const render = {
    dashboard: renderDashboard,
    requests: renderRequests,
    units: renderUnits,
    owners: renderOwnersList,
    tenants: renderTenantsList,
    occupants: renderOccupantsList,
    pets: renderPetsList,
    layouts: renderLayouts,
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

function renderDashboard() {
  const open = state.requests.filter((r) => r.status !== "resolved");
  const counts = {};
  STATUS_ORDER.forEach((s) => (counts[s] = state.requests.filter((r) => r.status === s).length));

  const headline = isTrustee()
    ? "Who is waiting on what — across the complex"
    : isAssignee()
    ? "Jobs assigned to you"
    : "Your unit's open requests";

  $("#main").innerHTML = `
    <div class="stats-grid">
      ${isTrustee() ? statCard(state.units.length, "Units", "") : ""}
      ${statCard(open.length, "Open items", "open")}
      ${statCard(counts.in_progress, "In progress", "progress")}
      ${statCard(counts.waiting_on_resident, "Waiting on resident", "waiting")}
      ${statCard(counts.resolved, "Resolved", "resolved")}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>⏳ ${headline}</h2>
        ${canCreateRequest() ? `<button class="btn primary" data-new-request>+ Log request</button>` : ""}
      </div>
      <div class="request-list">
        ${open.length ? open.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map(requestCard).join("")
          : `<div class="empty">🎉 Nothing open right now.</div>`}
      </div>
    </div>`;
}

function renderRequests() {
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🎫 Requests</h2>
        ${canCreateRequest() ? `<button class="btn primary" data-new-request>+ Log request</button>` : ""}
      </div>
      <div class="request-list">
        ${state.requests.length ? state.requests.map(requestCard).join("")
          : `<div class="empty">No requests yet.</div>`}
      </div>
    </div>`;
}

function renderUnits() {
  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>🏠 Units</h2>
        <button class="btn primary" id="add-unit-btn">+ Add unit</button></div>
      <div class="table-wrap"><table><thead><tr>
        <th>Unit</th><th>Layout</th><th>People</th><th>Open requests</th><th></th>
      </tr></thead><tbody>
        ${state.units.map((u) => {
          const open = state.requests.filter((r) => r.unit_id === u.id && r.status !== "resolved").length;
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
  if (!u) return renderUnits();

  const owners = state.owners.filter((o) => o.unit_id === unitId);
  const tenants = state.tenants.filter((t) => t.unit_id === unitId);
  const layout = layoutById(u.layout_id);

  $("#main").innerHTML = `
    <button class="link-btn" data-back-units>← Back to units</button>
    <div class="panel">
      <div class="panel-head">
        <h2>🏠 Unit ${esc(u.number)}</h2>
        <button class="btn ghost small" data-edit-unit="${u.id}">Edit unit</button>
      </div>
      <dl class="detail-grid">
        <dt>Layout</dt><dd>${layout ? esc(layout.code) + (layout.description ? " — " + esc(layout.description) : "") : "—"}</dd>
        <dt>Notes</dt><dd>${esc(u.notes || "—")}</dd>
      </dl>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>📷 Photos</h2>
        ${canManageUnitPhotos(unitId)
          ? `<label class="btn primary small upload-label">+ Add photo
               <input type="file" accept="image/*" id="unit-photo-input" hidden /></label>`
          : ""}
      </div>
      <p class="muted tiny">Photos of the unit and its exclusive-use area.</p>
      <p id="unit-photo-msg" class="login-msg"></p>
      ${unitPhotoGallery(unitId)}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>👤 Owners</h2>
        <button class="btn primary small" data-add-owner>+ Add owner</button></div>
      ${personTable(owners, "owner")}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>🔑 Tenants</h2>
        <button class="btn primary small" data-add-tenant>+ Add tenant</button></div>
      ${personTable(tenants, "tenant")}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>🧑‍🤝‍🧑 Occupants</h2>
        <button class="btn primary small" data-add-occupant>+ Add occupant</button></div>
      <p class="muted tiny">Owners &amp; tenants marked “is occupant” appear here automatically. Add other household members (spouse, child, live-in employee) below.</p>
      ${occupantTable(unitId)}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>🐾 Pets</h2>
        <button class="btn primary small" data-add-pet>+ Add pet</button></div>
      ${petTable(unitId)}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>🔐 Linked users</h2>
        <span class="hint">Login accounts linked to this unit (manage on the Users tab)</span></div>
      ${unitUsersTable(unitId)}
    </div>`;

  // Wire the hidden file input (added fresh each render).
  const input = $("#unit-photo-input");
  if (input) input.addEventListener("change", (e) => onUnitPhotoChosen(e, unitId));
}

// Trustees always; owners of this unit too.
function canManageUnitPhotos(unitId) {
  if (isTrustee()) return true;
  return state.owners.some((o) => o.unit_id === unitId && o.profile_id === me.id && o.active);
}

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
  const list = occupantsFor(unitId);
  if (!list.length) return `<div class="empty">No occupants yet.</div>`;
  const sorted = list.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  return `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Role / relationship</th><th>Source</th><th>Status</th><th></th>
    </tr></thead><tbody>
    ${sorted.map((p) => `<tr class="${p.active ? "" : "inactive-row"}">
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.detail)}</td>
      <td>${p.auto ? '<span class="muted tiny">auto (from ' + p.kind + ')</span>' : '<span class="chip">added</span>'}</td>
      <td>${p.active ? '<span class="pill approved">Active</span>' : '<span class="pill rejected">Inactive</span>'}</td>
      <td style="text-align:right">${p.auto
        ? '<span class="muted tiny">edit on their ' + p.kind + ' record</span>'
        : `<button class="btn ghost small" data-edit-occupant="${p.id}">Edit</button>`}</td>
    </tr>`).join("")}
  </tbody></table></div>`;
}

function petTable(unitId) {
  const pets = state.pets.filter((p) => p.unit_id === unitId);
  if (!pets.length) return `<div class="empty">No pets recorded.</div>`;
  return `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Type</th><th>Breed</th><th>Belongs to</th><th>Sterilised</th><th></th>
    </tr></thead><tbody>
    ${pets.map((p) => `<tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.pet_type === "other" ? (p.type_other || "Other") : capitalize(p.pet_type))}</td>
      <td>${esc(p.breed || "—")}</td>
      <td>${esc(holderName(p))}</td>
      <td>${p.sterilised == null ? "—" : (p.sterilised ? "Yes" : "No")}</td>
      <td style="text-align:right"><button class="btn ghost small" data-edit-pet="${p.id}">Edit</button></td>
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

function personTable(people, kind) {
  if (!people.length) return `<div class="empty">No ${kind}s recorded.</div>`;
  // Active first, then by name.
  const sorted = people.slice().sort((a, b) => (b.active - a.active) || fullName(a).localeCompare(fullName(b)));
  return `<div class="table-wrap"><table><thead><tr>
      <th>Name</th><th>Contact</th><th>Since</th>
      ${kind === "tenant" ? "<th>Lease</th>" : ""}
      <th>Occupant</th><th>Status</th><th></th>
    </tr></thead><tbody>
    ${sorted.map((p) => `<tr class="${p.active ? "" : "inactive-row"}">
      <td><strong>${esc(fullName(p))}</strong></td>
      <td>${contactLine(p)}</td>
      <td>${fmtDay(kind === "tenant" ? p.tenant_since : p.owner_since)}</td>
      ${kind === "tenant" ? `<td>${p.lease_with === "agency" ? "Agency: " + esc(p.agency_name || "—") : "Direct with owner"}</td>` : ""}
      <td>${p.is_occupant ? "Yes" : "No"}</td>
      <td>${p.active ? '<span class="pill approved">Active</span>' : `<span class="pill rejected">Left ${fmtDay(p.left_on)}</span>`}</td>
      <td style="text-align:right"><button class="btn ghost small" data-edit-${kind}="${p.id}">Edit</button></td>
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
  // Related owner / tenant dropdowns, scoped to the current unit.
  const owners = state.owners.filter((o) => o.unit_id === currentUnitId);
  const tenants = state.tenants.filter((t) => t.unit_id === currentUnitId);
  $("#occupant-owner").innerHTML = `<option value="">— none —</option>` +
    owners.map((o) => `<option value="${o.id}" ${occupant?.related_owner_id === o.id ? "selected" : ""}>${esc(fullName(o))}</option>`).join("");
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
  // Holder dropdown: every active person in the unit (owners, tenants, occupants).
  const holders = [];
  state.owners.filter((o) => o.unit_id === currentUnitId).forEach((o) =>
    holders.push({ v: `owner|${o.id}`, label: fullName(o) + " (owner)" }));
  state.tenants.filter((t) => t.unit_id === currentUnitId).forEach((t) =>
    holders.push({ v: `tenant|${t.id}`, label: fullName(t) + " (tenant)" }));
  state.occupants.filter((oc) => oc.unit_id === currentUnitId).forEach((oc) =>
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
function requestCard(r) {
  return `<div class="request-card" data-open-request="${r.id}">
    <div class="rc-top">
      <div><div class="rc-title">${esc(r.title)}</div>
        <div class="rc-meta">Unit <strong>${esc(unitNum(r.unit_id))}</strong>
          · <span class="rc-cat">${esc(r.category)}</span></div></div>
      <span class="pill ${r.status}">${STATUS_LABEL[r.status]}</span>
    </div></div>`;
}
function canCreateRequest() {
  return isTrustee() || isResident();
}

/* ---------- Request detail + status changes ---------- */
async function openDetail(id) {
  const r = state.requests.find((x) => x.id === id);
  if (!r) return;
  const { data: log } = await sb.from("request_log")
    .select("*").eq("request_id", id).order("created_at", { ascending: false });

  const canUpdate = isTrustee() || r.assignee_id === me.id;
  const statusBtns = canUpdate
    ? STATUS_ORDER.filter((s) => s !== r.status)
        .map((s) => `<button class="btn small ${s === "resolved" ? "primary" : "ghost"}" data-set-status="${r.id}|${s}">Mark ${STATUS_LABEL[s]}</button>`).join(" ")
    : "";

  $("#detail-content").innerHTML = `
    <h3>${esc(r.title)}</h3>
    <span class="pill ${r.status}">${STATUS_LABEL[r.status]}</span>
    <span class="rc-cat">${esc(r.category)}</span>
    <dl class="detail-grid">
      <dt>Unit</dt><dd>${esc(unitNum(r.unit_id))}</dd>
      <dt>Logged</dt><dd>${fmtDate(r.created_at)}</dd>
    </dl>
    <p>${esc(r.details) || "<em>No details.</em>"}</p>
    <div class="detail-actions">${statusBtns}
      ${isTrustee() ? `<button class="btn ghost small" data-delete-request="${r.id}" style="color:var(--open)">Delete</button>` : ""}
    </div>
    <h4 style="margin-bottom:0">History</h4>
    <ul class="timeline">
      ${(log || []).map((e) => `<li>${esc(e.text)}<div class="tl-time">${fmtDate(e.created_at)}</div></li>`).join("")
        || `<li class="muted">No history yet.</li>`}
    </ul>`;
  $("#detail-modal").classList.add("active");
}

async function setStatus(id, status) {
  await sb.from("requests").update({ status }).eq("id", id);
  await sb.from("request_log").insert({
    request_id: id, author_id: me.id,
    text: `Status → ${STATUS_LABEL[status]}`,
  });
  await loadData();
  openDetail(id);
  refreshActiveView();
}

/* ---------- Create / edit ---------- */
function openRequestModal() {
  const sel = $("#request-unit");
  // Residents can only log against their own unit(s); RLS also enforces this.
  sel.innerHTML = state.units
    .map((u) => `<option value="${u.id}">${esc(u.number)}</option>`).join("");
  $("#request-id").value = "";
  $("#request-title").value = "";
  $("#request-details").value = "";
  $("#request-modal").classList.add("active");
}

$("#request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    unit_id: $("#request-unit").value,
    category: $("#request-category").value,
    title: $("#request-title").value.trim(),
    details: $("#request-details").value.trim(),
    created_by: me.id,
    status: "open",
  };
  const { data, error } = await sb.from("requests").insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await sb.from("request_log").insert({
    request_id: data.id, author_id: me.id, text: "Request logged (Open)",
  });
  closeOverlays();
  await loadData();
  refreshActiveView();
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
  const relation = $("#link-relation").value;
  if (!unitId) return;
  const { error } = await sb.from("unit_members").insert({
    unit_id: unitId, profile_id: profileId, relation,
  });
  const msg = $("#link-msg");
  if (error) {
    // Most common error: this person is already linked to that unit.
    msg.textContent = error.message.includes("duplicate")
      ? "This person is already linked to that unit."
      : "⚠️ " + error.message;
    msg.className = "login-msg err";
    return;
  }
  msg.textContent = "✅ Linked!";
  msg.className = "login-msg ok";
  await loadData();
  setTimeout(() => { closeOverlays(); renderPeople(); }, 700);
});

/* ---------- Delegated events ---------- */
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.dataset.view) showView(t.dataset.view);
  if (t.hasAttribute("data-close")) closeOverlays();
  if (t.hasAttribute("data-new-request")) openRequestModal();

  const card = t.closest("[data-open-request]");
  if (card) openDetail(card.dataset.openRequest);

  if (t.dataset.setStatus) {
    const [id, s] = t.dataset.setStatus.split("|");
    setStatus(id, s);
  }
  if (t.dataset.deleteRequest) {
    if (confirm("Delete this request?")) {
      await sb.from("requests").delete().eq("id", t.dataset.deleteRequest);
      closeOverlays(); await loadData(); refreshActiveView();
    }
  }
  if (t.dataset.approve) approve(t.dataset.approve);
  if (t.dataset.linkUnit) openLinkModal(t.dataset.linkUnit);
  if (t.dataset.editUnit) openUnitModal(state.units.find((u) => u.id === t.dataset.editUnit));
  if (t.dataset.editLayout) openLayoutModal(state.layouts.find((l) => l.id === t.dataset.editLayout));

  // Unit detail (owners & tenants)
  if (t.dataset.openUnit) renderUnitDetail(t.dataset.openUnit);
  if (t.hasAttribute("data-back-units")) showView("units");
  if (t.hasAttribute("data-add-owner")) openOwnerModal(null);
  if (t.hasAttribute("data-add-tenant")) openTenantModal(null);
  if (t.dataset.editOwner) openOwnerModal(state.owners.find((o) => o.id === t.dataset.editOwner));
  if (t.dataset.editTenant) openTenantModal(state.tenants.find((tn) => tn.id === t.dataset.editTenant));
  if (t.hasAttribute("data-add-occupant")) openOccupantModal(null);
  if (t.dataset.editOccupant) openOccupantModal(state.occupants.find((oc) => oc.id === t.dataset.editOccupant));
  if (t.hasAttribute("data-add-pet")) openPetModal(null);
  if (t.dataset.editPet) openPetModal(state.pets.find((p) => p.id === t.dataset.editPet));
  if (t.dataset.delUnitPhoto) deleteUnitPhoto(t.dataset.delUnitPhoto);
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.roleFor) setRole(e.target.dataset.roleFor, e.target.value);
  if (e.target.id === "tenant-lease") toggleAgencyFields();
  if (e.target.id === "owner-active") toggleLeftOn("owner");
  if (e.target.id === "tenant-active") toggleLeftOn("tenant");
  if (e.target.id === "occupant-active") toggleLeftOn("occupant");
  if (e.target.id === "pet-type") togglePetOther();
});
$$(".modal-overlay").forEach((ov) =>
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("active"); }));

function closeOverlays() { $$(".modal-overlay").forEach((o) => o.classList.remove("active")); }
function refreshActiveView() {
  const active = $(".tab-btn.active")?.dataset.view || "dashboard";
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
