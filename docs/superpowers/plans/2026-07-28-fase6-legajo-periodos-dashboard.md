# Fase 6 — Legajo editable, períodos legibles y Dashboard operativo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar las 9 revisiones pedidas el 28/07/2026: liquidación rápida, categoría legible, sueldo individual fuera de convenio, edición de familiares/sanciones, carga de documentación configurable, liquidaciones y recibos dentro del legajo, etiquetas de período legibles y un Dashboard basado en tareas pendientes.

**Architecture:** Tres capas, sin cambiar el modelo mental existente. (1) Un bug de conteo en la Edge Function `liquidar-periodo` hace que el cliente reintente 20 veces; se corrige el conteo y se agrega un corte por "no hubo progreso". (2) El legajo pasa de vistas de solo lectura a CRUD completo reutilizando las acciones que el `legajoStore` **ya expone** (`guardarFamiliar`/`guardarSancion` ya aceptan `id` para UPDATE — solo falta la UI). (3) Dos tablas nuevas propias de Recursio (`nom_documentos_requeridos`, `nom_documentos_legajo`) y un tipo de período nuevo (`mensual_fc`), más un util puro `etiquetaPeriodo` compartido por selector, tabla y recibo.

**Tech Stack:** React 19 + Vite, Zustand, Supabase (Postgres + RLS + Storage + Edge Functions en Deno), vitest + @testing-library/react, jsPDF.

**Regla de oro del repo:** Recursio **nunca escribe** en tablas de Presencio (`personal`, `fichajes`, `ausencias`, `documentos_personal`) — ver `supabase/migrations/0001_vistas_contrato.sql`. La Task 6 respeta esto: lee `documentos_personal` (Presencio) y escribe sólo en `nom_documentos_legajo` (Recursio). Hacer que Presencio vea los documentos de Recursio queda **fuera de este plan** (decisión pendiente del usuario, "revisémoslo después").

---

## Orden recomendado

Tasks 1→9 son independientes entre sí salvo: la Task 8 (`etiquetaPeriodo`) es consumida por la Task 7 y la Task 9. Ejecutar 8 antes que 7 y 9.

---

### Task 1: La liquidación tarda mucho — el cliente reinvoca 20 veces

**Diagnóstico (confirmado leyendo el código, no inferido):**

En `supabase/functions/liquidar-periodo/index.ts:476-478`:

```ts
const totalFinal = (personal || []).length
const procesadosFinal = (personal.length - personalAProcesar.length) + resultados.length
const completo = procesadosFinal >= totalFinal
```

`resultados` **excluye a los omitidos** (las personas con legajo incompleto salen por `continue` en la línea 367 y nunca llegan a `resultados`). Con la nómina real de Asset Construcciones — 16 personas activas, 1 sola con legajo completo — queda `procesadosFinal = 1`, `totalFinal = 16`, `completo = false`.

El cliente (`src/store/liquidacionStore.js:29-36`) hace:

```js
while (!respuesta.error && respuesta.data?.completo === false && intentos < 20) { ... }
```

→ **20 invocaciones completas** de la Edge Function por cada click en "Calcular". Cada una relee período, conceptos, personal, legajos, fichajes y ausencias, y vuelve a saltear a los mismos 15 omitidos (que nunca entran en `nom_liquidaciones`, así que `reanudar` jamás los filtra). Ése es todo el "tarda mucho".

