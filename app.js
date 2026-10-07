// =====================================================================
// Pilotage — Ouverture des centres de prélèvement — CHR Verviers
// app.js — logique de l'application. Toutes les données métier vivent
// dans data.json ; ce fichier ne doit normalement pas être modifié pour
// ajouter/modifier un centre, une tâche ou une commande.
// =====================================================================

// ---- CONFIG : réglages modulables sans toucher à la logique ----
const CONFIG = {
  dataUrl: "data.json",
  apiUrl: "/api/data",
  storageKeyPrefix: "pilotage-chrv", // suffixé par la version ci-dessous
  storageVersion: "v1",
  editPasswordKey: "pilotage-chrv-edit-pw",
  timelineStart: "2026-08-24",
  timelineEnd: "2027-03-01",
  lateWarningDays: 14,       // seuil "à surveiller" avant une échéance
  soonToOpenDays: 7,         // seuil "prêt à ouvrir"
};
const STORAGE_KEY = `${CONFIG.storageKeyPrefix}-${CONFIG.storageVersion}`;

let DATA = null;
let state = { taskStatus:{}, orderStatus:{} };

const STATUS_LABEL = {todo:"À faire", doing:"En cours", done:"Fait", blocked:"Bloqué"};
const STATUS_COLOR_VAR = {todo:"amber", doing:"blue", done:"green", blocked:"red"};
const ORDER_LABEL = {a_commander:"À commander", commande:"Commandé", livre:"Livré", na:"Non nécessaire"};


