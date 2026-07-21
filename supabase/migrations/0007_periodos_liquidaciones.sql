-- 0007_periodos_liquidaciones.sql (renombrado de 0006 del plan madre porque
-- 0006 ya está tomado por 0006_tipos_documento_ambito.sql de la Fase 1)
CREATE TABLE IF NOT EXISTS nom_periodos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo               TEXT NOT NULL CHECK (tipo IN ('mensual','quincenal','sac','final')),
  fecha_desde        DATE NOT NULL,
  fecha_hasta        DATE NOT NULL,
  estado             TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','en_flujo','cerrado')),
  snapshot_parametros JSONB,
  created_at         TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_periodos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_periodos_all ON nom_periodos;
CREATE POLICY nom_periodos_all ON nom_periodos FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_periodos TO authenticated;
CREATE INDEX IF NOT EXISTS nom_periodos_empresa_idx ON nom_periodos(empresa_id);

CREATE TABLE IF NOT EXISTS nom_liquidaciones (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo_id           UUID NOT NULL REFERENCES nom_periodos(id) ON DELETE CASCADE,
  personal_id          UUID NOT NULL,
  bruto                NUMERIC NOT NULL DEFAULT 0,
  neto                 NUMERIC NOT NULL DEFAULT 0,
  total_aportes        NUMERIC NOT NULL DEFAULT 0,
  total_contribuciones NUMERIC NOT NULL DEFAULT 0,
  estado               TEXT NOT NULL DEFAULT 'preliminar' CHECK (estado IN ('preliminar','en_flujo','aprobada','pagada')),
  detalle_horas        JSONB, -- snapshot inmutable de asistencia usado para calcular
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (periodo_id, personal_id)
);
ALTER TABLE nom_liquidaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_liquidaciones_all ON nom_liquidaciones;
CREATE POLICY nom_liquidaciones_all ON nom_liquidaciones FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_liquidaciones TO authenticated;
CREATE INDEX IF NOT EXISTS nom_liquidaciones_periodo_idx ON nom_liquidaciones(periodo_id);

CREATE TABLE IF NOT EXISTS nom_liquidacion_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  liquidacion_id  UUID NOT NULL REFERENCES nom_liquidaciones(id) ON DELETE CASCADE,
  concepto_codigo TEXT NOT NULL,
  concepto_nombre TEXT NOT NULL,
  tipo            TEXT NOT NULL,
  monto           NUMERIC NOT NULL,
  regla_aplicada  TEXT, -- 'base' o el índice de la regla, en texto para simplicidad
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_liquidacion_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_liquidacion_items_all ON nom_liquidacion_items;
CREATE POLICY nom_liquidacion_items_all ON nom_liquidacion_items FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_liquidacion_items TO authenticated;
CREATE INDEX IF NOT EXISTS nom_liquidacion_items_liquidacion_idx ON nom_liquidacion_items(liquidacion_id);

CREATE TABLE IF NOT EXISTS nom_pagos_adelantos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id UUID NOT NULL,
  periodo_id  UUID REFERENCES nom_periodos(id) ON DELETE SET NULL,
  monto       NUMERIC NOT NULL CHECK (monto > 0),
  fecha       DATE NOT NULL,
  motivo      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_pagos_adelantos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_pagos_adelantos_all ON nom_pagos_adelantos;
CREATE POLICY nom_pagos_adelantos_all ON nom_pagos_adelantos FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_pagos_adelantos TO authenticated;
CREATE INDEX IF NOT EXISTS nom_pagos_adelantos_empresa_idx ON nom_pagos_adelantos(empresa_id);
