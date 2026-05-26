// api/iobill-bridge.js — Pont IOCAR → IOBILL
// ═══════════════════════════════════════════════════════════════════
// Endpoint serveur qui orchestre la communication entre IOCAR et IOBILL.
//
// Actions :
//   - status        : état du lien (lié ou non, auto_push, etc.)
//   - link          : crée/lie le compte IOBILL inclus, accepte password
//                     pour utiliser le MÊME mot de passe qu'IOCAR
//   - sync_company  : pousse les paramètres garage → company IOBILL
//   - push_invoice  : pousse une facture IOCAR vers IOBILL en Factur-X
//   - set_auto_push : active/désactive la transmission auto
// ═══════════════════════════════════════════════════════════════════
import { verifyUser, setCors } from './_lib/auth.js';

const IOBILL_API_URL = process.env.IOBILL_API_URL || 'https://app.iobill.online/api/public';
const IOBILL_EXTERNAL_SECRET = process.env.IOBILL_EXTERNAL_SECRET;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!IOBILL_EXTERNAL_SECRET) {
    console.error('[iobill-bridge] IOBILL_EXTERNAL_SECRET non configuré');
    return res.status(500).json({ error: 'Pont IOBILL non configuré côté serveur' });
  }

  try {
    const auth = await verifyUser(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { user, garage, supabase } = auth;
    if (!garage) return res.status(403).json({ error: 'Garage introuvable' });

    const { action } = req.body || {};

    if (action === 'status') return handleStatus(garage, res);
    if (action === 'link') return handleLink(user, garage, supabase, req.body, res);
    if (action === 'sync_company') return handleSyncCompany(garage, supabase, res);
    if (action === 'push_invoice') return handlePushInvoice(garage, supabase, req.body, res);
    if (action === 'push_invoice_draft') return handlePushInvoiceDraft(garage, supabase, req.body, res);
    if (action === 'mark_invoice_paid') return handleMarkInvoicePaid(garage, supabase, req.body, res);
    if (action === 'set_auto_push') return handleSetAutoPush(garage, supabase, req.body, res);

    return res.status(400).json({ error: `Action inconnue : ${action}` });
  } catch (e) {
    console.error('[iobill-bridge] ERROR', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

// ───────────────────────────────────────────────────────────────────
// STATUS
// ───────────────────────────────────────────────────────────────────
function handleStatus(garage, res) {
  return res.status(200).json({
    linked: !!garage.iobill_company_id,
    iobill_company_id: garage.iobill_company_id || null,
    iobill_email: garage.iobill_email || null,
    iobill_linked_at: garage.iobill_linked_at || null,
    auto_push: !!garage.iobill_auto_push,
    has_token: !!garage.iobill_api_token
  });
}

// ───────────────────────────────────────────────────────────────────
// LINK — activation initiale (avec password optionnel)
// Body : { password? }
// ───────────────────────────────────────────────────────────────────
async function handleLink(user, garage, supabase, body, res) {
  // Idempotent : si déjà lié, on retourne le statut
  if (garage.iobill_company_id && garage.iobill_api_token) {
    return res.status(200).json({
      ok: true,
      already_linked: true,
      iobill_company_id: garage.iobill_company_id,
      iobill_email: garage.iobill_email
    });
  }

  const password = body && typeof body.password === 'string' ? body.password : null;

  // Si password fourni, on vérifie qu'il est valide côté IOCAR (signIn)
  // → garantit qu'on n'utilise pas un MDP saisi à tort
  if (password) {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: user.email, password })
    });
    if (!r.ok) {
      return res.status(401).json({ error: 'Mot de passe IO CAR incorrect — réessayez' });
    }
  }

  // Construit le payload pour IOBILL en envoyant tous les champs disponibles
  const linkPayload = {
    action: 'link_account',
    source_app: 'iocar',
    external_ref: garage.id,
    email: user.email || garage.email,
    password: password || undefined,
    legal_name: garage.nom || garage.email || 'Garage',
    trade_name: garage.nom_commercial || null,
    siret: garage.siret || null,
    vat_number: garage.tva_intra || null,
    ape_code: garage.code_ape || null,
    phone: garage.telephone || null,
    website: garage.site_web || null,
    logo_url: null, // base64 → on traite séparément en phase ultérieure
    address: {
      line1: garage.adresse || null,
      postal_code: garage.code_postal || null,
      city: garage.ville || null,
      country: 'FR'
    }
  };

  const j = await callIobill(linkPayload);
  if (!j.ok) {
    return res.status(502).json({ error: 'Échec lien IOBILL', details: j.error, last_error: j.last_error, hint: j.hint, full_payload: j.full_payload });
  }

  const { error: updErr } = await supabase
    .from('garages')
    .update({
      iobill_company_id: j.data.company_id,
      iobill_api_token: j.data.token,
      iobill_email: j.data.email,
      iobill_linked_at: new Date().toISOString()
    })
    .eq('id', garage.id);

  if (updErr) {
    console.error('[link] échec persistance', updErr);
    return res.status(500).json({ error: 'Lien IOBILL OK mais échec sauvegarde locale' });
  }

  return res.status(200).json({
    ok: true,
    created: j.data.created,
    already_linked: false,
    iobill_company_id: j.data.company_id,
    iobill_email: j.data.email,
    used_password: !!password
  });
}

