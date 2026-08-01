-- 0036_empresa_logo.sql
-- Logo propio de la empresa para el recibo de sueldo.
--
-- `empresas.logo_url` existe y lo administra Presencio, pero esa tabla es
-- compartida y el plan maestro prohíbe escribirla desde Nómina. Así que el
-- logo que se imprime en el recibo se guarda en nuestra tabla satélite
-- nom_empresa_config; si está vacío, el recibo cae de nuevo a
-- empresas.logo_url (así una empresa que ya cargó su logo en Presencio no
-- tiene que volver a subirlo).
ALTER TABLE nom_empresa_config ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Bucket público: un logo institucional no es dato sensible y el PDF lo
-- necesita como imagen directa. Se separa de 'nom-documentos' (privado,
-- documentación del legajo) justamente para no volver público aquel.
INSERT INTO storage.buckets (id, name, public)
SELECT 'nom-logos', 'nom-logos', true
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'nom-logos');

-- Lectura pública; escritura solo para usuarios autenticados. La ruta de
-- cada archivo es <empresa_id>/logo-<timestamp>.<ext>.
DROP POLICY IF EXISTS nom_logos_lectura ON storage.objects;
CREATE POLICY nom_logos_lectura ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'nom-logos');

DROP POLICY IF EXISTS nom_logos_escritura ON storage.objects;
CREATE POLICY nom_logos_escritura ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nom-logos');

DROP POLICY IF EXISTS nom_logos_actualizacion ON storage.objects;
CREATE POLICY nom_logos_actualizacion ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'nom-logos') WITH CHECK (bucket_id = 'nom-logos');

DROP POLICY IF EXISTS nom_logos_borrado ON storage.objects;
CREATE POLICY nom_logos_borrado ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nom-logos');
