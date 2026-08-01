-- 0039_basico_unidad_base.sql
--
-- Bug: el concepto `basico` (sembrado en 0031_seed_conceptos_base.sql) tiene
-- config `{"recibo":{"grupo":"remunerativo","detalle":null}}` — sin
-- `unidadFormula` ni `baseFormula`. packages/motor/src/motor.ts ya sabe
-- evaluar esas dos claves (líneas ~110-129: recibo.baseFormula /
-- recibo.unidadFormula) para llenar `baseCalculo`/`unidadTexto` de
-- cualquier concepto, pero al básico nunca se le configuraron, así que en
-- el PDF las columnas UNIDAD y BASE de la fila del básico salían vacías.
--
-- Fix: apuntar unidadFormula/baseFormula a dos variables GENÉRICAS
-- (`unidad_basico` / `base_basico`) que liquidar-periodo/index.ts calcula
-- para las tres modalidades (hora/mensual/quincenal) — ver
-- unidadYBaseBasico() ahí mismo. Así BASE × UNIDAD = MONTO es verificable
-- en el recibo sin importar cómo esté pactada la escala del convenio.
--
-- Idempotente: jsonb_set sobre la clave 'recibo' preservando 'grupo'/
-- 'detalle' existentes; WHERE acota a codigo = 'basico', se puede
-- re-ejecutar sin efecto adicional.

UPDATE nom_conceptos
SET config = jsonb_set(
  jsonb_set(
    jsonb_set(COALESCE(config, '{}'::jsonb), '{recibo}', COALESCE(config->'recibo', '{}'::jsonb), true),
    '{recibo,unidadFormula}', '"unidad_basico"'::jsonb, true
  ),
  '{recibo,baseFormula}', '"base_basico"'::jsonb, true
)
WHERE codigo = 'basico';
