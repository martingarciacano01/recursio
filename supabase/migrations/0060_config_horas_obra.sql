-- 0060_config_horas_obra.sql — topes de horas y jornada POR OBRA.
-- La resolución en liquidar-periodo es: obra → empresa (nom_config_horas,
-- 0050) → default 8h.
CREATE TABLE IF NOT EXISTS nom_config_obras (
  empresa_id           UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  obra_id              UUID NOT NULL,
  tope_horas_diarias   NUMERIC,
  tope_horas_semanales NUMERIC,
  tope_horas_quincena  NUMERIC,
  tope_horas_mes       NUMERIC,
  jornada_horas        NUMERIC NOT NULL DEFAULT 8,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (empresa_id, obra_id)
);
ALTER TABLE nom_config_obras ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que nom_config_horas (0050): policies separadas por acción,
-- con bypass explícito de superadmin.
DROP POLICY IF EXISTS nom_config_obras_select ON nom_config_obras;
CREATE POLICY nom_config_obras_select ON nom_config_obras FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_config_obras_insert ON nom_config_obras;
CREATE POLICY nom_config_obras_insert ON nom_config_obras FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_config_obras_update ON nom_config_obras;
CREATE POLICY nom_config_obras_update ON nom_config_obras FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_config_obras_delete ON nom_config_obras;
CREATE POLICY nom_config_obras_delete ON nom_config_obras FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_config_obras TO authenticated;
