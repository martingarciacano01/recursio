-- 0066_schemas_pendientes.sql — CONSOLIDADO para aplicar en Supabase SQL Editor
-- Genera los schemas del plan convenios-por-obra (0058-0065). TODO idempotente.
--
-- DIAGNOSTICO: corre primero esto para ver qué existe y qué falta.

SELECT 'nom_v_obras' AS objeto, CASE WHEN to_regclass('public.nom_v_obras') IS NULL THEN 'FALTA' ELSE 'ok' END AS estado
UNION ALL SELECT 'nom_convenios.obra_id', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='nom_convenios' AND column_name='obra_id') THEN 'ok' ELSE 'FALTA' END
UNION ALL SELECT 'nom_config_obras', CASE WHEN to_regclass('public.nom_config_obras') IS NULL THEN 'FALTA' ELSE 'ok' END
UNION ALL SELECT 'nom_ajustes_horas', CASE WHEN to_regclass('public.nom_ajustes_horas') IS NULL THEN 'FALTA' ELSE 'ok' END
UNION ALL SELECT 'nom_bonos', CASE WHEN to_regclass('public.nom_bonos') IS NULL THEN 'FALTA' ELSE 'ok' END
UNION ALL SELECT 'nom_bono_aplicaciones', CASE WHEN to_regclass('public.nom_bono_aplicaciones') IS NULL THEN 'FALTA' ELSE 'ok' END
UNION ALL SELECT 'nom_bono_excepciones', CASE WHEN to_regclass('public.nom_bono_excepciones') IS NULL THEN 'FALTA' ELSE 'ok' END
UNION ALL SELECT 'nom_bono_aplicaciones.tipo_monto', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='nom_bono_aplicaciones' AND column_name='tipo_monto') THEN 'ok' ELSE 'FALTA' END
UNION ALL SELECT 'nom_empresa_features', CASE WHEN to_regclass('public.nom_empresa_features') IS NULL THEN 'FALTA' ELSE 'ok' END
UNION ALL SELECT 'nom_liquidaciones.obra_id', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='nom_liquidaciones' AND column_name='obra_id') THEN 'ok' ELSE 'FALTA' END;

-- =====================================================================
-- A PARTIR DE ACA: aplica los schemas (idempotente, se puede correr
-- varias veces sin romper nada).
-- =====================================================================


-- >>> migración: 0058_vista_obras_presencio.sql
-- 0058_vista_obras_presencio.sql — contrato de lectura Recursio → Presencio
-- (obras). Mismo patrón que 0001: security_invoker=true para heredar la RLS
-- de la tabla base `obras` con los permisos del usuario que consulta.
--
-- NOTA: columnas asumidas (id, empresa_id, nombre) según el diseño de
-- Presencio documentado en 0001_vistas_contrato.sql (personal.obra_id
-- referencia esta tabla). Verificar contra el esquema real antes de
-- aplicar en producción:
--   select column_name from information_schema.columns
--   where table_name = 'obras' order by ordinal_position;
-- Si difiere, ajustar el SELECT de la vista.

CREATE OR REPLACE VIEW nom_v_obras AS
  SELECT id, empresa_id, nombre
  FROM obras;

ALTER VIEW nom_v_obras SET (security_invoker = true);

GRANT SELECT ON nom_v_obras TO authenticated;
GRANT SELECT ON nom_v_obras TO service_role;


-- >>> migración: 0059_convenio_por_obra.sql
-- 0059_convenio_por_obra.sql
--
-- Permite clonar una plantilla global de convenio (ej. UOCRA) hacia un
-- convenio de OBRA puntual (no solo de empresa). El clon copia estructura
-- + VALORES de escala (básicos) y no remunerativos (decisión del usuario:
-- se copian con sus montos, no en cero). Si p_obra_id se pasa, el clon
-- re-apunta solo los legajos de esa obra; si no, re-apunta todos los
-- legajos de la empresa que estaban en el convenio global (comportamiento
-- previo de 0038, sin cambios).

ALTER TABLE nom_convenios ADD COLUMN IF NOT EXISTS obra_id UUID;
COMMENT ON COLUMN nom_convenios.obra_id IS
  'Obra de Presencio a la que aplica este convenio (vía nom_v_obras). NULL = convenio genérico de empresa.';

