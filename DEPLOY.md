# Putting the server online

This explains how to get the logbook server running on the internet so students can log in from their tablets.
It was written from the documentation and published prices of the hosts below. **The Fly.io steps (option A) have since been used for the current deployment** (see "Current deployment" below); the other options (B and C) have not been run. The server itself is tested and was started and used over HTTP locally.

## Current deployment

Status as reported by the product owner on 2026-10-28. It was not checked by the AI assistant that wrote this section, which cannot reach the service from its workspace.

| | |
|---|---|
| Host | Fly.io, option A below, set up with the settings in `fly.toml` |
| Address | `https://capacare-logbook.fly.dev` (students install the app from here; changing it means reinstalling on every tablet) |
| Setup | App `capacare-logbook`, region Stockholm (`arn`), one 512 MB machine, one volume `logbook_data` mounted at `/data` |
| Works in | Chrome on a Windows PC and on an iPhone |
| Not yet tried | A Samsung tablet (installing from the home screen, offline use, speed), supervisors on a second device |
| Not recorded | Whether the checklist below was done, in particular **taking and restoring a backup**; the data controller and the person who holds the Fly account (see `PROJECT.md` section 16) |
| Deviations from this guide | None reported |

Update this table whenever something changes (host, address, region, who owns the account).

## What you are deploying

One container with one Node process. It serves the app files *and* the API at one address, so there is no cross-origin set-up. It keeps all data in one SQLite file.

The host must give you three things:

| Need | Why |
|---|---|
| A **persistent disk** (volume) mounted at `/data` | The database lives there. Without it every restart deletes all accounts and entries. |
| **HTTPS** | Passwords are sent to the server, and service workers (offline mode) only run on HTTPS. |
| **Exactly one copy** of the server | SQLite in one file cannot be shared by two servers. Do not scale to two machines. |

Also choose a region in the **EU/EEA** (data protection), and pick it with latency in mind: a tablet in Sierra Leone reaches Europe in a few hundred milliseconds, which is fine for these small requests.

## First rehearse on your own computer

Do this before renting anything. It uses the same container, a persistent volume and the same settings as a rented server, so what you learn carries over.

**Closest to the real thing (needs Docker Desktop):**

```
docker compose up --build
docker compose exec logbook node --no-warnings=ExperimentalWarning server/admin.js add-admin ADMIN-ANDERS --name "Anders"
```

Then log in as the administrator and create supervisors and students on the Add users tab.

Open `http://localhost:8080`. The server serves the app itself, exactly as a rented server will. Use two browser profiles (or one normal and one private window) to be a student and a supervisor at the same time. `docker compose down` stops it and keeps the data; `docker compose down -v` deletes the database. (`docker-compose.yml` has not been run by its author: no Docker was available where it was written.)

**Without Docker:** `npm run local` starts the server with the settings in `local.env`; create the first administrator with `npm run admin -- add-admin ADMIN-ANDERS --name "Anders"`.

**With the app on GitHub Pages and the server on your computer:** start the server as above, then open

```
https://andersmatre.github.io/surgical-logbook-prototype/?api=http://localhost:8080
```

once. The app remembers the address (the login screen says "Test mode"); `?api=` with nothing after it switches it off. Only `localhost` addresses are accepted. This works only on the computer that runs the server. The server must allow the Pages address (`ALLOWED_ORIGIN`, already set in `docker-compose.yml` and `local.env`). Chrome may ask for permission to connect to devices on your local network; allow it. If it does not work, use `http://localhost:8080` directly. This combination (app on one address, server on another) is **not** how the rented setup works, so use it only to try the Pages publishing.

**What is different from a rented server:** no HTTPS and no public address. A tablet on the same Wi-Fi cannot install the app from `http://<your-computer>:8080`, because installing and offline mode need HTTPS. Testing on a real tablet therefore needs the real server (or a tunnel, for a short demo with test data).

**Tested in a real browser:** with the app and the server on two different local addresses, in Chromium: login, own password, logging, sync, opening the app offline after a reload, and syncing when the connection returns. Not tested: GitHub Pages itself talking to localhost, Safari or Firefox, a real tablet.

## Decide first

