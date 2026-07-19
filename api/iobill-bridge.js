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
    const { user, supabase } = auth;
    // v8.40.3 — flattenGarage défensif. Note : les champs IOCAR sont au
    // top-level (name, address, phone, siret, tva_num, logo, business_mentions),
    // PAS dans data JSONB. La fonction est conservée par sécurité.
    const garage = flattenGarage(auth.garage);
    if (!garage) return res.status(403).json({ error: 'Garage introuvable' });

    const { action } = req.body || {};

    if (action === 'status') return handleStatus(garage, res);
    if (action === 'link') return handleLink(user, garage, supabase, req.body, res);
    if (action === 'sync_company') return handleSyncCompany(garage, supabase, res);
    if (action === 'push_invoice') return handlePushInvoice(garage, supabase, req.body, res);
    if (action === 'push_invoice_draft') return handlePushInvoiceDraft(garage, supabase, req.body, res);
    if (action === 'mark_invoice_paid') return handleMarkInvoicePaid(garage, supabase, req.body, res);
    // v8.41 — Action dédiée pour les avoirs (route vers credit_notes côté IOBILL)
    if (action === 'push_credit_note') return handlePushCreditNote(garage, supabase, req.body, res);
    // v8.43 — CRM mono-source : sync proactive
    if (action === 'sync_client') return handleSyncClient(garage, supabase, req.body, res);
    if (action === 'delete_client') return handleDeleteClient(garage, supabase, req.body, res);
    // v8.44 — Backfill : sync TOUS les clients IOCAR vers IOBILL en une fois
    if (action === 'sync_all_clients') return handleSyncAllClients(garage, supabase, req.body, res);
    // v8.45 — Polling : envoie TOUS les clients en 1 seul appel batch à IOBILL
    if (action === 'sync_clients_batch') return handleSyncClientsBatchFromIocar(garage, supabase, req.body, res);
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
  // v8.40.3 — bonnes colonnes IOCAR (name, address, phone, tva_num, etc.)
  const addrLinkParsed = parseGarageAddress(garage.address);
  const linkPayload = {
    action: 'link_account',
    source_app: 'iocar',
    external_ref: garage.id,
    email: user.email || garage.email,
    password: password || undefined,
    legal_name: garage.name || garage.email || 'Garage',
    trade_name: null,
    siret: garage.siret || null,
    vat_number: garage.tva_num || null,
    ape_code: null,
    phone: garage.phone || null,
    website: null,
    logo_url: null, // base64 → on traite séparément en phase ultérieure
    address: {
      line1: addrLinkParsed.line1,
      postal_code: addrLinkParsed.postal_code,
      city: addrLinkParsed.city,
      country: 'FR'
    },
    // v8.39 — Mentions garage (saisies dans Paramètres > Mentions garage côté IOCAR)
    business_mentions: garage.business_mentions || null
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

  // v8.40.3 — bonnes colonnes IOCAR
  const addrSyncParsed = parseGarageAddress(garage.address);
  const payload = {
    action: 'sync_company',
    token: garage.iobill_api_token,
    legal_name: garage.name || null,
    trade_name: null,
    siret: garage.siret || null,
    vat_number: garage.tva_num || null,
    ape_code: null,
    phone: garage.phone || null,
    website: null,
    address: {
      line1: addrSyncParsed.line1,
      postal_code: addrSyncParsed.postal_code,
      city: addrSyncParsed.city,
      country: 'FR'
    },
    // v8.39 — Mentions garage (saisies dans Paramètres > Mentions garage côté IOCAR)
    business_mentions: garage.business_mentions || null,
    // v8.40.3 — Logo base64 (au cas où IOBILL ait perdu son logo_url)
    logo_base64: garage.logo || null
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
    invoice: mappedInvoice,
    company_update: buildCompanyUpdateFromGarage(garage)
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
    iobill_status: j.data.status || 'paid', // push_invoice "complet" → paid
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
    invoice: mappedInvoice,
    company_update: buildCompanyUpdateFromGarage(garage)
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
    iobill_status: 'draft', // v8.41 — push_invoice_draft → draft côté IOBILL
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
      iobill_status: 'paid', // v8.41 — draft → paid côté IOBILL
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
    invoice: mappedInvoice,
    company_update: buildCompanyUpdateFromGarage(garage)
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
    iobill_status: 'paid', // v8.41 — fallback : push direct en paid
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
// v8.41 — PUSH_CREDIT_NOTE — Pousse un avoir IOCAR vers credit_notes IOBILL
// Body : { order_id, mode? }
//
// mode : 'draft' (push initial à la création, statut='draft' côté IOBILL)
//      | 'finalize' (au remboursement complet, statut='issued')
//      | undefined : auto-déduit selon le reste à rembourser :
//                    - reste > 0.01 → mode 'draft'
//                    - reste ≤ 0.01 → mode 'finalize'
//
// Si déjà poussé en draft : on update vers 'issued' (cas finalize)
// Si déjà poussé en issued : idempotent
// ───────────────────────────────────────────────────────────────────
async function handlePushCreditNote(garage, supabase, body, res) {
  if (!garage.iobill_api_token) {
    return res.status(400).json({ error: 'Compte IOBILL non lié' });
  }
  const orderId = body?.order_id;
  if (!orderId) return res.status(400).json({ error: 'order_id requis' });

  const { order, error: ordErr } = await loadOrder(supabase, orderId, garage.id);
  if (ordErr || !order) {
    return res.status(404).json({ error: 'Order introuvable ou non autorisé' });
  }
  if (order.type !== 'avoir') {
    return res.status(400).json({ error: 'Cette action est réservée aux avoirs (type=avoir)' });
  }
  if (!order.facture_origine) {
    return res.status(400).json({ error: "L'avoir n'a pas de facture d'origine — impossible de le pousser sans la rattacher à une facture" });
  }

  const calc = calcOrderBackend(order);

  // Détermine le mode et le statut IOBILL cible
  let targetStatus;
  if (body?.mode === 'draft') {
    targetStatus = 'draft';
  } else if (body?.mode === 'finalize') {
    if (calc.reste > 0.01) {
      return res.status(400).json({
        error: `Avoir non encore totalement remboursé (reste : ${calc.reste.toFixed(2)} €).`,
        code: 'NOT_PAID',
        reste: calc.reste
      });
    }
    targetStatus = 'issued';
  } else {
    // Auto : selon le reste
    targetStatus = calc.reste > 0.01 ? 'draft' : 'issued';
  }

  // Idempotence : déjà au statut cible ?
  if (order.iobill_invoice_id && order.iobill_status === targetStatus) {
    return res.status(200).json({
      ok: true,
      already_pushed: true,
      credit_note_id: order.iobill_invoice_id,
      credit_note_number: order.iobill_invoice_number,
      status: order.iobill_status
    });
  }

  const mappedCreditNote = mapOrderToCreditNote(order, calc, targetStatus);

  const payload = {
    action: 'push_credit_note',
    token: garage.iobill_api_token,
    credit_note: mappedCreditNote,
    company_update: buildCompanyUpdateFromGarage(garage)
  };
  const j = await callIobill(payload);

  if (!j.ok) {
    await supabase.from('orders').update({
      iobill_sync_error: j.error || 'Erreur push credit_note',
      iobill_synced_at: null
    }).eq('id', orderId);
    return res.status(502).json({
      error: 'Échec push avoir IOBILL',
      details: j.error, last_error: j.last_error, hint: j.hint, full_payload: j.full_payload
    });
  }

  // On stocke l'id du credit_note dans iobill_invoice_id (réutilise le champ).
  // v8.41 — On stocke aussi iobill_status pour signaler brouillon/émis côté UI.
  await supabase.from('orders').update({
    iobill_invoice_id: j.data.credit_note_id,
    iobill_invoice_number: j.data.credit_note_number,
    iobill_pdf_url: j.data.pdf_url || null,
    iobill_status: j.data.status || targetStatus,
    iobill_synced_at: new Date().toISOString(),
    iobill_sync_error: null
  }).eq('id', orderId);

  return res.status(200).json({
    ok: true,
    credit_note_id: j.data.credit_note_id,
    credit_note_number: j.data.credit_note_number,
    pdf_url: j.data.pdf_url || null,
    status: j.data.status || targetStatus,
    facturx_status: j.data.facturx_status || 'pending'
  });
}

// ───────────────────────────────────────────────────────────────────
// SET_AUTO_PUSH
// Body : { enabled: bool }
// ───────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────
// v8.43 — SYNC_CLIENT — Pousse un client IOCAR vers IOBILL
// Body : { client_id }  (id du client côté table IOCAR clients)
//
// Charge le client depuis IOCAR clients, le mappe via mapClientToIobill,
// et appelle l'action sync_client côté pont IOBILL.
// ───────────────────────────────────────────────────────────────────
async function handleSyncClient(garage, supabase, body, res) {
  if (!garage.iobill_api_token) {
    return res.status(400).json({ error: 'Compte IOBILL non lié' });
  }
  const clientId = body?.client_id;
  if (!clientId) return res.status(400).json({ error: 'client_id requis' });

  // Charger le client depuis IOCAR (table clients, architecture similaire à orders)
  const { data: row, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .eq('garage_id', garage.id)
    .single();

  if (error || !row) {
    return res.status(404).json({ error: 'Client introuvable' });
  }

  // Si la table clients utilise un data JSONB comme orders, flatten d'abord
  const client = (row.data && typeof row.data === 'object')
    ? { ...row.data, ...row, id: row.id }
    : row;

  const mappedClient = mapClientToIobill(client);
  if (!mappedClient) {
    return res.status(400).json({ error: 'Impossible de mapper le client' });
  }

  const payload = {
    action: 'sync_client',
    token: garage.iobill_api_token,
    client: mappedClient
  };
  const j = await callIobill(payload);

  if (!j.ok) {
    return res.status(502).json({
      error: 'Échec sync client IOBILL',
      details: j.error, last_error: j.last_error, full_payload: j.full_payload
    });
  }

  return res.status(200).json({
    ok: true,
    client_id: j.data.client_id,
    external_managed: j.data.external_managed
  });
}

// ───────────────────────────────────────────────────────────────────
// v8.43 — DELETE_CLIENT — Supprime un client côté IOBILL
// Body : { client_id } (id IOCAR du client à supprimer)
//
// Appelé quand on supprime un client dans IOCAR. Si le client a des
// factures liées côté IOBILL, soft delete (déverrouille la lecture seule).
// Sinon, hard delete.
// ───────────────────────────────────────────────────────────────────
async function handleDeleteClient(garage, supabase, body, res) {
  if (!garage.iobill_api_token) {
    return res.status(400).json({ error: 'Compte IOBILL non lié' });
  }
  const clientId = body?.client_id;
  if (!clientId) return res.status(400).json({ error: 'client_id requis' });

  const payload = {
    action: 'delete_client',
    token: garage.iobill_api_token,
    external_id: String(clientId)
  };
  const j = await callIobill(payload);

  if (!j.ok) {
    return res.status(502).json({
      error: 'Échec delete client IOBILL',
      details: j.error, last_error: j.last_error, full_payload: j.full_payload
    });
  }

  return res.status(200).json({
    ok: true,
    soft_deleted: !!j.data.soft_deleted,
    hard_deleted: !!j.data.hard_deleted
  });
}

// ───────────────────────────────────────────────────────────────────
// v8.44 — SYNC_ALL_CLIENTS — Backfill : pousse tous les clients IOCAR vers IOBILL
// Body : { } (pas de paramètres)
//
// Itère sur tous les clients du garage et appelle sync_client pour chacun.
// Retourne un compte des succès/échecs. À utiliser après le déploiement v8.44
// pour rattraper les clients déjà existants côté IOCAR.
// ───────────────────────────────────────────────────────────────────
async function handleSyncAllClients(garage, supabase, body, res) {
  if (!garage.iobill_api_token) {
    return res.status(400).json({ error: 'Compte IOBILL non lié' });
  }

  // Récupère tous les clients du garage
  const { data: rows, error } = await supabase
    .from('clients')
    .select('*')
    .eq('garage_id', garage.id);

  if (error) {
    return res.status(500).json({ error: 'Erreur lecture clients : ' + error.message });
  }

  let success = 0;
  let failed = 0;
  const errors = [];

  for (const row of (rows || [])) {
    // Flatten le data JSONB si applicable
    const client = (row.data && typeof row.data === 'object')
      ? { ...row.data, ...row, id: row.id }
      : row;

    const mappedClient = mapClientToIobill(client);
    if (!mappedClient) {
      failed++;
      errors.push({ id: row.id, error: 'Mapping impossible' });
      continue;
    }

    const payload = {
      action: 'sync_client',
      token: garage.iobill_api_token,
      client: mappedClient
    };
    const j = await callIobill(payload);

    if (j.ok) {
      success++;
    } else {
      failed++;
      errors.push({ id: row.id, error: j.error || 'Unknown' });
    }
  }

  return res.status(200).json({
    ok: true,
    total: (rows || []).length,
    success,
    failed,
    errors: errors.slice(0, 10) // Garde max 10 erreurs pour le retour
  });
}

// ───────────────────────────────────────────────────────────────────
// v8.45 — SYNC_CLIENTS_BATCH — Polling : envoie TOUS les clients en 1 seul appel
// Body : { } (pas de paramètres)
//
// Lit tous les clients IOCAR, mappe chacun via mapClientToIobill, envoie
// la liste complète à IOBILL action 'sync_clients_batch'. IOBILL upsert
// chaque client et supprime ceux qui ne sont plus dans la liste.
//
// Appelé par le polling 5s côté front IOCAR (App.jsx setInterval).
// ───────────────────────────────────────────────────────────────────
async function handleSyncClientsBatchFromIocar(garage, supabase, body, res) {
  if (!garage.iobill_api_token) {
    return res.status(400).json({ error: 'Compte IOBILL non lié' });
  }

  // Récupère tous les clients du garage
  const { data: rows, error } = await supabase
    .from('clients')
    .select('*')
    .eq('garage_id', garage.id);

  if (error) {
    return res.status(500).json({ error: 'Erreur lecture clients : ' + error.message });
  }

  const mappedClients = [];
  for (const row of (rows || [])) {
    const client = (row.data && typeof row.data === 'object')
      ? { ...row.data, ...row, id: row.id }
      : row;
    const m = mapClientToIobill(client);
    if (m && m.external_id) mappedClients.push(m);
  }

  const payload = {
    action: 'sync_clients_batch',
    token: garage.iobill_api_token,
    clients: mappedClients
  };
  const j = await callIobill(payload);

  if (!j.ok) {
    return res.status(502).json({
      error: 'Échec batch sync IOBILL',
      details: j.error, last_error: j.last_error
    });
  }

  return res.status(200).json({
    ok: true,
    sent: mappedClients.length,
    ...j.data
  });
}

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
  const vehicleLabel = sanitizeString([v.marque, v.modele, v.finition].filter(Boolean).join(' ')
    || (order.vehicle_label || 'Véhicule'));
  // ⚠️ Côté IOCAR, le champ d'immatriculation s'appelle `plate`, pas `immatriculation`
  const vehiclePlate = sanitizeString(v.plate || order.vehicle_plate || '');
  const km = v.kilometrage ? `${Number(v.kilometrage).toLocaleString('fr-FR')} km` : '';
  const description1 = sanitizeString(`VENTE VÉHICULE — ${vehicleLabel}${vehiclePlate ? ' (' + vehiclePlate + ')' : ''}${km ? ' · ' + km : ''}`);

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
  // v8.39 — L3 (CARTE GRISE) : SORTIE des lines, mise en débours séparés
  // Conformément à l'art. 267 II 2° du CGI : la CG est un débours (le garage
  // refacture EXACTEMENT ce qu'il a payé au Trésor Public, sans marge, sans TVA).
  // Les débours apparaîtront dans un bloc séparé sous les totaux sur le PDF
  // IOBILL, hors base TVA (donc hors subtotal_ht_cents / vat_total_cents,
  // mais inclus dans le total à payer).
  const debours = [];
  if (carteGrise > 0) {
    debours.push({
      label: 'Carte grise',
      amount_cents: Math.round(carteGrise * 100 * sign),
      legal_basis: 'art. 267 II 2° du CGI',
      reference: order.carte_grise_reference || null
    });
  }
  // L4 — reprise (ligne négative)
  if (reprise > 0) {
    const reprDesc = sanitizeString([
      'Reprise véhicule',
      order.reprise_plate ? `· ${order.reprise_plate}` : '',
      order.reprise_marque || order.reprise_modele
        ? `· ${[order.reprise_marque, order.reprise_modele].filter(Boolean).join(' ')}`
        : ''
    ].filter(Boolean).join(' '));
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
      paid_at: toIsoDate(order.date_facture || order.date_creation),
      notes: 'Acompte versé à la signature (IO CAR)',
      reference: order.ref ? sanitizeString(`Acompte ${order.ref}`) : null
    });
  }
  if (Array.isArray(order.paiements)) {
    for (const p of order.paiements) {
      const montant = Number(p.montant) || 0;
      if (montant <= 0) continue;
      payments.push({
        amount_cents: Math.round(montant * 100),
        method: mapPaymentMethod(p.mode),
        paid_at: toIsoDate(p.date),
        notes: sanitizeString(p.note) || null,
        reference: sanitizeString(order.ref) || null
      });
    }
  }

  // ─── Client : structure IOCAR = order.client { name, address, phone, email, siren }
  // Si siren rempli → société. Sinon particulier (on splite le name).
  // v8.44 — On extrait aussi l'external_id du client (id IOCAR) pour permettre
  // à IOBILL de matcher par (external_source, external_id) → ZÉRO doublon, même
  // si l'email/téléphone change.
  const cli = order.client || {};
  const hasSiren = !!(cli.siren && String(cli.siren).trim());
  const cleanAddress = cli.address ? sanitizeString(cli.address, ' — ') : null;
  // L'external_id du client : prioritairement order.client_id (réf stable en BDD),
  // sinon order.client.id (cas où le client est embedded directement).
  const clientExternalId = order.client_id || cli.id || null;
  let clientPayload;
  if (hasSiren) {
    clientPayload = {
      external_id: clientExternalId ? String(clientExternalId) : null,
      legal_name: sanitizeString(cli.name) || null,
      first_name: null,
      last_name: null,
      siret: String(cli.siren).replace(/\s/g, '') || null,
      email: sanitizeString(cli.email) || null,
      phone: sanitizeString(cli.phone) || null,
      address_line1: cleanAddress,
      postal_code: null,
      city: null,
      country: 'FR'
    };
  } else {
    // Splite "Jean Dupont" en first=Jean / last=Dupont (heuristique simple)
    const fullName = sanitizeString(String(cli.name || '').trim());
    const parts = fullName.split(/\s+/);
    const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || null);
    const lastName = parts.length > 1 ? parts[parts.length - 1] : null;
    clientPayload = {
      external_id: clientExternalId ? String(clientExternalId) : null,
      legal_name: null,
      first_name: firstName || null,
      last_name: lastName || null,
      siret: null,
      email: sanitizeString(cli.email) || null,
      phone: sanitizeString(cli.phone) || null,
      address_line1: cleanAddress,
      postal_code: null,
      city: null,
      country: 'FR'
    };
  }

  return {
    external_id: order.id,
    number: sanitizeString(order.ref) || `IOCAR-${String(order.id || '').slice(0, 8).toUpperCase()}`,
    issue_date: toIsoDate(order.date_facture || order.date_creation),
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
      vin: sanitizeString(v.vin) || null,
      marque: sanitizeString(v.marque) || null,
      modele: sanitizeString(v.modele) || null,
      finition: sanitizeString(v.finition) || null,
      annee: v.annee || null,
      kilometrage: v.kilometrage || null,
      carburant: sanitizeString(v.carburant) || null,
      genre: sanitizeString(v.genre) || null,
      // v8.47 — Champs enrichis pour reproduire le layout PDF IOCAR
      date_mise_en_circulation: sanitizeString(v.date_mise_en_circulation) || null,
      puissance_cv: v.puissance_cv || null,              // Chevaux (ex: 143)
      puissance_fiscale: v.puissance_fiscale || null,    // CV fiscaux (ex: 5)
      options: sanitizeString(v.options) || null,
      // Garantie : issue de l'order (pas du véhicule)
      garantie_mois: order.garantie_mois || 0
    },
    // v8.39 — Les mentions sont stock\u00e9es au niveau company (saisies une fois
    // dans Param\u00e8tres > Mentions garage). On les enrichit juste ici si l'order
    // a des sp\u00e9cificit\u00e9s qui surchargent les valeurs par d\u00e9faut.
    business_mentions: buildOrderSpecificMentions(order),
    // v8.39 — Débours (CG, malus...) : hors TVA, sortis du tableau lignes
    debours: debours.length > 0 ? debours : null,
    vat_regime: avecTva ? 'standard' : 'margin_297a'
  };
}

