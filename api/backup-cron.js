// ═══════════════════════════════════════════════════════════════
// Backup automatique quotidien — appelé par Vercel Cron à minuit
// Écrase toujours le même fichier : backups/backup_latest.json
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://lnukqnopmlvaqxbdwhst.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  // Sécurité : vérifier que c'est bien Vercel Cron qui appelle
  if (req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  try {
    const headers = {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json"
    };

    // 1. Récupérer tous les garages
    const garagesRes = await fetch(`${SUPABASE_URL}/rest/v1/garages?order=created_at.asc`, { headers });
    const garages = await garagesRes.json();

    // 2. Pour chaque garage, récupérer toutes les tables
    const tables = ["vehicles", "orders", "clients", "livre_police"];
    const backup = {
      version: "1.0",
      backup_date: new Date().toISOString(),
      backup_type: "daily_auto",
      total_garages: garages.length,
      garages: []
    };

    for (const garage of garages) {
      const garageData = {
        id: garage.id,
        name: garage.name,
        email: garage.email,
        siret: garage.siret,
        plan: garage.plan,
        is_active: garage.is_active,
        created_at: garage.created_at,
        data: {}
      };

      for (const table of tables) {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/${table}?garage_id=eq.${garage.id}&order=created_at.asc`,
          { headers }
        );
        garageData.data[table] = r.ok ? await r.json() : [];
      }

      backup.garages.push(garageData);
    }

    const backupJson = JSON.stringify(backup);

    // 3. Uploader dans Supabase Storage — écrase toujours backup_latest.json
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/backups/backup_latest.json`,
      {
        method: "POST",
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          "x-upsert": "true" // ← écrase si existe déjà
        },
        body: backupJson
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`Storage upload failed: ${err}`);
    }

    const sizeKb = Math.round(backupJson.length / 1024);
    console.log(`✅ Backup OK — ${backup.total_garages} garages — ${sizeKb} KB`);
    res.status(200).json({
      success: true,
      backup_date: backup.backup_date,
      garages: backup.total_garages,
      size_kb: sizeKb
    });

  } catch(err) {
    console.error("❌ Backup failed:", err.message);
    res.status(500).json({ error: err.message });
  }
}
