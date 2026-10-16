-- ═══════════════════════════════════════════════════════════════
--  IO CAR — SÉCURITÉ : colonnes de garages réservées au serveur
-- ═══════════════════════════════════════════════════════════════
-- Faille corrigée : la règle « garages_update_own » laissait un abonné
-- modifier N'IMPORTE QUELLE colonne de sa fiche par l'API REST, y compris
-- is_admin. Un abonné pouvait donc se déclarer admin et lire les données de
-- tous les garages. L'application retirait bien ces champs avant l'envoi,
-- mais la base ne les protégeait pas.
--
-- Ce que fait ce script :
--   1) Une requête faite avec le jeton d'un ABONNÉ (rôle `authenticated`)
--      ne peut plus changer les colonnes réservées : la valeur en base est
--      conservée, sans erreur. Le reste de la mise à jour passe normalement
--      (nom, adresse, logo, préférences…). Pas d'erreur volontairement : un
--      onglet resté ouvert renvoie parfois une ancienne valeur de `plan` ou
--      `trial_ends_at` avec ses Paramètres ; l'enregistrement ne doit pas
--      échouer pour autant — et cette vieille valeur n'écrase plus celle
--      posée entre-temps par Stripe ou l'admin.
--   2) Un abonné ne peut plus créer de fiche garage par l'API : la création
--      se fait uniquement à l'inscription, par handle_new_user (base).
--
-- Ce que ce script NE touche PAS :
--   • la clé de service (webhook Stripe, pont IOBILL, panneau admin,
--     sauvegardes) : rôle `service_role`, non concerné ;
--   • les fonctions de la base (handle_new_user, consume_plate_lookup) :
--     elles s'exécutent sous leur propriétaire, non concernées ;
--   • l'admin connecté (is_admin) : non concerné ;
--   • les autres tables.
--
-- Idempotent : peut être relancé sans risque.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1) Colonnes réservées au serveur ─────────────────────────
CREATE OR REPLACE FUNCTION public.garages_proteger_colonnes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Seules les requêtes portant le jeton d'un utilisateur sont concernées.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  -- L'admin garde la main (et ne peut l'être devenu que par le serveur).
  IF public.is_current_user_admin() THEN
    RETURN NEW;
  END IF;

  -- Droits et identité
  NEW.is_admin                := OLD.is_admin;
  NEW.user_id                 := OLD.user_id;
  NEW.created_at              := OLD.created_at;
  -- Abonnement et essai (Stripe, admin)
  NEW.is_active               := OLD.is_active;
  NEW.plan                    := OLD.plan;
  NEW.trial_ends_at           := OLD.trial_ends_at;
  NEW.sub_status              := OLD.sub_status;
  NEW.stripe_customer_id      := OLD.stripe_customer_id;
  NEW.stripe_subscription_id  := OLD.stripe_subscription_id;
  NEW.subscribed_at           := OLD.subscribed_at;
  NEW.payment_failed_at       := OLD.payment_failed_at;
  -- Archivage (admin)
  NEW._archived               := OLD._archived;
  NEW.archive_date            := OLD.archive_date;
  NEW.archive_raison          := OLD.archive_raison;
  -- Liaison IO BILL (pont serveur)
  NEW.iobill_company_id       := OLD.iobill_company_id;
  NEW.iobill_api_token        := OLD.iobill_api_token;
  NEW.iobill_linked_at        := OLD.iobill_linked_at;
  NEW.iobill_email            := OLD.iobill_email;
  -- Compteur de recherches de plaque : tenu par consume_plate_lookup.
  -- Le remettre à zéro depuis le navigateur rendait des recherches gratuites.
  NEW.api_usage               := OLD.api_usage;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS garages_proteger_colonnes ON public.garages;
CREATE TRIGGER garages_proteger_colonnes
  BEFORE UPDATE ON public.garages
  FOR EACH ROW EXECUTE FUNCTION public.garages_proteger_colonnes();

-- ─── 2) Plus de création de garage par un abonné ──────────────
-- Les garages naissent à l'inscription (trigger on_auth_user_created →
-- handle_new_user, exécuté par la base). Cette règle n'était utilisée par
-- aucun écran, et permettait de créer une seconde fiche avec is_admin = true.
DROP POLICY IF EXISTS "garages_insert_own" ON public.garages;
