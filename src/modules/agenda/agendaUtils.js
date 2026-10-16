// ═══════════════════════════════════════════════════════════════
//  AGENDA — constantes et calculs (dates, créneaux, disponibilités)
// ═══════════════════════════════════════════════════════════════

export const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
export const JOURS_LONGS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
  "Septembre", "Octobre", "Novembre", "Décembre"];

export const SLOT_MIN = 15;     // pas de la grille
export const ROW_PX = 16;       // hauteur d'un pas

// Palette proposée pour les collaborateurs et les types.
export const COULEURS = ["#d4a843", "#3b82f6", "#10b981", "#ef4444", "#a855f7",
  "#f97316", "#06b6d4", "#ec4899", "#84cc16", "#64748b"];

export const TYPES_PAR_DEFAUT = [
  { label: "Essai", color: "#3b82f6", duration_minutes: 30 },
  { label: "Livraison", color: "#10b981", duration_minutes: 45 },
  { label: "Reprise / expertise", color: "#f97316", duration_minutes: 30 },
  { label: "Rendez-vous vente", color: "#d4a843", duration_minutes: 60 },
  { label: "Autre", color: "#64748b", duration_minutes: 30 },
];

export const STATUTS = {
  planned:   { label: "Prévu",    color: "#9997aa" },
  confirmed: { label: "Confirmé", color: "#3b82f6" },
  arrived:   { label: "Arrivé",   color: "#f97316" },
  done:      { label: "Honoré",   color: "#10b981" },
  canceled:  { label: "Annulé",   color: "#6b6a7a" },
  no_show:   { label: "Absent",   color: "#ef4444" },
};
// Statuts qui n'occupent plus le créneau.
export const LIBERE_CRENEAU = ["canceled", "no_show"];

export const PREFS_PAR_DEFAUT = { start_hour: 8, end_hour: 19, buffer_min: 0 };

export function lirePrefs(uiPrefs) {
  const p = { ...PREFS_PAR_DEFAUT, ...(uiPrefs?.agenda || {}) };
  p.start_hour = Math.min(Math.max(0, parseInt(p.start_hour, 10) || 0), 22);
  p.end_hour = Math.min(Math.max(p.start_hour + 1, parseInt(p.end_hour, 10) || 19), 24);
  p.buffer_min = Math.max(0, parseInt(p.buffer_min, 10) || 0);
  return p;
}

// ─── Dates (heure locale) ─────────────────────────────────────
export function debutJour(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function ajouterJours(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function memeJour(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// 0 = lundi … 6 = dimanche (getDay() renvoie 0 pour dimanche).
export function jourSemaine(d) { return (d.getDay() + 6) % 7; }
export function debutSemaine(d) { const x = debutJour(d); return ajouterJours(x, -jourSemaine(x)); }
export function numeroSemaine(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const jour = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - jour);
  const debutAnnee = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - debutAnnee) / 86400000 + 1) / 7);
}
export function dateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function heureHHMM(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
// "2026-10-20" + "10:30" → Date locale
export function composer(dateStr, heureStr) {
  const [y, m, j] = dateStr.split("-").map(Number);
  const [h, mi] = (heureStr || "00:00").split(":").map(Number);
  return new Date(y, m - 1, j, h || 0, mi || 0, 0, 0);
}
export function minutesDuJour(d) { return d.getHours() * 60 + d.getMinutes(); }
function minutesDe(hhmmss) {
  if (!hhmmss) return null;
  const [h, m] = String(hhmmss).split(":").map(Number);
  return h * 60 + (m || 0);
}
export function fmtDateLongue(d) {
  return `${JOURS_LONGS[jourSemaine(d)]} ${d.getDate()} ${MOIS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

// Téléphone ramené à ses chiffres (06…, +33 6…) pour comparer.
export function telNormalise(t) {
  let d = String(t || "").replace(/\D/g, "");
  if (d.startsWith("33") && d.length === 11) d = "0" + d.slice(2);
  return d;
}

// ─── Disponibilité ────────────────────────────────────────────
// Un collaborateur sans aucun horaire saisi est considéré disponible tout le
// temps : un garage qui découvre l'agenda ne doit pas voir une grille
// entièrement hachurée.
export function travaille(staffId, date, minute, schedules) {
  const siens = schedules.filter(s => s.staff_id === staffId);
  if (siens.length === 0) return true;
  const s = siens.find(x => x.day_of_week === jourSemaine(date));
  if (!s) return false;
  const debut = minutesDe(s.start_time), fin = minutesDe(s.end_time);
  if (minute < debut || minute >= fin) return false;
  const pd = minutesDe(s.break_start), pf = minutesDe(s.break_end);
  if (pd != null && pf != null && minute >= pd && minute < pf) return false;
  return true;
}

export function absentA(staffId, instant, timeOff) {
  return timeOff.some(o => o.staff_id === staffId
    && new Date(o.starts_at) <= instant && new Date(o.ends_at) > instant);
}

export function disponible(staffId, date, minute, schedules, timeOff) {
  const instant = new Date(date); instant.setHours(0, minute, 0, 0);
  return travaille(staffId, date, minute, schedules) && !absentA(staffId, instant, timeOff);
}

// RDV qui occupent un collaborateur (hors annulés / absents) et qui
// chevauchent [debut, fin[ élargi de la marge, sauf `ignorerId`.
export function conflits(rdvs, staffId, debut, fin, margeMin, ignorerId) {
  const m = (margeMin || 0) * 60000;
  return rdvs.filter(a => a.id !== ignorerId
    && !LIBERE_CRENEAU.includes(a.status)
    && (staffId ? a.staff_id === staffId : !a.staff_id)
    && new Date(a.starts_at).getTime() < fin.getTime() + m
    && new Date(a.ends_at).getTime() > debut.getTime() - m);
}

// Premier créneau libre de même durée, le même jour, après `debut`.
export function prochainCreneauLibre(rdvs, timeOff, staffId, debut, dureeMin, margeMin, ignorerId, finJourHeure) {
  const limite = new Date(debut); limite.setHours(finJourHeure || 24, 0, 0, 0);
  let t = new Date(debut);
  for (let i = 0; i < 96; i++) {
    t = new Date(t.getTime() + SLOT_MIN * 60000);
    const f = new Date(t.getTime() + dureeMin * 60000);
    if (f > limite) return null;
    const absent = staffId && timeOff.some(o => o.staff_id === staffId
      && new Date(o.starts_at) < f && new Date(o.ends_at) > t);
    if (!absent && conflits(rdvs, staffId, t, f, margeMin, ignorerId).length === 0) return t;
  }
  return null;
}

// Place les RDV qui se chevauchent côte à côte dans une colonne :
// renvoie pour chacun { lane, lanes }.
export function disposerChevauchements(items) {
  const tries = [...items].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const res = new Map();
  let groupe = [], finGroupe = 0;
  const clore = () => {
    const voies = [];
    for (const it of groupe) {
      const d = new Date(it.starts_at).getTime();
      let v = voies.findIndex(fin => fin <= d);
      if (v === -1) { v = voies.length; voies.push(0); }
      voies[v] = new Date(it.ends_at).getTime();
      res.set(it.id, { lane: v });
    }
    for (const it of groupe) res.get(it.id).lanes = voies.length;
    groupe = [];
  };
  for (const it of tries) {
    const d = new Date(it.starts_at).getTime();
    if (groupe.length && d >= finGroupe) { clore(); finGroupe = 0; }
    groupe.push(it);
    finGroupe = Math.max(finGroupe, new Date(it.ends_at).getTime());
  }
  if (groupe.length) clore();
  return res;
}
