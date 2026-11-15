/* Deterministic import review: AI extracts facts, the user decides conflicting updates. */
(function (root) {
'use strict';
const str=v=>typeof v==='string'?v.trim():'';
const clean=v=>str(v).replace(/\s+/g,' ');
const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
const words=v=>new Set(clean(v).toLowerCase().split(/[^a-z0-9+#.]+/).filter(t=>t.length>2));
const pick=keys=>x=>Object.fromEntries(keys.map(k=>[k,str(x?.[k])]));
const edu=pick(['school','degree','graduation','gpa']);
const job=pick(['title','company','dates','details']);
const project=pick(['name','technologies','role','dates','summary','details','impact','link']);
const generic=/^(full[- ]?stack project|individual project|academic project|student project|intro(duction)? to .+|personal project|course project)$/i;
function unionSkills(...values){const seen=new Set(), out=[];
  values.forEach(v=>str(v).split(/[,;\n]+/).forEach(raw=>{const s=clean(raw),k=norm(s);if(k&&!seen.has(k)){seen.add(k);out.push(s);}}));
  return out.join(', ');
}
function similarity(a,b){const A=words(a),B=words(b);if(!A.size||!B.size)return 0;let n=0;for(const t of A)if(B.has(t))n++;return n/Math.min(A.size,B.size);}
function mergeDetails(a,b){const old=str(a),fresh=str(b);if(!fresh||generic.test(fresh))return old;
  if(!old||generic.test(old))return fresh;
  if(norm(old)===norm(fresh)||old.toLowerCase().includes(fresh.toLowerCase()))return old;
  if(fresh.toLowerCase().includes(old.toLowerCase()))return fresh;
  const parts=old.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(s=>s.trim()).filter(Boolean);
  for(const sentence of fresh.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(s=>s.trim()).filter(Boolean)){
    if(!parts.some(s=>norm(s)===norm(sentence)||similarity(s,sentence)>0.86))parts.push(sentence);
  }
  return parts.join('\n');
}
function projectLikeExperience(e){const title=clean(e.title),company=clean(e.company);
  return /\b(personal|academic|class|coursework|capstone|side|portfolio|school)\b.*\bprojects?\b|\bprojects?\b.*\b(personal|academic|class|coursework|capstone|side|portfolio|school)\b/i.test(title) ||
  /^(project|projects|personal\/academic projects?)$/i.test(title) || /\b(personal|academic|student|school)\s+projects?\b/i.test(company);
}
function normalizeImport(raw){const x=raw&&typeof raw==='object'?raw:{};
 const projects=(Array.isArray(x.projects)?x.projects:[]).map(project).filter(p=>p.name||p.details);
 const experience=[];let reclassified=0;
 for(const value of (Array.isArray(x.experience)?x.experience:[])){
  const entry=job(value);if(!entry.title&&!entry.company&&!entry.details)continue;
  if(projectLikeExperience(entry)){
   reclassified++;
   const targets=projects.filter(p=>clean(p.name).length>=5&&clean(entry.details).toLowerCase().includes(clean(p.name).toLowerCase()));
   let target=targets.length===1?targets[0]:null;
   if(!target && targets.length===0) {
     const ranked=projects.map(p=>({p,score:similarity(p.technologies,entry.details)})).sort((a,b)=>b.score-a.score);
     if(ranked[0]?.score>=0.5 && (ranked.length===1 || ranked[0].score-ranked[1].score>=0.18))target=ranked[0].p;
   }
   if(target){target.details=mergeDetails(target.details,entry.details);if(!target.dates)target.dates=entry.dates;}
   else projects.push(project({name:'Imported project — review name',details:entry.details,dates:entry.dates}));
  }else experience.push(entry);
 }
 const r=x.roleFocus&&typeof x.roleFocus==='object'?x.roleFocus:{};
 return {summary:str(x.summary),skills:unionSkills(str(x.skills)),
 education:(Array.isArray(x.education)?x.education:[]).map(edu).filter(e=>e.school||e.degree),experience,projects,
 roleFocus:pick(['targetRoles','specialties','strengths','highlights','preferredProjects','approach'])(r),stats:{reclassified}};
}
function mergeExtracted(profile,raw,approvals=[]){const src=normalizeImport(raw), approved=new Set(approvals);
 const out={...profile,education:(profile.education||[]).map(x=>({...x})),experience:(profile.experience||[]).map(x=>({...x})),projects:(profile.projects||[]).map(x=>({...x}))};
 const changes={added:[],enriched:[],conflicts:[]};
 const set=(obj,key,value,path,label,kind='scalar')=>{const fresh=str(value);if(!fresh)return;
   const old=str(obj[key]);if(!old){obj[key]=fresh;changes.enriched.push(label);return;}
   if(norm(old)===norm(fresh))return;
   if(kind==='text'){const next=mergeDetails(old,fresh);if(old!==next){obj[key]=next;changes.enriched.push(label);}return;}
   const id=path+'.'+key;changes.conflicts.push({id,label,current:old,proposed:fresh});
   if(approved.has(id)){obj[key]=fresh;changes.enriched.push(label+' (updated)');}
 };
 out.skills=unionSkills(profile.skills,src.skills);
 if(norm(out.skills)!==norm(profile.skills))changes.enriched.push('Technical skills');
 if(!out.summary&&src.summary){out.summary=src.summary;changes.enriched.push('Professional summary');}
 for(const entry of src.education){const i=out.education.findIndex(x=>norm(x.school)===norm(entry.school)&&!!norm(entry.school));
  if(i<0){out.education.push(entry);changes.added.push('Education: '+(entry.school||entry.degree));continue;}
  for(const k of ['degree','graduation','gpa'])set(out.education[i],k,entry[k],`education.${i}`,`Education: ${entry.school} — ${k}`);
 }
 for(const entry of src.experience){const i=out.experience.findIndex(x=>norm(x.title)===norm(entry.title)&&norm(x.company)===norm(entry.company)&&!!norm(entry.title));
  if(i<0){out.experience.push(entry);changes.added.push('Employment: '+[entry.title,entry.company].filter(Boolean).join(' at '));continue;}
  set(out.experience[i],'dates',entry.dates,`experience.${i}`,'Employment dates: '+entry.title);
  set(out.experience[i],'details',entry.details,`experience.${i}`,'Work description: '+entry.title,'text');
 }
 for(const entry of src.projects){const i=out.projects.findIndex(x=>norm(x.name)===norm(entry.name)&&!!norm(entry.name));
  if(i<0){out.projects.push(entry);changes.added.push('Project: '+entry.name);continue;}
  const p=out.projects[i],tech=unionSkills(p.technologies,entry.technologies);
  if(norm(tech)!==norm(p.technologies)){p.technologies=tech;changes.enriched.push('Technologies: '+entry.name);}
  for(const k of ['role','dates','link'])set(p,k,entry[k],`projects.${i}`,`Project: ${entry.name} — ${k}`);
  for(const k of ['summary','details','impact'])set(p,k,entry[k],`projects.${i}`,`Project description: ${entry.name}`,'text');
 }
 for(const [k,v] of Object.entries(src.roleFocus))if(!out[k]&&v)out[k]=v;
 return {profile:out,changes,stats:src.stats};
}
function auditExisting(profile){const entries=(profile.experience||[]).filter(projectLikeExperience);return {count:entries.length,entries};}
function repairExisting(profile){const filtered=(profile.experience||[]).filter(x=>!projectLikeExperience(x));
 const src=normalizeImport({projects:profile.projects,experience:(profile.experience||[]).filter(projectLikeExperience)});
 return mergeExtracted({...profile,experience:filtered,projects:[]},src).profile;
}
root.ApplicationFillerImport={normalizeImport,mergeExtracted,auditExisting,repairExisting,projectLikeExperience,unionSkills,mergeDetails};
})(globalThis);
