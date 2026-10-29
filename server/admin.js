// Account administration. Run on the machine where the database lives.
//
//   node server/admin.js add S1234 [--name "Mohamed K"] [--password secret]   create a student account
//   node server/admin.js import candidates.csv                    create many students (first column = candidate number)
//   node server/admin.js add-supervisor SUP-ANNA --name "Dr Anna K" [--password secret]
//   node server/admin.js add-admin ADMIN-ANDERS --name "Anders" [--password secret]
//   node server/admin.js assign SUP-ANNA S1234 [S1235 ...]        let a supervisor see and sign these students
//   node server/admin.js unassign SUP-ANNA S1234
//   node server/admin.js rename SUP-ANNA "Dr Anna Kamara"         change the display name of any account
//   node server/admin.js reset S1234                              new initial password, logs the account out everywhere
//   node server/admin.js disable S1234 | enable S1234
//   node server/admin.js revoke S1234                             log out everywhere (e.g. lost tablet)
//   node server/admin.js list
//   node server/admin.js backup /data/backups/logbook-2026-11-01.db   consistent copy of the live database
//
// Initial passwords are printed once, as CSV on stdout. Hand them out through CapaCare.
// Everyone must choose their own password at first login.

import fs from 'node:fs';
import {
  openDb, addUser, resetPassword, setDisabled, revokeSessions, generatePassword, normCandidate, validCandidate,
  assign, unassign, renameUser, backupTo, logAudit, deleteUser,
} from './lib.js';

const [cmd, ...rest] = process.argv.slice(2);
const db = openDb(process.env.LOGBOOK_DB || './data/logbook.db');

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
const positional = () => {
  const out = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) i += 1; // skip the flag and its value
    else out.push(rest[i]);
  }
  return out;
};

function usage() {
  console.error([
    'Usage:',
    '  admin.js add <candidate> [--name "Name"] [--password pw]',
    '  admin.js import <file.csv>',
    '  admin.js add-supervisor <id> [--name "Dr X"] [--password pw]',
    '  admin.js add-admin <id> [--name "Name"] [--password pw]',
    '  admin.js assign <supervisor> <candidate> [<candidate> ...]',
    '  admin.js unassign <supervisor> <candidate>',
    '  admin.js rename <supervisor> "<name>"',
    '  admin.js reset <id> | disable <id> | enable <id> | revoke <id>',
    '  admin.js delete <id>   (erases a disabled account and its data for good)',
    '  admin.js list',
    '  admin.js backup <new-file.db>',
  ].join('\n'));
  process.exit(1);
}

try {
  const args = positional();
  if (cmd === 'add' && args[0]) {
    const pw = flag('password') || generatePassword();
    const c = await addUser(db, args[0], pw, { name: flag('name') });
    console.log('account,initial_password');
    console.log(`${c},${pw}`);
  } else if (cmd === 'add-supervisor' && args[0]) {
    const pw = flag('password') || generatePassword();
    const c = await addUser(db, args[0], pw, { role: 'supervisor', name: flag('name') });
    console.log('account,initial_password');
    console.log(`${c},${pw}`);
  } else if (cmd === 'add-admin' && args[0]) {
    const pw = flag('password') || generatePassword();
    const c = await addUser(db, args[0], pw, { role: 'admin', name: flag('name') });
    console.log('account,initial_password');
    console.log(`${c},${pw}`);
  } else if (cmd === 'import' && args[0]) {
    const lines = fs.readFileSync(args[0], 'utf8').split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    console.log('account,initial_password');
    for (const line of lines) {
      const c = normCandidate(line.split(/[,;\t]/)[0]);
      if (c === 'CANDIDATE' || !c) continue; // header or blank
      if (!validCandidate(c)) { console.error(`skipped (invalid): ${line}`); continue; }
      const pw = generatePassword();
      try { await addUser(db, c, pw); console.log(`${c},${pw}`); }
      catch (e) { console.error(`skipped (${/UNIQUE/.test(String(e.message)) ? 'already exists' : e.message}): ${c}`); }
    }
  } else if (cmd === 'assign' && args.length >= 2) {
    for (const student of args.slice(1)) {
      try { console.log(`${normCandidate(student)}: ${assign(db, args[0], student) ? 'assigned' : 'was already assigned'}`); }
      catch (e) { console.error(`${normCandidate(student)}: ${e.message}`); process.exitCode = 1; }
    }
  } else if (cmd === 'unassign' && args.length >= 2) {
    console.log(`${unassign(db, args[0], args[1])} assignment(s) removed`);
  } else if (cmd === 'rename' && args.length >= 2) {
    console.log(`${renameUser(db, args[0], args[1])} renamed`);
  } else if (cmd === 'reset' && args[0]) {
    const pw = generatePassword();
    const c = await resetPassword(db, args[0], pw);
    console.log('account,initial_password');
    console.log(`${c},${pw}`);
  } else if ((cmd === 'disable' || cmd === 'enable') && args[0]) {
    console.log(`${setDisabled(db, args[0], cmd === 'disable')} ${cmd}d`);
  } else if (cmd === 'delete' && args[0]) {
    const n = deleteUser(db, args[0]);
    console.log(`${normCandidate(args[0])} deleted (${n.events} events, ${n.assignments} assignments)`);
  } else if (cmd === 'revoke' && args[0]) {
    console.log(`${revokeSessions(db, args[0])} session(s) removed`);
  } else if (cmd === 'backup' && args[0]) {
    const written = backupTo(db, args[0]);
    logAudit(db, 'cli', 'backup', null, 'command line');
    console.log(`Backup written to ${written}`);
  } else if (cmd === 'list') {
    const rows = db.prepare(`
      SELECT u.candidate, u.role, u.display_name, u.disabled, u.must_change, u.last_login_at,
             (SELECT COUNT(*) FROM events e WHERE e.owner = u.candidate) AS events,
             (SELECT GROUP_CONCAT(a.supervisor, ' ') FROM assignments a WHERE a.student = u.candidate) AS supervisors,
             (SELECT COUNT(*) FROM assignments a WHERE a.supervisor = u.candidate) AS students
      FROM users u ORDER BY u.role DESC, u.candidate`).all();
    console.log('account,role,name,status,password_set,last_login,events,supervisors_or_student_count');
    for (const r of rows) {
      console.log([
        r.candidate, r.role, r.display_name || '', r.disabled ? 'disabled' : 'active', r.must_change ? 'no (initial)' : 'yes',
        r.last_login_at || '', r.events, r.role === 'supervisor' ? `${r.students} students` : (r.supervisors || ''),
      ].join(','));
    }
  } else {
    usage();
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
}