function parseISO(s){ const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function fmtFR(s){ const d=parseISO(s); return d.toLocaleDateString("fr-BE",{day:"2-digit",month:"2-digit",year:"2-digit"}); }
function diffDays(a,b){ return Math.round((a-b)/86400000); }
let TODAY;

let TASK_IDX = {};
let ORDER_IDX = {};
// Anciennes données : le champ "info" est séparé en fournisseur + descriptif.
function normOrder(o){
  if(o.fournisseur===undefined && o.descriptif===undefined){
    const info=(o.info||"").trim();
    let m=info.match(/^(.*?)\s*-\s*(Ecopostural)$/);
    if(m){ o.fournisseur=m[2]; o.descriptif=m[1]; }
    else{
      m=info.match(/^(IKEA|Hubo|DE LONGHI|PHILIPS|Vistaprint|P&P)\b\s*(.*)$/);
      o.fournisseur = m? m[1] : "";
      o.descriptif = m? m[2].replace(/^[-–]\s*/,"") : info;
    }
  }
  if(o.descriptif===undefined) o.descriptif="";
  if(o.fournisseur===undefined) o.fournisseur="";
  if(o.url===undefined) o.url="";
  if(o.reference===undefined) o.reference="";
  delete o.info;
}
function esc(v){ return String(v==null?"":v).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }
function safeUrl(u){ u=(u||"").trim(); if(!u) return ""; if(!/^https?:\/\//i.test(u)) u="https://"+u; return u; }
function mapsLink(a){ return "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(a); }
function addrHtml(c, withEmpty){
  const a=(c.adresse||"").trim();
  if(!a) return withEmpty? `<div class="addr empty">📍 Adresse à renseigner (onglet Édition)</div>` : "";
  return `<div class="addr">📍 ${esc(a)} <a href="${esc(mapsLink(a))}" target="_blank" rel="noopener noreferrer">Voir sur la carte ↗</a></div>`;
}
function buildIndexes(){
  TASK_IDX = {}; ORDER_IDX = {};
  DATA.centers.forEach(c=>{
    if(c.adresse===undefined) c.adresse="";
    if(c.note===undefined) c.note="";
    c.tasks.forEach(t=>TASK_IDX[t.id]={c,t});
    c.orders.forEach(o=>{ normOrder(o); ORDER_IDX[o.id]={c,o}; });
  });
}

async function loadState(){
  try{
    if(window.storage && window.storage.get){
      const r = await window.storage.get(STORAGE_KEY, true);
      if(r && r.value) return JSON.parse(r.value);
      return { taskStatus:{}, orderStatus:{} };
    }
  }catch(e){ /* fall through to localStorage */ }
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ /* private browsing / storage disabled */ }
  return { taskStatus:{}, orderStatus:{} };
}
async function saveState(){
  try{
    if(window.storage && window.storage.set){
      await window.storage.set(STORAGE_KEY, JSON.stringify(state), true);
      return;
    }
  }catch(e){ /* fall through to localStorage */ }
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch(e){ console.error("Erreur de sauvegarde", e); }
}
function applyState(){
  Object.entries(state.taskStatus).forEach(([id,st])=>{ if(TASK_IDX[id]) TASK_IDX[id].t.status = st; });
  Object.entries(state.orderStatus).forEach(([id,st])=>{ if(ORDER_IDX[id]) ORDER_IDX[id].o.status = st; });
}

function centerPhaseNow(c){
  const real = c.tasks.filter(t=>!t.milestone);
  const cur = real.find(t=> TODAY >= parseISO(t.start) && TODAY < parseISO(t.end) && t.status!=="done");
  if(cur) return cur.phase;
  const next = real.find(t=> t.status!=="done" );
  return next ? next.phase : "Terminé";
}
function centerStatusPill(c){
  const opened = TODAY >= parseISO(c.ouverture);
  if(opened) return {cls:"pill-ouvert", label:"Ouvert"};
  const prereq = c.tasks.find(t=>t.phase.startsWith("Pré-requis"));
  if(prereq && prereq.status==="blocked") return {cls:"pill-prereq", label:"Prérequis en cours"};
  if(TODAY < parseISO(c.kickoff)) return {cls:"pill-etude", label:"À l'étude"};
  const anyOrder = c.orders.some(o=>o.status==="commande"||o.status==="livre");
  if(anyOrder) return {cls:"pill-commandes", label:"Commandes en cours"};
  const daysToOpen = diffDays(parseISO(c.ouverture), TODAY);
  if(daysToOpen <= 7) return {cls:"pill-pret", label:"Prêt à ouvrir"};
  return {cls:"pill-prep", label:"En préparation"};
}
function centerProgress(c){
  const real = c.tasks.filter(t=>!t.milestone);
  const done = real.filter(t=>t.status==="done").length;
  return {done, total:real.length, pct: real.length? Math.round(done/real.length*100):0};
}
function centerBudget(c){
  const total = c.orders.reduce((s,o)=>s+o.pu*o.qty,0);
  const engaged = c.orders.filter(o=>o.status==="commande"||o.status==="livre").reduce((s,o)=>s+o.pu*o.qty,0);
  return {total, engaged};
}
function eur(n){ return n.toLocaleString("fr-BE",{maximumFractionDigits:0})+" €"; }

/* ---------------- Overview ---------------- */
function renderOverview(){
  const grid = document.getElementById("overviewGrid");
  grid.innerHTML = "";
  DATA.centers.forEach(c=>{
    const pill = centerStatusPill(c);
    const prog = centerProgress(c);
    const bud = centerBudget(c);
    const daysToOpen = diffDays(parseISO(c.ouverture), TODAY);
    const opened = daysToOpen <= 0;
    const countClass = (!opened && daysToOpen < 14 && daysToOpen >=0) ? "countdown late" : "countdown";
    const countLabel = opened ? `Ouvert depuis ${Math.abs(daysToOpen)} j` : `J-${daysToOpen} avant ouverture`;
    const hot = /report|risque|deadline dure|Décision de la direction/i.test(c.urgence);
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <div class="card-head">
        <div class="prio">${c.priorite}</div>
        <div class="card-title">
          <h3>${c.nom.replace(/^\d+\.\s*/,'')}</h3>
          <div class="type">${c.type}</div>
        </div>
        <span class="pill ${pill.cls}">${pill.label}</span>
      </div>
      <div class="card-row">
        <span>Phase en cours : <b style="color:var(--navy-2)">${centerPhaseNow(c)}</b></span>
        <span class="${countClass}">${countLabel}</span>
      </div>
      <div class="progress-outer"><div class="progress-inner" style="width:${prog.pct}%"></div></div>
      <div class="budget-line"><span>${prog.done}/${prog.total} tâches faites</span><span>${eur(bud.engaged)} / ${eur(bud.total)} engagés</span></div>
      ${addrHtml(c,true)}
      <div class="urgence ${hot?'hot':''}">${c.urgence}</div>
    `;
    grid.appendChild(el);
  });
}

/* ---------------- Planning (timeline) ---------------- */
let TL_START, TL_END, TOTAL_DAYS;

function renderPlanning(){
  const rows = document.getElementById("tlRows");
  rows.innerHTML = "";
  DATA.centers.forEach(c=>{
    const pill = centerStatusPill(c);
    const row = document.createElement("div");
    row.className = "tl-row";
    let segsHTML = "";
    c.tasks.forEach(t=>{
      if(t.milestone) return;
      const s = parseISO(t.start), e = parseISO(t.end);
      const left = Math.max(0, diffDays(s, TL_START)) / TOTAL_DAYS * 100;
      const width = Math.max(0.6, diffDays(e,s) / TOTAL_DAYS * 100);
      const color = `var(--${STATUS_COLOR_VAR[t.status]||'amber'})`;
      segsHTML += `<div class="tl-seg" style="left:${left}%; width:${width}%; background:${color}" title="${t.label}"></div>`;
    });
    const milestone = c.tasks.find(t=>t.milestone);
    if(milestone){
      const left = diffDays(parseISO(milestone.start), TL_START) / TOTAL_DAYS * 100;
      segsHTML += `<div class="tl-milestone" style="left:${left}%" title="Ouverture — ${fmtFR(milestone.start)}"></div>`;
    }
    const todayLeft = diffDays(TODAY, TL_START) / TOTAL_DAYS * 100;
    row.innerHTML = `
      <div class="tl-label">${c.nom}<span class="st">${pill.label} · ouverture ${fmtFR(c.ouverture)}</span></div>
      <div class="tl-track">${segsHTML}<div class="tl-today" style="left:${todayLeft}%"></div></div>
    `;
    rows.appendChild(row);
  });
  // months axis
  const monthsEl = document.getElementById("tlMonths");
  let html = "";
  let cur = new Date(TL_START.getFullYear(), TL_START.getMonth(), 1);
  while(cur < TL_END){
    const left = diffDays(cur, TL_START) / TOTAL_DAYS * 100;
    html += `<div style="position:relative; flex:none;"><span style="position:absolute; left:0;">${cur.toLocaleDateString("fr-BE",{month:"short",year:"2-digit"})}</span></div>`;
    cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
  }
  monthsEl.style.position="relative"; monthsEl.style.height="16px";
  monthsEl.innerHTML = "";
  cur = new Date(TL_START.getFullYear(), TL_START.getMonth(), 1);
  while(cur < TL_END){
    const left = diffDays(cur, TL_START) / TOTAL_DAYS * 100;
    const span = document.createElement("span");
    span.style.position="absolute"; span.style.left=left+"%";
    span.textContent = cur.toLocaleDateString("fr-BE",{month:"short",year:"2-digit"});
    monthsEl.appendChild(span);
    cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
  }
}

/* ---------------- Tasks (kanban) ---------------- */
let activeTaskCenterId = null;
function renderTaskCenterTabs(){
  if(!activeTaskCenterId) activeTaskCenterId = DATA.centers[0].id;
  const wrap = document.getElementById("taskCenterTabs");
  wrap.innerHTML = "";
  DATA.centers.forEach(c=>{
    const b = document.createElement("button");
    b.className = "ctab" + (c.id===activeTaskCenterId ? " active":"");
    b.textContent = c.nom;
    b.onclick = ()=>{ activeTaskCenterId = c.id; renderTaskCenterTabs(); renderKanban(); };
    wrap.appendChild(b);
  });
}
function renderKanban(){
  const c = DATA.centers.find(x=>x.id===activeTaskCenterId);
  const meta = document.getElementById("taskCenterMeta");
  meta.innerHTML = `<b>${c.type}</b> · Lancement ${fmtFR(c.kickoff)} → Ouverture cible <b>${fmtFR(c.ouverture)}</b><br>${c.urgence}${addrHtml(c,false)}`;
  const board = document.getElementById("kanbanBoard");
  const cols = [
    {key:"blocked", label:"Bloqué / prérequis"},
    {key:"todo", label:"À faire"},
    {key:"doing", label:"En cours"},
    {key:"done", label:"Fait"},
  ];
  board.innerHTML = "";
  cols.forEach(col=>{
    const colEl = document.createElement("div");
    colEl.className = "kcol";
    const items = c.tasks.filter(t=>t.status===col.key);
    colEl.innerHTML = `<h4>${col.label} <span>${items.length}</span></h4>`;
    items.forEach(t=>{
      const card = document.createElement("div");
      card.className = "kcard" + (t.milestone ? " milestone":"");
      card.innerHTML = `
        <div class="phase">${t.phase}</div>
        <div class="label">${t.label}</div>
        <div class="meta"><span>${t.resp}</span><span>${fmtFR(t.start)}–${fmtFR(t.end)}</span></div>
        <select data-id="${t.id}">
          <option value="blocked" ${t.status==="blocked"?"selected":""}>Bloqué</option>
          <option value="todo" ${t.status==="todo"?"selected":""}>À faire</option>
          <option value="doing" ${t.status==="doing"?"selected":""}>En cours</option>
          <option value="done" ${t.status==="done"?"selected":""}>Fait</option>
        </select>
      `;
      card.querySelector("select").addEventListener("change", async (e)=>{
        const id = e.target.getAttribute("data-id");
        const val = e.target.value;
        TASK_IDX[id].t.status = val;
        state.taskStatus[id] = val;
        await saveState(); schedulePush();
        renderKanban(); renderOverview(); renderPlanning();
      });
      colEl.appendChild(card);
    });
    board.appendChild(colEl);
  });
}

/* ---------------- Orders ---------------- */
let activeOrderCenterId = null;
function renderOrderCenterTabs(){
  if(!activeOrderCenterId) activeOrderCenterId = DATA.centers[0].id;
  const wrap = document.getElementById("orderCenterTabs");
  wrap.innerHTML = "";
  DATA.centers.forEach(c=>{
    const b = document.createElement("button");
    b.className = "ctab" + (c.id===activeOrderCenterId ? " active":"");
    b.textContent = c.nom;
    b.onclick = ()=>{ activeOrderCenterId = c.id; renderOrderCenterTabs(); renderOrders(); };
    wrap.appendChild(b);
  });
}
function renderOrders(){
  const c = DATA.centers.find(x=>x.id===activeOrderCenterId);
  const summary = document.getElementById("orderSummary");
  const total = c.orders.reduce((s,o)=>s+o.pu*o.qty,0);
  const engaged = c.orders.filter(o=>o.status==="commande"||o.status==="livre").reduce((s,o)=>s+o.pu*o.qty,0);
  const livre = c.orders.filter(o=>o.status==="livre").length;
  summary.innerHTML = `
    <div class="stat"><div class="n">${eur(total)}</div><div class="l">Budget total estimé</div></div>
    <div class="stat"><div class="n">${eur(engaged)}</div><div class="l">Engagé (commandé + livré)</div></div>
    <div class="stat"><div class="n">${livre}/${c.orders.length}</div><div class="l">Articles livrés</div></div>
  `;
  const addrEl = document.getElementById("orderAddress");
  if(addrEl){ const a=(c.adresse||"").trim(); addrEl.innerHTML = a ? `<b>Adresse de livraison :</b> ${esc(a)} <a href="${esc(mapsLink(a))}" target="_blank" rel="noopener noreferrer" style="color:var(--blue);text-decoration:none;">Voir sur la carte ↗</a>` : `<b>Adresse de livraison :</b> <i>à renseigner dans l'onglet Édition</i>`; }
  const rows = document.getElementById("orderRows");
  rows.innerHTML = "";
  c.orders.forEach(o=>{
    const tr = document.createElement("tr");
    if(o.leadtime) tr.className = "leadtime";
    const link = safeUrl(o.url);
    tr.innerHTML = `
      <td>${esc(o.poste)}${o.leadtime? `<span class="lt-badge">⚠ délai ${o.leadtime} sem.</span>`:""}</td>
      <td class="desc">${esc(o.descriptif)}</td>
      <td>${esc(o.reference)}</td>
      <td>${esc(o.fournisseur)}</td>
      <td>${link? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ouvrir ↗</a>` : ""}</td>
      <td>${o.pu.toLocaleString("fr-BE",{minimumFractionDigits:2})} €</td>
      <td>${o.qty}</td>
      <td>${eur(o.pu*o.qty)}</td>
      <td>
        <select data-id="${o.id}">
          <option value="a_commander" ${o.status==="a_commander"?"selected":""}>À commander</option>
          <option value="commande" ${o.status==="commande"?"selected":""}>Commandé</option>
          <option value="livre" ${o.status==="livre"?"selected":""}>Livré</option>
          <option value="na" ${o.status==="na"?"selected":""}>Non nécessaire</option>
        </select>
      </td>
    `;
    tr.querySelector("select").addEventListener("change", async (e)=>{
      const id = e.target.getAttribute("data-id");
      const val = e.target.value;
      ORDER_IDX[id].o.status = val;
      state.orderStatus[id] = val;
      await saveState(); schedulePush();
      renderOrders(); renderOverview();
    });
    rows.appendChild(tr);
  });
  const totRow = document.createElement("tr");
  totRow.className = "tot-row";
  totRow.innerHTML = `<td colspan="7">TOTAL</td><td>${eur(total)}</td><td></td>`;
  rows.appendChild(totRow);
}

/* ---------------- Résumé PDF (impression) ---------------- */
const ST_COL = {todo:"#B4720A", doing:"#2262A8", done:"#1E8A4C", blocked:"#C6392F"};
const ST_TXT = {todo:"À faire", doing:"En cours", done:"Fait", blocked:"Bloqué"};
function toISO(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function addDays(s,n){ const d=parseISO(s); d.setDate(d.getDate()+n); return toISO(d); }
function fmtLong(s){ return parseISO(s).toLocaleDateString("fr-BE",{day:"numeric",month:"long",year:"numeric"}); }
function trunc(s,n){ s=String(s||""); return s.length>n ? s.slice(0,n-1)+"…" : s; }
function isLate(t){ return t.status!=="done" && !t.milestone && parseISO(t.end) < TODAY; }

function ganttSvgCenter(c){
  const tasks = c.tasks.slice().sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
  if(!tasks.length) return "";
  const s0 = tasks.reduce((m,t)=>t.start<m?t.start:m, tasks[0].start);
  const e0 = tasks.reduce((m,t)=>t.end>m?t.end:m, tasks[0].end);
  const A = parseISO(s0), B = parseISO(addDays(e0,3));
  const days = Math.max(1, diffDays(B,A));
  const W=1000, L=340, RH=14, TOP=22, H=TOP+tasks.length*RH+6;
  const X = d => L + (diffDays(d,A)/days)*(W-L);
  let g = "";
  tasks.forEach((t,i)=>{ if(i%2===0) g += `<rect x="0" y="${TOP+i*RH}" width="${W}" height="${RH}" fill="#F4F6F8"/>`; });
  // lignes de semaine (lundis)
  const d0 = new Date(A); while(d0.getDay()!==1) d0.setDate(d0.getDate()+1);
  for(let d=new Date(d0); d<=B; d.setDate(d.getDate()+7)){
    const x = X(d);
    g += `<line x1="${x}" y1="${TOP-4}" x2="${x}" y2="${H-4}" stroke="#D5DBE1" stroke-width="0.6"/>`;
    g += `<text x="${x+2}" y="${TOP-8}" font-size="8" fill="#5B6B7A">${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}</text>`;
  }
  tasks.forEach((t,i)=>{
    const y = TOP+i*RH;
    g += `<text x="6" y="${y+10.5}" font-size="8.5" fill="#1A2531">${esc(trunc(t.label.replace(/^⚠\s*/,""),66))}</text>`;
    const xs = X(parseISO(t.start)), xe = X(parseISO(t.end));
    if(t.milestone){
      g += `<polygon points="${xs},${y+2} ${xs+7},${y+RH/2} ${xs},${y+RH-2} ${xs-7},${y+RH/2}" fill="#6C3FA8"/>`;
    }else{
      const late = isLate(t);
      g += `<rect x="${xs}" y="${y+2.5}" width="${Math.max(3,xe-xs)}" height="${RH-5}" rx="2" fill="${ST_COL[t.status]||"#B4720A"}" ${late?'stroke="#C6392F" stroke-width="1.6" stroke-dasharray="3 1.5"':""}/>`;
    }
  });
  if(TODAY>=A && TODAY<=B){
    const x = X(TODAY);
    g += `<line x1="${x}" y1="${TOP-4}" x2="${x}" y2="${H-4}" stroke="#C6392F" stroke-width="1.2" stroke-dasharray="4 2"/><text x="${x+3}" y="${H-1}" font-size="8" fill="#C6392F" font-weight="700">Aujourd'hui</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">${g}</svg>`;
}

function ganttSvgGlobal(){
  const W=1000, L=230, RH=26, TOP=22, n=DATA.centers.length, H=TOP+n*RH+8;
  const X = d => L + (diffDays(d,TL_START)/TOTAL_DAYS)*(W-L);
  let g = "";
  let m = new Date(TL_START.getFullYear(), TL_START.getMonth(), 1);
  while(m < TL_END){
    const x = Math.max(L, X(m));
    g += `<line x1="${x}" y1="${TOP-4}" x2="${x}" y2="${H-4}" stroke="#D5DBE1" stroke-width="0.6"/><text x="${x+3}" y="${TOP-8}" font-size="9" fill="#5B6B7A">${m.toLocaleDateString("fr-BE",{month:"short",year:"2-digit"})}</text>`;
    m = new Date(m.getFullYear(), m.getMonth()+1, 1);
  }
  DATA.centers.forEach((c,i)=>{
    const y = TOP+i*RH;
    if(i%2===0) g += `<rect x="0" y="${y}" width="${W}" height="${RH}" fill="#F4F6F8"/>`;
    g += `<text x="6" y="${y+16}" font-size="10" font-weight="700" fill="#1A2531">${esc(trunc(c.nom,34))}</text>`;
    c.tasks.forEach(t=>{
      const xs = X(parseISO(t.start)), xe = X(parseISO(t.end));
      if(t.milestone) g += `<polygon points="${xs},${y+3} ${xs+8},${y+RH/2} ${xs},${y+RH-3} ${xs-8},${y+RH/2}" fill="#6C3FA8"/>`;
      else g += `<rect x="${Math.max(L,xs)}" y="${y+6}" width="${Math.max(2,xe-xs)}" height="${RH-12}" fill="${ST_COL[t.status]||"#B4720A"}" opacity="0.92"/>`;
    });
  });
  if(TODAY>=TL_START && TODAY<=TL_END){
    const x = X(TODAY);
    g += `<line x1="${x}" y1="${TOP-4}" x2="${x}" y2="${H-4}" stroke="#C6392F" stroke-width="1.3" stroke-dasharray="4 2"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">${g}</svg>`;
}

function centerNarrative(c){
  const real = c.tasks.filter(t=>!t.milestone);
  const cnt = k => real.filter(t=>t.status===k).length;
  const prog = centerProgress(c), bud = centerBudget(c);
  const days = diffDays(parseISO(c.ouverture), TODAY);
  const lines = [];
  lines.push(days>0 ? `Ouverture prévue le <b>${fmtLong(c.ouverture)}</b>, dans <b>${days} jour${days>1?"s":""}</b> (lancement le ${fmtLong(c.kickoff)}).`
                    : `Ouverture prévue le <b>${fmtLong(c.ouverture)}</b> : date atteinte ou dépassée.`);
  lines.push(`Avancement : <b>${prog.done} tâche${prog.done>1?"s":""} terminée${prog.done>1?"s":""} sur ${prog.total} (${prog.pct} %)</b> — ${cnt("doing")} en cours, ${cnt("todo")} à faire, ${cnt("blocked")} bloquée${cnt("blocked")>1?"s":""}. Phase actuelle : <b>${esc(centerPhaseNow(c))}</b>.`);
  const oc = k => c.orders.filter(o=>o.status===k).length;
  lines.push(`Commandes : ${oc("a_commander")} article${oc("a_commander")>1?"s":""} à commander, ${oc("commande")} commandé${oc("commande")>1?"s":""}, ${oc("livre")} livré${oc("livre")>1?"s":""} — <b>${eur(bud.engaged)}</b> engagés sur un budget de ${eur(bud.total)}.`);
  const alerts = [];
  c.tasks.filter(t=>t.status==="blocked").forEach(t=>alerts.push(`Bloqué : ${esc(t.label)} (${esc(t.resp||"—")}).`));
  const late = c.tasks.filter(isLate);
  late.forEach(t=>alerts.push(`En retard : ${esc(t.label.replace(/^⚠\s*/,""))} — échéance du ${fmtFR(t.end)} dépassée.`));
  c.orders.filter(o=>o.leadtime && o.status==="a_commander").forEach(o=>{
    const last = addDays(c.ouverture, -(7 + o.leadtime*7));
    alerts.push(parseISO(last) < TODAY
      ? `Délai fournisseur : « ${esc(o.poste)} » (${o.leadtime} sem.) n'est pas encore commandé et la date limite (${fmtFR(last)}) est dépassée — l'ouverture au ${fmtFR(c.ouverture)} est compromise sauf livraison accélérée.`
      : `Délai fournisseur : commander « ${esc(o.poste)} » (${o.leadtime} sem.) au plus tard le <b>${fmtFR(last)}</b> pour tenir l'ouverture.`);
  });
  if((c.urgence||"").trim()) alerts.push(`Point de vigilance : ${esc(c.urgence)}`);
  return {lines, alerts};
}

function taskListHtml(tasks, emptyMsg){
  if(!tasks.length) return `<p class="empty">${emptyMsg}</p>`;
  return `<ul>` + tasks.map(t=>`<li class="${isLate(t)?"late":""}"><span class="tl">${esc(t.label.replace(/^⚠\s*/,""))}</span><span class="tm">${esc(t.resp||"")} · ${t.milestone? fmtFR(t.start) : fmtFR(t.start)+" → "+fmtFR(t.end)}${isLate(t)?" · en retard":""}${t.status==="blocked"?" · bloqué":""}</span></li>`).join("") + `</ul>`;
}

function centerPageHtml(c){
  const prog = centerProgress(c), pill = centerStatusPill(c), nar = centerNarrative(c);
  const byDate = (a,b)=>a.start.localeCompare(b.start);
  const done = c.tasks.filter(t=>t.status==="done").sort(byDate);
  const doing = c.tasks.filter(t=>t.status==="doing").sort(byDate);
  const todo = c.tasks.filter(t=>t.status==="todo"||t.status==="blocked").sort((a,b)=> (a.status==="blocked"?0:1)-(b.status==="blocked"?0:1) || byDate(a,b));
  const addr = (c.adresse||"").trim();
  return `<section class="page">
    <div class="head"><div><h2>${esc(c.nom)}</h2><div class="sub">${esc(c.type)}${addr? " · 📍 "+esc(addr):""}</div></div>
      <div class="badge"><b>${prog.pct} %</b><span>${esc(pill.label)}</span></div></div>
    <div class="bar"><i style="width:${prog.pct}%"></i></div>
    <div class="gantt">${ganttSvgCenter(c)}</div>
    <div class="legend"><span><i style="background:${ST_COL.done}"></i>Fait</span><span><i style="background:${ST_COL.doing}"></i>En cours</span><span><i style="background:${ST_COL.todo}"></i>À faire</span><span><i style="background:${ST_COL.blocked}"></i>Bloqué</span><span><i class="dia"></i>Ouverture</span><span><i class="lt"></i>En retard</span></div>
    <div class="cols">
      <div class="explain"><h3>Explicatif</h3>${nar.lines.map(l=>`<p>${l}</p>`).join("")}
        ${nar.alerts.length? `<h4>Points d'attention</h4><ul class="al">${nar.alerts.map(a=>`<li>${a}</li>`).join("")}</ul>`:""}
        ${(c.note||"").trim()? `<h4>Commentaire</h4><p class="note">${esc(c.note).replace(/\n/g,"<br>")}</p>`:""}</div>
      <div class="lists">
        <h3 class="g">Fait (${done.length})</h3>${taskListHtml(done,"Aucune tâche terminée pour l'instant.")}
        <h3 class="b">En cours (${doing.length})</h3>${taskListHtml(doing,"Aucune tâche en cours.")}
        <h3 class="a">Reste à faire (${todo.length})</h3>${taskListHtml(todo,"Plus rien à faire.")}
      </div>
    </div>
  </section>`;
}

function overviewPageHtml(centers){
  const rows = centers.map(c=>{
    const p = centerProgress(c), pill = centerStatusPill(c), b = centerBudget(c), d = diffDays(parseISO(c.ouverture), TODAY);
    return `<tr><td><b>${esc(c.nom)}</b></td><td>${fmtFR(c.ouverture)}</td><td>${d>0? "J-"+d : "ouvert"}</td><td>${esc(pill.label)}</td><td>${p.done}/${p.total} (${p.pct} %)</td><td>${eur(b.engaged)} / ${eur(b.total)}</td></tr>`;
  }).join("");
  const tot = centers.reduce((s,c)=>{ const b=centerBudget(c); s.t+=b.total; s.e+=b.engaged; return s; },{t:0,e:0});
  return `<section class="page">
    <div class="head"><div><h2>Ouverture des centres de prélèvement — synthèse</h2><div class="sub">CHR Verviers · Laboratoire · situation au ${fmtLong(toISO(TODAY))}</div></div></div>
    <div class="gantt">${ganttSvgGlobal()}</div>
    <div class="legend"><span><i style="background:${ST_COL.done}"></i>Fait</span><span><i style="background:${ST_COL.doing}"></i>En cours</span><span><i style="background:${ST_COL.todo}"></i>À faire</span><span><i style="background:${ST_COL.blocked}"></i>Bloqué</span><span><i class="dia"></i>Ouverture</span><span><i class="td"></i>Aujourd'hui</span></div>
    <table class="sum"><thead><tr><th>Centre</th><th>Ouverture</th><th>Échéance</th><th>Statut</th><th>Tâches</th><th>Budget engagé / total</th></tr></thead><tbody>${rows}
      <tr class="tot"><td colspan="5">Total</td><td>${eur(tot.e)} / ${eur(tot.t)}</td></tr></tbody></table>
  </section>`;
}

const REPORT_CSS = `
  @page{ size:A4 landscape; margin:9mm; }
  *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body{ font-family:Arial,Helvetica,sans-serif; color:#1A2531; margin:0; font-size:9px; }
  .page{ page-break-after:always; break-after:page; }
  .page:last-child{ page-break-after:auto; break-after:auto; }
  .head{ display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; }
  h2{ margin:0; font-size:16px; color:#132B45; }
  .sub{ color:#5B6B7A; font-size:10.5px; margin-top:2px; }
  .badge{ text-align:right; } .badge b{ font-size:20px; color:#0E7C7B; display:block; line-height:1; } .badge span{ font-size:10px; color:#5B6B7A; }
  .bar{ height:5px; background:#E8ECF0; border-radius:3px; overflow:hidden; margin-bottom:8px; } .bar i{ display:block; height:100%; background:#0E7C7B; }
  .gantt{ border:1px solid #E2E6EA; border-radius:4px; padding:4px; margin-bottom:4px; }
  .legend{ display:flex; gap:12px; font-size:8px; color:#5B6B7A; margin-bottom:6px; }
  .legend i{ display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
  .legend i.dia{ background:#6C3FA8; transform:rotate(45deg); width:8px; height:8px; }
  .legend i.lt{ background:#fff; border:1.5px dashed #C6392F; } .legend i.td{ background:#C6392F; width:2px; border-radius:0; }
  .cols{ display:flex; gap:14px; align-items:flex-start; }
  .explain{ width:36%; } .lists{ width:64%; columns:2; column-gap:12px; }
  h3{ font-size:10.5px; margin:0 0 3px; color:#132B45; } h4{ font-size:9.5px; margin:6px 0 2px; color:#C6392F; }
  h3.g{ color:#1E8A4C; } h3.b{ color:#2262A8; margin-top:6px; } h3.a{ color:#B4720A; margin-top:6px; }
  .explain p{ margin:0 0 4px; line-height:1.35; font-size:9px; }
  ul{ margin:0 0 3px; padding-left:12px; } li{ margin-bottom:2px; line-height:1.25; break-inside:avoid; font-size:9px; }
  .tl{ display:block; } .tm{ display:block; color:#5B6B7A; font-size:7.5px; }
  li.late .tl{ color:#C6392F; font-weight:700; }
  ul.al li{ color:#7A2A22; } .empty{ color:#7A8794; font-style:italic; margin:0 0 4px; } .note{ background:#F4F6F8; padding:5px 7px; border-left:3px solid #0E7C7B; }
  table.sum{ width:100%; border-collapse:collapse; margin-top:6px; font-size:10.5px; }
  table.sum th{ background:#F4F6F8; text-align:left; padding:6px 8px; border-bottom:1px solid #D5DBE1; font-size:9.5px; }
  table.sum td{ padding:6px 8px; border-bottom:1px solid #EEF1F4; } table.sum tr.tot td{ font-weight:700; background:#F4F6F8; }
  .foot{ position:fixed; left:0; bottom:0; color:#8896A3; font-size:7.5px; }
  .page{ padding-bottom:5mm; }
`;

function buildReportHtml(centers){
  const title = "Avancement_centres_" + toISO(TODAY);
  const pages = (centers.length>1 ? overviewPageHtml(centers) : "") + centers.map(centerPageHtml).join("");
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>${REPORT_CSS}</style></head><body><div class="foot">Rapport généré le ${fmtLong(toISO(TODAY))} — Pilotage des centres de prélèvement, CHR Verviers.</div>${pages}</body></html>`;
}

function exportReportPdf(scope){
  const centers = scope==="all" ? DATA.centers : DATA.centers.filter(c=>c.id===activeTaskCenterId);
  if(!centers.length) return;
  const html = buildReportHtml(centers);
  const old = document.getElementById("reportFrame"); if(old) old.remove();
  const fr = document.createElement("iframe");
  fr.id = "reportFrame";
  fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(fr);
  const doc = fr.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(()=>{ if(fr.contentWindow){ fr.contentWindow.focus(); fr.contentWindow.print(); } }, 350);
}

/* ---------------- Export Excel (bon de commande) ---------------- */
function exportOrders(scope){
  const centers = scope==="all" ? DATA.centers : DATA.centers.filter(c=>c.id===activeOrderCenterId);
  const detail = [];
  centers.forEach(c=>c.orders.filter(o=>o.status==="a_commander").forEach(o=>detail.push({c,o})));
  if(!detail.length){ alert("Aucun article « À commander » à exporter."); return; }

  // Regroupement par fournisseur + article (quantités additionnées entre centres)
  const groups = {};
  detail.forEach(({c,o})=>{
    const k = [o.fournisseur,o.poste,o.reference,o.pu,o.url].join("|");
    const g = groups[k] || (groups[k] = {fournisseur:o.fournisseur||"(sans fournisseur)", poste:o.poste, descriptif:o.descriptif, reference:o.reference||"", url:safeUrl(o.url), pu:o.pu, qty:0, leadtime:o.leadtime||"", centres:[]});
    g.qty += o.qty;
    const nom = c.nom.replace(/^\d+\.\s*/,"");
    if(!g.centres.includes(nom)) g.centres.push(nom);
    if(o.leadtime && !g.leadtime) g.leadtime = o.leadtime;
  });
  const list = Object.values(groups).sort((a,b)=> a.fournisseur.localeCompare(b.fournisseur,"fr") || a.poste.localeCompare(b.poste,"fr"));

  const head1 = ["Fournisseur","Article","Descriptif","Référence","Lien URL","Qté","PU (€)","Total (€)","Délai (sem.)","Centres concernés"];
  const rows1 = list.map((g,i)=>[g.fournisseur,g.poste,g.descriptif,g.reference,g.url,g.qty,g.pu,{f:`F${i+2}*G${i+2}`,v:g.qty*g.pu},g.leadtime,g.centres.join(", ")]);
  const totalVal = list.reduce((s,g)=>s+g.qty*g.pu,0);
  rows1.push(["TOTAL","","","","","","",{f:`SUM(H2:H${list.length+1})`,v:totalVal},"",""]);

  const head2 = ["Centre","Fournisseur","Article","Descriptif","Référence","Lien URL","Qté","PU (€)","Total (€)","Délai (sem.)","Adresse de livraison"];
  const rows2 = detail.map(({c,o},i)=>[c.nom,o.fournisseur,o.poste,o.descriptif,o.reference||"",safeUrl(o.url),o.qty,o.pu,{f:`G${i+2}*H${i+2}`,v:o.qty*o.pu},o.leadtime||"",c.adresse||""]);

  const today = new Date().toISOString().slice(0,10);
  const fname = `commande_${scope==="all"?"tous_centres":"centre_"+(centers[0].nom.replace(/^\d+\.\s*/,"").split(/[\s–-]/)[0].toLowerCase())}_${today}`;

  if(typeof XLSX === "undefined"){
    // Secours si la bibliothèque Excel n'a pas pu se charger : CSV lisible par Excel
    const csv = [head2].concat(rows2.map(r=>r.map(v=> (v&&v.v!==undefined)? v.v : v))).map(r=>r.map(v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"').join(";")).join("\n");
    const blob = new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fname+".csv";
    document.body.appendChild(a); a.click(); a.remove(); return;
  }
  const mk = (head, rows, widths, urlCol, numFmt)=>{
    const ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
    ws["!cols"] = widths.map(w=>({wch:w}));
    ws["!freeze"] = {xSplit:0,ySplit:1};
    rows.forEach((r,i)=>{
      const cell = ws[XLSX.utils.encode_cell({r:i+1,c:urlCol})];
      if(cell && cell.v) cell.l = {Target:cell.v, Tooltip:"Ouvrir le lien"};
      Object.entries(numFmt).forEach(([col,fmt])=>{ const x = ws[XLSX.utils.encode_cell({r:i+1,c:+col})]; if(x) x.z = fmt; });
    });
    return ws;
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, mk(head1,rows1,[22,34,34,18,36,7,10,12,11,40],4,{6:'#,##0.00',7:'#,##0.00'}), "Bon de commande");
  XLSX.utils.book_append_sheet(wb, mk(head2,rows2,[34,22,34,34,18,36,7,10,12,11,44],5,{7:'#,##0.00',8:'#,##0.00'}), "Détail par centre");
  const cs = [...new Map(detail.map(({c})=>[c.id,c])).values()];
  const ws3 = XLSX.utils.aoa_to_sheet([["Centre","Adresse de livraison","Plan"]].concat(cs.map(c=>[c.nom,c.adresse||"(à renseigner)", (c.adresse||"").trim()? mapsLink(c.adresse.trim()):""])));
  ws3["!cols"] = [{wch:44},{wch:60},{wch:50}];
  cs.forEach((c,i)=>{ const x = ws3[XLSX.utils.encode_cell({r:i+1,c:2})]; if(x && x.v) x.l = {Target:x.v}; });
  XLSX.utils.book_append_sheet(wb, ws3, "Adresses de livraison");
  XLSX.writeFile(wb, fname+".xlsx");
}

/* ---------------- Édition (admin) ---------------- */
let activeEditCenterId = null;
let isDirty = false;
let genSeq = 1;
function genId(prefix){ return prefix + Date.now().toString(36) + (genSeq++).toString(36); }

let editSeq = 0, pushing = false;
function markDirty(){
  isDirty = true; editSeq++;
  const banner = document.getElementById("editSaveStatus");
  if(DATA_SOURCE === "api"){
    if(banner) banner.textContent = "⏳ Enregistrement automatique en cours…";
    schedulePush();
  }else if(banner){
    banner.textContent = "⚠ Stockage partagé non actif : les modifications ne sont pas enregistrées. Téléchargez une copie (JSON) ou voir README, section 6.";
  }
}

/* ---- Propagation des modifications vers tous les centres ---- */
function propOn(){ const e = document.getElementById("chkPropAll"); return !!(e && e.checked); }
function propDatesOn(){ const e = document.getElementById("chkPropDates"); return !!(e && e.checked); }
function ensureGk(item){ if(!item.gk) item.gk = genId("g"); return item.gk; }
function otherCenters(c){ return DATA.centers.filter(x=>x!==c); }
function findTwin(list, item, field, oldKey){
  if(item.gk){ const g = list.find(x=>x.gk===item.gk); if(g) return g; }
  return list.find(x=>!x.gk && x[field]===oldKey) || list.find(x=>x[field]===oldKey);
}
function mapDate(src, dst, iso){
  try{
    const off = diffDays(parseISO(iso), parseISO(src.kickoff));
    const sSpan = diffDays(parseISO(src.ouverture), parseISO(src.kickoff));
    const dSpan = diffDays(parseISO(dst.ouverture), parseISO(dst.kickoff));
    const ratio = sSpan > 0 && dSpan > 0 ? dSpan / sSpan : 1;
    return addDays(dst.kickoff, Math.round(off * ratio));
  }catch(e){ return iso; }
}
const TASK_SHARED = ["phase","label","resp","milestone"];
const ORDER_SHARED = ["poste","descriptif","reference","fournisseur","url","pu","leadtime"];
function propagateTaskEdit(c, t, f, oldLabel){
  const isDate = (f==="start" || f==="end");
  if(!(TASK_SHARED.includes(f) || (isDate && propDatesOn()))) return 0;
  ensureGk(t);
  let n = 0;
  otherCenters(c).forEach(o=>{
    const twin = findTwin(o.tasks, t, "label", oldLabel);
    if(!twin) return;
    twin.gk = t.gk;
    twin[f] = isDate ? mapDate(c, o, t[f]) : t[f];
    n++;
  });
  return n;
}
function propagateOrderEdit(c, od, f, oldPoste){
  if(!ORDER_SHARED.includes(f)) return 0;
  ensureGk(od);
  let n = 0;
  otherCenters(c).forEach(o=>{
    const twin = findTwin(o.orders, od, "poste", oldPoste);
    if(!twin) return;
    twin.gk = od.gk;
    twin[f] = od[f];
    n++;
  });
  return n;
}
function loadPropPrefs(){
  try{
    const a = localStorage.getItem("pilotage-prop-all"), d = localStorage.getItem("pilotage-prop-dates");
    const ca = document.getElementById("chkPropAll"), cd = document.getElementById("chkPropDates");
    if(ca) ca.checked = a === null ? true : a === "1";
    if(cd) cd.checked = d === "1";
  }catch(e){}
}
function savePropPrefs(){
  try{
    localStorage.setItem("pilotage-prop-all", propOn() ? "1":"0");
    localStorage.setItem("pilotage-prop-dates", propDatesOn() ? "1":"0");
  }catch(e){}
}
function markClean(msg){
  isDirty = false;
  const banner = document.getElementById("editSaveStatus");
  if(banner) banner.textContent = msg || "Aucune modification en attente.";
}
window.addEventListener("beforeunload", (e)=>{
  if(isDirty){ e.preventDefault(); e.returnValue = ""; }
});

function renderEditCenterTabs(){
  if(!activeEditCenterId || !DATA.centers.find(c=>c.id===activeEditCenterId)){
    activeEditCenterId = DATA.centers[0] ? DATA.centers[0].id : null;
  }
  const wrap = document.getElementById("editCenterTabs");
  wrap.innerHTML = "";
  DATA.centers.forEach(c=>{
    const b = document.createElement("button");
    b.className = "ctab" + (c.id===activeEditCenterId ? " active":"");
    b.textContent = c.nom;
    b.onclick = ()=>{ activeEditCenterId = c.id; renderEditCenterTabs(); renderEditor(); };
    wrap.appendChild(b);
  });
}

function fieldRow(label, inputHtml, full){
  return `<div${full? ' class="full"':''}><label>${label}</label>${inputHtml}</div>`;
}

function renderEditor(){
  const c = DATA.centers.find(x=>x.id===activeEditCenterId);
  const form = document.getElementById("editCenterForm");
  if(!c){ form.innerHTML = "<p>Aucun centre — utilisez « + Nouveau centre ».</p>"; document.getElementById("editTasksBody").innerHTML=""; document.getElementById("editOrdersBody").innerHTML=""; return; }

  form.innerHTML =
    fieldRow("Nom du centre", `<input type="text" id="f-nom" value="${(c.nom||"").replace(/"/g,'&quot;')}">`) +
    fieldRow("Type / description courte", `<input type="text" id="f-type" value="${(c.type||"").replace(/"/g,'&quot;')}">`) +
    fieldRow("Priorité (ordre)", `<input type="number" id="f-priorite" value="${c.priorite}" min="1">`) +
    fieldRow("Profil budget", `<select id="f-budget">
        <option value="complet" ${c.budget==="complet"?"selected":""}>Complet (nouveau box, fauteuil inclus)</option>
        <option value="leger" ${c.budget==="leger"?"selected":""}>Léger (local déjà équipé)</option>
      </select>`) +
    fieldRow("Date de lancement (kickoff)", `<input type="date" id="f-kickoff" value="${c.kickoff}">`) +
    fieldRow("Date d'ouverture cible", `<input type="date" id="f-ouverture" value="${c.ouverture}">`) +
    fieldRow("Adresse du centre (rue, n°, code postal, commune)", `<input type="text" id="f-adresse" value="${esc(c.adresse)}" placeholder="Ex. : Rue Exemple 12, 4800 Verviers">`, true) +
    fieldRow("Commentaire pour le résumé PDF (facultatif)", `<textarea id="f-note" placeholder="Contexte, décisions, prochaines étapes… repris dans le PDF d'avancement">${esc(c.note)}</textarea>`, true) +
    fieldRow("Point de vigilance / note affichée sur la carte", `<textarea id="f-urgence">${(c.urgence||"")}</textarea>`, true);

  const bind = (id, field, parser)=>{
    document.getElementById(id).addEventListener("input", ()=>{
      const el = document.getElementById(id);
      c[field] = parser ? parser(el.value) : el.value;
      markDirty();
      renderOverview(); renderPlanning(); renderOrders(); renderKanban();
      renderEditCenterTabs(); // reflect renamed center in tab label
    });
  };
  bind("f-nom","nom");
  bind("f-type","type");
  bind("f-priorite","priorite", v=>parseInt(v,10)||0);
  bind("f-budget","budget");
  bind("f-kickoff","kickoff");
  bind("f-ouverture","ouverture");
  bind("f-urgence","urgence");
  bind("f-adresse","adresse");
  bind("f-note","note");

  // ---- Tasks table ----
  const tbody = document.getElementById("editTasksBody");
  tbody.innerHTML = "";
  c.tasks.forEach(t=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" data-f="phase" value="${(t.phase||"").replace(/"/g,'&quot;')}"></td>
      <td><input type="text" data-f="label" value="${(t.label||"").replace(/"/g,'&quot;')}" style="min-width:220px;"></td>
      <td><input type="text" data-f="resp" value="${(t.resp||"").replace(/"/g,'&quot;')}"></td>
      <td><input type="date" data-f="start" value="${t.start}"></td>
      <td><input type="date" data-f="end" value="${t.end}"></td>
      <td>
        <select data-f="status">
          <option value="blocked" ${t.status==="blocked"?"selected":""}>Bloqué</option>
          <option value="todo" ${t.status==="todo"?"selected":""}>À faire</option>
          <option value="doing" ${t.status==="doing"?"selected":""}>En cours</option>
          <option value="done" ${t.status==="done"?"selected":""}>Fait</option>
        </select>
      </td>
      <td style="text-align:center;"><input type="checkbox" data-f="milestone" ${t.milestone?"checked":""}></td>
      <td><button class="row-del" title="Supprimer">✕</button></td>
    `;
    tr.querySelectorAll("[data-f]").forEach(inp=>{
      const ev = inp.type==="checkbox" ? "change" : "input";
      inp.addEventListener(ev, ()=>{
        const f = inp.getAttribute("data-f");
        const oldLabel = t.label;
        t[f] = inp.type==="checkbox" ? inp.checked : inp.value;
        if(propOn()) propagateTaskEdit(c, t, f, oldLabel);
        markDirty();
        renderOverview(); renderPlanning(); renderKanban();
      });
    });
    tr.querySelector(".row-del").addEventListener("click", ()=>{
      const all = propOn();
      if(!confirm(all ? "Supprimer cette tâche dans TOUS les centres ?" : "Supprimer cette tâche (ce centre uniquement) ?")) return;
      if(all){
        otherCenters(c).forEach(o=>{
          const twin = findTwin(o.tasks, t, "label", t.label);
          if(twin){ o.tasks = o.tasks.filter(x=>x!==twin); delete TASK_IDX[twin.id]; }
        });
      }
      c.tasks = c.tasks.filter(x=>x!==t);
      delete TASK_IDX[t.id];
      markDirty();
      renderEditor(); renderKanban(); renderOverview(); renderPlanning();
    });
    tbody.appendChild(tr);
  });

  // ---- Orders table ----
  const obody = document.getElementById("editOrdersBody");
  obody.innerHTML = "";
  c.orders.forEach(o=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" data-f="poste" value="${esc(o.poste)}" style="min-width:160px;"></td>
      <td><input type="text" data-f="descriptif" value="${esc(o.descriptif)}" style="min-width:160px;"></td>
      <td><input type="text" data-f="reference" value="${esc(o.reference)}" style="min-width:100px;"></td>
      <td><input type="text" data-f="fournisseur" value="${esc(o.fournisseur)}" style="min-width:110px;"></td>
      <td><input type="text" data-f="url" class="url" value="${esc(o.url)}" placeholder="https://…"></td>
      <td><input type="number" step="0.01" data-f="pu" value="${o.pu}"></td>
      <td><input type="number" data-f="qty" value="${o.qty}"></td>
      <td><input type="number" data-f="leadtime" value="${o.leadtime==null?"":o.leadtime}" placeholder="—"></td>
      <td>
        <select data-f="status">
          <option value="a_commander" ${o.status==="a_commander"?"selected":""}>À commander</option>
          <option value="commande" ${o.status==="commande"?"selected":""}>Commandé</option>
          <option value="livre" ${o.status==="livre"?"selected":""}>Livré</option>
          <option value="na" ${o.status==="na"?"selected":""}>Non nécessaire</option>
        </select>
      </td>
      <td><button class="row-del" title="Supprimer">✕</button></td>
    `;
    tr.querySelectorAll("[data-f]").forEach(inp=>{
      inp.addEventListener("input", ()=>{
        const f = inp.getAttribute("data-f");
        const oldPoste = o.poste;
        if(f==="pu") o.pu = parseFloat(inp.value)||0;
        else if(f==="qty") o.qty = parseInt(inp.value,10)||0;
        else if(f==="leadtime") o.leadtime = inp.value===""? null : parseInt(inp.value,10);
        else o[f] = inp.value;
        if(propOn()) propagateOrderEdit(c, o, f, oldPoste);
        markDirty();
        renderOverview(); renderOrders();
      });
    });
    tr.querySelector(".row-del").addEventListener("click", ()=>{
      const all = propOn();
      if(!confirm(all ? "Supprimer cet article dans TOUS les centres ?" : "Supprimer cet article (ce centre uniquement) ?")) return;
      if(all){
        otherCenters(c).forEach(x=>{
          const twin = findTwin(x.orders, o, "poste", o.poste);
          if(twin){ x.orders = x.orders.filter(y=>y!==twin); delete ORDER_IDX[twin.id]; }
        });
      }
      c.orders = c.orders.filter(x=>x!==o);
      delete ORDER_IDX[o.id];
      markDirty();
      renderEditor(); renderOverview();
    });
    obody.appendChild(tr);
  });
}

const KIT_E519 = [{"poste": "ADAPTATEUR LUER 367300 VACUTAINER", "reference": "9000960", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 150}, {"poste": "CUTIPLAST 7,2 X 5 CM", "reference": "9007429", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 100}, {"poste": "ECOUVILLON TRANSWAB MW176S", "reference": "9027534", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 10}, {"poste": "MICROPERFUSEUR AILETTE 21G 3/4 NIPSVS21", "reference": "9006181", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 150}, {"poste": "MICROPERFUSEUR AILETTE 23G 3/4 NIPSVS23", "reference": "9006199", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 150}, {"poste": "MICROPORE 2,5 CM X 9,14 M 1530-1", "reference": "5000048", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 1}, {"poste": "OUATES HEMOSTATIQUES QUALIPHAR FL 10 GR", "reference": "2734102", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 2}, {"poste": "POT URINE 120ML CANULE TRANSFE 364941", "reference": "9050015", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 50}, {"poste": "PORTE TUBE BD PRONTO 368872 VACUTAINER", "reference": "5004446", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 10}, {"poste": "STRIPS SPOT DIAM. 22MM 37242", "reference": "9006033", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 150}, {"poste": "TAMPON ALCOOL INDIVIDUEL 31-0606", "reference": "9006645", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 150}, {"poste": "VACUTAINER 363048 BLEU 2,7 ML 363048 HG/BL", "reference": "9014854", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 50}, {"poste": "VACUTAINER 367374 VERT 3 ML 367374 LHPST", "reference": "9017055", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 20}, {"poste": "VACUTAINER 367525 MAUVE 10 ML 367525 K2E", "reference": "9001505", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 10}, {"poste": "VACUTAINER 368815 ROUGE 6 ML 368815 CAT PLUS SEC", "reference": "9001547", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 20}, {"poste": "VACUTAINER 368856 MAUVE 3 ML 368856 K2E", "reference": "9001513", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 150}, {"poste": "VACUTAINER 368921 GRIS 4 ML 368921 HEMOGARD", "reference": "9001489", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 100}, {"poste": "VACUTAINER 368968 ROUGE 5 ML 368968 SST II COAG", "reference": "9001554", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 150}, {"poste": "VACUTAINER ACD TUBE 367756", "reference": "9046435", "fournisseur": "Pharmacie", "descriptif": "Pharmacie — centre de frais E519", "pu": 0, "qty": 5}, {"poste": "Bassin réniforme inox", "reference": "", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 0.0, "qty": 1}, {"poste": "TENSIOMETRE MANUEL HEINE GAMMA G5", "reference": "60100022", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 90.46, "qty": 1}, {"poste": "BASSIN RENIFORME 750ML (50P)", "reference": "60100032", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 2.92, "qty": 1}, {"poste": "BIC 4 COULEURS POINTE MOYENNE", "reference": "60500117", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 1.86, "qty": 1}, {"poste": "CISEAUX DE BUREAU 18CM", "reference": "60500022", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 1.96, "qty": 1}, {"poste": "CLASSEUR PVC A4 DOS 2 ANNEAUX 35MM ROUGE", "reference": "60500023", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 2.43, "qty": 1}, {"poste": "COLD HOT PACK 12X29CM + HOUSSE", "reference": "60100300", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 5.1, "qty": 2}, {"poste": "CONTAINER A AIGUILLES SHARPSAFE 7L", "reference": "60300014", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 2.79, "qty": 3}, {"poste": "EAU SPA REINE PLATE 33CL (24P)", "reference": "60700037", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 10.44, "qty": 1}, {"poste": "EKO SPACE CITRON 250ML", "reference": "60300746", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 0.17, "qty": 1}, {"poste": "EUCERIN PH5 SAVON LIQUIDE 1L + DISTR.NF", "reference": "60300801", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 14.52, "qty": 1}, {"poste": "GANT NITRILE NON POUDRE FINO PEHA-SOFT BLEU M (150P)", "reference": "60100053", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 10.06, "qty": 2}, {"poste": "GANT NITRILE NON POUDRE FINO PEHA-SOFT BLEU S (150P)", "reference": "60100052", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 10.24, "qty": 2}, {"poste": "GOBELET CARTON 240ML (50P)", "reference": "60700122", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 1.76, "qty": 1}, {"poste": "MARQUEUR FLUO JAUNE", "reference": "60500065", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 0.83, "qty": 1}, {"poste": "MARQUEUR GROS ARTLINE 70 NOIR", "reference": "60500070", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 1.5, "qty": 1}, {"poste": "MASQUE CHIRURGICAL TYPE IIR - FIXATIONS ELASTIQUES (50P)", "reference": "60600044", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 1.51, "qty": 1}, {"poste": "MOUCHOIR PREMIUM (100P)", "reference": "60300783", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 1.06, "qty": 1}, {"poste": "NATURAL ZZ 2 PLIS H3 (15X250P)", "reference": "60600134", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 32.22, "qty": 1}, {"poste": "POT A SELLE AVEC PETITE CUILLERE 60ML", "reference": "60101399", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 0.17, "qty": 20}, {"poste": "PUR ZELLIN 4X5CM", "reference": "60101367", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 1.91, "qty": 2}, {"poste": "SACHET POUBELLE PEBD GRAND GRIS 80CMX110CMX35M (20P)", "reference": "60300008", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 4.46, "qty": 1}, {"poste": "SACHET POUBELLE PEHD PETIT GRIS 50CMX60CMX15µM (50P)", "reference": "60300009", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 1.99, "qty": 1}, {"poste": "SACHET PRISE DE SANG 160X220MM (100P)", "reference": "60101401", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 0.0, "qty": 5}, {"poste": "TIPPEX RECHARGE ROLLER 4,2MM", "reference": "60500110", "fournisseur": "Économat", "descriptif": "Économat — centre de frais E519", "pu": 4.1, "qty": 0}];
function importKit(){
  if(!DATA.centers.length) return;
  if(!confirm("Ajouter le matériel Pharmacie + Économat (centre de frais E519) à TOUS les centres, statut « À commander » ? Les articles déjà présents (même référence) sont ignorés.")) return;
  let added = 0;
  DATA.centers.forEach(c=>{
    KIT_E519.forEach(k=>{
      if(c.orders.some(o=>(o.reference||"")===k.reference && o.poste===k.poste && k.reference)) return;
      if(!k.reference && c.orders.some(o=>o.poste===k.poste && o.fournisseur===k.fournisseur)) return;
      c.orders.push({ id: genId("o"), gk: "kit-"+(k.reference||k.poste), poste:k.poste, descriptif:k.descriptif, reference:k.reference, fournisseur:k.fournisseur, url:"", pu:k.pu, qty:k.qty, status:"a_commander", leadtime:null });
      added++;
    });
  });
  buildIndexes(); markDirty(); renderEditor(); renderOrders(); renderOverview();
  alert(added + " ligne(s) ajoutée(s) au total. Ajustez les quantités par centre dans l'onglet Édition si besoin.");
}

function wireEditorButtons(){
  document.getElementById("btnAddCenter").addEventListener("click", ()=>{
    const n = DATA.centers.length + 1;
    const today = new Date().toISOString().slice(0,10);
    const c = {
      id: genId("c"), nom: `${n}. Nouveau centre`, type: "À préciser",
      priorite: n, kickoff: today, ouverture: today, budget: "complet",
      urgence: "", tasks: [], orders: [],
    };
    DATA.centers.push(c);
    activeEditCenterId = c.id;
    markDirty();
    renderEditCenterTabs(); renderEditor();
    renderTaskCenterTabs(); renderOrderCenterTabs(); renderOverview(); renderPlanning();
  });

  document.getElementById("btnDeleteCenter").addEventListener("click", ()=>{
    const c = DATA.centers.find(x=>x.id===activeEditCenterId);
    if(!c) return;
    if(!confirm(`Supprimer définitivement « ${c.nom} » et toutes ses tâches/commandes ?`)) return;
    DATA.centers = DATA.centers.filter(x=>x!==c);
    activeEditCenterId = null;
    markDirty();
    buildIndexes();
    renderEditCenterTabs(); renderEditor();
    renderTaskCenterTabs(); renderKanban(); renderOrderCenterTabs(); renderOrders();
    renderOverview(); renderPlanning();
  });

  document.getElementById("btnAddTask").addEventListener("click", ()=>{
    const c = DATA.centers.find(x=>x.id===activeEditCenterId);
    if(!c) return;
    const today = new Date().toISOString().slice(0,10);
    const nt = { id: genId("t"), phase:"Nouvelle phase", label:"Nouvelle tâche", resp:"", start:today, end:today, status:"todo", milestone:false };
    c.tasks.push(nt);
    if(propOn()){
      ensureGk(nt);
      otherCenters(c).forEach(o=>{
        o.tasks.push({ ...nt, id: genId("t"), start: mapDate(c,o,nt.start), end: mapDate(c,o,nt.end) });
      });
    }
    buildIndexes(); markDirty();
    renderEditor(); renderKanban(); renderOverview(); renderPlanning();
  });

  document.getElementById("btnAddOrder").addEventListener("click", ()=>{
    const c = DATA.centers.find(x=>x.id===activeEditCenterId);
    if(!c) return;
    const no = { id: genId("o"), poste:"Nouvel article", descriptif:"", reference:"", fournisseur:"", url:"", pu:0, qty:1, status:"a_commander", leadtime:null };
    c.orders.push(no);
    if(propOn()){
      ensureGk(no);
      otherCenters(c).forEach(o=>{ o.orders.push({ ...no, id: genId("o") }); });
    }
    buildIndexes(); markDirty();
    renderEditor(); renderOrders(); renderOverview();
  });

  document.getElementById("btnPdfAll").addEventListener("click", ()=>exportReportPdf("all"));
  document.getElementById("btnPdfCenter").addEventListener("click", ()=>exportReportPdf("center"));
  document.getElementById("btnExportCenter").addEventListener("click", ()=>exportOrders("center"));
  document.getElementById("btnExportAll").addEventListener("click", ()=>exportOrders("all"));
  document.getElementById("btnPublish").addEventListener("click", ()=>{
    if(DATA_SOURCE === "api"){ clearTimeout(pushTimer); pushSilently(); } else publishData();
  });
  document.getElementById("btnImportKit").addEventListener("click", importKit);
  loadPropPrefs();
  ["chkPropAll","chkPropDates"].forEach(id=>document.getElementById(id).addEventListener("change", savePropPrefs));
  document.getElementById("btnDownload").addEventListener("click", downloadDataBackup);
}

async function publishData(){
  const statusEl = document.getElementById("editSaveStatus");
  statusEl.textContent = "Publication en cours…";
  let pw = sessionStorage.getItem(CONFIG.editPasswordKey) || "";
  const attempt = async (password)=>{
    return fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Edit-Password": password },
      body: JSON.stringify(DATA),
    });
  };
  try{
    let res = await attempt(pw);
    if(res.status === 401){
      pw = prompt("Mot de passe d'édition requis pour publier :") || "";
      res = await attempt(pw);
      if(res.ok) sessionStorage.setItem(CONFIG.editPasswordKey, pw);
    }
    if(res.ok){
      markClean("✓ Publié — visible par toute l'équipe.");
      buildIndexes();
      return;
    }
    const err = await res.json().catch(()=>({}));
    if(res.status === 503){
      statusEl.textContent = "⚠ Stockage partagé non configuré côté hébergement (voir README.md, section 6). Utilisez « Télécharger une copie » ci-dessous en attendant.";
    }else if(res.status === 401){
      statusEl.textContent = "⚠ Mot de passe incorrect — publication annulée.";
    }else{
      statusEl.textContent = "⚠ Échec de la publication : " + (err.message || res.status);
    }
  }catch(e){
    statusEl.textContent = "⚠ Échec de la publication (réseau). Vos modifications restent dans cette page — téléchargez une copie par sécurité.";
  }
}

function downloadDataBackup(){
  const blob = new Blob([JSON.stringify(DATA, null, 1)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "data.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------- Tabs / init ---------------- */
document.querySelectorAll(".tab-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-"+btn.dataset.view).classList.add("active");
  });
});

let DATA_SOURCE = "static", LAST_JSON = "", pushTimer = null;
async function loadData(){
  try{
    const res = await fetch(CONFIG.apiUrl, {cache:"no-store"});
    if(res.ok){ DATA_SOURCE = "api"; const j = await res.json(); LAST_JSON = JSON.stringify(j); return j; }
  }catch(e){ /* API route unavailable (e.g. plain static hosting) — fall back below */ }
  try{
    const res = await fetch(CONFIG.dataUrl, {cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    return await res.json();
  }catch(e){
    document.body.innerHTML = `<div style="max-width:640px;margin:80px auto;padding:24px;font-family:sans-serif;">
      <h2 style="color:#C6392F;">Impossible de charger les données</h2>
      <p>Ni <code>/api/data</code> ni <code>data.json</code> n'ont pu être chargés. Si vous ouvrez ce fichier
      directement (double-clic, file://), le navigateur bloque ce chargement pour des raisons de sécurité.</p>
      <p>Déposez tous les fichiers ensemble sur votre hébergement, puis ouvrez l'URL correspondante.</p>
      <p style="color:#5B6B7A;font-size:13px;">Détail technique : ${e.message}</p>
    </div>`;
    throw e;
  }
}

// ---- Synchronisation automatique entre utilisateurs ----
function renderAll(){
  buildIndexes();
  renderOverview(); renderPlanning(); renderTaskCenterTabs(); renderKanban();
  renderOrderCenterTabs(); renderOrders(); renderEditCenterTabs(); renderEditor();
}
function schedulePush(){
  if(DATA_SOURCE !== "api") return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSilently, 900);
}
function nowHM(){ return new Date().toLocaleTimeString("fr-BE",{hour:"2-digit",minute:"2-digit"}); }
async function pushSilently(keep){
  clearTimeout(pushTimer); pushTimer = null;
  if(DATA_SOURCE !== "api") return;
  if(pushing){ schedulePush(); return; }
  pushing = true;
  const seq = editSeq;
  const el = document.getElementById("syncStatus");
  const banner = document.getElementById("editSaveStatus");
  const body = JSON.stringify(DATA);
  const send = pw => fetch(CONFIG.apiUrl,{method:"POST",keepalive: keep===true && body.length < 60000,headers:{"Content-Type":"application/json","X-Edit-Password":pw},body});
  try{
    let pw = sessionStorage.getItem(CONFIG.editPasswordKey) || "";
    let res = await send(pw);
    if(res.status === 401){
      pw = prompt("Mot de passe d'édition requis pour partager ce changement :") || "";
      res = await send(pw);
      if(res.ok) sessionStorage.setItem(CONFIG.editPasswordKey, pw);
    }
    if(res.ok){
      LAST_JSON = body;
      if(el) el.textContent = "✓ Synchronisé " + nowHM();
      if(seq === editSeq){ markClean("✓ Enregistré automatiquement à " + nowHM() + " — visible par toute l'équipe."); }
    }else{
      const err = await res.json().catch(()=>({}));
      const msg = "⚠ Changement non partagé (" + res.status + (err.message ? " — " + err.message : "") + ")";
      if(el) el.textContent = msg;
      if(banner && isDirty) banner.textContent = msg + " — nouvel essai à la prochaine modification.";
    }
  }catch(e){
    if(el) el.textContent = "⚠ Changement non partagé (réseau)";
    if(banner && isDirty) banner.textContent = "⚠ Réseau indisponible — modifications non enregistrées, nouvel essai à la prochaine modification.";
  }
  pushing = false;
  if(seq !== editSeq && isDirty) schedulePush();
}
function editorHasFocus(){
  const a = document.activeElement, v = document.getElementById("view-edit");
  return !!(a && v && v.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
async function pollRemote(){
  if(DATA_SOURCE !== "api" || isDirty || pushTimer || pushing || editorHasFocus()) return;
  try{
    const res = await fetch(CONFIG.apiUrl + "?t=" + Date.now(), {cache:"no-store"});
    if(!res.ok) return;
    const txt = JSON.stringify(await res.clone().json());
    if(txt === LAST_JSON || isDirty || pushTimer || pushing) return;
    LAST_JSON = txt; DATA = JSON.parse(txt); renderAll();
    const el = document.getElementById("syncStatus");
    if(el) el.textContent = "↻ Mis à jour " + nowHM();
  }catch(e){ /* réseau indisponible : on réessaiera */ }
}
setInterval(pollRemote, 30000);
document.addEventListener("visibilitychange", ()=>{
  if(document.hidden){ if(pushTimer || isDirty) pushSilently(true); }
  else pollRemote();
});

async function init(){
  DATA = await loadData();
  TODAY = new Date(); TODAY.setHours(0,0,0,0);
  TL_START = parseISO(CONFIG.timelineStart);
  TL_END = parseISO(CONFIG.timelineEnd);
  TOTAL_DAYS = diffDays(TL_END, TL_START);

  buildIndexes();

  document.getElementById("todayLabel").textContent = TODAY.toLocaleDateString("fr-BE",{day:"2-digit",month:"long",year:"numeric"});
  document.getElementById("reportingDate").textContent = parseISO(DATA.reporting_deadline).toLocaleDateString("fr-BE",{day:"2-digit",month:"long",year:"numeric"});

  const modeLabel = document.getElementById("storageModeLabel");
  if(modeLabel){
    const shared = DATA_SOURCE === "api" || !!(window.storage && window.storage.get);
    modeLabel.textContent = shared
      ? "Données partagées avec l'équipe projet (statuts visibles et modifiables par tous)."
      : "⚠ Stockage local à ce navigateur (les statuts modifiés ici ne sont pas visibles par les autres — voir README.md, section 5).";
  }

  state = await loadState();
  if(DATA_SOURCE !== "api") applyState();   // en mode partagé, les statuts viennent des données du serveur

  renderOverview();
  renderPlanning();
  renderTaskCenterTabs();
  renderKanban();
  renderOrderCenterTabs();
  renderOrders();
  renderEditCenterTabs();
  renderEditor();
  wireEditorButtons();
}
init();
