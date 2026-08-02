-- 0045_rls_superadmin_bypass_fix.sql — corrige el bypass de superadmin
-- roto por 0026.
--
-- Bug propio de 0026: escribí `empresa_id = auth_empresa_id() AND
-- has_rol_nomina(...)`. has_rol_nomina() SÍ bypassea el chequeo de ROL
-- para un superadmin (retorna true siempre), pero el `empresa_id =
-- auth_empresa_id()` de al lado NO — y para un Superadmin operando
-- "como" una empresa (empresaVista, ver src/store/authStore.js),
-- auth_empresa_id() da NULL (no tiene empresa propia). `empresa_id =
-- NULL` nunca es true, así que la condición completa fallaba SIEMPRE
-- para un superadmin, aunque has_rol_nomina() lo dejara pasar. Se
-- detectó en producción: "Quitar" en la pantalla de Usuarios tiraba
-- "permission denied" para el Superadmin.
--
-- El patrón correcto (el que ya usaba 0008_superadmin_bypass.sql antes
-- de esta migración) es envolver TODA la condición en
-- `is_superadmin() OR (...)`, no dejar que is_superadmin() solo mueva la
-- aguja de un AND interno. Se re-crean acá TODAS las policies de 0026
-- que tenían este defecto (todas menos nom_no_remunerativos, que ya
-- había quedado bien).
--
-- (Nota: para las tablas con `empresa_id IS NULL OR empresa_id =
-- auth_empresa_id()` — convenios/conceptos globales — el defecto es el
-- mismo: is_superadmin() tiene que ir aparte, con OR, al principio.)

-- ─── Grupo 1: legajo y datos personales ─────────────────────────
DROP POLICY IF EXISTS nom_legajo_select ON nom_legajo;
CREATE POLICY nom_legajo_select ON nom_legajo FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_legajo_insert ON nom_legajo;
CREATE POLICY nom_legajo_insert ON nom_legajo FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_legajo_update ON nom_legajo;
CREATE POLICY nom_legajo_update ON nom_legajo FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_legajo_delete ON nom_legajo;
CREATE POLICY nom_legajo_delete ON nom_legajo FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_familiares_select ON nom_familiares;
CREATE POLICY nom_familiares_select ON nom_familiares FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_familiares_insert ON nom_familiares;
CREATE POLICY nom_familiares_insert ON nom_familiares FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_familiares_update ON nom_familiares;
CREATE POLICY nom_familiares_update ON nom_familiares FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_familiares_delete ON nom_familiares;
CREATE POLICY nom_familiares_delete ON nom_familiares FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_sanciones_personal_select ON nom_sanciones_personal;
CREATE POLICY nom_sanciones_personal_select ON nom_sanciones_personal FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_sanciones_personal_insert ON nom_sanciones_personal;
CREATE POLICY nom_sanciones_personal_insert ON nom_sanciones_personal FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_sanciones_personal_update ON nom_sanciones_personal;
CREATE POLICY nom_sanciones_personal_update ON nom_sanciones_personal FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_sanciones_personal_delete ON nom_sanciones_personal;
CREATE POLICY nom_sanciones_personal_delete ON nom_sanciones_personal FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_legajo_adicionales_select ON nom_legajo_adicionales;
CREATE POLICY nom_legajo_adicionales_select ON nom_legajo_adicionales FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_legajo_adicionales_insert ON nom_legajo_adicionales;
CREATE POLICY nom_legajo_adicionales_insert ON nom_legajo_adicionales FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_legajo_adicionales_update ON nom_legajo_adicionales;
CREATE POLICY nom_legajo_adicionales_update ON nom_legajo_adicionales FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_legajo_adicionales_delete ON nom_legajo_adicionales;
CREATE POLICY nom_legajo_adicionales_delete ON nom_legajo_adicionales FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_documentos_requeridos_select ON nom_documentos_requeridos;
CREATE POLICY nom_documentos_requeridos_select ON nom_documentos_requeridos FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_documentos_requeridos_insert ON nom_documentos_requeridos;
CREATE POLICY nom_documentos_requeridos_insert ON nom_documentos_requeridos FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_documentos_requeridos_update ON nom_documentos_requeridos;
CREATE POLICY nom_documentos_requeridos_update ON nom_documentos_requeridos FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_documentos_requeridos_delete ON nom_documentos_requeridos;
CREATE POLICY nom_documentos_requeridos_delete ON nom_documentos_requeridos FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_documentos_legajo_select ON nom_documentos_legajo;
CREATE POLICY nom_documentos_legajo_select ON nom_documentos_legajo FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_documentos_legajo_insert ON nom_documentos_legajo;
CREATE POLICY nom_documentos_legajo_insert ON nom_documentos_legajo FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_documentos_legajo_update ON nom_documentos_legajo;
CREATE POLICY nom_documentos_legajo_update ON nom_documentos_legajo FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_documentos_legajo_delete ON nom_documentos_legajo;
CREATE POLICY nom_documentos_legajo_delete ON nom_documentos_legajo FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

