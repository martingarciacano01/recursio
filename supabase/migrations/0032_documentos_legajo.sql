-- 0032_documentos_legajo.sql — Fase 6 Task 6
--
-- Documentación del legajo, del lado de Recursio. NO se escribe en
-- `documentos_personal` (tabla de Presencio): el contrato de
-- 0001_vistas_contrato.sql prohíbe que Recursio escriba en tablas de la
-- otra app. La ficha del legajo LEE documentos_personal y ESCRIBE acá; la
-- lista que ve el usuario es la unión de ambos orígenes.
--
-- nom_documentos_requeridos: qué documentación exige la empresa (config).
-- nom_documentos_legajo: los archivos efectivamente cargados por persona.

CREATE TABLE IF NOT EXISTS nom_documentos_requeridos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,
  nombre        TEXT NOT NULL,
  obligatorio   BOOLEAN NOT NULL DEFAULT true,
  -- vence: si el documento caduca (ART, libreta sanitaria, carnet de
  -- conducir). Si es false, la ficha no pide fecha de vencimiento.
  vence         BOOLEAN NOT NULL DEFAULT false,
  -- dias_aviso: cuántos días antes del vencimiento se marca "por vencer"
  -- en el semáforo de la ficha y en el Dashboard.
  dias_aviso    INT NOT NULL DEFAULT 30,
  orden         INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE IF NOT EXISTS nom_documentos_legajo (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id        UUID NOT NULL,
  requerido_id       UUID REFERENCES nom_documentos_requeridos(id) ON DELETE SET NULL,
  nombre             TEXT NOT NULL,
  storage_path       TEXT,
  fecha_emision      DATE,
  fecha_vencimiento  DATE,
  observaciones      TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nom_documentos_legajo_personal_idx
  ON nom_documentos_legajo(personal_id);

ALTER TABLE nom_documentos_requeridos ENABLE ROW LEVEL SECURITY;
ALTER TABLE nom_documentos_legajo     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nom_documentos_requeridos_rw ON nom_documentos_requeridos;
CREATE POLICY nom_documentos_requeridos_rw ON nom_documentos_requeridos FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

DROP POLICY IF EXISTS nom_documentos_legajo_rw ON nom_documentos_legajo;
CREATE POLICY nom_documentos_legajo_rw ON nom_documentos_legajo FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_documentos_requeridos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_documentos_legajo     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_documentos_requeridos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_documentos_legajo     TO service_role;

-- Bucket privado para los archivos. El acceso se hace siempre con URL
-- firmada (createSignedUrl) desde el front — nunca público.
INSERT INTO storage.buckets (id, name, public)
SELECT 'nom-documentos', 'nom-documentos', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'nom-documentos');

DROP POLICY IF EXISTS nom_documentos_storage_rw ON storage.objects;
CREATE POLICY nom_documentos_storage_rw ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'nom-documentos')
  WITH CHECK (bucket_id = 'nom-documentos');
