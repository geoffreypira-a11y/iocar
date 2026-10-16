// ═══════════════════════════════════════════════════════════════
//  IO CAR — AGENDA DES RENDEZ-VOUS
// ═══════════════════════════════════════════════════════════════
// Module autonome, chargé seulement à l'ouverture de l'onglet Agenda. Il ne
// lit ni n'écrit rien d'autre que les tables agenda_* et ses préférences
// (garages.ui_prefs.agenda) : aucun lien avec la flotte, les factures, le CRM
// ou le livre de police.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAgendaApi } from "./agendaApi.js";
import {
  JOURS_COURTS, MOIS, SLOT_MIN, ROW_PX, STATUTS, LIBERE_CRENEAU, TYPES_PAR_DEFAUT,
  lirePrefs, debutJour, ajouterJours, memeJour, jourSemaine, debutSemaine, numeroSemaine,
  heureHHMM, minutesDuJour, disponible, disposerChevauchements, fmtDateLongue,
} from "./agendaUtils.js";
import { AppointmentModal, BlockModal } from "./AgendaModals.jsx";
import { AgendaSettings } from "./AgendaSettings.jsx";

const SANS_COLLAB = "__sans__";

function useEstMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  useEffect(() => {
    const f = () => setM(window.innerWidth < 760);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return m;
}

export default function AgendaPage({ token, garageId, supabaseUrl, supabaseKey, dealer, setDealer }) {
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const api = useMemo(() => createAgendaApi({
    url: supabaseUrl, apiKey: supabaseKey, garageId, getToken: () => tokenRef.current,
  }), [supabaseUrl, supabaseKey, garageId]);

  const prefs = lirePrefs(dealer?.ui_prefs);
  const estMobile = useEstMobile();
  const [vue, setVue] = useState(() => (typeof window !== "undefined" && window.innerWidth < 760) ? "day" : "week");
  const [focus, setFocus] = useState(() => debutJour(new Date()));
  const [staff, setStaff] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [types, setTypes] = useState([]);
  const [rdvs, setRdvs] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [filtre, setFiltre] = useState("all");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [modal, setModal] = useState(null);   // { kind: "create"|"edit"|"block"|"settings", ... }

  // ─── Données fixes : équipe, horaires, types ─────────────────
  const chargerFixe = useCallback(async () => {
    const [s, h, t] = await Promise.all([
      api.list("agenda_staff", "", "sort_order,created_at"),
      api.list("agenda_schedules"),
      api.list("agenda_types", "", "sort_order,created_at"),
    ]);
    setStaff(s || []);
    setSchedules(h || []);
    setTypes(t || []);
    return t || [];
  }, [api]);

  // Les types proposés au départ ne sont créés qu'une fois : un garage qui
  // les supprime tous ne les voit pas revenir.
  const typesInitialises = useRef(false);
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const t = await chargerFixe();
        if (!annule && t.length === 0 && !prefs.types_seeded && !typesInitialises.current) {
          typesInitialises.current = true;
          const crees = await api.insert("agenda_types",
            TYPES_PAR_DEFAUT.map((x, i) => ({ ...x, sort_order: i })));
          if (!annule) setTypes(crees || []);
          const ui = dealer?.ui_prefs || {};
          setDealer({ ...dealer, ui_prefs: { ...ui, agenda: { ...(ui.agenda || {}), types_seeded: true } } });
        }
      } catch (e) { if (!annule) setErreur(e.message); }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargerFixe]);

  // ─── Période affichée ───────────────────────────────────────
  const periode = useMemo(() => {
    if (vue === "day") return { debut: focus, fin: ajouterJours(focus, 1) };
    if (vue === "week") { const d = debutSemaine(focus); return { debut: d, fin: ajouterJours(d, 7) }; }
    const premier = new Date(focus.getFullYear(), focus.getMonth(), 1);
    const d = debutSemaine(premier);
    return { debut: d, fin: ajouterJours(d, 42) };
  }, [vue, focus]);

  const chargerPeriode = useCallback(async () => {
    setChargement(true);
    try {
      const [a, o] = await Promise.all([
        api.appointmentsBetween(periode.debut, periode.fin),
        api.timeOffBetween(periode.debut, periode.fin),
      ]);
      setRdvs(a || []);
      setTimeOff(o || []);
      setErreur("");
    } catch (e) { setErreur(e.message); }
    finally { setChargement(false); }
  }, [api, periode]);

  useEffect(() => { chargerPeriode(); }, [chargerPeriode]);

  // Retour sur l'onglet après une longue absence : on recharge.
  useEffect(() => {
    const f = () => { if (document.visibilityState === "visible") chargerPeriode(); };
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [chargerPeriode]);

  const staffActifs = staff.filter(s => s.active !== false);
  const staffVisibles = filtre === "all" ? staffActifs : staffActifs.filter(s => s.id === filtre);
  const couleurStaff = (id) => staff.find(s => s.id === id)?.color || "#6b6a7a";
  const nomStaff = (id) => staff.find(s => s.id === id)?.name || "";

  const rdvsVisibles = rdvs.filter(a => filtre === "all" ? true : a.staff_id === filtre);
  const absencesVisibles = timeOff.filter(o => filtre === "all" ? true : o.staff_id === filtre);

  // ─── Navigation ─────────────────────────────────────────────
  const decaler = (sens) => {
    if (vue === "day") setFocus(f => ajouterJours(f, sens));
    else if (vue === "week") setFocus(f => ajouterJours(f, 7 * sens));
    else setFocus(f => new Date(f.getFullYear(), f.getMonth() + sens, 1));
  };
  const titre = vue === "day" ? fmtDateLongue(focus)
    : vue === "week" ? (() => {
        const d = debutSemaine(focus), f = ajouterJours(d, 6);
        return `Semaine ${numeroSemaine(d)} · ${d.getDate()} ${MOIS[d.getMonth()].slice(0, 4).toLowerCase()}. → ${f.getDate()} ${MOIS[f.getMonth()].slice(0, 4).toLowerCase()}. ${f.getFullYear()}`;
      })()
    : `${MOIS[focus.getMonth()]} ${focus.getFullYear()}`;

  const ouvrirCreation = (date, minute, staffId) => {
    const d = new Date(date);
    if (minute != null) d.setHours(0, minute, 0, 0);
    else { const n = new Date(); d.setHours(n.getHours() + 1, 0, 0, 0); }
    setModal({ kind: "create", start: d, staffId: staffId || (filtre !== "all" ? filtre : "") });
  };

  const apresEnregistrement = async ({ typesChanges } = {}) => {
    setModal(null);
    if (typesChanges) await chargerFixe().catch(() => {});
    await chargerPeriode();
  };

  const supprimerAbsence = async (o) => {
    const qui = nomStaff(o.staff_id);
    if (!window.confirm(`Supprimer cette absence${qui ? " de " + qui : ""}${o.reason ? " (« " + o.reason + " »)" : ""} ?`)) return;
    try { await api.remove("agenda_time_off", o.id); await chargerPeriode(); }
    catch (e) { alert(e.message); }
  };

  // ─── Rendu ──────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="page-title">Agenda</div>
          <div className="page-sub" style={{ textTransform: "capitalize" }}>{titre}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={() => ouvrirCreation(focus, null)}>+ Nouveau RDV</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "block" })}
            disabled={staffActifs.length === 0}
            title={staffActifs.length === 0 ? "Ajoutez d'abord un collaborateur" : "Absence, congé, créneau indisponible"}>
            ⛔ Bloquer
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "settings" })}>⚙ Réglages</button>
        </div>
      </div>

      {/* Barre de navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setFocus(debutJour(new Date()))}>Aujourd'hui</button>
        <button className="btn btn-ghost btn-sm" onClick={() => decaler(-1)} aria-label="Précédent">‹</button>
        <button className="btn btn-ghost btn-sm" onClick={() => decaler(1)} aria-label="Suivant">›</button>
        <div style={{ display: "inline-flex", background: "var(--card2)", border: "1px solid var(--border2)", borderRadius: 8, padding: 3, gap: 2 }}>
          {[["day", "Jour"], ["week", "Semaine"], ["month", "Mois"]].map(([k, l]) => (
            <button key={k} onClick={() => setVue(k)} style={{
              padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", cursor: "pointer",
              background: vue === k ? "var(--gold)" : "transparent", color: vue === k ? "#0a0a0a" : "var(--muted)",
            }}>{l}</button>
          ))}
        </div>
        {staffActifs.length > 1 && (
          <select className="form-input" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
            value={filtre} onChange={e => setFiltre(e.target.value)}>
            <option value="all">Toute l'équipe</option>
            {staffActifs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {chargement && <span style={{ fontSize: 12, color: "var(--muted)" }}>Chargement…</span>}
        {/* Légende des couleurs de l'équipe */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginLeft: "auto" }}>
          {staffActifs.map(s => (
            <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted2, var(--muted))" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.name}
            </span>
          ))}
        </div>
      </div>

      {erreur && (
        <div style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 8, background: "rgba(229,92,92,.08)", border: "1px solid rgba(229,92,92,.3)", color: "var(--red)", fontSize: 13 }}>
          {erreur}
        </div>
      )}

      {staffActifs.length === 0 && !chargement && !erreur && (
        <div style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 8, background: "var(--card2)", border: "1px dashed var(--border2)", fontSize: 13, color: "var(--muted)" }}>
          Ajoutez les membres de votre équipe dans <strong>⚙ Réglages</strong> pour leur attribuer des rendez-vous et une couleur.
        </div>
      )}

      {vue === "month" ? (
        <VueMois focus={focus} periode={periode} rdvs={rdvsVisibles} timeOff={absencesVisibles}
          couleurStaff={couleurStaff} onJour={(d) => { setFocus(d); setVue("day"); }} />
      ) : (
        <Grille
          vue={vue} focus={focus} prefs={prefs} estMobile={estMobile}
          staffActifs={staffActifs} staffVisibles={staffVisibles} filtre={filtre}
          schedules={schedules} rdvs={rdvsVisibles} timeOff={absencesVisibles}
          couleurStaff={couleurStaff} nomStaff={nomStaff}
          onCellule={ouvrirCreation}
          onRdv={(a) => setModal({ kind: "edit", appt: a })}
          onAbsence={supprimerAbsence}
          onJour={(d) => { setFocus(d); setVue("day"); }}
        />
      )}

      {(modal?.kind === "create" || modal?.kind === "edit") && (
        <AppointmentModal
          api={api} mode={modal.kind} appt={modal.appt} start={modal.start} staffIdInitial={modal.staffId}
          staff={staffActifs} tousStaff={staff} types={types} schedules={schedules} prefs={prefs}
          onClose={() => setModal(null)} onSaved={apresEnregistrement}
        />
      )}
      {modal?.kind === "block" && (
        <BlockModal api={api} staff={staffActifs} staffIdInitial={filtre !== "all" ? filtre : ""}
          dateInitiale={focus} onClose={() => setModal(null)} onSaved={apresEnregistrement} />
      )}
      {modal?.kind === "settings" && (
        <AgendaSettings api={api} staff={staff} schedules={schedules} types={types} prefs={prefs}
          dealer={dealer} setDealer={setDealer}
          onChanged={async () => { await chargerFixe().catch(() => {}); await chargerPeriode(); }}
          onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  GRILLE JOUR / SEMAINE
// ═══════════════════════════════════════════════════════════════
function Grille({ vue, focus, prefs, estMobile, staffActifs, staffVisibles, filtre, schedules, rdvs, timeOff,
  couleurStaff, nomStaff, onCellule, onRdv, onAbsence, onJour }) {
  const minDebut = prefs.start_hour * 60;
  const minFin = prefs.end_hour * 60;
  const nbPas = (minFin - minDebut) / SLOT_MIN;
  const hauteur = nbPas * ROW_PX;
  const maintenant = new Date();

  // Colonnes : en semaine, un jour par colonne (toute l'équipe visible) ;
  // en jour, un collaborateur par colonne.
  let colonnes;
  if (vue === "week") {
    const d0 = debutSemaine(focus);
    colonnes = Array.from({ length: 7 }, (_, i) => {
      const d = ajouterJours(d0, i);
      return {
        key: d.toISOString(), date: d, staffIds: staffVisibles.map(s => s.id), staffCreation: filtre !== "all" ? filtre : "",
        entete: (
          <div onClick={() => onJour(d)} style={{ cursor: "pointer" }} title="Voir la journée">
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{JOURS_COURTS[i]}</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: memeJour(d, maintenant) ? "var(--gold)" : "var(--text)" }}>{d.getDate()}</div>
          </div>
        ),
        rdvs: rdvs.filter(a => memeJour(new Date(a.starts_at), d)),
        absences: timeOff.filter(o => new Date(o.starts_at) < ajouterJours(d, 1) && new Date(o.ends_at) > d),
      };
    });
  } else {
    const d = focus;
    const duJour = rdvs.filter(a => memeJour(new Date(a.starts_at), d));
    const absJour = timeOff.filter(o => new Date(o.starts_at) < ajouterJours(d, 1) && new Date(o.ends_at) > d);
    colonnes = staffVisibles.map(s => ({
      key: s.id, date: d, staffIds: [s.id], staffCreation: s.id,
      entete: (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
          <span style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</span>
        </div>
      ),
      rdvs: duJour.filter(a => a.staff_id === s.id),
      absences: absJour.filter(o => o.staff_id === s.id),
    }));
    // Colonne des RDV sans collaborateur : affichée s'il n'y a pas d'équipe
    // ou si des RDV n'ont personne d'attribué.
    const sans = duJour.filter(a => !a.staff_id);
    if (filtre === "all" && (staffActifs.length === 0 || sans.length > 0)) {
      colonnes.push({
        key: SANS_COLLAB, date: d, staffIds: [], staffCreation: "",
        entete: <span style={{ fontWeight: 700, fontSize: 13, color: "var(--muted)" }}>Sans collaborateur</span>,
        rdvs: sans, absences: [],
      });
    }
  }

  const largeurMin = vue === "week" ? (estMobile ? 110 : 120) : (estMobile ? 150 : 180);

  return (
    <div className="card" style={{ overflowX: "auto", padding: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: `52px repeat(${colonnes.length}, minmax(${largeurMin}px, 1fr))`, minWidth: 52 + colonnes.length * largeurMin }}>
        {/* En-têtes */}
        <div style={{ borderBottom: "1px solid var(--border2)", position: "sticky", top: 0, background: "var(--card)", zIndex: 3 }} />
        {colonnes.map(c => (
          <div key={c.key} style={{ textAlign: "center", padding: "8px 4px", borderBottom: "1px solid var(--border2)", borderLeft: "1px solid var(--border2)", position: "sticky", top: 0, background: "var(--card)", zIndex: 3 }}>
            {c.entete}
          </div>
        ))}

        {/* Heures */}
        <div style={{ position: "relative", height: hauteur }}>
          {Array.from({ length: prefs.end_hour - prefs.start_hour }, (_, i) => (
            <div key={i} style={{ position: "absolute", top: Math.max(0, i * 4 * ROW_PX - 6), right: 6, fontSize: 10, color: "var(--muted)", fontFamily: "DM Mono, monospace" }}>
              {String(prefs.start_hour + i).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* Colonnes */}
        {colonnes.map(c => (
          <Colonne key={c.key} col={c} prefs={prefs} nbPas={nbPas} hauteur={hauteur} vue={vue}
            schedules={schedules} timeOffTous={timeOff} maintenant={maintenant}
            couleurStaff={couleurStaff} nomStaff={nomStaff}
            onCellule={onCellule} onRdv={onRdv} onAbsence={onAbsence} />
        ))}
      </div>
    </div>
  );
}

function Colonne({ col, prefs, nbPas, hauteur, vue, schedules, timeOffTous, maintenant, couleurStaff, nomStaff, onCellule, onRdv, onAbsence }) {
  const minDebut = prefs.start_hour * 60;
  const minFin = prefs.end_hour * 60;
  const disposition = disposerChevauchements(col.rdvs);
  const yDe = (date) => ((minutesDuJour(date) - minDebut) / SLOT_MIN) * ROW_PX;

  // Une case est « fermée » si aucun collaborateur de la colonne n'est
  // disponible. Sans équipe, rien n'est fermé.
  const ferme = (minute) => col.staffIds.length > 0
    && !col.staffIds.some(id => disponible(id, col.date, minute, schedules, timeOffTous));

  const ligneMaintenant = memeJour(col.date, maintenant)
    && minutesDuJour(maintenant) >= minDebut && minutesDuJour(maintenant) < minFin;

  return (
    <div style={{ position: "relative", height: hauteur, borderLeft: "1px solid var(--border2)" }}>
      {Array.from({ length: nbPas }, (_, i) => {
        const minute = minDebut + i * SLOT_MIN;
        const f = ferme(minute);
        return (
          <div key={i}
            onClick={() => onCellule(col.date, minute, col.staffCreation)}
            title={`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}${f ? " · hors horaires" : ""}`}
            style={{
              position: "absolute", top: i * ROW_PX, left: 0, right: 0, height: ROW_PX, cursor: "pointer",
              borderTop: i % 4 === 0 ? "1px solid var(--border2)" : "1px dashed rgba(255,255,255,.03)",
              background: f ? "repeating-linear-gradient(45deg, rgba(255,255,255,.035) 0 4px, transparent 4px 8px)" : "transparent",
            }} />
        );
      })}

      {/* Absences / créneaux bloqués */}
      {col.absences.map(o => {
        const debut = new Date(Math.max(new Date(o.starts_at), debutJour(col.date)));
        const finJour = ajouterJours(debutJour(col.date), 1);
        const fin = new Date(Math.min(new Date(o.ends_at), finJour));
        const top = Math.max(0, yDe(debut));
        const bas = fin >= finJour ? hauteur : Math.min(hauteur, yDe(fin));
        if (bas <= 0 || top >= hauteur) return null;
        return (
          <div key={o.id} onClick={(e) => { e.stopPropagation(); onAbsence(o); }}
            title={`Absence${vue === "week" ? " · " + nomStaff(o.staff_id) : ""}${o.reason ? " : " + o.reason : ""} (cliquer pour supprimer)`}
            style={{
              position: "absolute", top, height: Math.max(ROW_PX, bas - top), left: 2, right: 2, zIndex: 1,
              borderRadius: 6, cursor: "pointer", overflow: "hidden", padding: "2px 6px", fontSize: 10, color: "var(--muted)",
              border: `1px dashed ${couleurStaff(o.staff_id)}`,
              background: "repeating-linear-gradient(45deg, rgba(120,120,140,.18) 0 6px, rgba(120,120,140,.06) 6px 12px)",
            }}>
            ⛔ {vue === "week" ? nomStaff(o.staff_id) + " · " : ""}{o.reason || "Indisponible"}
          </div>
        );
      })}

      {/* Rendez-vous */}
      {col.rdvs.map(a => {
        const debut = new Date(a.starts_at), fin = new Date(a.ends_at);
        const top = yDe(debut), bas = yDe(fin);
        if (bas <= 0 || top >= hauteur) return null;
        const { lane = 0, lanes = 1 } = disposition.get(a.id) || {};
        const couleur = a.staff_id ? couleurStaff(a.staff_id) : "#6b6a7a";
        const libere = LIBERE_CRENEAU.includes(a.status);
        const largeur = 100 / lanes;
        const h = Math.max(ROW_PX * 1.5, Math.min(hauteur, bas) - Math.max(0, top) - 2);
        return (
          <div key={a.id} onClick={(e) => { e.stopPropagation(); onRdv(a); }}
            title={`${heureHHMM(debut)}–${heureHHMM(fin)} · ${a.client_name || ""}${a.type_label ? " · " + a.type_label : ""}${a.vehicle ? " · " + a.vehicle : ""}${a.staff_id ? " · " + nomStaff(a.staff_id) : ""} · ${STATUTS[a.status]?.label || a.status}`}
            style={{
              position: "absolute", top: Math.max(0, top) + 1, height: h,
              left: `calc(${lane * largeur}% + 2px)`, width: `calc(${largeur}% - 4px)`, zIndex: 2,
              borderRadius: 6, padding: "3px 6px", overflow: "hidden", cursor: "pointer", fontSize: 11, lineHeight: 1.3,
              background: `${couleur}26`, borderLeft: `3px solid ${couleur}`,
              border: a.status === "no_show" ? `1px dashed ${STATUTS.no_show.color}` : undefined,
              opacity: libere ? 0.45 : 1, textDecoration: a.status === "canceled" ? "line-through" : "none",
            }}>
            <div style={{ fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {heureHHMM(debut)} {a.client_name || "—"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {a.type_label && <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.type_color || "#64748b", flexShrink: 0 }} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{[a.type_label, a.vehicle].filter(Boolean).join(" · ")}</span>
            </div>
            {a.status !== "planned" && h > ROW_PX * 3 && (
              <div style={{ fontSize: 10, color: STATUTS[a.status]?.color }}>{STATUTS[a.status]?.label}</div>
            )}
          </div>
        );
      })}

      {ligneMaintenant && (
        <div style={{ position: "absolute", left: 0, right: 0, top: yDe(maintenant), height: 2, background: "var(--red)", zIndex: 3, pointerEvents: "none" }} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  VUE MOIS
// ═══════════════════════════════════════════════════════════════
function VueMois({ focus, periode, rdvs, timeOff, couleurStaff, onJour }) {
  const aujourdhui = new Date();
  const jours = Array.from({ length: 42 }, (_, i) => ajouterJours(periode.debut, i));
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "34px repeat(7, minmax(90px, 1fr))", minWidth: 34 + 7 * 90 }}>
        <div />
        {JOURS_COURTS.map(j => (
          <div key={j} style={{ textAlign: "center", padding: 8, fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border2)" }}>{j}</div>
        ))}
        {jours.map((d, i) => {
          const duJour = rdvs.filter(a => memeJour(new Date(a.starts_at), d) && !LIBERE_CRENEAU.includes(a.status));
          const abs = timeOff.filter(o => new Date(o.starts_at) < ajouterJours(d, 1) && new Date(o.ends_at) > d);
          const staffs = [...new Set(duJour.map(a => a.staff_id || ""))];
          const horsMois = d.getMonth() !== focus.getMonth();
          return (
            <React.Fragment key={i}>
              {jourSemaine(d) === 0 && (
                <div style={{ fontSize: 10, color: "var(--muted)", padding: "8px 4px", borderTop: "1px solid var(--border2)" }}>S{numeroSemaine(d)}</div>
              )}
              <div onClick={() => onJour(d)} style={{
                minHeight: 74, padding: 6, cursor: "pointer", borderTop: "1px solid var(--border2)", borderLeft: "1px solid var(--border2)",
                opacity: horsMois ? 0.4 : 1, background: memeJour(d, aujourdhui) ? "rgba(212,168,67,.08)" : "transparent",
              }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: memeJour(d, aujourdhui) ? "var(--gold)" : "var(--text)" }}>{d.getDate()}</div>
                {duJour.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--text)", marginTop: 4 }}>{duJour.length} RDV</div>
                )}
                <div style={{ display: "flex", gap: 3, marginTop: 4, flexWrap: "wrap" }}>
                  {staffs.slice(0, 6).map(id => (
                    <span key={id || "x"} style={{ width: 8, height: 8, borderRadius: "50%", background: id ? couleurStaff(id) : "#6b6a7a" }} />
                  ))}
                </div>
                {abs.length > 0 && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>⛔ {abs.length} abs.</div>}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
