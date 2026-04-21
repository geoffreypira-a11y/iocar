// IO Car v2.1 — 2026-04-20T22:18:38
import React, { useState, useEffect, useRef, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

/* ═══════════════════════════════════════════════════════════════
   SUPABASE CONFIG
═══════════════════════════════════════════════════════════════ */
const SUPABASE_URL = "https://lnukqnopmlvaqxbdwhst.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxudWtxbm9wbWx2YXF4YmR3aHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MzY3OTgsImV4cCI6MjA5MjIxMjc5OH0.HkS1i0cakprVyY83_lGuym8CjuiDwXjYIEeVAmm_F6s";

// Client Supabase léger sans SDK (fetch natif)
const sb = {
  headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" },

  async signUp(email, password, garage_name) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST", headers: { ...this.headers, "Authorization": `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ email, password, data: { garage_name } })
    });
    return r.json();
  },

  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { ...this.headers },
      body: JSON.stringify({ email, password })
    });
    return r.json();
  },

  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST", headers: { ...this.headers, "Authorization": `Bearer ${token}` }
    });
  },

  async getUser(token) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { ...this.headers, "Authorization": `Bearer ${token}` }
    });
    return r.json();
  },

  async resetPassword(email) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: "POST", headers: { ...this.headers },
      body: JSON.stringify({ email })
    });
    return r.json();
  },

  // CRUD générique
  authedHeaders(token) {
    return { ...this.headers, "Authorization": `Bearer ${token}` };
  },

  async select(token, table, filter = "") {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}&order=created_at.desc`, {
      headers: this.authedHeaders(token)
    });
    return r.ok ? r.json() : [];
  },

  async upsert(token, table, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...this.authedHeaders(token), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(data)
    });
    return r.ok ? r.json() : null;
  },

  async update(token, table, id, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...this.authedHeaders(token), "Prefer": "return=representation" },
      body: JSON.stringify(data)
    });
    return r.ok ? r.json() : null;
  },

  async delete(token, table, id) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE", headers: this.authedHeaders(token)
    });
  },

  async getGarage(token, userId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/garages?user_id=eq.${userId}`, {
      headers: this.authedHeaders(token)
    });
    const data = await r.json();
    return data?.[0] || null;
  },

  async updateGarage(token, userId, data) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/garages?user_id=eq.${userId}`, {
      method: "PATCH",
      headers: { ...this.authedHeaders(token), "Prefer": "return=representation" },
      body: JSON.stringify(data)
    });
    return r.ok ? r.json() : null;
  },
};

// Persistance token dans localStorage
const TOKEN_KEY = "iocar_token";
const USER_KEY  = "iocar_user";
function saveSession(token, user) {
  try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch(e) {}
}
function loadSession() {
  try { return { token: localStorage.getItem(TOKEN_KEY), user: JSON.parse(localStorage.getItem(USER_KEY) || "null") }; } catch(e) { return { token: null, user: null }; }
}
function clearSession() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch(e) {}
}

/* ═══════════════════════════════════════════════════════════════
   STYLES
═══════════════════════════════════════════════════════════════ */
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&display=swap');

*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0b0c10;--card:#13141a;--card2:#1c1d26;--card3:#22232e;
  --gold:#d4a843;--gold2:#f0c86a;--gold3:rgba(212,168,67,.15);
  --border:rgba(212,168,67,.14);--border2:rgba(255,255,255,.06);
  --text:#f0ede8;--muted:#6b6a7a;--muted2:#9997aa;
  --green:#3ecf7a;--red:#e55c5c;--blue:#5c9ce5;--orange:#e5973c;
  --radius:10px;
}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
input,textarea,select{font-family:'DM Sans',sans-serif}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--card)}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}

/* LAYOUT */
.shell{display:flex;min-height:100vh}
.sidebar{
  width:220px;flex-shrink:0;background:var(--card);
  border-right:1px solid var(--border2);
  display:flex;flex-direction:column;
  position:sticky;top:0;height:100vh;overflow-y:auto;
}
.sidebar.demo-pushed{top:36px;height:calc(100vh - 36px)}
.content{flex:1;overflow-x:hidden;min-width:0}

/* SIDEBAR */
.sidebar-logo{
  padding:24px 20px 20px;
  border-bottom:1px solid var(--border2);
}
.logo-main{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;letter-spacing:3px;color:var(--gold)}
.logo-main span{color:var(--text)}
.logo-sub{font-size:10px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-top:3px}

.nav-section{padding:16px 12px 8px}
.nav-label{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);padding:0 8px;margin-bottom:6px}
.nav-item{
  display:flex;align-items:center;gap:10px;
  padding:10px 12px;border-radius:8px;
  font-size:13px;font-weight:500;cursor:pointer;
  transition:all .15s;color:var(--muted2);
  border:1px solid transparent;
  margin-bottom:2px;
}
.nav-item:hover{background:var(--card2);color:var(--text)}
.nav-item.active{background:var(--gold3);color:var(--gold);border-color:var(--border)}
.nav-icon{font-size:16px;width:20px;text-align:center}

.sidebar-footer{margin-top:auto;padding:16px;border-top:1px solid var(--border2)}
.dealer-info{font-size:11px;color:var(--muted);line-height:1.6}

/* PAGE */
.page{padding:28px 32px;max-width:1300px}
.page.demo-offset{padding-top:64px}
.page-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;gap:16px;flex-wrap:wrap}
.page-title{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;letter-spacing:1px}
.page-sub{font-size:13px;color:var(--muted);margin-top:4px}

/* BUTTONS */
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;border-radius:7px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;transition:all .15s;letter-spacing:.3px}
.btn-primary{background:var(--gold);color:#0b0c10}
.btn-primary:hover{background:var(--gold2);transform:translateY(-1px)}
.btn-ghost{background:transparent;color:var(--muted2);border:1px solid var(--border2)}
.btn-ghost:hover{border-color:var(--border);color:var(--text)}
.btn-danger{background:rgba(229,92,92,.15);color:var(--red);border:1px solid rgba(229,92,92,.2)}
.btn-danger:hover{background:rgba(229,92,92,.25)}
.btn-sm{padding:6px 12px;font-size:12px}
.btn-xs{padding:4px 9px;font-size:11px}

/* CARDS */
.card{background:var(--card);border:1px solid var(--border2);border-radius:var(--radius)}
.card-pad{padding:20px 24px}

/* KPI GRID */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:28px}
.kpi{background:var(--card);border:1px solid var(--border2);border-radius:var(--radius);padding:20px;transition:border-color .2s;cursor:default}
.kpi:hover{border-color:var(--border)}
.kpi-label{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.kpi-val{font-family:'Syne',sans-serif;font-size:30px;font-weight:700;line-height:1}
.kpi-val.green{color:var(--green)}
.kpi-val.gold{color:var(--gold)}
.kpi-val.red{color:var(--red)}
.kpi-val.blue{color:var(--blue)}
.kpi-foot{font-size:11px;color:var(--muted);margin-top:6px}

/* TABLE */
.tbl-wrap{overflow-x:auto;border-radius:var(--radius);border:1px solid var(--border2)}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{background:var(--card2);padding:10px 14px;text-align:left;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:600;white-space:nowrap}
tbody td{padding:12px 14px;border-bottom:1px solid var(--border2);color:var(--text);vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr{transition:background .1s;cursor:pointer}
tbody tr:hover td{background:var(--card2)}

/* BADGES */
.badge{display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.5px;white-space:nowrap}
.badge-green{background:rgba(62,207,122,.12);color:var(--green);border:1px solid rgba(62,207,122,.2)}
.badge-gold{background:var(--gold3);color:var(--gold);border:1px solid var(--border)}
.badge-red{background:rgba(229,92,92,.12);color:var(--red);border:1px solid rgba(229,92,92,.2)}
.badge-blue{background:rgba(92,156,229,.12);color:var(--blue);border:1px solid rgba(92,156,229,.2)}
.badge-orange{background:rgba(229,151,60,.12);color:var(--orange);border:1px solid rgba(229,151,60,.2)}
.badge-muted{background:rgba(107,106,122,.12);color:var(--muted2);border:1px solid rgba(107,106,122,.2)}

/* PLATE */
.plate{display:inline-flex;align-items:center;gap:5px;background:#fff;border:1.5px solid #003189;border-radius:5px;padding:3px 10px}
.plate-eu{background:#003189;color:#fdd835;font-size:8px;font-weight:700;padding:2px 4px;border-radius:3px;line-height:1.4;text-align:center}
.plate-num{font-family:'DM Mono',monospace;font-size:13px;font-weight:700;color:#111;letter-spacing:2px}

/* FORM */
.form-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.form-group{display:flex;flex-direction:column;gap:5px}
.form-group.full{grid-column:1/-1}
.form-label{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:600}
.form-input{background:var(--card2);border:1px solid var(--border2);border-radius:7px;padding:9px 12px;color:var(--text);font-size:13px;outline:none;transition:border-color .15s;width:100%}
.form-input:focus{border-color:var(--gold)}
.form-input::placeholder{color:var(--muted)}
select.form-input{cursor:pointer}
textarea.form-input{resize:vertical;min-height:72px}

/* MODAL */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);animation:fadein .15s}
@keyframes fadein{from{opacity:0}to{opacity:1}}
.modal{background:var(--card);border:1px solid var(--border);border-radius:14px;width:100%;max-height:90vh;overflow-y:auto;animation:slideup .2s}
@keyframes slideup{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
.modal-sm{max-width:480px}
.modal-md{max-width:700px}
.modal-lg{max-width:960px}
.modal-hd{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border2);position:sticky;top:0;background:var(--card);z-index:1}
.modal-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:700}
.modal-body{padding:24px}
.modal-foot{padding:16px 24px;border-top:1px solid var(--border2);display:flex;justify-content:flex-end;gap:10px}
.close-btn{background:var(--card2);border:none;color:var(--muted2);width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.close-btn:hover{background:var(--card3);color:var(--text)}

/* TABS */
.tabs{display:flex;gap:4px;background:var(--card);border:1px solid var(--border2);border-radius:9px;padding:4px;margin-bottom:20px;width:fit-content}
.tab{padding:7px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;color:var(--muted2);letter-spacing:.5px}
.tab.active{background:var(--gold);color:#0b0c10}
.tab:not(.active):hover{color:var(--text)}

/* SEARCH BAR */
.search-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.search-input{background:var(--card);border:1px solid var(--border2);border-radius:7px;padding:8px 14px 8px 36px;color:var(--text);font-size:13px;outline:none;width:240px;transition:border-color .15s;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%236b6a7a' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:12px center}
.search-input:focus{border-color:var(--border)}

/* PROGRESS BAR */
.progress{height:4px;background:var(--card2);border-radius:2px;overflow:hidden;margin-top:8px}
.progress-fill{height:100%;border-radius:2px;transition:width .3s}

/* DIVIDER */
.divider{border:none;border-top:1px solid var(--border2);margin:20px 0}

/* ═══ AUTH SCREENS ═══ */
.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:20px}
.auth-box{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:40px;width:100%;max-width:420px;animation:slideup .25s}
.auth-error{background:rgba(229,92,92,.12);border:1px solid rgba(229,92,92,.2);color:var(--red);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:16px}
.auth-success{background:rgba(62,207,122,.1);border:1px solid rgba(62,207,122,.2);color:var(--green);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:16px}
.auth-switch{text-align:center;margin-top:20px;font-size:13px;color:var(--muted)}
.auth-switch a{color:var(--gold);cursor:pointer;font-weight:600}
.plan-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700}
.plan-trial{background:rgba(212,168,67,.15);color:var(--gold);border:1px solid var(--border)}
.plan-active{background:rgba(62,207,122,.12);color:var(--green);border:1px solid rgba(62,207,122,.2)}
.plan-suspended{background:rgba(229,92,92,.12);color:var(--red);border:1px solid rgba(229,92,92,.2)}

/* ═══ MOBILE RESPONSIVE ═══ */
.hamburger{
  display:none;position:fixed;top:12px;left:12px;z-index:400;
  width:42px;height:42px;border-radius:10px;
  background:var(--card);border:1px solid var(--border2);
  cursor:pointer;align-items:center;justify-content:center;
  flex-direction:column;gap:5px;box-shadow:0 4px 16px rgba(0,0,0,.4);
}
.hamburger span{width:18px;height:2px;background:var(--text);border-radius:2px;transition:all .2s}
.sidebar-overlay{
  display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);
  z-index:300;backdrop-filter:blur(2px);
}
.bottom-nav{
  display:none;position:fixed;bottom:0;left:0;right:0;
  background:var(--card);border-top:1px solid var(--border2);
  z-index:250;padding:6px 4px calc(6px + env(safe-area-inset-bottom));
  grid-template-columns:repeat(5,1fr);gap:0;
}
.bottom-nav-item{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:3px;padding:6px 4px;border-radius:8px;cursor:pointer;
  font-size:9px;font-weight:600;color:var(--muted2);letter-spacing:.5px;
  text-transform:uppercase;transition:all .15s;
}
.bottom-nav-item.active{color:var(--gold)}
.bottom-nav-item .bn-icon{font-size:20px;line-height:1}

@media(max-width:768px){
  .hamburger{display:flex}
  .sidebar{
    position:fixed;left:-240px;top:0;bottom:0;z-index:350;
    width:240px;transition:left .25s cubic-bezier(.4,0,.2,1);
    box-shadow:4px 0 24px rgba(0,0,0,.5);
  }
  .sidebar.open{left:0}
  .sidebar-overlay{display:block}
  .content{padding-top:0}
  .content.demo-offset{padding-top:36px}
  .page{padding:70px 16px 90px}
  .page-title{font-size:22px}
  .kpi-grid{grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px}
  .kpi{padding:14px}
  .kpi-val{font-size:22px}
  .tbl-wrap{border-radius:8px;font-size:12px}
  thead th{padding:8px 10px;font-size:9px}
  tbody td{padding:10px;font-size:12px}
  .modal{border-radius:16px 16px 0 0;max-height:95vh;position:fixed;bottom:0;left:0;right:0;width:100%!important;max-width:100%!important;margin:0}
  .modal-bg{align-items:flex-end;padding:0}
  .modal-lg,.modal-md,.modal-sm{max-width:100%}
  .form-grid{grid-template-columns:1fr}
  .form-group.full{grid-column:1}
  .tabs{overflow-x:auto;width:100%;-webkit-overflow-scrolling:touch}
  .tab{white-space:nowrap;font-size:11px;padding:6px 12px}
  .search-input{width:100%}
  .search-bar{flex-direction:column;align-items:stretch}
  .page-header{flex-direction:column;gap:12px}
  .page-header > div:last-child{display:flex;flex-wrap:wrap;gap:8px}
  .bottom-nav{display:grid}
  /* Masquer le label sidebar sur mobile */
  .sidebar .nav-item{font-size:13px}
  /* Adapte pdoc pour mobile */
  .print-doc{padding:20px}
  .pdoc-head{flex-direction:column;gap:16px}
  .pdoc-parties{flex-direction:column;gap:12px}
  .pdoc-totals{justify-content:flex-end}
  /* Cards CRM */
  .crm-grid{grid-template-columns:1fr!important}
}
@media(max-width:480px){
  .kpi-grid{grid-template-columns:1fr 1fr}
  .kpi-val{font-size:20px}
  .btn{font-size:12px;padding:8px 14px}
  .btn-sm{padding:5px 10px;font-size:11px}
}
@media print{
  .sidebar,.no-print{display:none!important}
  .content{overflow:visible}
  .print-doc{display:block!important}
  body{background:#fff;color:#000}
  @page{margin:15mm}
}

/* PRINT DOC */
.print-doc{
  font-family:'DM Sans',sans-serif;
  background:#fff;color:#111;
  padding:36px;
  border-radius:8px;
}
.print-doc-bar{
  height:5px;background:linear-gradient(90deg,#d4a843,#f0c86a,#d4a843);
  margin:-36px -36px 32px;
  border-radius:8px 8px 0 0;
}
.pdoc-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
.pdoc-logo{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;letter-spacing:3px;color:#111}
.pdoc-type{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:#d4a843;text-align:right}
.pdoc-ref{font-size:11px;color:#888;text-align:right;margin-top:4px}
.pdoc-divider{border:none;border-top:1px solid #e8e8e8;margin:20px 0}
.pdoc-parties{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:28px}
.pdoc-plabel{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#aaa;margin-bottom:6px}
.pdoc-pname{font-size:15px;font-weight:700}
.pdoc-pinfo{font-size:12px;color:#555;line-height:1.8;margin-top:4px}
.pdoc-table{width:100%;border-collapse:collapse;margin-bottom:24px}
.pdoc-table th{background:#f8f6f0;padding:9px 14px;text-align:left;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#888;font-weight:600}
.pdoc-table td{padding:12px 14px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#333}
.pdoc-table tr:last-child td{border-bottom:none}
.pdoc-totals{display:flex;justify-content:flex-end;margin-bottom:28px}
.pdoc-totals-box{width:260px}
.pdoc-trow{display:flex;justify-content:space-between;padding:7px 0;font-size:12px;color:#666;border-bottom:1px solid #f0f0f0}
.pdoc-trow.big{font-size:15px;font-weight:700;color:#111;border-bottom:2px solid #111;padding:10px 0}
.pdoc-footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px;padding-top:20px;border-top:1px solid #e8e8e8}
.pdoc-sig{border-bottom:1px solid #ccc;width:180px;height:55px;display:flex;align-items:flex-end;padding-bottom:6px;font-size:10px;color:#bbb;letter-spacing:1px}
.pdoc-legal{font-size:9px;color:#bbb;max-width:260px;line-height:1.7}
.pdoc-paiements{margin-top:20px;padding:14px 16px;background:#f9f8f5;border-radius:6px}
.pdoc-paiements-title{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#aaa;margin-bottom:10px}

/* VEHICLE FICHE PRINT */
.fiche-print{
  background:linear-gradient(135deg,#0d0d18 0%,#16172a 100%);
  color:#f0ede8;border-radius:12px;overflow:hidden;
  page-break-inside:avoid;
}
@media print{
  .fiche-print{background:#fff!important;color:#111!important;border:1px solid #ddd}
}
.fiche-banner{height:6px;background:linear-gradient(90deg,#d4a843,#f0c86a,#d4a843)}
.fiche-head{padding:24px 28px 16px;display:flex;justify-content:space-between;align-items:flex-start}
.fiche-brand{font-family:'Syne',sans-serif;font-size:36px;font-weight:800;letter-spacing:3px;line-height:1}
.fiche-model{font-size:16px;color:#d4a843;font-weight:600;margin-top:4px}
.fiche-year{font-family:'Syne',sans-serif;font-size:64px;font-weight:800;color:rgba(212,168,67,.12);line-height:1}
.fiche-specs{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(255,255,255,.06);margin:0 0 0}
.fiche-spec{background:rgba(13,13,24,.8);padding:14px 20px}
@media print{.fiche-spec{background:#f9f9f9!important}.fiche-specs{background:#ddd!important}}
.fiche-slabel{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#6b6a7a;margin-bottom:4px}
.fiche-sval{font-size:14px;font-weight:600}
.fiche-price{padding:20px 28px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(212,168,67,.15)}
.fiche-price-label{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6a7a}
.fiche-price-val{font-family:'Syne',sans-serif;font-size:36px;font-weight:800;color:#d4a843}
.fiche-options{padding:0 28px 20px;font-size:12px;color:#9997aa;line-height:1.7}
`;

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */
const uid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
const today = () => new Date().toLocaleDateString("fr-FR");
const fmt = (n) => Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtDec = (n) => Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function getPayStatut(c) {
  if (c.ttc <= 0) return { label: "—", cls: "badge-muted" };
  if (c.reste <= 0.01) return { label: "✅ Soldé", cls: "badge-green" };
  if (c.encaisse > 0) return { label: "⏳ Partiel", cls: "badge-orange" };
  return { label: "💰 À encaisser", cls: "badge-red" };
}
const STATUTS_FLEET = {
  disponible: { label: "Disponible",  cls: "badge-green" },
  réservé:    { label: "Réservé",     cls: "badge-gold" },
  vendu:      { label: "Vendu",       cls: "badge-blue" },
  livré:      { label: "Livré",       cls: "badge-muted" },
  atelier:    { label: "Atelier",     cls: "badge-orange" },
};

function calcOrder(o) {
  const ht = parseFloat(o.prix_ht) || 0;
  const remAmt = ht * ((parseFloat(o.remise_pct) || 0) / 100);
  const base = ht - remAmt;
  // Si sans TVA : prix saisi = TTC, TVA = 0
  const avecTva = o.avec_tva !== false;
  const tvaAmt = avecTva ? base * ((parseFloat(o.tva_pct) || 20) / 100) : 0;
  const ttc = avecTva ? base + tvaAmt : base;
  const encaisse = (o.paiements || []).reduce((s, p) => s + (parseFloat(p.montant) || 0), 0);
  const reste = ttc - encaisse;
  return { ht, remAmt, base, tvaAmt, ttc, encaisse, reste, avecTva };
}

// ─── NUMÉROTATION SÉQUENTIELLE ──────────────────────────────
// Format : BC-2026-0001 / FAC-2026-0001 / AV-2026-0001
function nextRef(orders, type) {
  const year = new Date().getFullYear();
  const prefix = type === "bc" ? "BC" : type === "avoir" ? "AV" : "FAC";
  const existing = (orders || [])
    .filter(o => o.type === type && o.ref?.startsWith(`${prefix}-${year}-`))
    .map(o => parseInt(o.ref.split("-")[2]) || 0);
  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
}
const CARBURANT_MAP = {
  "ES": "Essence", "GO": "Diesel", "EL": "Électrique",
  "GH": "Hybride", "FE": "Hybride rechargeable", "GP": "GPL",
  "GN": "GNV", "HY": "Hydrogène", "ESSENCE": "Essence",
  "DIESEL": "Diesel", "GAZOLE": "Diesel", "ELECTRIQUE": "Électrique",
};
function mapCarburant(raw) {
  if (!raw) return "—";
  const k = raw.toUpperCase().trim();
  return CARBURANT_MAP[k] || raw;
}

