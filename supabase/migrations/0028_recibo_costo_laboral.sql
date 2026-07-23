-- 0028_recibo_costo_laboral.sql
-- Datos que el recibo de costo laboral (modelo AR) necesita y que hoy no se
-- persisten. Ninguna de estas columnas toca el esquema compartido con
-- Presencio: nom_liquidacion_items, nom_legajo y nom_periodos son tablas
-- propias de Nómina.

-- Unidad (%, cantidad de días u "1") y base sobre la que se calculó cada
-- concepto: columnas UNIDAD y BASE del modelo. NULL en filas viejas.
ALTER TABLE nom_liquidacion_items
  ADD COLUMN IF NOT EXISTS unidad_texto  TEXT,
  ADD COLUMN IF NOT EXISTS base_calculo  NUMERIC,
  ADD COLUMN IF NOT EXISTS grupo_recibo  TEXT,
  ADD COLUMN IF NOT EXISTS detalle_recibo TEXT;

-- Antigüedad reconocida al ingreso (años previos computados aparte de la
-- fecha de ingreso). Cabecera del recibo: "Antigüedad Reconocida".
ALTER TABLE nom_legajo
  ADD COLUMN IF NOT EXISTS antiguedad_reconocida INTEGER NOT NULL DEFAULT 0;

-- Fecha de pago del período (cabecera "Período / Fecha Pago").
ALTER TABLE nom_periodos
  ADD COLUMN IF NOT EXISTS fecha_pago DATE;

COMMENT ON COLUMN nom_liquidacion_items.unidad_texto IS 'Columna UNIDAD del recibo: "10,77 %", "30", "1"';
COMMENT ON COLUMN nom_liquidacion_items.base_calculo IS 'Columna BASE del recibo: monto sobre el que se aplicó la unidad';
COMMENT ON COLUMN nom_liquidacion_items.grupo_recibo IS 'Sección del recibo: contribucion|cct|remunerativo|no_remunerativo|descuento';
COMMENT ON COLUMN nom_liquidacion_items.detalle_recibo IS 'Organismo del detalle inferior: sindical|seguridad_social|obra_social|inssjp|art|scvo|NULL';
