# Correcciones Legajos/Liquidación (cache, sin horas, filtros, fecha de ingreso) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Modelo:** Claude Sonnet 5, esfuerzo bajo — una tarea por sesión, sin desviarse del código mostrado en cada paso.

**Goal:** Arreglar seis problemas reportados por el usuario: (1) las pantallas recargan/recalculan todo cada vez que se visita un menú, (2) el personal sin horas cargadas en el período se liquida en $0 en vez de listarse aparte, (3) el filtro de Legajos no arranca en "Activo", (4) Convenio/Categoría muestran el UUID crudo un instante antes del nombre, (5) Ausencias solo filtra por año (falta mes), y (6) `fecha_ingreso` no se usa para antigüedad/SAC/vacaciones ni para impedir faltas antes del ingreso.

**Architecture:** Cambios acotados y locales, sin tocar Presencio (regla del repo, `docs/Recursio_Plan_Ejecucion_Sonnet5.md` §7). El cache de stores Zustand se resuelve con un guard "ya cargado para esta clave" por store (mismo patrón que los `seq*` que ya existen en `legajoStore.js`), no con una librería nueva. La fecha de ingreso se resuelve como `legajo.fecha_ingreso` (override en `nom_legajo`, editable en Recursio) con fallback a `personal.fecha_ingreso` (Presencio, vía `nom_v_personal`) — se usa consistentemente en el motor de asistencia y en el cálculo de antigüedad de la Edge Function.

**Tech Stack:** React 19, Zustand (sin `persist`), Supabase (Postgres + RLS + Edge Functions Deno), Vitest.

**Spec:** ninguna previa — este documento nace directo del pedido del usuario (2026-07-31) más lectura del código existente.

---

## Convenciones de este repo (leer antes de la Tarea 1)

1. **TDD**: test que falla → verificar que falla → implementación mínima → test pasa → commit.
2. **Migraciones** solo en `supabase/migrations/NNNN_nombre.sql`, numeradas, idempotentes. Esta tanda de tareas NO necesita migraciones nuevas (todas las columnas ya existen).
3. **No tocar Presencio.** `nom_v_personal` y `personal.fecha_ingreso` son de solo lectura desde acá.
4. **Zustand sin `persist`** para datos salariales/legajo.
5. **Español (Argentina)** en UI, comentarios y mensajes.
6. **Commits frecuentes**, `feat:`/`fix:`/`test:`/`chore:`.
7. Correr los tests: `npm test`. Un archivo puntual: `npx vitest run <ruta>`.

---

## Respuesta a la pregunta del usuario: ¿fecha de ingreso en Presencio o override en Recursio?

**Override en Recursio.** Ya existe la columna `nom_legajo.fecha_ingreso`, ya se edita en `EditorDatosLegajo.jsx` y ya se guarda — el dato SÍ se carga y SÍ se muestra en modo lectura (línea 132 de ese archivo). El bug real es otro: el motor de liquidación (`liquidar-periodo/index.ts`) y el gating de faltas (`construirDiasPeriodo`) **nunca leen `nom_legajo.fecha_ingreso`** — usan `persona.fecha_ingreso`, que viene de `personal` (tabla de Presencio) vía la vista `nom_v_personal`. Si Presencio no tiene cargada esa fecha (o tiene una distinta a la que carga el usuario en el legajo), la antigüedad, el SAC/vacaciones y el conteo de faltas quedan mal — no porque falte el dato, sino porque se lee de la fuente equivocada.

