-- 0049_conceptos_uocra.sql (Task 2.7) — HE, presentismo y recargo feriado
-- para convenios de régimen '22250' (construcción, CCT 76/75). La jornada
-- UOCRA es 9 h/día, 44 h/semana (e-sueldos); el divisor de la hora extra se
-- valida con el contador (Task 2.9) — acá se usa /200 como el HE existente
-- fuera de convenio. Patrón de INSERT idéntico al usado en
-- 0037_correccion_aportes_julio_2026.sql (WHERE NOT EXISTS + regimen =
-- '22250', SIN pasar por nom_regiones que es de "regiones de obra", un
-- dominio distinto a convenios).
INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config)
SELECT cv.empresa_id, cv.id, x.codigo, x.nombre, x.tipo, x.formula, x.orden, true, NULL, x.config::jsonb
FROM nom_convenios cv
CROSS JOIN (VALUES
  ('hs_feriado', 'Recargo feriado', 'remunerativo',
   '(basico_convenio / 200) * horas_feriado', 15,
   '{"modo":"porcentaje","porcentaje":100,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
  ('hora_extra_50', 'Hora extra 50%', 'remunerativo',
   '(basico_convenio / 200) * 1.5 * horas_extra_50', 16,
   '{"modo":"porcentaje","porcentaje":150,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
  ('hora_extra_100', 'Hora extra 100%', 'remunerativo',
   '(basico_convenio / 200) * 2 * horas_extra_100', 17,
   '{"modo":"porcentaje","porcentaje":200,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
  ('presentismo', 'Presentismo', 'remunerativo',
   'remunerativo_acumulado * 0.20', 18,
   '{"modo":"porcentaje","porcentaje":20,"base":"remunerativo","recibo":{"grupo":"remunerativo","detalle":null}}')
) AS x(codigo, nombre, tipo, formula, orden, config)
WHERE cv.regimen = '22250'
  AND NOT EXISTS (
    SELECT 1 FROM nom_conceptos c
    WHERE c.convenio_id = cv.id AND c.codigo = x.codigo
      AND c.empresa_id IS NOT DISTINCT FROM cv.empresa_id
  );
