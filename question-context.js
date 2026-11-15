/* Domain-specific question aliases. All matching is local and deterministic.
 * Generic dates are deliberately NOT interchangeable across domains. */
(function (root) {
  'use strict';
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const domains = {
    education: /\b(education|educational|academic history|academic background|school history|universit(?:y|ies)|college|degree|undergraduate|graduate studies)\b/i,
    employment: /\b(work experience|employment|employer|job history|professional experience|work history|positions held|career history)\b/i
  };
  const rules = {
    education: [
      ['school',/\b(school|institution|university|college)\b/i],
      ['degree',/\b(degree|qualification|degree type)\b/i],
      ['discipline',/\b(discipline|major|field of study|program of study)\b/i],
      ['gpa',/\b(gpa|grade point average)\b/i],
      ['startDate',/\b(start date|semester start date|start of (?:studies|semester)|enroll(?:ment|ed)? date|date (?:studies|semester) began|attendance start)\b/i],
      ['graduation',/\b(graduation date|expected graduat(?:ion|e)|date (?:of )?graduation|graduat(?:ed|ion)|end date|semester end date|completion date|attendance end)\b/i]
    ],
    employment: [
      ['company',/\b(company|employer|organization name|company name)\b/i],
      ['title',/\b(job title|position title|role title|title|position)\b/i],
      ['startDate',/\b(start date|employment start|date started|hire date|date of hire)\b/i],
      ['endDate',/\b(end date|employment end|date ended|last date|termination date)\b/i],
      ['details',/\b(responsibilit(?:y|ies)|duties|contributions|description of work)\b/i]
    ]
  };
  function detectDomain(label, sectionHint = '', siblingLabels = '') {
    const section=norm(sectionHint), siblings=norm(siblingLabels);
    // Trust explicit section headings before loose sibling hints.
    if(domains.education.test(section) && !domains.employment.test(section))return 'education';
    if(domains.employment.test(section) && !domains.education.test(section))return 'employment';
    if(/\b(school|university|college|degree|gpa|major|graduation)\b/i.test(siblings)
      && !/\b(employer|company|job title|work history|professional work)\b/i.test(siblings))return 'education';
    if(/\b(employer|company|job title|employment start|work history|professional work)\b/i.test(siblings)
      && !/\b(school|university|degree|graduation)\b/i.test(siblings))return 'employment';
    // A uniquely informative field may itself establish the domain. A generic
    // Start Date, End Date, or Company must not be assigned from the label alone.
    if(/\b(school|university|college|degree|gpa|major|graduation)\b/i.test(label))return 'education';
    if(/\b(employer|employment history|professional work history|professional experience|job title|work history)\b/i.test(label))return 'employment';
    return 'general';
  }
  function canonicalField(domain,label) {
    const found=(rules[domain]||[]).find(([,re])=>re.test(text(label)));
    return found?.[0]||'';
  }
  // Keep entity identity distinct where a user lists multiple schools or jobs.
  // Do NOT merge school 2's Start Date into school 1's Start Date.
  function answerKey(roleId,domain,field,entityId='',label='') {
    if(!['education','employment'].includes(domain)||!field||!entityId)
      return String(roleId||'')+'|'+norm(label).slice(0,220);
    return String(roleId||'')+'|ctx:'+domain+':'+norm(entityId).slice(0,100)+':'+field;
  }
  function schoolIdentity(value) {return norm(value).replace(/\b(?:st|saint)\b/g,'saint').replace(/\b(?:univ)\b/g,'university');}
  function equivalent(domain,a,b) {
    const first=canonicalField(domain,a),second=canonicalField(domain,b);
    return !!first && first===second;
  }
  root.ApplicationFillerContext={text,norm,schoolIdentity,detectDomain,canonicalField,answerKey,equivalent};
})(globalThis);
