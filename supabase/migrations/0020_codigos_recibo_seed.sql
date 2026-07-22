-- Códigos de recibo default para los conceptos globales existentes, según
-- el modelo de recibo provisto (UOCRA). El resto de los conceptos globales
-- sin código asignado explícitamente arriba recibe un correlativo 09xx.
--
-- NOTA PARA REVISIÓN HUMANA (no ejecutar sin revisar): confirmar que los
-- valores reales de la columna `codigo` en `nom_conceptos` coinciden con
-- los usados abajo (`basico`, `hs_feriado`, `presentismo`, `jubilacion`,
-- `ley_19032`, `obra_social`, `retencion_sindical`). Correr primero:
--   SELECT codigo, nombre FROM nom_conceptos WHERE convenio_id IS NULL;
-- y ajustar los WHERE si los nombres difieren. No ejecutar este archivo
-- contra ninguna base de datos sin esa verificación previa.
UPDATE nom_conceptos SET codigo_recibo = '0015' WHERE codigo = 'basico' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0043' WHERE codigo = 'hs_feriado' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0191' WHERE codigo = 'presentismo' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0300' WHERE codigo = 'jubilacion' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0302' WHERE codigo = 'ley_19032' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0310' WHERE codigo = 'obra_social' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0316' WHERE codigo = 'retencion_sindical' AND convenio_id IS NULL AND codigo_recibo IS NULL;

-- Correlativo 09xx para el resto de los conceptos globales sin código.
WITH restantes AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY orden, codigo) AS n
  FROM nom_conceptos
  WHERE convenio_id IS NULL AND codigo_recibo IS NULL
)
UPDATE nom_conceptos c
SET codigo_recibo = '09' || LPAD(restantes.n::text, 2, '0')
FROM restantes
WHERE c.id = restantes.id;
