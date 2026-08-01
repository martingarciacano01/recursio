-- 0037_correccion_aportes_julio_2026.sql
--
-- QUÉ ARREGLA
-- ───────────
-- Los porcentajes de contribuciones patronales sembrados en 0029/0031 no
-- coinciden con los vigentes a julio 2026 (Ley 27.541, alícuotas del inciso
-- b — PyME y construcción). Además faltaban conceptos enteros del CCT 76/75
-- (UOCRA) y el Fondo de Reconversión Laboral, que aplica a todos.
--
-- Detalle de las correcciones:
--   c_sipa       10,77 % → 10,17 %
--   c_inssjp_pat  1,59 % →  1,50 %
--   c_asig        4,70 % →  4,44 %
--   c_fne         0,94 % →  0,89 %
--   c_frl           (no existía) → 1,00 %
--                 ────────────────────────
--                 TOTAL SUSS      18,00 %
--
--   obra_social  3 % sin tope → 3 % con tope SIPA
--   retencion_sindical 2 % → 2,5 % (solo régimen '22250')
--   c_focap        (no existía) → 0,50 % (solo régimen '22250')
--   seg_vida_cct   (no existía) → monto fijo (solo régimen '22250')
--
-- ⚠ El régimen de construcción se identifica como '22250', NO 'ley_22250':
--   la migración 0030 renombró el valor y redefinió el check de
--   nom_convenios a IN ('lct','22250').
--
-- ⚠ ALÍCUOTAS PATRONALES: se aplica la columna PyME / construcción del
--   art. 19 inc. b de la Ley 27.541. Una empresa grande de servicios o
--   comercio (inc. a) usa 11,53 / 1,70 / 5,03 / 1,01 / 1,13 = 20,40 % y
--   debe ajustarlos a mano desde Configuración → Aportes y contribuciones.
--   Recursio está pensado para constructoras, por eso el default es inc. b.
--
-- NO DESTRUCTIVA: los UPDATE solo tocan filas cuya fórmula sigue siendo
-- exactamente la sembrada por 0029/0031. Si una empresa ya editó el
-- porcentaje desde Configuración, su valor se respeta. Los INSERT son
-- WHERE NOT EXISTS. Nada se borra.
--
-- ─────────────────────────────────────────────────────────────────────
-- QUEDA FUERA DE ESTA MIGRACIÓN (y por qué)
-- ─────────────────────────────────────────────────────────────────────
--   · PAT_CESE (Fondo de Cese Laboral 12 % primer año / 8 % desde el
--     segundo). La fórmula es `remunerativo_acumulado * (antiguedad < 1 ?
--     0.12 : 0.08)`, pero liquidar-periodo/index.ts no expone `antiguedad`
--     en variablesBase y evaluar() aborta con "variable desconocida". El
--     cálculo ya existe en packages/motor/src/uocra.ts
--     (porcentajeFondoDesempleo) — falta cablearlo. Requiere agregar
--     `fecha_ingreso` al select de nom_v_personal y `antiguedad` a
--     variablesBase.
--
--   · RET_SOLID (Aporte Solidario 2 % para NO afiliados). No existe en
--     nom_legajo un campo `afiliado_sindicato`, así que no hay forma de
--     distinguir a quién se le retiene. Sembrarlo se lo cobraría a todos.
--
--   · PAT_ART_FIJ (FFEP), PAT_SCVO y PAT_IERIC. Son sumas fijas por cápita
--     cuyo monto no fue provisto. Sembrarlos en 0 imprimiría líneas de $0
--     en cada recibo. Cargarlos a mano desde Configuración cuando se
--     conozcan los importes.

-- ─────────────────────────────────────────────────────────────────────
-- 1) Contribuciones patronales — alícuotas Ley 27.541 inc. b
-- ─────────────────────────────────────────────────────────────────────
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

-- Fondo de Reconversión Laboral: nunca se sembró. Completa el 18 % de SUSS.
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

-- ─────────────────────────────────────────────────────────────────────
-- 2) Obra social del trabajador — agregar tope SIPA
-- ─────────────────────────────────────────────────────────────────────
-- El 3 % del art. 16 de la Ley 23.660 está sujeto al mismo tope máximo de
-- ANSES que jubilación e INSSJP; 0031 lo sembró sin tope, cobrando de más
-- a los sueldos altos.
UPDATE nom_conceptos SET
  formula = 'min(remunerativo_acumulado + no_remunerativo_acumulado, tope_sipa) * 0.03',
  config  = COALESCE(config, '{}'::jsonb) || '{"tope":"tope_sipa"}'::jsonb
WHERE codigo = 'obra_social'
  AND formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03';

-- ─────────────────────────────────────────────────────────────────────
-- 3) Específicos CCT 76/75 — solo convenios de régimen '22250'
-- ─────────────────────────────────────────────────────────────────────
-- Retención sindical: 2,5 % sobre remunerativo + no remunerativo.
-- ⚠ 0031 sembró este concepto al 2 % en TODOS los convenios, incluido
--   "Fuera de convenio (LCT)", donde no corresponde retener nada. Acá solo
--   se corrige el porcentaje en los convenios de construcción; la fila
--   sobrante en los convenios LCT queda para que la borres a mano desde
--   Configuración → Aportes y contribuciones (esta migración no borra
--   datos).
UPDATE nom_conceptos c SET
  formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.025',
  config  = COALESCE(c.config, '{}'::jsonb) || '{"porcentaje":2.5}'::jsonb
FROM nom_convenios cv
WHERE c.convenio_id = cv.id
  AND cv.regimen = '22250'
  AND c.codigo = 'retencion_sindical'
  AND c.formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.02';

-- Fondo de Capacitación y Formación Profesional (UOCRA/CAC): 0,5 % patronal.
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

-- Seguro de vida colectivo CCT 76/75: 2 % del básico de la categoría Sereno
-- Zona A, NO del sueldo del trabajador. Es el mismo importe para todos.
--
-- ⚠ VALOR CONGELADO: 2 % × $898.817,00 = $17.976,34 (escala julio 2026).
--   Como nom_conceptos todavía no tiene vigencia_desde, este monto no se
--   versiona: hay que actualizarlo a mano en cada paritaria desde
--   Configuración → Aportes y contribuciones. La Fase 2 del importador de
--   paritarias (versionado de conceptos) lo va a resolver.
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

-- ─────────────────────────────────────────────────────────────────────
-- 4) codigo_recibo para los conceptos nuevos
-- ─────────────────────────────────────────────────────────────────────
-- Mismo criterio que 0031: solo completa los que están en NULL.
UPDATE nom_conceptos SET codigo_recibo = v.cod
FROM (VALUES
  ('seg_vida_cct','0320'), ('c_frl','0930'), ('c_focap','0931')
) AS v(codigo, cod)
WHERE nom_conceptos.codigo = v.codigo AND nom_conceptos.codigo_recibo IS NULL;
