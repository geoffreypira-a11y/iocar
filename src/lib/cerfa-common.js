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

// v8.171 — Les gabarits plats (13750*07, 15776*02) sont encodés en WinAnsi :
// un caractère hors de ce jeu ferait échouer pdf-lib au dessin. On
// translittère plutôt que d'échouer sur un nom d'entreprise exotique.
export function winAnsi(str) {
  return String(str == null ? "" : str)
    .replace(/[œ]/g, "oe").replace(/[Œ]/g, "OE")
    .replace(/[æ]/g, "ae").replace(/[Æ]/g, "AE")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/[  ]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\xFF]/g, "");
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

// v8.168 — Découpe une adresse libre en voie / code postal / commune, et
// recompose au format canonique de l'application :
//
//     809 avenue du Languedoc
//     12100 Millau
//
// C'est ce format que tout le reste attend déjà : parseAddress() ci-dessus
// pour les CERFA, parseGarageAddress() du pont IOBILL (qui cherche le code
// postal en DÉBUT de ligne), et l'affichage des factures. Une adresse tapée
// d'un seul tenant laissait « 12100 Millau » dans le nom de la voie du CERFA
// et partait à IOBILL sans code postal ni commune.
export function splitPostalAddress(addr) {
  const lines = String(addr || "").split("\n").map(l => l.trim()).filter(Boolean);
  const others = (skip) => lines.filter((_, j) => j !== skip).join("\n");

  // 1) Ligne « 12100 MILLAU » isolée — le format déjà canonique. La commune ne
  //    doit pas contenir d'autre code postal, sinon « 10000 route de Nîmes
  //    13000 Marseille » se lirait comme le CP 10000 suivi d'une commune.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{5})\s+(.+)$/);
    if (m && !/\d{5}/.test(m[2])) return { rue: others(i), cp: m[1], ville: m[2].trim() };
  }

  const last = lines[lines.length - 1] || "";
  // Une virgule séparait souvent la voie du code postal (« 12 rue de la Paix,
  // 13000 Marseille ») : elle n'a plus lieu d'être une fois la coupure faite.
  const head = (reste) => [...lines.slice(0, -1), reste.trim().replace(/[\s,;]+$/, "")]
    .filter(Boolean).join("\n");

  // 2) « … 12100 Millau » en fin de ligne. Quantificateur gourmand : sur une
  //    voie qui commence par cinq chiffres (« 10000 route de X 13000 Nîmes »),
  //    c'est bien le dernier groupe qui est retenu comme code postal.
  const m2 = last.match(/^(.*)[\s,]+(\d{5})\s+(.+)$/);
  if (m2 && !/^\d+$/.test(m2[3].trim())) {
    return { rue: head(m2[1]), cp: m2[2], ville: m2[3].trim() };
  }

  // 3) Code postal seul en fin de ligne, commune non saisie.
  const m3 = last.match(/^(.*)[\s,]+(\d{5})$/);
  if (m3) return { rue: head(m3[1]), cp: m3[2], ville: "" };

  return { rue: lines.join("\n"), cp: "", ville: "" };
}

// Adresse d'une partie du CERFA (garage, client, fournisseur, contact saisi à
// la volée) : quand le code postal et la commune sont saisis dans leurs propres
// champs, ils font foi, et on ne garde de la ligne libre que la voie — sinon un
// « 13000 Marseille » resté en bout de ligne repartirait dans « nom de la voie ».
// Sans ces champs, on retombe exactement sur parseAddress().
export function parseAddressOf(p) {
  const cp = String(p?.code_postal || "").trim();
  const ville = String(p?.ville || "").trim();
  const libre = String(p?.adresse ?? p?.address ?? "");
  if (!cp && !ville) return parseAddress(libre);
  const decoupe = splitPostalAddress(libre);
  const base = parseAddress(decoupe.rue || libre);
  return {
    ...base,
    cp: cp || decoupe.cp || base.cp,
    ville: ville || decoupe.ville || base.ville,
  };
}

export function joinPostalAddress({ rue, cp, ville }) {
  const voie = String(rue || "").trim();
  const bas = [String(cp || "").trim(), String(ville || "").trim()].filter(Boolean).join(" ");
  return [voie, bas].filter(Boolean).join("\n");
}

// v8.172 — N° de formule du certificat d'immatriculation.
//
// Il s'écrit « 2024 AB 12345 » sur la carte grise, mais les deux premiers
// chiffres sont invariants : le CERFA 15776 les imprime déjà dans les deux
// premières cases de son peigne, et la Flotte fait pareil avec un préfixe
// « 20 » posé à côté du champ. On ne stocke donc que les 9 caractères qui
// suivent — 2 chiffres d'année, 2 lettres, 5 chiffres.
//
// La saisie est tolérante : espaces, tirets et minuscules acceptés, et un
// numéro tapé en entier (11 caractères commençant par « 20 ») voit son
// préfixe retiré plutôt que d'être tronqué par la fin.
export function cleanFormule(value) {
  const s = String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const sansPrefixe = s.length === 11 && s.startsWith("20") ? s.slice(2) : s;
  return sansPrefixe.slice(0, 9);
}

// Regroupement 2-2-5, comme sur la carte grise, pour la relecture à l'écran.
export function formatFormule(value) {
  const s = cleanFormule(value);
  return [s.slice(0, 2), s.slice(2, 4), s.slice(4)].filter(Boolean).join(" ");
}

// Numéro complet, pour les documents qui n'impriment pas le « 20 » eux-mêmes
// (le 13750*07 ne l'a que sur une ligne libre). Vide si rien n'est saisi.
export function formuleComplete(value) {
  const s = cleanFormule(value);
  return s ? "20" + s : "";
}

// v8.173 — Nom du fichier téléchargé pour un CERFA : type de document,
// immatriculation et partie concernée, pour retrouver la pièce dans un dossier
// sans avoir à l'ouvrir. Les accents et la ponctuation sautent — un nom de
// fichier voyage entre macOS, Windows et les pièces jointes — et chaque
// morceau est borné pour ne pas produire un nom à rallonge.
export function nomFichierCerfa(...morceaux) {
  const propres = morceaux
    .map(m => String(m || "")
      // Les ligatures ne se décomposent pas en NFD : « Sætre » deviendrait
      // « S-tre ». On les translittère avant de retirer les accents.
      .replace(/œ/g, "oe").replace(/Œ/g, "OE")
      .replace(/æ/g, "ae").replace(/Æ/g, "AE").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40))
    .filter(Boolean);
  return (propres.join("_") || "cerfa") + ".pdf";
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
