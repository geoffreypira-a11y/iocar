// ═══════════════════════════════════════════════════════════════
//  AGENDA — réglages : équipe et horaires, types de RDV, affichage
// ═══════════════════════════════════════════════════════════════
import React, { useEffect, useState } from "react";
import { COULEURS, JOURS_LONGS, PREFS_PAR_DEFAUT, fmtDateLongue, heureHHMM } from "./agendaUtils.js";
import { Fenetre, Alerte } from "./AgendaModals.jsx";

const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

function Pastilles({ valeur, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {COULEURS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c} aria-label={`Couleur ${c}`}
          style={{ width: 20, height: 20, borderRadius: 5, background: c, cursor: "pointer",
            border: valeur === c ? "2px solid var(--text)" : "2px solid transparent" }} />
      ))}
    </div>
  );
}

export function AgendaSettings({ api, staff, schedules, types, prefs, dealer, setDealer, onChanged, onClose }) {
  const [onglet, setOnglet] = useState("equipe");
  const [erreur, setErreur] = useState("");
  const action = async (fn) => {
    setErreur("");
    try { await fn(); await onChanged(); }
    catch (e) { setErreur(e.message); }
  };

  return (
    <Fenetre titre="Réglages de l'agenda" onClose={onClose} large
      pied={<button className="btn btn-primary" onClick={onClose}>Terminé</button>}>
      <div style={{ display: "inline-flex", background: "var(--card2)", border: "1px solid var(--border2)", borderRadius: 8, padding: 3, gap: 2, marginBottom: 16, flexWrap: "wrap" }}>
        {[["equipe", "👥 Équipe & horaires"], ["types", "🏷 Types de RDV"], ["affichage", "🕑 Affichage"]].map(([k, l]) => (
          <button key={k} onClick={() => setOnglet(k)} style={{
            padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", cursor: "pointer",
            background: onglet === k ? "var(--gold)" : "transparent", color: onglet === k ? "#0a0a0a" : "var(--muted)",
          }}>{l}</button>
        ))}
      </div>
      {erreur && <Alerte couleur="var(--red)">{erreur}</Alerte>}
      {onglet === "equipe" && <Equipe api={api} staff={staff} schedules={schedules} action={action} />}
      {onglet === "types" && <Types api={api} types={types} action={action} />}
      {onglet === "affichage" && <Affichage prefs={prefs} dealer={dealer} setDealer={setDealer} />}
    </Fenetre>
  );
}

// ─── Équipe ───────────────────────────────────────────────────
function Equipe({ api, staff, schedules, action }) {
  const [nom, setNom] = useState("");
  const [couleur, setCouleur] = useState(COULEURS[staff.length % COULEURS.length]);
  const [ouvert, setOuvert] = useState(null);

  const ajouter = () => {
    if (!nom.trim()) return;
    action(async () => {
      await api.insert("agenda_staff", { name: nom.trim(), color: couleur, sort_order: staff.length });
      setNom(""); setCouleur(COULEURS[(staff.length + 1) % COULEURS.length]);
    });
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Chaque membre de l'équipe a sa couleur dans l'agenda. Sans horaires saisis, il est considéré disponible tous les jours.
      </div>
      {staff.map(s => (
        <LigneCollaborateur key={s.id} api={api} s={s} schedules={schedules.filter(h => h.staff_id === s.id)}
          ouvert={ouvert === s.id} onToggle={() => setOuvert(ouvert === s.id ? null : s.id)} action={action} />
      ))}
      <div className="card" style={{ padding: 12, marginTop: 12, background: "var(--card2)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Ajouter un collaborateur</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input className="form-input" style={{ flex: 1, minWidth: 160 }} placeholder="Prénom Nom" value={nom}
            onChange={e => setNom(e.target.value)} onKeyDown={e => e.key === "Enter" && ajouter()} />
          <Pastilles valeur={couleur} onChange={setCouleur} />
          <button className="btn btn-primary btn-sm" onClick={ajouter} disabled={!nom.trim()}>+ Ajouter</button>
        </div>
      </div>
    </div>
  );
}

function LigneCollaborateur({ api, s, schedules, ouvert, onToggle, action }) {
  const [nom, setNom] = useState(s.name);
  useEffect(() => setNom(s.name), [s.name]);

  const supprimer = () => {
    if (!window.confirm(`Supprimer ${s.name} ?\n\nSes rendez-vous sont conservés, sans collaborateur. Ses horaires et absences sont supprimés.\nPour le retirer sans rien effacer, désactivez-le plutôt.`)) return;
    action(() => api.remove("agenda_staff", s.id));
  };

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8, opacity: s.active === false ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, background: s.color, flexShrink: 0 }} />
        <input className="form-input" style={{ flex: 1, minWidth: 140 }} value={nom} onChange={e => setNom(e.target.value)}
          onBlur={() => nom.trim() && nom.trim() !== s.name && action(() => api.update("agenda_staff", s.id, { name: nom.trim() }))} />
        <Pastilles valeur={s.color} onChange={c => action(() => api.update("agenda_staff", s.id, { color: c }))} />
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={s.active !== false} onChange={e => action(() => api.update("agenda_staff", s.id, { active: e.target.checked }))} />
          Actif
        </label>
        <button className="btn btn-ghost btn-sm" onClick={onToggle}>{ouvert ? "▲" : "▼"} Horaires & absences</button>
        <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={supprimer} title="Supprimer">🗑</button>
      </div>
      {ouvert && <>
        <Horaires api={api} staffId={s.id} schedules={schedules} action={action} />
        <AbsencesAVenir api={api} staffId={s.id} action={action} />
      </>}
    </div>
  );
}

