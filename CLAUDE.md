# Instructions for AI assistants working in this repository

Read `PROJECT.md` first (what this is, the rules, where things are, how to make common changes). This file is the short version of what matters most.

## Before you finish any change
- Run `npm test`. All tests must pass. Add or update tests for what you changed.
- If behaviour, data, API or files changed, update `PROJECT.md` in the same change.
- If you changed an app file (anything the browser loads), release it: bump the version in `config.js`, `package.json` **and** `CACHE` in `sw.js`; a new app file must also be added to `sw.js` ASSETS, `server/app.js` STATIC and the `Dockerfile`. `test/files.test.mjs` checks this.

## Rules that must not be broken
- The event log is append-only. Never add "edit entry". Mistakes are `void` events, signatures are `sign` events.
- The server never trusts the client: owner is stamped by the server and `validateEvent` whitelists fields (a new field must be added there or it is silently dropped). Only the server creates `sign` events.
- No patient identifiers and no free text, in the UI or in events. Use fixed lists or numbers.
- Never rename, reuse or delete a procedure id or role id.
- Database changes are additive only, inside `initSchema()` in `server/lib.js`, with an upgrade test. Never drop or rename columns.
- No new runtime dependencies in the server and no build step for the app, unless the user explicitly agrees.
- Do not commit `data/`, `*.db`, passwords or tokens.

## Conventions
- Code, comments, UI text and docs are in English. The product owner often writes in Norwegian; answer in the language they use.
- UI is for people with low IT literacy on a tablet: big touch targets, short plain words, no jargon, nothing that needs e-mail.
- Plain JavaScript modules. Content (procedures, targets, hospitals) lives in `config.js`; logic elsewhere.
- Keep changes small and say what you could not test. You cannot test on a real tablet or deploy to a host; do not claim that you did.
