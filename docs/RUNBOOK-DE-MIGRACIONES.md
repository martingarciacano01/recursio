# Runbook de migraciones — Recursio

Registro manual de qué migraciones de `supabase/migrations/` están aplicadas en cada base de Supabase. Hay **dos entorno** de Recursio:

| Entorno | Proyecto Supabase | Ref | Región | Rama Git | Deploy Vercel |
|---|---|---|---|---|---|
| **dev/staging** | Presencio-dev | `hlipootstxojwdxwkrwl` | us-east-2 | `dev` | preview |
| **prod** | Presencio (compartida con la app real de Presencio) | `qsgzbfusjhgnyacdbbzg` | us-west-2 | `prod` | production |

**Importante:** `supabase_migrations.schema_migrations` NO trackea las migraciones de Recursio (solo tiene filas genéricas de Presencio). Las migraciones de Recursio se aplican a mano, vía SQL Editor de Supabase, y quedan registradas acá.

## Mapeo rama → proyecto → env vars (Vercel)

Las env vars del proyecto Vercel `recursio` están separadas por entorno y ya configuradas:

| Env var | Production (rama `prod`) → Presencio prod | Preview (rama `dev`) → Presencio-dev |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://qsgzbfusjhgnyacdbbzg.supabase.co` | `https://hlipootstxojwdxwkrwl.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon key de Presencio prod | anon key de Presencio-dev |

`link.productionBranch` del proyecto Vercel = `prod`. En la práctica: un push a `prod` genera el deploy de producción contra la base real; un push a `dev` genera preview contra la base de staging. No hay que tocar envs Vercel al agregar migraciones — solo aplicar el SQL en la base indicada abajo.

## Estado de prod (Presencio)

**Migraciones aplicadas el 2026-08-13** vía Management API (`/v1/projects/{ref}/database/query`, token del keychain `Supabase CLI`), sin tocar las tablas de Presencio. Antes de aplicar se hizo snapshot de las 18 tablas de Presencio a `/tmp/snp-presencio.tar.gz`.

| Versión | Estado en prod | Notas |
|---|---|---|
| 0001–00021, 0001b, 0002b, 0025–0065 | aplicadas 2026-08-13 | Orden numérico; OK todas. |
| 0026 | aplicada con fix | El endpoint de Management API ejecutó la migración parcialmente y falló con `policy ... already exists` (el `database/query` no es transaccional statement-por-statement). 0045 (el fix del bypass de superadmin) sí corrió OK. Se reconcilió el estado con `/tmp/reconcile.sql`: se dropearon las 19 policies legacy (`*_all`/`*_rw`/`*_write` de 0008/0012/0014/0021/0025/0032/0034/0040) y se crearon las 4 de `nom_no_remunerativos` que habían quedado sin aplicar. Resultado: RLS por rol consistente = el estado de 0026+0045 limpias. |
| 0066 | aplicada 2026-08-13 | Consolidado 0058–0065. |
| 0067, 0068, 0069, 0070 | aplicadas 2026-08-13 | Fase 7 firma + grants service_role. |

**Resultado en prod:** 35 tablas `nom_*`, 5 vistas de contrato (`nom_v_personal`, `nom_v_horas_dia`, `nom_v_ausencias`, `nom_v_obras`, `nom_v_empresa_feriados`), seeds (2 convenios, 38 conceptos, 8 categorías), `nom_usuarios_empresas` vacía (aún sin roles de Nómina asignados). Edge Functions **`invitar-usuario`** y **`liquidar-periodo`** deployadas el 2026-08-13 con `verify_jwt: True` (alineadas con dev). `invite-user` es la función de Presencio (no confundir).

**Pendiente luego de este lanzamiento:**
1. Asignar roles en `nom_usuarios_empresas` en prod (la RLS por rol cierra el acceso; sin filas, nadie con rol Nómina aunque sea autenticado — igual que en dev cuando se aplicó 0026).
2. Smoke test de `liquidar-periodo` con un período real cargado.
3. Confirmar que las anon keys/URLs de Vercel (Production) siguen las de `qsgzbfusjhgnyacdbbzg`.

