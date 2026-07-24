-- 0010_grants_service_role_tablas_presencio.sql
--
-- Root cause de {"liquidadas": 0}: las vistas contrato (nom_v_personal,
-- nom_v_horas_dia, nom_v_ausencias) tienen security_invoker = true
-- (0001), así que Postgres chequea los permisos del rol que consulta
-- sobre las TABLAS BASE de Presencio (personal, fichajes, ausencias),
-- no solo sobre la vista. La 0009 dio GRANT sobre las vistas a
-- service_role, pero en este proyecto los grants siempre se dieron solo
-- a anon/authenticated (fichaobra 000_10_grants_personal.sql, incluso en
-- los default privileges), nunca a service_role. Resultado: la Edge
-- Function recibía "permission denied for table personal" al leer
-- nom_v_personal, el error se ignoraba en el código (data: null) y el
-- loop corría sobre una lista vacía → 0 liquidadas.
--
-- Verificación previa (SQL Editor):
--   begin; set local role service_role;
--   select count(*) from nom_v_personal;
--   rollback;
-- → debe fallar con "permission denied for table personal" antes de esta
--   migración, y devolver el count después.

GRANT SELECT ON personal  TO service_role;
GRANT SELECT ON fichajes  TO service_role;
GRANT SELECT ON ausencias TO service_role;
