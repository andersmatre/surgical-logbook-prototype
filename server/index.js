// Start the server:  node server/index.js
// Environment: PORT (8080), HOST (0.0.0.0), LOGBOOK_DB (./data/logbook.db),
// ALLOWED_ORIGIN (comma-separated, only needed if the app is hosted elsewhere, e.g. GitHub Pages),
// SERVE_STATIC (1 = also serve the app files from this server; set 0 to disable),
// ADMIN_ID + ADMIN_PASSWORD (optional: create the first administrator on first start).

import { createServer } from './app.js';
import { bootstrapAdmin } from './lib.js';

const port = Number(process.env.PORT || 8080);
const app = await createServer({
  dbPath: process.env.LOGBOOK_DB || './data/logbook.db',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '',
  serveStatic: process.env.SERVE_STATIC !== '0',
});
// First start: create the first administrator from ADMIN_ID and ADMIN_PASSWORD (host secrets), so
// no shell access is needed. The password only works for the first login, which forces a new one.
// It does nothing when the account already exists; remove ADMIN_PASSWORD from the host afterwards.
if (process.env.ADMIN_ID && process.env.ADMIN_PASSWORD) {
  try {
    const made = await bootstrapAdmin(app.db, process.env.ADMIN_ID, process.env.ADMIN_PASSWORD);
    if (made) console.log(`Created the first administrator ${made}. Log in and choose your own password, then remove ADMIN_PASSWORD from the host settings.`);
  } catch (e) { console.error(`Could not create the administrator: ${e.message}`); }
}
const actual = await app.listen(port, process.env.HOST || '0.0.0.0');
console.log(`Logbook server listening on port ${actual}`);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => { await app.close(); process.exit(0); });
}
