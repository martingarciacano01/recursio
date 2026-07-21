-- 0001b_grants_vistas_contrato.sql — fix: faltaba el GRANT sobre las
-- vistas contrato. security_invoker hace que la vista respete la RLS de
-- las tablas base, pero Postgres además exige el permiso de objeto
-- (GRANT SELECT) sobre la vista en sí para el rol `authenticated` —
-- sin esto, aunque la RLS de personal/fichajes/ausencias sea correcta,
-- la vista devuelve "permission denied" antes de llegar a evaluarla.

GRANT SELECT ON nom_v_personal  TO authenticated;
GRANT SELECT ON nom_v_horas_dia TO authenticated;
GRANT SELECT ON nom_v_ausencias TO authenticated;
