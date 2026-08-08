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

## Pendientes de aplicar — convenios por obra, ajustes de horas, bonos (2026-08-07)

| Versión | Nombre | Notas |
|---|---|---|
| 0058 | vista_obras_presencio | `nom_v_obras`. **Antes de aplicar**: verificar las columnas reales de `obras` en Presencio (`select column_name from information_schema.columns where table_name = 'obras'`) — la vista asume `id, empresa_id, nombre`; ajustar el SELECT si difiere. |
| 0059 | convenio_por_obra | `nom_convenios.obra_id` + `clonar_convenio(convenio_global_id, p_empresa_id, p_obra_id)`. Reemplaza la función de 0038 (mismo nombre, firma con un parámetro nuevo). |
| 0060 | config_horas_obra | `nom_config_obras` — tope de horas y jornada por obra. |
| 0061 | ajustes_horas_periodo | `nom_ajustes_horas` — delta global de horas por persona y período. |
| 0062 | bonos_no_remunerativos | `nom_bonos` (catálogo superadmin) + `nom_bono_aplicaciones` (empresa/obra) + `nom_bono_excepciones` (persona). |

Todavía no se aplicaron en Presencio-dev (no hay acceso al SQL Editor desde este entorno). Aplicar en orden 0058→0062, verificar cada una con los queries de smoke test documentados en cada archivo, y actualizar esta tabla con la fecha real.