**Verificado ya en el lanzamiento:** bucket público `nom-firmas` creado (0069), RPC `emitir_recibo_variante`/`emitir_recibo`/`has_rol_nomina`/`whoami_nomina`/`listar_usuarios_empresa` presentes, funciones con `verify_jwt: True` respondiendo 401 sin token.

## Cómo aplicar una migración nueva

1. Leer el archivo en `supabase/migrations/` y confirmar que es idempotente (o que se corre una sola vez a sabiendas).
2. Pegar el SQL en el SQL Editor de Supabase (proyecto "Presencio-dev") y ejecutar.
3. Si da "Success", agregar una fila a la tabla de abajo.
4. Commitear el runbook actualizado.

## Migraciones aplicadas

| Versión | Nombre | Fecha aplicada | Base | Notas |
|---|---|---|---|---|
| 0036 | empresa_logo | (histórico, pre-2026-08-01) | Presencio-dev | Aplicada antes del relevamiento; verificada por inspección de columnas. |
| 0037 | correccion_aportes_julio_2026 | 2026-08-01 | Presencio-dev | Corrige % de contribuciones patronales sembrados en 0029/0031. |
| 0038 | clonar_convenio_cortes | 2026-08-01 | Presencio-dev | Fix de `clonar_convenio()`. |
| 0039 | basico_unidad_base | 2026-08-01 | Presencio-dev | Agrega `unidadFormula`/`baseFormula` al concepto `basico`. |
| 0040 | adicionales_por_legajo | (histórico, pre-2026-08-01) | Presencio-dev | Aplicada antes del relevamiento; verificada por inspección de tablas. |
| 0041 | backfill_estado_ausencias | 2026-08-01 | Presencio-dev | Backfill de `estado` NULL en ausencias. |
| 0042 | grant_legajo_adicionales | 2026-08-01 | Presencio-dev | GRANT de objeto faltante para `nom_legajo_adicionales`. |

