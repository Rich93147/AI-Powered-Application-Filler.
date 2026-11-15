/* Shared data model: extension pages and the background script only. */
(function (g) {
  'use strict';
  const SETTINGS = {
    autoFill: true, autoNext: true, reviewGenerated: true,
    routineAgreements: true, useDemographics: true, learnAnswers: true,
    recommendProfile: true, duplicateWarnings: true,
    useBrowserHistory: false, salaryLookup: true,
    rejectForeignSpyRagebait: false,
    localAI: true, localModel: 'llama3.2:3b'
  };
  const makeProfile = (id, title, focus) => ({
    id, title, focus, summary: '', skills: '', targetRoles: '', specialties: '', strengths: '',
    highlights: '', preferredProjects: '', approach: '', avoidClaims: '', resumeName: '',
    education: [], experience: [], projects: []
  });
  const INITIAL = {
    version: 2, personal: {}, profiles: [], activeProfileId: '',
    settings: SETTINGS, answers: {}, answerMeta: {}, ignoredQuestions: [], learnedIntents: {}, history: []
  };
  const HISTORY_STATUSES = ['opened','in_progress','completed'];
  function normalizeHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const url = safeListingUrl(entry.url);
    const key = url ? listingKey(url) : String(entry.listingKey || '').split('?')[0];
    if (!key) return null;
    const rawStatus = String(entry.status || '').toLowerCase();
    const status = HISTORY_STATUSES.includes(rawStatus) ? rawStatus :
      /submitted|completed|success/.test(rawStatus) ? 'completed' :
      /progress|review|paused|started/.test(rawStatus) ? 'in_progress' : 'opened';
    const date = entry.date || entry.updatedAt || new Date().toISOString();
    return {
      listingKey:key, url, title:String(entry.title || '').slice(0,180),
      profileId:String(entry.profileId || ''), status,
      // Favorite is orthogonal to application status. An Opened listing can be
      // favorited without becoming In progress or Completed.
      favorite:entry.favorite === true || entry.isFavorite === true,
      favoritedAt:(entry.favorite === true || entry.isFavorite === true) ? String(entry.favoritedAt || date) : '',
      firstOpenedAt:entry.firstOpenedAt || date,
      lastOpenedAt:entry.lastOpenedAt || entry.firstOpenedAt || date,
      startedAt:entry.startedAt || (status !== 'opened' ? date : ''),
      completedAt:entry.completedAt || (status === 'completed' ? date : ''),
      completionSource:String(entry.completionSource || (status==='completed'?'user-confirmed':'')),
      updatedAt:entry.updatedAt || date
    };
  }
  function recordApplication(history, update, at = new Date().toISOString()) {
    const list = (Array.isArray(history) ? history : []).map(normalizeHistoryEntry).filter(Boolean);
    const url = safeListingUrl(update.url);
    const key = String(update.listingKey || listingKey(url));
    if (!key) return list;
    const existing = list.find(row => row.listingKey === key);
    const requested = HISTORY_STATUSES.includes(update.status) ? update.status : 'opened';
    if (existing) {
      // A visit or another autofill run must never silently undo a completed application.
      const effective = existing.status === 'completed' && !update.manualOverride ? 'completed' : requested;
      if (update.manualOverride || existing.status !== 'in_progress' || requested !== 'opened') existing.status = effective;
      if (url) existing.url = url;
      if (update.title && !/[@\r\n]/.test(update.title)) existing.title = String(update.title).slice(0,180);
      if (update.profileId) existing.profileId = update.profileId;
      if (typeof update.favorite === 'boolean') {
        existing.favorite = update.favorite;
        existing.favoritedAt = update.favorite ? (existing.favoritedAt || at) : '';
      }
      if (requested === 'opened') existing.lastOpenedAt = at;
      if (requested === 'in_progress' && !existing.startedAt) existing.startedAt = at;
      if (requested === 'completed') {
        existing.completedAt = at;
        existing.completionSource = update.completionSource || 'user-confirmed';
      }
      if (update.manualOverride && requested !== 'completed') { existing.completedAt=''; existing.completionSource=''; }
      existing.updatedAt = at;
    } else {
      list.unshift(normalizeHistoryEntry({listingKey:key,url,title:update.title||'',profileId:update.profileId||'',
        status:requested,favorite:update.favorite === true,
        favoritedAt:update.favorite === true ? at : '',firstOpenedAt:at,lastOpenedAt:at,
        startedAt:requested==='opened'?'':at,
        completedAt:requested==='completed'?at:'',
        completionSource:requested==='completed'?(update.completionSource||'user-confirmed'):'',updatedAt:at}));
    }
    return list.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    // Do not show untouched factory-generated SWE/ML profiles as user data.
    const profiles=(Array.isArray(source.profiles) ? source.profiles : []).filter(profile => {
      if (!['swe','ml'].includes(profile.id)) return true;
      const populated=Boolean(profile.summary || profile.skills || profile.resumeName ||
        profile.education?.length || profile.experience?.length || profile.projects?.length);
      return populated || !source.version;
    });
    const personal=source.personal && typeof source.personal==='object' ? {...source.personal} : {};
    // Preserve the existing explicitly confirmed U.S.-citizenship selection.
    // Never assume that this is the user's *only* citizenship.
    if(!Array.isArray(personal.citizenships))personal.citizenships=personal.citizenship==='Yes'?['United States']:[];
    if(personal.citizenshipsComplete!==true)personal.citizenshipsComplete=false;
    return {
      version: 2,
      personal,
      profiles,
      activeProfileId: profiles.some(x=>x.id===source.activeProfileId) ? source.activeProfileId : (profiles[0]?.id||''),
      settings: { ...SETTINGS, ...Object.fromEntries(Object.entries(source.settings || {}).filter(([key]) => key in SETTINGS)) },
      answers: source.answers && typeof source.answers === 'object' ? source.answers : {},
      answerMeta: source.answerMeta && typeof source.answerMeta === 'object' ? source.answerMeta : {},
      ignoredQuestions: Array.isArray(source.ignoredQuestions) ? source.ignoredQuestions.filter(rule=>
        rule && typeof rule.key==='string' && /^(?:question:|field:)/.test(rule.key) && rule.key.length<=260)
        .slice(0,500).map(rule=>({key:rule.key,label:String(rule.label||'Optional question').slice(0,240),
          createdAt:String(rule.createdAt||'')})) : [],
      learnedIntents: Object.fromEntries(Object.entries(source.learnedIntents && typeof source.learnedIntents==='object' ? source.learnedIntents : {})
        .filter(([k,v])=>typeof k==='string' && k.length>0 && k.length<=200 && /^[A-Za-z0-9]{2,40}$/.test(String(v))).slice(0,500)),
      history: Array.isArray(source.history) ? source.history.map(normalizeHistoryEntry).filter(Boolean) : []
    };
  }
  async function getState() {
    const result = await browser.storage.local.get(['applicationfiller_state', 'applypilot_state']);
    return normalize(result.applicationfiller_state || result.applypilot_state);
  }
  async function saveState(state) {
    const normalized = normalize(state);
    await browser.storage.local.set({ applicationfiller_state: normalized });
    return normalized;
  }
  function profileFor(state, id) {
    return state.profiles.find(p => p.id === id) || state.profiles[0] || null;
  }
  function normalizedQuestion(value) {
    return String(value || '').toLowerCase().replace(/\b(required|optional)\b/g, '')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  }
  // Candidate URLs frequently contain email/login/session tokens. Do not persist them.
  const LISTING_PARAMS = ['gh_jid','job_id','jobId','requisitionId','req_id','jid','location','loc','city','office'];
  function safeListingUrl(url) {
    try {
      const u = new URL(url);
      if (!['https:','http:'].includes(u.protocol)) return '';
      const kept = new URLSearchParams();
      for (const name of LISTING_PARAMS) if (u.searchParams.has(name)) kept.set(name,u.searchParams.get(name));
      u.search = kept.toString(); u.hash = '';
      return u.toString();
    } catch { return ''; }
  }
  function listingKey(url) {
    const safe = safeListingUrl(url);
    if (!safe) return '';
    const u = new URL(safe);
    const id = ['gh_jid','job_id','jobId','requisitionId','req_id','jid'].map(k=>u.searchParams.get(k)).find(Boolean);
    const location = ['location','loc','city','office'].map(k=>u.searchParams.get(k)).find(Boolean);
    // iCIMS requisition IDs are generally embedded directly in /jobs/NNNN/.
    const atsPathId=u.pathname.match(/\/(?:jobs?|requisitions?)\/(\d+)(?:\/|$)/i)?.[1];
    const path=u.pathname.replace(/\/(?:apply|application|candidate|review|confirmation|thank-you)\/?$/i,'').replace(/\/$/,'');
    return `${u.hostname}|${id ? 'requisition:'+id : atsPathId ? 'job:'+atsPathId : path}`+
      `${location ? '|location:'+location.toLowerCase() : ''}`;
  }
  // Metadata stays separate from the legacy string-valued answers map, preserving
  // existing autofill behavior while making each learned response auditable.
  function learnedItems(state) {
    const answers = state?.answers || {};
    const metadata = state?.answerMeta || {};
    return Object.entries(answers).filter(([key, value]) =>
      typeof value === 'string' && value.trim() && key.includes('|')).map(([key, value]) => {
      const sep=key.indexOf('|');
      const isListing=key.includes('|listing:');
      const roleId=key.slice(0,sep);
      const fallback=key.slice(sep+1).split('|listing:')[0];
      const meta=metadata[key] || {};
      return {key, question:String(meta.question || fallback), answer:value,
        roleId:String(meta.roleId || roleId), listingKey:meta.listingKey || (isListing ? key.split('|listing:')[1] : ''),
        scope:isListing?'listing':'profile', source:meta.source || 'Previous answer',
        createdAt:meta.createdAt || '', updatedAt:meta.updatedAt || '',
        category:meta.category || 'general', canonicalField:meta.canonicalField || '',
        entityId:meta.entityId || '',section:meta.section || '',conflict:meta.conflict || ''};
    }).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.question.localeCompare(b.question));
  }
  function storeLearnedAnswer(state, {key, question, answer, roleId='', listingKey='', source='Reviewed application answer',
    category='',canonicalField='',entityId='',section='',conflict=''} = {}) {
    const value=String(answer ?? '').trim();
    if (!key || !key.includes('|') || !value || value.length > 8000) throw new Error('Invalid learned answer.');
    if (!state.answers || typeof state.answers!=='object') state.answers={};
    if (!state.answerMeta || typeof state.answerMeta!=='object') state.answerMeta={};
    const now=new Date().toISOString();
    const previous=state.answerMeta[key] || {};
    state.answers[key]=value;
    state.answerMeta[key]={question:String(question || previous.question || key.split('|')[1]).slice(0,500),
      roleId:String(roleId || previous.roleId || key.split('|')[0]),
      listingKey:String(listingKey || previous.listingKey || '').slice(0,400),
      source:String(source),createdAt:previous.createdAt || now,updatedAt:now,
      category:category||previous.category||'general',canonicalField:canonicalField||previous.canonicalField||'',
      entityId:entityId||previous.entityId||'',section:section||previous.section||'',
      conflict:conflict||''};
    return state.answerMeta[key];
  }
  function deleteLearnedAnswer(state, key) {
    if(!Object.hasOwn(state.answers||{},key))return false;
    delete state.answers[key];
    if(state.answerMeta)delete state.answerMeta[key];
    return true;
  }
  function openResumeDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('applypilot-resumes', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function putResume(profileId, file) {
    const db = await openResumeDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put({ name: file.name, mime: file.type || 'application/octet-stream', blob: file }, profileId);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  async function getResume(profileId) {
    const db = await openResumeDb();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction('files').objectStore('files').get(profileId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }
  async function removeResume(profileId) {
    const db = await openResumeDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(profileId);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  g.ApplicationFillerData = { SETTINGS, INITIAL, getState, saveState, profileFor, normalizedQuestion,
    listingKey, safeListingUrl, normalizeHistoryEntry, recordApplication, HISTORY_STATUSES,
    learnedItems, storeLearnedAnswer, deleteLearnedAnswer, putResume, getResume, removeResume };
})(globalThis);
