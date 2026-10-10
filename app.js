/* ============================================================
   Complex Comms — a unit communication tracker for trustees.
   All data is stored locally in the browser (localStorage),
   so there is no server, account, or database to set up.
   ============================================================ */

const STORE_KEY = "complex-comms-v1";
const STATUSES = ["Open", "In Progress", "Waiting on Resident", "Resolved"];

/* ---------- Data layer ---------- */
let db = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Could not read saved data:", e);
  }
  return seed();
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(db));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* A little starter data so the app isn't empty on first open. */
function seed() {
  const now = Date.now();
  const u1 = uid(), u2 = uid(), u3 = uid();
  return {
    units: [
      { id: u1, number: "1A", owner: "Thandi Mokoena", ownerPhone: "+27 82 111 2222",
        tenant: "", tenantPhone: "", notes: "Owner-occupied. Bay 3." },
      { id: u2, number: "4C", owner: "David Pillay", ownerPhone: "+27 83 333 4444",
        tenant: "Sarah Nel", tenantPhone: "+27 84 555 6666", notes: "Rented. 1 dog approved." },
      { id: u3, number: "7B", owner: "Investments (Pty) Ltd", ownerPhone: "+27 11 777 8888",
        tenant: "Ahmed Patel", tenantPhone: "+27 82 999 0000", notes: "Rented via agent." },
    ],
    requests: [
      {
        id: uid(), unitId: u2, category: "Maintenance", title: "Leaking geyser",
        details: "Water staining the ceiling of unit below. Reported by tenant.",
        status: "In Progress", createdAt: now - 1000 * 60 * 60 * 48,
        log: [
          { at: now - 1000 * 60 * 60 * 48, text: "Request logged (Open)" },
          { at: now - 1000 * 60 * 60 * 24, text: "Status → In Progress — plumber called" },
        ],
      },
      {
        id: uid(), unitId: u3, category: "Billing / Levies", title: "Levy statement query",
        details: "Tenant asking why the levy increased this quarter.",
        status: "Waiting on Resident", createdAt: now - 1000 * 60 * 60 * 72,
        log: [
          { at: now - 1000 * 60 * 60 * 72, text: "Request logged (Open)" },
          { at: now - 1000 * 60 * 60 * 50, text: "Status → Waiting on Resident — sent breakdown, awaiting reply" },
        ],
      },
      {
        id: uid(), unitId: u1, category: "Access / Security", title: "New remote for gate",
        details: "Owner needs an additional gate remote.",
        status: "Open", createdAt: now - 1000 * 60 * 60 * 5,
        log: [{ at: now - 1000 * 60 * 60 * 5, text: "Request logged (Open)" }],
      },
    ],
  };
}

/* ---------- Helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const unitById = (id) => db.units.find((u) => u.id === id);
const openCountFor = (unitId) =>
  db.requests.filter((r) => r.unitId === unitId && r.status !== "Resolved").length;

function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
function ago(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}
const pillClass = (s) => "pill " + s.replace(/\s/g, "");
function esc(str = "") {
  return str.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Rendering ---------- */
function renderAll() {
  renderDashboard();
  renderUnits();
  renderRequests();
  populateUnitSelects();
}

function renderDashboard() {
  const counts = { Open: 0, "In Progress": 0, "Waiting on Resident": 0, Resolved: 0 };
  db.requests.forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
  const openTotal = counts.Open + counts["In Progress"] + counts["Waiting on Resident"];

  $("#stats-grid").innerHTML = `
    <div class="stat-card"><div class="num">${db.units.length}</div><div class="label">Units tracked</div></div>
    <div class="stat-card open"><div class="num">${openTotal}</div><div class="label">Open items total</div></div>
    <div class="stat-card progress"><div class="num">${counts["In Progress"]}</div><div class="label">In progress</div></div>
    <div class="stat-card waiting"><div class="num">${counts["Waiting on Resident"]}</div><div class="label">Waiting on resident</div></div>
    <div class="stat-card resolved"><div class="num">${counts.Resolved}</div><div class="label">Resolved</div></div>
  `;

  const open = db.requests
    .filter((r) => r.status !== "Resolved")
    .sort((a, b) => a.createdAt - b.createdAt);

  $("#waiting-list").innerHTML = open.length
    ? open.map(requestCardHTML).join("")
    : `<div class="empty">🎉 Nothing open — every unit is up to date!</div>`;
}

