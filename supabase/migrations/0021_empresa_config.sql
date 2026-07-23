-- 0021_empresa_config.sql
-- Datos fiscales de la empresa para el recibo (CUIT, domicilio) — en una
-- tabla satélite propia de Nómina, NO en `empresas` (esa tabla es
-- compartida con Presencio; el plan maestro prohíbe tocar su esquema). El
-- logo se reutiliza de `empresas.logo_url`, que ya existe y ya administra
-- Presencio/Superadmin — no se duplica acá.
CREATE TABLE IF NOT EXISTS nom_empresa_config (
  empresa_id  UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  cuit        TEXT,
  domicilio   TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_empresa_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nom_empresa_config_rw ON nom_empresa_config;
CREATE POLICY nom_empresa_config_rw ON nom_empresa_config FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_empresa_config TO authenticated;
