-- ═══════════════════════════════════════════════════════════════════
-- SEED DEMO — Legajos de XENTRIO
-- Proyecto Supabase: hlipootstxojwdxwkrwl
-- ═══════════════════════════════════════════════════════════════════
--
-- Completa los legajos de Xentrio con datos verosímiles para usar la app
-- como demo, DEJANDO 2 LEGAJOS INCOMPLETOS a propósito (para mostrar el
-- semáforo "INCOMPLETO", el aviso "Alta sin terminar" y la guía paso a paso).
--
-- QUÉ TOCA
--   · nom_legajo    → cuil, cbu, banco, obra social, jornada, convenio,
--                     categoría, fecha de ingreso/nacimiento, domicilio.
--   · nom_familiares→ cónyuge/hijos en ~40% de los legajos.
--   NO toca `personal` (vive en Presencio, Recursio nunca le escribe),
--   ni liquidaciones, ni escalas salariales, ni documentación.
--
-- IDEMPOTENTE: solo escribe donde hay NULL. Correrlo dos veces no duplica
-- ni pisa nada que hayas editado a mano desde la app.
--
-- CÓMO SE CORRE: pegar entero en el SQL editor de Supabase (rol postgres,
-- así que pasa por encima de la RLS). Al final imprime un control.
--
-- PARA DESHACERLO: ver el bloque ROLLBACK al pie del archivo.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- Helpers de sesión (pg_temp: se borran solos al cerrar la conexión,
-- no quedan objetos nuevos en el esquema público).
-- ───────────────────────────────────────────────────────────────────

