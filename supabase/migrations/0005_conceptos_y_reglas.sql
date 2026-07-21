-- 0005_conceptos_y_reglas.sql
CREATE TABLE IF NOT EXISTS nom_conceptos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID REFERENCES empresas(id) ON DELETE CASCADE, -- NULL = plantilla global
  convenio_id  UUID NOT NULL REFERENCES nom_convenios(id) ON DELETE CASCADE,
  codigo       TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('remunerativo','no_remunerativo','descuento','aporte_patronal','informativo')),
  formula      TEXT NOT NULL,
  orden        INTEGER NOT NULL,
  imprimible   BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (convenio_id, empresa_id, codigo)
);
ALTER TABLE nom_conceptos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_conceptos_select ON nom_conceptos;
CREATE POLICY nom_conceptos_select ON nom_conceptos FOR SELECT TO authenticated
  USING (empresa_id IS NULL OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_conceptos_write ON nom_conceptos;
CREATE POLICY nom_conceptos_write ON nom_conceptos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_conceptos_update ON nom_conceptos;
CREATE POLICY nom_conceptos_update ON nom_conceptos FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_conceptos_delete ON nom_conceptos;
CREATE POLICY nom_conceptos_delete ON nom_conceptos FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_conceptos TO authenticated;
CREATE INDEX IF NOT EXISTS nom_conceptos_convenio_idx ON nom_conceptos(convenio_id);

-- Reglas condicionales (4.3): referencian el concepto por FK directa (ya
-- no hay ambigüedad global/empresa porque nom_conceptos es una sola tabla
-- con empresa_id nullable, a diferencia de lo que sugería el plan madre
-- con dos tablas separadas nom_conceptos/nom_conceptos_empresa).
CREATE TABLE IF NOT EXISTS nom_concepto_reglas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto_id  UUID NOT NULL REFERENCES nom_conceptos(id) ON DELETE CASCADE,
  orden        INTEGER NOT NULL,
  condicion    TEXT NOT NULL,
  formula      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_concepto_reglas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_concepto_reglas_all ON nom_concepto_reglas;
CREATE POLICY nom_concepto_reglas_all ON nom_concepto_reglas FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id
            AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id
            AND c.empresa_id = auth_empresa_id())
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_concepto_reglas TO authenticated;
CREATE INDEX IF NOT EXISTS nom_concepto_reglas_concepto_idx ON nom_concepto_reglas(concepto_id);
