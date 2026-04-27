// api/upload-image.js — upload image vers Supabase Storage
// Reçoit une dataURL, vérifie l'auth, stocke dans le bucket approprié
// au préfixe du garage de l'utilisateur.
import { verifyUser, rateLimit, setCors } from './_lib/auth.js';

export const config = {
  api: { bodyParser: { sizeLimit: '3mb' } }  // autorise dataURL jusqu'à ~3 Mo
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

    // Parse data:image/png;base64,xxxx
    const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!m) return res.status(400).json({ error: 'dataURL invalide' });
    const mime = m[1];
    const b64  = m[2];
    const buf  = Buffer.from(b64, 'base64');

    if (buf.length > cfg.maxBytes) {
      return res.status(413).json({ error: `Fichier trop volumineux (max ${Math.round(cfg.maxBytes/1024)} Ko)` });
    }

    // Validation MIME stricte
    const allowedMime = kind === 'logo'
      ? ['image/png','image/jpeg','image/webp','image/svg+xml']
      : ['image/png'];
    if (!allowedMime.includes(mime)) {
      return res.status(400).json({ error: `Type MIME non autorisé: ${mime}` });
    }

    // Chemin : "garage_<uuid>/<filename ou uuid.png>"
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

    // URL signée valable 1h (bucket privé)
    const { data: signed } = await supabase.storage
      .from(cfg.bucket)
      .createSignedUrl(path, 3600);

    return res.status(200).json({
      path,
      bucket: cfg.bucket,
      signedUrl: signed?.signedUrl || null,
    });

  } catch (e) {
    console.error('upload-image:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
