/* Toolbar popup: start, monitor and review an application. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let tab = null, state = null, current = null, currentListing = null;
  const phaseNames = { idle:'Idle', running:'Working', review:'Review', paused:'Paused', final:'Final review', done:'Recorded' };
  function status(message, error = false) { $('status').textContent = message || ''; $('status').classList.toggle('error', error); }
  async function send(message) {
    const result = await browser.runtime.sendMessage({ ...message, tabId: tab.id });
    if (result?.error && !['paused','final'].includes(result.phase)) throw new Error(result.error);
    return result;
  }
  const make = (tag, className, text) => {
    const el = document.createElement(tag); el.className = className || '';
    if (text != null) el.textContent = text;
    return el;
  };
  function renderReview(pending) {
    const root=$('pending-items');root.replaceChildren();
    const byCategory=new Map();
    for(const question of pending){
      const category=question.category==='education'?'Education':question.category==='employment'?'Employment':'Other questions';
      if(!byCategory.has(category))byCategory.set(category,[]);
      byCategory.get(category).push(question);
    }
    for(const [section,questions] of byCategory){
      const region=make('section','review-group');
      const title=make('h3','review-group-title',section);
      const count=make('span','review-group-count',`${questions.length} item${questions.length===1?'':'s'}`);
      const heading=make('div','review-group-head');heading.append(title,count);region.append(heading);
      for(const question of questions){
        const card=make('div','review-item');
        const header=make('header');
        header.append(make('strong','',question.label||'Unrecognized question'),
          make('span','pill '+(question.kind==='ai'?'neutral':'warn'),
            {ai:'AI draft',unknown:question.suggestion&&question.profileKey?'Not accepted by site':'Unknown',optional:'Optional',missingFact:'Missing fact',salary:'Salary',conflict:'Check existing value',agreement:'Agreement',resume:'Resume',file:'Attachment'}[question.kind]||'Review'));
        card.append(header);
        if(question.entityId){card.append(make('small','review-entity',question.entityId));}
        if(question.where)card.append(make('small','review-entity','On the page under: '+question.where));
        const note=make('small','',question.message||(
          question.suggestion&&question.profileKey?'Your profile has “'+question.suggestion+'”, but the website would not accept it automatically. Confirm it here (these are the website’s own choices) or select it on the page.':
          !question.required?'Optional: answer it, skip once, or save an always-skip rule.':
          question.kind==='agreement'?'Review and acknowledge this on the application page.':
          question.kind==='ai'?'Review the generated draft before continuing.':
          'Enter the answer or choose the appropriate option.'));
        card.append(note);
        // Display the skip instruction BEFORE the answer control so it remains
        // visible in compact popups. Never offer it for a required question.
        if(!question.required && question.ignoreKey){
          const skip=make('label','ignore-row');
          const checkbox=make('input');checkbox.type='checkbox';checkbox.dataset.ignoreId=question.id;
          skip.append(checkbox,make('span','','Always skip this optional question'));
          card.append(skip);
        }
        if(question.source?.startsWith('https://www.bls.gov/')){
          const a=make('a','hint','View wage source');a.href=question.source;a.target='_blank';a.rel='noopener noreferrer';card.append(a);
        }
        const u=question.understanding;
        if(u && (u.candidates||[]).length && !['agreement','resume','file','missingFact','salary','conflict'].includes(question.kind)){
          const row=make('label','intent-row');
          row.append(make('span','',u.confident?'Recognized as “'+u.label+'”. Change if wrong:':'What is this question about? (so similar wording is answered next time)'));
          const choose=make('select','review-control');choose.dataset.intentFor=question.id;choose.dataset.original=u.confident?u.id:'';
          const none=make('option','','Something else / not sure');none.value='';choose.append(none);
          for(const candidate of u.candidates){const o=make('option','',candidate.label);o.value=candidate.id;choose.append(o);}
          choose.value=u.confident?u.id:'';row.append(choose);card.append(row);
        }
        const show=make('button','secondary small','Show on page');show.type='button';
        show.addEventListener('click',()=>send({type:'AP_FOCUS',ids:[question.id]}).catch(error=>status(error.message,true)));
        card.append(show);
        if(!['agreement','resume','file'].includes(question.kind)){
          const wrap=make('div','review-answer');wrap.dataset.answerWrapper=question.id;
          let control;
          if(question.type==='radio'){
            control=make('fieldset','review-radio-set');
            const legend=make('legend','sr-only',question.label);control.append(legend);
            for(const option of question.options||[]){
              const row=make('label','review-radio');const input=make('input');
              input.type='radio';input.name='review-'+question.id;input.value=option.value;
              if(String(question.suggestion||'')===option.value)input.checked=true;
              row.append(input,make('span','',option.label));control.append(row);
            }
          }else if(question.type==='select' && !(question.options||[]).length){
            const custom=make('div','review-custom-select');
            const text=make('input','review-control');text.type='text';
            text.placeholder='Enter a choice (or find the website options)';
            text.value=question.suggestion||'';
            text.setAttribute('aria-label',question.label);
            const find=make('button','secondary small review-find-choices','Find choices');find.type='button';
            const response=make('p','hint','');
            find.addEventListener('click',async()=>{
              find.disabled=true;response.textContent='Looking for the options on this page…';
              try{
                const result=await send({type:'AP_GET_CHOICES',id:question.id});
                if(result?.error)throw new Error(result.error);
                if(!(result.options||[]).length){
                  response.textContent='The site did not expose choices. Select it on the application page, then press Continue.';
                  return;
                }
                const picker=make('select','review-control');
                const empty=make('option','','Choose an option');empty.value='';picker.append(empty);
                for(const option of result.options){
                  const row=make('option','',option.label);row.value=option.value;picker.append(row);
                }
                picker.addEventListener('change',()=>{text.value=picker.value;});
                custom.querySelector('select')?.remove();
                custom.insertBefore(picker,find);
                response.textContent='Choose an option above, then press Continue.';
              }catch(error){response.textContent='Could not load choices: '+error.message;}
              finally{find.disabled=false;}
            });
            custom.append(text,find,response);control=custom;
          }else if(question.type==='select'){
            control=make('select','review-control');
            const empty=make('option','','Choose an answer');empty.value='';control.append(empty);
            for(const opt of question.options||[]){const node=make('option','',opt.label);node.value=opt.value;control.append(node);}
            control.value=question.suggestion||'';
          }else if(question.type==='textarea'){
            control=make('textarea','review-control');control.rows=question.kind==='ai'?5:3;
            control.value=question.suggestion||'';
            if(question.maxLength>0)control.maxLength=question.maxLength;
          }else{
            control=make('input','review-control');
            control.type=['date','number','email','tel','text'].includes(question.type)?question.type:'text';
            control.value=question.suggestion||'';
            if(question.maxLength>0)control.maxLength=question.maxLength;
          }
          if(!control.querySelector?.('[aria-label]'))control.setAttribute('aria-label',question.label);
          wrap.append(control);card.append(wrap);
        }
        region.append(card);
      }
      root.append(region);
    }
    $('pending-count').textContent=pending.length+(pending.length===1?' item':' items');
  }
  function reviewedAnswers() {
    return {
      replies:[...$('pending-items').querySelectorAll('[data-answer-wrapper]')].map(wrapper=>{
        const selected=wrapper.querySelector('input[type="radio"]:checked');
        const control=selected||wrapper.querySelector('select,input,textarea');
        return {id:wrapper.dataset.answerWrapper,value:control?.value||''};
      }),
      ignoreIds:[...$('pending-items').querySelectorAll('[data-ignore-id]:checked')].map(el=>el.dataset.ignoreId),
      intents:Object.fromEntries([...$('pending-items').querySelectorAll('[data-intent-for]')]
        .filter(sel=>sel.value && sel.value!==sel.dataset.original).map(sel=>[sel.dataset.intentFor,sel.value]))
    };
  }
  function render(result) {
    current = result || {phase:'idle',known:0,generated:0,unknown:0,pending:[]};
    $('phase').textContent = phaseNames[current.phase] || 'Idle';
    $('phase').className = 'pill ' + (current.phase === 'review' ? 'warn' : current.phase === 'done' ? 'done' : 'neutral');
    $('stat-known').textContent = current.known || 0;
    $('stat-generated').textContent = current.generated || 0;
    $('stat-unknown').textContent = current.unknown || 0;
    if (current.disabledFields && ['review','paused'].includes(current.phase)) {
      $('detection-detail').textContent = `${current.disabledFields} field(s) are temporarily disabled by this website. Complete its prerequisite, then press Fill & Continue again.`;
    }
    $('summary-note').textContent = current.phase === 'idle' ? 'Counts appear after you run an application.' :
      `${current.steps || 0} intermediate step(s) navigated. ${current.skippedOptional || 0} optional field(s) reviewed and skipped. Final submission remains manual.`;
    $('review').classList.toggle('hide', current.phase !== 'review' || !current.pending?.length);
    $('finish').classList.toggle('hide', current.phase !== 'final');
    $('stop').classList.toggle('hide', !['running','review'].includes(current.phase));
    if (current.phase === 'review') {
      // Don't discard user's typing on every status poll.
      const oldIds = [...$('pending-items').querySelectorAll('[data-answer-wrapper]')].map(el=>el.dataset.answerWrapper).join('|');
      const newIds = (current.pending || []).filter(p=>!['agreement','resume','file'].includes(p.kind)).map(p=>p.id).join('|');
      if (oldIds !== newIds) renderReview(current.pending);
    }
    status(current.error || '');
  }
  function renderFavoriteButton() {
    const button=$('favorite-listing');
    button.classList.toggle('hide',!currentListing);
    if(!currentListing)return;
    const isFavorite=currentListing.favorite===true;
    button.textContent=isFavorite?'★ Remove from favorites':'☆ Favorite this job';
    button.setAttribute('aria-pressed',String(isFavorite));
  }
  // Users may bookmark a job posting before reaching the application form.
  // Do not offer a favorite action on unrelated websites or generic careers indexes.
  function likelyJobPosting(url) {
    try {
      const u=new URL(url);
      return /\/(?:jobs?|requisitions?|positions?|openings?)\/[^/]+/i.test(u.pathname) ||
        /(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com)$/i.test(u.hostname) &&
        /\/(?:job|jobs|apply|candidate)\//i.test(u.pathname);
    }catch{return false;}
  }
  async function updateDetection() {
    if (!tab || !/^https?:/.test(tab.url || '')) {
      $('detection-title').textContent = 'Open an application page';
      $('detection-detail').textContent = 'Firefox internal pages are not supported.';
      $('fill').disabled = true; return;
    }
    try {
      const result = await send({type:'AP_DETECT'});
      $('detection-title').textContent = result.detected ? 'Form detected' : 'No application form detected';
      $('detection-detail').textContent = result.detected ? 'You can start filling this page.' : 'Refresh the application after signing in, or check Firefox site permissions.';
      const listing = ApplicationFillerData.listingKey(tab.url);
      const row=(await browser.runtime.sendMessage({type:'AP_HISTORY_LIST'})).history.find(item=>item.listingKey===listing);
      currentListing=(result.detected || row || likelyJobPosting(tab.url)) && listing ? (row || {listingKey:listing,url:tab.url,title:tab.title||'',favorite:false}) : null;
      renderFavoriteButton();
      if (row?.status==='completed') $('detection-detail').textContent = `Application marked completed on ${(row.completedAt || row.updatedAt || '').slice(0,10)}.`;
      else if (row?.status==='in_progress') $('detection-detail').textContent = 'Application in progress — return to the first unanswered field or continue filling.';
      else if (row?.status==='opened') $('detection-detail').textContent = 'Application opened and saved in your history.';
      else if (state.settings.useBrowserHistory && await browser.permissions.contains({ permissions:['history'] })) {
        const visits = await browser.history.getVisits({url:tab.url}).catch(()=>[]);
        if (visits.length > 1) $('detection-detail').textContent = 'Previously visited listing. A visit is not a submission.';
      }
      $('fill').disabled = !result.detected || !state.profiles.length;
      if (!state.profiles.length) $('detection-detail').textContent='Create your first role profile in Update information.';
    } catch {
      $('detection-title').textContent = 'Page not supported';
      $('detection-detail').textContent = 'Refresh the page or check Firefox site permissions.';
      $('fill').disabled = true;
    }
  }
  async function init() {
    state = await ApplicationFillerData.getState();
    tab = (await browser.tabs.query({active:true,currentWindow:true}))[0];
    $('profile-select').replaceChildren();
    for (const p of state.profiles) {
      const option = make('option','',p.title); option.value = p.id; $('profile-select').append(option);
    }
    $('profile-select').value = state.activeProfileId;
    if (!state.profiles.length) { const option=make('option','','Create a profile first');option.value='';$('profile-select').append(option); $('fill').disabled=true; }
    if (state.settings.recommendProfile && tab?.title) {
      const mlRole = /machine learning|\bml engineer\b|data scientist|artificial intelligence/i.test(tab.title);
      const candidate = state.profiles.find(p => mlRole ? /machine learning|\bml\b/i.test(p.focus + ' ' + p.title) : /software engineer|\bswe\b/i.test(p.focus + ' ' + p.title));
      if (candidate) $('profile-select').value = candidate.id;
    }
    $('profile-select').addEventListener('change',async () => {
      const requested=$('profile-select').value;
      const previous=state.activeProfileId;
      try {
        const response=await browser.runtime.sendMessage({type:'AP_SELECT_PROFILE',profileId:requested});
        if(response?.error)throw new Error(response.error);
        state.activeProfileId=requested;
      } catch(error){$('profile-select').value=previous;status('Could not change profile: '+error.message,true);}
    });
    $('open-options').addEventListener('click',()=>browser.runtime.openOptionsPage());
    $('edit').addEventListener('click',()=>browser.runtime.openOptionsPage());
    $('favorite-listing').addEventListener('click',async()=>{
      if(!currentListing)return;
      const button=$('favorite-listing');button.disabled=true;
      try {
        const result=await browser.runtime.sendMessage({type:'AP_HISTORY_SET_FAVORITE',
          listingKey:currentListing.listingKey,url:tab.url,title:tab.title||'',favorite:!currentListing.favorite});
        if(result?.error)throw new Error(result.error);
        currentListing=result.history.find(row=>row.listingKey===currentListing.listingKey)||null;
        renderFavoriteButton();
      } catch(error){status(error.message,true);}
      finally{button.disabled=false;}
    });
    $('fill').addEventListener('click',async () => {
      $('fill').disabled = true;
      try {
        if (!$('profile-select').value) throw new Error('Create a profile first.');
        if (current?.phase === 'review') {
          render(await send({type:'AP_CONTINUE',...reviewedAnswers()}));
        } else render(await send({type:'AP_START', profileId:$('profile-select').value, url:tab.url}));
      }
      catch(error) { status(error.message,true); }
      finally { $('fill').disabled = false; }
    });
    $('continue').addEventListener('click',async () => {
      const review = reviewedAnswers();
      $('continue').disabled = true;
      try { render(await send({type:'AP_CONTINUE',...review})); }
      catch(error) { status(error.message,true); }
      finally { $('continue').disabled = false; }
    });
    $('show-field').addEventListener('click',async()=>{
      try {await send({type:'AP_FOCUS'}); window.close();}catch(error){status(error.message,true);}
    });
    $('stop').addEventListener('click',async () => render(await send({type:'AP_STOP'})));
    $('diagnose').addEventListener('click',async()=>{
      try {
        const report=await send({type:'AP_DIAGNOSE',profileId:$('profile-select').value});
        await navigator.clipboard.writeText(JSON.stringify(report,null,1));
        status('Redacted debug report copied. Review it before sharing; it contains labels and page structure, not your saved values.');
      } catch(error) { status('Could not build report: '+error.message,true); }
    });
    $('mark-submitted').addEventListener('click',async()=> {
      if (!confirm('Only mark this application submitted if you submitted it yourself on the employer site.')) return;
      render(await send({type:'AP_SUBMITTED',url:tab.url}));
    });
    await updateDetection();
    if (tab?.id != null) render(await send({type:'AP_STATUS'}));
    // Popup closes when user clicks the page; polling is only for the currently open popup.
    setInterval(async () => {
      if (!tab?.id) return;
      try {
        const next = await send({type:'AP_STATUS'});
        if (next.phase !== current?.phase || (next.pending || []).length !== (current?.pending || []).length || next.known !== current?.known) render(next);
      } catch { /* page may be navigating */ }
    }, 1200);
  }
  init().catch(error=>status(error.message,true));
})();
