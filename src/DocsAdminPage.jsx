import React, { useState, useMemo } from "react";
import { fillCerfaImmat, NATURES_DEMANDE, couleurKey, teinteKey, TONS, TEINTES } from "./lib/cerfa-immat.js";
import { fillCerfaMandat } from "./lib/cerfa-mandat.js";
import { loadPdfLib, parseAddress, buildIdentite } from "./lib/cerfa-common.js";

// ═══════════════════════════════════════════════════════════════════
// v8.139 — Onglet "Documents administratifs" (stand-alone)
// Génère un CERFA "à la carte" : cession 15776, mandat 13757*03 ou demande
// de certificat d'immatriculation 13750*07 — on choisit librement
// le VENDEUR et l'ACQUÉREUR (clients CRM en lecture seule + garage +
// fournisseurs dédiés + nouveau contact ponctuel), un véhicule (flotte
// ou saisie libre), une date/heure de cession.
//
// CLOISONNEMENT : n'écrit RIEN ailleurs. Seule écriture possible : ajouter
// un fournisseur à dealer.admin_fournisseurs (liste dédiée à cet onglet,
// JAMAIS mélangée aux clients CRM), et uniquement si la case est cochée.
// Le générateur CERFA est DUPLIQUÉ ici (pas de lien avec le tunnel de vente).
// ═══════════════════════════════════════════════════════════════════

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    }));

// Parser d'adresse française (version robuste v8.138).

// Construit "NOM Prénom" (particulier) ou "RAISON SOCIALE" (société).

const emptyContact = { type: "particulier", nom: "", prenom: "", raison: "", adresse: "", siret: "", civilite: "M", tel: "", email: "" };
const emptyVeh = { plate: "", vin: "", marque: "", modele: "", finition: "", genre: "VP", date_mec: "", kilometrage: "", numero_formule: "" };

