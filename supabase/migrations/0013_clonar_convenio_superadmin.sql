-- 0013_clonar_convenio_superadmin.sql
--
-- Fix: "Personalizar convenio" fallaba con "usuario sin empresa asignada"
-- para un Superadmin operando "como" una empresa (empresaVista, ver
-- src/store/authStore.js) porque auth_empresa_id() sólo devuelve la
-- empresa PROPIA del usuario autenticado — un Superadmin no tiene una, así
-- que siempre le daba NULL, sin importar qué empresaVista hubiera elegido
-- en el cliente (mismo patrón de bug que 0008_superadmin_bypass.sql, pero
-- ahí se resolvió a nivel de política RLS; clonar_convenio es una función
-- con lógica propia, no una tabla filtrada por RLS, así que necesita el
-- empresa_id como parámetro explícito).
--
-- Se agrega p_empresa_id (opcional, sólo lo usa un Superadmin sin empresa
-- propia; is_superadmin() ya existe en el proyecto, ver 000_05_superadmin.sql).

-- Se reemplaza la función anterior de un solo parámetro por la de dos
-- (incompatible: DROP explícito, no basta con CREATE OR REPLACE porque
-- cambia la firma).
DROP FUNCTION IF EXISTS clonar_convenio(UUID);

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

  INSERT INTO nom_convenios (empresa_id, nombre, regimen, descripcion)
  VALUES (v_empresa, v_origen.nombre, v_origen.regimen, v_origen.descripcion)
  RETURNING id INTO v_nuevo;

  INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde)
  SELECT v_nuevo, nombre, basico, vigencia_desde
  FROM nom_categorias WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_no_remunerativos (convenio_id, categoria_nombre, monto, vigencia_desde)
  SELECT v_nuevo, categoria_nombre, monto, vigencia_desde
  FROM nom_no_remunerativos WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config)
  SELECT v_empresa, v_nuevo, codigo, nombre, tipo, formula, orden, imprimible, categorias, config
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
