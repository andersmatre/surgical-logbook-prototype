# Project guide: surgical logbook

This file travels with the code. Read it first if you are new to the project, want to change something, or are taking the project over.
Keep it true: when you change how something works, change this file in the same commit.

Contents: [1 What this is](#1-what-this-is) · [2 Status](#2-status) · [3 Get it running](#3-get-it-running) · [4 How it fits together](#4-how-it-fits-together) · [5 The rules the design depends on](#5-the-rules-the-design-depends-on) · [6 Files](#6-files) · [7 Data](#7-data) · [8 Server API](#8-server-api) · [9 Security and privacy](#9-security-and-privacy) · [10 How to make changes](#10-how-to-make-changes) · [11 Running it](#11-running-it) · [12 Decisions and why](#12-decisions-and-why) · [13 Known limits](#13-known-limits) · [14 Open questions for CapaCare](#14-open-questions-for-capacare) · [15 Next steps](#15-next-steps) · [16 Handing the project over](#16-handing-the-project-over) · [17 Working with an AI assistant](#17-working-with-an-ai-assistant) · [18 Screens in detail](#18-screens-in-detail)

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
| E-mail is little used, WhatsApp is preferred | Accounts use candidate numbers, not e-mail. The app needs neither e-mail nor WhatsApp |
| Earlier systems lacked motivation | Logging must take seconds; students see their own progress towards targets |
| Privacy matters, data is for research | No patient identifiers and no free text anywhere; the server stamps ownership itself; supervisors see only what they need |

## 2. Status

Version **0.18.0**. A working prototype, tested automatically and **deployed on Fly.io** (see [11](#11-running-it)), but **not yet used on a Samsung tablet**.

Works (each screen is described in detail in [18](#18-screens-in-detail)):

- **Student app.** Log in with the candidate number and the password from CapaCare, choose your own password at the first login, then the hospital ("Where do you work?"). Four tabs:
  - **New case**: one page, no switch: Operations (the most common ones, and "Find another operation" with every operation from CapaCare's logbook), then Deliveries (every way of giving birth). Tapping a procedure opens one pop-up: hospital and date (filled in), your role, the optional questions of the logbook, and Save. Undo right after saving.
  - **History**: the cases by week, newest first, with filters (procedure, role). A case opens in a pop-up with two tabs, Details and Follow-up. An unsigned case can be deleted there.
  - **Follow-up**: what happened to the patient. It can be added and changed at any time (no time limit since 0.15.0), bit by bit; the case shows when it was last changed, and "View history" shows every change.
  - **Progress**: the targets (the standard for every student, or what a supervisor set for this student), with how many were performed, and the procedures without a target.
  - **More**: the account and hospital, the supervisors, and folded away under "Advanced": data on this device, the version and "Your data".
  It works offline for weeks and can be installed on the home screen.
- **Sync** to the server, by itself: after logging, with automatic retry, and whenever the app comes back on the screen (so signatures and targets arrive without a button). Logging in on another tablet brings the whole history back. A server restored from a backup is noticed and handled (see [4](#4-how-it-fits-together)).
- **Supervisors** log in with a candidate number too (for example `SUP-ANNA`) and add the students they supervise. On a student's page: **To sign** (tick cases and sign them), **Signed**, and **Progress** (the student's progress, and changing the standard targets for this student; where a target differs from the standard, "Standard: N" says so). The server checks every signature. Online only.
- **Administrators** (no shell needed) have four tabs: **Overview** (numbers; students, procedures and hospitals; a page per student), **Manage users** (every account, a pop-up per account, a page to add users, and **Standard targets**: the targets for every student, since 0.18.0), **Download data** (spreadsheets) and **More** (backup, recent changes). The first administrator is created from environment variables (`ADMIN_ID`, `ADMIN_PASSWORD`, see `DEPLOY.md`).
- **Names**: every account can have a name next to the candidate number, set by an administrator.
- **Hospital**: stored in every case. Chosen once per device; it can be changed when logging and under More.
- **Spreadsheets** (CSV) for administrators: progress per student, procedures per student and per hospital, every case with every answer, and a codebook. Anonymous (codes instead of people) or with names.
- **Backups**: a complete copy of the database, downloaded from the app, with a reminder when none has been taken for a week.
- **Command line** fallback for every account task (`server/admin.js`, see [10.8](#108-manage-accounts-administrator)).
- **Privacy notice** ("Your data") at the first login and under More, worded for each role (final since 0.17.14). Administrators can erase a disabled account and its data for good.
- **81 automated tests**, including whole-flow tests of all three apps in a simulated browser against a real server.
- **Dev server** with live reload and demo data (`npm run dev`, see [3](#3-get-it-running) and [10.9](#109-front-end-work-with-the-dev-server)). It is a tool for the developer, not part of the app.

Targets are set in the app: standard targets for every student by an administrator, changed for one student by a supervisor where needed (there are no example targets). Placeholders: the procedure list, the hospital list, the role definitions and the detail and follow-up questions (`DETAIL_FIELDS`, `FOLLOWUP_FIELDS`: everything the surgical and obstetric logbooks asked, except what identifies the patient; to be cut down after trying it) come from CapaCare's logbook (`Logbook_softcopy_2021.xlsx`, not in the repository); the hospital list is from 2021 and should be checked. Added in 0.14.0 and still to be confirmed by CapaCare ([14](#14-open-questions-for-capacare)): fewer questions for small procedures, "Side" and "Mesh used" for some operations, no question about the sex where the procedure gives it, and the complications at a birth asked when logging it instead of in the follow-up.

Not done: trying it on a real Samsung tablet, approval of the research export, offline signing for supervisors, ethics and data-protection approval. See [13](#13-known-limits) and [15](#15-next-steps).

## 3. Get it running

Needs **Node 22.13 or newer**. Nothing else: the server has no runtime dependencies. `npm install` only fetches test tools.

```
npm install                                   # test tools only
npm test                                      # 81 tests, about 1 minute

npm run admin -- add-admin ADMIN-ANDERS --name "Anders"            # prints an initial password; then do everything else in the app
npm run admin -- add-supervisor SUP-ANNA --name "Dr Anna Kamara"   # prints an initial password
npm run admin -- add CC1234                                        # a student; prints an initial password
npm run admin -- assign SUP-ANNA CC1234                            # optional: supervisors can also add students themselves
npm start                                                          # http://localhost:8080 (app and API)
```

`npm run local` does the same with the settings in `local.env`, and `docker compose up --build` runs the real container with a persistent volume (see `DEPLOY.md`, "First rehearse on your own computer").

Open `http://localhost:8080` in Chrome. Log in as `CC1234`, choose a password, log a procedure. Open a second browser profile and log in as `SUP-ANNA` to sign it.
The database is the single file `data/logbook.db` (ignored by git). Delete it to start over.

**Working on the screens?** Use the dev server instead of `npm start`: `npm run dev` opens http://localhost:5173 with demo accounts (password `demo1234`) and reloads the page whenever you save a file. See [10.9](#109-front-end-work-with-the-dev-server).

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

**Entry flow.** The student taps a procedure. One pop-up (`openEntrySheet` in `app.js`) shows the hospital and date (filled in, with Change: the hospital opens a menu over the page (`hospitalPicker`, also under More: a white box with a search field and a button per hospital; one tap chooses; ×, "Change" again, Escape or a tap outside close it); the date opens the device calendar and a second press closes it (`dateToggle`); on a touch screen the invisible date field lies on top of the button because iOS only opens it from a real tap, with a mouse the button gets the click), the role (required: until one is chosen the Save button reads "Choose your role"; each role has a line in two short sentences, what I did and what the senior did, and a small box on the right, in the middle of its height (under the text once the text would wrap beside it, as on a phone; then all four move together, `stackTagsTogether` in `app.js`), Scrubbed (light blue) or Not scrubbed (grey), for a delivery that is not an operation Hands on or Hands off: `hint`, `tag` and `tagOn` in `ROLES`; one role per row on every screen, so each fits on one line; a delivery that is not an operation words the roles as the obstetric logbook does, "Delivered, supervised" / "Delivered alone", see `rolesFor` in `config.js`; the stored role ids are the same) and the optional detail questions for that procedure (which questions: `detailFieldsFor` in `config.js`, see [18.2](#182-student-app)). Save stays in view at the bottom. A thin grey line always runs along the top edge of Cancel and Save (also when scrolled to the end), and once scrolled down a line under a fixed heading too: the content is cut off cleanly at the line, like under the white bar on a supervisor's To sign page; no fade, no arrow or button (a scroll button sometimes went too far; a tap goes through the line to what is under it) (`scrollHint` in `ui.js`, also in the hospital menu and the list of all operations). A number that is not allowed (an age of 150) gets a red frame and the message right under it, and the form scrolls there, so it is never out of sight at the bottom. If a question on screen has no answer, Save first asks "N questions have no answer. Save anyway?" on top of the pop-up (`confirmOver` in `ui.js`; "Go back" keeps everything and scrolls to the first one). A follow-up does not ask, because it is meant to be filled in bit by bit. All choices, here and in the follow-up, use the same buttons (`choices()`): white, and filled with the main colour when chosen. `core.logEntry` writes an `entry` event to IndexedDB at once (works offline). A moment later `syncCore` (in `app.js`) sends every event the server has not confirmed (at most 200 per request) and pulls everything new. Confirmed ids go in the local `sent` store, which is what the "N to sync" counter is based on.

**Follow-up flow.** In History, every case has "Add follow-up" in its pop-up, at any time after the operation and whether or not it is signed (there was a 6-week limit until 0.14.3; it was removed in 0.15.0, with the "Follow-up closed" tag and text and "missed" in the spreadsheet; how late an answer came is in `followup_day` in the spreadsheet). History has no switch for the cases without a follow-up (it was removed in 0.15.3: with no time limit it was not needed). Its form (`openFollowUp` in `app.js`) is headed like the case pop-up (the procedure, a grey line with your role and the date, the hospital on a line of its own; it stays at the top) with a round arrow before it, then laid out like the pop-up for a new case: a grey line ("Tap only what you know now. You can add more later."), the questions in parts named and worded like the details, each a white card on the grey pop-up with a heading (Patient or Mother; at a delivery a card "Baby" (Outcome, and Days from birth until death after "Died"), "Second baby" and "Third baby" for twins and triplets, only for a baby that was born alive as far as the details say (`followupFieldsFor(procedure, details)`: by the number of babies and "Outcome at birth"; a stillbirth is already in the details); Complications (an operation: wound infection, back to theatre; the complications at the birth itself are asked when the birth is logged); Hospital stay: `FOLLOWUP_…` in `config.js`), with short labels (Outcome, Days from operation until death, Wound infection, Back to theatre, Days in hospital after the operation; counted from the birth at a delivery that is not an operation) and no "?", and only Save at the bottom (with nothing changed, Save just closes it, as after saving); the arrow goes back to the case's Follow-up tab. The answers that changed are saved as a `followup` event on top of the entry and synced like any other event; Save with nothing changed saves nothing. These events are the log of changes: `followUpLog` in `config.js` replays them and says what each one changed (from which answer to which, and when), leaving out a follow-up that changed nothing (the same answer again, for example from a second tablet). Under the answers the case's Follow-up tab says "Added 5 Nov" (one change) or "Last updated 12 Nov" (the day of the newest real change), and with more than one change a quiet grey "View history" that folds open the log under it, newest first (`followUpHistory` in `ui.js`). The spreadsheet's `followup_on` uses the same log, and the whole log is in the "Follow-up changes" file (`followups`, since 0.16.0). `derive()` merges an entry's follow-ups, the newest answer to each question winning, into `entry.outcome`, without the answers to questions that would no longer be asked (`shownAnswers` in `config.js`: after "Died" was changed to "Alive", the days until death and the cause no longer count; the spreadsheet does the same). Undo is a `void` of the follow-up.

**Signing flow.** The supervisor opens a student, ticks cases on To sign, confirms. `POST /api/sup/sign` makes the server check that the supervisor is assigned to that student and that each entry exists, is not deleted and is not already signed. For each one it writes a `sign` event into the *student's* event stream. The student's tablet receives it with its next sync, like any other event.

**Targets flow.** Targets come in two layers (since 0.18.0), so a supervisor does not have to set the same targets for every student:
- **Standard targets**, for every student, set by an administrator: Manage users, "Standard targets" (`openStandardTargets` in `administrator.js`). `POST /api/admin/set_standard_targets` checks them like a supervisor's (below) and adds a row per change to the `standard_targets` table (`setStandardTargets` in `server/lib.js`; the newest row per procedure counts, 0 removes it; also in the administrators' log). They are not events in a student's stream: every sync sends the whole set (`standard_targets`), and the tablet keeps it in `meta` for offline use; a supervisor's and administrator's page of a student gets it with the entries.
- **A student's own targets**, set by a supervisor where the student needs something else. On a student's page, under the tab "Progress", the supervisor sees the student's progress as the student does (each target with how many were performed, then the procedures without one; where the student's target differs from the standard, "Standard: N" or "Standard: none" at the end of its grey line) and "Set targets" / "Change targets" at the top.

Both use the same pop-up (`openTargetsSheet` in `ui.js`): every procedure that can be logged (`TARGET_PROCEDURES` in `config.js`, those on the New case tab first), a search and a number field each, the targets in force filled in (for a student: the standard, with what was changed); empty or 0 is no target. For a student, a grey "Standard: N" (or "Standard: none") stands beside a number that differs from the standard, updated while typing. `POST /api/sup/targets` makes the server check the assignment, that each procedure is offered and that each number is a whole number from 0 to `MAX_TARGET` (500), all or nothing, and writes a `target` event into the *student's* event stream for each target that differs from the one in force (`setTargets` in `server/lib.js`; also in the administrators' log). A number equal to the standard is stored as "follow the standard" (`count` 0), so a later change of the standard reaches that student too; 0 where there is a standard is stored with `none` (no target for this student, whatever the standard says). The student's tablet receives them with its next sync, like a signature; `core.targets(events, standard)` works out the targets in force: the standard, then per procedure the newest `target` event (`count` > 0 replaces the standard, `none` removes it, `count` 0 alone leaves the standard; with several supervisors the last change counts). The server does the same in `currentTargets`. A student whose supervisor set a different number keeps it when the standard changes. Nothing is ever edited: changing a target adds an event (or a row).

**New tablet.** Login returns a token. The first sync starts at cursor 0 and the server returns the whole history in pages of 500. Everything the student ever logged reappears.

**After a restore.** Every database has an id (`db_id` in the `settings` table, `databaseId` in `server/lib.js`), sent with every sync; each backup copy gets a new one (`backupTo`), and `admin.js mark-restored` gives one to a disk snapshot. A tablet remembers the id. When it changes, the server was restored and has lost what came after the backup, while the tablet had marked it as sent and its cursor may be past the server's newest event. So the tablet starts over (`syncCore` in `app.js`, `restartSync` in `core.js`): it forgets what was sent, sends all the student's own events again (the server stores each once, so this is harmless), and fetches everything from cursor 0. Signatures and targets are not sent again (only the server makes them); once everything is fetched, those the server no longer has are removed from the tablet (`dropServerEventsExcept`), so the student sees what the server has and the supervisor signs again. Until that is finished `resync` stays in `meta`, so an interrupted sync starts over.

**Updates.** The server also serves the app files. A new version is a redeploy; tablets pick it up the next time they open the app with internet, and say "A new version is ready" with a Restart button, which stays until it is tapped (see [10.2](#102-release-a-new-version)).

## 5. The rules the design depends on

Read these before changing anything. Most bugs in this kind of system come from breaking one.

1. **The event log is append-only.** Entries are never edited or deleted. A mistake is a `void` event on top; a signature is a `sign` event on top. The current state (`derive()` in `core.js`) is computed from the log. That is what makes offline use and sync conflict-free: two tablets can never overwrite each other, they only add events. If you feel the need for "update entry", add a new event type instead. **The one exception** is erasing a person on request (GDPR): an administrator can delete a whole account, only after disabling it, and `deleteUser` in `server/lib.js` then removes everything that account owns. Never use it to change or remove single entries.
2. **Event ids are unique and the server is idempotent.** Ids are UUIDs made on the device. The server stores `(owner, id)` once (`INSERT OR IGNORE`), so sending the same event twice is harmless. This is why retrying is always safe.
3. **Never trust the client.** `validateEvent` in `server/lib.js` copies only whitelisted fields and sets the owner to the logged-in account itself. A new field that is not added there is **silently dropped**, not rejected.
4. **Students cannot create signatures or targets.** `sign` and `target` events from a student's sync are refused (`sign_not_allowed`, `target_not_allowed`). Only `/api/sup/sign` and `/api/sup/targets` create them, after checking the assignment. Standard targets for every student are not events: only an administrator sets them (`/api/admin/set_standard_targets`).
5. **A signed entry is locked.** A `void` for a signed entry is refused (`signed_locked`) and the tablet forgets the delete (`dropEvent`).
6. **Content lives in `config.js`, logic in the other files.** Procedures, roles and hospitals are data (targets are set in the app: the standard by an administrator, per student by a supervisor). Do not hide them in code.
7. **No patient identifiers, no free text.** Not in the UI, not in events. If you add a field, make it a choice from a fixed list or a number. This is the main privacy protection and it is also what makes the system acceptable to run.
8. **Ids are forever.** A procedure id (for example `cs`) is stored in every entry. Never rename, reuse or delete one. Role ids likewise.
9. **The database only grows by addition.** See [10.6](#106-change-the-database).
10. **Zero server dependencies, no build step.** Keep it that way unless there is a strong reason: it keeps the project easy to read, run and hand over.

## 6. Files

| File | Purpose |
|---|---|
| `index.html`, `manifest.webmanifest`, `icon-*.png` | The page that loads the app; install metadata. |
| `config.js` | **Content to edit**: version, server address, procedures (and which can get a target), roles, the questions and which procedure asks which, hospitals, the privacy notice. |
| `core.js` | Student data layer. IndexedDB event log, `derive`, progress, the targets in force (`targets`), sync bookkeeping, counts. No DOM, so it can be tested in Node. |
| `api.js` | Every call to the server, as a function. Turns failures into `ApiError` with a message that can be shown as is. Also the `?api=http://localhost:...` override that lets the hosted app talk to a server on the tester's own computer (localhost only, by design). |
| `ui.js` | Shared interface pieces: the `h()` DOM helper, toast (and the message that stays, `persist`), sheets (modals) and the pop-up that asks first (`confirmSheet`), times in words (`timeAgo`, `daysAgo`, `fmtDateTime`), the Signed / Not signed yet tag (`signTag`), the password form, the case pop-up (`openCase`) that all three apps share, the short case row of supervisors and administrators (`caseRow`), and the procedure tiles of Progress (`procTile`, `procedureProgress`), which administrators use too, the pop-up to set targets (`openTargetsSheet`: a supervisor's for one student, an administrator's Standard targets), and the "Show only" filter button and pop-up (`filterButton`, `openFilterSheet`) of History and Users, the switch of the supervisor's and administrator's pages (`segSwitch`: tabs like Details and Follow-up in a case, whose blue line slides to the tab that is tapped), and the menu a "Change" button opens (`popMenu`: the hospital, and the file format on Download data), and the big pop-up of one student for supervisors and administrators (`showPanel`, `closePanel`: a layer of its own, `#panel`, under the other pop-ups). |
| `app.js` | Entry point. Decides what to show (login, forced password, hospital, student tabs, or the supervisor screens). Student screens and sync live here. |
| `supervisor.js` | The supervisor screens: My students, Manage students (add and remove), one student (To sign, Signed, Progress with targets), More. |
| `administrator.js` | The administrator screens: Overview (tabs Students, Procedures, Hospitals), a page per student (Cases, Progress), Manage users (the list of accounts, a page to add users, and the Standard targets pop-up), Download data (the spreadsheets), More (backup, recent changes). |
| `style.css` | All styling. Large touch targets; colours are variables at the top. |
| `sw.js` | Service worker: caches the app files so it opens offline. **Change `CACHE` on every release.** |
| `server/index.js` | Starts the server from environment variables. |
| `server/app.js` | The HTTP API and static file serving. |
| `server/lib.js` | Database schema and upgrades, passwords, account functions, assignments, event validation, signing, targets (standard and per student). No HTTP. |
| `server/admin.js` | Command-line administration (the same operations as the administrator screens, for when the app cannot be used). |
| `Dockerfile`, `.dockerignore` | One container with server and app. Built and run by Fly.io for the current deployment. |
| `docker-compose.yml`, `local.env` | Run the container (or the plain server) on your own computer with production-like settings. |
| `dev/dev-server.mjs`, `dev/seed.mjs` | **Developer tools, not part of the app** (not in `sw.js`, `server/app.js` STATIC or the `Dockerfile`, and never deployed). `npm run dev` serves the app with live reload and no caching, plus the real API on `data/dev.db`; `seed.mjs` creates the demo accounts and entries. See [10.9](#109-front-end-work-with-the-dev-server). |
| `test/*.test.mjs` | `core` (data layer), `server` (API and rules), `api` (the localhost-only server override), `ui` (student flow), `ui-supervisor` (supervisor flow), `ui-admin` (administrator flow), `files` (file lists stay in step), `dev` (the developer tools). |
| `README.md` | Short overview. `DEPLOY.md` hosting guide. `TESTER-GUIDE.md` instructions for people trying the app. |
| `CLAUDE.md` | Short instructions for AI assistants working in this repository. |

Rough size: about 3,800 lines of app code, 1,400 lines of server code, 600 lines of CSS and 3,100 lines of tests.

## 7. Data

### 7.1 On the server (SQLite, `data/logbook.db`)

| Table | Holds |
|---|---|
| `users` | `candidate` (the account id, called "candidate number" in the app for everyone, also supervisors and administrators; the column keeps its first name), `pw_hash` (scrypt), `must_change` (initial password still in use), `disabled`, `role` (`student`, `supervisor` or `admin`), `display_name` (the name: a supervisor's is shown to students next to a signature, a student's to the student, their supervisors and administrators, an administrator's only at the top of their own screen; the form for a new administrator therefore says only "Name"), `created_at`, `last_login_at`. |
| `sessions` | `token_hash` (SHA-256 of a random token; the token itself is never stored), `candidate`, `created_at`, `last_seen`. |
| `events` | `seq` (increasing number, the sync cursor), `owner` (always the **student** the event is about), `id`, `type`, `target`, `payload` (the whole event as JSON), `received_at`. `UNIQUE(owner, id)`. `type` and `target` are copies of fields inside `payload`, kept so they can be queried. |
| `assignments` | `supervisor`, `student`, `created_at`. Many-to-many: a student can have several supervisors. |
| `audit` | `id`, `at`, `actor` (an account id, or `cli` / `startup`), `action` (`create`, `reset_password`, `disable`, `enable`, `revoke_sessions`, `delete`, `rename`, `assign`, `unassign`, `set_targets`, `set_standard_targets`, `export`, `backup`, `mark_restored`), `target` (the account it was done to; none for standard targets), `detail`. Who changed accounts and access, and every download; never a password. Shown to administrators as "Recent changes" (the newest 50). |
| `settings` | `key`, `value`. Values about the database itself: `db_id`, the id of this copy of the data (see "After a restore" in [4](#4-how-it-fits-together)), and `pseudonym_key`, the secret behind the codes in the anonymous spreadsheets (never shown; a backup keeps it, so codes stay the same after a restore). |
| `standard_targets` | `seq`, `procedure`, `count` (0 removes it), `set_by` (the administrator's account id), `set_at`. The targets for every student (since 0.18.0). Only added to: the newest row per procedure counts (`standardTargets` in `server/lib.js`), so it is also the history of the standard. |

### 7.2 Events

Every fact is an event. All have `id`, `type`, `ts` (device clock, ISO time).

| Type | Made by | Extra fields |
|---|---|---|
| `entry` | student tablet | `student`, `hospital`, `procedure`, `role` (`observing`, `assisting`, `supervised`, `independent`; ids only, the app shows them in the past tense, "Observed", "Assisted", because everything is logged afterwards, `ROLES` in `config.js`), `performed_on` (date the student says), `entered_on` (date it was logged), `schema` (1), `details` (optional: `{question id: option id or whole number}`, questions from `DETAIL_FIELDS`; left out when nothing was answered; a question hidden by `showIf` is not saved; which questions a procedure asks: `detailFieldsFor` in `config.js`). Entries made by apps older than 0.13.0 also hold `ms_to_log` and `online` (how the app was used); they are no longer collected, stored or shown anywhere, and the server ignores them if an old app still sends them. An app from 0.13.0 on needs a server from 0.13.0 on (older servers refused an entry without `ms_to_log`); they are deployed together, so this only matters with the `?api=` override against an older local server. |
| `followup` | student tablet | `target` (an entry id), `known_on` (the day the student learnt it), `answers` (`{question id: option id}`, questions from `FOLLOWUP_FIELDS`, at least one). Only the answers that changed. At any time after the case; together they are the log of changes ("View history", `followUpLog` in `config.js`). |
| `void` | student tablet | `target` (an entry or follow-up id). "Delete", or Undo of a follow-up. |
| `sign` | **server only** | `target` (an entry id), `supervisor` (account id), `supervisor_name` (name at the time of signing) |
| `target` | **server only** | `procedure` (a procedure id from `TARGET_PROCEDURES`), `count` (how many to perform, 1 to 500; 0: no target of the student's own, so the standard applies, if there is one), `none` (since 0.18.0, with `count` 0: no target for this student, whatever the standard says), `supervisor`, `supervisor_name`. Set by a supervisor for one student, over the standard targets for every student (which are not events, see `standard_targets`); the newest per procedure counts. |

"Performed" in progress counts means role `supervised` or `independent`.
Three clocks exist: `ts` and `entered_on` come from the tablet (can be wrong), `performed_on` is chosen by the student, `received_at` is the server's. Use `received_at` when you need a time you can trust.

### 7.3 On the tablet (IndexedDB)

One database per student: `surgical-logbook-<CANDIDATE>`, version 2, stores `events`, `meta` (hospital, sync cursor, last sync, supervisors list, `standard_targets` (the standard targets for every student, from the last sync), `server_db` (the server's database id at the last sync) and `resync` (true while starting over after a restore)) and `sent` (ids the server has confirmed or that came from the server). The login session is in `localStorage` under `logbook.session` as `{candidate, token, must_change, role, name}`.
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
| `POST /api/sync` | student, password set | `events` (≤200), `cursor` | `accepted` (ids), `rejected` (`{id, reason}`), `events` (new since cursor, ≤500), `cursor`, `has_more`, `supervisors`, `name` (the account's name, so a changed name reaches the tablet), `db_id` (which copy of the data this is; it changes when the server is restored from a backup), `standard_targets` (`{procedure id: number}`, the targets for every student) |
| `POST /api/sup/students` | supervisor | | `students`: `candidate`, `name`, `entries`, `unsigned`, `since`, `last_received` (when the student's tablet last sent something; signatures and targets do not count), `last_logged` (the newest day a case was logged) |
| `POST /api/sup/candidates` | supervisor | | `candidates`: `candidate`, `name`, `mine`, `entries`, `last_received`, `last_logged` (every active student, to pick from; shown like My students) |
| `POST /api/sup/assign` / `unassign` | supervisor | `candidate` | `{ok}` |
| `POST /api/sup/entries` | supervisor, assigned student | `candidate`, `cursor` | `events` (reduced fields), `cursor`, `has_more`, `standard_targets` |
| `POST /api/sup/sign` | supervisor, assigned student | `candidate`, `ids` (≤200) | `signed`, `signed_ids`, `skipped` (`{id, reason}`) |
| `POST /api/sup/targets` | supervisor, assigned student | `candidate`, `targets` (`{procedure id: number}`, the target the student should have, 0 to 500, 0 = no target; the standard number = follow the standard) | `changed` (the procedure ids that changed); 400 `bad_targets` if anything is not allowed (nothing is stored then) |
| `POST /api/admin/users` | admin | | `users`: `id`, `role`, `name`, `disabled`, `password_set`, `last_login_at`, `entries`, `supervisors` / `students` |
| `POST /api/admin/stats` | admin | | `totals`, `procedures` (per procedure across students), `hospitals` (per hospital), `students` (per student, per procedure), `last_backup` |
| `POST /api/admin/audit` | admin | | `log`: `at`, `actor`, `action`, `target`, `detail` |
| `POST /api/admin/create` | admin | `role`, `id`, `name` | `id`, `password` (shown once) |
| `POST /api/admin/create_many` | admin | `people` (≤100, each `{id, name?}`; the older `ids` still works) | `created` (`{id, password}`), `skipped` (`{id, reason}`) |
| `POST /api/admin/reset` | admin, not own account | `id` | `id`, `password` (shown once) |
| `POST /api/admin/disable` / `enable` | admin, disable not own account | `id` | `{ok}` |
| `POST /api/admin/revoke` | admin | `id` | `{ok}`, `sessions` (how many were ended) |
| `POST /api/admin/delete` | admin, not own account, account disabled | `id` | `{ok}`, `events`, `assignments` (how many were removed) |
| `POST /api/admin/rename` | admin | `id`, `name` | `{ok}` |
| `POST /api/admin/export` | admin | `kind` (`progress`, `procedures`, `hospitals`, `entries`, `followups`, `codebook`), `delimiter` (`,` or `;`), `anonymous` (true: codes instead of candidate numbers, names and supervisor ids; not for `hospitals` and `codebook`, which have no people) | a CSV file (`entries` has `role_id` (the stored code) and `role` (in words), one column per detail question, `surgical_apgar` (the three parts added up, empty if one is missing), `followup_status` (done, or open: none yet), one `followup_<id>` column per follow-up question with the newest answer (none for a question no longer asked after a change), `followup_on` and `followup_day`; answers are the stored codes, explained in `codebook`; `procedures` and `hospitals` count `followup_done`, `followup_open`; `followups` (since 0.16.0) has a row per follow-up answer that was added or changed: `entry_id`, the case, `change_no`, `first`, `changed_at`, `known_on`, `followup_day`, `question`, `question_label`, `from`, `to`, built with `followUpLog` like "View history") (UTF-8 with byte order mark; cells starting with `= + - @` are prefixed so spreadsheets do not run them) |
| `POST /api/admin/backup` | admin | | the database file (a consistent copy) |
| `POST /api/admin/assign` / `unassign` | admin | `supervisor`, `student` | `{ok}` |
| `POST /api/admin/entries` | admin | `candidate`, `cursor` | `events`, `cursor`, `has_more`, `standard_targets` |
| `POST /api/admin/standard_targets` | admin | | `targets` (`{procedure id: number}`, the standard targets for every student) |
| `POST /api/admin/set_standard_targets` | admin | `targets` (`{procedure id: number}`, 0 to 500, 0 = no standard target) | `changed`; 400 `bad_targets` as for `sup/targets` |

Rejection reasons from `/api/sync`: `bad id`, `bad ts`, `bad procedure`, `bad role`, `bad date`, `bad hospital`, `bad target`, `bad answers` (a follow-up with no valid answer), `unknown type`, `sign_not_allowed`, `target_not_allowed`, `signed_locked`.
A detail answer that is not allowed (unknown question, option not on the list, number out of range) is dropped from the entry; the entry itself is kept.

## 9. Security and privacy

What protects what:

- **Passwords**: scrypt with a random salt, minimum 8 characters, not equal to the account id. The initial password (printed once by `admin.js`) works only until the first password change. Changing the password logs out every other session.
- **Sessions**: random 256-bit tokens, stored only as SHA-256 hashes, valid 365 days since last use (long on purpose: tablets are offline for weeks). When a session is refused, the message says why (ended on the server, account disabled, unused for a year). `disable` and `revoke` end sessions at once.
- **Login attempts**: 5 wrong passwords lock that account id for 10 minutes. The lock is in server memory (lost on restart) and per account id, not per address. Unknown ids take as long to answer as known ones and get the same error message.
- **Isolation**: every query on student data filters on the logged-in account; supervisor calls first check the assignment. Tests cover cross-student and cross-supervisor access.
- **Minimum data**: no patient identifiers. A supervisor sees procedure, role, dates, hospital, details and follow-ups. How the app is used (seconds to log, offline, undo) is not measured.
- **Outcomes are health data about patients.** Detail and follow-up answers identify no patient on their own, but an operation on a known day at a small hospital with a death recorded could be linked to a person by someone who was there. Keep the questions coarse (fixed lists, no exact times), and settle the ethics and data-protection position on outcomes before real use ([14](#14-open-questions-for-capacare)).
- **Transparency**: a student sees the list of supervisors who can see their cases (More tab) and who signed what.
- **Transport**: HTTPS is required. Passwords travel in the request body, protected only by HTTPS. Never run the server on the open internet over plain HTTP.
- **Static files**: the server serves only a fixed list of app files, never the database or server code.

What is *not* protected, honestly:

- A tablet that is unlocked and logged in is trusted. Whoever holds it can read and add that student's entries (or, for a supervisor, sign). The tablet's screen lock is the user's job.
- A signature means "the logged-in supervisor account asked the server to sign this". It is not cryptographic proof, and a supervisor who leaves a tablet unlocked can be signed in. The confirm dialog reduces accidents only.
- Any supervisor can add any student without the student's approval (the student can see it, and an admin can remove it). Whether that is acceptable is a question for CapaCare ([14](#14-open-questions-for-capacare)).
- Every supervisor can list all candidate numbers (to pick students to add).
- A student's "Delete" is a soft delete: voided entries stay in the database. To erase a person, an administrator disables the account and then deletes it for good (Manage users, or `admin.js delete`). That removes the account, its sessions, its supervisor links and, for a student, every event in their stream including signatures. A supervisor's signatures stay in the students' records, with the supervisor's id and name. SQLite runs with `secure_delete`, so removed data is overwritten in the file. **Backups taken earlier still contain it**, and so do entries still on the student's tablet until they log out there. The audit log keeps the id of the deleted account (who deleted whom, and when), and so does `standard_targets` for an administrator who set standard targets.
- The privacy notice (`PRIVACY` in `config.js`) is final since 0.17.14 (decided by the product owner; until then the app marked it as a draft). Its contact is "your CapaCare coordinator"; it does not name a data controller. If one is decided ([14](#14-open-questions-for-capacare)) or the text changes, change it and release: it is what people were told.
- Backups contain everything (names, entries, password hashes) and must be protected as much as the live database. An administrator can download one from the app; that download is written to the audit log.
- Student names are personal data about staff-in-training. They are shown to administrators, to the student themselves and to the supervisors who can find or have added the student. They appear in the spreadsheet files only when the administrator chooses "With names" (anonymous is chosen again at every login); the "procedures per hospital" file and the codebook never contain names. The anonymous files are pseudonymised, not anonymous in the legal sense: a code always means the same person, and dates and hospitals stay in them, so someone who knows who worked where and when may recognise a person. Treat them as personal data too, and decide with CapaCare which are used for research.
- The audit log records account changes (create, reset, disable, enable, log out, rename, assign, unassign), targets set (for a student and the standard), downloads and backups, with who did it and when; it never holds passwords. It does not record who *read* data.
- An administrator can see every student's entries and give any account (except their own) a new initial password, which is shown once. Keep the number of administrators small and give each person their own account.

Legal and ethical status (not legal advice): the server holds performance data about people identified by candidate number. Before real data is collected someone must be named as data controller; the host must be chosen with data location in mind (EU/EEA recommended); and research use needs ethics approval (in Sierra Leone through the SLESRC) and consent. As of the last check Sierra Leone had a data protection policy (April 2026) but no data protection act; the details should be confirmed locally.

## 10. How to make changes

Always: make the change, run `npm test`, update this file if behaviour changed, commit.

### 10.1 Change content: procedures, targets, hospitals

Edit `config.js`. Procedure ids must match `^[a-z0-9_]{1,40}$` (the server rejects others). **Never rename or delete an id**; a removed id shows up as its raw id in old entries. To stop offering a procedure, move it to `PROCEDURES_RETIRED` (old entries keep its name).
`PROCEDURES` holds every procedure that can be logged. `group` is the surgical group it is listed under in "All operations" (Find another operation; `PROCEDURE_GROUPS`, as in CapaCare's logbook, each with an "Other"); `delivery: true` makes it a way of giving birth. A caesarean has both; a procedure without a group is not an operation and uses the delivery wording of the roles. The rows on the Log tab, under Operations and Deliveries, are `LOG_SURGERY` and `LOG_DELIVERIES` (a procedure in both, the caesarean, is shown once, under Deliveries; together, each once, they come first in the list a supervisor sets targets from). The Progress tab shows the procedures that have a target, then those that have cases. A test in `core.test.mjs` checks that ids are valid and unique and that these lists only name procedures that exist.
Hospitals are stored by name: renaming one leaves old entries with the old name.
Targets are not in `config.js`: they are set in the app, the standard for every student by an administrator (Manage users, Standard targets) and, where a student needs something else, by a supervisor for that student (the targets flow in [4](#4-how-it-fits-together)). `TARGET_PROCEDURES` says which procedures can get a target (every procedure that is offered) and in which order the supervisor sees them; `MAX_TARGET` is the highest number. A new procedure in `PROCEDURES` can get a target at once.

### 10.2 Release a new version

1. Change the version in **four** places: `APP_VERSION` in `config.js`, `version` in `package.json`, `CACHE` in `sw.js` (`logbook-v<version>`), and the line `Version **x.y.z**` in section 2 of this file (check at the same time that the status text there is still true). `test/files.test.mjs` fails if they differ. The app shows the version only under the login form and under More, About (no strip on every screen, so it looks like a finished product).
2. **Why `CACHE` matters:** the browser only installs a new service worker if `sw.js` itself changed. If you forget, tablets keep serving the old app files from the old cache. This also means: **every deploy that changes an app file needs a new version**, even a small fix. Deploying changed files twice under the same version leaves devices that already have that version on their old files. The new cache is always filled with fresh files from the server (`cache: 'reload'` in `sw.js`), never with copies the browser still holds, so old and new files are not mixed.
3. If you added an app file: add it to `ASSETS` in `sw.js`, to `STATIC` in `server/app.js` and to the `COPY` line in `Dockerfile`. The same test checks this.
4. `npm test`, commit, deploy (`DEPLOY.md`).
5. Tablets fetch the new version next time the app is opened with internet. They show "A new version is ready" with a Restart button, which stays until it is tapped. Old and new app versions share the same server API, so a mixed period is fine as long as you only *add* to the API.

**Change the app icon.** The icon is `icon-512.png` and `icon-192.png` (the same picture, 512 and 192 px square PNG; the 192 is also the browser tab icon and the iPhone/iPad home-screen icon). Start from one square picture of at least 1024 px: a solid background to the edges (no transparency, iOS fills it with black), no rounded corners (the device adds them), no text, and everything that matters inside the middle 80 %, because `manifest.webmanifest` marks it `maskable` and Android may crop it to a circle. Since 0.13.6 it is a white clipboard with a dark blue tick and a suture line on the main blue (#1F5FAD). Scale it to both sizes under the **same file names** (then `sw.js`, `server/app.js` and the `Dockerfile` need no change), do not commit the large source picture, and release a new version as above. A device that already installed the app picks the new icon up late: Android Chrome by itself within about a day, an iPhone or iPad only after removing the app from the home screen and adding it again.

### 10.3 Add a field to an entry

For example "case type". Touch, in this order:

1. `core.js`: add the field in `logEntry` (and think about entries that do not have it: old data will show `undefined`).
2. The UI that collects it (`app.js`).
3. **`server/lib.js` `validateEvent`**: validate it and add it to `clean`. Without this the field is dropped.
4. `supervisorView` in `server/app.js` if supervisors should see it.
5. Bump `schema` in the event if the meaning of existing fields changes.
6. Tests in `core.test.mjs` and `server.test.mjs`. Update section 7.2 here.

Keep the privacy rule: a fixed list or a number, never free text.

For a new **detail or follow-up question** none of this is needed: add it to `DETAIL_FIELDS` or `FOLLOWUP_FIELDS` in `config.js` and to a part of the lists below them (each part may word a question differently with `ask`, as the Mother part does for the age; `DETAILS_OPERATION` for operations, `DETAILS_BIRTH` for deliveries, `DETAILS_BIRTH_OPERATION` for a delivery that is an operation, `DETAILS_BY_PROCEDURE` for one procedure, `DETAILS_MINOR` for the small procedures in `MINOR_PROCEDURES`, and the `FOLLOWUP_…` lists likewise; `ASK_SIDE`, `ASK_MESH` and `MALE_ONLY` adjust them per procedure in `detailFieldsFor`). Each part has a heading on the screen. `ask` is the wording on the screen if it differs from `label` (used in summaries); `showIf: {question: [answers]}` asks it only after one of those answers (used for the second and third baby and for the cause of death). `buttons: true` on a number question shows a button per number instead of a field to type in (the Apgar scores at 1 and 5 min, 0 to 10, on one line on a tablet and on two lines on a narrow phone; since 0.17.2); the answer is still stored and checked as a number. The server checks answers against the same lists, and the screens and the CSV columns follow. Question and option ids are stored in events: never rename or reuse one. To stop asking a question, take it out of the parts and mark it `retired` in its field (true, or a line for the codebook): old cases still show it, under "Other", and the codebook says it is no longer asked. Then release.

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

Student: add to `TABS` and `tabContent()` in `app.js`. Supervisor: add to the `tabs` array in `nav()` and to `body()` in `supervisor.js`. Use classes from `style.css`; keep touch targets at least 44 px. The tab bar sits at the top, under the header (both always stay at the top: once logged in the window does not scroll, only the page under them, `appShell()` in `ui.js` and `.shell`; with `position: sticky` or `fixed` an iPhone pulled the header away on long pages and when the page bounced; `pageScroll`/`setPageScroll` keep or reset where the page is scrolled to; the content sits in `.page`, which on a touch screen (`pointer: coarse`) is always 1 px taller than the visible part, so a short page such as Log or More can still be dragged and springs back instead of feeling frozen; with a mouse it is not, so a short page does not move with the wheel; `scrollbar-gutter: stable both-edges` always keeps room for a PC's scrollbar, on both sides so the page stays in the middle under the header, so the page does not jump sideways when it gets long enough to scroll, for example when the hospital menu opens; there are no wide tables any more (they were hard to use on a tablet; if one is ever needed, let it scroll sideways in its own box with `overscroll-behavior-x: none`, or on a phone or tablet it can be pulled past its first column into an empty strip that springs back)); all tabs are equally wide. On a phone or tablet a touch while the page or a pop-up is still scrolling only stops it and the browser sends no click; buttons that stay in place (in `.sheet-foot`, `.sheet-head`, `.top-bar` or `#toast`) are therefore pressed by the touch itself (`pressOnTouch` in `ui.js`), so Cancel and Save always work at once. In a pop-up with buttons at the bottom only the part between its heading and its buttons scrolls (`openSheet` wraps it in `.sheet-body`), so the buttons never move, also not when an iPhone bounces. Put a new button of that kind inside one of these; buttons that scroll with the content keep the browser's normal behaviour. A pop-up fades in as one piece (`#overlay.open` and `.layer` in `style.css`): the dark layer, the pop-up and its arrows together. Do not give `.sheet` a fade of its own (on an iPad the dark layer came first and the pop-up after, which looked like two steps); an edge line fades in (`.fade`, set by `scrollHint`) only when it comes later, not while the pop-up opens. Little bold text: only headings, buttons and what is chosen (the open tab) are semi-bold (600); names, tags and table headings are medium (500); in the pop-up for a new case (and the follow-up) the title and the part headings are medium, the questions a little lighter (475) and the answers between normal and medium (450, the chosen one 550; a font without every weight shows the nearest one); the names in lists (the procedures on the New case tab, the cases in History, the procedures in Progress, students and accounts, and the same in pop-ups: their titles, the rows of All operations, the hospital menu and "Show only", the procedures when setting targets) a little lighter than medium (475, the nearest weight where a font has no 475) and in a soft near-black (`--name`), so they stand out without shouting (18 px), on Log and in History with the same grey line under it (one shared rule in `style.css`, `.proc-name, .e-text > strong, .prow-top > strong` and `.proc-count, .e-sub`), and a label beside its value (Hospital, Age, a question in a case) is plain grey, so the value stands out (the rule is at the top of `style.css`; a lot of bold made the screens harder to read). The More tab looks the same in all three apps: cards with rows, each with its heading inside at the top (Account, Your supervisors, Backup), in the one heading style of the app (see "Headings" in [18.1](#181-shared-by-all-three-apps)) (the label small and grey, the value under it: `fact` in `ui.js`; a person, such as a supervisor, the other way round: the name first), and the rarely needed things folded away at the bottom under "Advanced" (`advancedCard`, with About and "Your data", `privacyFact`; a card that folds open is `foldCard` in `ui.js`; an administrator's Advanced also holds "Recent changes", after About). Do not add `viewport-fit=cover` to `index.html`: on Android Chrome it draws the page under the system gesture bar and leaves an empty white strip at the bottom (a test checks this). Strings are written inline in English; there is no translation layer yet (adding one means extracting the strings first). A page has no heading that repeats the open tab at the top: the tab is its name (since 0.14.2). Parts of a page get small grey headings (`.day-head`), and a page opened from a page (Add users) has its own heading with an arrow back. A list of things goes in a `.list` (one white card, a row per thing; see "Lists, boxes and buttons" in [18.1](#181-shared-by-all-three-apps)); give a row its own box only if it is a choice. A new pop-up follows the pop-up rule in the same place (to read, and a new case or follow-up: `{ cls: 'on-bg' }`, grey with white cards; other forms: white with grey cards; a small question or menu: plain white). One word for one thing on the screens: a logged procedure is a "case" (never "entry"), a tick box is ticked with "Select all" / "Select none", a supervisor "signs". A pop-up that asks before doing something uses `confirmSheet` in `ui.js` (Cancel on the left, the action on the right, like Cancel and Save). Do not give elements class names that look like advertising (`ad`, `adv-…`, `ads`, `sponsor`, `promo`): ad blockers hide them, but usually not on `localhost`, so it only shows up on the live site (this happened to the "Advanced" title, class `adv-text`, in 0.7.1).

### 10.8 Manage accounts (administrator)

Normal route: log in as an administrator and use the screens (Manage users, with its "Add users" page). Every action there is written to the audit log. The first administrator is created at startup from `ADMIN_ID` and `ADMIN_PASSWORD` (only if that account does not exist yet).

Fallback, on the machine that has the database (`DEPLOY.md` shows how to get a shell there). Use `npm run admin -- ...` or `node --no-warnings=ExperimentalWarning server/admin.js ...`.

```
add CC1234 [--password x]                 student; prints the initial password once
import candidates.csv                     many students; a line each: candidate number, then the name if known
add-supervisor SUP-ANNA --name "Dr Anna K"
add-admin ADMIN-ANDERS --name "Anders"
assign SUP-ANNA CC1234 [CC1235 ...]       or let the supervisor add students in the app
unassign SUP-ANNA CC1234
rename SUP-ANNA "Dr Anna Kamara"
reset CC1234          forgotten password: new initial password, logged out everywhere
disable CC1234 | enable CC1234     leaving the programme: blocks login, keeps the data
revoke CC1234         lost or stolen tablet: logs out everywhere, password stays
delete CC1234         erase a disabled account and all its data for good (a request to be forgotten)
list
backup /data/backups/logbook-2026-11-01.db
mark-restored         after restoring a disk snapshot (not needed for a backup file): tablets send everything again
```

Hand initial passwords to each person through CapaCare, one at a time, not in a group chat. They only work for the first login.
Account ids: 2 to 20 characters, letters, digits, `/`, `_`, `-`. Candidate numbers are case- and space-insensitive (`cc 1234` is `CC1234`). The app calls every account id a "candidate number", also for supervisors and administrators; suggested ids for them: `SUP-` or `ADMIN-` plus a short name.

### 10.9 Front-end work with the dev server

For changing how the app looks and feels, `npm run dev` is much faster than `npm start`:

```
npm run dev                 # http://localhost:5173, demo data is created on the first start
npm run dev:reset           # throw the dev database away, start again with fresh demo data
npm run dev -- --lan        # also reachable from a tablet on the same network (http://<this computer's address>:5173)
npm run dev -- --port 4000
```

What it does: serves the files straight from the project folder with no caching; replaces `sw.js` with an empty service worker (so an old offline cache never hides your change; the real `sw.js` is untouched); reloads the page when you save a file (a saved `.css` file is swapped in without a reload, so the screen stays as it is); and runs the real API from `server/app.js` on `data/dev.db`, reached through the same address (`/api/*`). The reload script is added to `index.html` while it is sent; no app file is changed.

Demo accounts (password `demo1234`; `data/dev.db` is ignored by git):

| Account | What it is for |
|---|---|
| `CC1001` | Student with 60 entries, 35 signed, 3 deleted, and four targets set by SUP-DEMO: the full screens (the others have no targets; with `npm run dev:reset` an older dev database gets them) |
| `CC1002` | Student with 8 entries, 3 signed |
| `CC1003` | Student with 25 entries, none signed |
| `CC1004` | Student with no entries: the empty states |
| `CC1099` | Student who has not chosen a password yet: the first-login screen |
| `SUP-DEMO` | Supervisor of CC1001, CC1002 and CC1003 (CC1004 is not assigned) |
| `ADMIN-DEMO` | Administrator |

Good to know:

- The dev server listens on this computer only, unless you pass `--lan`. Only use `--lan` on a network you trust: the demo password is public.
- It uses its own address (port 5173), so the browser keeps separate storage from `npm start` on port 8080.
- It refuses to use a database called `logbook.db`; it can never touch real data.
- To try the tablet for real: connect it with a USB cable, open `chrome://inspect` on the computer, and forward port 5173. Then `localhost` on the tablet is this computer, which Chrome treats as a secure address.
- The dev server shows the app **without** the real service worker, so it cannot show offline behaviour or the "A new version is ready" message. Test those with `npm start` (and DevTools, Network, "Offline") before a release.
- Work on a branch, commit as often as you like, and release **once** when a set of changes is finished ([10.2](#102-release-a-new-version)): bump the version in the four places, run `npm test` and update this file. Do not bump the version for every small change.
- The UI tests (`test/ui*.test.mjs`) run in a simulated browser and can fail when screens change. Run `npm test` now and then while you work, not only at the end.
- To change the demo data, edit `dev/seed.mjs` and the table above. The seed checks every entry with `validateEvent`, so it fails loudly if the event rules change.

## 11. Running it

Hosting, updating, backups, restoring and costs are in **`DEPLOY.md`**. The current deployment is described in its section "Current deployment". The short version:

- It is one Node process and one SQLite file in a directory called `data`. Whatever host you use must keep that directory on a **persistent disk**, serve **HTTPS**, and run exactly **one** copy (SQLite on a single file does not support two servers).
- **Back up regularly** with `admin.js backup` and keep copies somewhere else. **Test a restore once.** The database is the only copy of the research data.
- Environment variables: `PORT` (8080), `HOST` (0.0.0.0), `LOGBOOK_DB` (`./data/logbook.db`), `ALLOWED_ORIGIN` (only if the app is loaded from a different address than the server, as in the test mode with `?api=`, see `DEPLOY.md`), `SERVE_STATIC` (`0` stops the server serving the app files), `ADMIN_ID` and `ADMIN_PASSWORD` (create the first administrator at startup if the account does not exist; remove `ADMIN_PASSWORD` afterwards).
- Use `GET /api/health` for uptime monitoring.
- The Node `sqlite` module is still marked experimental in Node 22, which is why start commands carry `--no-warnings=ExperimentalWarning`. The `Dockerfile` pins the exact Node version (`node:22.23.4-slim`); change it on purpose and test before upgrading Node.

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
| No WhatsApp sharing (removed in 0.13.0, with the weekly summary) | Not needed; WhatsApp's Business policy also restricts health information | Students see their progress in the app; nothing is shared from it. |

## 13. Known limits

- **Not tried on a Samsung tablet.** It works in Chrome on a Windows PC and an iPhone (reported by the product owner). Installation on the tablet, offline behaviour, performance on the actual devices and the look on the real screen are unverified.
- **Deployment only partly checked.** It runs on Fly.io (see `DEPLOY.md`, "Current deployment"). A backup was restored on Fly on 2026-11-23; the rest of the `DEPLOY.md` checklist (on a Samsung tablet, offline mode, second device) is to be checked during the first real test.
- **Supervisors need internet to sign**, and see nothing offline.
- **No password reset without an administrator**, no two-factor login, no per-address rate limiting; the login lock is in memory.
- **Deleting an account is two steps** (disable, then delete for good) and cannot be undone. An administrator cannot reset, disable or delete their own account; another administrator must.
- **The research export is not approved yet.** The anonymous spreadsheets (codes instead of candidate numbers and names) are built, but dates and hospitals stay in them, and using them for research still needs ethics approval and a decision on outcome data ([14](#14-open-questions-for-capacare)).
- **No automatic retention.** Nothing is deleted after a set time; erasure is done by an administrator, account by account.
- **English only.**
- **Whole history is sent to a new tablet.** Fine for hundreds or a few thousand entries per student; revisit beyond that.
- **Accessibility** has not been checked beyond large touch targets and labels.
- **One standard for all students.** The standard targets are the same for every student (no different standard per year or hospital); a supervisor changes them one student at a time. A student who has no target for a procedure while the standard has one ("Standard: N" with no target) shows this only in the targets pop-up and, if the student has cases of it, on the Progress row. The procedure and hospital lists and the questions are CapaCare's from 2021, with the 0.14.0 changes still to be confirmed (small procedures, side and mesh, no sex where the procedure gives it, complications at the birth). A caesarean asks about 20 questions; which to keep is still to be decided.
- **Not taken over from the 2021 logbook:** patient initials and address (district) identify the patient; times of day (operation start and end, time of birth) are replaced by the operation time in minutes; dates after the operation (discharge, reoperation, referral, death) by yes/no and "days". Reoperation and referral are yes/no only.
- **Follow-up has no reminder outside the app.** Every case can get a follow-up at any time (the "Follow-up added" tag shows which have one), but the student has to remember to open the case; there are no notifications.
- **The same operation can be logged by several students** (one operating, one assisting). Their follow-ups are separate, so counting outcomes needs care (for example only entries with role `supervised` or `independent`).
- **A follow-up has no time limit** (since 0.15.0), so an answer can come long after the operation and may be less reliable. The spreadsheet says how late it came (`followup_day`); the app does not warn about it.
- **All detail questions are optional**, but Save asks before saving an entry with unanswered questions. Making some required is a small change in `questions()` in `app.js` once CapaCare decides which.
- **Single server, single file.** No redundancy; a failed disk means restoring from the last backup.
- **A restore loses what the server got after the backup, except what is still on the tablets.** Tablets send the students' entries, follow-ups and deletes again by themselves at their next sync. Signatures and targets made after the backup are lost (only the server makes them; students cannot send them back): supervisors sign those entries again and set those targets again. Standard targets changed after the backup are lost too (set them again). Accounts created after the backup are gone and must be created again. A restore on Fly was tried on 2026-11-23 with an almost empty database, not yet with tablets that had to send their cases again (see `DEPLOY.md`, "Restore").

## 14. Open questions for CapaCare

These need people, not code. Record the answers here.

1. **Who is the data controller** and where may the data be hosted? Which ethics approval and which consent text apply to research use?
2. **Who creates accounts** and hands out initial passwords (candidate numbers, staff ids)? Who is told when someone leaves?
3. **Who decides which supervisor sees which student?** Self-service (now), student approval, or a coordinator? Should a student be able to remove a supervisor?
4. **Do supervisors need to sign offline?** How reliable is their connection at the hospitals?
5. **What counts as signed?** One supervisor is enough today. Is co-signing needed? Can a signature be withdrawn?
6. **The real procedure list, targets and hospital list** from the STP training manual, and **the detail and follow-up questions** per procedure (the existing logbook's data structure). Which are required, and is a longer time to log acceptable?
   **From the 2021 logbook (now in the app), to confirm:** is the hospital list current (and the name "Wilberforce Military Hospital")? Is "Cystectomy" in the gynaecology group an ovarian cystectomy? A caesarean uses the surgical role definitions; the obstetric logbook defined the roles differently ("alone" = no supervisor in the room). Is "Normal delivery" the right word for the logbook's "spontaneous"?
   **The questions:** which are needed, which may be dropped, and which should be required? Is the Surgical Apgar scale right (the 2021 file had typos in the heart rate bands; the app uses Gawande 2007)? Is district of residence needed (it was left out, it helps to identify a patient)?
   **Outcome data**: may patient outcomes (complications, deaths) be collected, under which ethics approval, and who may see them?
   **The baby in the follow-up** (added in 0.13.13, a proposal): each baby born alive gets "Outcome" (alive, died, not known) and the days from birth until death. Is this wanted, and is that the right question?
   **Changes in 0.14.0, proposals to confirm:**
   - **Small procedures** ask only the patient, the urgency and the anaesthesia, not the operation time or the Surgical Apgar: wound cleaning and dressing, wound suturing, incision and drainage, removal of foreign body, chest tube, urethral catheterisation, suprapubic puncture, urethral dilatation, plaster cast, skin and skeletal traction, reduction of a dislocated joint, induction of labour, manual removal of placenta, manual vacuum aspiration, dilatation and curettage, uterine tamponade (`MINOR_PROCEDURES` in `config.js`). Is the list right?
   - **Side** (left, right, both) is asked for hernia repairs (inguinal, femoral, strangulated), hydrocele, orchidectomy, amputations and a chest tube; **Mesh used** for inguinal and femoral hernia repairs. Neither is in the 2021 logbook (both were in the first test version). Wanted, and for which operations? Mesh also for umbilical and ventral hernias?
   - **The sex is not asked** where the procedure gives it: every gynaecology and obstetrics procedure (female), circumcision, orchidectomy and hydrocele (male).
   - **The complications at a birth** (heavy bleeding (postpartum haemorrhage), shoulder dystocia) are asked when the birth is logged, as two yes/no questions so both can be answered, instead of one choice in the follow-up. Not shoulder dystocia at a caesarean.
   **Still open about the procedures:**
   - **Vacuum and forceps delivery** are treated differently: vacuum is in the 2021 surgical list, so it counts as an operation (the roles say Scrubbed, and it asks anaesthesia, operation time and the Surgical Apgar), while forceps is a delivery from the obstetric logbook (Hands on or off, the birth questions). Should they be the same, and which way?
   - **Breech extraction** is a gynaecology and obstetrics operation, but not under Deliveries, and it asks nothing about the baby. Is it a way of giving birth (then it moves under Deliveries and asks the birth questions too)?
   - **Follow-up for observed and assisted cases**: every case can get a follow-up, but the codebook advises counting outcomes only from the cases the student performed (the same patient may be logged by several students). Should cases the student only observed or assisted ask for a follow-up at all?
   - **The word "candidate number"** is used to log in for everyone, also supervisors and administrators, who may not have one. Is that clear enough, or should the login say "Candidate number or staff ID"?
7. **Languages.** English only, or also Krio?
8. **What does "better than the CheckWare logbook" mean?** Suggested measures, already collected: share of students who log weekly, cases per student per week, share of cases signed within 14 days, and interviews (questions in `TESTER-GUIDE.md`). Agree thresholds before the trial.
9. **Who runs and pays for the server** after the prototype, and who holds the accounts and backups.
10. **A contact person in Sierra Leone** for remote testing, first set-up and feedback.

## 15. Next steps

In rough order:

1. Try the deployed app on a real Samsung tablet with one or two students and one supervisor, with a contact person on site. Fix what you learn before anything else.
2. Check the procedure list and hospitals, and set the standard targets (Manage users, Standard targets; built in 0.18.0).
3. Settle the questions in section 14, especially data ownership and ethics.
4. If supervisors cannot rely on internet: let them queue signatures offline and send them later (the token already authorises the call, so the server rule stays the same).
5. Research use of the anonymous spreadsheets, once ethics allows (perhaps with dates as weeks or months, if that is asked for).
6. Automated backups to a second location, plus uptime monitoring.
7. Split `app.js` by screen and consider translations if the project grows.

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
- The tests are the safety net: whole-flow tests for all three apps and the server rules. A change that needs a test to change deserves a second look.
- Be careful with: the rules in section 5, anything touching `validateEvent`, `initSchema` or authentication, and anything that adds a dependency.
- It cannot test on a real tablet or deploy for you. Real-device checks are yours.

## 18. Screens in detail

What each screen shows and does, as it is now. Section 2 is the short version; section 4 has the flows behind the screens (logging, follow-up, signing, targets, sync). The code names in brackets say where to look. All text on the screens is English; a logged procedure is called a **case** on every screen ("entry" is the word in the code and the data).

### 18.1 Shared by all three apps

- **The frame.** The header and the tabs stay at the top; only the page under them scrolls. All tabs are equally wide. (`appShell` in `ui.js`, more in [10.7](#107-add-a-screen).)
- **Headings** look the same everywhere (since 0.17.4): the heading of a part is inside its white card, at the top, in the main colour (dark blue), 19 px, medium weight, normal capitals (`.card-head` in `style.css`; a list under a heading is `headedCard(title, …)` in `ui.js`, its rows from edge to edge; every heading has a thin light line under it across the whole card, the same as between the rows (since 0.17.6); `headedCard({ title, note }, …)` (or `cardHead(title, note)` in a card of its own) puts a short grey note on the right of the heading, without a full stop: "Set by your supervisor" on Progress (since 0.17.5) and "These supervisors can see your cases and sign them" under More (since 0.17.7)). Used for "Your role" and the parts of the new case pop-up and the follow-up, the parts of the case pop-up, More (Account, Your supervisors, Backup) and inside Advanced, New case (Operations, Deliveries), Progress (with or without a target, also on a supervisor's and administrator's student page), Manage students, an administrator's Overview, Procedures, Hospitals and Users (a card per kind of account), Files and Add users. Chosen over small grey capitals above the card (tried in 0.17.3, and used on New case and Progress before): easier to read for people not used to screens, and clearly part of its card. Not headings in this sense: a page's or pop-up's title (a procedure's name: 24 px in the new case pop-up, 21 px at the top of the case pop-up, the follow-up form and a student's pop-up; a little lighter than medium, in the soft near-black of names, and since 0.17.11 in the same letter design as the text under it: the system font switches to a tighter "display" design from about 20 px, which looked like another font, so the titles keep the design of the 18 px text, `font-variation-settings: "opsz" 18`) and the weeks in History and on a student page (`.day-head`, small and grey above each week's card: dividers of one long list).
- **Lists, boxes and buttons** follow one rule (since 0.14.1; `.list` in `style.css`). A list of things (the procedures on New case, on Progress and on the administrator's Overview, hospitals, cases, students, accounts, files) is **one white card** with a row per thing and a thin light line between the rows, under a small grey heading when the list is split up (a week in History, a kind of account in Manage users, with or without a target on Progress, Surgeries and Deliveries on Overview). A choice (an answer in the case form, a row in a pop-up or menu) is its own button. Every outlined button (Cancel, Close, Log out, "Not in the list?", Change, the round back arrow, the filters, the "?", Undo in a message, the answer buttons in a form; the red ones too) has the same thin border, `--outline` (1.5 px) at the top of `style.css` (since 0.16.6; it was 2 px): one value to change them all. Solid buttons (Save, Sign) have no border. **Fields to type in** (numbers, searches, login and passwords, names) are the same family but grey, not blue (since 0.17.8): the same outline thickness and corners as the buttons, a darker grey line (`--field-line`), blue while being typed in, red for a number that is not allowed. A blue outline means "tap to choose"; a field that looked like that would look like an empty answer button. Every dividing line runs from edge to edge of its card (since 0.17.9): between the rows of a list, under a heading, between the rows under More, between the answers in a case, and between Hospital and Date in the new case pop-up; the rows keep their text 16 px in. The questions of a part in the new case pop-up and the follow-up have no lines between them, only room (22 px; lines were tried in 0.17.9 and made a long form look busy). A row in a card shades lightly under the mouse and turns light blue when pressed; it does not sink like a button, and the line between the rows stays grey (only the background changes, since 0.14.3: on New case the line above a pressed procedure turned blue). A list with nothing in it shows only its message ("No match"), without the card.
- **Pop-ups** follow one rule too, by what is done in them (since 0.14.1). A pop-up **to read** (a case, a student, an account) looks like a page: grey (`--bg`) with white cards (`on-bg`, passed to `openSheet` as `{ cls: 'on-bg' }`; `showPanel` always). The **new case** pop-up and the **follow-up** form look like that too (since 0.17.0): grey with a white card for the hospital and date, for your role and for each part of the questions; the answer buttons are white with the thin blue outline of every other outlined button (`--outline`, since 0.17.1; a grey line was too faint in the white cards), and solid blue when chosen. The other pop-ups **to fill in** (targets, a name) are still white with grey cards. A **small question or menu** ("Sign?", "Delete?", the hospital menu, "Show only") is plain white. A quiet red link at the bottom of a pop-up to read does what cannot be undone ("Delete this case", "Delete account and data for good"); it asks first.
- **Pop-ups** sit in the middle of the screen over a dark layer; a tap on the layer closes them. A long one scrolls only between its heading and its buttons (Cancel and Save always in view, the bigger one on the right). A thin grey line always runs along the top of the buttons, and one under a fixed heading once the middle is scrolled down. (`openSheet`, `scrollHint` in `ui.js`.)
- **Asking first.** A pop-up that asks before doing something (Delete, Log out, Sign, Remove, Disable, Reset password, Delete for good) has Cancel on the left and the action on the right, like Cancel and Save; a red action for what cannot be undone or takes something away. (`confirmSheet` in `ui.js`.) "Not everything is answered" when saving a case is a smaller question on top of the open pop-up, with "Go back" and "Save anyway" (`confirmOver`).
- **Messages** appear at the bottom of the screen for a few seconds ("Saved", "Signed 2 cases", with Undo where it makes sense). "A new version is ready" with a **Restart** button stays until Restart is tapped; other messages can show on top of it for a moment. (`toast` with `persist` in `ui.js`, `registerSW` in `app.js`.)
- **Times** in plain words: "just now", "5 minutes ago", "3 hours ago", "12 days ago", and the date after a month; "Never" when there is none. Days: "today", "yesterday", "3 days ago". The administrators' list of recent changes shows the date and time ("6 Nov 14:32"). (`timeAgo`, `daysAgo`, `fmtDateTime` in `ui.js`.)
- **Tags** (the small boxes on the right of a row): Signed (green), "N to sign" and "Logged N days later" (orange: worth a look), "Follow-up added" (blue), and grey for a state that needs nothing: Not signed yet, Disabled, First login waiting.
- **The case pop-up** is the same for everyone (`openCase` in `ui.js`), kept quiet on purpose (few boxes, little colour):
  - At the top, like the row in the list: the procedure, a grey line with the role and the date (and "logged 8 Nov" when it was logged on a later day), the hospital on a line of its own, and on the right the tags (Follow-up added; Signed or Not signed yet). Who signed it and when in a grey line under it.
  - Two tabs sharing the width, **Details** (open first) and **Follow-up**; the blue line under the open one slides over when the other is tapped (`slideLine`, as on every row of tabs). The pop-up is grey like the pages (a pop-up to read, see "Pop-ups" above), and the answers are in white cards, a card per part of the form, a row per answer: the question on the left in grey, the answer against the right edge. A card has a heading only when it is not the tab's name. An answer to a question that is no longer asked comes last, under "Other".
  - Under the follow-up answers a small grey line: "Added 5 Nov", or "Last updated 12 Nov" once it has been changed, with a quiet grey "View history" on the right (no underline and no box, like "Delete this case": under the mouse or when pressed only its colour changes, to dark blue; since 0.15.1) that folds open a white card per change, newest first ("Changed 12 Nov 14:05", the first "Added"; a row per answer it changed: "Wound infection: Yes → No"). Saving with nothing changed is not a change. Everyone who can open the case sees it.
  - The pop-up has a home: where it opened, in the middle of the screen for the height it opened with. When its size changes (another tab, "View history" or "Hide history") or the screen does (the tablet turned), its top edge stays at home, so the heading and the tabs do not jump; only when it would run off the bottom does it move up, just enough to stay whole on the screen, and it goes back home as soon as it fits again, so after "View history" and "Hide history" it is exactly where it was (`keepFitting` in `ui.js`, with a ResizeObserver on the pop-up and the overlay, since 0.15.4; before that it ran off the screen (until 0.15.1) or stayed up after shrinking (0.15.2–0.15.3)). Re-centring on every change was not chosen: the heading would jump at every tab.
  - At the bottom Close; for the student, on the Follow-up tab only, also "Add follow-up" (or "Update follow-up"), the bigger one. An unsigned case of the student's own has "Delete this case", a quiet red link at the bottom of the case, under both tabs (like "Delete account and data for good" in an account). Supervisors and administrators only read.
  - For a supervisor or administrator the grey line starts with whose case it is, the student's name (or the candidate number when there is no name): "Mohamed Kamara · Operated with supervisor · 12 Nov" (`who` in `openCase` and `caseRow`).
  - The role is worded for who reads it: the student reads "Operated on my own", a supervisor or administrator "Operated alone" (`roleDone`, `roleDoneBy` in `config.js`).
- **More** looks the same in all three apps: cards with rows (the label small and grey, the value under it: `fact` in `ui.js`), and the rarely needed things folded away at the bottom under "Advanced" (`advancedCard`), with About and "Your data" (`privacyFact`).
- **"Your data"** (`openPrivacy` in `ui.js`, text in `PRIVACY` in `config.js`): one grey card per part: what is stored, why, who can see it, where it is kept, how long, and your rights. A line can be for one role only, so each person reads what is about them.
- **No Refresh buttons.** The supervisor and administrator screens fetch a page when it is opened, and the page on show again when the app comes back on the screen (not while a pop-up is open). A redraw keeps a search field's keyboard and cursor (`keepTyping` in `ui.js`).

### 18.2 Student app

- **Login** (`loginScreen` in `app.js`): candidate number, password, "Show password", Log in. The version is shown quietly under the form. The first login on a device needs internet.
- **Choose your own password** (`forcedPasswordScreen`): "Welcome, " and the name (or the candidate number), the password that was given, the new one twice, and "How your data is used" (the privacy notice).
- **Where do you work?** (`hospitalScreen`), once per device: a row "Hospital, Not chosen yet" with Choose, which opens the hospital menu (`hospitalPicker`: a white box over the page with a search and a button per hospital; one tap chooses; ×, the button again, Escape or a tap outside close it). Once chosen the row says Change and the button under it goes from "Choose your hospital" to Continue, which stores it.
- **Header**: "CapaCare logbook", the candidate number, name and hospital, and on the right a sync button only when something needs attention ("Offline · 1 waiting", "2 to sync", "Sync problem"; nothing when everything is up to date).
- **New case** (called the Log tab in the code; `logTab`): one page, no switch (since 0.14.1). No heading (the open tab at the top is the name of the page) and no line of help: first two small grey headings, each over one white card with a row per procedure (thin lines between the rows, one column on every screen): **Operations**, the most common operations (`LOG_SURGERY` without the caesarean), with under it an outlined button "Not in the list? Find another operation" (every operation under its group, with a search; `openMoreProcedures`; an operation tapped there opens on top of the list, so Cancel or a tap on the dark layer goes back to the list as it was, and Save closes both: `openSheet(…, { over: true })`, `closeSheet` and `closeAllSheets` in `ui.js`); and **Deliveries**, every way of giving birth (`LOG_DELIVERIES`, the caesarean among them: it is shown once, here). Each row has the name, how many cases under it (also "0 cases"), and a plain blue "+" on the right.
- **Logging a case** (`openEntrySheet`, the flow in [4](#4-how-it-fits-together)): one pop-up with the hospital and date, the role (a card "Your role": four buttons, one per row, each with a line in two short sentences and a small box on the right: Scrubbed or Not scrubbed, for a delivery that is not an operation Hands on or Hands off), then the optional questions in parts, each a white card on the grey pop-up (since 0.17.0) with one heading (Patient or Mother, Baby, Complications, Operation or Procedure, Surgical Apgar; a second and third baby only after Twins or Triplets). Choices two per row (three short ones in a row), numbers one per line. An unclear word has a small round "?" after it that shows a short explanation in a light blue bubble until it is tapped again (`helpTip`; the texts are `help` in `config.js`; a part's `note` likewise, after its heading). A number that is not allowed gets a red frame and the message right under it, and the form scrolls there. Save reads "Choose your role" until a role is chosen. After saving: "Saved · Operated with supervisor" with how many there are now (or "2 of 10 performed" with a target), and Undo.
- **Which questions** (`detailFieldsFor` in `config.js`): an operation asks Patient (sex, age), Operation (urgency, anaesthesia, operation time) and the Surgical Apgar. A small procedure (`MINOR_PROCEDURES`: dressings, sutures, plaster, traction, catheters, a chest tube, and small obstetric procedures) asks only Patient and Procedure (urgency, anaesthesia). Hernias, hydrocele, orchidectomy, amputations and a chest tube ask the side first (`ASK_SIDE`), inguinal and femoral hernias also whether a mesh was used (`ASK_MESH`). The sex is not asked where the procedure gives it: every gynaecology and obstetrics procedure, and circumcision, orchidectomy and hydrocele (`MALE_ONLY`). A delivery asks about the mother, each baby, and the complications at the birth (heavy bleeding (postpartum haemorrhage), shoulder dystocia; a caesarean only PPH); a delivery that is an operation asks the operation and its Surgical Apgar as well, a caesarean also its main reason.
- **History** (`historyTab`): no heading. At the top two filter buttons, Procedure and Role, made to look like buttons and not like more cases: the same outline as "Not in the list? Find another operation" (white, the thin blue border of every outlined button (`--outline`), the same corners, light blue under the mouse and when pressed; since 0.16.4, after a grey fill and a round light-blue outline were tried in 0.16.2 and 0.16.3), one line each ("Procedure: All", the value in dark blue), 48 px tall, filled light blue with the value in semi-bold while one is on, with a little more room under them (`.filter` in `style.css`; an administrator's Users has the same) (a pop-up with a row per choice and how many cases it has; `filterButton`, `openFilterSheet` in `ui.js`). While a filter is on: "Showing 1 of 3" and "Show all". Then the cases newest first by the day they were done, under a small heading per week, Monday to Sunday ("This week", "Last week", "26 Oct – 1 Nov", with the year for an earlier year: `byWeek` and `fmtWeek` in `core.js`). Each week's cases are one white card, and each case is one short row in it: the procedure, your role and the date ("Assisted · 6 Nov"), and the tags (Follow-up added; Signed or Not signed yet). Tapping it opens the case pop-up (18.1).
- **Follow-up** (`openFollowUp`): headed like the case (the procedure, your role and the date, the hospital), with a round arrow back to the case's Follow-up tab. "Tap only what you know now. You can add more later." Then the questions in white cards on grey (like a new case) named like the details (Patient or Mother; a card per baby born alive; Complications; Hospital stay), with the earlier answers chosen, and Save. With nothing changed, Save just closes it, as after saving, and nothing is logged. There is no time limit.
- **Progress** (`progressTab`): no heading; first three numbers (cases, signed, this week: Monday to Sunday, like History). Then "Procedures with a target" (the standard for every student, with what a supervisor changed; with "Set by CapaCare or your supervisor" small and grey on the right of the heading; the student is not told which is which) and one white card with a row per target (the name and "performed / target", a bar, "Observed N · Assisted N"), or "No targets yet. Your supervisor sets them."; then "Procedures without a target": a card with a row for each procedure (how many cases on the right, in the middle of the row's height) with at least one case, the most first (`procedureProgress` in `ui.js`).
- **More** (`moreTab`): Account (candidate number, name, hospital with Change; Change password and Log out), Your supervisors (by name, "since 6 Nov"; "These supervisors can see your cases and sign them" small and grey on the right of the heading), and Advanced: Data on this device (cases, waiting to be sent, last sync) and About (version, Your data). Logging out sends what is waiting first; if something still could not be sent it says so in red ("1 change has NOT been sent …") and the button becomes "Log out and lose them".

### 18.3 Supervisor app (`supervisor.js`)

- **Header**: "Supervisor · " and the name. Tabs: My students (with a count of the cases waiting), Manage students, More.
- **My students** (`studentsView`): a search (candidate number or name), then a row per student: the candidate number, the name, "12 cases · last case logged 3 days ago", and on the right "N to sign" or "All signed". The students with cases waiting come first. Without students: a card that points to Manage students, Add students.
- **Manage students** (`manageView`): one page in two parts under small grey headings, like the weeks in History, with no tabs of its own. **Your students** first (`removePart`, below), then **Add students** (`addPart`): the same search and rows as My students, with Add on the right (at most 40 at a time; "Showing 40 of 120. Type to narrow down."). An added student leaves the list. **Your students**: the list of My students ("None yet. Add them below." without students), a row each with Remove on the right, filled red as Add is filled blue, which asks first ("Remove CC1001?", which also says that signatures stay and the student can be added again).
- **A student** (`detailView`) opens in a big pop-up over My students (since 0.14.1; `showPanel` in `ui.js`), so it is clear that something was opened, like a new case; Close at the bottom or a tap on the dark layer around it closes it, and My students is under it as it was. The pop-up takes the whole height of the screen but 16 px above and below, like a long pop-up for a new case, and does not change height between tabs. At the top, staying there: the candidate number with the name under it (removing a student is under Manage students), and under them three tabs like Details and Follow-up in a case (sharing the whole width equally, like the tabs in Android apps, a blue line under the open one, which slides over quickly, in 0.18 s, when another tab is tapped, as it does between Details and Follow-up; `segSwitch` and `slideLine` in `ui.js`; the administrator's pages use the same one). Under them, scrolling, three numbers (cases, signed, to sign) and the tab. The pop-ups opened from it (a case, "Sign?", targets) come on top of it, and when they close it is still there (it has a layer of its own, `#panel`, under `#overlay`):
  - **To sign** (open first): the cases waiting, as short rows like History with the hospital on a third line, each with a tick box on the left (tapping the box ticks; tapping the row opens the case). Nothing is ticked at first: the supervisor ticks what they supervised. A case logged 7 days or more after it was done has an orange tag "Logged N days later" (`LATE_DAYS` in `core.js`; the next day is normal). Above the cases "3 cases waiting" with "Select all" / "Select none" (a round outlined button, like "Show all" in History); at the bottom of the pop-up Close and "Sign 2 cases" ("Select cases to sign" while nothing is ticked), which asks first.
  - **Signed**: the same rows, with "Signed · " and who signed.
  - **Progress**: "Set targets" (or "Change targets") at the top, then the student's progress as the student sees it (`procedureProgress`: "The student sees these under Progress."), with "Standard: N" (or "Standard: none") at the end of the grey line of a procedure whose target differs from the standard for every student. The targets pop-up (`openTargets`, using `openTargetsSheet` in `ui.js`): "Targets for CC1234" with the name under it, a line saying the standard is filled in, a search, and a number field per procedure (those on the New case tab first) with the student's targets in force; empty or 0 is no target. Beside a number that differs from the standard a grey "Standard: N" (updated while typing); typing the standard number again goes back to the standard. With nothing changed, Save just closes it.
- What was ticked stays ticked when the page is fetched again (after signing, saving targets, or coming back to the app); new cases come in unticked (`loadDetail(…, { quiet })`, `refreshCurrent`).
- **More**: Account (candidate number, "Name shown to students"; Change password, Log out) and Advanced (version, Your data).

### 18.4 Administrator app (`administrator.js`)

- **Header**: "Administrator · " and the name. Tabs: Overview, Manage users, Download data, More.
- **Overview** (`overviewView`): when no backup has been taken for a week (and there are cases), a light orange row ("No backup has been taken yet." or "The last backup was 9 days ago.") with "Go to backup". Four numbers (students, supervisors, cases, hospitals with at least one case), then three tabs, each with its own search (`searchable`):
  - **Students** (open first): a row per student like a supervisor's My students: "2 cases · last case 20 Oct", and on the right "N to sign", "All signed" or Disabled.
  - **Procedures**: under small grey headings Surgeries and Deliveries (a caesarean under both), one white card with a row per procedure: the name, "Observed N · Assisted N · Performed N · N students", and how many cases on the right; the most first.
  - **Hospitals**: the same per hospital.
- **A student** (`detailView`) opens in a big pop-up over the list it was opened from (Overview, or "View" in an account under Manage users), like a supervisor's student: at the top the candidate number with the name and "Account" (the same pop-up as under Manage users, which opens on top), and two tabs under them; Close at the bottom; then three numbers and the tab: **Cases** (short rows under a heading per week, with Signed or Not signed yet; tapping one opens the case, only to read) and **Progress** (as the student sees it, with "Standard, or set by a supervisor" by the heading and "Standard: N" where a target differs from the standard, as for a supervisor).
- **Manage users** (`usersView`): "Standard targets" and "Add users" at the top on the right. **Standard targets** (`openStandardTargets`, since 0.18.0) opens the same pop-up as a supervisor's "Change targets" (`openTargetsSheet` in `ui.js`), headed "Standard targets", "For every student": a number field per procedure, the standard filled in, empty or 0 for none; Save stores what changed, and the students get it with their next sync (a student whose supervisor set a different number keeps it). Then a search (candidate number or name); "Show" (Everyone, Students, Supervisors, Administrators: a pop-up with how many of each; while one kind is shown, "Showing N of M" and "Show all"). Every account under a small grey heading per kind, as a row: the id, the name, and a grey line with the kind, last login and cases; a grey tag Disabled or "First login waiting".
- **An account's pop-up** (`openUser`), laid out like the case pop-up: the id, the kind and the name at the top, then a grey box with a row per fact and a round button for what can be done to it: Name (Add or Change, its own pop-up with Cancel and Save; Save with the same name just goes back), Password (New password: asks first, then shows the new initial password once), Last login (Log out everywhere; not on your own account, where Log out is under More), Status (Disable, which asks first, or Enable), and for a student Cases (View). Then the people linked to it with Remove: a student's supervisors by name (with "Add a supervisor": a list, one tap adds), a supervisor's students by candidate number. Close at the bottom, and for a disabled account a quiet red link "Delete account and data for good", which asks first. On your own account: a note that another administrator is needed to reset or disable it.
- **Add users** (`addView`), a page of Manage users with an arrow back: the kind of account (Students, Supervisor, Administrator) in the switch, then a white card with a heading, a grey line about the initial password, the fields with a grey hint under each label, and the button. Students: a line per student, the candidate number then the name (`parseStudents`). The new initial passwords then show once in a pop-up, a row per person (the id, the name under it, the password on the right), with Done and "Copy all" (`showPasswords`). The page stays open to add more.
- **Download data** (`downloadView`, `exportCsv` in `server/lib.js`): one white card with two rows. **Anonymous**, an on/off switch (the whole row is the switch; written like the File format row: "Anonymous" small and grey, and under it Yes or No; on again at every login; `anonymousRow`), and **File format**, a row like the hospital: the format, and "Change", which opens a small menu with Excel (uses `;`) and Other programs (`,`); remembered on the device (`formatRow`, `popMenu` in `ui.js`). Then a row per file with a line about what is in it and a tick box (nothing ticked at first; tapping the row ticks it), and in the bar at the bottom "Select all" / "Select none" and "Download N files" (one after the other; what was ticked stays ticked). The files:
  - **Progress per student**: a row per target in force (the standard, with what a supervisor changed): the target, how many performed and the share, assisted, observed, where it comes from (`target_from`: `standard` or `supervisor`), who set it (empty for the standard) and when.
  - **Procedures per student** and **Procedures per hospital**: counts per role, signed, and the follow-ups done and open (none yet). The hospital file never has people in it.
  - **Every case**: a row per case with every answer: the role as a code (`role_id`) and in words, `followup_status` (done or open), `followup_on` (the day of the newest real change) and `followup_day` (how many days after the operation that was). Follow-up answers to questions no longer asked after a change (the days until death after "Died" became "Alive") are left out.
  - **Follow-up changes** (since 0.16.0): a row per follow-up answer that was added or changed, oldest first per case, the same as "View history" in the app: which save it was (`change_no`, `first`), when (`changed_at`, `known_on`, `followup_day`), the question (`question`, `question_label`) and the answer before and after (`from`, `to`, as codes). Joins to Every case on `entry_id`. Deleted cases, undone follow-ups and saves that changed nothing have no rows.
  - **Codebook**: every column and code in the other files, made from `config.js`, with notes (which questions are asked for which procedures, which are no longer asked, that the same operation can be logged by several students).
  - In the anonymous files each student is `S-` and each supervisor `V-` plus 8 characters instead of the candidate number and name, made from the id with a secret key kept in the database (`pseudonym_key` in `settings`): the same person has the same code in every file and download, and the code cannot be turned back without the key. Dates and hospitals stay in them.
- **More**: Account, Backup (what the file is, the last backup, "Download backup", and that it holds everything), and Advanced: About (version, server, Your data) and "Recent changes": who did what to which account (also targets, and the standard targets "for every student"), and every download, with the date and time.
