// config.js — content, not logic. Edit procedure lists, targets and hospitals here.
// (Supervisors are accounts on the server now, created with `admin.js add-supervisor`.)

export const APP_VERSION = '0.13.5';

// Where the logbook server lives. '' = the same address the app was loaded from
// (when the server also serves the app). If the app is hosted elsewhere, for example
// on GitHub Pages, put the server address here, e.g. 'https://logbook.example.org',
// and set ALLOWED_ORIGIN on the server to the address of the app.
export const API_BASE = '';

// ---- Procedures -----------------------------------------------------------------------------
// The list from CapaCare's logbook (Logbook_softcopy_2021.xlsx, sheet "Lists"), in its four surgical groups,
// plus the ways a baby is born from its obstetric logbook. Each procedure has:
//   group     the surgical group it is listed under in "More operations" (left out: not an operation)
//   delivery  true: a way of giving birth, shown under "Deliveries" (a caesarean is both)
// Shown in this order. Ids are stored in entries: never rename, reuse or delete one (retire it instead, below).
export const PROCEDURE_GROUPS = [
  { id: 'obgyn', name: 'Gynaecology and obstetrics' },
  { id: 'neuro', name: 'Neurosurgery' },
  { id: 'ortho', name: 'Orthopaedics' },
  { id: 'soft', name: 'Soft tissue' },
];

