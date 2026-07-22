-- 0018_legajo_baja_modalidad.sql
-- Alta/baja del legajo, fuera de convenio, dirección ampliada,
-- modalidad de básico por categoría y código imprimible de concepto.

ALTER TABLE nom_legajo
  ADD COLUMN IF NOT EXISTS fecha_baja DATE,
  ADD COLUMN IF NOT EXISTS motivo_baja TEXT
    CHECK (motivo_baja IN ('renuncia','despido_sin_causa','despido_con_causa','fin_obra','mutuo_acuerdo','fallecimiento') OR motivo_baja IS NULL),
  ADD COLUMN IF NOT EXISTS liquidacion_final_id UUID REFERENCES nom_liquidaciones(id),
  ADD COLUMN IF NOT EXISTS fuera_convenio BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sueldo_convenido NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS localidad TEXT,
  ADD COLUMN IF NOT EXISTS provincia TEXT,
  ADD COLUMN IF NOT EXISTS codigo_postal TEXT;

-- modalidad del básico de la escala: por hora (jornal), mensual o quincenal
ALTER TABLE nom_categorias
  ADD COLUMN IF NOT EXISTS modalidad TEXT NOT NULL DEFAULT 'hora'
    CHECK (modalidad IN ('hora','mensual','quincenal'));

-- código corto que se imprime en el recibo (ej. '0015'), editable por empresa
ALTER TABLE nom_conceptos
  ADD COLUMN IF NOT EXISTS codigo_recibo TEXT;

COMMENT ON COLUMN nom_legajo.fuera_convenio IS 'true: liquida por sueldo_convenido, sin convenio/categoría';
COMMENT ON COLUMN nom_categorias.modalidad IS 'hora=jornal x horas trabajadas; mensual=monto fijo por mes; quincenal=monto fijo por quincena';
