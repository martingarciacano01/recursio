-- 0029_seed_recibo_grupos.sql
-- Agrupación de recibo (grupo/detalle) + config sobre conceptos existentes, y
-- alta de las contribuciones patronales del modelo AR. Idempotente. Anclado al
-- convenio/empresa del concepto 'basico' (no hardcodea UUIDs). Valores del
-- modelo: SIPA 10,77 %, INSSJP 1,59 %, Asig. Fam. 4,70 %, FNE 0,94 %, Obra
-- social 6 %, ART variable 3 %, OSECAC/INACAP/SCVO nominales.

DO $$
DECLARE
  v_convenio UUID;
  v_empresa  UUID;
BEGIN
  SELECT convenio_id, empresa_id INTO v_convenio, v_empresa
    FROM nom_conceptos WHERE codigo = 'basico' ORDER BY created_at LIMIT 1;
  IF v_convenio IS NULL THEN
    RAISE NOTICE 'no se encontró el concepto "basico"; revisar seed de conceptos'; RETURN;
  END IF;

  -- 1) Descuentos del trabajador: fijar config (para que el motor calcule
  --    unidad/base) + formula consistente + agrupación de recibo.
  UPDATE nom_conceptos SET
      formula = 'min(remunerativo_acumulado, tope_sipa) * 0.11',
      config = '{"modo":"porcentaje","porcentaje":11,"base":"remunerativo","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"seguridad_social"}}'::jsonb
    WHERE codigo = 'jubilacion' AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  UPDATE nom_conceptos SET
      formula = 'min(remunerativo_acumulado, tope_sipa) * 0.03',
      config = '{"modo":"porcentaje","porcentaje":3,"base":"remunerativo","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"inssjp"}}'::jsonb
    WHERE codigo = 'ley_19032' AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  UPDATE nom_conceptos SET
      formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03',
      config = '{"modo":"porcentaje","porcentaje":3,"base":"ambos","tope":null,"recibo":{"grupo":"descuento","detalle":"obra_social"}}'::jsonb
    WHERE codigo = 'obra_social' AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  UPDATE nom_conceptos SET
      formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.02',
      config = '{"modo":"porcentaje","porcentaje":2,"base":"ambos","tope":null,"recibo":{"grupo":"descuento","detalle":"sindical"}}'::jsonb
    WHERE codigo = 'retencion_sindical' AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  -- 2) Remunerativos: solo agregar la agrupación de recibo, preservando el
  --    resto del config con jsonb_set (merge de la clave 'recibo').
  UPDATE nom_conceptos SET config = jsonb_set(coalesce(config,'{}'::jsonb),'{recibo}',
      '{"grupo":"remunerativo","detalle":null}'::jsonb, true)
    WHERE codigo IN ('basico','presentismo') AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  -- 3) Alta de contribuciones patronales del modelo. WHERE NOT EXISTS para ser
  --    idempotente y tolerar empresa_id NULL (ON CONFLICT no dispara con NULL).
  INSERT INTO nom_conceptos (convenio_id, empresa_id, codigo, nombre, tipo, formula, orden, imprimible, config)
  SELECT v_convenio, v_empresa, x.codigo, x.nombre, 'aporte_patronal', x.formula, x.orden, true, x.config::jsonb
  FROM (VALUES
    ('c_sipa',   'SIPA – Ley 24.241',             'remunerativo_acumulado * 0.1077', 200, '{"modo":"porcentaje","porcentaje":10.77,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'),
    ('c_inssjp_pat','Ley 19.032 – INSSJP (contrib.)','remunerativo_acumulado * 0.0159', 201, '{"modo":"porcentaje","porcentaje":1.59,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"inssjp"}}'),
    ('c_asig',   'Asignaciones Familiares',       'remunerativo_acumulado * 0.047',  202, '{"modo":"porcentaje","porcentaje":4.70,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'),
    ('c_fne',    'Fondo Nacional de Empleo',      'remunerativo_acumulado * 0.0094', 203, '{"modo":"porcentaje","porcentaje":0.94,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'),
    ('c_os_pat', 'Obra social (contribución)',    '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.06', 204, '{"modo":"porcentaje","porcentaje":6.00,"base":"ambos","recibo":{"grupo":"contribucion","detalle":"obra_social"}}'),
    ('c_art',    'Riesgos de Trabajo – Variable', '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03', 205, '{"modo":"porcentaje","porcentaje":3.00,"base":"ambos","recibo":{"grupo":"contribucion","detalle":"art"}}'),
    ('c_osecac', 'Contribución Solidaria OSECAC', '28000',   210, '{"modo":"nominal","monto":28000,"recibo":{"grupo":"cct","detalle":"sindical"}}'),
    ('c_inacap', 'INACAP',                        '5481.25', 211, '{"modo":"nominal","monto":5481.25,"recibo":{"grupo":"cct","detalle":"sindical"}}'),
    ('c_scvo',   'Seguro Colectivo de Vida Obligatorio', '424.62', 212, '{"modo":"nominal","monto":424.62,"recibo":{"grupo":"cct","detalle":"scvo"}}')
  ) AS x(codigo, nombre, formula, orden, config)
  WHERE NOT EXISTS (
    SELECT 1 FROM nom_conceptos c
    WHERE c.codigo = x.codigo AND c.convenio_id = v_convenio AND c.empresa_id IS NOT DISTINCT FROM v_empresa
  );
END $$;
