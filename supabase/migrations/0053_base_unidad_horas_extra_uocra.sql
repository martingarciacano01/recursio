-- 0053_base_unidad_horas_extra_uocra.sql — fix de dos bugs vistos en un
-- recibo real de "Hora extra 50%"/"Hora extra 100%"/"Recargo feriado":
--
-- 1) BASE/UNIDAD mostraban el % de config y el básico completo (como
--    cualquier concepto porcentual genérico), en vez del valor de UNA hora
--    recargada y la cantidad de horas extra (redondeada hacia arriba) —
--    fix con config.recibo.baseFormula/unidadFormula (mismo mecanismo que
--    ya usa el básico por hora, migración 0039).
-- 2) La fórmula dividía `basico_convenio / 200`, asumiendo que
--    basico_convenio es SIEMPRE un sueldo mensual (convención LCT:
--    mensual/200 = valor hora). Para categorías con modalidad 'hora' (el
--    caso jornalizado típico UOCRA — ej. categoría "Ayudante" con básico
--    $4.948), basico_convenio YA ES el valor de una hora: dividir por 200
--    lo achicaba ~200 veces, dejando la hora extra en centavos. Se usa
--    basico_convenio directo, sin dividir.
--
-- Pendiente de validar con el contador (docs/VALIDACION-CONTADOR.md): para
-- categorías con modalidad 'mensual'/'quincenal' (ej. "Sereno" con básico
-- mensual $898.817) no hay hoy un valorHora resuelto — basico.ts
-- (calcularBasicoPeriodo) devuelve valorHora=0 para esas modalidades. Este
-- fix cubre el caso jornalizado por hora, que es el reportado y el más
-- común en UOCRA.
--
-- Reemplaza por completo la migración 0053 anterior (que solo tocaba
-- baseFormula/unidadFormula, no la fórmula principal, y todavía dividía
-- por 200) — si esa versión llegó a aplicarse, este UPDATE la corrige
-- igual, es idempotente.
UPDATE nom_conceptos c SET
  formula = 'basico_convenio * 1.5 * horas_extra_50',
  config = jsonb_set(
    jsonb_set(c.config, '{recibo,baseFormula}', to_jsonb('basico_convenio * 1.5'::text)),
    '{recibo,unidadFormula}', to_jsonb('ceil(horas_extra_50)'::text)
  )
FROM nom_convenios cv
WHERE c.convenio_id = cv.id AND cv.regimen = '22250' AND c.codigo = 'hora_extra_50';

UPDATE nom_conceptos c SET
  formula = 'basico_convenio * 2 * horas_extra_100',
  config = jsonb_set(
    jsonb_set(c.config, '{recibo,baseFormula}', to_jsonb('basico_convenio * 2'::text)),
    '{recibo,unidadFormula}', to_jsonb('ceil(horas_extra_100)'::text)
  )
FROM nom_convenios cv
WHERE c.convenio_id = cv.id AND cv.regimen = '22250' AND c.codigo = 'hora_extra_100';

UPDATE nom_conceptos c SET
  formula = 'basico_convenio * horas_feriado',
  config = jsonb_set(
    jsonb_set(c.config, '{recibo,baseFormula}', to_jsonb('basico_convenio'::text)),
    '{recibo,unidadFormula}', to_jsonb('ceil(horas_feriado)'::text)
  )
FROM nom_convenios cv
WHERE c.convenio_id = cv.id AND cv.regimen = '22250' AND c.codigo = 'hs_feriado';