CREATE OR REPLACE FUNCTION clonar_convenio(
  convenio_global_id UUID,
  p_empresa_id UUID DEFAULT NULL,
  p_obra_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID := auth_empresa_id();
  v_origen  nom_convenios%ROWTYPE;
  v_nuevo   UUID;
BEGIN
  IF v_empresa IS NULL THEN
    IF NOT is_superadmin() OR p_empresa_id IS NULL THEN
      RAISE EXCEPTION 'usuario sin empresa asignada';
    END IF;
    v_empresa := p_empresa_id;
  END IF;

  SELECT * INTO v_origen FROM nom_convenios WHERE id = convenio_global_id AND empresa_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'convenio global no encontrado';
  END IF;

  -- Si el clon es "por obra", buscar/crear separado del clon genérico
  -- (mismo nombre puede existir una vez por obra y una vez genérico).
  IF p_obra_id IS NOT NULL THEN
    SELECT id INTO v_nuevo FROM nom_convenios
      WHERE empresa_id = v_empresa AND obra_id = p_obra_id AND nombre = v_origen.nombre;
  ELSE
    SELECT id INTO v_nuevo FROM nom_convenios
      WHERE empresa_id = v_empresa AND obra_id IS NULL AND nombre = v_origen.nombre;
  END IF;
  IF FOUND THEN
    RETURN v_nuevo;
  END IF;

  INSERT INTO nom_convenios (
    empresa_id, nombre, regimen, descripcion, obra_id,
    modalidad, corte_q1_desde, corte_q1_hasta,
    corte_q2_desde, corte_q2_hasta, corte_mensual_desde, corte_mensual_hasta
  )
  VALUES (
    v_empresa, v_origen.nombre, v_origen.regimen, v_origen.descripcion, p_obra_id,
    v_origen.modalidad, v_origen.corte_q1_desde, v_origen.corte_q1_hasta,
    v_origen.corte_q2_desde, v_origen.corte_q2_hasta,
    v_origen.corte_mensual_desde, v_origen.corte_mensual_hasta
  )
  RETURNING id INTO v_nuevo;

  -- Estructura + VALORES de escala (básicos) y no remunerativos (decisión
  -- del usuario): se copian con sus montos, no en cero.
  INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde, modalidad)
  SELECT v_nuevo, nombre, basico, vigencia_desde, modalidad
  FROM nom_categorias WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_no_remunerativos (convenio_id, categoria_nombre, monto, vigencia_desde)
  SELECT v_nuevo, categoria_nombre, monto, vigencia_desde
  FROM nom_no_remunerativos WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config, codigo_recibo)
  SELECT v_empresa, v_nuevo, codigo, nombre, tipo, formula, orden, imprimible, categorias, config, codigo_recibo
  FROM nom_conceptos WHERE convenio_id = convenio_global_id AND empresa_id IS NULL;

  INSERT INTO nom_concepto_reglas (concepto_id, orden, condicion, formula)
  SELECT nc.id, r.orden, r.condicion, r.formula
  FROM nom_conceptos viejo
  JOIN nom_concepto_reglas r ON r.concepto_id = viejo.id
  JOIN nom_conceptos nc ON nc.convenio_id = v_nuevo AND nc.empresa_id = v_empresa AND nc.codigo = viejo.codigo
  WHERE viejo.convenio_id = convenio_global_id AND viejo.empresa_id IS NULL;

  -- Re-apunta legajos: TODOS los de la empresa en ese convenio si el clon
  -- es genérico; SOLO los de la obra si el clon es por obra.
  UPDATE nom_legajo l SET
    convenio_id = v_nuevo,
    categoria_id = (
      SELECT nueva.id FROM nom_categorias vieja
      JOIN nom_categorias nueva
        ON nueva.convenio_id = v_nuevo
       AND nueva.nombre = vieja.nombre
       AND nueva.vigencia_desde = vieja.vigencia_desde
      WHERE vieja.id = l.categoria_id
    )
  WHERE l.empresa_id = v_empresa AND l.convenio_id = convenio_global_id
    AND (
      p_obra_id IS NULL
      OR l.personal_id IN (
        SELECT personal_id FROM nom_v_personal
        WHERE empresa_id = v_empresa AND obra_id = p_obra_id
      )
    );

  RETURN v_nuevo;
