// ═══════════════════════════════════════════════════════════════════
// CERFA 15776*02 — Certificat de cession d'un véhicule d'occasion
//
// v8.171 — Le 15776*02 remplace le *01. Contrairement à lui, il n'est diffusé
// qu'en PDF plat : aucun formulaire AcroForm à remplir. On y écrit donc le
// texte aux coordonnées du gabarit, comme sur le 13750*07.
//
// Toutes les positions ci-dessous sont MESURÉES sur le gabarit lui-même :
// les traits (lignes d'écriture, dents de peigne) proviennent du flux de
// contenu de la page, les cases à cocher de la position de leur glyphe. Elles
// ne sont pas déduites du *01 — sa mise en page est proche mais pas
// identique : « Personne physique » est devenu « Personne physique ou
// entreprise individuelle », ce qui a décalé les cases Sexe M / F de 99 pt.
//
// Repère PDF : origine en bas à gauche, page A4 595,276 × 841,89 pt.
// Les deux pages (exemplaire ancien / nouveau propriétaire) sont
// géométriquement identiques — vérifié sur 48 libellés communs, écart nul —
// et reçoivent donc le même contenu.
// ═══════════════════════════════════════════════════════════════════

import { winAnsi } from "./cerfa-common.js";

// ─── Champs à cases (peignes) ────────────────────────────────────
// x0 = première dent, pas = largeur d'une case, n = nombre de cases.
// La ligne de base est calée un peu au-dessus du bas des dents.
const CELLS = {
  immat:        { x0: 35.76, pas: 14.17, n:  9, y: 722.0 },
  vin:          { x0: 173.76, pas: 14.17, n: 17, y: 722.0 },
  mecJour:      { x0: 440.76, pas: 11.34, n:  2, y: 722.0 },
  mecMois:      { x0: 466.44, pas: 11.34, n:  2, y: 722.0 },
  mecAnnee:     { x0: 492.12, pas: 11.34, n:  4, y: 722.0 },
  // Les deux premières cases portent « 2 0 », imprimé sur le gabarit : le
  // peigne en compte 11, on n'écrit que dans les 9 libres.
  formule:      { x0: 170.66, pas: 14.17, n:  9, y: 643.9 },
  certifJour:   { x0: 222.52, pas: 11.34, n:  2, y: 622.3 },
  certifMois:   { x0: 248.19, pas: 11.34, n:  2, y: 622.3 },
  certifAnnee:  { x0: 273.87, pas: 11.34, n:  4, y: 622.3 },

  siretV:       { x0: 394.77, pas: 11.34, n: 14, y: 545.1 },
  cpV:          { x0: 107.77, pas: 14.17, n:  5, y: 493.9 },
  venteJour:    { x0: 47.03, pas: 11.34, n:  2, y: 451.8 },
  venteMois:    { x0: 72.71, pas: 11.34, n:  2, y: 451.8 },
  venteAnnee:   { x0: 98.38, pas: 11.34, n:  4, y: 451.8 },
  venteH1:      { x0: 153.13, pas: 11.34, n:  2, y: 451.8 },
  venteH2:      { x0: 187.11, pas: 11.34, n:  2, y: 451.8 },

  siretA:       { x0: 394.77, pas: 11.34, n: 14, y: 213.2 },
  naissJour:    { x0: 70.97, pas: 11.34, n:  2, y: 191.2 },
  naissMois:    { x0: 96.65, pas: 11.34, n:  2, y: 191.2 },
  naissAnnee:   { x0: 122.33, pas: 11.34, n:  4, y: 191.2 },
  cpA:          { x0: 107.77, pas: 14.17, n:  5, y: 149.6 },
};