// v8.39 — Construit les mentions SP\u00c9CIFIQUES \u00e0 cet order qui surchargent
// les mentions globales du garage. Renvoie null si rien de sp\u00e9cifique
// \u2192 le PDF utilisera alors company.business_mentions par d\u00e9faut.
function buildOrderSpecificMentions(order) {
  const overrides = {};
  const garantieMois = parseInt(order.garantie_mois) || 0;

  // Si l'order a une dur\u00e9e de garantie diff\u00e9rente de la valeur par d\u00e9faut
  // garage, on peut g\u00e9n\u00e9rer une note de surcharge. Pour l'instant on
  // se contente d'ajouter une mention discr\u00e8te quand la garantie est
  // explicitement \u00e0 0 (vendu sans garantie commerciale).
  if (garantieMois === 0 && order.garantie_mois !== undefined) {
    overrides.garantie_override = sanitizeString(
      'V\u00e9hicule vendu sans garantie commerciale (uniquement les garanties l\u00e9gales).'
    );
  } else if (garantieMois > 0) {
    overrides.garantie_duree = `${garantieMois} mois`;
  }

  // Date de cession sp\u00e9cifique \u00e0 cet order
  if (order.cession_date) {
    overrides.cession_date = order.cession_date;
    if (order.cession_heure) overrides.cession_heure = order.cession_heure;
  }

  return Object.keys(overrides).length > 0 ? overrides : null;
}

