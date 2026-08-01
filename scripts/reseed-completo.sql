-- ═══════════════════════════════════════════════════════════════════
-- RESEED COMPLETO — Recursio sobre una base con esquema pero sin datos
-- Generado: 2026-07-29 · Proyecto: hlipootstxojwdxwkrwl
-- ═══════════════════════════════════════════════════════════════════
--
-- Consolida, EN ORDEN, las partes de seed de estas migraciones:
--   0003_seed_convenios.sql              → convenios plantilla + categorías
--   0012_config_escalas.sql              → nom_no_remunerativos + suma_no_rem
--   0013_clonar_convenio_superadmin.sql  → DROP de la firma vieja (ver abajo)
--   0031_seed_conceptos_base.sql         → basico + aportes + contribuciones
--   0037_correccion_aportes_julio_2026   → alícuotas julio 2026 + CCT 76/75
--
-- NO incluye migraciones de esquema (0001-0002, 0004-0011, 0014-0036): las
-- tablas ya existen. Si alguna sentencia falla por columna inexistente,
-- falta aplicar las migraciones de esquema primero.
--
-- IDEMPOTENTE: todo es IF NOT EXISTS / WHERE NOT EXISTS / UPDATE acotado.
-- Se puede correr más de una vez sin duplicar ni pisar ediciones propias.
--
-- ⚠ POR QUÉ EL DROP DE clonar_convenio: 0012 define clonar_convenio(UUID) y
--   0031 define clonar_convenio(UUID, UUID DEFAULT NULL). Si conviven las
--   dos, una llamada con un solo argumento es ambigua y Postgres la
--   rechaza. 0013 resuelve esto dropeando la vieja; acá se replica.
--
-- ⚠ LOS BÁSICOS QUEDAN EN 0 a propósito. Publicar montos desactualizados es
--   peor que no publicar ninguno. Se cargan desde Configuración → Convenios
--   → Escalas salariales con su vigencia_desde real.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- BLOQUE 1 — Convenios plantilla y sus categorías        (de 0003)
-- ═══════════════════════════════════════════════════════════════════
-- empresa_id NULL = plantilla global, visible para todas las empresas.

INSERT INTO nom_convenios (id, empresa_id, nombre, regimen, descripcion)
SELECT gen_random_uuid(), NULL, 'Fuera de convenio (LCT)', 'lct',
       'Empleados no comprendidos en convenio colectivo — Ley de Contrato de Trabajo.'
WHERE NOT EXISTS (
  SELECT 1 FROM nom_convenios WHERE empresa_id IS NULL AND nombre = 'Fuera de convenio (LCT)'
);

INSERT INTO nom_convenios (id, empresa_id, nombre, regimen, descripcion)
-- ⚠ regimen = '22250', NO 'ley_22250'. La migración 0030 renombró el valor
--   y redefinió el check a IN ('lct','22250'). El texto de 0003 quedó
--   desactualizado: copiarlo tal cual falla con 23514.
SELECT gen_random_uuid(), NULL, 'UOCRA (Ley 22.250)', '22250',
       'Convenio de la construcción — Unión Obrera de la Construcción de la República Argentina.'
WHERE NOT EXISTS (
  SELECT 1 FROM nom_convenios WHERE empresa_id IS NULL AND nombre = 'UOCRA (Ley 22.250)'
);

INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde)
SELECT c.id, cat.nombre, 0, DATE '1900-01-01'
FROM nom_convenios c
CROSS JOIN (VALUES ('Administrativo'), ('Técnico'), ('Jefatura')) AS cat(nombre)
WHERE c.empresa_id IS NULL AND c.nombre = 'Fuera de convenio (LCT)'
  AND NOT EXISTS (
    SELECT 1 FROM nom_categorias
    WHERE convenio_id = c.id AND nombre = cat.nombre AND vigencia_desde = DATE '1900-01-01'
  );

INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde)
SELECT c.id, cat.nombre, 0, DATE '1900-01-01'
FROM nom_convenios c
CROSS JOIN (VALUES
  ('Oficial especializado'), ('Oficial'), ('Medio oficial'), ('Ayudante'), ('Sereno')
) AS cat(nombre)
WHERE c.empresa_id IS NULL AND c.nombre = 'UOCRA (Ley 22.250)'
  AND NOT EXISTS (
    SELECT 1 FROM nom_categorias
    WHERE convenio_id = c.id AND nombre = cat.nombre AND vigencia_desde = DATE '1900-01-01'
  );


