-- 0058_vista_obras_presencio.sql — contrato de lectura Recursio → Presencio
-- (obras). Mismo patrón que 0001: security_invoker=true para heredar la RLS
-- de la tabla base `obras` con los permisos del usuario que consulta.
--
-- NOTA: columnas asumidas (id, empresa_id, nombre) según el diseño de
-- Presencio documentado en 0001_vistas_contrato.sql (personal.obra_id
-- referencia esta tabla). Verificar contra el esquema real antes de
-- aplicar en producción:
--   select column_name from information_schema.columns
--   where table_name = 'obras' order by ordinal_position;
-- Si difiere, ajustar el SELECT de la vista.

CREATE OR REPLACE VIEW nom_v_obras AS
  SELECT id, empresa_id, nombre
  FROM obras;

ALTER VIEW nom_v_obras SET (security_invoker = true);

GRANT SELECT ON nom_v_obras TO authenticated;
GRANT SELECT ON nom_v_obras TO service_role;