// ───────────────────────────────────────────────────────────────────
// SYNC_COMPANY — push manuel des paramètres garage → IOBILL
// ───────────────────────────────────────────────────────────────────
async function handleSyncCompany(garage, supabase, res) {
  if (!garage.iobill_api_token) {
    return res.status(400).json({ error: 'Compte IOBILL non lié' });
  }

  const payload = {
    action: 'sync_company',
    token: garage.iobill_api_token,
    legal_name: garage.nom || null,
    trade_name: garage.nom_commercial || null,
    siret: garage.siret || null,
    vat_number: garage.tva_intra || null,
    ape_code: garage.code_ape || null,
    phone: garage.telephone || null,
    website: garage.site_web || null,
    address: {
      line1: garage.adresse || null,
      postal_code: garage.code_postal || null,
      city: garage.ville || null,
      country: 'FR'
    }
  };

  const j = await callIobill(payload);
  if (!j.ok) {
    return res.status(502).json({ error: 'Échec sync IOBILL', details: j.error, last_error: j.last_error, hint: j.hint, full_payload: j.full_payload });
  }
  return res.status(200).json({ ok: true, updated_fields: j.data.updated_fields });
}

// ───────────────────────────────────────────────────────────────────
// PUSH_INVOICE — pousse une facture IOCAR vers IOBILL
// Body : { order_id }
// ⚠️ N'autorise QUE les factures totalement payées (reste <= 0.01).
//    Cohérent avec le workflow IOCAR : une facture non payée n'a pas
//    activé le bouton "Livré dans la flotte", elle n'est pas finalisée.
// Le mapping IOCAR.order → IOBILL.invoice est fait ici en backend.
// ───────────────────────────────────────────────────────────────────
async function handlePushInvoice(garage, supabase, body, res) {
  if (!garage.iobill_api_token) {
    return res.status(400).json({ error: 'Compte IOBILL non lié' });
  }
  const orderId = body?.order_id;
  if (!orderId) return res.status(400).json({ error: 'order_id requis' });

  // Charger l'order avec ses relations (flatten le JSON data)
  const { order, error: ordErr } = await loadOrder(supabase, orderId, garage.id);

  if (ordErr || !order) {
    return res.status(404).json({ error: 'Order introuvable ou non autorisé' });
  }

  if (order.type !== 'facture' && order.type !== 'avoir') {
    return res.status(400).json({ error: 'Seules les factures et avoirs peuvent être transmis (pas les bons de commande)' });
  }

  // ─── VÉRIFICATION PAYEE ──────────────────────────────────────
  // Une facture ne peut être transmise à IOBILL que si elle est soldée.
  // Pour les avoirs, on accepte aussi : un avoir est "soldé" quand le
  // remboursement est totalement effectué (reste <= 0.01 absolu).
  const calc = calcOrderBackend(order);
  if (calc.reste > 0.01) {
    const restant = calc.reste.toFixed(2);
    const totalAbs = Math.abs(calc.ttc).toFixed(2);
    const msg = order.type === 'avoir'
      ? `Avoir non encore totalement remboursé (reste à rembourser : ${restant} € sur ${totalAbs} €). Encaissez d'abord le remboursement complet avant de transmettre à IO BILL.`
      : `Facture non encore totalement payée (reste à encaisser : ${restant} € sur ${totalAbs} €). Marquez d'abord la facture comme payée avant de la transmettre à IO BILL.`;
    return res.status(400).json({
      error: msg,
      code: 'NOT_PAID',
      reste: calc.reste,
      ttc: Math.abs(calc.ttc)
    });
  }

  // ─── MAPPING ─────────────────────────────────────────────────
  const mappedInvoice = mapOrderToInvoice(order, calc);

  const payload = {
    action: 'push_invoice',
    token: garage.iobill_api_token,
    invoice: mappedInvoice
  };

  const j = await callIobill(payload);

  if (!j.ok) {
    // On stocke l'erreur côté order pour pouvoir l'afficher dans l'UI
    await supabase.from('orders').update({
      iobill_sync_error: j.error || 'Erreur inconnue',
      iobill_synced_at: null
    }).eq('id', orderId);
    return res.status(502).json({ error: 'Échec push IOBILL', details: j.error, last_error: j.last_error, hint: j.hint, full_payload: j.full_payload });
  }

  // Succès : on stocke l'invoice IOBILL côté order
  await supabase.from('orders').update({
    iobill_invoice_id: j.data.invoice_id,
    iobill_invoice_number: j.data.invoice_number,
    iobill_pdf_url: j.data.pdf_url,
    iobill_synced_at: new Date().toISOString(),
    iobill_sync_error: null
  }).eq('id', orderId);

  return res.status(200).json({
    ok: true,
    invoice_id: j.data.invoice_id,
    invoice_number: j.data.invoice_number,
    pdf_url: j.data.pdf_url
  });
}

