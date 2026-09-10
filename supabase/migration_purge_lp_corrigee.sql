-- ═══════════════════════════════════════════════════════════════════
-- Purge du Livre de Police : corriger trois défauts d'une opération
-- IRRÉVERSIBLE (audit du 10/09/2026)
--
-- La version d'origine :
--
--   WHERE (data ->> 'date_entree')::DATE < NOW() - INTERVAL '5 years'
--
-- 1) LÈVE UNE ERREUR. IO CAR stocke les dates au format français
--    (`toLocaleDateString("fr-FR")` → « 25/09/2026 »). Avec le DateStyle
--    par défaut de PostgreSQL (ISO, MDY), '25/09/2026'::DATE échoue —
--    « date/time field value out of range ». La fonction s'arrête dès
--    qu'une entrée a un jour supérieur à 12, c'est-à-dire presque
--    toujours. Elle n'a donc probablement jamais purgé quoi que ce soit.
--
-- 2) SE TROMPE DE DATES quand elle ne lève pas d'erreur. '10/09/2026'
--    est lu comme le 9 octobre : jour et mois inversés.
--
-- 3) SE TROMPE DE CRITÈRE. Elle compte depuis l'ENTRÉE du véhicule.
--    Un véhicule resté six ans en stock et vendu hier serait effacé
--    aussitôt, alors que la vente est récente. Le registre se conserve
--    à compter de la SORTIE.
--
-- La version ci-dessous :
--   • lit la date avec to_date(..., 'DD/MM/YYYY'), format explicite ;
--   • se garde par une expression régulière — une valeur malformée est
--     ignorée plutôt que de faire échouer la purge entière ;
--   • ne purge QUE les véhicules effectivement sortis, cinq ans après
--     leur sortie. Un véhicule encore en stock reste au registre, quel
--     que soit son âge.
--
-- Elle ne peut donc que supprimer MOINS de lignes que l'ancienne.
-- ═══════════════════════════════════════════════════════════════════

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
     WHERE (data ->> 'date_sortie') ~ '^\d{2}/\d{2}/\d{4}$'
       AND to_date(data ->> 'date_sortie', 'DD/MM/YYYY') < (NOW() - INTERVAL '5 years')
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_livre_police_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_livre_police_expired() TO service_role;

-- ── Aperçu AVANT purge, à lancer d'abord : rien n'est supprimé ──
-- SELECT id, data ->> 'num_ordre'   AS num,
--            data ->> 'immat'       AS immat,
--            data ->> 'date_sortie' AS sortie
--   FROM public.livre_police
--  WHERE (data ->> 'date_sortie') ~ '^\d{2}/\d{2}/\d{4}$'
--    AND to_date(data ->> 'date_sortie', 'DD/MM/YYYY') < (NOW() - INTERVAL '5 years')
--  ORDER BY sortie;
