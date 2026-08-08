-- 0062_bonos_no_remunerativos.sql
-- Catálogo de bonos globales, definidos por SUPERADMIN (empresa_id NULL) y
-- visibles para todas las empresas. El monto base se define acá; cada
-- empresa lo aplica a una obra (o a toda la empresa) con su propio monto.
CREATE TABLE IF NOT EXISTS nom_bonos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  monto_base    NUMERIC NOT NULL DEFAULT 0,
  descripcion   TEXT,
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (nombre)
);
ALTER TABLE nom_bonos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_bonos_select ON nom_bonos;
CREATE POLICY nom_bonos_select ON nom_bonos FOR SELECT TO authenticated
  USING (true); -- catálogo global de lectura para todas las empresas
DROP POLICY IF EXISTS nom_bonos_insert ON nom_bonos;
CREATE POLICY nom_bonos_insert ON nom_bonos FOR INSERT TO authenticated
  WITH CHECK (is_superadmin());
DROP POLICY IF EXISTS nom_bonos_update ON nom_bonos;
CREATE POLICY nom_bonos_update ON nom_bonos FOR UPDATE TO authenticated
  USING (is_superadmin()) WITH CHECK (is_superadmin());
DROP POLICY IF EXISTS nom_bonos_delete ON nom_bonos;
CREATE POLICY nom_bonos_delete ON nom_bonos FOR DELETE TO authenticated
  USING (is_superadmin());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bonos TO authenticated;

-- Aplicación por EMPRESA + OBRA: qué bono se paga, en qué obra (obra_id
-- NULL = toda la empresa) y con qué monto. Lo administra la empresa.
CREATE TABLE IF NOT EXISTS nom_bono_aplicaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  obra_id     UUID, -- NULL = toda la empresa
  bono_id     UUID NOT NULL REFERENCES nom_bonos(id) ON DELETE CASCADE,
  monto       NUMERIC NOT NULL DEFAULT 0,
  vigencia_desde DATE,
  vigencia_hasta DATE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, obra_id, bono_id)
);
ALTER TABLE nom_bono_aplicaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_bono_aplicaciones_select ON nom_bono_aplicaciones;
CREATE POLICY nom_bono_aplicaciones_select ON nom_bono_aplicaciones FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_bono_aplicaciones_insert ON nom_bono_aplicaciones;
CREATE POLICY nom_bono_aplicaciones_insert ON nom_bono_aplicaciones FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_bono_aplicaciones_update ON nom_bono_aplicaciones;
CREATE POLICY nom_bono_aplicaciones_update ON nom_bono_aplicaciones FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_bono_aplicaciones_delete ON nom_bono_aplicaciones;
CREATE POLICY nom_bono_aplicaciones_delete ON nom_bono_aplicaciones FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bono_aplicaciones TO authenticated;

-- Excepción por PERSONA: monto distinto o desactivado (monto IS NULL).
CREATE TABLE IF NOT EXISTS nom_bono_excepciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id UUID NOT NULL,
  bono_id     UUID NOT NULL REFERENCES nom_bonos(id) ON DELETE CASCADE,
  monto       NUMERIC, -- NULL = bono desactivado para esta persona
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, personal_id, bono_id)
);
ALTER TABLE nom_bono_excepciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_bono_excepciones_select ON nom_bono_excepciones;
CREATE POLICY nom_bono_excepciones_select ON nom_bono_excepciones FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_bono_excepciones_insert ON nom_bono_excepciones;
CREATE POLICY nom_bono_excepciones_insert ON nom_bono_excepciones FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_bono_excepciones_update ON nom_bono_excepciones;
CREATE POLICY nom_bono_excepciones_update ON nom_bono_excepciones FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_bono_excepciones_delete ON nom_bono_excepciones;
CREATE POLICY nom_bono_excepciones_delete ON nom_bono_excepciones FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bono_excepciones TO authenticated;