// ─── Champs libres (une ligne d'écriture) ────────────────────────
// x = début du texte, y = ligne de base, w = largeur utile (le texte trop
// long est réduit plutôt que débordant, un CERFA ne se relit pas autrement).
const TEXT = {
  marque:       { x: 37.5, y: 698.0, w: 126 },
  typeVariante: { x: 176.5, y: 698.0, w: 130 },
  genre:        { x: 323.5, y: 698.0, w: 107 },
  denomination: { x: 443.5, y: 698.0, w: 113 },
  kilometrage:  { x: 208.5, y: 673.1, w:  62 },
  motifAbsence: { x: 339.0, y: 623.0, w: 218 },

  identiteV:    { x:  91.5, y: 545.1, w: 283 },
  voieV:        { x: 109.5, y: 513.9, w:  39 },
  extensionV:   { x: 158.0, y: 513.9, w:  39 },
  typeVoieV:    { x: 206.5, y: 513.9, w:  68 },
  nomVoieV:     { x: 283.5, y: 513.9, w: 274 },
  communeV:     { x: 192.5, y: 493.9, w: 365 },
  agrement:     { x: 140.5, y: 368.4, w: 105 },
  lieuDeclV:    { x:  65.5, y: 327.2, w: 113 },
  dateDeclV:    { x: 195.5, y: 327.2, w:  82 },

  identiteA:    { x:  91.5, y: 213.2, w: 283 },
  lieuNaissA:   { x: 184.0, y: 191.2, w: 374 },
  voieA:        { x: 109.5, y: 169.6, w:  39 },
  extensionA:   { x: 158.0, y: 169.6, w:  39 },
  typeVoieA:    { x: 206.5, y: 169.6, w:  68 },
  nomVoieA:     { x: 283.5, y: 169.6, w: 274 },
  communeA:     { x: 192.5, y: 149.6, w: 365 },
  lieuDeclA:    { x:  65.5, y:  73.5, w: 113 },
  dateDeclA:    { x: 195.5, y:  73.5, w:  82 },
};

// ─── Cases à cocher ──────────────────────────────────────────────
// Position du glyphe « ❑ » du gabarit, côté 8 pt (12 pt pour la dernière).
const BOXES = {
  certifOui:    { x: 35.51, y: 640.17, c: 8 },
  certifNon:    { x: 337.54, y: 642.85, c: 8 },

  vPhysique:    { x: 35.52, y: 571.81, c: 8 },
  vMorale:      { x: 35.52, y: 561.81, c: 8 },
  vSexeM:       { x: 278.85, y: 571.81, c: 8 },
  vSexeF:       { x: 302.71, y: 571.81, c: 8 },
  ceder:        { x: 184.87, y: 465.8, c: 8 },
  cederDetruire:{ x: 235.89, y: 465.8, c: 8 },
  vDecl1:       { x: 35.52, y: 416.54, c: 8 },
  vDecl2:       { x: 35.52, y: 396.94, c: 8 },
  vDecl3:       { x: 35.52, y: 377.34, c: 8 },

  aPhysique:    { x: 35.52, y: 239.90, c: 8 },
  aMorale:      { x: 35.52, y: 229.90, c: 8 },
  aSexeM:       { x: 278.85, y: 239.90, c: 8 },
  aSexeF:       { x: 302.71, y: 239.90, c: 8 },
  aDecl1:       { x: 35.52, y: 109.03, c: 8 },
  aDecl2:       { x: 35.52, y: 96.20, c: 8 },

  opposition:   { x: 508.54, y: 11.15, c: 12 },
};

