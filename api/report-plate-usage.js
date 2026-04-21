export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { garageId, quantity } = req.body || {};
  if (!garageId || !quantity) return res.status(400).json({ error: 'Missing params' });
  console.log(`Plate usage: garage=${garageId}, qty=${quantity}`);
  res.status(200).json({ ok: true });
}
