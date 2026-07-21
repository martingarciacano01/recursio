-- 0004_legajo_completo.sql — Fase 1, Task 7
-- nom_familiares: cargas de familia (asignaciones familiares, ganancias).
CREATE TABLE IF NOT EXISTS nom_familiares (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id       UUID NOT NULL,
  vinculo           TEXT NOT NULL CHECK (vinculo IN ('conyuge','conviviente','hijo','otro')),
  nombre            TEXT NOT NULL,
  cuil              TEXT,
  fecha_nacimiento  DATE,
  doc_path          TEXT,
  doc_nombre        TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_familiares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_familiares_all ON nom_familiares;
CREATE POLICY nom_familiares_all ON nom_familiares FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id())
  WITH CHECK (empresa_id = auth_empresa_id());
CREATE INDEX IF NOT EXISTS nom_familiares_empresa_idx ON nom_familiares(empresa_id);
CREATE INDEX IF NOT EXISTS nom_familiares_personal_idx ON nom_familiares(personal_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_familiares TO authenticated;

-- nom_sanciones_personal: calco de la propuesta sanciones_personal de
-- fichaobra/PROPUESTA_legajo_digital.md, con prefijo nom_ (Recursio no
-- crea tablas sin prefijo propio, Recursio_Diseno.md 2.1).
CREATE TABLE IF NOT EXISTS nom_sanciones_personal (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id       UUID NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('apercibimiento','suspension','llamado_atencion','otra')),
  motivo            TEXT NOT NULL,
  fecha             DATE NOT NULL,
  dias_suspension   INTEGER,
  doc_path          TEXT,
  doc_nombre        TEXT,
  aplicada_por      UUID,
  created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_sanciones_personal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_sanciones_personal_all ON nom_sanciones_personal;
CREATE POLICY nom_sanciones_personal_all ON nom_sanciones_personal FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id())
  WITH CHECK (empresa_id = auth_empresa_id());
CREATE INDEX IF NOT EXISTS nom_sanciones_empresa_idx ON nom_sanciones_personal(empresa_id);
CREATE INDEX IF NOT EXISTS nom_sanciones_personal_idx ON nom_sanciones_personal(personal_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_sanciones_personal TO authenticated;