// v8.43 — Helper : mappe un client IOCAR vers la structure attendue par IOBILL.
// Réutilisable pour push_invoice (snapshot) + sync_client (proactif).
//
// Convention IOCAR : un client a { id, name, address, phone, email, siren }
// - name est "Prénom Nom" pour particuliers ou raison sociale pour pros
// - siren rempli (9 chiffres) → société
// - address est un texte multiligne (rue \n CP ville)
function mapClientToIobill(cli) {
  if (!cli) return null;
  const hasSiren = !!(cli.siren && String(cli.siren).trim());
  // Adresse multi-ligne : on parse en line1/postal_code/city (réutilise parseGarageAddress)
  const addrParsed = parseGarageAddress(cli.address);

  if (hasSiren) {
    return {
      external_id: String(cli.id || ''),
      legal_name: sanitizeString(cli.name) || null,
      first_name: null,
      last_name: null,
      siret: String(cli.siren).replace(/\s/g, '') || null,
      email: sanitizeString(cli.email) || null,
      phone: sanitizeString(cli.phone) || null,
      address_line1: addrParsed.line1,
      postal_code: addrParsed.postal_code,
      city: addrParsed.city,
      country: 'FR'
    };
  }

  // Particulier : splite "Jean Dupont" en first=Jean / last=Dupont
  const fullName = sanitizeString(String(cli.name || '').trim());
  const parts = fullName.split(/\s+/);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || null);
  const lastName = parts.length > 1 ? parts[parts.length - 1] : null;

  return {
    external_id: String(cli.id || ''),
    legal_name: null,
    first_name: firstName || null,
    last_name: lastName || null,
    siret: null,
    email: sanitizeString(cli.email) || null,
    phone: sanitizeString(cli.phone) || null,
    address_line1: addrParsed.line1,
    postal_code: addrParsed.postal_code,
    city: addrParsed.city,
    country: 'FR'
  };
}

