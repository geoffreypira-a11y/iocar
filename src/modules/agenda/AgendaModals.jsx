// ═══════════════════════════════════════════════════════════════
//  AGENDA — fenêtres : rendez-vous (création / modification) et blocage
// ═══════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from "react";
import {
  STATUTS, LIBERE_CRENEAU, COULEURS, dateISO, heureHHMM, composer, ajouterJours, debutJour,
  conflits, prochainCreneauLibre, travaille, telNormalise, fmtDateLongue,
} from "./agendaUtils.js";

const AUTRE = "__autre__";
const DUREES = [15, 30, 45, 60, 90, 120, 180, 240];

function Fenetre({ titre, onClose, children, pied, large }) {
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${large ? "modal-lg" : "modal-md"}`} onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <span className="modal-title">{titre}</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {pied && <div className="modal-foot" style={{ flexWrap: "wrap", gap: 8 }}>{pied}</div>}
      </div>
    </div>
  );
}

function Alerte({ couleur = "var(--orange)", children }) {
  return (
    <div style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12, marginTop: 10, lineHeight: 1.5,
      background: "rgba(229,151,60,.08)", border: `1px solid ${couleur}`, color: couleur }}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  RENDEZ-VOUS
// ═══════════════════════════════════════════════════════════════
export function AppointmentModal({ api, mode, appt, start, staffIdInitial, staff, tousStaff, types, schedules, prefs, onClose, onSaved }) {
  const edition = mode === "edit";
  const debutInitial = edition ? new Date(appt.starts_at) : start;
  const dureeInitiale = edition
    ? Math.round((new Date(appt.ends_at) - new Date(appt.starts_at)) / 60000)
    : (types[0]?.duration_minutes || 30);

  // Type : choisi dans la liste, ou écrit à la main.
  const typeConnu = edition ? types.find(t => t.label === appt.type_label) : types[0];
  const [typeChoix, setTypeChoix] = useState(
    edition ? (appt.type_label ? (typeConnu ? typeConnu.id : AUTRE) : "") : (types[0]?.id || "")
  );
  const [typeLibre, setTypeLibre] = useState(edition && !typeConnu ? (appt.type_label || "") : "");
  const [ajouterALaListe, setAjouterALaListe] = useState(false);

  const [form, setForm] = useState({
    staff_id: edition ? (appt.staff_id || "") : (staffIdInitial || ""),
    date: dateISO(debutInitial),
    heure: heureHHMM(debutInitial),
    duree: dureeInitiale,
    client_name: edition ? (appt.client_name || "") : "",
    client_phone: edition ? (appt.client_phone || "") : "",
    vehicle: edition ? (appt.vehicle || "") : "",
    notes: edition ? (appt.notes || "") : "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  // Un RDV terminé ne se déplace plus : seuls la note et le statut bougent.
  const passe = edition && new Date(appt.ends_at) < new Date();
  const statut = edition ? appt.status : "planned";

  // RDV et absences du jour choisi, pour les contrôles (rechargés si la date change).
  const [duJour, setDuJour] = useState({ rdvs: [], absences: [] });
  useEffect(() => {
    let annule = false;
    const d = composer(form.date, "00:00");
    Promise.all([api.appointmentsBetween(d, ajouterJours(d, 1)), api.timeOffBetween(d, ajouterJours(d, 1))])
      .then(([r, o]) => { if (!annule) setDuJour({ rdvs: r || [], absences: o || [] }); })
      .catch(() => {});
    return () => { annule = true; };
  }, [api, form.date]);

  // RDV à venir, pour repérer un client qui en a déjà un.
  const [aVenir, setAVenir] = useState([]);
  useEffect(() => { api.upcomingAppointments().then(r => setAVenir(r || [])).catch(() => {}); }, [api]);

  const choisirType = (id) => {
    setTypeChoix(id);
    const t = types.find(x => x.id === id);
    if (t && !edition) set("duree", t.duration_minutes || 30);
  };

  const debut = form.date && form.heure ? composer(form.date, form.heure) : null;
  const fin = debut ? new Date(debut.getTime() + (parseInt(form.duree, 10) || 30) * 60000) : null;
  const ignorerId = edition ? appt.id : null;
  const nomStaff = (id) => (tousStaff.find(s => s.id === id)?.name) || "";

  const controle = useMemo(() => {
    if (!debut || !fin || LIBERE_CRENEAU.includes(statut)) return {};
    const res = {};
    if (form.staff_id) {
      const abs = duJour.absences.find(o => o.staff_id === form.staff_id
        && new Date(o.starts_at) < fin && new Date(o.ends_at) > debut);
      if (abs) res.absence = abs;
      if (!travaille(form.staff_id, debut, debut.getHours() * 60 + debut.getMinutes(), schedules)) res.horsHoraires = true;
    }
    const c = form.staff_id ? conflits(duJour.rdvs, form.staff_id, debut, fin, prefs.buffer_min, ignorerId) : [];
    if (c.length) {
      res.chevauchement = c;
      res.suivant = prochainCreneauLibre(duJour.rdvs, duJour.absences, form.staff_id, debut,
        parseInt(form.duree, 10) || 30, prefs.buffer_min, ignorerId, prefs.end_hour);
    }
    return res;
  }, [debut?.getTime(), fin?.getTime(), form.staff_id, duJour, schedules, prefs, statut, ignorerId]);

  const autresRdvClient = useMemo(() => {
    const t = telNormalise(form.client_phone);
    if (t.length < 8) return [];
    return aVenir.filter(a => a.id !== ignorerId && telNormalise(a.client_phone) === t);
  }, [form.client_phone, aVenir, ignorerId]);

  async function enregistrer() {
    setErreur("");
    if (!form.client_name.trim()) { setErreur("Indiquez le nom du client."); return; }
    if (!debut) { setErreur("Indiquez la date et l'heure."); return; }
    if (!edition && debut.getTime() < Date.now() - 60000) {
      setErreur("Impossible de créer un rendez-vous dans le passé."); return;
    }
    if (controle.absence) { setErreur(`${nomStaff(form.staff_id)} est absent sur ce créneau.`); return; }
    if (controle.chevauchement) { setErreur(`${nomStaff(form.staff_id)} a déjà un rendez-vous sur ce créneau.`); return; }

    let typeLabel = null, typeColor = null;
    let typesChanges = false;
    if (typeChoix === AUTRE) {
      typeLabel = typeLibre.trim() || null;
      typeColor = "#64748b";
    } else if (typeChoix) {
      const t = types.find(x => x.id === typeChoix);
      typeLabel = t?.label || null; typeColor = t?.color || null;
    }
    setEnCours(true);
    try {
      if (typeChoix === AUTRE && typeLabel && ajouterALaListe) {
        const deja = types.find(t => t.label.toLowerCase() === typeLabel.toLowerCase());
        if (deja) { typeColor = deja.color; }
        else {
          typeColor = COULEURS[types.length % COULEURS.length];
          await api.insert("agenda_types", {
            label: typeLabel, color: typeColor, duration_minutes: parseInt(form.duree, 10) || 30,
            sort_order: types.length,
          });
          typesChanges = true;
        }
      }
      const valeurs = {
        staff_id: form.staff_id || null,
        starts_at: debut.toISOString(),
        ends_at: fin.toISOString(),
        type_label: typeLabel, type_color: typeColor,
        client_name: form.client_name.trim(),
        client_phone: form.client_phone.trim() || null,
        vehicle: form.vehicle.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (edition) await api.update("agenda_appointments", appt.id, valeurs);
      else await api.insert("agenda_appointments", { ...valeurs, status: "planned" });
      await onSaved({ typesChanges });
    } catch (e) { setErreur(e.message); setEnCours(false); }
  }

  async function changerStatut(nouveau) {
    if (nouveau === "canceled" && !window.confirm("Annuler ce rendez-vous ?")) return;
    setEnCours(true); setErreur("");
    try {
      await api.update("agenda_appointments", appt.id, {
        status: nouveau,
        canceled_at: nouveau === "canceled" ? new Date().toISOString() : null,
        ...(passe ? { notes: form.notes.trim() || null } : {}),
      });
      await onSaved();
    } catch (e) { setErreur(e.message); setEnCours(false); }
  }

  async function supprimer() {
    if (!window.confirm("Supprimer définitivement ce rendez-vous ?")) return;
    setEnCours(true);
    try { await api.remove("agenda_appointments", appt.id); await onSaved(); }
    catch (e) { setErreur(e.message); setEnCours(false); }
  }

  async function enregistrerNote() {
    setEnCours(true); setErreur("");
    try { await api.update("agenda_appointments", appt.id, { notes: form.notes.trim() || null }); await onSaved(); }
    catch (e) { setErreur(e.message); setEnCours(false); }
  }

  const verrou = passe;
  const libere = LIBERE_CRENEAU.includes(statut);

  const boutonsStatut = edition ? [
    statut === "planned" && ["confirmed", "✓ Confirmer"],
    ["planned", "confirmed"].includes(statut) && ["arrived", "👋 Arrivé"],
    ["planned", "confirmed", "arrived"].includes(statut) && ["done", "✅ Honoré"],
    ["planned", "confirmed"].includes(statut) && ["no_show", "🚫 Absent"],
    !libere && statut !== "done" && ["canceled", "Annuler le RDV"],
    libere && !passe && ["planned", "↩ Rétablir"],
  ].filter(Boolean) : [];

  return (
    <Fenetre
      titre={edition ? "Rendez-vous" : "Nouveau rendez-vous"}
      onClose={onClose}
      pied={<>
        {edition && <button className="btn btn-ghost" style={{ color: "var(--red)", marginRight: "auto" }} onClick={supprimer} disabled={enCours}>🗑 Supprimer</button>}
        <button className="btn btn-ghost" onClick={onClose} disabled={enCours}>Fermer</button>
        {verrou
          ? <button className="btn btn-primary" onClick={enregistrerNote} disabled={enCours}>Enregistrer la note</button>
          : <button className="btn btn-primary" onClick={enregistrer} disabled={enCours || !!controle.absence || !!controle.chevauchement}
              style={controle.absence || controle.chevauchement ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>
              {enCours ? "…" : "✅ Enregistrer"}
            </button>}
      </>}
    >
      {edition && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <span className="badge" style={{ background: `${STATUTS[statut]?.color}22`, color: STATUTS[statut]?.color, border: `1px solid ${STATUTS[statut]?.color}` }}>
            {STATUTS[statut]?.label || statut}
          </span>
          {boutonsStatut.map(([s, l]) => (
            <button key={s} className="btn btn-ghost btn-sm" disabled={enCours} onClick={() => changerStatut(s)}
              style={s === "canceled" || s === "no_show" ? { color: "var(--red)" } : undefined}>{l}</button>
          ))}
        </div>
      )}
      {verrou && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          Rendez-vous passé : seuls le statut et la note se modifient.
        </div>
      )}

      <div className="form-grid">
        <div className="form-group full">
          <label className="form-label">Type de rendez-vous</label>
          <select className="form-input" value={typeChoix} disabled={verrou} onChange={e => choisirType(e.target.value)}>
            <option value="">— Sans type —</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value={AUTRE}>✏️ Autre (à écrire)…</option>
          </select>
          {typeChoix === AUTRE && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <input className="form-input" style={{ flex: 1, minWidth: 180 }} placeholder="Ex. : Contrôle technique"
                value={typeLibre} disabled={verrou} onChange={e => setTypeLibre(e.target.value)} />
              {!verrou && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={ajouterALaListe} onChange={e => setAjouterALaListe(e.target.checked)} />
                  Ajouter à ma liste
                </label>
              )}
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Collaborateur</label>
          <select className="form-input" value={form.staff_id} disabled={verrou} onChange={e => set("staff_id", e.target.value)}>
            <option value="">— Aucun —</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            {/* Collaborateur désactivé depuis : on le garde affiché sur ses RDV. */}
            {edition && appt.staff_id && !staff.some(s => s.id === appt.staff_id) && (
              <option value={appt.staff_id}>{nomStaff(appt.staff_id) || "Collaborateur retiré"}</option>
            )}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Durée</label>
          <select className="form-input" value={form.duree} disabled={verrou} onChange={e => set("duree", parseInt(e.target.value, 10))}>
            {[...new Set([...DUREES, parseInt(form.duree, 10) || 30])].sort((a, b) => a - b).map(d => (
              <option key={d} value={d}>{d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? String(d % 60).padStart(2, "0") : ""}`}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Date</label>
          <input className="form-input" type="date" value={form.date} disabled={verrou} onChange={e => set("date", e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Heure</label>
          <input className="form-input" type="time" step="300" value={form.heure} disabled={verrou} onChange={e => set("heure", e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Nom du client</label>
          <input className="form-input" value={form.client_name} disabled={verrou} onChange={e => set("client_name", e.target.value)} placeholder="Nom Prénom" />
        </div>
        <div className="form-group">
          <label className="form-label">Téléphone</label>
          <input className="form-input" type="tel" value={form.client_phone} disabled={verrou} onChange={e => set("client_phone", e.target.value)} placeholder="06 12 34 56 78" />
        </div>
        <div className="form-group full">
          <label className="form-label">Véhicule</label>
          <input className="form-input" value={form.vehicle} disabled={verrou} onChange={e => set("vehicle", e.target.value)} placeholder="Ex. : Peugeot 308 · AB-123-CD" />
        </div>
        <div className="form-group full">
          <label className="form-label">Note</label>
          <textarea className="form-input" rows={3} value={form.notes} onChange={e => set("notes", e.target.value)} />
        </div>
      </div>

      {debut && !verrou && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          {fmtDateLongue(debut)} · {heureHHMM(debut)} → {heureHHMM(fin)}
        </div>
      )}
      {!verrou && controle.absence && (
        <Alerte couleur="var(--red)">⛔ {nomStaff(form.staff_id)} est absent sur ce créneau{controle.absence.reason ? ` (${controle.absence.reason})` : ""}.</Alerte>
      )}
      {!verrou && controle.chevauchement && (
        <Alerte couleur="var(--red)">
          ⚠️ {nomStaff(form.staff_id)} a déjà {controle.chevauchement.map(a => `${heureHHMM(new Date(a.starts_at))}–${heureHHMM(new Date(a.ends_at))} (${a.client_name || "RDV"})`).join(", ")}
          {prefs.buffer_min > 0 ? `, avec ${prefs.buffer_min} min de marge entre deux RDV` : ""}.
          {controle.suivant && (
            <div style={{ marginTop: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setForm(f => ({ ...f, date: dateISO(controle.suivant), heure: heureHHMM(controle.suivant) }))}>
                Décaler à {heureHHMM(controle.suivant)}
              </button>
            </div>
          )}
        </Alerte>
      )}
      {!verrou && !controle.absence && controle.horsHoraires && (
        <Alerte>🕑 En dehors des horaires de {nomStaff(form.staff_id)}.</Alerte>
      )}
      {autresRdvClient.length > 0 && (
        <Alerte>
          📅 Ce client a déjà {autresRdvClient.length > 1 ? `${autresRdvClient.length} rendez-vous` : "un rendez-vous"} à venir :
          {autresRdvClient.slice(0, 3).map(a => (
            <div key={a.id}>• {fmtDateLongue(new Date(a.starts_at))} à {heureHHMM(new Date(a.starts_at))}
              {a.type_label ? ` · ${a.type_label}` : ""}{a.staff_id ? ` · ${nomStaff(a.staff_id)}` : ""}</div>
          ))}
        </Alerte>
      )}
      {erreur && <Alerte couleur="var(--red)">{erreur}</Alerte>}
    </Fenetre>
  );
}

// ═══════════════════════════════════════════════════════════════
//  BLOQUER UN CRÉNEAU / ABSENCE
// ═══════════════════════════════════════════════════════════════
export function BlockModal({ api, staff, staffIdInitial, dateInitiale, onClose, onSaved }) {
  const [form, setForm] = useState({
    staff_id: staffIdInitial || staff[0]?.id || "",
    journee: true,
    du: dateISO(dateInitiale), au: dateISO(dateInitiale),
    heureDebut: "09:00", heureFin: "12:00",
    raison: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [rdvTouches, setRdvTouches] = useState([]);

  const periode = useMemo(() => {
    if (!form.du) return null;
    if (form.journee) {
      const d = composer(form.du, "00:00");
      const f = ajouterJours(composer(form.au || form.du, "00:00"), 1);
      return f > d ? { debut: d, fin: f } : null;
    }
    const d = composer(form.du, form.heureDebut), f = composer(form.du, form.heureFin);
    return f > d ? { debut: d, fin: f } : null;
  }, [form]);

  // RDV déjà pris pendant la période : ils ne sont pas supprimés, on prévient.
  useEffect(() => {
    if (!periode || !form.staff_id) { setRdvTouches([]); return; }
    let annule = false;
    api.appointmentsBetween(periode.debut, periode.fin)
      .then(r => { if (!annule) setRdvTouches((r || []).filter(a => a.staff_id === form.staff_id && !LIBERE_CRENEAU.includes(a.status))); })
      .catch(() => {});
    return () => { annule = true; };
  }, [api, periode?.debut?.getTime(), periode?.fin?.getTime(), form.staff_id]);

  async function enregistrer() {
    setErreur("");
    if (!form.staff_id) { setErreur("Choisissez un collaborateur."); return; }
    if (!periode) { setErreur("La fin doit être après le début."); return; }
    setEnCours(true);
    try {
      await api.insert("agenda_time_off", {
        staff_id: form.staff_id,
        starts_at: periode.debut.toISOString(),
        ends_at: periode.fin.toISOString(),
        all_day: form.journee,
        reason: form.raison.trim() || null,
      });
      await onSaved();
    } catch (e) { setErreur(e.message); setEnCours(false); }
  }

  return (
    <Fenetre titre="Bloquer un créneau" onClose={onClose} pied={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={enCours}>Annuler</button>
      <button className="btn btn-primary" onClick={enregistrer} disabled={enCours}>{enCours ? "…" : "⛔ Bloquer"}</button>
    </>}>
      <div className="form-grid">
        <div className="form-group full">
          <label className="form-label">Collaborateur</label>
          <select className="form-input" value={form.staff_id} onChange={e => set("staff_id", e.target.value)}>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="form-group full">
          <div style={{ display: "inline-flex", background: "var(--card2)", border: "1px solid var(--border2)", borderRadius: 8, padding: 3, gap: 2 }}>
            {[[true, "Journée(s) entière(s)"], [false, "Créneau horaire"]].map(([v, l]) => (
              <button key={String(v)} onClick={() => set("journee", v)} style={{
                padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", cursor: "pointer",
                background: form.journee === v ? "var(--gold)" : "transparent", color: form.journee === v ? "#0a0a0a" : "var(--muted)",
              }}>{l}</button>
            ))}
          </div>
        </div>
        {form.journee ? (<>
          <div className="form-group">
            <label className="form-label">Du</label>
            <input className="form-input" type="date" value={form.du} onChange={e => setForm(f => ({ ...f, du: e.target.value, au: f.au < e.target.value ? e.target.value : f.au }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Au (inclus)</label>
            <input className="form-input" type="date" value={form.au} min={form.du} onChange={e => set("au", e.target.value)} />
          </div>
        </>) : (<>
          <div className="form-group full">
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={form.du} onChange={e => set("du", e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">De</label>
            <input className="form-input" type="time" step="300" value={form.heureDebut} onChange={e => set("heureDebut", e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">À</label>
            <input className="form-input" type="time" step="300" value={form.heureFin} onChange={e => set("heureFin", e.target.value)} />
          </div>
        </>)}
        <div className="form-group full">
          <label className="form-label">Motif (facultatif)</label>
          <input className="form-input" value={form.raison} onChange={e => set("raison", e.target.value)} placeholder="Congés, formation, salon auto…" />
        </div>
      </div>
      {rdvTouches.length > 0 && (
        <Alerte>
          ⚠️ {rdvTouches.length > 1 ? `${rdvTouches.length} rendez-vous sont prévus` : "Un rendez-vous est prévu"} pendant cette période.
          Ils restent dans l'agenda : pensez à les déplacer.
        </Alerte>
      )}
      {erreur && <Alerte couleur="var(--red)">{erreur}</Alerte>}
    </Fenetre>
  );
}

export { Fenetre, Alerte, debutJour };
