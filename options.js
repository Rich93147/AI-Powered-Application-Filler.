/* Full-page profile editor. No framework or build step required. */
(function () {
  'use strict';
  const DB = ApplicationFillerData;
  const Importer = ApplicationFillerImport;
  const $ = id => document.getElementById(id);
  const el = (tag, className, value) => {
    const node = document.createElement(tag); node.className = className || '';
    if (value !== undefined) node.textContent = String(value);
    return node;
  };
  let state, active, saveTimer, pendingExtraction = null;
  let learnedRows=[], ignoredRows=[],learnedCategory='education';
  const personalFields = [
    ['firstName','First name'],['lastName','Last name'],['email','Email','email'],
    ['phone','Phone','tel'],
    ['addressLine1','Street address / address line 1'],
    ['addressLine2','Apartment, suite, unit, or address line 2 (optional)'],
    ['city','City'],['state','State / province'],['zip','ZIP / postal code'],['country','Country','country'],
    ['linkedin','LinkedIn URL','url'],['github','GitHub URL','url'],['portfolio','Portfolio URL','url'],
    ['dob','Date of birth (optional)','date']
  ];
  const eligibilityFields = [
    ['citizenship','U.S. citizen?','choice'],['workAuthorization','Authorized to work in the U.S.?','choice'],
    ['sponsorship','Require visa sponsorship now or in the future?','choice'],
    ['veteranStatus','Are you a veteran?','choice'],
    ['disabilityStatus','Do you have a disability?','choice'],
    ['essentialFunctions','Can you perform the essential functions of the role with or without reasonable accommodation?','choice'],
    ['gender','Gender','gender'],
    ['race','Race (optional)','race'],
    ['ethnicity','Ethnicity (optional)','ethnicity']
  ];
  const collectionFields = {
    education:[['school','School / institution'],['degree','Degree'],['startDate','Start date (when enrolled)'],['graduation','Graduation / end date'],['gpa','GPA']],
    experience:[['title','Job title'],['company','Employer'],['startDate','Employment start date'],['endDate','Employment end date'],['dates','Other date details'],['details','Your contributions','textarea']],
    projects:[
      ['name','Project name'],['technologies','Technologies / tools'],
      ['details','Detailed project description','textarea']
    ]
  };
  const settingFields = [
    ['localAI','Enable local AI drafting','Use an Ollama model running on your computer; without it, written questions pause for your response.'],
    ['salaryLookup','Look up salary estimates','Offer a current BLS occupation-level wage benchmark for supported U.S. roles; confirm before applying it.'],
    ['useBrowserHistory','Check visited listing URLs','Requires optional Firefox History permission. A visit does not count as submission.']
  ];
  function feedback(msg) {
    $('global-status').textContent = msg;
    $('global-status').classList.remove('hide');
    clearTimeout(feedback.timer);
    feedback.timer = setTimeout(()=>$('global-status').classList.add('hide'), 3600);
  }
  async function save() {
    clearTimeout(saveTimer);
    $('saved-indicator').textContent = 'Saving…';
    try {
      // Profile edits must not overwrite newer history/answer changes made by the background.
      const response=await browser.runtime.sendMessage({type:'AP_SAVE_EDIT_STATE',state});
      if(response?.error)throw new Error(response.error);
      state.history=response.history || [];
      state.answers=response.answers || state.answers;
      state.answerMeta=response.answerMeta || state.answerMeta;
      state.ignoredQuestions=response.ignoredQuestions || state.ignoredQuestions;
      $('saved-indicator').textContent = 'All changes saved';
    }
    catch(error) { $('saved-indicator').textContent = 'Save failed'; feedback(error.message); }
  }
  function dirty() {
    $('saved-indicator').textContent = 'Unsaved changes';
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 350);
  }
  function field(parent, key, label, value, update, type = 'text') {
    const wrap = el('label','field');
    wrap.append(el('span','',label));
    let input;
    if (type === 'textarea') { input = el('textarea'); input.rows = key === 'details' ? 5 : 3; }
    else if(type === 'country') {
      input=el('select');
      const blank=el('option','','Select country');blank.value='';input.append(blank);
      for(const c of ApplicationFillerCountries.all){const o=el('option','',c.name);o.value=c.name;input.append(o);}
      const existing=String(value||'');const found=ApplicationFillerCountries.find(existing);
      if(existing && !found){const legacy=el('option','',existing+' (existing value)');legacy.value=existing;input.append(legacy);}
    }
    else if (['choice','gender','race','ethnicity'].includes(type)) {
      input = el('select');
      // Do not presume a demographic answer before the user chooses one.
      const options = type === 'gender'
        ? [['','Not provided'],['Male','Male'],['Female','Female'],['Prefer not to answer','Prefer not to answer']]
        : type === 'race'
        ? [['','Not provided'],['American Indian or Alaska Native','American Indian or Alaska Native'],['Asian','Asian'],['Black or African American','Black or African American'],['Native Hawaiian or Other Pacific Islander','Native Hawaiian or Other Pacific Islander'],['White','White'],['Two or more races','Two or more races'],['Prefer not to answer','Prefer not to answer']]
        : type === 'ethnicity'
        ? [['','Not provided'],['Hispanic or Latino','Hispanic or Latino'],['Not Hispanic or Latino','Not Hispanic or Latino'],['Prefer not to answer','Prefer not to answer']]
        : [['','Not provided'],['Yes','Yes'],['No','No']];
      for (const [id, text] of options) {
        const item = el('option','',text); item.value = id; input.append(item);
      }
    } else { input = el('input'); input.type = type; }
    input.value = type==='country' ? (ApplicationFillerCountries.find(value)?.name || String(value||'')) : String(value ?? '');
    input.dataset.field = key;
    input.addEventListener('input',()=> { update(input.value); dirty(); });
    input.addEventListener('change',()=> { update(input.value); dirty(); });
    wrap.append(input); parent.append(wrap);
    return wrap;
  }
  $('add-citizenship').addEventListener('click',()=>{
    if(!state)return;
    if(!Array.isArray(state.personal.citizenships))state.personal.citizenships=[];
    state.personal.citizenships.push('');
    state.personal.citizenshipsComplete=false;
    dirty();renderCitizenships();
  });
  function renderCitizenships() {
    const root=$('citizenship-list');root.replaceChildren();
    const person=state.personal;
    if(!Array.isArray(person.citizenships))person.citizenships=[];
    person.citizenships.forEach((value,index)=>{
      const line=el('div','row citizenship-row');
      const wrap=el('label','field grow');wrap.append(el('span','','Citizenship '+(index+1)));
      const select=el('select');select.setAttribute('aria-label','Citizenship '+(index+1));
      const blank=el('option','','Select country');blank.value='';select.append(blank);
      for(const country of ApplicationFillerCountries.all){
        const option=el('option','',country.name);option.value=country.name;select.append(option);
      }
      select.value=ApplicationFillerCountries.find(value)?.name || '';
      select.addEventListener('change',()=>{
        const next=select.value;
        if(next && person.citizenships.some((v,i)=>i!==index && ApplicationFillerCountries.find(v)?.code===ApplicationFillerCountries.find(next)?.code)){
          feedback('That citizenship is already listed.');select.value=ApplicationFillerCountries.find(value)?.name||'';return;
        }
        person.citizenships[index]=next;person.citizenshipsComplete=false;
        $('citizenships-complete').checked=false;dirty();
      });
      wrap.append(select);
      const remove=el('button','btn small danger','Remove');remove.type='button';
      remove.addEventListener('click',()=>{person.citizenships.splice(index,1);person.citizenshipsComplete=false;dirty();renderCitizenships();});
      line.append(wrap,remove);root.append(line);
    });
    const completed=$('citizenships-complete');completed.checked=person.citizenshipsComplete === true;
    completed.onchange=()=>{
      if(completed.checked && (!person.citizenships.length || person.citizenships.some(c=>!ApplicationFillerCountries.find(c)))){
        completed.checked=false;feedback('Select your countries of citizenship before confirming the list is complete.');return;
      }
      person.citizenshipsComplete=completed.checked;dirty();
    };
  }
  function renderPersonal() {
    $('personal-fields').replaceChildren(); $('eligibility-fields').replaceChildren();
    for (const [key,label,type] of personalFields)
      field($('personal-fields'),key,label,state.personal[key],v=>state.personal[key]=v,type);
    for (const [key,label,type] of eligibilityFields)
      field($('eligibility-fields'),key,label,state.personal[key],v=>state.personal[key]=v,type);
    renderCitizenships();
  }
  function profile() { return DB.profileFor(state,active); }
  function renderProfilePicker() {
    const picker = $('profile-picker'); picker.replaceChildren();
    for (const p of state.profiles) { const option = el('option','',p.title); option.value=p.id; picker.append(option); }
    picker.value = active;
    $('delete-profile').disabled = state.profiles.length === 0;
  }
  function renderCollection(key) {
    const container = $(key + '-items'); container.replaceChildren();
    if (!profile()) { container.append(el('p','empty-message','Create a profile to add entries.')); return; }
    const items = profile()[key] || (profile()[key] = []);
    if (!items.length) container.append(el('p','empty-message','Nothing saved yet. Add an entry when you have verified information.'));
    items.forEach((item,index) => {
      const card = el('div','repeat-card');
      const top = el('div','row');
      top.append(el('h3','',`${key.charAt(0).toUpperCase()+key.slice(1)} #${index+1}`));
      const remove = el('button','btn small danger','Remove'); remove.type = 'button';
      remove.addEventListener('click',()=>{ items.splice(index,1);dirty();renderCollection(key); });
      top.append(remove); card.append(top);
      const grid = el('div','form-grid');
      if (key==='projects') {
        // One readable description. Legacy purpose/outcome fields stay in data for
        // backward compatibility but no longer occupy separate form controls.
        const current = Importer.mergeDetails(item.summary || '', item.details || '');
        if (current !== (item.details || '')) { item.details = current; item.summary = ''; dirty(); }
      }
      for (const [id,label,type] of collectionFields[key]) {
        const wrap=field(grid,id,label,item[id],v=>item[id]=v,type || 'text');
        wrap.classList.toggle('wide',type==='textarea');
        if (key==='education' && id==='school') setupSchoolFinder(wrap, item);
        if (key==='projects') {
          const placeholders={
            technologies:'e.g. Angular, TypeScript, Flask, MySQL, Docker',
            details:'Describe what you built, how it worked, your individual contributions, architecture, integrations, design decisions and technical challenges. Use as much detail as you know.'
          };
          const target=wrap.querySelector('input, textarea');
          if(placeholders[id]) target.placeholder=placeholders[id];
          if(id==='details') wrap.append(el('small','field-hint','Be specific. The AI adapts these facts to each question instead of repeating this description verbatim.'));
        }
      }
      card.append(grid);
      if (key==='projects') {
        const actions=el('div','project-actions');
        const expand=el('button','btn small','Improve description with local AI');expand.type='button';
        expand.addEventListener('click',()=>improveProject(item, card, expand));
        actions.append(expand);card.append(actions);
        const more=el('details','project-more');
        const summary=el('summary','','Optional project metadata');more.append(summary);
        const optional=el('div','form-grid');
        for(const [id,label,type] of [['role','Your role'],['dates','Project dates'],['link','Repository or project URL','url']]) {
          field(optional,id,label,item[id],v=>item[id]=v,type||'text');
        }
        more.append(optional);card.append(more);
      }
      container.append(card);
    });
  }
  function setupSchoolFinder(wrap, item) {
    const input=wrap.querySelector('input');
    input.autocomplete='off';
    const box=el('div','school-suggestions');box.setAttribute('role','listbox');wrap.append(box);
    let timer, current=0;
    input.addEventListener('input',()=>{
      clearTimeout(timer);box.replaceChildren();
      const query=input.value.trim();if(query.length<3)return;
      const n=++current;
      timer=setTimeout(async()=>{
        try {
          const url='https://api.ror.org/v2/organizations?query='+encodeURIComponent(query);
          const response=await fetch(url);
          if(!response.ok)throw new Error('School search temporarily unavailable');
          const json=await response.json();if(n!==current||input.value.trim()!==query)return;
          box.replaceChildren();
          const hits=(json.items||[]).filter(x=>Array.isArray(x.types)&&x.types.includes('education')).slice(0,6);
          for(const school of hits) {
            const name=school.names?.find(x=>x.types?.includes('ror_display'))?.value || school.names?.[0]?.value;
            if(!name)continue;
            const place=school.locations?.[0]?.geonames_details?.country_name || '';
            const button=el('button','school-result',name+(place?' · '+place:''));button.type='button';
            button.addEventListener('click',()=>{input.value=name;item.school=name;dirty();box.replaceChildren();});
            box.append(button);
          }
          if(!hits.length)box.append(el('small','hint','No matches. You can still enter a school manually.'));
        } catch {box.replaceChildren();box.append(el('small','hint','Search unavailable. Enter the school name manually.'));}
      },380);
    });
  }
  function renderRole() {
    pendingExtraction=null;
    $('resume-text').value=''; // Never reuse another profile's pasted resume text.
    renderProfilePicker();
    const container=$('role-fields');container.replaceChildren();
    $('focus-preview').classList.add('hide');
    if (!profile()) {
      container.append(el('p','empty-message','No profiles yet. Click New profile to create your first one.'));
      $('resume-name').textContent='Choose resume';
      $('suggest-focus').disabled=true; $('additional-fields').replaceChildren();
      $('repair-experience').disabled=true; $('repair-experience').classList.add('hide');
      for (const key of Object.keys(collectionFields)) renderCollection(key);
      return;
    }
    $('suggest-focus').disabled=false;
    const p=profile();
    const identity=el('div','role-field-group');
    field(identity,'title','Profile name',p.title,v=>{p.title=v;renderProfilePicker();});
    field(identity,'focus','Main role or specialization',p.focus,v=>p.focus=v);
    field(identity,'skills','Technical skills and tools',p.skills,v=>p.skills=v,'textarea').classList.add('wide');
    field(identity,'summary','About you (short summary)',p.summary,v=>p.summary=v,'textarea').classList.add('wide');
    container.append(identity);
    renderAdditional();

    $('resume-name').textContent=p.resumeName || 'Choose resume';
    for (const key of Object.keys(collectionFields)) renderCollection(key);
    const audit=Importer.auditExisting(p);
    $('repair-experience').disabled=!audit.count;
    $('repair-experience').classList.toggle('hide',!audit.count);
    $('repair-experience').textContent=audit.count?`Review ${audit.count} misplaced project${audit.count===1?'':'s'}`:'Review misplaced projects';
  }
  $('reject-foreign-spy-ragebait').addEventListener('change',event=>{
    if(!state)return;
    state.settings.rejectForeignSpyRagebait=event.target.checked;dirty();
  });
  function renderAdditional() {
    $('reject-foreign-spy-ragebait').checked=state.settings.rejectForeignSpyRagebait === true;
    const container=$('additional-fields');container.replaceChildren();
    if(!profile()) { container.append(el('p','empty-message','Create a profile under Role profiles first.'));return; }
    const p=profile();
    const fields=[
      ['targetRoles','Other job titles you are considering'],
      ['specialties','Technical interests'],
      ['strengths','Additional strengths you can demonstrate'],
      ['highlights','Other verified accomplishments'],
      ['preferredProjects','General project notes (optional, not prioritized automatically)'],
      ['approach','Optional writing preferences'],
      ['avoidClaims','Statements or assumptions to avoid']
    ];
    const grid=el('div','role-field-group');
    for(const [key,label] of fields)field(grid,key,label,p[key],v=>p[key]=v,'textarea').classList.add('wide');
    container.append(grid);
  }
  async function improveProject(item, card, button) {
    if(!profile())return;
    const context={...item,summary:item.summary||'',impact:item.impact||''};
    button.disabled=true;
    const preview=el('div','extraction');preview.setAttribute('role','region');
    try {
      const response=await browser.runtime.sendMessage({type:'AP_IMPROVE_PROJECT',project:context,sourceText:profile().resumeSourceText||''});
      if(response.error)throw new Error(response.error);
      const text=String(response.description||'').trim();if(!text)throw new Error('Ollama returned an empty description.');
      preview.append(el('strong','','Suggested project description (review before saving)'));
      const proposed=el('textarea');proposed.value=text;proposed.rows=7;
      proposed.setAttribute('aria-label','AI-suggested project description');preview.append(proposed);
      const buttons=el('div','row wrap');
      const accept=el('button','btn small primary','Use description');accept.type='button';
      accept.addEventListener('click',()=>{item.details=proposed.value.trim();item.summary='';dirty();renderCollection('projects');feedback('Project description saved.');});
      const discard=el('button','btn small','Discard');discard.type='button';discard.addEventListener('click',()=>preview.remove());
      buttons.append(accept,discard);preview.append(buttons);card.append(preview);
    }catch(error){feedback('Could not improve description: '+error.message);}
    finally{button.disabled=false;}
  }

  const historyNames = { opened:'Opened', in_progress:'In progress', completed:'Completed' };
  const historyTabNames = ['in_progress','opened','completed','favorites'];
  let activeHistoryTab = 'in_progress';
  const historyDates = d => {
    if (!d) return 'Not recorded';
    const time=new Date(d);
    return Number.isNaN(time.getTime()) ? 'Not recorded' : time.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  };
  const historyLinkLabel = record => {
    if (record.title && record.title.length > 3) return record.title;
    try { return new URL(record.url).hostname; } catch { return 'Job application'; }
  };
  function selectHistoryTab(tab, focus=false) {
    if(!historyTabNames.includes(tab))return;
    activeHistoryTab=tab;
    document.querySelectorAll('[data-history-tab]').forEach(button=>{
      const selected=button.dataset.historyTab===tab;
      button.setAttribute('aria-selected',String(selected));
      button.tabIndex=selected?0:-1;
      if(selected && focus)button.focus();
    });
    document.querySelectorAll('[data-history-panel]').forEach(panel=>{
      const selected=panel.dataset.historyPanel===tab;
      panel.hidden=!selected;
      panel.classList.toggle('hide',!selected);
    });
  }
  async function historyAction(type, args={}) {
    const result=await browser.runtime.sendMessage({type,...args});
    if (result?.error) throw new Error(result.error);
    state.history=result.history || [];
    renderHistory(false);
  }
  async function renderHistory(refresh=true) {
    if(refresh) {
      try { const latest=await browser.runtime.sendMessage({type:'AP_HISTORY_LIST'});if(latest?.history)state.history=latest.history; }
      catch { /* last locally saved history remains visible */ }
    }
    const all=Array.isArray(state.history)?state.history:[];
    const groups={
      in_progress:all.filter(r=>r.status==='in_progress'),
      opened:all.filter(r=>r.status==='opened'),
      completed:all.filter(r=>r.status==='completed'),
      favorites:all.filter(r=>r.favorite===true)
    };
    for(const tab of historyTabNames) {
      const countId='history-count-'+(tab==='in_progress'?'progress':tab);
      $(countId).textContent=groups[tab].length;
    }
    $('history-clear-all').disabled=all.length===0;
    for(const tab of historyTabNames) {
      const container=document.querySelector(`[data-history-panel="${tab}"] .history-items`);
      container.replaceChildren();
      const listed=groups[tab].slice().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
      if(!listed.length) {
        const emptyText={
          in_progress:'No applications in progress. Start autofill on a job application to see it here.',
          opened:'No opened applications yet. Detected applications appear here before autofill starts.',
          completed:'No completed applications yet. Only confirmed submissions appear here.',
          favorites:'No favorites yet. Use the star on a listing or the Firefox toolbar popup to save jobs you care about.'
        };
        container.append(el('p','empty-message',emptyText[tab]));
        continue;
      }
      for (const record of listed) {
        const entry=el('article','history-entry');
        const heading=el('div','row wrap spread');
        const title=el('strong','history-job-title',historyLinkLabel(record));
        heading.append(title);
        if(tab==='favorites')heading.append(el('span','history-status '+(record.status||'opened'),historyNames[record.status]||'Opened'));
        entry.append(heading);
        let host='';try{host=new URL(record.url).hostname;}catch{}
        entry.append(el('p','history-meta',`${host || 'Job listing'} · First opened ${historyDates(record.firstOpenedAt)}${record.startedAt?' · Started '+historyDates(record.startedAt):''}${record.completedAt?' · Completed '+historyDates(record.completedAt):''}`));
        if(record.profileId) {
          const profile=state.profiles.find(x=>x.id===record.profileId);
          entry.append(el('p','history-meta',`Profile: ${profile?.title || 'Previously selected profile'}`));
        }
        const actions=el('div','history-actions');
        const favorite=el('button','btn small history-favorite'+(record.favorite?' is-favorite':''),record.favorite?'★ Favorited':'☆ Favorite');
        favorite.type='button';favorite.setAttribute('aria-pressed',String(!!record.favorite));
        favorite.setAttribute('aria-label',(record.favorite?'Remove favorite from ':'Add favorite to ')+historyLinkLabel(record));
        favorite.addEventListener('click',async()=>{
          favorite.disabled=true;
          try { await historyAction('AP_HISTORY_SET_FAVORITE',{listingKey:record.listingKey,favorite:!record.favorite}); }
          catch(e){feedback('Could not change favorite: '+e.message);favorite.disabled=false;}
        });
        actions.append(favorite);
        if(record.url){
          const link=el('a','btn small','Open listing');link.href=record.url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
        }
        const label=el('label','history-change');label.append(el('span','', 'Status'));
        const select=el('select');select.setAttribute('aria-label',`Change status for ${historyLinkLabel(record)}`);
        for(const [key,name] of Object.entries(historyNames)) {
          const option=el('option','',name);option.value=key;select.append(option);
        }
        select.value=record.status;
        select.addEventListener('change',async()=>{
          const next=select.value;
          if(next==='completed' && !confirm('Only mark this listing Completed if the employer site confirmed you submitted your application. Continue?')){select.value=record.status;return;}
          select.disabled=true;
          try {await historyAction('AP_HISTORY_SET_STATUS',{listingKey:record.listingKey,status:next});feedback('Application status updated.');}
          catch(e){feedback('Could not change status: '+e.message);select.value=record.status;select.disabled=false;}
        });
        label.append(select);actions.append(label);
        const remove=el('button','btn small danger','Delete');remove.type='button';
        remove.setAttribute('aria-label',`Delete ${historyLinkLabel(record)} from application history`);
        remove.addEventListener('click',async()=>{
          if(!confirm(`Remove “${historyLinkLabel(record)}” from application history? This also removes it from Favorites.`))return;
          remove.disabled=true;
          try {await historyAction('AP_HISTORY_DELETE',{listingKey:record.listingKey});feedback('Application record deleted.');}
          catch(e){feedback('Could not delete record: '+e.message);remove.disabled=false;}
        });
        actions.append(remove);entry.append(actions);container.append(entry);
      }
    }
    selectHistoryTab(activeHistoryTab);
  }

  async function loadIgnored() {
    try {
      const result=await browser.runtime.sendMessage({type:'AP_IGNORE_LIST'});
      if(result?.error)throw new Error(result.error);
      ignoredRows=result.items||[];
      renderIgnored();
    } catch(error){feedback('Could not load skipped questions: '+error.message);}
  }
  function renderIgnored() {
    const parent=$('ignored-items');parent.replaceChildren();
    if(!ignoredRows.length){parent.append(el('p','empty-message','No permanent skip rules saved.'));return;}
    for(const item of ignoredRows) {
      const card=el('article','learned-entry');
      card.append(el('strong','learned-question',item.label));
      card.append(el('p','hint','Optional question — always skip'));
      const actions=el('div','row wrap learned-actions');
      const remove=el('button','btn small danger','Stop skipping');remove.type='button';
      remove.addEventListener('click',async()=>{
        remove.disabled=true;
        try {
          const result=await browser.runtime.sendMessage({type:'AP_IGNORE_DELETE',key:item.key});
          if(result?.error)throw new Error(result.error);
          ignoredRows=result.items||[];renderIgnored();feedback('The question can be asked again.');
        }catch(error){remove.disabled=false;feedback('Could not remove skip rule: '+error.message);}
      });
      actions.append(remove);card.append(actions);parent.append(card);
    }
  }
  async function loadLearned() {
    await loadIgnored();
    try {
      const result=await browser.runtime.sendMessage({type:'AP_MEMORY_LIST'});
      if(result?.error)throw new Error(result.error);
      learnedRows=Array.isArray(result.items)?result.items:[];
      selectLearnedCategory(learnedCategory);
    }catch(error){feedback('Could not load learned information: '+error.message);}
  }
  function selectLearnedCategory(category) {
    learnedCategory=category;
    document.querySelectorAll('[data-learned-category]').forEach(button=>{
      const selected=button.dataset.learnedCategory===category;
      button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
    });
    $('learned-main-panel').hidden=category==='skipped';
    $('learned-skips-panel').hidden=category!=='skipped';
    if(category==='skipped')renderIgnored(); else renderLearned();
  }
  function renderIntents() {
    const parent=$('intent-items');if(!parent)return;parent.replaceChildren();
    const entries=Object.entries(state.learnedIntents||{});
    if(!entries.length){parent.append(el('p','empty-message','No taught question meanings yet.'));return;}
    for(const [key,intent] of entries) {
      const card=el('article','learned-entry');
      card.append(el('strong','learned-question','“'+key+'”'));
      card.append(el('p','hint learned-meta','Treated as: '+(ApplicationFillerModel.intentLabel(intent)||intent)));
      const remove=el('button','btn small danger','Delete');remove.type='button';
      remove.addEventListener('click',async()=>{
        await browser.runtime.sendMessage({type:'AP_DELETE_INTENT',key});
        delete state.learnedIntents[key];renderIntents();
      });
      card.append(remove);parent.append(card);
    }
  }
  function renderLearned() {
    renderIntents();
    const query=$('learned-search').value.trim().toLowerCase();
    const scope=$('learned-scope').value;
    const rows=learnedRows.filter(row=>(scope==='all'||scope===row.scope) &&
      (learnedCategory==='all' || (row.category||'general')===learnedCategory ||
        (learnedCategory==='general' && !['education','employment'].includes(row.category))) &&
      `${row.question} ${row.answer} ${row.source} ${row.entityId||''}`.toLowerCase().includes(query));
    $('learned-count').textContent=`${rows.length} shown of ${learnedRows.length} saved answers`;
    $('learned-clear-all').disabled=learnedRows.length===0;
    const parent=$('learned-items');parent.replaceChildren();
    if(!rows.length){parent.append(el('p','empty-message',learnedRows.length?'No answers match this filter.':'No learned answers yet. When you review a new question and continue, it can appear here.'));return;}
    const groupRoots=new Map();
    for(const row of rows) {
      const groupKey=['education','employment'].includes(row.category)?
        (row.category+'|'+(row.entityId||'Unassigned / listing-specific details')) : 'general';
      if(!groupRoots.has(groupKey)){
        const section=el('section','learned-record-group');
        if(groupKey!=='general')section.append(el('h3','learned-record-title',
          (row.category==='education'?'School: ':'Employer: ')+(row.entityId||'Needs record association')));
        const entries=el('div','repeat-list');section.append(entries);
        parent.append(section);groupRoots.set(groupKey,entries);
      }
      const card=el('article','learned-entry');
      const heading=el('div','row wrap spread');
      heading.append(el('strong','learned-question',row.question));
      heading.append(el('span','learned-scope',row.scope==='listing'?'This job only':'Reusable'));
      card.append(heading);
      const p=state.profiles.find(p=>p.id===row.roleId);
      const desc=[p?.title||row.roleId||'Unknown profile',row.entityId||row.section||'',row.source,row.updatedAt?`Updated ${new Date(row.updatedAt).toLocaleDateString()}`:''].filter(Boolean).join(' · ');
      card.append(el('p','hint learned-meta',desc));
      const answer=el('p','learned-answer',row.answer);card.append(answer);
      if(row.conflict)card.append(el('p','hint learned-warning','Review conflict: '+row.conflict+'. Update the profile if the saved date has changed.'));
      const buttons=el('div','learned-actions row wrap');
      const edit=el('button','btn small','Edit answer');edit.type='button';
      const remove=el('button','btn small danger','Delete');remove.type='button';
      edit.addEventListener('click',()=>{
        if(card.querySelector('textarea'))return;
        const fieldWrap=el('label','field');fieldWrap.append(el('span','','Saved answer'));
        const textarea=el('textarea');textarea.rows=3;textarea.value=row.answer;fieldWrap.append(textarea);
        const actions=el('div','row wrap');
        const apply=el('button','btn small primary','Save answer');apply.type='button';
        const cancel=el('button','btn small','Cancel');cancel.type='button';
        apply.addEventListener('click',async()=>{
          if(!textarea.value.trim()){feedback('An answer cannot be empty. Use Delete to remove it.');return;}
          apply.disabled=true;
          try {
            const result=await browser.runtime.sendMessage({type:'AP_MEMORY_SAVE',key:row.key,answer:textarea.value});
            if(result?.error)throw new Error(result.error);
            learnedRows=result.items||[];renderLearned();feedback('Learned answer updated.');
          }catch(e){feedback('Save failed: '+e.message);apply.disabled=false;}
        });
        cancel.addEventListener('click',()=>{fieldWrap.remove();actions.remove();});
        actions.append(apply,cancel);card.append(fieldWrap,actions);textarea.focus();
      });
      remove.addEventListener('click',async()=>{
        if(!confirm(`Delete this saved answer?\n\n${row.question}`))return;
        remove.disabled=true;
        try {
          const result=await browser.runtime.sendMessage({type:'AP_MEMORY_DELETE',key:row.key});
          if(result?.error)throw new Error(result.error);
          learnedRows=result.items||[];renderLearned();feedback('Learned answer deleted.');
        }catch(e){feedback('Delete failed: '+e.message);remove.disabled=false;}
      });
      buttons.append(edit,remove);card.append(buttons);groupRoots.get(groupKey).append(card);
    }
  }
  function renderSettings() {
    const container = $('automation-settings'); container.replaceChildren();
    for (const [key,title,description] of settingFields) {
      const row = el('label','setting-row');
      const text = el('div');text.append(el('strong','',title),el('p','',description));
      const input = el('input');input.type='checkbox';input.checked=!!state.settings[key];
      input.addEventListener('change',()=>{state.settings[key]=input.checked;dirty();});
      row.append(text,input);container.append(row);
    }
    $('model-name').value=state.settings.localModel || 'llama3.2:3b';
    updateHistoryPermission();
  }
  async function updateHistoryPermission() {
    const has = await browser.permissions.contains({ permissions:['history'] });
    $('history-permission').textContent = has ? 'Permission enabled' : 'Permission disabled';
    $('toggle-history').textContent = has ? 'Disable' : 'Enable';
  }
  function switchView(name) {
    document.querySelectorAll('.nav-btn').forEach(button=>button.classList.toggle('selected',button.dataset.view===name));
    document.querySelectorAll('.view').forEach(view=>view.classList.toggle('hide',view.id !== 'view-'+name));
    const names = { personal:['YOUR INFORMATION','Personal information','These details are shared across all application profiles.'],
      profiles:['ROLE PROFILES','Role profiles','Maintain different application contexts without repeating your identity.'],
      additional:['ADDITIONAL INPUTS','Additional inputs','Optional notes for your active role profile.'],
      history:['APPLICATIONS','Application history','Records belong to a particular job listing, not the company.'],
      learned:['KNOWLEDGE BASE','Learned information','Review the answers ApplicationFiller has learned while filling job applications.'],
      settings:['PREFERENCES','Settings & privacy','Choose how ApplicationFiller behaves and what it can access.'] };
    const parts = names[name];
    $('kicker').textContent=parts[0];$('view-title').textContent=parts[1];$('view-description').textContent=parts[2];
    if (name==='history') renderHistory();
    if (name==='learned') loadLearned();
    if (name==='additional') renderAdditional();
  }
  function download(filename,content) {
    const blob = new Blob([content],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = el('a');a.download=filename;a.href=url;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),250);
  }
  function wire() {
    document.querySelectorAll('.nav-btn').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
    $('save-now').addEventListener('click',save);
    document.querySelectorAll('[data-learned-category]').forEach(button=>{
      button.addEventListener('click',()=>selectLearnedCategory(button.dataset.learnedCategory));
      button.addEventListener('keydown',event=>{
        const buttons=[...document.querySelectorAll('[data-learned-category]')];
        const index=buttons.indexOf(button);
        const next=event.key==='ArrowRight'?(index+1)%buttons.length:
          event.key==='ArrowLeft'?(index+buttons.length-1)%buttons.length:-1;
        if(next!==-1){event.preventDefault();selectLearnedCategory(buttons[next].dataset.learnedCategory);buttons[next].focus();}
      });
    });
    selectLearnedCategory(learnedCategory);
    $('learned-search').addEventListener('input',renderLearned);
    $('learned-scope').addEventListener('change',renderLearned);
    $('learned-clear-all').addEventListener('click',async()=>{
      if(!learnedRows.length)return;
      if(!confirm(`Delete all ${learnedRows.length} learned answers? This will not delete applicant profiles or application history.`))return;
      try {
        const result=await browser.runtime.sendMessage({type:'AP_MEMORY_CLEAR'});
        if(result?.error)throw new Error(result.error);
        learnedRows=[];renderLearned();feedback('All learned answers deleted.');
      }catch(e){feedback('Could not clear learned answers: '+e.message);}
    });
    document.querySelectorAll('[data-history-tab]').forEach(tab=>{
      tab.addEventListener('click',()=>selectHistoryTab(tab.dataset.historyTab));
      tab.addEventListener('keydown',event=>{
        const index=historyTabNames.indexOf(tab.dataset.historyTab);
        const next=event.key==='ArrowRight' ? (index+1)%historyTabNames.length :
          event.key==='ArrowLeft' ? (index+historyTabNames.length-1)%historyTabNames.length :
          event.key==='Home' ? 0 : event.key==='End' ? historyTabNames.length-1 : -1;
        if(next!==-1){event.preventDefault();selectHistoryTab(historyTabNames[next],true);}
      });
    });
    $('history-clear-all').addEventListener('click',async()=>{
      if(!state.history.length)return;
      if(!confirm(`Permanently clear all ${state.history.length} application history records? Saved profiles and resumes are unaffected.`))return;
      try {await historyAction('AP_HISTORY_CLEAR');feedback('Application history cleared.');}
      catch(error){feedback('Could not clear history: '+error.message);}
    });
    $('new-profile').addEventListener('click',()=>{
      const title=prompt('Name your new role profile:','New role');if (!title?.trim()) return;
      const id='profile-'+Date.now();
      state.profiles.push({id,title:title.trim(),focus:'',summary:'',skills:'',targetRoles:'',specialties:'',strengths:'',highlights:'',preferredProjects:'',approach:'',avoidClaims:'',resumeName:'',education:[],experience:[],projects:[]});
      active=id;state.activeProfileId=id;dirty();renderRole();
    });
    $('profile-picker').addEventListener('change',()=>{active=$('profile-picker').value;state.activeProfileId=active;dirty();renderRole();});
    $('delete-profile').addEventListener('click',async()=>{
      if(state.profiles.length<1 || !confirm('Delete this profile and its saved resume?'))return;
      const removed=active;state.profiles=state.profiles.filter(p=>p.id!==removed);
      active=state.profiles[0]?.id || '';state.activeProfileId=active;
      await DB.removeResume(removed);dirty();renderRole();
    });
    for(const key of Object.keys(collectionFields)){
      const buttonId = key === 'projects' ? 'add-projects' : 'add-'+key;
      $(buttonId).addEventListener('click',()=>{
        const item=Object.fromEntries(collectionFields[key].map(([name])=>[name,'']));
        if (!profile()) { feedback('Create a profile first.'); return; }
        profile()[key].push(item);dirty();renderCollection(key);
      });
    }
    $('resume-file').addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(!file)return;
      if (!profile()) { feedback('Create a profile first.'); return; }
      if(file.size>6*1024*1024){feedback('Resume exceeds 6 MB.');return;}
      if(!/\.(pdf|doc|docx|txt)$/i.test(file.name)){feedback('Use PDF, DOC, DOCX or TXT.');return;}
      try {await DB.putResume(active,file);profile().resumeName=file.name;dirty();$('resume-name').textContent=file.name;feedback('Resume saved in Firefox.');}
      catch(error){feedback('Could not save resume: '+error.message);}
    });
    $('remove-resume').addEventListener('click',async()=>{if(!profile())return;
      await DB.removeResume(active);profile().resumeName='';profile().resumeSourceText='';dirty();$('resume-name').textContent='Choose resume';feedback('Resume removed.');
    });
    $('extract').addEventListener('click',async()=>{
      const button=$('extract');button.disabled=true;
      let text=$('resume-text').value.trim();
      if(!text) {
        try {
          if(!profile())throw new Error('Create a profile first.');
          const saved=await DB.getResume(active);
          if(!saved?.blob)throw new Error('Upload a resume or paste its text first.');
          const ext=saved.name.toLowerCase();
          if(ext.endsWith('.pdf')) text=await ApplicationFillerPDF.extract(saved.blob);
          else if(ext.endsWith('.txt')) text=await saved.blob.text();
          else throw new Error('DOC/DOCX can be attached, but this importer only extracts text from PDF or TXT.');
          $('resume-text').value=text;
        } catch(error) {feedback(error.message);button.disabled=false;return;}
      }
      try{
        const reply=await browser.runtime.sendMessage({type:'AP_EXTRACT',text});
        if(reply.error) {
          if(reply.error.includes('Ollama') || reply.error.includes('local AI')) {
            const preview=$('extraction-preview');preview.replaceChildren();
            preview.append(el('strong','','PDF text extracted locally'),
              el('p','', 'Your extracted text appears above. Start Ollama and click Extract again for a structured draft, or copy details into your profile manually.'));
            preview.classList.remove('hide');feedback('Text extracted. Local AI is unavailable.');return;
          }
          throw new Error(reply.error);
        }
        pendingExtraction=Importer.normalizeImport(reply.extracted);
        const requestedProfile=active;
        const diff=Importer.mergeExtracted(profile(),pendingExtraction);
        const preview=$('extraction-preview');preview.replaceChildren();
        preview.append(el('strong','','Review resume changes'));
        const summary=el('p','',`${diff.changes.added.length} new entries · ${new Set(diff.changes.enriched).size} updated sections · ${diff.changes.conflicts.length} possible changes to review.`);
        preview.append(summary);
        for(const [heading,entries] of [['New information',diff.changes.added],['Added details', [...new Set(diff.changes.enriched)]]]){
          if(!entries.length)continue;
          preview.append(el('h4','',heading));const list=el('ul','import-change-list');
          for(const entry of entries)list.append(el('li','',entry));preview.append(list);
        }
        if(diff.changes.conflicts.length){
          preview.append(el('h4','','Potentially changed facts (leave unchecked to keep saved value)'));
        }
        for(const conflict of diff.changes.conflicts){
          const label=el('label','import-conflict');
          const checkbox=el('input');checkbox.type='checkbox';checkbox.value=conflict.id;
          label.append(checkbox,el('span','',`${conflict.label}: ${conflict.current} → ${conflict.proposed}`));preview.append(label);
        }
        const controls=el('div','row wrap');
        const apply=el('button','btn small primary','Merge changes');apply.type='button';
        apply.addEventListener('click',()=>{
          if(active!==requestedProfile){feedback('Profile changed; extract again before merging.');return;}
          const updated=Importer.mergeExtracted(profile(),pendingExtraction,
            [...preview.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value));
          Object.assign(profile(),updated.profile);
          profile().resumeSourceText=text.slice(0,24000);
          pendingExtraction=null;dirty();renderRole();preview.classList.add('hide');
          feedback('Resume information merged successfully.');
        });
        const cancel=el('button','btn small','Cancel');cancel.type='button';
        cancel.addEventListener('click',()=>{pendingExtraction=null;preview.classList.add('hide');});
        controls.append(apply,cancel);preview.append(controls);preview.classList.remove('hide');
      }catch(error){feedback('Extraction failed: '+error.message);}
      finally{button.disabled=false;}
    });
    $('repair-experience').addEventListener('click',()=>{
      if(!profile())return;
      const audit=Importer.auditExisting(profile());
      if(!audit.count){feedback('No project entries found in work experience.');return;}
      if(!confirm(`Move ${audit.count} project-like work experience entries into Projects? Existing details will be kept; you can review them afterward.`))return;
      Object.assign(profile(),Importer.repairExisting(profile()));
      dirty();renderRole();feedback('Project entries moved from work experience. Review project names and details.');
    });
    $('suggest-focus').addEventListener('click',async()=>{
      if(!profile())return;
      const button=$('suggest-focus');button.disabled=true;
      const requestedProfile=active;
      try {
        const reply=await browser.runtime.sendMessage({type:'AP_ROLE_FOCUS',profileId:requestedProfile});
        if(reply.error)throw new Error(reply.error);
        if(active!==requestedProfile)return;
        const suggestion=reply.suggested;
        const keys=['targetRoles','specialties','strengths','highlights','approach'];
        const verified=Object.fromEntries(keys.map(k=>[k,typeof suggestion?.[k]==='string'?suggestion[k]:'']));
        const preview=$('focus-preview');preview.replaceChildren();
        preview.append(el('strong','','Suggested role focus — review carefully'),el('pre','',JSON.stringify(verified,null,2)));
        const apply=el('button','btn small primary','Apply suggestions');
        apply.addEventListener('click',()=>{
          if(active!==requestedProfile)return;
          for(const key of keys)if(verified[key]&&!profile()[key])profile()[key]=verified[key];
          dirty();renderRole();renderAdditional();feedback('Optional information saved.');
        });
        preview.append(apply);preview.classList.remove('hide');
      }catch(error){feedback('Could not suggest role focus: '+error.message);}
      finally{button.disabled=false;}
    });
    $('model-name').addEventListener('change',()=>{state.settings.localModel=$('model-name').value.trim();dirty();});
    $('test-ollama').addEventListener('click',async()=>{
      $('ollama-status').textContent='Checking…';
      try { const r=await browser.runtime.sendMessage({type:'AP_AI_TEST'}); $('ollama-status').textContent=r.error || r.message || 'Connected'; }
      catch(e){$('ollama-status').textContent=e.message;}
    });
    $('toggle-history').addEventListener('click',()=>{
      const isEnabled = $('toggle-history').textContent === 'Disable';
      // Directly invoke the permission operation within the click event handler.
      const request = isEnabled
        ? browser.permissions.remove({permissions:['history']})
        : browser.permissions.request({permissions:['history']});
      request.then(granted=>{
        if (!granted) feedback('History permission was not granted.');
        state.settings.useBrowserHistory=!isEnabled && Boolean(granted);
        dirty();
        return updateHistoryPermission();
      }).catch(e=>feedback(e.message));
    });
    $('export-data').addEventListener('click',async()=>{
      // Include answers learned in other application tabs since this editor opened.
      await save();
      const output=structuredClone(await DB.getState());
      for(const p of output.profiles) p.resumeName='';
      download('applicationfiller-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(output,null,2));
      feedback('Backup saved without resume file bytes.');
    });
    $('import-data').addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(!file)return;
      if(file.size>4*1024*1024){feedback('Backup exceeds 4 MB.');return;}
      try{
        const imported=JSON.parse(await file.text());
        if(!Array.isArray(imported.profiles)||!imported.personal||!imported.settings)throw new Error('Invalid backup format.');
        if(!confirm('Replace saved profiles and answers with this backup? Resumes are not part of the backup.'))return;
        state={...await DB.saveState(imported)};
        await DB.saveState(state);
        active=state.activeProfileId;
        renderPersonal();renderRole();renderSettings();renderHistory();feedback('Backup imported. Reattach your resumes.');
      }catch(error){feedback('Import failed: '+error.message);}
    });
  }
  async function init(){
    state=await DB.getState();active=state.activeProfileId;
    renderPersonal();renderRole();renderSettings();renderHistory();wire();
  }
  init().catch(error=>feedback(error.message));
})();
