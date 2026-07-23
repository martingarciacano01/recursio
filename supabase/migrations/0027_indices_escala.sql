-- 0027_indices_escala.sql
-- Índices para las consultas más frecuentes a escala (Fase 5I, Tasks 35-36)
-- y columnas de progreso/reanudación para liquidar-periodo por lotes.
-- nom_liquidaciones ya tiene UNIQUE (periodo_id, personal_id) desde
-- 0007_periodos_liquidaciones.sql — no se repite acá.

CREATE INDEX IF NOT EXISTS nom_liquidacion_items_liquidacion_idx
  ON nom_liquidacion_items (liquidacion_id);

CREATE INDEX IF NOT EXISTS nom_categorias_vigencia_idx
  ON nom_categorias (convenio_id, nombre, vigencia_desde DESC);

CREATE INDEX IF NOT EXISTS nom_no_remunerativos_vigencia_idx
  ON nom_no_remunerativos (convenio_id, categoria_nombre, vigencia_desde DESC);

CREATE INDEX IF NOT EXISTS nom_legajo_empresa_baja_idx
  ON nom_legajo (empresa_id, fecha_baja);

-- Progreso de liquidación por lotes: permite a la UI mostrar una barra y al
-- cliente reintentar con `reanudar: true` sin recalcular a quienes ya
-- quedaron liquidados en esta corrida (ver liquidar-periodo/index.ts).
ALTER TABLE nom_periodos
  ADD COLUMN IF NOT EXISTS calculo_estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (calculo_estado IN ('pendiente','calculando','completo','error')),
  ADD COLUMN IF NOT EXISTS calculo_procesados INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calculo_total INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN nom_periodos.calculo_estado IS 'estado de la ultima corrida de liquidar-periodo: pendiente|calculando|completo|error';