-- ═══════════════════════════════════════════════════════════════════
-- BLOQUE 2 — No remunerativos y columnas de conceptos     (de 0012)
-- ═══════════════════════════════════════════════════════════════════

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

ALTER TABLE nom_conceptos ADD COLUMN IF NOT EXISTS categorias TEXT[];
ALTER TABLE nom_conceptos ADD COLUMN IF NOT EXISTS config JSONB;

INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible)
SELECT NULL, c.id, 'suma_no_rem', 'Suma no remunerativa', 'no_remunerativo', 'no_rem_convenio', 50, true
FROM nom_convenios c
WHERE c.empresa_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM nom_conceptos x
    WHERE x.convenio_id = c.id AND x.codigo = 'suma_no_rem' AND x.empresa_id IS NULL
  );

-- Firma vieja fuera antes de crear la de dos parámetros (ver 0013).
DROP FUNCTION IF EXISTS clonar_convenio(UUID);


-- ═══════════════════════════════════════════════════════════════════
-- BLOQUE 3 — Conceptos base: básico, aportes, contribuciones (de 0031)
-- ═══════════════════════════════════════════════════════════════════
-- Sin el concepto `basico` la liquidación da $0 en bruto, neto, aportes y
-- contribuciones aunque la escala esté bien cargada: es un CONCEPTO el que
-- mete `basico_periodo` en remunerativo_acumulado.
--
-- Los porcentajes patronales de acá los corrige el BLOQUE 4.

INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config)
SELECT cv.empresa_id, cv.id, x.codigo, x.nombre, x.tipo, x.formula, x.orden, true, NULL, x.config::jsonb
FROM nom_convenios cv
CROSS JOIN (VALUES
  -- unidadFormula/baseFormula → unidad_basico/base_basico (migración 0039):
  -- variables genéricas que liquidar-periodo/index.ts calcula para las tres
  -- modalidades (hora/mensual/quincenal), así BASE × UNIDAD = MONTO es
  -- verificable en el recibo desde el día 1 de una base nueva.
  ('basico', 'Sueldo básico', 'remunerativo', 'basico_periodo', 10,
   '{"recibo":{"grupo":"remunerativo","detalle":null,"unidadFormula":"unidad_basico","baseFormula":"base_basico"}}'),

  ('jubilacion', 'Jubilación – Ley 24.241', 'descuento',
   'min(remunerativo_acumulado, tope_sipa) * 0.11', 100,
   '{"modo":"porcentaje","porcentaje":11,"base":"remunerativo","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"seguridad_social"}}'),
  ('ley_19032', 'Ley 19.032 – INSSJP', 'descuento',
   'min(remunerativo_acumulado, tope_sipa) * 0.03', 101,
   '{"modo":"porcentaje","porcentaje":3,"base":"remunerativo","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"inssjp"}}'),
  ('obra_social', 'Obra social – Ley 23.660', 'descuento',
   '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03', 102,
   '{"modo":"porcentaje","porcentaje":3,"base":"ambos","tope":null,"recibo":{"grupo":"descuento","detalle":"obra_social"}}'),
  ('retencion_sindical', 'Retención sindical', 'descuento',
   '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.02', 103,
   '{"modo":"porcentaje","porcentaje":2,"base":"ambos","tope":null,"recibo":{"grupo":"descuento","detalle":"sindical"}}'),

  ('c_sipa', 'SIPA – Ley 24.241', 'aporte_patronal',
   'remunerativo_acumulado * 0.1077', 200,
   '{"modo":"porcentaje","porcentaje":10.77,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'),
  ('c_inssjp_pat', 'Ley 19.032 – INSSJP (contrib.)', 'aporte_patronal',
   'remunerativo_acumulado * 0.0159', 201,
   '{"modo":"porcentaje","porcentaje":1.59,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"inssjp"}}'),
  ('c_asig', 'Asignaciones Familiares', 'aporte_patronal',
   'remunerativo_acumulado * 0.047', 202,
   '{"modo":"porcentaje","porcentaje":4.70,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'),
  ('c_fne', 'Fondo Nacional de Empleo', 'aporte_patronal',
   'remunerativo_acumulado * 0.0094', 203,
   '{"modo":"porcentaje","porcentaje":0.94,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'),
  ('c_os_pat', 'Obra social (contribución)', 'aporte_patronal',
   '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.06', 204,
   '{"modo":"porcentaje","porcentaje":6.00,"base":"ambos","recibo":{"grupo":"contribucion","detalle":"obra_social"}}'),
  ('c_art', 'Riesgos de Trabajo – Variable', 'aporte_patronal',
   '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03', 205,
   '{"modo":"porcentaje","porcentaje":3.00,"base":"ambos","recibo":{"grupo":"contribucion","detalle":"art"}}')
) AS x(codigo, nombre, tipo, formula, orden, config)
WHERE NOT EXISTS (
  SELECT 1 FROM nom_conceptos c
  WHERE c.convenio_id = cv.id
    AND c.codigo = x.codigo
    AND c.empresa_id IS NOT DISTINCT FROM cv.empresa_id
);