-- ─── Grupo 2: configuración de convenio ──────────────────────────
DROP POLICY IF EXISTS nom_convenios_select ON nom_convenios;
CREATE POLICY nom_convenios_select ON nom_convenios FOR SELECT TO authenticated
  USING (is_superadmin() OR (
    (empresa_id IS NULL OR empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])
  ));
DROP POLICY IF EXISTS nom_convenios_insert ON nom_convenios;
CREATE POLICY nom_convenios_insert ON nom_convenios FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_convenios_update ON nom_convenios;
CREATE POLICY nom_convenios_update ON nom_convenios FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_convenios_delete ON nom_convenios;
CREATE POLICY nom_convenios_delete ON nom_convenios FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_categorias_select ON nom_categorias;
CREATE POLICY nom_categorias_select ON nom_categorias FOR SELECT TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id
            AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
    AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])
  ));
DROP POLICY IF EXISTS nom_categorias_insert ON nom_categorias;
CREATE POLICY nom_categorias_insert ON nom_categorias FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));
DROP POLICY IF EXISTS nom_categorias_update ON nom_categorias;
CREATE POLICY nom_categorias_update ON nom_categorias FOR UPDATE TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ))
  WITH CHECK (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));
DROP POLICY IF EXISTS nom_categorias_delete ON nom_categorias;
CREATE POLICY nom_categorias_delete ON nom_categorias FOR DELETE TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));

DROP POLICY IF EXISTS nom_conceptos_select ON nom_conceptos;
CREATE POLICY nom_conceptos_select ON nom_conceptos FOR SELECT TO authenticated
  USING (is_superadmin() OR (
    (empresa_id IS NULL OR empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])
  ));
DROP POLICY IF EXISTS nom_conceptos_insert ON nom_conceptos;
CREATE POLICY nom_conceptos_insert ON nom_conceptos FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_conceptos_update ON nom_conceptos;
CREATE POLICY nom_conceptos_update ON nom_conceptos FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_conceptos_delete ON nom_conceptos;
CREATE POLICY nom_conceptos_delete ON nom_conceptos FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_concepto_reglas_select ON nom_concepto_reglas;
CREATE POLICY nom_concepto_reglas_select ON nom_concepto_reglas FOR SELECT TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id
            AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
    AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])
  ));
DROP POLICY IF EXISTS nom_concepto_reglas_insert ON nom_concepto_reglas;
CREATE POLICY nom_concepto_reglas_insert ON nom_concepto_reglas FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));
DROP POLICY IF EXISTS nom_concepto_reglas_update ON nom_concepto_reglas;
CREATE POLICY nom_concepto_reglas_update ON nom_concepto_reglas FOR UPDATE TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ))
  WITH CHECK (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));
DROP POLICY IF EXISTS nom_concepto_reglas_delete ON nom_concepto_reglas;
CREATE POLICY nom_concepto_reglas_delete ON nom_concepto_reglas FOR DELETE TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));

