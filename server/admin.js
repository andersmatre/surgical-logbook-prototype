// Account administration. Run on the machine where the database lives.
//
//   node server/admin.js add S1234 [--password secret]   create one account
//   node server/admin.js import candidates.csv           create many (first column = candidate number)
//   node server/admin.js reset S1234                     new initial password, logs the user out everywhere
//   node server/admin.js disable S1234 | enable S1234
//   node server/admin.js revoke S1234                    log out everywhere (e.g. lost tablet)
//   node server/admin.js list
//
// Initial passwords are printed once, as CSV on stdout. Hand them to students through
// CapaCare. Students must choose their own password at first login.

import fs from 'node:fs';
import {
  openDb, addUser, resetPassword, setDisabled, revokeSessions, generatePassword, normCandidate, validCandidate,
} from './lib.js';

const [cmd, ...rest] = process.argv.slice(2);
const db = openDb(process.env.LOGBOOK_DB || './data/logbook.db');

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

function usage() {
  console.error('Usage: admin.js add <candidate> [--password pw] | import <file.csv> | reset <candidate> | disable <candidate> | enable <candidate> | revoke <candidate> | list');
  process.exit(1);
}

try {
  if (cmd === 'add' && rest[0]) {
    const pw = flag('password') || generatePassword();
    const c = await addUser(db, rest[0], pw);
    console.log('candidate,initial_password');
    console.log(`${c},${pw}`);
  } else if (cmd === 'import' && rest[0]) {
    const lines = fs.readFileSync(rest[0], 'utf8').split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    console.log('candidate,initial_password');
    for (const line of lines) {
      const c = normCandidate(line.split(/[,;\t]/)[0]);
      if (c === 'CANDIDATE' || !c) continue; // header or blank
      if (!validCandidate(c)) { console.error(`skipped (invalid): ${line}`); continue; }
      const pw = generatePassword();
      try { await addUser(db, c, pw); console.log(`${c},${pw}`); }
      catch (e) { console.error(`skipped (${/UNIQUE/.test(String(e.message)) ? 'already exists' : e.message}): ${c}`); }
    }
  } else if (cmd === 'reset' && rest[0]) {
    const pw = generatePassword();
    const c = await resetPassword(db, rest[0], pw);
    console.log('candidate,initial_password');
    console.log(`${c},${pw}`);
  } else if ((cmd === 'disable' || cmd === 'enable') && rest[0]) {
    console.log(`${setDisabled(db, rest[0], cmd === 'disable')} ${cmd}d`);
  } else if (cmd === 'revoke' && rest[0]) {
    console.log(`${revokeSessions(db, rest[0])} session(s) removed`);
  } else if (cmd === 'list') {
    const rows = db.prepare(`
      SELECT u.candidate, u.disabled, u.must_change, u.last_login_at,
             (SELECT COUNT(*) FROM events e WHERE e.owner = u.candidate) AS events
      FROM users u ORDER BY u.candidate`).all();
    console.log('candidate,status,password_set,last_login,events');
    for (const r of rows) {
      console.log([r.candidate, r.disabled ? 'disabled' : 'active', r.must_change ? 'no (initial)' : 'yes', r.last_login_at || '', r.events].join(','));
    }
  } else {
    usage();
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
}
