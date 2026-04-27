// api/_lib/auth.js — utilitaires communs aux endpoints serverless
import { createClient } from '@supabase/supabase-js';

// Client service_role : bypasse RLS — à n'utiliser QUE côté serveur.
export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Extrait + vérifie le JWT utilisateur, retourne { user, garage } ou null
export async function verifyUser(req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  if (!token) return null;

  const admin = getServiceClient();

  // Récupère l'user depuis le token (Supabase vérifie la signature)
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return null;

  const user = userData.user;

  // Récupère le garage associé (lecture via service_role, donc bypass RLS)
  const { data: garage } = await admin
    .from('garages')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  return { user, garage, supabase: admin };
}

// Rate-limit très simple en mémoire — bon pour un premier niveau de protection.
// (En prod à volume élevé, préférer Upstash Redis ou équivalent.)
const rlBucket = new Map();

export function rateLimit(key, maxPerMinute = 60) {
  const now = Date.now();
  const windowMs = 60_000;
  const entry = rlBucket.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  rlBucket.set(key, entry);
  return entry.count <= maxPerMinute;
}

// Helpers CORS minimaux
export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
