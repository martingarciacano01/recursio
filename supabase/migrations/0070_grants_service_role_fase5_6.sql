-- 0070_grants_service_role_fase5_6.sql
--
-- Fix del bug reportado en vivo (2026-08-11): el tope de horas "no modifica
-- nada". Causa raíz: la Edge Function liquidar-periodo corre con el rol
-- `service_role` (index.ts:146), que bypasea RLS pero NO los GRANTs de
-- tabla. Las tablas de la Fase 0 recibieron GRANT a service_role en 0009 y
-- `empresas` en 0052, pero las tablas nuevas de las Fases 5-6 (config de
-- horas por obra/empresa, ajustes, bonos) solo se concedieron a
-- `authenticated` — la función las leía en silencio (sin chequeo de error)
-- y el cálculo corría SIN tope de horas, SIN jornada configurada, SIN
-- ajustes de horas y SIN bonos.
--
-- Verificado en base: service_role NO tenía SELECT sobre estas tablas.
-- También se cubre nom_firma_empresa (0069): la función no la lee hoy,
-- pero queda cubierta para el mismo patrón futuro.

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_config_horas       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_config_obras       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_ajustes_horas      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bonos              TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bono_aplicaciones  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bono_excepciones   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_firma_empresa      TO service_role;