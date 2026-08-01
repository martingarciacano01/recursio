-- 0040_adicionales_por_legajo.sql
--
-- Feature: asignación de adicionales a nivel EMPLEADO (ej. "trabajo en
-- altura"), no solo a nivel categoría (ver plan 2026-07-29 §3). Hoy
-- filtrarPorCategoria (motor.ts) solo puede decir "este adicional aplica a
-- estas categorías", no "a esta persona puntual" — no hay forma de decir
-- "Juan cobra altura y Ana no" sin inventar una categoría por combinación.
--
-- nom_legajo_adicionales: la asignación en sí, con override opcional de
-- valor (% del básico o monto fijo) y vigencia. `nom_conceptos.asignacion`
-- decide si un adicional se sigue filtrando por categoría (como siempre) o
-- si pasa a depender EXCLUSIVAMENTE de esta tabla.

ALTER TABLE nom_conceptos
  ADD COLUMN IF NOT EXISTS asignacion TEXT NOT NULL DEFAULT 'categoria'
    CHECK (asignacion IN ('categoria', 'legajo'));

CREATE TABLE IF NOT EXISTS nom_legajo_adicionales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  legajo_id      uuid NOT NULL REFERENCES nom_legajo(id) ON DELETE CASCADE,
  concepto_id    uuid NOT NULL REFERENCES nom_conceptos(id) ON DELETE CASCADE,
  modo           TEXT NOT NULL CHECK (modo IN ('porcentaje', 'nominal', 'heredado')),
  porcentaje     NUMERIC,
  monto          NUMERIC,
  vigencia_desde DATE NOT NULL,
  vigencia_hasta DATE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legajo_id, concepto_id, vigencia_desde)
);

CREATE INDEX IF NOT EXISTS nom_legajo_adicionales_legajo_idx ON nom_legajo_adicionales(legajo_id);
CREATE INDEX IF NOT EXISTS nom_legajo_adicionales_empresa_idx ON nom_legajo_adicionales(empresa_id);

ALTER TABLE nom_legajo_adicionales ENABLE ROW LEVEL SECURITY;

-- Mismo patrón de RLS que el resto de nom_legajo/nom_familiares
-- (auth_empresa_id()/is_superadmin(), ver 0002/0004/0008 — no
-- auth.jwt()->>'empresa_id' directo, que no es la convención de este repo).
DROP POLICY IF EXISTS nom_legajo_adicionales_all ON nom_legajo_adicionales;
CREATE POLICY nom_legajo_adicionales_all ON nom_legajo_adicionales FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

-- La Edge Function liquidar-periodo usa el service_role (bypassea RLS por
-- defecto en Supabase, pero se deja el GRANT explícito por consistencia con
-- el resto de las tablas nom_* — ver migración 0009).
GRANT SELECT ON nom_legajo_adicionales TO service_role;