// Formulaire d'un contact "Nouveau…" (au niveau module → référence stable,
// sinon l'input perdrait le focus à chaque frappe).
function NewContactForm({ value, onChange, showSave, saveChecked, onToggleSave }) {
  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: "var(--card2)", border: "1px solid var(--border2)" }}>
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Type</label>
          <select className="form-input" value={value.type} onChange={e => onChange({ ...value, type: e.target.value })}>
            <option value="particulier">Particulier</option>
            <option value="professionnel">Professionnel</option>
          </select>
        </div>
        {value.type === "professionnel" ? (
          <>
            <div className="form-group">
              <label className="form-label">Raison sociale</label>
              <input className="form-input" value={value.raison} onChange={e => onChange({ ...value, raison: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">SIRET</label>
              <input className="form-input" value={value.siret} onChange={e => onChange({ ...value, siret: e.target.value })} />
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">Nom</label>
              <input className="form-input" value={value.nom} onChange={e => onChange({ ...value, nom: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Prénom</label>
              <input className="form-input" value={value.prenom} onChange={e => onChange({ ...value, prenom: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Civilité</label>
              <select className="form-input" value={value.civilite} onChange={e => onChange({ ...value, civilite: e.target.value })}>
                <option value="M">M.</option>
                <option value="F">Mme</option>
              </select>
            </div>
          </>
        )}
        <div className="form-group full">
          <label className="form-label">Adresse</label>
          <input className="form-input" value={value.adresse} onChange={e => onChange({ ...value, adresse: e.target.value })} placeholder="12 rue de la Paix, 13000 Marseille" />
        </div>
        <div className="form-group">
          <label className="form-label">Téléphone</label>
          <input className="form-input" value={value.tel || ""} onChange={e => onChange({ ...value, tel: e.target.value })} placeholder="06 12 34 56 78" />
        </div>
        <div className="form-group">
          <label className="form-label">Mél</label>
          <input className="form-input" value={value.email || ""} onChange={e => onChange({ ...value, email: e.target.value })} placeholder="contact@exemple.fr" />
        </div>
      </div>
      {showSave && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={saveChecked} onChange={onToggleSave} />
          Enregistrer dans mes fournisseurs <span style={{ color: "var(--muted)", fontSize: 11 }}>(liste dédiée à cet onglet, jamais dans le CRM)</span>
        </label>
      )}
    </div>
  );
}

export default function DocsAdminPage({ vehicles = [], clients = [], dealer = {}, setDealer }) {
  const fournisseurs = useMemo(() => Array.isArray(dealer?.admin_fournisseurs) ? dealer.admin_fournisseurs : [], [dealer]);

  // v8.142 — Type de document : cession (15776), mandat d'immatriculation
  // (13757*03) ou demande de certificat d'immatriculation (13750*07).
  const [docType, setDocType] = useState("cession");
  const [natureOp, setNatureOp] = useState("Immatriculation");
  // v8.153 — Nature cochée en tête du CERFA 13750*07.
  const [natureImmat, setNatureImmat] = useState("certificat");
  // Couleur dominante du 13750 : dessinée dans le document (une case cochée
  // à l'écran dans l'aperçu ne reviendrait pas dans le fichier).
  const [couleurImmat, setCouleurImmat] = useState("");
  const [teinteImmat, setTeinteImmat] = useState("");
  const [lieuMandat, setLieuMandat] = useState(() => parseAddress(dealer?.address || "").ville);

  // Sélections : "garage" | "c:<id>" | "f:<id>" | "nouveau"
  const [vendeurSel, setVendeurSel] = useState("garage");     // par défaut : garage en vendeur…
  const [acquereurSel, setAcquereurSel] = useState("garage"); // …mais on force l'acquéreur = garage par défaut ci-dessous
  const [newVendeur, setNewVendeur] = useState({ ...emptyContact });
  const [newAcquereur, setNewAcquereur] = useState({ ...emptyContact });
  const [saveVendeurFourn, setSaveVendeurFourn] = useState(false);
  const [saveAcquereurFourn, setSaveAcquereurFourn] = useState(false);

  // Défaut demandé : ACQUÉREUR = garage ; vendeur = premier autre choix logique (nouveau).
  React.useEffect(() => { setAcquereurSel("garage"); setVendeurSel("nouveau"); }, []);

  // Véhicule : "existing" | "manual"
  const [vehMode, setVehMode] = useState("existing");
  const [vehId, setVehId] = useState("");
  const [manualVeh, setManualVeh] = useState({ ...emptyVeh });

  // Date + heure de cession — préremplies au moment présent, modifiables.
  const now = new Date();
  const [dateCession, setDateCession] = useState(now.toISOString().slice(0, 10)); // yyyy-mm-dd
  const [heureCession, setHeureCession] = useState(now.toTimeString().slice(0, 5)); // hh:mm

  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [error, setError] = useState(null);

  // ── Options des menus déroulants (clients CRM en lecture seule + garage + fournisseurs + nouveau) ──
  function partyOptions() {
    const opts = [{ value: "garage", label: "🏠 Moi-même (le garage)" }];
    for (const c of clients) {
      const nm = c.legal_name || c.name || [c.prenom, c.nom].filter(Boolean).join(" ") || "Client";
      opts.push({ value: "c:" + c.id, label: "👤 " + nm });
    }
    for (const f of fournisseurs) {
      const nm = f.type === "professionnel" ? (f.raison || f.nom) : [f.nom, f.prenom].filter(Boolean).join(" ");
      opts.push({ value: "f:" + f.id, label: "🏭 " + (nm || "Fournisseur") });
    }
    opts.push({ value: "nouveau", label: "➕ Nouveau contact ponctuel…" });
    return opts;
  }

  // ── Résout une sélection en partie normalisée pour le CERFA ──
  function resolveParty(sel, newForm) {
    if (sel === "garage") {
      return { isMorale: true, identite: dealer?.name || "", nom: "", prenom: "",
               siret: dealer?.siret || "", adresse: dealer?.address || "", civilite: "",
               tel: dealer?.phone || "", email: dealer?.email || "" };
    }
    if (sel && sel.startsWith("c:")) {
      const c = clients.find(x => String(x.id) === sel.slice(2)) || {};
      const isMorale = c.type === "company" || !!(c.siren && String(c.siren).trim());
      return {
        isMorale,
        identite: c.legal_name || c.name || "",
        nom: c.nom || "", prenom: c.prenom || "",
        siret: c.siren || "", adresse: c.address || c.adresse || "",
        civilite: c.civilite || "",
        tel: c.phone || "", email: c.email || "",
      };
    }
    if (sel && sel.startsWith("f:")) {
      const f = fournisseurs.find(x => String(x.id) === sel.slice(2)) || {};
      const isMorale = f.type === "professionnel";
      return {
        isMorale,
        identite: isMorale ? (f.raison || f.nom || "") : "",
        nom: f.nom || "", prenom: f.prenom || "",
        siret: f.siret || "", adresse: f.adresse || "",
        civilite: f.civilite || "",
        tel: f.tel || "", email: f.email || "",
      };
    }
    // "nouveau"
    const isMorale = newForm.type === "professionnel";
    return {
      isMorale,
      identite: isMorale ? (newForm.raison || newForm.nom || "") : "",
      nom: newForm.nom || "", prenom: newForm.prenom || "",
      siret: newForm.siret || "", adresse: newForm.adresse || "",
      civilite: newForm.civilite || "",
      tel: newForm.tel || "", email: newForm.email || "",
    };
  }

  function resolveVehicle() {
    if (vehMode === "manual") return manualVeh;
    const v = vehicles.find(x => String(x.id) === String(vehId));
    if (!v) return null;
    return {
      plate: v.plate || "", vin: v.vin || "", marque: v.marque || "", modele: v.modele || "",
      finition: v.finition || "", genre: v.genre || "VP",
      date_mec: v.date_mise_en_circulation || "", kilometrage: v.kilometrage || "",
      numero_formule: v.numero_formule || "", couleur: v.couleur || "",
    };
  }

  // ── Enregistre un "nouveau" comme fournisseur dédié (jamais dans le CRM) ──
  function maybeSaveFournisseur(newForm, doSave) {
    if (!doSave) return;
    if (!newForm.nom && !newForm.raison) return;
    const f = {
      id: uid(),
      type: newForm.type, nom: newForm.nom, prenom: newForm.prenom,
      raison: newForm.raison, adresse: newForm.adresse, siret: newForm.siret,
      civilite: newForm.civilite, tel: newForm.tel || "", email: newForm.email || "",
    };
    const next = [...fournisseurs, f];
    if (typeof setDealer === "function") setDealer({ ...dealer, admin_fournisseurs: next });
  }

  async function generate() {
    setError(null);
    const veh = resolveVehicle();
    if (!veh || !veh.plate) { setError("Sélectionne un véhicule (ou saisis au moins l'immatriculation)."); return; }
    const V = resolveParty(vendeurSel, newVendeur);
    const A = resolveParty(acquereurSel, newAcquereur);
    if (!buildIdentite(V)) { setError("Le vendeur est incomplet (nom / raison sociale)."); return; }
    if (!buildIdentite(A)) { setError("L'acquéreur est incomplet (nom / raison sociale)."); return; }

    setLoading(true);
    try {
      // v8.139.1 — pdf-lib est chargé à la volée (cf. lib/cerfa-common).
      const { PDFDocument } = await loadPdfLib();
      const pdfBytes = await fetch("/cerfa_15776-01_acroform.pdf").then(r => r.arrayBuffer());
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const form = pdfDoc.getForm();
      const setText = (n, v) => { if (!v) return; try { form.getTextField(n).setText(String(v)); } catch (e) {} };
      const setCheck = (n) => { try { form.getCheckBox(n).check(); } catch (e) {} };
      const setRadio = (n, v) => { try { form.getRadioGroup(n).select(v); } catch (e) {} };

      const vA = parseAddress(V.adresse);
      const aA = parseAddress(A.adresse);

      // Date de cession
      const [yy, mm, dd] = dateCession.split("-");
      const [h1, h2] = (heureCession || "").split(":");
      const dateJ = `${dd}/${mm}/${yy}`;

      // Date MEC véhicule (accepte jj/mm/aaaa ou aaaa-mm-jj)
      let mecJ = "", mecM = "", mecA = "";
      const mec = veh.date_mec || "";
      if (/\d{2}\/\d{2}\/\d{4}/.test(mec)) { const p = mec.split("/"); [mecJ, mecM, mecA] = p; }
      else if (/\d{4}-\d{2}-\d{2}/.test(mec)) { const p = mec.split("-"); mecA = p[0]; mecM = p[1]; mecJ = p[2]; }

      for (const pk of ["Page1", "Page2"]) {
        const p = (n) => `${pk}.${n}`;

        // VÉHICULE
        setText(p("num_Immatriculation"), veh.plate);
        setText(p("num_Identification"), veh.vin);
        if (mecJ) { setText(p("num_DateImmatriculationJour"), mecJ); setText(p("num_DateImmatriculationMois"), mecM); setText(p("num_DateImmatriculationAnnée"), mecA); }
        setText(p("txt_MarqueVéhicule"), veh.marque);
        setText(p("txt_TypeVarianteVersionVéhicule"), veh.finition);
        setText(p("txt_GenreNational"), veh.genre || "VP");
        setText(p("txt_DénominationCommerciale"), veh.modele);
        setText(p("num_KilométrageCompteur"), veh.kilometrage ? String(Number(veh.kilometrage).toLocaleString("fr-FR")).replace(/\u202f/g, " ").replace(/\u00a0/g, " ") : "");
        if (veh.numero_formule) setText(p("num_Formule"), veh.numero_formule);
        setRadio(p("Groupe_de_boutons_radio1"), "1");

        // ANCIEN PROPRIÉTAIRE (VENDEUR)
        setRadio(p("Groupe_de_boutons_radio3"), V.isMorale ? "1" : "2");
        setText(p("txt_IdentitéVendeur"), buildIdentite(V));
        if (V.siret) setText(p("Num_Siret"), String(V.siret).replace(/\s/g, ""));
        setText(p("num_VoieAdresse"), vA.num);
        setText(p("txt_ExtensionAdresse"), vA.ext);
        setText(p("txt_TypeVoieAdresse"), vA.type);
        setText(p("txt_NomVoie"), vA.nom);
        setText(p("num_CodePostalAdresse"), vA.cp);
        setText(p("txt_CommuneAdresse"), vA.ville);
        setRadio(p("Groupe_de_boutons_radio4"), "1");  // Céder
        setText(p("num_DateVenteJour"), dd);
        setText(p("num_DateVenteMois"), mm);
        setText(p("num_DateVenteAnnée"), yy);
        setText(p("num_HoraireVente1"), h1);
        setText(p("num_HoraireVente2"), h2);
        setCheck(p("ckb_ValidationDéclaration1"));
        setCheck(p("ckb_ValidationDéclaration2"));
        setText(p("txt_LieuDéclaration1"), vA.ville);
        setText(p("num_DateDéclaration"), dateJ);

        // NOUVEAU PROPRIÉTAIRE (ACQUÉREUR)
        if (A.isMorale) {
          setRadio(p("Groupe_de_boutons_radio5"), "1");
        } else {
          setRadio(p("Groupe_de_boutons_radio5"), "2");
          if (A.civilite === "M") setRadio(p("Groupe_de_boutons_radio6"), "1");
          if (A.civilite === "F") setRadio(p("Groupe_de_boutons_radio6"), "2");
        }
        setText(p("txt_IdentitéAcheteur"), buildIdentite(A));
        if (A.siret) setText(p("num_SiretAcheteur"), String(A.siret).replace(/\s/g, ""));
        setText(p("num_VoieAdresseAcheteur"), aA.num);
        setText(p("txt_ExtensionAdresseAcheteur"), aA.ext);
        setText(p("txt_TypeVoieAdresseAcheteur"), aA.type);
        setText(p("txt_NomVoieAdresseAcheteur"), aA.nom);
        setText(p("num_CodePostalAdresseAcheteur"), aA.cp);
        setText(p("txt_CommuneAdresseAcheteur"), aA.ville);
        setCheck(p("ckb_ValidationDéclarationA1"));
        setCheck(p("ckb_ValidationDéclarationA2"));
        setText(p("txt_LieuDéclaration2"), aA.ville || vA.ville);
        setText(p("txt_dateDéclaration"), dateJ);
      }

      const filled = await pdfDoc.save();
      const blob = new Blob([filled], { type: "application/pdf" });
      setPdfUrl(URL.createObjectURL(blob));

      // Écriture éventuelle : enregistrer les "nouveau" comme fournisseurs (si coché).
      if (vendeurSel === "nouveau") maybeSaveFournisseur(newVendeur, saveVendeurFourn);
      if (acquereurSel === "nouveau") maybeSaveFournisseur(newAcquereur, saveAcquereurFourn);
    } catch (e) {
      setError("Erreur CERFA : " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // ── Génère le MANDAT d'immatriculation 13757*03 ──
  async function generateMandat() {
    setError(null);
    const veh = resolveVehicle();
    if (!veh || !veh.plate) { setError("Sélectionne un véhicule (au moins l'immatriculation)."); return; }
    const M1 = resolveParty(vendeurSel, newVendeur);    // mandant (donneur d'ordre)
    const M2 = resolveParty(acquereurSel, newAcquereur); // mandataire (fait les démarches)
    if (!buildIdentite(M1)) { setError("Le mandant est incomplet (nom / raison sociale)."); return; }
    if (!buildIdentite(M2)) { setError("Le mandataire est incomplet (nom / raison sociale)."); return; }

    setLoading(true);
    try {
      const PDFLib = await loadPdfLib();
      const pdfBytes = await fetch("/cerfa_1375703.pdf").then(r => r.arrayBuffer());
      const filled = await fillCerfaMandat(pdfBytes, PDFLib, {
        mandant: M1,
        mandataire: M2,
        vehicule: veh,
        nature: natureOp,
        lieu: lieuMandat,
        date: dateCession,
      });
      const blob = new Blob([filled], { type: "application/pdf" });
      setPdfUrl(URL.createObjectURL(blob));

      if (vendeurSel === "nouveau") maybeSaveFournisseur(newVendeur, saveVendeurFourn);
      if (acquereurSel === "nouveau") maybeSaveFournisseur(newAcquereur, saveAcquereurFourn);
    } catch (e) {
      setError("Erreur mandat : " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }


  // ── Génère la DEMANDE DE CERTIFICAT D'IMMATRICULATION 13750*07 ──
  // Ce CERFA est diffusé à plat (aucun champ AcroForm) : les valeurs sont
  // dessinées sur le gabarit, cf. src/lib/cerfa-immat.js.
  async function generateImmat() {
    setError(null);
    const veh = resolveVehicle();
    if (!veh || !veh.plate) { setError("Sélectionne un véhicule (au moins l'immatriculation)."); return; }
    const T = resolveParty(acquereurSel, newAcquereur); // titulaire = nouveau propriétaire
    if (!buildIdentite(T)) { setError("Le titulaire est incomplet (nom / raison sociale)."); return; }

    setLoading(true);
    try {
      const PDFLib = await loadPdfLib();
      const pdfBytes = await fetch("/cerfa_1375007.pdf").then(r => r.arrayBuffer());
      const adr = parseAddress(T.adresse);
      const filled = await fillCerfaImmat(pdfBytes, PDFLib, {
        nature: natureImmat,
        couleur: couleurImmat,
        teinte: teinteImmat,
        dateAchat: dateCession,
        faitA: lieuMandat || adr.ville,
        faitLe: dateCession,
        vehicule: veh,
        titulaire: {
          isMorale: T.isMorale,
          civilite: T.civilite,
          identite: buildIdentite(T),
          siret: T.siret,
          tel: T.tel,
          email: T.email,
          adresse: adr,
        },
      });
      const blob = new Blob([filled], { type: "application/pdf" });
      setPdfUrl(URL.createObjectURL(blob));

      if (acquereurSel === "nouveau") maybeSaveFournisseur(newAcquereur, saveAcquereurFourn);
    } catch (e) {
      setError("Erreur demande d'immatriculation : " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  const options = partyOptions();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="page-title">Documents administratifs</div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -6, marginBottom: 16 }}>
        Générez un CERFA à la carte — cession (15776), mandat d'immatriculation (13757*03)
        ou demande de certificat d'immatriculation (13750*07).
        Cet onglet lit vos données mais n'écrit rien ailleurs.
      </p>

      {/* Sélecteur de type de document */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={"btn " + (docType === "cession" ? "btn-primary" : "btn-ghost")} onClick={() => { setDocType("cession"); setPdfUrl(null); }}>
          📄 Cession (15776)
        </button>
        <button className={"btn " + (docType === "mandat" ? "btn-primary" : "btn-ghost")} onClick={() => { setDocType("mandat"); setPdfUrl(null); }}>
          🖊 Mandat d'immatriculation (13757)
        </button>
        <button className={"btn " + (docType === "immat" ? "btn-primary" : "btn-ghost")} onClick={() => { setDocType("immat"); setPdfUrl(null); }}>
          🪪 Demande de carte grise (13750)
        </button>
      </div>

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1fr" }}>
        {/* PARTIE 1 : Vendeur (cession) / Mandant (mandat).
            Le 13750*07 ne connaît qu'un titulaire : ce bloc n'a pas lieu d'être. */}
        {docType !== "immat" && <div className="card">
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--red)", fontWeight: 700, marginBottom: 8 }}>
            {docType === "mandat" ? "Mandant (donneur d'ordre)" : "Vendeur (ancien propriétaire)"}
          </div>
          <select className="form-input" value={vendeurSel} onChange={e => setVendeurSel(e.target.value)}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {vendeurSel === "nouveau" && (
            <NewContactForm value={newVendeur} onChange={setNewVendeur} showSave
              saveChecked={saveVendeurFourn} onToggleSave={() => setSaveVendeurFourn(s => !s)} />
          )}
        </div>}

        {/* PARTIE 2 : Acquéreur (cession) / Mandataire (mandat) */}
        <div className="card">
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--gold)", fontWeight: 700, marginBottom: 8 }}>
            {docType === "mandat" ? "Mandataire (qui fait les démarches)"
              : docType === "immat" ? "Titulaire de la carte grise"
              : "Acquéreur (nouveau propriétaire)"}
          </div>
          <select className="form-input" value={acquereurSel} onChange={e => setAcquereurSel(e.target.value)}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {acquereurSel === "nouveau" && (
            <NewContactForm value={newAcquereur} onChange={setNewAcquereur} showSave
              saveChecked={saveAcquereurFourn} onToggleSave={() => setSaveAcquereurFourn(s => !s)} />
          )}
        </div>

        {/* MANDAT : nature de l'opération */}
        {docType === "mandat" && (
          <div className="card">
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted2)", fontWeight: 700, marginBottom: 8 }}>Nature de l'opération</div>
            <input className="form-input" value={natureOp} onChange={e => setNatureOp(e.target.value)} placeholder="Immatriculation, changement de titulaire, duplicata…" />
          </div>
        )}

        {/* 13750*07 : case à cocher en tête du formulaire */}
        {docType === "immat" && (
          <div className="card">
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted2)", fontWeight: 700, marginBottom: 8 }}>Nature de la demande</div>
            <select className="form-input" value={natureImmat} onChange={e => setNatureImmat(e.target.value)}>
              {NATURES_DEMANDE.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
            </select>

            {/* La couleur choisie est dessinée dans le PDF, donc toujours
                imprimée ; les autres cases du cadre restent cochables. */}
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted2)", fontWeight: 700, margin: "14px 0 8px" }}>Couleur dominante</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Couleur</label>
                <select className="form-input" value={couleurImmat} onChange={e => setCouleurImmat(e.target.value)}>
                  <option value="">— non renseignée —</option>
                  {TONS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Teinte</label>
                <select className="form-input" value={teinteImmat} onChange={e => setTeinteImmat(e.target.value)}>
                  <option value="">— sans teinte —</option>
                  {TEINTES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* VÉHICULE */}
        <div className="card">
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted2)", fontWeight: 700, marginBottom: 8 }}>Véhicule</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button className={"btn btn-sm " + (vehMode === "existing" ? "btn-primary" : "btn-ghost")} onClick={() => setVehMode("existing")}>De ma flotte</button>
            <button className={"btn btn-sm " + (vehMode === "manual" ? "btn-primary" : "btn-ghost")} onClick={() => setVehMode("manual")}>Saisie libre</button>
          </div>
          {vehMode === "existing" ? (
            <select className="form-input" value={vehId} onChange={e => {
              setVehId(e.target.value);
              // Le SIV renvoie la couleur en texte libre (« GRIS CLAIR »…) :
              // on préremplit les menus du 13750, corrigeables à la main.
              const veh = vehicles.find(x => String(x.id) === e.target.value);
              setCouleurImmat(couleurKey(veh?.couleur));
              setTeinteImmat(teinteKey(veh?.couleur));
            }}>
              <option value="">— Choisir un véhicule —</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{[v.marque, v.modele, v.plate].filter(Boolean).join(" · ")}</option>
              ))}
            </select>
          ) : (
            <div className="form-grid">
              {[["plate", "Immatriculation *"], ["vin", "N° VIN"], ["marque", "Marque"], ["modele", "Modèle"], ["finition", "Type/Variante/Version"], ["genre", "Genre national"], ["date_mec", "Date 1ère MEC (jj/mm/aaaa)"], ["kilometrage", "Kilométrage"], ["numero_formule", "N° de formule"]].map(([k, l]) => (
                <div className="form-group" key={k}>
                  <label className="form-label">{l}</label>
                  <input className="form-input" value={manualVeh[k]} onChange={e => setManualVeh(mv => ({ ...mv, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* DATE (+ heure cession, ou Fait à mandat) */}
        <div className="card">
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted2)", fontWeight: 700, marginBottom: 8 }}>
            {docType === "mandat" ? "Lieu & date"
              : docType === "immat" ? "Date d'achat & lieu de signature"
              : "Date & heure de cession"}
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Date</label>
              <input className="form-input" type="date" value={dateCession} onChange={e => setDateCession(e.target.value)} />
            </div>
            {docType === "mandat" || docType === "immat" ? (
              <div className="form-group">
                <label className="form-label">Fait à</label>
                <input className="form-input" value={lieuMandat} onChange={e => setLieuMandat(e.target.value)} placeholder="Marseille" />
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">Heure</label>
                <input className="form-input" type="time" value={heureCession} onChange={e => setHeureCession(e.target.value)} />
              </div>
            )}
          </div>
        </div>

        {error && <div style={{ color: "var(--red)", fontSize: 13 }}>{error}</div>}

        <div>
          <button
            className="btn btn-primary"
            onClick={docType === "mandat" ? generateMandat : docType === "immat" ? generateImmat : generate}
            disabled={loading}
          >
            {loading ? "Génération…"
              : docType === "mandat" ? "🖊 Générer le mandat"
              : docType === "immat" ? "🪪 Générer la demande"
              : "📄 Générer le CERFA"}
          </button>
        </div>

        {pdfUrl && (
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" onClick={() => window.open(pdfUrl, "_blank")}>
                ↗ Ouvrir en plein écran
              </button>
              <a className="btn btn-ghost btn-sm" href={pdfUrl} download={docType === "mandat" ? "mandat-immatriculation-13757.pdf" : docType === "immat" ? "demande-immatriculation-13750.pdf" : "cerfa-cession-15776.pdf"} style={{ textDecoration: "none" }}>
                ⬇ Télécharger
              </a>
            </div>
            <div style={{ height: 620, overflow: "hidden", borderRadius: 8 }}>
              <iframe src={pdfUrl} style={{ width: "100%", height: "100%", border: "none" }} title={docType === "mandat" ? "Mandat 13757" : docType === "immat" ? "CERFA 13750" : "CERFA 15776"} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