Tocar Presencio para esto violaría la regla del repo de no modificarlo y además dependería de un repo/despliegue separado. La Tarea 6 de este plan resuelve todo con `fechaIngresoEfectiva = legajo.fecha_ingreso || persona.fecha_ingreso`, calculado en Recursio, sin cambiar una sola línea de Presencio.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/store/legajoStore.js` | **Modificar.** Cache por `empresaId` en `cargarLegajos`. |
| `src/store/conveniosStore.js` | **Modificar.** Cache por `empresaId` en `cargarConvenios`. |
| `src/store/escalasStore.js` | **Modificar.** Cache por `convenioId` en `cargarEscala`. |
| `src/store/conceptosStore.js` | **Modificar.** Cache por `empresaId` en `cargarConceptos`. |
| `src/store/__tests__/legajoStore.test.js`, `conveniosStore.test.js` (crear), `escalasStore.test.js` (crear), `conceptosStore.test.js` (crear) | Tests del guard de cache. |
| `packages/motor/src/asistencia.ts` | **Modificar.** `construirDiasPeriodo` gana parámetros opcionales `fechaIngreso`/`fechaBaja` para no contar faltas fuera de la relación laboral. |
| `packages/motor/src/asistencia.test.ts` | **Modificar.** Tests del nuevo gating. |
| `supabase/functions/liquidar-periodo/index.ts` | **Modificar.** (a) `fechaIngresoEfectiva` en flujo mensual y especial; (b) nuevo array `sinHoras` separado de `omitidos`. |
| `src/store/liquidacionStore.js` | **Modificar.** Propagar `sinHoras` de la respuesta de la función. |
| `src/pages/LiquidacionPage.jsx` | **Modificar.** Sección "Personal sin horas en el período". |
| `src/pages/LegajosPage.jsx` | **Modificar.** Default de `filtroEstado` a `'activo'`. |
| `src/components/legajo/EditorDatosLegajo.jsx` | **Modificar.** No mostrar el UUID crudo mientras `todosConvenios`/`todasCategorias` no cargaron. |
| `src/components/legajo/TabAusencias.jsx` | **Modificar.** Filtro por mes además de año; usa `fechaIngresoEfectiva` del legajo para el gating de faltas. |
| `src/pages/FichaLegajoPage.jsx` | **Modificar.** Pasar `legajo` a `TabAusencias`. |

---

### Task 1: Cache de stores — no recargar al revisitar un menú

**Problema:** `cargarLegajos`, `cargarConvenios`, `cargarEscala` y `cargarConceptos` refetchean contra Supabase cada vez que el componente que las llama se monta (cambiar de pestaña del sidebar desmonta y remonta la página). No hay ningún criterio de "ya lo tengo, no lo pido de nuevo".

**Decisión de diseño:** guard "ya cargado para esta clave" (empresaId o convenioId, según el store), igual al patrón `seqLegajos` que ya existe en este archivo para evitar carreras. `forzar: true` como escape hatch explícito para cuando de verdad hace falta refrescar (por ejemplo, después de una operación que XX no actualiza el estado local solo). Las funciones `guardar*` ya actualizan el estado local en memoria sin refetch, así que no pierden nada con este cambio.

**Files:**
- Modify: `src/store/legajoStore.js`
- Test: `src/store/__tests__/legajoStore.test.js`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `src/store/__tests__/legajoStore.test.js` (después del describe de mappers ya existente):

```js
describe('cargarLegajos — cache por empresa', () => {
  beforeEach(() => {
    useLegajoStore.setState({ legajos: [], cargando: false, error: null, cargadoEmpresaId: null })
  })

  it('no vuelve a pedir a Supabase si ya cargó para la misma empresa', async () => {
    const fromSpy = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: undefined,
    }))
    // Reemplaza el mock global por uno que además resuelve la promesa de cargarLegajos.
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))

    await useLegajoStore.getState().cargarLegajos('empresa-1')
    await useLegajoStore.getState().cargarLegajos('empresa-1')

    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('SÍ vuelve a pedir si cambia la empresa', async () => {
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))

    await useLegajoStore.getState().cargarLegajos('empresa-1')
    await useLegajoStore.getState().cargarLegajos('empresa-2')

    expect(supabase.from).toHaveBeenCalledTimes(2)
  })

  it('vuelve a pedir si se pasa forzar: true aunque sea la misma empresa', async () => {
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))

    await useLegajoStore.getState().cargarLegajos('empresa-1')
    await useLegajoStore.getState().cargarLegajos('empresa-1', { forzar: true })

    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/store/__tests__/legajoStore.test.js`
Expected: FAIL — `cargadoEmpresaId` no existe todavía y `cargarLegajos` pide a Supabase las dos veces.

- [ ] **Step 3: Implementar el guard en `legajoStore.js`**

En `src/store/legajoStore.js`, cambiar el estado inicial (línea 95) y la función `cargarLegajos` (líneas 97-109):

```js
export const useLegajoStore = create((set, get) => ({
  legajos: [], familiares: [], sanciones: [], adicionalesLegajo: [], cargando: false, error: null,
  // empresaId para el que `legajos` ya está cargado — evita refetch al
  // revisitar un menú (LegajosPage/FichaLegajoPage se desmontan y montan
  // en cada navegación del sidebar). `forzar: true` lo salta a propósito.
  cargadoEmpresaId: null,

  cargarLegajos: async (empresaId, { forzar = false } = {}) => {
    if (!forzar && get().cargadoEmpresaId === empresaId && !get().error) return
    const miSeq = ++seqLegajos
    set({ cargando: true, error: null })
    try {
      const { data, error } = await supabase.from('nom_legajo').select('*').eq('empresa_id', empresaId)
      if (miSeq !== seqLegajos) return // llegó una carga más nueva primero, descartar
      if (error) { set({ error: error.message, cargando: false }); return }
      set({ legajos: (data || []).map(legajoFromDB), cargando: false, cargadoEmpresaId: empresaId })
    } catch (e) {
      if (miSeq !== seqLegajos) return
      set({ error: e.message, cargando: false })
    }
  },
```

Y en `guardarLegajo`, tras el `set` que ya actualiza `legajos` en memoria (línea 121), no hace falta ningún cambio — el cache sigue siendo válido porque el estado local ya refleja el guardado.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/store/__tests__/legajoStore.test.js`
Expected: PASS (los 3 tests nuevos + los mappers existentes).

- [ ] **Step 5: Commit**

```bash
git add src/store/legajoStore.js src/store/__tests__/legajoStore.test.js
git commit -m "feat: cache de cargarLegajos por empresa (no recargar al revisitar el menú)"
```

- [ ] **Step 6: Repetir el mismo patrón en `conveniosStore.js`**

Crear `src/store/__tests__/conveniosStore.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

import { supabase } from '../../lib/supabase'
import { useConveniosStore } from '../conveniosStore'

describe('cargarConvenios — cache por empresa', () => {
  beforeEach(() => {
    useConveniosStore.setState({ convenios: [], cargando: false, error: null, cargadoEmpresaId: null })
    supabase.from.mockReset()
    supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))
  })

  it('no vuelve a pedir si ya cargó para la misma empresa', async () => {
    await useConveniosStore.getState().cargarConvenios('empresa-1')
    await useConveniosStore.getState().cargarConvenios('empresa-1')
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('vuelve a pedir si cambia la empresa', async () => {
    await useConveniosStore.getState().cargarConvenios('empresa-1')
    await useConveniosStore.getState().cargarConvenios('empresa-2')
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})
```

Run: `npx vitest run src/store/__tests__/conveniosStore.test.js` → FAIL.

En `src/store/conveniosStore.js`, cambiar:

```js
export const useConveniosStore = create((set, get) => ({
  convenios: [], cargando: false, error: null, cargadoEmpresaId: null,

  cargarConvenios: async (empresaId, { forzar = false } = {}) => {
    if (!forzar && get().cargadoEmpresaId === empresaId && !get().error) return
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_convenios').select('*')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('nombre')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ convenios: (data || []).map(convenioFromDB), cargando: false, cargadoEmpresaId: empresaId })
  },
```

`clonarConvenio` y `crearConvenio` ya llaman a `get().cargarConvenios(empresaId)` después de escribir — como cambia el resultado esperado, hay que pasarles `{ forzar: true }`:

```js
  clonarConvenio: async (convenioGlobalId, empresaId) => {
    const { data, error } = await supabase.rpc('clonar_convenio', {
      convenio_global_id: convenioGlobalId, p_empresa_id: empresaId ?? null,
    })
    if (error) return { ok: false, error: error.message }
    await get().cargarConvenios(empresaId, { forzar: true })
    return { ok: true, convenioId: data }
  },
```

(`crearConvenio` ya inserta y llama `cargarConvenios(empresaId)` al final — cambiar esa llamada también a `cargarConvenios(empresaId, { forzar: true })`.)

Run: `npx vitest run src/store/__tests__/conveniosStore.test.js` → PASS.

```bash
git add src/store/conveniosStore.js src/store/__tests__/conveniosStore.test.js
git commit -m "feat: cache de cargarConvenios por empresa"
```

- [ ] **Step 7: Repetir en `escalasStore.js` (clave: `convenioId`)**

Crear `src/store/__tests__/escalasStore.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { supabase } from '../../lib/supabase'
import { useEscalasStore } from '../escalasStore'

describe('cargarEscala — cache por convenio', () => {
  beforeEach(() => {
    useEscalasStore.setState({ categorias: [], cargando: false, error: null, cargadoConvenioId: null })
    supabase.from.mockReset()
    supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    }))
    // El último .order() de la cadena real resuelve la promesa.
    supabase.from.mockImplementation(() => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(function (...args) {
          // El segundo .order() (vigencia_desde) cierra la cadena.
          if (this._ordenados) return Promise.resolve({ data: [], error: null })
          this._ordenados = true
          return chain
        }),
      }
      return chain
    })
  })

  it('no vuelve a pedir si ya cargó para el mismo convenio', async () => {
    await useEscalasStore.getState().cargarEscala('conv-1')
    await useEscalasStore.getState().cargarEscala('conv-1')
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('vuelve a pedir si cambia el convenio', async () => {
    await useEscalasStore.getState().cargarEscala('conv-1')
    await useEscalasStore.getState().cargarEscala('conv-2')
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})
```

Run: `npx vitest run src/store/__tests__/escalasStore.test.js` → FAIL.

En `src/store/escalasStore.js`:

```js
export const useEscalasStore = create((set, get) => ({
  categorias: [], cargando: false, error: null, cargadoConvenioId: null,

  cargarEscala: async (convenioId, { forzar = false } = {}) => {
    if (!forzar && get().cargadoConvenioId === convenioId && !get().error) return
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_categorias').select('*')
      .eq('convenio_id', convenioId).order('nombre').order('vigencia_desde', { ascending: false })
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ categorias: (data || []).map(categoriaFromDB), cargando: false, cargadoConvenioId: convenioId })
  },
```

El llamador de `guardarVigencias` (en el componente que arma paritarias) debe volver a llamar `cargarEscala(convenioId, { forzar: true })` después de guardar para ver las filas nuevas — buscar sus usos:

Run: `grep -rn "guardarVigencias" src/` y agregar `{ forzar: true }` a la llamada a `cargarEscala` que la sigue en cada componente encontrado.

Run: `npx vitest run src/store/__tests__/escalasStore.test.js` → PASS.

```bash
git add src/store/escalasStore.js src/store/__tests__/escalasStore.test.js
git commit -m "feat: cache de cargarEscala por convenio"
```

- [ ] **Step 8: Repetir en `conceptosStore.js` (clave: `empresaId`)**

Mismo patrón que el Step 6. En `src/store/conceptosStore.js`:

```js
export const useConceptosStore = create((set, get) => ({
  conceptos: [], cargando: false, error: null, cargadoEmpresaId: null,

  cargarConceptos: async (empresaId, { forzar = false } = {}) => {
    if (!forzar && get().cargadoEmpresaId === empresaId && !get().error) return
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_conceptos').select('*, nom_concepto_reglas(*)')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('orden')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ conceptos: (data || []).map(conceptoFromDB), cargando: false, cargadoEmpresaId: empresaId })
  },

  guardarConcepto: async (concepto, empresaId) => {
    const row = conceptoToDB(concepto, empresaId)
    const query = concepto.id
      ? supabase.from('nom_conceptos').update(row).eq('id', concepto.id).select().single()
      : supabase.from('nom_conceptos').insert(row).select().single()
    const { data, error } = await query
    if (error) return { ok: false, error: error.message }
    await useConceptosStore.getState().cargarConceptos(empresaId, { forzar: true })
    return { ok: true, concepto: conceptoFromDB(data) }
  },
}))
```

Test análogo a Step 6 en `src/store/__tests__/conceptosStore.test.js` (copiar la estructura, cambiar `useConveniosStore`/`cargarConvenios` por `useConceptosStore`/`cargarConceptos`).

```bash
git add src/store/conceptosStore.js src/store/__tests__/conceptosStore.test.js
git commit -m "feat: cache de cargarConceptos por empresa"
```

- [ ] **Step 9: Correr toda la suite**

Run: `npm test`
Expected: todo PASS. Si algún componente dependía de que `cargarX` siempre refetcheara (por ejemplo, un botón "Actualizar" manual), pasarle `{ forzar: true }` en ese punto puntual — no volver a quitar el guard.

**Nota de alcance:** `empresaConfigStore.js`, `parametrosStore.js`, `flujosStore.js`, `noRemunerativosStore.js` y `documentosStore.js` tienen el mismo problema (refetch en cada mount) y se benefician del mismo patrón exacto. Se dejan fuera de esta tanda para no inflarla — replicar el Step 6 en cada uno cuando el usuario lo pida, son ~10 líneas por store.

---

### Task 2: Personal sin horas en el período → listado aparte

**Problema:** hoy, si una persona no tiene ningún fichaje ni ausencia aprobada en el período, `construirDiasPeriodo` marca todos los días laborables como falta injustificada y el motor liquida igual, con básico $0 y aportes sobre $0 — sin avisar que en realidad no hay datos de asistencia, no que la persona no trabajó ningún día.

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts`
- Modify: `src/store/liquidacionStore.js`
- Modify: `src/pages/LiquidacionPage.jsx`

- [ ] **Step 1: Agregar el array `sinHoras` y el corte temprano en la Edge Function**

En `supabase/functions/liquidar-periodo/index.ts`, junto a la declaración de `omitidos`/`advertencias` (línea 310-311):

```ts
  const omitidos: { personal_id: string; nombre: string; motivo: string }[] = []
  const advertencias: { personal_id: string; mensaje: string }[] = []
  // Personal SIN fichajes y SIN ausencias aprobadas en todo el período: no
  // es "legajo incompleto" (el legajo puede estar perfecto), es que no hay
  // ningún dato de asistencia cargado. Antes esto liquidaba en $0 con todos
  // los días como falta injustificada, sin avisar. Se separa en su propia
  // lista para que quien liquida sepa que faltan cargar fichajes/licencias,
  // no que la persona faltó todo el período.
  const sinHoras: { personal_id: string; nombre: string }[] = []
```

Dentro del loop `for (const persona of personalAProcesar)` (línea 510), justo después de calcular `asistencia` (línea 535) y antes de `resolverBasicoYConceptos` (línea 543):

```ts
    const asistencia = calcularAsistencia(dias, 15, legajo.jornada === 'parcial' ? 4 : 8)

    // Sin ningún fichaje y sin ningún día cubierto por ausencia aprobada:
    // no liquidar en $0 silenciosamente, listar aparte.
    const diasConAusenciaAprobada = dias.filter((d) => d.ausenciaAprobada).length
    if (asistencia.horasTrabajadas === 0 && diasConAusenciaAprobada === 0) {
      sinHoras.push({ personal_id: persona.id, nombre: persona.nombre })
      continue
    }

    const { basicoPeriodo, basicoConvenio, noRem, conceptosLegajo, horasLiquidadas, unidadBasico, baseBasico } =
      await resolverBasicoYConceptos(legajo, asistencia, persona.id)
```

Y en las dos respuestas JSON de este flujo (buscar `return new Response(JSON.stringify({ liquidadas: resultados.length, omitidos, advertencias` — línea 655 y cualquier otra ocurrencia en este mismo flujo mensual), agregar `sinHoras` al objeto:

```ts
  return new Response(JSON.stringify({ liquidadas: resultados.length, omitidos, sinHoras, advertencias, completo, procesados: procesadosFinal, total: totalFinal }), {
```

- [ ] **Step 2: Verificar con un test unitario del criterio (sin mockear Supabase)**

El criterio en sí (`horasTrabajadas === 0 && diasConAusenciaAprobada === 0`) es lógica pura sobre el resultado de `calcularAsistencia`/`construirDiasPeriodo`, ya testeados en `packages/motor/src/asistencia.test.ts`. Agregar ahí un test que documente el caso que dispara "sin horas":

```ts
it('persona sin ningún fichaje ni ausencia aprobada: 0 horas y 0 días con ausencia aprobada', () => {
  const dias = construirDiasPeriodo([], [], '2026-06-01', '2026-06-05')
  const r = calcularAsistencia(dias, 15)
  const diasConAusenciaAprobada = dias.filter((d) => d.ausenciaAprobada).length
  expect(r.horasTrabajadas).toBe(0)
  expect(diasConAusenciaAprobada).toBe(0)
})

it('persona de vacaciones todo el período: 0 horas pero SÍ tiene días con ausencia aprobada', () => {
  const dias = construirDiasPeriodo([], [{ fecha_desde: '2026-06-01', fecha_hasta: '2026-06-05' }], '2026-06-01', '2026-06-05')
  const r = calcularAsistencia(dias, 15)
  const diasConAusenciaAprobada = dias.filter((d) => d.ausenciaAprobada).length
  expect(r.horasTrabajadas).toBe(0)
  expect(diasConAusenciaAprobada).toBeGreaterThan(0)
})
```

Run: `npx vitest run packages/motor/src/asistencia.test.ts`
Expected: PASS (esto ya funciona con el código actual de `asistencia.ts` — el test documenta el contrato que la Edge Function usa, para que un cambio futuro en `construirDiasPeriodo`/`calcularAsistencia` no rompa el criterio sin que salte un test).

- [ ] **Step 3: Propagar `sinHoras` en el store**

En `src/store/liquidacionStore.js`, buscar `calcularPeriodo` (la función que invoca la Edge Function `liquidar-periodo` y guarda `omitidos`/`advertencias` en el estado):

```bash
grep -n "omitidos" src/store/liquidacionStore.js
```

Agregar `sinHoras: []` al estado inicial del store (junto a `omitidos: []`) y, en el punto donde hoy se hace `set({ omitidos: data.omitidos ?? [], advertencias: data.advertencias ?? [], ... })`, agregar `sinHoras: data.sinHoras ?? []`.

- [ ] **Step 4: Mostrar la sección en `LiquidacionPage.jsx`**

En `src/pages/LiquidacionPage.jsx`, tomar `sinHoras` del store (línea 32, junto a `omitidos, advertencias`):

```jsx
  const { liquidaciones, calculando, error, omitidos, sinHoras, advertencias, calcularPeriodo, cargarLiquidaciones, emitirRecibo } = useLiquidacionStore()
```

Agregar una sección nueva justo después del bloque de `omitidos`/`advertencias` (después de la línea 541, el `)}` que cierra ese bloque):

```jsx
      {sinHoras.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', background: 'var(--warning-bg, rgba(234,179,8,0.12))', border: '1px solid var(--warning, #eab308)' }}>
          <strong>👤 Personal sin horas en el período ({sinHoras.length})</strong>
          <p className="texto-secundario" style={{ fontSize: '0.85rem', marginTop: 4 }}>
            No tienen fichajes ni ausencias aprobadas cargadas en este período — no se liquidaron. Revisar si falta cargar asistencia en Presencio o si corresponde una licencia.
          </p>
          <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
            {sinHoras.map((p) => <div key={p.personal_id}>• {p.nombre}</div>)}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/liquidar-periodo/index.ts src/store/liquidacionStore.js src/pages/LiquidacionPage.jsx packages/motor/src/asistencia.test.ts
git commit -m "feat: separar personal sin horas del período en su propio listado"
```

- [ ] **Step 6: Desplegar la Edge Function**

Run: `supabase functions deploy liquidar-periodo`
Expected: deploy sin errores. Probar liquidando un período de prueba con una persona sin fichajes: debe aparecer en "Personal sin horas", no en la tabla de liquidaciones con $0.

---

### Task 3: Filtro de Legajos por defecto en "Activo"

**Problema:** `LegajosPage.jsx` inicializa `filtroEstado` en `'todos'` (línea 21), así que al entrar siempre se ve el personal activo mezclado con el inactivo/dado de baja. El usuario quiere que el filtro arranque en "Activo".

**Files:**
- Modify: `src/pages/LegajosPage.jsx`
- Test: `src/utils/__tests__/filtrarLegajos.test.js`

- [ ] **Step 1: Verificar el test existente de `filtrarLegajos` (no debería cambiar)**

`filtrarLegajos.js` ya soporta `estado === 'activo'` correctamente — el bug es solo el valor inicial del `useState` en la página, no la función de filtro. No hace falta tocar `filtrarLegajos.test.js`.

- [ ] **Step 2: Cambiar el default**

En `src/pages/LegajosPage.jsx`, línea 21:

```jsx
  const [filtroEstado, setFiltroEstado] = useState('activo')
```

- [ ] **Step 3: Verificar manualmente**

Run: `npm run dev`, entrar a Legajos con una empresa que tenga personal inactivo cargado → debe listar solo activos por default, con el `<select>` mostrando "Activo" seleccionado. Cambiar a "Todos" debe seguir funcionando igual que antes.

- [ ] **Step 4: Commit**

```bash
git add src/pages/LegajosPage.jsx
git commit -m "fix: filtro de Legajos arranca en Activo en vez de Todos"
```

---

### Task 4: No mostrar el UUID crudo de Convenio/Categoría mientras cargan

**Problema:** en `EditorDatosLegajo.jsx`, la vista de solo lectura resuelve el nombre buscando en `todosConvenios`/`todasCategorias` (líneas 142-143), pero esas listas se piden en un `useEffect` async — en el primer render, antes de que la promesa resuelva, el fallback es `legajo.convenioId` (el UUID crudo), no un estado de carga. Por eso se ve el hash un instante y después el nombre correcto.

**Files:**
- Modify: `src/components/legajo/EditorDatosLegajo.jsx`

- [ ] **Step 1: Agregar un flag de carga explícito**

En `src/components/legajo/EditorDatosLegajo.jsx`, agregar estado junto a `todosConvenios`/`todasCategorias` (línea 24-25):

```jsx
  const [todosConvenios, setTodosConvenios] = useState([])
  const [todasCategorias, setTodasCategorias] = useState([])
  const [cargandoConvenios, setCargandoConvenios] = useState(true)
  const [cargandoCategorias, setCargandoCategorias] = useState(false)
```

- [ ] **Step 2: Marcar el flag en los dos `useEffect` que cargan**

El primero (línea 84-97, convenios):

```jsx
  useEffect(() => {
    setCargandoConvenios(true)
    supabase.from('nom_convenios').select('id, nombre, empresa_id').order('nombre')
      .then(({ data }) => { setTodosConvenios(data || []); setCargandoConvenios(false) })
  }, [])
```

El segundo (línea 103-107, categorías) — solo hay algo que esperar si hay `convenioParaCategorias`; si no, no queda "cargando" pendiente:

```jsx
  const convenioParaCategorias = form.convenioId || legajo?.convenioId || ''
  useEffect(() => {
    if (!convenioParaCategorias) { setTodasCategorias([]); setCargandoCategorias(false); return }
    setCargandoCategorias(true)
    supabase.from('nom_categorias').select('id, nombre, vigencia_desde').eq('convenio_id', convenioParaCategorias).order('nombre')
      .then(({ data }) => { setTodasCategorias(data || []); setCargandoCategorias(false) })
  }, [convenioParaCategorias])
```

- [ ] **Step 3: Usar el flag en la vista de solo lectura**

Reemplazar las líneas 142-143:

```jsx
            <p>Convenio: {cargandoConvenios ? 'Cargando…' : (todosConvenios.find((c) => c.id === legajo?.convenioId)?.nombre || (legajo?.convenioId ? 'Convenio no encontrado' : '—'))}</p>
            <p>Categoría: {(legajo?.convenioId && cargandoCategorias) ? 'Cargando…' : (todasCategorias.find((c) => c.id === legajo?.categoriaId)?.nombre || (legajo?.categoriaId ? 'Categoría no encontrada' : '—'))}</p>
```

Nota: se cambió también el mensaje de fallback de "mostrar el UUID crudo" a "Convenio no encontrado" / "Categoría no encontrada" para el caso en que YA terminó de cargar y de verdad no está (dato inconsistente) — mostrar un UUID ahí nunca fue útil para el usuario final.

- [ ] **Step 4: Test de componente**

Buscar si ya existe `src/components/__tests__/EditorDatosLegajo.test.jsx`:

Run: `ls src/components/legajo/__tests__/ 2>/dev/null; find src -iname "*EditorDatosLegajo*"`

Si no existe ningún test de este componente, crear `src/components/legajo/__tests__/EditorDatosLegajo.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ data: [{ id: 'conv-1', nombre: 'UOCRA' }] }), 20))),
    })),
  },
}))
vi.mock('../../../store/legajoStore', () => ({ useLegajoStore: () => ({ guardarLegajo: vi.fn() }) }))

