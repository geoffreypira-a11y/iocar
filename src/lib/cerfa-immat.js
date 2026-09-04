// ═══════════════════════════════════════════════════════════════════
// CERFA 13750*07 — Demande de certificat d'immatriculation d'un véhicule
//
// Contrairement aux CERFA 15776 (cession) et 13757*03 (mandat), ce
// formulaire est DIFFUSÉ À PLAT : aucun champ AcroForm, aucune couche XFA.
// On ne peut donc pas le remplir par nom de champ — les valeurs sont
// dessinées aux coordonnées du gabarit (A4, 595.276 × 841.89 pt, origine
// en bas à gauche).
//
// Les coordonnées ci-dessous ont été relevées sur le gabarit officiel :
// position des libellés (couche texte) et des peignes de cases (traits
// verticaux), puis contrôlées sur un rendu du document rempli.
// ═══════════════════════════════════════════════════════════════════

import { splitDate } from "./cerfa-common.js";

// Cases à cocher de l'en-tête « Veuillez cocher la case correspondante ».
export const NATURES_DEMANDE = [
  { value: "certificat", label: "Certificat", box: [148.2, 760.1] },
  { value: "duplicata", label: "Duplicata", box: [208.9, 760.1] },
  { value: "correction", label: "Correction", box: [271.1, 760.1] },
  { value: "domicile", label: "Changement de domicile", box: [337.3, 760.1] },
  { value: "etat_civil", label: "Changement d'état civil ou matrimonial", box: [81.3, 744.4] },
  { value: "caracteristiques", label: "Changement des caractéristiques techniques", box: [280.3, 744.4] },
];

// Peignes de cases : centre de chaque case, de gauche à droite.
const CELLS = {
  dateAchat: { jour: [172.3, 186.5], mois: [203.5, 217.7], annee: [235.0, 249.1, 263.3, 277.5], y: 706 },
  dateMec:   { jour: [448.3, 462.5], mois: [479.5, 493.7], annee: [511.0, 525.1, 539.3, 553.5], y: 706 },
  // Le peigne SIRET est peu profond (dents de ~4 pt au-dessus du trait) :
  // les chiffres se posent sur le trait, en corps 7.
  siret:     { x: [408.0, 419.3, 430.6, 441.9, 453.3, 464.6, 475.9, 487.3, 498.7, 510.0, 521.3, 532.6, 544.0, 555.4], y: 540.5, size: 7 },
  codePostal:{ x: [89.4, 100.8, 112.1, 123.4, 134.8], y: 440, size: 7 },
};

// Champs texte libres : [x, ligne de base, largeur utile, corps].
// Les lignes du cadre « Domicile » sont serrées (≈ 8 pt entre le trait et le
// libellé de la ligne du dessus) : elles se remplissent en corps 7.
const TEXT = {
  immatriculation:  [40, 706, 100, 9],
  numeroFormule:    [40, 676, 145, 9],
  marque:           [40, 655, 166, 9],
  denomination:     [224, 655, 90, 9],
  typeVariante:     [40, 633, 276, 9],
  vin:              [40, 612, 166, 8.5],
  genre:            [224, 612, 90, 9],
  identite:         [76, 524, 302, 9],
  nomUsage:         [392, 524, 168, 9],
  domEtage:         [85, 487, 234, 8],
  domImmeuble:      [327, 487, 232, 8],
  voieNum:          [86, 471.3, 40, 7],
  voieExt:          [136, 471.3, 48, 7],
  voieType:         [192, 471.3, 76, 7],
  voieNom:          [278, 471.3, 280, 7],
  lieuDit:          [86, 456.4, 252, 7],
  tel:              [349, 456.4, 210, 7],
  commune:          [150, 440, 188, 7],
  mel:              [349, 440, 210, 7],
  faitA:            [57, 119.5, 55, 8],
  faitLe:           [118, 119.5, 55, 8],
};

