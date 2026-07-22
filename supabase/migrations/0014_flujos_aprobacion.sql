-- 0014_flujos_aprobacion.sql — Fase 3: flujo de aprobación + usuarios externos
--
-- nom_flujos/nom_flujo_pasos: definición del circuito (builder en
-- Configuración). nom_flujo_instancias: una instancia por período que
-- avanza paso a paso. nom_aprobaciones: historial auditado de cada
-- acción (aprobar/rechazar) sobre una instancia.
--
-- nom_usuarios_empresas: puente multi-empresa para roles que no son la
-- empresa "dueña" del usuario (revisor_externo, aprobador_pagos) — un
-- mismo usuario puede revisar varias empresas sin tener empresa_id fijo
-- en su JWT. auth_empresa_id() sigue resolviendo la empresa "propia"
-- (dueños/admins); este puente es aparte y se consulta explícitamente.

CREATE TABLE IF NOT EXISTS nom_usuarios_empresas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL,
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  rol         TEXT NOT NULL CHECK (rol IN ('revisor_externo','aprobador_pagos')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (usuario_id, empresa_id, rol)
);
ALTER TABLE nom_usuarios_empresas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_usuarios_empresas_select ON nom_usuarios_empresas;
CREATE POLICY nom_usuarios_empresas_select ON nom_usuarios_empresas FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id() OR usuario_id = auth.uid());
DROP POLICY IF EXISTS nom_usuarios_empresas_write ON nom_usuarios_empresas;
CREATE POLICY nom_usuarios_empresas_write ON nom_usuarios_empresas FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_usuarios_empresas TO authenticated;
CREATE INDEX IF NOT EXISTS nom_usuarios_empresas_usuario_idx ON nom_usuarios_empresas(usuario_id);
CREATE INDEX IF NOT EXISTS nom_usuarios_empresas_empresa_idx ON nom_usuarios_empresas(empresa_id);

-- ─── nom_flujos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nom_flujos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_flujos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_flujos_all ON nom_flujos;
CREATE POLICY nom_flujos_all ON nom_flujos FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_flujos TO authenticated;
CREATE INDEX IF NOT EXISTS nom_flujos_empresa_idx ON nom_flujos(empresa_id);

-- ─── nom_flujo_pasos ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nom_flujo_pasos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_id       UUID NOT NULL REFERENCES nom_flujos(id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL,
  nombre         TEXT NOT NULL,
  rol_requerido  TEXT NOT NULL CHECK (rol_requerido IN ('revisor_interno','revisor_externo','aprobador_pagos','admin')),
  es_masivo      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (flujo_id, orden)
);
ALTER TABLE nom_flujo_pasos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_flujo_pasos_all ON nom_flujo_pasos;
CREATE POLICY nom_flujo_pasos_all ON nom_flujo_pasos FOR ALL TO authenticated
  USING (
    is_superadmin() OR EXISTS (
      SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id()
    )
  )
  WITH CHECK (
    is_superadmin() OR EXISTS (
      SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id()
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_flujo_pasos TO authenticated;
CREATE INDEX IF NOT EXISTS nom_flujo_pasos_flujo_idx ON nom_flujo_pasos(flujo_id);

-- ─── nom_flujo_instancias ───────────────────────────────────────
-- Una por período que entra al circuito; paso_actual_id NULL = terminada
-- (ver estado). El avance real ocurre en la RPC avanzar_flujo (SECURITY
-- DEFINER, migración 0015) para no depender de que el cliente pueda
-- escribir paso_actual_id directamente (evita saltarse pasos).
CREATE TABLE IF NOT EXISTS nom_flujo_instancias (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo_id      UUID NOT NULL REFERENCES nom_periodos(id) ON DELETE CASCADE,
  flujo_id        UUID NOT NULL REFERENCES nom_flujos(id),
  paso_actual_id  UUID REFERENCES nom_flujo_pasos(id),
  estado          TEXT NOT NULL DEFAULT 'en_progreso' CHECK (estado IN ('en_progreso','aprobado','rechazado')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (periodo_id)
);
ALTER TABLE nom_flujo_instancias ENABLE ROW LEVEL SECURITY;
-- SELECT: dueño/admin de la empresa, superadmin, o usuario cuyo rol
-- (nom_usuarios_empresas) coincide con el rol_requerido del paso actual
-- de esa empresa (revisor externo multi-empresa).
DROP POLICY IF EXISTS nom_flujo_instancias_select ON nom_flujo_instancias;
CREATE POLICY nom_flujo_instancias_select ON nom_flujo_instancias FOR SELECT TO authenticated
  USING (
    is_superadmin() OR empresa_id = auth_empresa_id() OR EXISTS (
      SELECT 1 FROM nom_flujo_pasos p
      JOIN nom_usuarios_empresas ue ON ue.empresa_id = nom_flujo_instancias.empresa_id AND ue.rol = p.rol_requerido
      WHERE p.id = nom_flujo_instancias.paso_actual_id AND ue.usuario_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS nom_flujo_instancias_write ON nom_flujo_instancias;
CREATE POLICY nom_flujo_instancias_write ON nom_flujo_instancias FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_flujo_instancias_update ON nom_flujo_instancias;
CREATE POLICY nom_flujo_instancias_update ON nom_flujo_instancias FOR UPDATE TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
-- El UPDATE real de paso_actual_id/estado lo hace la RPC (SECURITY
-- DEFINER, corre como owner y no está sujeta a esta política), así que
-- esta política de UPDATE es sólo para que un dueño/admin pueda, por
-- ejemplo, reasignar el flujo manualmente si hiciera falta.
GRANT SELECT, INSERT, UPDATE ON nom_flujo_instancias TO authenticated;
CREATE INDEX IF NOT EXISTS nom_flujo_instancias_periodo_idx ON nom_flujo_instancias(periodo_id);
CREATE INDEX IF NOT EXISTS nom_flujo_instancias_paso_idx ON nom_flujo_instancias(paso_actual_id);

-- ─── nom_aprobaciones ───────────────────────────────────────────
-- Historial auditado, nunca se borra ni edita (append-only).
CREATE TABLE IF NOT EXISTS nom_aprobaciones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instancia_id UUID NOT NULL REFERENCES nom_flujo_instancias(id) ON DELETE CASCADE,
  paso_id      UUID NOT NULL REFERENCES nom_flujo_pasos(id),
  usuario_id   UUID NOT NULL,
  accion       TEXT NOT NULL CHECK (accion IN ('aprobado','rechazado')),
  comentario   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_aprobaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_aprobaciones_select ON nom_aprobaciones;
CREATE POLICY nom_aprobaciones_select ON nom_aprobaciones FOR SELECT TO authenticated
  USING (
    is_superadmin() OR EXISTS (
      SELECT 1 FROM nom_flujo_instancias i
      WHERE i.id = nom_aprobaciones.instancia_id AND i.empresa_id = auth_empresa_id()
    ) OR usuario_id = auth.uid()
  );
-- El INSERT lo hace la RPC avanzar_flujo (SECURITY DEFINER); no se
-- otorga INSERT directo a authenticated para forzar que toda acción
-- pase por la validación de rol+empresa+paso del cuerpo de la función.
GRANT SELECT ON nom_aprobaciones TO authenticated;
CREATE INDEX IF NOT EXISTS nom_aprobaciones_instancia_idx ON nom_aprobaciones(instancia_id);