import EditorDatosLegajo from '../EditorDatosLegajo'

describe('EditorDatosLegajo — vista de solo lectura', () => {
  it('muestra "Cargando…" en vez del UUID crudo mientras resuelve el nombre del convenio', async () => {
    const legajo = { id: 'l1', convenioId: 'conv-1', categoriaId: null, fueraConvenio: false }
    render(<EditorDatosLegajo legajo={legajo} personalId="p1" empresaId="e1" />)

    expect(screen.getByText(/Convenio: Cargando…/)).toBeInTheDocument()
    expect(screen.queryByText(/Convenio: conv-1/)).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByText(/Convenio: UOCRA/)).toBeInTheDocument())
  })
})
```

Run: `npx vitest run src/components/legajo/__tests__/EditorDatosLegajo.test.jsx`
Expected: FAIL antes del Step 1-3, PASS después.

- [ ] **Step 5: Commit**

```bash
git add src/components/legajo/EditorDatosLegajo.jsx src/components/legajo/__tests__/EditorDatosLegajo.test.jsx
git commit -m "fix: no mostrar UUID crudo de convenio/categoría mientras cargan los nombres"
```

---

### Task 5: Filtro de Ausencias por mes y año

**Problema:** `TabAusencias.jsx` solo tiene un `<select>` de año (línea 80-84); el usuario quiere poder acotar también por mes.

**Files:**
- Modify: `src/components/legajo/TabAusencias.jsx`
- Modify: `src/utils/agruparAusencias.js` (revisar firma de `agruparAusencias`, puede necesitar el mes)

- [ ] **Step 1: Revisar `agruparAusencias` antes de tocar nada**

Run: `cat src/utils/agruparAusencias.js`

(Este paso es de lectura — según lo que devuelva, el Step 2 arma el rango fecha_desde/fecha_hasta acotado por mes en vez de pasarle el mes a la función. Si `agruparAusencias(ausencias, anio)` filtra internamente por año comparando `fecha_desde.slice(0,4)`, la forma más simple es NO tocar esa función y en cambio filtrar la lista `ausencias` por mes ANTES de pasarla, en el propio componente — igual que ya se hace en la línea 64 (`ausenciasDelAnio`) para el cálculo de injustificadas.)

- [ ] **Step 2: Test que falla**

Crear `src/components/legajo/__tests__/TabAusencias.test.jsx` (o agregar si ya existe uno):

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}))

import TabAusencias from '../TabAusencias'

describe('TabAusencias — filtro de mes', () => {
  const ausencias = [
    { id: 'a1', tipo: 'vacaciones', estado: 'aprobada', fecha_desde: '2026-03-10', fecha_hasta: '2026-03-15' },
    { id: 'a2', tipo: 'vacaciones', estado: 'aprobada', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-05' },
  ]

  it('muestra un select de mes además del de año', () => {
    render(<TabAusencias ausencias={ausencias} personalId="p1" />)
    expect(screen.getByLabelText(/Mes/i)).toBeInTheDocument()
  })

  it('al elegir un mes, el total de justificadas se acota a ese mes', () => {
    render(<TabAusencias ausencias={ausencias} personalId="p1" />)
    fireEvent.change(screen.getByLabelText(/Mes/i), { target: { value: '3' } })
    // Solo a1 (marzo) debería contar — 6 días de licencia.
    const justificadas = screen.getByText('Justificadas').nextSibling
    expect(justificadas.textContent).toBe('6')
  })
})
```

