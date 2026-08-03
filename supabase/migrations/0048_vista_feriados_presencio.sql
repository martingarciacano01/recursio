-- 0048_vista_feriados_presencio.sql (Task 2.5) — expone los feriados que
-- Presencio ya cuenta (empresas.config_json->'moduloHorasProyecto'->
-- 'feriados') sin tocar el esquema de `empresas` (contrato
-- 0001_vistas_contrato.sql: Recursio NO escribe en tablas de Presencio,
-- solo lee vistas). Decisión del usuario: no crear nom_feriados propia.
CREATE OR REPLACE VIEW nom_v_empresa_feriados
WITH (security_invoker = true) AS
SELECT id AS empresa_id,
       config_json -> 'moduloHorasProyecto' -> 'feriados' AS feriados
FROM empresas;

GRANT SELECT ON nom_v_empresa_feriados TO authenticated;
GRANT SELECT ON nom_v_empresa_feriados TO service_role;
