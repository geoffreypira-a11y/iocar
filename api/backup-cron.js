// IO CAR — Sauvegarde quotidienne automatique
// ═══════════════════════════════════════════════════════════════════
// Déclenché par le cron Vercel déclaré dans vercel.json.
//
// Ce fichier ne faisait RIEN jusqu'ici : il vérifiait le secret, écrivait
// une ligne de log et renvoyait ok. DEPLOIEMENT.md l'annonçait même comme
// supprimé, remplacé par l'action `backup_save` de api/admin.js. Sauf que
// cette action exige `verifyUser()`, donc le jeton d'un admin CONNECTÉ :
// un cron n'a pas de session et ne peut pas l'appeler. La sauvegarde
// n'existait donc que les jours où quelqu'un cliquait — la dernière
// datait de 40 jours.
//
// Il est ici réécrit pour sauvegarder réellement, et réutilisé plutôt que
// remplacé : le plan Hobby de Vercel plafonne à 12 fonctions par
// déploiement, et le projet y est déjà.
//
// Deux authentifications acceptées :
//   • header `x-vercel-cron: 1`, injecté par Vercel sur ses propres appels
//   • `Authorization: Bearer <CRON_SECRET>`, pour un déclenchement manuel

import { saveBackup } from './_lib/backup.js';

export default async function handler(req, res) {
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const hasSecret = secret && req.headers.authorization === `Bearer ${secret}`;

  if (!isVercelCron && !hasSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await saveBackup(isVercelCron ? 'cron' : 'manual_secret');
    console.log('[backup-cron] OK', JSON.stringify({
      filename: result.filename,
      size_kb: result.size_kb,
      garages: result.total_garages,
      purged: result.purged,
      manifest: result.manifest,
    }));
    return res.status(200).json(result);
  } catch (e) {
    // Un échec doit être bruyant : sur le plan Supabase gratuit, c'est la
    // seule protection des données — livre de police compris.
    console.error('[backup-cron] ÉCHEC', e?.stack || e?.message);
    return res.status(500).json({ error: e?.message || 'Échec de la sauvegarde' });
  }
}