Run: `npx vitest run src/components/legajo/__tests__/TabAusencias.test.jsx`
Expected: FAIL — no existe el label "Mes" todavía.

- [ ] **Step 3: Implementar el filtro de mes**

En `src/components/legajo/TabAusencias.jsx`, agregar estado `mes` (0 = "todos los meses", 1-12 = mes puntual) junto a `anio` (línea 35):

```jsx
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [mes, setMes] = useState(0) // 0 = todo el año
```

Acotar `fechaDesde`/`fechaHasta` (líneas 39-42) por mes cuando corresponda:

```jsx
  const fechaDesde = mes
    ? `${anio}-${String(mes).padStart(2, '0')}-01`
    : `${anio}-01-01`
  const finDeMes = (a, m) => new Date(a, m, 0).getDate() // día 0 del mes siguiente = último día del mes
  const fechaHasta = mes
    ? `${anio}-${String(mes).padStart(2, '0')}-${String(finDeMes(anio, mes)).padStart(2, '0')}`
    : (anio === new Date().getFullYear() ? new Date().toISOString().slice(0, 10) : `${anio}-12-31`)
```

Acotar también la lista de `ausencias` que entra a `agruparAusencias` y al cálculo de injustificadas (líneas 58-67) por el rango elegido, no solo por año:

