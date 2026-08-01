-- ═══════════════════════════════════════════════════════════════════
-- ESCALA UOCRA — Zona A — vigencia julio 2026
-- ═══════════════════════════════════════════════════════════════════
--
-- ⚠ REVISAR LA FECHA ANTES DE CORRER
--   Se usa 2026-07-01. Si la paritaria rige desde otro día, cambiá las
--   seis apariciones de DATE '2026-07-01' (o usá buscar y reemplazar).
--   La fecha importa: nom_categorias versiona por vigencia_desde y el
--   motor resuelve la escala vigente al período que se liquida.
--
-- NO PISA NADA. nom_categorias nunca se actualiza, se agrega una vigencia
-- nueva. Las filas actuales (vigencia 1900-01-01, básico 0) quedan como
-- histórico. `agruparVigencias` elige la mayor vigencia_desde <= hoy, así
-- que a partir de hoy manda esta escala.
--
-- Se aplica a TODO convenio llamado 'UOCRA (Ley 22.250)' — la plantilla
-- global y cualquier copia de empresa ya personalizada. Si personalizás
-- DESPUÉS de correr esto, clonar_convenio copia todas las vigencias.
--
-- MODALIDADES: Oficial especializado, Oficial, Medio oficial y Ayudante
-- van por hora (jornal × horas trabajadas). Sereno va mensual: el motor
-- lo divide por 2 en cada quincena (calcularBasicoPeriodo, basico.ts).

BEGIN;

INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde, modalidad)
SELECT cv.id, e.nombre, e.basico, DATE '2026-07-01', e.modalidad
FROM nom_convenios cv
CROSS JOIN (VALUES
  ('Oficial especializado', 6800.00,   'hora'),
  ('Oficial',               5817.00,   'hora'),
  ('Medio oficial',         5375.00,   'hora'),
  ('Ayudante',              4948.00,   'hora'),
  ('Sereno',              898817.00,   'mensual')
) AS e(nombre, basico, modalidad)
WHERE cv.nombre = 'UOCRA (Ley 22.250)'
ON CONFLICT (convenio_id, nombre, vigencia_desde) DO NOTHING;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════
-- Escala vigente hoy por categoría. Esperado: los 5 valores de arriba,
-- con Sereno en 'mensual' y el resto en 'hora'.
SELECT DISTINCT ON (cv.id, k.nombre)
  cv.nombre AS convenio,
  CASE WHEN cv.empresa_id IS NULL THEN 'plantilla' ELSE 'empresa' END AS ambito,
  k.nombre  AS categoria,
  k.basico,
  k.modalidad,
  k.vigencia_desde
FROM nom_categorias k
JOIN nom_convenios cv ON cv.id = k.convenio_id
WHERE cv.nombre = 'UOCRA (Ley 22.250)'
  AND k.vigencia_desde <= CURRENT_DATE
ORDER BY cv.id, k.nombre, k.vigencia_desde DESC;

-- Coherencia con el seguro de vida CCT 76/75: el concepto seg_vida_cct
-- es 2 % del básico de Sereno. Las dos columnas deben coincidir.
SELECT
  k.basico                          AS sereno_basico,
  round(k.basico * 0.02, 2)         AS dos_por_ciento,
  (c.config->>'monto')::numeric     AS seg_vida_cct_cargado
FROM nom_categorias k
JOIN nom_convenios cv ON cv.id = k.convenio_id
JOIN nom_conceptos  c ON c.convenio_id = cv.id AND c.codigo = 'seg_vida_cct'
WHERE cv.nombre = 'UOCRA (Ley 22.250)'
  AND k.nombre = 'Sereno'
  AND k.vigencia_desde = DATE '2026-07-01';
