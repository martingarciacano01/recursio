-- 0038_clonar_convenio_cortes.sql
--
-- BUG QUE ARREGLA
-- ───────────────
-- clonar_convenio() copia el convenio origen con:
--     INSERT INTO nom_convenios (empresa_id, nombre, regimen, descripcion)
-- y nada más. La migración 0035 agregó DESPUÉS siete columnas a esa tabla
-- —`modalidad` y los seis cortes de quincena/mes— pero no actualizó la
-- función. Así que "Personalizar convenio" pierde en silencio:
--
--   modalidad             → vuelve a 'quincenal' (DEFAULT de 0035)
--   corte_q1_desde/hasta  → vuelven a 1 / 15
--   corte_q2_desde/hasta  → vuelven a 16 / NULL
--   corte_mensual_*       → vuelven a 1 / NULL
--
-- Un convenio mensual con cortes del 26 al 25 clonado a una empresa quedaba
-- quincenal del 1 al 15, y los períodos se generaban con fechas equivocadas
-- sin ninguna advertencia.
--
-- Es el mismo descuido que 0031 (sección 3) corrigió para
-- nom_categorias.modalidad, no repetido para las columnas que trajo 0035.
--
-- El resto del cuerpo es idéntico a la versión de 0031: solo cambia el
-- INSERT sobre nom_convenios.

CREATE OR REPLACE FUNCTION clonar_convenio(convenio_global_id UUID, p_empresa_id UUID DEFAULT NULL)
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

  SELECT id INTO v_nuevo FROM nom_convenios WHERE empresa_id = v_empresa AND nombre = v_origen.nombre;
  IF FOUND THEN
    RETURN v_nuevo;
  END IF;

  -- ⬇ ACÁ ESTÁ EL FIX: se copian modalidad y los seis cortes.
  INSERT INTO nom_convenios (
    empresa_id, nombre, regimen, descripcion,
    modalidad, corte_q1_desde, corte_q1_hasta,
    corte_q2_desde, corte_q2_hasta, corte_mensual_desde, corte_mensual_hasta
  )
  VALUES (
    v_empresa, v_origen.nombre, v_origen.regimen, v_origen.descripcion,
    v_origen.modalidad, v_origen.corte_q1_desde, v_origen.corte_q1_hasta,
    v_origen.corte_q2_desde, v_origen.corte_q2_hasta,
    v_origen.corte_mensual_desde, v_origen.corte_mensual_hasta
  )
  RETURNING id INTO v_nuevo;

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
  WHERE l.empresa_id = v_empresa AND l.convenio_id = convenio_global_id;

  RETURN v_nuevo;
END $$;
REVOKE ALL ON FUNCTION clonar_convenio(UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION clonar_convenio(UUID, UUID) TO authenticated;