// v8.39 — Construit un objet company_update à envoyer à IOBILL à chaque push.
// IOBILL utilisera ces champs pour remplir les valeurs vides côté companies
// (au cas où link_account initial avait des données incomplètes).
//
// v8.40.3 — CORRECTION CRITIQUE : les colonnes IOCAR sont au top-level
// avec les noms suivants (voir migration garages) :
//   - name (raison sociale, pas "nom")
//   - address (adresse complète multiligne, pas "adresse")
//   - phone (pas "telephone")
//   - tva_num (pas "tva_intra")
//   - siret, email, logo, business_mentions
//
// Et l'adresse est un texte MULTILIGNE :
//   "ROUTE NATIONALE 568
//    13740 LE ROVE"
// → On parse pour extraire ligne1, code_postal, ville.
function buildCompanyUpdateFromGarage(garage) {
  // Parse l'adresse multiligne IOCAR pour extraire line1 / CP / ville
  const addrParsed = parseGarageAddress(garage.address);
  return {
    legal_name: garage.name || null,
    trade_name: null,  // pas de champ dédié côté IOCAR
    siret: garage.siret || null,
    vat_number: garage.tva_num || null,
    ape_code: null,    // pas de champ dédié côté IOCAR
    phone: garage.phone || null,
    website: null,     // pas de champ dédié côté IOCAR
    address: {
      line1: addrParsed.line1,
      postal_code: addrParsed.postal_code,
      city: addrParsed.city,
      country: 'FR'
    },
    business_mentions: garage.business_mentions || null,
    // v8.39 — Logo base64 stocké au top-level dans garages.logo
    // IOBILL uploadera vers son bucket company-logos UNIQUEMENT si logo_url
    // est vide côté IOBILL (préserve un logo défini manuellement par l'user).
    logo_base64: garage.logo || null
  };
}