Las migraciones 0037, 0038, 0039, 0041 y 0042 se aplicaron el 2026-08-01 en un solo bloque SQL concatenado (todas idempotentes: UPDATE con match exacto, INSERT con `WHERE NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `GRANT` simple), con resultado "Success" en el SQL Editor.

## Pendientes de aplicar — consolidado 0066 (2026-08-09)

**Si hay dudas de qué está aplicado** (por ejemplo si una función falla leyendo una tabla que debería existir), correr en el SQL Editor el archivo consolidado **`supabase/migrations/0066_schemas_pendientes.sql`**: arranca con un `SELECT` de diagnóstico que lista objeto por objeto (`ok` / `FALTA`) y después aplica todo lo que falta. Es 100% idempotente (0058→0065 concatenadas), así que se puede correr aunque ya esté todo aplicado — solo recrea lo que no exista.

**OJO — la Edge Function `liquidar-periodo` lee estas tablas y hay que REDEPLOYGARLA** después de aplicar el SQL (el código nuevo ya está en el repo pero el deploy es manual):

```bash
cd supabase && supabase functions deploy liquidar-periodo --project-ref <ref-de-presencio-dev>
```

> **Último deploy: 2026-08-11 (version 25, `--use-api`).** Incluye el fix del tope de horas diarias (`b18eab6`) y el **chequeo de errores** al leer `nom_config_horas`/`nom_config_obras` (antes un permiso faltante hacía que el cálculo corriera sin tope en silencio). Antes (version 22, deploy 2026-08-04) la extra se cortaba pero el básico pagaba las horas completas — por eso "el tope no modificaba nada". Ver `docs/TOPE-HORAS-POR-OBRA.md`.

## Fix aplicado en vivo — 0070 grants service_role (2026-08-11)

**Causa raíz del "el tope no modifica nada":** la edge function corre con `service_role`, que bypasea RLS pero **no** los GRANTs de tabla. Las tablas de las Fases 5-6 (`nom_config_horas`, `nom_config_obras`, `nom_ajustes_horas`, `nom_bonos`, `nom_bono_aplicaciones`, `nom_bono_excepciones`) solo se concedieron a `authenticated`, nunca a `service_role` → la función las leía en `null` en silencio y calculaba SIN tope/jornada/ajustes/bonos. Verificado con grants reales + log `[DIAG-TOPE]`.

| Versión | Nombre | Notas |
|---|---|---|
| 0070 | grants_service_role_fase5_6 | GRANT SELECT/INSERT/UPDATE/DELETE a service_role de las tablas de config de Fase 5-6 + `nom_firma_empresa`. **Aplicada en vivo 2026-08-11.** |

La migración `0070` es idempotente; aplicarla en cualquier entorno nuevo antes de liquidar.

| Versión | Nombre | Notas |
|---|---|---|
| 0066 | schemas_pendientes (consolidado 0058–0065) | Un solo archivo con diagnóstico + todo el schema del plan. Reemplaza la necesidad de aplicar 0064/0065 por separado. |
| 0067 | periodo_por_obra | Agrega `nom_periodos.obra_id` (opcional): un período puede acotarse a una obra/sitio; al calcular, `liquidar-periodo` procesa solo el personal activo de esa obra. Idempotente. |

**Estado 0058–0063:** confirmadas aplicadas por el usuario en Presencio-dev (2026-08-07, handoff). 0063 habilita las 4 features por empresa en Superadmin → "Features" — sin tildar, la UI no muestra nada nuevo y liquidar-periodo ignora ajustes/topes por obra/bonos aunque haya datos cargados. **Importante:** `liquidar-periodo` consulta `nom_empresa_features` y `nom_bonos`/`nom_bono_aplicaciones`/`nom_bono_excepciones` incondicionalmente al inicio; si esas tablas no existen la función falla para CUALQUIER período (incluida la liquidación final) — por eso el diagnóstico y el redeploy van juntos.

## Pendiente de aplicar — 0069 firma de recibos (Fase 7, plan 2026-08-11)

**No requiere redeploy de `liquidar-periodo`** (la migración es solo SQL; el front ya emite contra el RPC nuevo). Aplicar en SQL Editor de Presencio-dev:

| Versión | Nombre | Notas |
|---|---|---|
| 0069 | firma_recibos | Tabla `nom_firma_empresa`, bucket público `nom-firmas`, columnas `hash_pdf_empleado`/`hash_pdf_empleador`/`emitido_empleado`/`emitido_empleador` en `nom_liquidaciones`, RPC `emitir_recibo_variante`. 100% idempotente. **Requiere 0054 aplicada** (`estado_revision` en `nom_liquidaciones`, plan de aprobaciones 2026-08-03) — el RPC rechaza liquidaciones con `estado_revision='rechazado'`. |

Sin aplicar la 0069, los botones "para el Empleado" se ven (si hay período aprobado) pero `emitir_recibo_variante` falla con "function does not exist" — aplicar antes de probar la variante.

## Pendiente de aplicar — 0071 contacto del legajo (nom_legajo)

Replica las columnas de contacto que Presencio agrega al esquema compartido: `telefono` (Presencio 043) y `email` (Presencio 044). La dirección ya existe (`domicilio`, 0002). 100% idempotente (`ADD COLUMN IF NOT EXISTS`). Presencio es la fuente de verdad que las escribe; Recursio solo las lee en la ficha del legajo.

| Versión | Nombre | Notas |
|---|---|---|
| 0071 | legajo_contacto | `ADD COLUMN IF NOT EXISTS telefono, email` en `nom_legajo`. Aplicar en Presencio-dev y en prod (mismo proyecto Presencio). No requiere redeploy de `liquidar-periodo`. |
