// config.js — content, not logic. Edit procedure lists, targets and hospitals here.
// (Supervisors are accounts on the server now, created with `admin.js add-supervisor`.)

export const APP_VERSION = '0.9.0';

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

// ---- Details and follow-up -----------------------------------------------------------------
// PLACEHOLDER: a first guess to show the idea. The real fields come from the training manual and
// the existing logbook. Every field is a fixed list ('choice') or a whole number ('number'), never
// free text. Like procedure ids, field ids and option ids are stored in entries: never rename or
// reuse one. To stop asking a field, take it out of the procedure's list; old entries keep it.

// Asked after the role, before saving. All optional: "Save" works with nothing filled in.
export const DETAIL_FIELDS = {
  urgency: { label: 'Urgency', options: [['elective', 'Planned'], ['emergency', 'Emergency']] },
  anaesthesia: { label: 'Anaesthesia', options: [['spinal', 'Spinal'], ['general', 'General'], ['ketamine', 'Ketamine'], ['local', 'Local'], ['other', 'Other']] },
  duration_min: { label: 'Operation time', unit: 'minutes', number: { min: 1, max: 1440 } },
  side: { label: 'Side', options: [['left', 'Left'], ['right', 'Right'], ['both', 'Both']] },
  mesh: { label: 'Mesh used', options: [['yes', 'Yes'], ['no', 'No']] },
  cs_indication: { label: 'Main reason', options: [['obstructed', 'Obstructed labour'], ['previous_cs', 'Previous caesarean'], ['fetal_distress', 'Fetal distress'], ['malpresentation', 'Breech or other position'], ['bleeding', 'Bleeding'], ['eclampsia', 'Eclampsia'], ['other', 'Other']] },
};

// Added later, from the History tab, as a follow-up on the entry (the entry itself never changes).
// A newer follow-up replaces older answers to the same question.
export const FOLLOWUP_FIELDS = {
  complication: { label: 'Complication', options: [['none', 'None'], ['wound_infection', 'Wound infection'], ['wound_breakdown', 'Wound opened up'], ['bleeding', 'Bleeding'], ['reoperation', 'Back to theatre'], ['other', 'Other']] },
  patient: { label: 'Patient', options: [['alive', 'Alive'], ['died', 'Died'], ['unknown', 'Not known']] },
  mother: { label: 'Mother', options: [['alive', 'Alive'], ['died', 'Died'], ['unknown', 'Not known']] },
  baby: { label: 'Baby', options: [['alive', 'Alive'], ['stillbirth', 'Stillborn'], ['died', 'Died after birth'], ['unknown', 'Not known']] },
};

// How long after the operation a follow-up can be added from the History tab (6 weeks).
export const FOLLOWUP_DAYS = 42;

// Which fields each procedure asks. A procedure not listed here gets the default.
const DETAILS_DEFAULT = ['urgency', 'anaesthesia', 'duration_min'];
const DETAILS_BY_PROCEDURE = {
  cs: ['urgency', 'cs_indication', 'anaesthesia', 'duration_min'],
  ing_hernia: ['urgency', 'side', 'mesh', 'anaesthesia', 'duration_min'],
  strang_hernia: ['side', 'anaesthesia', 'duration_min'],
  hydrocele: ['side', 'anaesthesia', 'duration_min'],
};
const FOLLOWUP_DEFAULT = ['complication', 'patient'];
const FOLLOWUP_BY_PROCEDURE = {
  cs: ['complication', 'mother', 'baby'],
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
      'Students: each procedure you log, with your role, the date, the hospital, details about the operation (such as the anaesthesia), what happened to the patient afterwards, and if a supervisor signed it. Never who the patient is.',
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
export const detailFieldsFor = (procedure) => DETAILS_BY_PROCEDURE[procedure] || DETAILS_DEFAULT;
export const followupFieldsFor = (procedure) => FOLLOWUP_BY_PROCEDURE[procedure] || FOLLOWUP_DEFAULT;
// The words shown for a stored answer, e.g. ('anaesthesia', 'spinal') -> 'Spinal', ('duration_min', 45) -> '45 minutes'.
export function answerLabel(fields, id, value) {
  const f = fields[id];
  if (!f) return String(value);
  if (f.number) return f.unit ? `${value} ${f.unit}` : String(value);
  const o = f.options.find(([v]) => v === value);
  return o ? o[1] : String(value);
}