// Cadre COULEUR DOMINANTE : carrés imprimés du gabarit, [x, y, largeur, hauteur].
// La couleur choisie est dessinée en dur (elle s'imprime partout) ; les cases
// non retenues restent de vraies cases AcroForm, cochables à la main dans le
// lecteur PDF — à condition d'imprimer depuis ce lecteur, une coche saisie à
// l'écran n'étant pas réinjectée dans le fichier généré.
export const COULEURS = [
  { key: "clair",  label: "Clair",  rect: [374.2, 619.4, 5.7, 6.0] },
  { key: "fonce",  label: "Foncé",  rect: [374.2, 595.2, 5.7, 6.0] },
  { key: "noir",   label: "Noir",   rect: [421.0, 628.7, 6.4, 7.0] },
  { key: "marron", label: "Marron", rect: [421.0, 615.5, 6.4, 7.0] },
  { key: "rouge",  label: "Rouge",  rect: [421.0, 601.9, 6.4, 7.0] },
  { key: "orange", label: "Orange", rect: [421.0, 588.2, 6.4, 7.0] },
  { key: "jaune",  label: "Jaune",  rect: [466.6, 628.7, 6.4, 7.0] },
  { key: "vert",   label: "Vert",   rect: [466.6, 615.5, 6.4, 7.0] },
  { key: "bleu",   label: "Bleu",   rect: [466.6, 601.9, 6.4, 7.0] },
  { key: "beige",  label: "Beige",  rect: [466.6, 588.2, 6.4, 7.0] },
  { key: "gris",   label: "Gris",   rect: [509.8, 628.7, 6.7, 7.0] },
  { key: "blanc",  label: "Blanc",  rect: [509.8, 615.5, 6.7, 7.0] },
];

// Teintes (colonne de gauche du cadre), indépendantes de la couleur.
export const TEINTES = COULEURS.filter(c => c.key === "clair" || c.key === "fonce");
// Les douze couleurs proprement dites.
export const TONS = COULEURS.filter(c => c.key !== "clair" && c.key !== "fonce");

// « GRIS CLAIR », « Bleu foncé », « BLANC NACRE »… : la couleur du SIV est du
// texte libre. On en extrait la case du CERFA (et la teinte quand elle y est).
function normalise(str) {
  return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}
const SYNONYMES = { ARGENT: "gris", ARGENTE: "gris", ANTHRACITE: "gris", IVOIRE: "beige", CREME: "beige" };

export function couleurKey(libelle) {
  const s = normalise(libelle);
  if (!s) return "";
  for (const c of TONS) if (s.includes(normalise(c.label))) return c.key;
  for (const [mot, key] of Object.entries(SYNONYMES)) if (s.includes(mot)) return key;
  return "";
}

export function teinteKey(libelle) {
  const s = normalise(libelle);
  if (/\bCLAIR/.test(s)) return "clair";
  if (/\bFONCE|\bSOMBRE/.test(s)) return "fonce";
  return "";
}

// Cases « Personne physique / Sexe / Personne morale » du cadre TITULAIRE.
const CHECK = {
  physique: [206.8, 538.9],
  sexeM: [260.3, 538.9],
  sexeF: [284.2, 538.9],
  morale: [365.5, 538.9],
};

// Helvetica standard n'encode que WinAnsi : on retire ce qui n'y entre pas
// (le PDF échouerait à l'enregistrement sur un caractère hors jeu).
function winAnsi(str) {
  return String(str == null ? "" : str)
    .replace(/[œ]/g, "oe").replace(/[Œ]/g, "OE")
    .replace(/[æ]/g, "ae").replace(/[Æ]/g, "AE")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/[  ]/g, " ")
    .replace(/[^\x20-\xFF]/g, "");
}

/**
 * Remplit le CERFA 13750*07 et renvoie les octets du PDF.
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes  gabarit /cerfa_1375007.pdf
 * @param {object} PDFLib                    module pdf-lib (CDN ou npm)
 * @param {object} data                      données du formulaire
 */
