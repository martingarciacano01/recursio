-- 0042_grant_legajo_adicionales.sql
--
-- Bug: 0040_adicionales_por_legajo.sql habilitó RLS y creó la policy para
-- nom_legajo_adicionales, pero solo hizo GRANT SELECT a `service_role`
-- (para la Edge Function). Se olvidó el GRANT de objeto para
-- `authenticated` — mismo patrón que 0001b/0002b (la RLS por sí sola no
-- alcanza en Postgres: sin el GRANT, cualquier lectura desde el cliente
-- devuelve "permission denied for table nom_legajo_adicionales", como se
-- ve en la pestaña Adicionales de un legajo). Reportado por Martin,
-- 2026-07-30.

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_legajo_adicionales TO authenticated;
