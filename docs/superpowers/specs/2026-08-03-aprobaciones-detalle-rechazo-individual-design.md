# Aprobaciones con detalle por recibo y rechazo individual — Design

**Fecha:** 2026-08-03
**Reemplaza el alcance original de Task 4.1** del plan `docs/superpowers/plans/2026-07-31-produccion-pyme-ejecucion-sonnet5.md` (que solo pedía agregados y link a detalle). El usuario pidió, además, ver el detalle de cada recibo dentro de la pantalla de Aprobaciones y poder rechazar el pago de una persona puntual sin frenar el resto del período.

## Contexto / gap encontrado

Hoy la aprobación corre a nivel **período completo**: `nom_flujo_instancias` (una fila por período) avanza de paso vía la RPC `avanzar_flujo(instancia_id, accion, comentario)`. No existe ningún estado de aprobación a nivel de recibo individual (`nom_liquidaciones`). Rechazar "una persona" hoy no es posible sin rechazar el período entero.

**Decisión del usuario:** rechazar el pago de una persona no debe frenar el resto del período. Se necesita un estado de aprobación independiente por recibo, que convive con el flujo de instancia existente (que no se toca).

## Modelo de datos (migración `0054_revision_liquidaciones.sql`)

Columnas nuevas en `nom_liquidaciones`:
- `estado_revision TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_revision IN ('pendiente','aprobado','rechazado'))`
- `motivo_rechazo TEXT`
- `revisado_por UUID`
- `revisado_en TIMESTAMPTZ`

No se crea tabla de auditoría aparte (a diferencia de `nom_aprobaciones`): alcanza con el estado actual por recibo para el caso de uso (decidir a quién se le paga este run). Si en el futuro se necesita historial de cambios de estado por recibo, se agrega entonces (YAGNI).

### RPC `revisar_liquidacion(p_liquidacion_id UUID, p_accion TEXT, p_comentario TEXT DEFAULT NULL)`

`SECURITY DEFINER`, mismo patrón de autorización que `avanzar_flujo` (migración 0015): no se otorga `UPDATE` directo sobre las columnas nuevas a `authenticated`, todo pasa por la función para no poder saltear la validación de rol.

Cuerpo:
1. Busca la liquidación y su `periodo_id` → `empresa_id`.
2. Busca la instancia de flujo (`nom_flujo_instancias`) de ese período y su `paso_actual`. Si no hay instancia o paso actual, exige que el usuario sea admin/dueño de la empresa (o superadmin) — no puede haber revisión por recibo si el período nunca entró a un circuito de aprobación.
3. Autorización: misma lógica que `avanzar_flujo` — `is_superadmin()`, o dueño/admin de la empresa con `rol_requerido IN ('admin','revisor_interno')`, o rol puente en `nom_usuarios_empresas` que coincida con `rol_requerido` del paso actual.
4. Si `p_accion = 'rechazado'` y `p_comentario` es NULL o vacío (trim), `RAISE EXCEPTION 'motivo de rechazo obligatorio'`.
5. `UPDATE nom_liquidaciones SET estado_revision = p_accion, motivo_rechazo = p_comentario, revisado_por = auth.uid(), revisado_en = now() WHERE id = p_liquidacion_id`.
6. `REVOKE ALL ... FROM public; GRANT EXECUTE ... TO authenticated;` (igual que las RPC existentes).

## Store (`src/store/aprobacionesStore.js`)

