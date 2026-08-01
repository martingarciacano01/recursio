#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# sync-personal-fichajes.sh
#
# Trae de PROD a STAGING solo lo mínimo para probar Recursio:
#   empresas → obras → personal → fichajes → ausencias
#
# `ausencias` se agregó porque Recursio (nom_v_ausencias, pestaña Ausencias
# del legajo y el descuento de faltas en liquidar-periodo) lee de esta tabla
# de Presencio: sin copiarla, STAGING siempre la ve vacía y la pestaña
# Ausencias/el cálculo de faltas nunca tienen nada que mostrar aunque en PROD
# el empleado sí tenga licencias cargadas (bug real, 2026-07-30).
#
# Diferencias con sync-prod-to-staging.sh (el completo):
#   · NO trunca nada — es un upsert (ON CONFLICT DO NOTHING). Se puede correr
#     todas las veces que quieras y solo agrega lo nuevo.
#   · NO toca auth.users, usuarios, usuarios_empresa ni superadmins, así que
#     no te saca el acceso ni choca con el schema desalineado.
#   · Copia solo las columnas que existen EN AMBOS lados, así que la deriva
#     de schema no lo rompe.
#   · Anonimiza nombre, DNI y biometría de los empleados nuevos.
#
# PROD es solo lectura. Nunca escribe ahí.
#
# Uso:
#    export PROD_DB_URL="postgresql://postgres.qsgzbfusjhgnyacdbbzg:PWD@aws-1-us-west-2.pooler.supabase.com:5432/postgres"
#    export STAGING_DB_URL="postgresql://postgres.hlipootstxojwdxwkrwl:PWD@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
#    bash scripts/sync-personal-fichajes.sh          # últimos 120 días
#    DIAS=30 bash scripts/sync-personal-fichajes.sh  # últimos 30 días
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="${DIR}/.dumps"
DIAS="${DIAS:-120}"

: "${PROD_DB_URL:?Falta PROD_DB_URL}"
: "${STAGING_DB_URL:?Falta STAGING_DB_URL}"

if [[ "$STAGING_DB_URL" == *"qsgzbfusjhgnyacdbbzg"* ]]; then
  echo "✗ STAGING_DB_URL apunta a PRODUCCIÓN. Abortando."; exit 1
fi

mkdir -p "$TMP"

# ─── Copia una tabla de prod a staging por CSV, columna a columna ────────────
# Solo usa las columnas presentes en ambos schemas → inmune a la deriva.
copiar() {
  local TABLA="$1" WHERE="${2:-true}"
  local CSV="${TMP}/${TABLA}.csv"

  local Q="SELECT string_agg(quote_ident(column_name), ',' ORDER BY column_name)
           FROM information_schema.columns
           WHERE table_schema='public' AND table_name='${TABLA}'"
  local COLS_PROD COLS_STG COLS
  COLS_PROD=$(psql "$PROD_DB_URL"    -At -c "$Q")
  COLS_STG=$(psql  "$STAGING_DB_URL" -At -c "$Q")

  # intersección de ambas listas
  COLS=$(comm -12 \
    <(tr ',' '\n' <<<"$COLS_PROD" | sort) \
    <(tr ',' '\n' <<<"$COLS_STG"  | sort) | paste -sd, -)

  if [[ -z "$COLS" ]]; then
    echo "   ✗ ${TABLA}: no hay columnas en común"; return 1
  fi

  local SOLO_PROD
  SOLO_PROD=$(comm -23 \
    <(tr ',' '\n' <<<"$COLS_PROD" | sort) \
    <(tr ',' '\n' <<<"$COLS_STG"  | sort) | paste -sd, -)
  [[ -n "$SOLO_PROD" ]] && echo "   ⚠ ${TABLA}: columnas solo en prod, se omiten → ${SOLO_PROD}"

  psql "$PROD_DB_URL" -q -c \
    "\copy (SELECT ${COLS} FROM ${TABLA} WHERE ${WHERE}) TO '${CSV}' WITH CSV"

  local FILAS
  FILAS=$(wc -l < "$CSV" | tr -d ' ')

  psql "$STAGING_DB_URL" -q -v ON_ERROR_STOP=1 <<SQL
BEGIN;
CREATE TEMP TABLE _stage (LIKE ${TABLA}) ON COMMIT DROP;
\copy _stage(${COLS}) FROM '${CSV}' WITH CSV
INSERT INTO ${TABLA} (${COLS})
SELECT ${COLS} FROM _stage
ON CONFLICT DO NOTHING;
COMMIT;
SQL

  echo "   ✓ ${TABLA}: ${FILAS} filas leídas de prod"
}

echo "▸ Copiando catálogos (necesarios por las FK)…"
copiar empresas
copiar obras

echo "▸ Copiando personal…"
copiar personal

echo "▸ Copiando fichajes de los últimos ${DIAS} días…"
copiar fichajes "timestamp >= now() - interval '${DIAS} days'"

echo "▸ Copiando ausencias de los últimos ${DIAS} días…"
copiar ausencias "hasta >= now() - interval '${DIAS} days'"

echo "▸ Anonimizando PII de los empleados nuevos…"
psql "$STAGING_DB_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
UPDATE personal p
SET nombre = (ARRAY['Juan','María','Carlos','Lucía','Diego','Sofía','Martín',
                    'Valeria','Pablo','Camila','Andrés','Rocío','Gonzalo',
                    'Florencia','Nicolás','Julieta']
             )[1 + abs(hashtext(p.id::text)) % 16]
             || ' ' ||
             (ARRAY['Gómez','Fernández','Rodríguez','López','Martínez','Sosa',
                    'Romero','Torres','Ruiz','Álvarez','Benítez','Acosta',
                    'Medina','Herrera','Aguirre','Cabrera']
             )[1 + abs(hashtext(p.id::text || 'salt')) % 16],
    dni        = (20000000 + (abs(hashtext(p.id::text)) % 25000000))::text,
    foto_url   = NULL,
    descriptor = CASE WHEN p.descriptor IS NULL THEN NULL
                      ELSE (SELECT jsonb_agg(round((random()*2-1)::numeric, 6))
                            FROM generate_series(1,128)) END
WHERE p.nombre !~ '^(Juan|María|Carlos|Lucía|Diego|Sofía|Martín|Valeria|Pablo|Camila|Andrés|Rocío|Gonzalo|Florencia|Nicolás|Julieta) ';

UPDATE fichajes SET foto_url = NULL WHERE foto_url IS NOT NULL;
UPDATE obras    SET direccion = 'Av. Siempreviva ' || (100 + abs(hashtext(id::text)) % 4000)
WHERE direccion IS NULL OR direccion !~ '^Av\. Siempreviva ';
SQL

echo "▸ Resumen en STAGING:"
psql "$STAGING_DB_URL" -c "
  SELECT 'empresas' t, count(*) FROM empresas
  UNION ALL SELECT 'obras',    count(*) FROM obras
  UNION ALL SELECT 'personal', count(*) FROM personal
  UNION ALL SELECT 'fichajes', count(*) FROM fichajes
  UNION ALL SELECT 'ausencias', count(*) FROM ausencias
  UNION ALL SELECT 'superadmins', count(*) FROM superadmins;"

rm -f "${TMP}"/*.csv
echo ""
echo "✅ Listo. CSVs temporales borrados."