// Parse une adresse multiligne style :
//   "ROUTE NATIONALE 568
//    13740 LE ROVE"
// → { line1: "ROUTE NATIONALE 568", postal_code: "13740", city: "LE ROVE" }
//
// Tolère aussi une seule ligne avec CP + ville à la fin, ou inversement,
// ou des lignes intermédiaires (qui sont ajoutées à line1).
function parseGarageAddress(addressText) {
  if (!addressText || typeof addressText !== 'string') {
    return { line1: null, postal_code: null, city: null };
  }
  const lines = addressText.split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return { line1: null, postal_code: null, city: null };

  // Cherche la ligne qui contient le code postal (5 chiffres en début)
  const cpRegex = /^(\d{5})\s+(.+)$/;
  let cpLineIdx = -1;
  let postal_code = null, city = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(cpRegex);
    if (m) {
      postal_code = m[1];
      city = m[2];
      cpLineIdx = i;
      break;
    }
  }
  // Toutes les lignes AVANT le CP forment l'adresse (line1)
  let line1 = null;
  if (cpLineIdx > 0) {
    line1 = lines.slice(0, cpLineIdx).join(', ');
  } else if (cpLineIdx === -1) {
    // Pas de CP trouvé, on prend tout en line1
    line1 = lines.join(', ');
  } else {
    // CP sur la 1ère ligne, on n'a pas de line1
    line1 = null;
  }
  return { line1, postal_code, city };
}