```jsx
  const ausenciasEnRango = useMemo(
    () => ausencias.filter((a) => a.fecha_desde <= fechaHasta && a.fecha_hasta >= fechaDesde),
    [ausencias, fechaDesde, fechaHasta]
  )

  const { totalDiasJustificadas } = useMemo(
    () => agruparAusencias(ausenciasEnRango, anio),
    [ausenciasEnRango, anio]
  )

  const totalDiasInjustificadas = useMemo(() => {
    const dias = construirDiasPeriodo(fichajes, ausenciasEnRango, fechaDesde, fechaHasta)
    return contarFaltasSinFichaje(dias)
  }, [fichajes, ausenciasEnRango, fechaDesde, fechaHasta])
```

Agregar el `<select>` de mes en el JSX, junto al de año (después de la línea 84):

```jsx
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Año</label>
          <select className="input" value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ maxWidth: 160 }}>
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mes-ausencias-select" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Mes</label>
          <select id="mes-ausencias-select" aria-label="Mes" className="input" value={mes} onChange={(e) => setMes(Number(e.target.value))} style={{ maxWidth: 160 }}>
            <option value={0}>Todo el año</option>
            {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
              .map((nombre, i) => <option key={i + 1} value={i + 1}>{nombre}</option>)}
          </select>
        </div>
      </div>
```