function Horaires({ api, staffId, schedules, action }) {
  const initial = () => JOURS_LONGS.map((_, j) => {
    const h = schedules.find(x => x.day_of_week === j);
    return h
      ? { on: true, debut: hhmm(h.start_time), fin: hhmm(h.end_time), pd: hhmm(h.break_start), pf: hhmm(h.break_end) }
      : { on: false, debut: "09:00", fin: "19:00", pd: "12:00", pf: "14:00" };
  });
  const [jours, setJours] = useState(initial);
  const [msg, setMsg] = useState("");
  const set = (j, k, v) => setJours(js => js.map((x, i) => i === j ? { ...x, [k]: v } : x));

  const enregistrer = () => {
    setMsg("");
    for (let j = 0; j < 7; j++) {
      const x = jours[j];
      if (!x.on) continue;
      if (!x.debut || !x.fin || x.fin <= x.debut) { setMsg(`${JOURS_LONGS[j]} : la fin doit être après le début.`); return; }
      if ((x.pd && !x.pf) || (!x.pd && x.pf)) { setMsg(`${JOURS_LONGS[j]} : indiquez le début et la fin de la pause, ou aucun des deux.`); return; }
      if (x.pd && x.pf && (x.pf <= x.pd || x.pd < x.debut || x.pf > x.fin)) { setMsg(`${JOURS_LONGS[j]} : la pause doit tenir dans les horaires.`); return; }
    }
    action(async () => {
      await api.removeWhere("agenda_schedules", `staff_id=eq.${staffId}`);
      const lignes = jours.map((x, j) => x.on ? {
        staff_id: staffId, day_of_week: j, start_time: x.debut, end_time: x.fin,
        break_start: x.pd || null, break_end: x.pf || null,
      } : null).filter(Boolean);
      if (lignes.length) await api.insert("agenda_schedules", lignes);
      setMsg("✅ Horaires enregistrés.");
    });
  };

  const champ = { padding: "4px 6px", fontSize: 12, width: 110 };
  return (
    <div style={{ marginTop: 12, overflowX: "auto" }}>
      <table style={{ fontSize: 12, minWidth: 520 }}>
        <thead><tr><th style={{ textAlign: "left" }}>Jour</th><th>Début</th><th>Fin</th><th>Pause de</th><th>à</th></tr></thead>
        <tbody>
          {jours.map((x, j) => (
            <tr key={j}>
              <td>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={x.on} onChange={e => set(j, "on", e.target.checked)} />
                  {JOURS_LONGS[j]}
                </label>
              </td>
              {x.on ? <>
                <td><input className="form-input" style={champ} type="time" value={x.debut} onChange={e => set(j, "debut", e.target.value)} /></td>
                <td><input className="form-input" style={champ} type="time" value={x.fin} onChange={e => set(j, "fin", e.target.value)} /></td>
                <td><input className="form-input" style={champ} type="time" value={x.pd} onChange={e => set(j, "pd", e.target.value)} /></td>
                <td><input className="form-input" style={champ} type="time" value={x.pf} onChange={e => set(j, "pf", e.target.value)} /></td>
              </> : <td colSpan={4} style={{ color: "var(--muted)" }}>Ne travaille pas</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={enregistrer}>Enregistrer les horaires</button>
        {msg && <span style={{ fontSize: 12, color: msg.startsWith("✅") ? "var(--green)" : "var(--red)" }}>{msg}</span>}
      </div>
    </div>
  );
}

function AbsencesAVenir({ api, staffId, action }) {
  const [liste, setListe] = useState(null);
  const charger = () => api.list("agenda_time_off", `staff_id=eq.${staffId}&ends_at=gt.${encodeURIComponent(new Date().toISOString())}`, "starts_at")
    .then(r => setListe(r || [])).catch(() => setListe([]));
  useEffect(() => { charger(); }, [staffId]);
  if (!liste) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Absences à venir</div>
      {liste.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Aucune. Utilisez « ⛔ Bloquer » dans l'agenda pour en ajouter.</div>
      ) : liste.map(o => {
        const d = new Date(o.starts_at), f = new Date(o.ends_at);
        const dernierJour = new Date(f.getTime() - 1);
        return (
          <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "4px 0" }}>
            <span style={{ flex: 1 }}>
              {o.all_day
                ? (d.toDateString() === dernierJour.toDateString() ? fmtDateLongue(d) : `Du ${fmtDateLongue(d)} au ${fmtDateLongue(dernierJour)}`)
                : `${fmtDateLongue(d)} · ${heureHHMM(d)}–${heureHHMM(f)}`}
              {o.reason ? ` · ${o.reason}` : ""}
            </span>
            <button className="btn btn-ghost btn-xs" style={{ color: "var(--red)" }}
              onClick={() => window.confirm("Supprimer cette absence ?") && action(async () => { await api.remove("agenda_time_off", o.id); await charger(); })}>🗑</button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Types de RDV ─────────────────────────────────────────────
function Types({ api, types, action }) {
  const [nouveau, setNouveau] = useState({ label: "", color: COULEURS[types.length % COULEURS.length], duration_minutes: 30 });

  const deplacer = (i, sens) => {
    const j = i + sens;
    if (j < 0 || j >= types.length) return;
    action(async () => {
      await api.update("agenda_types", types[i].id, { sort_order: j });
      await api.update("agenda_types", types[j].id, { sort_order: i });
    });
  };
  const ajouter = () => {
    const label = nouveau.label.trim();
    if (!label) return;
    if (types.some(t => t.label.toLowerCase() === label.toLowerCase())) { alert("Ce type existe déjà."); return; }
    action(async () => {
      await api.insert("agenda_types", { ...nouveau, label, sort_order: types.length });
      setNouveau({ label: "", color: COULEURS[(types.length + 1) % COULEURS.length], duration_minutes: 30 });
    });
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
        La durée est proposée par défaut à la création d'un RDV. Supprimer un type ne modifie pas les rendez-vous déjà pris.
      </div>
      {types.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Aucun type. Ajoutez-en ci-dessous.</div>}
      {types.map((t, i) => (
        <LigneType key={t.id} api={api} t={t} premier={i === 0} dernier={i === types.length - 1}
          onMonter={() => deplacer(i, -1)} onDescendre={() => deplacer(i, 1)} action={action} />
      ))}
      <div className="card" style={{ padding: 12, marginTop: 12, background: "var(--card2)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Ajouter un type</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input className="form-input" style={{ flex: 1, minWidth: 160 }} placeholder="Ex. : Contrôle technique" value={nouveau.label}
            onChange={e => setNouveau(n => ({ ...n, label: e.target.value }))} onKeyDown={e => e.key === "Enter" && ajouter()} />
          <input className="form-input" type="number" min={5} max={720} step={5} style={{ width: 80 }} value={nouveau.duration_minutes}
            onChange={e => setNouveau(n => ({ ...n, duration_minutes: parseInt(e.target.value, 10) || 30 }))} title="Durée (min)" />
          <span style={{ fontSize: 12, color: "var(--muted)" }}>min</span>
          <Pastilles valeur={nouveau.color} onChange={c => setNouveau(n => ({ ...n, color: c }))} />
          <button className="btn btn-primary btn-sm" onClick={ajouter} disabled={!nouveau.label.trim()}>+ Ajouter</button>
        </div>
      </div>
    </div>
  );
}

function LigneType({ api, t, premier, dernier, onMonter, onDescendre, action }) {
  const [label, setLabel] = useState(t.label);
  const [duree, setDuree] = useState(t.duration_minutes);
  useEffect(() => { setLabel(t.label); setDuree(t.duration_minutes); }, [t.label, t.duration_minutes]);
  return (
    <div className="card" style={{ padding: 10, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ width: 12, height: 12, borderRadius: "50%", background: t.color, flexShrink: 0 }} />
      <input className="form-input" style={{ flex: 1, minWidth: 140 }} value={label} onChange={e => setLabel(e.target.value)}
        onBlur={() => label.trim() && label.trim() !== t.label && action(() => api.update("agenda_types", t.id, { label: label.trim() }))} />
      <input className="form-input" type="number" min={5} max={720} step={5} style={{ width: 80 }} value={duree}
        onChange={e => setDuree(e.target.value)}
        onBlur={() => { const d = parseInt(duree, 10); if (d >= 5 && d !== t.duration_minutes) action(() => api.update("agenda_types", t.id, { duration_minutes: d })); }} />
      <span style={{ fontSize: 12, color: "var(--muted)" }}>min</span>
      <Pastilles valeur={t.color} onChange={c => action(() => api.update("agenda_types", t.id, { color: c }))} />
      <button className="btn btn-ghost btn-xs" disabled={premier} onClick={onMonter} title="Monter">↑</button>
      <button className="btn btn-ghost btn-xs" disabled={dernier} onClick={onDescendre} title="Descendre">↓</button>
      <button className="btn btn-ghost btn-xs" style={{ color: "var(--red)" }} title="Supprimer"
        onClick={() => window.confirm(`Supprimer le type « ${t.label} » ?\n\nLes rendez-vous déjà pris gardent leur libellé.`) && action(() => api.remove("agenda_types", t.id))}>🗑</button>
    </div>
  );
}

// ─── Affichage ────────────────────────────────────────────────
function Affichage({ prefs, dealer, setDealer }) {
  const [p, setP] = useState({ start_hour: prefs.start_hour, end_hour: prefs.end_hour, buffer_min: prefs.buffer_min });
  const [msg, setMsg] = useState("");
  const heures = Array.from({ length: 25 }, (_, h) => h);
  const enregistrer = async () => {
    if (p.end_hour <= p.start_hour) { setMsg("L'heure de fin doit être après l'heure de début."); return; }
    const ui = dealer?.ui_prefs || {};
    await setDealer({ ...dealer, ui_prefs: { ...ui, agenda: { ...(ui.agenda || {}), ...p } } });
    setMsg("✅ Enregistré.");
  };
  return (
    <div className="form-grid">
      <div className="form-group">
        <label className="form-label">Grille : début</label>
        <select className="form-input" value={p.start_hour} onChange={e => setP(x => ({ ...x, start_hour: parseInt(e.target.value, 10) }))}>
          {heures.slice(0, 24).map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Grille : fin</label>
        <select className="form-input" value={p.end_hour} onChange={e => setP(x => ({ ...x, end_hour: parseInt(e.target.value, 10) }))}>
          {heures.slice(1).map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
        </select>
      </div>
      <div className="form-group full">
        <label className="form-label">Marge entre deux RDV d'un même collaborateur</label>
        <select className="form-input" value={p.buffer_min} onChange={e => setP(x => ({ ...x, buffer_min: parseInt(e.target.value, 10) }))}>
          {[0, 5, 10, 15, 20, 30].map(m => <option key={m} value={m}>{m === 0 ? "Aucune" : `${m} min`}</option>)}
        </select>
      </div>
      <div className="form-group full" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn btn-primary btn-sm" onClick={enregistrer}>Enregistrer</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setP({ ...PREFS_PAR_DEFAUT })}>Valeurs par défaut</button>
        {msg && <span style={{ fontSize: 12, color: msg.startsWith("✅") ? "var(--green)" : "var(--red)" }}>{msg}</span>}
      </div>
    </div>
  );
}