export const PROCEDURES = [
  // Gynaecology and obstetrics
  { id: 'breech_extraction', name: 'Breech extraction', group: 'obgyn' },
  { id: 'cs', name: 'Caesarean section', group: 'obgyn', delivery: true },
  { id: 'cystectomy', name: 'Cystectomy', group: 'obgyn' },
  { id: 'destructive_delivery', name: 'Destructive delivery (craniotomy)', group: 'obgyn', delivery: true },
  { id: 'dnc', name: 'Dilatation and curettage', group: 'obgyn' },
  { id: 'hysterectomy', name: 'Hysterectomy', group: 'obgyn' },
  { id: 'induction', name: 'Induction of labour', group: 'obgyn' },
  { id: 'placenta', name: 'Manual removal of placenta', group: 'obgyn' },
  { id: 'mva', name: 'Manual vacuum aspiration', group: 'obgyn' },
  { id: 'myomectomy', name: 'Myomectomy', group: 'obgyn' },
  { id: 'prolapse', name: 'Operation for uterine prolapse', group: 'obgyn' },
  { id: 'bladder_repair', name: 'Repair of bladder injury', group: 'obgyn' },
  { id: 'tear_repair', name: 'Repair of cervical, vaginal or perineal tear', group: 'obgyn' },
  { id: 'uterine_rupture', name: 'Repair of ruptured uterus', group: 'obgyn' },
  { id: 'uterine_tear', name: 'Repair of uterine tear', group: 'obgyn' },
  { id: 'vvf', name: 'Repair of vesicovaginal fistula (VVF)', group: 'obgyn' },
  { id: 'ectopic', name: 'Salpingectomy for ectopic pregnancy', group: 'obgyn' },
  { id: 'tubal_ligation', name: 'Tubal ligation', group: 'obgyn' },
  { id: 'uterine_tamponade', name: 'Uterine tamponade for PPH', group: 'obgyn' },
  { id: 'vacuum_delivery', name: 'Vacuum delivery', group: 'obgyn', delivery: true },
  { id: 'other_obgyn', name: 'Other gynaecology or obstetrics', group: 'obgyn' },
  // Neurosurgery
  { id: 'craniotomy', name: 'Craniotomy', group: 'neuro' },
  { id: 'other_neuro', name: 'Other neurosurgery', group: 'neuro' },
  // Orthopaedics
  { id: 'amp_ak', name: 'Amputation above knee', group: 'ortho' },
  { id: 'amp_bk', name: 'Amputation below knee', group: 'ortho' },
  { id: 'amp_foot', name: 'Amputation below ankle', group: 'ortho' },
  { id: 'amp_toe', name: 'Amputation of toe', group: 'ortho' },
  { id: 'amp_hand', name: 'Amputation of hand', group: 'ortho' },
  { id: 'amp_finger', name: 'Amputation of finger', group: 'ortho' },
  { id: 'osteomyelitis', name: 'Debridement for osteomyelitis', group: 'ortho' },
  { id: 'septic_joint', name: 'Drainage of septic joint (pyoarthritis)', group: 'ortho' },
  { id: 'ext_fixation', name: 'External fixation', group: 'ortho' },
  { id: 'pop_cast', name: 'Plaster cast (POP) for fracture', group: 'ortho' },
  { id: 'joint_reduction', name: 'Reduction of dislocated joint', group: 'ortho' },
  { id: 'traction_skeletal', name: 'Skeletal traction', group: 'ortho' },
  { id: 'traction_skin', name: 'Skin traction', group: 'ortho' },
  { id: 'other_ortho', name: 'Other orthopaedics', group: 'ortho' },
  // Soft tissue
  { id: 'appendectomy', name: 'Appendectomy', group: 'soft' },
  { id: 'chest_tube', name: 'Chest tube', group: 'soft' },
  { id: 'circumcision', name: 'Circumcision (male)', group: 'soft' },
  { id: 'colostomy', name: 'Colostomy', group: 'soft' },
  { id: 'haematoma', name: 'Evacuation of haematoma', group: 'soft' },
  { id: 'lipoma', name: 'Excision of lipoma', group: 'soft' },
  { id: 'excision_other', name: 'Excision, other', group: 'soft' },
  { id: 'fem_hernia', name: 'Femoral hernia repair', group: 'soft' },
  { id: 'abscess', name: 'Incision and drainage (abscess)', group: 'soft' },
  { id: 'ing_hernia', name: 'Inguinal hernia repair', group: 'soft' },
  { id: 'laparotomy', name: 'Laparotomy', group: 'soft' },
  { id: 'large_bowel', name: 'Large bowel resection', group: 'soft' },
  { id: 'debridement', name: 'Necrotectomy (removing dead tissue)', group: 'soft' },
  { id: 'orchidectomy', name: 'Orchidectomy', group: 'soft' },
  { id: 'foreign_body', name: 'Removal of foreign body', group: 'soft' },
  { id: 'hydrocele', name: 'Scrotal hydrocele', group: 'soft' },
  { id: 'secondary_closure', name: 'Secondary closure of wound', group: 'soft' },
  { id: 'skin_graft', name: 'Skin graft', group: 'soft' },
  { id: 'small_bowel', name: 'Small bowel resection', group: 'soft' },
  { id: 'strang_hernia', name: 'Strangulated hernia repair', group: 'soft' },
  { id: 'suprapubic_puncture', name: 'Suprapubic puncture', group: 'soft' },
  { id: 'umb_hernia', name: 'Umbilical hernia repair', group: 'soft' },
  { id: 'urethral_cath', name: 'Urethral catheterisation', group: 'soft' },
  { id: 'urethral_dilation', name: 'Urethral dilatation for stricture', group: 'soft' },
  { id: 'ventral_hernia', name: 'Ventral hernia repair', group: 'soft' },
  { id: 'dressing', name: 'Wound cleaning and dressing', group: 'soft' },
  { id: 'wound_suturing', name: 'Wound suturing', group: 'soft' },
  { id: 'other_soft', name: 'Other soft tissue', group: 'soft' },
  // Deliveries that are not operations
  { id: 'normal_delivery', name: 'Normal delivery', delivery: true },
  { id: 'forceps_delivery', name: 'Forceps delivery', delivery: true },
];

// No longer offered (from the first, invented list), kept so that old entries still show a name.
export const PROCEDURES_RETIRED = [
  { id: 'bowel_perf', name: 'Repair of bowel perforation' },
  { id: 'suprapubic', name: 'Suprapubic cystostomy' },
  { id: 'fracture', name: 'Fracture reduction and splinting' },
  { id: 'burns', name: 'Burns dressing / escharotomy' },
  { id: 'tracheostomy', name: 'Tracheostomy' },
  { id: 'other', name: 'Other / not listed' },
];

export const ALL_PROCEDURES = [...PROCEDURES, ...PROCEDURES_RETIRED];
export const findProcedure = (id) => ALL_PROCEDURES.find((p) => p.id === id);