export async function fillCerfaCession(pdfBytes, PDFLib, data) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const noir = rgb(0, 0, 0);
  const pages = doc.getPages();

  const dessine = (page) => {
    // Texte libre, réduit s'il dépasse la largeur du champ.
    const txt = (clef, valeur, taille = 9) => {
      const f = TEXT[clef];
      const v = winAnsi(valeur).trim();
      if (!f || !v) return;
      let t = taille;
      while (t > 5 && font.widthOfTextAtSize(v, t) > f.w) t -= 0.25;
      page.drawText(v, { x: f.x, y: f.y, size: t, font, color: noir });
    };

    // Un caractère par case, centré dans sa case.
    const cases = (clef, valeur, taille = 9) => {
      const c = CELLS[clef];
      const v = winAnsi(valeur).replace(/\s/g, "");
      if (!c || !v) return;
      for (let i = 0; i < Math.min(v.length, c.n); i++) {
        const ch = v[i];
        const x = c.x0 + c.pas * i + (c.pas - font.widthOfTextAtSize(ch, taille)) / 2;
        page.drawText(ch, { x, y: c.y, size: taille, font, color: noir });
      }
    };

    // Croix inscrite dans la case du gabarit.
    const coche = (clef) => {
      const b = BOXES[clef];
      if (!b) return;
      const taille = b.c * 0.95;
      const l = gras.widthOfTextAtSize("X", taille);
      page.drawText("X", {
        x: b.x + (b.c - l) / 2,
        y: b.y + (b.c - taille * 0.72) / 2,
        size: taille, font: gras, color: noir,
      });
    };

    const v = data.vehicule || {};
    const A = data.vendeur || {};      // ancien propriétaire
    const B = data.acquereur || {};    // nouveau propriétaire

    // ── Véhicule ──
    cases("immat", v.plate);
    cases("vin", v.vin);
    if (v.mec) { cases("mecJour", v.mec.jour); cases("mecMois", v.mec.mois); cases("mecAnnee", v.mec.annee); }
    txt("marque", v.marque);
    txt("typeVariante", v.typeVariante);
    txt("genre", v.genre || "VP");
    txt("denomination", v.modele);
    txt("kilometrage", v.kilometrage);

    // Présence du certificat : n° de formule, ou motif d'absence.
    // Le gabarit imprime déjà « 2 0 » dans les deux premières cases, et la
    // Flotte le présente pareil : son champ affiche « 20 » en préfixe fixe et
    // ne stocke que les 9 caractères suivants. La valeur s'écrit donc telle
    // quelle, dans les 9 cases libres — surtout pas amputée d'un « 20 » qui
    // n'y est pas (un n° de formule « 20AB12345 » y perdrait son début).
    if (v.formule) { coche("certifOui"); cases("formule", v.formule); }
    else if (v.dateCertificat) {
      coche("certifOui");
      cases("certifJour", v.dateCertificat.jour);
      cases("certifMois", v.dateCertificat.mois);
      cases("certifAnnee", v.dateCertificat.annee);
    } else if (v.motifAbsence) { coche("certifNon"); txt("motifAbsence", v.motifAbsence); }

    // ── Ancien propriétaire ──
    coche(A.isMorale ? "vMorale" : "vPhysique");
    if (!A.isMorale && (A.sexe === "M" || A.sexe === "F")) coche(A.sexe === "F" ? "vSexeF" : "vSexeM");
    txt("identiteV", A.identite);
    cases("siretV", A.siret);
    txt("voieV", A.adresse?.num);
    txt("extensionV", A.adresse?.ext);
    txt("typeVoieV", A.adresse?.type);
    txt("nomVoieV", A.adresse?.nom);
    cases("cpV", A.adresse?.cp);
    txt("communeV", A.adresse?.ville);

    coche(data.pourDestruction ? "cederDetruire" : "ceder");
    if (data.dateCession) {
      cases("venteJour", data.dateCession.jour);
      cases("venteMois", data.dateCession.mois);
      cases("venteAnnee", data.dateCession.annee);
    }
    if (data.heureCession) {
      cases("venteH1", data.heureCession.h);
      cases("venteH2", data.heureCession.min);
    }
    // Les deux premières déclarations sont celles que le vendeur atteste dans
    // une cession ordinaire ; la troisième ne vaut que pour une destruction.
    coche("vDecl1");
    coche("vDecl2");
    if (data.pourDestruction) { coche("vDecl3"); txt("agrement", data.agrementVHU); }
    txt("lieuDeclV", A.lieu);
    txt("dateDeclV", data.dateDeclaration);

    // ── Nouveau propriétaire ──
    coche(B.isMorale ? "aMorale" : "aPhysique");
    if (!B.isMorale && (B.sexe === "M" || B.sexe === "F")) coche(B.sexe === "F" ? "aSexeF" : "aSexeM");
    txt("identiteA", B.identite);
    cases("siretA", B.siret);
    if (B.naissance) {
      cases("naissJour", B.naissance.jour);
      cases("naissMois", B.naissance.mois);
      cases("naissAnnee", B.naissance.annee);
    }
    txt("lieuNaissA", B.lieuNaissance);
    txt("voieA", B.adresse?.num);
    txt("extensionA", B.adresse?.ext);
    txt("typeVoieA", B.adresse?.type);
    txt("nomVoieA", B.adresse?.nom);
    cases("cpA", B.adresse?.cp);
    txt("communeA", B.adresse?.ville);
    coche("aDecl1");
    coche("aDecl2");
    txt("lieuDeclA", B.lieu || A.lieu);
    txt("dateDeclA", data.dateDeclaration);
  };

  // Exemplaire 1 (ancien propriétaire) et 2 (nouveau) : même contenu.
  for (const page of pages) dessine(page);
  return doc.save();
}
