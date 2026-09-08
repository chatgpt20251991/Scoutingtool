'use strict';
// Local alpha. No external scripts, telemetry, network providers or AI calls.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (value, digits=0) => value == null ? 'Onbekend' : Number(value).toLocaleString('nl-NL', {maximumFractionDigits:digits});
const when = (value) => value ? new Date(value).toLocaleString('nl-NL', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Onbekend';
const roles = {GK:'Doelman',CB:'Centrale verdediger',CM:'Middenvelder',WG:'Vleugelspeler',ST:'Spits'};
const names = {radar:'Wereldradar',coverage:'Datadekking',tasks:'Onderzoeksopdrachten',log:'Beslislogboek',brief:'Clubvraag',imports:'Bronnen & imports'};
const covLabels = {available:'Beschikbaar',partial:'Gedeeltelijk',unknown:'Onbekend',not_connected:'Niet aangesloten',not_licensed:'Niet in licentie',unavailable:'Niet aangeleverd',delayed:'Vertraagd'};
const actionLabels = {follow:'Volgen',review_video:'Video beoordelen',observe_live:'Live observeren',verify:'Informatie verifiëren',not_prioritized:'Niet prioriteren'};
const reasonLabels = {role:'Rol past niet',budget:'Budget',registration:'Registratie',insufficient_evidence:'Onvoldoende bewijs',sporting:'Sportieve beoordeling',other:'Andere reden'};
let state = null, activeView='radar', activeTrack='all', activeContinent='', page=1, currentPlayer=null;
const pageSize=9;
let toastTimer;
function toast(message,error=false){$('#toast').textContent=message;$('#toast').className=`toast${error?' error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),5500);}

async function request(path, body){
  if(window.OMNI_PREVIEW){
    if(!body) return window.OMNI_PREVIEW;
    const s=window.OMNI_PREVIEW;
    if(path==='/api/decisions'){
      const p=s.players.find(p=>p.uid===body.player_id);if(!p)throw Error('Speler niet gevonden.');
      if(body.action==='not_prioritized'&&!body.reason)throw Error('Kies een afwijsreden.');
      const d={...body,id:s.decisions.length+1,created_at:new Date().toISOString()};s.decisions.unshift(d);p.decision=d;
    }else if(path==='/api/tasks'){
      if(!s.tasks.some(t=>t.player_id===body.player_id&&t.question===body.question&&t.status==='open'))s.tasks.unshift({...body,id:s.tasks.length+1,status:'open',created_at:new Date().toISOString()});
    }else if(path==='/api/tasks/finish'){
      const t=s.tasks.find(t=>t.id===body.id);if(t)t.status='done';
    }else if(path==='/api/brief'){s.brief=body;}
    else throw Error('Deze actie vereist de lokale Python-app. De losse preview heeft geen server of worker.');
    try{localStorage.setItem('omni-preview-v1',JSON.stringify({decisions:s.decisions,tasks:s.tasks,brief:s.brief}));}catch{}
    return {ok:true};
  }
  const options=body?{method:'POST',headers:{'Content-Type':'application/json','X-Omni-CSRF':state?.csrf_token || ''},body:JSON.stringify(body)}:{};
  const r=await fetch(path,options);let result;
  try{result=await r.json();}catch{throw Error('Ongeldig serverantwoord. Controleer of server.py draait.');}
  if(!r.ok)throw Error(result.error || 'Verzoek mislukt.');
  return result;
}
async function load(initial=false){
  state=await request('/api/state');
  if(initial){
    if(window.OMNI_PREVIEW){
      try{
        const saved=JSON.parse(localStorage.getItem('omni-preview-v1')||'null');
        if(saved){state.decisions=saved.decisions||[];state.tasks=saved.tasks||[];state.brief=saved.brief||{};
          for(const p of state.players)p.decision=state.decisions.find(d=>d.player_id===p.uid)||null;}
      }catch{}
    }
    $('#mode').value=state.players.some(p=>p.is_demo)?'demo':'real';
  }
  $('#club-name').textContent=state.brief.club||'Mijn scoutingclub';
  $('#task-count').textContent=state.tasks.filter(t=>t.status==='open').length;
  const demo=state.players.filter(p=>p.is_demo).length;
  const real=state.players.filter(p=>!p.is_demo).length;
  $('#mode-banner').textContent = window.OMNI_PREVIEW
    ? `INTERACTIEVE DEMO · ${fmt(demo)} fictieve spelersrecords. Geen echte talenten, live feeds of Codex-taak. Bewerkingen blijven alleen in deze browser.`
    : `LOKALE ALPHA · ${fmt(demo)} demorecords · ${fmt(real)} eigen importrecords · 0 live providers. Demo is fictief; eigen imports zijn niet onafhankelijk geverifieerd.`;
  $('#updated').textContent=`Overzicht: ${when(state.generated_at)}`;
  const previous=$('#country').value;
  const selectedDemo=$('#mode').value==='demo';
  const countries=[...new Set(state.competitions.filter(c=>c.is_demo===selectedDemo).map(c=>c.country))].sort();
  $('#country').innerHTML='<option value="">Alle landen</option>'+countries.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if(countries.includes(previous))$('#country').value=previous;
  renderOverview();renderRadar();renderView();
}
function selectedMode(p){return p.is_demo===($('#mode').value==='demo');}
function renderOverview(){
  const ps=state.players.filter(selectedMode);
  const cs=state.competitions.filter(selectedMode);
  const uniqueRecords=ps.filter(p=>p.identity_status!=='needs_review').length;
  const stats=[['Spelersrecords',uniqueRecords,'Geen claim over uniek wereldtalent'],['Competities in deze bronset',cs.length,'Met afzonderlijke dekkingsstatus'],['Eerst nader verkennen',ps.filter(p=>p.track==='explore').length,'Onzekerheid is geen lage kwaliteit'],['Live dataproviders',0,'Nog geen provider aangesloten']];
  $('#stats').innerHTML=stats.map(([label,n,foot])=>`<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${fmt(n)}</div><div class="stat-foot">${esc(foot)}</div></div>`).join('');
  const continents=['Europa','Afrika','Zuid-Amerika','Azië','Noord-Amerika','Oceanië'];
  $('#continents').innerHTML=continents.map((c,i)=>{
    const n=ps.filter(p=>p.continent===c).length;
    return `<button class="continent-card ${activeContinent===c?'active':''}" data-continent="${esc(c)}" aria-pressed="${activeContinent===c}"><span class="globe">${['◍','◐','◒','◓','◑','◌'][i]}</span><strong>${esc(c)}</strong><small>${n?fmt(n)+' bronrecords':'Niet aangesloten'}</small></button>`;
  }).join('');
}
function baseFiltered(){
  const q=$('#search').value.trim().toLocaleLowerCase('nl-NL');
  const country=$('#country').value,role=$('#role').value,level=Number($('#level').value)||0;
  const age=Number($('#age-max').value)||60,minString=$('#min-minutes').value,mins=minString===''?null:Number(minString);
  return state.players.filter(p=> selectedMode(p)&&(!q||`${p.name} ${p.club} ${p.competition}`.toLocaleLowerCase('nl-NL').includes(q))
    &&(!country||p.country===country)&&(!role||p.role===role)&&(!level||(p.level!=null&&p.level>=level))
    &&(!activeContinent||p.continent===activeContinent)&&p.age<=age
    &&(mins==null||(p.minutes!=null&&p.minutes>=mins))&&(!$('#unknown').checked||!p.decision));
}
function renderRadar(){
  let all=baseFiltered();
  for(const track of ['all','documented','explore'])$('#count-'+track).textContent=fmt(track==='all'?all.length:all.filter(p=>p.track===track).length);
  let ps=all.filter(p=>activeTrack==='all'||p.track===activeTrack);
  const sort=$('#sort').value;
  ps.sort((a,b)=>sort==='minutes'?((b.minutes??-1)-(a.minutes??-1)||a.name.localeCompare(b.name)):sort==='level'?((b.level??-1)-(a.level??-1)||a.name.localeCompare(b.name)):sort==='age'?(a.age-b.age||a.name.localeCompare(b.name)):a.name.localeCompare(b.name));
  const pages=Math.max(1,Math.ceil(ps.length/pageSize));page=Math.max(1,Math.min(page,pages));
  $('#results-meta').textContent=`${fmt(ps.length)} bronrecords · ${$('#mode').value==='demo'?'Fictieve demonstratie':'Eigen aangeleverde data'} · Nieuwe kandidaat betekent uitsluitend: nieuw voor deze werkruimte.`;
  $('#players').innerHTML=ps.slice((page-1)*pageSize,page*pageSize).map(card).join('')||empty('Hier zijn nog geen passende bronrecords','Dit betekent niet dat hier geen talent speelt. Bekijk de dekking of verruim je filters.');
  $('#page-number').textContent=`Pagina ${page} van ${pages}`;$('#prev').disabled=page===1;$('#next').disabled=page===pages;
}
function card(p){
  const insight=p.signals.length?p.signals[0].text:(p.track==='explore'?'Interessant om te verkennen; verifieer eerst de ontbrekende waarnemingen.':'Rolgegevens beschikbaar. Beoordeel de wedstrijdcontext voordat je conclusies trekt.');
  const short=insight.length>133?insight.slice(0,130)+'…':insight;
  const initials=p.name.split(' ').slice(0,2).map(w=>w[0]).join('');
  return `<article class="player-card"><div class="card-top"><div class="badge-row"><span class="tag ${p.track==='explore'?'amber':''}">${p.track==='explore'?'EERST VERKENNEN':'MEER GEDOCUMENTEERD'}</span>${p.is_demo?'<span class="tag demo">DEMO</span>':''}</div><span class="card-number">${esc(p.role)}</span></div>
  <div class="player-identity"><span class="avatar" aria-hidden="true">${esc(initials)}</span><div><h3>${esc(p.name)}</h3><small>${esc(roles[p.role])} · ${fmt(p.age)} jaar</small></div></div>
  <div class="player-location">${esc(p.club)}<br>${esc(p.country)} · Niveau ${fmt(p.level)}</div>
  <div class="metric-row"><div><strong>${p.per90==null?'—':fmt(p.per90,2)}</strong><span>${esc(p.metric_label)} / 90</span></div><div><strong>${p.minutes==null?'—':fmt(p.minutes)}</strong><span>Geregistreerde minuten</span></div></div>
  <p class="insight">${esc(short)}</p><div class="card-foot"><small>${p.decision?'Al beoordeeld in deze werkruimte':'Nieuw voor deze werkruimte'}</small><button class="open-player" data-player="${esc(p.uid)}">Dossier →</button></div></article>`;
}
function empty(title,body){return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;}
function heading(title,body){return `<div class="simple-heading"><p class="eyebrow">OMNI-SCOUT / ONDERZOEKSWERKPLEK</p><h1>${esc(title)}</h1><p>${esc(body)}</p></div>`;}
function view(name){if(!names[name])return;activeView=name;$$('.view').forEach(e=>e.classList.add('hidden'));$('#'+name+'-view').classList.remove('hidden');$$('.nav-item').forEach(e=>e.classList.toggle('active',e.dataset.view===name));$('#breadcrumb').textContent=names[name].toUpperCase();renderView();}
function renderView(){
  if(activeView==='coverage')renderCoverage();
  if(activeView==='tasks')renderTasks();
  if(activeView==='log')renderLog();
  if(activeView==='brief')renderBrief();
  if(activeView==='imports')renderImports();
}
function renderCoverage(){
  const dims=[['fixtures','Uitslagen'],['lineups','Opstellingen'],['minutes','Minuten'],['player_stats','Spelerstats'],['events','Events'],['tracking','Tracking'],['full_video','Volledige video']];
  $('#coverage-view').innerHTML=heading('Waar zien we genoeg?','Een competitie met uitslagen is niet automatisch statistisch gedekt. De onderstaande aantallen zijn ingelezen bronrecords, geen volledigheidspercentages.')+
  `<div class="notice">Demo en eigen imports zijn hieronder apart gelabeld. Geen van deze bronnen is een aangesloten live feed. ${state.blocked_records?fmt(state.blocked_records)+' records zijn afgeschermd door bronrechten of beschikbaarheidsdatum.':''}</div><div class="panel table-wrap"><table class="coverage-table"><thead><tr><th>Competitie / bron</th><th>Records</th>${dims.map(d=>`<th>${d[1]}</th>`).join('')}<th>Controle</th></tr></thead><tbody>${state.competitions.map(c=>`<tr><td><strong>${esc(c.name)}</strong><br><span class="muted">${esc(c.source_name)} · ${c.is_demo?'DEMO':'EIGEN IMPORT'}${!c.permitted?' · GEBLOKKEERD':''}</span></td><td>${fmt(c.record_count)}</td>${dims.map(([k])=>`<td class="cov-${esc(c.coverage[k])}">${c.permitted?esc(covLabels[c.coverage[k]]):'Rechten geblokkeerd'}</td>`).join('')}<td>${esc(when(c.checked_at))}</td></tr>`).join('')}</tbody></table>${!state.competitions.length?empty('Nog geen dekking aangesloten','Importeer toegestane data of start de app expliciet met --demo.'):''}</div>`;
}
function playerName(id){return state.players.find(p=>p.uid===id)?.name||'Speler niet beschikbaar';}
function renderTasks(){
  $('#tasks-view').innerHTML=heading('De volgende juiste vraag.','Opdrachten worden alleen lokaal voorbereid. Er wordt niets naar een speler, club of scout verstuurd en er wordt niets ingekocht.')+
  (state.tasks.map(t=>`<article class="task-card"><div class="badge-row"><span class="tag ${t.status==='open'?'amber':''}">${t.status==='open'?'OPEN ONDERZOEKSVRAAG':'AFGEROND'}</span></div><h3>${esc(playerName(t.player_id))}</h3><p>${esc(t.question)}</p><div class="task-actions"><button class="quiet-button" data-player="${esc(t.player_id)}">Open dossier</button>${t.status==='open'?`<button class="primary-button" data-finish="${t.id}">Markeer afgerond</button>`:''}<small class="muted">${esc(when(t.created_at))}</small></div></article>`).join('')||empty('Je onderzoekswerkvoorraad is leeg','Open een spelersdossier en kies “Onderzoeksopdracht klaarzetten”.'));
}
function renderLog(){
  $('#log-view').innerHTML=heading('Bewaar het waarom.','Een budgetafwijzing is geen oordeel over talent. Beslissingen en afwijsredenen worden afzonderlijk vastgelegd.')+
  (state.decisions.map(d=>`<article class="log-card"><span class="tag">${esc(actionLabels[d.action]||d.action)}</span><h3>${esc(playerName(d.player_id))}</h3><p>${d.reason?`Reden: ${esc(reasonLabels[d.reason]||d.reason)}<br>`:''}${esc(d.note||'Geen aanvullende notitie.')}</p><button class="quiet-button" data-player="${esc(d.player_id)}">Dossier openen</button><small class="muted"> · ${esc(when(d.created_at))}</small></article>`).join('')||empty('Nog geen beslissingen vastgelegd','Je onafhankelijke beoordeling blijft naast de onderzoeksaanbeveling bewaard.'));
}
function renderBrief(){
  $('#brief-view').innerHTML=heading('Wat mist jouw team?','Leg concrete taken vast, niet alleen een positie. Deze alpha bewaart de clubvraag en kan op rol filteren; hij claimt nog geen automatische tactische match.')+
  `<form id="brief-form" class="panel form-grid"><label>Club / werkruimte<input name="club" maxlength="200" required value="${esc(state.brief.club||'Mijn scoutingclub')}"></label><label>Gezochte rol<select name="role"><option value="">Nog geen vaste rol</option>${Object.entries(roles).map(([k,v])=>`<option value="${k}" ${state.brief.role===k?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label class="wide">Taken, context en ontbrekende kwaliteiten<textarea name="tasks" maxlength="2000" placeholder="Bijvoorbeeld: ruimte achter een hoge verdediging bewaken en onder druk de eerste linie overspelen.">${esc(state.brief.tasks||'')}</textarea></label><p class="muted wide">Vrije tekst wordt niet naar een AI-dienst gestuurd. Voor tactische conclusies blijft concrete observatie nodig.</p><button class="primary-button" type="submit">Clubvraag bewaren</button><button class="quiet-button" type="button" id="apply-brief">Rol toepassen op radar →</button></form>`;
}
function renderImports(){
  $('#imports-view').innerHTML=heading('Echte informatie begint bij de bron.','Importeer alleen gegevens waarvoor je verwerking, opslag, weergave en analyse mag uitvoeren. Een aangevinkt vakje is jouw verklaring, geen juridische verificatie.')+
  `<div class="notice">${window.OMNI_PREVIEW?'Losse preview: imports en workers zijn niet beschikbaar. Start server.py uit de broncode voor de werkende importwachtrij.':'Deze alpha heeft geen betaalde provider, scraper, AI-koppeling of automatisch draaiende cloudworker. Imports worden in een lokale wachtrij geplaatst.'}</div><div class="import-grid"><div class="panel"><h2>Gecontroleerde JSON-import</h2><p class="muted">Gebruik samples/import-demo.json als schema. Maximaal 4 MB en 3.000 records per bestand. Een eigen echte bron blijft apart van demodata.</p><form id="import-form"><label>Importbestand<input id="import-file" type="file" accept=".json,application/json" required></label><label class="check-label"><input id="rights-check" type="checkbox" required>Ik heb de bronrechten gecontroleerd en ben bevoegd deze data te verwerken.</label><p class="record-note">De bron moet ook een licentieomschrijving, verloopdatum, afzonderlijke rechten en bewijsverwijzingen bevatten. Minderjarigen worden niet geïmporteerd.</p><button class="primary-button" type="submit" ${window.OMNI_PREVIEW?'disabled':''}>Import in wachtrij plaatsen</button></form><hr><div class="panel-title"><h2>Importworker</h2><button id="run-worker" class="quiet-button" ${window.OMNI_PREVIEW?'disabled':''}>Verwerk één import</button></div><div id="job-list">${state.jobs.map(j=>`<div class="source-card"><strong>Import #${j.id} · ${esc(j.status)}</strong><p>Pogingen: ${j.attempts}${j.error?' · '+esc(j.error):''}</p>${j.status==='failed'&&j.attempts<3?`<button class="quiet-button" data-retry="${j.id}">Opnieuw klaarzetten</button>`:''}</div>`).join('')||'<p class="muted">Geen imports in de wachtrij.</p>'}</div></div><div class="panel"><h2>Bronnenregister</h2>${state.sources.map(s=>`<div class="source-card"><span class="tag ${s.is_demo?'demo':''}">${s.is_demo?'DEMO':'EIGEN IMPORT'}</span><h3>${esc(s.name)}</h3><p>Toegang: ${s.display_permitted?'toegestaan volgens eigen verklaring':'geblokkeerd'}<br>Rechten tot: ${esc(when(s.license_expires_at))}</p></div>`).join('')||'<p class="muted">Geen bronnen geïmporteerd.</p>'}<h2>Wat gebeurt er niet?</h2><p class="muted">Geen automatisch contractadvies, geen nieuwe betaalde abonnementen, geen externe berichten en geen ongeautoriseerde gegevensverzameling.</p></div></div>`;
}
function openPlayer(id){
  const p=state.players.find(p=>p.uid===id);if(!p){toast('Dossier niet beschikbaar.',true);return;}
  currentPlayer=id;
  const signals=p.signals.length?p.signals.map(s=>`<li>${esc(s.text)}</li>`).join(''):'<li>Geen aanvullende opvallendheidsclaim op basis van de huidige brongegevens.</li>';
  const cohort=p.percentile==null?`Geen percentiel gepubliceerd: ${p.cohort_n} voldoende gedocumenteerde vergelijkbare bronrecords; minimaal vijf vereist.`:`P${p.percentile} binnen ${p.cohort_n} bronrecords met dezelfde competitie, rol, seizoen en meetdefinitie. Dit is géén talentcijfer en geen vergelijking met een ander competitieniveau.`;
  $('#dossier-content').innerHTML=`<header class="dossier-header"><div class="badge-row">${p.is_demo?'<span class="tag amber">FICTIEVE DEMOSPELER</span>':'<span class="tag">EIGEN BRONIMPORT</span>'}<span class="tag">${p.track==='explore'?'EERST VERKENNEN':'MEER GEDOCUMENTEERD'}</span></div><h2 id="dossier-title">${esc(p.name)}</h2><p>${esc(roles[p.role])} · ${p.age} jaar · ${esc(p.club)}<br>${esc(p.competition)} · ${esc(p.season)}</p></header>
  <div class="dossier-grid"><section class="dossier-section"><h3>01 / Wat is geregistreerd?</h3><div class="metric-row"><div><strong>${p.per90==null?'—':fmt(p.per90,2)}</strong><span>${esc(p.metric_label)} per 90</span></div><div><strong>${p.minutes==null?'—':fmt(p.minutes)}</strong><span>Minuten · ${fmt(p.appearances)} wedstrijden</span></div></div><p>${esc(p.metric_label)} totaal: ${fmt(p.metric_total)}</p><p>${esc(cohort)}</p><p class="source-detail">Definitie: ${esc(p.metric_definition)}</p></section>
  <section class="dossier-section"><h3>02 / Waarom nader onderzoeken?</h3><ul>${signals}</ul><p>Nieuwheid betekent uitsluitend dat in deze werkruimte nog geen eerdere beoordeling is vastgelegd. Andere scouts kunnen deze speler al kennen.</p></section>
  <section class="dossier-section"><h3>03 / Tegenbewijs & onzekerheden</h3><ul>${p.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul><p>${esc(p.feasibility)}</p></section>
  <section class="dossier-section"><h3>04 / Controleer de bron</h3><p><strong>${esc(p.source_name)}</strong></p><p class="source-detail">Bewijslocatie: ${esc(p.evidence_locator)}</p><p class="source-detail">Gebeurtenis: ${esc(when(p.event_at))}<br>Publicatie: ${esc(when(p.published_at))}<br>Opgehaald: ${esc(when(p.retrieved_at))}<br>Beschikbaar: ${esc(when(p.available_at))}</p><p>Identiteit: ${esc(p.identity_status)}. Geen automatische naamfusie.</p></section>
  <section class="dossier-section dossier-wide"><h3>05 / De volgende onderzoeksvraag</h3><p>${esc(p.next_question)}</p><div class="dossier-actions"><button class="primary-button" id="prepare-task">Onderzoeksopdracht klaarzetten</button><button class="quiet-button" id="export-player">Dossier exporteren</button></div></section>
  <section class="dossier-section dossier-wide"><h3>06 / Jouw beoordeling</h3><p>Dit is een menselijke onderzoeksbeslissing, geen geautomatiseerde contractbeslissing.</p><form id="decision-form" class="form-grid"><label>Vervolgactie<select name="action">${Object.entries(actionLabels).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label>Reden (verplicht bij niet prioriteren)<select name="reason"><option value="">Geen afwijzing / nog niet gekozen</option>${Object.entries(reasonLabels).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label class="wide">Eigen notitie<textarea name="note" maxlength="2000" placeholder="Wat heb je zelf gezien? Welke onzekerheid blijft bestaan?"></textarea></label><button class="primary-button" type="submit">Beoordeling vastleggen</button></form></section></div>`;
  if(!$('#dossier').open)$('#dossier').showModal();
}
function exportPlayer(){
  const p=state.players.find(p=>p.uid===currentPlayer);
  if(window.OMNI_PREVIEW){
    const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),disclaimer:'Fictieve preview. Geen echte speler of talentvoorspelling.',player:p},null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='omni-scout-demo-dossier.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }else window.location.assign('/api/export?id='+encodeURIComponent(currentPlayer));
}
async function mutate(path,body,message){await request(path,body);await load();toast(message);}
function resetFilters(){for(const id of ['search','country','role','level','min-minutes'])$('#'+id).value='';$('#age-max').value=30;$('#sort').value='name';$('#unknown').checked=false;activeContinent='';page=1;renderOverview();renderRadar();}

for(const id of ['search','country','role','level','age-max','min-minutes','unknown','sort'])$('#'+id).addEventListener('input',()=>{page=1;renderRadar();});
$('#mode').addEventListener('change',()=>{activeContinent='';resetFilters();load().catch(e=>toast(e.message,true));});
$('#prev').addEventListener('click',()=>{page--;renderRadar();});$('#next').addEventListener('click',()=>{page++;renderRadar();});
$('#reset-filters').addEventListener('click',resetFilters);
$('#refresh').addEventListener('click',()=>load().then(()=>toast('Lokaal overzicht vernieuwd. Er zijn geen externe bronnen opgehaald.')).catch(e=>toast(e.message,true)));
$('#close-dossier').addEventListener('click',()=>$('#dossier').close());
$('#dossier').addEventListener('click',e=>{if(e.target===$('#dossier')){const r=$('#dossier').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#dossier').close();}});
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b)return;
  try{
    if(b.dataset.view){view(b.dataset.view);return;}
    if(b.dataset.continent){activeContinent=activeContinent===b.dataset.continent?'':b.dataset.continent;page=1;renderOverview();renderRadar();return;}
    if(b.dataset.track){activeTrack=b.dataset.track;page=1;$$('.track-tab').forEach(t=>{t.classList.toggle('active',t.dataset.track===activeTrack);t.setAttribute('aria-selected',String(t.dataset.track===activeTrack));});renderRadar();return;}
    if(b.dataset.player){openPlayer(b.dataset.player);return;}
    if(b.dataset.finish){await mutate('/api/tasks/finish',{id:Number(b.dataset.finish)},'Opdracht lokaal afgerond.');return;}
    if(b.dataset.retry){await mutate('/api/jobs/retry',{id:Number(b.dataset.retry)},'Import opnieuw klaargezet.');return;}
    if(b.id==='prepare-task'){
      b.disabled=true;const p=state.players.find(p=>p.uid===currentPlayer);
      await mutate('/api/tasks',{player_id:p.uid,question:p.next_question},'Onderzoeksvraag klaargezet. Er is niets verstuurd.');b.disabled=false;return;
    }
    if(b.id==='export-player'){exportPlayer();return;}
    if(b.id==='run-worker'){b.disabled=true;const r=await request('/api/worker/run',{});await load();toast(r.status==='idle'?'Geen import in de wachtrij.':r.status==='failed'?'Import mislukt: '+r.error:'Import verwerkt; bronrecords zijn bijgewerkt.',r.status==='failed');return;}
    if(b.id==='apply-brief'){$('#role').value=state.brief.role||'';page=1;view('radar');renderRadar();return;}
  }catch(e){b.disabled=false;toast(e.message,true);}
});
document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target;const submit=form.querySelector('[type=submit]');if(submit)submit.disabled=true;
  try{
    if(form.id==='brief-form'){const b=Object.fromEntries(new FormData(form));await mutate('/api/brief',b,'Clubvraag lokaal bewaard.');}
    if(form.id==='decision-form'){
      const b=Object.fromEntries(new FormData(form));if(b.action==='not_prioritized'&&!b.reason)throw Error('Kies eerst een afwijsreden.');
      await mutate('/api/decisions',{...b,player_id:currentPlayer},'Beoordeling met reden vastgelegd.');$('#dossier').close();
    }
    if(form.id==='import-form'){
      if(!$('#rights-check').checked)throw Error('Bevestig eerst je verwerkingsrechten.');
      const file=$('#import-file').files[0];if(!file)throw Error('Selecteer een JSON-bestand.');if(file.size>4*1024*1024)throw Error('Bestand is groter dan 4 MB.');
      let b;try{b=JSON.parse(await file.text());}catch{throw Error('Het bestand bevat geen geldige JSON.');}
      await mutate('/api/imports',b,'Import gevalideerd en in de wachtrij. Kies “Verwerk één import”.');
    }
  }catch(e){toast(e.message,true);}finally{if(submit)submit.disabled=false;}
});
load(true).catch(e=>{$('#mode-banner').textContent='Niet verbonden: '+e.message;$('#players').innerHTML=empty('Start de lokale app','Open de app via python server.py --demo, of gebruik de losse interactieve preview.');});
