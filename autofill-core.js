/* Job Form Helper - shared, dependency-free logic for the demo and Firefox add-on. */
(function (global) {
  'use strict';

  const FIELDS = [
    { key: 'firstName', labels: [/\b(first|given)\s*name\b/i, /\bfname\b/i] },
    { key: 'lastName', labels: [/\b(last|family|sur)\s*name\b/i, /\blname\b/i] },
    { key: 'fullName', labels: [/\b(full|legal|applicant|candidate|your)\s*name\b/i, /\bname\s*\(?(?:first\s*(?:and|&)\s*last|as\s+on\s+resume)\)?/i, /^name(?:\s*\*)?$/i] },
    { key: 'email', labels: [/\be-?mail(?:\s*address)?\b/i] },
    { key: 'phone', labels: [/\b(phone|mobile|telephone|cell)(?:\s*number)?\b/i] },
    { key: 'addressLine2', labels: [/\b(?:address|street)\s*(?:line\s*)?(?:2|two|second)\b/i,/\b(?:apartment|apt\.?|suite|unit|building\s*unit|floor|room)(?:\s*(?:number|no\.?|#))?\b/i] },
    { key: 'fullAddress', labels: [/\b(?:full|complete|entire)\s+(?:mailing\s+|residential\s+|home\s+|postal\s+)?address\b/i] },
    { key: 'addressLine1', labels: [/\b(?:address|street)\s*(?:line\s*)?(?:1|one|first)\b/i,/\b(?:street\s+address|mailing\s+address|residential\s+address|home\s+address)\b/i,/^address(?:\s*\*)?$/i] },
    { key: 'country', labels: [/\b(?:country|nation)(?:\s*\/\s*region)?\b/i] },
    { key: 'city', labels: [/^city\b/i, /\bcurrent\s+city\b/i] },
    { key: 'state', labels: [/^(state|province|region)(?:\s*\/\s*province)?\b/i] },
    { key: 'zip', labels: [/\b(zip|postal)(?:\s*code)?\b/i] },
    { key: 'linkedin', labels: [/linkedin/i] },
    { key: 'github', labels: [/github/i] },
    { key: 'portfolio', labels: [/portfolio/i, /personal\s+website/i] },
    { key: 'dob', labels: [/\bdate\s+of\s+birth\b/i, /\bbirth\s*date\b/i, /\bbirthday\b/i, /^dob$/i] },
    { key: 'citizenship', labels: [/\b(?:are\s+you\s+(?:a\s+)?)?(?:u\.?s\.?|united\s+states)\s+citizen(?:ship)?\b/i, /\bcitizenship\s+status\b/i, /\bexport\s+control\s+citizenship\b/i] },
    { key: 'workAuthorization', labels: [/\b(?:authorized|authorization|legally\s+eligible|eligible)\b.{0,65}\b(?:work|employment)\b/i, /\blegally\s+(?:work|employed)\b/i, /\b(?:work|employment)\s+authori[sz]ation\b/i, /\blegal(?:ly)?\s+authori[sz]ed\s+to\s+work/i] },
    { key: 'sponsorship', labels: [/\b(?:require|need)\b.{0,65}\b(?:visa|immigration|employment)\s*sponsorship\b/i, /\b(?:visa|immigration|employment)\s+sponsorship\b/i, /\bsponsor\b.{0,40}\b(?:visa|employment|work\s+authorization)\b/i] },
    { key: 'race', labels: [/^(?:race|racial\s+identity)(?:\b|\s*\*)/i] },
    { key: 'ethnicity', labels: [/\bethnic(?:ity|\s+origin)\b/i, /\bhispanic\s*\/\s*latino\b/i] }
  ];

  const SENSITIVE_DECISIONS = new Set(['citizenship', 'workAuthorization', 'sponsorship']);
  const YES_WORDS = ['yes', 'true', 'y', '1', 'authorized', 'i am', 'citizen'];
  const NO_WORDS = ['no', 'false', 'n', '0', 'not authorized', 'i am not'];

  function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

  // Normalizes common institutional abbreviations and punctuation, without
  // treating unrelated schools as equivalent.
  function normalizedSchool(value) {
    return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/\b(?:st|saint)\.?\s+/g, 'saint ')
      .replace(/\b(?:univ|university)\.?\b/g, 'university')
      .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function isSchoolMatch(a,b) {return !!a && !!b && normalizedSchool(a) === normalizedSchool(b);}


  function isVisible(el) {
    if (!el || el.disabled || el.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = global.getComputedStyle ? global.getComputedStyle(el) : null;
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  }

  function labelText(el) {
    const texts = [];
    for (const attr of ['aria-label', 'placeholder', 'name', 'id', 'title', 'autocomplete']) {
      if (el.getAttribute?.(attr)) texts.push(el.getAttribute(attr).replace(/[_-]/g, ' '));
    }
    if (el.labels) for (const label of el.labels) texts.push(label.textContent);
    const labelIds = el.getAttribute?.('aria-labelledby');
    if (labelIds) for (const id of labelIds.split(/\s+/)) {
      const label = el.ownerDocument.getElementById(id);
      if (label) texts.push(label.textContent);
    }
    const fieldset = el.closest?.('fieldset');
    const legend = fieldset?.querySelector('legend');
    if (legend) texts.push(legend.textContent);
    const question = el.closest?.('.question, .form-group, .field, [role="group"]');
    if (question) {
      const heading = question.querySelector('h2,h3,h4,.question-title,.field-label');
      if (heading) texts.push(heading.textContent);
    }
    return clean(texts.join(' | '));
  }

  function isUnsafeQuestion(text) {
    // Avoid acting on inverted or bundled eligibility questions.
    return /\b(not\s+(?:a\s+)?(?:us|u\.?s\.?|united states)\s+citizen|citizen\s+of\s+another\s+country)\b/i.test(text) ||
      /\b(?:select\s+all|check\s+all|and\/or|either\/or)\b/i.test(text);
  }

  function classify(el) {
    if (!el || !el.matches?.('input,select,textarea') || !isVisible(el)) return null;
    const type = (el.type || '').toLowerCase();
    if (['hidden','password','submit','reset','button','image','file','range','color','time','datetime-local'].includes(type)) return null;
    const hint = labelText(el);
    if (isUnsafeQuestion(hint)) return null;
    for (const item of FIELDS) {
      if (item.labels.some(re => re.test(hint))) {
        // Question answers require an explicit yes/no choice; never infer from text.
        if (SENSITIVE_DECISIONS.has(item.key) && !(['radio','checkbox','select-one'].includes(type) || el.tagName === 'SELECT')) return null;
        if (['radio','checkbox'].includes(type) && !SENSITIVE_DECISIONS.has(item.key)) return null;
        return item.key;
      }
    }
    return null;
  }

  function readAnswer(profile, key) {
    const value = profile?.[key];
    if (key === 'fullName') return clean(value || `${clean(profile?.firstName)} ${clean(profile?.lastName)}`);
    if (key === 'fullAddress') return [profile?.addressLine1, profile?.addressLine2,
      [profile?.city,profile?.state,profile?.zip].filter(Boolean).join(', '),profile?.country].filter(Boolean).join(', ');
    return clean(value);
  }

  function logicalChoice(value) {
    const v = clean(value).toLowerCase();
    if (v === 'yes' || v === 'no') return v;
    return null;
  }

  function optionChoiceText(el) {
    return clean(`${el.value || ''} ${el.labels ? [...el.labels].map(x=>x.textContent).join(' ') : ''}`.toLowerCase());
  }

  function matchesAnswer(text, answer) {
    const v = clean(text).toLowerCase();
    // Avoid confusing "No, I need sponsorship" with "No" on the wrong question.
    const matches = answer === 'yes' ? YES_WORDS : NO_WORDS;
    const contradicts = answer === 'yes' ? NO_WORDS : YES_WORDS;
    if (matches.includes(v)) return true;
    if (contradicts.includes(v)) return false;
    if (answer === 'yes') return /^(yes|true|y)(?:\b|\s*[-:.])/i.test(v);
    return /^(no|false|n)(?:\b|\s*[-:.])/i.test(v);
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? global.HTMLTextAreaElement?.prototype : global.HTMLInputElement?.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillElement(el, key, profile) {
    const value = readAnswer(profile, key);
    if (!value) return false;
    const type = (el.type || '').toLowerCase();
    if (SENSITIVE_DECISIONS.has(key)) {
      const answer = logicalChoice(value);
      if (!answer) return false;
      if (el.tagName === 'SELECT') {
        if (el.value && el.selectedIndex > 0) return false;
        const option = [...el.options].find(x => matchesAnswer(`${x.value} ${x.textContent}`, answer));
        if (!option) return false;
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (type === 'radio') {
        const questionName = el.name;
        const siblings = questionName ? [...el.ownerDocument.querySelectorAll('input[type="radio"]')].filter(x=> x.name === questionName) : [el];
        if (siblings.some(x=>x.checked)) return false;
        const match = siblings.find(x=>matchesAnswer(optionChoiceText(x), answer));
        if (!match) return false;
        match.click();
        return true;
      }
      // Intentionally skip checkboxes: often legal attestations or default checked.
      return false;
    }
    if (type === 'radio' || type === 'checkbox') return false;
    if (el.tagName === 'SELECT') {
      if (el.value && el.selectedIndex > 0) return false;
      const option = [...el.options].find(x => clean(x.value).toLowerCase() === value.toLowerCase() || clean(x.textContent).toLowerCase() === value.toLowerCase() || (key === 'university' && isSchoolMatch(x.textContent, value)));
      if (!option) return false;
      el.value = option.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.value) return false;
    // Date fields require an ISO date, no guessing or locale ambiguity.
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    if ((key === 'dob') && type !== 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    setNativeValue(el, value);
    return true;
  }

  function scan(root = global.document) {
    const elements = [...root.querySelectorAll('input,select,textarea')];
    const fields = elements.map(el => ({ el, key: classify(el) })).filter(x=>x.key);
    const unmatched = elements.filter(el=>isVisible(el) && !classify(el) && el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'file');
    return { fields, unmatched, totalInputs: elements.length, formDetected: !!root.querySelector('form') || fields.length >= 3 };
  }

  function fill(root, profile) {
    const matches = scan(root).fields;
    const processedGroups = new Set();
    let filled = 0;
    const details = [];
    for (const {el,key} of matches) {
      if (el.type === 'radio') {
        const group = key + ':' + el.name;
        if (processedGroups.has(group)) continue;
        processedGroups.add(group);
      }
      if (fillElement(el,key,profile)) { filled++; details.push(key); }
    }
    return { filled, matched: matches.length, details };
  }

  const LEGAL_TOPICS = [
    { id:'arbitration', test:/\b(arbitrat(?:ion|or)|class.action waiver)\b/i,
      title:'Arbitration / class-action waiver',
      summary:'You may be agreeing to resolve some disputes outside court, and possibly giving up the ability to bring a class action. Check the scope, exceptions, opt-out instructions, and deadlines.' },
    { id:'atwill', test:/\bat.will\b/i,
      title:'At-will employment',
      summary:'In general, this means the employment relationship can end at any time by either side, subject to applicable laws and contract terms.' },
    { id:'background', test:/\b(background check|consumer report|investigative consumer report)\b/i,
      title:'Background screening',
      summary:'The employer may request permission to verify certain details about you. Review what they check, who runs the check, and any separate authorization and rights notices.' },
    { id:'eeo', test:/\b(equal employment opportunity|voluntary self.identification|eeo|protected veteran|disabilit(?:y|ies) status)\b/i,
      title:'Equal-opportunity / self-identification',
      summary:'This typically requests demographic information for reporting or compliance. Check whether responding is voluntary and how the information will be used.' },
    { id:'certification', test:/\b(certify|attest|under penalty of perjury|true and complete|accurate to the best of my knowledge)\b/i,
      title:'Certification of accuracy',
      summary:'You may be confirming that the information you submitted is accurate. Read carefully before checking an agreement or signing.' },
    { id:'privacy', test:/\b(personal data|personal information|data retention|privacy policy|data processing|consent to process)\b/i,
      title:'Personal-data processing',
      summary:'The employer or its vendors may collect, use, store, or share your information. Review the privacy notice for purposes, recipients, retention, and any available choices.' },
    { id:'noncompete', test:/\b(non.compete|non.solicit(?:ation)?|restrictive covenant)\b/i,
      title:'Post-employment restriction',
      summary:'This may restrict certain work or contacts after you leave. Enforceability depends on local law and the exact wording; review duration, geography, and scope.' },
    { id:'authorization', test:/\b(authorized to work|work authorization|require sponsorship|visa sponsorship)\b/i,
      title:'Work eligibility / sponsorship',
      summary:'Work authorization, citizenship, and future sponsorship are different questions. Answer each based on your actual status, not an assumption from another answer.' }
  ];

  function explain(text) {
    return LEGAL_TOPICS.filter(topic=>topic.test.test(clean(text)));
  }

  function annotate(root = global.document) {
    let added = 0;
    const targets = root.querySelectorAll('label, legend, p, .legal-question, .question-title');
    for (const el of targets) {
      if (el.dataset?.jfhExplained || el.closest('[data-jfh-note]')) continue;
      const text = clean(el.textContent);
      if (text.length < 18 || text.length > 1400) continue;
      const items = explain(text);
      if (!items.length) continue;
      const note = root.createElement('div');
      note.setAttribute('data-jfh-note', 'true');
      note.style.cssText = 'padding:10px 12px;margin:8px 0;border-left:3px solid #5a71db;border-radius:5px;background:#f1f4ff;color:#17233d;font:13px/1.5 system-ui,sans-serif;';
      for (const item of items) {
        const heading = root.createElement('strong');
        heading.textContent = 'Plain English: ' + item.title;
        const body = root.createElement('div');
        body.textContent = item.summary;
        note.append(heading, body);
      }
      el.insertAdjacentElement('afterend', note);
      el.dataset.jfhExplained = 'yes';
      added++;
    }
    return added;
  }

  global.JobFormCore = { classify, labelText, scan, fill, fillElement, explain, annotate, LEGAL_TOPICS, normalizedSchool, isSchoolMatch, matchesAnswer };
})(globalThis);
