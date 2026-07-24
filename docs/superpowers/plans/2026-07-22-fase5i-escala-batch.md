# Fase 5I (Tasks 35-36) — Escala: liquidación por lotes + índices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar el N+1 de `liquidar-periodo` (hoy 2 queries por persona dentro del loop), hacerla reanudable con progreso visible, e indexar las tablas más consultadas — para que una empresa de 500+ empleados no la corte por timeout ni deje las pantallas lentas.

**Architecture:** Se mantiene la misma Edge Function (`supabase/functions/liquidar-periodo/index.ts`), pero se reemplazan las dos queries por-persona (fichajes, ausencias) por dos queries batched con `.in('personal_id', chunk)` antes del loop, y la escritura final (hoy `insert` uno por uno) por `upsert` en lotes de 50 aprovechando el `UNIQUE (periodo_id, personal_id)` que ya existe (`0007_periodos_liquidaciones.sql`). Progreso y reanudación viven en 3 columnas nuevas de `nom_periodos`. La lógica de agrupar filas por `personal_id` y de partir arrays en lotes se extrae como funciones puras testeables en `packages/motor/src/lotes.ts` (igual que `basico.ts`/`asistencia.ts`). Los índices de Task 36 van en la misma migración por ser el único número reservado que queda libre para esta sub-fase (`0027`, ver `docs/.../2026-07-21-fase5-correcciones-y-mejoras.md` §"Migraciones reservadas"). La paginación de listados se resuelve con un hook reutilizable `usePaginado` aplicado primero a `LegajosPage` (no depende de los filtros de la Fase 5D, que todavía no existen).

**Tech Stack:** React 19, Vite, Zustand, Supabase (Postgres + Edge Functions Deno), Vitest.

**Decisiones de alcance (para no explotar el tamaño de esta sub-fase):**
- El "self-chaining" de reanudación se hace desde el cliente (el store reintenta automáticamente con `reanudar: true` mientras la respuesta indique `completo: false`), no con colas ni cron — igual que documenta la Decisión 10 del plan maestro.
- La búsqueda server-side de `LegajosPage`/`LiquidacionPage` (Tasks 7 y 13 "pasan a server-side" cuando la empresa supera 200 legajos) queda para cuando exista una empresa de ese tamaño para probar contra datos reales; acá se deja el hook `usePaginado` listo y aplicado a `LegajosPage` (paginación pura, sin búsqueda server-side todavía — `LegajosPage` hoy no tiene búsqueda, es Task 13 de la Fase 5D, no ejecutada aún).

---

## Task 35: Migración 0027 — índices, UNIQUE y progreso de cálculo

**Files:**
- Create: `supabase/migrations/0027_indices_escala.sql`

- [ ] **Step 1:** Crear la migración completa:

```sql
-- 0027_indices_escala.sql
-- Índices para las consultas más frecuentes a escala (Fase 5I, Tasks 35-36)
-- y columnas de progreso/reanudación para liquidar-periodo por lotes.
-- nom_liquidaciones ya tiene UNIQUE (periodo_id, personal_id) desde
-- 0007_periodos_liquidaciones.sql — no se repite acá.

CREATE INDEX IF NOT EXISTS nom_liquidacion_items_liquidacion_idx
  ON nom_liquidacion_items (liquidacion_id);

CREATE INDEX IF NOT EXISTS nom_categorias_vigencia_idx
  ON nom_categorias (convenio_id, nombre, vigencia_desde DESC);

CREATE INDEX IF NOT EXISTS nom_no_remunerativos_vigencia_idx
  ON nom_no_remunerativos (convenio_id, categoria_nombre, vigencia_desde DESC);

CREATE INDEX IF NOT EXISTS nom_legajo_empresa_baja_idx
  ON nom_legajo (empresa_id, fecha_baja);

-- Progreso de liquidación por lotes: permite a la UI mostrar una barra y al
-- cliente reintentar con `reanudar: true` sin recalcular a quienes ya
-- quedaron liquidados en esta corrida (ver liquidar-periodo/index.ts).
ALTER TABLE nom_periodos
  ADD COLUMN IF NOT EXISTS calculo_estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (calculo_estado IN ('pendiente','calculando','completo','error')),
  ADD COLUMN IF NOT EXISTS calculo_procesados INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calculo_total INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN nom_periodos.calculo_estado IS 'estado de la ultima corrida de liquidar-periodo: pendiente|calculando|completo|error';
```

