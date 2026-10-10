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

let sb = null;        // supabase client
let me = null;        // current profile row
let state = { units: [], requests: [], profiles: [] };
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
    tabs.push({ id: "people", label: "People" });
  }
  const el = $("#tabs");
  el.hidden = false;
  el.innerHTML = tabs
    .map((t, i) => `<button class="tab-btn ${i === 0 ? "active" : ""}" data-view="${t.id}">${t.label}</button>`)
    .join("");
}

/* ---------- Data loading (RLS filters automatically) ---------- */
async function loadData() {
  const [units, requests, profiles] = await Promise.all([
    sb.from("units").select("*").order("number"),
    sb.from("requests").select("*").order("created_at", { ascending: false }),
    isTrustee() ? sb.from("profiles").select("*").order("created_at") : Promise.resolve({ data: [] }),
  ]);
  state.units = units.data || [];
  state.requests = requests.data || [];
  state.profiles = profiles.data || [];
}

/* ---------- Views ---------- */
function showView(name) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const render = {
    dashboard: renderDashboard,
    requests: renderRequests,
    units: renderUnits,
    people: renderPeople,
  }[name];
  if (render) render();
}

function unitNum(id) {
  return state.units.find((u) => u.id === id)?.number || "?";
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
        <th>Unit</th><th>Notes</th><th>Open requests</th>
      </tr></thead><tbody>
        ${state.units.map((u) => {
          const open = state.requests.filter((r) => r.unit_id === u.id && r.status !== "resolved").length;
          return `<tr><td><strong>${esc(u.number)}</strong></td>
            <td>${esc(u.notes || "—")}</td>
            <td><span class="badge-count ${open ? "" : "zero"}">${open}</span></td></tr>`;
        }).join("") || `<tr><td colspan="3" class="empty">No units yet.</td></tr>`}
      </tbody></table></div>
    </div>`;
  $("#add-unit-btn").addEventListener("click", () => $("#unit-modal").classList.add("active"));
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
      <td><span class="pill ${p.status}">${p.status}</span></td>
      <td style="text-align:right">
        ${p.status !== "approved" ? `<button class="btn primary small" data-approve="${p.id}">Approve</button>` : ""}
        <button class="btn ghost small" data-link-unit="${p.id}">Link unit</button>
      </td>
    </tr>`).join("");

  $("#main").innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>👥 People &amp; approvals</h2>
        <span class="hint">Approve new sign-ups, set their role, link them to a unit</span></div>
      <div class="table-wrap"><table><thead><tr>
        <th>Person</th><th>Role</th><th>Status</th><th></th>
      </tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">No one yet.</td></tr>`}</tbody></table></div>
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
  const { error } = await sb.from("units").insert({
    number: $("#unit-number").value.trim(),
    notes: $("#unit-notes").value.trim(),
  });
  if (error) { alert(error.message); return; }
  $("#unit-number").value = ""; $("#unit-notes").value = "";
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
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.roleFor) setRole(e.target.dataset.roleFor, e.target.value);
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
