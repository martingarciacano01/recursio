-- 0034_vacaciones_liquidadas.sql — Liquidaciones individuales: vacaciones
--
-- Trazabilidad de qué ausencias de tipo 'vacaciones' (Presencio) ya se
-- liquidaron. Recursio NUNCA escribe en `ausencias` (0001_vistas_contrato.sql),
-- así que no puede marcar la ausencia como "pagada" en la tabla de la otra
-- app: en cambio guarda acá la referencia (ausencia_id suelto, sin FK — la
-- tabla `ausencias` no pertenece al esquema de Recursio).
--
-- `origen`: 'presencio' cuando los días salen de una ausencia real cargada
-- en Presencio; 'manual' cuando no había ausencia registrada y se tipeó el
-- rango de fechas a mano en Recursio (ver Task de LiquidacionesIndividuales).

CREATE TABLE IF NOT EXISTS nom_vacaciones_liquidadas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id    UUID NOT NULL,
  ausencia_id    UUID,
  liquidacion_id UUID NOT NULL REFERENCES nom_liquidaciones(id) ON DELETE CASCADE,
  fecha_desde    DATE NOT NULL,
  fecha_hasta    DATE NOT NULL,
  dias           INT NOT NULL,
  origen         TEXT NOT NULL CHECK (origen IN ('presencio','manual')),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nom_vacaciones_liquidadas_personal_idx
  ON nom_vacaciones_liquidadas(personal_id);
CREATE INDEX IF NOT EXISTS nom_vacaciones_liquidadas_ausencia_idx
  ON nom_vacaciones_liquidadas(ausencia_id);

ALTER TABLE nom_vacaciones_liquidadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nom_vacaciones_liquidadas_rw ON nom_vacaciones_liquidadas;
CREATE POLICY nom_vacaciones_liquidadas_rw ON nom_vacaciones_liquidadas FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_vacaciones_liquidadas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_vacaciones_liquidadas TO service_role;
