// api/get-image-url.js — génère une URL signée pour afficher une image privée
import { verifyUser, setCors } from './_lib/auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await verifyUser(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { supabase } = auth;

    const { bucket, path } = req.body || {};
    if (!['logos','signatures'].includes(bucket) || !path) {
      return res.status(400).json({ error: 'Paramètres invalides' });
    }

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ signedUrl: data.signedUrl });

  } catch (e) {
    console.error('get-image-url:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
