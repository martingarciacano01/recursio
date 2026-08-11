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