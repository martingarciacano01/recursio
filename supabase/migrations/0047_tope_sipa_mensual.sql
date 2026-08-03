-- 0047_tope_sipa_mensual.sql — activa la consolidación mensual del tope
-- SIPA en quincenales (Task 2.3, bug C3: min(remunerativo_acumulado,
-- tope_sipa) por quincena dejaba cada quincena bajo el tope y duplicaba
-- la retención). Q1 calcula sobre el mes parcial; Q2 calcula sobre el mes
-- completo (remunerativo_acumulado + remunerativo_quincena1) y el ajuste
-- de liquidar-periodo (codigosConsolidadosPorAcumuladoMensual, index.ts)
-- resta lo ya retenido en Q1 para ese mismo concepto. La clave que activa
-- el mecanismo es config.base = 'acumulado_mensual' (index.ts:255-294,
-- motor.ts BASES_EXPR). Idempotente: UPDATE repetido con el mismo valor.
UPDATE nom_conceptos SET
  formula = 'min(remunerativo_acumulado + remunerativo_quincena1, tope_sipa) * 0.11',
  config  = '{"modo":"porcentaje","porcentaje":11,"base":"acumulado_mensual","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"seguridad_social"}}'::jsonb
WHERE codigo = 'jubilacion';

UPDATE nom_conceptos SET
  formula = 'min(remunerativo_acumulado + remunerativo_quincena1, tope_sipa) * 0.03',
  config  = '{"modo":"porcentaje","porcentaje":3,"base":"acumulado_mensual","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"inssjp"}}'::jsonb
WHERE codigo = 'ley_19032';