1. **Whose account hosts it?** Preferably a CapaCare or project account that more than one person can recover, not only your private card. See the handover checklist in `PROJECT.md`.
2. **What address?** A host gives you one for free (for example `https://something.fly.dev`). A nicer address (`logbook.example.org`) needs a domain; whoever manages CapaCare's domain can add one record. Students install the app *from this address*, so changing it later means reinstalling on every tablet. Decide before you hand it to anyone.
3. **Who is the data controller?** Settle this before real data is stored (`PROJECT.md` section 9 and 14).

## Option A: Fly.io (least work; suggested for the trial)

Fly runs your container on a small virtual machine, gives it HTTPS automatically and attaches a volume. There is no operating system for you to look after.

Cost, from Fly's pricing page when this was written (check it again, prices change): a small shared machine is about **$2.19 per month with 256 MB or $4.39 with 512 MB**; a volume is **$0.15 per GB per month**; volume snapshots are $0.08 per GB per month with the first 10 GB free. A 1 GB volume is far more than this project needs for a long time. Use the 512 MB machine (password hashing uses about 16 MB per login). Expect roughly **$5 a month**. Fly may require a payment card at sign-up; that was not stated on the page.

Regions: Fly has Europe regions including Amsterdam (`ams`), Stockholm (`arn`), Frankfurt (`fra`) and Paris (`cdg`). This list is from memory; Fly's regions page could not be opened from the build environment, so check it.

### Steps

Install the Fly command-line tool (`flyctl`) and sign in (`fly auth login`). In the project folder:

1. The repository already contains `fly.toml` (app name `capacare-logbook`, Stockholm, one 512 MB machine, a volume mounted at `/data`, a health check). Change `app` if the name is taken: names are global on Fly.

2. Create the app and the volume, then deploy. Fly asks to confirm the volume ("a single volume has no redundancy"): answer yes.

   ```
   fly apps create capacare-logbook
   fly volumes create logbook_data --region arn --size 1
   fly deploy --ha=false
   ```

   `--ha=false` stops Fly from creating a second machine. There must be **one** machine only (check with `fly status`): the volume belongs to one machine and SQLite cannot be shared.

3. Create the first administrator. No shell is needed: set an initial password as a secret and deploy again.

   ```
   fly secrets set ADMIN_ID=ADMIN-ANDERS ADMIN_PASSWORD=choose-a-temporary-password
   ```

   (`fly secrets set` restarts the machine; the account is created at startup, only if it does not exist.) Open the address, log in with `ADMIN-ANDERS` and that password, and choose your own password. Then remove the temporary one:

   ```
   fly secrets unset ADMIN_PASSWORD
   ```

   Create supervisors and students in the app (**Add users**). Each gets an initial password that is shown **once**; pass it on through CapaCare. Later administrators are created the same way, in the app.

4. Open the address (`fly status` shows it) and run the checklist below.

Updating later: change the code, bump the version (`PROJECT.md` 10.2), `npm test`, `fly deploy`.
Logs: `fly logs`. If something is wrong with a deploy, `fly releases` and `fly deploy --image <previous image>` go back.

## Option B: your own small server (VPS) with Docker and Caddy

More control and often cheaper, but you maintain a Linux machine (updates, firewall, backups). Hetzner is one example: a press release about its Cloud plans listed a 2 vCPU, 4 GB RAM, 40 GB plan at **about €4.5 per month including 19 % VAT** in Germany and Finland. That may be outdated and plan names change, so check the current price list. The same recipe works at any provider that offers Ubuntu servers in the EU.

Needs a **domain name** pointing at the server (Caddy uses it to get the HTTPS certificate automatically).

1. Create an Ubuntu server, add your SSH key, point the domain's `A` record at its address.
2. Log in and install the basics:

   ```
   apt update && apt -y upgrade
   apt -y install docker.io git ufw unattended-upgrades
   apt -y install caddy
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
   ```
3. Get the code and start the container (it restarts by itself after a reboot):

   ```
   git clone https://github.com/andersmatre/surgical-logbook-prototype.git /opt/logbook
   cd /opt/logbook && git checkout login-v0.2     # or the branch you deploy from
   docker build -t logbook .
   docker run -d --name logbook --restart unless-stopped \
     -p 127.0.0.1:8080:8080 -v logbook-data:/data logbook
   ```
4. Tell Caddy to put HTTPS in front of it. `/etc/caddy/Caddyfile`:

   ```
   logbook.example.org {
     reverse_proxy 127.0.0.1:8080
   }
   ```
   then `systemctl reload caddy`.