async function aiLookupPlate(plate, apiKey) {
  const key = apiKey || "9a05402107mshffd01f995575592p162c8djsn2cf79c109e41";
  const host = "api-de-plaque-d-immatriculation-france.p.rapidapi.com";
  const url = `https://${host}/?plaque=${encodeURIComponent(plate)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": host,
      "Content-Type": "application/json",
      "plaque": plate,
    },
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const d = await res.json();
  const v = d.data || d; // les données sont dans d.data

  // Mapping des champs API → format interne IO Car
  const anneeRaw = v.AWN_annee_de_debut_modele || v.AWN_annee_de_fin_modele || "";
  const annee = anneeRaw ? parseInt(anneeRaw) : null;

  return {
    marque:                   v.AWN_marque              || v.AWN_brand || "",
    modele:                   v.AWN_modele              || v.AWN_model || "",
    finition:                 v.AWN_version             || "",
    annee:                    annee                     || "",
    motorisation:             v.AWN_code_moteur         || "",
    carburant:                mapCarburant(v.AWN_energie || v.AWN_carburant || ""),
    puissance_cv:             v.AWN_PV                  || v.AWN_puissance_din || "",
    boite:                    v.AWN_code_boite_de_vitesses?.[0] || v.AWN_code_de_boite_de_vitesses || "",
    transmission:             v.AWN_transmission        || "",
    couleur:                  v.AWN_couleur             || "",
    couleur_int:              v.AWN_couleur_interieur   || "",
    nb_portes:                v.AWN_nombre_de_portes    || "",
    nb_places:                v.AWN_nombre_de_places    || "",
    kilometrage:              "",
    vin:                      v.AWN_VIN                 || "",
    date_mise_en_circulation: v.AWN_annee_de_debut_modele || "",
    co2:                      v.AWN_co2                 || "",
    options:                  [],
  };
}

/* ═══════════════════════════════════════════════════════════════
   STORAGE HOOK
═══════════════════════════════════════════════════════════════ */
function useStored(key, def) {
  const [val, setVal] = useState(def);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = () => { if (!done) { done = true; setReady(true); } };

    // Timeout de sécurité — si storage ne répond pas en 1.5s, on continue avec la valeur par défaut
    const timer = setTimeout(finish, 1500);

    if (window.storage?.get) {
      window.storage.get(key)
        .then(r => { if (r?.value) { try { setVal(JSON.parse(r.value)); } catch(e) {} } })
        .catch(() => {})
        .finally(() => { clearTimeout(timer); finish(); });
    } else {
      // storage non disponible — mode dégradé
      clearTimeout(timer);
      finish();
    }

    return () => { done = true; clearTimeout(timer); };
  }, []); // eslint-disable-line

  const save = useCallback((v) => {
    setVal(v);
    if (window.storage?.set) {
      window.storage.set(key, JSON.stringify(v)).catch(() => {});
    }
  }, []); // eslint-disable-line

  return [val, save, ready];
}

/* ═══════════════════════════════════════════════════════════════
   PLATE BADGE
═══════════════════════════════════════════════════════════════ */
function PlateBadge({ plate }) {
  if (!plate) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <div className="plate">
      <div className="plate-eu"><span>🇫🇷</span><br />F</div>
      <span className="plate-num">{plate}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════ */
function Dashboard({ vehicles, setVehicles, orders, setTab, apiKey, usage, setUsage }) {
  const fleet = vehicles.length;
  const dispo = vehicles.filter(v => v.statut === "disponible").length;
  const vendu = vehicles.filter(v => v.statut === "vendu").length;

  const allTtc = orders.reduce((s, o) => s + calcOrder(o).ttc, 0);
  const encaisse = orders.reduce((s, o) => s + calcOrder(o).encaisse, 0);
  const aEncaisser = orders.reduce((s, o) => s + Math.max(0, calcOrder(o).reste), 0);
  const nbBC = orders.filter(o => o.type === "bc").length;
  const recent = [...orders].sort((a, b) => (b.date_creation || "").localeCompare(a.date_creation || "")).slice(0, 6);

  const totalAchats = vehicles.reduce((s, v) => s + (parseFloat(v.prix_achat) || 0), 0);
  const soldeTreso = encaisse - totalAchats;
  const tresoPositive = soldeTreso >= 0;

  // ─── RECHERCHE PLAQUE ────────────────────────────────────────
  const [searchPlate, setSearchPlate] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundVehicle, setFoundVehicle] = useState(null); // ouvre VehicleModal

  const monthKey = new Date().toISOString().slice(0, 7);
  const usedThisMonth = usage?.[monthKey] || 0;
  const isFree = usedThisMonth < 10;

  const handlePlateSearch = async () => {
    const plate = searchPlate.trim().toUpperCase().replace(/\s/g, "");
    if (!plate) return;
    if (!isFree) {
      const ok = window.confirm(
        `⚠️ Quota mensuel atteint (${usedThisMonth} recherches ce mois)\n\nCette recherche est payante : 0,20 €\n\nConfirmer ?`
      );
      if (!ok) return;
    }
    setSearching(true);
    try {
      const data = await aiLookupPlate(plate, apiKey);
      setUsage({ ...usage, [monthKey]: usedThisMonth + 1 });
      setFoundVehicle({
        ...data,
        plate,
        options: Array.isArray(data.options) ? data.options.join(", ") : "",
        statut: "disponible",
        date_entree: today(),
        prix_achat: "", prix_vente: "",
      });
    } catch (e) {
      alert(`Erreur : ${e.message}`);
    } finally {
      setSearching(false);
    }
  };

  // Données camembert — on n'affiche que les parts > 0
  const pieTotal = totalAchats + encaisse + aEncaisser;
  const pieData = [
    { name: "Avance tréso (achats)", value: totalAchats, color: "#e55c5c" },
    { name: "Encaissé", value: encaisse, color: "#3ecf7a" },
    { name: "À encaisser", value: aEncaisser, color: "#e5973c" },
  ].filter(d => d.value > 0);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    return (
      <div style={{ background: "#1c1d26", border: "1px solid rgba(212,168,67,.2)", borderRadius: 8, padding: "10px 14px" }}>
        <div style={{ fontSize: 12, color: "#9997aa", marginBottom: 4 }}>{d.name}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: d.payload.color }}>{fmt(d.value)}</div>
        {pieTotal > 0 && <div style={{ fontSize: 11, color: "#6b6a7a", marginTop: 2 }}>{Math.round(d.value / pieTotal * 100)}%</div>}
      </div>
    );
  };

  const CustomLegend = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 8 }}>
      {pieData.map(d => (
        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: d.color, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, color: "#9997aa" }}>{d.name}</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Syne", color: d.color }}>{fmt(d.value)}</div>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 6, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,.06)" }}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#6b6a7a", marginBottom: 4 }}>Solde net tréso</div>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "Syne", color: tresoPositive ? "#3ecf7a" : "#e55c5c" }}>{fmt(soldeTreso)}</div>
        {aEncaisser > 0.01 && (
          <div style={{ fontSize: 11, color: "#d4a843", marginTop: 4 }}>Projection : {fmt(soldeTreso + aEncaisser)}</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="page">
      {/* Modal véhicule ouvert après recherche plaque */}
      {foundVehicle && (
        <VehicleModal
          vehicle={foundVehicle}
          apiKey={apiKey}
          usage={usage}
          setUsage={setUsage}
          onSave={v => {
            setVehicles([v, ...vehicles]);
            setFoundVehicle(null);
            setSearchPlate("");
          }}
          onClose={() => setFoundVehicle(null)}
        />
      )}

      <div className="page-header">
        <div>
          <div className="page-title">Tableau de bord</div>
          <div className="page-sub">Vue d'ensemble de votre activité</div>
        </div>
        {/* BARRE RECHERCHE PLAQUE */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{
            display: "flex", alignItems: "stretch",
            border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden",
            transition: "border-color .2s",
          }}
            onFocus={e => e.currentTarget.style.borderColor = "var(--gold)"}
            onBlur={e => e.currentTarget.style.borderColor = "var(--border)"}
          >
            <div style={{
              background: "var(--card2)", padding: "0 12px",
              display: "flex", alignItems: "center", gap: 6,
              borderRight: "1px solid var(--border2)",
              fontFamily: "DM Mono", fontSize: 10, color: "var(--muted)", letterSpacing: 1
            }}>
              🇫🇷 FR
            </div>
            <input
              value={searchPlate}
              onChange={e => setSearchPlate(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && handlePlateSearch()}
              placeholder="AB-123-CD"
              maxLength={9}
              style={{
                background: "var(--card)", border: "none", outline: "none",
                padding: "10px 14px", fontFamily: "DM Mono", fontSize: 18,
                fontWeight: 700, letterSpacing: 4, color: "var(--text)",
                width: 160,
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <button
              className={`btn ${isFree ? "btn-primary" : "btn-ghost"}`}
              onClick={handlePlateSearch}
              disabled={searching || !searchPlate.trim()}
              style={!isFree ? { borderColor: "var(--orange)", color: "var(--orange)" } : {}}
            >
              {searching ? "⏳ Recherche..." : isFree ? "🔍 Identifier" : "💳 Identifier (0,20€)"}
            </button>
            <div style={{ fontSize: 10, textAlign: "right", color: isFree ? "var(--green)" : "var(--orange)", letterSpacing: .5 }}>
              {isFree ? `${Math.max(0, 10 - usedThisMonth)} gratuite${10 - usedThisMonth > 1 ? "s" : ""} restante${10 - usedThisMonth > 1 ? "s" : ""}` : "Quota mensuel atteint"}
            </div>
          </div>
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
        <div className="kpi" onClick={() => setTab("fleet")} style={{ cursor: "pointer" }}>
          <div className="kpi-label">🚗 En stock</div>
          <div className="kpi-val gold">{dispo}</div>
          <div className="kpi-foot">{fleet} total · {vendu} vendus</div>
        </div>
        <div className="kpi" onClick={() => setTab("fleet")} style={{ cursor: "pointer" }}>
          <div className="kpi-label">🏷 Vendus</div>
          <div className="kpi-val" style={{ color: "var(--muted2)" }}>{vendu}</div>
          <div className="kpi-foot">véhicules cédés</div>
        </div>
        <div className="kpi" onClick={() => setTab("orders")} style={{ cursor: "pointer" }}>
          <div className="kpi-label">📋 BC en cours</div>
          <div className="kpi-val blue">{nbBC}</div>
          <div className="kpi-foot">bons de commande</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">✅ Encaissé</div>
          <div className="kpi-val green">{fmt(encaisse)}</div>
          <div className="kpi-foot">{allTtc > 0 ? Math.round(encaisse / allTtc * 100) : 0}% du CA</div>
          <div className="progress"><div className="progress-fill" style={{ width: allTtc > 0 ? `${Math.min(encaisse / allTtc * 100, 100)}%` : "0%", background: "var(--green)" }} /></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">⏳ À encaisser</div>
          <div className="kpi-val" style={{ color: aEncaisser > 0.01 ? "var(--orange)" : "var(--green)" }}>{fmt(aEncaisser)}</div>
          <div className="kpi-foot">{aEncaisser > 0.01 ? "solde restant dû" : "tout soldé ✓"}</div>
        </div>
        <div className="kpi" style={{ border: `1px solid ${tresoPositive ? "rgba(62,207,122,.3)" : "rgba(229,92,92,.3)"}`, background: tresoPositive ? "rgba(62,207,122,.04)" : "rgba(229,92,92,.04)" }}>
          <div className="kpi-label" style={{ color: tresoPositive ? "var(--green)" : "var(--red)" }}>🏦 Solde tréso</div>
          <div className="kpi-val" style={{ color: tresoPositive ? "var(--green)" : "var(--red)" }}>{fmt(soldeTreso)}</div>
          <div className="kpi-foot">encaissé − achats</div>
        </div>
      </div>

      {/* CAMEMBERT TRÉSORERIE + ACTIVITÉ RÉCENTE */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

        {/* CAMEMBERT */}
        <div className="card">
          <div className="card-pad" style={{ borderBottom: "1px solid var(--border2)" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>🏦 Répartition trésorerie</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Avance achats · Encaissé · À encaisser</div>
          </div>
          <div style={{ padding: "20px 24px" }}>
            {pieData.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "40px 0" }}>
                Aucune donnée financière
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 200, height: 200, flexShrink: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <CustomLegend />
              </div>
            )}
          </div>
        </div>

        {/* ACTIVITÉ RÉCENTE */}
        <div className="card">
          <div className="card-pad" style={{ borderBottom: "1px solid var(--border2)" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>🕒 Activité récente</div>
          </div>
          {recent.length === 0 ? (
            <div className="card-pad" style={{ color: "var(--muted)", fontSize: 13 }}>Aucune activité</div>
          ) : (
            <div>
              {recent.map(o => {
                const c = calcOrder(o);
                return (
                  <div key={o.id} style={{ padding: "11px 20px", borderBottom: "1px solid var(--border2)", display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 18 }}>{o.type === "facture" ? "🧾" : "📝"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{o.client?.name || "Client non défini"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{o.ref} · {o.date_creation}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{fmt(c.ttc)}</div>
                      <span className={`badge ${getPayStatut(c).cls}`}>{getPayStatut(c).label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* SUIVI ENCAISSEMENTS */}
      <div className="card">
        <div className="card-pad" style={{ borderBottom: "1px solid var(--border2)" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>💳 Suivi encaissements en attente</div>
        </div>
        {orders.filter(o => calcOrder(o).reste > 0.01).length === 0 ? (
          <div className="card-pad" style={{ color: "var(--muted)", fontSize: 13 }}>✅ Aucun encaissement en attente</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 1, background: "var(--border2)" }}>
            {orders.filter(o => calcOrder(o).reste > 0.01).map(o => {
              const c = calcOrder(o);
              const pct = c.ttc > 0 ? Math.round(c.encaisse / c.ttc * 100) : 0;
              return (
                <div key={o.id} style={{ padding: "14px 20px", background: "var(--card)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{o.client?.name || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{o.vehicle_label || o.ref}</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12 }}>
                      <div style={{ color: "var(--green)", fontWeight: 700 }}>{fmt(c.encaisse)}</div>
                      <div style={{ color: "var(--orange)" }}>reste {fmt(c.reste)}</div>
                    </div>
                  </div>
                  <div className="progress"><div className="progress-fill" style={{ width: `${pct}%`, background: pct === 100 ? "var(--green)" : "var(--gold)" }} /></div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{pct}% encaissé</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VEHICLE FORM MODAL
═══════════════════════════════════════════════════════════════ */
function VehicleModal({ vehicle, onSave, onClose, apiKey, usage, setUsage, garageId, viewMode }) {
  const [form, setForm] = useState(vehicle ? {
    ...vehicle,
    options: Array.isArray(vehicle.options) ? vehicle.options.join(", ") : vehicle.options || "",
    // Si le véhicule a déjà un prix d'achat, on active le toggle tréso
    includeTreso: !!(parseFloat(vehicle.prix_achat) > 0),
  } : {
    plate: "", marque: "", modele: "", finition: "", annee: new Date().getFullYear(),
    motorisation: "", carburant: "Essence", puissance_cv: "", boite: "Manuelle 6",
    transmission: "Traction", couleur: "", couleur_int: "", nb_portes: 5, nb_places: 5,
    kilometrage: "", vin: "", date_entree: today(),
    prix_achat: "", prix_vente: "",
    statut: "disponible", options: "", notes: "",
    includeTreso: false,
  });
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ─── QUOTA MENSUEL ────────────────────────────────────────────
  const QUOTA_FREE = 10;
  const COST_EXTRA = 0.20;
  const monthKey = new Date().toISOString().slice(0, 7); // "2026-04"
  const usedThisMonth = usage?.[monthKey] || 0;
  const isFree = usedThisMonth < QUOTA_FREE;
  const remaining = Math.max(0, QUOTA_FREE - usedThisMonth);

  const handleAI = async () => {
    if (!form.plate) return;

    // Confirmation si quota dépassé (pas pour l'admin)
    if (!isFree && viewMode !== "admin") {
      const ok = window.confirm(
        `⚠️ Quota mensuel atteint (${usedThisMonth} recherches ce mois)\n\n` +
        `Cette recherche est payante : ${COST_EXTRA.toFixed(2)} €\n\n` +
        `Confirmer la recherche ?`
      );
      if (!ok) return;
    }

    setLoading(true);
    try {
      const data = await aiLookupPlate(form.plate.toUpperCase().replace(/\s/g, ""), apiKey);
      setForm(f => ({ ...f, ...data, options: Array.isArray(data.options) ? data.options.join(", ") : "" }));
      // Incrémenter le compteur mensuel
      const newUsage = { ...usage, [monthKey]: usedThisMonth + 1 };
      setUsage(newUsage);

      // Si quota dépassé → reporter à Stripe (metered billing)
      if (!isFree && viewMode !== "admin" && garageId) {
        fetch("/api/report-plate-usage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ garageId, quantity: 1 })
        }).catch(() => {}); // silencieux, ne bloque pas l'UX
      }
    } catch (e) {
      alert(`Erreur de récupération : ${e.message}\n\nVérifiez votre clé API dans les Paramètres.`);
    } finally {
      setLoading(false);
    }
  };

  const submit = () => {
    if (!form.marque || !form.modele) return alert("Marque et modèle requis");
    onSave({
      ...form,
      id: form.id || uid(),
      plate: (form.plate || "").toUpperCase().replace(/\s/g, ""),
      prix_achat: form.includeTreso ? (parseFloat(form.prix_achat) || 0) : 0,
      prix_vente: parseFloat(form.prix_vente) || 0,   // toujours sauvegardé
      kilometrage: parseInt(form.kilometrage) || 0,
      options: form.options ? String(form.options).split(",").map(s => s.trim()).filter(Boolean) : [],
    });
  };

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-hd">
          <span className="modal-title">{vehicle ? "Modifier le véhicule" : "Ajouter un véhicule"}</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* Plaque + Identifier */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-start" }}>
            <input className="form-input" placeholder="Plaque (ex: AB-123-CD)" value={form.plate}
              onChange={e => set("plate", e.target.value.toUpperCase())} style={{ flex: 1, fontFamily: "DM Mono", letterSpacing: 2 }} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <button className={`btn ${isFree ? "btn-primary" : "btn-ghost"}`} onClick={handleAI} disabled={loading}
                style={!isFree ? { borderColor: "var(--orange)", color: "var(--orange)" } : {}}>
                {loading ? "⏳" : isFree ? "🔍" : "💳"} {loading ? "Recherche..." : "Identifier la plaque"}
              </button>
              <div style={{ fontSize: 10, color: isFree ? "var(--green)" : "var(--orange)", letterSpacing: 1 }}>
                {isFree
                  ? `${remaining} recherche${remaining !== 1 ? "s" : ""} gratuite${remaining !== 1 ? "s" : ""} restante${remaining !== 1 ? "s" : ""}`
                  : `Quota atteint · 0,20 € / recherche`}
              </div>
            </div>
          </div>

          {/* PRIX DE VENTE — toujours visible */}
          <div style={{
            background: "rgba(62,207,122,.06)", border: "1px solid rgba(62,207,122,.2)",
            borderRadius: 10, padding: "14px 20px", marginBottom: 14,
            display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap"
          }}>
            <div style={{ fontSize: 20 }}>🏷</div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--green)", fontWeight: 700, marginBottom: 6 }}>
                Prix de vente
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input className="form-input" type="number" placeholder="0"
                  value={form.prix_vente || ""}
                  onChange={e => set("prix_vente", e.target.value)}
                  style={{ fontSize: 22, fontWeight: 700, fontFamily: "Syne", color: "var(--green)", maxWidth: 180 }}
                />
                <span style={{ fontSize: 18, color: "var(--muted)" }}>€</span>
              </div>
            </div>
            {parseFloat(form.prix_vente) > 0 && form.includeTreso && parseFloat(form.prix_achat) > 0 && (
              <div style={{ textAlign: "center", padding: "8px 14px", background: "var(--card2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>Marge prévue</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "Syne", color: (parseFloat(form.prix_vente) - parseFloat(form.prix_achat)) >= 0 ? "var(--green)" : "var(--red)" }}>
                  {(parseFloat(form.prix_vente) - parseFloat(form.prix_achat)).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
                </div>
              </div>
            )}
          </div>

          {/* TRÉSORERIE — Optionnelle (prix d'achat seulement) */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: form.includeTreso ? 12 : 0 }}
              onClick={() => set("includeTreso", !form.includeTreso)}
            >
              <div style={{
                width: 40, height: 22, borderRadius: 11, flexShrink: 0,
                background: form.includeTreso ? "var(--gold)" : "var(--card2)",
                border: "1px solid var(--border2)", position: "relative", transition: "background .2s"
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%", background: "#fff",
                  position: "absolute", top: 2, left: form.includeTreso ? 21 : 3, transition: "left .2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,.3)"
                }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: form.includeTreso ? "var(--red)" : "var(--muted2)" }}>
                💸 Inclure le prix d'achat dans la trésorerie
              </span>
            </div>

            {form.includeTreso && (
              <div style={{
                background: "linear-gradient(135deg, rgba(229,92,92,.08), rgba(229,92,92,.04))",
                border: "1px solid rgba(229,92,92,.25)", borderRadius: 10,
                padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap"
              }}>
                <div style={{ fontSize: 20 }}>💸</div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--red)", fontWeight: 700, marginBottom: 6 }}>
                    Sortie trésorerie — Prix d'achat
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input className="form-input" type="number" placeholder="0"
                      value={form.prix_achat || ""}
                      onChange={e => set("prix_achat", e.target.value)}
                      style={{ fontSize: 22, fontWeight: 700, fontFamily: "Syne", color: "var(--red)", maxWidth: 180 }}
                    />
                    <span style={{ fontSize: 18, color: "var(--muted)" }}>€</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="form-grid">
            {[["marque", "Marque *"], ["modele", "Modèle *"], ["finition", "Finition"], ["annee", "Année", "number"],
              ["motorisation", "Motorisation"], ["puissance_cv", "Puissance (ch)", "number"], ["boite", "Boîte"],
              ["couleur", "Couleur ext."], ["couleur_int", "Couleur int."], ["kilometrage", "Kilométrage", "number"],
              ["vin", "N° VIN"], ["date_entree", "Date d'entrée"]].map(([k, label, type]) => (
                <div className="form-group" key={k}>
                  <label className="form-label">{label}</label>
                  <input className="form-input" type={type || "text"} value={form[k] || ""} onChange={e => set(k, e.target.value)} />
                </div>
              ))}

            <div className="form-group">
              <label className="form-label">Carburant</label>
              <select className="form-input" value={form.carburant} onChange={e => set("carburant", e.target.value)}>
                {["Essence", "Diesel", "Hybride", "Hybride rechargeable", "Électrique", "GPL"].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Transmission</label>
              <select className="form-input" value={form.transmission} onChange={e => set("transmission", e.target.value)}>
                {["Traction", "Propulsion", "Intégrale (4x4)"].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Statut</label>
              <select className="form-input" value={form.statut} onChange={e => set("statut", e.target.value)}>
                {Object.entries(STATUTS_FLEET).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="form-group full">
              <label className="form-label">Options (séparées par des virgules)</label>
              <input className="form-input" value={Array.isArray(form.options) ? form.options.join(", ") : form.options || ""}
                onChange={e => set("options", e.target.value)} placeholder="GPS, Toit pano, Caméra recul..." />
            </div>
            <div className="form-group full">
              <label className="form-label">Notes internes</label>
              <textarea className="form-input" rows={2} value={form.notes || ""} onChange={e => set("notes", e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={submit}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VEHICLE FICHE PRINT
═══════════════════════════════════════════════════════════════ */
function VehicleFiche({ v, dealer, onClose }) {
  return (
    <div className="modal-bg no-print" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-md">
        <div className="modal-hd no-print">
          <span className="modal-title">Aperçu fiche véhicule</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨 Imprimer</button>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
        </div>
        <div style={{ padding: 24 }}>
          <div className="fiche-print">
            <div className="fiche-banner" />
            <div className="fiche-head">
              <div>
                <div className="fiche-brand">{v.marque}</div>
                <div className="fiche-model">{v.modele} {v.finition}</div>
                <div style={{ marginTop: 12 }}><PlateBadge plate={v.plate} /></div>
              </div>
              <div className="fiche-year">{v.annee}</div>
            </div>
            <div className="fiche-specs">
              {[
                ["Année", v.annee], ["Kilométrage", `${Number(v.kilometrage || 0).toLocaleString("fr-FR")} km`],
                ["Motorisation", v.motorisation], ["Carburant", v.carburant],
                ["Puissance", `${v.puissance_cv} ch`], ["Boîte", v.boite],
                ["Transmission", v.transmission], ["Couleur ext.", v.couleur],
                ["Couleur int.", v.couleur_int], ["Nb portes", v.nb_portes],
                ["Nb places", v.nb_places], ["N° VIN", v.vin],
              ].map(([l, val], i) => (
                <div className="fiche-spec" key={i}>
                  <div className="fiche-slabel">{l}</div>
                  <div className="fiche-sval">{val || "—"}</div>
                </div>
              ))}
            </div>
            {v.options?.length > 0 && (
              <div className="fiche-options">
                <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#d4a843", marginBottom: 6 }}>Options & équipements inclus</div>
                {v.options.join(" · ")}
              </div>
            )}
            <div className="fiche-price">
              <div>
                <div className="fiche-price-label">Prix de vente</div>
                <div className="fiche-price-val">{fmt(v.prix_vente)}</div>
                <div style={{ fontSize: 11, color: "#6b6a7a", marginTop: 4 }}>TTC · Financement disponible</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#6b6a7a" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#f0ede8" }}>{dealer?.name || "AUTO DEALER"}</div>
                <div>{dealer?.address?.split("\n")[0]}</div>
                <div>{dealer?.phone}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FLEET PAGE
═══════════════════════════════════════════════════════════════ */
function FleetPage({ vehicles, setVehicles, apiKey, usage, setUsage, livrePolice, setLivrePolice, viewMode, garageId }) {
  const [modal, setModal] = useState(null);
  const [fiche, setFiche] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [pendingDelete, setPendingDelete] = useState(null); // {id, label} | null
  const [showDemoLimit, setShowDemoLimit] = useState(false);
  const [dealer] = useState({ name: "AUTO PRESTIGE", address: "12 Av. de la République\n75011 Paris", phone: "01 23 45 67 89" });

  const filtered = vehicles.filter(v => {
    const matchS = !search || `${v.marque} ${v.modele} ${v.plate} ${v.finition}`.toLowerCase().includes(search.toLowerCase());
    const matchF = filter === "all" || v.statut === filter;
    return matchS && matchF;
  });

  const save = (v) => {
    const exists = vehicles.find(x => x.id === v.id);

    // Véhicule passé "livré" → retirer de la flotte + date sortie LP
    if (v.statut === "livré") {
      if (setLivrePolice && livrePolice) {
        const lpEntry = livrePolice.find(e => e.vehicle_id === v.id || e.immat === v.plate);
        if (lpEntry && !lpEntry.date_sortie) {
          setLivrePolice(livrePolice.map(e =>
            e.id === lpEntry.id ? { ...e, date_sortie: today(), acheteur_nom: v._acheteur_nom || "" } : e
          ));
        }
      }
      // Supprimer de la flotte — le véhicule est parti
      setVehicles(vehicles.filter(x => x.id !== v.id));
      setModal(null);
      return;
    }

    // Véhicule passé "vendu" → reste dans la flotte, pas de date sortie LP (pas encore livré)
    const next = exists ? vehicles.map(x => x.id === v.id ? v : x) : [v, ...vehicles];
    setVehicles(next);

    // Création automatique dans le livre de police pour tout NOUVEAU véhicule
    if (!exists && setLivrePolice && livrePolice) {
      const alreadyInLP = livrePolice.find(e => e.immat === v.plate || e.vehicle_id === v.id);
      if (!alreadyInLP) {
        const entries = livrePolice;
        const nextNum = (entries.length > 0 ? Math.max(...entries.map(e => e.num_ordre || 0)) : 0) + 1;

        const newEntry = {
          id: uid(),
          vehicle_id: v.id,
          num_ordre: nextNum,
          date_entree: v.date_entree || today(),
          marque: v.marque || "",
          modele: v.modele || "",
          annee: v.annee || "",
          couleur: v.couleur || "",
          immat: v.plate || "",
          vin: v.vin || "",
          kilometrage: v.kilometrage || "",
          pays_origine: "France",
          prix_achat: v.prix_achat || "",
          // Champs vendeur vides — à compléter
          vendeur_type: "particulier",
          vendeur_nom: "", vendeur_prenom: "", vendeur_adresse: "",
          vendeur_piece_type: "CNI", vendeur_piece_id: "", vendeur_piece_date: "", vendeur_piece_autorite: "",
          mode_reglement: "Virement",
          date_sortie: "", acheteur_nom: "", acheteur_adresse: "",
          notes: "Entrée créée automatiquement depuis la flotte — à compléter",
          _incomplete: true, // flag infos manquantes
        };
        setLivrePolice([...livrePolice, newEntry]);

        // Alerte infos manquantes
        const missing = [];
        if (!v.plate) missing.push("plaque d'immatriculation");
        if (!v.vin) missing.push("numéro VIN");
        if (!v.prix_achat) missing.push("prix d'achat");
        if (missing.length > 0) {
          setTimeout(() => alert(
            `✅ Véhicule ajouté au Livre de Police (N°${String(nextNum).padStart(4,"0")})\n\n` +
            `⚠️ Infos manquantes à compléter :\n${missing.map(m => `  • ${m}`).join("\n")}\n` +
            `  • Identité du vendeur (obligatoire légalement)\n\n` +
            `→ Allez dans Livre de Police pour compléter l'entrée.`
          ), 100);
        }
      }
    }

    setModal(null);
  };

  const del = (id) => {
    setVehicles(vehicles.filter(v => v.id !== id));
    setPendingDelete(null);
  };

  return (
    <div className="page">
      {modal && <VehicleModal vehicle={modal === "add" ? null : modal} onSave={save} onClose={() => setModal(null)} apiKey={apiKey} usage={usage} setUsage={setUsage} garageId={garageId} viewMode={viewMode} />}
      {fiche && <VehicleFiche v={fiche} dealer={dealer} onClose={() => setFiche(null)} />}
      {pendingDelete && (
        <ConfirmModal
          title="Supprimer le véhicule"
          message={`Voulez-vous supprimer définitivement le véhicule ${pendingDelete.label} de la flotte ? Cette action est irréversible.`}
          confirmLabel="Supprimer"
          onConfirm={() => del(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {viewMode === "trial" && showDemoLimit && <DemoLimitModal type="vehicles" onClose={() => setShowDemoLimit(false)} />}

      <div className="page-header">
        <div>
          <div className="page-title">Flotte véhicules</div>
          <div className="page-sub">{vehicles.length} véhicule{vehicles.length !== 1 ? "s" : ""} · {vehicles.filter(v => v.statut === "disponible").length} disponibles</div>
        </div>
        <button className="btn btn-primary" onClick={() => {
          if (viewMode === "trial" && vehicles.length >= DEMO_LIMITS.vehicles) { setShowDemoLimit(true); return; }
          setModal("add");
        }}>+ Ajouter un véhicule</button>
      </div>

      <div className="search-bar" style={{ marginBottom: 16 }}>
        <input className="search-input" placeholder="Rechercher marque, modèle, plaque..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="tabs" style={{ margin: 0 }}>
          {[["all", "Tous"], ...Object.entries(STATUTS_FLEET).map(([k, v]) => [k, v.label])].map(([k, l]) => (
            <div key={k} className={`tab${filter === k ? " active" : ""}`} onClick={() => setFilter(k)}>{l}</div>
          ))}
        </div>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Plaque</th><th>Véhicule</th><th>Année</th><th>Motorisation</th>
              <th>Km</th><th>Prix achat</th><th>Prix vente</th><th>Marge</th><th>Statut</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>Aucun véhicule trouvé</td></tr>
            )}
            {filtered.map(v => {
              const marge = (parseFloat(v.prix_vente) || 0) - (parseFloat(v.prix_achat) || 0);
              const lpEntry = livrePolice?.find(e => e.vehicle_id === v.id || e.immat === v.plate);
              const lpIncomplete = lpEntry?._incomplete || !lpEntry;
              return (
                <tr key={v.id}>
                  <td>
                    <PlateBadge plate={v.plate} />
                    {lpIncomplete && (
                      <div style={{ fontSize: 9, color: "var(--orange)", marginTop: 3, letterSpacing: .5 }}
                        title={lpEntry ? "Livre de Police incomplet" : "Pas encore dans le Livre de Police"}>
                        {lpEntry ? "⚠️ LP incomplet" : "⚠️ Absent du LP"}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{v.marque} {v.modele}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{v.finition} · {v.couleur}</div>
                  </td>
                  <td>{v.annee}</td>
                  <td>
                    <div style={{ fontSize: 12 }}>{v.motorisation}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{v.carburant} · {v.puissance_cv}ch</div>
                  </td>
                  <td style={{ fontFamily: "DM Mono", fontSize: 12 }}>{Number(v.kilometrage || 0).toLocaleString("fr-FR")}</td>
                  <td style={{ fontFamily: "DM Mono" }}>{fmt(v.prix_achat)}</td>
                  <td style={{ fontFamily: "DM Mono", fontWeight: 700, color: "var(--gold)" }}>{fmt(v.prix_vente)}</td>
                  <td style={{ fontFamily: "DM Mono", color: marge >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>{fmt(marge)}</td>
                  <td><span className={`badge ${STATUTS_FLEET[v.statut]?.cls || "badge-muted"}`}>{STATUTS_FLEET[v.statut]?.label}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => setFiche(v)}>🏷 Fiche</button>
                      {v.statut === "vendu" && (
                        <button className="btn btn-ghost btn-xs" style={{ color: "var(--green)" }}
                          title="Marquer comme livré"
                          onClick={() => save({ ...v, statut: "livré" })}>
                          🚗 Livré
                        </button>
                      )}
                      <button className="btn btn-ghost btn-xs" onClick={() => setModal(v)}>✏️</button>
                      <button className="btn btn-danger btn-xs" onClick={() => setPendingDelete({ id: v.id, label: `${v.marque} ${v.modele} ${v.plate ? `(${v.plate})` : ""}` })}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONFIRM MODAL — réutilisable partout
═══════════════════════════════════════════════════════════════ */
function ConfirmModal({ title, message, confirmLabel = "Supprimer", onConfirm, onCancel }) {
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal-sm" style={{ maxWidth: 420 }}>
        <div className="modal-hd">
          <span className="modal-title" style={{ color: "var(--red)" }}>🗑 {title}</span>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body" style={{ padding: "20px 24px" }}>
          <p style={{ fontSize: 14, color: "var(--muted2)", lineHeight: 1.6, margin: 0 }}>{message}</p>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DEMO LIMITS
═══════════════════════════════════════════════════════════════ */
const DEMO_LIMITS = { vehicles: 2, orders: 2, clients: 2 };

function DemoLimitModal({ type, onClose }) {
  const labels = { vehicles: "véhicules", orders: "bons de commande / factures", clients: "clients CRM" };
  const limits = { vehicles: 2, orders: 2, clients: 2 };
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-sm" style={{ maxWidth: 440, textAlign: "center" }}>
        <div className="modal-body" style={{ padding: "36px 32px" }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🚀</div>
          <div style={{ fontFamily: "Syne", fontSize: 20, fontWeight: 800, marginBottom: 10 }}>
            Limite démo atteinte
          </div>
          <div style={{ fontSize: 13, color: "var(--muted2)", lineHeight: 1.7, marginBottom: 24 }}>
            Le mode démo est limité à <strong style={{ color: "var(--text)" }}>{limits[type]} {labels[type]}</strong>.<br />
            Abonnez-vous pour accéder à toutes les fonctionnalités sans limite.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="btn btn-primary" style={{ justifyContent: "center", padding: "12px" }}
              onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("iocar_goto_register")); }}>
              🚀 S'abonner — 24,99€/mois
            </button>
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: "center" }} onClick={onClose}>
              Continuer en démo
            </button>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 16, lineHeight: 1.6 }}>
            Vos données démo sont conservées lors de l'abonnement.<br />
            Paiement par carte bancaire requis.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PAYMENT MODAL
═══════════════════════════════════════════════════════════════ */
function PaymentModal({ order, onSave, onClose }) {
  const c = calcOrder(order);
  const [form, setForm] = useState({ date: today(), montant: c.reste.toFixed(2), mode: "Virement" });
  const modes = ["Virement", "Chèque", "Espèces", "CB", "Financement"];
  const submit = () => {
    if (!parseFloat(form.montant)) return;
    const pmt = { id: uid(), ...form, montant: parseFloat(form.montant) };
    const updated = { ...order, paiements: [...(order.paiements || []), pmt] };
    const newC = calcOrder(updated);
    updated.statut = newC.reste <= 0.01 ? "payé" : newC.encaisse > 0 ? "partiel" : updated.statut;
    onSave(updated);
  };
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-sm">
        <div className="modal-hd">
          <span className="modal-title">Enregistrer un paiement</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ background: "var(--card2)", borderRadius: 8, padding: "14px 16px", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>Total TTC</span>
              <span style={{ fontWeight: 700 }}>{fmtDec(c.ttc)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 6 }}>
              <span style={{ color: "var(--muted)" }}>Déjà encaissé</span>
              <span style={{ color: "var(--green)" }}>{fmtDec(c.encaisse)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border2)" }}>
              <span>Reste à payer</span>
              <span style={{ color: "var(--orange)" }}>{fmtDec(c.reste)}</span>
            </div>
          </div>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input className="form-input" type="text" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Mode</label>
              <select className="form-input" value={form.mode} onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}>
                {modes.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-group full">
              <label className="form-label">Montant (€)</label>
              <input className="form-input" type="number" step="0.01" value={form.montant} onChange={e => setForm(f => ({ ...f, montant: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={submit}>✅ Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ORDER / INVOICE FORM
═══════════════════════════════════════════════════════════════ */
function OrderForm({ order, vehicles, onSave, onClose, apiKey, clients, setClients, orders }) {
  const isEdit = !!order?.id;
  const [form, setForm] = useState(order || {
    type: "bc", ref: "", date_creation: today(), date_echeance: "",
    client: { name: "", address: "", phone: "", email: "", siren: "" },
    vehicle_id: "", vehicle_plate: "", vehicle_label: "",
    prix_ht: "", remise_pct: 0, tva_pct: 20, avec_tva: true,
    categorie_operation: "livraison_biens",
    tva_sur_debits: false,
    paiements: [], notes: ""
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setClient = (k, v) => setForm(f => ({ ...f, client: { ...f.client, [k]: v } }));

  // ── CRM : sélection + création rapide ────────────────────
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ nom: "", prenom: "", email: "", phone: "", adresse: "" });

  const filteredClients = (clients || []).filter(c =>
    !clientSearch || `${c.prenom} ${c.nom} ${c.email} ${c.phone}`.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const selectClientFromCrm = (c) => {
    setForm(f => ({
      ...f,
      client_id: c.id,
      client: {
        name: `${c.prenom || ""} ${c.nom}`.trim(),
        address: c.adresse || "",
        phone: c.phone || "",
        email: c.email || "",
      }
    }));
    setClientSearch("");
    setShowClientDropdown(false);
  };

  const createAndSelectClient = () => {
    if (!newClientForm.nom.trim()) return alert("Le nom est requis");
    const newClient = {
      id: uid(),
      // Prospect si BC (pas encore de facture), Client si facture directe
      statut: form.type === "bc" ? "prospect" : "client",
      date_contact: today(),
      annotations: [], notes: "", vehicule_interet: "", budget: 0,
      ...newClientForm,
    };
    if (setClients) setClients([newClient, ...(clients || [])]);
    selectClientFromCrm(newClient);
    setShowCreateClient(false);
    setNewClientForm({ nom: "", prenom: "", email: "", phone: "", adresse: "" });
  };

  const linkedClient = form.client_id ? (clients || []).find(c => c.id === form.client_id) : null;

  const selectVehicle = (id) => {
    const v = vehicles.find(x => x.id === id);
    if (!v) return set("vehicle_id", "");
    set("vehicle_id", id);
    set("vehicle_plate", v.plate);
    set("vehicle_label", `${v.marque} ${v.modele} ${v.finition} (${v.annee})`);
    if (!form.prix_ht && v.prix_vente) set("prix_ht", v.prix_vente);
  };

  const c = calcOrder(form);

  const submit = () => {
    if (!form.client.name) return alert("Nom du client requis");
    // Générer la ref séquentielle si pas encore définie
    const ref = form.ref || nextRef(orders, form.type);
    onSave({ ...form, id: form.id || uid(), ref });
  };

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-hd">
          <span className="modal-title">{isEdit ? `Modifier ${form.ref}` : "Nouveau document"}</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
            <div className="form-group">
              <label className="form-label">Type de document</label>
              <select className="form-input" value={form.type} onChange={e => {
                const t = e.target.value;
                set("type", t);
                set("ref", nextRef(orders, t));
              }}>
                <option value="bc">Bon de commande</option>
                <option value="facture">Facture</option>
                <option value="avoir">Avoir / Note de crédit</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Référence</label>
              <input className="form-input" value={form.ref || nextRef(orders, form.type)} onChange={e => set("ref", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input className="form-input" value={form.date_creation} onChange={e => set("date_creation", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Échéance</label>
              <input className="form-input" value={form.date_echeance} onChange={e => set("date_echeance", e.target.value)} placeholder="jj/mm/aaaa" />
            </div>
          </div>

          {/* ── SECTION CLIENT ── */}
          <div style={{ fontFamily: "Syne", fontSize: 13, fontWeight: 700, letterSpacing: 1, color: "var(--gold)", textTransform: "uppercase", marginBottom: 12 }}>CLIENT</div>

          {/* Badge client lié */}
          {linkedClient && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 12px", background: "rgba(62,207,122,.08)", border: "1px solid rgba(62,207,122,.2)", borderRadius: 8 }}>
              <span style={{ fontSize: 18 }}>✅</span>
              <div style={{ flex: 1, fontSize: 13 }}>
                <strong>{linkedClient.prenom} {linkedClient.nom}</strong>
                <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 11 }}>Fiche CRM liée</span>
              </div>
            </div>
          )}

          {/* Dropdown recherche CRM */}
          {showClientDropdown && (
            <div style={{ marginBottom: 14, background: "var(--card2)", borderRadius: 10, border: "1px solid var(--border)", padding: 12 }}>
              <input className="form-input" placeholder="Rechercher un client CRM..." value={clientSearch}
                onChange={e => setClientSearch(e.target.value)} autoFocus style={{ marginBottom: 8 }} />
              <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {filteredClients.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "16px 12px" }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                      Aucun client trouvé pour <strong>"{clientSearch}"</strong>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => {
                      // Pré-remplir le formulaire avec la recherche en cours
                      const parts = clientSearch.trim().split(" ");
                      setNewClientForm({
                        prenom: parts.length > 1 ? parts.slice(0, -1).join(" ") : "",
                        nom: parts[parts.length - 1] || clientSearch,
                        email: "", phone: "", adresse: ""
                      });
                      setShowClientDropdown(false);
                      setShowCreateClient(true);
                    }}>
                      ➕ Créer "{clientSearch}"
                    </button>
                  </div>
                ) : filteredClients.map(c => (
                  <div key={c.id} onClick={() => selectClientFromCrm(c)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 6, cursor: "pointer", background: "var(--card)", border: "1px solid var(--border2)" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "var(--gold)"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border2)"}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.prenom} {c.nom}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.email || c.phone || "—"}</div>
                    </div>
                    <span className={`badge ${STATUTS_CLIENT[c.statut || "prospect"]?.cls}`} style={{ fontSize: 10 }}>
                      {STATUTS_CLIENT[c.statut || "prospect"]?.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Création rapide client */}
          {showCreateClient && (
            <div style={{ marginBottom: 14, background: "var(--card2)", borderRadius: 10, border: "1px solid var(--border)", padding: 14 }}>
              <div style={{ fontFamily: "Syne", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "var(--gold)", textTransform: "uppercase", marginBottom: 10 }}>
                Créer un nouveau client
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 10 }}>
                {[["prenom", "Prénom"], ["nom", "Nom *"], ["email", "Email"], ["phone", "Téléphone"], ["adresse", "Adresse"]].map(([k, l]) => (
                  <div className="form-group" key={k} style={k === "adresse" ? { gridColumn: "1/-1" } : {}}>
                    <label className="form-label">{l}</label>
                    <input className="form-input" value={newClientForm[k]} onChange={e => setNewClientForm(f => ({ ...f, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={createAndSelectClient}>✅ Créer et sélectionner</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowCreateClient(false)}>Annuler</button>
              </div>
            </div>
          )}

          {/* Infos client en lecture seule si sélectionné */}
          {form.client?.name && !showClientDropdown && !showCreateClient ? (
            <div style={{ background: "var(--card2)", borderRadius: 10, border: "1px solid var(--border2)", padding: "14px 16px", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: form.client.siren !== undefined ? 10 : 0 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--gold3)", border: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne", fontWeight: 800, fontSize: 15, color: "var(--gold)", flexShrink: 0 }}>
                    {(form.client.name?.[0] || "?").toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{form.client.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {[form.client.phone, form.client.email, form.client.address?.split("\n")[0]].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => {
                  setForm(f => ({ ...f, client_id: null, client: { name: "", address: "", phone: "", email: "", siren: "" } }));
                }}>✕ Changer</button>
              </div>
              {/* SIREN client — obligatoire B2B facture 2026 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", minWidth: 80 }}>SIREN client</div>
                <input className="form-input" style={{ fontSize: 12, fontFamily: "DM Mono", flex: 1, padding: "4px 8px" }}
                  placeholder="9 chiffres — requis pour facture B2B (2026)"
                  value={form.client.siren || ""}
                  onChange={e => setForm(f => ({ ...f, client: { ...f.client, siren: e.target.value } }))} />
                {form.client.siren && form.client.siren.replace(/\s/g, "").length !== 9 && (
                  <span style={{ fontSize: 10, color: "var(--orange)" }}>⚠️ 9 chiffres requis</span>
                )}
              </div>
            </div>
          ) : !showClientDropdown && !showCreateClient && (
            <div style={{ marginBottom: 20, padding: "20px", background: "var(--card2)", borderRadius: 10, border: "2px dashed var(--border2)", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>👤</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>Aucun client sélectionné</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button className="btn btn-primary btn-sm" onClick={() => setShowClientDropdown(true)}>👥 Choisir dans le CRM</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowCreateClient(true)}>➕ Créer un client</button>
              </div>
            </div>
          )}

          <div style={{ fontFamily: "Syne", fontSize: 13, fontWeight: 700, letterSpacing: 1, color: "var(--gold)", marginBottom: 10, textTransform: "uppercase" }}>VÉHICULE</div>
          <div className="form-grid" style={{ marginBottom: 20 }}>
            <div className="form-group full">
              <label className="form-label">Sélectionner depuis la flotte</label>
              <select className="form-input" value={form.vehicle_id} onChange={e => selectVehicle(e.target.value)}>
                <option value="">— Choisir un véhicule —</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate} · {v.marque} {v.modele} {v.finition} ({v.annee})</option>)}
              </select>
            </div>
            <div className="form-group full">
              <label className="form-label">Libellé véhicule</label>
              <input className="form-input" value={form.vehicle_label} onChange={e => set("vehicle_label", e.target.value)} placeholder="ou saisir manuellement" />
            </div>
          </div>

          <div style={{ fontFamily: "Syne", fontSize: 13, fontWeight: 700, letterSpacing: 1, color: "var(--gold)", marginBottom: 10, textTransform: "uppercase" }}>TARIFICATION</div>

          {/* Toggle TVA */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, padding: "10px 14px", background: "var(--card2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Vente soumise à TVA</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {form.avec_tva !== false ? "TVA applicable — régime normal ou marge" : "Vente hors TVA — véhicule d'occasion régime particulier (art. 297A CGI)"}
              </div>
            </div>
            <div style={{
              width: 44, height: 24, borderRadius: 12, cursor: "pointer",
              background: form.avec_tva !== false ? "var(--gold)" : "var(--card)",
              border: "1px solid var(--border2)", position: "relative", transition: "background .2s", flexShrink: 0
            }} onClick={() => set("avec_tva", form.avec_tva === false ? true : false)}>
              <div style={{
                width: 18, height: 18, borderRadius: "50%", background: "#fff",
                position: "absolute", top: 2,
                left: form.avec_tva !== false ? 23 : 3,
                transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)"
              }} />
            </div>
          </div>

          <div className="form-grid" style={{ marginBottom: 4 }}>
            <div className="form-group">
              <label className="form-label">Prix {form.avec_tva !== false ? "HT" : "TTC"} (€)</label>
              <input className="form-input" type="number" value={form.prix_ht} onChange={e => set("prix_ht", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Remise (%)</label>
              <input className="form-input" type="number" value={form.remise_pct} onChange={e => set("remise_pct", e.target.value)} />
            </div>
            {form.avec_tva !== false && (
              <div className="form-group">
                <label className="form-label">Taux TVA (%)</label>
                <select className="form-input" value={form.tva_pct} onChange={e => set("tva_pct", parseFloat(e.target.value))}>
                  <option value={20}>20% — Taux normal</option>
                  <option value={10}>10% — Taux intermédiaire</option>
                  <option value={5.5}>5,5% — Taux réduit</option>
                  <option value={0}>0% — Exonéré</option>
                </select>
              </div>
            )}
          </div>

          <div style={{ background: "var(--card2)", borderRadius: 8, padding: "14px 16px", marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
            {(c.avecTva
              ? [["Base HT", fmtDec(c.base)], ["TVA", fmtDec(c.tvaAmt)], ["Total TTC", fmtDec(c.ttc)]]
              : [["Prix TTC", fmtDec(c.ttc)], ["TVA", "Non applicable"], ["Régime", "Art. 297A CGI"]]
            ).map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--muted)", marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "Syne" }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Mentions obligatoires 2026 — uniquement pour factures et avoirs */}
          {(form.type === "facture" || form.type === "avoir") && (
            <div style={{ marginBottom: 16, padding: "12px 14px", background: "rgba(212,168,67,.06)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <div style={{ fontFamily: "Syne", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "var(--gold)", textTransform: "uppercase", marginBottom: 10 }}>
                📋 Mentions obligatoires 2026
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="form-group">
                  <label className="form-label">Catégorie de l'opération *</label>
                  <select className="form-input" value={form.categorie_operation || "livraison_biens"} onChange={e => set("categorie_operation", e.target.value)}>
                    <option value="livraison_biens">Livraison de biens</option>
                    <option value="prestation_services">Prestation de services</option>
                    <option value="mixte">Livraison + Prestation</option>
                  </select>
                </div>
                <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 20 }}>
                  <div style={{
                    width: 36, height: 20, borderRadius: 10, cursor: "pointer", flexShrink: 0,
                    background: form.tva_sur_debits ? "var(--gold)" : "var(--card2)",
                    border: "1px solid var(--border2)", position: "relative", transition: "background .2s"
                  }} onClick={() => set("tva_sur_debits", !form.tva_sur_debits)}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: form.tva_sur_debits ? 19 : 3, transition: "left .2s" }} />
                  </div>
                  <span style={{ fontSize: 12 }}>TVA sur les débits</span>
                </div>
                {form.type === "avoir" && (
                  <div className="form-group full">
                    <label className="form-label">Facture d'origine (référence)</label>
                    <input className="form-input" style={{ fontFamily: "DM Mono" }}
                      value={form.facture_origine || ""}
                      onChange={e => set("facture_origine", e.target.value)}
                      placeholder="ex: FAC-2026-0001" />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Notes / Conditions</label>
            <textarea className="form-input" rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Conditions de garantie, délai de livraison..." />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={submit}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PRINT DOCUMENT
═══════════════════════════════════════════════════════════════ */
function PrintDoc({ order, dealer, onClose, viewMode }) {
  const c = calcOrder(order);
  return (
    <div className="modal-bg no-print" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ display: "flex", flexDirection: "column", maxHeight: "92vh" }}>

        {/* Barre fixe */}
        <div className="modal-hd no-print" style={{ flexShrink: 0 }}>
          <span className="modal-title">Aperçu — {order.ref}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {order.type === "facture" && viewMode !== "trial" && (
              <button className="btn btn-ghost btn-sm" onClick={() => exportFacturX(order, dealer, "en16931")}
                title="Export Factur-X EN16931 — compatible Plateforme Agréée (PA/PDP)">
                ⚡ Factur-X PA
              </button>
            )}
            {order.type === "facture" && viewMode === "trial" && (
              <button className="btn btn-ghost btn-sm" style={{ opacity: .5, cursor: "not-allowed" }}
                title="Disponible avec un abonnement"
                onClick={() => window.dispatchEvent(new CustomEvent("iocar_goto_register"))}>
                ⚡ Factur-X PA 🔒
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨 Imprimer / PDF</button>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        {/* Document scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <div className="print-doc">
            <div className="print-doc-bar" />
            <div className="pdoc-head">
              <div>
                {dealer?.logo && (
                  <div style={{ marginBottom: 10 }}>
                    <img src={dealer.logo} alt="Logo"
                      style={{
                        maxHeight: 70, maxWidth: 200, objectFit: "contain",
                        mixBlendMode: dealer.logoBlend || "normal",
                        filter: dealer.logoInvert ? "invert(1)" : "none"
                      }} />
                  </div>
                )}
                <div className="pdoc-logo">{dealer?.name || "AUTO DEALER"}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 6, lineHeight: 1.7 }}>
                  {dealer?.address?.split("\n").map((l, i) => <span key={i}>{l}<br /></span>)}
                  {dealer?.phone && <span>Tél : {dealer.phone}<br /></span>}
                  {dealer?.siret && <span>SIRET : {dealer.siret}</span>}
                </div>
              </div>
              <div>
                <div className="pdoc-type">{order.type === "facture" ? "FACTURE" : "BON DE COMMANDE"}</div>
                <div className="pdoc-ref">N° {order.ref}</div>
                <div className="pdoc-ref">Date : {order.date_creation}</div>
                {order.date_echeance && <div className="pdoc-ref">Échéance : {order.date_echeance}</div>}
              </div>
            </div>
            <hr className="pdoc-divider" />
            <div className="pdoc-parties">
              <div>
                <div className="pdoc-plabel">Vendeur</div>
                <div className="pdoc-pname">{dealer?.name || "AUTO DEALER"}</div>
                <div className="pdoc-pinfo">{dealer?.address}{dealer?.phone && <><br />Tél : {dealer.phone}</>}</div>
              </div>
              <div>
                <div className="pdoc-plabel">Client</div>
                <div className="pdoc-pname">{order.client?.name || "—"}</div>
                <div className="pdoc-pinfo">{order.client?.address}{order.client?.phone && <><br />{order.client.phone}</>}{order.client?.email && <><br />{order.client.email}</>}</div>
              </div>
            </div>
            <table className="pdoc-table">
              <thead>
                <tr><th>Description véhicule</th><th>Plaque</th><th>VIN / Réf.</th><th style={{ textAlign: "right" }}>{c.avecTva ? "Prix HT" : "Prix TTC"}</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 700 }}>{order.vehicle_label || "Véhicule"}<br />
                    <span style={{ fontWeight: 400, color: "#888", fontSize: 11 }}>{order.vehicle_plate && `Plaque : ${order.vehicle_plate}`}</span>
                  </td>
                  <td><PlateBadge plate={order.vehicle_plate} /></td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>—</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtDec(c.ht)}</td>
                </tr>
                {c.remAmt > 0 && (
                  <tr><td colSpan={3} style={{ color: "#e05252" }}>Remise ({order.remise_pct}%)</td><td style={{ textAlign: "right", color: "#e05252" }}>- {fmtDec(c.remAmt)}</td></tr>
                )}
              </tbody>
            </table>
            <div className="pdoc-totals">
              <div className="pdoc-totals-box">
                {c.avecTva ? (
                  <>
                    <div className="pdoc-trow"><span>Montant HT</span><span>{fmtDec(c.base)}</span></div>
                    <div className="pdoc-trow"><span>TVA {order.tva_pct}%</span><span>{fmtDec(c.tvaAmt)}</span></div>
                    <div className="pdoc-trow big"><span>TOTAL TTC</span><span>{fmtDec(c.ttc)}</span></div>
                  </>
                ) : (
                  <>
                    <div className="pdoc-trow"><span>Montant TTC</span><span>{fmtDec(c.ttc)}</span></div>
                    <div className="pdoc-trow" style={{ fontSize: 10, color: "#aaa" }}><span>TVA non applicable</span><span>Art. 297A CGI</span></div>
                    <div className="pdoc-trow big"><span>TOTAL TTC</span><span>{fmtDec(c.ttc)}</span></div>
                  </>
                )}
                {c.encaisse > 0 && <>
                  <div className="pdoc-trow" style={{ color: "#3ecf7a" }}><span>Encaissé</span><span>- {fmtDec(c.encaisse)}</span></div>
                  <div className="pdoc-trow" style={{ fontWeight: 700, color: c.reste <= 0 ? "#3ecf7a" : "#e5973c" }}><span>Solde restant</span><span>{fmtDec(c.reste)}</span></div>
                </>}
              </div>
            </div>
            {order.paiements?.length > 0 && (
              <div className="pdoc-paiements">
                <div className="pdoc-paiements-title">Historique des paiements</div>
                {order.paiements.map(p => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555", padding: "3px 0", borderBottom: "1px solid #ece" }}>
                    <span>{p.date} — {p.mode}</span><span style={{ fontWeight: 700, color: "#3ecf7a" }}>{fmtDec(p.montant)}</span>
                  </div>
                ))}
              </div>
            )}
            {order.notes && (
              <div style={{ marginTop: 20, padding: "12px 16px", background: "#f9f8f5", borderRadius: 6, fontSize: 12, color: "#555" }}>
                <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#aaa", marginBottom: 6 }}>Notes / Conditions</div>
                {order.notes}
              </div>
            )}
            {order.type === "bc" ? (
              /* BON DE COMMANDE — signatures */
              <div className="pdoc-footer">
                <div><div className="pdoc-sig">Signature vendeur</div></div>
                <div><div className="pdoc-sig">Signature client / Bon pour accord</div></div>
                <div className="pdoc-legal">Acompte de 30% requis à la signature. Document non contractuel avant encaissement de l'acompte.</div>
              </div>
            ) : (
              /* FACTURE / AVOIR — mentions légales obligatoires 2026 */
              <div style={{ marginTop: 32, paddingTop: 16, borderTop: "2px solid #e8e8e8" }}>
                {/* Mentions obligatoires 2026 — bande centrale */}
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, padding: "8px 12px", background: "#f9f8f5", borderRadius: 6, fontSize: 10, color: "#888" }}>
                  <span>📦 Opération : <strong style={{ color: "#555" }}>
                    {order.categorie_operation === "prestation_services" ? "Prestation de services"
                      : order.categorie_operation === "mixte" ? "Livraison de biens + Prestation de services"
                      : "Livraison de biens"}
                  </strong></span>
                  {order.tva_sur_debits && <span>💶 TVA acquittée sur les <strong style={{ color: "#555" }}>débits</strong></span>}
                  {!order.tva_sur_debits && order.avec_tva !== false && <span>💶 TVA acquittée sur les <strong style={{ color: "#555" }}>encaissements</strong></span>}
                  {order.client?.siren && <span>🏢 SIREN client : <strong style={{ color: "#555", fontFamily: "monospace" }}>{order.client.siren}</strong></span>}
                  {order.type === "avoir" && order.facture_origine && <span>📎 Facture d'origine : <strong style={{ color: "#555", fontFamily: "monospace" }}>{order.facture_origine}</strong></span>}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 9, color: "#aaa", lineHeight: 1.8, flex: 1 }}>
                    <strong style={{ color: "#888", letterSpacing: 1, textTransform: "uppercase", fontSize: 8 }}>Mentions légales</strong><br />
                    {dealer?.name}{dealer?.siret && ` — SIRET : ${dealer.siret}`}{dealer?.tva_num && ` — TVA : ${dealer.tva_num}`}<br />
                    {dealer?.address?.replace(/\n/g, ", ")}<br />
                    {dealer?.email && `Email : ${dealer.email}`}{dealer?.phone && ` — Tél : ${dealer.phone}`}
                  </div>
                  <div style={{ fontSize: 9, color: "#aaa", lineHeight: 1.8, flex: 1 }}>
                    <strong style={{ color: "#888", letterSpacing: 1, textTransform: "uppercase", fontSize: 8 }}>Conditions de règlement</strong><br />
                    {(dealer?.conditions_reglement || "TVA acquittée sur les encaissements.\nTout retard de paiement entraîne des pénalités au taux légal en vigueur (art. L441-10 C. com.).\nIndemnité forfaitaire de recouvrement : 40 €.").split("\n").map((l, i) => <span key={i}>{l}<br /></span>)}
                  </div>
                  <div style={{ fontSize: 9, color: "#aaa", lineHeight: 1.8, flex: 1 }}>
                    <strong style={{ color: "#888", letterSpacing: 1, textTransform: "uppercase", fontSize: 8 }}>Informations complémentaires</strong><br />
                    {(dealer?.infos_complementaires || "En cas de litige, tribunal compétent selon règles de droit commun.\nFacture à conserver pendant 10 ans (art. L123-22 C. com.).").split("\n").map((l, i) => <span key={i}>{l}<br /></span>)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ORDERS PAGE
═══════════════════════════════════════════════════════════════ */
function OrdersPage({ orders, setOrders, vehicles, setVehiclesRaw, dealer, apiKey, usage, setUsage, clients, setClients, viewMode }) {
  const [tab, setTabLocal] = useState("all");
  const [modal, setModal] = useState(null);
  const [print, setPrint] = useState(null);
  const [payment, setPayment] = useState(null);
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showDemoLimit, setShowDemoLimit] = useState(false);

  const save = (o) => {
    // Sauvegarder le document
    const exists = orders.find(x => x.id === o.id);
    const next = exists ? orders.map(x => x.id === o.id ? o : x) : [o, ...orders];
    setOrders(next);

    // Créer automatiquement la fiche client CRM si elle n'existe pas encore
    if (o.client?.name && setClients && clients) {
      const nomClient = o.client.name.trim().toLowerCase();

      // Si client_id est défini, la fiche existe déjà (créée via createAndSelectClient) — on ne touche à rien
      if (!o.client_id) {
        const clientExiste = clients.find(c =>
          `${c.prenom || ""} ${c.nom}`.trim().toLowerCase() === nomClient ||
          `${c.nom || ""} ${c.prenom || ""}`.trim().toLowerCase() === nomClient
        );

        if (!clientExiste) {
          const parts = o.client.name.trim().split(" ");
          const prenom = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
          const nom = parts[parts.length - 1];
          const statutAuto = o.type === "bc" ? "prospect" : "client";

          const newClient = {
            id: uid(),
            nom, prenom,
            email: o.client.email || "",
            phone: o.client.phone || "",
            adresse: o.client.address || "",
            statut: statutAuto,
            date_contact: today(),
            annotations: [{
              id: uid(),
              texte: o.type === "bc"
                ? `Fiche créée depuis le bon de commande ${o.ref} — statut Prospect`
                : `Fiche créée depuis la facture ${o.ref} — statut Client`,
              date: today(),
              heure: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
            }],
            notes: "", vehicule_interet: "", budget: 0,
          };
          setClients([newClient, ...clients]);
        }
      }
    }

    setModal(null);
  };

  const del = (id) => {
    setOrders(orders.filter(o => o.id !== id));
    setPendingDelete(null);
  };

  const toFacture = (o) => {
    const updated = { ...o, type: "facture", ref: nextRef(orders, "facture"), date_creation: today() };
    setOrders(orders.map(x => x.id === o.id ? updated : x));

    // Passer le véhicule lié en "vendu" automatiquement
    if (o.vehicle_id && vehicles) {
      const veh = vehicles.find(v => v.id === o.vehicle_id);
      if (veh && veh.statut !== "vendu" && veh.statut !== "livré") {
        setVehiclesRaw(vehicles.map(v => v.id === o.vehicle_id ? { ...v, statut: "vendu" } : v));
      }
    }

    // Passer le prospect en "client" dans le CRM
    if (setClients && clients) {
      const nomDoc = (o.client?.name || "").trim().toLowerCase();

      const clientCrm = o.client_id
        // 1. Lien direct par ID (prioritaire)
        ? clients.find(c => c.id === o.client_id)
        // 2. Correspondance par nom complet "Prénom Nom" ou "Nom Prénom"
        : clients.find(c => {
            const fullA = `${c.prenom || ""} ${c.nom || ""}`.trim().toLowerCase();
            const fullB = `${c.nom || ""} ${c.prenom || ""}`.trim().toLowerCase();
            return fullA === nomDoc || fullB === nomDoc || c.nom?.toLowerCase() === nomDoc;
          });

      if (clientCrm) {
        const annot = {
          id: uid(),
          texte: `✅ Statut passé à "Client" — BC ${o.ref} converti en facture ${updated.ref}`,
          date: today(),
          heure: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        };
        setClients(clients.map(c => c.id === clientCrm.id
          ? { ...c, statut: "client", annotations: [...(c.annotations || []), annot] }
          : c
        ));
      }
    }
  };

  const filtered = orders.filter(o => {
    const c = calcOrder(o);
    const matchT = tab === "all"
      || (tab === "bc" && o.type === "bc")
      || (tab === "facture" && o.type === "facture")
      || (tab === "avoir" && o.type === "avoir")
      || (tab === "encours" && o.type === "facture" && c.reste > 0.01)
      || (tab === "solde" && c.reste <= 0.01 && c.ttc > 0);
    const matchS = !search || `${o.ref} ${o.client?.name} ${o.vehicle_label} ${o.vehicle_plate}`.toLowerCase().includes(search.toLowerCase());
    return matchT && matchS;
  });

  return (
    <div className="page">
      {modal && <OrderForm order={modal === "new" ? null : modal} vehicles={vehicles} onSave={save} onClose={() => setModal(null)} apiKey={apiKey} clients={clients} setClients={setClients} orders={orders} viewMode={viewMode} />}
      {print && <PrintDoc order={print} dealer={dealer} onClose={() => setPrint(null)} viewMode={viewMode} />}
      {viewMode === "trial" && showDemoLimit && <DemoLimitModal type="orders" onClose={() => setShowDemoLimit(false)} />}
      {payment && <PaymentModal order={payment} onSave={o => { setOrders(orders.map(x => x.id === o.id ? o : x)); setPayment(null); }} onClose={() => setPayment(null)} />}
      {pendingDelete && (
        <ConfirmModal
          title="Supprimer le document"
          message={`Voulez-vous supprimer définitivement le document ${pendingDelete.label} ? Cette action est irréversible.`}
          confirmLabel="Supprimer"
          onConfirm={() => del(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <div className="page-header">
        <div>
          <div className="page-title">Commandes & Factures</div>
          <div className="page-sub">{orders.length} document{orders.length !== 1 ? "s" : ""}{viewMode === "trial" && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--orange)" }}>· Mode démo ({orders.length}/{DEMO_LIMITS.orders})</span>}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {viewMode !== "trial" && (
            <button className="btn btn-ghost btn-sm" onClick={() => exportComptableCSV(orders, dealer)} title="Export comptable CSV">
              📊 Export comptable
            </button>
          )}
          <button className="btn btn-primary" onClick={() => {
            if (viewMode === "trial" && orders.length >= DEMO_LIMITS.orders) { setShowDemoLimit(true); return; }
            setModal("new");
          }}>+ Nouveau document</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div className="tabs" style={{ margin: 0 }}>
          {[["all", "Tous"], ["bc", "BC"], ["facture", "Factures"], ["avoir", "Avoirs"], ["encours", "À encaisser"], ["solde", "Soldés"]].map(([k, l]) => (
            <div key={k} className={`tab${tab === k ? " active" : ""}`} onClick={() => setTabLocal(k)}>{l}</div>
          ))}
        </div>
        <input className="search-input" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr><th>Réf.</th><th>Type</th><th>Date</th><th>Client</th><th>Véhicule</th><th>TTC</th><th>Encaissé</th><th>Reste</th><th>Paiement</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>Aucun document trouvé</td></tr>
            )}
            {filtered.map(o => {
              const c = calcOrder(o);
              const pct = c.ttc > 0 ? Math.round(c.encaisse / c.ttc * 100) : 0;
              const paySt = getPayStatut(c);
              return (
                <tr key={o.id}>
                  <td style={{ fontFamily: "DM Mono", fontSize: 12, fontWeight: 600 }}>{o.ref}</td>
                  <td>
                    <span className={`badge ${o.type === "facture" ? "badge-gold" : o.type === "avoir" ? "badge-red" : "badge-blue"}`}>
                      {o.type === "facture" ? "🧾 Facture" : o.type === "avoir" ? "↩️ Avoir" : "📝 BC"}
                    </span>
                    {o.type === "avoir" && o.facture_origine && (
                      <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "DM Mono", marginTop: 2 }}>↳ {o.facture_origine}</div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{o.date_creation}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{o.client?.name || "—"}</div>
                    {o.client?.phone && <div style={{ fontSize: 11, color: "var(--muted)" }}>{o.client.phone}</div>}
                  </td>
                  <td>
                    <div style={{ fontSize: 12 }}>{o.vehicle_label || "—"}</div>
                    {o.vehicle_plate && <PlateBadge plate={o.vehicle_plate} />}
                  </td>
                  <td style={{ fontFamily: "DM Mono", fontWeight: 700 }}>{fmtDec(c.ttc)}</td>
                  <td style={{ fontFamily: "DM Mono", color: "var(--green)" }}>{c.encaisse > 0 ? fmtDec(c.encaisse) : "—"}</td>
                  <td>
                    {c.reste > 0.01 ? <span style={{ color: "var(--orange)", fontFamily: "DM Mono", fontSize: 12, fontWeight: 700 }}>{fmtDec(c.reste)}</span> : <span style={{ color: "var(--green)" }}>✓</span>}
                    {c.ttc > 0 && <div className="progress" style={{ marginTop: 4, width: 80 }}><div className="progress-fill" style={{ width: `${pct}%`, background: pct === 100 ? "var(--green)" : "var(--gold)" }} /></div>}
                  </td>
                  <td><span className={`badge ${paySt.cls}`}>{paySt.label}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => setPrint(o)} title="Imprimer">🖨</button>
                      {/* En mode démo : facture validée = lecture seule */}
                      {(viewMode !== "trial" || o.type === "bc") && o.type === "bc" && (
                        <button className="btn btn-ghost btn-xs" onClick={() => toFacture(o)} title="Convertir en facture">🧾</button>
                      )}
                      {o.type === "facture" && viewMode !== "trial" && <button className="btn btn-ghost btn-xs" title="Créer un avoir" onClick={() => setModal({
                        ...o, id: null, type: "avoir",
                        ref: nextRef(orders, "avoir"),
                        date_creation: today(),
                        facture_origine: o.ref,
                        paiements: [],
                      })}>↩️</button>}
                      {o.type === "facture" && c.reste > 0.01 && viewMode !== "trial" && (
                        <button className="btn btn-ghost btn-xs" style={{ color: "var(--green)" }} onClick={() => setPayment(o)}>💳</button>
                      )}
                      {/* Modifier : bloqué sur les factures sauf admin */}
                      {(o.type !== "facture" || viewMode === "admin") && (
                        <button className="btn btn-ghost btn-xs" onClick={() => setModal(o)}>✏️</button>
                      )}
                      {/* Supprimer : bloqué sur les factures sauf admin */}
                      {(o.type !== "facture" || viewMode === "admin") && (
                        <button className="btn btn-danger btn-xs" onClick={() => setPendingDelete({ id: o.id, label: o.ref })}>🗑</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TICKET SYSTEM — Support & amélioration
═══════════════════════════════════════════════════════════════ */
function TicketSystem({ dealer }) {
  const [type, setType]       = useState("incident");
  const [message, setMessage] = useState("");
  const [sent, setSent]       = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState("");

  const TYPES = [
    { value: "incident",     label: "🔴 Incident technique",       desc: "Bug, erreur, dysfonctionnement" },
    { value: "amelioration", label: "💡 Idée d'amélioration",      desc: "Nouvelle fonctionnalité, suggestion" },
    { value: "question",     label: "❓ Question / Aide",           desc: "Besoin d'assistance ou d'explication" },
    { value: "facturation",  label: "💳 Question de facturation",   desc: "Abonnement, paiement, facture" },
  ];

  const submit = async () => {
    if (!message.trim()) { setError("Veuillez décrire votre demande"); return; }
    setSending(true); setError("");
    try {
      // Envoi via mailto (fallback universel sans backend)
      const subject = encodeURIComponent(`[IO Car] ${TYPES.find(t => t.value === type)?.label} — ${dealer?.name || "Utilisateur"}`);
      const body = encodeURIComponent(
        `Type : ${TYPES.find(t => t.value === type)?.label}\n` +
        `Concession : ${dealer?.name || "—"}\n` +
        `Email : ${dealer?.email || "—"}\n` +
        `SIRET : ${dealer?.siret || "—"}\n` +
        `Date : ${new Date().toLocaleString("fr-FR")}\n\n` +
        `Message :\n${message}`
      );
      window.open(`mailto:contact@iocar.online?subject=${subject}&body=${body}`);
      setSent(true);
      setMessage("");
    } catch(e) {
      setError("Erreur lors de l'envoi. Contactez contact@iocar.online");
    }
    setSending(false);
  };

  if (sent) return (
    <div className="card card-pad" style={{ marginTop: 24, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
      <div style={{ fontFamily: "Syne", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Ticket envoyé !</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.7 }}>
        Votre message a été transmis à notre équipe.<br />
        Nous vous répondrons sous 24h à l'adresse <strong style={{ color: "var(--text)" }}>{dealer?.email || "indiquée"}</strong>.
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => setSent(false)}>Envoyer un autre ticket</button>
    </div>
  );

  return (
    <div className="card card-pad" style={{ marginTop: 24 }}>
      <div style={{ fontFamily: "Syne", fontSize: 14, fontWeight: 700, letterSpacing: 1, color: "var(--gold)", textTransform: "uppercase", marginBottom: 16 }}>
        🎫 Support & Suggestions
      </div>

      <div className="form-group" style={{ marginBottom: 16 }}>
        <label className="form-label">Type de demande</label>
        <select className="form-input" value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>)}
        </select>
      </div>

      <div className="form-group" style={{ marginBottom: 16 }}>
        <label className="form-label">Votre message</label>
        <textarea className="form-input" rows={5}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={
            type === "incident"     ? "Décrivez le problème : que s'est-il passé, à quelle étape, quel message d'erreur ?" :
            type === "amelioration" ? "Décrivez votre idée : quelle fonctionnalité, quel bénéfice attendez-vous ?" :
            type === "facturation"  ? "Décrivez votre question concernant votre abonnement ou facturation..." :
            "Posez votre question ou décrivez ce dont vous avez besoin..."
          }
        />
        {error && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>⚠️ {error}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
          Réponse sous 24h ouvrées à <strong style={{ color: "var(--muted2)" }}>{dealer?.email || "votre email"}</strong>
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={sending}>
          {sending ? "⏳ Envoi..." : "📨 Envoyer le ticket"}
        </button>
      </div>
    </div>
  );
}

function SettingsPage({ dealer, setDealer, usage }) {
  const [form, setForm] = useState(dealer);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminInput, setAdminInput] = useState("");
  const [adminError, setAdminError] = useState(false);
  const fileRef = useRef();

  const ADMIN_CODE = "RAPIDAPI";
  const monthKey = new Date().toISOString().slice(0, 7);
  const usedThisMonth = usage?.[monthKey] || 0;

  const tryUnlock = () => {
    if (adminInput.trim().toUpperCase() === ADMIN_CODE) {
      setAdminUnlocked(true);
      setAdminError(false);
      setAdminInput("");
    } else {
      setAdminError(true);
      setAdminInput("");
    }
  };

  const handleLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setForm(f => ({ ...f, logo: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const saved = JSON.stringify(form) !== JSON.stringify(dealer);

  return (
    <div className="page">
      <div className="page-header">
        <div><div className="page-title">Paramètres</div><div className="page-sub">Informations de votre concession</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 900 }}>

        {/* LOGO */}
        <div className="card card-pad">
          <div style={{ fontFamily: "Syne", fontSize: 14, fontWeight: 700, letterSpacing: 1, color: "var(--gold)", textTransform: "uppercase", marginBottom: 16 }}>Logo de la concession</div>

          {/* Preview */}
          <div style={{
            height: 140, borderRadius: 10, border: "2px dashed var(--border2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 14, overflow: "hidden", position: "relative",
            background: form.logoBg === "dark" ? "#0b0c10" : form.logoBg === "white" ? "#fff" : "repeating-conic-gradient(#1c1d26 0% 25%, #13141a 0% 50%) 0 0 / 16px 16px",
            cursor: "pointer"
          }} onClick={() => fileRef.current?.click()}>
            {form.logo ? (
              <img src={form.logo} alt="Logo"
                style={{
                  maxHeight: 120, maxWidth: "100%", objectFit: "contain",
                  mixBlendMode: form.logoBlend || "normal",
                  filter: form.logoInvert ? "invert(1)" : "none"
                }} />
            ) : (
              <div style={{ textAlign: "center", color: "var(--muted)" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
                <div style={{ fontSize: 12 }}>Cliquer pour uploader</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>PNG, JPG, SVG — max 4 Mo</div>
              </div>
            )}
          </div>

          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogo} />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>📁 Choisir un fichier</button>
            {form.logo && <button className="btn btn-danger btn-sm" onClick={() => setForm(f => ({ ...f, logo: null }))}>🗑 Supprimer</button>}
          </div>

          {form.logo && (
            <>
              <div style={{ fontFamily: "Syne", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "var(--muted)", textTransform: "uppercase", marginBottom: 10 }}>Options de détourage</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

                {/* Fond d'aperçu */}
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Fond d'aperçu</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[["checker", "Damier"], ["dark", "Sombre"], ["white", "Blanc"]].map(([v, l]) => (
                      <button key={v} className={`btn btn-xs ${form.logoBg === v ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => setForm(f => ({ ...f, logoBg: v }))}>{l}</button>
                    ))}
                  </div>
                </div>

                {/* Mode de fusion */}
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Détourage fond blanc</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[["normal", "Aucun"], ["multiply", "Multiply"], ["screen", "Screen"], ["darken", "Darken"]].map(([v, l]) => (
                      <button key={v} className={`btn btn-xs ${(form.logoBlend || "normal") === v ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => setForm(f => ({ ...f, logoBlend: v }))}>{l}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 6 }}>
                    💡 <em>Multiply</em> efface les fonds blancs · <em>Screen</em> efface les fonds noirs
                  </div>
                </div>

                {/* Inverser */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 36, height: 20, borderRadius: 10, cursor: "pointer",
                    background: form.logoInvert ? "var(--gold)" : "var(--card2)",
                    border: "1px solid var(--border2)", position: "relative", transition: "background .2s"
                  }} onClick={() => setForm(f => ({ ...f, logoInvert: !f.logoInvert }))}>
                    <div style={{
                      width: 14, height: 14, borderRadius: "50%", background: "#fff",
                      position: "absolute", top: 2, left: form.logoInvert ? 19 : 3, transition: "left .2s"
                    }} />
                  </div>
                  <span style={{ fontSize: 12, color: "var(--muted2)" }}>Inverser les couleurs</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* INFOS CONCESSION */}
        <div className="card card-pad">
          <div style={{ fontFamily: "Syne", fontSize: 14, fontWeight: 700, letterSpacing: 1, color: "var(--gold)", textTransform: "uppercase", marginBottom: 16 }}>Informations concession</div>
          <div className="form-grid">
            {[["name", "Nom de la concession"], ["address", "Adresse"], ["phone", "Téléphone"], ["email", "Email"], ["siret", "SIRET"], ["tva_num", "N° TVA intracommunautaire"]].map(([k, l]) => (
              <div className="form-group full" key={k}>
                <label className="form-label">{l}</label>
                {k === "address" ? (
                  <textarea className="form-input" rows={2} value={form[k] || ""} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                ) : (
                  <input className="form-input" value={form[k] || ""} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
                )}
              </div>
            ))}

            {/* Mentions facture personnalisables */}
            <div className="form-group full" style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--border2)" }}>
              <div style={{ fontFamily: "Syne", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "var(--gold)", textTransform: "uppercase", marginBottom: 10 }}>
                📄 Mentions facture
              </div>
            </div>
            <div className="form-group full">
              <label className="form-label">Conditions de règlement</label>
              <textarea className="form-input" rows={3}
                value={form.conditions_reglement || "TVA acquittée sur les encaissements.\nTout retard de paiement entraîne des pénalités au taux légal en vigueur (art. L441-10 C. com.).\nIndemnité forfaitaire de recouvrement : 40 €."}
                onChange={e => setForm(f => ({ ...f, conditions_reglement: e.target.value }))}
                placeholder="Vos conditions de paiement personnalisées..." />
            </div>
            <div className="form-group full">
              <label className="form-label">Informations complémentaires</label>
              <textarea className="form-input" rows={3}
                value={form.infos_complementaires || "En cas de litige, tribunal compétent selon règles de droit commun.\nFacture à conserver pendant 10 ans (art. L123-22 C. com.)."}
                onChange={e => setForm(f => ({ ...f, infos_complementaires: e.target.value }))}
                placeholder="Tribunal compétent, clause de réserve de propriété, etc." />
            </div>
          </div>

          {/* Clé API — Zone Admin */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontFamily: "Syne", fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--gold)", textTransform: "uppercase" }}>
                🔑 Clé API — Recherche par plaque
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Ce mois : </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: usedThisMonth < 10 ? "var(--green)" : "var(--orange)" }}>
                  {usedThisMonth} / 10 gratuites
                </span>
              </div>
            </div>

            {!adminUnlocked ? (
              /* Verrou admin */
              <div style={{ background: "rgba(212,168,67,.06)", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 20px" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 28 }}>🔒</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Zone administrateur</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>Entrez le code admin pour modifier la clé API</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="Code administrateur"
                    value={adminInput}
                    onChange={e => { setAdminInput(e.target.value); setAdminError(false); }}
                    onKeyDown={e => e.key === "Enter" && tryUnlock()}
                    style={{ fontFamily: "DM Mono", letterSpacing: 3, maxWidth: 240 }}
                  />
                  <button className="btn btn-primary" onClick={tryUnlock}>Déverrouiller</button>
                </div>
                {adminError && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }}>❌ Code incorrect</div>
                )}
              </div>
            ) : (
              /* Clé visible après déverrouillage */
              <div style={{ background: "rgba(62,207,122,.05)", border: "1px solid rgba(62,207,122,.2)", borderRadius: 10, padding: "16px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>🔓 Zone admin déverrouillée</div>
                  <button className="btn btn-ghost btn-xs" onClick={() => setAdminUnlocked(false)}>🔒 Verrouiller</button>
                </div>
                <div className="form-group">
                  <label className="form-label">Clé RapidAPI (api-plaque.com)</label>
                  <input
                    className="form-input"
                    type="text"
                    value={form.rapidapi_key || ""}
                    onChange={e => setForm(f => ({ ...f, rapidapi_key: e.target.value }))}
                    placeholder="Coller votre clé X-RapidAPI-Key ici"
                    style={{ fontFamily: "DM Mono", fontSize: 12 }}
                  />
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                  Clé stockée localement · <a href="https://rapidapi.com" target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>RapidAPI →</a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <button className="btn btn-primary" onClick={() => setDealer(form)}>
          💾 Enregistrer les paramètres
        </button>
        {saved && <span style={{ marginLeft: 12, fontSize: 12, color: "var(--orange)" }}>● Modifications non sauvegardées</span>}
      </div>

      {/* SYSTÈME DE TICKETS */}
      <TicketSystem dealer={form} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LIVRE DE POLICE
   Champs obligatoires art. R321-3 à R321-5 Code Pénal
═══════════════════════════════════════════════════════════════ */
function LivreDePolice({ vehicles, livrePolice, setLivrePolice, dealer, viewMode }) {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [printMode, setPrintMode] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const entries = livrePolice || [];

  const sorted = [...entries].sort((a, b) => (b.num_ordre || 0) - (a.num_ordre || 0));
  const filtered = sorted.filter(e =>
    !search || `${e.marque} ${e.modele} ${e.immat} ${e.vendeur_nom} ${e.acheteur_nom}`.toLowerCase().includes(search.toLowerCase())
  );

  const nextNum = (entries.length > 0 ? Math.max(...entries.map(e => e.num_ordre || 0)) : 0) + 1;

  const saveEntry = (entry) => {
    // Retirer le flag _incomplete si les infos obligatoires sont remplies
    const isComplete = entry.vendeur_nom && entry.vendeur_piece_id && entry.prix_achat;
    const cleaned = { ...entry, _incomplete: !isComplete };
    const exists = entries.find(x => x.id === cleaned.id);
    const next = exists ? entries.map(x => x.id === cleaned.id ? cleaned : x) : [...entries, cleaned];
    setLivrePolice(next);
    setModal(null);
  };

  const delEntry = (id) => { setLivrePolice(entries.filter(e => e.id !== id)); setPendingDelete(null); };

  return (
    <div className="page">
      {modal && <LivrePoliceModal entry={modal === "add" ? null : modal} nextNum={nextNum} vehicles={vehicles} onSave={saveEntry} onClose={() => setModal(null)} />}
      {pendingDelete && (
        <ConfirmModal
          title="Supprimer l'entrée"
          message={`Supprimer l'entrée N°${String(pendingDelete.num).padStart(4,"0")} — ${pendingDelete.label} du livre de police ? Cette action est irréversible.`}
          confirmLabel="Supprimer"
          onConfirm={() => delEntry(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <div className="page-header">
        <div>
          <div className="page-title">📋 Livre de Police</div>
          <div className="page-sub">Registre obligatoire — art. R321-3 à R321-5 Code Pénal · Conservation 5 ans</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setPrintMode(true); setTimeout(() => window.print(), 300); setTimeout(() => setPrintMode(false), 1000); }}>
            🖨 Imprimer le registre
          </button>
          <button className="btn btn-primary" onClick={() => setModal("add")}>+ Nouvelle entrée</button>
        </div>
      </div>

      {/* Bandeau légal */}
      <div style={{ background: "rgba(229,151,60,.08)", border: "1px solid rgba(229,151,60,.25)", borderRadius: 10, padding: "12px 18px", marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ fontSize: 20 }}>⚖️</span>
        <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.7, flex: 1 }}>
          <strong style={{ color: "var(--orange)" }}>Obligation légale</strong> — Tout professionnel achetant/revendant des véhicules d'occasion doit tenir ce registre à jour.
          Consultable à tout moment par la police, gendarmerie ou services fiscaux. <strong style={{ color: "var(--text)" }}>Conservation : 5 ans minimum.</strong>
          Sanctions : amende + suspension d'activité en cas de manquement.
        </div>
        {entries.filter(e => e._incomplete).length > 0 && (
          <div style={{ flexShrink: 0, background: "rgba(229,151,60,.15)", border: "1px solid var(--orange)", borderRadius: 8, padding: "8px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 20, lineHeight: 1 }}>⚠️</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--orange)", marginTop: 4 }}>{entries.filter(e => e._incomplete).length}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>à compléter</div>
          </div>
        )}
      </div>

      <input className="search-input" placeholder="Rechercher véhicule, vendeur, acheteur..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16, width: 320 }} />

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>N° ordre</th>
              <th>Date entrée</th>
              <th>Véhicule</th>
              <th>Immat.</th>
              <th>VIN</th>
              <th>Km</th>
              <th>Vendeur / Provenance</th>
              <th>Prix achat</th>
              <th>Date sortie</th>
              <th>Acheteur</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>
                Aucune entrée — cliquez sur "+ Nouvelle entrée" pour commencer
              </td></tr>
            )}
            {filtered.map(e => (
              <tr key={e.id} style={{ background: e._incomplete ? "rgba(229,151,60,.04)" : "transparent" }}>
                <td style={{ fontFamily: "DM Mono", fontWeight: 700, color: "var(--gold)" }}>
                  #{String(e.num_ordre).padStart(4, "0")}
                  {e._incomplete && (
                    <div style={{ fontSize: 9, color: "var(--orange)", marginTop: 2 }}>⚠️ À compléter</div>
                  )}
                </td>
                <td style={{ fontSize: 12 }}>{e.date_entree}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{e.marque} {e.modele}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{e.couleur} · {e.annee}</div>
                </td>
                <td><PlateBadge plate={e.immat} /></td>
                <td style={{ fontFamily: "DM Mono", fontSize: 11, color: "var(--muted)" }}>{e.vin || "—"}</td>
                <td style={{ fontSize: 12 }}>{e.kilometrage ? Number(e.kilometrage).toLocaleString("fr-FR") : "—"}</td>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{e.vendeur_nom || "—"}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{e.vendeur_type === "pro" ? "🏢 Pro" : "👤 Particulier"} · {e.vendeur_piece_id}</div>
                </td>
                <td style={{ fontFamily: "DM Mono", color: "var(--red)" }}>{e.prix_achat ? fmt(e.prix_achat) : "—"}</td>
                <td style={{ fontSize: 12, color: e.date_sortie ? "var(--green)" : "var(--muted)" }}>{e.date_sortie || "En stock"}</td>
                <td style={{ fontSize: 12 }}>{e.acheteur_nom || "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => setModal(e)}>✏️</button>
                    {viewMode === "admin" && (
                      <button className="btn btn-danger btn-xs" onClick={() => setPendingDelete({ id: e.id, num: e.num_ordre, label: `${e.marque} ${e.modele} ${e.immat || ""}` })}>🗑</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* IMPRESSION */}
      {printMode && (
        <div style={{ display: "none" }} className="print-only">
          <div style={{ fontFamily: "DM Sans", padding: 20 }}>
            <h2 style={{ marginBottom: 4 }}>LIVRE DE POLICE — {dealer?.name}</h2>
            <p style={{ fontSize: 11, color: "#888", marginBottom: 20 }}>
              {dealer?.address} · SIRET : {dealer?.siret} · Imprimé le {today()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function LivrePoliceModal({ entry, nextNum, vehicles, onSave, onClose }) {
  const [form, setForm] = useState(entry || {
    id: uid(), num_ordre: nextNum, date_entree: today(),
    marque: "", modele: "", annee: "", couleur: "", immat: "", vin: "", kilometrage: "",
    pays_origine: "France",
    vendeur_type: "particulier",
    vendeur_nom: "", vendeur_prenom: "", vendeur_adresse: "",
    vendeur_piece_id: "", vendeur_piece_type: "CNI", vendeur_piece_date: "", vendeur_piece_autorite: "",
    prix_achat: "", mode_reglement: "Virement",
    date_sortie: "", acheteur_nom: "", acheteur_adresse: "",
    notes: ""
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const fillFromVehicle = (vid) => {
    const v = vehicles?.find(x => x.id === vid);
    if (!v) return;
    setForm(f => ({
      ...f, marque: v.marque || "", modele: v.modele || "", annee: v.annee || "",
      couleur: v.couleur || "", immat: v.plate || "", vin: v.vin || "",
      kilometrage: v.kilometrage || "", prix_achat: v.prix_achat || ""
    }));
  };

  const PIECES = ["CNI", "Passeport", "Permis de conduire", "Carte de séjour", "Extrait Kbis"];
  const REGLEMENTS = ["Virement", "Chèque", "Espèces", "Financement"];

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-hd">
          <span className="modal-title">📋 Entrée livre de police — N°{String(form.num_ordre).padStart(4, "0")}</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">

          {/* Import depuis flotte */}
          {vehicles?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label className="form-label">Importer depuis la flotte</label>
              <select className="form-input" onChange={e => fillFromVehicle(e.target.value)} style={{ marginTop: 4 }}>
                <option value="">— Choisir un véhicule —</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.plate} · {v.marque} {v.modele} ({v.annee})</option>)}
              </select>
            </div>
          )}

          {/* Section véhicule */}
          <div style={{ fontFamily: "Syne", fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--gold)", textTransform: "uppercase", marginBottom: 10 }}>🚗 Identification du véhicule</div>
          <div className="form-grid" style={{ marginBottom: 20 }}>
            {[["marque","Marque *"],["modele","Modèle *"],["annee","Année","number"],["couleur","Couleur"],["immat","Immatriculation"],["vin","N° VIN / Châssis"],["kilometrage","Kilométrage","number"],["pays_origine","Pays d'origine"],["date_entree","Date d'entrée *"]].map(([k,l,t]) => (
              <div className="form-group" key={k}>
                <label className="form-label">{l}</label>
                <input className="form-input" type={t||"text"} value={form[k]||""} onChange={e => set(k, e.target.value)} />
              </div>
            ))}
          </div>

          {/* Section vendeur */}
          <div style={{ fontFamily: "Syne", fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--blue)", textTransform: "uppercase", marginBottom: 10 }}>👤 Vendeur / Fournisseur</div>
          <div className="form-grid" style={{ marginBottom: 20 }}>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-input" value={form.vendeur_type} onChange={e => set("vendeur_type", e.target.value)}>
                <option value="particulier">Particulier</option>
                <option value="pro">Professionnel / Société</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Nom / Raison sociale *</label>
              <input className="form-input" value={form.vendeur_nom||""} onChange={e => set("vendeur_nom", e.target.value)} />
            </div>
            {form.vendeur_type === "particulier" && (
              <div className="form-group">
                <label className="form-label">Prénom</label>
                <input className="form-input" value={form.vendeur_prenom||""} onChange={e => set("vendeur_prenom", e.target.value)} />
              </div>
            )}
            <div className="form-group full">
              <label className="form-label">Adresse</label>
              <input className="form-input" value={form.vendeur_adresse||""} onChange={e => set("vendeur_adresse", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Type pièce d'identité *</label>
              <select className="form-input" value={form.vendeur_piece_type} onChange={e => set("vendeur_piece_type", e.target.value)}>
                {PIECES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">N° pièce d'identité *</label>
              <input className="form-input" value={form.vendeur_piece_id||""} onChange={e => set("vendeur_piece_id", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Date délivrance</label>
              <input className="form-input" value={form.vendeur_piece_date||""} onChange={e => set("vendeur_piece_date", e.target.value)} placeholder="jj/mm/aaaa" />
            </div>
            <div className="form-group">
              <label className="form-label">Autorité émettrice</label>
              <input className="form-input" value={form.vendeur_piece_autorite||""} onChange={e => set("vendeur_piece_autorite", e.target.value)} placeholder="ex: Préfecture du Rhône" />
            </div>
            <div className="form-group">
              <label className="form-label">Prix d'achat (€)</label>
              <input className="form-input" type="number" value={form.prix_achat||""} onChange={e => set("prix_achat", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Mode de règlement</label>
              <select className="form-input" value={form.mode_reglement} onChange={e => set("mode_reglement", e.target.value)}>
                {REGLEMENTS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>

          {/* Section sortie */}
          <div style={{ fontFamily: "Syne", fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--green)", textTransform: "uppercase", marginBottom: 10 }}>🏷 Sortie du parc (vente)</div>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Date de sortie</label>
              <input className="form-input" value={form.date_sortie||""} onChange={e => set("date_sortie", e.target.value)} placeholder="jj/mm/aaaa" />
            </div>
            <div className="form-group">
              <label className="form-label">Nom acheteur</label>
              <input className="form-input" value={form.acheteur_nom||""} onChange={e => set("acheteur_nom", e.target.value)} />
            </div>
            <div className="form-group full">
              <label className="form-label">Adresse acheteur</label>
              <input className="form-input" value={form.acheteur_adresse||""} onChange={e => set("acheteur_adresse", e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={2} value={form.notes||""} onChange={e => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={() => {
            if (!form.marque || !form.date_entree) return alert("Marque et date d'entrée requis");
            // Retirer le flag _incomplete si les infos obligatoires sont remplies
            const isComplete = form.vendeur_nom && form.vendeur_piece_id;
            onSave({
              ...form,
              prix_achat: parseFloat(form.prix_achat) || 0,
              kilometrage: parseInt(form.kilometrage) || 0,
              _incomplete: isComplete ? false : form._incomplete,
            });
          }}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FACTUR-X — Export facture électronique conforme 2026
   Profils : minimum | en16931 (PA-compatible)
═══════════════════════════════════════════════════════════════ */
function exportFacturX(order, dealer, profil = "minimum") {
  const c = calcOrder(order);
  const dateISO = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dueDate = (order.date_echeance || today()).split("/").reverse().join("");
  const isEN16931 = profil === "en16931";
  const siren = (dealer?.siret || "").replace(/\s/g, "").slice(0, 9);
  const profilID = isEN16931
    ? "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:en16931"
    : "urn:factur-x.eu:1p0:minimum";

  const lignes = isEN16931 ? (order.lignes || [{
    id: "1", nom: order.vehicle_label || "Véhicule", qte: 1,
    prix_unitaire: c.base.toFixed(2), montant_net: c.base.toFixed(2),
    tva_code: "S", tva_pct: order.tva_pct || 20,
  }]) : [];

  const lignesXml = lignes.map((l, i) => [
    '    <ram:IncludedSupplyChainTradeLineItem>',
    '      <ram:AssociatedDocumentLineDocument>',
    `        <ram:LineID>${i + 1}</ram:LineID>`,
    '      </ram:AssociatedDocumentLineDocument>',
    '      <ram:SpecifiedTradeProduct>',
    `        <ram:Name>${l.nom}</ram:Name>`,
    '      </ram:SpecifiedTradeProduct>',
    '      <ram:SpecifiedLineTradeAgreement>',
    '        <ram:NetPriceProductTradePrice>',
    `          <ram:ChargeAmount>${l.prix_unitaire}</ram:ChargeAmount>`,
    '        </ram:NetPriceProductTradePrice>',
    '      </ram:SpecifiedLineTradeAgreement>',
    '      <ram:SpecifiedLineTradeDelivery>',
    `        <ram:BilledQuantity unitCode="C62">${l.qte}</ram:BilledQuantity>`,
    '      </ram:SpecifiedLineTradeDelivery>',
    '      <ram:SpecifiedLineTradeSettlement>',
    '        <ram:ApplicableTradeTax>',
    '          <ram:TypeCode>VAT</ram:TypeCode>',
    `          <ram:CategoryCode>${l.tva_code}</ram:CategoryCode>`,
    `          <ram:RateApplicablePercent>${l.tva_pct}</ram:RateApplicablePercent>`,
    '        </ram:ApplicableTradeTax>',
    '        <ram:SpecifiedTradeSettlementLineMonetarySummation>',
    `          <ram:LineTotalAmount>${l.montant_net}</ram:LineTotalAmount>`,
    '        </ram:SpecifiedTradeSettlementLineMonetarySummation>',
    '      </ram:SpecifiedLineTradeSettlement>',
    '    </ram:IncludedSupplyChainTradeLineItem>',
  ].join("\n")).join("\n");

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- Factur-X 1.08 / ZUGFeRD 2.4 profil ${isEN16931 ? "EN16931" : "MINIMUM"} — conforme reforme 01/09/2026 -->`,
    '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"',
    '  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"',
    '  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">',
    '  <rsm:ExchangedDocumentContext>',
    '    <ram:GuidelineSpecifiedDocumentContextParameter>',
    `      <ram:ID>${profilID}</ram:ID>`,
    '    </ram:GuidelineSpecifiedDocumentContextParameter>',
    '  </rsm:ExchangedDocumentContext>',
    '  <rsm:ExchangedDocument>',
    `    <ram:ID>${order.ref}</ram:ID>`,
    '    <ram:TypeCode>380</ram:TypeCode>',
    '    <ram:IssueDateTime>',
    `      <udt:DateTimeString format="102">${dateISO}</udt:DateTimeString>`,
    '    </ram:IssueDateTime>',
    '  </rsm:ExchangedDocument>',
    '  <rsm:SupplyChainTradeTransaction>',
    ...(isEN16931 && lignesXml ? [lignesXml] : []),
    '    <ram:ApplicableHeaderTradeAgreement>',
    '      <ram:SellerTradeParty>',
    `        <ram:Name>${dealer?.name || ""}</ram:Name>`,
    ...(siren ? [
      '        <ram:SpecifiedLegalOrganization>',
      `          <ram:ID schemeID="0002">${siren}</ram:ID>`,
      '        </ram:SpecifiedLegalOrganization>',
    ] : []),
    '        <ram:PostalTradeAddress>',
    `          <ram:LineOne>${(dealer?.address || "").split("\n")[0]}</ram:LineOne>`,
    '          <ram:CountryID>FR</ram:CountryID>',
    '        </ram:PostalTradeAddress>',
    '        <ram:SpecifiedTaxRegistration>',
    `          <ram:ID schemeID="VA">${dealer?.tva_num || ""}</ram:ID>`,
    '        </ram:SpecifiedTaxRegistration>',
    '      </ram:SellerTradeParty>',
    '      <ram:BuyerTradeParty>',
    `        <ram:Name>${order.client?.name || ""}</ram:Name>`,
    '      </ram:BuyerTradeParty>',
    '    </ram:ApplicableHeaderTradeAgreement>',
    '    <ram:ApplicableHeaderTradeDelivery/>',
    '    <ram:ApplicableHeaderTradeSettlement>',
    '      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>',
    '      <ram:ApplicableTradeTax>',
    `        <ram:CalculatedAmount>${c.tvaAmt.toFixed(2)}</ram:CalculatedAmount>`,
    '        <ram:TypeCode>VAT</ram:TypeCode>',
    `        <ram:BasisAmount>${c.base.toFixed(2)}</ram:BasisAmount>`,
    '        <ram:CategoryCode>S</ram:CategoryCode>',
    `        <ram:RateApplicablePercent>${order.tva_pct || 20}</ram:RateApplicablePercent>`,
    '      </ram:ApplicableTradeTax>',
    '      <ram:SpecifiedTradePaymentTerms>',
    '        <ram:DueDateDateTime>',
    `          <udt:DateTimeString format="102">${dueDate}</udt:DateTimeString>`,
    '        </ram:DueDateDateTime>',
    '      </ram:SpecifiedTradePaymentTerms>',
    '      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    `        <ram:LineTotalAmount>${c.base.toFixed(2)}</ram:LineTotalAmount>`,
    `        <ram:TaxBasisTotalAmount>${c.base.toFixed(2)}</ram:TaxBasisTotalAmount>`,
    `        <ram:TaxTotalAmount currencyID="EUR">${c.tvaAmt.toFixed(2)}</ram:TaxTotalAmount>`,
    `        <ram:GrandTotalAmount>${c.ttc.toFixed(2)}</ram:GrandTotalAmount>`,
    `        <ram:TotalPrepaidAmount>${c.encaisse.toFixed(2)}</ram:TotalPrepaidAmount>`,
    `        <ram:DuePayableAmount>${c.reste.toFixed(2)}</ram:DuePayableAmount>`,
    '      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    '    </ram:ApplicableHeaderTradeSettlement>',
    '  </rsm:SupplyChainTradeTransaction>',
    '</rsm:CrossIndustryInvoice>',
  ];

  const xml = lines.join("\n");
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${order.ref}_facturx_${isEN16931 ? "EN16931" : "MINIMUM"}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════════
   CRM — CLIENTS
═══════════════════════════════════════════════════════════════ */
const STATUTS_CLIENT = {
  prospect:    { label: "Prospect",       cls: "badge-muted",   icon: "🔍" },
  contacte:    { label: "Contacté",       cls: "badge-blue",    icon: "📞" },
  negociation: { label: "Négociation",    cls: "badge-orange",  icon: "🤝" },
  client:      { label: "Client",         cls: "badge-green",   icon: "✅" },
  inactif:     { label: "Inactif",        cls: "badge-muted",   icon: "💤" },
};

function CrmPage({ clients, setClients, orders, viewMode }) {
  const [search, setSearch]         = useState("");
  const [filterStatut, setFilter]   = useState("all");
  const [modal, setModal]           = useState(null);
  const [fiche, setFiche]           = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showDemoLimit, setShowDemoLimit] = useState(false);

  const filtered = clients.filter(c => {
    const matchS = !search || `${c.nom} ${c.prenom} ${c.email} ${c.phone}`.toLowerCase().includes(search.toLowerCase());
    const matchF = filterStatut === "all" || c.statut === filterStatut;
    return matchS && matchF;
  });

  const save = (c) => {
    const exists = clients.find(x => x.id === c.id);
    setClients(exists ? clients.map(x => x.id === c.id ? c : x) : [c, ...clients]);
    setModal(null);
    if (fiche?.id === c.id) setFiche(c);
  };

  const del = (id) => {
    setClients(clients.filter(c => c.id !== id));
    if (fiche?.id === id) setFiche(null);
    setPendingDelete(null);
  };

  const clientOrders = (clientId) => orders.filter(o => o.client_id === clientId || (fiche && o.client?.name?.toLowerCase() === fiche.nom?.toLowerCase()));

  return (
    <div className="page">
      {modal && <CrmModal client={modal === "add" ? null : modal} onSave={save} onClose={() => setModal(null)} />}
      {fiche && <CrmFiche client={fiche} orders={clientOrders(fiche.id)} onEdit={() => setModal(fiche)} onClose={() => setFiche(null)} onSave={save} />}
      {pendingDelete && (
        <ConfirmModal
          title="Supprimer le contact"
          message={`Supprimer définitivement la fiche de ${pendingDelete.label} ? Ses documents ne seront pas supprimés.`}
          confirmLabel="Supprimer"
          onConfirm={() => del(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {viewMode === "trial" && showDemoLimit && <DemoLimitModal type="clients" onClose={() => setShowDemoLimit(false)} />}

      <div className="page-header">
        <div>
          <div className="page-title">👥 CRM Clients</div>
          <div className="page-sub">{clients.length} contact{clients.length !== 1 ? "s" : ""} · {clients.filter(c => c.statut === "client").length} clients actifs{viewMode === "trial" && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--orange)" }}>· Mode démo ({clients.length}/{DEMO_LIMITS.clients})</span>}</div>
        </div>
        <button className="btn btn-primary" onClick={() => {
          if (viewMode === "trial" && clients.length >= DEMO_LIMITS.clients) { setShowDemoLimit(true); return; }
          setModal("add");
        }}>+ Nouveau contact</button>
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input className="search-input" placeholder="Rechercher nom, email, téléphone..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="tabs" style={{ margin: 0 }}>
          {[["all", "Tous"], ...Object.entries(STATUTS_CLIENT).map(([k, v]) => [k, v.icon + " " + v.label])].map(([k, l]) => (
            <div key={k} className={`tab${filterStatut === k ? " active" : ""}`} onClick={() => setFilter(k)}>{l}</div>
          ))}
        </div>
      </div>

      {/* Grille clients */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted)" }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: .3 }}>👥</div>
          <div style={{ fontSize: 14 }}>Aucun contact trouvé</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {filtered.map(c => {
            const nbDocs = orders.filter(o => o.client?.name?.toLowerCase() === `${c.nom} ${c.prenom}`.toLowerCase().trim() || o.client_id === c.id).length;
            const lastAnnot = c.annotations?.length > 0 ? c.annotations[c.annotations.length - 1] : null;
            return (
              <div key={c.id} className="card" style={{ transition: "border-color .15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,.07)"}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", cursor: "pointer", flex: 1 }} onClick={() => setFiche(c)}>
                    <div style={{
                      width: 42, height: 42, borderRadius: "50%", background: "var(--gold3)",
                      border: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "Syne", fontWeight: 800, fontSize: 15, color: "var(--gold)", flexShrink: 0
                    }}>
                      {(c.nom?.[0] || "?").toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.prenom} {c.nom}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{c.email || c.phone || "—"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span className={`badge ${STATUTS_CLIENT[c.statut || "prospect"]?.cls}`}>
                      {STATUTS_CLIENT[c.statut || "prospect"]?.label}
                    </span>
                    <button className="btn btn-danger btn-xs" onClick={e => { e.stopPropagation(); setPendingDelete({ id: c.id, label: `${c.prenom || ""} ${c.nom}`.trim() }); }}>🗑</button>
                  </div>
                </div>
                <div style={{ padding: "12px 20px" }}>
                  <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)", marginBottom: lastAnnot ? 10 : 0 }}>
                    <span>🧾 {nbDocs} document{nbDocs !== 1 ? "s" : ""}</span>
                    {c.vehicule_interet && <span>🚗 {c.vehicule_interet}</span>}
                    {c.budget && <span>💰 {fmt(c.budget)}</span>}
                  </div>
                  {lastAnnot && (
                    <div style={{ fontSize: 11, color: "var(--muted2)", background: "var(--card2)", borderRadius: 6, padding: "6px 10px", borderLeft: "3px solid var(--border)" }}>
                      📝 {lastAnnot.texte?.slice(0, 80)}{lastAnnot.texte?.length > 80 ? "…" : ""}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Fiche détail client ── */
function CrmFiche({ client, orders, onEdit, onClose, onSave }) {
  const [newAnnot, setNewAnnot] = useState("");
  const [annotMode, setAnnotMode] = useState(false);
  const [pendingDeleteAnnot, setPendingDeleteAnnot] = useState(null);

  const addAnnotation = () => {
    if (!newAnnot.trim()) return;
    const annot = { id: uid(), texte: newAnnot.trim(), date: today(), heure: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) };
    onSave({ ...client, annotations: [...(client.annotations || []), annot] });
    setNewAnnot("");
    setAnnotMode(false);
  };

  const delAnnot = (id) => {
    onSave({ ...client, annotations: (client.annotations || []).filter(a => a.id !== id) });
    setPendingDeleteAnnot(null);
  };

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      {pendingDeleteAnnot && (
        <ConfirmModal
          title="Supprimer l'annotation"
          message={`Supprimer cette note : "${pendingDeleteAnnot.texte?.slice(0, 60)}…" ?`}
          confirmLabel="Supprimer"
          onConfirm={() => delAnnot(pendingDeleteAnnot.id)}
          onCancel={() => setPendingDeleteAnnot(null)}
        />
      )}
      <div className="modal modal-lg" style={{ display: "flex", flexDirection: "column", maxHeight: "92vh" }}>
        <div className="modal-hd" style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--gold3)", border: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne", fontWeight: 800, fontSize: 16, color: "var(--gold)" }}>
              {(client.nom?.[0] || "?").toUpperCase()}
            </div>
            <div>
              <span className="modal-title">{client.prenom} {client.nom}</span>
              <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                <span className={`badge ${STATUTS_CLIENT[client.statut || "prospect"]?.cls}`}>
                  {STATUTS_CLIENT[client.statut || "prospect"]?.icon} {STATUTS_CLIENT[client.statut || "prospect"]?.label}
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>✏️ Modifier</button>
            <button className="close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>

            {/* Infos contact */}
            <div className="card card-pad">
              <div style={{ fontFamily: "Syne", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "var(--gold)", textTransform: "uppercase", marginBottom: 12 }}>Coordonnées</div>
              {[["📧", "Email", client.email], ["📞", "Téléphone", client.phone], ["🏠", "Adresse", client.adresse], ["🚗", "Intérêt véhicule", client.vehicule_interet], ["💰", "Budget", client.budget ? fmt(client.budget) : null], ["📅", "Contact le", client.date_contact]].filter(([,, v]) => v).map(([icon, label, val]) => (
                <div key={label} style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 13 }}>
                  <span>{icon}</span>
                  <span style={{ color: "var(--muted)", minWidth: 100 }}>{label}</span>
                  <span style={{ fontWeight: 500 }}>{val}</span>
                </div>
              ))}
              {client.notes && (
                <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--card2)", borderRadius: 6, fontSize: 12, color: "var(--muted2)" }}>
                  {client.notes}
                </div>
              )}
            </div>

            {/* Documents rattachés */}
            <div className="card card-pad">
              <div style={{ fontFamily: "Syne", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "var(--gold)", textTransform: "uppercase", marginBottom: 12 }}>
                Factures & Bons de commande ({orders.length})
              </div>
              {orders.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Aucun document lié</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {orders.map(o => {
                    const c2 = calcOrder(o);
                    return (
                      <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "var(--card2)", borderRadius: 6 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "DM Mono" }}>{o.ref}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{o.date_creation} · {o.vehicle_label}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtDec(c2.ttc)}</div>
                          <span className={`badge ${o.type === "facture" ? "badge-gold" : "badge-blue"}`} style={{ fontSize: 10 }}>
                            {o.type === "facture" ? "🧾 Facture" : "📝 BC"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Annotations */}
          <div className="card">
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontFamily: "Syne", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "var(--gold)", textTransform: "uppercase" }}>
                📝 Annotations & Suivi ({(client.annotations || []).length})
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setAnnotMode(!annotMode)}>
                {annotMode ? "Annuler" : "+ Ajouter une note"}
              </button>
            </div>

            {annotMode && (
              <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border2)", background: "var(--card2)" }}>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="Votre note... (ex: Intéressé par un SUV diesel, rappeler en mai)"
                  value={newAnnot}
                  onChange={e => setNewAnnot(e.target.value)}
                  autoFocus
                  style={{ marginBottom: 10 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={addAnnotation}>💾 Enregistrer</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setAnnotMode(false); setNewAnnot(""); }}>Annuler</button>
                </div>
              </div>
            )}

            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {(client.annotations || []).length === 0 ? (
                <div style={{ padding: "20px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                  Aucune annotation — cliquez sur "+ Ajouter une note"
                </div>
              ) : (
                [...(client.annotations || [])].reverse().map(a => (
                  <div key={a.id} style={{ padding: "12px 20px", borderBottom: "1px solid var(--border2)", display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--card2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>📝</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>{a.texte}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{a.date} à {a.heure}</div>
                    </div>
                    <button className="btn btn-danger btn-xs" onClick={() => setPendingDeleteAnnot(a)}>🗑</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Formulaire création/édition client ── */
function CrmModal({ client, onSave, onClose }) {
  const [form, setForm] = useState(client || {
    id: uid(), nom: "", prenom: "", email: "", phone: "", adresse: "",
    statut: "prospect", vehicule_interet: "", budget: "", date_contact: today(),
    notes: "", annotations: []
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-md">
        <div className="modal-hd">
          <span className="modal-title">{client ? "Modifier le contact" : "Nouveau contact"}</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Prénom</label>
              <input className="form-input" value={form.prenom} onChange={e => set("prenom", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Nom *</label>
              <input className="form-input" value={form.nom} onChange={e => set("nom", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => set("email", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Téléphone</label>
              <input className="form-input" value={form.phone} onChange={e => set("phone", e.target.value)} />
            </div>
            <div className="form-group full">
              <label className="form-label">Adresse</label>
              <input className="form-input" value={form.adresse} onChange={e => set("adresse", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Statut</label>
              <select className="form-input" value={form.statut} onChange={e => set("statut", e.target.value)}>
                {Object.entries(STATUTS_CLIENT).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Date de contact</label>
              <input className="form-input" value={form.date_contact} onChange={e => set("date_contact", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Véhicule recherché</label>
              <input className="form-input" placeholder="ex: SUV diesel, Budget 20k€" value={form.vehicule_interet} onChange={e => set("vehicule_interet", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Budget max (€)</label>
              <input className="form-input" type="number" value={form.budget} onChange={e => set("budget", e.target.value)} />
            </div>
            <div className="form-group full">
              <label className="form-label">Notes internes</label>
              <textarea className="form-input" rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Informations générales sur ce contact..." />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={() => {
            if (!form.nom.trim()) return alert("Le nom est requis");
            onSave({ ...form, budget: parseFloat(form.budget) || 0 });
          }}>💾 Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT COMPTABLE CSV — FEC simplifié
═══════════════════════════════════════════════════════════════ */
function exportComptableCSV(orders, dealer) {
  const sep = ";";
  const headers = [
    "Type", "Référence", "Date", "Client", "SIREN client",
    "Véhicule", "Plaque", "Base HT (€)", "TVA (%)", "Montant TVA (€)",
    "Total TTC (€)", "Encaissé (€)", "Reste dû (€)", "Statut paiement",
    "Catégorie opération", "TVA sur débits", "Avec TVA", "Facture origine"
  ].join(sep);

  const rows = [...orders]
    .sort((a, b) => (a.ref || "").localeCompare(b.ref || ""))
    .map(o => {
      const c = calcOrder(o);
      const paySt = c.reste <= 0.01 ? "Soldé" : c.encaisse > 0 ? "Partiel" : "À encaisser";
      const catOp = o.categorie_operation === "prestation_services" ? "Prestation de services"
        : o.categorie_operation === "mixte" ? "Livraison + Prestation"
        : "Livraison de biens";
      return [
        o.type === "facture" ? "Facture" : o.type === "avoir" ? "Avoir" : "Bon de commande",
        o.ref || "",
        o.date_creation || "",
        (o.client?.name || "").replace(/;/g, ","),
        o.client?.siren || "",
        (o.vehicle_label || "").replace(/;/g, ","),
        o.vehicle_plate || "",
        c.base.toFixed(2).replace(".", ","),
        o.avec_tva !== false ? (o.tva_pct || 20) : 0,
        c.tvaAmt.toFixed(2).replace(".", ","),
        c.ttc.toFixed(2).replace(".", ","),
        c.encaisse.toFixed(2).replace(".", ","),
        c.reste.toFixed(2).replace(".", ","),
        paySt,
        catOp,
        o.tva_sur_debits ? "Oui" : "Non",
        o.avec_tva !== false ? "Oui" : "Non (Art. 297A CGI)",
        o.facture_origine || "",
      ].join(sep);
    });

  const bom = "\uFEFF"; // BOM UTF-8 pour Excel
  const csv = bom + [headers, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `export_comptable_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════════
   SUPABASE DATA HOOKS
═══════════════════════════════════════════════════════════════ */
function useSupabaseTable(token, garageId, table) {
  const [data, setData] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token || !garageId) { setReady(true); return; }
    setReady(false);
    sb.select(token, table, `garage_id=eq.${garageId}`)
      .then(rows => {
        // Supabase stocke {id, garage_id, data:{...}} — on aplatit pour l'UI
        const flat = (rows || []).map(r => {
          if (r.data && typeof r.data === "object") {
            return { ...r.data, id: r.id, garage_id: r.garage_id, created_at: r.created_at };
          }
          return r;
        });
        setData(flat);
      })
      .catch(() => setData([]))
      .finally(() => setReady(true));
  }, [token, garageId]);

  // setData wrapper : met à jour le state ET persiste les changements dans Supabase
  const setDataAndSync = useCallback((newDataOrFn) => {
    setData(prev => {
      const next = typeof newDataOrFn === "function" ? newDataOrFn(prev) : newDataOrFn;
      if (!token || !garageId || token === "demo") return next;

      const prevIds = new Set(prev.map(r => r.id));
      const nextIds = new Set(next.map(r => r.id));

      // Upsert : éléments nouveaux ou modifiés — wrapper dans {id, garage_id, data:{...}}
      for (const row of next) {
        const old = prev.find(r => r.id === row.id);
        if (!old || JSON.stringify(old) !== JSON.stringify(row)) {
          const { id, garage_id: _g, created_at: _c, ...fields } = row;
          sb.upsert(token, table, { id, garage_id: garageId, data: fields }).catch(() => {});
        }
      }

      // Delete : éléments supprimés
      for (const id of prevIds) {
        if (!nextIds.has(id)) {
          sb.delete(token, table, id).catch(() => {});
        }
      }

      return next;
    });
  }, [token, garageId, table]);

  return [data, setDataAndSync, ready];
}

/* ═══════════════════════════════════════════════════════════════
   ÉCRAN CONNEXION
═══════════════════════════════════════════════════════════════ */
// ── STRIPE CONFIG ─────────────────────────────────────────────
const STRIPE_PK = "pk_live_SDF3fQvD7xz2CEka6zTxl0pv00q59HC4w7";
const STRIPE_PLANS = {
  monthly: {
    priceId: "price_1TODbBGHGXxR2PvGx242HQBI",
    label:   "Mensuel",
    price:   "24,99€",
    period:  "/ mois HT",
    badge:   null,
  },
  annual: {
    priceId: "price_1TODbBGHGXxR2PvGDH10euYl",
    label:   "Annuel",
    price:   "274,89€",
    period:  "/ an HT",
    badge:   "1 mois offert",
  },
};

async function redirectToStripe(priceId, email) {
  // Charge Stripe.js dynamiquement
  if (!window.Stripe) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const stripe = window.Stripe(STRIPE_PK);
  await stripe.redirectToCheckout({
    lineItems: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    customerEmail: email,
    successUrl: window.location.href + "?subscribed=1",
    cancelUrl:  window.location.href + "?canceled=1",
  });
}

function LoginScreen({ onLogin }) {
  const [mode, setMode]           = useState("login"); // login | register | reset | plan
  const [plan, setPlan]           = useState("monthly");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [garageName, setGarageName] = useState("");
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState("");
  const [loading, setLoading]     = useState(false);

  // Détection retour Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("subscribed") === "1") {
      setSuccess("🎉 Abonnement activé ! Connectez-vous pour accéder à IO Car.");
      setMode("login");
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("canceled") === "1") {
      setError("Paiement annulé. Vous pouvez réessayer.");
      setMode("register");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handle = async () => {
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (mode === "reset") {
        await sb.resetPassword(email);
        setSuccess("Email de réinitialisation envoyé ! Vérifiez votre boîte mail.");
        setLoading(false); return;
      }
      if (mode === "register") {
        if (!garageName.trim()) { setError("Nom de la concession requis"); setLoading(false); return; }
        if (!email.trim() || !password.trim()) { setError("Email et mot de passe requis"); setLoading(false); return; }
        // 1. Créer le compte Supabase
        const res = await sb.signUp(email, password, garageName);
        if (res.error) { setError(res.error.message || "Erreur inscription"); setLoading(false); return; }
        // 2. Rediriger vers Stripe pour le paiement
        await redirectToStripe(STRIPE_PLANS[plan].priceId, email);
        setLoading(false); return;
      }
      // Login
      const res = await sb.signIn(email, password);
      if (res.error) { setError("Email ou mot de passe incorrect"); setLoading(false); return; }
      saveSession(res.access_token, res.user);
      onLogin(res.access_token, res.user);
    } catch(e) {
      setError("Erreur réseau — vérifiez votre connexion");
    }
    setLoading(false);
  };

  return (
    <>
      <style>{STYLE}</style>
      <div className="auth-wrap">
        <div className="auth-box">
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne", fontWeight: 800, fontSize: 16, color: "#0b0c10" }}>IO</div>
              <div>
                <div style={{ fontFamily: "Syne", fontWeight: 800, fontSize: 20, letterSpacing: 2 }}>IO <span style={{ color: "var(--gold)" }}>Car</span></div>
                <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--muted)", textTransform: "uppercase" }}>by OWL'S INDUSTRY</div>
              </div>
            </div>
          </div>

          <div style={{ fontFamily: "Syne", fontSize: 20, fontWeight: 700, textAlign: "center", marginBottom: 6 }}>
            {mode === "login" ? "Connexion" : mode === "register" ? "Créer mon accès" : "Mot de passe oublié"}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", marginBottom: 24 }}>
            {mode === "login" ? "Accédez à votre concession" : mode === "register" ? "Choisissez votre abonnement" : "Réinitialiser votre mot de passe"}
          </div>

          {error && <div className="auth-error">⚠️ {error}</div>}
          {success && <div className="auth-success">✅ {success}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {mode === "register" && (
              <>
                {/* Choix du plan */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
                  {Object.entries(STRIPE_PLANS).map(([key, p]) => (
                    <div key={key} onClick={() => setPlan(key)} style={{
                      padding: "14px 12px", borderRadius: 10, cursor: "pointer", textAlign: "center",
                      border: `2px solid ${plan === key ? "var(--gold)" : "var(--border2)"}`,
                      background: plan === key ? "var(--gold3)" : "var(--card2)",
                      transition: "all .15s", position: "relative"
                    }}>
                      {p.badge && (
                        <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "var(--green)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>
                          {p.badge}
                        </div>
                      )}
                      <div style={{ fontFamily: "Syne", fontWeight: 700, fontSize: 14, color: plan === key ? "var(--gold)" : "var(--text)" }}>{p.label}</div>
                      <div style={{ fontFamily: "Syne", fontWeight: 800, fontSize: 20, marginTop: 4 }}>{p.price}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{p.period}</div>
                    </div>
                  ))}
                </div>
                <div className="form-group">
                  <label className="form-label">Nom de la concession</label>
                  <input className="form-input" placeholder="ex: Garage Dupont" value={garageName} onChange={e => setGarageName(e.target.value)} />
                </div>
              </>
            )}
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="contact@mongarage.fr" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handle()} />
            </div>
            {mode !== "reset" && (
              <div className="form-group">
                <label className="form-label">Mot de passe</label>
                <input className="form-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handle()} />
              </div>
            )}
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "12px", marginTop: 4 }}
              onClick={handle} disabled={loading}>
              {loading ? "⏳ Redirection vers le paiement..." : mode === "login" ? "🔓 Se connecter" : mode === "register" ? `💳 Payer ${STRIPE_PLANS[plan].price} et commencer` : "📧 Envoyer le lien"}
            </button>
            {mode === "register" && (
              <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", lineHeight: 1.6 }}>
                Paiement sécurisé par Stripe · Résiliation à tout moment<br />
                En vous abonnant vous acceptez nos <a href="https://iocar.online/cgu" target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>CGU</a>
              </div>
            )}
          </div>

          {mode === "login" && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }} onClick={() => { setMode("reset"); setError(""); setSuccess(""); }}>
                Mot de passe oublié ?
              </span>
            </div>
          )}

          <div className="auth-switch">
            {mode === "login" ? <>Pas encore abonné ? <a onClick={() => { setMode("register"); setError(""); setSuccess(""); }}>S'abonner</a></> :
             mode === "register" ? <>Déjà abonné ? <a onClick={() => { setMode("login"); setError(""); setSuccess(""); }}>Se connecter</a></> :
             <a onClick={() => { setMode("login"); setError(""); setSuccess(""); }}>← Retour à la connexion</a>}
          </div>

          {/* Mode démo */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border2)", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>Vous voulez tester avant de vous abonner ?</div>
            <button className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "center" }}
              onClick={() => onLogin("demo", { id: "demo", email: "demo@iocar.fr" })}>
              👀 Tester en mode démo (limité)
            </button>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 6 }}>2 véhicules · 2 documents · 2 clients — sans sauvegarde</div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ÉCRAN ACCÈS SUSPENDU
═══════════════════════════════════════════════════════════════ */
function SuspendedScreen({ garage, onLogout }) {
  return (
    <>
      <style>{STYLE}</style>
      <div className="auth-wrap">
        <div className="auth-box" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 20 }}>🔒</div>
          <div style={{ fontFamily: "Syne", fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Accès suspendu</div>
          <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, marginBottom: 28 }}>
            L'abonnement de <strong style={{ color: "var(--text)" }}>{garage?.name}</strong> est suspendu.<br />
            Contactez-nous pour réactiver votre accès.
          </div>
          <a href="mailto:contact@iocar.online" className="btn btn-primary" style={{ display: "inline-flex", marginBottom: 16, justifyContent: "center" }}>
            📧 Nous contacter
          </a>
          <br />
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>Se déconnecter</button>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN PAGE — Dashboard garages IO Car
═══════════════════════════════════════════════════════════════ */
function AdminPage({ token }) {
  const [garages, setGarages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [updating, setUpdating] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [backupInfo, setBackupInfo] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [expandedGarage, setExpandedGarage] = useState(null); // garage id pour voir les données
  const [garageData, setGarageData] = useState(null); // { vehicles, orders, clients, livre_police }

  useEffect(() => {
    fetch(`${SUPABASE_URL}/rest/v1/garages?order=created_at.desc`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    })
      .then(r => r.json())
      .then(data => { setGarages(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
    checkBackup();
  }, [token]);

  // Charger les données d'un garage
  const loadGarageData = async (garageId) => {
    if (expandedGarage === garageId) { setExpandedGarage(null); setGarageData(null); return; }
    setExpandedGarage(garageId);
    const tables = ["vehicles", "orders", "clients", "livre_police"];
    const data = {};
    for (const table of tables) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?garage_id=eq.${garageId}&order=created_at.desc`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` } }
      );
      data[table] = r.ok ? await r.json() : [];
    }
    setGarageData(data);
  };

  // Supprimer une entrée d'un garage
  const deleteEntry = async (table, id) => {
    if (!window.confirm("Supprimer cette entrée ? Irréversible.")) return;
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
    setGarageData(prev => ({
      ...prev,
      [table]: prev[table].filter(x => x.id !== id)
    }));
  };

  const checkBackup = async () => {
    try {
      // Lister les fichiers du bucket backups
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/backups`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: "", limit: 10 })
      });
      if (r.ok) {
        const files = await r.json();
        const backup = files.find(f => f.name === "backup_latest.json");
        if (backup) setBackupInfo(backup);
      }
    } catch(e) {}
  };

  const downloadBackup = async () => {
    setBackupLoading(true);
    try {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/backups/backup_latest.json`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
      });
      if (!r.ok) throw new Error("Backup introuvable");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `iocar_backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      alert("Erreur : " + e.message);
    }
    setBackupLoading(false);
  };

  // ── Export complet de toutes les données ──────────────────
  const exportAllData = async () => {
    setExporting(true);
    try {
      const tables = ["vehicles", "orders", "clients", "livre_police"];
      const backup = {
        exported_at: new Date().toISOString(),
        garages: [],
      };

      for (const garage of garages) {
        const garageData = { ...garage, data: {} };
        for (const table of tables) {
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/${table}?garage_id=eq.${garage.id}&order=created_at.asc`,
            { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` } }
          );
          garageData.data[table] = r.ok ? await r.json() : [];
        }
        backup.garages.push(garageData);
      }

      // Télécharger le JSON
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `iocar_backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      alert("Erreur export : " + e.message);
    }
    setExporting(false);
  };

  const [savingBackup, setSavingBackup] = useState(false);

  const runBackup = async () => {
    setSavingBackup(true);
    try {
      const tables = ["vehicles", "orders", "clients", "livre_police"];
      const headers = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` };
      const backup = {
        version: "1.0",
        backup_date: new Date().toISOString(),
        backup_type: "manual",
        total_garages: garages.length,
        garages: []
      };

      for (const garage of garages) {
        const garageData = {
          id: garage.id, name: garage.name, email: garage.email,
          siret: garage.siret, plan: garage.plan, is_active: garage.is_active,
          created_at: garage.created_at, data: {}
        };
        for (const table of tables) {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?garage_id=eq.${garage.id}&order=created_at.asc`, { headers });
          garageData.data[table] = r.ok ? await r.json() : [];
        }
        backup.garages.push(garageData);
      }

      const backupJson = JSON.stringify(backup);

      // Upload dans Supabase Storage — écrase backup_latest.json
      await fetch(`${SUPABASE_URL}/storage/v1/object/backups/backup_latest.json`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "x-upsert": "true" },
        body: backupJson
      });

      // Rafraîchir l'info backup
      await checkBackup();
      alert(`✅ Sauvegarde créée — ${garages.length} garages — ${Math.round(backupJson.length / 1024)} KB`);
    } catch(e) {
      alert("Erreur sauvegarde : " + e.message);
    }
    setSavingBackup(false);
  };

  const toggleActive = async (g) => {
    setUpdating(g.id);
    const newVal = !g.is_active;
    const updated_at = new Date().toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/garages?id=eq.${g.id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ is_active: newVal, updated_at })
    });
    setGarages(garages.map(x => x.id === g.id ? { ...x, is_active: newVal, updated_at } : x));
    setUpdating(null);
  };

  const setPlan = async (g, plan) => {
    setUpdating(g.id);
    const updated_at = new Date().toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/garages?id=eq.${g.id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ plan, updated_at })
    });
    setGarages(garages.map(x => x.id === g.id ? { ...x, plan, updated_at } : x));
    setUpdating(null);
  };

  const ADMIN_LIST = ["johnyjoowls@gmail.com"];

  const filtered = garages.filter(g =>
    !search || `${g.name} ${g.email} ${g.siret}`.toLowerCase().includes(search.toLowerCase())
  );

  // Exclure les comptes admin du MRR
  const payingGarages = garages.filter(g => !ADMIN_LIST.includes(g.email));

  // Calcul plaques supplémentaires ce mois (marge 0,10€ par plaque)
  const monthKey = new Date().toISOString().slice(0, 7);
  const totalPlaquesSupp = payingGarages.reduce((sum, g) => {
    const u = typeof g.api_usage === "string" ? (() => { try { return JSON.parse(g.api_usage); } catch(e) { return {}; } })() : (g.api_usage || {});
    const used = u[monthKey] || 0;
    return sum + Math.max(0, used - 10);
  }, 0);

  const stats = {
    total: payingGarages.length,
    actifs: payingGarages.filter(g => g.is_active).length,
    suspendus: payingGarages.filter(g => !g.is_active).length,
    annual: payingGarages.filter(g => g.plan === "annual").length,
    monthly: payingGarages.filter(g => g.plan === "monthly").length,
    trial: payingGarages.filter(g => !g.plan || g.plan === "trial").length,
  };

  // MRR = abonnements + marge plaques supplémentaires (0,10€/plaque)
  const mrrAbos = (stats.monthly * 24.99) + (stats.annual * (274.89 / 12));
  const mrrPlaques = totalPlaquesSupp * 0.10;
  const mrr = mrrAbos + mrrPlaques;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">🛡 Dashboard Admin</div>
          <div className="page-sub">IO Car — Vue globale des concessions</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={exportAllData} disabled={exporting || loading}
            title="Télécharger un backup JSON de toutes les données">
            {exporting ? "⏳ Export en cours..." : "💾 Exporter toutes les données"}
          </button>
        </div>
      </div>

      {/* Sauvegarde manuelle */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, padding: "12px 16px", background: "var(--card)", border: "1px solid var(--border2)", borderRadius: 10 }}>
        <div style={{ fontSize: 28 }}>🗄️</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Sauvegarde des données</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            Écrase la sauvegarde précédente — à faire régulièrement
          </div>
          {backupInfo ? (
            <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4 }}>
              ✅ Dernière sauvegarde : {new Date(backupInfo.updated_at || backupInfo.created_at).toLocaleString("fr-FR")}
              {backupInfo.size && ` · ${Math.round(backupInfo.size / 1024)} KB`}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--orange)", marginTop: 4 }}>
              ⚠️ Aucune sauvegarde — cliquez sur "Sauvegarder maintenant"
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={runBackup} disabled={savingBackup || loading}>
            {savingBackup ? "⏳ En cours..." : "💾 Sauvegarder"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={downloadBackup} disabled={backupLoading || !backupInfo}>
            {backupLoading ? "⏳" : "⬇️ Télécharger"}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", marginBottom: 28 }}>
        {[
          ["Abonnés", stats.total, "var(--text)"],
          ["Actifs", stats.actifs, "var(--green)"],
          ["Suspendus", stats.suspendus, "var(--red)"],
          ["MRR total", `${fmtDec(mrr)}`, "var(--gold)"],
          ["dont abos", `${fmtDec(mrrAbos)}`, "var(--blue)"],
          ["dont plaques", `${fmtDec(mrrPlaques)}`, "var(--green)"],
          ["Mensuel", stats.monthly, "var(--blue)"],
          ["Annuel", stats.annual, "var(--green)"],
          ["Essai", stats.trial, "var(--muted2)"],
        ].map(([label, val, color]) => (
          <div key={label} className="kpi">
            <div className="kpi-label">{label}</div>
            <div className="kpi-val" style={{ fontSize: 22, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Recherche */}
      <input className="search-input" style={{ marginBottom: 16, width: "100%", maxWidth: 400 }}
        placeholder="Rechercher par nom, email, SIRET..."
        value={search} onChange={e => setSearch(e.target.value)} />

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>Chargement...</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Concession</th>
                <th>Email</th>
                <th>SIRET</th>
                <th>Clé RapidAPI</th>
                <th>Plaques ce mois</th>
                <th>Plaques total</th>
                <th>Plan</th>
                <th>Statut</th>
                <th>Inscrit le</th>
                <th>Dernière MAJ</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>Aucun garage trouvé</td></tr>
              )}
              {filtered.map(g => (
                <React.Fragment key={g.id}>
                <tr>
                  <td style={{ fontWeight: 600 }}>
                    {g.name || "—"}
                    {ADMIN_LIST.includes(g.email) && (
                      <span style={{ marginLeft: 6, fontSize: 9, background: "var(--gold)", color: "#0b0c10", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>ADMIN</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{g.email || "—"}</td>
                  <td style={{ fontFamily: "DM Mono", fontSize: 11 }}>{g.siret || "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        className="form-input"
                        style={{ padding: "3px 8px", fontSize: 10, fontFamily: "DM Mono", width: 160 }}
                        defaultValue={g.rapidapi_key || ""}
                        placeholder="Clé RapidAPI..."
                        onBlur={async e => {
                          const val = e.target.value.trim();
                          if (val === (g.rapidapi_key || "")) return;
                          const updated_at = new Date().toISOString();
                          await fetch(`${SUPABASE_URL}/rest/v1/garages?id=eq.${g.id}`, {
                            method: "PATCH",
                            headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                            body: JSON.stringify({ rapidapi_key: val, updated_at })
                          });
                          setGarages(garages.map(x => x.id === g.id ? { ...x, rapidapi_key: val, updated_at } : x));
                        }}
                      />
                      {g.rapidapi_key && <span style={{ color: "var(--green)", fontSize: 10 }}>✓</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {(() => {
                      const mk = new Date().toISOString().slice(0, 7);
                      const u = typeof g.api_usage === "string" ? JSON.parse(g.api_usage || "{}") : (g.api_usage || {});
                      const mois = u[mk] || 0;
                      return (
                        <span style={{ fontFamily: "DM Mono", fontWeight: 700, color: mois >= 10 ? "var(--orange)" : "var(--text)" }}>
                          {mois}
                          {mois >= 10 && <span style={{ fontSize: 9, color: "var(--orange)", marginLeft: 4 }}>+payant</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {(() => {
                      const u = typeof g.api_usage === "string" ? JSON.parse(g.api_usage || "{}") : (g.api_usage || {});
                      const total = Object.values(u).reduce((s, v) => s + (parseInt(v) || 0), 0);
                      return <span style={{ fontFamily: "DM Mono", fontWeight: 700 }}>{total}</span>;
                    })()}
                  </td>
                  <td>
                    <select
                      className="form-input"
                      style={{ padding: "3px 8px", fontSize: 11, width: "auto" }}
                      value={g.plan || "trial"}
                      onChange={e => setPlan(g, e.target.value)}
                      disabled={updating === g.id || ADMIN_LIST.includes(g.email)}
                    >
                      <option value="trial">Essai</option>
                      <option value="monthly">Mensuel</option>
                      <option value="annual">Annuel</option>
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${g.is_active ? "badge-green" : "badge-red"}`}>
                      {g.is_active ? "✅ Actif" : "⛔ Suspendu"}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>
                    {g.created_at ? new Date(g.created_at).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  <td>
                    {g.updated_at ? (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
                          {new Date(g.updated_at).toLocaleDateString("fr-FR")}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>
                          {new Date(g.updated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    ) : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className={`btn btn-sm ${g.is_active ? "btn-danger" : "btn-primary"}`}
                        onClick={() => toggleActive(g)}
                        disabled={updating === g.id}
                        style={{ fontSize: 11 }}
                      >
                        {updating === g.id ? "..." : g.is_active ? "⛔ Suspendre" : "✅ Activer"}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11 }}
                        title={`Explorer les données de ${g.name || g.email}`}
                        onClick={() => loadGarageData(g.id)}
                      >
                        {expandedGarage === g.id ? "▲ Fermer" : "📂 Données"}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11 }}
                        title={`Exporter les données de ${g.name || g.email}`}
                        onClick={async () => {
                          const tables = ["vehicles", "orders", "clients", "livre_police"];
                          const garageData = { ...g, data: {} };
                          for (const table of tables) {
                            const r = await fetch(
                              `${SUPABASE_URL}/rest/v1/${table}?garage_id=eq.${g.id}&order=created_at.asc`,
                              { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` } }
                            );
                            garageData.data[table] = r.ok ? await r.json() : [];
                          }
                          const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), garage: garageData }, null, 2)], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `iocar_backup_${(g.name || g.email || g.id).replace(/\s/g,"_")}_${new Date().toISOString().slice(0,10)}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        💾
                      </button>
                    </div>
                  </td>
                </tr>
                {/* Données du garage — expandable */}
                {expandedGarage === g.id && garageData && (
                  <tr><td colSpan={11} style={{ padding: 0, background: "var(--card2)" }}>
                    <div style={{ padding: "16px 20px" }}>
                      {["vehicles", "orders", "clients", "livre_police"].map(table => (
                        <div key={table} style={{ marginBottom: 16 }}>
                          <div style={{ fontFamily: "Syne", fontSize: 12, fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                            {table === "vehicles" ? "🚗 Véhicules" : table === "orders" ? "📄 Factures/BC" : table === "clients" ? "👥 Clients" : "📋 Livre de Police"}
                            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400, marginLeft: 8 }}>({garageData[table].length})</span>
                          </div>
                          {garageData[table].length === 0 ? (
                            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>Aucune donnée</div>
                          ) : (
                            <div style={{ maxHeight: 200, overflowY: "auto", borderRadius: 8, border: "1px solid var(--border2)" }}>
                              <table style={{ fontSize: 11 }}>
                                <thead>
                                  <tr>
                                    {table === "vehicles" && <><th>Marque</th><th>Modèle</th><th>Plaque</th><th>Statut</th><th>Action</th></>}
                                    {table === "orders" && <><th>Réf</th><th>Type</th><th>Client</th><th>TTC</th><th>Date</th><th>Action</th></>}
                                    {table === "clients" && <><th>Nom</th><th>Email</th><th>Statut</th><th>Action</th></>}
                                    {table === "livre_police" && <><th>N°</th><th>Marque</th><th>Plaque</th><th>Entrée</th><th>Sortie</th><th>Action</th></>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {garageData[table].map(row => {
                                    const d = row.data || row;
                                    return (
                                      <tr key={row.id}>
                                        {table === "vehicles" && <><td>{d.marque}</td><td>{d.modele}</td><td>{d.plate}</td><td>{d.statut}</td></>}
                                        {table === "orders" && <><td>{d.ref}</td><td>{d.type}</td><td>{d.client?.name}</td><td>{fmtDec(calcOrder(d).ttc)}</td><td>{d.date_creation}</td></>}
                                        {table === "clients" && <><td>{d.prenom} {d.nom}</td><td>{d.email}</td><td>{d.statut}</td></>}
                                        {table === "livre_police" && <><td>{d.num_ordre}</td><td>{d.marque}</td><td>{d.immat}</td><td>{d.date_entree}</td><td>{d.date_sortie || "—"}</td></>}
                                        <td>
                                          <button className="btn btn-danger btn-xs" onClick={() => deleteEntry(table, row.id)}>🗑</button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </td></tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tab, setTab]               = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [token, setToken]           = useState(() => loadSession().token);
  const [user, setUser]             = useState(() => loadSession().user);
  const [garage, setGarage]         = useState(null);
  const [garageReady, setGarageReady] = useState(false);
  const [appLoading, setAppLoading] = useState(true);

  const isRealDemo = token === "demo";

  // ADMIN_EMAILS doit être défini avant les hooks
  const ADMIN_EMAILS = ["johnyjoowls@gmail.com"];
  const isRealAdmin = ADMIN_EMAILS.includes(user?.email);

  // viewMode DOIT être déclaré ici avant tout return conditionnel
  const [viewMode, setViewMode] = useState(
    token === "demo" ? "trial" : ADMIN_EMAILS.includes(loadSession().user?.email) ? "admin" : "subscriber"
  );

  // ── Mode DÉMO : données locales via useStored ─────────────
  const [demoVehicles,    setDemoVehicles,    dvReady]   = useStored("autodeskFleet", []);
  const [demoOrders,      setDemoOrders,      doReady]   = useStored("autodeskOrders", []);
  const [demoClients,     setDemoClients,     dcReady]   = useStored("autodeskClients", []);
  const [demoLivrePolice, setDemoLivrePolice, dlpReady]  = useStored("autodeskLivrePolice", []);
  const [demoDealer,      setDemoDealer,      ddReady]   = useStored("autodeskDealer", {
    name: "AUTO PRESTIGE MOTORS", address: "12 Avenue de la République\n75011 Paris",
    phone: "01 23 45 67 89", email: "contact@autoprestige.fr", siret: "123 456 789 00010"
  });

  // ── Mode SUPABASE : données distantes ─────────────────────
  const userId = isRealDemo ? null : user?.id;
  const [garageId, setGarageId] = useState(null);

  const [vehicles,    setVehicles,    vReady]    = useSupabaseTable(token, garageId, "vehicles");
  const [orders,      setOrders,      oReady]    = useSupabaseTable(token, garageId, "orders");
  const [clients,     setClients,     cReady]    = useSupabaseTable(token, garageId, "clients");
  const [livrePolice, setLivrePolice, lpReady]   = useSupabaseTable(token, garageId, "livre_police");

  // Charger le profil garage (Supabase uniquement)
  useEffect(() => {
    if (isRealDemo) { setGarage(null); setGarageReady(true); setAppLoading(false); return; }
    if (!token || !userId) { setAppLoading(false); setGarageReady(true); return; }
    sb.getGarage(token, userId)
      .then(g => {
        setGarage(g);
        setGarageId(g?.id || null);
        setGarageReady(true);
      })
      .catch(() => setGarageReady(true))
      .finally(() => setAppLoading(false));
  }, [token, userId, isRealDemo]);

  const handleLogin = (tk, u) => {
    setToken(tk); setUser(u);
    if (tk !== "demo") saveSession(tk, u);
  };

  const handleLogout = async () => {
    if (token && !isRealDemo) await sb.signOut(token).catch(() => {});
    clearSession();
    setToken(null); setUser(null); setGarage(null); setGarageId(null);
  };

  const saveDealer = async (data) => {
    if (isRealDemo) { setDemoDealer({ ...demoDealer, ...data }); return; }
    const updated = { ...garage, ...data };
    setGarage(updated);
    if (token && garage?.id) await sb.update(token, "garages", garage.id, data).catch(() => {});
  };

  // Quota API plaque — sauvegardé en localStorage ET dans Supabase
  const monthKey = new Date().toISOString().slice(0, 7);
  const [usage, setUsageLocal] = useState(() => {
    try { return JSON.parse(localStorage.getItem("iocar_usage") || "{}"); } catch(e) { return {}; }
  });

  // Charger api_usage depuis Supabase au login
  useEffect(() => {
    if (isRealDemo || !garage?.api_usage) return;
    try {
      const remote = typeof garage.api_usage === "string" ? JSON.parse(garage.api_usage) : garage.api_usage;
      setUsageLocal(remote);
      localStorage.setItem("iocar_usage", JSON.stringify(remote));
    } catch(e) {}
  }, [garage?.id]);

  const setUsage = (u) => {
    setUsageLocal(u);
    try { localStorage.setItem("iocar_usage", JSON.stringify(u)); } catch(e) {}
    if (!isRealDemo && garageId && token) {
      fetch(`${SUPABASE_URL}/rest/v1/garages?id=eq.${garageId}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ api_usage: u })
      }).catch(() => {});
    }
  };

  // Écoute l'événement "goto register" depuis les modals démo
  useEffect(() => {
    const handler = () => { handleLogout(); };
    window.addEventListener("iocar_goto_register", handler);
    return () => window.removeEventListener("iocar_goto_register", handler);
  }, []);

  // Sync viewMode si login change — DOIT être avant tout return conditionnel
  useEffect(() => {
    if (isRealDemo) setViewMode("trial");
    else if (isRealAdmin) setViewMode("admin");
    else setViewMode("subscriber");
  }, [isRealDemo, isRealAdmin]);

  // ── Écrans d'auth ─────────────────────────────────────────
  if (!token || !user) return <LoginScreen onLogin={handleLogin} />;

  // Loading
  const allReady = isRealDemo
    ? dvReady && doReady && dcReady && dlpReady && ddReady
    : !appLoading && garageReady && vReady && oReady && cReady && lpReady;

  if (!allReady) {
    return (
      <>
        <style>{STYLE}</style>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg)" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 48, height: 48, border: "3px solid var(--border)", borderTopColor: "var(--gold)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 20px" }} />
            <div style={{ color: "var(--muted)", fontSize: 13, letterSpacing: 2 }}>CHARGEMENT...</div>
          </div>
        </div>
      </>
    );
  }

  if (!isRealDemo && !isRealAdmin && garage?.is_active === false)
    return <SuspendedScreen garage={garage} onLogout={handleLogout} />;

  // Sources de données — trial utilise localStorage, les autres Supabase
  const useTrial = viewMode === "trial";
  const activeVehicles    = useTrial ? demoVehicles    : vehicles;
  const activeOrders      = useTrial ? demoOrders      : orders;
  const activeClients     = useTrial ? demoClients      : clients;
  const activeLivrePolice = useTrial ? demoLivrePolice : livrePolice;
  const dealer            = useTrial ? demoDealer      : (garage || {});

  const setVehiclesRaw    = useTrial ? setDemoVehicles    : setVehicles;
  const setOrdersRaw      = useTrial ? setDemoOrders      : setOrders;
  const setClientsRaw     = useTrial ? setDemoClients     : setClients;
  const setLivrePoliceRaw = useTrial ? setDemoLivrePolice : setLivrePolice;
  const setDealerRaw      = saveDealer;

  const navItems = [
    { id: "dashboard",   icon: "📊", label: "Dashboard" },
    { id: "fleet",       icon: "🚗", label: "Flotte" },
    { id: "orders",      icon: "📄", label: "Factures" },
    { id: "crm",         icon: "👥", label: "CRM" },
    { id: "livrepolice", icon: "📋", label: "Police" },
    { id: "settings",    icon: "⚙️", label: "Paramètres" },
    ...(isRealAdmin ? [{ id: "admin", icon: "🛡", label: "Admin IO Car" }] : []),
  ];

  const bottomNavItems = [
    { id: "dashboard",   icon: "📊", label: "Dashboard" },
    { id: "fleet",       icon: "🚗", label: "Flotte" },
    { id: "orders",      icon: "📄", label: "Factures" },
    { id: "crm",         icon: "👥", label: "CRM" },
    { id: "livrepolice", icon: "📋", label: "Police" },
  ];

  const navigate = (id) => { setTab(id); setSidebarOpen(false); };

  // Badge plan
  const planLabel = garage?.is_active === false ? "⛔ Suspendu"
    : garage?.plan === "pro" ? "⭐ Pro"
    : garage?.plan === "starter" ? "✅ Starter"
    : "🔓 Essai";
  const planCls = garage?.is_active === false ? "plan-suspended"
    : garage?.plan === "trial" ? "plan-trial" : "plan-active";

  return (
    <>
      <style>{STYLE}</style>

      {/* ── Hamburger mobile ── */}
      <div className="hamburger" onClick={() => setSidebarOpen(o => !o)}>
        <span style={{ transform: sidebarOpen ? "rotate(45deg) translate(5px,5px)" : "none" }} />
        <span style={{ opacity: sidebarOpen ? 0 : 1, width: sidebarOpen ? 0 : 18 }} />
        <span style={{ transform: sidebarOpen ? "rotate(-45deg) translate(5px,-5px)" : "none" }} />
      </div>

      {/* ── Bannière mode démo ou preview ── */}
      {viewMode === "trial" && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 500,
          background: isRealAdmin
            ? "linear-gradient(90deg, #3a3a3a, #555)"
            : "linear-gradient(90deg, var(--gold), #f0c86a)",
          color: isRealAdmin ? "#fff" : "#0b0c10",
          padding: "8px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 12, fontWeight: 700, gap: 12
        }}>
          <span>{isRealAdmin ? "👁 Prévisualisation — Mode Essai" : `🚀 Mode démo — Limité à ${DEMO_LIMITS.vehicles} véhicules · ${DEMO_LIMITS.orders} documents · ${DEMO_LIMITS.clients} clients`}</span>
          {!isRealAdmin && (
            <button style={{ background: "#0b0c10", color: "var(--gold)", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontWeight: 700, fontSize: 11 }}
              onClick={handleLogout}>S'abonner — 24,99€/mois →</button>
          )}
          {isRealAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => setViewMode("admin")}>← Retour Admin</button>
          )}
        </div>
      )}
      {viewMode === "subscriber" && isRealAdmin && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 500,
          background: "linear-gradient(90deg, var(--blue), #7ab4f0)",
          color: "#fff", padding: "8px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontSize: 12, fontWeight: 700, gap: 12
        }}>
          <span>👁 Prévisualisation — Mode Abonné</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setViewMode("admin")}>← Retour Admin</button>
        </div>
      )}

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* ══ MODE ADMIN — Interface directe sans sidebar ══ */}
      {viewMode === "admin" ? (
        <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
          {/* Header admin */}
          <div style={{
            position: "sticky", top: 0, zIndex: 100,
            background: "var(--card)", borderBottom: "1px solid var(--border2)",
            padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne", fontWeight: 800, fontSize: 12, color: "#0b0c10" }}>IO</div>
              <div style={{ fontFamily: "Syne", fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>IO <span style={{ color: "var(--gold)" }}>Car</span> <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "DM Sans" }}>— Admin</span></div>
            </div>
            {/* Sélecteur de vue */}
            <div style={{ display: "flex", gap: 4, background: "var(--card2)", borderRadius: 8, padding: 4 }}>
              {[
                { mode: "admin",      label: "🛡 Admin",   color: "var(--gold)" },
                { mode: "subscriber", label: "✅ Abonné",  color: "var(--green)" },
                { mode: "trial",      label: "👁 Essai",   color: "var(--muted2)" },
              ].map(({ mode, label, color }) => (
                <div key={mode} onClick={() => { setViewMode(mode); setTab("dashboard"); }} style={{
                  padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700,
                  background: viewMode === mode ? "var(--card3)" : "transparent",
                  color: viewMode === mode ? color : "var(--muted)",
                  border: viewMode === mode ? `1px solid ${color}30` : "1px solid transparent",
                  transition: "all .15s"
                }}>{label}</div>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>🚪 Déconnexion</button>
          </div>
          {/* Contenu admin — dashboard OU accès aux données des garages */}
          <AdminPage token={token} />
        </div>

      ) : (
        /* ══ MODE ABONNÉ / ESSAI — Interface normale avec sidebar ══ */
        <div className="shell">
          <aside className={`sidebar${sidebarOpen ? " open" : ""}${(viewMode === "trial" || viewMode === "subscriber") ? " demo-pushed" : ""}`}>
            <div className="sidebar-logo">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Syne", fontWeight: 800, fontSize: 13, color: "#0b0c10", letterSpacing: 1, flexShrink: 0 }}>IO</div>
                <div>
                  <div style={{ fontFamily: "Syne", fontWeight: 800, fontSize: 16, letterSpacing: 2, color: "var(--text)", lineHeight: 1 }}>IO <span style={{ color: "var(--gold)" }}>Car</span></div>
                  <div style={{ fontSize: 8, letterSpacing: 2, color: "var(--muted)", textTransform: "uppercase", marginTop: 3 }}>by OWL'S INDUSTRY</div>
                </div>
              </div>
            </div>

            {/* Sélecteur vue preview (admin uniquement) */}
            {isRealAdmin && (
              <div style={{ padding: "12px 12px 0" }}>
                <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted)", padding: "0 8px", marginBottom: 8 }}>Vue prévisualisation</div>
                <div style={{ display: "flex", gap: 4, background: "var(--card2)", borderRadius: 8, padding: 4 }}>
                  {[
                    { mode: "admin",      label: "🛡 Admin",   color: "var(--gold)" },
                    { mode: "subscriber", label: "✅ Abonné",  color: "var(--green)" },
                    { mode: "trial",      label: "👁 Essai",   color: "var(--muted2)" },
                  ].map(({ mode, label, color }) => (
                    <div key={mode} onClick={() => { setViewMode(mode); if (mode === "admin") setTab("dashboard"); }} style={{
                      flex: 1, textAlign: "center", padding: "5px 4px",
                      borderRadius: 6, cursor: "pointer", fontSize: 10, fontWeight: 700,
                      background: viewMode === mode ? "var(--card3)" : "transparent",
                      color: viewMode === mode ? color : "var(--muted)",
                      border: viewMode === mode ? `1px solid ${color}30` : "1px solid transparent",
                      transition: "all .15s"
                    }}>{label}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="nav-section">
              <div className="nav-label">Navigation</div>
              {navItems.filter(n => n.id !== "admin").map(n => (
                <div key={n.id} className={`nav-item${tab === n.id ? " active" : ""}`} onClick={() => navigate(n.id)}>
                  <span className="nav-icon">{n.icon}</span>
                  {n.label}
                </div>
              ))}
            </div>

            <div style={{ padding: "8px 12px" }}>
              <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted)", padding: "0 8px", marginBottom: 8 }}>Stats rapides</div>
              <div style={{ background: "var(--card2)", borderRadius: 8, padding: "12px 14px" }}>
                {(() => {
                  const used = usage?.[new Date().toISOString().slice(0,7)] || 0;
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border2)" }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>🔍 {viewMode === "admin" ? "Plaques ce mois" : "Plaques restantes"}</span>
                      {viewMode === "admin" ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>{used} <span style={{ fontSize: 10, color: "var(--muted)" }}>/ ∞</span></span>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 700, color: used < 10 ? "var(--green)" : "var(--red)" }}>{Math.max(0, 10 - used)}/10</span>
                      )}
                    </div>
                  );
                })()}
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>🚗 En stock</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{activeVehicles.filter(v => v.statut === "disponible").length}</span>
                </div>
              </div>
            </div>

            <div className="sidebar-footer">
              {dealer.logo && (
                <div style={{ marginBottom: 10, textAlign: "center" }}>
                  <img src={dealer.logo} alt="Logo" style={{ maxHeight: 56, maxWidth: "100%", objectFit: "contain", mixBlendMode: dealer.logoBlend || "normal", filter: dealer.logoInvert ? "invert(1)" : "none" }} />
                </div>
              )}
              <div className="dealer-info">
                <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 12, marginBottom: 3 }}>{dealer.name || "Ma Concession"}</div>
                <div>{dealer.address?.split("\n")[0]}</div>
                <div style={{ marginTop: 4 }}><span className={`plan-badge ${planCls}`}>{planLabel}</span></div>
              </div>
              <button className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} onClick={handleLogout}>
                🚪 Déconnexion
              </button>
            </div>
          </aside>

          <main className={`content${(viewMode === "trial" || viewMode === "subscriber") ? " demo-offset" : ""}`}>
            {tab === "dashboard"   && <Dashboard vehicles={activeVehicles} setVehicles={setVehiclesRaw} orders={activeOrders} setTab={setTab} apiKey={dealer.rapidapi_key} usage={usage} setUsage={setUsage} />}
            {tab === "fleet"       && <FleetPage vehicles={activeVehicles} setVehicles={setVehiclesRaw} apiKey={dealer.rapidapi_key} usage={usage} setUsage={setUsage} livrePolice={activeLivrePolice} setLivrePolice={setLivrePoliceRaw} viewMode={viewMode} garageId={garageId} />}
            {tab === "orders"      && <OrdersPage orders={activeOrders} setOrders={setOrdersRaw} vehicles={activeVehicles} setVehiclesRaw={setVehiclesRaw} dealer={dealer} apiKey={dealer.rapidapi_key} usage={usage} setUsage={setUsage} clients={activeClients} setClients={setClientsRaw} viewMode={viewMode} />}
            {tab === "crm"         && <CrmPage clients={activeClients} setClients={setClientsRaw} orders={activeOrders} viewMode={viewMode} />}
            {tab === "livrepolice" && (viewMode === "trial" ? (
              <div className="page" style={{ textAlign: "center", paddingTop: 80 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
                <div style={{ fontFamily: "Syne", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Livre de Police</div>
                <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 24 }}>Disponible avec un abonnement IO Car.</div>
                <button className="btn btn-primary" onClick={handleLogout}>🚀 S'abonner — 24,99€/mois</button>
              </div>
            ) : <LivreDePolice vehicles={activeVehicles} livrePolice={activeLivrePolice} setLivrePolice={setLivrePoliceRaw} dealer={dealer} viewMode={viewMode} />)}
            {tab === "settings"    && <SettingsPage dealer={dealer} setDealer={setDealerRaw} usage={usage} />}
          </main>
        </div>
      )}

      {/* Bottom nav mobile — uniquement en mode preview */}
      {viewMode !== "admin" && (
        <nav className="bottom-nav">
          {bottomNavItems.map(n => (
            <div key={n.id} className={`bottom-nav-item${tab === n.id ? " active" : ""}`} onClick={() => navigate(n.id)}>
              <span className="bn-icon">{n.icon}</span>
              <span>{n.label}</span>
            </div>
          ))}
        </nav>
      )}
    </>
  );
}
