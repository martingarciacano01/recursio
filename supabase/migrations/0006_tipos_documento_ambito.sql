-- 0006_tipos_documento_ambito.sql — ÚNICA excepción autorizada por el
-- plan madre para modificar una tabla de Presencio. NO aplicar sin
-- confirmación explícita del usuario.
ALTER TABLE tipos_documento ADD COLUMN IF NOT EXISTS ambito TEXT DEFAULT 'general';
