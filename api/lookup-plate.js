// api/lookup-plate.js — appel RapidAPI côté serveur
// Avantages : clé jamais exposée au front, quota vérifié atomiquement en DB,
// report Stripe metered si overage.
import Stripe from 'stripe';
import { verifyUser, rateLimit, setCors } from './_lib/auth.js';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const RAPIDAPI_HOST = 'api-de-plaque-d-immatriculation-france.p.rapidapi.com';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Authentification
    const auth = await verifyUser(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { user, garage, supabase } = auth;
    if (!garage) return res.status(403).json({ error: 'Garage introuvable' });
    if (garage.is_active === false) return res.status(403).json({ error: 'Abonnement inactif' });

    // 2. Rate-limit : 30 recherches/min par user max (protection anti-script)
    if (!rateLimit(`plate:${user.id}`, 30)) {
      return res.status(429).json({ error: 'Trop de requêtes, réessayez dans une minute' });
    }

    // 3. Validation du payload
    const { plate } = req.body || {};
    if (!plate || typeof plate !== 'string') {
      return res.status(400).json({ error: 'Plaque manquante' });
    }
    const cleanPlate = plate.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
    if (!cleanPlate) return res.status(400).json({ error: 'Plaque invalide' });

    // 4. Incrémentation atomique du quota via fonction DB
    const monthKey = new Date().toISOString().slice(0, 7); // "2026-04"
    const { data: quotaResult, error: quotaErr } = await supabase
      .rpc('consume_plate_lookup', {
        p_garage_id: garage.id,
        p_month_key: monthKey,
      });

    if (quotaErr) {
      console.error('Erreur quota:', quotaErr);
      return res.status(500).json({ error: 'Erreur serveur' });
    }

    const overage = quotaResult?.overage === true;
    const isAdmin = garage.is_admin === true;

    // 5. Choix de la clé RapidAPI :
    //    - si le garage a SA propre clé (rapidapi_key) → on l'utilise
    //    - sinon → clé globale gérée par vous via variable d'env
    const rapidKey = (garage.rapidapi_key && garage.rapidapi_key.trim())
      || process.env.RAPIDAPI_KEY;

    if (!rapidKey) {
      return res.status(503).json({ error: 'Aucune clé RapidAPI configurée' });
    }

    // 6. Appel RapidAPI
    const url = `https://${RAPIDAPI_HOST}/?plaque=${encodeURIComponent(cleanPlate)}`;
    const rapidRes = await fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': rapidKey,
        'X-RapidAPI-Host': RAPIDAPI_HOST,
        'Content-Type': 'application/json',
      },
    });

    if (!rapidRes.ok) {
      return res.status(502).json({ error: `API plaque indisponible (${rapidRes.status})` });
    }

    const rawData = await rapidRes.json();
    const v = rawData.data || rawData;

    // 7. Report Stripe metered si overage (ignoré pour l'admin)
    //
    // ⚠ NOUVELLE API "Meter Events" (Stripe 2024+)
    // L'ancienne API `subscriptionItems.createUsageRecord` ne fonctionne PAS
    // avec un price configuré comme metered via une "billing.meter".
    // Ici on envoie un meter event avec le nom et la clé customer définis
    // dans le Dashboard Stripe :
    //   - event_name: "api_requests" (nom configuré dans la meter Stripe)
    //   - payload.stripe_customer_id: l'ID Stripe du customer du garage
    //   - payload.value: "1" (1 recherche au-delà du quota gratuit)
    //
    // Stripe agrège (sum) tous les events du mois et facture automatiquement
    // à la fin du cycle de facturation de l'abonnement.
    if (overage && !isAdmin && stripe && garage.stripe_customer_id) {
      try {
        await stripe.billing.meterEvents.create({
          event_name: 'api_requests',
          payload: {
            stripe_customer_id: garage.stripe_customer_id,
            value: '1',
          },
          // identifier optionnel — utile pour idempotence si on relance
          // accidentellement la même requête. On combine garage + timestamp.
          identifier: `lookup-${garage.id}-${Date.now()}`,
        });
      } catch (e) {
        console.error('Report Stripe meter échoué (non bloquant):', e.message);
      }
    }

    // 8. Normalisation de la réponse : on transforme AWN_* en champs propres
    //    pour que le front n'ait pas à connaître le format RapidAPI.
    const dateMEC    = v.AWN_date_mise_en_circulation || '';
    const dateMEC_us = v.AWN_date_mise_en_circulation_us || '';
    let annee = '';
    if (dateMEC_us) annee = parseInt(dateMEC_us.substring(0, 4)) || '';
    else if (dateMEC && dateMEC.length >= 10) annee = parseInt(dateMEC.substring(6, 10)) || '';

    let dateMEC_fr = '';
    if (dateMEC_us) {
      const [y, m, d] = dateMEC_us.split('-');
      dateMEC_fr = `${d}/${m}/${y}`;
    } else if (dateMEC) {
      dateMEC_fr = dateMEC.replace(/-/g, '/');
    }

    const mapCarburant = (e) => {
      const s = (e || '').toLowerCase();
      if (s.includes('gaz') || s === 'es') return 'Essence';
      if (s === 'go' || s.includes('diesel')) return 'Diesel';
      if (s.includes('elec') || s.includes('élec')) return 'Électrique';
      if (s.includes('hyb')) return 'Hybride';
      if (s.includes('gpl')) return 'GPL';
      return '—';
    };

    const vehicle = {
      marque:                   v.AWN_marque              || '',
      modele:                   v.AWN_modele              || v.AWN_modele_prf || '',
      finition:                 v.AWN_label_moteur        || v.AWN_version || '',
      annee:                    annee                     || '',
      motorisation:             v.AWN_code_moteur         || '',
      carburant:                mapCarburant(v.AWN_energie) !== '—'
                                  ? mapCarburant(v.AWN_energie)
                                  : (/kwh/i.test(v.AWN_label_moteur || v.AWN_version || '') ? 'Électrique' : 'Essence'),
      puissance_cv:             v.AWN_puissance_chevaux   || '',
      puissance_fiscale:        v.AWN_puissance_fiscale   || '',
      puissance_kw:             v.AWN_puissance_KW        || '',
      co2:                      v.AWN_emission_co_2       || '',
      boite:                    v.AWN_type_boite_vites    || '',
      transmission:             v.AWN_propulsion          || '',
      couleur:                  v.AWN_couleur             || '',
      couleur_int:              '',
      nb_portes:                v.AWN_nbr_portes          || '',
      nb_places:                v.AWN_nbr_de_places       || '',
      kilometrage:              '',
      vin:                      v.AWN_VIN                 || '',
      genre:                    v.AWN_genre               || 'VP',
      carrosserie:              v.AWN_carrosserie         || '',
      date_mise_en_circulation: dateMEC_fr                || '',
      options:                  [],
    };

    return res.status(200).json({
      vehicle,
      quota: {
        used:      quotaResult.used,
        quota:     quotaResult.quota,
        remaining: quotaResult.remaining,
        overage:   quotaResult.overage,
      },
    });

  } catch (e) {
    console.error('lookup-plate:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
