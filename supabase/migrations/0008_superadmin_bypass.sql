-- 0008_superadmin_bypass.sql
--
-- Arreglo de fondo que había quedado deliberadamente diferido (Fase 1,
-- decisión del usuario: "lo dejamos para después"): las tablas nom_*
-- nunca tuvieron el mismo bypass de superadmin que ya tienen las tablas
-- propias de Presencio (`is_superadmin() OR empresa_id = auth_empresa_id()`,
-- ver fichaobra/supabase/migrations/000_05_superadmin.sql). Un usuario
-- Superadmin no tiene empresa_id propio (auth_empresa_id() da NULL para
-- él), así que CUALQUIER INSERT/UPDATE/DELETE sobre nom_* fallaba con
-- "new row violates row-level security policy" en cuanto Recursio empezó
-- a usarse de verdad con un superadmin operando "como" una empresa
-- (empresaVista, ver src/store/authStore.js).
--
-- La función is_superadmin() ya existe en este mismo proyecto de Supabase
-- (creada por Presencio en 000_05_superadmin.sql) y valida el rol contra
-- el JWT firmado del lado del servidor, así que reutilizarla acá es
-- seguro y consistente con el resto del sistema.

-- ─── nom_legajo ─────────────────────────────────────────────────
DROP POLICY IF EXISTS nom_legajo_all ON nom_legajo;
CREATE POLICY nom_legajo_all ON nom_legajo FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

-- ─── nom_convenios ──────────────────────────────────────────────
DROP POLICY IF EXISTS nom_convenios_select ON nom_convenios;
CREATE POLICY nom_convenios_select ON nom_convenios FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id IS NULL OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_convenios_write ON nom_convenios;
CREATE POLICY nom_convenios_write ON nom_convenios FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_convenios_update ON nom_convenios;
CREATE POLICY nom_convenios_update ON nom_convenios FOR UPDATE TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_convenios_delete ON nom_convenios;
CREATE POLICY nom_convenios_delete ON nom_convenios FOR DELETE TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());

-- ─── nom_categorias (aislamiento heredado vía join con nom_convenios) ──
DROP POLICY IF EXISTS nom_categorias_all ON nom_categorias;
CREATE POLICY nom_categorias_all ON nom_categorias FOR ALL TO authenticated
  USING (
    is_superadmin() OR EXISTS (
      SELECT 1 FROM nom_convenios c
      WHERE c.id = nom_categorias.convenio_id
        AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id())
    )
  )
  WITH CHECK (
    is_superadmin() OR EXISTS (
      SELECT 1 FROM nom_convenios c
      WHERE c.id = nom_categorias.convenio_id
        AND c.empresa_id = auth_empresa_id()
    )
  );

-- ─── nom_parametros ─────────────────────────────────────────────
DROP POLICY IF EXISTS nom_parametros_all ON nom_parametros;
CREATE POLICY nom_parametros_all ON nom_parametros FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

-- ─── nom_familiares ─────────────────────────────────────────────
DROP POLICY IF EXISTS nom_familiares_all ON nom_familiares;
CREATE POLICY nom_familiares_all ON nom_familiares FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

-- ─── nom_sanciones_personal ─────────────────────────────────────
DROP POLICY IF EXISTS nom_sanciones_personal_all ON nom_sanciones_personal;
CREATE POLICY nom_sanciones_personal_all ON nom_sanciones_personal FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

-- ─── nom_conceptos ──────────────────────────────────────────────
DROP POLICY IF EXISTS nom_conceptos_select ON nom_conceptos;
CREATE POLICY nom_conceptos_select ON nom_conceptos FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id IS NULL OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_conceptos_write ON nom_conceptos;
CREATE POLICY nom_conceptos_write ON nom_conceptos FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_conceptos_update ON nom_conceptos;
CREATE POLICY nom_conceptos_update ON nom_conceptos FOR UPDATE TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_conceptos_delete ON nom_conceptos;
CREATE POLICY nom_conceptos_delete ON nom_conceptos FOR DELETE TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());

-- ─── nom_concepto_reglas (aislamiento heredado vía join con nom_conceptos) ──
DROP POLICY IF EXISTS nom_concepto_reglas_all ON nom_concepto_reglas;
CREATE POLICY nom_concepto_reglas_all ON nom_concepto_reglas FOR ALL TO authenticated
  USING (
    is_superadmin() OR EXISTS (
      SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id
        AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id())
    )
  )
  WITH CHECK (
    is_superadmin() OR EXISTS (
      SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id
        AND c.empresa_id = auth_empresa_id()
    )
  );

-- ─── nom_periodos ───────────────────────────────────────────────
DROP POLICY IF EXISTS nom_periodos_all ON nom_periodos;
CREATE POLICY nom_periodos_all ON nom_periodos FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

-- ─── nom_liquidaciones ──────────────────────────────────────────
DROP POLICY IF EXISTS nom_liquidaciones_all ON nom_liquidaciones;
CREATE POLICY nom_liquidaciones_all ON nom_liquidaciones FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

-- ─── nom_liquidacion_items ──────────────────────────────────────
DROP POLICY IF EXISTS nom_liquidacion_items_all ON nom_liquidacion_items;
CREATE POLICY nom_liquidacion_items_all ON nom_liquidacion_items FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

-- ─── nom_pagos_adelantos ────────────────────────────────────────
DROP POLICY IF EXISTS nom_pagos_adelantos_all ON nom_pagos_adelantos;
CREATE POLICY nom_pagos_adelantos_all ON nom_pagos_adelantos FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

-- NOTA IMPORTANTE para el cliente (front-end): este bypass hace que un
-- Superadmin vea/pueda escribir filas de TODAS las empresas si no filtra
-- explícitamente por empresa_id en sus queries (a diferencia de un usuario
-- normal, para quien la RLS ya hace ese filtro solo). Por eso, toda
-- pantalla que arma queries a mano (no a través de una vista con filtro
-- fijo) DEBE agregar `.eq('empresa_id', empresaId)` cuando hay una
-- empresaVista activa. Ver commit que acompaña esta migración para el
-- ajuste correspondiente en LegajosPage/FichaLegajoPage/DashboardPage.
