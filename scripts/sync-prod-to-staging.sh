#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# sync-prod-to-staging.sh
#
# Copia los DATOS de Presencio PROD (qsgzbfusjhgnyacdbbzg) a STAGING
# (hlipootstxojwdxwkrwl) y los anonimiza, para poder desarrollar Presencio dev
# y Recursio con volumen y forma de datos reales sin exponer PII.
#
# NO toca el schema — para eso ya está `supabase db pull` / `db push`.
# NO escribe nunca en PROD (solo lee).
#
# Requisitos: psql, pg_dump 15+ (brew install libpq), password de ambas DBs.
#
# Uso (poner un ESPACIO adelante de cada export para que la password no quede
# guardada en ~/.zsh_history):
#
#    export PROD_DB_URL="postgresql://postgres.qsgzbfusjhgnyacdbbzg:PWD@aws-1-us-west-2.pooler.supabase.com:5432/postgres"
#    export STAGING_DB_URL="postgresql://postgres.hlipootstxojwdxwkrwl:PWD@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
#    bash scripts/sync-prod-to-staging.sh
#
# Ojo con las regiones: PROD está en us-west-2 y STAGING en us-east-2.
# Las connection strings salen de Supabase → Project Settings → Database →
# Connection string → URI, en modo "Session" (puerto 5432).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUMP_DIR="${DIR}/.dumps"
STAMP="$(date +%Y%m%d-%H%M%S)"

: "${PROD_DB_URL:?Falta PROD_DB_URL}"
: "${STAGING_DB_URL:?Falta STAGING_DB_URL}"

# Guarda de seguridad: staging NO puede ser el ref de prod
if [[ "$STAGING_DB_URL" == *"qsgzbfusjhgnyacdbbzg"* ]]; then
  echo "✗ STAGING_DB_URL apunta al proyecto de PRODUCCIÓN. Abortando."
  exit 1
fi

# Tablas de Presencio a copiar (orden irrelevante: se restaura con FKs off).
TABLES=(
  empresas
  obras
  usuarios
  usuarios_empresa
  superadmins
  personal
  fichajes
  ausencias
  tipos_documento
  documentos_personal
  proyectos
  subproyectos
  procesos_produccion
  sitios_trabajo
  registro_horas_proyecto
  app_config
  app_versions
)

# Tablas que NO se copian a propósito:
#   push_subscriptions  → endpoints de push de dispositivos reales
#   auditoria_fichadas  → log de auditoría, no aporta a dev

mkdir -p "$DUMP_DIR"

# ─── PASO 0: verificar que los schemas coincidan ─────────────────────────────
# Si prod tiene una columna que staging no, el COPY de esa tabla falla y psql
# pierde la sincronización con el archivo (los \N de los NULL se interpretan
# como comandos). Mejor detectarlo antes de tocar nada.
echo "▸ 0/5  Comparando schemas prod vs staging…"
COLS_SQL="SELECT table_name || '.' || column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY (string_to_array('$(IFS=, ; echo "${TABLES[*]}")', ','))
          ORDER BY 1;"
psql "$PROD_DB_URL"    -At -c "$COLS_SQL" > "${DUMP_DIR}/.cols-prod"
psql "$STAGING_DB_URL" -At -c "$COLS_SQL" > "${DUMP_DIR}/.cols-staging"

if ! DIFF=$(diff "${DUMP_DIR}/.cols-prod" "${DUMP_DIR}/.cols-staging"); then
  echo ""
  echo "   ✗ Los schemas NO coinciden. Columnas que difieren:"
  echo "$DIFF" | grep '^[<>]' | sed 's/^</     solo en PROD:    /; s/^>/     solo en STAGING: /'
  echo ""
  echo "   Sincronizá el schema antes de copiar datos:"
  echo "     supabase link --project-ref qsgzbfusjhgnyacdbbzg && supabase db pull"
  echo "     supabase link --project-ref hlipootstxojwdxwkrwl && supabase db push"
  exit 1
fi
echo "   ✓ schemas alineados"

DUMP_FILE="${DUMP_DIR}/prod-data-${STAMP}.sql"
AUTH_FILE="${DUMP_DIR}/prod-auth-${STAMP}.sql"

TBL_ARGS=()
for t in "${TABLES[@]}"; do TBL_ARGS+=(-t "public.${t}"); done

