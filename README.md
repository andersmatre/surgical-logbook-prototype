# Surgical logbook — prototype v0.1

A static, installable web app (PWA) for logging surgical procedures on a tablet.
It works without internet, keeps all data on the device, and needs no server.
Purpose of v0.1: find out quickly, with real students, whether this is a better
logbook than the current one. It is not production software.

## What v0.1 does

- Log a procedure in two taps: procedure, then role (observing, assisting, surgeon supervised, surgeon independent). Date defaults to today. Undo for 6 seconds.
- Ten large buttons for the ten most common procedures in 2025 (CapaCare annual report), plus a searchable list for the rest.
- Progress per procedure against targets, weekly summary (numbers only) that can be shared on WhatsApp.
- Supervisor sign-off: the supervisor picks their name, types a PIN on the student's tablet, and ticks the entries to sign. Works offline.
- Fully offline after the first load. Data lives in IndexedDB; the app asks the browser for persistent storage.
- "Export test data" produces a JSON file (all events plus usage metrics) that testers can send on WhatsApp.
- Entries are an append-only event log: nothing is edited or deleted, a void or sign event is added on top. This is what makes real sync simple later.

## What v0.1 deliberately does not do

- No server and no real sync. The sync button is simulated.
- No real security. Demo supervisor PINs (1111, 2222) are checked on the device. Real sign-off needs server-side verification and signatures.
- No patient identifiers, no free text, no photos. Keep it that way.
- Targets and the "more procedures" list are placeholders in `config.js`. Replace them with the real STP training manual.
- No supervisor dashboard, no research export, no automatic WhatsApp messages.

## Run it locally

    python3 -m http.server 8080      # then open http://localhost:8080

Service workers and installation only work on `https://` or `localhost`. To test on a tablet you need to deploy it.

## Deploy (any static host with HTTPS)

Copy these files: `index.html app.js core.js config.js style.css sw.js manifest.webmanifest icon-192.png icon-512.png`.
Not `node_modules`, not `test/`.

- GitHub Pages: push to a repository, enable Pages. The files can sit in a sub-folder; all paths are relative.
- Cloudflare Pages or Netlify: drag the folder in.

To ship an update: change `CACHE` in `sw.js` (for example `logbook-v0.1.1`) and redeploy. Testers get a message to reopen the app.

## Install on a Samsung tablet

Open the link in Chrome, menu (three dots), "Add to Home screen" / "Install app". Samsung Internet: menu, "Add page to", "Home screen". Open it once while online so the app is cached, then it works offline.

## What it measures (for the go/no-go decision)

The export contains, per tester:

- median time from tapping a procedure to the entry being saved
- number of entries, days with entries, late entries, entries logged while offline
- number of undos, app opens, signed entries

## Tests

    npm install
    npm test

`core.test.mjs` tests the data layer. `ui.test.mjs` runs the whole user flow in jsdom.
Neither replaces trying it on a real tablet.

## Files

| File | Purpose |
|---|---|
| `config.js` | Procedures, roles, targets, hospitals, demo supervisors. Edit here. |
| `core.js` | Event log in IndexedDB, derived state, summaries, metrics. No DOM. |
| `app.js` | The interface. |
| `style.css` | Styling: large touch targets, high contrast. |
| `sw.js`, `manifest.webmanifest` | Offline cache and installability. |

## Next (v0.2, only if the test is positive)

Server with real sync and individual logins, server-verified supervisor signatures, supervisor overview, audit sample against the operating register, ethics and data-protection review before any real data is collected centrally.