-- CUIL con dígito verificador REAL. Un CUIL inventado se ve bien en
-- pantalla pero rebota en cualquier validación posterior (AFIP, F.931).
CREATE OR REPLACE FUNCTION pg_temp.demo_cuil(p_dni text, p_prefijo text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  dni   text := lpad(regexp_replace(coalesce(p_dni, ''), '\D', '', 'g'), 8, '0');
  pref  text := p_prefijo;
  pesos int[] := ARRAY[5,4,3,2,7,6,5,4,3,2];
  base  text;
  s     int;
  i     int;
  dv    int;
BEGIN
  IF length(dni) <> 8 THEN RETURN NULL; END IF;
  LOOP
    base := pref || dni;
    s := 0;
    FOR i IN 1..10 LOOP
      s := s + substr(base, i, 1)::int * pesos[i];
    END LOOP;
    dv := 11 - (s % 11);
    IF dv = 11 THEN dv := 0; END IF;
    EXIT WHEN dv <> 10;
    -- El DV 10 no existe: la regla es pasar al prefijo 23 y recalcular.
    IF pref = '23' THEN dv := 9; EXIT; END IF;
    pref := '23';
  END LOOP;
  RETURN pref || '-' || dni || '-' || dv::text;
END $fn$;

-- CBU de 22 dígitos con los DOS dígitos verificadores calculados.
-- Bloque 1 (8): banco(3) + sucursal(4) + dv. Bloque 2 (14): cuenta(13) + dv.
CREATE OR REPLACE FUNCTION pg_temp.demo_cbu(p_banco text, p_suc text, p_cuenta text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  b1 text := lpad(p_banco, 3, '0') || lpad(p_suc, 4, '0');
  b2 text := lpad(p_cuenta, 13, '0');
  w1 int[] := ARRAY[7,1,3,9,7,1,3];
  w2 int[] := ARRAY[3,9,7,1,3,9,7,1,3,9,7,1,3];
  s  int := 0;
  i  int;
  d1 int;
  d2 int;
BEGIN
  FOR i IN 1..7  LOOP s := s + substr(b1, i, 1)::int * w1[i]; END LOOP;
  d1 := (10 - (s % 10)) % 10;
  s := 0;
  FOR i IN 1..13 LOOP s := s + substr(b2, i, 1)::int * w2[i]; END LOOP;
  d2 := (10 - (s % 10)) % 10;
  RETURN b1 || d1::text || b2 || d2::text;
END $fn$;


-- ───────────────────────────────────────────────────────────────────
-- 0 · Empresa y legajos a dejar incompletos
-- ───────────────────────────────────────────────────────────────────

CREATE TEMP TABLE demo_emp ON COMMIT DROP AS
SELECT id FROM empresas WHERE nombre ILIKE '%xentrio%' ORDER BY nombre LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM demo_emp) THEN
    RAISE EXCEPTION 'No se encontró ninguna empresa con nombre ILIKE %%xentrio%%. Revisá el nombre en la tabla empresas.';
  END IF;
END $$;

-- Los 2 que quedan INCOMPLETOS. Si dejás esta tabla vacía se eligen solos:
-- los 2 legajos cargados más recientemente (narrativa: "altas de esta semana,
-- todavía sin completar"). Para fijarlos vos, descomentá y poné los DNI.
CREATE TEMP TABLE demo_excluir (dni text) ON COMMIT DROP;
-- INSERT INTO demo_excluir (dni) VALUES ('90100024'), ('90100025');


-- ───────────────────────────────────────────────────────────────────
-- 1 · Alta de legajo para el personal que todavía no tiene fila
--     (sin esto, esas personas ni siquiera aparecen con ficha).
-- ───────────────────────────────────────────────────────────────────

INSERT INTO nom_legajo (empresa_id, personal_id)
SELECT p.empresa_id, p.id
FROM personal p
WHERE p.empresa_id = (SELECT id FROM demo_emp)
  AND coalesce(p.estado, 'activo') <> 'inactivo'
  AND NOT EXISTS (SELECT 1 FROM nom_legajo l WHERE l.personal_id = p.id);


-- ───────────────────────────────────────────────────────────────────
-- 2 · Universo de trabajo, con orden estable
-- ───────────────────────────────────────────────────────────────────

CREATE TEMP TABLE demo_base ON COMMIT DROP AS
SELECT
  l.id                       AS legajo_id,
  l.personal_id,
  p.nombre,
  regexp_replace(coalesce(p.dni, ''), '\D', '', 'g') AS dni,
  p.puesto,
  p.fecha_ingreso            AS ingreso_personal,
  l.fuera_convenio,
  -- ::int a propósito: row_number() devuelve bigint y ni `date - bigint` ni
  -- make_date(bigint,...) tienen operador/firma en Postgres.
  (row_number() OVER (ORDER BY p.nombre))::int                                     AS rn,
  (row_number() OVER (ORDER BY l.created_at DESC NULLS FIRST, p.nombre DESC))::int AS rn_reciente
FROM nom_legajo l
JOIN personal p ON p.id = l.personal_id
WHERE l.empresa_id = (SELECT id FROM demo_emp);

-- Marcado de los que se dejan a medias.
ALTER TABLE demo_base ADD COLUMN excluir boolean;
UPDATE demo_base b
SET excluir = CASE
  WHEN (SELECT count(*) FROM demo_excluir) > 0
    THEN b.dni IN (SELECT regexp_replace(dni, '\D', '', 'g') FROM demo_excluir)
  ELSE b.rn_reciente <= 2
END;


-- ───────────────────────────────────────────────────────────────────
-- 3 · Convenio y categorías disponibles para Xentrio
--     Se prefiere el convenio propio de la empresa sobre la plantilla global.
-- ───────────────────────────────────────────────────────────────────

CREATE TEMP TABLE demo_conv ON COMMIT DROP AS
SELECT id FROM nom_convenios
WHERE (empresa_id = (SELECT id FROM demo_emp) OR empresa_id IS NULL)
  AND nombre ILIKE '%UOCRA%'
ORDER BY (empresa_id IS NULL), nombre
LIMIT 1;

-- Una fila por nombre de categoría, quedándonos con la vigencia más nueva.
CREATE TEMP TABLE demo_cats ON COMMIT DROP AS
SELECT id, nombre, row_number() OVER (ORDER BY nombre) - 1 AS idx,
       count(*) OVER () AS total
FROM (
  SELECT DISTINCT ON (nombre) id, nombre
  FROM nom_categorias
  WHERE convenio_id = (SELECT id FROM demo_conv)
    AND vigencia_desde <= current_date
  ORDER BY nombre, vigencia_desde DESC
) c;


-- ───────────────────────────────────────────────────────────────────
-- 4 · Datos generados
-- ───────────────────────────────────────────────────────────────────

CREATE TEMP TABLE demo_datos ON COMMIT DROP AS
WITH cfg AS (
  SELECT
    ARRAY['Banco de la Nación Argentina','Banco Provincia de Buenos Aires',
          'Banco Galicia','Banco Santander','Banco Macro']            AS bancos,
    ARRAY['011','014','007','072','285']                              AS bancos_cod,
    ARRAY['OSDE','Swiss Medical','Galeno','OMINT']                    AS os_fuera,
    ARRAY['Berazategui','Quilmes','La Plata','Avellaneda','Lanús',
          'Florencio Varela','Wilde']                                 AS localidades,
    ARRAY['1884','1878','1900','1870','1824','1888','1875']           AS cps,
    ARRAY['Av. Mitre','Calle 12','San Martín','Belgrano','Rivadavia',
          'Los Andes','Alsina']                                       AS calles
)
SELECT
  b.legajo_id,
  b.personal_id,
  -- 27 para nombres de pila terminados en «a», 20 para el resto. Heurística
  -- de demo: no tenemos sexo en `personal`, y el prefijo del CUIL lo pide.
  pg_temp.demo_cuil(
    b.dni,
    CASE WHEN lower(split_part(btrim(b.nombre), ' ', 1)) ~ 'a$' THEN '27' ELSE '20' END
  ) AS cuil,
  pg_temp.demo_cbu(
    cfg.bancos_cod[(b.rn % 5) + 1],
    lpad(((b.rn * 13) % 400 + 1)::text, 4, '0'),
    lpad((400000000000 + b.rn * 7919)::text, 13, '0')
  ) AS cbu,
  cfg.bancos[(b.rn % 5) + 1] AS banco,
  CASE WHEN b.fuera_convenio
       THEN cfg.os_fuera[(b.rn % 4) + 1]
       ELSE 'OSPeCon — Obra Social del Personal de la Construcción'
  END AS obra_social,
  CASE WHEN b.rn % 7 = 0 THEN 'parcial' ELSE 'completa' END AS jornada,
  CASE WHEN b.fuera_convenio THEN NULL ELSE (SELECT id FROM demo_conv) END AS convenio_id,
  CASE WHEN b.fuera_convenio THEN NULL ELSE coalesce(
    -- 1º: categoría que coincide con el puesto que ya trae de Presencio.
    (SELECT c.id FROM demo_cats c WHERE btrim(lower(c.nombre)) = btrim(lower(coalesce(b.puesto, ''))) LIMIT 1),
    -- 2º: rotación estable entre las categorías del convenio.
    (SELECT c.id FROM demo_cats c WHERE c.idx = b.rn % greatest(c.total, 1) LIMIT 1)
  ) END AS categoria_id,
  -- Fuera de convenio necesita sueldo pactado para poder liquidar.
  CASE WHEN b.fuera_convenio THEN 900000 + (b.rn % 6) * 150000 ELSE NULL END::numeric(14,2) AS sueldo_convenido,
  coalesce(b.ingreso_personal, current_date - (((b.rn * 137) % 1000) + 45)) AS fecha_ingreso,
  make_date(1972 + ((b.rn * 7) % 26), 1 + ((b.rn * 5) % 12), 1 + ((b.rn * 11) % 28)) AS fecha_nacimiento,
  cfg.calles[(b.rn % 7) + 1] || ' ' || (350 + b.rn * 47)::text AS domicilio,
  cfg.localidades[(b.rn % 7) + 1] AS localidad,
  'Buenos Aires'::text            AS provincia,
  cfg.cps[(b.rn % 7) + 1]         AS codigo_postal,
  b.rn,
  b.nombre
FROM demo_base b CROSS JOIN cfg
WHERE NOT b.excluir;


-- ───────────────────────────────────────────────────────────────────
-- 5 · Escritura — solo sobre columnas en NULL
-- ───────────────────────────────────────────────────────────────────

UPDATE nom_legajo l SET
  cuil             = coalesce(l.cuil,             d.cuil),
  cbu              = coalesce(l.cbu,              d.cbu),
  banco            = coalesce(l.banco,            d.banco),
  obra_social      = coalesce(l.obra_social,      d.obra_social),
  jornada          = coalesce(l.jornada,          d.jornada),
  convenio_id      = coalesce(l.convenio_id,      d.convenio_id),
  categoria_id     = coalesce(l.categoria_id,     d.categoria_id),
  sueldo_convenido = coalesce(l.sueldo_convenido, d.sueldo_convenido),
  fecha_ingreso    = coalesce(l.fecha_ingreso,    d.fecha_ingreso),
  fecha_nacimiento = coalesce(l.fecha_nacimiento, d.fecha_nacimiento),
  domicilio        = coalesce(l.domicilio,        d.domicilio),
  localidad        = coalesce(l.localidad,        d.localidad),
  provincia        = coalesce(l.provincia,        d.provincia),
  codigo_postal    = coalesce(l.codigo_postal,    d.codigo_postal)
FROM demo_datos d
WHERE l.id = d.legajo_id;


-- ───────────────────────────────────────────────────────────────────
-- 6 · Familiares a cargo (~40% de los legajos completados)
-- ───────────────────────────────────────────────────────────────────

-- Cónyuge
INSERT INTO nom_familiares (empresa_id, personal_id, vinculo, nombre, fecha_nacimiento)
SELECT (SELECT id FROM demo_emp), d.personal_id, 'conyuge',
       (ARRAY['María','Silvana','Carla','Natalia','Verónica'])[(d.rn % 5) + 1]
         || ' ' || split_part(btrim(d.nombre), ' ', 2),
       make_date(1975 + ((d.rn * 3) % 22), 1 + ((d.rn * 7) % 12), 1 + ((d.rn * 13) % 28))
FROM demo_datos d
WHERE d.rn % 5 < 2
  AND NOT EXISTS (
    SELECT 1 FROM nom_familiares f
    WHERE f.personal_id = d.personal_id AND f.vinculo = 'conyuge'
  );

-- Un hijo menor (el que dispara asignaciones familiares en la demo)
INSERT INTO nom_familiares (empresa_id, personal_id, vinculo, nombre, fecha_nacimiento)
SELECT (SELECT id FROM demo_emp), d.personal_id, 'hijo',
       (ARRAY['Tomás','Lucía','Bruno','Mora','Benjamín'])[(d.rn % 5) + 1]
         || ' ' || split_part(btrim(d.nombre), ' ', 2),
       make_date(2013 + ((d.rn * 5) % 10), 1 + ((d.rn * 11) % 12), 1 + ((d.rn * 17) % 28))
FROM demo_datos d
WHERE d.rn % 5 = 0
  AND NOT EXISTS (
    SELECT 1 FROM nom_familiares f
    WHERE f.personal_id = d.personal_id AND f.vinculo = 'hijo'
  );

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- CONTROL — replica el criterio de src/utils/legajoCompletitud.js.
-- Esperado: exactamente 2 filas en INCOMPLETO.
-- ═══════════════════════════════════════════════════════════════════

SELECT
  p.nombre,
  p.dni,
  CASE
    WHEN l.cuil IS NULL OR l.cbu IS NULL THEN 'INCOMPLETO'
    WHEN l.fuera_convenio AND l.sueldo_convenido IS NULL THEN 'INCOMPLETO'
    WHEN NOT l.fuera_convenio AND (l.convenio_id IS NULL OR l.categoria_id IS NULL) THEN 'INCOMPLETO'
    ELSE 'OK'
  END AS estado,
  l.cuil, l.cbu, l.banco, l.obra_social, l.localidad,
  (SELECT count(*) FROM nom_familiares f WHERE f.personal_id = l.personal_id) AS familiares
FROM nom_legajo l
JOIN personal p ON p.id = l.personal_id
WHERE l.empresa_id = (SELECT id FROM empresas WHERE nombre ILIKE '%xentrio%' ORDER BY nombre LIMIT 1)
ORDER BY estado, p.nombre;


-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK — deja los legajos de Xentrio como estaban.
-- ⚠ Borra TODOS estos campos, incluso los que hayas cargado a mano después.
-- Descomentar sólo si querés reiniciar la demo desde cero.
-- ═══════════════════════════════════════════════════════════════════
--
-- BEGIN;
--   DELETE FROM nom_familiares
--   WHERE empresa_id = (SELECT id FROM empresas WHERE nombre ILIKE '%xentrio%' ORDER BY nombre LIMIT 1);
--
--   UPDATE nom_legajo SET
--     cuil = NULL, cbu = NULL, banco = NULL, obra_social = NULL, jornada = NULL,
--     convenio_id = NULL, categoria_id = NULL, sueldo_convenido = NULL,
--     fecha_ingreso = NULL, fecha_nacimiento = NULL, domicilio = NULL,
--     localidad = NULL, provincia = NULL, codigo_postal = NULL
--   WHERE empresa_id = (SELECT id FROM empresas WHERE nombre ILIKE '%xentrio%' ORDER BY nombre LIMIT 1);
-- COMMIT;
