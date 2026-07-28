-- 0035_periodos_por_convenio.sql
-- Modalidad (mensual/quincenal) y fechas de corte configurables por convenio,
-- + convenio_id en los períodos (un período quincenal/mensual pertenece a UN
-- convenio puntual, con sus propias fechas de corte). "Fuera de convenio"
-- (nom_legajo.fuera_convenio) sigue siendo un caso aparte, sin convenio_id:
-- su período (mensual_fc) no cambia.

ALTER TABLE nom_convenios
  ADD COLUMN IF NOT EXISTS modalidad TEXT NOT NULL DEFAULT 'quincenal'
    CHECK (modalidad IN ('mensual','quincenal')),
  ADD COLUMN IF NOT EXISTS corte_q1_desde INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS corte_q1_hasta INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS corte_q2_desde INT NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS corte_q2_hasta INT,       -- NULL = último día real del mes
  ADD COLUMN IF NOT EXISTS corte_mensual_desde INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS corte_mensual_hasta INT;  -- NULL = último día real del mes

COMMENT ON COLUMN nom_convenios.modalidad IS 'mensual: un solo período por mes. quincenal: quincena_1 + quincena_2.';
COMMENT ON COLUMN nom_convenios.corte_q2_hasta IS 'NULL = último día real del mes (resuelve automáticamente febrero 28/29).';
COMMENT ON COLUMN nom_convenios.corte_mensual_hasta IS 'NULL = último día real del mes.';

ALTER TABLE nom_periodos ADD COLUMN IF NOT EXISTS convenio_id UUID REFERENCES nom_convenios(id);
COMMENT ON COLUMN nom_periodos.convenio_id IS
  'A qué convenio pertenece un período mensual/quincena_1/quincena_2 (sus fechas se calcularon con el corte de ESE convenio). NULL en mensual_fc (fuera de convenio, no depende de ningún convenio), sac_1/sac_2, y períodos legado.';
