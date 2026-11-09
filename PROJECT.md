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
| E-mail is little used, WhatsApp is preferred | Accounts use candidate numbers, not e-mail. The app needs neither e-mail nor WhatsApp |
| Earlier systems lacked motivation | Logging must take seconds; students see their own progress towards targets |
| Privacy matters, data is for research | No patient identifiers and no free text anywhere; the server stamps ownership itself; supervisors see only what they need |

## 2. Status

Version **0.13.13**. A working prototype, tested automatically and **deployed on Fly.io** (see [11](#11-running-it)), but **not yet used on a Samsung tablet**.

Works:

- Student app: login with candidate number and password, forced own password at first login, the first tab, "New case" (called the Log tab in the code and in these notes), is headed "Add a new case" and has two tabs, Surgery (open from the start) and Delivery, like CapaCare's two logbooks (a switch: a light grey track across the page with the open one as a white raised button in it, the other in grey; built on the same `.ctabs` as Details and Follow-up in a case) (Surgery: the ten most common operations, then "More operations" with every operation from CapaCare's logbook under its group; Delivery: every way of giving birth; the choice is kept while the app is open), log a procedure in one pop-up (tap the procedure; then the role, the optional questions of the logbook in parts, each a grey card with one heading (Your role, Patient or Mother, Baby, Operation, Surgical Apgar; a second and third baby only for twins and triplets; choices two per row, three short ones in a row; number questions one per line; an unclear word has a small round "?" after it, which opens a short explanation in a light blue bubble under it (it stays open until "?" is tapped again; `helpTip` in `app.js`, the texts are `help` in `config.js`; a part's `note` too, after its heading: only at an operation with a baby, to say the Surgical Apgar is the mother's), and Save), undo, a follow-up on an entry for 6 weeks after the operation (the outcome questions of the logbook), history (can show only one procedure and/or one role; newest first by the day it was done, under a small heading per week, Monday to Sunday ("This week", "Last week", "26 Oct – 1 Nov", with the year for an earlier year: `byWeek` and `fmtWeek` in `core.js`); each case is one short row: procedure, your role and the date ("Assisted · 6 Nov"), whether it is signed and, if it has one, a tag "Follow-up added" (or "Follow-up closed" when it has none and is too old for one); tapping it opens the whole case in a pop-up, kept quiet on purpose (few boxes, little colour): at the top like its row in the list: the procedure, a grey line with the role and the date, and one with the hospital, and on the right the tags (Follow-up, Signed or Not signed; who signed it and when in a grey line under it); then two plain tabs, "Details" (open first) and "Follow-up"; the answers in grey cards like the parts of the form when logging, a heading only when it is not the tab's name, a row per answer with the question on the left and the answer against the right edge; an unsigned entry has "Delete this case" in red on the line of the tabs, all the way to the right, on both tabs (just "Delete" on a narrow phone; it asks "Delete this case?" first); when another tab is opened the pop-up fits its content, but its top edge stays where it was, so the heading and the tabs do not jump (`keepTop`); at the bottom Close, and on the Follow-up tab only also Add (or Update) follow-up, the bigger one, like Cancel and Save: `openCase` in `ui.js`, with the actions from `app.js`), progress against targets (Progress: under the heading "Procedures with a target", "Set by your supervisor." and one white tile per procedure with a target, in the same grid and style as the procedures on the Log tab (two per row on a tablet, one on a phone): the name and how many performed out of the target, a bar, and "Observed N · Assisted N"; without targets "No targets yet. Your supervisor sets them."; under it "Procedures without a target": one row for each procedure without a target that has at least one case, the most cases first, with how many cases and "Observed N · Assisted N · Performed N" under it: `progressTab` in `app.js`), works offline, installable.
- Sync to the server with automatic retry, and whenever the app comes back on the screen (so signatures arrive without a button); log in on any tablet and the history comes back.
- Supervisor accounts: a supervisor logs in with a candidate number (for example `SUP-ANNA`), adds students, sees their entries and signs selected ones, and sets each student's targets (how many of each procedure to perform; see the targets flow in [4](#4-how-it-fits-together)). The server verifies every signature. My students has a search like Add students (candidate number or name). A student's page is part of My students (that tab stays chosen; tapping it goes back to the list) and has one line at the top: a round arrow back on the left, the candidate number with the name under it, and "Remove student" (red, outlined; just "Remove" on a narrow phone) on the right; then the stats and then three tabs in the same switch as Surgery/Delivery (`detailView` in `supervisor.js`): "To sign" (opens first: the entries waiting as short rows like History (with the hospital on a third line), each with a tick box, none ticked at first (the supervisor ticks what they supervised), "Tick all" / "Untick all" next to the Sign button, both in a white bar at the bottom of the screen with a thin line on top, as wide as the bar at the top (at most 960 px, in the middle), with the buttons lined up with the list (the `bottom` of `appShell` in `ui.js`), the list scrolls above it), "Signed" (the same rows, with who signed) and "Targets". Tapping a row opens the same case pop-up the student sees, only to read: no Delete, no follow-up button (`caseRow` and `openCase` in `ui.js`, which an administrator's page of one student uses too); a case logged later than the day it was done has a tag "Logged late". The role is worded about the student ("Operated alone", not the student's own "Operated on my own": `doneBy` in `ROLES`, `roleDoneBy` in `config.js`). There is no Refresh button: each page is fetched from the server when it is opened, and the page on show is fetched again when the app comes back on the screen (not while a pop-up is open), keeping what the supervisor ticked (new entries come in unticked), as after signing or saving targets (`refreshCurrent` and `loadDetail(…, { quiet })` in `supervisor.js`).
- Administrator accounts and screens (no shell needed), under four tabs at the top: Overview, Manage users, Download data and More. Overview: the numbers at the top (students, supervisors, cases, and hospitals with at least one case), then three tabs in the same switch as Surgery/Delivery: "Students" (opens first: a row per student like a supervisor's My students, with a search (candidate number or name), how many cases and the day of the last one, and on the right "N to sign", "All signed" or "Disabled"), "Procedures" and "Hospitals" (a search too; on Procedures the tiles under the small grey headings "Surgeries" and "Deliveries", like the two lists of a new case, a caesarean under both; then a white tile each, as on the student's Progress: the name with the roles and how many students in grey under it, and how many cases on the right, in the middle of the tile's height; the most cases first). Each tab keeps its own search while the app is open (`searchable` in `administrator.js`). There are no wide tables any more (the old matrix per student is now the student's page, and the CSV "Procedures per student"). Tapping a student opens their page, laid out like a supervisor's (`detailView` in `administrator.js`): a round arrow back, the candidate number with the name, and "Account" on the right (the same pop-up as under Manage users); the stats; then two tabs: "Cases" (short rows under a heading per week, like History, with Signed or Not signed; tapping one opens the same case pop-up, only to read) and "Progress" (as on the student's Progress: targets and the procedures without one, `procedureProgress` in `ui.js`). The page is part of the tab it was opened from (Overview, or Manage users through "View" by Cases in a user's pop-up); tapping that tab goes back. Add users, a page of Manage users opened with its "Add users" button (on the right of the heading, like "Account" on a student's page), with a round arrow back to the list like a student's page (it stays open after creating, to add more; not fetched again while it is open, so typing is never disturbed): the kind of account (Students, Supervisor, Administrator) in the same switch, then a white card like those under More: a heading ("New students" …), a grey line about the initial password, the fields with a grey hint under each label, and the button; the new initial passwords then show in a pop-up as a row per person in a grey box (the id, the name under it, the password on the right), with Done and "Copy all" at the bottom (`showPasswords`). Manage users: the list of every account under a small grey heading per kind of account (Administrators, Supervisors, Students; like the week headings in History, only those with rows), with rows like those on Students ( the id, the name under it, then a grey line with the kind of account, last login and cases) with a search and "Show" (Everyone, Students, Supervisors, Administrators: a button like the History filters that opens a pop-up with a row per kind and how many there are; while one kind is chosen, "Showing N of M" and "Show all" under it, as in History (the search stays); `filterButton` and `openFilterSheet` in `ui.js`, shared with History). Tapping an account opens its pop-up (`openUser` in `administrator.js`), laid out like the case pop-up: a heading that stays at the top (the id, the kind of account and the name, a tag like in the list), a grey box with a row per fact and a round button on the right for what can be done (Name: Add or Change, which opens its own pop-up with Cancel and Save; Password: New password; Last login: Log out everywhere; Status: Disable or Enable; a student's Cases: View), then the linked people as rows in a grey box with Remove (a student's supervisors by name, a supervisor's students by candidate number) and, for a student, "Add a supervisor" (a list to choose from, one tap adds); Close at the bottom, and for a disabled account a quiet red link "Delete account and data for good". Download data: the spreadsheet files (see below). More: Account, Backup, and Advanced (About, then "Recent changes": the log of who did what to an account, and downloads) and Advanced. No Refresh button here either: Overview, Manage users and More are fetched again each time they are opened and when the app comes back on the screen with one of them on show, a student's page likewise (not while a pop-up is open; `goTab` and `watchVisibility` in `administrator.js`). A redraw keeps a search field's keyboard and cursor (`keepTyping` in `ui.js`), on the supervisor screens too. The first administrator is created from environment variables (`ADMIN_ID`, `ADMIN_PASSWORD`, see `DEPLOY.md`).
- Students can have a name next to the candidate number (administrators set it; the student, their supervisors and administrators see it).
- The hospital is stored in every entry. After the first login on a device the student chooses their hospital ("Where do you work?", `hospitalScreen` in `app.js`: laid out like the hospital under More, a row "Hospital, Not chosen yet" with a Choose button that opens the same hospital menu, `hospitalPicker`; once chosen it says Change, and the button under it goes from "Choose your hospital" to Continue, which stores it). The student sees it when logging (and can change it there) and in the history; administrators get a hospital tab on Overview and spreadsheet (CSV) downloads, see "Download data" below.
- "Download data" (administrators, a tab of its own; the choices straight on the page, without a white card; `downloadView` in `administrator.js`, `exportCsv` in `server/lib.js`): two switches, "People in the files" (Anonymous, chosen again at every login, or With names) and "File format" (Excel, which uses `;`, or Other programs, `,`; remembered on the device), then, like a supervisor's To sign, a row per file with a line about what is in it and a tick box on the left (none ticked at first; tapping the row ticks it), and in the white bar at the bottom of the screen (as wide as the bar at the top) "Tick all" and "Download N files", which downloads the ticked files one after the other and says so once (`downloadView` and `downloadPicked`; what was ticked stays ticked, so the same files can be downloaded again in the other format; a browser may ask once whether the site may download several files). The files: **Progress per student** (a row per target in force: the target, how many performed and the share, assisted, observed, who set it and when), **Procedures per student** and **Procedures per hospital** (counts per role, signed, and the follow-ups done, still open and missed; the hospital file never has people in it), **Every case** (a row per case with every answer, `followup_status`: done, open or missed, and `followup_day`: how many days after the operation it was given) and the **Codebook** (every column and every code in the other files, made from `config.js`, with notes such as the same operation being logged by several students). In the anonymous files each student is `S-` and each supervisor `V-` plus 8 characters instead of the candidate number and name: made from the id with a secret key kept in the database (`pseudonym_key` in `settings`), so the same person has the same code in every file and download, and the code cannot be turned back without the key. Dates and hospitals stay in them. The change log says which file was downloaded and whether it was anonymous.
- Administrators download a complete database backup from the app and are reminded when none has been taken for a week (on Overview, a light orange row in plain text with "Go to backup", a round outlined button like "Show all", which opens More).
- Admin from the command line as a fallback: create accounts, assign, reset, disable, revoke, delete, list, backup.
- Privacy: a notice ("Your data") on the first-login screen and under More in all three apps (the row "Your data" with a Read button, under About in "Advanced"), with what is stored, why, who sees it, where, how long and the person's rights, one grey card per part (`openPrivacy` in `ui.js`; a line can be for one role only, so each person reads what is about them). Its text is in `config.js` and is still a draft (`PRIVACY_IS_PLACEHOLDER`). Administrators can erase a disabled account and all its data for good.
- 72 automated tests, including whole-flow tests of both apps in a simulated browser against a real server.
- A development server with live reload and demo data for front-end work (`npm run dev`, see [3](#3-get-it-running) and [10.9](#109-front-end-work-with-the-dev-server)). It is a tool for the developer, not part of the app.

Targets are set per student by a supervisor in the app (there are no example targets any more). Placeholders: the procedure list, the hospital list, the role definitions and the detail and follow-up questions (`DETAIL_FIELDS`, `FOLLOWUP_FIELDS`: everything the surgical and obstetric logbooks asked, except what identifies the patient; to be cut down after trying it) now come from CapaCare's logbook (`Logbook_softcopy_2021.xlsx`, not in the repository); the hospital list is from 2021 and should be checked.

Not done: trying it on a real Samsung tablet, approval of the research export, offline signing for supervisors, ethics and data-protection approval. See [13](#13-known-limits) and [15](#15-next-steps).

## 3. Get it running

Needs **Node 22.13 or newer**. Nothing else: the server has no runtime dependencies. `npm install` only fetches test tools.

```
npm install                                   # test tools only
npm test                                      # 72 tests, about 1 minute

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

**Entry flow.** The student taps a procedure. One pop-up (`openEntrySheet` in `app.js`) shows the hospital and date (filled in, with Change: the hospital opens a menu over the page (`hospitalPicker`, also under More: a white box with a search field and a button per hospital; one tap chooses; ×, "Change" again, Escape or a tap outside close it); the date opens the device calendar and a second press closes it (`dateToggle`); on a touch screen the invisible date field lies on top of the button because iOS only opens it from a real tap, with a mouse the button gets the click), the role (required: until one is chosen the Save button reads "Choose your role"; each role has a line in two short sentences, what I did and what the senior did, and a small box on the right, in the middle of its height (under the text once the text would wrap beside it, as on a phone; then all four move together, `stackTagsTogether` in `app.js`), Scrubbed (light blue) or Not scrubbed (grey), for a delivery that is not an operation Hands on or Hands off: `hint`, `tag` and `tagOn` in `ROLES`; one role per row on every screen, so each fits on one line; a delivery that is not an operation words the roles as the obstetric logbook does, "Delivered, supervised" / "Delivered alone", see `rolesFor` in `config.js`; the stored role ids are the same) and the optional detail questions for that procedure. Save stays in view at the bottom. A thin grey line always runs along the top edge of Cancel and Save (also when scrolled to the end), and once scrolled down a line under a fixed heading too: the content is cut off cleanly at the line, like under the white bar on a supervisor's To sign page; no fade, no arrow or button (a scroll button sometimes went too far; a tap goes through the line to what is under it) (`scrollHint` in `ui.js`, also in the hospital menu and the list of all operations; there is no line above Cancel and Save). If a question on screen has no answer, Save first asks "N questions have no answer. Save anyway?" on top of the pop-up (`confirmOver` in `ui.js`; "Go back" keeps everything and scrolls to the first one). A follow-up does not ask, because it is meant to be filled in bit by bit. All choices, here and in the follow-up, use the same buttons (`choices()`): white, and filled with the main colour when chosen. `core.logEntry` writes an `entry` event to IndexedDB at once (works offline). A moment later `syncCore` (in `app.js`) sends every event the server has not confirmed (at most 200 per request) and pulls everything new. Confirmed ids go in the local `sent` store, which is what the "N to sync" counter is based on.

**Follow-up flow.** In History, an entry up to `FOLLOWUP_DAYS` (42) after the operation has "Add follow-up", whether or not it is signed. Its form (`openFollowUp` in `app.js`) is headed like the case pop-up (the procedure, a grey line with your role and the date, the hospital on a line of its own; it stays at the top) with a round arrow before it, then laid out like the pop-up for a new case: a grey line ("Tap only what you know now. You can add more later."), the questions in parts named and worded like the details, each a grey card with a heading (Patient or Mother; at a delivery a card "Baby" (Outcome, and Days from birth until death after "Died"), "Second baby" and "Third baby" for twins and triplets, only for a baby that was born alive as far as the details say (`followupFieldsFor(procedure, details)`: by the number of babies and "Outcome at birth"; a stillbirth is already in the details); Complications; Hospital stay: `FOLLOWUP_…` in `config.js`), with short labels (Outcome, Days from operation until death, Wound infection, Back to theatre, Days in hospital after the operation; counted from the birth at a delivery that is not an operation) and no "?", and only Save at the bottom; the arrow goes back to the case's Follow-up tab. After that the case says "Follow-up is closed: more than 6 weeks after the operation." (worded from `FOLLOWUP_DAYS`), so nobody thinks the signature is the reason. The answers are saved as a `followup` event on top of the entry and synced like any other event. `derive()` merges an entry's follow-ups, the newest answer to each question winning, into `entry.outcome`. Undo is a `void` of the follow-up.

**Signing flow.** The supervisor opens a student, ticks entries, confirms. `POST /api/sup/sign` makes the server check that the supervisor is assigned to that student and that each entry exists, is not deleted and is not already signed. For each one it writes a `sign` event into the *student's* event stream. The student's tablet receives it with its next sync, like any other event.

**Targets flow.** On a student's page, under the tab "Targets", the supervisor has a card "Targets" (each target with how many the student performed) and "Set targets" / "Change targets": a pop-up with every procedure that can be logged (`TARGET_PROCEDURES` in `config.js`, those on the New case tab first), a search and a number field each, the current targets filled in; empty or 0 is no target (`openTargets` in `supervisor.js`). `POST /api/sup/targets` makes the server check the assignment, that each procedure is offered and that each number is a whole number from 0 to `MAX_TARGET` (500), all or nothing, and writes a `target` event into the *student's* event stream for each target that changed (`setTargets` in `server/lib.js`; also in the administrators' log). The student's tablet receives them with its next sync, like a signature; `core.targets()` works out the targets in force (the newest event per procedure wins, 0 removes it, so with several supervisors the last change counts). Nothing is ever edited: changing a target adds an event.

**New tablet.** Login returns a token. The first sync starts at cursor 0 and the server returns the whole history in pages of 500. Everything the student ever logged reappears.

**After a restore.** Every database has an id (`db_id` in the `settings` table, `databaseId` in `server/lib.js`), sent with every sync; each backup copy gets a new one (`backupTo`), and `admin.js mark-restored` gives one to a disk snapshot. A tablet remembers the id. When it changes, the server was restored and has lost what came after the backup, while the tablet had marked it as sent and its cursor may be past the server's newest event. So the tablet starts over (`syncCore` in `app.js`, `restartSync` in `core.js`): it forgets what was sent, sends all the student's own events again (the server stores each once, so this is harmless), and fetches everything from cursor 0. Signatures and targets are not sent again (only the server makes them); once everything is fetched, those the server no longer has are removed from the tablet (`dropServerEventsExcept`), so the student sees what the server has and the supervisor signs again. Until that is finished `resync` stays in `meta`, so an interrupted sync starts over.

**Updates.** The server also serves the app files. A new version is a redeploy; tablets pick it up the next time they open the app with internet (see [10.2](#102-release-a-new-version)).

## 5. The rules the design depends on

Read these before changing anything. Most bugs in this kind of system come from breaking one.

1. **The event log is append-only.** Entries are never edited or deleted. A mistake is a `void` event on top; a signature is a `sign` event on top. The current state (`derive()` in `core.js`) is computed from the log. That is what makes offline use and sync conflict-free: two tablets can never overwrite each other, they only add events. If you feel the need for "update entry", add a new event type instead. **The one exception** is erasing a person on request (GDPR): an administrator can delete a whole account, only after disabling it, and `deleteUser` in `server/lib.js` then removes everything that account owns. Never use it to change or remove single entries.
2. **Event ids are unique and the server is idempotent.** Ids are UUIDs made on the device. The server stores `(owner, id)` once (`INSERT OR IGNORE`), so sending the same event twice is harmless. This is why retrying is always safe.
3. **Never trust the client.** `validateEvent` in `server/lib.js` copies only whitelisted fields and sets the owner to the logged-in account itself. A new field that is not added there is **silently dropped**, not rejected.
4. **Students cannot create signatures or targets.** `sign` and `target` events from a student's sync are refused (`sign_not_allowed`, `target_not_allowed`). Only `/api/sup/sign` and `/api/sup/targets` create them, after checking the assignment.
5. **A signed entry is locked.** A `void` for a signed entry is refused (`signed_locked`) and the tablet forgets the delete (`dropEvent`).
6. **Content lives in `config.js`, logic in the other files.** Procedures, roles and hospitals are data (targets are set per student in the app). Do not hide them in code.
7. **No patient identifiers, no free text.** Not in the UI, not in events. If you add a field, make it a choice from a fixed list or a number. This is the main privacy protection and it is also what makes the system acceptable to run.
8. **Ids are forever.** A procedure id (for example `cs`) is stored in every entry. Never rename, reuse or delete one. Role ids likewise.
9. **The database only grows by addition.** See [10.6](#106-change-the-database).
10. **Zero server dependencies, no build step.** Keep it that way unless there is a strong reason: it keeps the project easy to read, run and hand over.

## 6. Files

| File | Purpose |
|---|---|
| `index.html`, `manifest.webmanifest`, `icon-*.png` | The page that loads the app; install metadata. |
| `config.js` | **Content to edit**: version, server address, procedures (and which can get a target), roles, hospitals. |
| `core.js` | Student data layer. IndexedDB event log, `derive`, progress, sync bookkeeping, counts. No DOM, so it can be tested in Node. |
| `api.js` | Every call to the server, as a function. Turns failures into `ApiError` with a message that can be shown as is. Also the `?api=http://localhost:...` override that lets the hosted app talk to a server on the tester's own computer (localhost only, by design). |
| `ui.js` | Shared interface pieces: the `h()` DOM helper, toast, sheets (modals), the password form, the case pop-up (`openCase`) that all three apps share, the short case row of supervisors and administrators (`caseRow`), and the procedure tiles of Progress (`procTile`, `procedureProgress`), which administrators use too, and the "Show only" filter button and pop-up (`filterButton`, `openFilterSheet`) of History and Users. |
| `app.js` | Entry point. Decides what to show (login, forced password, hospital, student tabs, or the supervisor screens). Student screens and sync live here. |
| `supervisor.js` | The supervisor screens: My students, Add students, one student with signing, More. |
| `administrator.js` | The administrator screens: Overview (tabs Students, Procedures, Hospitals), a page per student (Cases, Progress), Manage users (the list of accounts, and a page to add users), Download data (the spreadsheets), More (backup, recent changes). |
| `style.css` | All styling. Large touch targets; colours are variables at the top. |
| `sw.js` | Service worker: caches the app files so it opens offline. **Change `CACHE` on every release.** |
| `server/index.js` | Starts the server from environment variables. |
| `server/app.js` | The HTTP API and static file serving. |
| `server/lib.js` | Database schema and upgrades, passwords, account functions, assignments, event validation, signing. No HTTP. |
| `server/admin.js` | Command-line administration (the same operations as the administrator screens, for when the app cannot be used). |
| `Dockerfile`, `.dockerignore` | One container with server and app. Built and run by Fly.io for the current deployment. |
| `docker-compose.yml`, `local.env` | Run the container (or the plain server) on your own computer with production-like settings. |
| `dev/dev-server.mjs`, `dev/seed.mjs` | **Developer tools, not part of the app** (not in `sw.js`, `server/app.js` STATIC or the `Dockerfile`, and never deployed). `npm run dev` serves the app with live reload and no caching, plus the real API on `data/dev.db`; `seed.mjs` creates the demo accounts and entries. See [10.9](#109-front-end-work-with-the-dev-server). |
| `test/*.test.mjs` | `core` (data layer), `server` (API and rules), `api` (the localhost-only server override), `ui` (student flow), `ui-supervisor` (supervisor flow), `ui-admin` (administrator flow), `files` (file lists stay in step), `dev` (the developer tools). |
| `README.md` | Short overview. `DEPLOY.md` hosting guide. `TESTER-GUIDE.md` instructions for people trying the app. |
| `CLAUDE.md` | Short instructions for AI assistants working in this repository. |

Rough size: about 2,300 lines of code (plus 160 lines of CSS) and 1,000 lines of tests.

## 7. Data

### 7.1 On the server (SQLite, `data/logbook.db`)

| Table | Holds |
|---|---|
| `users` | `candidate` (the account id, called "candidate number" in the app for everyone, also supervisors and administrators; the column keeps its first name), `pw_hash` (scrypt), `must_change` (initial password still in use), `disabled`, `role` (`student` or `supervisor`), `display_name` (the name: a supervisor's is shown to students next to a signature, a student's to the student, their supervisors and administrators, an administrator's only at the top of their own screen; the form for a new administrator therefore says only "Name"), `created_at`, `last_login_at`. |
| `sessions` | `token_hash` (SHA-256 of a random token; the token itself is never stored), `candidate`, `created_at`, `last_seen`. |
| `events` | `seq` (increasing number, the sync cursor), `owner` (always the **student** the event is about), `id`, `type`, `target`, `payload` (the whole event as JSON), `received_at`. `UNIQUE(owner, id)`. `type` and `target` are copies of fields inside `payload`, kept so they can be queried. |
| `assignments` | `supervisor`, `student`, `created_at`. Many-to-many: a student can have several supervisors. |
| `settings` | `key`, `value`. Values about the database itself: `db_id`, the id of this copy of the data (see "After a restore" in [4](#4-how-it-fits-together)), and `pseudonym_key`, the secret behind the codes in the anonymous spreadsheets (never shown; a backup keeps it, so codes stay the same after a restore). |

### 7.2 Events

Every fact is an event. All have `id`, `type`, `ts` (device clock, ISO time).

| Type | Made by | Extra fields |
|---|---|---|
| `entry` | student tablet | `student`, `hospital`, `procedure`, `role` (`observing`, `assisting`, `supervised`, `independent`; ids only, the app shows them in the past tense, "Observed", "Assisted", because everything is logged afterwards, `ROLES` in `config.js`), `performed_on` (date the student says), `entered_on` (date it was logged), `schema` (1), `details` (optional: `{question id: option id or whole number}`, questions from `DETAIL_FIELDS`; left out when nothing was answered; a question hidden by `showIf` is not saved). Entries made by apps older than 0.13.0 also hold `ms_to_log` and `online` (how the app was used); they are no longer collected, stored or shown anywhere, and the server ignores them if an old app still sends them. An app from 0.13.0 on needs a server from 0.13.0 on (older servers refused an entry without `ms_to_log`); they are deployed together, so this only matters with the `?api=` override against an older local server. |
| `followup` | student tablet | `target` (an entry id), `known_on` (the day the student learnt it), `answers` (`{question id: option id}`, questions from `FOLLOWUP_FIELDS`, at least one). Only the answers that changed. |
| `void` | student tablet | `target` (an entry or follow-up id). "Delete", or Undo of a follow-up. |
| `sign` | **server only** | `target` (an entry id), `supervisor` (account id), `supervisor_name` (name at the time of signing) |
| `target` | **server only** | `procedure` (a procedure id from `TARGET_PROCEDURES`), `count` (how many to perform, 1 to 500; 0 removes the target), `supervisor`, `supervisor_name`. Set by a supervisor; the newest per procedure counts. |

"Performed" in progress counts means role `supervised` or `independent`.
Three clocks exist: `ts` and `entered_on` come from the tablet (can be wrong), `performed_on` is chosen by the student, `received_at` is the server's. Use `received_at` when you need a time you can trust.

### 7.3 On the tablet (IndexedDB)

One database per student: `surgical-logbook-<CANDIDATE>`, version 2, stores `events`, `meta` (hospital, sync cursor, last sync, supervisors list, `server_db` (the server's database id at the last sync) and `resync` (true while starting over after a restore)) and `sent` (ids the server has confirmed or that came from the server). The login session is in `localStorage` under `logbook.session` as `{candidate, token, must_change, role, name}`.
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
| `POST /api/sync` | student, password set | `events` (≤200), `cursor` | `accepted` (ids), `rejected` (`{id, reason}`), `events` (new since cursor, ≤500), `cursor`, `has_more`, `supervisors`, `db_id` (which copy of the data this is; it changes when the server is restored from a backup) |
| `POST /api/sup/students` | supervisor | | `students`: `candidate`, `entries`, `unsigned`, `since`, `last_received` |
| `POST /api/sup/candidates` | supervisor | | `candidates`: `candidate`, `name`, `mine`, `entries`, `last_received` (every active student, to pick from; shown like My students) |
| `POST /api/sup/assign` / `unassign` | supervisor | `candidate` | `{ok}` |
| `POST /api/sup/entries` | supervisor, assigned student | `candidate`, `cursor` | `events` (reduced fields), `cursor`, `has_more` |
| `POST /api/sup/sign` | supervisor, assigned student | `candidate`, `ids` (≤200) | `signed`, `signed_ids`, `skipped` (`{id, reason}`) |
| `POST /api/sup/targets` | supervisor, assigned student | `candidate`, `targets` (`{procedure id: number}`, 0 to 500, 0 = no target) | `changed` (the procedure ids that changed); 400 `bad_targets` if anything is not allowed (nothing is stored then) |
| `POST /api/admin/users` | admin | | `users`: `id`, `role`, `name`, `disabled`, `password_set`, `last_login_at`, `entries`, `supervisors` / `students` |
| `POST /api/admin/stats` | admin | | `totals`, `procedures` (per procedure across students), `students` (per student, per procedure) |
| `POST /api/admin/audit` | admin | | `log`: `at`, `actor`, `action`, `target`, `detail` |
| `POST /api/admin/create` | admin | `role`, `id`, `name` | `id`, `password` (shown once) |
| `POST /api/admin/create_many` | admin | `people` (≤100, each `{id, name?}`; the older `ids` still works) | `created` (`{id, password}`), `skipped` (`{id, reason}`) |
| `POST /api/admin/reset` | admin, not own account | `id` | `id`, `password` (shown once) |
| `POST /api/admin/disable` / `enable` | admin, disable not own account | `id` | `{ok}` |
| `POST /api/admin/revoke` | admin | `id` | `{ok}` |
| `POST /api/admin/delete` | admin, not own account, account disabled | `id` | `{ok}`, `events`, `assignments` (how many were removed) |
| `POST /api/admin/rename` | admin | `id`, `name` | `{ok}` |
| `POST /api/admin/export` | admin | `kind` (`progress`, `procedures`, `hospitals`, `entries`, `codebook`), `delimiter` (`,` or `;`), `anonymous` (true: codes instead of candidate numbers, names and supervisor ids; not for `hospitals` and `codebook`, which have no people) | a CSV file (`entries` has one column per detail question, `surgical_apgar` (the three parts added up, empty if one is missing), `followup_status` (done, open, missed), one `followup_<id>` column per follow-up question with the newest answer, `followup_on` and `followup_day`; answers are the stored codes, explained in `codebook`; `procedures` and `hospitals` count `followup_done`, `followup_open`, `followup_missed`) (UTF-8 with byte order mark; cells starting with `= + - @` are prefixed so spreadsheets do not run them) |
| `POST /api/admin/backup` | admin | | the database file (a consistent copy) |
| `POST /api/admin/assign` / `unassign` | admin | `supervisor`, `student` | `{ok}` |
| `POST /api/admin/entries` | admin | `candidate`, `cursor` | `events`, `cursor`, `has_more` |

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
- **Transparency**: a student sees the list of supervisors who can see their entries (More tab) and who signed what.
- **Transport**: HTTPS is required. Passwords travel in the request body, protected only by HTTPS. Never run the server on the open internet over plain HTTP.
- **Static files**: the server serves only a fixed list of app files, never the database or server code.

What is *not* protected, honestly:

- A tablet that is unlocked and logged in is trusted. Whoever holds it can read and add that student's entries (or, for a supervisor, sign). The tablet's screen lock is the user's job.
- A signature means "the logged-in supervisor account asked the server to sign this". It is not cryptographic proof, and a supervisor who leaves a tablet unlocked can be signed in. The confirm dialog reduces accidents only.
- Any supervisor can add any student without the student's approval (the student can see it, and an admin can remove it). Whether that is acceptable is a question for CapaCare ([14](#14-open-questions-for-capacare)).
- Every supervisor can list all candidate numbers (to pick students to add).
- A student's "Delete" is a soft delete: voided entries stay in the database. To erase a person, an administrator disables the account and then deletes it for good (Manage users, or `admin.js delete`). That removes the account, its sessions, its supervisor links and, for a student, every event in their stream including signatures. A supervisor's signatures stay in the students' records, with the supervisor's id and name. SQLite runs with `secure_delete`, so removed data is overwritten in the file. **Backups taken earlier still contain it**, and so do entries still on the student's tablet until they log out there. The audit log keeps the id of the deleted account (who deleted whom, and when).
- The privacy notice (`PRIVACY` in `config.js`) is a draft: the contact and how long data is kept must be decided, and who is responsible (the data controller) must be decided and then named in it ([14](#14-open-questions-for-capacare)). Then set `PRIVACY_IS_PLACEHOLDER` to false.
- Backups contain everything (names, entries, password hashes) and must be protected as much as the live database. An administrator can download one from the app; that download is written to the audit log.
- Student names are personal data about staff-in-training. They are shown to administrators, to the student themselves and to the supervisors who can find or have added the student. They appear in the spreadsheet files only when the administrator chooses "With names" (anonymous is chosen again at every login); the "procedures per hospital" file and the codebook never contain names. The anonymous files are pseudonymised, not anonymous in the legal sense: a code always means the same person, and dates and hospitals stay in them, so someone who knows who worked where and when may recognise a person. Treat them as personal data too, and decide with CapaCare which are used for research.
- The audit log records account changes (create, reset, disable, enable, log out, rename, assign, unassign) with who did it and when; it never holds passwords. It does not record who *read* data.
- An administrator can see every student's entries and give any account (except their own) a new initial password, which is shown once. Keep the number of administrators small and give each person their own account.

Legal and ethical status (not legal advice): the server holds performance data about people identified by candidate number. Before real data is collected someone must be named as data controller; the host must be chosen with data location in mind (EU/EEA recommended); and research use needs ethics approval (in Sierra Leone through the SLESRC) and consent. As of the last check Sierra Leone had a data protection policy (April 2026) but no data protection act; the details should be confirmed locally.

## 10. How to make changes

Always: make the change, run `npm test`, update this file if behaviour changed, commit.

### 10.1 Change content: procedures, targets, hospitals

Edit `config.js`. Procedure ids must match `^[a-z0-9_]{1,40}$` (the server rejects others). **Never rename or delete an id**; a removed id shows up as its raw id in old entries. To stop offering a procedure, move it to `PROCEDURES_RETIRED` (old entries keep its name).
`PROCEDURES` holds every procedure that can be logged. `group` is the surgical group it is listed under in "More operations" (`PROCEDURE_GROUPS`, as in CapaCare's logbook, each with an "Other"); `delivery: true` makes it a way of giving birth. A caesarean has both; a procedure without a group is not an operation and uses the delivery wording of the roles. The buttons on the Log tab, after the student has chosen Surgery or Delivery, are `LOG_SURGERY` and `LOG_DELIVERIES` (together, each once, they come first in the list a supervisor sets targets from). The Progress tab shows the procedures that have a target, then those that have cases. A test in `core.test.mjs` checks that ids are valid and unique and that these lists only name procedures that exist.
Hospitals are stored by name: renaming one leaves old entries with the old name.
Targets are not in `config.js`: a supervisor sets them per student in the app (the targets flow in [4](#4-how-it-fits-together)). `TARGET_PROCEDURES` says which procedures can get a target (every procedure that is offered) and in which order the supervisor sees them; `MAX_TARGET` is the highest number. A new procedure in `PROCEDURES` can get a target at once.

### 10.2 Release a new version

1. Change the version in **four** places: `APP_VERSION` in `config.js`, `version` in `package.json`, `CACHE` in `sw.js` (`logbook-v<version>`), and the line `Version **x.y.z**` in section 2 of this file (check at the same time that the status text there is still true). `test/files.test.mjs` fails if they differ. The app shows the version only under the login form and under More, About (no strip on every screen, so it looks like a finished product).
2. **Why `CACHE` matters:** the browser only installs a new service worker if `sw.js` itself changed. If you forget, tablets keep serving the old app files from the old cache. This also means: **every deploy that changes an app file needs a new version**, even a small fix. Deploying changed files twice under the same version leaves devices that already have that version on their old files. The new cache is always filled with fresh files from the server (`cache: 'reload'` in `sw.js`), never with copies the browser still holds, so old and new files are not mixed.
3. If you added an app file: add it to `ASSETS` in `sw.js`, to `STATIC` in `server/app.js` and to the `COPY` line in `Dockerfile`. The same test checks this.
4. `npm test`, commit, deploy (`DEPLOY.md`).
5. Tablets fetch the new version next time the app is opened with internet. They show "App updated, close and reopen it". Old and new app versions share the same server API, so a mixed period is fine as long as you only *add* to the API.

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

For a new **detail or follow-up question** none of this is needed: add it to `DETAIL_FIELDS` or `FOLLOWUP_FIELDS` in `config.js` and to a part of the lists below them (each part may word a question differently with `ask`, as the Mother part does for the age; `DETAILS_OPERATION` for operations, `DETAILS_BIRTH` for deliveries, `DETAILS_BIRTH_OPERATION` for a delivery that is an operation, `DETAILS_BY_PROCEDURE` for one procedure, and the `FOLLOWUP_…` lists likewise). Each part has a heading on the screen. `ask` is the wording on the screen if it differs from `label` (used in summaries); `showIf: {question: [answers]}` asks it only after one of those answers (used for the second and third baby and for the cause of death). The server checks answers against the same lists, and the screens and the CSV columns follow. Question and option ids are stored in events: never rename or reuse one. Then release.

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

Student: add to `TABS` and `tabContent()` in `app.js`. Supervisor: add to the `tabs` array in `nav()` and to `body()` in `supervisor.js`. Use classes from `style.css`; keep touch targets at least 44 px. The tab bar sits at the top, under the header (both always stay at the top: once logged in the window does not scroll, only the page under them, `appShell()` in `ui.js` and `.shell`; with `position: sticky` or `fixed` an iPhone pulled the header away on long pages and when the page bounced; `pageScroll`/`setPageScroll` keep or reset where the page is scrolled to; the content sits in `.page`, which on a touch screen (`pointer: coarse`) is always 1 px taller than the visible part, so a short page such as Log or More can still be dragged and springs back instead of feeling frozen; with a mouse it is not, so a short page does not move with the wheel; `scrollbar-gutter: stable both-edges` always keeps room for a PC's scrollbar, on both sides so the page stays in the middle under the header, so the page does not jump sideways when it gets long enough to scroll, for example when the hospital menu opens; there are no wide tables any more (they were hard to use on a tablet; if one is ever needed, let it scroll sideways in its own box with `overscroll-behavior-x: none`, or on a phone or tablet it can be pulled past its first column into an empty strip that springs back)); all tabs are equally wide. On a phone or tablet a touch while the page or a pop-up is still scrolling only stops it and the browser sends no click; buttons that stay in place (in `.sheet-foot`, `.sheet-head`, `.top-bar` or `#toast`) are therefore pressed by the touch itself (`pressOnTouch` in `ui.js`), so Cancel and Save always work at once. In a pop-up with buttons at the bottom only the part between its heading and its buttons scrolls (`openSheet` wraps it in `.sheet-body`), so the buttons never move, also not when an iPhone bounces. Put a new button of that kind inside one of these; buttons that scroll with the content keep the browser's normal behaviour. A pop-up fades in as one piece (`#overlay.open` and `.layer` in `style.css`): the dark layer, the pop-up and its arrows together. Do not give `.sheet` a fade of its own (on an iPad the dark layer came first and the pop-up after, which looked like two steps); an edge line fades in (`.fade`, set by `scrollHint`) only when it comes later, not while the pop-up opens. Little bold text: only headings, buttons and what is chosen (the open tab) are semi-bold (600); names, tags and table headings are medium (500); in the pop-up for a new case (and the follow-up) the title and the part headings are medium, the questions a little lighter (475) and the answers between normal and medium (450, the chosen one 550; a font without every weight shows the nearest one); the procedures on the Log tab, the cases in History and the procedures in Progress medium too, but smaller (18 px), on Log and in History with the same grey line under it (one shared rule in `style.css`, `.proc-name, .e-text > strong, .prow-top > strong` and `.proc-count, .e-sub`), and a label beside its value (Hospital, Age, a question in a case) is plain grey, so the value stands out (the rule is at the top of `style.css`; a lot of bold made the screens harder to read). The More tab looks the same in all three apps: cards with rows (the label small and grey, the value under it: `fact` in `ui.js`; a person, such as a supervisor, the other way round: the name first), and the rarely needed things folded away at the bottom under "Advanced" (`advancedCard`, with About and "Your data", `privacyFact`; a card that folds open is `foldCard` in `ui.js`; an administrator's Advanced also holds "Recent changes", after About). Do not add `viewport-fit=cover` to `index.html`: on Android Chrome it draws the page under the system gesture bar and leaves an empty white strip at the bottom (a test checks this). Strings are written inline in English; there is no translation layer yet (adding one means extracting the strings first). Do not give elements class names that look like advertising (`ad`, `adv-…`, `ads`, `sponsor`, `promo`): ad blockers hide them, but usually not on `localhost`, so it only shows up on the live site (this happened to the "Advanced" title, class `adv-text`, in 0.7.1).

### 10.8 Manage accounts (administrator)

Normal route: log in as an administrator and use the screens (Manage users, with its "Add users" page). Every action there is written to the audit log. The first administrator is created at startup from `ADMIN_ID` and `ADMIN_PASSWORD` (only if that account does not exist yet).

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
- The dev server shows the app **without** the real service worker, so it cannot show offline behaviour or the "App updated" message. Test those with `npm start` (and DevTools, Network, "Offline") before a release.
- Work on a branch, commit as often as you like, and release **once** when a set of changes is finished ([10.2](#102-release-a-new-version)): bump the version in the four places, run `npm test` and update this file. Do not bump the version for every small change.
- The UI tests (`test/ui*.test.mjs`) run in a simulated browser and can fail when screens change. Run `npm test` now and then while you work, not only at the end.
- To change the demo data, edit `dev/seed.mjs` and the table above. The seed checks every entry with `validateEvent`, so it fails loudly if the event rules change.

## 11. Running it

Hosting, updating, backups, restoring and costs are in **`DEPLOY.md`**. The current deployment is described in its section "Current deployment". The short version:

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
| No WhatsApp sharing (removed in 0.13.0, with the weekly summary) | Not needed; WhatsApp's Business policy also restricts health information | Students see their progress in the app; nothing is shared from it. |

## 13. Known limits

- **Not tried on a Samsung tablet.** It works in Chrome on a Windows PC and an iPhone (reported by the product owner). Installation on the tablet, offline behaviour, performance on the actual devices and the look on the real screen are unverified.
- **Deployment only partly checked.** It runs on Fly.io (see `DEPLOY.md`, "Current deployment"). The rest of the `DEPLOY.md` checklist (backup and restore, offline mode, second device) has not been recorded as done.
- **Supervisors need internet to sign**, and see nothing offline.
- **No password reset without an administrator**, no two-factor login, no per-address rate limiting; the login lock is in memory.
- **Deleting an account is two steps** (disable, then delete for good) and cannot be undone. An administrator cannot reset, disable or delete their own account; another administrator must.
- **The research export is not approved yet.** The anonymous spreadsheets (codes instead of candidate numbers and names) are built, but dates and hospitals stay in them, and using them for research still needs ethics approval and a decision on outcome data ([14](#14-open-questions-for-capacare)).
- **No automatic retention.** Nothing is deleted after a set time; erasure is done by an administrator, account by account.
- **English only.**
- **Whole history is sent to a new tablet.** Fine for hundreds or a few thousand entries per student; revisit beyond that.
- **Accessibility** has not been checked beyond large touch targets and labels.
- **Targets are set one student at a time.** There is no programme-wide default yet; a supervisor sets them for each student. The procedure and hospital lists and the questions are CapaCare's from 2021. A caesarean asks about 20 questions; which to keep is still to be decided.
- **Not taken over from the 2021 logbook:** patient initials and address (district) identify the patient; times of day (operation start and end, time of birth) are replaced by the operation time in minutes; dates after the operation (discharge, reoperation, referral, death) by yes/no and "days". Reoperation and referral are yes/no only.
- **Follow-up has no reminder.** The student has to remember to open History. A list or count of operations still waiting for a follow-up is a likely next step.
- **The same operation can be logged by several students** (one operating, one assisting). Their follow-ups are separate, so counting outcomes needs care (for example only entries with role `supervised` or `independent`).
- **The 6-week follow-up window is only enforced in the app**, from dates on the tablet; the server accepts a follow-up at any time.
- **All detail questions are optional**, but Save asks before saving an entry with unanswered questions. Making some required is a small change in `questions()` in `app.js` once CapaCare decides which.
- **Single server, single file.** No redundancy; a failed disk means restoring from the last backup.
- **A restore loses what the server got after the backup, except what is still on the tablets.** Tablets send the students' entries, follow-ups and deletes again by themselves at their next sync. Signatures and targets made after the backup are lost (only the server makes them; students cannot send them back): supervisors sign those entries again and set those targets again. Accounts created after the backup are gone and must be created again. The restore itself has not been tried on Fly yet (see `DEPLOY.md`).

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
   **The baby in the follow-up** (added in 0.13.13, a proposal): each baby born alive gets "Outcome" (alive, died, not known) and the days from birth until death, within the 6-week follow-up. Is this wanted, and is that the right question?
7. **Languages.** English only, or also Krio?
8. **What does "better than the CheckWare logbook" mean?** Suggested measures, already collected: share of students who log weekly, entries per student per week, share of entries signed within 14 days, and interviews (questions in `TESTER-GUIDE.md`). Agree thresholds before the trial.
9. **Who runs and pays for the server** after the prototype, and who holds the accounts and backups.
10. **A contact person in Sierra Leone** for remote testing, first set-up and feedback.

## 15. Next steps

In rough order:

1. Try the deployed app on a real Samsung tablet with one or two students and one supervisor, with a contact person on site. Fix what you learn before anything else.
2. Check the procedure list and hospitals. Perhaps: default targets for the whole programme, which a supervisor can then change per student.
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
- The tests are the safety net: whole-flow tests for both apps and the server rules. A change that needs a test to change deserves a second look.
- Be careful with: the rules in section 5, anything touching `validateEvent`, `initSchema` or authentication, and anything that adds a dependency.
- It cannot test on a real tablet or deploy for you. Real-device checks are yours.
