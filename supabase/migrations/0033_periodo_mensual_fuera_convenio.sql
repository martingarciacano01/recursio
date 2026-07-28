-- 0033_periodo_mensual_fuera_convenio.sql — Fase 6 Task 8
--
-- Nuevo tipo de período: 'mensual_fc' (mensual — fuera de convenio). El
-- personal fuera de convenio cobra MENSUAL mientras el de UOCRA cobra por
-- quincena; hasta ahora ambos caían en el mismo período 'mensual' y no
-- había forma de liquidar a unos sin liquidar a los otros.
--
-- liquidar-periodo filtra por legajo.fuera_convenio cuando el período es
-- 'mensual_fc', y EXCLUYE a los fuera de convenio en los períodos
-- quincenales (si no, se les liquidaría medio sueldo dos veces al mes
-- además de su mensual).

ALTER TABLE nom_periodos DROP CONSTRAINT IF EXISTS nom_periodos_tipo_check;
ALTER TABLE nom_periodos ADD CONSTRAINT nom_periodos_tipo_check
  CHECK (tipo IN (
    'mensual','mensual_fc','quincenal','quincena_1','quincena_2',
    'sac','sac_1','sac_2','vacaciones','final'
  ));

COMMENT ON COLUMN nom_periodos.tipo IS
  'mensual_fc: período mensual que liquida ÚNICAMENTE al personal con nom_legajo.fuera_convenio = true. Los períodos quincenales excluyen a ese personal.';
