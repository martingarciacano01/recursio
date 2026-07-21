-- 0012_config_escalas.sql — menú de configuración (spec 2026-07-21)

-- ─── nom_no_remunerativos ───────────────────────────────────────
-- Suma no remunerativa por categoría, versionada por vigencia_desde
-- (mismo patrón que nom_categorias: nunca se pisa, se agrega vigencia).
CREATE TABLE IF NOT EXISTS nom_no_remunerativos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convenio_id      UUID NOT NULL REFERENCES nom_convenios(id) ON DELETE CASCADE,
  categoria_nombre TEXT NOT NULL,
  monto            NUMERIC NOT NULL,
  vigencia_desde   DATE NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (convenio_id, categoria_nombre, vigencia_desde)
);
ALTER TABLE nom_no_remunerativos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_no_remunerativos_all ON nom_no_remunerativos;
CREATE POLICY nom_no_remunerativos_all ON nom_no_remunerativos FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_no_remunerativos.convenio_id
            AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_no_remunerativos.convenio_id
            AND c.empresa_id = auth_empresa_id())
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_no_remunerativos TO authenticated;
GRANT SELECT ON nom_no_remunerativos TO service_role;
CREATE INDEX IF NOT EXISTS nom_no_remunerativos_convenio_idx ON nom_no_remunerativos(convenio_id);

-- ─── nom_conceptos: categorias + config ─────────────────────────
-- categorias: NULL = aplica a todas las categorías; con valores, solo a esas.
-- config: metadata del formulario estructurado; la fórmula se genera de acá.
ALTER TABLE nom_conceptos ADD COLUMN IF NOT EXISTS categorias TEXT[];
ALTER TABLE nom_conceptos ADD COLUMN IF NOT EXISTS config JSONB;

-- ─── concepto plantilla: suma no remunerativa ───────────────────
-- La UNIQUE (convenio_id, empresa_id, codigo) no matchea filas con
-- empresa_id NULL (NULLs distintos), por eso NOT EXISTS y no ON CONFLICT.
INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible)
SELECT NULL, c.id, 'suma_no_rem', 'Suma no remunerativa', 'no_remunerativo', 'no_rem_convenio', 50, true
FROM nom_convenios c
WHERE c.empresa_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM nom_conceptos x
    WHERE x.convenio_id = c.id AND x.codigo = 'suma_no_rem' AND x.empresa_id IS NULL
  );

-- ─── clonar_convenio ────────────────────────────────────────────
-- Copia un convenio global (empresa_id NULL) a la empresa del usuario,
-- con categorías (todas las vigencias), no remunerativos, conceptos
-- plantilla y reglas; re-apunta los legajos de la empresa. Idempotente:
-- si ya existe un convenio de la empresa con el mismo nombre, lo devuelve.
CREATE OR REPLACE FUNCTION clonar_convenio(convenio_global_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID := auth_empresa_id();
  v_origen  nom_convenios%ROWTYPE;
  v_nuevo   UUID;
BEGIN
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'usuario sin empresa asignada';
  END IF;
  SELECT * INTO v_origen FROM nom_convenios WHERE id = convenio_global_id AND empresa_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'convenio global no encontrado';
  END IF;

  SELECT id INTO v_nuevo FROM nom_convenios WHERE empresa_id = v_empresa AND nombre = v_origen.nombre;
  IF FOUND THEN
    RETURN v_nuevo;
  END IF;

  INSERT INTO nom_convenios (empresa_id, nombre, regimen, descripcion)
  VALUES (v_empresa, v_origen.nombre, v_origen.regimen, v_origen.descripcion)
  RETURNING id INTO v_nuevo;

  INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde)
  SELECT v_nuevo, nombre, basico, vigencia_desde
  FROM nom_categorias WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_no_remunerativos (convenio_id, categoria_nombre, monto, vigencia_desde)
  SELECT v_nuevo, categoria_nombre, monto, vigencia_desde
  FROM nom_no_remunerativos WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config)
  SELECT v_empresa, v_nuevo, codigo, nombre, tipo, formula, orden, imprimible, categorias, config
  FROM nom_conceptos WHERE convenio_id = convenio_global_id AND empresa_id IS NULL;

  INSERT INTO nom_concepto_reglas (concepto_id, orden, condicion, formula)
  SELECT nc.id, r.orden, r.condicion, r.formula
  FROM nom_conceptos viejo
  JOIN nom_concepto_reglas r ON r.concepto_id = viejo.id
  JOIN nom_conceptos nc ON nc.convenio_id = v_nuevo AND nc.empresa_id = v_empresa AND nc.codigo = viejo.codigo
  WHERE viejo.convenio_id = convenio_global_id AND viejo.empresa_id IS NULL;

  UPDATE nom_legajo l SET
    convenio_id = v_nuevo,
    categoria_id = (
      SELECT nueva.id FROM nom_categorias vieja
      JOIN nom_categorias nueva
        ON nueva.convenio_id = v_nuevo
       AND nueva.nombre = vieja.nombre
       AND nueva.vigencia_desde = vieja.vigencia_desde
      WHERE vieja.id = l.categoria_id
    )
  WHERE l.empresa_id = v_empresa AND l.convenio_id = convenio_global_id;

  RETURN v_nuevo;
END $$;
REVOKE ALL ON FUNCTION clonar_convenio(UUID) FROM public;
GRANT EXECUTE ON FUNCTION clonar_convenio(UUID) TO authenticated;
