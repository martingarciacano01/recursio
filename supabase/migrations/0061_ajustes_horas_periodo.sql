-- 0061_ajustes_horas_periodo.sql — ajuste GLOBAL de horas trabajadas por
-- persona para un período puntual (delta, puede ser negativo). No es una
-- edición día a día: corrige el total del período antes de liquidar.
CREATE TABLE IF NOT EXISTS nom_ajustes_horas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo_id      UUID NOT NULL REFERENCES nom_periodos(id) ON DELETE CASCADE,
  personal_id     UUID NOT NULL,
  horas_globales  NUMERIC NOT NULL,
  motivo          TEXT,
  creado_por      UUID,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, periodo_id, personal_id)
);
ALTER TABLE nom_ajustes_horas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nom_ajustes_horas_select ON nom_ajustes_horas;
CREATE POLICY nom_ajustes_horas_select ON nom_ajustes_horas FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_ajustes_horas_insert ON nom_ajustes_horas;
CREATE POLICY nom_ajustes_horas_insert ON nom_ajustes_horas FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_ajustes_horas_update ON nom_ajustes_horas;
CREATE POLICY nom_ajustes_horas_update ON nom_ajustes_horas FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_ajustes_horas_delete ON nom_ajustes_horas;
CREATE POLICY nom_ajustes_horas_delete ON nom_ajustes_horas FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_ajustes_horas TO authenticated;