// ───────────────────────────────────────────────────────────────────
// PUSH_INVOICE_DRAFT — Push d'une facture en brouillon (BC → Facture)
// Body : { order_id }
//
// Cette action est appelée à la CONVERSION BC → Facture côté IOCAR.
// La facture arrive dans IOBILL en status='draft' :
//   - Le comptable peut la voir mais elle n'est pas comptabilisée TVA
//   - Le Factur-X n'est PAS encore généré (attend le passage en non-draft)
//   - Le comptable ne peut pas la modifier (verrou external_source)
//
// Au clic "Livré" côté IOCAR, on appellera mark_invoice_paid pour basculer
// la facture en status='paid' et déclencher la génération Factur-X.
//
// FLUIDITÉ : appel fire-and-forget côté front IOCAR (sans await), donc
// l'user IOCAR ne sent aucune latence à la conversion BC→Facture.
// ───────────────────────────────────────────────────────────────────
async function handlePushInvoiceDraft(garage, supabase, body, res) {
  if (!garage.iobill_api_token) {
    return res.status(400).json({ error: 'Compte IOBILL non lié' });
  }
  const orderId = body?.order_id;
  if (!orderId) return res.status(400).json({ error: 'order_id requis' });

  const { order, error: ordErr } = await loadOrder(supabase, orderId, garage.id);
  if (ordErr || !order) {
    return res.status(404).json({ error: 'Order introuvable ou non autorisé' });
  }
  if (order.type !== 'facture' && order.type !== 'avoir') {
    return res.status(400).json({ error: 'Seules les factures peuvent être pushées (pas les BC)' });
  }

  // Idempotent : si déjà pushée avec un iobill_invoice_id, on retourne
  if (order.iobill_invoice_id) {
    return res.status(200).json({
      ok: true,
      already_pushed: true,
      invoice_id: order.iobill_invoice_id,
      invoice_number: order.iobill_invoice_number
    });
  }

  // Calc sans vérifier reste — on accepte une facture non payée (c'est draft)
  const calc = calcOrderBackend(order);

  const mappedInvoice = mapOrderToInvoice(order, calc);
  // Force status=draft pour cette action (override le 'paid' du mapping)
  mappedInvoice.status = 'draft';
  // En draft, pas de payments encore figés
  mappedInvoice.payments = [];
  // paid_cents partira aussi à 0 (le push_invoice côté IOBILL force la cohérence)
  mappedInvoice.totals = { paid_cents: 0 };

  const payload = {
    action: 'push_invoice',
    token: garage.iobill_api_token,
    invoice: mappedInvoice
  };
  const j = await callIobill(payload);

  if (!j.ok) {
    await supabase.from('orders').update({
      iobill_sync_error: j.error || 'Erreur draft push',
      iobill_synced_at: null
    }).eq('id', orderId);
    return res.status(502).json({ error: 'Échec push draft IOBILL', details: j.error, last_error: j.last_error, hint: j.hint, full_payload: j.full_payload });
  }

  await supabase.from('orders').update({
    iobill_invoice_id: j.data.invoice_id,
    iobill_invoice_number: j.data.invoice_number,
    iobill_pdf_url: j.data.pdf_url || null,
    iobill_synced_at: new Date().toISOString(),
    iobill_sync_error: null
  }).eq('id', orderId);

  return res.status(200).json({
    ok: true,
    created: j.data.created,
    invoice_id: j.data.invoice_id,
    invoice_number: j.data.invoice_number,
    status: 'draft'
  });
}

