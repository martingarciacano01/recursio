-- ============================================================
-- 0071: Contacto del empleado en el legajo (nom_legajo)
-- ============================================================
-- Replica las columnas de contacto que Presencio agregó al esquema
-- compartido (telefono: Presencio 043, email: Presencio 044). La
-- dirección ya existe (domicilio, 0002). Presencio es la fuente de
-- verdad que las escribe; Recursio las lee. Idempotente.
-- ============================================================

ALTER TABLE nom_legajo
  ADD COLUMN IF NOT EXISTS telefono TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN nom_legajo.telefono IS 'Teléfono de contacto del empleado (cargado desde Presencio).';
COMMENT ON COLUMN nom_legajo.email IS 'Correo electrónico de contacto del empleado (cargado desde Presencio).';