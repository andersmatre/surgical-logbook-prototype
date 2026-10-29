// config.js — content, not logic. Edit procedure lists, targets and hospitals here.
// (Supervisors are accounts on the server now, created with `admin.js add-supervisor`.)

export const APP_VERSION = '0.8.0';

// Where the logbook server lives. '' = the same address the app was loaded from
// (when the server also serves the app). If the app is hosted elsewhere, for example
// on GitHub Pages, put the server address here, e.g. 'https://logbook.example.org',
// and set ALLOWED_ORIGIN on the server to the address of the app.
export const API_BASE = '';

// Top ten procedures registered by students in 2025
// (source: CapaCare Annual Report 2025, Table 2).
export const PROCEDURES_TOP = [
  { id: 'cs', name: 'Caesarean section' },
  { id: 'ing_hernia', name: 'Inguinal hernia repair' },
  { id: 'appendectomy', name: 'Appendectomy' },
  { id: 'laparotomy', name: 'Laparotomy' },
  { id: 'umb_hernia', name: 'Umbilical hernia repair' },
  { id: 'strang_hernia', name: 'Strangulated hernia repair' },
  { id: 'amp_ak', name: 'Amputation above knee' },
  { id: 'hydrocele', name: 'Scrotal hydrocele' },
  { id: 'cystectomy', name: 'Cystectomy' },
  { id: 'ectopic', name: 'Salpingectomy for ectopic pregnancy' },
];

// PLACEHOLDER list shown under "More procedures".
// Replace with the procedure list from the STP training manual.
export const PROCEDURES_OTHER = [
  { id: 'abscess', name: 'Abscess incision and drainage' },
  { id: 'debridement', name: 'Wound debridement' },
  { id: 'skin_graft', name: 'Skin graft' },
  { id: 'circumcision', name: 'Circumcision' },
  { id: 'hysterectomy', name: 'Hysterectomy' },
  { id: 'bowel_perf', name: 'Repair of bowel perforation' },
  { id: 'suprapubic', name: 'Suprapubic cystostomy' },
  { id: 'fracture', name: 'Fracture reduction and splinting' },
  { id: 'placenta', name: 'Manual removal of placenta' },
  { id: 'dnc', name: 'Dilatation and curettage' },
  { id: 'burns', name: 'Burns dressing / escharotomy' },
  { id: 'tracheostomy', name: 'Tracheostomy' },
  { id: 'other', name: 'Other / not listed' },
];

export const ALL_PROCEDURES = [...PROCEDURES_TOP, ...PROCEDURES_OTHER];

// The four roles CapaCare already uses in its logbook.
// "Performed" = supervised or independent (counts towards targets).
// `done` is the past tense, used where the student's own entries are listed (History).
export const ROLES = [
  { id: 'observing', label: 'Observing', hint: 'I watched', done: 'Observed' },
  { id: 'assisting', label: 'Assisting', hint: 'I helped the surgeon', done: 'Assisted' },
  { id: 'supervised', label: 'Surgeon, supervised', hint: 'I operated with supervisor present', done: 'Operated with supervisor' },
  { id: 'independent', label: 'Surgeon, independent', hint: 'I operated on my own', done: 'Operated on my own' },
];

// PLACEHOLDER targets (number of procedures performed).
// These are invented examples, NOT the programme's real requirements.
export const TARGETS_ARE_PLACEHOLDER = true;
export const TARGETS = {
  cs: 30,
  ing_hernia: 20,
  appendectomy: 10,
  laparotomy: 10,
  umb_hernia: 8,
  strang_hernia: 5,
  amp_ak: 3,
  hydrocele: 5,
  cystectomy: 3,
  ectopic: 3,
};

// Training hospitals (subset of those listed in the 2025 annual report).
export const HOSPITALS = [
  'Masanga Hospital',
  'Bo Government Hospital',
  'Kenema Government Hospital',
  'Makeni Government Hospital',
  'Connaught Hospital, Freetown',
  'Kabala Government Hospital',
  'Kailahun Government Hospital',
  'Kambia Government Hospital',
  'Koidu Government Hospital',
  'Magburaka Government Hospital',
  'Port Loko Government Hospital',
  'Pujehun Government Hospital',
  'Other / testing',
];

// The privacy notice ("Your data"), shown at the first login and under More in all three apps.
// PLACEHOLDER: who is responsible, whom to contact and how long data is kept are not decided yet
// (PROJECT.md, section 14). While PRIVACY_IS_PLACEHOLDER is true the notice says it is a draft.
export const PRIVACY_IS_PLACEHOLDER = true;
export const PRIVACY = {
  responsible: 'CapaCare (to be confirmed)',
  contact: 'your CapaCare coordinator',
  keptFor: 'While you are in the training programme. After that, for as long as CapaCare needs it for the programme (to be decided). Then it is deleted.',
  // Each part: a heading and one or more short lines in plain words.
  parts: [
    ['What is stored', [
      'Your candidate number or staff ID, and your name if CapaCare added it.',
      'Your password, scrambled so that nobody can read it, not even CapaCare.',
      'Students: each procedure you log, with your role, the date, the hospital, and if a supervisor signed it.',
      'Supervisors: which students you added, and which entries you signed.',
      'How the app is used: how many seconds logging takes, if you were offline, and how often you tap Undo. This shows us if the app is easy to use.',
    ]],
    ['What is never stored', ['Patient names or numbers. Never type them anywhere in the app.']],
    ['Why', [
      'So you can keep your logbook, your supervisor can sign it, and CapaCare can follow the training programme.',
      'Your data is only used for research if an ethics committee has approved it and you have agreed.',
    ]],
    ['Who can see it', ['You. The supervisors who added you (students see their names under More). CapaCare administrators. Nobody else.']],
    ['Where it is kept', ['On your own tablet, and on a server in Stockholm, Sweden (in the EU), run by the company Fly.io.']],
  ],
};

export const procName = (id) => (ALL_PROCEDURES.find((p) => p.id === id) || { name: id }).name;
export const roleLabel = (id) => (ROLES.find((r) => r.id === id) || { label: id }).label;
export const roleDone = (id) => (ROLES.find((r) => r.id === id) || { done: id }).done;
