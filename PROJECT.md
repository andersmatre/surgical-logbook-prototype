# Project guide: surgical logbook

This file travels with the code. Read it first if you are new to the project, want to change something, or are taking the project over.
Keep it true: when you change how something works, change this file in the same commit.

Contents: [1 What this is](#1-what-this-is) · [2 Status](#2-status) · [3 Get it running](#3-get-it-running) · [4 How it fits together](#4-how-it-fits-together) · [5 The rules the design depends on](#5-the-rules-the-design-depends-on) · [6 Files](#6-files) · [7 Data](#7-data) · [8 Server API](#8-server-api) · [9 Security and privacy](#9-security-and-privacy) · [10 How to make changes](#10-how-to-make-changes) · [11 Running it](#11-running-it) · [12 Decisions and why](#12-decisions-and-why) · [13 Known limits](#13-known-limits) · [14 Open questions for CapaCare](#14-open-questions-for-capacare) · [15 Next steps](#15-next-steps) · [16 Handing the project over](#16-handing-the-project-over) · [17 Working with an AI assistant](#17-working-with-an-ai-assistant)

---

## 1. What this is

A logbook for surgical training in Sierra Leone, built for CapaCare's Surgical Training Programme (STP). Students log each procedure they did or saw, supervisors check and sign, and the data can later be used for research.
It is a **prototype to find out whether a better logbook than the existing CheckWare e-logbook is possible**. It will only be adopted if it proves better in real use.

Who uses it:

- **Students** (surgical trainees) log procedures on their own Samsung tablet and follow their progress. They log in with the candidate number CapaCare gave them.
- **Supervisors** add the students they supervise and sign the students' procedures.
- **CapaCare / the research team** administer accounts and, later, use the data for research.

The context that shaped every decision:

| Constraint | What it means for the design |
|---|---|
| Low IT literacy | Big buttons, a few taps to log, no jargon, no e-mail flows, no settings |
| Unreliable power and internet | Offline-first: the student app works for weeks without a connection and syncs when it can |
| Everyone has a personal Samsung tablet | An installable web app (PWA) in Chrome, no app store |
| E-mail is little used, WhatsApp is preferred | Accounts use candidate numbers, not e-mail. WhatsApp is only used to *share* a numbers-only weekly summary |
| Earlier systems lacked motivation | Logging must take seconds; students see their own progress towards targets |
| Privacy matters, data is for research | No patient identifiers and no free text anywhere; the server stamps ownership itself; supervisors see only what they need |

## 2. Status

Version **0.5.1**. A working prototype, tested automatically but **not yet used on a real tablet and not yet deployed**.

Works:

- Student app: login with candidate number and password, forced own password at first login, log a procedure in two taps (procedure, then role), undo, history, progress against targets, weekly summary to share on WhatsApp, works offline, installable.
- Sync to the server with automatic retry; log in on any tablet and the history comes back.
- Supervisor accounts: a supervisor logs in with a staff ID, adds students, sees their entries and signs selected ones. The server verifies every signature.
- Administrator accounts and screens (no shell needed): overview of every procedure across all students, a matrix per student, user list, add many students at once, new password, disable, log out everywhere, assign supervisors, a log of recent changes. The first administrator is created from environment variables (`ADMIN_ID`, `ADMIN_PASSWORD`, see `DEPLOY.md`).
- Students can have a name next to the candidate number (administrators set it; the student, their supervisors and administrators see it).
- The hospital is stored in every entry. The student sees it when logging (and can change it there) and in the history; administrators get a hospital table and CSV downloads (procedures per student, per hospital, every entry).
- Administrators download a complete database backup from the app and are reminded when none has been taken for a week.
- Admin from the command line as a fallback: create accounts, assign, reset, disable, revoke, list, backup.
- 48 automated tests, including whole-flow tests of both apps in a simulated browser against a real server.

Placeholders you must replace before real use: the target numbers and the "more procedures" list in `config.js`; the demo hospital list should be checked.

Not done: hosting (see `DEPLOY.md`), research export, offline signing for supervisors, ethics and data-protection approval. See [13](#13-known-limits) and [15](#15-next-steps).

## 3. Get it running

Needs **Node 22.13 or newer**. Nothing else: the server has no runtime dependencies. `npm install` only fetches test tools.

```
npm install                                   # test tools only
npm test                                      # 48 tests, about 1 minute

npm run admin -- add-admin ADMIN-ANDERS --name "Anders"            # prints an initial password; then do everything else in the app
npm run admin -- add-supervisor SUP-ANNA --name "Dr Anna Kamara"   # prints an initial password
npm run admin -- add CC1234                                        # a student; prints an initial password
npm run admin -- assign SUP-ANNA CC1234                            # optional: supervisors can also add students themselves
npm start                                                          # http://localhost:8080 (app and API)
```

`npm run local` does the same with the settings in `local.env`, and `docker compose up --build` runs the real container with a persistent volume (see `DEPLOY.md`, "First rehearse on your own computer").

Open `http://localhost:8080` in Chrome. Log in as `CC1234`, choose a password, log a procedure. Open a second browser profile and log in as `SUP-ANNA` to sign it.
The database is the single file `data/logbook.db` (ignored by git). Delete it to start over.

To try the student app offline: Chrome DevTools, Network tab, "Offline". To try it on a real tablet you need the server reachable over HTTPS (see `DEPLOY.md`); service workers do not run on plain `http://` except on `localhost`.

## 4. How it fits together

```
 Student tablet (Chrome, installed PWA)                 Server (one Node process)            Supervisor tablet
┌────────────────────────────────────────┐          ┌────────────────────────────┐        ┌────────────────────────┐
│ app.js  student screens                │          │ server/app.js  HTTP API    │        │ app.js → supervisor.js │
│ core.js event log in IndexedDB         │  HTTPS   │ server/lib.js  rules + DB  │ HTTPS  │ no data stored locally │
│   (one database per student)           │◄────────►│ SQLite file  data/logbook.db│◄──────►│ online only            │
│ api.js  sync, login                    │  /api/*  │ server/admin.js  CLI       │ /api/* │                        │
│ sw.js   offline cache of the app files │          └────────────────────────────┘        └────────────────────────┘
└────────────────────────────────────────┘
```

**Entry flow.** The student taps a procedure and a role. `core.logEntry` writes an `entry` event to IndexedDB at once (works offline). A moment later `syncCore` (in `app.js`) sends every event the server has not confirmed (at most 200 per request) and pulls everything new. Confirmed ids go in the local `sent` store, which is what the "N to sync" counter is based on.

**Signing flow.** The supervisor opens a student, ticks entries, confirms. `POST /api/sup/sign` makes the server check that the supervisor is assigned to that student and that each entry exists, is not deleted and is not already signed. For each one it writes a `sign` event into the *student's* event stream. The student's tablet receives it with its next sync, like any other event.

**New tablet.** Login returns a token. The first sync starts at cursor 0 and the server returns the whole history in pages of 500. Everything the student ever logged reappears.

**Updates.** The server also serves the app files. A new version is a redeploy; tablets pick it up the next time they open the app with internet (see [10.2](#102-release-a-new-version)).

## 5. The rules the design depends on

Read these before changing anything. Most bugs in this kind of system come from breaking one.

1. **The event log is append-only.** Entries are never edited or deleted. A mistake is a `void` event on top; a signature is a `sign` event on top. The current state (`derive()` in `core.js`) is computed from the log. That is what makes offline use and sync conflict-free: two tablets can never overwrite each other, they only add events. If you feel the need for "update entry", add a new event type instead.
2. **Event ids are unique and the server is idempotent.** Ids are UUIDs made on the device. The server stores `(owner, id)` once (`INSERT OR IGNORE`), so sending the same event twice is harmless. This is why retrying is always safe.
3. **Never trust the client.** `validateEvent` in `server/lib.js` copies only whitelisted fields and sets the owner to the logged-in account itself. A new field that is not added there is **silently dropped**, not rejected.
4. **Students cannot create signatures.** `sign` events from a student's sync are refused (`sign_not_allowed`). Only `/api/sup/sign` creates them, after checking the assignment.
5. **A signed entry is locked.** A `void` for a signed entry is refused (`signed_locked`) and the tablet forgets the delete (`dropEvent`).
6. **Content lives in `config.js`, logic in the other files.** Procedures, roles, targets and hospitals are data. Do not hide them in code.
7. **No patient identifiers, no free text.** Not in the UI, not in events. If you add a field, make it a choice from a fixed list or a number. This is the main privacy protection and it is also what makes the system acceptable to run.
8. **Ids are forever.** A procedure id (for example `cs`) is stored in every entry. Never rename, reuse or delete one. Role ids likewise.
9. **The database only grows by addition.** See [10.6](#106-change-the-database).
10. **Zero server dependencies, no build step.** Keep it that way unless there is a strong reason: it keeps the project easy to read, run and hand over.

## 6. Files

| File | Purpose |
|---|---|
| `index.html`, `manifest.webmanifest`, `icon-*.png` | The page that loads the app; install metadata. |
| `config.js` | **Content to edit**: version, server address, procedures, roles, targets, hospitals. |
| `core.js` | Student data layer. IndexedDB event log, `derive`, progress, weekly summary, sync bookkeeping, test metrics and export. No DOM, so it can be tested in Node. |
| `api.js` | Every call to the server, as a function. Turns failures into `ApiError` with a message that can be shown as is. Also the `?api=http://localhost:...` override that lets the hosted app talk to a server on the tester's own computer (localhost only, by design). |
| `ui.js` | Shared interface pieces: the `h()` DOM helper, toast, sheets (modals), the password form. |
| `app.js` | Entry point. Decides what to show (login, forced password, hospital, student tabs, or the supervisor screens). Student screens and sync live here. |
| `supervisor.js` | The supervisor screens: My students, Add students, one student with signing, More. |
| `administrator.js` | The administrator screens: Overview (procedures across all students, per-student matrix, recent changes), Users, Add users, More. |
| `style.css` | All styling. Large touch targets; colours are variables at the top. |
| `sw.js` | Service worker: caches the app files so it opens offline. **Change `CACHE` on every release.** |
| `server/index.js` | Starts the server from environment variables. |
| `server/app.js` | The HTTP API and static file serving. |
| `server/lib.js` | Database schema and upgrades, passwords, account functions, assignments, event validation, signing. No HTTP. |
| `server/admin.js` | Command-line administration (the same operations as the administrator screens, for when the app cannot be used). |
| `Dockerfile`, `.dockerignore` | One container with server and app. Untested on a real host. |
| `docker-compose.yml`, `local.env` | Run the container (or the plain server) on your own computer with production-like settings. |
| `test/*.test.mjs` | `core` (data layer), `server` (API and rules), `api` (the localhost-only server override), `ui` (student flow), `ui-supervisor` (supervisor flow), `ui-admin` (administrator flow), `files` (file lists stay in step). |
| `README.md` | Short overview. `DEPLOY.md` hosting guide. `TESTER-GUIDE.md` instructions for people trying the app. |
| `CLAUDE.md` | Short instructions for AI assistants working in this repository. |

Rough size: about 2,300 lines of code (plus 160 lines of CSS) and 1,000 lines of tests.

## 7. Data

### 7.1 On the server (SQLite, `data/logbook.db`)

| Table | Holds |
|---|---|
| `users` | `candidate` (the account id: candidate number for students, staff ID for supervisors; the column keeps its first name), `pw_hash` (scrypt), `must_change` (initial password still in use), `disabled`, `role` (`student` or `supervisor`), `display_name` (supervisors only, shown to students next to a signature), `created_at`, `last_login_at`. |
| `sessions` | `token_hash` (SHA-256 of a random token; the token itself is never stored), `candidate`, `created_at`, `last_seen`. |
| `events` | `seq` (increasing number, the sync cursor), `owner` (always the **student** the event is about), `id`, `type`, `target`, `payload` (the whole event as JSON), `received_at`. `UNIQUE(owner, id)`. `type` and `target` are copies of fields inside `payload`, kept so they can be queried. |
| `assignments` | `supervisor`, `student`, `created_at`. Many-to-many: a student can have several supervisors. |

### 7.2 Events

Every fact is an event. All have `id`, `type`, `ts` (device clock, ISO time).

| Type | Made by | Extra fields |
|---|---|---|
| `entry` | student tablet | `student`, `hospital`, `procedure`, `role` (`observing`, `assisting`, `supervised`, `independent`), `performed_on` (date the student says), `entered_on` (date it was logged), `ms_to_log` (how long logging took, a usability measurement), `online`, `schema` (1) |
| `void` | student tablet | `target` (an entry id). "Delete". |
| `sign` | **server only** | `target` (an entry id), `supervisor` (account id), `supervisor_name` (name at the time of signing) |

"Performed" in progress counts means role `supervised` or `independent`.
Three clocks exist: `ts` and `entered_on` come from the tablet (can be wrong), `performed_on` is chosen by the student, `received_at` is the server's. Use `received_at` when you need a time you can trust.

### 7.3 On the tablet (IndexedDB)

One database per student: `surgical-logbook-<CANDIDATE>`, version 2, stores `events`, `meta` (hospital, sync cursor, last sync, supervisors list, usage counters) and `sent` (ids the server has confirmed or that came from the server). The login session is in `localStorage` under `logbook.session` as `{candidate, token, must_change, role, name}`.
**Supervisors keep no database**: nothing about students is stored on a supervisor's tablet.
Logging out wipes that student's database (after warning if something was not sent).

## 8. Server API

All calls are `POST` with a JSON body, except `GET /api/health`. Authenticated calls send `Authorization: Bearer <token>`. Errors are `{error: <code>, message: <text for the user>}` with a fitting status. A 401 on an authenticated call means the session ended, and the app returns to the login screen.

| Call | Who | Body | Returns |
|---|---|---|---|
| `GET /api/health` | anyone | | `{ok:true}` (use for monitoring) |
| `POST /api/login` | anyone | `candidate`, `password` | `token`, `candidate`, `role`, `name`, `must_change_password` |
| `POST /api/logout` | any | | `{ok}` |
| `POST /api/password` | any | `old_password`, `new_password` | `{ok}`; logs out the account's other sessions |
| `POST /api/sync` | student, password set | `events` (≤200), `cursor` | `accepted` (ids), `rejected` (`{id, reason}`), `events` (new since cursor, ≤500), `cursor`, `has_more`, `supervisors` |
| `POST /api/sup/students` | supervisor | | `students`: `candidate`, `entries`, `unsigned`, `since`, `last_received` |
| `POST /api/sup/candidates` | supervisor | | `candidates`: `candidate`, `mine` (every active student, to pick from) |
| `POST /api/sup/assign` / `unassign` | supervisor | `candidate` | `{ok}` |
| `POST /api/sup/entries` | supervisor, assigned student | `candidate`, `cursor` | `events` (reduced fields), `cursor`, `has_more` |
| `POST /api/sup/sign` | supervisor, assigned student | `candidate`, `ids` (≤200) | `signed`, `signed_ids`, `skipped` (`{id, reason}`) |
| `POST /api/admin/users` | admin | | `users`: `id`, `role`, `name`, `disabled`, `password_set`, `last_login_at`, `entries`, `supervisors` / `students` |
| `POST /api/admin/stats` | admin | | `totals`, `procedures` (per procedure across students), `students` (per student, per procedure) |
| `POST /api/admin/audit` | admin | | `log`: `at`, `actor`, `action`, `target`, `detail` |
| `POST /api/admin/create` | admin | `role`, `id`, `name` | `id`, `password` (shown once) |
| `POST /api/admin/create_many` | admin | `people` (≤100, each `{id, name?}`; the older `ids` still works) | `created` (`{id, password}`), `skipped` (`{id, reason}`) |
| `POST /api/admin/reset` | admin, not own account | `id` | `id`, `password` (shown once) |
| `POST /api/admin/disable` / `enable` | admin, disable not own account | `id` | `{ok}` |
| `POST /api/admin/revoke` | admin | `id` | `{ok}` |
| `POST /api/admin/rename` | admin | `id`, `name` | `{ok}` |
| `POST /api/admin/export` | admin | `kind` (`procedures`, `hospitals`, `entries`), `delimiter` (`,` or `;`) | a CSV file (UTF-8 with byte order mark; cells starting with `= + - @` are prefixed so spreadsheets do not run them) |
| `POST /api/admin/backup` | admin | | the database file (a consistent copy) |
| `POST /api/admin/assign` / `unassign` | admin | `supervisor`, `student` | `{ok}` |
| `POST /api/admin/entries` | admin | `candidate`, `cursor` | `events`, `cursor`, `has_more` |

Rejection reasons from `/api/sync`: `bad id`, `bad ts`, `bad procedure`, `bad role`, `bad date`, `bad hospital`, `bad ms_to_log`, `bad target`, `unknown type`, `sign_not_allowed`, `signed_locked`.

## 9. Security and privacy

What protects what:

- **Passwords**: scrypt with a random salt, minimum 8 characters, not equal to the account id. The initial password (printed once by `admin.js`) works only until the first password change. Changing the password logs out every other session.
- **Sessions**: random 256-bit tokens, stored only as SHA-256 hashes, valid 365 days since last use (long on purpose: tablets are offline for weeks). When a session is refused, the message says why (ended on the server, account disabled, unused for a year). `disable` and `revoke` end sessions at once.
- **Login attempts**: 5 wrong passwords lock that account id for 10 minutes. The lock is in server memory (lost on restart) and per account id, not per address. Unknown ids take as long to answer as known ones and get the same error message.
- **Isolation**: every query on student data filters on the logged-in account; supervisor calls first check the assignment. Tests cover cross-student and cross-supervisor access.
- **Minimum data**: no patient data. A supervisor sees procedure, role, dates and hospital, not `ms_to_log` or `online`.
- **Transparency**: a student sees the list of supervisors who can see their entries (More tab) and who signed what.
- **Transport**: HTTPS is required. Passwords travel in the request body, protected only by HTTPS. Never run the server on the open internet over plain HTTP.
- **Static files**: the server serves only a fixed list of app files, never the database or server code.

What is *not* protected, honestly:

- A tablet that is unlocked and logged in is trusted. Whoever holds it can read and add that student's entries (or, for a supervisor, sign). The tablet's screen lock is the user's job.
- A signature means "the logged-in supervisor account asked the server to sign this". It is not cryptographic proof, and a supervisor who leaves a tablet unlocked can be signed in. The confirm dialog reduces accidents only.
- Any supervisor can add any student without the student's approval (the student can see it, and an admin can remove it). Whether that is acceptable is a question for CapaCare ([14](#14-open-questions-for-capacare)).
- Every supervisor can list all candidate numbers (to pick students to add).
- "Delete" is a soft delete: voided entries stay in the database. A real erasure request needs a manual database operation.
- Backups contain everything (names, entries, password hashes) and must be protected as much as the live database. An administrator can download one from the app; that download is written to the audit log.
- Student names are personal data about staff-in-training. They are shown to administrators, to the student themselves and to the supervisors who can find or have added the student. They appear in the CSV files. Decide with CapaCare whether names are needed in research exports; the "procedures per hospital" file contains no names.
- The audit log records account changes (create, reset, disable, enable, log out, rename, assign, unassign) with who did it and when; it never holds passwords. It does not record who *read* data.
- An administrator can see every student's entries and give any account (except their own) a new initial password, which is shown once. Keep the number of administrators small and give each person their own account.

Legal and ethical status (not legal advice): the server holds performance data about people identified by candidate number. Before real data is collected someone must be named as data controller; the host must be chosen with data location in mind (EU/EEA recommended); and research use needs ethics approval (in Sierra Leone through the SLESRC) and consent. As of the last check Sierra Leone had a data protection policy (April 2026) but no data protection act; the details should be confirmed locally. WhatsApp Business policy restricts health information, so WhatsApp is used only to share a short numbers-only text.

## 10. How to make changes

Always: make the change, run `npm test`, update this file if behaviour changed, commit.

### 10.1 Change content: procedures, targets, hospitals

Edit `config.js`. Procedure ids must match `^[a-z0-9_]{1,40}$` (the server rejects others). **Never rename or delete an id**; a removed id shows up as its raw id in old entries. To retire a procedure, leave it listed or keep it in `PROCEDURES_OTHER`.
When the real targets are known set `TARGETS_ARE_PLACEHOLDER = false`. Then release ([10.2](#102-release-a-new-version)).

### 10.2 Release a new version

1. Change the version in **four** places: `APP_VERSION` in `config.js`, `version` in `package.json`, `CACHE` in `sw.js` (`logbook-v<version>`), and the line `Version **x.y.z**` in section 2 of this file (check at the same time that the status text there is still true). `test/files.test.mjs` fails if they differ.
2. **Why `CACHE` matters:** the browser only installs a new service worker if `sw.js` itself changed. If you forget, tablets keep serving the old app files from the old cache.
3. If you added an app file: add it to `ASSETS` in `sw.js`, to `STATIC` in `server/app.js` and to the `COPY` line in `Dockerfile`. The same test checks this.
4. `npm test`, commit, deploy (`DEPLOY.md`).
5. Tablets fetch the new version next time the app is opened with internet. They show "App updated, close and reopen it". Old and new app versions share the same server API, so a mixed period is fine as long as you only *add* to the API.

### 10.3 Add a field to an entry

For example "case type". Touch, in this order:

1. `core.js`: add the field in `logEntry` (and think about entries that do not have it: old data will show `undefined`).
2. The UI that collects it (`app.js`).
3. **`server/lib.js` `validateEvent`**: validate it and add it to `clean`. Without this the field is dropped.
4. `supervisorView` in `server/app.js` if supervisors should see it.
5. Bump `schema` in the event if the meaning of existing fields changes.
6. Tests in `core.test.mjs` and `server.test.mjs`. Update section 7.2 here.

Keep the privacy rule: a fixed list or a number, never free text.

### 10.4 Add an event type

Add it to `validateEvent` (decide who may create it; if only the server, return a rejection like `sign` does), handle it in `derive()` if it changes what an entry looks like, add tests. Remember old tablets will simply ignore types they do not know in `derive()`.

### 10.5 Add a server endpoint

In `server/app.js` add a branch in `api()`. Use `authenticate(req)` or `requireSupervisor(req)`; for anything about a student use `assignedStudent(a, body)`. Add a wrapper in `api.js`, a test in `server.test.mjs` (include the "not allowed for this user" case), and a row in the table in section 8 and the comment at the top of `server/app.js`.

### 10.6 Change the database

`initSchema()` in `server/lib.js` runs at every start, on live data. Rules:

- **Only add.** New tables with `CREATE TABLE IF NOT EXISTS`, new columns with `ALTER TABLE ... ADD COLUMN` guarded by the `columns()` check, new indexes with `IF NOT EXISTS`. Never drop or rename; SQLite cannot be rolled back after the file was upgraded.
- Backfill old rows in the same upgrade step if needed (see how `type` and `target` were added).
- Add a test like "a database made by v0.2 is upgraded in place".
- **Take a backup before deploying** an upgrade (`admin.js backup`).

### 10.7 Add a screen

Student: add to `TABS` and `tabContent()` in `app.js`. Supervisor: add to the `tabs` array in `nav()` and to `body()` in `supervisor.js`. Use classes from `style.css`; keep touch targets at least 44 px. Strings are written inline in English; there is no translation layer yet (adding one means extracting the strings first).

### 10.8 Manage accounts (administrator)

Normal route: log in as an administrator and use the screens (Users, Add users). Every action there is written to the audit log. The first administrator is created at startup from `ADMIN_ID` and `ADMIN_PASSWORD` (only if that account does not exist yet).

Fallback, on the machine that has the database (`DEPLOY.md` shows how to get a shell there). Use `npm run admin -- ...` or `node --no-warnings=ExperimentalWarning server/admin.js ...`.

```
add CC1234 [--password x]                 student; prints the initial password once
import candidates.csv                     many students; first column = candidate number
add-supervisor SUP-ANNA --name "Dr Anna K"
add-admin ADMIN-ANDERS --name "Anders"
assign SUP-ANNA CC1234 [CC1235 ...]       or let the supervisor add students in the app
unassign SUP-ANNA CC1234
rename SUP-ANNA "Dr Anna Kamara"
reset CC1234          forgotten password: new initial password, logged out everywhere
disable CC1234 | enable CC1234     leaving the programme: blocks login, keeps the data
revoke CC1234         lost or stolen tablet: logs out everywhere, password stays
list
backup /data/backups/logbook-2026-11-01.db
```

Hand initial passwords to each person through CapaCare, one at a time, not in a group chat. They only work for the first login.
Account ids: 2 to 20 characters, letters, digits, `/`, `_`, `-`. Candidate numbers are case- and space-insensitive (`cc 1234` is `CC1234`). Suggested staff ids: `SUP-` plus a short name.

## 11. Running it

Hosting, updating, backups, restoring and costs are in **`DEPLOY.md`**. The short version:

- It is one Node process and one SQLite file in a directory called `data`. Whatever host you use must keep that directory on a **persistent disk**, serve **HTTPS**, and run exactly **one** copy (SQLite on a single file does not support two servers).
- **Back up regularly** with `admin.js backup` and keep copies somewhere else. **Test a restore once.** The database is the only copy of the research data.
- Environment variables: `PORT` (8080), `HOST` (0.0.0.0), `LOGBOOK_DB` (`./data/logbook.db`), `ALLOWED_ORIGIN` (only if the app is hosted on a different address than the server, for example GitHub Pages), `SERVE_STATIC` (`0` stops the server serving the app files), `ADMIN_ID` and `ADMIN_PASSWORD` (create the first administrator at startup if the account does not exist; remove `ADMIN_PASSWORD` afterwards).
- Use `GET /api/health` for uptime monitoring.
- The Node `sqlite` module is still marked experimental in Node 22, which is why start commands carry `--no-warnings=ExperimentalWarning`. Pin the Node version in the `Dockerfile` and test before upgrading Node.

## 12. Decisions and why

| Decision | Why | Cost / what to revisit |
|---|---|---|
| Installable web app (PWA), not a native app | No app store, works on any Samsung tablet with Chrome, updates by redeploying | The browser can clear its storage (mitigated by the server copy and a persistent-storage request). Revisit if push notifications or camera features become essential. |
| Event log instead of editable records | Conflict-free offline sync, built-in history, simple server | State must be derived; reports need `derive()` logic. |
| Plain JavaScript modules, no framework, no build step | Anyone (and any AI assistant) can read and run it; nothing to compile | `app.js` builds the DOM by hand and will get long; consider splitting by screen or adopting a small library later. |
| Server with no runtime dependencies (`node:http`, `node:sqlite`, `node:crypto`) | Nothing to patch or audit; one file to back up | Needs Node ≥ 22.13; the sqlite module is experimental. Moving to Postgres later is possible: all queries are in `lib.js` and `app.js`. |
| Candidate number + admin-issued password, no e-mail | E-mail is little used; CapaCare already issues candidate numbers | No self-service reset: forgotten password means asking an admin. |
| Long sessions (365 days) | Tablets may be offline for weeks; a session that expires offline would lock students out | A stolen tablet stays logged in until an admin runs `revoke`. |
| Signing done by the server for a logged-in supervisor | Students cannot forge signatures; supervisors use their own account | Not cryptographic; relies on the account and a confirm dialog. |
| Supervisors online only, nothing stored on their tablets | Simple, verifiable, no student data on supervisor devices | Supervisors in poor-signal places cannot sign. See [15](#15-next-steps). |
| Supervisors add students themselves | Asked for by the product owner; low admin work | No approval step. See [14](#14-open-questions-for-capacare). |
| No patient data, no free text | Privacy; keeps the system outside the hardest data rules | Less detail for research; add structured fields instead. |
| WhatsApp only as a share target | WhatsApp is preferred, but its Business policy restricts health information | A summary is plain text the user sends themselves. |

## 13. Known limits

- **Not tried on a real tablet.** Installation, offline behaviour, performance on the actual devices and the look on the real screen are unverified.
- **Not deployed.** The `Dockerfile` and `DEPLOY.md` have not been run on a real host.
- **Supervisors need internet to sign**, and see nothing offline.
- **No password reset without an administrator**, no two-factor login, no per-address rate limiting; the login lock is in memory.
- **Administrators cannot delete accounts**, only disable them (data stays). An administrator cannot reset or disable their own account; another administrator must.
- **No research export yet.** The data is in the `events` table; a pseudonymised export (candidate number replaced by a code) still has to be built and approved.
- **Soft deletes only**; erasure is manual.
- **English only.**
- **Whole history is sent to a new tablet.** Fine for hundreds or a few thousand entries per student; revisit beyond that.
- **Accessibility** has not been checked beyond large touch targets and labels.
- **Targets and the "more procedures" list are placeholders.**
- **Single server, single file.** No redundancy; a failed disk means restoring from the last backup.

## 14. Open questions for CapaCare

These need people, not code. Record the answers here.

1. **Who is the data controller** and where may the data be hosted? Which ethics approval and which consent text apply to research use?
2. **Who creates accounts** and hands out initial passwords (candidate numbers, staff ids)? Who is told when someone leaves?
3. **Who decides which supervisor sees which student?** Self-service (now), student approval, or a coordinator? Should a student be able to remove a supervisor?
4. **Do supervisors need to sign offline?** How reliable is their connection at the hospitals?
5. **What counts as signed?** One supervisor is enough today. Is co-signing needed? Can a signature be withdrawn?
6. **The real procedure list, targets and hospital list** from the STP training manual.
7. **Languages.** English only, or also Krio?
8. **What does "better than the CheckWare logbook" mean?** Suggested measures, most already collected: share of students who log weekly, entries per student per week, median seconds to log (`ms_to_log`), share of entries signed within 14 days, and interviews (questions in `TESTER-GUIDE.md`). Agree thresholds before the trial.
9. **Who runs and pays for the server** after the prototype, and who holds the accounts and backups.
10. **A contact person in Sierra Leone** for remote testing, first set-up and feedback.

## 15. Next steps

In rough order:

1. Deploy (`DEPLOY.md`), then try it on a real tablet with one or two students and one supervisor, with a contact person on site. Fix what you learn before anything else.
2. Replace the placeholder targets and procedure list; check hospitals.
3. Settle the questions in section 14, especially data ownership and ethics.
4. If supervisors cannot rely on internet: let them queue signatures offline and send them later (the token already authorises the call, so the server rule stays the same).
5. Pseudonymised research export, once ethics allows.
6. A supervisor "waiting for signature" summary they can share on WhatsApp.
8. Automated backups to a second location, plus uptime monitoring.
9. Split `app.js` by screen and consider translations if the project grows.

## 16. Handing the project over

If you are taking over, make sure you have:

- [ ] **The repository**: owner or admin rights on GitHub, not only read access. Ideally under an organisation account.
- [ ] **The hosting account**: login, billing, and a second person who can recover it. Do not leave it only in one individual's personal account.
- [ ] **A shell on the server** to run `admin.js` (see `DEPLOY.md`), and the deploy command that has been tried.
- [ ] **The backups**: where they go, who can read them, and the date you last restored one successfully.
- [ ] **Domain / DNS** if one is used, and who can change it.
- [ ] **The account list**: which candidate numbers and staff ids exist (`admin.js list`). Initial passwords are never stored; they are issued with `reset`.
- [ ] **Ethics and data-protection documents**, and who the data controller is.
- [ ] **Contacts** at CapaCare and in Sierra Leone.
- [ ] **A green `npm test`** on your machine.

And read: sections 5 (rules), 9 (security) and 13 (limits) of this file.

## 17. Working with an AI assistant

The project was built with an AI coding assistant and is meant to be maintained that way. What helps:

- Start a session by asking it to read `PROJECT.md` and `CLAUDE.md`.
- Ask for one small change at a time, and ask it to run `npm test` and to update `PROJECT.md`.
- The tests are the safety net: whole-flow tests for both apps and the server rules. A change that needs a test to change deserves a second look.
- Be careful with: the rules in section 5, anything touching `validateEvent`, `initSchema` or authentication, and anything that adds a dependency.
- It cannot test on a real tablet or deploy for you. Real-device checks are yours.