END $$;
REVOKE ALL ON FUNCTION clonar_convenio(UUID, UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION clonar_convenio(UUID, UUID, UUID) TO authenticated;


-- >>> migración: 0060_config_horas_obra.sql
-- 0060_config_horas_obra.sql — topes de horas y jornada POR OBRA.
-- La resolución en liquidar-periodo es: obra → empresa (nom_config_horas,
-- 0050) → default 8h.
CREATE TABLE IF NOT EXISTS nom_config_obras (
  empresa_id           UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  obra_id              UUID NOT NULL,
  tope_horas_diarias   NUMERIC,
  tope_horas_semanales NUMERIC,
  tope_horas_quincena  NUMERIC,
  tope_horas_mes       NUMERIC,
  jornada_horas        NUMERIC NOT NULL DEFAULT 8,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (empresa_id, obra_id)
);
ALTER TABLE nom_config_obras ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que nom_config_horas (0050): policies separadas por acción,
-- con bypass explícito de superadmin.
DROP POLICY IF EXISTS nom_config_obras_select ON nom_config_obras;
CREATE POLICY nom_config_obras_select ON nom_config_obras FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_config_obras_insert ON nom_config_obras;
CREATE POLICY nom_config_obras_insert ON nom_config_obras FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_config_obras_update ON nom_config_obras;
CREATE POLICY nom_config_obras_update ON nom_config_obras FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_config_obras_delete ON nom_config_obras;
CREATE POLICY nom_config_obras_delete ON nom_config_obras FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_config_obras TO authenticated;


-- >>> migración: 0061_ajustes_horas_periodo.sql
-- 0061_ajustes_horas_periodo.sql — ajuste GLOBAL de horas trabajadas por
-- persona para un período puntual (delta, puede ser negativo). No es una
-- edición día a día: corrige el total del período antes de liquidar.
CREATE TABLE IF NOT EXISTS nom_ajustes_horas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo_id      UUID NOT NULL REFERENCES nom_periodos(id) ON DELETE CASCADE,
  personal_id     UUID NOT NULL,
  horas_globales  NUMERIC NOT NULL,
  motivo          TEXT,
  creado_por      UUID,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, periodo_id, personal_id)
);
ALTER TABLE nom_ajustes_horas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nom_ajustes_horas_select ON nom_ajustes_horas;
CREATE POLICY nom_ajustes_horas_select ON nom_ajustes_horas FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_ajustes_horas_insert ON nom_ajustes_horas;
CREATE POLICY nom_ajustes_horas_insert ON nom_ajustes_horas FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_ajustes_horas_update ON nom_ajustes_horas;
CREATE POLICY nom_ajustes_horas_update ON nom_ajustes_horas FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_ajustes_horas_delete ON nom_ajustes_horas;
CREATE POLICY nom_ajustes_horas_delete ON nom_ajustes_horas FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_ajustes_horas TO authenticated;


-- >>> migración: 0062_bonos_no_remunerativos.sql
-- 0062_bonos_no_remunerativos.sql
-- Catálogo de bonos globales, definidos por SUPERADMIN (empresa_id NULL) y
-- visibles para todas las empresas. El monto base se define acá; cada
-- empresa lo aplica a una obra (o a toda la empresa) con su propio monto.
CREATE TABLE IF NOT EXISTS nom_bonos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  monto_base    NUMERIC NOT NULL DEFAULT 0,
  descripcion   TEXT,
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (nombre)
);
ALTER TABLE nom_bonos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_bonos_select ON nom_bonos;
CREATE POLICY nom_bonos_select ON nom_bonos FOR SELECT TO authenticated
  USING (true); -- catálogo global de lectura para todas las empresas
DROP POLICY IF EXISTS nom_bonos_insert ON nom_bonos;
CREATE POLICY nom_bonos_insert ON nom_bonos FOR INSERT TO authenticated
  WITH CHECK (is_superadmin());
DROP POLICY IF EXISTS nom_bonos_update ON nom_bonos;
CREATE POLICY nom_bonos_update ON nom_bonos FOR UPDATE TO authenticated
  USING (is_superadmin()) WITH CHECK (is_superadmin());
