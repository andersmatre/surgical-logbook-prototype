# Surgical logbook — prototype v0.2 (login and sync)

An installable web app (PWA) for logging surgical procedures on a tablet, plus a small server
for accounts and sync. Students log in with the **candidate number** they get from CapaCare and a
password, on any tablet. The logbook works without internet; entries are sent to the server
automatically when there is a connection.

This is a prototype for finding out whether the approach works with real students.
It is not production software (see "Known limits").

## How it works

- **Accounts.** The app never creates accounts. CapaCare provides candidate numbers; an administrator
  creates the accounts on the server (`admin.js`) and gets one initial password per candidate to hand out.
  At the first login the student must choose their own password.
- **Login needs internet** the first time on a tablet. After that the session stays on the tablet
  (120 days of inactivity), so the logbook opens and works offline for weeks.
- **Entries are an append-only event log** (entry, void, sign). Nothing is edited or overwritten, so syncing
  is just "send what the server has not confirmed, fetch what this tablet has not seen". Sending twice is harmless.
- **Any tablet.** Log in on a new tablet and the whole history is fetched from the server.
- **Separate data per student** on a tablet. Logging out removes that student's data from the tablet
  (after warning if something has not been sent yet). Changing the password logs out all other tablets.
- **Accounts hold only a candidate number**, no names, no e-mail. Entries contain no patient identifiers and no free text.

## Run it locally (needs Node 22.13 or newer, nothing to install)

    npm run admin -- add CC1234        # prints the initial password once
    npm start                          # app and API on http://localhost:8080

Open http://localhost:8080, log in as `CC1234` with the printed password.
The database is `./data/logbook.db`.

## Accounts (administrator)

    npm run admin -- add CC1234 [--password x]   one account
    npm run admin -- import candidates.csv       many (first column = candidate number)
    npm run admin -- reset CC1234                new initial password, logs the student out everywhere
    npm run admin -- disable CC1234 | enable CC1234
    npm run admin -- revoke CC1234               log out everywhere (lost or stolen tablet)
    npm run admin -- list

Initial passwords are printed once on screen as CSV. Hand them to students through CapaCare, one at a time,
not in a group chat. They only work for the first login.

## Deploy

The server is one Node process plus one SQLite file, so any host that runs a container with a
**persistent volume** and gives you **HTTPS** works. Choose a region in the EU/EEA. Examples to look at:
Fly.io, Render, Railway, or a small VPS behind Caddy. (The Dockerfile has not been run on a host yet.)

    docker build -t logbook .
    docker run -p 8080:8080 -v logbook-data:/data logbook
    docker exec <container> node server/admin.js add CC1234

The container serves the app too, so the whole thing lives at one address. Install on the tablets from that address.

**If the app stays on GitHub Pages** instead: set `API_BASE` in `config.js` to the server address and start the
server with `ALLOWED_ORIGIN=https://<user>.github.io` (use `SERVE_STATIC=0` if you do not want it to serve the app too).
Keep v0.1 on `main` until the server is live: v0.2 without a server cannot log in.

Environment variables: `PORT` (8080), `HOST`, `LOGBOOK_DB` (`./data/logbook.db`), `ALLOWED_ORIGIN`, `SERVE_STATIC` (`0` to turn off).

**Backups.** Everything is in the database file. Take regular copies while the server runs with
`sqlite3 logbook.db ".backup backup.db"`, or use volume snapshots from the host. Test a restore once.

## Install on a Samsung tablet

Open the address in Chrome, menu (three dots), "Add to Home screen" / "Install app". Log in once while online.

## Known limits (read before real use)

- **Supervisor sign-off is still a demo.** PINs are checked on the device, and the server accepts the signature
  without verifying it, so a signature proves nothing yet. Real sign-off needs supervisor accounts.
- **No password reset by the student.** A forgotten password means asking the administrator for `reset`.
  There is no e-mail flow, on purpose: e-mail is little used.
- **Login throttling** is in server memory (5 wrong attempts lock a candidate number for 10 minutes) and resets when the server restarts.
  There is no per-IP limit and no two-factor login.
- **Passwords travel as plain text inside HTTPS.** Never run the server without HTTPS outside your own computer.
- **No admin screen.** Accounts are managed from the command line.
- **A tablet is trusted once logged in.** Anyone with an unlocked tablet can read and add entries. A screen lock is the student's job.
- **Data protection is not settled.** The server now holds performance data about named-by-number students. Decide who the data controller is,
  where it is hosted, and get the ethics and data-protection review before real data is collected.
- Targets and the "more procedures" list are placeholders in `config.js`.

## Tests

    npm install
    npm test

`core.test.mjs` (data layer), `server.test.mjs` (login, lock-out, password rules, sync, isolation, validation, paging),
`ui.test.mjs` (the whole student flow in jsdom against a real server, including logging in on a "new tablet").
They do not replace trying the app on a real tablet.

## Files

| File | Purpose |
|---|---|
| `config.js` | Procedures, targets, hospitals, demo supervisors, `API_BASE`. Edit here. |
| `core.js` | Local event log in IndexedDB (one database per student), summaries, metrics. |
| `api.js` | Calls to the server. |
| `app.js`, `style.css` | The interface. |
| `sw.js`, `manifest.webmanifest` | Offline cache and installability. |
| `server/` | `app.js` (HTTP API), `lib.js` (database, passwords, validation), `admin.js`, `index.js`. |

## Next

Supervisor accounts and server-verified signatures, a supervisor overview, an admin screen,
audit sample against the operating register, research export with approval.
