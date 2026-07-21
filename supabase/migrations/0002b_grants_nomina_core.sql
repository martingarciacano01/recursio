-- 0002b_grants_nomina_core.sql — fix: igual que 0001b, a las tablas de
-- 0002_nomina_core.sql también les faltaba el GRANT de objeto para
-- `authenticated` (la RLS por sí sola no alcanza; Presencio tiene el
-- mismo patrón en 000_10_grants_personal.sql y 026_grants_modulo_horas.sql).

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_legajo     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_convenios  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_categorias TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_parametros TO authenticated;