UPDATE nom_conceptos SET codigo_recibo = v.cod
FROM (VALUES
  ('basico','0015'), ('hs_feriado','0043'), ('presentismo','0191'),
  ('jubilacion','0300'), ('ley_19032','0302'), ('obra_social','0310'),
  ('retencion_sindical','0316')
) AS v(codigo, cod)
WHERE nom_conceptos.codigo = v.codigo AND nom_conceptos.codigo_recibo IS NULL;

WITH restantes AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY orden, codigo) AS n
  FROM nom_conceptos
  WHERE empresa_id IS NULL AND codigo_recibo IS NULL
)
UPDATE nom_conceptos c
SET codigo_recibo = '09' || LPAD(restantes.n::text, 2, '0')
FROM restantes
WHERE c.id = restantes.id;

CREATE OR REPLACE FUNCTION clonar_convenio(convenio_global_id UUID, p_empresa_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID := auth_empresa_id();
  v_origen  nom_convenios%ROWTYPE;
  v_nuevo   UUID;
BEGIN
  IF v_empresa IS NULL THEN
    IF NOT is_superadmin() OR p_empresa_id IS NULL THEN
      RAISE EXCEPTION 'usuario sin empresa asignada';
    END IF;
    v_empresa := p_empresa_id;
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

  INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde, modalidad)
  SELECT v_nuevo, nombre, basico, vigencia_desde, modalidad
  FROM nom_categorias WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_no_remunerativos (convenio_id, categoria_nombre, monto, vigencia_desde)
  SELECT v_nuevo, categoria_nombre, monto, vigencia_desde
  FROM nom_no_remunerativos WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config, codigo_recibo)
  SELECT v_empresa, v_nuevo, codigo, nombre, tipo, formula, orden, imprimible, categorias, config, codigo_recibo
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
REVOKE ALL ON FUNCTION clonar_convenio(UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION clonar_convenio(UUID, UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- BLOQUE 4 — Alícuotas julio 2026 y CCT 76/75             (de 0037)
-- ═══════════════════════════════════════════════════════════════════
-- Alícuotas patronales: columna PyME / construcción del art. 19 inc. b de
-- la Ley 27.541 (suman 18,00 %). Una empresa grande de servicios usa el
-- inc. a (20,40 %) y debe ajustarlas desde Configuración.
--
-- Los UPDATE solo tocan filas cuya fórmula sigue siendo la del BLOQUE 3,
-- así que una edición hecha desde la app se respeta.

UPDATE nom_conceptos c SET
  formula = 'remunerativo_acumulado * ' || v.factor,
  config  = COALESCE(c.config, '{}'::jsonb) || jsonb_build_object('porcentaje', v.porcentaje)
FROM (VALUES
  ('c_sipa',       'remunerativo_acumulado * 0.1077', '0.1017', 10.17),
  ('c_inssjp_pat', 'remunerativo_acumulado * 0.0159', '0.0150',  1.50),
  ('c_asig',       'remunerativo_acumulado * 0.047',  '0.0444',  4.44),
  ('c_fne',        'remunerativo_acumulado * 0.0094', '0.0089',  0.89)
) AS v(codigo, formula_vieja, factor, porcentaje)
WHERE c.codigo = v.codigo
  AND c.formula = v.formula_vieja;

INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config)
SELECT cv.empresa_id, cv.id, 'c_frl', 'Fondo de Reconversión Laboral', 'aporte_patronal',
       'remunerativo_acumulado * 0.01', 206, true, NULL,
       '{"modo":"porcentaje","porcentaje":1.00,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'::jsonb
FROM nom_convenios cv
WHERE NOT EXISTS (
  SELECT 1 FROM nom_conceptos c
  WHERE c.convenio_id = cv.id AND c.codigo = 'c_frl'
    AND c.empresa_id IS NOT DISTINCT FROM cv.empresa_id
);

-- El 3 % de obra social está sujeto al mismo tope máximo de ANSES.
UPDATE nom_conceptos SET
  formula = 'min(remunerativo_acumulado + no_remunerativo_acumulado, tope_sipa) * 0.03',
  config  = COALESCE(config, '{}'::jsonb) || '{"tope":"tope_sipa"}'::jsonb
WHERE codigo = 'obra_social'
  AND formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03';

-- Retención sindical 2,5 %: solo convenios de construcción.
UPDATE nom_conceptos c SET
  formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.025',
  config  = COALESCE(c.config, '{}'::jsonb) || '{"porcentaje":2.5}'::jsonb
FROM nom_convenios cv
WHERE c.convenio_id = cv.id
  AND cv.regimen = '22250'
  AND c.codigo = 'retencion_sindical'
  AND c.formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.02';

INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config)
SELECT cv.empresa_id, cv.id, 'c_focap', 'Fondo de Capacitación y Formación (CCT 76/75)', 'aporte_patronal',
       'remunerativo_acumulado * 0.005', 207, true, NULL,
       '{"modo":"porcentaje","porcentaje":0.50,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'::jsonb
