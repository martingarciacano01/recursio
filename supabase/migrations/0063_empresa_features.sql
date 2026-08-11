-- 0063_empresa_features.sql — toggles por empresa de las funcionalidades
-- nuevas del plan convenios-por-obra (2026-08-07). No todos los clientes
-- necesitan convenio por obra, topes por obra, ajuste global de horas o
-- bonos no remunerativos: el superadmin habilita cada una por empresa
-- desde Superadmin. Sin fila = feature apagada (default seguro: nada nuevo
-- se activa solo).
--
-- Claves reconocidas por el frontend/edge function (no hay CHECK acá para
-- no tener que migrar si se agrega una nueva feature más adelante):
--   'convenios_por_obra'      — clonar convenio hacia una obra puntual
--   'topes_horas_por_obra'    — tope de horas diarias/jornada por obra
--   'ajuste_horas_periodo'    — ajuste global de horas por persona/período
--   'bonos_no_remunerativos'  — catálogo de bonos + aplicación + excepción
CREATE TABLE IF NOT EXISTS nom_empresa_features (
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (empresa_id, feature)
);
ALTER TABLE nom_empresa_features ENABLE ROW LEVEL SECURITY;

-- Lectura: la propia empresa necesita saber qué tiene habilitado para
-- mostrar/ocultar UI; superadmin ve todas.
DROP POLICY IF EXISTS nom_empresa_features_select ON nom_empresa_features;
CREATE POLICY nom_empresa_features_select ON nom_empresa_features FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());

-- Escritura: SOLO superadmin. Habilitar/deshabilitar features de un cliente
-- es una decisión comercial/de soporte, no algo que la empresa se
-- autogestione.
DROP POLICY IF EXISTS nom_empresa_features_insert ON nom_empresa_features;
CREATE POLICY nom_empresa_features_insert ON nom_empresa_features FOR INSERT TO authenticated
  WITH CHECK (is_superadmin());
DROP POLICY IF EXISTS nom_empresa_features_update ON nom_empresa_features;
CREATE POLICY nom_empresa_features_update ON nom_empresa_features FOR UPDATE TO authenticated
  USING (is_superadmin()) WITH CHECK (is_superadmin());
DROP POLICY IF EXISTS nom_empresa_features_delete ON nom_empresa_features;
CREATE POLICY nom_empresa_features_delete ON nom_empresa_features FOR DELETE TO authenticated
  USING (is_superadmin());

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_empresa_features TO authenticated;
GRANT SELECT ON nom_empresa_features TO service_role;
