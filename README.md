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

## How to run

No build step, no server, no account. Just open the file:

```
open index.html        # macOS
# or double-click index.html in any browser
```

Everything is saved locally in your browser (via `localStorage`), so your data
stays on your device.

## Files

| File         | Purpose                                             |
|--------------|-----------------------------------------------------|
| `index.html` | Page structure and modals                           |
| `styles.css` | Styling (responsive — works on tablet and desktop)  |
| `app.js`     | All logic: data, rendering, status tracking, history|

## Ideas for next steps

- Export/import data as a file (for backup or sharing between trustees)
- Pre-filled WhatsApp "reply" links per contact
- Due dates / reminders on open requests
- A proper backend + login so multiple trustees share one dataset

---

*This started as a demo for a 35-unit complex. Adjust the seed data in `app.js`
or just add your real units from the UI.*
