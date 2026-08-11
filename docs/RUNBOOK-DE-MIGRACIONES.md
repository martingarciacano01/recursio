# Runbook de migraciones — Recursio

Registro manual de qué migraciones de `supabase/migrations/` están aplicadas en la base de Supabase compartida con Presencio (proyecto "Presencio-dev" en el dashboard).

**Importante:** `supabase_migrations.schema_migrations` NO trackea las migraciones de Recursio (solo tiene filas genéricas de Presencio). Las migraciones de Recursio se aplican a mano, vía SQL Editor de Supabase, y quedan registradas acá.

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
