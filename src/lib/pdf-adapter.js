// IO CAR - Adapter pour utiliser pdf-builder-client (copie IOBILL)
// Convertit un order IOCAR + garage → format attendu par buildDocumentPdf.
// Types supportés : BC (bon de commande) → docType='quote', factures, avoirs.

import { ensurePdfLibLoaded, buildDocumentPdf } from "./pdf-builder-client.js";

// Calcule les totaux d'un order IOCAR (repris de la logique existante)
function calcOrderTotals(o) {
  const prixVente = parseFloat(o.prix_vente_ttc) || 0;
  const remAmt = parseFloat(o.remise_ttc) || 0;
  const prixApresRemise = prixVente - remAmt;
  const fraisMiseDispo = parseFloat(o.frais_mise_dispo) || 0;
  const carteGrise = parseFloat(o.carte_grise) || 0;
  const avecTva = o.avec_tva !== false;
  const tvaPct = parseFloat(o.tva_pct) || 20;

  const montantTTC_soumis = prixApresRemise + fraisMiseDispo;
  let ht, tvaAmt;
  if (avecTva) {
    ht = montantTTC_soumis / (1 + tvaPct / 100);
    tvaAmt = montantTTC_soumis - ht;
  } else {
    ht = montantTTC_soumis;
    tvaAmt = 0;
  }
  const repriseValeur = o.reprise_active ? (parseFloat(o.reprise_valeur) || 0) : 0;
  const ttc = montantTTC_soumis + carteGrise - repriseValeur;

  const acompteTtc = o.type === "avoir" ? 0 : (parseFloat(o.acompte_ttc) || 0);
  const paiementsTotal = (Array.isArray(o.paiements) ? o.paiements : [])
    .reduce((s, p) => s + (parseFloat(p.montant) || 0), 0);
  const encaisse = acompteTtc + paiementsTotal;
  const reste = ttc - encaisse;

  const sign = o.type === "avoir" ? -1 : 1;
  return {
    ht: ht * sign,
    remAmt,
    baseHT: prixApresRemise,
    fraisMiseDispo,
    carteGrise,
    repriseValeur,
    montantTTC_soumis,
    tvaAmt: tvaAmt * sign,
    ttc: ttc * sign,
    encaisse,
    reste,
    avecTva,
    tvaPct
  };
}