echo "▸ 1/5  Dump de datos de PROD (solo lectura)…"
# Sin --disable-triggers: requiere ser owner de la tabla y en Supabase falla.
# Las FKs se desactivan en el restore con session_replication_role = replica.
#
# --inserts en vez de COPY: si una fila falla, se saltea esa fila sola en vez
# de abortar la tabla entera y descarrilar el parser de psql.
# --on-conflict-do-nothing: tolera filas que ya existen en staging.
pg_dump "$PROD_DB_URL" \
  --data-only --no-owner --no-privileges --no-comments \
  --inserts --on-conflict-do-nothing --rows-per-insert=500 \
  "${TBL_ARGS[@]}" \
  -f "$DUMP_FILE"
echo "   ✓ $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

echo "▸ 2/5  Dump de auth.users (necesario por las FK de usuarios/obras)…"
# Idem: con --inserts, un email que ya existe en staging saltea esa fila sola.
pg_dump "$PROD_DB_URL" \
  --data-only --no-owner --no-privileges \
  --inserts --on-conflict-do-nothing --rows-per-insert=200 \
  -t auth.users -t auth.identities \
  -f "$AUTH_FILE"
echo "   ✓ $AUTH_FILE"

echo "▸ 3/5  Vaciando tablas en STAGING…"
echo "   ⚠ TRUNCATE ... CASCADE también vacía las tablas nom_* de Recursio que"
echo "     referencian a personal/obras/empresas. Es intencional: los legajos"
echo "     viejos quedarían apuntando a personal que ya no existe."
read -r -p "   ¿Continuar? [s/N] " OK
[[ "$OK" == "s" || "$OK" == "S" ]] || { echo "   Cancelado."; exit 1; }

# Trunca solo las tablas que realmente existen en staging
TRUNC_SQL=$(cat <<'SQL'
DO $$
DECLARE t text; lista text := '';
BEGIN
  FOREACH t IN ARRAY string_to_array(current_setting('sync.tables'), ',') LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      lista := lista || CASE WHEN lista='' THEN '' ELSE ',' END || quote_ident(t);
    END IF;
  END LOOP;
  IF lista <> '' THEN
    EXECUTE 'TRUNCATE ' || lista || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;
SQL
)
TBL_CSV=$(IFS=, ; echo "${TABLES[*]}")
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 \
  -c "SET sync.tables = '${TBL_CSV}';" -c "$TRUNC_SQL"
echo "   ✓ tablas vaciadas"

echo "▸ 4/5  Restaurando en STAGING…"
# Sin --single-transaction: con --inserts, un error puntual no debe tirar abajo
# toda la carga. session_replication_role=replica desactiva FKs y triggers.
LOG="${DUMP_DIR}/restore-${STAMP}.log"
psql "$STAGING_DB_URL" \
  -c "SET session_replication_role = replica;" \
  -f "$AUTH_FILE" -f "$DUMP_FILE" > "$LOG" 2>&1 || true

ERRORES=$(grep -c '^psql:.*ERROR' "$LOG" || true)
if [[ "$ERRORES" -gt 0 ]]; then
  echo "   ⚠ $ERRORES error(es) durante la carga — primeros 10:"
  grep '^psql:.*ERROR' "$LOG" | head -10 | sed 's/^/     /'
  echo "     log completo: $LOG"
else
  echo "   ✓ datos cargados sin errores"
fi

# Limpia referencias a usuarios de prod que no pudieron entrar (email duplicado)
psql "$STAGING_DB_URL" -q -c "
  UPDATE obras SET responsable_id = NULL
   WHERE responsable_id IS NOT NULL
     AND responsable_id NOT IN (SELECT id FROM auth.users);
  DELETE FROM usuarios WHERE id NOT IN (SELECT id FROM auth.users);
  UPDATE usuarios_empresa SET user_id = NULL
   WHERE user_id IS NOT NULL
     AND user_id NOT IN (SELECT id FROM auth.users);
"

echo "▸ 5/5  Anonimizando PII en STAGING…"
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f "${DIR}/anonimizar-staging.sql"

echo ""
echo "✅ Listo. Staging tiene los datos de prod, anonimizados."
echo "   Dumps crudos en ${DUMP_DIR}/ — CONTIENEN PII REAL."
echo "   Borralos cuando termines:  rm -rf ${DUMP_DIR}"