function renderUnits() {
  const tbody = $("#units-table tbody");
  tbody.innerHTML = db.units
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
    .map((u) => {
      const open = openCountFor(u.id);
      const contactName = u.tenant || u.owner || "—";
      const contactPhone = u.tenant ? u.tenantPhone : u.ownerPhone;
      return `<tr>
        <td><strong>${esc(u.number)}</strong></td>
        <td>${esc(u.owner || "—")}</td>
        <td>${esc(u.tenant || "—")}</td>
        <td>${contactPhone ? `<a href="tel:${esc(contactPhone)}">${esc(contactPhone)}</a>` : "—"}</td>
        <td><span class="badge-count ${open ? "" : "zero"}">${open}</span></td>
        <td style="text-align:right">
          <button class="btn ghost small" data-edit-unit="${u.id}">Edit</button>
        </td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" class="empty">No units yet. Add your first unit.</td></tr>`;
}

function renderRequests() {
  const statusF = $("#filter-status").value;
  const unitF = $("#filter-unit").value;
  const text = $("#filter-search").value.toLowerCase().trim();

  let list = db.requests.slice().sort((a, b) => b.createdAt - a.createdAt);
  if (statusF) list = list.filter((r) => r.status === statusF);
  if (unitF) list = list.filter((r) => r.unitId === unitF);
  if (text) list = list.filter((r) =>
    (r.title + r.details + (unitById(r.unitId)?.number || "")).toLowerCase().includes(text));

  $("#requests-list").innerHTML = list.length
    ? list.map(requestCardHTML).join("")
    : `<div class="empty">No requests match your filters.</div>`;
}

function requestCardHTML(r) {
  const u = unitById(r.unitId);
  return `<div class="request-card" data-open-request="${r.id}">
    <div class="rc-top">
      <div>
        <div class="rc-title">${esc(r.title)}</div>
        <div class="rc-meta">Unit <strong>${esc(u ? u.number : "?")}</strong>
          · <span class="rc-cat">${esc(r.category)}</span>
          · logged ${ago(r.createdAt)}</div>
      </div>
      <span class="${pillClass(r.status)}">${esc(r.status)}</span>
    </div>
  </div>`;
}

function populateUnitSelects() {
  const opts = db.units
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
    .map((u) => `<option value="${u.id}">${esc(u.number)} — ${esc(u.tenant || u.owner || "")}</option>`)
    .join("");
  $("#request-unit").innerHTML = opts;
  $("#filter-unit").innerHTML = `<option value="">All units</option>` + opts;
}

/* ---------- Views / tabs ---------- */
function showView(name) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $("#view-" + name).classList.add("active");
}

/* ---------- Modals ---------- */
function openModal(id) { $("#" + id).classList.add("active"); }
function closeModal(el) { el.closest(".modal-overlay").classList.remove("active"); }

/* Unit form */
function openUnitModal(unit) {
  $("#unit-modal-title").textContent = unit ? "Edit unit" : "Add unit";
  $("#unit-id").value = unit?.id || "";
  $("#unit-number").value = unit?.number || "";
  $("#unit-owner").value = unit?.owner || "";
  $("#unit-owner-phone").value = unit?.ownerPhone || "";
  $("#unit-tenant").value = unit?.tenant || "";
  $("#unit-tenant-phone").value = unit?.tenantPhone || "";
  $("#unit-notes").value = unit?.notes || "";
  openModal("unit-modal");
}

$("#unit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#unit-id").value;
  const data = {
    number: $("#unit-number").value.trim(),
    owner: $("#unit-owner").value.trim(),
    ownerPhone: $("#unit-owner-phone").value.trim(),
    tenant: $("#unit-tenant").value.trim(),
    tenantPhone: $("#unit-tenant-phone").value.trim(),
    notes: $("#unit-notes").value.trim(),
  };
  if (id) {
    Object.assign(unitById(id), data);
  } else {
    db.units.push({ id: uid(), ...data });
  }
  save();
  renderAll();
  closeModal($("#unit-form"));
});

/* Request form */
function openRequestModal(req) {
  $("#request-modal-title").textContent = req ? "Edit request" : "Log request";
  $("#request-id").value = req?.id || "";
  $("#request-unit").value = req?.unitId || (db.units[0]?.id || "");
  $("#request-category").value = req?.category || "Maintenance";
  $("#request-title").value = req?.title || "";
  $("#request-details").value = req?.details || "";
  $("#request-status").value = req?.status || "Open";
  openModal("request-modal");
}

