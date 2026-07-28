# Diseño — Períodos calculados por convenio (modalidad mensual/quincenal)

## Contexto

Hoy "Nuevo período" (LiquidacionPage, pestaña "Períodos generales") pide un tipo y dos fechas libres (desde/hasta) tipeadas a mano. La única distinción automática que existe es `nom_legajo.fuera_convenio`: si es `true` cobra por `mensual_fc`, si no, por quincena (`quincena_1`/`quincena_2`) — un período `mensual` "a secas" no filtra a nadie (migración 0033). No hay noción de que un convenio en sí sea mensual o quincenal, ni de fechas de corte configurables, ni una forma de dar de alta un convenio nuevo desde la UI (solo existe "clonar" un convenio global vía función de superadmin).

Esto genera dos problemas concretos:
1. Cargar fechas a mano es tedioso y con el tiempo acumula inconsistencias (ver también la queja de UI de la sesión anterior sobre el selector de período).
2. Si una empresa tuviera dos convenios quincenales con distintas fechas de corte, hoy no hay forma de representarlo — todo período quincenal usa las fechas que el usuario tipeó, sin atarlas a un convenio.

## Alcance

Este diseño cubre:
1. Modalidad (mensual/quincenal) y fechas de corte configurables por convenio.
2. Selector de "Nuevo período" por Año/Mes/Tipo(/Convenio), con fechas auto-calculadas.
3. Filtro de personal en `liquidar-periodo` basado en `período.convenio_id` en vez del flag binario actual.
4. Alta de convenios nuevos desde Configuración (formulario propio, no solo clonado).
5. Reutilizar `<SelectorPeriodo>` en `ReportesPage` (hoy tiene su propio `<select>` con formato crudo).

Fuera de alcance (confirmado con el usuario): el flujo de vacaciones en Liquidaciones individuales ya usa las fechas reales de la ausencia — no se toca. SAC (`sac_1`/`sac_2`) no cambia. `mensual_fc` (fuera de convenio) sigue basado únicamente en `legajo.fuera_convenio`, sin `convenio_id` — se mantiene como caso aparte, no se unifica con los convenios reales.

## Modelo de datos

### `nom_convenios` (ALTER)

```sql
ALTER TABLE nom_convenios
  ADD COLUMN IF NOT EXISTS modalidad TEXT NOT NULL DEFAULT 'quincenal'
    CHECK (modalidad IN ('mensual','quincenal')),
  ADD COLUMN IF NOT EXISTS corte_q1_desde INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS corte_q1_hasta INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS corte_q2_desde INT NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS corte_q2_hasta INT,          -- NULL = fin de mes
  ADD COLUMN IF NOT EXISTS corte_mensual_desde INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS corte_mensual_hasta INT;      -- NULL = fin de mes
```

Días representados como enteros 1-31; `NULL` en un "hasta" significa "último día real del mes" (resuelve automáticamente febrero bisiesto/no bisiesto y meses de 30 días). Si un valor configurado excede el último día real del mes, se recorta a ese último día.

### `nom_periodos` (ALTER)

```sql
ALTER TABLE nom_periodos ADD COLUMN IF NOT EXISTS convenio_id UUID REFERENCES nom_convenios(id);
```

Nullable. Se completa para períodos `quincena_1`/`quincena_2`/`mensual`. Queda `NULL` para `mensual_fc`, `sac_1`, `sac_2` y períodos legado ya existentes (no se migran datos viejos).

## Cálculo de fechas

Nueva función pura en `src/utils/calcularFechasPeriodo.js`:

```js
calcularFechasPeriodo({ anio, mes, tipo, convenio }) → { fechaDesde: 'YYYY-MM-DD', fechaHasta: 'YYYY-MM-DD' }
```

- `tipo === 'mensual'`: usa `convenio.corteMensualDesde/Hasta`.
- `tipo === 'mensual_fc'`: usa el default fijo 1 → fin de mes (no depende de ningún convenio, ya que fuera de convenio no tiene `convenio_id`).
- `tipo === 'quincena_1'`: usa `convenio.corteQ1Desde/Hasta`.
- `tipo === 'quincena_2'`: usa `convenio.corteQ2Desde/Hasta`.
- `tipo === 'sac_1' | 'sac_2'`: sin cambios respecto al comportamiento actual (rangos semestrales fijos ya existentes en el código — no se tocan).

Fin de mes: `new Date(anio, mes, 0).getDate()`. Cualquier "hasta" `NULL` o mayor al último día real se resuelve a ese último día.

## `liquidar-periodo` (edge function)

Reemplaza:

