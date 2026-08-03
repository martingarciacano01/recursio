-- 0051_adicionales_uocra_esueldos.sql (Task 2.13) — adicionales del
-- artículo e-sueldos UOCRA (CCT 76/75) que se asignan PERSONA POR PERSONA,
-- no por categoría: zona desfavorable (% variable por escala geográfica),
-- trabajo insalubre, tarea específica, asistencia perfecta (fuera de la
-- regla de presentismo — ver nota abajo), título habilitante, traslado y
-- vestimenta.
--
-- Se modelan con el mecanismo YA CONSTRUIDO de adicionales por legajo
-- (migración 0040_adicionales_por_legajo.sql: nom_conceptos.asignacion =
-- 'legajo' + nom_legajo_adicionales para el override de %/monto por
-- persona, UI en TabAdicionales.jsx) — no un mecanismo nuevo. Sin
-- asignación explícita en nom_legajo_adicionales, el concepto NO se aplica
-- a nadie (filtrarAsignados, motor.ts): el 'formula'/'config' del seed son
-- solo el valor por defecto para el caso 'heredado' (override sin pisar
-- valor, ver aplicarOverridesAdicionales en liquidar-periodo/index.ts) —
-- en la práctica cada empresa carga el % o monto real por persona desde
-- Configuración → Legajo → Adicionales.
--
-- Asistencia perfecta 20%: el CCT la modela como parte de la escala de
-- presentismo (0/50/100%), no como un adicional aparte — se deja
-- explícitamente SIN sembrar acá porque el concepto 'presentismo' con sus
-- reglas de tardanzas/faltas (conceptos-fuera-convenio.ts, 04-07 del
-- golden) ya cubre ese 0/50/100%. Decisión pendiente de confirmar con el
-- contador (Task 2.9, pospuesta) — documentada en
-- docs/VALIDACION-CONTADOR.md.
INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config, asignacion)
SELECT cv.empresa_id, cv.id, x.codigo, x.nombre, x.tipo, x.formula, x.orden, true, NULL, x.config::jsonb, 'legajo'
FROM nom_convenios cv
CROSS JOIN (VALUES
  ('zona_desfavorable', 'Zona desfavorable', 'remunerativo', '0', 19,
   '{"modo":"porcentaje","porcentaje":0,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
  ('trabajo_insalubre', 'Trabajo insalubre', 'remunerativo', '0', 20,
   '{"modo":"porcentaje","porcentaje":0,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
  ('tarea_especifica', 'Tarea específica', 'remunerativo', '0', 21,
   '{"modo":"porcentaje","porcentaje":0,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
  ('titulo_habilitante', 'Título habilitante', 'remunerativo', '0', 22,
   '{"modo":"porcentaje","porcentaje":0,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
  ('adicional_traslado', 'Traslado', 'no_remunerativo', '0', 23,
   '{"modo":"nominal","monto":0,"recibo":{"grupo":"no_remunerativo","detalle":null}}'),
  ('adicional_vestimenta', 'Vestimenta/ropa de trabajo', 'no_remunerativo', '0', 24,
   '{"modo":"nominal","monto":0,"recibo":{"grupo":"no_remunerativo","detalle":null}}')
) AS x(codigo, nombre, tipo, formula, orden, config)
WHERE cv.regimen = '22250'
  AND NOT EXISTS (
    SELECT 1 FROM nom_conceptos c
    WHERE c.convenio_id = cv.id AND c.codigo = x.codigo
      AND c.empresa_id IS NOT DISTINCT FROM cv.empresa_id
  );