- [ ] **Step 2:** Avisar al usuario que la aplique en Supabase (SQL Editor) antes de probar el resto de esta tarea.
- [ ] **Step 3:** Commit: `git add supabase/migrations/0027_indices_escala.sql && git commit -m "feat(db): migracion 0027 indices de escala y progreso de calculo por lotes"`

## Task 36: Helpers puros de lotes (`packages/motor/src/lotes.ts`)

**Files:**
- Create: `packages/motor/src/lotes.ts`
- Create: `packages/motor/src/lotes.test.ts`

- [ ] **Step 1: Test que falla**

```ts
// packages/motor/src/lotes.test.ts
import { describe, it, expect } from 'vitest'
import { partirEnLotes, agruparPorPersonalId } from './lotes'

describe('partirEnLotes', () => {
  it('parte un array en lotes del tamaño pedido', () => {
    expect(partirEnLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('un array vacio da un array de lotes vacio', () => {
    expect(partirEnLotes([], 50)).toEqual([])
  })
  it('un array mas chico que el lote da un solo lote', () => {
    expect(partirEnLotes([1, 2], 50)).toEqual([[1, 2]])
  })
})

describe('agruparPorPersonalId', () => {
  it('agrupa filas por personal_id en un Map de arrays', () => {
    const filas = [
      { personal_id: 'a', tipo: 'entrada' },
      { personal_id: 'b', tipo: 'entrada' },
      { personal_id: 'a', tipo: 'salida' },
    ]
    const r = agruparPorPersonalId(filas)
    expect(r.get('a')).toEqual([{ personal_id: 'a', tipo: 'entrada' }, { personal_id: 'a', tipo: 'salida' }])
    expect(r.get('b')).toEqual([{ personal_id: 'b', tipo: 'entrada' }])
  })
  it('personal_id sin filas devuelve array vacio al hacer .get(...) ?? []', () => {
    const r = agruparPorPersonalId([])
    expect(r.get('inexistente') ?? []).toEqual([])
  })
})
```

- [ ] **Step 2:** Run `npx vitest run packages/motor/src/lotes.test.ts` → Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima**

```ts
// packages/motor/src/lotes.ts
// Helpers puros para procesar la liquidación de un período en lotes (Fase
// 5I): partir los personal_ids en grupos manejables por la Edge Function
// (chunks para .in(), lotes de escritura) y agrupar filas ya traídas de una
// sola query batched (fichajes, ausencias) por persona, sin volver a pegarle
// a la base dentro de un loop.

export function partirEnLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano))
  }
  return lotes
}

export function agruparPorPersonalId<T extends { personal_id: string }>(filas: T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const fila of filas) {
    const lista = mapa.get(fila.personal_id)
    if (lista) lista.push(fila)
    else mapa.set(fila.personal_id, [fila])
  }
  return mapa
}
```

- [ ] **Step 4:** Run → Expected: PASS (5 tests). Commit: `git add packages/motor/src/lotes.ts packages/motor/src/lotes.test.ts && git commit -m "feat(motor): helpers puros para lotes y agrupado por personal_id"`

## Task 37: `liquidar-periodo` sin N+1, por lotes, con progreso y reanudable [⚙️ esfuerzo medio]

