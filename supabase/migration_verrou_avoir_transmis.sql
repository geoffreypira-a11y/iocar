-- ════════════════════════════════════════════════════════════════════
-- Inaltérabilité des avoirs transmis — IO CAR
-- ════════════════════════════════════════════════════════════════════
--
-- CONSTAT
-- IO BILL protège ses documents par des déclencheurs en base
-- (protect_issued_invoice, protect_issued_lines, chaîne de hachage). IO CAR
-- n'avait RIEN : toute la protection tenait dans le rendu React, et elle ne
-- couvrait que la suppression d'un avoir « émis ». On pouvait donc rouvrir et
-- modifier un avoir déjà transmis à l'administration fiscale — la copie IO CAR
-- divergeait alors en silence de celle d'IO BILL et de celle de la PDP.
--
-- Un verrou dans l'interface ne protège personne de déterminé : le navigateur
-- écrit directement dans PostgREST. Seule la base peut refuser.
--
-- CE QUI EST BLOQUÉ
-- Toute modification du CONTENU (`data`) et toute suppression d'un avoir
-- transmis à la plateforme.
--
-- CE QUI RESTE PERMIS, et c'est essentiel
-- Les colonnes de synchronisation de premier niveau — iobill_status,
-- facturx_status, pdp_transmission_id, pdp_transmitted_at… — restent
-- modifiables : c'est par elles que remonte le statut de la plateforme. Seul
-- `data`, qui porte le document lui-même, est figé.
--
-- Le service_role passe outre, comme chez IO BILL : c'est le pont qui écrit
-- les retours de transmission.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.protect_avoir_transmis()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_transmis BOOLEAN;
BEGIN
  IF current_user = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF COALESCE(OLD.data ->> 'type', '') <> 'avoir' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_transmis := OLD.pdp_transmission_id IS NOT NULL
             OR OLD.pdp_transmitted_at IS NOT NULL
             OR COALESCE(OLD.facturx_status, '') IN ('transmitted','accepted','payment_sent','paid');

  IF NOT v_transmis THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Avoir transmis à l''administration : suppression impossible (document définitif)';
  END IF;

  -- UPDATE : on ne bloque que si le CONTENU change. Les colonnes de
  -- synchronisation doivent rester ouvertes, sinon le statut de la plateforme
  -- ne pourrait plus remonter.
  IF NEW.data IS DISTINCT FROM OLD.data THEN
    RAISE EXCEPTION 'Avoir transmis à l''administration : modification impossible (document définitif)';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_avoir_transmis_protect ON public.orders;
CREATE TRIGGER trg_avoir_transmis_protect
BEFORE UPDATE OR DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.protect_avoir_transmis();

-- ── Vérification ────────────────────────────────────────────────────
-- Doit renvoyer une ligne :
--
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'public.orders'::regclass
--     AND tgname = 'trg_avoir_transmis_protect';
--
-- Et combien d'avoirs sont déjà protégés :
--
--   SELECT count(*) FROM public.orders
--   WHERE data ->> 'type' = 'avoir'
--     AND (pdp_transmission_id IS NOT NULL OR pdp_transmitted_at IS NOT NULL);
-- ════════════════════════════════════════════════════════════════════