Dos arreglos, ambos necesarios: el conteo (causa) y un corte por falta de progreso (red de seguridad, para que un bug futuro del mismo tipo cueste 2 invocaciones y no 20).

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts:476-482`
- Modify: `src/store/liquidacionStore.js:29-36`
- Test: `src/store/__tests__/liquidacionStore.test.js`

- [ ] **Step 1: Escribir el test que falla — el reintento corta cuando no hay progreso**

Agregar al final de `src/store/__tests__/liquidacionStore.test.js`:

```js
describe('invocarConReintento — corte por falta de progreso', () => {
  it('no reinvoca mas de 2 veces si procesados no avanza entre intentos', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { completo: false, procesados: 1, total: 16, omitidos: [], advertencias: [] },
      error: null,
    })
    supabase.functions.invoke = invoke

    const { useLiquidacionStore } = await import('../liquidacionStore')
    await useLiquidacionStore.getState().calcularPeriodo('per-1')

    // 1ª invocación + 1 reanudar que no avanza → corta. Antes: 20.
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('sigue reinvocando mientras procesados avanza', async () => {
    let procesados = 0
    const invoke = vi.fn().mockImplementation(() => {
      procesados += 5
      return Promise.resolve({
        data: { completo: procesados >= 15, procesados, total: 15, omitidos: [], advertencias: [] },
        error: null,
      })
    })
    supabase.functions.invoke = invoke

    const { useLiquidacionStore } = await import('../liquidacionStore')
    await useLiquidacionStore.getState().calcularPeriodo('per-2')

    expect(invoke).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/store/__tests__/liquidacionStore.test.js`
Expected: FAIL — `expected 20, received 2` en el primer test (el loop actual no mira `procesados`).

- [ ] **Step 3: Implementar el corte por progreso en el cliente**

En `src/store/liquidacionStore.js`, reemplazar la función `invocarConReintento` completa por:

```js
// Reintenta la Edge Function liquidar-periodo con reanudar:true mientras
// la respuesta indique completo:false (corte por timeout de la Edge
// Function con muchos empleados). Dos cortes:
//   - tope de 20 intentos (con lotes de ~50 personas por invocación cubre
//     1000 personas, el objetivo de la Decisión 10 del plan maestro);
//   - **falta de progreso**: si `procesados` no avanzó respecto del
//     intento anterior, reinvocar es tirar tiempo a la basura — la
//     función va a saltear exactamente a la misma gente. Sin este corte,
//     un período con personas omitidas (legajo incompleto) disparaba las
//     20 invocaciones completas, cada una releyendo toda la nómina: eso
//     era el "calcular tarda muchísimo" reportado el 28/07/2026.
async function invocarConReintento(body) {
  let respuesta = await supabase.functions.invoke('liquidar-periodo', { body })
  let intentos = 1
  let procesadosPrevios = respuesta.data?.procesados ?? -1
  while (!respuesta.error && respuesta.data?.completo === false && intentos < 20) {
    respuesta = await supabase.functions.invoke('liquidar-periodo', { body: { ...body, reanudar: true } })
    intentos += 1
    const procesados = respuesta.data?.procesados ?? -1
    if (procesados <= procesadosPrevios) break
    procesadosPrevios = procesados
  }
  return respuesta
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/store/__tests__/liquidacionStore.test.js`
Expected: PASS (todos los tests del archivo).

- [ ] **Step 5: Corregir la causa raíz en la Edge Function**

En `supabase/functions/liquidar-periodo/index.ts`, reemplazar las líneas 476-482 por:

```ts
  const totalFinal = (personal || []).length
  // Los omitidos (legajo incompleto) ESTÁN procesados: se los evaluó y se
  // decidió no liquidarlos. Si no se los cuenta acá, `completo` queda en
  // false para siempre y el cliente reinvoca hasta agotar sus reintentos
  // sin que nada cambie nunca (bug de performance del 28/07/2026).
  const procesadosFinal =
    (personal.length - personalAProcesar.length) + resultados.length + omitidos.length
  const completo = procesadosFinal >= totalFinal
  await supabase.from('nom_periodos').update({
    calculo_estado: completo ? 'completo' : 'calculando',
    calculo_procesados: procesadosFinal,
  }).eq('id', periodoId)
```

- [ ] **Step 6: Verificar el arreglo end-to-end en la app**

1. `npm run dev`
2. Liquidación → elegir el período quincenal de junio → abrir DevTools → pestaña Network → filtrar por `liquidar-periodo`.
3. Click en "Calcular".

Expected: **1 sola** invocación de `liquidar-periodo` (antes: 20). El panel de advertencias sigue mostrando "⚠ 15 persona(s) no liquidada(s)".

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/liquidar-periodo/index.ts src/store/liquidacionStore.js src/store/__tests__/liquidacionStore.test.js
git commit -m "perf(liquidar): contar omitidos como procesados y cortar reintentos sin progreso"
```

---

### Task 2: La categoría se muestra como UUID en la vista de solo lectura

**Diagnóstico:** en `src/components/legajo/EditorDatosLegajo.jsx`, el `useState` de `form` se inicializa **una sola vez**, en el primer render. En ese momento `legajo` todavía es `null`: `FichaLegajoPage` lo saca de `legajos.find(...)` y esa lista la carga `cargarLegajos()` de forma asíncrona. Entonces `form.convenioId` queda en `''` para siempre, el `useEffect` de la línea 68 hace `if (!form.convenioId) { setTodasCategorias([]); return }`, y `todasCategorias` queda vacío → el fallback de la línea 100 imprime el UUID crudo. El convenio sí se resuelve porque `todosConvenios` se pide sin condiciones.

El arreglo es resincronizar `form` cuando llega `legajo`, y colgar la carga de categorías de `legajo?.convenioId` además de `form.convenioId`.

**Files:**
- Modify: `src/components/legajo/EditorDatosLegajo.jsx:26-38` (init de `form`) y `:67-71` (effect de categorías)
- Test: `src/components/legajo/__tests__/EditorDatosLegajo.test.jsx`

- [ ] **Step 1: Escribir el test que falla**

Agregar dentro del `describe('EditorDatosLegajo', ...)` de `src/components/legajo/__tests__/EditorDatosLegajo.test.jsx`:

```js
  it('muestra el NOMBRE de la categoria cuando el legajo llega despues del primer render', async () => {
    const { rerender } = render(<EditorDatosLegajo legajo={null} personalId="p1" empresaId="emp-1" />)
    // segundo render: ya llegó el legajo desde cargarLegajos()
    rerender(<EditorDatosLegajo legajo={{ id: 'l1', convenioId: 'e1', categoriaId: 'cat-1' }} personalId="p1" empresaId="emp-1" />)
    await waitFor(() => {
      expect(screen.getByText('Categoría: Ayudante')).toBeInTheDocument()
    })
    expect(screen.queryByText(/cat-1/)).not.toBeInTheDocument()
  })
```

Y en el `vi.mock` de `../../../lib/supabase` de ese mismo archivo, reemplazar el bloque de fallback (`return { select..., eq..., order... }`) por uno que devuelva categorías reales:

```js
      if (tabla === 'nom_categorias') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [{ id: 'cat-1', nombre: 'Ayudante', vigencia_desde: '2026-06-01' }],
            error: null,
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/components/legajo/__tests__/EditorDatosLegajo.test.jsx`
Expected: FAIL — "Unable to find an element with the text: Categoría: Ayudante" (se está renderizando `Categoría: cat-1`).

- [ ] **Step 3: Resincronizar `form` cuando llega el legajo**

En `src/components/legajo/EditorDatosLegajo.jsx`, justo **después** del `useState` de `form` (línea 38, después del cierre `})`), insertar:

```jsx
  // `form` se inicializa en el primer render, cuando `legajo` todavía es
  // null (FichaLegajoPage lo resuelve contra `legajos`, que carga async).
  // Sin este resync, form.convenioId quedaba '' para siempre y el effect
  // de categorías nunca se disparaba: la vista de solo lectura imprimía
  // el UUID crudo de la categoría en vez de su nombre (bug del 28/07/2026).
  // No se resincroniza mientras `editando` es true para no pisar lo que el
  // usuario está tipeando si otra carga refresca el legajo.
  useEffect(() => {
    if (!legajo || editando) return
    setForm({
      cuil: legajo.cuil || '',
      cbu: legajo.cbu || '',
      banco: legajo.banco || '',
      obraSocial: legajo.obraSocial || '',
      jornada: legajo.jornada || 'completa',
      convenioId: legajo.convenioId || '',
      categoriaId: legajo.categoriaId || '',
      fueraConvenio: legajo.fueraConvenio || false,
      sueldoConvenido: legajo.sueldoConvenido || '',
      localidad: legajo.localidad || '',
      provincia: legajo.provincia || '',
      codigoPostal: legajo.codigoPostal || '',
    })
  }, [legajo?.id, legajo?.convenioId, legajo?.categoriaId, legajo?.fueraConvenio, legajo?.sueldoConvenido, editando])
```

- [ ] **Step 4: Colgar la carga de categorías también de `legajo.convenioId`**

En el mismo archivo, reemplazar el effect de categorías (líneas 67-71) por:

```jsx
  // Se prueba primero el convenio del formulario y, si está vacío (primer
  // render, antes de que llegue el legajo), el del legajo — así la vista de
  // solo lectura resuelve el nombre de la categoría sin depender del resync.
  const convenioParaCategorias = form.convenioId || legajo?.convenioId || ''
  useEffect(() => {
    if (!convenioParaCategorias) { setTodasCategorias([]); return }
    supabase.from('nom_categorias').select('id, nombre, vigencia_desde').eq('convenio_id', convenioParaCategorias).order('nombre')
      .then(({ data }) => setTodasCategorias(data || []))
  }, [convenioParaCategorias])
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/components/legajo/__tests__/EditorDatosLegajo.test.jsx`
Expected: PASS (todos, incluidos los 3 que ya existían).

- [ ] **Step 6: Commit**

```bash
git add src/components/legajo/EditorDatosLegajo.jsx src/components/legajo/__tests__/EditorDatosLegajo.test.jsx
git commit -m "fix(legajo): resolver el nombre de la categoria en la vista de solo lectura"
```

---

### Task 3: Fuera de convenio — sueldo individual visible y legajo no marcado como incompleto

**Diagnóstico:** el campo ya existe punta a punta (`nom_legajo.sueldo_convenido`, `legajoToDB`, el input del editor, y `liquidar-periodo:271-290` que lo usa como básico). Faltan dos cosas:

1. La **vista de solo lectura** no muestra ni "Fuera de convenio" ni el sueldo convenido, así que el usuario no tiene forma de ver el valor cargado sin entrar a editar.
2. `src/utils/legajoCompletitud.js` exige `convenioId` y `categoriaId` **siempre** → todo legajo fuera de convenio aparece en rojo en el semáforo y suma al contador de "legajos incompletos" del Dashboard, aunque esté perfectamente liquidable. La Edge Function ya usa el criterio correcto (`index.ts:356-358`); acá se lo replica en el front.

**Files:**
- Modify: `src/utils/legajoCompletitud.js`
- Modify: `src/components/legajo/EditorDatosLegajo.jsx` (bloque `if (!editando)`)
- Test: `src/utils/__tests__/legajoCompletitud.test.js` (crear)
- Test: `src/components/legajo/__tests__/EditorDatosLegajo.test.jsx`

- [ ] **Step 1: Escribir el test que falla — criterio de completitud**

Crear `src/utils/__tests__/legajoCompletitud.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { legajoIncompleto } from '../legajoCompletitud'

describe('legajoIncompleto', () => {
  it('sin legajo es incompleto', () => {
    expect(legajoIncompleto(null)).toBe(true)
  })

  it('legajo de convenio completo NO es incompleto', () => {
    expect(legajoIncompleto({ cuil: '20-1-4', cbu: '123', convenioId: 'c1', categoriaId: 'k1' })).toBe(false)
  })

  it('legajo de convenio sin categoria es incompleto', () => {
    expect(legajoIncompleto({ cuil: '20-1-4', cbu: '123', convenioId: 'c1', categoriaId: null })).toBe(true)
  })

  it('fuera de convenio con sueldo convenido NO es incompleto aunque no tenga convenio ni categoria', () => {
    expect(legajoIncompleto({ cuil: '20-1-4', cbu: '123', fueraConvenio: true, sueldoConvenido: 900000 })).toBe(false)
  })

  it('fuera de convenio SIN sueldo convenido es incompleto', () => {
    expect(legajoIncompleto({ cuil: '20-1-4', cbu: '123', fueraConvenio: true, sueldoConvenido: null })).toBe(true)
  })

  it('fuera de convenio sin CUIL sigue siendo incompleto', () => {
    expect(legajoIncompleto({ cuil: '', cbu: '123', fueraConvenio: true, sueldoConvenido: 900000 })).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/utils/__tests__/legajoCompletitud.test.js`
Expected: FAIL en los dos casos de "fuera de convenio con sueldo" (devuelve `true`, se espera `false`).

- [ ] **Step 3: Implementar el criterio correcto**

Reemplazar el contenido completo de `src/utils/legajoCompletitud.js` por:

```js
// Criterio compartido de "incompleto para liquidar". Debe ser el MISMO que
// aplica la Edge Function liquidar-periodo (index.ts, chequeo `incompleto`
// del loop principal): si divergen, el semáforo dice verde y la liquidación
// saltea a la persona igual, o al revés.
//
// - Siempre: cuil y cbu.
// - Legajo de convenio: además convenioId y categoriaId.
// - Legajo fuera de convenio: además sueldoConvenido (no tiene convenio ni
//   categoría por definición — su básico sale del monto pactado individualmente).
export function legajoIncompleto(legajo) {
  if (!legajo) return true
  if (!legajo.cuil || !legajo.cbu) return true
  if (legajo.fueraConvenio) return !legajo.sueldoConvenido
  return !legajo.convenioId || !legajo.categoriaId
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/utils/__tests__/legajoCompletitud.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Verificar que el Dashboard sigue funcionando con el criterio nuevo**

`src/pages/DashboardPage.jsx:47-49` arma su objeto sin `fueraConvenio`/`sueldoConvenido`. Reemplazar ese `.select(...)` y ese `map` por:

```jsx
      let qLegajos = supabase.from('nom_legajo').select('personal_id, cuil, cbu, convenio_id, categoria_id, fuera_convenio, sueldo_convenido')
```

```jsx
      const legajoPorPersonal = new Map((legajos || []).map((l) => [l.personal_id, {
        cuil: l.cuil, cbu: l.cbu, convenioId: l.convenio_id, categoriaId: l.categoria_id,
        fueraConvenio: l.fuera_convenio, sueldoConvenido: l.sueldo_convenido,
      }]))
```

- [ ] **Step 6: Escribir el test de la vista de solo lectura**

Agregar en `src/components/legajo/__tests__/EditorDatosLegajo.test.jsx`:

```js
  it('la vista de solo lectura muestra el sueldo convenido de un legajo fuera de convenio', async () => {
    render(<EditorDatosLegajo legajo={{ id: 'l1', fueraConvenio: true, sueldoConvenido: 1250000 }} personalId="p1" empresaId="emp-1" />)
    await waitFor(() => {
      expect(screen.getByText('Convenio: Fuera de convenio')).toBeInTheDocument()
    })
    expect(screen.getByText('Sueldo convenido: $ 1.250.000')).toBeInTheDocument()
    expect(screen.queryByText(/^Categoría:/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 7: Correr el test y verificar que falla**

Run: `npx vitest run src/components/legajo/__tests__/EditorDatosLegajo.test.jsx -t "sueldo convenido"`
Expected: FAIL — no existe el texto "Convenio: Fuera de convenio".

- [ ] **Step 8: Implementar la vista de solo lectura**

En `src/components/legajo/EditorDatosLegajo.jsx`, dentro del bloque `if (!editando)`, reemplazar las dos líneas de Convenio y Categoría por:

```jsx
        {legajo?.fueraConvenio ? (
          <>
            <p>Convenio: Fuera de convenio</p>
            <p>Sueldo convenido: {legajo?.sueldoConvenido != null
              ? `$ ${Number(legajo.sueldoConvenido).toLocaleString('es-AR')}`
              : '— (falta cargarlo: la liquidación va a saltear a esta persona)'}</p>
          </>
        ) : (
          <>
            <p>Convenio: {todosConvenios.find((c) => c.id === legajo?.convenioId)?.nombre || (legajo?.convenioId ? legajo.convenioId : '—')}</p>
            <p>Categoría: {todasCategorias.find((c) => c.id === legajo?.categoriaId)?.nombre || (legajo?.categoriaId ? legajo.categoriaId : '—')}</p>
          </>
        )}
```

- [ ] **Step 9: Correr los tests y verificar que pasan**

Run: `npx vitest run src/components/legajo/__tests__/EditorDatosLegajo.test.jsx src/utils/__tests__/legajoCompletitud.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/utils/legajoCompletitud.js src/utils/__tests__/legajoCompletitud.test.js src/components/legajo/EditorDatosLegajo.jsx src/components/legajo/__tests__/EditorDatosLegajo.test.jsx src/pages/DashboardPage.jsx
git commit -m "feat(legajo): sueldo convenido visible y completitud correcta para fuera de convenio"
```

---

### Task 4: Editar familiares

**Contexto:** `legajoStore.guardarFamiliar(familiar, personalId, empresaId)` **ya hace UPDATE** cuando `familiar.id` está presente (`src/store/legajoStore.js`, rama `familiar.id ? ...update... : ...insert...`). No hay que tocar el store: sólo falta la UI de edición.

**Files:**
- Modify: `src/components/legajo/TabFamiliares.jsx`
- Test: `src/components/legajo/__tests__/TabFamiliares.test.jsx` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `src/components/legajo/__tests__/TabFamiliares.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabFamiliares from '../TabFamiliares'

const guardarFamiliarMock = vi.fn().mockResolvedValue({ ok: true })
const eliminarFamiliarMock = vi.fn().mockResolvedValue({ ok: true })
const estado = {
  familiares: [{ id: 'f1', vinculo: 'hijo', nombre: 'Ana Pérez', cuil: '27-11-1', fechaNacimiento: '2015-03-10' }],
  guardarFamiliar: guardarFamiliarMock,
  eliminarFamiliar: eliminarFamiliarMock,
}
vi.mock('../../../store/legajoStore', () => ({
  useLegajoStore: (selector) => selector(estado),
}))

describe('TabFamiliares — edición', () => {
  beforeEach(() => { guardarFamiliarMock.mockClear() })

  it('el boton Editar precarga el formulario con los datos del familiar', () => {
    render(<TabFamiliares personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana Pérez')
    expect(screen.getByLabelText('CUIL (opcional)')).toHaveValue('27-11-1')
  })

  it('guardar en modo edicion llama a guardarFamiliar con el id existente', async () => {
    render(<TabFamiliares personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana María Pérez' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(guardarFamiliarMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'f1', nombre: 'Ana María Pérez' }),
        'p1', 'emp-1'
      )
    })
  })

  it('cancelar la edicion vuelve al formulario de alta vacio', () => {
    render(<TabFamiliares personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByLabelText('Nombre')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/components/legajo/__tests__/TabFamiliares.test.jsx`
Expected: FAIL — "Unable to find an accessible element with the role button and name Editar".

- [ ] **Step 3: Implementar el modo edición**

Reemplazar el contenido completo de `src/components/legajo/TabFamiliares.jsx` por:

```jsx
import { useState } from 'react'
import { useLegajoStore } from '../../store/legajoStore'

const VINCULOS = [
  { value: 'conyuge', label: 'Cónyuge' },
  { value: 'conviviente', label: 'Conviviente' },
  { value: 'hijo', label: 'Hijo/a' },
  { value: 'otro', label: 'Otro' },
]

const FORM_VACIO = { id: null, vinculo: 'hijo', nombre: '', cuil: '', fechaNacimiento: '' }

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return null
  const nacimiento = new Date(fechaNacimiento)
  const hoy = new Date()
  let edad = hoy.getFullYear() - nacimiento.getFullYear()
  const noCumplioAun = hoy.getMonth() < nacimiento.getMonth() ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate())
  if (noCumplioAun) edad -= 1
  return edad
}

// CRUD de familiares del legajo (Task 46; edición agregada en Fase 6 Task 4).
// El store ya resolvía el UPDATE — guardarFamiliar hace update cuando el
// objeto trae `id` — así que acá sólo se agrega el modo edición de la UI.
export default function TabFamiliares({ personalId, empresaId }) {
  const familiares = useLegajoStore((s) => s.familiares)
  const guardarFamiliar = useLegajoStore((s) => s.guardarFamiliar)
  const eliminarFamiliar = useLegajoStore((s) => s.eliminarFamiliar)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [eliminandoId, setEliminandoId] = useState(null)
  const [error, setError] = useState('')

  const editando = form.id !== null

  const handleGuardar = async () => {
    setError('')
    if (!form.nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setGuardando(true)
    const r = await guardarFamiliar(
      {
        ...(form.id ? { id: form.id } : {}),
        vinculo: form.vinculo,
        nombre: form.nombre,
        cuil: form.cuil || undefined,
        fechaNacimiento: form.fechaNacimiento || undefined,
      },
      personalId, empresaId
    )
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  const handleEditar = (f) => {
    setError('')
    setForm({
      id: f.id, vinculo: f.vinculo, nombre: f.nombre,
      cuil: f.cuil || '', fechaNacimiento: f.fechaNacimiento || '',
    })
  }

  const handleEliminar = async (id) => {
    setError('')
    setEliminandoId(id)
    const r = await eliminarFamiliar(id)
    setEliminandoId(null)
    if (!r.ok) { setError(r.error); return }
    if (form.id === id) setForm(FORM_VACIO)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {familiares.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin familiares cargados.</p>}
      {familiares.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {familiares.map((f) => {
            const edad = calcularEdad(f.fechaNacimiento)
            const vinculoLabel = VINCULOS.find((v) => v.value === f.vinculo)?.label || f.vinculo
            return (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>
                  {f.nombre} — {vinculoLabel}
                  {edad !== null ? ` (${edad} años)` : ''}
                  {f.cuil ? ` · CUIL ${f.cuil}` : ''}
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleEditar(f)}>Editar</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleEliminar(f.id)}
                    disabled={eliminandoId === f.id}
                  >
                    {eliminandoId === f.id ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <strong style={{ fontSize: '0.9rem' }}>{editando ? 'Editar familiar' : 'Agregar familiar'}</strong>
        <div>
          <label htmlFor="fam-vinculo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Vínculo</label>
          <select id="fam-vinculo" className="input" value={form.vinculo} onChange={(e) => setForm((f) => ({ ...f, vinculo: e.target.value }))}>
            {VINCULOS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="fam-nombre" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Nombre</label>
          <input id="fam-nombre" className="input" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="fam-cuil" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>CUIL (opcional)</label>
          <input id="fam-cuil" className="input" value={form.cuil} onChange={(e) => setForm((f) => ({ ...f, cuil: e.target.value }))} placeholder="20-12345678-9" />
        </div>
        <div>
          <label htmlFor="fam-nac" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de nacimiento (opcional)</label>
          <input id="fam-nac" className="input" type="date" value={form.fechaNacimiento} onChange={(e) => setForm((f) => ({ ...f, fechaNacimiento: e.target.value }))} />
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={handleGuardar} disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Agregar'}
          </button>
          {editando && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setForm(FORM_VACIO); setError('') }} disabled={guardando}>
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/components/legajo/__tests__/TabFamiliares.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/legajo/TabFamiliares.jsx src/components/legajo/__tests__/TabFamiliares.test.jsx
git commit -m "feat(legajo): editar familiares desde la ficha"
```

---

### Task 5: Editar sanciones

Mismo patrón que la Task 4 — `legajoStore.guardarSancion` ya hace UPDATE cuando el objeto trae `id`.

**Files:**
- Modify: `src/components/legajo/TabSanciones.jsx`
- Test: `src/components/legajo/__tests__/TabSanciones.test.jsx` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `src/components/legajo/__tests__/TabSanciones.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabSanciones from '../TabSanciones'

const guardarSancionMock = vi.fn().mockResolvedValue({ ok: true })
const eliminarSancionMock = vi.fn().mockResolvedValue({ ok: true })
const estado = {
  sanciones: [{ id: 's1', tipo: 'suspension', fecha: '2026-05-04', motivo: 'Ausencia sin aviso', diasSuspension: 2 }],
  guardarSancion: guardarSancionMock,
  eliminarSancion: eliminarSancionMock,
}
vi.mock('../../../store/legajoStore', () => ({
  useLegajoStore: (selector) => selector(estado),
}))

describe('TabSanciones — edición', () => {
  beforeEach(() => { guardarSancionMock.mockClear() })

  it('el boton Editar precarga el formulario con los datos de la sancion', () => {
    render(<TabSanciones personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Motivo / descripción')).toHaveValue('Ausencia sin aviso')
    expect(screen.getByLabelText('Días de suspensión')).toHaveValue(2)
  })

  it('guardar en modo edicion llama a guardarSancion con el id existente', async () => {
    render(<TabSanciones personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Motivo / descripción'), { target: { value: 'Ausencia sin aviso (corregido)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(guardarSancionMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 's1', motivo: 'Ausencia sin aviso (corregido)' }),
        'p1', 'emp-1'
      )
    })
  })

  it('cancelar la edicion vuelve al formulario de alta vacio', () => {
    render(<TabSanciones personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByLabelText('Motivo / descripción')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/components/legajo/__tests__/TabSanciones.test.jsx`
Expected: FAIL — no existe el botón "Editar".

- [ ] **Step 3: Implementar el modo edición**

Reemplazar el contenido completo de `src/components/legajo/TabSanciones.jsx` por:

```jsx
import { useState } from 'react'
import { useLegajoStore } from '../../store/legajoStore'

const TIPOS = [
  { value: 'apercibimiento', label: 'Apercibimiento' },
  { value: 'suspension', label: 'Suspensión' },
  { value: 'llamado_atencion', label: 'Llamado de atención' },
  { value: 'otra', label: 'Otra' },
]

const FORM_VACIO = { id: null, tipo: 'apercibimiento', fecha: '', motivo: '', diasSuspension: '' }

// CRUD de sanciones del legajo (Task 47; edición agregada en Fase 6 Task 5).
// guardarSancion del store ya hacía UPDATE cuando el objeto trae `id`.
export default function TabSanciones({ personalId, empresaId }) {
  const sanciones = useLegajoStore((s) => s.sanciones)
  const guardarSancion = useLegajoStore((s) => s.guardarSancion)
  const eliminarSancion = useLegajoStore((s) => s.eliminarSancion)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [eliminandoId, setEliminandoId] = useState(null)
  const [error, setError] = useState('')

  const editando = form.id !== null

  const handleGuardar = async () => {
    setError('')
    if (!form.fecha) { setError('La fecha es obligatoria.'); return }
    if (!form.motivo.trim()) { setError('El motivo es obligatorio.'); return }
    setGuardando(true)
    const r = await guardarSancion(
      {
        ...(form.id ? { id: form.id } : {}),
        tipo: form.tipo,
        fecha: form.fecha,
        motivo: form.motivo,
        // En una edición hay que mandar SIEMPRE el campo (aunque sea null)
        // para poder borrar los días si la sanción deja de ser suspensión:
        // sancionToDB omite la columna cuando el valor es `undefined`.
        diasSuspension: form.tipo === 'suspension' ? (form.diasSuspension || null) : null,
      },
      personalId, empresaId
    )
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  const handleEditar = (s) => {
    setError('')
    setForm({
      id: s.id, tipo: s.tipo, fecha: s.fecha, motivo: s.motivo,
      diasSuspension: s.diasSuspension ?? '',
    })
  }

  const handleEliminar = async (id) => {
    setError('')
    setEliminandoId(id)
    const r = await eliminarSancion(id)
    setEliminandoId(null)
    if (!r.ok) { setError(r.error); return }
    if (form.id === id) setForm(FORM_VACIO)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>Sanciones ({sanciones.length})</h3>

      {sanciones.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin sanciones registradas.</p>}
      {sanciones.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sanciones.map((s) => {
            const tipoLabel = TIPOS.find((t) => t.value === s.tipo)?.label || s.tipo
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>
                  {s.fecha} — {tipoLabel}: {s.motivo}
                  {s.diasSuspension ? ` (${s.diasSuspension} días)` : ''}
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleEditar(s)}>Editar</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleEliminar(s.id)}
                    disabled={eliminandoId === s.id}
                  >
                    {eliminandoId === s.id ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <strong style={{ fontSize: '0.9rem' }}>{editando ? 'Editar sanción' : 'Registrar sanción'}</strong>
        <div>
          <label htmlFor="san-tipo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Tipo</label>
          <select id="san-tipo" className="input" value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="san-fecha" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha</label>
          <input id="san-fecha" className="input" type="date" value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="san-motivo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Motivo / descripción</label>
          <textarea id="san-motivo" className="input" value={form.motivo} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))} />
        </div>
        {form.tipo === 'suspension' && (
          <div>
            <label htmlFor="san-dias" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Días de suspensión</label>
            <input
              id="san-dias"
              className="input"
              type="number"
              min="1"
              value={form.diasSuspension}
              onChange={(e) => setForm((f) => ({ ...f, diasSuspension: e.target.value }))}
            />
          </div>
        )}

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={handleGuardar} disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Agregar'}
          </button>
          {editando && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setForm(FORM_VACIO); setError('') }} disabled={guardando}>
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Ajustar `sancionToDB` para aceptar el borrado de días**

En `src/store/legajoStore.js`, reemplazar la línea de `dias_suspension` dentro de `sancionToDB` por:

```js
  ...(s.diasSuspension !== undefined && { dias_suspension: s.diasSuspension ? Number(s.diasSuspension) : null }),
```

(ya es así — verificar que no haya cambiado; si ya coincide, no hay edición que hacer en este step).

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/components/legajo/__tests__/TabSanciones.test.jsx src/store/__tests__/legajoStore.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/legajo/TabSanciones.jsx src/components/legajo/__tests__/TabSanciones.test.jsx
git commit -m "feat(legajo): editar sanciones desde la ficha"
```

---

### Task 6: Documentación — carga en el legajo y tipos requeridos configurables

**Alcance y decisión de arquitectura:**

`documentos_personal` y `tipos_documento` son tablas **de Presencio**. `supabase/migrations/0001_vistas_contrato.sql` establece que Recursio nunca escribe en ellas. Por eso:

- **Lectura:** la pestaña sigue leyendo `documentos_personal` (lo que se cargó desde Presencio aparece en Recursio, como hoy).
- **Escritura:** Recursio guarda en tablas propias, `nom_documentos_legajo` (+ bucket de Storage `nom-documentos`).
- La pestaña muestra **una sola lista unificada** de ambos orígenes, con una columna "Origen".
- Que los documentos cargados en Recursio se vean **dentro de Presencio** requiere un cambio en la otra app y quedó explícitamente pendiente de decisión del usuario. **No se implementa acá.**

**Files:**
- Create: `supabase/migrations/0032_documentos_legajo.sql`
- Create: `src/store/documentosStore.js`
- Create: `src/components/config/TabDocumentacion.jsx`
- Modify: `src/components/legajo/DocumentosLegajo.jsx`
- Modify: `src/pages/ConfiguracionPage.jsx`
- Test: `src/store/__tests__/documentosStore.test.js`
- Test: `src/components/legajo/__tests__/DocumentosLegajo.test.jsx`

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/0032_documentos_legajo.sql`:

```sql
-- 0032_documentos_legajo.sql — Fase 6 Task 6
--
-- Documentación del legajo, del lado de Recursio. NO se escribe en
-- `documentos_personal` (tabla de Presencio): el contrato de
-- 0001_vistas_contrato.sql prohíbe que Recursio escriba en tablas de la
-- otra app. La ficha del legajo LEE documentos_personal y ESCRIBE acá; la
-- lista que ve el usuario es la unión de ambos orígenes.
--
-- nom_documentos_requeridos: qué documentación exige la empresa (config).
-- nom_documentos_legajo: los archivos efectivamente cargados por persona.

CREATE TABLE IF NOT EXISTS nom_documentos_requeridos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,
  nombre        TEXT NOT NULL,
  obligatorio   BOOLEAN NOT NULL DEFAULT true,
  -- vence: si el documento caduca (ART, libreta sanitaria, carnet de
  -- conducir). Si es false, la ficha no pide fecha de vencimiento.
  vence         BOOLEAN NOT NULL DEFAULT false,
  -- dias_aviso: cuántos días antes del vencimiento se marca "por vencer"
  -- en el semáforo de la ficha y en el Dashboard.
  dias_aviso    INT NOT NULL DEFAULT 30,
  orden         INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE IF NOT EXISTS nom_documentos_legajo (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id        UUID NOT NULL,
  requerido_id       UUID REFERENCES nom_documentos_requeridos(id) ON DELETE SET NULL,
  nombre             TEXT NOT NULL,
  storage_path       TEXT,
  fecha_emision      DATE,
  fecha_vencimiento  DATE,
  observaciones      TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nom_documentos_legajo_personal_idx
  ON nom_documentos_legajo(personal_id);

ALTER TABLE nom_documentos_requeridos ENABLE ROW LEVEL SECURITY;
ALTER TABLE nom_documentos_legajo     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nom_documentos_requeridos_rw ON nom_documentos_requeridos;
CREATE POLICY nom_documentos_requeridos_rw ON nom_documentos_requeridos FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

DROP POLICY IF EXISTS nom_documentos_legajo_rw ON nom_documentos_legajo;
CREATE POLICY nom_documentos_legajo_rw ON nom_documentos_legajo FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_documentos_requeridos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_documentos_legajo     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_documentos_requeridos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_documentos_legajo     TO service_role;

-- Bucket privado para los archivos. El acceso se hace siempre con URL
-- firmada (createSignedUrl) desde el front — nunca público.
INSERT INTO storage.buckets (id, name, public)
SELECT 'nom-documentos', 'nom-documentos', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'nom-documentos');

DROP POLICY IF EXISTS nom_documentos_storage_rw ON storage.objects;
CREATE POLICY nom_documentos_storage_rw ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'nom-documentos')
  WITH CHECK (bucket_id = 'nom-documentos');
```

- [ ] **Step 2: Aplicar la migración**

Abrir Supabase → SQL Editor → pegar el contenido de `supabase/migrations/0032_documentos_legajo.sql` → Run.
Expected: "Success. No rows returned".

Verificar: `select count(*) from nom_documentos_requeridos;` → devuelve `0` sin error de permisos.

- [ ] **Step 3: Escribir el test del store**

Crear `src/store/__tests__/documentosStore.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { requeridoFromDB, documentoFromDB, estadoDocumento, faltantes } from '../documentosStore'

describe('mappers de documentos', () => {
  it('requeridoFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'r1', empresa_id: 'e1', codigo: 'art', nombre: 'ART', obligatorio: true, vence: true, dias_aviso: 30, orden: 10 }
    expect(requeridoFromDB(row)).toEqual({
      id: 'r1', empresaId: 'e1', codigo: 'art', nombre: 'ART',
      obligatorio: true, vence: true, diasAviso: 30, orden: 10,
    })
  })

  it('documentoFromDB mapea snake_case a camelCase y marca el origen recursio', () => {
    const row = { id: 'd1', empresa_id: 'e1', personal_id: 'p1', requerido_id: 'r1', nombre: 'ART 2026', storage_path: 'e1/p1/art.pdf', fecha_emision: '2026-01-01', fecha_vencimiento: '2026-12-31', observaciones: null }
    expect(documentoFromDB(row)).toEqual({
      id: 'd1', empresaId: 'e1', personalId: 'p1', requeridoId: 'r1', nombre: 'ART 2026',
      storagePath: 'e1/p1/art.pdf', fechaEmision: '2026-01-01', fechaVencimiento: '2026-12-31',
      observaciones: null, origen: 'recursio',
    })
  })
})

describe('estadoDocumento', () => {
  const hoy = '2026-07-28'
  it('sin vencimiento es vigente', () => {
    expect(estadoDocumento({ fechaVencimiento: null }, 30, hoy).clave).toBe('sin_vencimiento')
  })
  it('vencido cuando la fecha ya pasó', () => {
    expect(estadoDocumento({ fechaVencimiento: '2026-07-27' }, 30, hoy).clave).toBe('vencido')
  })
  it('por vencer dentro de los dias de aviso', () => {
    expect(estadoDocumento({ fechaVencimiento: '2026-08-10' }, 30, hoy).clave).toBe('por_vencer')
  })
  it('vigente fuera de los dias de aviso', () => {
    expect(estadoDocumento({ fechaVencimiento: '2026-12-31' }, 30, hoy).clave).toBe('vigente')
  })
})

describe('faltantes', () => {
  const requeridos = [
    { id: 'r1', codigo: 'art', nombre: 'ART', obligatorio: true },
    { id: 'r2', codigo: 'dni', nombre: 'DNI', obligatorio: true },
    { id: 'r3', codigo: 'carnet', nombre: 'Carnet', obligatorio: false },
  ]
  it('devuelve solo los obligatorios sin documento cargado', () => {
    const docs = [{ requeridoId: 'r1', nombre: 'ART 2026' }]
    expect(faltantes(requeridos, docs).map((r) => r.codigo)).toEqual(['dni'])
  })
  it('no falta nada cuando todos los obligatorios estan cargados', () => {
    const docs = [{ requeridoId: 'r1' }, { requeridoId: 'r2' }]
    expect(faltantes(requeridos, docs)).toEqual([])
  })
})
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `npx vitest run src/store/__tests__/documentosStore.test.js`
Expected: FAIL — "Failed to resolve import '../documentosStore'".

- [ ] **Step 5: Implementar el store**

Crear `src/store/documentosStore.js`:

```js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const BUCKET = 'nom-documentos'

export const requeridoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, codigo: r.codigo, nombre: r.nombre,
  obligatorio: r.obligatorio, vence: r.vence, diasAviso: r.dias_aviso, orden: r.orden,
})

export const requeridoToDB = (r, empresaId) => ({
  empresa_id: empresaId, codigo: r.codigo, nombre: r.nombre,
  obligatorio: r.obligatorio ?? true, vence: r.vence ?? false,
  dias_aviso: Number(r.diasAviso ?? 30), orden: Number(r.orden ?? 100),
})

// `origen` distingue los documentos propios de Recursio de los que vienen
// de Presencio (documentos_personal). La ficha muestra una sola lista con
// los dos orígenes; solo los de origen 'recursio' son editables desde acá.
export const documentoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, requeridoId: r.requerido_id,
  nombre: r.nombre, storagePath: r.storage_path, fechaEmision: r.fecha_emision,
  fechaVencimiento: r.fecha_vencimiento, observaciones: r.observaciones, origen: 'recursio',
})

export const documentoPresencioFromDB = (r) => ({
  id: `presencio:${r.id}`, personalId: r.personal_id, requeridoId: null,
  nombre: r.nombre, storagePath: null, fechaEmision: null,
  fechaVencimiento: r.fecha_vencimiento ?? null, observaciones: null, origen: 'presencio',
})

// Estado de vencimiento con los días de aviso configurados por documento.
// `hoy` es inyectable para poder testear sin congelar el reloj.
export function estadoDocumento(doc, diasAviso = 30, hoy = new Date().toISOString().slice(0, 10)) {
  if (!doc.fechaVencimiento) return { clave: 'sin_vencimiento', label: 'Sin vencimiento', clase: 'badge-neutral' }
  const dias = Math.floor((new Date(doc.fechaVencimiento) - new Date(hoy)) / 86400000)
  if (dias < 0) return { clave: 'vencido', label: 'Vencido', clase: 'badge-danger' }
  if (dias <= diasAviso) return { clave: 'por_vencer', label: `Por vencer (${dias} d)`, clase: 'badge-warning' }
  return { clave: 'vigente', label: 'Vigente', clase: 'badge-success' }
}

// Documentos obligatorios de la empresa que esta persona todavía no cargó.
export function faltantes(requeridos, documentos) {
  const cargados = new Set(documentos.map((d) => d.requeridoId).filter(Boolean))
  return requeridos.filter((r) => r.obligatorio && !cargados.has(r.id))
}

export const useDocumentosStore = create((set, get) => ({
  requeridos: [], documentos: [], cargando: false, error: null,

  cargarRequeridos: async (empresaId) => {
    if (!empresaId) { set({ requeridos: [] }); return }
    const { data, error } = await supabase.from('nom_documentos_requeridos').select('*')
      .eq('empresa_id', empresaId).order('orden').order('nombre')
    if (error) { set({ error: error.message }); return }
    set({ requeridos: (data || []).map(requeridoFromDB), error: null })
  },

  guardarRequerido: async (requerido, empresaId) => {
    const row = requeridoToDB(requerido, empresaId)
    const query = requerido.id
      ? supabase.from('nom_documentos_requeridos').update(row).eq('id', requerido.id)
      : supabase.from('nom_documentos_requeridos').insert(row)
    const { error } = await query
    if (error) return { ok: false, error: error.message }
    await get().cargarRequeridos(empresaId)
    return { ok: true }
  },

  eliminarRequerido: async (id, empresaId) => {
    const { error } = await supabase.from('nom_documentos_requeridos').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    await get().cargarRequeridos(empresaId)
    return { ok: true }
  },

  // Une los documentos propios (nom_documentos_legajo) con los de
  // Presencio (documentos_personal, solo lectura).
  cargarDocumentos: async (personalId) => {
    set({ cargando: true, error: null })
    const [{ data: propios, error: errPropios }, { data: presencio }] = await Promise.all([
      supabase.from('nom_documentos_legajo').select('*').eq('personal_id', personalId).order('created_at', { ascending: false }),
      supabase.from('documentos_personal').select('*').eq('personal_id', personalId),
    ])
    if (errPropios) { set({ error: errPropios.message, cargando: false }); return }
    set({
      documentos: [
        ...(propios || []).map(documentoFromDB),
        ...(presencio || []).map(documentoPresencioFromDB),
      ],
      cargando: false,
    })
  },

  // Sube el archivo al bucket privado y registra la fila. Si la subida
  // falla, no se inserta nada (nunca queda una fila apuntando a un archivo
  // inexistente). El archivo es opcional: se puede registrar solo la fecha
  // de vencimiento de un documento en papel.
  subirDocumento: async ({ archivo, nombre, requeridoId, fechaEmision, fechaVencimiento, observaciones }, personalId, empresaId) => {
    let storagePath = null
    if (archivo) {
      storagePath = `${empresaId}/${personalId}/${Date.now()}-${archivo.name.replace(/[^\w.-]/g, '_')}`
      const { error: errUpload } = await supabase.storage.from(BUCKET).upload(storagePath, archivo)
      if (errUpload) return { ok: false, error: `no se pudo subir el archivo: ${errUpload.message}` }
    }
    const { error } = await supabase.from('nom_documentos_legajo').insert({
      empresa_id: empresaId, personal_id: personalId,
      requerido_id: requeridoId || null, nombre,
      storage_path: storagePath,
      fecha_emision: fechaEmision || null,
      fecha_vencimiento: fechaVencimiento || null,
      observaciones: observaciones || null,
    })
    if (error) return { ok: false, error: error.message }
    await get().cargarDocumentos(personalId)
    return { ok: true }
  },

  eliminarDocumento: async (id, personalId) => {
    const doc = get().documentos.find((d) => d.id === id)
    if (doc?.storagePath) await supabase.storage.from(BUCKET).remove([doc.storagePath])
    const { error } = await supabase.from('nom_documentos_legajo').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    await get().cargarDocumentos(personalId)
    return { ok: true }
  },

  // URL firmada de 60 s para ver/descargar sin exponer el bucket.
  urlFirmada: async (storagePath) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60)
    if (error) return { ok: false, error: error.message }
    return { ok: true, url: data.signedUrl }
  },
}))
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx vitest run src/store/__tests__/documentosStore.test.js`
Expected: PASS (8 tests).

- [ ] **Step 7: Escribir el test de la pestaña de documentación del legajo**

Crear `src/components/legajo/__tests__/DocumentosLegajo.test.jsx` (reemplaza el archivo existente si ya hay uno — el viejo testea la versión de solo lectura):

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DocumentosLegajo from '../DocumentosLegajo'

const subirDocumentoMock = vi.fn().mockResolvedValue({ ok: true })
const estado = {
  requeridos: [
    { id: 'r1', codigo: 'art', nombre: 'ART', obligatorio: true, vence: true, diasAviso: 30 },
    { id: 'r2', codigo: 'dni', nombre: 'Copia de DNI', obligatorio: true, vence: false, diasAviso: 30 },
  ],
  documentos: [
    { id: 'd1', requeridoId: 'r1', nombre: 'ART 2026', fechaVencimiento: '2026-12-31', storagePath: 'x/y.pdf', origen: 'recursio' },
    { id: 'presencio:z', requeridoId: null, nombre: 'Libreta sanitaria', fechaVencimiento: null, storagePath: null, origen: 'presencio' },
  ],
  cargando: false,
  error: null,
  cargarRequeridos: vi.fn(),
  cargarDocumentos: vi.fn(),
  subirDocumento: subirDocumentoMock,
  eliminarDocumento: vi.fn().mockResolvedValue({ ok: true }),
  urlFirmada: vi.fn().mockResolvedValue({ ok: true, url: 'https://x/y' }),
}
vi.mock('../../../store/documentosStore', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useDocumentosStore: (selector) => (selector ? selector(estado) : estado) }
})

describe('DocumentosLegajo', () => {
  beforeEach(() => { subirDocumentoMock.mockClear() })

  it('lista documentos de ambos origenes', () => {
    render(<DocumentosLegajo personalId="p1" empresaId="e1" />)
    expect(screen.getByText('ART 2026')).toBeInTheDocument()
    expect(screen.getByText('Libreta sanitaria')).toBeInTheDocument()
    expect(screen.getByText('Presencio')).toBeInTheDocument()
  })

  it('avisa cuales documentos obligatorios faltan', () => {
    render(<DocumentosLegajo personalId="p1" empresaId="e1" />)
    expect(screen.getByText(/Falta cargar: Copia de DNI/)).toBeInTheDocument()
  })

  it('cargar un documento llama a subirDocumento con los datos del formulario', async () => {
    render(<DocumentosLegajo personalId="p1" empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Nombre del documento'), { target: { value: 'DNI frente y dorso' } })
    fireEvent.change(screen.getByLabelText('Tipo requerido'), { target: { value: 'r2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cargar documento' }))
    await waitFor(() => {
      expect(subirDocumentoMock).toHaveBeenCalledWith(
        expect.objectContaining({ nombre: 'DNI frente y dorso', requeridoId: 'r2' }),
        'p1', 'e1'
      )
    })
  })
})
```

- [ ] **Step 8: Correr el test y verificar que falla**

Run: `npx vitest run src/components/legajo/__tests__/DocumentosLegajo.test.jsx`
Expected: FAIL — el componente actual no tiene formulario ni usa el store.

- [ ] **Step 9: Implementar la pestaña**

Reemplazar el contenido completo de `src/components/legajo/DocumentosLegajo.jsx` por:

```jsx
import { useEffect, useState } from 'react'
import { useDocumentosStore, estadoDocumento, faltantes } from '../../store/documentosStore'

const FORM_VACIO = { nombre: '', requeridoId: '', fechaEmision: '', fechaVencimiento: '', observaciones: '', archivo: null }

// Documentación del legajo (Fase 6 Task 6). Muestra una sola lista con los
// documentos propios de Recursio (editables) y los que vienen de Presencio
// (solo lectura — Recursio no escribe en documentos_personal). Los tipos
// requeridos se configuran en Configuración → Documentación.
export default function DocumentosLegajo({ personalId, empresaId }) {
  const requeridos = useDocumentosStore((s) => s.requeridos)
  const documentos = useDocumentosStore((s) => s.documentos)
  const cargando = useDocumentosStore((s) => s.cargando)
  const errorCarga = useDocumentosStore((s) => s.error)
  const cargarRequeridos = useDocumentosStore((s) => s.cargarRequeridos)
  const cargarDocumentos = useDocumentosStore((s) => s.cargarDocumentos)
  const subirDocumento = useDocumentosStore((s) => s.subirDocumento)
  const eliminarDocumento = useDocumentosStore((s) => s.eliminarDocumento)
  const urlFirmada = useDocumentosStore((s) => s.urlFirmada)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { cargarDocumentos(personalId) }, [personalId])
  useEffect(() => { if (empresaId) cargarRequeridos(empresaId) }, [empresaId])

  const pendientes = faltantes(requeridos, documentos)
  const diasAvisoDe = (requeridoId) => requeridos.find((r) => r.id === requeridoId)?.diasAviso ?? 30

  const handleCargar = async () => {
    setError('')
    if (!form.nombre.trim()) { setError('Poné un nombre para el documento.'); return }
    setGuardando(true)
    const r = await subirDocumento({
      archivo: form.archivo,
      nombre: form.nombre.trim(),
      requeridoId: form.requeridoId || null,
      fechaEmision: form.fechaEmision || null,
      fechaVencimiento: form.fechaVencimiento || null,
      observaciones: form.observaciones || null,
    }, personalId, empresaId)
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  const handleVer = async (doc) => {
    setError('')
    const r = await urlFirmada(doc.storagePath)
    if (!r.ok) { setError(r.error); return }
    window.open(r.url, '_blank', 'noopener,noreferrer')
  }

  const handleEliminar = async (doc) => {
    setError('')
    const r = await eliminarDocumento(doc.id, personalId)
    if (!r.ok) setError(r.error)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {errorCarga && <p style={{ color: 'var(--danger)' }}>Error al cargar documentos: {errorCarga}</p>}

      {pendientes.length > 0 && (
        <div className="badge badge-warning" style={{ alignSelf: 'flex-start' }}>
          Falta cargar: {pendientes.map((r) => r.nombre).join(', ')}
        </div>
      )}

      {cargando && <p style={{ color: 'var(--text-secondary)' }}>Cargando documentos…</p>}
      {!cargando && documentos.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin documentos cargados.</p>}

      {documentos.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Documento</th><th>Vence</th><th>Estado</th><th>Origen</th><th></th></tr>
          </thead>
          <tbody>
            {documentos.map((d) => {
              const est = estadoDocumento(d, diasAvisoDe(d.requeridoId))
              return (
                <tr key={d.id}>
                  <td>{d.nombre}</td>
                  <td>{d.fechaVencimiento || '—'}</td>
                  <td><span className={`badge ${est.clase}`}>{est.label}</span></td>
                  <td><span className="badge badge-neutral">{d.origen === 'presencio' ? 'Presencio' : 'Recursio'}</span></td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    {d.storagePath && <button className="btn btn-ghost btn-sm" onClick={() => handleVer(d)}>Ver</button>}
                    {d.origen === 'recursio' && <button className="btn btn-ghost btn-sm" onClick={() => handleEliminar(d)}>Eliminar</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <strong style={{ fontSize: '0.9rem' }}>Cargar documento</strong>
        <div>
          <label htmlFor="doc-nombre" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Nombre del documento</label>
          <input id="doc-nombre" className="input" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="doc-tipo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Tipo requerido</label>
          <select id="doc-tipo" className="input" value={form.requeridoId} onChange={(e) => setForm((f) => ({ ...f, requeridoId: e.target.value }))}>
            <option value="">Sin clasificar</option>
            {requeridos.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="doc-emision" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de emisión (opcional)</label>
          <input id="doc-emision" className="input" type="date" value={form.fechaEmision} onChange={(e) => setForm((f) => ({ ...f, fechaEmision: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="doc-vence" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de vencimiento (opcional)</label>
          <input id="doc-vence" className="input" type="date" value={form.fechaVencimiento} onChange={(e) => setForm((f) => ({ ...f, fechaVencimiento: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="doc-archivo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Archivo (PDF o imagen, opcional)</label>
          <input id="doc-archivo" className="input" type="file" accept=".pdf,image/*"
            onChange={(e) => setForm((f) => ({ ...f, archivo: e.target.files?.[0] || null }))} />
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

        <div>
          <button className="btn btn-primary btn-sm" onClick={handleCargar} disabled={guardando}>
            {guardando ? 'Cargando…' : 'Cargar documento'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 10: Pasarle `empresaId` desde la ficha**

En `src/pages/FichaLegajoPage.jsx`, reemplazar:

```jsx
        <DocumentosLegajo personalId={personalId} />
```

por:

```jsx
        <DocumentosLegajo personalId={personalId} empresaId={empresaActiva?.id} />
```

- [ ] **Step 11: Correr el test y verificar que pasa**

Run: `npx vitest run src/components/legajo/__tests__/DocumentosLegajo.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 12: Crear la pestaña de Configuración → Documentación**

Crear `src/components/config/TabDocumentacion.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useDocumentosStore } from '../../store/documentosStore'

const FORM_VACIO = { id: null, codigo: '', nombre: '', obligatorio: true, vence: false, diasAviso: 30, orden: 100 }

// Configuración de qué documentación exige la empresa en cada legajo
// (Fase 6 Task 6). La ficha del legajo usa esta lista para avisar qué
// falta cargar y con cuántos días de anticipación marcar "por vencer".
export default function TabDocumentacion({ empresaId }) {
  const requeridos = useDocumentosStore((s) => s.requeridos)
  const cargarRequeridos = useDocumentosStore((s) => s.cargarRequeridos)
  const guardarRequerido = useDocumentosStore((s) => s.guardarRequerido)
  const eliminarRequerido = useDocumentosStore((s) => s.eliminarRequerido)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (empresaId) cargarRequeridos(empresaId) }, [empresaId])

  const editando = form.id !== null

  const handleGuardar = async () => {
    setError('')
    if (!form.codigo.trim() || !form.nombre.trim()) { setError('Completá código y nombre.'); return }
    setGuardando(true)
    const r = await guardarRequerido({ ...form, codigo: form.codigo.trim(), nombre: form.nombre.trim() }, empresaId)
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Documentación exigida en cada legajo. Los marcados como obligatorios aparecen como
        "falta cargar" en la ficha de la persona y suman al contador de legajos a revisar del Dashboard.
      </p>

      <table className="table">
        <thead>
          <tr><th>Código</th><th>Nombre</th><th>Obligatorio</th><th>Vence</th><th>Aviso</th><th></th></tr>
        </thead>
        <tbody>
          {requeridos.map((r) => (
            <tr key={r.id}>
              <td><code>{r.codigo}</code></td>
              <td>{r.nombre}</td>
              <td>{r.obligatorio ? 'Sí' : 'No'}</td>
              <td>{r.vence ? 'Sí' : 'No'}</td>
              <td>{r.vence ? `${r.diasAviso} días` : '—'}</td>
              <td style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...r })}>Editar</button>
                <button className="btn btn-ghost btn-sm" onClick={() => eliminarRequerido(r.id, empresaId)}>Eliminar</button>
              </td>
            </tr>
          ))}
          {requeridos.length === 0 && <tr><td colSpan={6}>Sin documentación configurada.</td></tr>}
        </tbody>
      </table>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <strong style={{ fontSize: '0.9rem' }}>{editando ? 'Editar tipo de documento' : 'Agregar tipo de documento'}</strong>
        <div>
          <label htmlFor="req-codigo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Código</label>
          <input id="req-codigo" className="input" value={form.codigo} placeholder="art"
            onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="req-nombre" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Nombre</label>
          <input id="req-nombre" className="input" value={form.nombre} placeholder="Constancia de ART"
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
        </div>
        <label htmlFor="req-oblig" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
          <input id="req-oblig" type="checkbox" checked={form.obligatorio}
            onChange={(e) => setForm((f) => ({ ...f, obligatorio: e.target.checked }))} />
          Obligatorio
        </label>
        <label htmlFor="req-vence" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
          <input id="req-vence" type="checkbox" checked={form.vence}
            onChange={(e) => setForm((f) => ({ ...f, vence: e.target.checked }))} />
          Vence
        </label>
        {form.vence && (
          <div>
            <label htmlFor="req-aviso" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Avisar N días antes</label>
            <input id="req-aviso" className="input" type="number" min="1" value={form.diasAviso}
              onChange={(e) => setForm((f) => ({ ...f, diasAviso: e.target.value }))} />
          </div>
        )}

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={handleGuardar} disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Agregar'}
          </button>
          {editando && <button className="btn btn-ghost btn-sm" onClick={() => setForm(FORM_VACIO)}>Cancelar</button>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 13: Registrar la pestaña en Configuración**

En `src/pages/ConfiguracionPage.jsx`:

1. Agregar el import junto a los otros tabs:

```jsx
import TabDocumentacion from '../components/config/TabDocumentacion'
```

2. Reemplazar la constante `PESTANAS`:

```jsx
const PESTANAS = ['Escalas salariales', 'No remunerativos', 'Aportes y contribuciones', 'Adicionales', 'Parámetros', 'Documentación', 'Alertas', 'Flujo de aprobación', 'Empresa']
```

(la pestaña "Alertas" se implementa en la Task 9; por ahora dejarla en la lista y agregar su render en esa task.)

3. Agregar el render junto a los demás:

```jsx
          {pestana === 'Documentación' && <TabDocumentacion empresaId={empresaActiva.id} />}
```

- [ ] **Step 14: Verificar en la app**

1. `npm run dev`
2. Configuración → Documentación → agregar `art` / "Constancia de ART" / obligatorio / vence / 30 días.
3. Legajos → una persona → Documentación → debe aparecer "Falta cargar: Constancia de ART".
4. Cargar un PDF con vencimiento 2026-12-31 → aparece en la tabla con badge "Vigente" y origen "Recursio", y el aviso de faltante desaparece.
5. Click en "Ver" → abre el PDF en una pestaña nueva.

- [ ] **Step 15: Commit**

```bash
git add supabase/migrations/0032_documentos_legajo.sql src/store/documentosStore.js src/store/__tests__/documentosStore.test.js src/components/legajo/DocumentosLegajo.jsx src/components/legajo/__tests__/DocumentosLegajo.test.jsx src/components/config/TabDocumentacion.jsx src/pages/ConfiguracionPage.jsx src/pages/FichaLegajoPage.jsx
git commit -m "feat(legajo): carga de documentacion con tipos requeridos configurables"
```

---

### Task 8: Etiquetas de período legibles (hacer ANTES de las Tasks 7 y 9)

**Requisito del usuario:** el período debe mostrarse como
- `Junio 2026 · 1ª quincena` / `Junio 2026 · 2ª quincena`
- `Junio 2026 · Fuera de convenio` (período mensual que liquida **sólo** al personal marcado fuera de convenio)
- `Junio 2026 · 1er SAC` / `Junio 2026 · 2do SAC`

Hoy la etiqueta se arma en tres lugares distintos y de forma distinta: `SelectorPeriodo.jsx` (mapa `ETIQUETA_TIPO`), `LiquidacionPage.jsx:154` y `:327` (`${tipo} — ${desde} a ${hasta}`) y `FichaLegajoPage.jsx:182`. Se unifica en un util puro.

Además se agrega el tipo `mensual_fc` a `nom_periodos.tipo` y el filtrado correspondiente en la Edge Function.

**Files:**
- Create: `src/utils/etiquetaPeriodo.js`
- Create: `src/utils/__tests__/etiquetaPeriodo.test.js`
- Create: `supabase/migrations/0033_periodo_mensual_fuera_convenio.sql`
- Modify: `src/components/SelectorPeriodo.jsx`
- Modify: `src/pages/LiquidacionPage.jsx` (líneas 154, 274-282, 327)
- Modify: `supabase/functions/liquidar-periodo/index.ts`

- [ ] **Step 1: Escribir el test del util**

Crear `src/utils/__tests__/etiquetaPeriodo.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { etiquetaPeriodo, etiquetaTipoPeriodo } from '../etiquetaPeriodo'

describe('etiquetaPeriodo', () => {
  it('quincena 1', () => {
    expect(etiquetaPeriodo({ tipo: 'quincena_1', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-15' }))
      .toBe('Junio 2026 · 1ra quincena')
  })

  it('quincena 2', () => {
    expect(etiquetaPeriodo({ tipo: 'quincena_2', fecha_desde: '2026-06-16', fecha_hasta: '2026-06-30' }))
      .toBe('Junio 2026 · 2da quincena')
  })

  it('mensual fuera de convenio', () => {
    expect(etiquetaPeriodo({ tipo: 'mensual_fc', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-30' }))
      .toBe('Junio 2026 · Fuera de convenio')
  })

  it('primer SAC', () => {
    expect(etiquetaPeriodo({ tipo: 'sac_1', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-30' }))
      .toBe('Junio 2026 · 1er SAC')
  })

  it('segundo SAC', () => {
    expect(etiquetaPeriodo({ tipo: 'sac_2', fecha_desde: '2026-12-01', fecha_hasta: '2026-12-31' }))
      .toBe('Diciembre 2026 · 2do SAC')
  })

  it('mensual comun', () => {
    expect(etiquetaPeriodo({ tipo: 'mensual', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-31' }))
      .toBe('Julio 2026 · Mensual')
  })

  it('acepta camelCase (nom_periodos anidado en otras consultas)', () => {
    expect(etiquetaPeriodo({ tipo: 'final', fechaDesde: '2026-07-10' }))
      .toBe('Julio 2026 · Liquidación final')
  })

  it('periodo nulo devuelve un guion', () => {
    expect(etiquetaPeriodo(null)).toBe('—')
  })

  it('etiquetaTipoPeriodo devuelve solo el tipo, sin mes', () => {
    expect(etiquetaTipoPeriodo('quincena_1')).toBe('1ra quincena')
    expect(etiquetaTipoPeriodo('tipo_desconocido')).toBe('tipo_desconocido')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/utils/__tests__/etiquetaPeriodo.test.js`
Expected: FAIL — "Failed to resolve import '../etiquetaPeriodo'".

- [ ] **Step 3: Implementar el util**

Crear `src/utils/etiquetaPeriodo.js`:

```js
// Etiqueta única y legible de un período, compartida por el selector de
// Liquidación, la tabla de liquidaciones de la ficha del legajo y el
// recibo. Antes cada pantalla la armaba a mano y de forma distinta
// ("quincenal — 2026-06-15 a 2026-07-01").
//
// Formato pedido: "Mes Año · <tipo>".

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const ETIQUETA_TIPO = {
  mensual: 'Mensual',
  // 'quincenal' es el tipo viejo, previo a 0017: se conserva para no romper
  // los períodos ya creados.
  quincenal: 'Quincenal',
  quincena_1: '1ra quincena',
  quincena_2: '2da quincena',
  // mensual_fc: período mensual que liquida SOLO al personal fuera de
  // convenio (cobra mensual mientras UOCRA cobra por quincena) — 0033.
  mensual_fc: 'Fuera de convenio',
  sac: 'SAC',
  sac_1: '1er SAC',
  sac_2: '2do SAC',
  vacaciones: 'Vacaciones',
  final: 'Liquidación final',
}

export function etiquetaTipoPeriodo(tipo) {
  return ETIQUETA_TIPO[tipo] || tipo
}

export function etiquetaPeriodo(periodo) {
  if (!periodo) return '—'
  // Acepta snake_case (fila cruda de nom_periodos) y camelCase (filas ya
  // mapeadas por los stores).
  const desde = periodo.fecha_desde || periodo.fechaDesde
  if (!desde) return etiquetaTipoPeriodo(periodo.tipo)
  const anio = String(desde).slice(0, 4)
  const mes = MESES[Number(String(desde).slice(5, 7)) - 1] || ''
  return `${mes} ${anio} · ${etiquetaTipoPeriodo(periodo.tipo)}`
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/utils/__tests__/etiquetaPeriodo.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Migración del tipo `mensual_fc`**

Crear `supabase/migrations/0033_periodo_mensual_fuera_convenio.sql`:

```sql
-- 0033_periodo_mensual_fuera_convenio.sql — Fase 6 Task 8
--
-- Nuevo tipo de período: 'mensual_fc' (mensual — fuera de convenio). El
-- personal fuera de convenio cobra MENSUAL mientras el de UOCRA cobra por
-- quincena; hasta ahora ambos caían en el mismo período 'mensual' y no
-- había forma de liquidar a unos sin liquidar a los otros.
--
-- liquidar-periodo filtra por legajo.fuera_convenio cuando el período es
-- 'mensual_fc', y EXCLUYE a los fuera de convenio en los períodos
-- quincenales (si no, se les liquidaría medio sueldo dos veces al mes
-- además de su mensual).

ALTER TABLE nom_periodos DROP CONSTRAINT IF EXISTS nom_periodos_tipo_check;
ALTER TABLE nom_periodos ADD CONSTRAINT nom_periodos_tipo_check
  CHECK (tipo IN (
    'mensual','mensual_fc','quincenal','quincena_1','quincena_2',
    'sac','sac_1','sac_2','vacaciones','final'
  ));

COMMENT ON COLUMN nom_periodos.tipo IS
  'mensual_fc: período mensual que liquida ÚNICAMENTE al personal con nom_legajo.fuera_convenio = true. Los períodos quincenales excluyen a ese personal.';
```

- [ ] **Step 6: Aplicar la migración**

Supabase → SQL Editor → pegar `0033_periodo_mensual_fuera_convenio.sql` → Run.
Expected: "Success. No rows returned".

- [ ] **Step 7: Filtrar por fuera de convenio en la Edge Function**

En `supabase/functions/liquidar-periodo/index.ts`, inmediatamente **después** de la línea que arma `legajoPorPersonal` (`const legajoPorPersonal = new Map(...)`, línea 139) y **antes** del bloque `let personalAProcesar = personal || []`, reemplazar esa asignación por:

```ts
  // Un período 'mensual_fc' liquida SOLO al personal fuera de convenio
  // (cobra mensual); los períodos de quincena liquidan solo al resto (si
  // no, el fuera de convenio cobraría medio sueldo dos veces al mes ADEMÁS
  // de su mensual). El resto de los tipos no discrimina — migración 0033.
  const esPeriodoFueraConvenio = periodo.tipo === 'mensual_fc'
  const esPeriodoQuincenal =
    periodo.tipo === 'quincenal' || periodo.tipo === 'quincena_1' || periodo.tipo === 'quincena_2'
  let personalAProcesar = (personal || []).filter((p: any) => {
    const l = legajoPorPersonal.get(p.id)
    if (esPeriodoFueraConvenio) return l?.fuera_convenio === true
    if (esPeriodoQuincenal) return l?.fuera_convenio !== true
    return true
  })
```

- [ ] **Step 8: Ajustar el conteo total al universo filtrado**

En el mismo archivo, `personalAProcesar` ahora ya viene filtrado, así que **todas** las referencias a `(personal || []).length` como "total" pasan a ser el universo del período. Reemplazar el bloque de `reanudar` + `update` (líneas 142-153 originales) por:

```ts
  // Universo del período: la nómina que ESTE tipo de período debe liquidar
  // (ya filtrada por fuera de convenio arriba). Se guarda antes de aplicar
  // el filtro de `reanudar` porque es el denominador de calculo_total.
  const totalPeriodo = personalAProcesar.length
  if (reanudar) {
    const { data: yaLiquidados } = await supabase.from('nom_liquidaciones')
      .select('personal_id').eq('periodo_id', periodoId)
    const idsYaLiquidados = new Set((yaLiquidados || []).map((l: any) => l.personal_id))
    personalAProcesar = personalAProcesar.filter((p: any) => !idsYaLiquidados.has(p.id))
  }

  await supabase.from('nom_periodos').update({
    calculo_estado: 'calculando',
    calculo_total: totalPeriodo,
    calculo_procesados: totalPeriodo - personalAProcesar.length,
  }).eq('id', periodoId)
```

Y reemplazar el bloque final (el que la Task 1 ya tocó) por:

```ts
  const totalFinal = totalPeriodo
  // Los omitidos (legajo incompleto) ESTÁN procesados: se los evaluó y se
  // decidió no liquidarlos. Si no se los cuenta acá, `completo` queda en
  // false para siempre y el cliente reinvoca hasta agotar sus reintentos
  // sin que nada cambie nunca (bug de performance del 28/07/2026).
  const procesadosFinal =
    (totalPeriodo - personalAProcesar.length) + resultados.length + omitidos.length
  const completo = procesadosFinal >= totalFinal
```

Y en `let procesadosAcumulados = personal.length - personalAProcesar.length` (línea 428), reemplazar por:

```ts
  let procesadosAcumulados = totalPeriodo - personalAProcesar.length
```

- [ ] **Step 9: Usar el util en el selector de períodos**

En `src/components/SelectorPeriodo.jsx`:

1. Reemplazar las dos constantes del tope del archivo (`MESES` y `ETIQUETA_TIPO`) por:

```jsx
import { etiquetaTipoPeriodo } from '../utils/etiquetaPeriodo'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
```

2. Reemplazar la línea `{ETIQUETA_TIPO[p.tipo] || p.tipo}` por:

```jsx
                    {etiquetaTipoPeriodo(p.tipo)}
```

- [ ] **Step 10: Usar el util en la página de Liquidación**

En `src/pages/LiquidacionPage.jsx`:

1. Agregar el import junto a los otros utils:

```jsx
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
```

2. Reemplazar la línea 154 (`descripcion:` del recibo) por:

```jsx
          descripcion: etiquetaPeriodo(periodoActivo),
```

3. Reemplazar la línea 327 (`<span>{periodoActivo.tipo} — ...</span>`) por:

```jsx
          <span>{etiquetaPeriodo(periodoActivo)}</span>
```

4. Reemplazar el `<select>` de tipo del formulario "Nuevo período" (líneas 274-282) por:

```jsx
            <select className="input" value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value)}>
              <option value="quincena_1">1ra quincena</option>
              <option value="quincena_2">2da quincena</option>
              <option value="mensual_fc">Fuera de convenio (mensual)</option>
              <option value="mensual">Mensual</option>
              <option value="sac_1">1er SAC</option>
              <option value="sac_2">2do SAC</option>
              <option value="vacaciones">Vacaciones</option>
              <option value="final">Liquidación final</option>
            </select>
```

5. Reemplazar el `useState` de `nuevoTipo` (línea 35) por:

```jsx
  const [nuevoTipo, setNuevoTipo] = useState('quincena_1')
```

- [ ] **Step 11: Correr todos los tests**

Run: `npx vitest run`
Expected: PASS. Si algún test viejo de `LiquidacionPage` esperaba el texto `quincenal — 2026-...`, actualizarlo a la etiqueta nueva.

- [ ] **Step 12: Verificar en la app**

1. `npm run dev` → Liquidación → "Nuevo período" → tipo "1ra quincena", 2026-08-01 a 2026-08-15 → Crear.
2. El chip del selector dice "1ra quincena"; el encabezado de resultados dice "Agosto 2026 · 1ra quincena".
3. Crear un período "Fuera de convenio (mensual)" 2026-08-01 a 2026-08-31 → Calcular → sólo liquida a las personas con el legajo marcado fuera de convenio.

- [ ] **Step 13: Commit**

```bash
git add src/utils/etiquetaPeriodo.js src/utils/__tests__/etiquetaPeriodo.test.js supabase/migrations/0033_periodo_mensual_fuera_convenio.sql src/components/SelectorPeriodo.jsx src/pages/LiquidacionPage.jsx supabase/functions/liquidar-periodo/index.ts
git commit -m "feat(periodos): etiquetas legibles y periodo mensual solo para fuera de convenio"
```

---

### Task 7: Liquidaciones y recibos dentro del legajo

**Estado actual:** la pestaña "Liquidaciones" de `FichaLegajoPage` ya existe pero muestra `quincenal 2026-06-15 a 2026-07-01`, montos sin formato y no permite bajar el recibo. La generación del PDF vive entera en `LiquidacionPage.handleEmitirRecibo` (75 líneas) y no es reutilizable.

Se extrae esa lógica a `src/utils/emitirReciboLegajo.js` y la usan las dos pantallas.

**Files:**
- Create: `src/utils/emitirReciboLegajo.js`
- Create: `src/utils/__tests__/emitirReciboLegajo.test.js`
- Modify: `src/pages/FichaLegajoPage.jsx` (pestaña Liquidaciones)
- Modify: `src/pages/LiquidacionPage.jsx` (usar el util extraído)

- [ ] **Step 1: Escribir el test del util extraído**

Crear `src/utils/__tests__/emitirReciboLegajo.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { datosReciboDesdeSupabase } from '../emitirReciboLegajo'

const from = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { from: (t) => from(t) } }))

function tabla(data) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

describe('datosReciboDesdeSupabase', () => {
  beforeEach(() => {
    from.mockImplementation((t) => {
      if (t === 'empresas') return tabla({ nombre: 'Asset Construcciones', logo_url: null })
      if (t === 'nom_empresa_config') return tabla({ cuit: '30-1111-9', domicilio: 'Av. Siempreviva 742' })
      if (t === 'nom_legajo') return tabla({ cuil: '20-33901676-4', categoria_id: 'cat-1', fecha_ingreso: '2024-03-01', banco: 'Santander', antiguedad_reconocida: 0 })
      if (t === 'nom_categorias') return tabla({ nombre: 'Ayudante' })
      return tabla(null)
    })
  })

  it('arma empresa, persona y categoria resueltas', async () => {
    const r = await datosReciboDesdeSupabase({ empresaId: 'e1', personalId: 'p1', nombrePersona: 'Juan Martín García Cano' })
    expect(r.empresa).toEqual({ nombre: 'Asset Construcciones', cuit: '30-1111-9', domicilio: 'Av. Siempreviva 742' })
    expect(r.persona.cuil).toBe('20-33901676-4')
    expect(r.persona.categoria).toBe('Ayudante')
    expect(r.persona.nombre).toBe('Juan Martín García Cano')
  })

  it('usa guiones cuando faltan los datos fiscales', async () => {
    from.mockImplementation((t) => {
      if (t === 'empresas') return tabla({ nombre: 'X', logo_url: null })
      return tabla(null)
    })
    const r = await datosReciboDesdeSupabase({ empresaId: 'e1', personalId: 'p1', nombrePersona: 'Sin Legajo' })
    expect(r.empresa.cuit).toBe('—')
    expect(r.persona.categoria).toBe('—')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/utils/__tests__/emitirReciboLegajo.test.js`
Expected: FAIL — "Failed to resolve import '../emitirReciboLegajo'".

- [ ] **Step 3: Implementar el util**

Crear `src/utils/emitirReciboLegajo.js`:

```js
import { supabase } from '../lib/supabase'
import { generarReciboPdf } from './reciboPdf'
import { calcularHashPdf } from './reciboHash'
import { etiquetaPeriodo } from './etiquetaPeriodo'

// Datos de cabecera del recibo (empresa + persona) resueltos contra
// Supabase. Extraído de LiquidacionPage.handleEmitirRecibo (Fase 6 Task 7)
// para poder emitir el mismo recibo desde la ficha del legajo sin duplicar
// 75 líneas de fetching.
export async function datosReciboDesdeSupabase({ empresaId, personalId, nombrePersona }) {
  const [{ data: empresaRow }, { data: configRow }, { data: legajoRow }] = await Promise.all([
    // `empresas` es compartida con Presencio: solo tiene nombre y logo_url.
    // El CUIT y el domicilio viven en nom_empresa_config (migración 0021).
    supabase.from('empresas').select('nombre, logo_url').eq('id', empresaId).single(),
    supabase.from('nom_empresa_config').select('cuit, domicilio').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('nom_legajo').select('cuil, categoria_id, fecha_ingreso, banco, antiguedad_reconocida')
      .eq('personal_id', personalId).eq('empresa_id', empresaId).maybeSingle(),
  ])

  let categoriaNombre = '—'
  if (legajoRow?.categoria_id) {
    const { data: cat } = await supabase.from('nom_categorias').select('nombre').eq('id', legajoRow.categoria_id).single()
    categoriaNombre = cat?.nombre || '—'
  }

  return {
    empresa: {
      nombre: empresaRow?.nombre || '—',
      cuit: configRow?.cuit || '—',
      domicilio: configRow?.domicilio || '—',
    },
    persona: {
      nombre: nombrePersona || personalId,
      cuil: legajoRow?.cuil || '—',
      legajo: personalId.slice(0, 8),
      categoria: categoriaNombre,
      fechaIngreso: legajoRow?.fecha_ingreso || '—',
      antiguedadReconocida: legajoRow?.antiguedad_reconocida ?? 0,
      banco: legajoRow?.banco || '—',
    },
  }
}

// `nom_liquidacion_items` no persiste `codigo_recibo` (limitación conocida
// de la Fase 5B Task 9): se usa `concepto_codigo` como columna "Cod".
export function itemsRecibo(filas) {
  return (filas || []).map((i) => ({
    codigo: i.concepto_codigo, nombre: i.concepto_nombre, tipo: i.tipo, monto: Number(i.monto),
    unidadTexto: i.unidad_texto ?? null,
    baseCalculo: i.base_calculo != null ? Number(i.base_calculo) : null,
    grupoRecibo: i.grupo_recibo ?? null,
    detalleRecibo: i.detalle_recibo ?? null,
  }))
}

// Genera el PDF, calcula su hash y lo descarga. Devuelve { ok, hash, doc }
// — asignar el número de recibo (RPC emitir_recibo) queda del lado del
// caller, que es quien tiene el store a mano.
export async function generarYDescargarRecibo({ empresaId, personalId, nombrePersona, periodo, filasItems, numeroRecibo }) {
  const { empresa, persona } = await datosReciboDesdeSupabase({ empresaId, personalId, nombrePersona })
  const desde = periodo?.fecha_desde || periodo?.fechaDesde || ''
  const doc = generarReciboPdf({
    empresa,
    persona,
    periodo: {
      mes: desde ? String(desde).slice(5, 7) : '—',
      anio: desde ? String(desde).slice(0, 4) : '—',
      descripcion: etiquetaPeriodo(periodo),
      fechaPago: periodo?.fecha_pago || '—',
    },
    items: itemsRecibo(filasItems),
    codigoRecibo: numeroRecibo || null,
  })
  const hash = await calcularHashPdf(doc)
  return { doc, hash, nombreArchivo: `recibo-${(nombrePersona || personalId).replace(/[^\w.-]/g, '_')}` }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/utils/__tests__/emitirReciboLegajo.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Rehacer la pestaña Liquidaciones de la ficha**

En `src/pages/FichaLegajoPage.jsx`:

1. Agregar imports:

```jsx
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { generarYDescargarRecibo } from '../utils/emitirReciboLegajo'
```

2. Agregar estado, junto a los demás `useState`:

```jsx
  const [descargandoRecibo, setDescargandoRecibo] = useState(null)
```

3. Agregar el handler, junto a `handleExportar`:

```jsx
  // Descarga el recibo de una liquidación ya calculada. Si la liquidación
  // todavía no tiene numero_recibo, se lo asigna con la RPC emitir_recibo
  // (misma semántica que la pantalla de Liquidación) y se guarda el hash.
  const handleDescargarRecibo = async (l) => {
    setErrorLiquidaciones('')
    setDescargandoRecibo(l.id)
    try {
      const { data: filasItems } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', l.id)
      const { doc, hash, nombreArchivo } = await generarYDescargarRecibo({
        empresaId: empresaActiva?.id,
        personalId,
        nombrePersona: persona.nombre,
        periodo: l.nom_periodos,
        filasItems,
        numeroRecibo: l.numero_recibo,
      })
      const r = await emitirRecibo(l.id, hash)
      if (!r.ok) { setErrorLiquidaciones(r.error); setDescargandoRecibo(null); return }
      doc.save(`${nombreArchivo}-${r.numeroRecibo}.pdf`)
    } catch (e) {
      setErrorLiquidaciones(e instanceof Error ? e.message : String(e))
    }
    setDescargandoRecibo(null)
  }
```

4. Agregar `emitirRecibo` a la desestructuración del store (línea 26):

```jsx
  const { crearPeriodoFinal, emitirRecibo } = useLiquidacionStore()
```

5. Reemplazar el bloque completo `{pestana === 'Liquidaciones' && (...)}` por:

```jsx
      {pestana === 'Liquidaciones' && (
        <div className="card">
          {errorLiquidaciones && <p style={{ color: 'var(--danger)' }}>Error: {errorLiquidaciones}</p>}
          {liquidaciones.length === 0 && !errorLiquidaciones && <p style={{ color: 'var(--text-secondary)' }}>Sin liquidaciones registradas.</p>}
          {liquidaciones.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Período</th><th>Bruto</th><th>Aportes</th><th>Neto</th><th>Estado</th><th>Recibo</th><th></th>
                </tr>
              </thead>
              <tbody>
                {liquidaciones.map((l) => (
                  <tr key={l.id}>
                    <td>{etiquetaPeriodo(l.nom_periodos)}</td>
                    <td>${fmtMonto(l.bruto)}</td>
                    <td>${fmtMonto(l.total_aportes)}</td>
                    <td><strong>${fmtMonto(l.neto)}</strong></td>
                    <td>
                      <span className="badge badge-neutral">{l.estado}</span>
                      {l.anulado && <span className="badge badge-warning" style={{ marginLeft: 4 }}>anulado</span>}
                    </td>
                    <td>{l.numero_recibo ? `#${l.numero_recibo}${l.version > 1 ? ` v${l.version}` : ''}` : '—'}</td>
                    <td>
                      {!l.anulado && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDescargarRecibo(l)}
                          disabled={descargandoRecibo === l.id || !empresaActiva?.id}
                        >
                          {descargandoRecibo === l.id ? 'Generando…' : l.numero_recibo ? 'Descargar recibo' : 'Emitir recibo'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
```

6. Agregar el formateador junto al resto de las constantes del componente (después de `const legajo = ...`):

```jsx
  const fmtMonto = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
```

- [ ] **Step 6: Hacer que la página de Liquidación use el util extraído**

En `src/pages/LiquidacionPage.jsx`, reemplazar el cuerpo de `handleEmitirRecibo` (líneas 93-169) por:

```jsx
  const handleEmitirRecibo = async (l) => {
    setErrorRecibo(''); setEmitiendoRecibo(l.id)
    try {
      const { doc, hash, nombreArchivo } = await generarYDescargarRecibo({
        empresaId,
        personalId: l.personalId,
        nombrePersona: personalPorId.get(l.personalId) || l.personalId,
        periodo: periodoActivo,
        filasItems: itemsPorLiq[l.id] || [],
        numeroRecibo: l.numeroRecibo,
      })
      const r = await emitirRecibo(l.id, hash)
      if (!r.ok) { setErrorRecibo(r.error); setEmitiendoRecibo(null); return }
      doc.save(`${nombreArchivo}-${r.numeroRecibo}.pdf`)
      await cargarLiquidaciones(periodoSeleccionado)
    } catch (e) {
      setErrorRecibo(e instanceof Error ? e.message : String(e))
    }
    setEmitiendoRecibo(null)
  }
```

Y agregar el import:

```jsx
import { generarYDescargarRecibo } from '../utils/emitirReciboLegajo'
```

Los imports de `generarReciboPdf` y `calcularHashPdf` quedan sin uso en esa página: borrarlos.

> **Nota:** el logo en base64 (líneas 111-125 del original) se pierde en esta extracción. Si el recibo debe seguir llevando logo, mover ese bloque `fetch(empresaRow.logo_url) → FileReader` dentro de `datosReciboDesdeSupabase` y devolver `logoBase64` junto a `empresa`/`persona`, pasándolo a `generarReciboPdf`. Verificar primero contra `src/utils/reciboPdf.js` si ese parámetro se está consumiendo — si `generarReciboPdf` no recibe hoy ningún `logo`, no hay nada que preservar.

- [ ] **Step 7: Correr todos los tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Verificar en la app**

1. `npm run dev` → Legajos → Juan Martín García Cano → pestaña "Liquidaciones".
2. La columna Período dice "Junio 2026 · 2da quincena" (no `quincenal 2026-06-15 a 2026-07-01`).
3. Click en "Emitir recibo" → se descarga el PDF y la columna Recibo pasa a mostrar `#N`.

- [ ] **Step 9: Commit**

```bash
git add src/utils/emitirReciboLegajo.js src/utils/__tests__/emitirReciboLegajo.test.js src/pages/FichaLegajoPage.jsx src/pages/LiquidacionPage.jsx
git commit -m "feat(legajo): liquidaciones legibles y emision de recibo desde la ficha"
```

---

### Task 9: Dashboard orientado a tareas pendientes

**Tarjetas pedidas (las 4 seleccionadas por el usuario):**

1. **Aprobaciones pendientes** — flujos de aprobación esperando acción.
2. **Liquidaciones a realizar** — períodos del mes en curso que todavía no se calcularon o no se cerraron, con alerta según el día del mes (umbrales configurables).
3. **Legajos a revisar** — incompletos para liquidar + documentación obligatoria faltante o vencida.
4. **Bajas sin liquidación final** — legajos con `fecha_baja` y sin `liquidacion_final_id`.

Cada tarjeta es clickeable y navega a la pantalla correspondiente.

**Files:**
- Create: `src/utils/alertasDashboard.js`
- Create: `src/utils/__tests__/alertasDashboard.test.js`
- Create: `src/components/config/TabAlertas.jsx`
- Modify: `src/pages/DashboardPage.jsx`
- Modify: `src/pages/ConfiguracionPage.jsx`

**Configuración de alertas:** se reutiliza `nom_parametros` (ya versionado por vigencia, ya con RLS, ya con UI) con dos códigos nuevos: `alerta_liq_dia` (día del mes a partir del cual una liquidación pendiente pasa a "urgente"; default 25) y `alerta_doc_dias` (días de anticipación para documentación por vencer; default 30). **No hace falta migración.**

- [ ] **Step 1: Escribir el test de la lógica pura de alertas**

Crear `src/utils/__tests__/alertasDashboard.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { periodosPendientesDelMes, urgenciaLiquidacion, bajasSinFinal } from '../alertasDashboard'

describe('periodosPendientesDelMes', () => {
  const hoy = '2026-07-28'
  it('cuenta los periodos del mes en curso que no estan cerrados', () => {
    const periodos = [
      { id: 'a', fecha_desde: '2026-07-01', estado: 'abierto', calculo_estado: 'completo' },
      { id: 'b', fecha_desde: '2026-07-16', estado: 'abierto', calculo_estado: null },
      { id: 'c', fecha_desde: '2026-07-01', estado: 'cerrado', calculo_estado: 'completo' },
      { id: 'd', fecha_desde: '2026-06-16', estado: 'abierto', calculo_estado: null },
    ]
    expect(periodosPendientesDelMes(periodos, hoy).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('sin periodos del mes devuelve vacio', () => {
    expect(periodosPendientesDelMes([{ fecha_desde: '2026-05-01', estado: 'abierto' }], hoy)).toEqual([])
  })
})

describe('urgenciaLiquidacion', () => {
  it('es urgente pasado el dia umbral con pendientes', () => {
    expect(urgenciaLiquidacion(2, '2026-07-28', 25)).toBe('urgente')
  })
  it('es normal antes del dia umbral', () => {
    expect(urgenciaLiquidacion(2, '2026-07-10', 25)).toBe('normal')
  })
  it('sin pendientes esta al dia sin importar la fecha', () => {
    expect(urgenciaLiquidacion(0, '2026-07-28', 25)).toBe('ok')
  })
})

describe('bajasSinFinal', () => {
  it('cuenta legajos con fecha de baja y sin liquidacion final', () => {
    const legajos = [
      { personal_id: 'p1', fecha_baja: '2026-06-30', liquidacion_final_id: null },
      { personal_id: 'p2', fecha_baja: '2026-05-31', liquidacion_final_id: 'liq-1' },
      { personal_id: 'p3', fecha_baja: null, liquidacion_final_id: null },
    ]
    expect(bajasSinFinal(legajos).map((l) => l.personal_id)).toEqual(['p1'])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/utils/__tests__/alertasDashboard.test.js`
Expected: FAIL — "Failed to resolve import '../alertasDashboard'".

- [ ] **Step 3: Implementar la lógica pura**

Crear `src/utils/alertasDashboard.js`:

```js
// Lógica pura de las alertas del Dashboard — sin red, sin React, testeable
// sola. El Dashboard sólo hace las consultas y renderiza (Fase 6 Task 9).

export const DEFAULTS_ALERTAS = {
  // Día del mes a partir del cual una liquidación pendiente pasa a
  // "urgente" en el Dashboard. Configurable en Configuración → Alertas
  // con el código de parámetro `alerta_liq_dia`.
  alertaLiqDia: 25,
  // Días de anticipación con que se marca un documento como "por vencer".
  alertaDocDias: 30,
}

// Períodos del mes calendario en curso que todavía no están cerrados —
// es decir, trabajo de liquidación que queda por hacer.
export function periodosPendientesDelMes(periodos, hoy = new Date().toISOString().slice(0, 10)) {
  const mesActual = String(hoy).slice(0, 7)
  return (periodos || []).filter(
    (p) => String(p.fecha_desde).slice(0, 7) === mesActual && p.estado !== 'cerrado'
  )
}

// 'ok' sin pendientes · 'urgente' pasado el día umbral · 'normal' antes.
export function urgenciaLiquidacion(cantidadPendientes, hoy = new Date().toISOString().slice(0, 10), diaUmbral = DEFAULTS_ALERTAS.alertaLiqDia) {
  if (cantidadPendientes === 0) return 'ok'
  const dia = Number(String(hoy).slice(8, 10))
  return dia >= diaUmbral ? 'urgente' : 'normal'
}

// Personas dadas de baja a las que todavía no se les generó la
// liquidación final (nom_legajo.liquidacion_final_id, Fase 5E Task 33).
export function bajasSinFinal(legajos) {
  return (legajos || []).filter((l) => l.fecha_baja && !l.liquidacion_final_id)
}

// Lee un parámetro de alerta de la lista de nom_parametros, con default.
export function valorAlerta(parametros, codigo, porDefecto) {
  const fila = (parametros || []).find((p) => p.codigo === codigo)
  const valor = Number(fila?.valor)
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/utils/__tests__/alertasDashboard.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Reescribir el Dashboard**

Reemplazar el contenido completo de `src/pages/DashboardPage.jsx` por:

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Users, AlertTriangle, CheckSquare, Calculator, UserMinus } from 'lucide-react'
import { legajoIncompleto } from '../utils/legajoCompletitud'
import { periodosPendientesDelMes, urgenciaLiquidacion, bajasSinFinal, valorAlerta, DEFAULTS_ALERTAS } from '../utils/alertasDashboard'
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { useAuthStore } from '../store/authStore'

// Dashboard orientado a tareas pendientes (Fase 6 Task 9): qué hay que
// hacer hoy, no cuánta gente hay. Cada tarjeta navega a la pantalla donde
// se resuelve ese pendiente. Los umbrales de alerta se configuran en
// Configuración → Alertas (nom_parametros: alerta_liq_dia, alerta_doc_dias).
export default function DashboardPage() {
  const navigate = useNavigate()
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un Superadmin tiene bypass de RLS (0008_superadmin_bypass.sql) y vería
  // personal/legajos de TODAS las empresas mezclados si no filtramos acá.
  const empresaActiva = empresa || empresaVista
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [datos, setDatos] = useState({
    totalActivo: 0, incompletos: 0, docsPendientes: 0,
    aprobaciones: 0, periodosPendientes: [], bajas: 0, urgencia: 'ok',
  })

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      setError('')
      if (!empresaActiva?.id) { setCargando(false); return }
      const empresaId = empresaActiva.id
      const hoy = new Date().toISOString().slice(0, 10)

      const [
        { data: personal, error: errPersonal },
        { data: legajos, error: errLegajos },
        { data: periodos },
        { data: aprobaciones },
        { data: parametros },
        { data: requeridos },
        { data: documentos },
      ] = await Promise.all([
        supabase.from('nom_v_personal').select('id, estado').eq('estado', 'activo').eq('empresa_id', empresaId),
        supabase.from('nom_legajo').select('personal_id, cuil, cbu, convenio_id, categoria_id, fuera_convenio, sueldo_convenido, fecha_baja, liquidacion_final_id').eq('empresa_id', empresaId),
        supabase.from('nom_periodos').select('*').eq('empresa_id', empresaId).order('fecha_desde', { ascending: false }).limit(24),
        supabase.from('nom_flujo_instancias').select('id, estado').eq('empresa_id', empresaId).eq('estado', 'pendiente'),
        supabase.from('nom_parametros').select('codigo, valor').eq('empresa_id', empresaId),
        supabase.from('nom_documentos_requeridos').select('id, obligatorio').eq('empresa_id', empresaId),
        supabase.from('nom_documentos_legajo').select('personal_id, requerido_id, fecha_vencimiento').eq('empresa_id', empresaId),
      ])
      if (cancelado) return
      if (errPersonal || errLegajos) {
        setError((errPersonal || errLegajos).message)
        setCargando(false)
        return
      }

      const legajoPorPersonal = new Map((legajos || []).map((l) => [l.personal_id, {
        cuil: l.cuil, cbu: l.cbu, convenioId: l.convenio_id, categoriaId: l.categoria_id,
        fueraConvenio: l.fuera_convenio, sueldoConvenido: l.sueldo_convenido,
      }]))
      const incompletos = (personal || []).filter((p) => legajoIncompleto(legajoPorPersonal.get(p.id))).length

      const diasAviso = valorAlerta(parametros, 'alerta_doc_dias', DEFAULTS_ALERTAS.alertaDocDias)
      const diaUmbral = valorAlerta(parametros, 'alerta_liq_dia', DEFAULTS_ALERTAS.alertaLiqDia)

      const obligatorios = (requeridos || []).filter((r) => r.obligatorio).map((r) => r.id)
      const limiteAviso = new Date(Date.now() + diasAviso * 86400000).toISOString().slice(0, 10)
      const docsPorPersona = new Map()
      for (const d of documentos || []) {
        if (!docsPorPersona.has(d.personal_id)) docsPorPersona.set(d.personal_id, [])
        docsPorPersona.get(d.personal_id).push(d)
      }
      // Una persona cuenta como "documentación pendiente" si le falta algún
      // obligatorio o si tiene alguno vencido / por vencer dentro del aviso.
      const docsPendientes = (personal || []).filter((p) => {
        const suyos = docsPorPersona.get(p.id) || []
        const cargados = new Set(suyos.map((d) => d.requerido_id).filter(Boolean))
        const falta = obligatorios.some((id) => !cargados.has(id))
        const porVencer = suyos.some((d) => d.fecha_vencimiento && d.fecha_vencimiento <= limiteAviso)
        return falta || porVencer
      }).length

      const pendientes = periodosPendientesDelMes(periodos, hoy)

      setDatos({
        totalActivo: (personal || []).length,
        incompletos,
        docsPendientes,
        aprobaciones: (aprobaciones || []).length,
        periodosPendientes: pendientes,
        bajas: bajasSinFinal(legajos).length,
        urgencia: urgenciaLiquidacion(pendientes.length, hoy, diaUmbral),
      })
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [empresaActiva?.id])

  const val = (n) => (cargando ? '—' : n)
  const colorUrgencia = datos.urgencia === 'urgente' ? 'var(--danger)' : datos.urgencia === 'normal' ? 'var(--warning)' : 'var(--brand-secondary)'

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Qué hay pendiente hoy</p>
      </div>

      {!empresaActiva && <div className="card">Elegí una empresa en Superadmin → "Entrar" para ver sus pendientes.</div>}

      {error && (
        <div className="card" style={{ borderColor: 'rgba(218,54,51,0.4)', color: 'var(--danger)', marginBottom: '1rem' }}>
          Error al cargar datos: {error}
        </div>
      )}

      {empresaActiva && !error && (
        <>
          <div className="stats-grid">
            <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/aprobaciones')}>
              <CheckSquare size={18} color="var(--brand-secondary)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.aprobaciones)}</div>
              <div className="stat-label">Aprobaciones pendientes</div>
            </div>

            <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/liquidacion')}>
              <Calculator size={18} color={colorUrgencia} style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.periodosPendientes.length)}</div>
              <div className="stat-label">
                Liquidaciones a realizar
                {datos.urgencia === 'urgente' && <span className="badge badge-danger" style={{ marginLeft: 6 }}>urgente</span>}
              </div>
            </div>

            <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/legajos')}>
              <AlertTriangle size={18} color="var(--warning)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.incompletos + datos.docsPendientes)}</div>
              <div className="stat-label">
                Legajos a revisar
                {!cargando && <span style={{ display: 'block', opacity: 0.7, fontSize: '0.75rem' }}>
                  {datos.incompletos} incompletos · {datos.docsPendientes} con documentación pendiente
                </span>}
              </div>
            </div>

            <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/legajos')}>
              <UserMinus size={18} color="var(--warning)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.bajas)}</div>
              <div className="stat-label">Bajas sin liquidación final</div>
            </div>

            <div className="stat-card">
              <Users size={18} color="var(--brand-secondary)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.totalActivo)}</div>
              <div className="stat-label">Personal activo</div>
            </div>
          </div>

          {!cargando && datos.periodosPendientes.length > 0 && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>Períodos abiertos este mes</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {datos.periodosPendientes.map((p) => (
                  <button key={p.id} className="btn btn-ghost btn-sm" onClick={() => navigate('/liquidacion')}>
                    {etiquetaPeriodo(p)}
                    <span className="badge badge-neutral" style={{ marginLeft: 6 }}>
                      {p.calculo_estado === 'completo' ? 'calculado' : 'sin calcular'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Verificar los nombres reales de las tablas de aprobación**

El Dashboard consulta `nom_flujo_instancias`. Confirmar el nombre y la columna de estado:

Run: `grep -n "from('nom_flujo" src/store/aprobacionesStore.js src/store/flujosStore.js`

Ajustar el `.from(...)` / `.eq('estado', ...)` del Dashboard a lo que devuelva ese grep. Si la tabla se llama distinto, usar el nombre real; si el estado pendiente se llama distinto (`en_curso`, `pendiente_aprobacion`), usar ése.

- [ ] **Step 7: Crear la pestaña de Configuración → Alertas**

Crear `src/components/config/TabAlertas.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useParametrosStore } from '../../store/parametrosStore'
import { valorAlerta, DEFAULTS_ALERTAS } from '../../utils/alertasDashboard'

const ALERTAS = [
  {
    codigo: 'alerta_liq_dia',
    label: 'Día del mes a partir del cual una liquidación pendiente es urgente',
    porDefecto: DEFAULTS_ALERTAS.alertaLiqDia,
    ayuda: 'El Dashboard marca en rojo "Liquidaciones a realizar" desde este día.',
  },
  {
    codigo: 'alerta_doc_dias',
    label: 'Días de anticipación para avisar documentación por vencer',
    porDefecto: DEFAULTS_ALERTAS.alertaDocDias,
    ayuda: 'Se usa en el semáforo de la ficha del legajo y en el conteo del Dashboard.',
  },
]

// Umbrales de las alertas del Dashboard. Se guardan en nom_parametros —
// la misma tabla versionada por vigencia que usa tope_sipa — así que no
// hace falta esquema nuevo (Fase 6 Task 9).
export default function TabAlertas({ empresaId }) {
  const { parametros, cargarParametros, guardarParametro } = useParametrosStore()
  const [valores, setValores] = useState({})
  const [guardando, setGuardando] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { if (empresaId) cargarParametros(empresaId) }, [empresaId])

  useEffect(() => {
    setValores(Object.fromEntries(
      ALERTAS.map((a) => [a.codigo, String(valorAlerta(parametros, a.codigo, a.porDefecto))])
    ))
  }, [parametros])

  const guardar = async (alerta) => {
    setError('')
    const valor = Number(valores[alerta.codigo])
    if (!Number.isFinite(valor) || valor <= 0) { setError('El valor tiene que ser un número mayor a cero.'); return }
    setGuardando(alerta.codigo)
    const r = await guardarParametro({
      codigo: alerta.codigo, valor,
      vigenciaDesde: new Date().toISOString().slice(0, 10), vigenciaHasta: null,
    }, empresaId)
    setGuardando(null)
    if (!r.ok) setError(r.error)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Umbrales de las alertas del Dashboard. Se guardan como parámetros versionados: cada cambio agrega una vigencia nueva, no pisa la anterior.
      </p>
      {ALERTAS.map((a) => (
        <div key={a.codigo} style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 520 }}>
          <label htmlFor={`alerta-${a.codigo}`} style={{ fontSize: '0.85rem' }}>{a.label}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id={`alerta-${a.codigo}`}
              className="input"
              type="number"
              min="1"
              style={{ width: 120 }}
              value={valores[a.codigo] ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, [a.codigo]: e.target.value }))}
            />
            <button className="btn btn-primary btn-sm" onClick={() => guardar(a)} disabled={guardando === a.codigo}>
              {guardando === a.codigo ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{a.ayuda}</span>
        </div>
      ))}
      {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}
    </div>
  )
}
```

- [ ] **Step 8: Registrar la pestaña Alertas en Configuración**

En `src/pages/ConfiguracionPage.jsx` (la Task 6 ya agregó `'Alertas'` a `PESTANAS`):

1. Import:

```jsx
import TabAlertas from '../components/config/TabAlertas'
```

2. Render:

```jsx
          {pestana === 'Alertas' && <TabAlertas empresaId={empresaActiva.id} />}
```

- [ ] **Step 9: Verificar las rutas de navegación**

Run: `grep -n "path=" src/App.jsx`

Confirmar que las rutas usadas en los `navigate(...)` del Dashboard (`/aprobaciones`, `/liquidacion`, `/legajos`) coinciden exactamente con las declaradas. Ajustar los `navigate` si difieren.

- [ ] **Step 10: Correr todos los tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 11: Verificar en la app**

1. `npm run dev` → Dashboard.
2. Las 5 tarjetas cargan sin error. "Liquidaciones a realizar" muestra los períodos abiertos de julio 2026 con su etiqueta legible.
3. Configuración → Alertas → cambiar `alerta_liq_dia` a 1 → volver al Dashboard → la tarjeta de liquidaciones aparece con badge "urgente".
4. Click en cada tarjeta → navega a la pantalla correcta.

- [ ] **Step 12: Commit**

```bash
git add src/utils/alertasDashboard.js src/utils/__tests__/alertasDashboard.test.js src/components/config/TabAlertas.jsx src/pages/DashboardPage.jsx src/pages/ConfiguracionPage.jsx
git commit -m "feat(dashboard): tarjetas de pendientes con umbrales de alerta configurables"
```

---

### Task 10: Verificación final

**Files:** ninguno nuevo — sólo verificación.

- [ ] **Step 1: Correr la suite completa**

Run: `npx vitest run`
Expected: 0 failures. Anotar el total de tests antes/después.

- [ ] **Step 2: Correr el lint**

Run: `npm run lint`
Expected: 0 errores. Los warnings de `react-hooks/exhaustive-deps` preexistentes son aceptables; los **nuevos** hay que revisarlos uno por uno.

- [ ] **Step 3: Build de producción**

Run: `npm run build`
Expected: "built in Xs" sin errores.

- [ ] **Step 4: Verificar el motor de liquidación**

Run: `npx vitest run --config packages/motor/vitest.config.ts`
Expected: los golden tests de `packages/motor/golden/` siguen en verde — ninguna task de este plan tocó el motor puro, así que cualquier fallo acá es una regresión inesperada.

- [ ] **Step 5: Verificación manual del arreglo de performance (la revisión #1)**

1. `npm run dev` → Liquidación → período de junio → DevTools → Network → filtrar `liquidar-periodo`.
2. Click en "Calcular" y cronometrar.
3. Expected: **1 invocación**, resultado en pocos segundos. Antes del plan: 20 invocaciones.

- [ ] **Step 6: Repasar las 9 revisiones pedidas contra la app**

| # | Revisión | Dónde verificar |
|---|---|---|
| 1 | Liquidación lenta | Liquidación → Calcular → 1 sola invocación |
| 2 | Categoría con hash | Legajos → una persona → Datos → "Categoría: Ayudante" |
| 3 | Sueldo individual fuera de convenio | Datos → tildar "Fuera de convenio" → cargar sueldo → guardar → se ve en solo lectura |
| 4 | Editar familiares | Familiares → Editar → Guardar cambios |
| 5 | Cargar documentación + config | Configuración → Documentación; Legajo → Documentación → Cargar |
| 6 | Editar sanciones | Sanciones → Editar → Guardar cambios |
| 7 | Liquidaciones y recibos en el legajo | Legajo → Liquidaciones → Emitir recibo |
| 8 | Etiquetas de período | Selector y encabezados: "Junio 2026 · 1ra quincena" |
| 9 | Dashboard por tareas | Dashboard → 5 tarjetas clickeables |

- [ ] **Step 7: Actualizar el handoff**

Crear `docs/2026-07-28-handoff-fase6.md` con: qué migraciones hay que aplicar (`0031`, `0032`, `0033`), qué quedó pendiente (visibilidad bidireccional de documentos con Presencio; fórmulas de horas extra y presentismo para UOCRA, que venían de la sesión anterior) y el resultado de la verificación de performance.

- [ ] **Step 8: Commit final**

```bash
git add docs/2026-07-28-handoff-fase6.md
git commit -m "docs: handoff de la fase 6"
```

---

## Pendientes explícitos (fuera del alcance de este plan)

1. **Documentos bidireccionales con Presencio** — que lo cargado en Recursio se vea dentro de Presencio requiere tocar la otra app. Decisión postergada por el usuario ("revisémoslo después").
2. **Migración `0031_seed_conceptos_base.sql`** — escrita en la sesión anterior, **todavía sin aplicar**. Sin ella la liquidación sigue dando $0 (no existe el concepto `basico`). Aplicarla antes de verificar cualquier monto.
3. **`tope_sipa` sin cargar** en Configuración → Parámetros: los aportes con tope se calculan sobre el bruto completo.
4. **Fórmulas de horas extra y presentismo para UOCRA** — las columnas HE 50 % / HE 100 % se calculan pero no se pagan, porque ningún concepto las consume.