// Convertit un order + garage IOCAR en format IOBILL
export function orderToIobillFormat(order, garage) {
  const o = order;
  const g = garage || {};
  const v = o.vehicle_data || {};
  const c = o.client_data || {};
  const calc = calcOrderTotals(o);

  const docType =
    o.type === "avoir" ? "credit_note"
    : o.type === "bc" || o.type === "bon_commande" ? "quote"
    : "invoice";

  // Détermine la garantie (comme dans iobill-bridge)
  const garantieMois = o.garantie_mois || 0;

  // Nom client
  const clientName = c.type === "societe"
    ? (c.raison_sociale || c.nom || "")
    : `${c.prenom || ""} ${c.nom || ""}`.trim();

  // Adresse client
  const addrParts = [];
  if (c.adresse) addrParts.push(c.adresse);
  const cpVille = [c.cp, c.ville].filter(Boolean).join(" ");
  if (cpVille) addrParts.push(cpVille);
  if (c.pays) addrParts.push(c.pays);
  const clientAddress = addrParts.join("\n");

  // Snapshot client au format IOBILL
  const clientSnapshot = {
    legal_name: clientName,
    email: c.email || "",
    phone: c.telephone || "",
    address_line1: c.adresse || "",
    postal_code: c.cp || "",
    city: c.ville || "",
    country: c.pays || "FR",
    siret: c.siret || null,
    vat_number: c.tva_intra || null
  };

  // Snapshot société au format IOBILL
  const companySnapshot = {
    legal_name: g.nom || g.raison_sociale || "Garage",
    email: g.email || "",
    phone: g.telephone || "",
    address_line1: g.adresse || "",
    postal_code: g.cp || "",
    city: g.ville || "",
    country: "FR",
    siret: g.siret || "",
    vat_number: g.tva_intra || "",
    // Passe le logo en base64 dans le champ logo_url (fetchLogoBytes le décode)
    logo_url: g.logo || null
  };

  // Company object avec les champs nécessaires
  const company = {
    ...companySnapshot,
    business_mode: "garage",           // Active l'encart véhicule
    source_app: "iocar",               // Active le filigrane logo
    brand_color: g.brand_color || null,
    business_mentions: g.business_mentions || null,
    business_type: g.business_type || "garage",
    vat_regime: calc.avecTva ? "standard" : "margin_297a"
  };

  // Lignes du document (en cents pour IOBILL)
  const lines = [];
  const vehicleLabel = [v.marque, v.modele, v.finition].filter(Boolean).join(" ") || "Véhicule";
  const vehiclePlate = v.plate || o.vehicle_plate || "";
  const desc1 = `VENTE VÉHICULE - ${vehicleLabel}${vehiclePlate ? " (" + vehiclePlate + ")" : ""}`;

  lines.push({
    designation: desc1,
    quantity: 1,
    unit: "u",
    unit_price_cents: Math.round(calc.baseHT * (calc.avecTva ? (1 / (1 + calc.tvaPct / 100)) : 1) * 100),
    vat_rate: calc.avecTva ? calc.tvaPct : 0,
    line_ht_cents: Math.round(calc.baseHT * (calc.avecTva ? (1 / (1 + calc.tvaPct / 100)) : 1) * 100)
  });

  if (calc.fraisMiseDispo > 0) {
    const fraisHt = calc.avecTva ? calc.fraisMiseDispo / (1 + calc.tvaPct / 100) : calc.fraisMiseDispo;
    lines.push({
      designation: "Frais de mise à disposition",
      quantity: 1,
      unit: "u",
      unit_price_cents: Math.round(fraisHt * 100),
      vat_rate: calc.avecTva ? calc.tvaPct : 0,
      line_ht_cents: Math.round(fraisHt * 100)
    });
  }

  // Débours (carte grise)
  const debours = [];
  if (calc.carteGrise > 0) {
    debours.push({ label: "Carte grise", amount_cents: Math.round(calc.carteGrise * 100) });
  }

  // Paiements (uniquement pour factures)
  const payments = docType === "invoice"
    ? (Array.isArray(o.paiements) ? o.paiements : []).map(p => ({
        method: p.mode || "virement",
        amount_cents: Math.round((parseFloat(p.montant) || 0) * 100),
        paid_at: p.date || null
      }))
    : [];

  // Le doc au format IOBILL
  const doc = {
    number: o.ref || `IOCAR-${String(o.id || "").slice(0, 8).toUpperCase()}`,
    issue_date: o.date_facture || o.date_creation || new Date().toISOString().slice(0, 10),
    status: docType === "invoice" ? (Math.abs(calc.reste) < 0.01 ? "paid" : "issued") : "issued",
    client_snapshot: clientSnapshot,
    company_snapshot: companySnapshot,
    business_mode: "garage",
    vat_regime: calc.avecTva ? "standard" : "margin_297a",
    subtotal_ht_cents: Math.round(Math.abs(calc.ht) * 100),
    vat_total_cents: Math.round(Math.abs(calc.tvaAmt) * 100),
    total_ttc_cents: Math.round(Math.abs(calc.ttc) * 100),
    paid_cents: Math.round(calc.encaisse * 100),
    debours: debours.length > 0 ? debours : null,
    payments,
    business_mentions: g.business_mentions || null,
    // Bloc VÉHICULE enrichi (v8.47)
    vehicle_meta: {
      plate: vehiclePlate,
      vin: v.vin || null,
      marque: v.marque || null,
      modele: v.modele || null,
      finition: v.finition || null,
      annee: v.annee || null,
      kilometrage: v.kilometrage || null,
      carburant: v.carburant || null,
      genre: v.genre || null,
      date_mise_en_circulation: v.date_mise_en_circulation || null,
      puissance_cv: v.puissance_cv || null,
      puissance_fiscale: v.puissance_fiscale || null,
      options: v.options || null,
      garantie_mois: garantieMois
    }
  };

  return { docType, doc, lines, company };
}

// Fonction principale : génère le PDF et déclenche le téléchargement OU l'aperçu
// Usage :
//   await generateAndDownload(order, garage, "preview") → ouvre dans un nouvel onglet
//   await generateAndDownload(order, garage, "download") → download direct
export async function generateAndDownload(order, garage, mode = "preview") {
  await ensurePdfLibLoaded();
  const { docType, doc, lines, company } = orderToIobillFormat(order, garage);
  const pdfDoc = await buildDocumentPdf({ docType, doc, lines, company });
  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const filename = `${docType === "quote" ? "BC" : docType === "credit_note" ? "Avoir" : "Facture"}_${doc.number.replace(/[^\w-]/g, "_")}.pdf`;

  if (mode === "download") {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    // Preview : ouvre dans un nouvel onglet
    window.open(url, "_blank");
  }
  // Libère la mémoire après quelques secondes
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