// ═══════════════════════════════════════════════════════════════════
// v8.41 — MAPPING : avoir IOCAR → credit_note IOBILL
//
// Structure attendue par IOBILL (table credit_notes) :
//   - source_invoice_number : numéro de la facture source (ex: "FAC-2026-0001")
//                             IOBILL fera le lookup pour retrouver invoice_id
//   - external_id           : id UUID de l'order IOCAR
//   - number                : numéro de l'avoir (ex: "AV-2026-0002")
//   - lines                 : montants en VALEURS ABSOLUES (le signe négatif est
//                             géré côté IOBILL par le statut credit_note)
//   - reason                : motif de l'avoir (optionnel, libre)
//   - status                : "issued" (= équivalent paid pour avoir)
//
// Convention IOCAR : un avoir n'a pas de débours ni de reprise. Il a juste
// un montant (prix_ht en TTC en réalité). On simplifie le mapping.
// ═══════════════════════════════════════════════════════════════════
function mapOrderToCreditNote(order, calc, overrideStatus = null) {
  const avecTva = order.avec_tva !== false;
  const tvaPct = avecTva ? (Number(order.tva_pct) || 20) : 0;

  // Côté IOCAR : prix_ht stocke en réalité le montant TTC de l'avoir
  const ttcAmount = Math.abs(Number(order.prix_ht) || 0);
  const ttcToHt = (ttc) => avecTva ? ttc / (1 + tvaPct / 100) : ttc;

  // Description ligne (réutilise le label véhicule si dispo)
  const v = order.vehicle_data || {};
  const vehicleLabel = sanitizeString([v.marque, v.modele, v.finition].filter(Boolean).join(' ')
    || (order.vehicle_label || 'Véhicule'));
  const vehiclePlate = sanitizeString(v.plate || order.vehicle_plate || '');
  const description1 = order.facture_origine
    ? sanitizeString(`Avoir sur ${order.facture_origine}${vehicleLabel ? ' — ' + vehicleLabel : ''}${vehiclePlate ? ' (' + vehiclePlate + ')' : ''}`)
    : sanitizeString(`Avoir${vehicleLabel ? ' — ' + vehicleLabel : ''}`);

  const lines = [{
    description: description1,
    quantity: 1,
    unit_price_ht_cents: Math.round(ttcToHt(ttcAmount) * 100),
    vat_rate: tvaPct,
    discount_pct: 0
  }];

  // Client — v8.44 ajout external_id pour matching fiable
  const cli = order.client || {};
  const hasSiren = !!(cli.siren && String(cli.siren).trim());
  const cleanAddress = cli.address ? sanitizeString(cli.address, ' — ') : null;
  const clientExternalId = order.client_id || cli.id || null;
  let clientPayload;
  if (hasSiren) {
    clientPayload = {
      external_id: clientExternalId ? String(clientExternalId) : null,
      legal_name: sanitizeString(cli.name) || null,
      first_name: null, last_name: null,
      siret: String(cli.siren).replace(/\s/g, '') || null,
      email: sanitizeString(cli.email) || null,
      phone: sanitizeString(cli.phone) || null,
      address_line1: cleanAddress,
      postal_code: null, city: null, country: 'FR'
    };
  } else {
    const fullName = sanitizeString(String(cli.name || '').trim());
    const parts = fullName.split(/\s+/);
    const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || null);
    const lastName = parts.length > 1 ? parts[parts.length - 1] : null;
    clientPayload = {
      external_id: clientExternalId ? String(clientExternalId) : null,
      legal_name: null,
      first_name: firstName || null, last_name: lastName || null,
      siret: null,
      email: sanitizeString(cli.email) || null,
      phone: sanitizeString(cli.phone) || null,
      address_line1: cleanAddress,
      postal_code: null, city: null, country: 'FR'
    };
  }

  return {
    external_id: order.id,
    number: sanitizeString(order.ref) || `IOCAR-AV-${String(order.id || '').slice(0, 8).toUpperCase()}`,
    issue_date: toIsoDate(order.date_facture || order.date_creation),
    status: overrideStatus || 'issued', // 'draft' à la création, 'issued' au remboursement complet
    source_invoice_number: order.facture_origine || null, // ⚠ requis côté IOBILL
    reason: sanitizeString(order.motif_avoir) || sanitizeString(order.notes) || null,
    client: clientPayload,
    lines
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

// Nettoie une string pour qu'elle soit safe dans pdf-lib (WinAnsi) :
//   - Convertit \r\n et \n et \r en espace (single-line) ou en " - " (compact)
//   - Supprime les caractères de contrôle non-imprimables (sauf espaces)
//   - Trim et compacte les espaces multiples
// Pour les champs MULTILIGNES (notes), utiliser sanitizeMultiline() qui garde \n.
function sanitizeString(s, separator = ' ') {
  if (s == null) return s;
  if (typeof s !== 'string') return s;
  return s
    .replace(/[\r\n]+/g, separator)              // newlines → séparateur
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, '') // contrôles non-imprimables
    .replace(/\s+/g, ' ')                         // espaces multiples → 1 seul
    .trim();
}