(Esto reemplaza el bloque original de solo-año, líneas 79-84 — eliminar el `<div>` viejo suelto y dejar este contenedor con los dos selects.)

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/components/legajo/__tests__/TabAusencias.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/legajo/TabAusencias.jsx src/components/legajo/__tests__/TabAusencias.test.jsx
git commit -m "feat: filtro de Ausencias por mes además de año"
```

---

### Task 6: Fecha de ingreso — override en Recursio, usada en antigüedad/SAC/vacaciones y para no contar faltas antes del ingreso

Ver la sección "Respuesta a la pregunta del usuario" más arriba: la decisión es leer `nom_legajo.fecha_ingreso` con fallback a `personal.fecha_ingreso` (Presencio), en Recursio, sin tocar Presencio.

**Files:**
- Modify: `packages/motor/src/asistencia.ts`
- Modify: `packages/motor/src/asistencia.test.ts`
- Modify: `supabase/functions/liquidar-periodo/index.ts`
- Modify: `src/components/legajo/TabAusencias.jsx`
- Modify: `src/pages/FichaLegajoPage.jsx`

- [ ] **Step 1: Test que falla — `construirDiasPeriodo` no debe contar faltas antes del ingreso**

En `packages/motor/src/asistencia.test.ts`, dentro del `describe('construirDiasPeriodo', ...)` existente:

```ts
it('días anteriores a fechaIngreso no son laborables (no cuentan como falta)', () => {
  const dias = construirDiasPeriodo([], [], '2026-06-01', '2026-06-10', { fechaIngreso: '2026-06-05' })
  const antesDeIngresar = dias.filter((d) => d.fecha < '2026-06-05')
  const desdeIngreso = dias.filter((d) => d.fecha >= '2026-06-05')
  expect(antesDeIngresar.every((d) => d.horaEntradaEsperada === null)).toBe(true)
  // Desde el ingreso, los días de semana siguen siendo laborables (esto no cambia).
  expect(desdeIngreso.some((d) => d.horaEntradaEsperada !== null)).toBe(true)
})