// ───────────────────────────────────────────────────────────────────
// MARK_INVOICE_PAID — Bascule la facture draft en paid (clic "Livré")
// Body : { order_id }
//
// Cette action est appelée au CLIC "Livré" côté IOCAR.
// Effets côté IOBILL :
//   1. Status passe draft → paid
//   2. paid_cents = total_ttc_cents (cohérence)
//   3. Les payments détaillés sont créés (acompte signature + paiements)
//   4. Le Factur-X est généré en arrière-plan (fire-and-forget)
//   5. La facture entre dans la TVA collectée du mois
//
// Si la facture n'a pas encore été pushée en draft (cas où push_draft a
// échoué à la conversion), on fait un push COMPLET (draft + paid en une fois)
// pour garantir qu'elle apparaît bien dans IOBILL.
// ───────────────────────────────────────────────────────────────────
async function handleMarkInvoicePaid(garage, supabase, body, res) {
  if (!garage.iobill_api_token) {
    return res.status(400).json({ error: 'Compte IOBILL non lié' });
  }
  const orderId = body?.order_id;
  if (!orderId) return res.status(400).json({ error: 'order_id requis' });

  const { order, error: ordErr } = await loadOrder(supabase, orderId, garage.id);
  if (ordErr || !order) {
    return res.status(404).json({ error: 'Order introuvable ou non autorisé' });
  }
  if (order.type !== 'facture' && order.type !== 'avoir') {
    return res.status(400).json({ error: 'Seules les factures peuvent être marquées payées' });
  }

  // Vérif paiement (sécurité)
  const calc = calcOrderBackend(order);
  if (calc.reste > 0.01) {
    return res.status(400).json({
      error: `Facture non encore totalement payée (reste : ${calc.reste.toFixed(2)} €). Impossible de marquer payée.`,
      code: 'NOT_PAID',
      reste: calc.reste
    });
  }

  const mappedInvoice = mapOrderToInvoice(order, calc);
  // Status reste 'paid' (valeur par défaut du mapping)

  // Cas 1 : facture déjà draft sur IOBILL → on bascule juste le status + payments
  if (order.iobill_invoice_id) {
    const j = await callIobill({
      action: 'update_invoice_status',
      token: garage.iobill_api_token,
      external_id: order.id,
      new_status: 'paid',
      payments: mappedInvoice.payments
    });

    if (!j.ok) {
      await supabase.from('orders').update({
        iobill_sync_error: j.error || 'Erreur update status',
      }).eq('id', orderId);
      return res.status(502).json({ error: 'Échec update IOBILL', details: j.error, last_error: j.last_error, hint: j.hint, full_payload: j.full_payload });
    }

    await supabase.from('orders').update({
      iobill_pdf_url: j.data.pdf_url || order.iobill_pdf_url || null,
      iobill_synced_at: new Date().toISOString(),
      iobill_sync_error: null
    }).eq('id', orderId);

    return res.status(200).json({
      ok: true,
      transition: 'draft_to_paid',
      invoice_id: j.data.invoice_id,
      invoice_number: j.data.invoice_number,
      pdf_url: j.data.pdf_url || null,
      facturx_status: j.data.facturx_status || 'pending'
    });
  }

  // Cas 2 : pas encore pushée (push_draft a échoué/skip) → push complet
  // direct en status=paid (fallback robuste)
  const payload = {
    action: 'push_invoice',
    token: garage.iobill_api_token,
    invoice: mappedInvoice
  };
  const j = await callIobill(payload);

  if (!j.ok) {
    await supabase.from('orders').update({
      iobill_sync_error: j.error || 'Erreur push direct paid',
      iobill_synced_at: null
    }).eq('id', orderId);
    return res.status(502).json({ error: 'Échec push IOBILL', details: j.error, last_error: j.last_error, hint: j.hint, full_payload: j.full_payload });
  }

  await supabase.from('orders').update({
    iobill_invoice_id: j.data.invoice_id,
    iobill_invoice_number: j.data.invoice_number,
    iobill_pdf_url: j.data.pdf_url || null,
    iobill_synced_at: new Date().toISOString(),
    iobill_sync_error: null
  }).eq('id', orderId);

  return res.status(200).json({
    ok: true,
    transition: 'direct_paid',
    invoice_id: j.data.invoice_id,
    invoice_number: j.data.invoice_number,
    pdf_url: j.data.pdf_url || null,
    facturx_status: j.data.facturx_status || 'pending'
  });
}