FROM nom_convenios cv
WHERE cv.regimen = '22250'
  AND NOT EXISTS (
    SELECT 1 FROM nom_conceptos c
    WHERE c.convenio_id = cv.id AND c.codigo = 'c_focap'
      AND c.empresa_id IS NOT DISTINCT FROM cv.empresa_id
  );

-- Seguro de vida CCT 76/75: 2 % del básico de Sereno Zona A ($898.817,00)
-- = $17.976,34, igual para todos. ⚠ Valor congelado: nom_conceptos todavía
-- no versiona por vigencia, así que hay que actualizarlo cada paritaria.
INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config)
SELECT cv.empresa_id, cv.id, 'seg_vida_cct', 'Seguro de vida colectivo CCT 76/75', 'descuento',
       '17976.34', 104, true, NULL,
       '{"modo":"monto_fijo","monto":17976.34,"base":"sereno_zona_a","recibo":{"grupo":"descuento","detalle":"seguro"}}'::jsonb
FROM nom_convenios cv
WHERE cv.regimen = '22250'
  AND NOT EXISTS (
    SELECT 1 FROM nom_conceptos c
    WHERE c.convenio_id = cv.id AND c.codigo = 'seg_vida_cct'
      AND c.empresa_id IS NOT DISTINCT FROM cv.empresa_id
  );

UPDATE nom_conceptos SET codigo_recibo = v.cod
FROM (VALUES
  ('seg_vida_cct','0320'), ('c_frl','0930'), ('c_focap','0931')
) AS v(codigo, cod)
WHERE nom_conceptos.codigo = v.codigo AND nom_conceptos.codigo_recibo IS NULL;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN — correr después del COMMIT
-- ═══════════════════════════════════════════════════════════════════
-- Esperado, en una base que arrancó vacía:
--   Fuera de convenio (LCT) → 3 categorías, 13 conceptos
--   UOCRA (Ley 22.250)      → 5 categorías, 15 conceptos
-- Desglose: 11 base (BLOQUE 3) + suma_no_rem (BLOQUE 2) + c_frl = 13;
-- UOCRA suma además c_focap y seg_vida_cct = 15.
SELECT
  cv.nombre AS convenio,
  cv.regimen,
  (SELECT count(*) FROM nom_categorias k WHERE k.convenio_id = cv.id) AS categorias,
  (SELECT count(*) FROM nom_conceptos c WHERE c.convenio_id = cv.id) AS conceptos
FROM nom_convenios cv
ORDER BY cv.nombre;

-- Total de contribuciones patronales: debe dar 18.00 para SUSS
-- (c_sipa + c_inssjp_pat + c_asig + c_fne + c_frl).
SELECT cv.nombre AS convenio,
       round(sum((c.config->>'porcentaje')::numeric), 2) AS total_suss
FROM nom_conceptos c
JOIN nom_convenios cv ON cv.id = c.convenio_id
WHERE c.codigo IN ('c_sipa','c_inssjp_pat','c_asig','c_fne','c_frl')
GROUP BY cv.nombre
ORDER BY cv.nombre;
