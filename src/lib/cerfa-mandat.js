// ═══════════════════════════════════════════════════════════════════
// CERFA 13757*03 — Mandat d'immatriculation d'un véhicule
//
// Le gabarit porte un formulaire AcroForm doublé d'une couche XFA : celle-ci
// masque les valeurs AcroForm dans certains lecteurs, on la retire donc avant
// de remplir.
// ═══════════════════════════════════════════════════════════════════

import { parseAddress, buildIdentite, splitDate } from "./cerfa-common.js";

/**
 * Remplit le mandat 13757*03 et renvoie les octets du PDF.
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes  gabarit /cerfa_1375703.pdf
 * @param {object} PDFLib                    module pdf-lib
 * @param {object} data
 *   - mandant     partie qui donne mandat  (isMorale, identite, nom, prenom, siret, adresse)
 *   - mandataire  partie qui fait les démarches
 *   - vehicule    { plate, marque, vin }
 *   - nature      nature de l'opération (« Immatriculation », …)
 *   - lieu        lieu de signature (défaut : commune du mandant)
 *   - date        jj/mm/aaaa ou aaaa-mm-jj
 */
export async function fillCerfaMandat(pdfBytes, PDFLib, data) {
  const { PDFDocument, PDFName } = PDFLib;
  const doc = await PDFDocument.load(pdfBytes);
  try {
    const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
    if (acro && acro.delete) acro.delete(PDFName.of("XFA"));
  } catch (e) {}

  const form = doc.getForm();
  const setText = (n, v) => { if (!v) return; try { form.getTextField(n).setText(String(v)); } catch (e) {} };
  const setCheck = (n) => { try { form.getCheckBox(n).check(); } catch (e) {} };

  const pre = "topmostSubform[0].Page1[0].";
  const M1 = data.mandant || {};
  const M2 = data.mandataire || {};
  const veh = data.vehicule || {};
  const mA = parseAddress(M1.adresse);
  const d = splitDate(data.date) || { jour: "", mois: "", annee: "" };

  // Mandant
  setText(pre + "txt_IdentitéMandant[0]", buildIdentite(M1));
  if (M1.siret) setText(pre + "num_SIRETMandant[0]", String(M1.siret).replace(/\s/g, ""));
  setText(pre + "num_VoieAdresse[0]", mA.num);
  setText(pre + "txt_ExtensionAdresse[0]", mA.ext);
  setText(pre + "txt_TypeVoieAdresse[0]", mA.type);
  setText(pre + "txt_NomVoieAdresse[0]", mA.nom);
  setText(pre + "num_CodePostalAdresse[0]", mA.cp);
  setText(pre + "txt_CommuneAdresse[0]", mA.ville);
  setText(pre + "txt_PaysAdresse[0]", "France");
  // Mandataire
  setText(pre + "txt_IdentitéMandataire[0]", buildIdentite(M2));
  if (M2.siret) setText(pre + "num_SIRETMandataire[0]", String(M2.siret).replace(/\s/g, ""));
  // Opération + véhicule
  setText(pre + "txt_NatureOpération[0]", data.nature);
  setText(pre + "txt_MarqueVéhicule[0]", veh.marque);
  setText(pre + "txt_NumVinVéhicule[0]", veh.vin);
  setText(pre + "txt_MarqueImmatriculation[0]", veh.plate);
  // Lieu + date + confirmation
  setText(pre + "txt_LieuDéclaration[0]", data.lieu || mA.ville);
  setText(pre + "num_DateJourDéclaration[0]", d.jour);
  setText(pre + "num_DateMoisDéclaration[0]", d.mois);
  setText(pre + "num_DateAnnéeDéclaration[0]", d.annee);
  // ⚠ Les deux cases du gabarit portent des noms inversés par rapport à leur
  // position : « ckb_OppositionUtilisationDonnées » dessine la coche du
  // « Je suis informé(e) [de] l'obligation de l'assurer » que le mandant
  // confirme, et « ckb_ConfirmationInformation » celle de l'opposition à la
  // prospection commerciale — qui, elle, reste au choix du client.
  setCheck(pre + "ckb_OppositionUtilisationDonnées[0]");

  return doc.save();
}
