export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  console.log('Backup cron triggered');
  res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
}
