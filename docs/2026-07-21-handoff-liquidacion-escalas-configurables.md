# Handoff: Liquidación con detalle de asistencia — próximo paso: escalas configurables

## Contexto

Se implementó el plan `2026-07-21-liquidacion-detalle-asistencia.md` (TDD en `packages/motor`, Edge Function `liquidar-periodo`, store y UI). Repo: `recursio`, rama `dev`. Commits:

```
91eb768 feat(motor): horas trabajadas, faltas justificadas y extras derivadas en asistencia
8929c56 feat(motor): construirDiasPeriodo — snapshot diario con dias sin fichaje y pareo entrada/salida
1a09bf1 feat(liquidacion): total_contribuciones, variables reales en liquidar-periodo, store y UI con detalle de asistencia/conceptos
```

## Qué quedó funcionando

- `packages/motor/src/asistencia.ts`: `calcularAsistencia` ahora devuelve `horasTrabajadas`, `tardanzas`, `faltasInjustificadas`, `faltasJustificadas`, `horasExtra50`, `horasExtra100`. Nueva función pura `construirDiasPeriodo(fichajes, ausencias, fechaDesde, fechaHasta)` que arma el snapshot diario completo del período (incluye días sin fichaje, para que las faltas se cuenten).
- Migración `supabase/migrations/0011_total_contribuciones.sql`: agrega `nom_liquidaciones.total_contribuciones` (ya aplicada por el usuario en Supabase).
- Edge Function `supabase/functions/liquidar-periodo/index.ts`: usa `construirDiasPeriodo`, resuelve `basico_convenio` (lee `nom_categorias` vigente por convenio+nombre+fecha), `adelanto_monto` (suma `nom_pagos_adelantos` del período) y `tope_sipa` (lee `nom_parametros`). Persiste `total_contribuciones` (suma de items `aporte_patronal`). Ya deployada.
- `src/store/liquidacionStore.js`: `liquidacionFromDB` expone `totalAportes`, `totalContribuciones`, `detalleHoras`.
- `src/pages/LiquidacionPage.jsx`: banner de período calculado, columnas de horas/extras/tardanzas/faltas/bruto/aportes/contribuciones/neto, fila expandible con detalle por concepto agrupado (remunerativo, no remunerativo, descuento, aporte_patronal, informativo).

Estado verificado: `npx vitest run` → 82/82 tests pasando (incluye los nuevos de `asistencia.ts`). La UI ya muestra horas, tardanzas y faltas reales en pantalla (confirmado por el usuario). Los montos (bruto/aportes/contribuciones/neto) siguen en $0 porque `nom_categorias.basico = 0` en el seed — **pendiente de resolver, ver abajo**.

## Por qué quedó pendiente (y por qué no seguir por SQL)

El plan original asumía cargar el básico real con un `UPDATE`/`INSERT` manual en `nom_categorias` vía SQL Editor. El usuario aclaró que **no quiere hacerlo así**: la idea es que los usuarios de la app carguen las escalas salariales, aportes, contribuciones y otros conceptos desde un **menú de configuración dentro de la propia app** (no editando la base a mano). Ese menú todavía no existe — es el trabajo que sigue.

## Qué diseñar/implementar a continuación

1. **UI de configuración de escalas salariales**: pantalla para crear/editar filas de `nom_categorias` (convenio, nombre de categoría, básico, vigencia_desde) con historial versionado — hoy la tabla ya soporta versionado por `(convenio_id, nombre, vigencia_desde)`, pero no hay CRUD en la UI.
2. **UI de conceptos/reglas**: `nom_conceptos` y `nom_concepto_reglas` (aportes del trabajador, contribuciones patronales, otros conceptos) hoy se cargan por seed/SQL (`0005_conceptos_y_reglas.sql`). Definir si el usuario podrá crear conceptos nuevos con fórmulas propias desde la UI, o solo ajustar porcentajes/topes de los conceptos existentes — esto tiene implicancias de seguridad (fórmulas son código que corre en `liquidarConceptos`, revisar `packages/motor/src/motor.ts` / `interprete.ts` antes de exponer edición libre).
3. **`nom_parametros`** (ej. `tope_sipa`): mismo patrón, necesita UI de alta/edición versionada por vigencia.
4. Revisar permisos: estas pantallas tocan tablas que hoy solo tienen GRANT a `service_role` desde la Edge Function — si se editan desde el cliente (RLS con usuario autenticado), hay que revisar policies (ver migraciones 0007/0009/0010).

## Pendiente operativo (no bloqueante, para cuando haya escala real)

Una vez exista el menú, o si se quiere probar antes con un valor real a mano:

```sql
INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde)
SELECT convenio_id, nombre, <MONTO_REAL>, DATE '<FECHA_VIGENCIA>'
FROM nom_categorias
WHERE id = (SELECT categoria_id FROM nom_legajo WHERE cuil IS NOT NULL LIMIT 1);
```

Después recalcular el período desde la UI y contrastar contra el reporte de Presencio de la misma quincena (Task 7 del plan original, punto 3 — anotar discrepancias, no ajustar el motor para forzar que coincida sin entender por qué).

## Nota técnica de entorno (no relevante para el diseño, sí para quien ejecute)

Durante la implementación, el sandbox usado para escribir el código no podía borrar archivos de lock de git (`.git/index.lock`, etc.) en la carpeta montada del usuario — el usuario tuvo que borrarlos manualmente varias veces desde su Mac para que los commits se completaran. Si se retoma el trabajo desde un entorno con las mismas restricciones, tenerlo en cuenta.