DROP POLICY IF EXISTS nom_bonos_delete ON nom_bonos;
CREATE POLICY nom_bonos_delete ON nom_bonos FOR DELETE TO authenticated
  USING (is_superadmin());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bonos TO authenticated;

-- Aplicación por EMPRESA + OBRA: qué bono se paga, en qué obra (obra_id
-- NULL = toda la empresa) y con qué monto. Lo administra la empresa.
CREATE TABLE IF NOT EXISTS nom_bono_aplicaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  obra_id     UUID, -- NULL = toda la empresa
  bono_id     UUID NOT NULL REFERENCES nom_bonos(id) ON DELETE CASCADE,
  monto       NUMERIC NOT NULL DEFAULT 0,
  vigencia_desde DATE,
  vigencia_hasta DATE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, obra_id, bono_id)
);
ALTER TABLE nom_bono_aplicaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_bono_aplicaciones_select ON nom_bono_aplicaciones;
CREATE POLICY nom_bono_aplicaciones_select ON nom_bono_aplicaciones FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_bono_aplicaciones_insert ON nom_bono_aplicaciones;
CREATE POLICY nom_bono_aplicaciones_insert ON nom_bono_aplicaciones FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_bono_aplicaciones_update ON nom_bono_aplicaciones;
CREATE POLICY nom_bono_aplicaciones_update ON nom_bono_aplicaciones FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_bono_aplicaciones_delete ON nom_bono_aplicaciones;
CREATE POLICY nom_bono_aplicaciones_delete ON nom_bono_aplicaciones FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bono_aplicaciones TO authenticated;

-- Excepción por PERSONA: monto distinto o desactivado (monto IS NULL).
CREATE TABLE IF NOT EXISTS nom_bono_excepciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id UUID NOT NULL,
  bono_id     UUID NOT NULL REFERENCES nom_bonos(id) ON DELETE CASCADE,
  monto       NUMERIC, -- NULL = bono desactivado para esta persona
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, personal_id, bono_id)
);
ALTER TABLE nom_bono_excepciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_bono_excepciones_select ON nom_bono_excepciones;
CREATE POLICY nom_bono_excepciones_select ON nom_bono_excepciones FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_bono_excepciones_insert ON nom_bono_excepciones;
CREATE POLICY nom_bono_excepciones_insert ON nom_bono_excepciones FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_bono_excepciones_update ON nom_bono_excepciones;
CREATE POLICY nom_bono_excepciones_update ON nom_bono_excepciones FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_bono_excepciones_delete ON nom_bono_excepciones;
CREATE POLICY nom_bono_excepciones_delete ON nom_bono_excepciones FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bono_excepciones TO authenticated;


-- >>> migración: 0063_empresa_features.sql
-- 0063_empresa_features.sql — toggles por empresa de las funcionalidades
-- nuevas del plan convenios-por-obra (2026-08-07). No todos los clientes
-- necesitan convenio por obra, topes por obra, ajuste global de horas o
-- bonos no remunerativos: el superadmin habilita cada una por empresa
-- desde Superadmin. Sin fila = feature apagada (default seguro: nada nuevo
-- se activa solo).
--
-- Claves reconocidas por el frontend/edge function (no hay CHECK acá para
-- no tener que migrar si se agrega una nueva feature más adelante):
--   'convenios_por_obra'      — clonar convenio hacia una obra puntual
--   'topes_horas_por_obra'    — tope de horas diarias/jornada por obra
--   'ajuste_horas_periodo'    — ajuste global de horas por persona/período
--   'bonos_no_remunerativos'  — catálogo de bonos + aplicación + excepción
CREATE TABLE IF NOT EXISTS nom_empresa_features (
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (empresa_id, feature)
);
ALTER TABLE nom_empresa_features ENABLE ROW LEVEL SECURITY;

-- Lectura: la propia empresa necesita saber qué tiene habilitado para
-- mostrar/ocultar UI; superadmin ve todas.
DROP POLICY IF EXISTS nom_empresa_features_select ON nom_empresa_features;
CREATE POLICY nom_empresa_features_select ON nom_empresa_features FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());

