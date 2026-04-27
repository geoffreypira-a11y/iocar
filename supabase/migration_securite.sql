-- ═══════════════════════════════════════════════════════════════════════════
--  IO CAR — MIGRATION SÉCURITÉ v1.0
--  À exécuter UNE SEULE FOIS dans Supabase → SQL Editor
--  Ordre : connectez-vous au dashboard Supabase, ouvrez SQL Editor,
--          collez ce fichier complet et cliquez "Run".
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────
--  1) COLONNES MANQUANTES sur GARAGES
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.garages
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS sub_status             TEXT,
  ADD COLUMN IF NOT EXISTS payment_failed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscribed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_usage              JSONB DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_garages_user_id       ON public.garages(user_id);
CREATE INDEX IF NOT EXISTS idx_garages_stripe_cust   ON public.garages(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_garages_email         ON public.garages(email);

-- Marquez votre compte admin (REMPLACEZ par votre email réel avant d'exécuter)
UPDATE public.garages
   SET is_admin = TRUE
 WHERE email = 'johnyjoowls@gmail.com';

-- ──────────────────────────────────────────────────────────────
--  2) ACTIVATION DU ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.garages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.livre_police ENABLE ROW LEVEL SECURITY;

-- Nettoyage d'anciennes politiques éventuelles pour repartir propre
DROP POLICY IF EXISTS "garages_select_own"       ON public.garages;
DROP POLICY IF EXISTS "garages_update_own"       ON public.garages;
DROP POLICY IF EXISTS "garages_insert_own"       ON public.garages;
DROP POLICY IF EXISTS "garages_admin_all"        ON public.garages;

DROP POLICY IF EXISTS "vehicles_own"             ON public.vehicles;
DROP POLICY IF EXISTS "vehicles_admin_all"       ON public.vehicles;
DROP POLICY IF EXISTS "orders_own"               ON public.orders;
DROP POLICY IF EXISTS "orders_admin_all"         ON public.orders;
DROP POLICY IF EXISTS "clients_own"              ON public.clients;
DROP POLICY IF EXISTS "clients_admin_all"        ON public.clients;
DROP POLICY IF EXISTS "livre_police_own"         ON public.livre_police;
DROP POLICY IF EXISTS "livre_police_admin_all"   ON public.livre_police;

-- Fonction utilitaire : "l'utilisateur courant est-il admin ?"
-- IMPORTANT : on la rend SECURITY DEFINER pour qu'elle puisse lire
-- la table garages même si la policy bloque la lecture générale.
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.garages WHERE user_id = auth.uid() LIMIT 1),
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.is_current_user_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;

-- ─── GARAGES ───
CREATE POLICY "garages_select_own" ON public.garages
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_current_user_admin());

CREATE POLICY "garages_update_own" ON public.garages
  FOR UPDATE
  USING (user_id = auth.uid() OR public.is_current_user_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_current_user_admin());

CREATE POLICY "garages_insert_own" ON public.garages
  FOR INSERT
  WITH CHECK (user_id = auth.uid());
-- Note : pas de DELETE exposé — la suppression passera par un endpoint serveur

-- ─── VEHICLES ───
CREATE POLICY "vehicles_own" ON public.vehicles
  FOR ALL
  USING (
    garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
    OR public.is_current_user_admin()
  )
  WITH CHECK (
    garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
    OR public.is_current_user_admin()
  );

-- ─── ORDERS ───
CREATE POLICY "orders_own" ON public.orders
  FOR ALL
  USING (
    garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
    OR public.is_current_user_admin()
  )
  WITH CHECK (
    garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
    OR public.is_current_user_admin()
  );

-- ─── CLIENTS ───
CREATE POLICY "clients_own" ON public.clients
  FOR ALL
  USING (
    garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
    OR public.is_current_user_admin()
  )
  WITH CHECK (
    garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
    OR public.is_current_user_admin()
  );

-- ─── LIVRE DE POLICE ───
CREATE POLICY "livre_police_own" ON public.livre_police
  FOR ALL
  USING (
    garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
    OR public.is_current_user_admin()
  )
  WITH CHECK (
    garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
    OR public.is_current_user_admin()
  );

-- ──────────────────────────────────────────────────────────────
--  3) BUCKETS DE STORAGE + POLITIQUES
-- ──────────────────────────────────────────────────────────────

-- Les buckets se créent via la Storage API ou l'UI Supabase.
-- On les crée ici via un INSERT direct sur storage.buckets.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('logos',      'logos',      FALSE, 2097152,  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('signatures', 'signatures', FALSE, 524288,   ARRAY['image/png']),
  ('backups',    'backups',    FALSE, 52428800, ARRAY['application/json','application/gzip','application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET
  public            = EXCLUDED.public,
  file_size_limit   = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Politiques Storage : convention de nommage "garage_<id>/<fichier>"
-- Un user ne peut accéder qu'aux fichiers sous le préfixe de SON garage.

DROP POLICY IF EXISTS "logos_own_read"   ON storage.objects;
DROP POLICY IF EXISTS "logos_own_write"  ON storage.objects;
DROP POLICY IF EXISTS "logos_own_update" ON storage.objects;
DROP POLICY IF EXISTS "logos_own_delete" ON storage.objects;
DROP POLICY IF EXISTS "sigs_own_read"    ON storage.objects;
DROP POLICY IF EXISTS "sigs_own_write"   ON storage.objects;
DROP POLICY IF EXISTS "sigs_own_update"  ON storage.objects;
DROP POLICY IF EXISTS "sigs_own_delete"  ON storage.objects;
DROP POLICY IF EXISTS "backups_admin"    ON storage.objects;

-- LOGOS : lecture + écriture par le garage propriétaire (ou admin)
CREATE POLICY "logos_own_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'logos'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT 'garage_' || id::text FROM public.garages WHERE user_id = auth.uid()
      )
      OR public.is_current_user_admin()
    )
  );