// ───────────────────────────────────────────────────────────────────
// SET_AUTO_PUSH
// Body : { enabled: bool }
// ───────────────────────────────────────────────────────────────────
async function handleSetAutoPush(garage, supabase, body, res) {
  const enabled = !!body?.enabled;
  const { error } = await supabase
    .from('garages')
    .update({ iobill_auto_push: enabled })
    .eq('id', garage.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, auto_push: enabled });
}

// ───────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────

// Appel sécurisé IOBILL avec le secret partagé
async function callIobill(payload) {
  try {
    const r = await fetch(`${IOBILL_API_URL}?op=external`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-External-Secret': IOBILL_EXTERNAL_SECRET
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      console.error('[callIobill] failed', r.status, data);
      // v8.37 hotfix5 — On forward TOUT le payload IOBILL pour avoir
      // le détail (last_error, hint, etc.) côté DevTools IOCAR.
      return {
        ok: false,
        error: data.error || `HTTP ${r.status}`,
        details: data.details || null,
        last_error: data.last_error || null,
        hint: data.hint || null,
        full_payload: data
      };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════
// calcOrderBackend — réplique côté serveur de la fonction calcOrder() IOCAR
// Important : NE PAS importer du front, le code est dupliqué intentionnellement
// pour découpler. Si la logique de calcul change côté front, mettre à jour ici.
// ═══════════════════════════════════════════════════════════════════
function calcOrderBackend(o) {
  // Convention historique IOCAR : prix_ht stocke en fait le prix de vente TTC
  const prixVente = parseFloat(o.prix_ht) || 0;
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

  // Avoir : on ignore l'acompte signature
  const acompteTtc = o.type === 'avoir' ? 0 : (parseFloat(o.acompte_ttc) || 0);
  const paiementsTotal = (Array.isArray(o.paiements) ? o.paiements : [])
    .reduce((s, p) => s + (parseFloat(p.montant) || 0), 0);
  const encaisse = acompteTtc + paiementsTotal;
  const reste = ttc - encaisse;

  const sign = o.type === 'avoir' ? -1 : 1;
  return {
    ht: ht * sign,
    remAmt,
    base: prixApresRemise,
    fraisMiseDispo,
    carteGrise,
    repriseValeur,
    baseTotal: montantTTC_soumis,
    tvaAmt: tvaAmt * sign,
    ttc: ttc * sign,
    encaisse,
    reste,
    avecTva,
    tvaPct,
    acompteTtc,
    paiementsTotal
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAPPING : order IOCAR → invoice IOBILL
//
// Logique :
// - Ligne 1 : VENTE VÉHICULE — {plate} {marque} {modele} ({km} km)
//             prix de vente HT après remise (ou TTC en TVA marge 297A)
// - Ligne 2 (optionnelle) : Frais de mise à disposition
// - Ligne 3 (optionnelle) : Carte grise (HORS TVA — vat_rate = 0)
// - Ligne 4 (optionnelle) : Reprise véhicule (HT négatif)
//
// Si avec_tva=false → vat_regime='margin_297a' + toutes les lignes en
//                      vat_rate=0 + mention 297A dans notes
//
// Status = 'paid' systématiquement car on n'appelle ce mapping que
// pour des factures totalement soldées (vérifié en amont par
// handlePushInvoice via calc.reste <= 0.01).
//
// On envoie aussi la liste des `payments` pour que le comptable voie
// dans IOBILL le détail des règlements (mode, date, montant) plutôt
// qu'un simple total.
// ═══════════════════════════════════════════════════════════════════
function mapOrderToInvoice(order, calc) {
  const avecTva = order.avec_tva !== false;
  const tvaPct = avecTva ? (Number(order.tva_pct) || 20) : 0;
  const sign = order.type === 'avoir' ? -1 : 1;

  const baseTtc = Number(order.prix_ht) || 0;
  const remAmt = Number(order.remise_ttc) || 0;
  const baseApresRem = baseTtc - remAmt;

  const fraisMD = Number(order.frais_mise_dispo) || 0;
  const carteGrise = Number(order.carte_grise) || 0;
  const reprise = (order.reprise_active ? (Number(order.reprise_valeur) || 0) : 0);

  // Conversion TTC → HT pour chaque ligne
  const ttcToHt = (ttc) => avecTva ? ttc / (1 + tvaPct / 100) : ttc;

  const v = order.vehicle_data || {};
  const vehicleLabel = [v.marque, v.modele, v.finition].filter(Boolean).join(' ')
    || (order.vehicle_label || 'Véhicule');
  // ⚠️ Côté IOCAR, le champ d'immatriculation s'appelle `plate`, pas `immatriculation`
  const vehiclePlate = v.plate || order.vehicle_plate || '';
  const km = v.kilometrage ? `${Number(v.kilometrage).toLocaleString('fr-FR')} km` : '';
  const description1 = `VENTE VÉHICULE — ${vehicleLabel}${vehiclePlate ? ' (' + vehiclePlate + ')' : ''}${km ? ' · ' + km : ''}`;

  const lines = [];
  // L1 — véhicule
  lines.push({
    description: description1,
    quantity: 1,
    unit_price_ht_cents: Math.round(ttcToHt(baseApresRem) * 100 * sign),
    vat_rate: tvaPct,
    discount_pct: 0
  });
  // L2 — frais
  if (fraisMD > 0) {
    lines.push({
      description: 'Frais de mise à disposition',
      quantity: 1,
      unit_price_ht_cents: Math.round(ttcToHt(fraisMD) * 100 * sign),
      vat_rate: tvaPct,
      discount_pct: 0
    });
  }
  // L3 — carte grise (HORS TVA toujours)
  if (carteGrise > 0) {
    lines.push({
      description: 'Carte grise (hors TVA)',
      quantity: 1,
      unit_price_ht_cents: Math.round(carteGrise * 100 * sign),
      vat_rate: 0,
      discount_pct: 0
    });
  }
  // L4 — reprise (ligne négative)
  if (reprise > 0) {
    const reprDesc = [
      'Reprise véhicule',
      order.reprise_plate ? `· ${order.reprise_plate}` : '',
      order.reprise_marque || order.reprise_modele
        ? `· ${[order.reprise_marque, order.reprise_modele].filter(Boolean).join(' ')}`
        : ''
    ].filter(Boolean).join(' ');
    lines.push({
      description: reprDesc,
      quantity: 1,
      unit_price_ht_cents: -Math.round(ttcToHt(reprise) * 100 * sign),
      vat_rate: tvaPct,
      discount_pct: 0
    });
  }

  // ─── Paiements : on construit la liste détaillée pour IOBILL ──
  // 1) L'acompte signature (si > 0 et facture non-avoir)
  // 2) Tous les paiements de la liste o.paiements
  const payments = [];
  if (order.type !== 'avoir' && Number(order.acompte_ttc) > 0) {
    payments.push({
      amount_cents: Math.round(Number(order.acompte_ttc) * 100),
      method: 'cash', // pas tracé côté IOCAR, on met cash par défaut
      paid_at: order.date_facture || order.date_creation || new Date().toISOString().slice(0, 10),
      notes: 'Acompte versé à la signature (IO CAR)',
      reference: order.ref ? `Acompte ${order.ref}` : null
    });
  }
  if (Array.isArray(order.paiements)) {
    for (const p of order.paiements) {
      const montant = Number(p.montant) || 0;
      if (montant <= 0) continue;
      payments.push({
        amount_cents: Math.round(montant * 100),
        method: mapPaymentMethod(p.mode),
        paid_at: p.date || new Date().toISOString().slice(0, 10),
        notes: p.note || null,
        reference: order.ref || null
      });
    }
  }

  // ─── Client : structure IOCAR = order.client { name, address, phone, email, siren }
  // Si siren rempli → société. Sinon particulier (on splite le name).
  const cli = order.client || {};
  const hasSiren = !!(cli.siren && String(cli.siren).trim());
  let clientPayload;
  if (hasSiren) {
    clientPayload = {
      legal_name: cli.name || null,
      first_name: null,
      last_name: null,
      siret: String(cli.siren).replace(/\s/g, '') || null,
      email: cli.email || null,
      phone: cli.phone || null,
      address_line1: cli.address || null,
      postal_code: null,
      city: null,
      country: 'FR'
    };
  } else {
    // Splite "Jean Dupont" en first=Jean / last=Dupont (heuristique simple)
    const fullName = String(cli.name || '').trim();
    const parts = fullName.split(/\s+/);
    const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || null);
    const lastName = parts.length > 1 ? parts[parts.length - 1] : null;
    clientPayload = {
      legal_name: null,
      first_name: firstName || null,
      last_name: lastName || null,
      siret: null,
      email: cli.email || null,
      phone: cli.phone || null,
      address_line1: cli.address || null,
      postal_code: null,
      city: null,
      country: 'FR'
    };
  }

  return {
    external_id: order.id,
    number: order.ref || `IOCAR-${String(order.id || '').slice(0, 8).toUpperCase()}`,
    issue_date: order.date_facture || order.date_creation || new Date().toISOString().slice(0, 10),
    // ⚠️ Toujours 'paid' : on n'a pushé que parce que calc.reste <= 0.01
    status: 'paid',
    client: clientPayload,
    lines,
    payments,
    totals: {
      paid_cents: Math.round(Math.abs(calc.ttc) * 100)  // = total TTC car soldé
    },
    vehicle_meta: {
      plate: vehiclePlate,
      vin: v.vin || null,
      marque: v.marque || null,
      modele: v.modele || null,
      finition: v.finition || null,
      annee: v.annee || null,
      kilometrage: v.kilometrage || null,
      carburant: v.carburant || null,
      genre: v.genre || null
    },
    vat_regime: avecTva ? 'standard' : 'margin_297a'
  };
}

// Map les modes de paiement IOCAR → IOBILL
function mapPaymentMethod(mode) {
  if (!mode) return 'other';
  const m = String(mode).toLowerCase();
  if (m.includes('virement')) return 'bank_transfer';
  if (m.includes('cb') || m.includes('carte') || m.includes('stripe')) return 'stripe';
  if (m.includes('espece') || m.includes('cash')) return 'cash';
  if (m.includes('chèque') || m.includes('cheque')) return 'check';
  return 'other';
}

// ═══════════════════════════════════════════════════════════════════
// flattenOrder — Normalise la structure d'un order chargé depuis Supabase
//
// IMPORTANT : côté IOCAR, la table `orders` a une architecture EAV :
//   {id, garage_id, data: {...tous les champs métier...}, created_at}
//
// On aplatit pour avoir un objet flat `{id, garage_id, type, prix_ht, ...}`
// comme le fait le frontend (cf. useSupabaseTable ligne 7449).
//
// Les colonnes iobill_* qu'on a ajoutées à `orders` directement (pour pouvoir
// les indexer/requêter) restent au top-level — on les préserve.
// ═══════════════════════════════════════════════════════════════════
function flattenOrder(row) {
  if (!row) return null;
  if (!row.data || typeof row.data !== 'object') return row;
  // On commence par les données métier (data), puis on superpose les colonnes
  // top-level pour les preserver (id, garage_id, iobill_*, created_at...)
  const { data: nested, ...topLevel } = row;
  return { ...nested, ...topLevel };
}

// Charge + aplatit un order, avec vérif d'autorisation par garage_id
async function loadOrder(supabase, orderId, garageId) {
  const { data: row, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('garage_id', garageId)
    .single();
  if (error || !row) return { error: error || new Error('not found'), order: null };
  return { error: null, order: flattenOrder(row) };
}
