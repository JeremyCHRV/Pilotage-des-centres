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
function buildIndexes(){
  TASK_IDX = {}; ORDER_IDX = {};
  DATA.centers.forEach(c=>{
    c.tasks.forEach(t=>TASK_IDX[t.id]={c,t});
    c.orders.forEach(o=>ORDER_IDX[o.id]={c,o});
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
  meta.innerHTML = `<b>${c.type}</b> · Lancement ${fmtFR(c.kickoff)} → Ouverture cible <b>${fmtFR(c.ouverture)}</b><br>${c.urgence}`;
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
    <div class="stat"><div class="n">${livre}/${c.orders.length}</div><div class="l">Postes livrés</div></div>
  `;
  const rows = document.getElementById("orderRows");
  rows.innerHTML = "";
  c.orders.forEach(o=>{
    const tr = document.createElement("tr");
    if(o.leadtime) tr.className = "leadtime";
    tr.innerHTML = `
      <td>${o.poste}${o.leadtime? `<span class="lt-badge">⚠ délai ${o.leadtime} sem.</span>`:""}</td>
      <td>${o.pu.toLocaleString("fr-BE",{minimumFractionDigits:2})} €</td>
      <td>${o.qty}</td>
      <td>${eur(o.pu*o.qty)}</td>
      <td style="color:var(--text-mut); font-size:11.5px;">${o.info||""}</td>
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
  totRow.innerHTML = `<td colspan="3">TOTAL</td><td>${eur(total)}</td><td colspan="2"></td>`;
  rows.appendChild(totRow);
}

/* ---------------- Édition (admin) ---------------- */
let activeEditCenterId = null;
let isDirty = false;
let genSeq = 1;
function genId(prefix){ return prefix + Date.now().toString(36) + (genSeq++).toString(36); }

function markDirty(){
  isDirty = true;
  const banner = document.getElementById("editSaveStatus");
  if(banner) banner.textContent = "⚠ Modifications non publiées — cliquez sur « Publier pour toute l'équipe » pour les partager (ou téléchargez une copie de sauvegarde).";
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
    fieldRow("Point de vigilance / note affichée sur la carte", `<textarea id="f-urgence">${(c.urgence||"")}</textarea>`, true);

  const bind = (id, field, parser)=>{
    document.getElementById(id).addEventListener("input", ()=>{
      const el = document.getElementById(id);
      c[field] = parser ? parser(el.value) : el.value;
      markDirty();
      renderOverview(); renderPlanning();
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
        t[f] = inp.type==="checkbox" ? inp.checked : inp.value;
        markDirty();
        renderOverview(); renderPlanning();
      });
    });
    tr.querySelector(".row-del").addEventListener("click", ()=>{
      if(!confirm("Supprimer cette tâche ?")) return;
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
      <td><input type="text" data-f="poste" value="${(o.poste||"").replace(/"/g,'&quot;')}" style="min-width:180px;"></td>
      <td><input type="number" step="0.01" data-f="pu" value="${o.pu}"></td>
      <td><input type="number" data-f="qty" value="${o.qty}"></td>
      <td><input type="text" data-f="info" value="${(o.info||"").replace(/"/g,'&quot;')}"></td>
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
        if(f==="pu") o.pu = parseFloat(inp.value)||0;
        else if(f==="qty") o.qty = parseInt(inp.value,10)||0;
        else if(f==="leadtime") o.leadtime = inp.value===""? null : parseInt(inp.value,10);
        else o[f] = inp.value;
        markDirty();
        renderOverview();
      });
    });
    tr.querySelector(".row-del").addEventListener("click", ()=>{
      if(!confirm("Supprimer cet article ?")) return;
      c.orders = c.orders.filter(x=>x!==o);
      delete ORDER_IDX[o.id];
      markDirty();
      renderEditor(); renderOverview();
    });
    obody.appendChild(tr);
  });
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
    c.tasks.push({ id: genId("t"), phase:"Nouvelle phase", label:"Nouvelle tâche", resp:"", start:today, end:today, status:"todo", milestone:false });
    markDirty();
    renderEditor(); renderKanban();
  });

  document.getElementById("btnAddOrder").addEventListener("click", ()=>{
    const c = DATA.centers.find(x=>x.id===activeEditCenterId);
    if(!c) return;
    c.orders.push({ id: genId("o"), poste:"Nouvel article", pu:0, qty:1, info:"", status:"a_commander", leadtime:null });
    markDirty();
    renderEditor(); renderOrders();
  });

  document.getElementById("btnPublish").addEventListener("click", publishData);
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
  pushTimer = setTimeout(pushSilently, 800);
}
async function pushSilently(){
  const el = document.getElementById("syncStatus");
  const send = pw => fetch(CONFIG.apiUrl,{method:"POST",headers:{"Content-Type":"application/json","X-Edit-Password":pw},body:JSON.stringify(DATA)});
  try{
    let pw = sessionStorage.getItem(CONFIG.editPasswordKey) || "";
    let res = await send(pw);
    if(res.status === 401){
      pw = prompt("Mot de passe d'édition requis pour partager ce changement :") || "";
      res = await send(pw);
      if(res.ok) sessionStorage.setItem(CONFIG.editPasswordKey, pw);
    }
    if(res.ok){ LAST_JSON = JSON.stringify(DATA); if(el) el.textContent = "✓ Synchronisé " + new Date().toLocaleTimeString("fr-BE",{hour:"2-digit",minute:"2-digit"}); }
    else if(el) el.textContent = "⚠ Changement non partagé (" + res.status + ")";
  }catch(e){ if(el) el.textContent = "⚠ Changement non partagé (réseau)"; }
}
async function pollRemote(){
  if(DATA_SOURCE !== "api" || isDirty || pushTimer) return;
  try{
    const res = await fetch(CONFIG.apiUrl + "?t=" + Date.now(), {cache:"no-store"});
    if(!res.ok) return;
    const txt = JSON.stringify(await res.clone().json());
    if(txt === LAST_JSON) return;
    LAST_JSON = txt; DATA = JSON.parse(txt); renderAll();
    const el = document.getElementById("syncStatus");
    if(el) el.textContent = "↻ Mis à jour " + new Date().toLocaleTimeString("fr-BE",{hour:"2-digit",minute:"2-digit"});
  }catch(e){ /* réseau indisponible : on réessaiera */ }
}
setInterval(pollRemote, 30000);
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) pollRemote(); });

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
