// Start the server:  node server/index.js
// Environment: PORT (8080), HOST (0.0.0.0), LOGBOOK_DB (./data/logbook.db),
// ALLOWED_ORIGIN (comma-separated, only needed if the app is hosted elsewhere, e.g. GitHub Pages),
// SERVE_STATIC (1 = also serve the app files from this server; set 0 to disable).

import { createServer } from './app.js';

const port = Number(process.env.PORT || 8080);
const app = await createServer({
  dbPath: process.env.LOGBOOK_DB || './data/logbook.db',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '',
  serveStatic: process.env.SERVE_STATIC !== '0',
});
const actual = await app.listen(port, process.env.HOST || '0.0.0.0');
console.log(`Logbook server listening on port ${actual}`);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => { await app.close(); process.exit(0); });
}
