-- 0031_seed_conceptos_base.sql
--
-- CAUSA RAÍZ QUE ARREGLA ESTA MIGRACIÓN
-- ─────────────────────────────────────
-- La liquidación devolvía $0 en bruto/neto/aportes/contribuciones para
-- legajos con escala salarial correctamente cargada. Motivo: NUNCA existió
-- una migración que sembrara el concepto `basico`.
--
-- liquidar-periodo/index.ts resuelve la escala vigente y la deja en la
-- variable `basico_periodo` (ver packages/motor/src/basico.ts), pero es un
-- CONCEPTO el que tiene que consumir esa variable para que el monto entre a
-- `remunerativo_acumulado`. Sin concepto `basico`:
--   remunerativo_acumulado = 0
--   → bruto = 0
--   → jubilación / obra social / contribuciones (todas % del acumulado) = 0
-- y sin advertencia alguna, porque la escala SÍ se había resuelto bien.
--
-- Las migraciones 0019, 0020 y 0029 ya asumían que estos conceptos existían
-- (0029 incluso aborta con "no se encontró el concepto basico; revisar seed
-- de conceptos"). Esta migración es ese seed faltante.
--
-- También corrige, en el mismo lugar:
--   (a) 0020: filtraba por `convenio_id IS NULL`, pero esa columna es NOT
--       NULL desde 0005 → ningún `codigo_recibo` se asignó jamás.
--   (b) 0029: anclaba las contribuciones patronales a UN SOLO convenio
--       (`ORDER BY created_at LIMIT 1`) → el resto de los convenios quedaba
--       sin contribuciones.
--   (c) clonar_convenio: no copiaba `nom_categorias.modalidad`, así que todo
--       clon de empresa quedaba en 'hora' aunque el origen fuera mensual.
--
-- IDEMPOTENTE Y NO DESTRUCTIVA: todo es INSERT ... WHERE NOT EXISTS. Nunca
-- pisa un concepto ya existente, así que las ediciones que cada empresa
-- haya hecho desde Configuración se respetan.
--
-- ⚠ REVISIÓN HUMANA REQUERIDA ANTES DE APLICAR EN PRODUCCIÓN:
--   · Los porcentajes de aportes son los generales de ley (jubilación 11 %
--     y Ley 19.032 3 % con tope SIPA — Ley 24.241; obra social 3 % — Ley
--     23.660). La retención sindical 2 % es CONVENIO-DEPENDIENTE: ajustarla
--     al CCT que corresponda.
--   · NO se siembra `presentismo` ni horas extra: su base de cálculo depende
--     del convenio y sembrarlos con un valor inventado pagaría montos
--     incorrectos. Cargarlos desde Configuración → Adicionales.
--   · Cargar `tope_sipa` en Configuración → Parámetros. Sin ese parámetro,
--     liquidar-periodo usa un tope efectivamente infinito (999.999.999) y
--     los aportes con tope se calculan sobre el bruto completo.

-- ─────────────────────────────────────────────────────────────────────
-- 1) Conceptos base en TODOS los convenios (globales y de empresa)
-- ─────────────────────────────────────────────────────────────────────
-- Se insertan directamente en cada convenio existente (no solo en los
-- globales) porque las empresas que ya clonaron su convenio no volverían a
-- pasar por clonar_convenio y quedarían sin conceptos.
INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config)
SELECT cv.empresa_id, cv.id, x.codigo, x.nombre, x.tipo, x.formula, x.orden, true, NULL, x.config::jsonb
FROM nom_convenios cv
CROSS JOIN (VALUES
  -- El básico: única fórmula sin ambigüedad posible. `basico_periodo` ya
  -- viene resuelto por calcularBasicoPeriodo() según la modalidad de la
  -- escala (hora / mensual / quincenal) y el tipo de período liquidado, así
  -- que un mismo concepto sirve para jornal, mensual y quincenal.
  ('basico', 'Sueldo básico', 'remunerativo', 'basico_periodo', 10,
   '{"recibo":{"grupo":"remunerativo","detalle":null}}'),

  -- Aportes del trabajador (porcentajes generales de ley).
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

  -- Contribuciones patronales (mismos valores que 0029, pero aplicadas a
  -- TODOS los convenios y no solo al primero por created_at).
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

-- ─────────────────────────────────────────────────────────────────────
-- 2) codigo_recibo — reemplaza a 0020, que nunca matcheó ninguna fila
-- ─────────────────────────────────────────────────────────────────────
-- 0020 filtraba por `convenio_id IS NULL`, pero nom_conceptos.convenio_id es
-- NOT NULL desde 0005: el filtro correcto para "concepto plantilla global"
-- es `empresa_id IS NULL`. Solo completa códigos faltantes (IS NULL), así
-- que no pisa los que una empresa haya personalizado.
UPDATE nom_conceptos SET codigo_recibo = v.cod
FROM (VALUES
  ('basico','0015'), ('hs_feriado','0043'), ('presentismo','0191'),
  ('jubilacion','0300'), ('ley_19032','0302'), ('obra_social','0310'),
  ('retencion_sindical','0316')
) AS v(codigo, cod)
WHERE nom_conceptos.codigo = v.codigo AND nom_conceptos.codigo_recibo IS NULL;

-- Correlativo 09xx para el resto de los conceptos globales sin código.
WITH restantes AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY orden, codigo) AS n
  FROM nom_conceptos
  WHERE empresa_id IS NULL AND codigo_recibo IS NULL
)
UPDATE nom_conceptos c
SET codigo_recibo = '09' || LPAD(restantes.n::text, 2, '0')
FROM restantes
WHERE c.id = restantes.id;

-- ─────────────────────────────────────────────────────────────────────
-- 3) clonar_convenio: copiar también `modalidad` de las categorías
-- ─────────────────────────────────────────────────────────────────────
-- Sin esto, todo clon de empresa quedaba en modalidad 'hora' (el DEFAULT de
-- 0018) aunque la categoría de origen fuera mensual o quincenal — y el
-- básico se calculaba como jornal × horas en vez de monto fijo, en silencio.
-- El resto del cuerpo es idéntico a 0013.
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
