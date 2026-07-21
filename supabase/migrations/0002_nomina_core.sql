-- 0002_nomina_core.sql — esquema núcleo de nómina (Fase 0, Task 4)
--
-- Todas las tablas nacen con RLS habilitada y su política por
-- empresa_id = auth_empresa_id() en este mismo archivo (Recursio_Plan_
-- Ejecucion_Sonnet5.md, instrucción 5). auth_empresa_id() ya existe en
-- el proyecto Supabase compartido (definida en fichaobra/supabase/
-- migrations/022_modulo_horas_catalogos.sql); no se redefine acá para
-- no pisar la versión de Presencio — si no existiera en el entorno
-- donde se aplica esta migración, crearla primero con:
--   CREATE OR REPLACE FUNCTION auth_empresa_id() RETURNS UUID
--     LANGUAGE sql STABLE
--     AS $$ SELECT (auth.jwt() -> 'user_metadata' ->> 'empresa_id')::UUID $$;

-- ─── nom_legajo ─────────────────────────────────────────────────
-- Extensión 1:1 de personal (personal vive en Presencio; acá solo el id,
-- sin FK física porque personal no es visible directamente para Recursio
-- fuera de la vista nom_v_personal — la relación se valida en la app).
CREATE TABLE IF NOT EXISTS nom_legajo (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id       UUID NOT NULL UNIQUE,
  cuil              TEXT,
  fecha_nacimiento  DATE,
  domicilio         TEXT,
  fecha_ingreso     DATE,
  convenio_id       UUID,
  categoria_id      UUID,
  cbu               TEXT,
  banco             TEXT,
  obra_social       TEXT,
  jornada           TEXT DEFAULT 'completa' CHECK (jornada IN ('completa','parcial')),
  created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_legajo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_legajo_all ON nom_legajo;
CREATE POLICY nom_legajo_all ON nom_legajo FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id())
  WITH CHECK (empresa_id = auth_empresa_id());
CREATE INDEX IF NOT EXISTS nom_legajo_empresa_idx ON nom_legajo(empresa_id);

-- ─── nom_convenios ──────────────────────────────────────────────
-- empresa_id NULL = plantilla global (solo lectura para todas las
-- empresas); empresa_id NOT NULL = convenio propio/clonado.
CREATE TABLE IF NOT EXISTS nom_convenios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID REFERENCES empresas(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  regimen      TEXT NOT NULL CHECK (regimen IN ('lct','ley_22250')),
  descripcion  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_convenios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_convenios_select ON nom_convenios;
CREATE POLICY nom_convenios_select ON nom_convenios FOR SELECT TO authenticated
  USING (empresa_id IS NULL OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_convenios_write ON nom_convenios;
CREATE POLICY nom_convenios_write ON nom_convenios FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_convenios_update ON nom_convenios;
CREATE POLICY nom_convenios_update ON nom_convenios FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id())
  WITH CHECK (empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_convenios_delete ON nom_convenios;
CREATE POLICY nom_convenios_delete ON nom_convenios FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id());
CREATE INDEX IF NOT EXISTS nom_convenios_empresa_idx ON nom_convenios(empresa_id);

-- ─── nom_categorias ─────────────────────────────────────────────
-- Histórico de escalas: nunca se pisa un valor, se versiona por
-- vigencia_desde. El aislamiento por empresa se hereda del convenio
-- (join con nom_convenios), por eso la política usa un EXISTS.
CREATE TABLE IF NOT EXISTS nom_categorias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convenio_id    UUID NOT NULL REFERENCES nom_convenios(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  basico         NUMERIC NOT NULL DEFAULT 0,
  vigencia_desde DATE NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (convenio_id, nombre, vigencia_desde)
);
ALTER TABLE nom_categorias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_categorias_all ON nom_categorias;
CREATE POLICY nom_categorias_all ON nom_categorias FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nom_convenios c
      WHERE c.id = nom_categorias.convenio_id
        AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM nom_convenios c
      WHERE c.id = nom_categorias.convenio_id
        AND c.empresa_id = auth_empresa_id()
    )
  );
CREATE INDEX IF NOT EXISTS nom_categorias_convenio_idx ON nom_categorias(convenio_id);

-- ─── nom_parametros ─────────────────────────────────────────────
-- Valores con vigencia temporal (topes SIPA, alícuotas, etc.), por
-- empresa (nunca globales: cada empresa puede tener parámetros propios).
CREATE TABLE IF NOT EXISTS nom_parametros (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo         TEXT NOT NULL,
  valor          NUMERIC NOT NULL,
  vigencia_desde DATE NOT NULL,
  vigencia_hasta DATE,
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_parametros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_parametros_all ON nom_parametros;
CREATE POLICY nom_parametros_all ON nom_parametros FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id())
  WITH CHECK (empresa_id = auth_empresa_id());
CREATE INDEX IF NOT EXISTS nom_parametros_empresa_idx ON nom_parametros(empresa_id);
CREATE INDEX IF NOT EXISTS nom_parametros_codigo_idx ON nom_parametros(empresa_id, codigo, vigencia_desde);
