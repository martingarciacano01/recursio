-- 0046_accesos_log.sql — auditoría de accesos a datos sensibles
-- (Fase 1, Task 1.6; numeración original del plan era 0031, ocupada por
-- el seed de conceptos — reservada como 0044 en el plan de la Fase 5H,
-- pero acá ya se usó 0044 para el grant de nom_usuarios_empresas y 0045
-- para el fix del bypass de superadmin, así que queda como 0046).
CREATE TABLE IF NOT EXISTS nom_accesos_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id  UUID NOT NULL,
  recurso     TEXT NOT NULL CHECK (recurso IN ('recibo_pdf','export_csv','liquidacion_detalle','libro_sueldos')),
  recurso_id  UUID,
  detalle     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_accesos_log ENABLE ROW LEVEL SECURITY;

-- Solo admin (y superadmin vía is_superadmin()) leen el log; nadie lo
-- edita ni lo borra: un log de auditoría que el auditado puede modificar
-- no sirve de nada.
DROP POLICY IF EXISTS nom_accesos_log_select ON nom_accesos_log;
CREATE POLICY nom_accesos_log_select ON nom_accesos_log FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin'])));

GRANT SELECT ON nom_accesos_log TO authenticated;
CREATE INDEX IF NOT EXISTS nom_accesos_log_empresa_idx ON nom_accesos_log(empresa_id, created_at DESC);

-- El INSERT va solo por esta RPC: el cliente no puede falsear usuario_id.
CREATE OR REPLACE FUNCTION registrar_acceso(p_recurso TEXT, p_recurso_id UUID, p_detalle TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO nom_accesos_log (empresa_id, usuario_id, recurso, recurso_id, detalle)
  VALUES (auth_empresa_id(), auth.uid(), p_recurso, p_recurso_id, p_detalle);
END $$;
GRANT EXECUTE ON FUNCTION registrar_acceso(TEXT, UUID, TEXT) TO authenticated;
