-- 0057_presentismo_base_basico_uocra.sql — el presentismo UOCRA se calcula
-- sobre el SUELDO BÁSICO del período, NO sobre el remunerativo acumulado.
--
-- Bug: la fórmula sembrada en 0049 ('remunerativo_acumulado * 0.20', orden
-- 18) evalúa DESPUÉS de las horas extra (16-17) y el recargo feriado (15),
-- así que el acumulado ya incluía HE y feriado → el presentismo pagaba de
-- más (ej. con HE pagaba 20% de básico+HE). Decisión revisada con el
-- usuario: presentismo = 20% del básico, sin HE ni adicionales.
--
-- El recibo queda consistente porque BASES_EXPR['basico'] = 'basico_periodo'
-- (motor.ts) y liquidar-periodo/index.ts ya expone basico_periodo en
-- variablesBase (el básico YA resuelto según la modalidad del legajo).
-- Idempotente: el UPDATE repetido deja el mismo valor.
UPDATE nom_conceptos c
SET formula = 'basico_periodo * 0.20',
    config  = '{"modo":"porcentaje","porcentaje":20,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'::jsonb
WHERE c.codigo = 'presentismo'
  AND EXISTS (SELECT 1 FROM nom_convenios cv WHERE cv.id = c.convenio_id AND cv.regimen = '22250');