$("#request-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#request-id").value;
  const newStatus = $("#request-status").value;
  const payload = {
    unitId: $("#request-unit").value,
    category: $("#request-category").value,
    title: $("#request-title").value.trim(),
    details: $("#request-details").value.trim(),
    status: newStatus,
  };
  if (id) {
    const r = db.requests.find((x) => x.id === id);
    if (r.status !== newStatus) {
      r.log.push({ at: Date.now(), text: `Status → ${newStatus}` });
    }
    Object.assign(r, payload);
  } else {
    db.requests.push({
      id: uid(), ...payload,
      createdAt: Date.now(),
      log: [{ at: Date.now(), text: `Request logged (${newStatus})` }],
    });
  }
  save();
  renderAll();
  closeModal($("#request-form"));
});

/* Detail / timeline view */
function openDetail(id) {
  const r = db.requests.find((x) => x.id === id);
  if (!r) return;
  const u = unitById(r.unitId);
  const contactName = u?.tenant || u?.owner || "—";
  const contactPhone = u?.tenant ? u.tenantPhone : u?.ownerPhone;

  const timeline = r.log
    .slice()
    .sort((a, b) => b.at - a.at)
    .map((e) => `<li>${esc(e.text)}<div class="tl-time">${fmtDate(e.at)}</div></li>`)
    .join("");

  const nextStatusButtons = STATUSES
    .filter((s) => s !== r.status)
    .map((s) => `<button class="btn small ${s === "Resolved" ? "primary" : "ghost"}" data-set-status="${r.id}|${s}">Mark ${esc(s)}</button>`)
    .join(" ");

  $("#detail-content").innerHTML = `
    <h3>${esc(r.title)}</h3>
    <span class="${pillClass(r.status)}">${esc(r.status)}</span>
    <span class="rc-cat">${esc(r.category)}</span>
    <dl class="detail-grid">
      <dt>Unit</dt><dd>${esc(u ? u.number : "?")}</dd>
      <dt>Contact</dt><dd class="detail-contact">${esc(contactName)}${contactPhone ? ` · <a href="tel:${esc(contactPhone)}">${esc(contactPhone)}</a>` : ""}</dd>
      <dt>Logged</dt><dd>${fmtDate(r.createdAt)}</dd>
    </dl>
    <p>${esc(r.details) || "<em>No details.</em>"}</p>
    <div style="margin:12px 0; display:flex; gap:6px; flex-wrap:wrap;">
      ${nextStatusButtons}
      <button class="btn small ghost" data-edit-request="${r.id}">Edit</button>
      <button class="btn small ghost" data-delete-request="${r.id}" style="color:var(--open)">Delete</button>
    </div>
    <h4 style="margin-bottom:0">History</h4>
    <ul class="timeline">${timeline}</ul>
  `;
  openModal("detail-modal");
}

function setStatus(id, status) {
  const r = db.requests.find((x) => x.id === id);
  if (!r || r.status === status) return;
  r.status = status;
  r.log.push({ at: Date.now(), text: `Status → ${status}` });
  save();
  renderAll();
  openDetail(id); // refresh open detail
}

/* ---------- Event wiring (delegated) ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;

  if (t.dataset.view) showView(t.dataset.view);
  if (t.hasAttribute("data-close")) closeModal(t);
  if (t.id === "add-unit-btn") openUnitModal(null);
  if (t.id === "add-request-btn") {
    if (!db.units.length) { alert("Add a unit first."); return; }
    openRequestModal(null);
  }
  if (t.dataset.editUnit) openUnitModal(unitById(t.dataset.editUnit));

  const card = t.closest("[data-open-request]");
  if (card) openDetail(card.dataset.openRequest);

  if (t.dataset.setStatus) {
    const [id, status] = t.dataset.setStatus.split("|");
    setStatus(id, status);
  }
  if (t.dataset.editRequest) {
    closeModal(t);
    openRequestModal(db.requests.find((x) => x.id === t.dataset.editRequest));
  }
  if (t.dataset.deleteRequest) {
    if (confirm("Delete this request permanently?")) {
      db.requests = db.requests.filter((x) => x.id !== t.dataset.deleteRequest);
      save();
      renderAll();
      closeModal(t);
    }
  }
});

// Close modal when clicking the dark overlay
$$(".modal-overlay").forEach((ov) =>
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("active"); }));

// Filters
["filter-status", "filter-unit", "filter-search"].forEach((id) =>
  $("#" + id).addEventListener("input", renderRequests));

/* ---------- Boot ---------- */
renderAll();