export async function fillCerfaImmat(pdfBytes, PDFLib, data) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.getPage(0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.11, 0.45); // bleu stylo, pour distinguer du gabarit

  // Écrit une valeur, en la rétrécissant si elle déborde de la largeur utile.
  function text(key, value, opts = {}) {
    const v = winAnsi(value).trim();
    if (!v || !TEXT[key]) return;
    const [x, y, maxW, base] = TEXT[key];
    let size = opts.size || base || 9;
    while (size > 4.5 && font.widthOfTextAtSize(v, size) > maxW) size -= 0.5;
    page.drawText(v, { x, y, size, font, color: ink });
  }

  // Répartit une suite de caractères dans un peigne de cases.
  function cells(centers, value, y, size = 9) {
    const v = winAnsi(value).replace(/\s/g, "");
    for (let i = 0; i < centers.length && i < v.length; i++) {
      const ch = v[i];
      page.drawText(ch, { x: centers[i] - font.widthOfTextAtSize(ch, size) / 2, y, size, font, color: ink });
    }
  }

  function check(pos, size = 8) {
    if (!pos) return;
    page.drawText("X", { x: pos[0] + 1, y: pos[1] + 0.5, size, font: bold, color: ink });
  }

  // ── Nature de la demande ──
  const nature = NATURES_DEMANDE.find(n => n.value === data.nature) || NATURES_DEMANDE[0];
  check(nature.box);

  // ── Cadre VÉHICULE ──
  const v = data.vehicule || {};
  text("immatriculation", v.plate);
  text("numeroFormule", v.numero_formule);
  text("marque", v.marque);
  text("denomination", v.modele);
  text("typeVariante", v.finition);
  text("vin", v.vin);
  text("genre", v.genre || "VP");

  const mec = splitDate(v.date_mec);
  if (mec) {
    cells(CELLS.dateMec.jour, mec.jour, CELLS.dateMec.y);
    cells(CELLS.dateMec.mois, mec.mois, CELLS.dateMec.y);
    cells(CELLS.dateMec.annee, mec.annee, CELLS.dateMec.y);
  }
  const achat = splitDate(data.dateAchat);
  if (achat) {
    cells(CELLS.dateAchat.jour, achat.jour, CELLS.dateAchat.y);
    cells(CELLS.dateAchat.mois, achat.mois, CELLS.dateAchat.y);
    cells(CELLS.dateAchat.annee, achat.annee, CELLS.dateAchat.y);
  }

  // ── Cadre TITULAIRE ──
  const t = data.titulaire || {};
  check(t.isMorale ? CHECK.morale : CHECK.physique);
  if (!t.isMorale) {
    if (t.civilite === "M") check(CHECK.sexeM);
    if (t.civilite === "F") check(CHECK.sexeF);
  }
  text("identite", t.identite);
  if (t.siret) cells(CELLS.siret.x, String(t.siret).replace(/\D/g, ""), CELLS.siret.y, CELLS.siret.size);

  const a = t.adresse || {};
  text("domEtage", a.etage);
  text("domImmeuble", a.immeuble);
  text("voieNum", a.num);
  text("voieExt", a.ext);
  text("voieType", a.type);
  text("voieNom", a.nom);
  text("lieuDit", a.lieuDit);
  text("commune", a.ville);
  if (a.cp) cells(CELLS.codePostal.x, a.cp, CELLS.codePostal.y, CELLS.codePostal.size);
  text("tel", t.tel);
  text("mel", t.email);

  // ── Couleur dominante ──
  // Ce que le garage a choisi dans IOCAR est dessiné : une coche dessinée
  // s'imprime toujours, alors qu'une case cochée à l'écran dans l'aperçu ne
  // revient pas dans le fichier. Les autres cases restent des cases AcroForm
  // sans fond ni bordure — le carré du gabarit reste visible — pour pouvoir
  // compléter à la main dans le lecteur PDF avant impression.
  const choisies = new Set([data.couleur, data.teinte].filter(Boolean));
  const form = doc.getForm();
  for (const c of COULEURS) {
    const [x, y, width, height] = c.rect;
    if (choisies.has(c.key)) {
      // Coche dessinée, centrée dans le carré du gabarit.
      const size = height + 1;
      page.drawText("X", {
        x: x + (width - bold.widthOfTextAtSize("X", size)) / 2,
        y: y + 1,
        size, font: bold, color: ink,
      });
      continue;
    }
    const box = form.createCheckBox(`couleur_${c.key}`);
    box.addToPage(page, {
      x, y, width, height,
      textColor: ink,
      backgroundColor: undefined,
      borderColor: undefined,
      borderWidth: 0,
    });
  }

  // ── Signature du titulaire ──
  text("faitA", data.faitA);
  const fait = splitDate(data.faitLe);
  if (fait) text("faitLe", `${fait.jour}/${fait.mois}/${fait.annee}`);

  return doc.save();
}
