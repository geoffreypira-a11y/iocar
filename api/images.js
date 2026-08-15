// api/images.js — endpoint consolidé pour gestion d'images (v8.61.1)
//
// Fusion de :
//   - /api/get-image-url  → action=get_signed_url
//   - /api/upload-image   → action=upload
//
// Objectif : libérer 1 slot Vercel Hobby (11 → 10 fonctions).
// Compatibilité descendante : les URLs historiques /api/get-image-url et
// /api/upload-image continuent de fonctionner via des rewrites déclarés
// dans vercel.json (le frontend n'a AUCUNE modification à faire).
//
// L'action est détectée dans cet ordre :
//   1. req.query.action (rempli par les rewrites Vercel)
//   2. req.body.action  (au cas où un futur appel serait direct)
import { verifyUser, rateLimit, setCors } from './_lib/auth.js';

export const config = {
  api: { bodyParser: { sizeLimit: '3mb' } }  // pour upload en dataURL
};

const BUCKETS = {
  logo:      { bucket: 'logos',      maxBytes: 2_000_000 },
  signature: { bucket: 'signatures', maxBytes: 500_000 },
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await verifyUser(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    // Détection action : query (via rewrite) puis body (fallback direct)
    const action = req.query.action || (req.body && req.body.action) || null;
    if (!action) return res.status(400).json({ error: 'Action manquante' });

    switch (action) {
      case 'get_signed_url':
        return handleGetSignedUrl(auth, req, res);
      case 'upload':
        return handleUpload(auth, req, res);
      default:
        return res.status(400).json({ error: `Action inconnue: ${action}` });
    }
  } catch (e) {
    console.error('images:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ─── ACTION : GET_SIGNED_URL ────────────────────────────────────────
// Reprise à l'identique de l'ancien /api/get-image-url
async function handleGetSignedUrl(auth, req, res) {
  const { supabase } = auth;
  const { bucket, path } = req.body || {};
  if (!['logos', 'signatures'].includes(bucket) || !path) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 3600);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ signedUrl: data.signedUrl });
}

// ─── ACTION : UPLOAD ────────────────────────────────────────────────
// Reprise à l'identique de l'ancien /api/upload-image
async function handleUpload(auth, req, res) {
  const { user, garage, supabase } = auth;
  if (!garage) return res.status(403).json({ error: 'Garage introuvable' });

  if (!rateLimit(`upload:${user.id}`, 20)) {
    return res.status(429).json({ error: 'Trop de requêtes' });
  }

  const { kind, dataUrl, filename } = req.body || {};
  const cfg = BUCKETS[kind];
  if (!cfg) return res.status(400).json({ error: 'kind invalide (logo | signature)' });
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'dataUrl manquante' });
  }

  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return res.status(400).json({ error: 'dataURL invalide' });
  const mime = m[1];
  const b64  = m[2];
  const buf  = Buffer.from(b64, 'base64');

  if (buf.length > cfg.maxBytes) {
    return res.status(413).json({ error: `Fichier trop volumineux (max ${Math.round(cfg.maxBytes/1024)} Ko)` });
  }

  const allowedMime = kind === 'logo'
    ? ['image/png','image/jpeg','image/webp','image/svg+xml']
    : ['image/png'];
  if (!allowedMime.includes(mime)) {
    return res.status(400).json({ error: `Type MIME non autorisé: ${mime}` });
  }

  const ext = mime.split('/')[1].replace('+xml','').replace('jpeg','jpg');
  const safeName = (filename || `${Date.now()}`).replace(/[^a-z0-9._-]/gi, '').slice(0, 80);
  const path = `garage_${garage.id}/${safeName}.${ext}`;

  const { error } = await supabase.storage
    .from(cfg.bucket)
    .upload(path, buf, {
      contentType: mime,
      upsert: true,
    });

  if (error) {
    console.error('Storage upload:', error);
    return res.status(500).json({ error: error.message });
  }

  const { data: signed } = await supabase.storage
    .from(cfg.bucket)
    .createSignedUrl(path, 3600);

  return res.status(200).json({
    path,
    bucket: cfg.bucket,
    signedUrl: signed?.signedUrl || null,
  });
}
