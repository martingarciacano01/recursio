-- 0017_uocra_quincenal.sql — Fase 4, Task 28: períodos quincenales UOCRA
--
-- nom_periodos.tipo pasa a incluir 'quincena_1'/'quincena_2' (además de
-- los ya existentes: mensual/quincenal/sac/final — se conserva 'quincenal'
-- para no romper períodos ya creados con Fuera de Convenio, que no
-- necesita la distinción de quincena). grupo_mensual_id agrupa Q1+Q2 bajo
-- un mismo mes calendario para poder consolidar: la Q2 recalcula cargas/
-- topes sobre el acumulado del mes y ajusta la diferencia (Recursio_Plan_
-- Ejecucion_Sonnet5.md, Fase 4 Task 28).

ALTER TABLE nom_periodos DROP CONSTRAINT IF EXISTS nom_periodos_tipo_check;
ALTER TABLE nom_periodos ADD CONSTRAINT nom_periodos_tipo_check
  CHECK (tipo IN ('mensual','quincenal','quincena_1','quincena_2','sac','final'));

ALTER TABLE nom_periodos ADD COLUMN IF NOT EXISTS grupo_mensual_id UUID;
ALTER TABLE nom_periodos ADD COLUMN IF NOT EXISTS ajuste_diferencia NUMERIC;
CREATE INDEX IF NOT EXISTS nom_periodos_grupo_mensual_idx ON nom_periodos(grupo_mensual_id);

-- consolidar_quincena(periodo_q2_id): dado el período de la quincena 2,
-- busca la quincena 1 del mismo grupo_mensual_id, sopesa el acumulado
-- mensual (bruto de Q1 + Q2) contra lo que correspondería calcular de
-- una sola vez (recalculando cargas/topes sobre el acumulado), y guarda
-- la diferencia en nom_periodos.ajuste_diferencia de la Q2 para que la
-- Edge Function liquidar-periodo la sume/reste al liquidar esa quincena.
-- La lógica de cálculo del ajuste vive en el motor (packages/motor), acá
-- solo se resuelve qué períodos son "pareja" — mantiene la función SQL
-- simple y el cálculo numérico testeable con vitest sin Supabase.
CREATE OR REPLACE FUNCTION quincena_pareja(p_periodo_id UUID)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT p2.id FROM nom_periodos p1
  JOIN nom_periodos p2 ON p2.grupo_mensual_id = p1.grupo_mensual_id AND p2.id <> p1.id
  WHERE p1.id = p_periodo_id
$$;