5. Create accounts:

   ```
   docker exec logbook node --no-warnings=ExperimentalWarning server/admin.js add-admin ADMIN-ANDERS --name "Anders"
   ```

   It prints an initial password once. Log in and create everyone else in the app.

Updating: `cd /opt/logbook && git pull && docker build -t logbook . && docker rm -f logbook && docker run ...` (same `run` line as above; the data volume stays).
Logs: `docker logs logbook`.

## Option C: Render, Railway or similar

Any host works if it runs a container (or Node), gives you a persistent disk mounted at `/data`, and HTTPS. Set `LOGBOOK_DB=/data/logbook.db`. Check that the plan you pick really includes a persistent disk (free plans often do not, or put the service to sleep) and that you can choose an EU region. I did not verify prices or features for these hosts.

## After the first deploy: checklist

Do all of these before you give the address to anyone:

- [ ] `https://<address>/api/health` shows `{"ok":true}`.
- [ ] Opening `https://<address>` shows the login screen.
- [ ] On a real tablet in Chrome: log in with a test student, choose a password, log a procedure; no sync button is shown at the top right when everything is sent.
- [ ] "Add to Home screen" works and the app opens from the icon.
- [ ] Switch on airplane mode: the app still opens and logs; switch it off: the "Offline" button at the top right goes away.
- [ ] Log in as a test supervisor on another device, add the student, sign the entry; the student sees the signature after tapping "Sync now" (More tab, Advanced).
- [ ] Log out and log in on a second device: the entries come back.
- [ ] **Take a backup and restore it** (below). Do not skip this.
- [ ] Delete the test accounts' data, or start with a fresh database, before real students start.

## Backups

All data is in the database file.

**Easiest: in the app.** Log in as an administrator, open **More → Download backup**. The file is saved on the device you are using. The Overview tab warns when no backup has been taken for a week. Move the file to a safe place that is not the server (a USB stick, or CapaCare's own storage), and do not send it by WhatsApp or e-mail.

**From the command line**, if you cannot use the app, with the built-in command that makes a consistent copy while the server runs:

```
# Fly
fly ssh console -C "node --no-warnings=ExperimentalWarning server/admin.js backup /data/backups/logbook-$(date +%F).db"
# Docker on a VPS
docker exec logbook node --no-warnings=ExperimentalWarning server/admin.js backup /data/backups/logbook-$(date +%F).db
```

A copy that stays on the same disk does not protect you from losing the disk. **Copy it elsewhere**: on Fly `fly ssh sftp get /data/backups/<file> .` (see `fly ssh sftp --help`), on a VPS with `scp`, or use your host's volume snapshots in addition (Fly takes volume snapshots; check the retention on its dashboard). Keep copies in the EU, with restricted access: they contain everything.

How often: at least weekly while testing; daily when real data is being collected (a `cron` job on a VPS; on Fly, a scheduled task on your own computer or a small scheduled machine). Remove old backup files so the disk does not fill.

### Restore

The app downloads a plain database file, the same as the command line makes.

1. Stop the server (`fly machine stop`, or `docker stop logbook`).
2. Put the backup file in place of `/data/logbook.db`, and delete `/data/logbook.db-wal` and `/data/logbook.db-shm` if they exist.
3. Start the server and check the list: `admin.js list`.

Practice this once on a test deployment so you know it works before you need it.

## Moving off GitHub Pages

Version 0.1 (no login) is on GitHub Pages from the `main` branch. Version 0.3 needs the server and is served *by* the server, so students install it from the server's address, not from Pages. Leave `main` alone until the server is live and tested, then either switch Pages off or leave it as an offline demo of v0.1.

If you ever want the app on Pages and only the API on the server: set `API_BASE` in `config.js` to the server address and start the server with `ALLOWED_ORIGIN=https://<user>.github.io SERVE_STATIC=0`. It is not recommended: two addresses mean two things to keep in step.

## Data protection reminders

(Not legal advice; settle these with CapaCare.)

- Pick a host and a region you can name in the data protection documents, and check the host offers a data processing agreement.
- Restrict who can open a shell on the server or read the backups to the people who need it.
- Decide how long data is kept and who can ask for removal; deleting a person's data is a manual operation on the database today.