// Version multilignes pour les notes : garde les \n mais nettoie le reste
function sanitizeMultiline(s) {
  if (s == null) return s;
  if (typeof s !== 'string') return s;
  return s
    .replace(/\r\n/g, '\n')                       // CRLF → LF
    .replace(/\r/g, '\n')                         // CR → LF
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, '') // contrôles sauf \n et \t
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim();
}

// Convertit une date IOCAR (souvent "DD/MM/YYYY" en français) vers ISO YYYY-MM-DD
// Accepte aussi : Date object, timestamp, déjà-ISO, "YYYY-MM-DD".
// Retourne toujours une string ISO "YYYY-MM-DD" ou today() en fallback.
function toIsoDate(input) {
  const fallback = new Date().toISOString().slice(0, 10);
  if (!input) return fallback;
  // Déjà au bon format ISO ?
  if (typeof input === 'string') {
    const trimmed = input.trim();
    // ISO standard
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    // Format FR : DD/MM/YYYY ou DD-MM-YYYY
    const m = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      const yyyy = m[3];
      return `${yyyy}-${mm}-${dd}`;
    }
    // Format compact YYYYMMDD
    const c = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (c) return `${c[1]}-${c[2]}-${c[3]}`;
    // Tentative parse natif (peut donner Invalid Date)
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return fallback;
  }
  if (input instanceof Date && !isNaN(input.getTime())) {
    return input.toISOString().slice(0, 10);
  }
  if (typeof input === 'number') {
    const d = new Date(input);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return fallback;
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
// v8.40.3 — flattenGarage : utilitaire défensif.
// IOCAR stocke les champs garage au TOP-LEVEL (name, address, phone, siret,
// tva_num, logo, business_mentions...), pas dans data JSONB comme les orders.
// Cette fonction reste là par sécurité au cas où certaines rows auraient
// quand même un champ `data` à aplatir (rétrocompatibilité). Si pas de data,
// retourne la row inchangée.
function flattenGarage(row) {
  if (!row) return null;
  if (!row.data || typeof row.data !== 'object') return row;
  const { data: nested, ...topLevel } = row;
  return { ...nested, ...topLevel };
}

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
