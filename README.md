# Surgical logbook — prototype (login, sync, supervisor sign-off, administrator screens, downloads)

An installable web app (PWA) for logging surgical procedures on a tablet, plus a small server for accounts, sync and supervisor sign-off.
Built for CapaCare's Surgical Training Programme in Sierra Leone, to find out whether it can be better than the existing e-logbook.

- **Students** log in with the candidate number from CapaCare and a password, on any tablet. They log a procedure with a few taps (procedure, role, optional details), also without internet, and can add what happened to the patient later (follow-up); cases are sent to the server automatically.
- **Supervisors** log in with a candidate number from CapaCare, add the students they supervise, see their cases, sign them and set targets. The server checks every signature.
- **Administrators** log in too: they see all procedures across students and hospitals, add accounts (with names), give new passwords, disable accounts, choose who supervises whom, and download spreadsheets (CSV) and a backup. No command line needed.

This is a prototype; the current version is in section 2 of `PROJECT.md`. It is deployed on Fly.io (see "Current deployment" in `DEPLOY.md`) and works in Chrome on a Windows PC and an iPhone, but it has **not yet been tried on a Samsung tablet**. Read "Known limits" in `PROJECT.md` before real use.

**New to the project? Read [`PROJECT.md`](PROJECT.md).** It explains how things are structured, the rules the design depends on, how to make changes, and what a new maintainer needs.
To put the server online, read [`DEPLOY.md`](DEPLOY.md). Instructions for people trying the app: [`TESTER-GUIDE.md`](TESTER-GUIDE.md).

## Run it locally (Node 22.13 or newer; nothing to install to run)

    npm run admin -- add-admin ADMIN-ANDERS --name "Anders"            # prints an initial password once
    npm start                                                          # app and API on http://localhost:8080

Open http://localhost:8080. Log in as `ADMIN-ANDERS`, choose your own password, and create a supervisor and a student under "Manage users", "Add users". In other browser profiles log in as them: the student logs a procedure, the supervisor adds the student under "Add students" and signs the case.
The database is `./data/logbook.db`.

**Working on the screens?** Run `npm run dev` instead: http://localhost:5173 with demo accounts (password `demo1234`) and a page that reloads when you save a file. See `PROJECT.md`, section 10.9.

## Accounts (administrator)

Normally in the app. The command line does the same and is the fallback:

    npm run admin -- add CC1234 [--password x]          student
    npm run admin -- import candidates.csv              many students (a line each: candidate number, then the name if known)
    npm run admin -- add-supervisor SUP-ANNA --name "Dr Anna K"
    npm run admin -- add-admin ADMIN-ANDERS --name "Anders"
    npm run admin -- assign SUP-ANNA CC1234 CC1235      (supervisors can also add students themselves)
    npm run admin -- unassign SUP-ANNA CC1234
    npm run admin -- reset CC1234                       new initial password, logs the account out everywhere
    npm run admin -- disable CC1234 | enable CC1234
    npm run admin -- revoke CC1234                      log out everywhere (lost or stolen tablet)
    npm run admin -- delete CC1234                      erase a disabled account and all its data for good
    npm run admin -- list
    npm run admin -- backup /data/backups/logbook-2026-11-01.db
    npm run admin -- mark-restored                      after restoring a disk snapshot (not needed for a backup file)

Initial passwords are printed once. Hand them out through CapaCare, one at a time, not in a group chat. They work only for the first login.

## Try it on your own computer like a real server

`docker compose up --build` runs the same container a rented server would, with a persistent volume (`docker-compose.yml`, untested by the author). Without Docker: `npm run local`. Details and limits, and the test mode (`?api=`) for developers: the first section of [`DEPLOY.md`](DEPLOY.md).

## Put it online

The server is one Node process plus one SQLite file. It needs a persistent disk, HTTPS and a single running copy, in an EU/EEA region. [`DEPLOY.md`](DEPLOY.md) has step-by-step guides (Fly.io, or your own server with Docker and Caddy), a checklist for after the first deploy, and backup and restore. The current deployment on Fly.io is built from the `Dockerfile`.

Environment variables: `PORT` (8080), `HOST`, `LOGBOOK_DB` (`./data/logbook.db`), `ALLOWED_ORIGIN`, `SERVE_STATIC` (`0` to turn off serving the app), `ADMIN_ID` and `ADMIN_PASSWORD` (create the first administrator at the first start; remove `ADMIN_PASSWORD` afterwards).

## Install on a Samsung tablet

Open the server's address in Chrome, menu (three dots), "Add to Home screen" / "Install app". Log in once while online.

## Tests

    npm install
    npm test            # 75 tests, about 1 minute

`core` (data layer), `server` (API, login, sync, supervisor rules, upgrade of an old database, backup), `api` (the localhost-only server override), `ui` (the whole student flow in a simulated browser against a real server), `ui-supervisor` (the whole supervisor flow), `ui-admin` (the whole administrator flow), `files` (file lists stay in step), `dev` (the developer tools). They do not replace trying the app on a real tablet.

## Files

| File | Purpose |
|---|---|
| `config.js` | Procedures, roles, hospitals, version, `API_BASE`. Edit content here (targets are set per student by a supervisor in the app). |
| `core.js`, `api.js` | Local event log in IndexedDB; calls to the server. |
| `app.js`, `ui.js`, `supervisor.js`, `administrator.js`, `style.css` | The interface: student app, shared pieces, supervisor and administrator screens. |
| `sw.js`, `manifest.webmanifest` | Offline cache and installability. |
| `dev/` | Developer tools only (dev server with live reload, demo data). Not part of the app. |
| `server/` | `app.js` (HTTP API), `lib.js` (database, passwords, rules), `admin.js`, `index.js`. |
| `PROJECT.md`, `DEPLOY.md`, `CLAUDE.md` | Project guide and handover, hosting guide, instructions for AI assistants. |