-- Escritura: SOLO superadmin. Habilitar/deshabilitar features de un cliente
-- es una decisión comercial/de soporte, no algo que la empresa se
-- autogestione.
DROP POLICY IF EXISTS nom_empresa_features_insert ON nom_empresa_features;
CREATE POLICY nom_empresa_features_insert ON nom_empresa_features FOR INSERT TO authenticated
  WITH CHECK (is_superadmin());
DROP POLICY IF EXISTS nom_empresa_features_update ON nom_empresa_features;
CREATE POLICY nom_empresa_features_update ON nom_empresa_features FOR UPDATE TO authenticated
  USING (is_superadmin()) WITH CHECK (is_superadmin());
DROP POLICY IF EXISTS nom_empresa_features_delete ON nom_empresa_features;
CREATE POLICY nom_empresa_features_delete ON nom_empresa_features FOR DELETE TO authenticated
  USING (is_superadmin());

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_empresa_features TO authenticated;
GRANT SELECT ON nom_empresa_features TO service_role;


-- >>> migración: 0064_obra_en_liquidaciones_bono_tipo_monto.sql
-- 0064_obra_en_liquidaciones_bono_tipo_monto.sql
-- Ajustes de los 10 ítems del plan convenios-por-obra (2026-08-07):
--   · nom_liquidaciones.obra_id — la obra del personal al momento de la
--     liquidación queda persistida en la fila, para mostrarla en la grilla
--     y el CSV aun si la persona se reasigna de obra después.
--   · nom_bono_aplicaciones.tipo_monto — el bono se paga con monto FIJO o
--     VARIABLE por hora trabajada ('fijo' | 'por_horas').

ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS obra_id UUID;

COMMENT ON COLUMN nom_liquidaciones.obra_id IS
  'Obra a la que estaba asignada la persona al momento de liquidar (Presencio, via nom_v_personal.obra_id). NULL si no tenia obra o es una liquidacion previa a la migracion 0064.';

ALTER TABLE nom_bono_aplicaciones ADD COLUMN IF NOT EXISTS tipo_monto TEXT NOT NULL DEFAULT 'fijo';
ALTER TABLE nom_bono_aplicaciones DROP CONSTRAINT IF EXISTS nom_bono_aplicaciones_tipo_monto_check;
ALTER TABLE nom_bono_aplicaciones ADD CONSTRAINT nom_bono_aplicaciones_tipo_monto_check
  CHECK (tipo_monto IN ('fijo', 'por_horas'));

COMMENT ON COLUMN nom_bono_aplicaciones.tipo_monto IS
  'fijo: el monto se paga tal cual. por_horas: el monto es el valor por HORA trabajada y se multiplica por horas del período. Historicamente ''fijo'' (default de la migracion 0062).';

-- >>> migración: 0065_clonar_convenio_gate_feature.sql
-- 0065_clonar_convenio_gate_feature.sql
--
-- Item 4 (plan convenios-por-obra 2026-08-07): `clonar_convenio` con
-- p_obra_id NO NULL solo está gateado del lado de la UI (el selector de
-- obra aparece recién cuando la feature `convenios_por_obra` está prendida
-- para la empresa). Del lado del servidor el RPC seguía aceptando el clon
-- por obra aunque la feature esté apagada (fail-closed por violación).
--
-- Este mover la guarda al propio RPC: sin la fila activa en
-- nom_empresa_features, la función rechaza el p_obra_id con el mismo error
-- genérico que el resto de la feature. El clon genérico (p_obra_id NULL)
-- no cambia — es el comportamiento previo de 0038/0059.

