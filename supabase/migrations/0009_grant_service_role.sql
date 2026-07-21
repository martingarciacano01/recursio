-- 0009_grant_service_role.sql
--
-- La Edge Function liquidar-periodo usa el cliente de Supabase con la
-- SERVICE_ROLE_KEY (rol `service_role`), que en Postgres bypasea RLS pero
-- NO bypasea los GRANTs de tabla — son dos mecanismos independientes. Las
-- migraciones anteriores (0002, 0004, 0005, 0007) solo otorgaron permisos
-- a `authenticated`, nunca a `service_role`, así que cualquier query desde
-- la Edge Function fallaba con "permission denied for table ...".
--
-- Mismo tipo de lección ya aprendida en Fase 0 (RLS por sí sola no
-- alcanza, hace falta GRANT), esta vez para el rol correcto.

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_legajo               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_convenios             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_categorias            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_parametros            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_familiares            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_sanciones_personal    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_conceptos             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_concepto_reglas       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_periodos              TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_liquidaciones         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_liquidacion_items     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_pagos_adelantos       TO service_role;

-- La Edge Function también lee estas 3 vistas de solo lectura (Fase 0)
-- para armar el snapshot de asistencia.
GRANT SELECT ON nom_v_personal   TO service_role;
GRANT SELECT ON nom_v_horas_dia  TO service_role;
GRANT SELECT ON nom_v_ausencias  TO service_role;
