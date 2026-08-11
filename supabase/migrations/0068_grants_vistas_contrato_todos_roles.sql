-- 0068_grants_vistas_contrato_todos_roles.sql — cerrar el contrato de
-- lectura Recursio → Presencio para TODOS los roles que lo consultan.
--
-- Síntoma: "permission denied for view nom_v_personal" (app y edge
-- functions). Las vistas contrato (nom_v_personal, nom_v_horas_dia,
-- nom_v_ausencias, nom_v_obras, nom_v_empresa_feriados) usan
-- security_invoker = true (0001/0048/0058): Postgres exige GRANT SELECT
-- sobre la VISTA Y sobre la TABLA BASE para el rol que consulta. Los
-- grants estaban repartidos y con agujeros:
--
--   rol            vista nom_v_*              tablas base de Presencio
--   anon           NO (faltaba)               personal/obras/fichajes si (000_10)
--                                             ausencias NO
--   authenticated  si (0001b/0048/0058)       personal/obras/fichajes si (000_10)
--                                             ausencias NO
--   service_role   si (0009/0048/0058)        personal/fichajes/ausencias si (0010)
--                                             obras/empresas NO
--
-- Resultado: la app con sesión inactiva (consulta como `anon`) fallaba en
-- la vista; la Edge Function fallaría en las tablas base obras/empresas.
-- Esta migración es ADITIVA e idempotente: solo agrega GRANTs, no quita
-- nada, no toca políticas RLS y no afecta a Presencio (que no usa las
-- vistas nom_v_*). La RLS de las tablas base (security_invoker) sigue
-- filtrando filas por empresa: para un usuario anónimo (auth.uid() = null)
-- devuelve 0 filas, así que conceder SELECT a `anon` no expone datos.
--
-- Re-correrse las veces que haga falta, no rompe nada.

-- 1) Vistas contrato → los 3 roles. `anon` necesario para que la app no
--    revente cuando un fetch sale sin sesión activa (RLS sigue filtrando).

GRANT SELECT ON nom_v_personal      TO anon, authenticated, service_role;
GRANT SELECT ON nom_v_horas_dia     TO anon, authenticated, service_role;
GRANT SELECT ON nom_v_ausencias     TO anon, authenticated, service_role;
GRANT SELECT ON nom_v_obras         TO anon, authenticated, service_role;

-- nom_v_empresa_feriados expone config_json; solo lo usan authenticated
-- y la Edge Function. No se otorga a anon a propósito.

GRANT SELECT ON nom_v_empresa_feriados TO authenticated, service_role;

-- 2) Tablas base de Presencio: que cada rol que lee la vista tenga permiso
--    sobre la tabla base (exigencia de security_invoker). Aditivo: repite
--    los grants de fichaobra 000_10 y recursio 0010 sin alterarlos, y
--    cubre los que faltaban (ausencias, obras para authenticated/anon;
--    obras/empresas para service_role).

GRANT SELECT ON personal   TO anon, authenticated, service_role;
GRANT SELECT ON fichajes   TO anon, authenticated, service_role;
GRANT SELECT ON ausencias  TO anon, authenticated, service_role;
GRANT SELECT ON obras      TO anon, authenticated, service_role;
GRANT SELECT ON empresas   TO authenticated, service_role;

-- =====================================================================
-- Diagnóstico rápido (SQL Editor, rol postgres): correr antes y después.
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_name in ('nom_v_personal','personal','nom_v_obras','obras',
--                        'nom_v_ausencias','ausencias','nom_v_horas_dia',
--                        'fichajes','nom_v_empresa_feriados','empresas')
--   order by table_name, grantee;
--
--   -- Reproducir el error como anon (debe devolver 0 filas DESPUÉS de
--   -- esta migración, NO error de permiso):
--   begin; set local role anon; select count(*) from nom_v_personal; rollback;
--   begin; set local role authenticated; select count(*) from nom_v_personal; rollback;
--   begin; set local role service_role;  select count(*) from nom_v_personal; rollback;