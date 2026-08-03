-- 0050_config_horas_extras.sql (Task 2.12) — configuración de horas extras
-- por empresa: si contabiliza HE o no, topes horarios, y jornada por
-- convenio (UOCRA 9h vs LCT 8h, hoy hardcodeado en liquidar-periodo).
CREATE TABLE IF NOT EXISTS nom_config_horas (
  empresa_id                  UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  contabilizar_horas_extras   BOOLEAN NOT NULL DEFAULT true,
  tope_horas_diarias          NUMERIC,
  tope_horas_semanales        NUMERIC,
  tope_horas_quincena         NUMERIC,
  tope_horas_mes              NUMERIC,
  jornada_horas               NUMERIC NOT NULL DEFAULT 8,
  updated_at                  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_config_horas ENABLE ROW LEVEL SECURITY;
-- Mismo patrón que nom_empresa_config (0026/0045, Task 1.2 de la Fase 1 de
-- seguridad): policies separadas por acción, con bypass explícito de
-- superadmin — NO un FOR ALL genérico (ver comentario grande en
-- 0026_rls_roles.sql sobre por qué FOR ALL es de bajo nivel de detalle).
DROP POLICY IF EXISTS nom_config_horas_select ON nom_config_horas;
CREATE POLICY nom_config_horas_select ON nom_config_horas FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])));
DROP POLICY IF EXISTS nom_config_horas_insert ON nom_config_horas;
CREATE POLICY nom_config_horas_insert ON nom_config_horas FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_config_horas_update ON nom_config_horas;
CREATE POLICY nom_config_horas_update ON nom_config_horas FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_config_horas_delete ON nom_config_horas;
CREATE POLICY nom_config_horas_delete ON nom_config_horas FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_config_horas TO authenticated;