it('días posteriores a fechaBaja no son laborables', () => {
  const dias = construirDiasPeriodo([], [], '2026-06-01', '2026-06-10', { fechaBaja: '2026-06-05' })
  const despuesDeBaja = dias.filter((d) => d.fecha > '2026-06-05')
  expect(despuesDeBaja.every((d) => d.horaEntradaEsperada === null)).toBe(true)
})

it('sin fechaIngreso/fechaBaja, se comporta exactamente igual que antes', () => {
  const dias = construirDiasPeriodo([], [], '2026-06-01', '2026-06-05')
  expect(dias.every((d) => d.fecha < '2026-06-06')).toBe(true)
  expect(dias.filter((d) => d.horaEntradaEsperada !== null).length).toBeGreaterThan(0)
})
```

Run: `npx vitest run packages/motor/src/asistencia.test.ts`
Expected: FAIL — `construirDiasPeriodo` no acepta un cuarto parámetro todavía, y las fechas antes/después de ingreso/baja se marcan igual que cualquier día laborable.

- [ ] **Step 2: Implementar el gating en `asistencia.ts`**

En `packages/motor/src/asistencia.ts`, cambiar la firma de `construirDiasPeriodo` (línea 85-90):

```ts
export function construirDiasPeriodo(
  fichajes: FichajeCrudo[],
  ausencias: AusenciaRango[],
  fechaDesde: string,
  fechaHasta: string,
  opciones: { fechaIngreso?: string | null; fechaBaja?: string | null } = {}
): DiaAsistencia[] {
```

Y dentro del `while` (línea 104-121), antes de calcular `laborable`:

```ts
  const dias: DiaAsistencia[] = []
  const d = new Date(fechaDesde + 'T00:00:00Z')
  const fin = new Date(fechaHasta + 'T00:00:00Z')
  while (d <= fin) {
    const fecha = d.toISOString().slice(0, 10)
    // Fuera de la relación laboral (antes de ingresar o después de la
    // baja): no es "falta", es que la persona todavía no era/ya no era
    // personal de la empresa — sin esto, un alta a mitad de mes computaba
    // faltas injustificadas por los días previos al ingreso.
    const dentroDeRelacionLaboral =
      (!opciones.fechaIngreso || fecha >= opciones.fechaIngreso) &&
      (!opciones.fechaBaja || fecha <= opciones.fechaBaja)
    const dow = d.getUTCDay() // 0 = domingo, 6 = sábado
    const laborable = dentroDeRelacionLaboral && dow >= 1 && dow <= 5
    const reg = porFecha.get(fecha)
    const horas = reg?.entrada && reg?.salida
      ? Math.max(0, (aMinutos(reg.salida) - aMinutos(reg.entrada)) / 60)
      : 0
    dias.push({
      fecha,
      horaEntradaEsperada: laborable ? '08:00' : null,
      horaEntradaReal: reg?.entrada ?? null,
      horasTrabajadas: Math.round(horas * 100) / 100,
      esDomingo: dow === 0,
      ausenciaAprobada: ausencias.some((a) => fecha >= a.fecha_desde && fecha <= a.fecha_hasta),
    })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dias
}
```

- [ ] **Step 3: Correr el test y verificar que pasa**

Run: `npx vitest run packages/motor/src/asistencia.test.ts`
Expected: PASS — todos los tests, viejos y nuevos.

- [ ] **Step 4: Commit**

```bash
git add packages/motor/src/asistencia.ts packages/motor/src/asistencia.test.ts
git commit -m "feat: construirDiasPeriodo no cuenta faltas antes del ingreso ni después de la baja"
```

- [ ] **Step 5: Usar `fechaIngresoEfectiva` en el flujo mensual de la Edge Function**

En `supabase/functions/liquidar-periodo/index.ts`, agregar `fecha_ingreso` al select de `nom_v_personal` del flujo mensual (línea 128):

```ts
  let queryPersonal = supabase.from('nom_v_personal').select('id, nombre, fecha_ingreso').eq('empresa_id', periodo.empresa_id).eq('estado', 'activo')
```

En el loop `for (const persona of personalAProcesar)` (línea 510), antes de llamar a `construirDiasPeriodo` (línea 529):

```ts
    const legajo = legajoPorPersonal.get(persona.id)
    const incompleto = !legajo?.cuil || !legajo?.cbu || /* ... sin cambios ... */
    if (incompleto) { /* ... sin cambios ... */ }

    // Override de Recursio: si el legajo tiene su propia fecha_ingreso
    // cargada, prevalece sobre la de Presencio (persona.fecha_ingreso) —
    // ver docs/superpowers/plans/2026-07-31-correcciones-legajos-liquidacion.md.
    const fechaIngresoEfectiva = legajo?.fecha_ingreso || persona.fecha_ingreso || null

    const fichajes = fichajesPorPersona.get(persona.id) ?? []
    const ausencias = ausenciasPorPersona.get(persona.id) ?? []

    const dias = construirDiasPeriodo(
      (fichajes || []).map((f: any) => ({ tipo: f.tipo, timestamp: f.timestamp })),
      (ausencias || []).map((a: any) => ({ fecha_desde: a.fecha_desde, fecha_hasta: a.fecha_hasta })),
      periodo.fecha_desde,
      periodo.fecha_hasta,
      { fechaIngreso: fechaIngresoEfectiva, fechaBaja: legajo?.fecha_baja }
    )
```

- [ ] **Step 6: Usar `fechaIngresoEfectiva` en antigüedad/SAC/vacaciones (flujo especial)**

En el mismo archivo, dentro de `liquidarPeriodoEspecial` (línea 757+), donde hoy se usa `persona.fecha_ingreso` directo (líneas 953, 960, 1016, 1018), calcular una vez por persona y reusar. Justo antes de la línea 953:

```ts
    // Mismo override que en el flujo mensual: legajo.fecha_ingreso (Recursio)
    // prevalece sobre persona.fecha_ingreso (Presencio).
    const fechaIngresoEfectiva = legajo?.fecha_ingreso || persona.fecha_ingreso || null
    const antiguedadAnios = calcularAntiguedadAnios(fechaIngresoEfectiva, legajo.antiguedad_reconocida, periodo.fecha_hasta)
```

Y reemplazar `persona.fecha_ingreso` por `fechaIngresoEfectiva` en las otras tres ocurrencias (líneas 960, 1016, 1018):

```ts
      const diasTrabajados = diasTrabajadosEnRango(fechaIngresoEfectiva, legajo.fecha_baja, semestre.desde, semestre.hasta)
```

```ts
    const diasTrabajadosSemestreFinal = diasTrabajadosEnRango(fechaIngresoEfectiva, fechaBaja, semestreFinal.desde, semestreFinal.hasta)
    const anioBaja = Number(fechaBaja.slice(0, 4))
    const diasTrabajadosAnioFinal = diasTrabajadosEnRango(fechaIngresoEfectiva, fechaBaja, `${anioBaja}-01-01`, `${anioBaja}-12-31`)
```

(`fechaIngresoEfectiva` se calcula una sola vez, arriba, y se reusa en las cuatro llamadas de esta función — no recalcular por cada una.)

- [ ] **Step 7: Verificar que el select de `nom_v_personal` en el flujo especial ya trae `fecha_ingreso`**

Ya lo trae (línea 821: `.select('id, nombre, fecha_ingreso')`) — no requiere cambio.

- [ ] **Step 8: Desplegar y probar manualmente**

Run: `supabase functions deploy liquidar-periodo`

Prueba manual: cargar un legajo con `fecha_ingreso` distinta a la de Presencio (o con Presencio sin ese dato), liquidar un período mensual que incluya días previos al ingreso sin fichajes → esos días NO deben aparecer como falta injustificada. Liquidar un período de vacaciones/SAC final para esa persona → la antigüedad debe calcularse desde la fecha del legajo, no la de Presencio.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/liquidar-periodo/index.ts
git commit -m "feat: fecha_ingreso del legajo (Recursio) prevalece sobre Presencio en antigüedad y gating de faltas"
```

- [ ] **Step 10: Aplicar el mismo override en `TabAusencias.jsx` (conteo de injustificadas en la ficha)**

`TabAusencias.jsx` llama a `construirDiasPeriodo` en el cliente (línea 65) sin `legajo` — hoy no tiene forma de saber la fecha de ingreso. Pasarle el legajo desde `FichaLegajoPage.jsx`:

En `src/pages/FichaLegajoPage.jsx`, línea 266:

```jsx
      {pestana === 'Ausencias' && (
        <TabAusencias ausencias={ausencias} personalId={personalId} legajo={legajo} />
      )}
```

En `src/components/legajo/TabAusencias.jsx`, agregar el prop y usarlo en el cálculo de injustificadas (Task 5 ya dejó este bloque en `ausenciasEnRango`/`totalDiasInjustificadas` — agregar `legajo` a la firma y a `construirDiasPeriodo`):

```jsx
export default function TabAusencias({ ausencias, personalId, legajo }) {
```

```jsx
  const totalDiasInjustificadas = useMemo(() => {
    const dias = construirDiasPeriodo(fichajes, ausenciasEnRango, fechaDesde, fechaHasta, { fechaIngreso: legajo?.fechaIngreso, fechaBaja: legajo?.fechaBaja })
    return contarFaltasSinFichaje(dias)
  }, [fichajes, ausenciasEnRango, fechaDesde, fechaHasta, legajo?.fechaIngreso, legajo?.fechaBaja])
```

- [ ] **Step 11: Test**

En `src/components/legajo/__tests__/TabAusencias.test.jsx` (creado en Task 5), agregar:

```jsx
it('no cuenta como injustificado un día anterior a la fecha de ingreso del legajo', () => {
  const legajo = { fechaIngreso: '2026-07-15' }
  render(<TabAusencias ausencias={[]} personalId="p1" legajo={legajo} />)
  // Con año actual completo y fechaIngreso a mitad de julio, los días de
  // enero-junio no deben sumar como falta injustificada.
  const injustificadas = screen.getByText('Injustificadas').nextSibling
  expect(Number(injustificadas.textContent)).toBeLessThan(150) // cota laxa: sin el fix daría ~140+ solo hasta julio
})
```

Run: `npx vitest run src/components/legajo/__tests__/TabAusencias.test.jsx`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/pages/FichaLegajoPage.jsx src/components/legajo/TabAusencias.jsx src/components/legajo/__tests__/TabAusencias.test.jsx
git commit -m "fix: pestaña Ausencias respeta fecha de ingreso del legajo al contar injustificadas"
```

---

## Self-Review

**1. Cobertura del pedido del usuario:**
- Cache al navegar menús → Task 1 (4 stores concretos + nota de alcance para el resto).
- Personal sin horas → listado aparte → Task 2.
- Filtro de Legajos en Activos → Task 3.
- Convenio/Categoría con hash antes del nombre → Task 4.
- Ausencias con filtro de mes y año → Task 5.
- Fecha de ingreso: no aparece / no se usa en liquidaciones/vacaciones/faltas, y la pregunta de dónde ponerla → respondida arriba + Task 6 (antigüedad, SAC, vacaciones, gating de faltas en mensual y en la pestaña Ausencias).

**2. Placeholders:** revisado — cada paso tiene código completo, comandos exactos y resultados esperados. La única desviación deliberada de "código completo" es el Step 1 de la Task 5 (lectura de un archivo antes de decidir el enfoque) y el Step 6 de la Task 1 (un `grep` para encontrar callers de `guardarVigencias`), ambos justificados porque dependen de código que hay que leer primero, no de lógica a inventar.

**3. Consistencia de tipos/firmas:** `construirDiasPeriodo(fichajes, ausencias, fechaDesde, fechaHasta, opciones)` se usa con la misma firma en la Edge Function (Task 6, Step 5) y en `TabAusencias.jsx` (Task 6, Step 10). `cargarLegajos(empresaId, { forzar })`, `cargarConvenios(empresaId, { forzar })`, `cargarEscala(convenioId, { forzar })`, `cargarConceptos(empresaId, { forzar })` siguen la misma forma en las cuatro stores de la Task 1. `sinHoras: { personal_id, nombre }[]` se define en la Edge Function (Task 2, Step 1) y se consume igual en el store y en `LiquidacionPage.jsx` (Steps 3-4).