DROP POLICY IF EXISTS nom_parametros_select ON nom_parametros;
CREATE POLICY nom_parametros_select ON nom_parametros FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])));
DROP POLICY IF EXISTS nom_parametros_insert ON nom_parametros;
CREATE POLICY nom_parametros_insert ON nom_parametros FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_parametros_update ON nom_parametros;
CREATE POLICY nom_parametros_update ON nom_parametros FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_parametros_delete ON nom_parametros;
CREATE POLICY nom_parametros_delete ON nom_parametros FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_empresa_config_select ON nom_empresa_config;
CREATE POLICY nom_empresa_config_select ON nom_empresa_config FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])));
DROP POLICY IF EXISTS nom_empresa_config_insert ON nom_empresa_config;
CREATE POLICY nom_empresa_config_insert ON nom_empresa_config FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_empresa_config_update ON nom_empresa_config;
CREATE POLICY nom_empresa_config_update ON nom_empresa_config FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_empresa_config_delete ON nom_empresa_config;
CREATE POLICY nom_empresa_config_delete ON nom_empresa_config FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

-- ─── Grupo 3: períodos y liquidaciones ───────────────────────────
DROP POLICY IF EXISTS nom_periodos_select ON nom_periodos;
CREATE POLICY nom_periodos_select ON nom_periodos FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_periodos_insert ON nom_periodos;
CREATE POLICY nom_periodos_insert ON nom_periodos FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_periodos_update ON nom_periodos;
CREATE POLICY nom_periodos_update ON nom_periodos FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_periodos_delete ON nom_periodos;
CREATE POLICY nom_periodos_delete ON nom_periodos FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_liquidaciones_select ON nom_liquidaciones;
CREATE POLICY nom_liquidaciones_select ON nom_liquidaciones FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_liquidaciones_insert ON nom_liquidaciones;
CREATE POLICY nom_liquidaciones_insert ON nom_liquidaciones FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_liquidaciones_update ON nom_liquidaciones;
CREATE POLICY nom_liquidaciones_update ON nom_liquidaciones FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_liquidaciones_delete ON nom_liquidaciones;
CREATE POLICY nom_liquidaciones_delete ON nom_liquidaciones FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_liquidacion_items_select ON nom_liquidacion_items;
CREATE POLICY nom_liquidacion_items_select ON nom_liquidacion_items FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_liquidacion_items_insert ON nom_liquidacion_items;
CREATE POLICY nom_liquidacion_items_insert ON nom_liquidacion_items FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_liquidacion_items_update ON nom_liquidacion_items;
CREATE POLICY nom_liquidacion_items_update ON nom_liquidacion_items FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_liquidacion_items_delete ON nom_liquidacion_items;
CREATE POLICY nom_liquidacion_items_delete ON nom_liquidacion_items FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_pagos_adelantos_select ON nom_pagos_adelantos;
CREATE POLICY nom_pagos_adelantos_select ON nom_pagos_adelantos FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_pagos_adelantos_insert ON nom_pagos_adelantos;
CREATE POLICY nom_pagos_adelantos_insert ON nom_pagos_adelantos FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_pagos_adelantos_update ON nom_pagos_adelantos;
CREATE POLICY nom_pagos_adelantos_update ON nom_pagos_adelantos FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_pagos_adelantos_delete ON nom_pagos_adelantos;
CREATE POLICY nom_pagos_adelantos_delete ON nom_pagos_adelantos FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_vacaciones_liquidadas_select ON nom_vacaciones_liquidadas;
CREATE POLICY nom_vacaciones_liquidadas_select ON nom_vacaciones_liquidadas FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
DROP POLICY IF EXISTS nom_vacaciones_liquidadas_insert ON nom_vacaciones_liquidadas;
CREATE POLICY nom_vacaciones_liquidadas_insert ON nom_vacaciones_liquidadas FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_vacaciones_liquidadas_update ON nom_vacaciones_liquidadas;
CREATE POLICY nom_vacaciones_liquidadas_update ON nom_vacaciones_liquidadas FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_vacaciones_liquidadas_delete ON nom_vacaciones_liquidadas;
CREATE POLICY nom_vacaciones_liquidadas_delete ON nom_vacaciones_liquidadas FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

