-- 0025_roles_nomina.sql
-- Amplía nom_usuarios_empresas (0014) de "solo revisor_externo/aprobador_pagos
-- multi-empresa" a la tabla de roles completa de Nómina, con alcance
-- opcional (sitio/región) para supervisor. has_rol_nomina() es el único
-- punto de verdad que las policies nuevas (0026) van a consultar — nunca
-- se resuelve el rol desde user_metadata del cliente.

ALTER TABLE nom_usuarios_empresas
  DROP CONSTRAINT IF EXISTS nom_usuarios_empresas_rol_check;
ALTER TABLE nom_usuarios_empresas
  ADD CONSTRAINT nom_usuarios_empresas_rol_check
  CHECK (rol IN ('admin','rrhh','revisor_interno','aprobador_pagos','revisor_externo','supervisor','consulta'));

ALTER TABLE nom_usuarios_empresas
  ADD COLUMN IF NOT EXISTS alcance_tipo TEXT NOT NULL DEFAULT 'empresa'
    CHECK (alcance_tipo IN ('empresa','region','sitio')),
  ADD COLUMN IF NOT EXISTS alcance_id UUID;

-- Regiones propias de Nómina (agrupan obras de Presencio para el alcance
-- "region" de un supervisor). nom_regiones_obras vincula cada obra
-- (nom_v_personal.obra_id) a 0..N regiones.
CREATE TABLE IF NOT EXISTS nom_regiones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_regiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_regiones_all ON nom_regiones;
CREATE POLICY nom_regiones_all ON nom_regiones FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_regiones TO authenticated;

CREATE TABLE IF NOT EXISTS nom_regiones_obras (
  region_id  UUID NOT NULL REFERENCES nom_regiones(id) ON DELETE CASCADE,
  obra_id    UUID NOT NULL,
  PRIMARY KEY (region_id, obra_id)
);
ALTER TABLE nom_regiones_obras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_regiones_obras_all ON nom_regiones_obras;
CREATE POLICY nom_regiones_obras_all ON nom_regiones_obras FOR ALL TO authenticated
  USING (is_superadmin() OR EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id()))
  WITH CHECK (is_superadmin() OR EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_regiones_obras TO authenticated;

-- Helper SQL usado por TODAS las policies de escritura nuevas (0026) y por
-- whoami_nomina(). SECURITY DEFINER + STABLE: corre con los permisos del
-- owner (evita recursión de RLS al leer nom_usuarios_empresas) pero solo
-- lee, nunca escribe. Superadmin siempre pasa.
CREATE OR REPLACE FUNCTION has_rol_nomina(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT is_superadmin() OR EXISTS (
    SELECT 1 FROM nom_usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.empresa_id = auth_empresa_id()
      AND ue.rol = ANY(roles)
  );
$$;
GRANT EXECUTE ON FUNCTION has_rol_nomina(TEXT[]) TO authenticated;

-- whoami_nomina(): analogía de whoami() (Presencio) para los roles de
-- Nómina. Un usuario puede tener más de un rol/empresa (ej. rrhh en su
-- empresa dueña + revisor_externo en otra) — de ahí que devuelva filas,
-- no una sola. El cliente NUNCA deriva roles de user_metadata editable.
CREATE OR REPLACE FUNCTION whoami_nomina()
RETURNS TABLE (rol TEXT, alcance_tipo TEXT, alcance_id UUID, empresa_id UUID)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT ue.rol, ue.alcance_tipo, ue.alcance_id, ue.empresa_id
  FROM nom_usuarios_empresas ue
  WHERE ue.usuario_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION whoami_nomina() TO authenticated;
