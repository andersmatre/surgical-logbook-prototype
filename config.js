// config.js — content, not logic. Edit lists, targets and demo supervisors here.

export const APP_VERSION = '0.1.0';

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
export const ROLES = [
  { id: 'observing', label: 'Observing', hint: 'I watched' },
  { id: 'assisting', label: 'Assisting', hint: 'I helped the surgeon' },
  { id: 'supervised', label: 'Surgeon, supervised', hint: 'I operated, supervisor present' },
  { id: 'independent', label: 'Surgeon, independent', hint: 'I operated on my own' },
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

// DEMO supervisors with PINs checked on the device. Prototype only: a real
// system verifies the PIN on the server and signs entries cryptographically.
export const SUPERVISORS = [
  { id: 'sup_a', name: 'Supervisor A (demo)', pin: '1111' },
  { id: 'sup_b', name: 'Supervisor B (demo)', pin: '2222' },
];

export const procName = (id) => (ALL_PROCEDURES.find((p) => p.id === id) || { name: id }).name;
export const roleLabel = (id) => (ROLES.find((r) => r.id === id) || { label: id }).label;
export const supName = (id) => (SUPERVISORS.find((s) => s.id === id) || { name: id }).name;