-- ─── Grupo 4: flujo de aprobación ─────────────────────────────────
DROP POLICY IF EXISTS nom_flujos_select ON nom_flujos;
CREATE POLICY nom_flujos_select ON nom_flujos FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_flujos_insert ON nom_flujos;
CREATE POLICY nom_flujos_insert ON nom_flujos FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin'])));
DROP POLICY IF EXISTS nom_flujos_update ON nom_flujos;
CREATE POLICY nom_flujos_update ON nom_flujos FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin'])));
DROP POLICY IF EXISTS nom_flujos_delete ON nom_flujos;
CREATE POLICY nom_flujos_delete ON nom_flujos FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin'])));

DROP POLICY IF EXISTS nom_flujo_pasos_select ON nom_flujo_pasos;
CREATE POLICY nom_flujo_pasos_select ON nom_flujo_pasos FOR SELECT TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));
DROP POLICY IF EXISTS nom_flujo_pasos_insert ON nom_flujo_pasos;
CREATE POLICY nom_flujo_pasos_insert ON nom_flujo_pasos FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin'])
  ));
DROP POLICY IF EXISTS nom_flujo_pasos_update ON nom_flujo_pasos;
CREATE POLICY nom_flujo_pasos_update ON nom_flujo_pasos FOR UPDATE TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin'])
  ))
  WITH CHECK (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin'])
  ));
DROP POLICY IF EXISTS nom_flujo_pasos_delete ON nom_flujo_pasos;
CREATE POLICY nom_flujo_pasos_delete ON nom_flujo_pasos FOR DELETE TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin'])
  ));

-- ─── Grupo 5: nom_usuarios_empresas ───────────────────────────────
DROP POLICY IF EXISTS nom_usuarios_empresas_select ON nom_usuarios_empresas;
CREATE POLICY nom_usuarios_empresas_select ON nom_usuarios_empresas FOR SELECT TO authenticated
  USING (
    is_superadmin()
    OR usuario_id = auth.uid()
    OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']))
  );
DROP POLICY IF EXISTS nom_usuarios_empresas_insert ON nom_usuarios_empresas;
CREATE POLICY nom_usuarios_empresas_insert ON nom_usuarios_empresas FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin'])));
DROP POLICY IF EXISTS nom_usuarios_empresas_update ON nom_usuarios_empresas;
CREATE POLICY nom_usuarios_empresas_update ON nom_usuarios_empresas FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin'])));
DROP POLICY IF EXISTS nom_usuarios_empresas_delete ON nom_usuarios_empresas;
CREATE POLICY nom_usuarios_empresas_delete ON nom_usuarios_empresas FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin'])));

-- ─── Grupo 6: regiones ─────────────────────────────────────────────
DROP POLICY IF EXISTS nom_regiones_select ON nom_regiones;
CREATE POLICY nom_regiones_select ON nom_regiones FOR SELECT TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','supervisor'])));
DROP POLICY IF EXISTS nom_regiones_insert ON nom_regiones;
CREATE POLICY nom_regiones_insert ON nom_regiones FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_regiones_update ON nom_regiones;
CREATE POLICY nom_regiones_update ON nom_regiones FOR UPDATE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
  WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
DROP POLICY IF EXISTS nom_regiones_delete ON nom_regiones;
CREATE POLICY nom_regiones_delete ON nom_regiones FOR DELETE TO authenticated
  USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));

DROP POLICY IF EXISTS nom_regiones_obras_select ON nom_regiones_obras;
CREATE POLICY nom_regiones_obras_select ON nom_regiones_obras FOR SELECT TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh','supervisor'])
  ));
DROP POLICY IF EXISTS nom_regiones_obras_insert ON nom_regiones_obras;
CREATE POLICY nom_regiones_obras_insert ON nom_regiones_obras FOR INSERT TO authenticated
  WITH CHECK (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));
DROP POLICY IF EXISTS nom_regiones_obras_update ON nom_regiones_obras;
CREATE POLICY nom_regiones_obras_update ON nom_regiones_obras FOR UPDATE TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ))
  WITH CHECK (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));
DROP POLICY IF EXISTS nom_regiones_obras_delete ON nom_regiones_obras;
CREATE POLICY nom_regiones_obras_delete ON nom_regiones_obras FOR DELETE TO authenticated
  USING (is_superadmin() OR (
    EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  ));