**Contexto exacto del archivo actual** (397 líneas, ya leído completo): dentro del `for (const persona of personal || [])` (línea ~276) hay DOS queries por persona (`nom_v_horas_dia` y `nom_v_ausencias`, líneas 292-295) — ese es el N+1 a eliminar. Al final (líneas 365-382) hay OTRO loop que hace `insert` de a una liquidación + un `insert` de sus items — también N+1 de escritura. La lectura de básico/no-remunerativo YA está cacheada por `${convenioId}:${nombre}` (líneas 188-199) y NO se toca en esta tarea.

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts`

- [ ] **Step 1: Leer el body también acepta `reanudar`.** Cambiar la desestructuración del body (línea 46):

```ts
const { periodoId, personalIds, reanudar } = await req.json()
```

- [ ] **Step 2: Si `reanudar === true`, excluir personas ya liquidadas en esta corrida.** Justo después de armar `personal` (línea 84, tras el `errLectura` check de la línea 91-96), agregar:

```ts
  let personalAProcesar = personal || []
  if (reanudar) {
    const { data: yaLiquidados } = await supabase.from('nom_liquidaciones')
      .select('personal_id').eq('periodo_id', periodoId)
    const idsYaLiquidados = new Set((yaLiquidados || []).map((l: any) => l.personal_id))
    personalAProcesar = personalAProcesar.filter((p: any) => !idsYaLiquidados.has(p.id))
  }
```

  (usar `personalAProcesar` en vez de `personal` en el resto de la función, incluyendo el loop principal y el cálculo de `categoriaIds`/`legajoPorPersonal` lookups que iteran sobre personas — el resto de esas partes ya usa `legajos`/`legajoPorPersonal` que están indexados por `personal_id` y no necesitan cambios).

- [ ] **Step 3: Marcar el período como `calculando` con el total real, apenas se sabe cuánta gente hay que procesar.** Justo después del Step 2 (antes del bloque de consolidación quincenal, línea ~99):

```ts
  await supabase.from('nom_periodos').update({
    calculo_estado: 'calculando',
    calculo_total: (personal || []).length,
    calculo_procesados: (personal || []).length - personalAProcesar.length,
  }).eq('id', periodoId)
```

- [ ] **Step 4: Batch de fichajes y ausencias — reemplazar el N+1.** Antes del `for (const persona of personalAProcesar)` (línea 276, usar `personalAProcesar` en vez de `personal`), agregar la lectura batched, usando `partirEnLotes`/`agruparPorPersonalId` del Step de Task 36:

```ts
  import { partirEnLotes, agruparPorPersonalId } from '../../../packages/motor/src/lotes.ts'
