/* ApplicationFiller content controller. Operates only on user-requested runs. */
(function () {
  'use strict';
  if (globalThis.__applicationFillerListenerInstalled) return;
  globalThis.__applicationFillerListenerInstalled = true;
  let nextId = 0;
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const normalize = s => norm(s).replace(/\b(required|optional)\b/g, '').slice(0, 220);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const inputSelector = 'input:not([type="hidden"]),select,textarea,[role="combobox"],[role="radio"],button[aria-pressed],[aria-haspopup="listbox"],[aria-haspopup="menu"]';
  function visible(el, includeDisabled = false) {
    if (!el || (!includeDisabled && el.disabled) || el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    const css = getComputedStyle(el);
    if (css.display === 'none' || css.visibility === 'hidden') return false;
    if (el.getClientRects().length) return true;
    // Custom radio cards often visually hide the real input but expose a clickable label.
    if (el.matches('input[type="radio"], input[type="checkbox"]')) {
      return [...(el.labels || [])].some(label => label.getClientRects().length && getComputedStyle(label).display !== 'none');
    }
    // File inputs are often hidden behind a styled upload button.
    return el.matches('input[type="file"]');
  }
  function group(el) {
    return el.closest('fieldset,[role="radiogroup"],[role="group"],[data-question],.question,.form-group,.form-field,.field,.application-question,.field-container') || el.parentElement;
  }
  // Choice inputs are frequently wrapped in labels containing just "Yes" or "No".
  // Walk toward the actual question container instead of using that option label.
  function isChoiceCaption(text) {
    return /^(yes|no|y|n|true|false|agree|disagree|i agree|i disagree|decline|prefer not to answer|not applicable|n\/?a|other)$/i.test(norm(text));
  }
  function questionPrompt(text) {
    const value=clean(text).replace(/\s*\*\s*$/,'').trim();
    return value.length>=8 && value.length<=450 && !isChoiceCaption(value) &&
      (/\?/.test(value) || /^(are|do|does|did|have|has|will|would|is|was|were|can|could|should|which|what|why|where|when|if|please|select|indicate|confirm|whether|have you|i certify|i acknowledge)\b/i.test(value));
  }
  function questionFromChoice(el) {
    const ids = clean(el.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    for (const id of ids) {
      const node=document.getElementById(id);
      if (node && questionPrompt(node.textContent)) return clean(node.textContent);
    }
    let node=el, levels=0;
    while(node && levels++<9 && !node.matches?.('form,body,main')) {
      if(node.matches?.('fieldset,[role="radiogroup"],[role="group"],[data-question]')) {
        const named=clean(node.getAttribute('aria-label'));
        if(named && !isChoiceCaption(named))return named;
        const namedBy=clean(node.getAttribute('aria-labelledby')).split(' ').filter(Boolean)
          .map(id=>document.getElementById(id)?.textContent||'').join(' ');
        if(namedBy && !isChoiceCaption(namedBy))return clean(namedBy);
        const heading=node.querySelector(':scope > legend,:scope > .question-label,:scope > .field-label,:scope > .form-label,:scope > [role="heading"]');
        if(heading && !isChoiceCaption(heading.textContent))return clean(heading.textContent);
      }
      // At each level, look BEFORE the subtree containing the choice, never at
      // the choice itself. This works for field labels above visually styled radios.
      let sibling=node.previousElementSibling;
      for(let tries=0;sibling && tries<4;tries++,sibling=sibling.previousElementSibling) {
        if(sibling.querySelector('input,select,textarea,[role="radio"]'))continue;
        const label=clean(sibling.textContent);
        if(questionPrompt(label))return label;
      }
      node=node.parentElement;
    }
    return '';
  }
  function questionContext(el,label,facts={}) {
    // Determine the logical section, not just the input's short label.
    // Avoid taking all text from a huge form, which would mix education and work.
    let section='', siblingLabels='';
    let ancestor=el.parentElement;
    for(let depth=0;ancestor && depth<7;depth++,ancestor=ancestor.parentElement) {
      if(ancestor.matches?.('form,body,main'))break;
      const headline=ancestor.matches?.('fieldset')?ancestor.querySelector(':scope > legend'):null;
      const title=headline || ancestor.querySelector?.(':scope > h2,:scope > h3,:scope > h4,:scope > [role="heading"],:scope > .section-heading,:scope > .form-section-title');
      if(title && !section)section=clean(title.textContent).slice(0,150);
      const peers=[...ancestor.querySelectorAll('input:not([type="hidden"]),select,textarea')];
      if(peers.length>=2 && peers.length<=9 && !siblingLabels) {
        siblingLabels=peers.slice(0,9).map(input=>{
          const labels=[...(input.labels||[])].map(x=>clean(x.textContent)).join(' ');
          return labels||clean(input.getAttribute('aria-label')||input.placeholder||'');
        }).join(' ');
      }
    }
    // Pages such as IBM use a heading followed by fields inside a single form.
    // Use the closest preceding heading if no local section title was present.
    if(!section) {
      const headings=[...document.querySelectorAll('h2,h3,h4,legend,[role="heading"]')];
      for(let i=headings.length-1;i>=0;i--){
        const h=headings[i];
        if(h.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING){
          const title=clean(h.textContent);
          if(title.length<130){section=title;break;}
        }
      }
    }
    const domain=ApplicationFillerContext.detectDomain(label,section,siblingLabels);
    const canonical=ApplicationFillerContext.canonicalField(domain,label);
    let entityId='',recordIndex=-1;
    const records=domain==='education'?(facts.educationRecords||[]):domain==='employment'?(facts.employmentRecords||[]):[];
    if(records.length===1){recordIndex=0;entityId=clean(domain==='education'?records[0].school:records[0].company);}
    else if(records.length>1){
      const groupText=clean(group(el)?.textContent||'');
      const matches=records.map((r,i)=>[r,i]).filter(([r])=>{
        const name=clean(domain==='education'?r.school:r.company);
        return name.length>=5 && norm(groupText).includes(norm(name));
      });
      if(matches.length===1){recordIndex=matches[0][1];entityId=clean(domain==='education'?matches[0][0].school:matches[0][0].company);}
    }
    // Distinct uncertain records are never merged under one Start Date.
    const memoryKey=canonical && entityId ? ApplicationFillerContext.answerKey(facts.roleId||'',domain,canonical,entityId,label) : '';
    return {domain,canonical,entityId,recordIndex,section:section||({education:'Education',employment:'Work experience'}[domain]||'Other questions'),memoryKey};
  }
  // Read the human-facing label before looking at framework-generated input
  // names.  Some ATS controls have names/IDs that resemble *other* fields.
  function nearbyFieldLabel(el) {
    let node=el;
    for(let depth=0;node && depth<5;depth++,node=node.parentElement) {
      if (node.matches?.('form,fieldset,body,main')) break;
      const parent=node.parentElement;
      if (!parent || parent.matches('form,body,main')) break;
      const peers=[...parent.querySelectorAll('input:not([type="hidden"]),select,textarea,[role="combobox"]')];
      if (peers.length > 2) break; // Do not borrow another field's question.
      const proposed=[];
      let sibling=node.previousElementSibling;
      for(let attempt=0;sibling && attempt<3;attempt++,sibling=sibling.previousElementSibling) {
        if (sibling.querySelector('input,select,textarea,[role="combobox"]')) break;
        proposed.push(clean(sibling.textContent));
      }
      const direct=parent.querySelector(':scope > label,:scope > .control-label,:scope > .field-label,:scope > [class*="fieldLabel"],:scope > [class*="formLabel"]');
      if(direct && !direct.contains(el))proposed.unshift(clean(direct.textContent));
      const good=proposed.find(label=>label.length>=2 && label.length<=95 &&
        !/^(select|choose|please select|search)(?: an? option)?(?:\.{3})?$/i.test(label) &&
        !/^(yes|no|optional|required|\*)$/i.test(label));
      if(good)return good;
    }
    return '';
  }
  function placeholderChoice(value) {
    const v=clean(value).toLowerCase().replace(/^[-–—\s]+|[-–—\s]+$/g,'');
    if(!v)return true;
    return /^(?:select|choose|please select|please choose|pick)(?:\s+(?:an?|the|one|your))?(?:\s+(?:option|value|country|state|province|region|location|one))?(?:\.{2,3})?$/.test(v) ||
      /^(?:select an option|select a value|choose an option|choose a value|none selected|not selected|-- select --)$/.test(v);
  }
  // A number of ATS sites display the actual field title as a sibling caption,
  // while a hidden / generated HTML label or internal name points elsewhere.
  // For address data, a local *visible* caption is stronger evidence than an
  // unrelated `for=` label. Never read text from a container with many fields.
  function localAddressCaption(el) {
    const container=group(el);
    if(!container || container.matches('form,main,body'))return '';
    const children=[...container.querySelectorAll('input:not([type="hidden"]),select,textarea,[role="combobox"]')];
    if(children.length!==1 || children[0]!==el)return '';
    const title=container.querySelector(':scope > .label-caption,:scope > .field-label,:scope > .control-label,:scope > .question-label,:scope > label,:scope > [class*="fieldLabel"],:scope > [class*="formLabel"]');
    if(!title || !visible(title))return '';
    const caption=clean(title.textContent).replace(/\s*(?:select|choose) an? option\s*$/i,'');
    if(/^(?:city|town|municipality|state(?:\s*\/\s*province)?|province|country(?:\s*\/\s*region)?|zip(?:\s+code)?|postal(?:\s+code)?|post\s*code|address\s*(?:line\s*)?[12]|street address)\b/i.test(caption))return caption;
    return '';
  }
  const meaningful = text => norm(text).length>=2;
  const usable = text => meaningful(text) ? clean(text) : '';
  const captionSkip = '[role="listbox"],[role="option"],script,style,option,.virtual-menu,[role="tooltip"]';
  const captionNoise = text => !meaningful(text) || placeholderChoice(text) || /^(optional|required|\*)$/i.test(clean(text));
  // Use the whole caption element (so a separate red asterisk <span> stays attached).
  function captionFromTextNode(node, el) {
    const holder=node.parentElement;
    if(holder && !holder.contains(el) && !holder.querySelector(inputSelector)) {
      const text=clean(holder.textContent);
      if(text.length<=95)return text;
    }
    return clean(node.textContent);
  }
  const textNodeShown = (node, el) => {
    const p=node.parentElement;
    if(!p || el.contains(p) || p.closest(captionSkip) || !p.getClientRects().length)return false;
    const css=getComputedStyle(p);
    if(css.visibility==='hidden' || css.opacity==='0' || css.display==='none')return false;
    // Screen-reader-only text (off-screen, clipped or 1px) is not a caption the applicant can see.
    const r=p.getBoundingClientRect();
    return r.width>=3 && r.height>=3 && r.right+window.scrollX>0 && r.bottom+window.scrollY>0;
  };
  // Text that is actually visible inside the smallest wrapper that holds exactly this one control.
  function visualCaption(el) {
    let node=el;
    for(let depth=0;node && depth<6;depth++) {
      const parent=node.parentElement;
      if(!parent || parent.matches('form,main,body'))return '';
      const others=[...parent.querySelectorAll(inputSelector+',[data-application-filler-picker]')]
        .filter(c=>c!==el && !el.contains(c) && !c.contains(el) && visible(c,true));
      if(others.length)return '';
      const walker=document.createTreeWalker(parent,NodeFilter.SHOW_TEXT);
      for(let n=walker.nextNode();n;n=walker.nextNode()) {
        if(!textNodeShown(n,el) || captionNoise(n.textContent))continue;
        const text=captionFromTextNode(n,el);
        if(text.length<=95 && !captionNoise(text))return text.replace(/\s*(?:select|choose) an? option\s*$/i,'');
      }
      node=parent;
    }
    return '';
  }
  // Nearest visible text above the control, by screen position. Independent of DOM nesting and ids.
  function geometricCaption(el) {
    const box=el.getBoundingClientRect();
    if(!box.width && !box.height)return '';
    const root=el.closest('form,main,[role="main"]')||document.body;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let best=null,bestScore=Infinity;
    for(let n=walker.nextNode();n;n=walker.nextNode()) {
      if(!textNodeShown(n,el) || captionNoise(n.textContent))continue;
      const rect=n.parentElement.getBoundingClientRect();
      const gap=box.top-rect.bottom;
      const overlap=Math.min(rect.bottom,box.bottom)-Math.max(rect.top,box.top);
      let score;
      if(gap>=-3 && gap<=70 && rect.right>=box.left-4 && rect.left<=box.right)score=gap+Math.abs(rect.left-box.left)/20;       // above
      else if(overlap>=Math.min(rect.height,box.height)*0.5 && box.left-rect.right>=-4 && box.left-rect.right<=260)score=(box.left-rect.right)/6; // same row, to the left
      else continue;
      if(score<bestScore){const text=captionFromTextNode(n,el);if(text.length<=95 && !captionNoise(text)){best=text;bestScore=score;}}
    }
    return best ? best.replace(/\s*(?:select|choose) an? option\s*$/i,'') : '';
  }
  const labelCache=new WeakMap();
  function inputLabel(el) {
    const hit=labelCache.get(el);
    if(hit && Date.now()-hit.t<350)return hit.label;
    const label=computeInputLabel(el);
    labelCache.set(el,{t:Date.now(),label});
    return label;
  }
  function computeInputLabel(el) {
    const localAddress=localAddressCaption(el);
    if(localAddress)return localAddress;
    const choice = el.type === 'radio' || el.getAttribute('role') === 'radio' || el.hasAttribute('aria-pressed');
    // A visible <label for> that really resolves to THIS control is reliable. (With duplicate ids the
    // browser binds the label to a different element, so it is not in el.labels and is not trusted.)
    const explicit=[...(el.labels||[])].some(label=>label.control===el && label.getClientRects().length && usable(label.textContent));
    if(!choice && !explicit) {
      // A caption the applicant can actually see beats ids, hidden labels and generated names.
      const seen=visualCaption(el);
      if(seen && knownKey(el,seen))return seen;
      const near=seen ? '' : geometricCaption(el);
      if(near && knownKey(el,near))return near;
    }
    if(choice) {
      const prompt=questionFromChoice(el);
      if(prompt)return prompt;
      const wrapper=group(el);
      const heading=wrapper?.querySelector('legend,.question-label,.field-label,.form-label,[role="heading"]');
      const named=wrapper?.getAttribute('aria-label') || heading?.textContent;
      if(clean(named) && !isChoiceCaption(named))return clean(named);
    }
    const ids = clean(el.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    const ariaText = ids.map(id => document.getElementById(id)).filter(node=>node && node.getClientRects().length)
      .map(node=>node.textContent||'').filter(Boolean).join(' ');
    const labels = [...(el.labels || [])].filter(label=>label.getClientRects().length).map(label => {
      const copy = label.cloneNode(true);
      copy.querySelectorAll('input,select,textarea,button').forEach(node => node.remove());
      return clean(copy.textContent);
    }).find(Boolean);
    const grp = group(el);
    const legend = grp?.querySelector(':scope > legend,[role="group"] > legend, .question-label,.field-label,.form-label,[data-testid="question-title"]');
    const groupAria = grp?.getAttribute('aria-label') || '';
    // The visible caption is more trustworthy than an autogenerated input ID.
    // Keep explicit accessibility labels authoritative when they are present.
    const direct = clean(usable(ariaText) || usable(labels) || usable(el.getAttribute('aria-label')) ||
      usable(nearbyFieldLabel(el)) || usable(legend?.textContent) || usable(groupAria) || '');
    // Custom selectors sometimes append the unselected placeholder to the question.
    const fieldCaption = direct.replace(/\s*\*?\s*(?:select|choose|please select)\s+(?:an?\s+)?option\s*(?:\.\.\.)?$/i,'').trim();
    if (fieldCaption && (!choice || !isChoiceCaption(fieldCaption))) return fieldCaption;
    if(choice) {
      // Never show "Yes" as the question or store it in answer memory.
      const name=clean(el.name || group(el)?.getAttribute('aria-label') || '');
      return name && !/^(yes|no|radio|option)\d*$/i.test(name)
        ? 'Question on application: '+name.replace(/[_-]+/g,' ')
        : 'Unrecognized choice question — review on application page';
    }
    // Nearby explicit labels, common with iCIMS and React-style custom selectors.
    const labelNode = grp?.querySelector('label,.control-label,[class*="questionLabel"],[class*="fieldLabel"]');
    if (labelNode && !labelNode.querySelector('input,textarea,select')) return clean(labelNode.textContent);
    const hinted = JobFormCore.labelText(el).split('|').map(clean).find(value => value && !/^(select|choose|search)$/i.test(value));
    return hinted || clean(el.getAttribute('placeholder') || el.name || el.id || 'Unnamed question');
  }
  function isFilled(el) {
    if (el.matches('[role="radio"]')) return el.getAttribute('aria-checked') === 'true';
    if (isPicker(el)) {
      const shown=clean(el.getAttribute('aria-valuetext') ||
        (el.matches('input') ? el.value : '') || el.textContent);
      return !!shown && !placeholderChoice(shown);
    }
    if (el.matches('button[aria-pressed]')) return el.getAttribute('aria-pressed') === 'true';
    if (el.type === 'checkbox' || el.type === 'radio') return !!el.checked;
    if (el.tagName === 'SELECT') {
      const selected=el.selectedOptions?.[0];
      return !!selected && !selected.disabled && !placeholderChoice(selected.textContent) &&
        !!clean(el.value) && !placeholderChoice(el.value);
    }
    if (el.type === 'file') return !!el.files?.length;
    return !!clean(el.value);
  }
  const Model = typeof ApplicationFillerModel !== 'undefined' ? ApplicationFillerModel : null;
  let modelLearned = {};
  const understandCache = new Map();
  // What a question means, independent of its exact wording (see question-model.js).
  function classifyLabel(label) {
    if (!Model) return null;
    const cacheKey = clean(label) + '\u0000' + Object.keys(modelLearned).length;
    if (!understandCache.has(cacheKey)) {
      if (understandCache.size > 400) understandCache.clear();
      understandCache.set(cacheKey, Model.classify(label, {learned: modelLearned}));
    }
    return understandCache.get(cacheKey);
  }
  const intentInfo = id => Model?.INTENTS.find(i => i.id === id);
  function intentMemoryKey(label, context = {}, roleId = '') {
    const u = classifyLabel(label);
    if (!u?.confident || !u.id || context.canonical || (context.domain && context.domain !== 'general') || intentInfo(u.id)?.neverAuto) return '';
    return roleId + '|intent:' + u.id;
  }
  const isDisabledEl = el => !!el.disabled || el.getAttribute('aria-disabled')==='true' || !!el.closest('fieldset[disabled]') ||
    /(^|[\s_-])disabled($|[\s_-])/i.test(String(el.className?.baseVal ?? el.className ?? ''));
  const isPicker = el => !!el.matches?.('[role="combobox"],[aria-haspopup="listbox"],[aria-haspopup="menu"]') || el.dataset?.applicationFillerPicker==='1';
  // Many ATS dropdowns are plain buttons/divs that merely *display* "Select an option".
  function placeholderTriggers(wantDisabled=false) {
    return [...document.querySelectorAll('button,[role="button"],div[tabindex],span[tabindex],[aria-expanded],[data-application-filler-picker]')]
      .filter(el=>!el.matches(inputSelector) && visible(el,true) && !el.closest('nav,header,footer,[role="navigation"]') &&
        (el.dataset.applicationFillerPicker==='1' || (!el.querySelector('input,select,textarea,button') &&
          clean(el.textContent) && placeholderChoice(clean(el.textContent)))))
      .filter(el=>isDisabledEl(el)===wantDisabled)
      .map(el=>{el.dataset.applicationFillerPicker='1';return el;});
  }
  const baseControls = () => [...document.querySelectorAll(inputSelector)].filter(el=>visible(el))
    // Search boxes and controls in site navigation are not application questions.
    .filter(el => !el.closest('nav,header,footer,[role="navigation"],[role="search"]') && el.type !== 'search')
    .filter(el => !['button','submit','reset','password'].includes(el.type) || el.hasAttribute('aria-pressed') || ['radio','combobox'].includes(el.getAttribute('role')) || ['listbox','menu'].includes(el.getAttribute('aria-haspopup')));
  const controls = () => {
    const seen=new Set(),all=[];
    for(const el of [...baseControls(),...placeholderTriggers(false)]) if(!seen.has(el)){seen.add(el);all.push(el);}
    return all.sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  };
  // Visible but disabled controls (e.g. State until Country is chosen). They are never filled,
  // but they must never be silently skipped past either.
  const disabledControls = () => [...new Set([...document.querySelectorAll(inputSelector),...placeholderTriggers(true)])]
    .filter(el=>isDisabledEl(el) && visible(el,true) && !el.closest('nav,header,footer,[role="navigation"]') &&
      (isPicker(el) || !['button','submit','reset','password','hidden','search','file'].includes(el.type)));
  function fieldKey(el) {
    // Include the human-readable question. Many SPAs reuse generic field names
    // across multiple steps, which otherwise causes unrelated skips.
    const base = [el.name || el.id || 'field', normalize(inputLabel(el))].join('|');
    const step = el.closest('[data-step]')?.getAttribute('data-step') || '';
    return `${location.hostname}|${location.pathname}|${step}|${base}`;
  }
  function stableOptionalKey(el) {
    // Framework-generated ids and names often change after a React rerender.
    // Use human-readable question wording and control type for skip memory.
    const step=el.closest('[data-step]')?.getAttribute('data-step')||'';
    const kind=el.type==='radio'||el.getAttribute('role')==='radio'?'radio':
      el.type==='file'?'file':el.tagName.toLowerCase();
    return 'os:'+location.hostname+'|'+location.pathname+'|'+step+'|'+kind+'|'+normalize(inputLabel(el));
  }
  function mark(el) {
    if (!el.dataset.applicationFillerId) el.dataset.applicationFillerId = `af-${++nextId}`;
    return el.dataset.applicationFillerId;
  }
  function setValue(el, value) {
    const text = clean(value);
    if (el.tagName === 'SELECT') {
      const match = [...el.options].find(option => !option.disabled && !placeholderChoice(option.textContent) &&
        (norm(option.value) === norm(text) || norm(option.textContent) === norm(text)
        || (JobFormCore.isSchoolMatch && JobFormCore.isSchoolMatch(option.textContent, text))));
      if (!match) return false;
      const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')?.set;
      if(setter)setter.call(el,match.value);else el.value=match.value;
    } else if (el.matches('[role="radio"],button[aria-pressed]')) {
      el.click(); return true;
    } else if (el.type === 'radio') {
      (el.labels?.[0] || el).click(); return true;
    } else if (el.type === 'checkbox' || el.type === 'file') return false;
    else if (isPicker(el) && !el.matches('input')) return false;
    else {
      if (el.maxLength > 0 && text.length > el.maxLength) return false;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
    }
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    return el.tagName === 'SELECT' ? isFilled(el) : clean(el.value) === text;
  }
  function siblingsFor(el) {
    if (el.type === 'radio' && el.name) return [...document.querySelectorAll('input[type="radio"]')].filter(other => other.name === el.name && visible(other));
    // Custom Yes/No bubbles can each be wrapped in a separate div. Find the
    // smallest ancestor holding both choices; don't treat "Yes" as a group.
    let container=group(el), depth=0;
    while(container && depth++<6 && !container.matches('form,main,body')) {
      const options=[...container.querySelectorAll('input[type="radio"],[role="radio"],button[aria-pressed]')].filter(el=>visible(el));
      if(options.length>=2)return options;
      container=container.parentElement;
    }
    return [el];
  }
  function optionLabel(el) {
    const label = [...(el.labels || [])].map(x => clean(x.textContent)).join(' ');
    return clean(label || el.getAttribute('aria-label') || el.textContent || el.value || '');
  }
  const US_STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
  function normalizedState(text) {
    const v=norm(text).toUpperCase();
    return Object.keys(US_STATES).find(code=>code===v||norm(US_STATES[code])===norm(text)) || '';
  }
  function selectionMatch(option, value, key) {
    const actual = norm(option), expected = norm(value);
    if (!actual || !expected) return false;
    if (actual === expected) return true;
    if (key === 'state') return !!normalizedState(option) && normalizedState(option)===normalizedState(value);
    if(key === 'country') {
      const a=ApplicationFillerCountries.find(option),b=ApplicationFillerCountries.find(value);
      return !!a && !!b && a.code===b.code;
    }
    if (key === 'university') return JobFormCore.isSchoolMatch?.(option, value) || false;
    if (['citizenship', 'workAuthorization', 'sponsorship', 'essentialFunctions'].includes(key)) {
      if (key === 'citizenship' && expected === 'yes' && /^(u s citizen|united states citizen|us citizen)$/.test(actual)) return true;
      if (/^(yes|no)$/i.test(value)) return /^(yes|no)(?:\b|\s|\W)/i.test(actual) && actual.startsWith(expected);
    }
    if (key === 'veteranStatus' && expected === 'no') return /^(no|not a protected veteran|i am not a protected veteran|none of the above)$/.test(actual);
    if (key === 'disabilityStatus' && expected === 'no') return /^(no|no disability|i do not have a disability|i don t have a disability)$/.test(actual);
    if (key === 'ethnicity' && /^(hispanic or latino|not hispanic or latino)$/.test(expected)) {
      if (/^(yes|no)$/.test(actual)) return actual === (expected==='hispanic or latino'?'yes':'no');
    }
    if (key === 'race' && expected === 'black or african american') return /^(black or african american|black african american|african american)$/.test(actual);
    if (key === 'gender' && expected === 'prefer not to answer') return /^(prefer not to answer|decline to answer|i do not wish to answer)$/.test(actual);
    if (key === 'race' && expected === 'prefer not to answer') return /^(prefer not to answer|decline to answer|choose not to disclose)$/.test(actual);
    if (key === 'ethnicity' && expected === 'prefer not to answer') return /^(prefer not to answer|decline to answer|choose not to disclose)$/.test(actual);
    if (key === 'degree') {
      if (/bachelor of science|b\s*s\s*in|b\s*s\b/.test(expected)) return /^(bachelor of science|b s|b s degree)$/.test(actual);
    }
    return false;
  }
  function chooseFromGroup(el, value, key) {
    const options = siblingsFor(el);
    if (options.some(isFilled)) return false;
    let found = options.find(option => selectionMatch(optionLabel(option), value, key) || selectionMatch(option.value, value, key));
    if (!found && Model) {
      const pick=Model.pickOption(key,value,options.map(optionLabel));
      if(pick.index>=0 && pick.confidence>=0.8)found=options[pick.index];
    }
    if (!found) return false;
    (found.labels?.[0] || found).click(); return true;
  }
  function setNamedAnswer(el, value, key = '') {
    if (el.type === 'radio' || el.getAttribute('role') === 'radio' || el.hasAttribute('aria-pressed')) return chooseFromGroup(el, value, key);
    if (el.tagName === 'SELECT') {
      let selected = [...el.options].find(o => selectionMatch(o.textContent, value, key) || selectionMatch(o.value, value, key));
      if (!selected && Model) {
        const pick=Model.pickOption(key,value,[...el.options].map(o=>clean(o.textContent)));
        if(pick.index>=0 && pick.confidence>=0.8)selected=el.options[pick.index];
      }
      return selected ? setValue(el, selected.value) : false;
    }
    return setValue(el, value);
  }
  function isAgreement(el, label) {
    const consentControl = el.type === 'checkbox' || el.type === 'radio' || el.getAttribute('role') === 'radio';
    return consentControl && /\b(agree|accept|consent|certify|understand|acknowledge|privacy|terms|confirm\s+(?:that\s+)?i\s+have\s+read)\b/i.test(label);
  }
  function criticalAgreement(label) { return /\b(read|understand|certify|attest|accurate|true|complete|arbitration|background\s*check|signature|waiver)\b/i.test(label); }
  function isExperience(label) {return /\b(work history|employment history|professional (work )?experience|past employment)\b/i.test(label);}
  function isAIQuestion(el,label) {return (el.tagName === 'TEXTAREA' || /\b(why|describe|tell us|explain|what interests|motivation)\b/i.test(label)) &&
    /\b(why|describe|tell us|explain|motiv|project|experience|accomplish|interested|about yourself|cover letter)\b/i.test(label);}
  function isRequired(el,label) {
    if(el.required || el.getAttribute('aria-required')==='true')return true;
    if(/\boptional\b/i.test(label))return false;
    if(/\*\s*$/.test(clean(label)))return true;
    // Use a specific label rather than stars on surrounding unrelated controls.
    const labels=[...(el.labels||[])];
    const own=labels.map(node=>clean(node.textContent)).join(' ');
    if(/\*/.test(own) || /\*/.test(clean(el.getAttribute('aria-label'))))return true;
    const container=group(el);
    if(!container || container.matches('form,body,main,section'))return false;
    const children=[...container.querySelectorAll('input:not([type="hidden"]),select,textarea,[role="radio"],[role="combobox"]')];
    const radioGroup=(el.type==='radio'||el.getAttribute('role')==='radio') && children.length>0 &&
      children.every(child=>child.type==='radio'||child.getAttribute('role')==='radio');
    // A wrapper containing Address line 2 AND Country * does not make the
    // optional address field required. Radio options count as one question.
    if(children.length>1 && !radioGroup)return false;
    return container.getAttribute('aria-required')==='true' ||
      /\brequired\b/i.test(String(container.className||'')) || /\*/.test(label);
  }
  function describeKind(el) {
    return Model ? Model.controlKind({tag:el.tagName,type:el.type,role:el.getAttribute('role'),
      hasPopup:!!el.getAttribute('aria-haspopup'),pickerMarked:el.dataset?.applicationFillerPicker==='1',readOnly:el.readOnly,
      ariaPressed:el.hasAttribute('aria-pressed'),searchable:el.getAttribute('aria-autocomplete')==='list'||el.getAttribute('aria-autocomplete')==='both'}) : '';
  }
  function manualItem(el, kind, label, roleId, required, suggestion = '', context = {}) {
    let choices = [];
    if (el.tagName === 'SELECT') choices = [...el.options].filter(o=>clean(o.value) && !o.disabled).map(o=>({value:o.value,label:clean(o.textContent)}));
    else if (el.type === 'radio' || el.getAttribute('role') === 'radio' || el.hasAttribute('aria-pressed'))
      choices = siblingsFor(el).map(o=>{
        const caption=optionLabel(o),raw=clean(o.value);
        return {value:(!raw||/^(?:on|off|0|1|true|false)$/i.test(raw))?caption:raw,label:caption};
      }).filter(o=>o.value);
    else if (isPicker(el) || el.readOnly)
      choices = visibleCustomChoices().map(o=>({value:customChoiceLabel(o),label:customChoiceLabel(o)}))
        .filter(o=>o.value);
    const type=el.type==='date'?'date':el.type==='number'?'number':
      (el.type==='radio'||el.getAttribute('role')==='radio'||el.hasAttribute('aria-pressed'))?'radio':
      (el.tagName==='SELECT'||isPicker(el)||el.readOnly)?'select':
      el.type==='file'?'file':el.type==='checkbox'?'checkbox':
      el.tagName==='TEXTAREA'?'textarea':el.type==='email'?'email':el.type==='tel'?'tel':'text';
    const fallbackKey=roleId+'|'+normalize(label);
    const learnedKey=context.memoryKey||
      (context.canonical && ['education','employment'].includes(context.domain) ?
        roleId+'|ctx:'+context.domain+':unassigned:'+context.canonical : fallbackKey);
    const understood=classifyLabel(label);
    return {id:mark(el),kind,label,required,profileKey:knownKey(el,label)||'',signature:fieldKey(el),
      controlKind:describeKind(el),
      understanding:understood&&(understood.id||understood.candidates.length)?{id:understood.id,label:understood.label,
        confident:understood.confident,confidence:Math.round(understood.confidence*100)/100,source:understood.source,
        candidates:understood.candidates}:null,optionalSignature:stableOptionalKey(el),
      ignoreKey:required?'':optionalIgnoreKey(el,label,context),memoryKey:learnedKey,suggestion,
      category:context.domain||'general',canonicalField:context.canonical||'',entityId:context.entityId||'',
      recordIndex:context.recordIndex??-1,section:context.section||'Other questions',
      ambiguous:context.domain==='general' && /^(?:start date|end date|company|school|date)$/i.test(normalize(label)),
      type,maxLength:el.maxLength > 0 ? el.maxLength : 1400,options:choices};
  }
  function factsFor(key, facts) {
    if(key==='citizenshipCountry') {
      const list=Array.isArray(facts.citizenships)?facts.citizenships.filter(Boolean):[];
      return list.length===1 ? clean(list[0]) : '';
    }
    if(key==='fullName')return clean(facts.fullName || [facts.firstName,facts.lastName].filter(Boolean).join(' '));
    if(key==='fullAddress')return [facts.addressLine1,facts.addressLine2,
      [facts.city,facts.state,facts.zip].filter(Boolean).join(', '),facts.country].filter(Boolean).join(', ');
    return clean(facts[key]);
  }
  function knownKey(el,label) {
    // A citizenship-country selector must never be filled from the residence-country field.
    if(/\b(?:country of citizenship|citizenship country|country you (?:are a )?citizen of|which countr(?:y|ies).{0,30}citizen)\b/i.test(label))return 'citizenshipCountry';
    if (/\b(full name|legal name|candidate name|applicant name|your name)\b/i.test(label)) return 'fullName';
    // Explicit site labels outrank incidental id/name strings. In IBM's form,
    // broad classification previously filled "City" with a first name and ZIP
    // with a GitHub username fragment.
    if(/\b(first|given)\s*name\b/i.test(label))return 'firstName';
    if(/\b(last|family|surname)\s*name\b/i.test(label))return 'lastName';
    if(/\b(e-?mail)(?:\s+address)?\b/i.test(label))return 'email';
    if(/\b(phone|mobile|telephone|cell)(?:\s+number)?\b/i.test(label))return 'phone';
    if(/\blinked\s*in\b/i.test(label))return 'linkedin';
    if(/\bgithub\b/i.test(label))return 'github';
    if(/\bportfolio\b|\bpersonal\s+website\b/i.test(label))return 'portfolio';
    if(/\b(date of birth|birth date|birthday)\b|^dob$/i.test(label))return 'dob';
    if(/^\s*(?:city|town|municipality)\b/i.test(label))return 'city';
    if(/\b(zip|postal)(?:\s+(?:code|number))?\b/i.test(label))return 'zip';
    if(/^\s*(?:state|province|state\s*\/\s*province)\b/i.test(label))return 'state';
    if(/^\s*(?:country|country\s*\/\s*region)\b/i.test(label))return 'country';
    const detected=JobFormCore.classify(el);
    // Only use attribute-based matching if there is no conflicting explicit label.
    if(detected && (!label || /^(?:unnamed question|field|input)\b/i.test(label)))return detected;
    // Address line 2 must be checked before generic street / mailing address.
    // Do not interpret email addresses, web addresses or IP addresses as residences.
    if(!/\b(?:email|e-mail|web|url|ip)\s+address\b/i.test(label)) {
      if(/\b(?:address|street)\s*(?:line\s*)?(?:2|two|second)\b|\b(?:apartment|apt\.?|suite|unit|floor|room)(?:\s*(?:no\.?|number|#))?\b/i.test(label))return 'addressLine2';
      if(/\b(?:full|complete|entire)\s+(?:mailing\s+|home\s+|residential\s+|postal\s+)?address\b/i.test(label))return 'fullAddress';
      if(/\b(?:address|street)\s*(?:line\s*)?(?:1|one|first)\b|\b(?:street|mailing|residential|home)\s+address\b|^address\s*\*?$/i.test(label))return 'addressLine1';
    }
    if(/\b(?:country|country\s*\/\s*region|nation)\b/i.test(label))return 'country';
    if(/\b(?:postal\s*code|zip\s*code|zip|postcode)\b/i.test(label))return 'zip';
    if(/\b(?:state|province|region)\b/i.test(label)&&!/\b(united states|country)\b/i.test(label))return 'state';
    if(/^(?:city|town|municipality)(?:\s*\*)?$/i.test(label))return 'city';
    const autocomplete=norm(el.getAttribute('autocomplete')||'');
    const autoKeys={'address line1':'addressLine1','address line2':'addressLine2',
      'street address':'addressLine1','address level1':'state','address level2':'city',
      'postal code':'zip','country name':'country','country':'country'};
    if(autoKeys[autocomplete])return autoKeys[autocomplete];
    const rule = [
      ['university', /\b(university|college|school(?:\s*\/?\s*institution)?|institution)\b/i],
      ['degree',/\b(degree|qualification)\b/i],['graduation',/\b(graduation|graduate date|expected graduation)\b/i],
      ['gpa',/\bgpa\b/i],['skills',/\b(technical skills|programming skills|relevant skills)\b/i],
      ['experience',/\b(work history|employment history|professional (work )?experience)\b/i],
      ['veteranStatus',/\b(veteran status|protected veteran|military service)\b/i],
      ['disabilityStatus',/\b(disabilit(?:y|ies)|self identification of disability|self-identify)\b/i],
      ['essentialFunctions',/\b(essential functions|reasonable accommodations?|perform.*functions.*role)\b/i],
      ['gender',/\b(gender|sex(?:\s+identit(?:y|ies))?)\b/i],
      ['ethnicity',/\b(ethnicity|ethnic origin|hispanic|latino)\b/i],
      ['race',/\b(race|racial identity)\b/i],
      ['workAuthorization',/\b(authorized|authorization|legally eligible)\b.{0,90}\b(work|employment)\b/i],
      ['citizenship',/\b(citizenship status|u\.?s\.? citizen)\b/i],
      ['sponsorship',/\b(visa sponsorship|require.*sponsorship)\b/i],
      ['fullName',/\b(full name|legal name|candidate name|applicant name|your name)\b/i]
    ];
    const fromRules=rule.find(([,re])=>re.test(label))?.[0];
    if(fromRules)return fromRules;
    // Different wording, same question: let the model infer it (only when confident).
    const understood=classifyLabel(label);
    return understood?.confident && understood.key ? understood.key : null;
  }
  function optionalIgnoreKey(el,label,context={}) {
    const normalized=normalize(label);
    if(!normalized || normalized.length<8 || isChoiceCaption(normalized) || /^(?:unrecognized choice question|question on application)/.test(normalized))return '';
    // Address 2 is semantically the same across apartment/unit/second-line labels.
    if(/\b(?:address|street)\s*(?:line\s*)?(?:2|two|second)\b|\b(?:apartment|apt|suite|unit)\b/i.test(label))return 'field:addressLine2';
    return 'question:'+(context.domain && context.domain!=='general'?context.domain+':':'')+normalized;
  }
  // ATS frameworks render dropdowns as popovers, menus, virtualized listboxes,
  // and ordinary divs. These are strictly *visible* choice surfaces, never form
  // navigation controls, so the extension cannot accidentally click Next/Submit.
  const customChoiceSelector = [
    '[role="option"]','[role="menuitemradio"]','[role="listbox"] > li',
    '[role="listbox"] > div','[data-value]:not(input):not(select)',
    '.dropdown-menu li','.dropdown-menu [tabindex]',
    '[class*="dropdown-item"]','[class*="dropdownItem"]',
    '[class*="select__option"]','[class*="select-option"]',
    '[class*="Select-option"]','[class*="autocomplete-option"]',
    '[class*="listbox-option"]','[class*="listboxOption"]',
    '.MuiMenuItem-root','.ant-select-item-option','.p-dropdown-item',
    '.k-list-item','.cdk-option','mat-option','[data-testid*="option"]'
  ].join(',');
  function customChoiceLabel(element) {
    return clean(element.getAttribute('aria-label') || element.getAttribute('data-label') ||
      element.getAttribute('title') || element.textContent || element.getAttribute('data-value') || '');
  }
  function visibleCustomChoices(root=document) {
    return [...root.querySelectorAll(customChoiceSelector)]
      .filter(element => visible(element) && !element.disabled && element.getAttribute('aria-disabled')!=='true')
      .filter(element => !element.closest('nav,header,footer,[role="navigation"]'))
      .filter(element => {
        const label=customChoiceLabel(element);
        return label.length>0 && label.length<=140 && !placeholderChoice(label);
      })
      .filter(element => !element.querySelector(`${customChoiceSelector}`));
  }
  function pickerTrigger(el) {
    if(isPicker(el))return el;
    return el.closest('[role="combobox"],[aria-haspopup="listbox"],[aria-haspopup="menu"]') ||
      el.parentElement?.querySelector(':scope > button[aria-haspopup],:scope > [role="combobox"],:scope > [class*="dropdown-toggle"]') ||
      el;
  }
  // Some widgets react to pointer/mouse events rather than the bare click event.
  function fireClick(node) {
    const base={bubbles:true,cancelable:true,view:window,button:0};
    for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      const Ctor=type.startsWith('pointer') && typeof PointerEvent==='function' ? PointerEvent : MouseEvent;
      node.dispatchEvent(new Ctor(type,{...base,pointerType:'mouse',isPrimary:true}));
    }
  }
  function pressKey(node,key) {
    for(const type of ['keydown','keyup'])node.dispatchEvent(new KeyboardEvent(type,{key,bubbles:true,cancelable:true}));
  }
  // Only the options that belong to THIS control: its aria-controls/owns list, else menus that
  // appeared after it was opened. Never a stale menu belonging to another field.
  function scopedChoices(el, before) {
    const trigger=pickerTrigger(el);
    for(const id of [el.getAttribute('aria-controls'),el.getAttribute('aria-owns'),trigger.getAttribute('aria-controls'),trigger.getAttribute('aria-owns')].filter(Boolean)) {
      const root=document.getElementById(id);
      const found=root ? visibleCustomChoices(root) : [];
      if(found.length)return found;
    }
    const all=visibleCustomChoices(),fresh=all.filter(choice=>!before.has(choice));
    return fresh.length ? fresh : all;
  }
  async function openPicker(el, search = '') {
    const trigger=pickerTrigger(el);
    if(el.matches('input:not([type="hidden"])') && !el.readOnly && search){
      el.focus();setValue(el,search);
    }
    if(trigger !== el || !el.matches('input') || el.readOnly || !search)trigger.click();
    await wait(170);
  }
  function customCurrentValue(el) {
    const node=pickerTrigger(el);
    const values=[el.getAttribute('aria-valuetext'),el.matches('input')?el.value:null,
      node.getAttribute('aria-valuetext'),node.matches('input')?node.value:null,
      node.textContent,el.textContent];
    return values.map(clean).find(value=>value && !placeholderChoice(value))||'';
  }
  async function currentPickerOptions(el) {
    if(el.tagName==='SELECT')return [...el.options].filter(o=>!o.disabled&&!placeholderChoice(o.textContent))
      .map(o=>({value:o.value,label:clean(o.textContent)}));
    await openPicker(el);
    for(let i=0;i<5;i++) {
      const choices=visibleCustomChoices();
      if(choices.length) return [...new Map(choices.slice(0,300).map(option=>{
        const label=customChoiceLabel(option);return [norm(label),{value:label,label}];
      })).values()];
      await wait(150);
    }
    return [];
  }
  // A virtualized ATS picker may render only 4-10 choices at a time. Looking
  // at the first batch repeatedly cannot ever reach a country near the end of
  // the alphabet. Scroll the *open picker*, not the application page.
  function scrollOpenPicker(choices,previousOffset=-1) {
    const scrollables=[];
    const seen=new Set();
    const candidates=[...choices,...document.querySelectorAll(
      '[role="listbox"],[role="menu"],.dropdown-menu,[class*="dropdown-menu"],[class*="listbox"],.virtual-menu')];
    for(const element of candidates){
      let node=element;
      for(let depth=0;node && depth<6 && node!==document.body;depth++,node=node.parentElement){
        if(seen.has(node))continue;
        seen.add(node);
        if(!visible(node) || node.scrollHeight<=node.clientHeight+3 || node.clientHeight<25)continue;
        const style=getComputedStyle(node);
        // CSS auto/scroll is ideal, but some libraries scroll using JS while
        // hiding the scrollbar, so scrollHeight is the primary evidence.
        if(style.overflowY==='hidden' && node.getAttribute('role')!=='listbox')continue;
        scrollables.push(node);
      }
    }
    const menu=scrollables.find(node=>choices.some(choice=>node.contains(choice))) || scrollables[0];
    if(!menu)return {advanced:false,offset:previousOffset};
    const before=menu.scrollTop;
    menu.scrollTop=Math.min(menu.scrollHeight-menu.clientHeight, before+Math.max(48,Math.floor(menu.clientHeight*0.83)));
    if(menu.scrollTop===before)return {advanced:false,offset:before};
    menu.dispatchEvent(new Event('scroll',{bubbles:true}));
    return {advanced:true,offset:menu.scrollTop};
  }
  async function selectCustom(el,value,key) {
    if (el.tagName === 'SELECT') return setNamedAnswer(el,value,key);
    const trigger=pickerTrigger(el);
    const typeahead=isPicker(el) || el.getAttribute('aria-autocomplete') ||
      el.getAttribute('aria-controls') || el.getAttribute('list') || el.readOnly || trigger !== el ||
      el.closest('[class*="select"],[class*="autocomplete"],[class*="dropdown"]');
    if (!typeahead) return key === 'university' ? setValue(el,value) : false;
    const search=key==='university'?value.replace(/^St\.?(?=\s)/i,'Saint'):value;
    const before=new Set(visibleCustomChoices());
    if(before.size)pressKey(document.activeElement||document.body,'Escape');
    await openPicker(el,search);
    // Escalate how the picker is opened until options appear: click, full pointer sequence, keyboard.
    if(!scopedChoices(el,before).length){fireClick(trigger);await wait(200);}
    if(!scopedChoices(el,before).length){trigger.focus?.();pressKey(trigger,'ArrowDown');await wait(200);}
    const mayNeedScroll=['country','state','citizenshipCountry','university'].includes(key);
    const attempts=mayNeedScroll?155:12;
    let expectText='';
    const accepted=()=>valueAccepted(el,key,value) || selectionMatch(clean(el.getAttribute('aria-label')||''),value,key) ||
      (!!expectText && norm(displayedValue(el))===norm(expectText));
    for(let attempt=0;attempt<attempts;attempt++){
      const choices=scopedChoices(el,before);
      let match=choices.find(option=>selectionMatch(customChoiceLabel(option),value,key) ||
        selectionMatch(option.getAttribute('data-value')||'',value,key));
      // Short lists (Yes/No, EEO wording): choose by meaning, e.g. "No" -> "I am not a protected veteran".
      if(!match && Model && choices.length>1 && choices.length<=15 && !mayNeedScroll) {
        const pick=Model.pickOption(key,value,choices.map(customChoiceLabel));
        if(pick.index>=0 && pick.confidence>=0.8){match=choices[pick.index];expectText=pick.text;}
      }
      if(match){
        match.scrollIntoView?.({block:'nearest'});
        match.click();
        await wait(120);
        if(accepted())return true;
        fireClick(match);
        await wait(160);
        if(accepted())return true;
      }
      if(mayNeedScroll && choices.length){
        const progress=scrollOpenPicker(choices);
        if(progress.advanced){await wait(45);continue;}
      }
      // Once a picker cannot scroll any farther, give up quickly rather than
      // repeatedly reopening or pretending a value was selected.
      if(attempt>=(key==='state'?20:11))break;
      await wait(150);
    }
    // Last resort: type-ahead on the focused control, then Enter (works for listboxes that ignore clicks).
    trigger.focus?.();
    for(const ch of search) {
      for(const type of ['keydown','keypress','keyup'])trigger.dispatchEvent(new KeyboardEvent(type,{key:ch,bubbles:true,cancelable:true}));
      await wait(15);
    }
    await wait(180);pressKey(trigger,'Enter');await wait(260);
    if(accepted())return true;
    // Close an unused menu so it cannot leak options into the next field.
    pressKey(trigger,'Escape');
    if(el.matches('input') && !el.readOnly && !accepted() && !PROFILE_KEYS.has(key))
      setValue(el,'');
    return false;
  }
  function foreignCitizenshipAnswer(label, facts, settings) {
    const q=clean(label),n=norm(q);
    // Different statuses: never infer residency, ancestry, domicile, place of birth,
    // passport eligibility, clearance or export-control eligibility from citizenship.
    if(!/\b(citizen|citizenship)\b/i.test(q) ||
       /\b(residen|reside|live|born|birth|ancestr|ethnic|descent|national origin|visa|clearance|itar|export|passport|ever been|previously|former|dual citizenship eligible)\b/i.test(q))return null;
    if(/\b(?:not|never|without)\b.{0,35}\b(?:citizen|citizenship)\b/i.test(q) ||
       /\b(?:select all|check all|indicate which|list all|which of the following)\b/i.test(q))return null;
    const list=Array.isArray(facts.citizenships)?facts.citizenships:[];
    const codes=new Set(list.map(c=>ApplicationFillerCountries.find(c)?.code).filter(Boolean));
    const complete=facts.citizenshipsComplete===true;
    const nonUS=[...codes].filter(c=>c!=='US');
    const foreignScope=/\b(?:outside|other than|besides|apart from|in addition to|except|non[ -]?u\.?s\.?|foreign|another|any other)\b/i.test(q)
      && /\b(?:country|countries|citizenship|citizen)\b/i.test(q)
      && /\b(?:us|u\.?s\.?|united states|america|foreign|another|other|outside)\b/i.test(q);
    // Yes requires actual saved citizenship; No requires a complete, confirmed list and opt-in.
    if(foreignScope) {
      if(nonUS.length)return {key:'foreignCitizenship',value:'Yes'};
      if(complete && settings.rejectForeignSpyRagebait)return {key:'foreignCitizenship',value:'No'};
      return {key:'foreignCitizenship',review:true};
    }
    const mentioned=ApplicationFillerCountries.namesIn(q).filter(c=>c.code!=='US');
    // Avoid misreading complex multi-country questions as if they ask just one question.
    if(!mentioned.length)return null;
    if(/\b(?:both|all|each)\b/i.test(q))return {key:'foreignCitizenship',review:true};
    if(mentioned.some(c=>codes.has(c.code))) {
      if(mentioned.length===1)return {key:'foreignCitizenship',value:'Yes'};
      return {key:'foreignCitizenship',review:true};
    }
    if(complete && settings.rejectForeignSpyRagebait)return {key:'foreignCitizenship',value:'No'};
    return {key:'foreignCitizenship',review:true};
  }
  async function matchSectionFact(el,context,facts) {
    const {domain,canonical,recordIndex}=context;
    if(!canonical || recordIndex<0)return null;
    const records=(domain==='education'?facts.educationRecords:facts.employmentRecords)||[];
    const record=records[recordIndex];
    if(!record)return null;
    // Start and end dates must never be borrowed from a different education or job.
    const value=clean(record[canonical]);
    if(!value)return {filled:false,missing:true,key:canonical};
    if(el.type==='date' && !/^\d{4}-\d{2}-\d{2}$/.test(value))return {filled:false,review:true,key:canonical};
    return {filled:canonical==='school' ? await selectCustom(el,value,'university') : setNamedAnswer(el,value,canonical),key:canonical};
  }
  const ADDRESS_KEYS=['city','state','zip','country','addressLine1','addressLine2'];
  const PROFILE_KEYS=new Set([...ADDRESS_KEYS,'firstName','lastName','fullName','email','phone','linkedin','github','portfolio','dob']);
  const STRICT_KEYS=new Set([...ADDRESS_KEYS,'firstName','lastName','fullName','email']);
  // A plain text input for city/zip/etc. is never a dropdown, even inside a wrapper whose CSS class says "select".
  function isPickerControl(el,key) {
    if(isPicker(el)||el.getAttribute('aria-autocomplete')||el.getAttribute('aria-haspopup')||el.readOnly)return true;
    if(PROFILE_KEYS.has(key) && !['country','state'].includes(key))return false;
    return !!el.closest('[class*="dropdown"],[class*="select"]');
  }
  function displayedValue(el) {
    if(el.tagName==='SELECT'){const o=el.selectedOptions?.[0];return o?clean(o.textContent):'';}
    if(el.matches('input,textarea'))return clean(el.value);
    return customCurrentValue(el)||clean(el.getAttribute('aria-valuetext'))||'';
  }
  // The only definition of "success": what the control actually shows afterwards.
  function valueAccepted(el,key,expected) {
    const shown=displayedValue(el);
    if(!shown||placeholderChoice(shown))return false;
    if(norm(shown)===norm(expected)||selectionMatch(shown,expected,key))return true;
    if(key==='zip' && norm(shown).startsWith(norm(expected)))return true;
    if(isPicker(el) && !el.matches('input')) {
      const e=norm(expected);
      return !!e && (' '+norm(shown)+' ').includes(' '+e+' ') && norm(shown).length<=e.length+30;
    }
    return false;
  }
  async function matchKnown(el,label,facts,settings,context={}) {
    if(context.canonical && ['education','employment'].includes(context.domain)){
      const sectionMatch=await matchSectionFact(el,context,facts);
      if(sectionMatch)return sectionMatch;
      // Backward-compatible flat facts are used only if there are NO structured
      // school records. Never borrow school 1's dates for school 2.
      if(context.domain==='education' && !(facts.educationRecords||[]).length){
        const alias={school:'university',degree:'degree',graduation:'graduation',gpa:'gpa'}[context.canonical];
        const flat=alias && clean(facts[alias]);
        if(flat)return {key:context.canonical,filled:alias==='university' ? await selectCustom(el,flat,'university') : setNamedAnswer(el,flat,alias)};
      }
      return {key:context.canonical,filled:false,missing:true};
    }
    const foreign=foreignCitizenshipAnswer(label,facts,settings);
    if(foreign) {
      if(!foreign.value)return {key:foreign.key,filled:false,review:true};
      const kind=el.type==='radio'||el.getAttribute('role')==='radio'||el.hasAttribute('aria-pressed')||el.tagName==='SELECT';
      return {key:foreign.key,filled:kind && setNamedAnswer(el,foreign.value,foreign.key),review:!kind};
    }

    const key=knownKey(el,label);
    // Address-country lookup is not a response to a residency/nationality question.
    if(key==='country' && /\b(?:are you|do you|have you|residen|citizen|nationality|national origin)\b/i.test(label))return null;
    if(!key) return null;
    if (['veteranStatus','disabilityStatus','gender','race','ethnicity'].includes(key) && !settings.useDemographics) return null;
    let value = factsFor(key,facts);
    if(!value) return {key,filled:false,missing:true};
    const understood=classifyLabel(label);
    if(understood?.confident && understood.key===key && Model) {
      const answer=Model.answerFor(understood.id,facts);
      if(answer.ask) return {key,filled:false,review:true,understanding:understood};
      value=answer.value||value;
    }
    if (['veteranStatus','disabilityStatus'].includes(key) && norm(value)==='yes') {
      // Only a plain Yes/No control may be answered Yes; legal-classification wording needs the applicant.
      const plainYes=(el.tagName==='SELECT'||el.type==='radio'||el.getAttribute('role')==='radio'||el.hasAttribute('aria-pressed')) &&
        (el.tagName==='SELECT'?[...el.options].map(o=>clean(o.textContent)):siblingsFor(el).map(optionLabel)).some(t=>norm(t)==='yes');
      if(!plainYes)return {key,filled:false,review:true};
    }
    const choiceControl = el.matches('[role="radio"],button[aria-pressed]') || el.type === 'radio' || el.tagName === 'SELECT';
    if(key==='citizenshipCountry') {
      // If the applicant holds multiple citizenships, a single-select field
      // requires review instead of choosing one arbitrarily.
      if(Array.isArray(facts.citizenships) && facts.citizenships.filter(Boolean).length!==1)return {key,review:true,filled:false};
      if(el.tagName==='SELECT')return {key,filled:setNamedAnswer(el,value,'country'),missing:false};
      return {key,filled:await selectCustom(el,value,'country'),missing:false};
    }
    if (key === 'university') return {key,filled:await selectCustom(el,value,key),missing:false};
    if (isPickerControl(el,key))
      return {key,filled:await selectCustom(el,value,key),missing:false};
    if (choiceControl) return {key,filled:setNamedAnswer(el,value,key),missing:false};
    if (['citizenship','workAuthorization','sponsorship','essentialFunctions','veteranStatus','disabilityStatus','gender','race','ethnicity'].includes(key)) return {key,filled:false,review:true};
    return {key,filled:setValue(el,value),missing:false};
  }
  const nextButton = () => [...document.querySelectorAll('button,input[type="button"],input[type="submit"]')]
    .filter(el=>visible(el))
    // Intermediate Next buttons can have type=submit in real ATS forms.
    // Match *only* explicit navigation text; never click a final Submit button.
    .find(b=>/^(next|continue|next step|save and continue|review application|proceed|review)$/i
      .test(clean(b.textContent || b.value)));
  function pageControls() {
    const buttons=[...document.querySelectorAll('button,input[type="button"],input[type="submit"]')].filter(el=>visible(el));
    const next=nextButton();
    const final=!next && buttons.some(b=>/^(submit( application)?|send application|complete application|finish application|apply now)$/i.test(clean(b.textContent||b.value)));
    return {final,next:!!next};
  }
  function pageIdentity() {
    // Input ids/names can change during a React rerender. The same visible page
    // should retain its skip token, but a different set of questions should not.
    const step=clean(document.querySelector('[data-step]')?.getAttribute('data-step')||'');
    const questions=[...new Set(controls().map(el=>
      (el.type==='radio'||el.getAttribute('role')==='radio'?'radio':el.type||el.tagName)+':'+normalize(inputLabel(el))))];
    return location.pathname+'|'+step+'|'+questions.join('|');
  }
  function scanPage() {
    const fields=controls();
    const inputs=fields.filter(el=>el.type!=='file');
    const labelled=inputs.map(el=>{const label=inputLabel(el);return {el,label,key:knownKey(el,label)};});
    const signals=labelled.filter(x=>x.key).length;
    const lockedInputs=[...document.querySelectorAll(inputSelector)]
      .filter(el=>el.disabled && visible(el,true) && !el.closest('nav,header,footer,[role="navigation"]'))
      .filter(el=>el.matches('input:not([type="hidden"]),select,textarea'));
    const cues=/\b(application|applicant|resume|candidate|education|work experience|upload resume)\b/i.test(document.title+' '+document.body?.innerText?.slice(0,3500));
    let detected=(fields.length>=2 && (!!document.querySelector('form') || signals>0 || cues)) ||
      (fields.length>=1 && signals>0 && cues) || (fields.length>0 && pageControls().final) ||
      (fields.length>=1 && lockedInputs.length>=1 && !!document.querySelector('form') && cues);
    // Form model: positive evidence can detect a job application; payment/login pages veto it.
    let formModel=null;
    if(Model) {
      const bodyText=(document.body?.innerText||'').slice(0,6000);
      const features={fields:fields.length,
        knownIntents:new Set(labelled.map(x=>x.key||classifyLabel(x.label)?.id||'').filter(Boolean)).size,
        hasResumeUpload:[...document.querySelectorAll('input[type="file"]')].some(f=>/resume|curriculum|\bcv\b/i.test(inputLabel(f)+' '+(f.name||'')+' '+(f.id||''))),
        eeoTerms:new Set(bodyText.toLowerCase().match(/\b(veteran|disability|gender|race|ethnicity|equal opportunity|eeo)\b/g)||[]).size,
        titleCue:/\b(apply|application|careers?|jobs?|candidate|applicant|requisition)\b/i.test(document.title+' '+(document.querySelector('h1,h2')?.textContent||'')+' '+location.pathname),
        applyButton:[...document.querySelectorAll('button,input[type="button"],input[type="submit"]')].filter(b=>visible(b))
          .some(b=>/^(submit( application)?|apply( now)?|send application|review application)$/i.test(clean(b.textContent||b.value))),
        hasPassword:!!document.querySelector('input[type="password"]') &&
          [...document.querySelectorAll('input[type="password"]')].some(i=>visible(i,true)),
        hasPayment:inputs.some(el=>/cc-number|card number|\bcvv\b|\bcvc\b|credit card/i.test(
          (el.getAttribute('autocomplete')||'')+' '+inputLabel(el)+' '+(el.name||'')))};
      formModel=Model.scoreForm(features);
      detected=(detected || formModel.p>=0.75) && !formModel.hardNegative;
    }
    return {detected,visibleFields:fields.length,disabledFields:lockedInputs.length,matched:signals,
      score:signals*4+Math.min(fields.length,35)+(cues?3:0)+(formModel?Math.round(formModel.p*6):0),
      formModel:formModel?{probability:Math.round(formModel.p*100)/100,reasons:formModel.reasons}:null};
  }
  function savedAddressConflict(el, facts) {
    const label=inputLabel(el),key=knownKey(el,label);
    if(!['city','state','zip','country','addressLine1','addressLine2'].includes(key))return null;
    const expected=factsFor(key,facts);
    if(!expected)return null;
    const actual=el.tagName==='SELECT' ? clean(el.selectedOptions?.[0]?.textContent || el.value) :
      clean(el.getAttribute('aria-valuetext') || el.value || el.textContent);
    if(!actual || placeholderChoice(actual))return null;
    if(selectionMatch(actual,expected,key) || norm(actual)===norm(expected))return null;
    return {key,expected,actual,label};
  }
  // The site's own option list, so the popup can show the real wording instead of a free-text box.
  async function harvestOptions(el) {
    if(el.tagName==='SELECT')return [];
    const trigger=pickerTrigger(el),before=new Set(visibleCustomChoices());
    try {
      await openPicker(el,'');
      if(!scopedChoices(el,before).length){fireClick(trigger);await wait(200);}
      if(!scopedChoices(el,before).length){trigger.focus?.();pressKey(trigger,'ArrowDown');await wait(200);}
      const seen=new Map();
      for(let i=0;i<160 && seen.size<400;i++) {
        const choices=scopedChoices(el,before);
        if(!choices.length)break;
        for(const choice of choices){const label=customChoiceLabel(choice);if(label && !seen.has(norm(label)))seen.set(norm(label),{value:label,label});}
        if(!scrollOpenPicker(choices).advanced)break;
        await wait(40);
      }
      return [...seen.values()];
    } finally {pressKey(trigger,'Escape');await wait(60);}
  }
  function headingAbove(el) {
    const box=el.getBoundingClientRect();
    let heading='',best=-Infinity;
    for(const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role="heading"]')) {
      if(h.contains(el) || !h.getClientRects().length)continue;
      const r=h.getBoundingClientRect();
      if(r.bottom<=box.top+2 && r.bottom>best){best=r.bottom;heading=clean(h.textContent);}
    }
    return heading.slice(0,90);
  }
  function textLinesAbove(el,count=3) {
    const box=el.getBoundingClientRect(),root=el.closest('form,main,[role="main"]')||document.body,found=[];
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    for(let n=walker.nextNode();n;n=walker.nextNode()) {
      if(!textNodeShown(n,el) || !clean(n.textContent))continue;
      const rect=n.parentElement.getBoundingClientRect(),gap=box.top-rect.bottom;
      if(gap>=-3 && gap<=220)found.push({gap,text:clean(n.textContent).slice(0,120)});
    }
    return found.sort((a,b)=>a.gap-b.gap).slice(0,count).map(x=>x.text);
  }
  async function processPage(message) {
    const {facts={},answers={},answerMeta={},settings={},roleId='',listingKey='',seenOptional=[],suppressOptional=false,ignoredQuestions=[],learnedIntents={}}=message;
    modelLearned=learnedIntents||{};
    facts.roleId=roleId;
    const known=[],pending=[],visited=new Set(),processed=new WeakSet(),entries=[],skippedAmbiguous=[];
    const acknowledged=new Set(Array.isArray(seenOptional)?seenOptional:[]);
    const ignored=new Set(Array.isArray(ignoredQuestions)?ignoredQuestions.map(r=>r.key):[]);
    const isPending=el=>pending.some(item=>item.id===el.dataset.applicationFillerId);
    // Never silently skip a required field. An optional question can be
    // reviewed once, then acknowledged without supplying an answer.
    function queue(el,kind,label,required,suggestion='',context={}) {
      const sharedKey=context.memoryKey ? '' : intentMemoryKey(label,context,roleId);
      if(sharedKey)context={...context,memoryKey:sharedKey};
      if(!required && (suppressOptional || acknowledged.has(fieldKey(el)) || acknowledged.has(stableOptionalKey(el)) ||
        ignored.has(optionalIgnoreKey(el,label,context))))return;
      // A bare "Year"/"Month"/"Day" the applicant cannot place in a question is not worth interrupting for.
      if(!required && /^(year|month|day|date)$/.test(normalize(label)) && !context.canonical) {
        skippedAmbiguous.push({label:clean(label),where:headingAbove(el)});return;
      }
      if(isPending(el) || ((el.type==='radio'||el.getAttribute('role')==='radio'||el.hasAttribute('aria-pressed')) && siblingsFor(el).some(isPending)))return;
      pending.push(manualItem(el,kind,label,roleId,required,suggestion,context));
    }
    // A success is only counted after the control is re-read at the end of the page pass.
    const markKnown=(el,key,label)=>entries.push({el,key,label,sig:fieldKey(el),
      expected:STRICT_KEYS.has(key)?factsFor(key,facts):''});
    let sawDependency=false;
    for(let pass=0;pass<4;pass++) {
      const fields=controls().filter(el=>!processed.has(el)).map(el=>({el,label:inputLabel(el)}));
      if(!fields.length)break;
      sawDependency=false;
      for(const {el:original,label:originalLabel} of fields) {
        processed.add(original);
        // Country selection often reconstructs the dependent state/province
        // control in React/Angular forms. Don't interact with a detached node.
        const el=original.isConnected ? original : controls().find(candidate=>
          candidate.tagName===original.tagName && normalize(inputLabel(candidate))===normalize(originalLabel));
        if(!el)continue;
        processed.add(el);
        if(el.type==='radio'||el.getAttribute('role')==='radio'||el.hasAttribute('aria-pressed')) {
          const container=group(el);const groupId=el.name||container?.id||inputLabel(el);
          if(visited.has('radio:'+groupId))continue;visited.add('radio:'+groupId);
          if(siblingsFor(el).some(isFilled))continue;
        } else if(isFilled(el)) {
          // A stale or incorrect value is not a successful autofill. Do not
          // silently overwrite it either: the applicant must approve repairs.
          const conflict=savedAddressConflict(el,facts);
          if(conflict) {
            const context=questionContext(el,conflict.label,facts);
            const item=manualItem(el,'conflict',conflict.label,roleId,true,conflict.expected,context);
            item.canonicalField=conflict.key;
            item.category='personal';
            item.message=`This field currently shows “${conflict.actual}”, but your saved profile says “${conflict.expected}”. Confirm the correction before continuing.`;
            pending.push(item);
          }
          continue;
        }
        const label=inputLabel(el),context=questionContext(el,label,facts),required=isRequired(el,label);
        // A permanent skip is a deliberate instruction not to fill that optional
        // question, even if a previously learned answer happens to exist.
        if(!required && ignored.has(optionalIgnoreKey(el,label,context)))continue;
        if (isAgreement(el,label)) {
          // Never auto-select a radio attestation or a statement claiming the
          // applicant read/understood/certified something they may not have.
          if(el.type==='checkbox' && settings.routineAgreements && !criticalAgreement(label)) {
            (el.labels?.[0]||el).click();markKnown(el,'agreement',label);continue;
          }
          queue(el,'agreement',label,required,'',context);continue;
        }
        if(el.type==='checkbox') {queue(el,'agreement',label,required,'',context);continue;}
        if(el.type==='file') {
          if(/\b(resume|curriculum vitae|\bcv\b)\b/i.test(label)||/resume|cv/i.test(el.name||'')) queue(el,'resume',label,required,'',context);
          else queue(el,'file',label,required,'',context);
          // Never treat an upload input as an ordinary text question.
          continue;
        }
        if(isExperience(label)&&!facts.experience){queue(el,'missingFact',label,required,required?'N/A':'',context);continue;}
        if(/\b(desired|expected|salary expectations|salary requirement|compensation expectations|salary range)\b/i.test(label)&&/\b(salary|compensation|pay|annual)\b/i.test(label)) {
          queue(el,'salary',label,required,'',context);continue;
        }
        const labelKey=knownKey(el,label)||'';
        if(settings.autoFill) {
          const result=await matchKnown(el,label,facts,settings,context);
          if(result?.filled){
            markKnown(el,result.key,label);
            // State/province choices load or rerender after selecting country.
            if(result.key==='country'){sawDependency=true;await wait(250);}
            continue;
          }
          if(result?.review){queue(el,required?'unknown':'optional',label,required,'',context);continue;}
          if(result?.missing && !required && !context.memoryKey){queue(el,'optional',label,false,'',context);continue;}
        }
        const memoryKey=context.memoryKey || intentMemoryKey(label,context,roleId) || (context.canonical && ['education','employment'].includes(context.domain)?roleId+'|ctx:'+context.domain+':unassigned:'+context.canonical:roleId+'|'+normalize(label));
        const contextSpecific=/\b(why|interested|motivat|company|organization)\b/i.test(label);
        const unsafeGeneric=context.domain==='general' && /^(?:start date|end date|company|school|date)$/i.test(normalize(label));
        // Profile facts (name, city, zip...) are never overwritten from learned answers, and a
        // label with no real words can never match a learned answer.
        const neverAuto=!!intentInfo(classifyLabel(label)?.id)?.neverAuto;
        const mayUseLearned=!neverAuto && !!normalize(label) && (!PROFILE_KEYS.has(labelKey) || !factsFor(labelKey,facts));
        const saved=!mayUseLearned ? null : (contextSpecific?answers[memoryKey+'|listing:'+listingKey]:null)||
          (unsafeGeneric ? answers[memoryKey+'|listing:'+listingKey] :
           context.canonical && !context.entityId ? answers[memoryKey+'|listing:'+listingKey] : answers[memoryKey]);
        // Answers saved before question meanings existed are keyed by exact wording; keep honouring them.
        const savedAnswer=saved || (mayUseLearned && memoryKey.includes('|intent:') ? answers[roleId+'|'+normalize(label)] : null);
        if(settings.autoFill&&savedAnswer&&!answerMeta[memoryKey]?.conflict&&
          setNamedAnswer(el,savedAnswer,labelKey||context.canonical||'')){markKnown(el,'',label);continue;}
        // Preserve the saved answer as an editable suggestion if a custom site
        // dropdown could not accept it automatically.
        const candidate=labelKey && (ADDRESS_KEYS.includes(labelKey)||labelKey==='citizenshipCountry') ? factsFor(labelKey,facts) : '';
        const reviewKind=isAIQuestion(el,label)?'ai':required?'unknown':'optional';
        queue(el,reviewKind,label,required,candidate,context);
      }
      if(!sawDependency)break;
      // Wait for a dependent control (State after Country) to appear or become enabled.
      const started=Date.now();
      while(Date.now()-started<3000) {
        await wait(200);
        if(controls().some(el=>!processed.has(el)))break;
      }
    }
    await wait(150);
    // Verification: re-read every control we claim to have filled.
    const trace=[];
    for(const entry of entries) {
      const live=entry.el.isConnected ? entry.el : controls().find(c=>c.tagName===entry.el.tagName &&
        normalize(inputLabel(c))===normalize(entry.label));
      const ok=!!live && (entry.expected ? valueAccepted(live,entry.key,entry.expected)
        : (live.type==='radio'||live.getAttribute('role')==='radio'||live.hasAttribute('aria-pressed') ? siblingsFor(live).some(isFilled) : isFilled(live)));
      trace.push({label:clean(entry.label).slice(0,70),key:entry.key,verified:ok});
      if(ok){known.push(entry.sig);continue;}
      if(!live)continue;
      const shown=displayedValue(live);
      const item=manualItem(live,shown&&!placeholderChoice(shown)?'conflict':'unknown',entry.label,roleId,true,entry.expected,
        questionContext(live,entry.label,facts));
      item.canonicalField=entry.key;item.category='personal';
      item.message=`The website did not accept your saved ${entry.key||'answer'}. Choose or enter it on the page, then press Continue.`;
      if(!isPending(live))pending.push(item);
    }
    // Sweep, independent of what was attempted: any required control that is still empty
    // (including disabled ones) blocks the run. Success counters are not proof.
    const seenGroups=new Set();
    for(const el of [...controls(),...disabledControls()]) {
      if(el.type==='file'||el.type==='checkbox'||isPending(el))continue;
      const label=inputLabel(el);
      if(!isRequired(el,label))continue;
      const isRadio=el.type==='radio'||el.getAttribute('role')==='radio'||el.hasAttribute('aria-pressed');
      if(isRadio && siblingsFor(el).some(isPending))continue;
      if(isRadio){const id='r:'+(el.name||group(el)?.id||label);if(seenGroups.has(id))continue;seenGroups.add(id);}
      if(isRadio ? siblingsFor(el).some(isFilled) : isFilled(el))continue;
      const item=manualItem(el,'unknown',label,roleId,true,'',questionContext(el,label,facts));
      if(isDisabledEl(el))item.message='This required field is disabled until another field is completed (for example Country). Complete that first, then press Continue.';
      pending.push(item);
    }
    // Show the website's own choices (and the site's wording for the saved value) in the popup.
    let harvested=0;
    for(const item of pending.filter(x=>x.required).concat(pending.filter(x=>!x.required))) {
      if(harvested>=6)break;
      if(item.type!=='select' || item.options.length || ['agreement','resume','file'].includes(item.kind))continue;
      const el=elementWithId(item.id);
      if(!el || !isPicker(el) || isDisabledEl(el))continue;
      harvested++;
      item.options=await harvestOptions(el);
      if(item.suggestion) {
        const match=item.options.find(o=>norm(o.label)===norm(item.suggestion)||selectionMatch(o.label,item.suggestion,item.profileKey));
        if(match)item.suggestion=match.label;
      }
    }
    for(const item of pending){const el=elementWithId(item.id);if(el)item.where=headingAbove(el);}
    for(const item of pending)trace.push({label:clean(item.label).slice(0,70),kind:item.kind,required:item.required,message:item.message||''});
    for(const item of skippedAmbiguous)trace.push({label:item.label,kind:'skipped-ambiguous-optional',where:item.where});
    // Prioritize genuinely required questions before first-time optional prompts.
    pending.sort((a,b)=>Number(b.required)-Number(a.required) ||
      Number(b.kind==='agreement')-Number(a.kind==='agreement'));
    const nav=pageControls(),detector=scanPage();
    return {jobTitle:clean(document.querySelector('h1')?.textContent||document.title),detected:detector.detected,
      known,pending,trace,next:nav.next,final:nav.final,identity:pageIdentity(),
      visibleFields:detector.visibleFields,disabledFields:detector.disabledFields};
  }
  // Privacy-safe diagnostics: labels, structure and match results; never the applicant's values.
  async function diagnose(message) {
    const facts=message.facts||{};
    const secrets=Object.values(facts).flatMap(v=>Array.isArray(v)?v:[v]).filter(v=>typeof v==='string'&&clean(v).length>=3).map(v=>clean(v));
    const redact=text=>{
      let out=String(text??'');
      for(const secret of secrets)out=out.split(secret).join('[saved-value]');
      return out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g,'[email]').replace(/\d{5,}/g,'[digits]');
    };
    const ids={};document.querySelectorAll('[id]').forEach(n=>ids[n.id]=(ids[n.id]||0)+1);
    const fields=[...new Set([...controls(),...disabledControls()])].map((el,index)=>{
      const label=inputLabel(el),key=knownKey(el,label)||null;
      const expected=key?factsFor(key,facts):'';
      const shown=displayedValue(el);
      let wrapper=el;
      for(let i=0;i<4&&wrapper.parentElement&&!wrapper.parentElement.matches('form,main,body');i++){
        wrapper=wrapper.parentElement;
        if([...wrapper.querySelectorAll(inputSelector)].length>1)break;
      }
      const copy=wrapper.cloneNode(true);
      copy.querySelectorAll('script,style,svg,[role="listbox"]').forEach(n=>n.remove());
      copy.querySelectorAll('[value]').forEach(n=>n.setAttribute('value','[value]'));
      return {index,tag:el.tagName.toLowerCase(),type:el.type||'',role:el.getAttribute('role')||'',
        id:redact(el.id).slice(0,60),name:redact(el.getAttribute('name')||'').slice(0,60),
        controlKind:describeKind(el),understanding:(()=>{const u=classifyLabel(label);return u?{intent:u.id,confidence:Math.round(u.confidence*100)/100,source:u.source}:null;})(),
        disabled:isDisabledEl(el),picker:isPicker(el),required:isRequired(el,label),filled:isFilled(el),
        label:redact(label).slice(0,100),
        labelSources:{visual:redact(visualCaption(el)).slice(0,100),geometric:redact(geometricCaption(el)).slice(0,100),
          forLabels:[...(el.labels||[])].map(l=>({text:redact(clean(l.textContent)).slice(0,60),visible:l.getClientRects().length>0})),
          ariaLabelledby:clean(el.getAttribute('aria-labelledby')).split(' ').filter(Boolean).map(id=>({id:redact(id).slice(0,40),
            duplicateId:(ids[id]||0)>1,text:redact(clean(document.getElementById(id)?.textContent)).slice(0,60),
            visible:!!document.getElementById(id)?.getClientRects().length})),
          ariaLabel:redact(el.getAttribute('aria-label')||'').slice(0,60)},
        semanticKey:key,profileHasValue:!!expected,
        displayed:shown?(placeholderChoice(shown)?'[placeholder]':'[value len='+shown.length+']'):'[empty]',
        displayedMatchesSaved:expected&&shown?valueAccepted(el,key,expected):null,
        where:redact(headingAbove(el)),linesAbove:textLinesAbove(el).map(redact),
        containerHtml:(isFilled(el)&&!isPicker(el))?'':redact(copy.outerHTML).slice(0,1800)};
    });
    const probes=[];
    if(message.probe) {
      const targets=[...controls()].filter(el=>isPicker(el) && !isFilled(el)).slice(0,3);
      for(const el of targets) {
        const trigger=pickerTrigger(el),before=new Set(visibleCustomChoices());
        const entry={label:redact(inputLabel(el)).slice(0,60),triggerHtml:redact(trigger.outerHTML).slice(0,600)};
        try {
          await openPicker(el,'');
          let how='click';
          if(!scopedChoices(el,before).length){fireClick(trigger);await wait(250);how='pointer-sequence';}
          if(!scopedChoices(el,before).length){trigger.focus?.();pressKey(trigger,'ArrowDown');await wait(250);how='keyboard';}
          const choices=scopedChoices(el,before);
          entry.openedBy=choices.length?how:'none';entry.visibleOptionCount=choices.length;
          entry.firstOptions=choices.slice(0,6).map(c=>redact(customChoiceLabel(c)).slice(0,50));
          const first=choices[0];
          if(first){
            const holder=first.closest('[role="listbox"],ul,[class*="menu"],[class*="list"]')||first.parentElement;
            const copy=holder.cloneNode(true);
            copy.querySelectorAll('[role="option"],li,[data-value]').forEach((n,i)=>{if(i>3)n.remove();});
            entry.listHtml=redact(copy.outerHTML).slice(0,1800);
            entry.optionTag=first.tagName.toLowerCase()+(first.className?'.'+String(first.className).split(' ').slice(0,3).join('.'):'');
            entry.listScrollable=holder.scrollHeight>holder.clientHeight+3;
            entry.hasSearchInput=!!holder.querySelector('input')||!!document.querySelector('[role="listbox"] input');
            entry.ariaControlsResolves=!!document.getElementById(el.getAttribute('aria-controls')||trigger.getAttribute('aria-controls')||'-');
          }
        } catch(error){entry.error=String(error.message||error).slice(0,120);}
        finally{pressKey(trigger,'Escape');await wait(80);}
        probes.push(entry);
      }
    }
    return {frame:window===window.top?'top':'subframe',host:location.hostname,formModel:scanPage().formModel,
      duplicateIds:Object.keys(ids).filter(k=>ids[k]>1).map(k=>redact(k).slice(0,40)).slice(0,30),fields,probes};
  }
  function nextPage() {
    const next=nextButton();
    if(!next || pageControls().final) return {clicked:false};
    next.click();return {clicked:true};
  }
  async function attachResume(message) {
    const target=[...document.querySelectorAll('input[type="file"]')].find(el=>/\b(resume|curriculum vitae|\bcv\b)\b/i.test(inputLabel(el))||/resume|cv/i.test(el.name||''));
    if(!target||!message.file?.base64)return {attached:false};
    try {
      const binary=atob(message.file.base64),bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      const file=new File([bytes],message.file.name,{type:message.file.mime});
      const transfer=new DataTransfer();transfer.items.add(file);target.files=transfer.files;
      target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));
      return {attached:target.files?.[0]?.name===file.name};
    }catch{return {attached:false};}
  }
  function elementWithId(id){return [...document.querySelectorAll('[data-application-filler-id]')].find(el=>el.dataset.applicationFillerId===id);}
  async function availableChoices(id) {
    const el=elementWithId(id);
    if(!el)return {error:'The field moved or disappeared. Refresh the application and retry.',options:[]};
    return {options:await currentPickerOptions(el)};
  }
  function focusPending(ids) {
    for(const id of ids||[]) {
      const el=elementWithId(id);if(!el)continue;
      const target=el.getClientRects().length?el:(el.labels?.[0]||group(el)||el);
      target.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
      if(window.parent !== window) window.parent.postMessage({type:'APPLICATIONFILLER_REVEAL_FRAME'},'*');
      target.style.outline='3px solid #e2a349';target.style.outlineOffset='4px';
      setTimeout(()=>{target.style.outline='';target.style.outlineOffset='';},4200);
      if(el.matches('input,select,textarea') && el.type!=='file' && el.type!=='radio')el.focus({preventScroll:true});
      return {focused:true,label:inputLabel(el)};
    }
    return {focused:false};
  }
  function readReplies(ids) {
    return (ids||[]).map(id=>{
      const el=elementWithId(id);
      if(!el)return {id,value:''};
      if(el.type==='radio'||el.getAttribute('role')==='radio'||el.hasAttribute('aria-pressed')) {
        const selected=siblingsFor(el).find(isFilled);
        if(!selected)return {id,value:''};
        // Native radio inputs frequently have value="on"; custom controls can
        // expose internal codes. Save the human-readable answer whenever known.
        // Always store what the applicant sees (“Yes”), never an internal option code such as 38.
        const raw=clean(selected.value), human=optionLabel(selected);
        return {id,value:human||raw};
      }
      if(el.tagName==='SELECT') {
        const selected=el.selectedIndex>=0?el.options[el.selectedIndex]:null;
        const raw=clean(el.value),human=clean(selected?.textContent);
        return {id,value:!isFilled(el)?'':(human&&!/^(select|choose|please select)(\.\.\.)?$/i.test(human)?human:raw)};
      }
      if(isPicker(el) && !el.matches('input'))
        return {id,value:isFilled(el)?displayedValue(el):''};
      return {id,value:['checkbox','file'].includes(el.type)?'':el.value||''};
    });
  }
  function checkFields(ids) {
    return (ids || []).map(id=>{
      const el=elementWithId(id);
      return {id,filled:!!el && (el.type==='radio'||el.getAttribute('role')==='radio' ? siblingsFor(el).some(isFilled) : isFilled(el))};
    });
  }
  async function applyReplies(replies,replaceIds=[]) {
    const replace=new Set(replaceIds);
    const errors=[];
    for(const answer of replies||[]) {
      const el=elementWithId(answer.id);
      if(!el){errors.push('A question moved or disappeared. Review this page.');continue;}
      if(['checkbox','file'].includes(el.type))continue;
      if(isFilled(el) && !replace.has(answer.id))continue;
      const key=knownKey(el,inputLabel(el))||'';
      const pickerLike=isPickerControl(el,key);
      const applied=pickerLike && el.tagName!=='SELECT'
        ? await selectCustom(el,answer.value,key) : setNamedAnswer(el,answer.value,key);
      if(!applied)errors.push('Could not select '+inputLabel(el)+'. Try Find choices, or select it directly on the application page and press Continue.');
    }
    return {errors};
  }
  // In an embedded application, expose the actual iframe in the outer page too.
  window.addEventListener('message',event=>{
    if(event.data?.type!=='APPLICATIONFILLER_REVEAL_FRAME')return;
    const frame=[...document.querySelectorAll('iframe')].find(iframe=>iframe.contentWindow===event.source);
    if(frame) frame.scrollIntoView({behavior:'smooth',block:'center'});
  });
  // Observe a *user* submission, never click Submit ourselves. A completion
  // record needs both a recent user action and an explicit success page.
  let submissionObserved = false;
  function successVisible() {
    const pageText=String(document.body?.innerText || '').slice(0,9000);
    const phrase=/(?:your application (?:has been|was) (?:successfully )?(?:submitted|received)|application (?:successfully )?submitted|we (?:have )?received your application|thank you for applying(?: to|!|\.|\s*$))/i;
    return phrase.test(pageText);
  }
  function checkConfirmation() {
    if (!submissionObserved || !successVisible()) return;
    browser.runtime.sendMessage({type:'AP_CONFIRMATION_SEEN'}).catch(()=>{});
  }
  // Preserve manually selected unknown answers when the user proceeds via the
  // employer's Next control. Do not watch all keystrokes or save partial drafts.
  document.addEventListener('click',event=>{
    const control=event.target?.closest?.('button,input[type="button"],input[type="submit"],[role="button"]');
    if(!control)return;
    const caption=clean(control.innerText || control.value || control.getAttribute('aria-label') || '');
    if(!/^(?:next|continue|next step|save and continue|review application|proceed|review)$/i.test(caption))return;
    const pending=[...document.querySelectorAll('[data-application-filler-id]')].map(el=>el.dataset.applicationFillerId);
    if(!pending.length)return;
    browser.runtime.sendMessage({type:'AP_REMEMBER_PAGE',replies:readReplies(pending)}).catch(()=>{});
  },true);
  document.addEventListener('click',event=>{
    const target=event.target?.closest?.('button,input[type="submit"],[role="button"]');
    if(!target)return;
    const caption=clean(target.innerText || target.value || target.getAttribute('aria-label') || '');
    const submit=/^(?:submit(?: application)?|send application|finish(?: application)?|apply now|send my application)$/i.test(caption);
    if (!submit) return;
    browser.runtime.sendMessage({type:'AP_SUBMIT_ATTEMPTED'}).then(result=>{
      if (!result?.accepted) return;
      submissionObserved=true;
      [600,1800,4000,8000].forEach(ms=>setTimeout(checkConfirmation,ms));
    }).catch(()=>{});
  },true);
  browser.runtime.onMessage.addListener(message => {
    switch(message?.type) {
      case 'AP_SCAN':return Promise.resolve(scanPage());
      case 'AP_CONFIRMATION_SCAN':return Promise.resolve({confirmed:successVisible()});
      case 'AP_PROCESS':return processPage(message);
      case 'AP_DIAGNOSE':return diagnose(message);
      case 'AP_SET_ANSWERS':return applyReplies(message.replies,message.replaceIds);
      case 'AP_GET_CHOICES':return availableChoices(message.id);
      case 'AP_RESUME':return attachResume(message);
      case 'AP_READ_ANSWERS':return Promise.resolve(readReplies(message.ids));
      case 'AP_CHECK_FIELDS':return Promise.resolve(checkFields(message.ids));
      case 'AP_NEXT':return Promise.resolve(nextPage());
      case 'AP_PAGE_ID':return Promise.resolve({identity:pageIdentity()});
      case 'AP_FOCUS_PENDING':return Promise.resolve(focusPending(message.ids));
      default:return undefined;
    }
  });
})();