CREATE POLICY "logos_own_write" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] IN (
      SELECT 'garage_' || id::text FROM public.garages WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "logos_own_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] IN (
      SELECT 'garage_' || id::text FROM public.garages WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "logos_own_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] IN (
      SELECT 'garage_' || id::text FROM public.garages WHERE user_id = auth.uid()
    )
  );

-- SIGNATURES : même logique
CREATE POLICY "sigs_own_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'signatures'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT 'garage_' || id::text FROM public.garages WHERE user_id = auth.uid()
      )
      OR public.is_current_user_admin()
    )
  );

CREATE POLICY "sigs_own_write" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] IN (
      SELECT 'garage_' || id::text FROM public.garages WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "sigs_own_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] IN (
      SELECT 'garage_' || id::text FROM public.garages WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "sigs_own_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'signatures'
    AND (storage.foldername(name))[1] IN (
      SELECT 'garage_' || id::text FROM public.garages WHERE user_id = auth.uid()
    )
  );

-- BACKUPS : jamais lisibles depuis le front, accessibles uniquement par service_role
-- → aucune policy pour `authenticated` = accès refusé par défaut en RLS.
-- Les endpoints serveur utilisent la clé service_role qui bypasse RLS.
-- (Une policy vide sur 'backups' signifie : aucun user ne peut y toucher.)

-- ──────────────────────────────────────────────────────────────
--  4) FONCTION ATOMIQUE — QUOTA RapidAPI + consume
--  Empêche le contournement du quota côté client.
--  À utiliser depuis l'endpoint serveur /api/lookup-plate.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.consume_plate_lookup(
  p_garage_id UUID,
  p_month_key TEXT  -- "2026-04"
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current   JSONB;
  v_used      INT;
  v_quota     INT := 10;          -- 10 recherches gratuites / mois
  v_overage   BOOLEAN;
BEGIN
  -- Lit le compteur actuel
  SELECT COALESCE(api_usage, '{}'::JSONB) INTO v_current
    FROM public.garages
   WHERE id = p_garage_id;

  v_used    := COALESCE((v_current ->> p_month_key)::INT, 0);
  v_overage := v_used >= v_quota;

  -- Incrémente
  UPDATE public.garages
     SET api_usage = COALESCE(api_usage, '{}'::JSONB)
                    || jsonb_build_object(p_month_key, v_used + 1),
         updated_at = NOW()
   WHERE id = p_garage_id;

  RETURN jsonb_build_object(
    'used',      v_used + 1,
    'quota',     v_quota,
    'remaining', GREATEST(0, v_quota - v_used - 1),
    'overage',   v_overage
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_plate_lookup(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_plate_lookup(UUID, TEXT) TO service_role;

-- ──────────────────────────────────────────────────────────────
--  5) PURGE AUTOMATIQUE DU LIVRE DE POLICE > 5 ANS (RGPD)
--  À exécuter manuellement ou via pg_cron si disponible.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_livre_police_expired()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  WITH del AS (
    DELETE FROM public.livre_police
     WHERE (data ->> 'date_entree')::DATE < NOW() - INTERVAL '5 years'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_livre_police_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_livre_police_expired() TO service_role;

-- ──────────────────────────────────────────────────────────────
--  6) VÉRIFICATIONS APRÈS DÉPLOIEMENT
--  Exécutez ces requêtes une par une pour valider.
-- ──────────────────────────────────────────────────────────────

-- A) Toutes les tables ont RLS activé (résultat attendu : toutes à true)
--    SELECT schemaname, tablename, rowsecurity
--      FROM pg_tables
--     WHERE schemaname = 'public'
--       AND tablename IN ('garages','vehicles','orders','clients','livre_police');

-- B) Liste des policies actives (une par table au minimum)
--    SELECT tablename, policyname, cmd
--      FROM pg_policies
--     WHERE schemaname = 'public'
--     ORDER BY tablename, policyname;

-- C) Votre compte est bien admin
--    SELECT email, is_admin FROM public.garages WHERE email = 'votre@email.com';

-- D) Les buckets existent et sont privés
--    SELECT id, public, file_size_limit FROM storage.buckets WHERE id IN ('logos','signatures','backups');

-- ═══════════════════════════════════════════════════════════════════════════
--  FIN — Si tout s'est exécuté sans erreur, votre base est sécurisée.
-- ═══════════════════════════════════════════════════════════════════════════
