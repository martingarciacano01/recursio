-- 0019_formulas_basico_periodo.sql
--
-- ANTES DE EJECUTAR: correr en Supabase
--   SELECT codigo, formula FROM nom_conceptos WHERE codigo = 'basico';
-- y confirmar que las fórmulas existentes son exactamente una de las dos
-- que cubre este UPDATE. Si aparece una tercera variante (por ejemplo con
-- espacios distintos o algún wrapper de función), este UPDATE no la va a
-- tocar y hay que ajustar la migración a mano antes de aplicarla.
--
-- Los conceptos "básico" que usaban basico_convenio * horas_trabajadas
-- (jornal fijo) ahora usan basico_periodo, ya resuelto por
-- calcularBasicoPeriodo según la modalidad de la categoría — así un mismo
-- código de concepto sirve para jornal por hora, mensual o quincenal sin
-- tener que reescribir la fórmula por convenio.
UPDATE nom_conceptos
SET formula = 'basico_periodo'
WHERE codigo = 'basico' AND formula = 'basico_convenio * horas_trabajadas';

UPDATE nom_conceptos
SET formula = 'basico_periodo'
WHERE codigo = 'basico' AND formula = 'basico_convenio';