```ts
const esPeriodoFueraConvenio = periodo.tipo === 'mensual_fc'
const esPeriodoQuincenal = periodo.tipo === 'quincenal' || periodo.tipo === 'quincena_1' || periodo.tipo === 'quincena_2'
let personalAProcesar = (personal || []).filter((p) => {
  const l = legajoPorPersonal.get(p.id)
  if (esPeriodoFueraConvenio) return l?.fuera_convenio === true
  if (esPeriodoQuincenal) return l?.fuera_convenio !== true
  return true
})
```

por:

```ts
const esPeriodoFueraConvenio = periodo.tipo === 'mensual_fc'
let personalAProcesar = (personal || []).filter((p) => {
  const l = legajoPorPersonal.get(p.id)
  if (esPeriodoFueraConvenio) return l?.fuera_convenio === true
  if (periodo.convenio_id) return l?.convenio_id === periodo.convenio_id && l?.fuera_convenio !== true
  // períodos legado sin convenio_id (sac, datos viejos): comportamiento actual sin filtrar
  return l?.fuera_convenio !== true
})
```

Esto es estrictamente más específico que el filtro actual (antes "todo quincenal no fuera de convenio", ahora "todo período de ESE convenio no fuera de convenio") — no rompe el caso de una sola convenio quincenal (comportamiento idéntico), y habilita el caso de dos convenios quincenales con fechas distintas sin cruzarse.

## UI — "Nuevo período" (LiquidacionPage, pestaña Períodos generales)

Reemplaza los inputs "Desde"/"Hasta" (`<input type="date">`) por:
- Select **Año** (rango razonable: año actual ± 2, o derivado de períodos existentes).
- Select **Mes** (Enero..Diciembre).
- Select **Tipo**: Mensual / 1ra quincena / 2da quincena / SAC 1 / SAC 2 / Fuera de convenio (mensual).
- Si el tipo es Mensual/1ra quincena/2da quincena: select **Convenio**, poblado con los convenios de la empresa que tengan la modalidad correspondiente (mensual→convenios modalidad='mensual', quincena→modalidad='quincenal'). Si hay exactamente uno, se preselecciona y no hace falta tocarlo pero se muestra igual (transparencia de qué convenio se está liquidando). Si hay cero, se deshabilita "Crear" con mensaje "no hay ningún convenio con modalidad X configurado".
- Fechas resultantes (`calcularFechasPeriodo`) se muestran como texto de solo lectura antes de confirmar, no se tipean.

`handleCrearPeriodo` pasa a insertar `convenio_id` además de `tipo`/`fecha_desde`/`fecha_hasta`.

## Configuración → pestaña "Convenios" (nueva)

Nuevo componente `TabConvenios.jsx`, agregado a `ConfiguracionPage.jsx` junto a las pestañas existentes (Escalas, Aportes, etc.).

- Lista los convenios de la empresa (nombre, régimen, modalidad, fechas de corte resumidas).
- Botón "Nuevo convenio": formulario con nombre, régimen (LCT/22250), modalidad (mensual/quincenal), y las fechas de corte correspondientes a la modalidad elegida, precargadas con los defaults (1-15/16-fin o 1-fin) y editables.
- Cada convenio existente es editable: cambiar modalidad y/o fechas de corte (guarda contra `nom_convenios`).
- Reutiliza `useConveniosStore`, se le agrega una acción `crearConvenio` y `actualizarConvenio`.

## Reportes

`ReportesPage.jsx` reemplaza su `<select>` propio (línea ~154-159, formato `"quincenal — 2026-07-01 a 2026-07-15 (abierto)"`) por `<SelectorPeriodo periodos={periodos} value={periodoId} onChange={setPeriodoId} />`, igual que `LiquidacionPage`.

## Testing

- `src/utils/__tests__/calcularFechasPeriodo.test.js`: quincena 2 en meses de 30 y 31 días, mensual en febrero bisiesto (2028) y no bisiesto (2026), corte custom (ej. q1 6→20), `mensual_fc` ignora convenio.
- Edge function `liquidar-periodo`: test de filtro por `convenio_id` (dos convenios quincenales, cada período solo liquida al suyo) — se agrega junto a los tests existentes de filtrado fuera_convenio/quincenal.
- `TabConvenios.jsx`: alta de convenio nuevo, edición de modalidad/fechas.
- `LiquidacionPage` / formulario "Nuevo período": selección Año/Mes/Tipo/Convenio arma correctamente el insert con `convenio_id` y fechas calculadas.
- `ReportesPage`: usa `<SelectorPeriodo>` y agrupa por año igual que Liquidación.

## Fuera de alcance / no se toca

- Vacaciones en Liquidaciones individuales (ya resuelto con fechas de la ausencia real).
- SAC (`sac_1`/`sac_2`): fechas semestrales fijas, sin cambios.
- Migración de períodos ya creados a `convenio_id` (quedan con `NULL`, comportamiento legado sin filtrar por convenio).
- Unificar "fuera de convenio" como un convenio más (se descartó explícitamente: sigue siendo un caso aparte, sin `convenio_id`).
