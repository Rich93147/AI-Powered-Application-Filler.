/* ApplicationFiller question model — fully on-device, no network, no training data leaves the browser.
 *
 * 1. scoreForm(features)        – is this page a job application? (logistic score over observable features)
 * 2. controlKind(descriptor)    – how does this control collect its answer? (text, native select, custom picker, bubbles…)
 * 3. classify(label, opts)      – what is this question really asking? (concept-normalised TF-IDF similarity against an
 *                                  intent catalogue + answers the applicant has taught it). Paraphrases land on the same intent.
 * 4. answerFor(intent, facts)   – what may be answered from stored facts, and when must we ask instead
 *                                  (e.g. "protected veteran" is narrower than "veteran").
 * 5. pickOption(key, value, options) – choose among the SITE's own choices by meaning (polarity, synonyms), never by guess.
 * Anything below the confidence bar is reported as not confident so the caller can ask the applicant.
 */
(function (root) {
  'use strict';
  const STOP = new Set('a an the of to for in on at by with and or is are am be been do does did you your yours have has had will would can could i we our us this that these those please if any as from about it its what which who whom whose how when where there their they them than then so such'.split(' '));
  const CONCEPTS = {
    veteran: 'veteran veterans military armed forces served soldier army navy marine marines airforce vets vevraa',
    disability: 'disability disabilities disabled handicap handicapped impairment impairments',
    gender: 'gender genders sex',
    race: 'race racial races',
    ethnicity: 'ethnicity ethnic hispanic latino latina latinx latine',
    authorize: 'authorized authorised authorization authorisation eligible eligibility legally legal entitled permitted permission right',
    work: 'work working employment employed job',
    sponsor: 'sponsor sponsorship sponsored visa immigration h1b petition',
    citizen: 'citizen citizens citizenship national nationality',
    relocate: 'relocate relocation relocating relocated move moving',
    notice: 'notice',
    start: 'start begin available availability earliest commence',
    referral: 'referred referral referrer refer hear heard learn found source',
    former: 'previously formerly former ever prior past',
    worked: 'worked employee employer',
    accommodation: 'accommodation accommodations reasonable adjustment',
    essential: 'essential functions duties perform',
    criminal: 'felony convicted conviction convictions criminal crime misdemeanor offense arrested',
    drug: 'drug drugs substance marijuana',
    background: 'background screening',
    age: 'age adult majority',
    clearance: 'clearance classified',
    travel: 'travel travelling traveling',
    remote: 'remote hybrid onsite office commute',
    pronoun: 'pronoun pronouns',
    preferred: 'preferred prefer',
    protected: 'protected'
  };
  const WORD2CONCEPT = {};
  for (const [concept, words] of Object.entries(CONCEPTS)) for (const w of words.split(' ')) WORD2CONCEPT[w] = concept;

  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  // Labels like "Veteran status *" / "(optional)" / "Select an option" must not change the meaning.
  const normalizeLabel = s => norm(String(s || '').replace(/\*/g, ' ').replace(/\((?:optional|required)\)/ig, ' ').replace(/\b(?:optional|required)\b/ig, ' '));
  function stem(w) {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(?:ing|ed)$/.test(w)) return w.replace(/(?:ing|ed)$/, '');
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }
  function tokens(text) {
    const out = [];
    for (const raw of normalizeLabel(text).split(' ')) {
      if (!raw || STOP.has(raw)) continue;
      const concept = WORD2CONCEPT[raw] || WORD2CONCEPT[stem(raw)];
      out.push(concept ? 'c:' + concept : stem(raw));
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Intent catalogue. `key` is the stored-fact key the existing filler already understands (or null: nothing stored,
  // so the applicant is asked once and the answer is shared by every paraphrase). `neverAuto`: legal attestations that
  // are never answered automatically, even from a learned answer.
  const INTENTS = [
    { id: 'veteran', key: 'veteranStatus', kind: 'yesno', label: 'Veteran / military service', seeds: ['are you a veteran', 'veteran status', 'have you served in the military', 'do you have military service', 'did you serve in the armed forces', 'are you a us military veteran'] },
    { id: 'protectedVeteran', key: 'veteranStatus', kind: 'yesno', label: 'Protected veteran status', seeds: ['are you a protected veteran', 'protected veteran status', 'do you identify as a protected veteran', 'identify as one or more of the classifications of protected veteran', 'are you a veteran protected under vevraa'] },
    { id: 'disability', key: 'disabilityStatus', kind: 'yesno', label: 'Disability status', seeds: ['do you have a disability', 'disability status', 'are you disabled', 'do you have a physical or mental impairment', 'voluntary self identification of disability', 'self identification of disability'] },
    { id: 'workAuthorization', key: 'workAuthorization', kind: 'yesno', label: 'Authorized to work', seeds: ['are you legally authorized to work in the united states', 'do you have the legal right to work', 'are you eligible to work in the us', 'are you authorized to work for any employer', 'work authorization status', 'do you have authorization to be employed'] },
    { id: 'sponsorship', key: 'sponsorship', kind: 'yesno', label: 'Needs visa sponsorship', seeds: ['will you now or in the future require visa sponsorship', 'do you need sponsorship to work', 'will you require immigration sponsorship', 'do you require employment visa sponsorship', 'sponsorship for a work visa'] },
    { id: 'citizenship', key: 'citizenship', kind: 'yesno', label: 'U.S. citizen', seeds: ['are you a us citizen', 'are you a united states citizen', 'us citizenship status', 'are you a citizen of the united states'] },
    { id: 'essentialFunctions', key: 'essentialFunctions', kind: 'yesno', label: 'Can perform essential functions', seeds: ['can you perform the essential functions of the job with or without reasonable accommodation', 'are you able to perform the essential functions of this position', 'essential functions of the role with reasonable accommodations'] },
    { id: 'gender', key: 'gender', kind: 'choice', label: 'Gender', seeds: ['what is your gender', 'gender identity', 'please select your gender', 'gender'] },
    { id: 'race', key: 'race', kind: 'choice', label: 'Race', seeds: ['what is your race', 'racial background', 'race', 'racial identity'] },
    { id: 'ethnicity', key: 'ethnicity', kind: 'choice', label: 'Ethnicity / Hispanic or Latino', seeds: ['are you hispanic or latino', 'what is your ethnicity', 'hispanic latino ethnicity', 'ethnic origin'] },
    { id: 'relocate', key: null, kind: 'yesno', label: 'Willing to relocate', seeds: ['are you willing to relocate', 'would you relocate for this position', 'are you open to relocation', 'can you relocate'] },
    { id: 'noticePeriod', key: null, kind: 'text', label: 'Notice period', seeds: ['what is your notice period', 'how much notice do you need to give', 'notice period required'] },
    { id: 'availableStart', key: null, kind: 'text', label: 'Earliest start date', seeds: ['when can you start', 'what is your earliest start date', 'earliest availability', 'available start date', 'how soon can you begin'] },
    { id: 'referralSource', key: null, kind: 'choice', label: 'How you heard about the job', seeds: ['how did you hear about this job', 'how did you find out about us', 'referral source', 'who referred you', 'where did you learn about this position'] },
    { id: 'formerEmployee', key: null, kind: 'yesno', label: 'Previously worked for this company', seeds: ['have you ever worked for this company', 'are you a former employee', 'have you previously been employed by us', 'did you previously work here'] },
    { id: 'over18', key: null, kind: 'yesno', label: 'At least 18 years old', seeds: ['are you at least 18 years of age', 'are you over 18', 'are you of legal working age'] },
    { id: 'securityClearance', key: null, kind: 'yesno', label: 'Security clearance', seeds: ['do you have an active security clearance', 'do you currently hold a security clearance', 'security clearance level'] },
    { id: 'travel', key: null, kind: 'yesno', label: 'Willing to travel', seeds: ['are you willing to travel', 'can you travel for work', 'what percentage of travel can you do'] },
    { id: 'onsite', key: null, kind: 'yesno', label: 'Onsite / hybrid / remote', seeds: ['are you willing to work onsite', 'can you work in the office hybrid', 'are you able to commute to the office', 'remote work preference'] },
    { id: 'pronouns', key: null, kind: 'text', label: 'Pronouns', seeds: ['what are your pronouns', 'preferred pronouns', 'pronoun'] },
    { id: 'preferredName', key: null, kind: 'yesno', label: 'Preferred name differs from legal name', seeds: ['do you have a preferred name that is different from your legal name', 'preferred first name', 'do you go by a different name'] },
    { id: 'criminalHistory', key: null, kind: 'yesno', neverAuto: true, label: 'Criminal history (legal attestation)', seeds: ['have you ever been convicted of a felony', 'do you have any criminal convictions', 'have you been convicted of a crime', 'criminal record'] },
    { id: 'drugTest', key: null, kind: 'yesno', neverAuto: true, label: 'Drug screening consent (legal attestation)', seeds: ['are you willing to submit to a drug test', 'do you consent to drug screening', 'will you take a drug test'] },
    { id: 'backgroundCheck', key: null, kind: 'yesno', neverAuto: true, label: 'Background check consent (legal attestation)', seeds: ['do you consent to a background check', 'are you willing to undergo a background check', 'background screening authorization'] }
  ];
  const BY_ID = Object.fromEntries(INTENTS.map(i => [i.id, i]));

  // TF-IDF over the seed corpus (concept-normalised, so "military" and "veteran" are the same feature).
  const seedDocs = [];
  for (const intent of INTENTS) for (const seed of intent.seeds) seedDocs.push({ intent: intent.id, toks: tokens(seed) });
  const DF = {};
  for (const d of seedDocs) for (const t of new Set(d.toks)) DF[t] = (DF[t] || 0) + 1;
  const idf = t => Math.log((seedDocs.length + 1) / ((DF[t] || 0) + 1)) + 1;
  const vec = toks => { const v = new Map(); for (const t of toks) v.set(t, (v.get(t) || 0) + 1); for (const [t, c] of v) v.set(t, (1 + Math.log(c)) * idf(t)); return v; };
  const dot = (a, b) => { let s = 0; for (const [t, w] of a) if (b.has(t)) s += w * b.get(t); return s; };
  const len = v => Math.sqrt([...v.values()].reduce((s, w) => s + w * w, 0));
  const cosine = (a, b) => { const d = len(a) * len(b); return d ? dot(a, b) / d : 0; };
  for (const d of seedDocs) d.vec = vec(d.toks);

  const THRESH = { score: 0.5, margin: 0.12 };
  /** classify(label, {learned}) → {id,key,label,kind,confidence,confident,source,candidates[]} */
  function classify(label, opts = {}) {
    const q = normalizeLabel(label);
    if (!q) return { id: '', confident: false, confidence: 0, candidates: [], source: 'empty' };
    const taught = opts.learned && opts.learned[q];
    if (taught && BY_ID[taught]) {
      const i = BY_ID[taught];
      return { id: i.id, key: i.key, label: i.label, kind: i.kind, confidence: 1, confident: true, source: 'taught', candidates: [] };
    }
    const toks = tokens(label);
    // Long consent/instruction paragraphs are not single questions.
    if (!toks.length || toks.length > 40) return { id: '', confident: false, confidence: 0, candidates: [], source: 'not-a-question' };
    const qv = vec(toks), hasProtected = toks.includes('c:protected');
    const best = {};
    for (const d of seedDocs) { const s = cosine(qv, d.vec); if (s > (best[d.intent] || 0)) best[d.intent] = s; }
    // "protected veteran" is a different (narrower) question from "veteran"; keep them apart.
    if (hasProtected) best.veteran = (best.veteran || 0) * 0.6; else best.protectedVeteran = (best.protectedVeteran || 0) * 0.6;
    const ranked = Object.entries(best).map(([id, score]) => ({ id, score, label: BY_ID[id].label })).sort((a, b) => b.score - a.score);
    const top = ranked[0], second = ranked[1] || { score: 0 }, margin = top.score - second.score;
    const confident = top.score >= THRESH.score && margin >= THRESH.margin;
    const i = BY_ID[top.id];
    return { id: confident ? i.id : '', key: confident ? i.key : null, label: confident ? i.label : '', kind: i.kind,
      confidence: Math.max(0, Math.min(1, top.score * 0.8 + margin * 0.8)), confident, source: 'model',
      candidates: ranked.filter(r => r.score >= 0.2).slice(0, 3).map(r => ({ id: r.id, label: r.label, score: Math.round(r.score * 100) / 100 })) };
  }

  /** What may be answered from stored facts for this intent? {value, ask, reason} */
  function answerFor(id, facts = {}) {
    const intent = BY_ID[id];
    if (!intent) return { value: '', ask: true, reason: 'unrecognised question' };
    if (intent.neverAuto) return { value: '', ask: true, reason: 'Legal attestation: you must answer this yourself.' };
    if (!intent.key) return { value: '', ask: true, reason: 'No stored information covers this.' };
    const stored = String(facts[intent.key] == null ? '' : facts[intent.key]).trim();
    if (!stored) return { value: '', ask: true, reason: 'No stored value for ' + intent.label + '.' };
    if (id === 'protectedVeteran') {
      // Not a veteran ⇒ certainly not a protected veteran. A veteran may or may not be protected: never assume.
      return /^no$/i.test(stored) ? { value: 'No' } : { value: '', ask: true, reason: 'Protected-veteran status is narrower than veteran status; confirm it.' };
    }
    return { value: stored };
  }

  // ---- option understanding --------------------------------------------------------------------------------------
  const PLACEHOLDER = /^(select|choose|please select|please choose|select an? option|choose an? option|pick one|none selected|-+)$/;
  const DECLINE = /(prefer not|decline|choose not|rather not|do(?:n t| not) (?:wish|want) to (?:answer|disclose|say|identify|provide)|not (?:wish|want) to (?:answer|disclose)|not to (?:answer|disclose|say)|no answer)/;
  const NEGATIVE = /\b(?:not|no|never|none|neither|nor|cannot|isn t|aren t|don t|do not|am not|have not|haven t|n t)\b/;
  function polarity(text) {
    const n = norm(text);
    if (!n || PLACEHOLDER.test(n)) return 'placeholder';
    if (DECLINE.test(n)) return 'decline';
    if (/^(?:yes|y|true)\b/.test(n)) return 'yes';
    if (/^(?:no|n|false)\b/.test(n) || NEGATIVE.test(n)) return 'no';
    if (/\b(?:i am|i have|i do|i identify|i was|i will|i can|i would|i m)\b/.test(n)) return 'yes';
    return 'other';
  }
  const SYN = { man: 'male', male: 'male', woman: 'female', female: 'female', nonbinary: 'nonbinary', genderqueer: 'nonbinary',
    caucasian: 'white', white: 'white', black: 'black', african: 'black', asian: 'asian', hispanic: 'hispanic', latino: 'hispanic', latina: 'hispanic', latinx: 'hispanic',
    indigenous: 'native', native: 'native', pacific: 'pacific', islander: 'pacific', hawaiian: 'pacific', two: 'multi', more: 'multi', multiracial: 'multi', biracial: 'multi' };
  const canon = text => new Set(norm(text).split(' ').filter(w => w && !STOP.has(w) && w !== 'or').map(w => SYN[w] || w));
  const SENSITIVE_KEYS = new Set(['veteranStatus', 'disabilityStatus']);
  /** pickOption(key, value, labels[]) → {index,text,confidence,reason} (index -1 when it must ask) */
  function pickOption(key, value, labels) {
    const options = labels.map((text, index) => ({ text, index, n: norm(text), pol: polarity(text) })).filter(o => o.pol !== 'placeholder');
    const v = norm(value);
    if (!v || !options.length) return { index: -1, text: '', confidence: 0, reason: 'nothing to choose from' };
    const exact = options.filter(o => o.n === v);
    if (exact.length === 1) return { index: exact[0].index, text: exact[0].text, confidence: 1, reason: 'exact' };
    const wantYes = /^(yes|true|y)$/.test(v), wantNo = /^(no|false|n)$/.test(v), wantDecline = DECLINE.test(v);
    if (wantYes || wantNo || wantDecline) {
      const pol = wantYes ? 'yes' : wantNo ? 'no' : 'decline';
      let cands = options.filter(o => o.pol === pol);
      // Never assert a legal classification ("I identify as … protected veteran") on the applicant's behalf.
      if (wantYes && SENSITIVE_KEYS.has(key)) cands = cands.filter(o => o.n === 'yes');
      if (cands.length === 1) return { index: cands[0].index, text: cands[0].text, confidence: 0.9, reason: 'polarity ' + pol };
      const plain = cands.filter(o => o.n === pol);
      if (plain.length === 1) return { index: plain[0].index, text: plain[0].text, confidence: 0.9, reason: 'plain ' + pol };
      return { index: -1, text: '', confidence: cands.length ? 0.4 : 0, reason: cands.length ? 'several options fit; ask' : 'no option expresses ' + pol };
    }
    const want = canon(value);
    const scored = options.map(o => { const have = canon(o.text); const inter = [...want].filter(w => have.has(w)).length;
      return { o, s: inter / (new Set([...want, ...have]).size || 1), cover: inter / (want.size || 1) }; }).sort((a, b) => b.s - a.s);
    const [a, b] = [scored[0], scored[1] || { s: 0 }];
    if (a && a.cover >= 0.99 && a.s >= 0.5 && a.s - b.s >= 0.2) return { index: a.o.index, text: a.o.text, confidence: Math.min(0.95, 0.5 + a.s / 2), reason: 'meaning overlap' };
    return { index: -1, text: '', confidence: a ? a.s : 0, reason: 'no option clearly matches' };
  }

  // ---- how the page collects data -------------------------------------------------------------------------------
  /** controlKind({tag,type,role,hasPopup,pickerMarked,readOnly,ariaPressed,multiline}) */
  function controlKind(d) {
    const tag = (d.tag || '').toLowerCase(), type = (d.type || '').toLowerCase(), role = (d.role || '').toLowerCase();
    if (type === 'file') return 'upload';
    if (type === 'radio' || role === 'radio') return 'radio-group';
    if (d.ariaPressed) return 'bubble-group';
    if (type === 'checkbox' || role === 'checkbox' || role === 'switch') return 'checkbox';
    if (tag === 'select') return 'native-select';
    if (tag === 'textarea') return 'long-text';
    if (role === 'combobox' || d.hasPopup || d.pickerMarked) return d.searchable ? 'searchable-dropdown' : 'custom-dropdown';
    if (['date', 'month', 'datetime-local', 'time'].includes(type)) return 'date';
    if (['number', 'range'].includes(type)) return 'number';
    if (['email', 'tel', 'url'].includes(type)) return type + '-text';
    return d.readOnly ? 'custom-dropdown' : 'text';
  }

  // ---- is this page a job application? -------------------------------------------------------------------------
  const sigmoid = z => 1 / (1 + Math.exp(-z));
  /** features: {fields, knownIntents, hasResumeUpload, eeoTerms, titleCue, applyButton, hasPassword, hasPayment} */
  function scoreForm(f) {
    const reasons = [];
    let z = -3;
    const add = (w, why) => { z += w; if (w) reasons.push((w > 0 ? '+' : '') + w.toFixed(1) + ' ' + why); };
    add(0.25 * Math.min(f.fields || 0, 12), (f.fields || 0) + ' fields');
    add(0.7 * Math.min(f.knownIntents || 0, 6), (f.knownIntents || 0) + ' recognised questions');
    if (f.hasResumeUpload) add(1.6, 'resume upload');
    add(0.5 * Math.min(f.eeoTerms || 0, 3), 'equal-opportunity wording');
    if (f.titleCue) add(1.2, 'application wording in title/headings/URL');
    if (f.applyButton) add(0.8, 'apply/submit-application button');
    if (f.hasPayment) add(-3, 'payment fields');
    if (f.hasPassword && (f.fields || 0) <= 4) add(-2.5, 'looks like a login form');
    if ((f.fields || 0) < 2) add(-1.5, 'fewer than two fields');
    return { p: sigmoid(z), z, reasons, hardNegative: !!f.hasPayment || (!!f.hasPassword && (f.fields || 0) <= 4 && sigmoid(z) < 0.5) };
  }

  const api = { INTENTS, classify, answerFor, pickOption, polarity, controlKind, scoreForm, normalizeLabel, intentLabel: id => BY_ID[id]?.label || '' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ApplicationFillerModel = api;
})(typeof self !== 'undefined' ? self : this);