```

  (agregar este import junto a los demás imports de `packages/motor` al principio del archivo, línea 3-5).

```ts
  const idsAProcesar = personalAProcesar.map((p: any) => p.id)
  const fichajesTodos: any[] = []
  const ausenciasTodas: any[] = []
  for (const lote of partirEnLotes(idsAProcesar, 100)) {
    const [{ data: f, error: eF }, { data: a, error: eA }] = await Promise.all([
      supabase.from('nom_v_horas_dia').select('*').in('personal_id', lote)
        .gte('timestamp', periodo.fecha_desde).lte('timestamp', periodo.fecha_hasta),
      supabase.from('nom_v_ausencias').select('*').in('personal_id', lote).eq('estado', 'aprobada'),
    ])
    if (eF || eA) {
      const e = eF || eA
      await supabase.from('nom_periodos').update({ calculo_estado: 'error' }).eq('id', periodoId)
      return new Response(JSON.stringify({ error: `error al leer asistencia en lote: ${e!.message}`, code: e!.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    fichajesTodos.push(...(f || []))
    ausenciasTodas.push(...(a || []))
  }
  const fichajesPorPersona = agruparPorPersonalId(fichajesTodos)
  const ausenciasPorPersona = agruparPorPersonalId(ausenciasTodas)
```

  Dentro del loop `for (const persona of personalAProcesar)`, **eliminar** por completo las dos queries actuales (líneas 292-301: `const { data: fichajes, error: errFichajes } = ...` hasta el `if (errFichajes || errAusencias) {...}` incluido) y reemplazarlas por:

```ts
    const fichajes = fichajesPorPersona.get(persona.id) ?? []
    const ausencias = ausenciasPorPersona.get(persona.id) ?? []
```

- [ ] **Step 5: Escritura por lotes con `upsert` — reemplazar el loop final de inserts.** Reemplazar TODO el bloque desde `for (const r of resultados) {` hasta su cierre (líneas 365-382) por:

```ts
  for (const loteResultados of partirEnLotes(resultados, 50)) {
    const filasLiquidacion = loteResultados.map((r) => ({
      empresa_id: periodo.empresa_id, periodo_id: periodoId, personal_id: r.personalId,
      bruto: r.resultado.bruto, neto: r.resultado.neto, total_aportes: r.resultado.totalDescuentos,
      total_contribuciones: r.resultado.items
        .filter((i) => i.tipo === 'aporte_patronal')
        .reduce((s, i) => s + i.monto, 0),
      detalle_horas: r.asistencia, estado: 'preliminar',
    }))
    const { data: liqsLote, error: errUpsert } = await supabase.from('nom_liquidaciones')
      .upsert(filasLiquidacion, { onConflict: 'periodo_id,personal_id' })
      .select('id, personal_id')
    if (errUpsert) {
      await supabase.from('nom_periodos').update({ calculo_estado: 'error' }).eq('id', periodoId)
      return new Response(JSON.stringify({ error: `error al guardar liquidaciones: ${errUpsert.message}`, code: errUpsert.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const liqIdPorPersonal = new Map((liqsLote || []).map((l: any) => [l.personal_id, l.id]))
    // Idempotencia de items: al re-liquidar (ej. tras un reanudar parcial de
    // un intento anterior fallido) hay que limpiar los items viejos de estas
    // liquidaciones antes de reinsertar, si no se duplican.
    const idsLote = [...liqIdPorPersonal.values()]
    if (idsLote.length > 0) {
      await supabase.from('nom_liquidacion_items').delete().in('liquidacion_id', idsLote)
    }
    const itemsLote = loteResultados.flatMap((r) => {
      const liqId = liqIdPorPersonal.get(r.personalId)
      if (!liqId) return []
      return r.resultado.items.map((i) => ({
        empresa_id: periodo.empresa_id, liquidacion_id: liqId, concepto_codigo: i.codigo,
        concepto_nombre: i.nombre, tipo: i.tipo, monto: i.monto, regla_aplicada: String(i.reglaAplicada),
      }))
    })
    if (itemsLote.length > 0) {
      await supabase.from('nom_liquidacion_items').insert(itemsLote)
    }
    await supabase.from('nom_periodos').update({
      calculo_procesados: (personal.length - personalAProcesar.length) + loteResultados.length +
        ((personal || []).length - personalAProcesar.length === 0 ? 0 : 0), // ver nota abajo
    }).eq('id', periodoId)
  }
```

  **Nota de implementación (resolver al escribir, el placeholder de arriba es intencionalmente ilustrativo del problema, no código final):** `calculo_procesados` debe acumular lote a lote, no recalcularse mal. Usar una variable local `let procesadosAcumulados = (personal.length - personalAProcesar.length)` declarada ANTES del `for (const loteResultados of partirEnLotes(...))`, incrementarla `procesadosAcumulados += loteResultados.length` dentro del loop, y usar ese valor en el `update`. Esto reemplaza la expresión inline confusa de arriba.

  El borrado idempotente de liquidaciones/items previos que hoy existe ANTES del loop principal (líneas 354-363, `queryPrevias`/`liquidacionesPrevias`) **se elimina por completo** — el `upsert` con `onConflict: 'periodo_id,personal_id'` ya lo reemplaza sin necesidad de borrar-todo-y-reinsertar primero (evita el bug de la Task 7 donde ese borrado podía alcanzar liquidaciones fuera del scope de `personalIds`).

- [ ] **Step 6: Marcar `completo` al final y devolver el flag en la respuesta.** Reemplazar el `return new Response(JSON.stringify({ liquidadas: ... }))` final (línea 384) por:

```ts
  const totalFinal = (personal || []).length
  const procesadosFinal = (personal.length - personalAProcesar.length) + resultados.length
  const completo = procesadosFinal >= totalFinal
  await supabase.from('nom_periodos').update({
    calculo_estado: completo ? 'completo' : 'calculando',
    calculo_procesados: procesadosFinal,
  }).eq('id', periodoId)

  return new Response(JSON.stringify({ liquidadas: resultados.length, omitidos, advertencias, completo, procesados: procesadosFinal, total: totalFinal }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
```

  (con `personalIds` acotado como hoy, `total` termina siendo el tamaño del subconjunto pedido, igual que `personal.length` ya se calculaba filtrado por `personalIds` en la query original — comportamiento sin cambios para ese caso, solo se agrega la info de progreso).

- [ ] **Step 7: Catch general también marca error.** El bloque `catch (err)` final (línea 387) hoy está fuera del scope donde `periodoId` y `supabase` quedaron declarados (ambos se declaran dentro del `try`). Para poder marcar `calculo_estado: 'error'` incluso en un fallo no contemplado, mover las dos declaraciones fuera del `try`, antes de la línea 45 (`try {`):

```ts
  let periodoId: string | undefined
  let supabase: ReturnType<typeof createClient> | undefined
  try {
    const body = await req.json()
    periodoId = body.periodoId
    const personalIds = body.personalIds
    const reanudar = body.reanudar
    supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
```

  (reemplaza la línea `const { periodoId, personalIds, reanudar } = await req.json()` y la línea siguiente de `createClient` — el resto del código del `try` sigue usando `periodoId`/`personalIds`/`reanudar`/`supabase` sin cambios, ya que siguen siendo las mismas variables, solo declaradas un nivel más arriba). Luego, en el `catch (err)`:

```ts
  } catch (err) {
    if (periodoId && supabase) {
      await supabase.from('nom_periodos').update({ calculo_estado: 'error' }).eq('id', periodoId)
    }
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
```

- [ ] **Step 8:** `npx vitest run` completo → PASS, sin regresiones (motor no cambia su comportamiento, solo se le agregan 2 funciones puras ya testeadas en Task 36). Commit: `git add supabase/functions/liquidar-periodo/index.ts && git commit -m "perf(liquidacion): liquidar-periodo sin N+1, escritura por lotes con upsert, progreso y reanudable"`
- [ ] **Step 9:** Recordar al usuario: `supabase functions deploy liquidar-periodo`.

## Task 38: UI de progreso y reintento automático

**Files:**
- Modify: `src/store/liquidacionStore.js` (función que llama a `liquidar-periodo`: reintentar con `reanudar: true` mientras `completo === false`)
- Modify: `src/pages/LiquidacionPage.jsx` (barra de progreso durante el cálculo)
- Test: `src/store/__tests__/liquidacionStore.test.js`

- [ ] **Step 1: Leer primero** `src/store/liquidacionStore.js` completo para ubicar la función que invoca `supabase.functions.invoke('liquidar-periodo', ...)` (nombre exacto a confirmar al leer; se asume `calcular` o `liquidarPeriodo` — usar el nombre real del archivo).

- [ ] **Step 2: Test que falla** (adaptar el nombre de la función y el mock de `supabase.functions.invoke` al patrón ya usado en el archivo real):

```js
// agregar a src/store/__tests__/liquidacionStore.test.js
it('reintenta con reanudar:true hasta que la respuesta indica completo', async () => {
  const invoke = vi.fn()
    .mockResolvedValueOnce({ data: { liquidadas: 50, omitidos: [], advertencias: [], completo: false, procesados: 50, total: 120 }, error: null })
    .mockResolvedValueOnce({ data: { liquidadas: 70, omitidos: [], advertencias: [], completo: true, procesados: 120, total: 120 }, error: null })
  supabase.functions.invoke = invoke
  await useLiquidacionStore.getState().calcular('periodo-1')
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(invoke.mock.calls[1][1].body.reanudar).toBe(true)
})
```

- [ ] **Step 3:** Run → FAIL (o PASS-por-casualidad si ya reintentaba; en ese caso ajustar el test para que sea un cambio real de comportamiento observable, no un no-op).

- [ ] **Step 4: Implementación.** En la función del store que invoca `liquidar-periodo`, envolver la llamada en un loop:

```js
async function invocarConReintento(body) {
  let respuesta = await supabase.functions.invoke('liquidar-periodo', { body })
  let intentos = 1
  while (!respuesta.error && respuesta.data?.completo === false && intentos < 20) {
    respuesta = await supabase.functions.invoke('liquidar-periodo', { body: { ...body, reanudar: true } })
    intentos += 1
  }
  return respuesta
}
```

  (el tope `intentos < 20` evita un loop infinito si algo queda mal marcado en `calculo_estado`; con lotes de 50 personas por invocación, 20 vueltas cubren 1000 personas, más que el objetivo de 500-1000 de la Decisión 10 del plan maestro). Usar `invocarConReintento` en vez de la llamada directa a `supabase.functions.invoke` dentro de la función de cálculo del store, y exponer en el estado del store `calculando: boolean` mientras el loop corre.

- [ ] **Step 5:** Run → PASS. `npx vitest run` completo → PASS.

- [ ] **Step 6: UI.** En `LiquidacionPage.jsx`, mientras `calculando` es `true`, mostrar un `<div className="card">Calculando liquidación… (puede tardar unos segundos con muchos empleados)</div>` en vez de (o antes que) la tabla — sin necesidad de leer `calculo_procesados`/`calculo_total` por polling en esta vuelta (el reintento del store ya es transparente para el usuario; una barra con progreso exacto por polling queda como mejora futura si una empresa real de 500+ lo pide, para no sobre-construir sin datos reales que la justifiquen — anotar esta decisión en el commit).

- [ ] **Step 7:** Commit: `git add src/store/liquidacionStore.js src/store/__tests__/liquidacionStore.test.js src/pages/LiquidacionPage.jsx && git commit -m "feat(liquidacion): reintento automatico de liquidar-periodo hasta completar y aviso de calculo en curso"`

## Task 39: `usePaginado` + paginación en `LegajosPage`

**Files:**
- Create: `src/hooks/usePaginado.js`
- Create: `src/hooks/__tests__/usePaginado.test.js`
- Modify: `src/pages/LegajosPage.jsx`

- [ ] **Step 1: Test que falla**

```js
// src/hooks/__tests__/usePaginado.test.js
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePaginado } from '../usePaginado'

describe('usePaginado', () => {
  it('arranca en la pagina 0 con el tamano de pagina pedido', () => {
    const { result } = renderHook(() => usePaginado(50))
    expect(result.current.pagina).toBe(0)
    expect(result.current.rango).toEqual([0, 49])
  })

  it('siguientePagina avanza el rango un tamano de pagina', () => {
    const { result } = renderHook(() => usePaginado(50))
    act(() => result.current.siguientePagina())
    expect(result.current.pagina).toBe(1)
    expect(result.current.rango).toEqual([50, 99])
  })

  it('reset vuelve a la pagina 0 (para cuando cambia un filtro)', () => {
    const { result } = renderHook(() => usePaginado(50))
    act(() => result.current.siguientePagina())
    act(() => result.current.reset())
    expect(result.current.pagina).toBe(0)
  })

  it('hayMasPaginas es true si el total supera lo cargado hasta ahora', () => {
    const { result } = renderHook(() => usePaginado(50))
    expect(result.current.hayMasPaginas(120)).toBe(true)
    act(() => result.current.siguientePagina())
    act(() => result.current.siguientePagina())
    expect(result.current.hayMasPaginas(120)).toBe(false) // ya cubrio 0-149
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/hooks/__tests__/usePaginado.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima**

```js
// src/hooks/usePaginado.js
import { useCallback, useState } from 'react'

// Paginación server-side genérica con .range() de Supabase: pagina es el
// índice de la ÚLTIMA página cargada (arranca en 0), rango es [desde, hasta]
// ACUMULADO desde la página 0 (para poder pedir "las primeras N páginas
// juntas" con un solo .range(), que es el patrón de "cargar más" que usa
// LegajosPage — no reemplaza la página anterior, la extiende).
export function usePaginado(tamanoPagina) {
  const [pagina, setPagina] = useState(0)

  const rango = [0, (pagina + 1) * tamanoPagina - 1]

  const siguientePagina = useCallback(() => setPagina((p) => p + 1), [])
  const reset = useCallback(() => setPagina(0), [])
  const hayMasPaginas = useCallback((total) => rango[1] + 1 < total, [rango])

  return { pagina, rango, siguientePagina, reset, hayMasPaginas }
}
```

- [ ] **Step 4:** Run → PASS (4 tests). Commit: `git add src/hooks/usePaginado.js src/hooks/__tests__/usePaginado.test.js && git commit -m "feat(escala): hook usePaginado reutilizable para listados server-side"`

- [ ] **Step 5: Aplicar en `LegajosPage.jsx`.** Leer el archivo completo (ya listado arriba en el contexto de esta sesión, 79 líneas). Modificar:
  - Importar `usePaginado` y `useAuthStore` (ya importado) + agregar `const { rango, siguientePagina, reset, hayMasPaginas } = usePaginado(100)`.
  - En la query de `nom_v_personal` (línea 23), agregar `.select('id, nombre, dni, puesto, estado', { count: 'estimated' })` (agregar `count` al select existente) y encadenar `.range(rango[0], rango[1])`.
  - Guardar el `count` devuelto en un nuevo estado `const [total, setTotal] = useState(0)` y setearlo desde `error`-checked `count` de la respuesta de `qPersonal`.
  - Al cambiar `empresaActiva?.id`, llamar `reset()` antes de `cargar()` (para no arrastrar la página de la empresa anterior).
  - Agregar en el `useEffect` la dependencia `rango[1]` (para recargar al pedir más).
  - Debajo de la tabla, si `hayMasPaginas(total)`, mostrar `<button className="btn btn-ghost btn-sm" onClick={siguientePagina}>Cargar más</button>`.
  - **Importante:** la query de `nom_legajo` (línea 24) NO se pagina — sigue trayendo todos los legajos de la empresa (son livianos, sin esto el `Map` de lookup por `personal_id` quedaría incompleto para las filas de páginas ya cargadas). Documentar esto con un comentario en el código.

- [ ] **Step 6:** `npx vitest run` completo → PASS, sin regresiones. Prueba manual del usuario: con menos de 100 legajos no debería verse ningún cambio (no aparece el botón "Cargar más"); confirmar antes de cerrar la tarea. Commit: `git add src/pages/LegajosPage.jsx && git commit -m "feat(escala): paginacion server-side (cargar mas) en LegajosPage"`

---

## Verificación final de la sub-fase (Tasks 35-39)

- [ ] `npx vitest run` completo en verde, sin regresiones vs. la base previa (162 tests al cierre de la Fase 5G).
- [ ] Confirmar con el usuario que aplicó la migración `0027_indices_escala.sql` y que corrió `supabase functions deploy liquidar-periodo`.
- [ ] Prueba manual guiada: calcular un período con la empresa de prueba actual (pocos legajos) y confirmar que el resultado (bruto/neto/omitidos/advertencias) es idéntico a antes del refactor — el cambio es de performance, no de comportamiento de negocio.
- [ ] Nota para el usuario: la prueba de carga real (600 legajos, `scripts/seed-carga.sql`, criterios de <5 min / <2 s) es la Task 38 del plan maestro (Fase 5I, más adelante) — esta sub-fase deja la base técnica (sin N+1, con progreso, indexada) pero no incluye el seed sintético ni la medición contra 500+ personas reales, que requiere un proyecto de staging dedicado.