CREATE OR REPLACE FUNCTION clonar_convenio(
  convenio_global_id UUID,
  p_empresa_id UUID DEFAULT NULL,
  p_obra_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID := auth_empresa_id();
  v_origen  nom_convenios%ROWTYPE;
  v_nuevo   UUID;
BEGIN
  IF v_empresa IS NULL THEN
    IF NOT is_superadmin() OR p_empresa_id IS NULL THEN
      RAISE EXCEPTION 'usuario sin empresa asignada';
    END IF;
    v_empresa := p_empresa_id;
  END IF;

  -- Gate por feature (migración 0063, fail-closed): clonar hacia una obra
  -- puntual requiere la feature `convenios_por_obra` habilitada para la
  -- empresa. Sin la fila activa, el RPC se comporta como antes (clon
  -- genérico sin obra).
  IF p_obra_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM nom_empresa_features
      WHERE empresa_id = v_empresa AND feature = 'convenios_por_obra' AND activo
    ) THEN
      RAISE EXCEPTION 'clonar convenio por obra no habilitado para esta empresa';
    END IF;
  END IF;

  SELECT * INTO v_origen FROM nom_convenios WHERE id = convenio_global_id AND empresa_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'convenio global no encontrado';
  END IF;

  -- Si el clon es "por obra", buscar/crear separado del clon genérico
  -- (mismo nombre puede existir una vez por obra y una vez genérico).
  IF p_obra_id IS NOT NULL THEN
    SELECT id INTO v_nuevo FROM nom_convenios
      WHERE empresa_id = v_empresa AND obra_id = p_obra_id AND nombre = v_origen.nombre;
  ELSE
    SELECT id INTO v_nuevo FROM nom_convenios
      WHERE empresa_id = v_empresa AND obra_id IS NULL AND nombre = v_origen.nombre;
  END IF;
  IF FOUND THEN
    RETURN v_nuevo;
  END IF;

  INSERT INTO nom_convenios (
    empresa_id, nombre, regimen, descripcion, obra_id,
    modalidad, corte_q1_desde, corte_q1_hasta,
    corte_q2_desde, corte_q2_hasta, corte_mensual_desde, corte_mensual_hasta
  )
  VALUES (
    v_empresa, v_origen.nombre, v_origen.regimen, v_origen.descripcion, p_obra_id,
    v_origen.modalidad, v_origen.corte_q1_desde, v_origen.corte_q1_hasta,
    v_origen.corte_q2_desde, v_origen.corte_q2_hasta,
    v_origen.corte_mensual_desde, v_origen.corte_mensual_hasta
  )
  RETURNING id INTO v_nuevo;

  -- Estructura + VALORES de escala (básicos) y no remunerativos (decisión
  -- del usuario): se copian con sus montos, no en cero.
  INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde, modalidad)
  SELECT v_nuevo, nombre, basico, vigencia_desde, modalidad
  FROM nom_categorias WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_no_remunerativos (convenio_id, categoria_nombre, monto, vigencia_desde)
  SELECT v_nuevo, categoria_nombre, monto, vigencia_desde
  FROM nom_no_remunerativos WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config, codigo_recibo)
  SELECT v_empresa, v_nuevo, codigo, nombre, tipo, formula, orden, imprimible, categorias, config, codigo_recibo
  FROM nom_conceptos WHERE convenio_id = convenio_global_id AND empresa_id IS NULL;

  INSERT INTO nom_concepto_reglas (concepto_id, orden, condicion, formula)
  SELECT nc.id, r.orden, r.condicion, r.formula
  FROM nom_conceptos viejo
  JOIN nom_concepto_reglas r ON r.concepto_id = viejo.id
  JOIN nom_conceptos nc ON nc.convenio_id = v_nuevo AND nc.empresa_id = v_empresa AND nc.codigo = viejo.codigo
  WHERE viejo.convenio_id = convenio_global_id AND viejo.empresa_id IS NULL;

  -- Re-apunta legajos: TODOS los de la empresa en ese convenio si el clon+
  -- es genérico; SOLO los de la obra si el clon es por obra.
  UPDATE nom_legajo l SET
    convenio_id = v_nuevo,
    categoria_id = (
      SELECT nueva.id FROM nom_categorias vieja
      JOIN nom_categorias nueva
        ON nueva.convenio_id = v_nuevo
       AND nueva.nombre = vieja.nombre
       AND nueva.vigencia_desde = vieja.vigencia_desde
      WHERE vieja.id = l.categoria_id
    )
  WHERE l.empresa_id = v_empresa AND l.convenio_id = convenio_global_id
    AND (
      p_obra_id IS NULL
      OR l.personal_id IN (
        SELECT personal_id FROM nom_v_personal
        WHERE empresa_id = v_empresa AND obra_id = p_obra_id
      )
    );

  RETURN v_nuevo;
END $$;
REVOKE ALL ON FUNCTION clonar_convenio(UUID, UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION clonar_convenio(UUID, UUID, UUID) TO authenticated;