- `cargarInstancias(empresaId)`: además de las instancias (igual que hoy), hace un segundo `select` a `nom_liquidaciones` filtrado por `periodo_id IN (...)` de las instancias cargadas, trayendo `id, periodo_id, personal_id, bruto, total_aportes, neto, detalle_horas, estado_revision, motivo_rechazo`. El nombre de la persona se resuelve con un select aparte a la vista `nom_v_personal(id, nombre)` (mismo patrón que usa `LiquidacionesIndividuales.jsx`) filtrado por los `personal_id` presentes, y se cruza en cliente por id — no hay columna `apellido` separada, `nombre` ya viene combinado en esa vista.
- Se agrupan esos recibos en el store como `recibosPorPeriodo: { [periodoId]: Recibo[] }`.
- Los agregados (`sum bruto`, `sum totalAportes`, `sum neto`, `count`) se calculan en el cliente reduciendo sobre `recibosPorPeriodo[periodoId]` — sin fetch aparte, sin RPC de agregación (ver justificación de performance/seguridad/escalabilidad ya discutida y aceptada).
- Nueva acción `revisarLiquidacion(id, accion, comentario)`: llama al RPC `revisar_liquidacion`, devuelve `{ok, error}` (mismo contrato que `actuar`). No hace refetch automático — la página decide cuándo recargar (para poder hacer varias revisiones en lote antes de refrescar, igual que hace `accionar` hoy con `actuar`).

## UI (`src/pages/AprobacionesPage.jsx`)

- Cada card de período (igual que hoy: badge de paso actual, checkbox y acciones para avanzar el período completo vía `actuar`/`avanzar_flujo` — **sin cambios** en esa parte) agrega debajo una tabla de recibos:
  - Columnas: persona, bruto, descuentos (total_aportes), neto, horas (de `detalle_horas`, mismo formato que ya usa `LiquidacionesIndividuales.jsx` si existe un helper — reusar, no reinventar), estado_revision (badge: pendiente/aprobado/rechazado), checkbox de selección.
  - Fila con `estado_revision !== 'pendiente'` se muestra atenuada/con el motivo de rechazo visible (`title` o texto chico) pero sigue permitiendo cambiar de estado (por si se revierte una decisión).
  - Barra de acciones por período: "Aprobar seleccionados" / "Rechazar seleccionados" (rechazar abre/exige un textarea de motivo obligatorio antes de habilitar el botón) — actúan en loop sobre `revisarLiquidacion` para cada id seleccionado, mismo patrón de manejo de error que `accionar` existente (corta en el primer error, no sigue con los siguientes).
  - Cada fila individual tiene sus propios botones Aprobar/Rechazar (rechazo individual exige motivo en un input/textarea de esa fila).
- Selección de recibos es **por período** (estado local `seleccionPorPeriodo: {[periodoId]: string[]}`), separada de la selección de períodos completos que ya existe para el flujo.
- Link "Ver detalle" del período → `/liquidacion?periodo=<id>`; en `LiquidacionPage.jsx` se agrega lectura de `useSearchParams` (`react-router-dom`) para preseleccionar `periodoSeleccionado` si el id viene en la URL y existe en la lista de períodos cargados (si no existe todavía —períodos no cargados aún— esperar a que `periodos` tenga datos antes de intentar el match, con un `useEffect` que dependa de `periodos`).
- Paginación de la lista de períodos con `usePaginado.js` (ya existe, reusar tal cual).
- Recarga al recuperar foco: `useEffect` con `window.addEventListener('focus', () => cargarInstancias(empresaActiva.id))` + cleanup, condicionado a que `empresaActiva?.id` exista.

## Testing

- `aprobacionesStore.test.js`: agregar casos para `cargarInstancias` trayendo recibos y calculando agregados correctos (incluyendo período sin recibos → agregados en 0), y para `revisarLiquidacion` (éxito, error del RPC, motivo vacío en rechazo si se valida también client-side como UX rápida antes de llamar al RPC — la validación autoritativa es la del RPC, pero conviene no gastar un round-trip si el textarea está vacío).
- `AprobacionesPage.test.jsx` (crear si no existe): selección múltiple de recibos, botón rechazar deshabilitado sin motivo, llamada a `revisarLiquidacion` con los ids correctos, badge de estado_revision se refleja tras recarga.

## Fuera de alcance

- No se toca `avanzar_flujo` ni el modelo de instancia de período — coexisten.
- No se agrega tabla de auditoría por recibo (ver nota arriba).
- No se cambia el criterio de "período cerrado"/emisión de recibos: `estado_revision` es informativo para decidir a quién pagar en este run, no bloquea el cierre del período (eso queda para una futura iteración si hace falta, no lo pidió el usuario).
