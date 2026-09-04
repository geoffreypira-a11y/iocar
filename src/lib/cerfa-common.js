// ═══════════════════════════════════════════════════════════════════
// Briques partagées par les trois CERFA (cession 15776, mandat 13757*03,
// demande de certificat d'immatriculation 13750*07), qu'ils soient générés
// depuis l'onglet Documents administratifs ou depuis une facture.
// ═══════════════════════════════════════════════════════════════════

// pdf-lib est chargé à la volée depuis le CDN : il ne sert que sur ces
// documents, inutile de l'embarquer dans le bundle.
export async function loadPdfLib() {
  if (window.PDFLib) return window.PDFLib;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  if (!window.PDFLib) throw new Error("Librairie PDF non chargée (PDFLib).");
  return window.PDFLib;
}

// Découpe une adresse libre en composants attendus par les CERFA.
// v8.138 — Ville robuste (corrige "Fait à" vide sur le CERFA) :
//  1) ville APRÈS le CP sur la même ligne  → "13000 Marseille"
//  2) sinon ville AVANT le CP              → "Marseille 13000"
//  3) sinon CP seul sur sa ligne → dernière ligne "texte" (hors rue)
export function parseAddress(addr) {
  if (!addr) return { num: "", ext: "", type: "", nom: "", cp: "", ville: "" };
  const lines = String(addr).split("\n").map(l => l.trim()).filter(Boolean);
  const rue = lines[0] || "";
  const cpLine = lines.find(l => /\d{5}/.test(l)) || "";
  const cpMatch = cpLine.match(/(\d{5})\s*(.*)/);
  const cp = cpMatch ? cpMatch[1] : "";
  let ville = cpMatch ? cpMatch[2].trim() : "";
  if (!ville && cpLine && cp) {
    const before = cpLine.slice(0, cpLine.indexOf(cp)).trim();
    if (before && !/^\d/.test(before)) ville = before;
  }
  if (!ville) {
    const cand = lines.filter(l => l !== rue && l !== cpLine && !/\d{5}/.test(l) && !/^\d/.test(l));
    if (cand.length) ville = cand[cand.length - 1].trim();
  }
  const types = ["RUE","AVENUE","AVE","AV","BOULEVARD","BD","BLVD","IMPASSE","IMP","CHEMIN","CH","ROUTE","RTE","PLACE","PL","ALLÉE","ALLEE","PASSAGE","COURS","SQUARE","SQ","LOTISSEMENT","LOT","RÉSIDENCE","RESIDENCE","HAMEAU","LIEU-DIT","QUAI","VOIE","SENTIER","TRAVERSE"];
  const extensions = ["BIS","TER","QUATER","A","B","C"];
  const parts = rue.split(/\s+/);
  let num = "", ext = "", type = "", nom = "";
  let idx = 0;
  if (parts[idx] && /^\d+$/.test(parts[idx])) { num = parts[idx]; idx++; }
  if (parts[idx] && extensions.includes(parts[idx].toUpperCase())) { ext = parts[idx]; idx++; }
  if (parts[idx] && types.includes(parts[idx].toUpperCase())) { type = parts[idx]; idx++; }
  nom = parts.slice(idx).join(" ");
  if (!type && !num) nom = rue;
  return { num, ext, type, nom, cp, ville };
}

// Identité telle que l'attendent les CERFA : raison sociale pour une personne
// morale, « NOM Prénom » (nom en majuscules d'abord) pour une personne physique.
export function buildIdentite(p) {
  if (!p) return "";
  if (p.isMorale) return (p.identite || "").toUpperCase().trim();
  if (p.nom || p.prenom) return `${(p.nom || "").toUpperCase()} ${p.prenom || ""}`.trim();
  const parts = (p.identite || "").trim().split(/\s+/);
  if (parts.length >= 2) {
    const nom = parts[parts.length - 1];
    const prenom = parts.slice(0, -1).join(" ");
    return `${nom.toUpperCase()} ${prenom}`.trim();
  }
  return p.identite || "";
}

// Découpe une date en jour / mois / année, qu'elle arrive en jj/mm/aaaa
// (saisie libre, today()) ou en aaaa-mm-jj (input date / base).
export function splitDate(value) {
  const s = String(value || "").trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return { jour: m[1], mois: m[2], annee: m[3] };
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { jour: m[3], mois: m[2], annee: m[1] };
  return null;
}
