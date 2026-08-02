-- 0026_rls_roles.sql — RLS por rol (Fase 5H/Fase 1 de seguridad)
--
-- Cierra la deuda de la Fase 5G: hasta esta migración, 27 policies
-- `FOR ALL` (inventario abajo) le daban a CUALQUIER usuario autenticado
-- de la empresa lectura Y escritura sobre casi todo `nom_*`. Esta
-- migración las reemplaza por SELECT amplio (según rol) + escritura
-- restringida a roles concretos, usando has_rol_nomina() (0025) como
-- único punto de verdad — nunca se resuelve el rol desde metadata del
-- cliente.
--
-- Inventario de `FOR ALL` reemplazadas (grep -rn "FOR ALL" supabase/migrations/*.sql,
-- 2026-08-01, quedándose con la versión vigente de cada policy — varias
-- fueron creadas en una migración y luego re-creadas en 0008 con el mismo
-- nombre, así que la de 0008 es la que hoy manda):
--   nom_legajo_all (0008), nom_categorias_all (0008), nom_parametros_all (0008),
--   nom_familiares_all (0008), nom_sanciones_personal_all (0008),
--   nom_concepto_reglas_all (0008), nom_periodos_all (0008),
--   nom_liquidaciones_all (0008), nom_liquidacion_items_all (0008),
--   nom_pagos_adelantos_all (0008), nom_no_remunerativos_all (0012),
--   nom_usuarios_empresas_write (0014), nom_flujos_all (0014),
--   nom_flujo_pasos_all (0014), nom_empresa_config_rw (0021),
--   nom_documentos_requeridos_rw (0032), nom_documentos_legajo_rw (0032),
--   nom_vacaciones_liquidadas_rw (0034), nom_legajo_adicionales_all (0040).
-- (nom_convenios_write/update/delete y nom_conceptos_write/update/delete de
-- 0008 ya eran políticas separadas por comando, no `FOR ALL`, pero
-- tampoco distinguían rol — se les agrega el chequeo acá igual.
-- nom_documentos_storage_rw (0032, storage.objects) NO se toca en esta
-- migración: es la Task 1.3, migración 0043 aparte.
-- nom_aprobaciones y nom_flujo_instancias (0014) ya estaban bien: SELECT
-- acotado a participantes y el INSERT/UPDATE real pasa por RPC — no
-- llevan cambios acá.
-- nom_regiones/nom_regiones_obras (0025) eran `FOR ALL` pero de bajo
-- riesgo (solo agrupan obras para el alcance de supervisor); se les
-- agrega igual el gating admin/rrhh por consistencia.)

-- ═══════════════════════════════════════════════════════════════
-- Grupo 1: legajo y datos personales sensibles
--   SELECT: admin, rrhh, consulta, supervisor · escritura: admin, rrhh
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS nom_legajo_all ON nom_legajo;
CREATE POLICY nom_legajo_select ON nom_legajo FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_legajo_insert ON nom_legajo FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_legajo_update ON nom_legajo FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_legajo_delete ON nom_legajo FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_familiares_all ON nom_familiares;
CREATE POLICY nom_familiares_select ON nom_familiares FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_familiares_insert ON nom_familiares FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_familiares_update ON nom_familiares FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_familiares_delete ON nom_familiares FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_sanciones_personal_all ON nom_sanciones_personal;
CREATE POLICY nom_sanciones_personal_select ON nom_sanciones_personal FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_sanciones_personal_insert ON nom_sanciones_personal FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_sanciones_personal_update ON nom_sanciones_personal FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_sanciones_personal_delete ON nom_sanciones_personal FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_legajo_adicionales_all ON nom_legajo_adicionales;
CREATE POLICY nom_legajo_adicionales_select ON nom_legajo_adicionales FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_legajo_adicionales_insert ON nom_legajo_adicionales FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_legajo_adicionales_update ON nom_legajo_adicionales FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_legajo_adicionales_delete ON nom_legajo_adicionales FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_documentos_requeridos_rw ON nom_documentos_requeridos;
CREATE POLICY nom_documentos_requeridos_select ON nom_documentos_requeridos FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_documentos_requeridos_insert ON nom_documentos_requeridos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_documentos_requeridos_update ON nom_documentos_requeridos FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_documentos_requeridos_delete ON nom_documentos_requeridos FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_documentos_legajo_rw ON nom_documentos_legajo;
CREATE POLICY nom_documentos_legajo_select ON nom_documentos_legajo FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_documentos_legajo_insert ON nom_documentos_legajo FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_documentos_legajo_update ON nom_documentos_legajo FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_documentos_legajo_delete ON nom_documentos_legajo FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

-- ═══════════════════════════════════════════════════════════════
-- Grupo 2: configuración de convenio (escalas, conceptos, parámetros)
--   SELECT: todos los roles internos · escritura: admin, rrhh
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS nom_convenios_select ON nom_convenios;
CREATE POLICY nom_convenios_select ON nom_convenios FOR SELECT TO authenticated
  USING (
    (empresa_id IS NULL OR empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])
  );
DROP POLICY IF EXISTS nom_convenios_write ON nom_convenios;
CREATE POLICY nom_convenios_insert ON nom_convenios FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
DROP POLICY IF EXISTS nom_convenios_update ON nom_convenios;
CREATE POLICY nom_convenios_update ON nom_convenios FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
DROP POLICY IF EXISTS nom_convenios_delete ON nom_convenios;
CREATE POLICY nom_convenios_delete ON nom_convenios FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_categorias_all ON nom_categorias;
CREATE POLICY nom_categorias_select ON nom_categorias FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id
            AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
    AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])
  );
CREATE POLICY nom_categorias_insert ON nom_categorias FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  );
CREATE POLICY nom_categorias_update ON nom_categorias FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  );
CREATE POLICY nom_categorias_delete ON nom_categorias FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_categorias.convenio_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  );

DROP POLICY IF EXISTS nom_conceptos_select ON nom_conceptos;
CREATE POLICY nom_conceptos_select ON nom_conceptos FOR SELECT TO authenticated
  USING (
    (empresa_id IS NULL OR empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])
  );
DROP POLICY IF EXISTS nom_conceptos_write ON nom_conceptos;
CREATE POLICY nom_conceptos_insert ON nom_conceptos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
DROP POLICY IF EXISTS nom_conceptos_update ON nom_conceptos;
CREATE POLICY nom_conceptos_update ON nom_conceptos FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
DROP POLICY IF EXISTS nom_conceptos_delete ON nom_conceptos;
CREATE POLICY nom_conceptos_delete ON nom_conceptos FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_concepto_reglas_all ON nom_concepto_reglas;
CREATE POLICY nom_concepto_reglas_select ON nom_concepto_reglas FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id
            AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
    AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])
  );
CREATE POLICY nom_concepto_reglas_insert ON nom_concepto_reglas FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  );
CREATE POLICY nom_concepto_reglas_update ON nom_concepto_reglas FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  );
CREATE POLICY nom_concepto_reglas_delete ON nom_concepto_reglas FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id AND c.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  );

DROP POLICY IF EXISTS nom_parametros_all ON nom_parametros;
CREATE POLICY nom_parametros_select ON nom_parametros FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos']));
CREATE POLICY nom_parametros_insert ON nom_parametros FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_parametros_update ON nom_parametros FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_parametros_delete ON nom_parametros FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

-- nom_no_remunerativos: hallazgo del master plan (Step 5) — a esta tabla
-- le faltaba is_superadmin() en su policy de 0012 (no lo tenía ni siquiera
-- en la versión FOR ALL vieja). Se agrega acá de una vez con el resto del
-- gating por rol.
DROP POLICY IF EXISTS nom_no_remunerativos_all ON nom_no_remunerativos;
CREATE POLICY nom_no_remunerativos_select ON nom_no_remunerativos FOR SELECT TO authenticated
  USING (
    is_superadmin() OR (
      EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_no_remunerativos.convenio_id
              AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
      AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos'])
    )
  );
CREATE POLICY nom_no_remunerativos_insert ON nom_no_remunerativos FOR INSERT TO authenticated
  WITH CHECK (
    is_superadmin() OR (
      EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_no_remunerativos.convenio_id AND c.empresa_id = auth_empresa_id())
      AND has_rol_nomina(ARRAY['admin','rrhh'])
    )
  );
CREATE POLICY nom_no_remunerativos_update ON nom_no_remunerativos FOR UPDATE TO authenticated
  USING (
    is_superadmin() OR (
      EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_no_remunerativos.convenio_id AND c.empresa_id = auth_empresa_id())
      AND has_rol_nomina(ARRAY['admin','rrhh'])
    )
  )
  WITH CHECK (
    is_superadmin() OR (
      EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_no_remunerativos.convenio_id AND c.empresa_id = auth_empresa_id())
      AND has_rol_nomina(ARRAY['admin','rrhh'])
    )
  );
CREATE POLICY nom_no_remunerativos_delete ON nom_no_remunerativos FOR DELETE TO authenticated
  USING (
    is_superadmin() OR (
      EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_no_remunerativos.convenio_id AND c.empresa_id = auth_empresa_id())
      AND has_rol_nomina(ARRAY['admin','rrhh'])
    )
  );

DROP POLICY IF EXISTS nom_empresa_config_rw ON nom_empresa_config;
CREATE POLICY nom_empresa_config_select ON nom_empresa_config FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos']));
CREATE POLICY nom_empresa_config_insert ON nom_empresa_config FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_empresa_config_update ON nom_empresa_config FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_empresa_config_delete ON nom_empresa_config FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

-- ═══════════════════════════════════════════════════════════════
-- Grupo 3: períodos y liquidaciones (datos salariales)
--   SELECT: admin, rrhh, consulta, supervisor · escritura: admin, rrhh
--   (el filtrado fino de revisor_externo por paso de flujo ya lo resuelve
--   nom_flujo_instancias/nom_aprobaciones, que no se tocan acá; un
--   revisor ve el período a través de esas tablas, no necesita SELECT
--   directo sobre nom_periodos con datos de sueldos).
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS nom_periodos_all ON nom_periodos;
CREATE POLICY nom_periodos_select ON nom_periodos FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_periodos_insert ON nom_periodos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_periodos_update ON nom_periodos FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_periodos_delete ON nom_periodos FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_liquidaciones_all ON nom_liquidaciones;
CREATE POLICY nom_liquidaciones_select ON nom_liquidaciones FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_liquidaciones_insert ON nom_liquidaciones FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_liquidaciones_update ON nom_liquidaciones FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_liquidaciones_delete ON nom_liquidaciones FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_liquidacion_items_all ON nom_liquidacion_items;
CREATE POLICY nom_liquidacion_items_select ON nom_liquidacion_items FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_liquidacion_items_insert ON nom_liquidacion_items FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_liquidacion_items_update ON nom_liquidacion_items FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_liquidacion_items_delete ON nom_liquidacion_items FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

-- No está en la matriz del plan pero es el mismo tipo de dato sensible
-- (adelantos monetarios por persona): mismo criterio que legajo/periodos.
DROP POLICY IF EXISTS nom_pagos_adelantos_all ON nom_pagos_adelantos;
CREATE POLICY nom_pagos_adelantos_select ON nom_pagos_adelantos FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_pagos_adelantos_insert ON nom_pagos_adelantos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_pagos_adelantos_update ON nom_pagos_adelantos FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_pagos_adelantos_delete ON nom_pagos_adelantos FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_vacaciones_liquidadas_rw ON nom_vacaciones_liquidadas;
CREATE POLICY nom_vacaciones_liquidadas_select ON nom_vacaciones_liquidadas FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor']));
CREATE POLICY nom_vacaciones_liquidadas_insert ON nom_vacaciones_liquidadas FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_vacaciones_liquidadas_update ON nom_vacaciones_liquidadas FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_vacaciones_liquidadas_delete ON nom_vacaciones_liquidadas FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

-- ═══════════════════════════════════════════════════════════════
-- Grupo 4: flujo de aprobación (definición del circuito)
--   SELECT: admin, rrhh · escritura: admin
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS nom_flujos_all ON nom_flujos;
CREATE POLICY nom_flujos_select ON nom_flujos FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_flujos_insert ON nom_flujos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']));
CREATE POLICY nom_flujos_update ON nom_flujos FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']));
CREATE POLICY nom_flujos_delete ON nom_flujos FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']));

DROP POLICY IF EXISTS nom_flujo_pasos_all ON nom_flujo_pasos;
CREATE POLICY nom_flujo_pasos_select ON nom_flujo_pasos FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin','rrhh'])
  );
CREATE POLICY nom_flujo_pasos_insert ON nom_flujo_pasos FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin'])
  );
CREATE POLICY nom_flujo_pasos_update ON nom_flujo_pasos FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin'])
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin'])
  );
CREATE POLICY nom_flujo_pasos_delete ON nom_flujo_pasos FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_flujos f WHERE f.id = nom_flujo_pasos.flujo_id AND f.empresa_id = auth_empresa_id())
    AND has_rol_nomina(ARRAY['admin'])
  );

-- ═══════════════════════════════════════════════════════════════
-- Grupo 5: nom_usuarios_empresas (gestión de accesos)
--   SELECT: admin de la empresa, o la propia fila (para que un usuario
--   pueda ver su propio vínculo sin ser admin) · escritura: admin.
--   (Antes cualquier miembro de la empresa podía insertar/actualizar/
--   borrar vínculos de rol de CUALQUIER otro usuario — el agujero más
--   directo de escalada de privilegios de toda la deuda de la Fase 5G.)
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS nom_usuarios_empresas_select ON nom_usuarios_empresas;
CREATE POLICY nom_usuarios_empresas_select ON nom_usuarios_empresas FOR SELECT TO authenticated
  USING (
    usuario_id = auth.uid()
    OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']))
  );
DROP POLICY IF EXISTS nom_usuarios_empresas_write ON nom_usuarios_empresas;
CREATE POLICY nom_usuarios_empresas_insert ON nom_usuarios_empresas FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']));
CREATE POLICY nom_usuarios_empresas_update ON nom_usuarios_empresas FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']));
CREATE POLICY nom_usuarios_empresas_delete ON nom_usuarios_empresas FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']));

-- ═══════════════════════════════════════════════════════════════
-- Grupo 6: regiones (alcance de supervisor) — bajo riesgo, mismo gating
-- por consistencia con el resto (config administrativa, admin/rrhh).
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS nom_regiones_all ON nom_regiones;
CREATE POLICY nom_regiones_select ON nom_regiones FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','supervisor']));
CREATE POLICY nom_regiones_insert ON nom_regiones FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_regiones_update ON nom_regiones FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_regiones_delete ON nom_regiones FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

DROP POLICY IF EXISTS nom_regiones_obras_all ON nom_regiones_obras;
CREATE POLICY nom_regiones_obras_select ON nom_regiones_obras FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
         AND has_rol_nomina(ARRAY['admin','rrhh','supervisor']));
CREATE POLICY nom_regiones_obras_insert ON nom_regiones_obras FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
              AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_regiones_obras_update ON nom_regiones_obras FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
         AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
              AND has_rol_nomina(ARRAY['admin','rrhh']));
CREATE POLICY nom_regiones_obras_delete ON nom_regiones_obras FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id())
         AND has_rol_nomina(ARRAY['admin','rrhh']));

-- ═══════════════════════════════════════════════════════════════
-- Endurecimiento menor (Step 5 del plan): quincena_pareja() sin GRANT
-- explícito quedaba ejecutable por `public` (el default de Postgres para
-- toda función nueva), más amplio que el resto de las RPC del repo.
-- ═══════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION quincena_pareja(UUID) FROM public;
GRANT EXECUTE ON FUNCTION quincena_pareja(UUID) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- Red de seguridad: sin esto, en cuanto se aplique esta migración,
-- CUALQUIER usuario sin fila en nom_usuarios_empresas queda afuera de su
-- propia app (has_rol_nomina devuelve false para todos). Se comprobó
-- (2026-08-01, consulta directa) que HOY nom_usuarios_empresas está
-- vacía: nadie tiene ningún rol cargado todavía — el acceso actual
-- funciona solo por `empresa_id = auth_empresa_id()` sin distinción de
-- rol. `empresas` no tiene columna `owner_id` (es tabla de Presencio, no
-- de Nómina), así que no hay forma de derivar automáticamente "quién es
-- el dueño" — se le pregunta al usuario (Martín) y se hardcodea acá su
-- alta como admin de su empresa de prueba (Asset Construcciones),
-- confirmado por consulta directa a auth.users/empresas el mismo día.
-- Es un INSERT idempotente (WHERE NOT EXISTS): no pisa nada si ya existe.
INSERT INTO nom_usuarios_empresas (usuario_id, empresa_id, rol, alcance_tipo)
SELECT '309cc2f6-19f5-4a5a-bf60-f5373deb6cab', '8007e464-efe2-4929-a977-f8aade8ee450', 'admin', 'empresa'
WHERE NOT EXISTS (
  SELECT 1 FROM nom_usuarios_empresas
  WHERE usuario_id = '309cc2f6-19f5-4a5a-bf60-f5373deb6cab'
    AND empresa_id = '8007e464-efe2-4929-a977-f8aade8ee450'
);

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (si algo se rompe tras aplicar esta migración): recrear las
-- policies `FOR ALL` viejas equivalentes a 0008/0012/0014/0021/0025/
-- 0032/0034/0040 tal como estaban antes de esta migración — el bypass de
-- superadmin (is_superadmin() OR empresa_id = auth_empresa_id()) sigue
-- intacto en las tablas que ya lo tenían, así que el rollback mínimo es
-- dropear las policies *_select/_insert/_update/_delete de arriba y
-- volver a correr el bloque original de 0008_superadmin_bypass.sql (para
-- nom_legajo, nom_categorias, nom_parametros, nom_familiares,
-- nom_sanciones_personal, nom_conceptos, nom_concepto_reglas,
-- nom_periodos, nom_liquidaciones, nom_liquidacion_items,
-- nom_pagos_adelantos) + las policies FOR ALL originales de 0012, 0014,
-- 0021, 0025, 0032, 0034 y 0040 (ver esos archivos). El INSERT de la red
-- de seguridad no hace falta revertirlo: dejar a Martín como admin de su
-- empresa no es un problema de seguridad.