// Buttons on the Log tab, after the student has chosen Surgery or Delivery. Surgery: the ten procedures
// registered most in 2025 (CapaCare Annual Report 2025, Table 2); every other operation is under "More operations".
// The caesarean is in both.
export const LOG_SURGERY = ['cs', 'ing_hernia', 'appendectomy', 'laparotomy', 'umb_hernia', 'strang_hernia', 'amp_ak', 'hydrocele', 'cystectomy', 'ectopic'];
export const LOG_DELIVERIES = ['normal_delivery', 'cs', 'vacuum_delivery', 'forceps_delivery', 'destructive_delivery'];
// The same procedures, each once, in that order (also the columns of the administrator's per-student table).
export const PROCEDURES_TOP = [...new Set([...LOG_SURGERY, ...LOG_DELIVERIES])].map(findProcedure);

// The four roles CapaCare already uses in its logbook, with its definitions in plain words.
// "Performed" = supervised or independent (counts towards targets).
// `done` is the past tense, used where the student's own entries are listed (History).
// `birth` is the wording for a delivery that is not an operation (the obstetric logbook's definitions).
export const ROLES = [
  { id: 'observing', label: 'Observing', hint: 'I watched, not scrubbed', done: 'Observed',
    birth: { hint: 'I was in the room, did not touch the patient' } },
  { id: 'assisting', label: 'Assisting', hint: 'Scrubbed, I helped a senior surgeon', done: 'Assisted',
    birth: { hint: 'I helped a colleague' } },
  { id: 'supervised', label: 'Surgeon, supervised', hint: 'I did most of it, a senior surgeon helped', done: 'Operated with supervisor',
    birth: { label: 'Delivered, supervised', hint: 'A supervisor was in the room', done: 'Delivered with supervisor' } },
  { id: 'independent', label: 'Surgeon, independent', hint: 'No one more senior was scrubbed', done: 'Operated on my own',
    birth: { label: 'Delivered alone', hint: 'No supervisor in the room', done: 'Delivered on my own' } },
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
// The questions of CapaCare's surgical and obstetric logbooks (Logbook_softcopy_2021.xlsx), as fixed lists and
// whole numbers only. Not taken over: patient initials and address (they identify the patient), times of day
// (the operation time in minutes is asked instead) and dates after the operation (days are asked instead).
// Each field: `label` (in summaries), `ask` (in the form, if different), `help` (a short grey line under the
// question, for a word that may be unclear), `options` [id, words] or `number`
// {min, max} with an optional `unit`, and `showIf` {question: [answers]}: only asked when one of those answers
// is chosen. Field ids and option ids are stored in entries: never rename or reuse one. To stop asking a field,
// take it out of the lists further down; old entries keep it.

const YES_NO = [['yes', 'Yes'], ['no', 'No']];

// The questions about one baby. Baby 2 and 3 are only asked for twins and triplets.
function babyFields(n) {
  const p = n === 1 ? 'baby_' : `baby${n}_`;
  const who = n === 1 ? 'Baby' : `Baby ${n}`;
  const showIf = n === 1 ? undefined : { babies: n === 2 ? ['2', '3'] : ['3'] };
  return {
    [`${p}outcome`]: { label: who, ask: 'Outcome at birth', options: [['alive', 'Alive'], ['fresh_stillbirth', 'Died during labour'], ['macerated', 'Died before labour']], showIf },
    [`${p}presentation`]: { label: `${who}, position`, ask: 'Position', options: [['cephalic', 'Head first'], ['breech', 'Breech'], ['transverse', 'Transverse']], showIf },
    [`${p}sex`]: { label: `${who}, sex`, ask: 'Sex', options: [['male', 'Male'], ['female', 'Female']], showIf },
    [`${p}weight_g`]: { label: `${who}, weight`, ask: 'Weight', unit: 'grams', number: { min: 500, max: 6000 }, showIf },
    [`${p}apgar1`]: { label: `${who}, Apgar 1 min`, ask: 'Apgar at 1 min', unit: 'of 10', number: { min: 0, max: 10 }, showIf },
    [`${p}apgar5`]: { label: `${who}, Apgar 5 min`, ask: 'Apgar at 5 min', unit: 'of 10', number: { min: 0, max: 10 }, showIf },
  };
}
const babyIds = (n) => Object.keys(babyFields(n));

// Asked after the role, before saving. All optional: "Save" works with nothing filled in.
// In this order in summaries and in the CSV file.
export const DETAIL_FIELDS = {
  // the patient, or the mother
  sex: { label: 'Sex', options: [['male', 'Male'], ['female', 'Female']] },
  age_years: { label: 'Age', unit: 'years', number: { min: 0, max: 120 } },
  gravida: { label: 'Gravida', help: 'Pregnancies, this one too', number: { min: 1, max: 20 } },
  para: { label: 'Para', help: 'Births before this one', number: { min: 0, max: 20 } },
  children_alive: { label: 'Children alive', number: { min: 0, max: 20 } },
  induction: { label: 'Start of labour', ask: 'How labour started', options: [['spontaneous', 'Spontaneous'], ['oxytocin', 'Oxytocin'], ['foley', 'Foley catheter'], ['rom', 'Rupture of membranes']] },
  // the babies
  babies: { label: 'Babies', ask: 'Number of babies', options: [['1', 'One'], ['2', 'Twins'], ['3', 'Triplets']] },
  ...babyFields(1),
  ...babyFields(2),
  ...babyFields(3),
  // the operation
  urgency: { label: 'Urgency', options: [['elective', 'Planned'], ['emergency', 'Emergency']] },
  cs_reason: { label: 'Main reason', options: [['abnormal_presentation', 'Abnormal position'], ['prolonged_labour', 'Prolonged labour'], ['cord_prolapse', 'Cord prolapse'], ['uterine_rupture', 'Uterine rupture'], ['preeclampsia', 'Pre-eclampsia'], ['fetal_infection', 'Fetal infection'], ['placenta', 'Placenta problem'], ['previous_cs', 'Previous caesarean'], ['bicornuate', 'Bicornuate uterus'], ['other', 'Other']] },
  anaesthesia: { label: 'Anaesthesia', options: [['none', 'None'], ['local', 'Local'], ['ketamine', 'Ketamine'], ['spinal', 'Spinal or epidural'], ['general', 'General'], ['local_ketamine', 'Local + ketamine'], ['spinal_ketamine', 'Spinal + ketamine'], ['spinal_local', 'Spinal + local'], ['other', 'Other']] },
  duration_min: { label: 'Operation time', help: 'First cut to last stitch', unit: 'minutes', number: { min: 1, max: 1440 } },
  blood_loss_ml: { label: 'Blood loss', unit: 'ml', number: { min: 0, max: 5000 } },
  // Surgical Apgar (Gawande 2007): the option id is the number of points.
  sapgar_blood: { label: 'Surgical Apgar, blood loss', ask: 'Blood loss', options: [['3', '100 ml or less'], ['2', '101–600 ml'], ['1', '601–1000 ml'], ['0', 'More than 1000 ml']] },
  sapgar_map: { label: 'Surgical Apgar, lowest MAP', ask: 'Lowest blood pressure', help: 'Mean arterial pressure (MAP), mmHg', options: [['0', 'Under 40'], ['1', '40–54'], ['2', '55–69'], ['3', '70 or more']] },
  sapgar_hr: { label: 'Surgical Apgar, lowest heart rate', ask: 'Lowest heart rate', help: 'Beats per minute', options: [['4', '55 or less'], ['3', '56–65'], ['2', '66–75'], ['1', '76–85'], ['0', 'More than 85']] },
  // From the first, invented list: no longer asked, kept so old entries still show them.
  side: { label: 'Side', options: [['left', 'Left'], ['right', 'Right'], ['both', 'Both']] },
  mesh: { label: 'Mesh used', options: [['yes', 'Yes'], ['no', 'No']] },
  cs_indication: { label: 'Main reason', options: [['obstructed', 'Obstructed labour'], ['previous_cs', 'Previous caesarean'], ['fetal_distress', 'Fetal distress'], ['malpresentation', 'Breech or other position'], ['bleeding', 'Bleeding'], ['eclampsia', 'Eclampsia'], ['other', 'Other']] },
};

// Added later, from the History tab, as a follow-up on the entry (the entry itself never changes).
// A newer follow-up replaces older answers to the same question.
export const FOLLOWUP_FIELDS = {
  mat_complication: { label: 'Complication at birth', options: [['none', 'None'], ['pph', 'Heavy bleeding (PPH)'], ['shoulder_dystocia', 'Shoulder dystocia']] },
  patient: { label: 'Patient', options: [['alive', 'Alive'], ['died', 'Died'], ['unknown', 'Not known']] },
  mother: { label: 'Mother', options: [['alive', 'Alive'], ['died', 'Died'], ['unknown', 'Not known']] },
  died_day: { label: 'Died on day', ask: 'Died how many days after?', unit: 'days', number: { min: 0, max: 365 }, showIf: { patient: ['died'], mother: ['died'] } },
  death_cause: { label: 'Cause of death', options: [['hypertensive', 'High blood pressure (eclampsia)'], ['haemorrhage', 'Bleeding'], ['sepsis', 'Sepsis or infection'], ['obstructed_labour', 'Obstructed labour'], ['anaemia', 'Anaemia'], ['hiv', 'HIV/AIDS'], ['embolism', 'Embolism'], ['uterine_rupture', 'Uterine rupture'], ['other_direct', 'Other direct cause'], ['other_indirect', 'Other indirect cause']], showIf: { mother: ['died'] } },
  wound_infection: { label: 'Wound infection', help: 'Antibiotics started for the wound', options: YES_NO },
  reoperation: { label: 'Back to theatre', help: 'Another operation during the same stay', options: YES_NO },
  referral: { label: 'Referred', ask: 'Referred to another hospital', options: YES_NO },
  days_in_hospital: { label: 'Days in hospital', ask: 'Days in hospital afterwards', unit: 'days', number: { min: 0, max: 365 } },
  // From the first, invented list: no longer asked, kept so old entries still show them.
  complication: { label: 'Complication', options: [['none', 'None'], ['wound_infection', 'Wound infection'], ['wound_breakdown', 'Wound opened up'], ['bleeding', 'Bleeding'], ['reoperation', 'Back to theatre'], ['other', 'Other']] },
  baby: { label: 'Baby', options: [['alive', 'Alive'], ['stillbirth', 'Stillborn'], ['died', 'Died after birth'], ['unknown', 'Not known']] },
};

// How long after the operation a follow-up can be added from the History tab (6 weeks).
export const FOLLOWUP_DAYS = 42;

// Which questions are asked, in parts with a heading. An operation asks the surgical logbook's questions, a
// delivery the obstetric logbook's. A delivery that is also an operation (caesarean, vacuum, destructive) asks
// both, each question once; there the blood loss in ml also gives the Surgical Apgar's points.
// A part can have a `note` under its heading, and word a question differently with `ask` or `help`
// ({id: words}, null for none).
// The Surgical Apgar is about the operated patient: at a caesarean, the mother (the baby's is the Apgar under Baby).
const SAPGAR_NOTE = 'A score for how the operation went.';
const SAPGAR_NOTE_MOTHER = "The mother's, during the operation. The baby's Apgar is under Baby.";
const BABIES = [
  { title: 'Baby', ids: ['babies', ...babyIds(1)] },
  { title: 'Second baby', ids: babyIds(2) },
  { title: 'Third baby', ids: babyIds(3) },
];
const DETAILS_OPERATION = [
  { title: 'Patient', ids: ['sex', 'age_years'] },
  { title: 'Operation', ids: ['urgency', 'anaesthesia', 'duration_min'] },
  { title: 'Surgical Apgar', note: SAPGAR_NOTE, ids: ['sapgar_blood', 'sapgar_map', 'sapgar_hr'] },
];
const DETAILS_BIRTH = [
  { title: 'Mother', ids: ['age_years', 'gravida', 'para', 'children_alive', 'induction', 'blood_loss_ml'] },
  ...BABIES,
];
const DETAILS_BIRTH_OPERATION = [
  { title: 'Mother', ids: ['age_years', 'gravida', 'para', 'children_alive', 'induction'] },
  ...BABIES,
  { title: 'Operation', ids: ['urgency', 'anaesthesia', 'duration_min'] },
  { title: 'Surgical Apgar', note: SAPGAR_NOTE_MOTHER, ids: ['blood_loss_ml', 'sapgar_map', 'sapgar_hr'] },
];
const DETAILS_BY_PROCEDURE = {
  cs: DETAILS_BIRTH_OPERATION.map((s) => (s.title === 'Operation' ? { ...s, ids: ['urgency', 'cs_reason', 'anaesthesia', 'duration_min'] } : s)),
};
const FOLLOWUP_OPERATION = [{ ids: ['patient', 'died_day', 'wound_infection', 'reoperation', 'referral', 'days_in_hospital'] }];
const FOLLOWUP_BIRTH = [{ ids: ['mat_complication', 'mother', 'died_day', 'death_cause', 'referral', 'days_in_hospital'] }];
const FOLLOWUP_BIRTH_OPERATION = [{ ids: ['mat_complication', 'mother', 'died_day', 'death_cause', 'wound_infection', 'reoperation', 'referral', 'days_in_hospital'] }];

// Hospitals from CapaCare's logbook (Logbook_softcopy_2021.xlsx, "Hospital name"), sorted by name, obvious
// spelling mistakes corrected. The name is stored in every entry: if one is renamed, old entries keep the old name.
// To be checked with CapaCare: the list is from 2021.
export const HOSPITALS = [
  'Aberdeen Women\'s Centre',
  'Abernita Hospital (Ecowas Street)',
  'Anmaqiya Muslim Hospital',
  'Bai Bureh Memorial Community Hospital',
  'Blue Shield Hospital',
  'Bo Government Hospital',
  'Bonthe Government Hospital',
  'Choithram Hospital, Freetown',
  'City Garden Clinic, Makeni',
  'Connaught Hospital, Freetown',
  'Crim Clinic (T. T. Rogers)',
  'Davidson Nicol Medical Centre',
  'Dr. Bells Hospital (Curney Barnes)',
  'Dr. Boima',
  'Dr. Mansaray',
  'Dr. Yillah Hospital',
  'Emergency Hospital, Freetown',
  'Gondama Referral Centre, Bo',
  'Good Shepherd Clinic',
  'Holy Spirit Hospital, Makeni',
  'Josephine Memorial Hospital',
  'Kabala Government Hospital',
  'Kailahun Government Hospital',
  'Kamakwie Wesleyan Hospital',
  'Kambia Government Hospital',
  'Katelena Clinic',
  'Kenema Government Hospital',
  'King Harman Road Hospital',
  'Koidu Government Hospital',
  'Lion Heart Medical Centre',
  'Lumley Government Hospital',
  'Lungi Government Hospital, Port Loko',
  'Lunsar Eye Hospital',
  'Magbenteh Community Hospital',
  'Magburaka Government Hospital',
  'Makeni Government Hospital',
  'Marie Stopes Maternity Unit',
  'Masanga Hospital',
  'Moyamba Government Hospital',
  'Nixon Memorial Hospital, Segbwema',
  'Obstetrics and Gynaecology Clinic',
  'Panguma Mission Hospital',
  'PCM Hospital, Freetown',
  'Port Loko Government Hospital',
  'Pujehun Government Hospital',
  'Ralpha Maternity Hospital (Dr. Samba)',
  'Rijanic Day Care and Surgical Unit',
  'Rokopur Hospital',
  'Rokupa Government Hospital',
  'Serabu Catholic Hospital',
  'Serabu Eye Clinic',
  'St. John of God Catholic Hospital, Lunsar',
  'UMC Hospital (Eye hospital)',
  'UMC Kissy',
  'UMC Matru Hospital',
  'Waterloo Adventist Hospital',
  'Waterloo CHC',
  'Waterloo Street Clinic (T. B. Kamara)',
  'Wilberforce Military Hospital',
  'Yangadie Memorial Health Clinic',
  'Other',
];

// The privacy notice ("Your data"), shown at the first login and under More, "Advanced", in all three apps.
// PLACEHOLDER: whom to contact and how long data is kept are not decided yet, and who is responsible is not named
// (PROJECT.md, section 14). While PRIVACY_IS_PLACEHOLDER is true the notice says it is a draft.
export const PRIVACY_IS_PLACEHOLDER = true;
export const PRIVACY = {
  contact: 'your CapaCare coordinator',
  keptFor: 'While you are in the training programme. After that, for as long as CapaCare needs it for the programme.',
  // Each part: a heading and one or more short lines in plain words. A line only for one role is
  // { for: 'student' | 'supervisor' | 'admin', text }; the others see it nowhere.
  parts: [
    ['What is stored', [
      'Your candidate number and name.',
      'Your password, scrambled so that nobody can read it, not even CapaCare.',
      { for: 'student', text: 'Each procedure you log.' },
      { for: 'supervisor', text: 'Which students you added, and which entries you signed.' },
    ]],
    ['Why', [
      'So you can keep your logbook, your supervisor can sign it, and CapaCare can follow the training programme.',
      'Your data is only used for research if an ethics committee has approved it and you have agreed.',
    ]],
    ['Who can see it', ['You.', 'The supervisors who added you.', 'CapaCare administrators.']],
    ['Where it is kept', ['On your own device, and on a server in Stockholm, Sweden, run by the company Fly.io.']],
  ],
};

export const procName = (id) => (findProcedure(id) || { name: id }).name;
// The roles as worded for this procedure: a delivery that is not an operation uses the `birth` wording.
export function rolesFor(procedure) {
  const p = findProcedure(procedure);
  return p && p.delivery && !p.group ? ROLES.map((r) => ({ ...r, ...r.birth })) : ROLES;
}
export const roleLabel = (id, procedure) => (rolesFor(procedure).find((r) => r.id === id) || { label: id }).label;
export const roleDone = (id, procedure) => (rolesFor(procedure).find((r) => r.id === id) || { done: id }).done;
// The questions for a procedure, as parts: [{ title, ids }]. An unknown procedure is treated as an operation.
// The two `kind`s: is it a delivery, is it an operation (a caesarean is both).
function kind(procedure) {
  const p = findProcedure(procedure);
  return { birth: !!(p && p.delivery), operation: !p || !!p.group };
}
export function detailFieldsFor(procedure) {
  if (DETAILS_BY_PROCEDURE[procedure]) return DETAILS_BY_PROCEDURE[procedure];
  const k = kind(procedure);
  return k.birth ? (k.operation ? DETAILS_BIRTH_OPERATION : DETAILS_BIRTH) : DETAILS_OPERATION;
}
export function followupFieldsFor(procedure) {
  const k = kind(procedure);
  return k.birth ? (k.operation ? FOLLOWUP_BIRTH_OPERATION : FOLLOWUP_BIRTH) : FOLLOWUP_OPERATION;
}
// Surgical Apgar (0–10) from an entry's details, or null when a part is missing. The blood loss can also come
// from the blood loss in ml (asked instead at a delivery that is an operation).
export function surgicalApgar(details) {
  const d = details || {};
  let blood = d.sapgar_blood != null ? Number(d.sapgar_blood) : null;
  if (blood == null && d.blood_loss_ml != null) blood = d.blood_loss_ml <= 100 ? 3 : d.blood_loss_ml <= 600 ? 2 : d.blood_loss_ml <= 1000 ? 1 : 0;
  if (blood == null || d.sapgar_map == null || d.sapgar_hr == null) return null;
  return blood + Number(d.sapgar_map) + Number(d.sapgar_hr);
}
// The words shown for a stored answer, e.g. ('anaesthesia', 'spinal') -> 'Spinal or epidural', ('duration_min', 45) -> '45 minutes'.
export function answerLabel(fields, id, value) {
  const f = fields[id];
  if (!f) return String(value);
  if (f.number) return f.unit ? `${value} ${f.unit}` : String(value);
  const o = f.options.find(([v]) => v === value);
  return o ? o[1] : String(value);
}
