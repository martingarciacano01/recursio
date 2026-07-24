# Fase 5D — Legajo completo (bite-sized) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filtros en el listado de legajos, ficha por pestañas, CRUD real de familiares y sanciones (hoy solo se listan, no se pueden cargar desde la UI), ausencias separadas por justificadas/injustificadas, y alta/baja de legajo.

**Architecture:** Se extiende lo existente, no se reescribe: `src/store/legajoStore.js` ya tiene `cargarFamiliares`/`cargarSanciones` (solo lectura) — se agregan `guardarFamiliar`/`eliminarFamiliar`/`guardarSancion`/`eliminarSancion` siguiendo el mismo patrón de `guardarLegajo` (upsert con `.select().single()`). `legajoToDB`/`legajoFromDB` se extienden para mapear los campos de la migración 0018 (`fecha_baja`, `motivo_baja`, `localidad`, `provincia`, `codigo_postal`) que hoy existen en la tabla pero el store ignora. `src/pages/FichaLegajoPage.jsx` (hoy `SeccionColapsable` apiladas verticalmente) se reorganiza en pestañas — mismo patrón de `PESTANAS`/render condicional que `ConfiguracionPage.jsx` — reusando el contenido que ya funciona, sin inventar UI nueva donde no hace falta.

**Tech Stack:** React 19, Vite, Zustand, Supabase, Vitest.

**Decisión de alcance (Task 17 del plan maestro, "Documentación configurable por cliente" — DEFERIDA):** requiere CRUD de `tipos_documento` (tabla de Presencio, solo autorizado a tocar vía el `ALTER` puntual ya hecho en `0006_tipos_documento_ambito.sql`) más un bucket de upload nuevo — es un trabajo más grande y separado, que además pisa una tabla ajena a Nómina. Esta sub-fase deja `DocumentosLegajo.jsx` tal como está (solo lectura de `documentos_personal`, ya funcional) y no construye el checklist configurable — se anota como pendiente explícito para una vuelta futura, no se improvisa a mitad de esta fase.

---

## Task 44: Filtros en `LegajosPage.jsx`

**Files:**
- Create: `src/utils/filtrarLegajos.js`
- Create: `src/utils/__tests__/filtrarLegajos.test.js`
- Modify: `src/pages/LegajosPage.jsx`

- [ ] **Step 1: Test que falla**

```js
// src/utils/__tests__/filtrarLegajos.test.js
import { describe, it, expect } from 'vitest'
import { filtrarLegajos } from '../filtrarLegajos'

const FILAS = [
  { id: '1', nombre: 'Juan Pérez', dni: '30111222', estado: 'activo' },
  { id: '2', nombre: 'María López', dni: '28999888', estado: 'activo' },
  { id: '3', nombre: 'Carlos Ruiz', dni: '35-444-555', estado: 'inactivo' },
]

describe('filtrarLegajos', () => {
  it('sin busqueda ni filtro de estado devuelve todo', () => {
    expect(filtrarLegajos(FILAS, '', 'todos')).toHaveLength(3)
  })
  it('busca por nombre parcial, sin importar mayusculas', () => {
    expect(filtrarLegajos(FILAS, 'lópez', 'todos').map((f) => f.id)).toEqual(['2'])
  })
  it('busca por documento ignorando guiones', () => {
    expect(filtrarLegajos(FILAS, '35444555', 'todos').map((f) => f.id)).toEqual(['3'])
  })
  it('filtra por estado activo', () => {
    expect(filtrarLegajos(FILAS, '', 'activo').map((f) => f.id).sort()).toEqual(['1', '2'])
  })
  it('combina busqueda y estado', () => {
    expect(filtrarLegajos(FILAS, 'ruiz', 'inactivo').map((f) => f.id)).toEqual(['3'])
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/utils/__tests__/filtrarLegajos.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima**

```js
// src/utils/filtrarLegajos.js
// Filtro puro client-side (Task 13, Fase 5D). Documento: matcheo parcial
// ignorando guiones y espacios (el DNI/CUIL puede venir formateado o no).
const limpiarDoc = (s) => String(s || '').replace(/[-\s]/g, '')

export function filtrarLegajos(filas, busqueda, estado) {
  const q = busqueda.trim().toLowerCase()
  const qDoc = limpiarDoc(busqueda)
  return filas.filter((f) => {
    const pasaEstado = estado === 'todos' || f.estado === estado
    if (!pasaEstado) return false
    if (!q) return true
    const nombreMatch = (f.nombre || '').toLowerCase().includes(q)
    const dniMatch = qDoc.length > 0 && limpiarDoc(f.dni).includes(qDoc)
    return nombreMatch || dniMatch
  })
}
```

- [ ] **Step 4:** Run → PASS (5 tests). Commit: `git add src/utils/filtrarLegajos.js src/utils/__tests__/filtrarLegajos.test.js && git commit -m "feat(legajos): helper puro de filtrado por nombre/documento/estado"`

- [ ] **Step 5: Aplicar en `LegajosPage.jsx`.** Leer el archivo completo (79 líneas + los cambios de paginación de la Fase 5I ya aplicados) antes de editar. Cambios:
  - Agregar estado `const [busqueda, setBusqueda] = useState('')` y `const [filtroEstado, setFiltroEstado] = useState('todos')`.
  - La query a `nom_v_personal` HOY filtra fijo `.eq('estado', 'activo')` — cambiar a NO filtrar por estado en la query (traer todos) y dejar que `filtrarLegajos` lo haga client-side, para que el select "Todos/Activo/Inactivo" tenga sentido. **Importante:** esto interactúa con la paginación de la Fase 5I (`usePaginado`) — el `count`/`range` deben seguir aplicándose sobre la query sin filtro de estado (paginación server-side sobre el total real, filtro de estado sigue siendo client-side sobre lo ya cargado, documentar esto con un comentario).
  - Renderizar `filtrarLegajos(filas, busqueda, filtroEstado)` en vez de `filas` directamente en el `.map()` de la tabla.
  - UI: input de búsqueda (`placeholder="Buscar por nombre o DNI…"`) + `<select>` con opciones Activo/Inactivo/Todos, arriba de la tabla.

- [ ] **Step 6:** `npx vitest run` completo → PASS, sin regresiones. Commit: `git add src/pages/LegajosPage.jsx && git commit -m "feat(legajos): filtros de busqueda y estado en LegajosPage"`

## Task 45: Rediseño de `FichaLegajoPage.jsx` con pestañas

**Contexto:** hoy la página apila 5 `SeccionColapsable` verticalmente (Datos y estado, Documentación, Familiares, Sanciones, Ausencias — ya transcripta completa arriba, 126 líneas). Esta tarea SOLO reorganiza en pestañas (mismo patrón `PESTANAS`/render condicional que `ConfiguracionPage.jsx`) — el contenido de cada sección no cambia en esta tarea (Familiares/Sanciones/Ausencias ganan su UI real en las Tasks 46-48).

**Files:**
- Modify: `src/pages/FichaLegajoPage.jsx`

- [ ] **Step 1:** Leer `src/pages/ConfiguracionPage.jsx` completo para copiar el patrón exacto de pestañas (array `PESTANAS`, estado `pestana`, botones, render condicional).

- [ ] **Step 2:** Reestructurar `FichaLegajoPage.jsx`: mantener el header (nombre, DNI, semáforo, botón exportar) y los banners de error tal cual están. Reemplazar las 5 `SeccionColapsable` por pestañas `['Datos', 'Familiares', 'Documentación', 'Sanciones', 'Ausencias', 'Liquidaciones']` — el contenido de "Datos", "Documentación" y el nuevo tab "Liquidaciones" mantienen exactamente lo que ya hay (`EditorDatosLegajo`, `DocumentosLegajo`); "Liquidaciones" es NUEVO en esta tarea: una tabla simple con las liquidaciones históricas de esa persona (`supabase.from('nom_liquidaciones').select('*, nom_periodos(tipo, fecha_desde, fecha_hasta)').eq('personal_id', personalId).order('created_at', { ascending: false })`, columnas Período/Bruto/Neto/Estado — solo lectura, sin acciones).
  - "Familiares"/"Sanciones"/"Ausencias" quedan con el MISMO contenido inline que ya tienen (se reemplaza su UI real en las próximas 3 tareas — no dejar la pestaña vacía en este paso intermedio).

- [ ] **Step 3:** Test de componente: si `src/pages/__tests__/FichaLegajoPage.test.jsx` no existe (`find src/pages -iname "*FichaLegajo*test*"`), crear uno mínimo que mockee `legajoStore`/`authStore`/`supabase` (seguir el patrón de mocks ya usado en `src/pages/__tests__/UsuariosPage.test.jsx`) y verifique: (a) se ven los botones de las 6 pestañas, (b) clickear "Liquidaciones" muestra el contenido de esa pestaña y oculta "Datos".

- [ ] **Step 4:** `npx vitest run` completo → PASS, sin regresiones. Commit: `git add src/pages/FichaLegajoPage.jsx src/pages/__tests__/FichaLegajoPage.test.jsx && git commit -m "feat(legajo): ficha reorganizada en pestanas, agrega historial de liquidaciones"`

## Task 46: CRUD de Familiares

**Files:**
- Modify: `src/store/legajoStore.js` (agregar `guardarFamiliar`, `eliminarFamiliar`)
- Modify: `src/store/__tests__/legajoStore.test.js`
- Create: `src/components/legajo/TabFamiliares.jsx`
- Modify: `src/pages/FichaLegajoPage.jsx` (usar el componente nuevo en la pestaña "Familiares")

- [ ] **Step 1:** Leer `src/store/__tests__/legajoStore.test.js` completo para matchear el patrón de mock de `supabase` ya usado ahí (mismo criterio que en tareas anteriores: adaptarse al mock real del archivo, no inventar uno nuevo).

- [ ] **Step 2: Test que falla** (adaptar el mock exacto al patrón real del archivo):

```js
// agregar a src/store/__tests__/legajoStore.test.js
it('guardarFamiliar inserta un familiar nuevo (sin id)', async () => {
  const r = await useLegajoStore.getState().guardarFamiliar(
    { vinculo: 'hijo', nombre: 'Tomás Pérez', fechaNacimiento: '2015-03-10' },
    'personal-1', 'empresa-1'
  )
  expect(r.ok).toBe(true)
})

it('eliminarFamiliar borra por id y lo saca del estado', async () => {
  useLegajoStore.setState({ familiares: [{ id: 'f1', nombre: 'X' }] })
  const r = await useLegajoStore.getState().eliminarFamiliar('f1')
  expect(r.ok).toBe(true)
  expect(useLegajoStore.getState().familiares).toEqual([])
})
```

- [ ] **Step 3:** Run → FAIL (funciones no existen).

- [ ] **Step 4: Implementación en `legajoStore.js`** (mismo patrón que `guardarLegajo`):

```js
export const familiarToDB = (f, personalId, empresaId) => ({
  empresa_id: empresaId, personal_id: personalId,
  vinculo: f.vinculo, nombre: f.nombre,
  ...(f.cuil !== undefined && { cuil: f.cuil }),
  ...(f.fechaNacimiento !== undefined && { fecha_nacimiento: f.fechaNacimiento || null }),
})
```

```js
  guardarFamiliar: async (familiar, personalId, empresaId) => {
    set({ error: null })
    try {
      const row = familiarToDB(familiar, personalId, empresaId)
      const query = familiar.id
        ? supabase.from('nom_familiares').update(row).eq('id', familiar.id).select().single()
        : supabase.from('nom_familiares').insert(row).select().single()
      const { data, error } = await query
      if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
      const nuevo = familiarFromDB(data)
      set((s) => ({ familiares: familiar.id ? s.familiares.map((f) => (f.id === nuevo.id ? nuevo : f)) : [...s.familiares, nuevo] }))
      return { ok: true, familiar: nuevo }
    } catch (e) {
      set({ error: e.message })
      return { ok: false, error: e.message }
    }
  },

  eliminarFamiliar: async (id) => {
    set({ error: null })
    const { error } = await supabase.from('nom_familiares').delete().eq('id', id)
    if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
    set((s) => ({ familiares: s.familiares.filter((f) => f.id !== id) }))
    return { ok: true }
  },
```

  (agregar `familiarToDB` cerca de `familiarFromDB` ya existente, y las dos funciones nuevas dentro del `create((set, get) => ({...}))`, junto a `cargarFamiliares`).

- [ ] **Step 5:** Run → PASS. `npx vitest run` completo → PASS.

- [ ] **Step 6: `TabFamiliares.jsx`** — lista de familiares (nombre, vínculo, edad calculada desde `fechaNacimiento` si existe, DNI/CUIL) con botón "Eliminar" por fila, y un formulario de alta (select Vínculo: `conyuge|conviviente|hijo|otro`, input Nombre, input CUIL opcional, input Fecha de nacimiento) con botón "Agregar". Sin test de componente propio (mismo criterio de consistencia que `TabEmpresa.jsx` en la Fase 5C — verificar si hay un patrón de test para componentes de listado simples antes de decidir, ej. `DocumentosLegajo.jsx` ¿tiene test?).

- [ ] **Step 7:** Enganchar `<TabFamiliares personalId={personalId} empresaId={empresaActiva?.id} />` en la pestaña "Familiares" de `FichaLegajoPage.jsx`, reemplazando el listado inline de párrafos.

- [ ] **Step 8:** `npx vitest run` completo → PASS, sin regresiones. Commit: `git add src/store/legajoStore.js src/store/__tests__/legajoStore.test.js src/components/legajo/TabFamiliares.jsx src/pages/FichaLegajoPage.jsx && git commit -m "feat(legajo): CRUD de familiares (alta, baja) en la ficha"`

## Task 47: CRUD de Sanciones (con contador visible)

**Files:**
- Modify: `src/store/legajoStore.js` (agregar `guardarSancion`, `eliminarSancion`)
- Modify: `src/store/__tests__/legajoStore.test.js`
- Create: `src/components/legajo/TabSanciones.jsx`
- Modify: `src/pages/FichaLegajoPage.jsx`

- [ ] **Step 1: Test que falla** (mismo patrón que Task 46, adaptado):

```js
// agregar a src/store/__tests__/legajoStore.test.js
it('guardarSancion inserta una sancion nueva', async () => {
  const r = await useLegajoStore.getState().guardarSancion(
    { tipo: 'apercibimiento', motivo: 'Llegada tarde reiterada', fecha: '2026-07-01' },
    'personal-1', 'empresa-1'
  )
  expect(r.ok).toBe(true)
})

it('eliminarSancion borra por id', async () => {
  useLegajoStore.setState({ sanciones: [{ id: 's1', motivo: 'X' }] })
  const r = await useLegajoStore.getState().eliminarSancion('s1')
  expect(r.ok).toBe(true)
  expect(useLegajoStore.getState().sanciones).toEqual([])
})
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implementación** (mismo patrón exacto que familiares, adaptado a `nom_sanciones_personal` y sus campos `tipo`/`motivo`/`fecha`/`dias_suspension`/`doc_path`; ordenar el estado descendente por fecha al insertar, ya que `cargarSanciones` ya trae ordenado por fecha desc — al agregar uno nuevo, re-ordenar el array en el `set` en vez de solo appendear):

```js
export const sancionToDB = (s, personalId, empresaId) => ({
  empresa_id: empresaId, personal_id: personalId,
  tipo: s.tipo, motivo: s.motivo, fecha: s.fecha,
  ...(s.diasSuspension !== undefined && { dias_suspension: s.diasSuspension ? Number(s.diasSuspension) : null }),
})
```

```js
  guardarSancion: async (sancion, personalId, empresaId) => {
    set({ error: null })
    try {
      const row = sancionToDB(sancion, personalId, empresaId)
      const query = sancion.id
        ? supabase.from('nom_sanciones_personal').update(row).eq('id', sancion.id).select().single()
        : supabase.from('nom_sanciones_personal').insert(row).select().single()
      const { data, error } = await query
      if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
      const nueva = sancionFromDB(data)
      set((s) => {
        const resto = s.sanciones.filter((x) => x.id !== nueva.id)
        return { sanciones: [...resto, nueva].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)) }
      })
      return { ok: true, sancion: nueva }
    } catch (e) {
      set({ error: e.message })
      return { ok: false, error: e.message }
    }
  },

  eliminarSancion: async (id) => {
    set({ error: null })
    const { error } = await supabase.from('nom_sanciones_personal').delete().eq('id', id)
    if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
    set((s) => ({ sanciones: s.sanciones.filter((x) => x.id !== id) }))
    return { ok: true }
  },
```

- [ ] **Step 4:** Run → PASS. `npx vitest run` completo → PASS.

- [ ] **Step 5: `TabSanciones.jsx`** — título con contador (`Sanciones (${sanciones.length})`), lista ordenada desc. por fecha (Fecha, Tipo, Descripción/motivo, días de suspensión si aplica) con "Eliminar" por fila, formulario de alta (select Tipo: `apercibimiento|suspension|llamado_atencion|otra`, input Fecha, textarea Motivo/descripción, input Días de suspensión — solo visible/habilitado si Tipo es `suspension`).

- [ ] **Step 6:** Enganchar en la pestaña "Sanciones" de `FichaLegajoPage.jsx`, y actualizar el LABEL de la pestaña para mostrar el contador (`Sanciones (${sanciones.length})`) igual que pide el plan maestro — la pestaña en sí, no solo el título interno del tab.

- [ ] **Step 7:** `npx vitest run` completo → PASS, sin regresiones. Commit: `git add src/store/legajoStore.js src/store/__tests__/legajoStore.test.js src/components/legajo/TabSanciones.jsx src/pages/FichaLegajoPage.jsx && git commit -m "feat(legajo): CRUD de sanciones con contador visible en la pestana"`

## Task 48: Ausencias — justificadas/injustificadas con totales del año

**Files:**
- Create: `src/utils/agruparAusencias.js`
- Create: `src/utils/__tests__/agruparAusencias.test.js`
- Create: `src/components/legajo/TabAusencias.jsx`
- Modify: `src/pages/FichaLegajoPage.jsx`

**Contexto:** `nom_v_ausencias` (vista, solo lectura) expone `id, empresa_id, personal_id, obra_id, tipo, fecha_desde, fecha_hasta, certificado, doc_url, estado`. NO expone si es "justificada" o no directamente — el criterio (confirmado por el patrón ya usado en `liquidar-periodo/index.ts`, que solo cuenta como justificada una ausencia con `estado === 'aprobada'`) es: `estado === 'aprobada'` → justificada; cualquier otro estado (`pendiente`, `rechazada`, etc.) → injustificada a los fines de este listado.

- [ ] **Step 1: Test que falla**

```js
// src/utils/__tests__/agruparAusencias.test.js
import { describe, it, expect } from 'vitest'
import { agruparAusencias } from '../agruparAusencias'

const dias = (desde, hasta) => Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1

describe('agruparAusencias', () => {
  it('separa justificadas (aprobada) de injustificadas (el resto)', () => {
    const ausencias = [
      { id: '1', fecha_desde: '2026-01-05', fecha_hasta: '2026-01-05', estado: 'aprobada' },
      { id: '2', fecha_desde: '2026-02-10', fecha_hasta: '2026-02-11', estado: 'pendiente' },
      { id: '3', fecha_desde: '2026-03-01', fecha_hasta: '2026-03-01', estado: 'rechazada' },
    ]
    const r = agruparAusencias(ausencias, 2026)
    expect(r.justificadas.map((a) => a.id)).toEqual(['1'])
    expect(r.injustificadas.map((a) => a.id).sort()).toEqual(['2', '3'])
  })

  it('calcula el total de dias del año para cada grupo', () => {
    const ausencias = [
      { id: '1', fecha_desde: '2026-01-01', fecha_hasta: '2026-01-03', estado: 'aprobada' }, // 3 dias
      { id: '2', fecha_desde: '2026-02-01', fecha_hasta: '2026-02-01', estado: 'aprobada' }, // 1 dia
      { id: '3', fecha_desde: '2026-03-01', fecha_hasta: '2026-03-02', estado: 'pendiente' }, // 2 dias
    ]
    const r = agruparAusencias(ausencias, 2026)
    expect(r.totalDiasJustificadas).toBe(4)
    expect(r.totalDiasInjustificadas).toBe(2)
  })

  it('excluye ausencias de otros años', () => {
    const ausencias = [
      { id: '1', fecha_desde: '2025-12-30', fecha_hasta: '2025-12-31', estado: 'aprobada' },
      { id: '2', fecha_desde: '2026-01-01', fecha_hasta: '2026-01-01', estado: 'aprobada' },
    ]
    const r = agruparAusencias(ausencias, 2026)
    expect(r.justificadas.map((a) => a.id)).toEqual(['2'])
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/utils/__tests__/agruparAusencias.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima**

```js
// src/utils/agruparAusencias.js
// Agrupa ausencias (nom_v_ausencias) en justificadas/injustificadas para
// una ficha de legajo, con totales de días del año — mismo criterio que
// liquidar-periodo/index.ts usa para el cálculo real de faltas
// (estado === 'aprobada' es lo único que cuenta como justificada).
function diasEnRango(desde, hasta) {
  return Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1
}

export function agruparAusencias(ausencias, anio) {
  const delAnio = ausencias.filter((a) => a.fecha_desde.slice(0, 4) === String(anio))
  const justificadas = delAnio.filter((a) => a.estado === 'aprobada')
  const injustificadas = delAnio.filter((a) => a.estado !== 'aprobada')
  const sumar = (lista) => lista.reduce((acc, a) => acc + diasEnRango(a.fecha_desde, a.fecha_hasta), 0)
  return {
    justificadas, injustificadas,
    totalDiasJustificadas: sumar(justificadas),
    totalDiasInjustificadas: sumar(injustificadas),
  }
}
```

- [ ] **Step 4:** Run → PASS (3 tests). Commit: `git add src/utils/agruparAusencias.js src/utils/__tests__/agruparAusencias.test.js && git commit -m "feat(legajo): helper puro para agrupar ausencias justificadas/injustificadas por anio"`

- [ ] **Step 5: `TabAusencias.jsx`** — selector de año (default: año actual), dos listas ("Justificadas" / "Injustificadas") con sus totales de días en el título de cada una, usando `agruparAusencias`. Solo lectura (la fuente es Presencio, tal como indica el plan maestro).

- [ ] **Step 6:** Enganchar en la pestaña "Ausencias" de `FichaLegajoPage.jsx`, reemplazando el listado inline plano.

- [ ] **Step 7:** `npx vitest run` completo → PASS, sin regresiones. Commit: `git add src/components/legajo/TabAusencias.jsx src/pages/FichaLegajoPage.jsx && git commit -m "feat(legajo): pestana de ausencias separadas justificadas/injustificadas con totales"`

## Task 49: Alta y baja de legajo

**Files:**
- Modify: `src/store/legajoStore.js` (extender `legajoFromDB`/`legajoToDB` con los campos de la migración 0018)
- Modify: `src/store/__tests__/legajoStore.test.js`
- Modify: `src/components/legajo/EditorDatosLegajo.jsx` (acción "Dar de baja" + fecha de alta ya visible)
- Modify: `src/pages/FichaLegajoPage.jsx` (botón "Generar liquidación final", deshabilitado)

- [ ] **Step 1: Test que falla**

```js
// agregar a src/store/__tests__/legajoStore.test.js
describe('legajoFromDB / legajoToDB — campos de baja (migracion 0018)', () => {
  it('legajoFromDB mapea fecha_baja, motivo_baja, localidad, provincia, codigo_postal', () => {
    const row = {
      id: 'l1', empresa_id: 'e1', personal_id: 'p1',
      fecha_baja: '2026-06-30', motivo_baja: 'renuncia',
      localidad: 'Merlo', provincia: 'Buenos Aires', codigo_postal: '1722',
    }
    const l = legajoFromDB(row)
    expect(l.fechaBaja).toBe('2026-06-30')
    expect(l.motivoBaja).toBe('renuncia')
    expect(l.localidad).toBe('Merlo')
    expect(l.provincia).toBe('Buenos Aires')
    expect(l.codigoPostal).toBe('1722')
  })

  it('legajoToDB mapea de vuelta esos mismos campos', () => {
    const row = legajoToDB({ personalId: 'p1', fechaBaja: '2026-06-30', motivoBaja: 'renuncia' }, 'e1')
    expect(row.fecha_baja).toBe('2026-06-30')
    expect(row.motivo_baja).toBe('renuncia')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/store/__tests__/legajoStore.test.js` → FAIL (los campos nuevos no se mapean, `l.fechaBaja` es `undefined`).

- [ ] **Step 3: Implementación.** En `legajoFromDB`, agregar:

```js
  fechaBaja: r.fecha_baja, motivoBaja: r.motivo_baja, liquidacionFinalId: r.liquidacion_final_id,
  localidad: r.localidad, provincia: r.provincia, codigoPostal: r.codigo_postal,
```

  En `legajoToDB`, agregar (mismo patrón condicional que el resto de los campos):

```js
  ...(l.fechaBaja !== undefined && { fecha_baja: l.fechaBaja || null }),
  ...(l.motivoBaja !== undefined && { motivo_baja: l.motivoBaja || null }),
  ...(l.localidad !== undefined && { localidad: l.localidad }),
  ...(l.provincia !== undefined && { provincia: l.provincia }),
  ...(l.codigoPostal !== undefined && { codigo_postal: l.codigoPostal }),
```

- [ ] **Step 4:** Run → PASS. `npx vitest run` completo → PASS.

- [ ] **Step 5: `EditorDatosLegajo.jsx`.** Leer el archivo completo antes de editar (ya tiene el checkbox "Fuera de convenio" de la Fase 5B, mismo patrón a seguir). Agregar:
  - Los inputs de `localidad`/`provincia`/`codigoPostal` junto al resto de datos de dirección (`domicilio` ya existe).
  - Si `legajo.fechaBaja` está vacío: botón "Dar de baja" que abre un mini-formulario inline (fecha + select Motivo: `renuncia|despido_sin_causa|despido_con_causa|fin_obra|mutuo_acuerdo|fallecimiento`) con botón "Confirmar baja" que llama `guardarLegajo({ ...legajo, fechaBaja, motivoBaja }, empresaId)`.
  - Si `legajo.fechaBaja` está cargada: mostrar "Baja: {fechaBaja} ({motivoBaja})" de solo lectura (sin botón para deshacerla desde acá — revertir una baja es una decisión que requiere criterio de negocio no cubierto en este plan; si hace falta, se hace editando directo en Supabase por ahora).

- [ ] **Step 6: `FichaLegajoPage.jsx`.** En el header, si `legajo?.fechaBaja` está presente, mostrar un badge "Inactivo (baja: {fechaBaja})" junto al semáforo. Agregar botón "Generar liquidación final" — **deshabilitado**, con `title="Disponible al completar la Fase 5E (SAC, vacaciones y liquidación final)"` — visible únicamente cuando `legajo?.fechaBaja` está presente y `legajo?.liquidacionFinalId` es null.

- [ ] **Step 7:** `npx vitest run` completo → PASS, sin regresiones. Commit: `git add src/store/legajoStore.js src/store/__tests__/legajoStore.test.js src/components/legajo/EditorDatosLegajo.jsx src/pages/FichaLegajoPage.jsx && git commit -m "feat(legajo): alta y baja (fecha, motivo) con placeholder de liquidacion final"`

---

## Verificación final de la sub-fase (Tasks 44-49)

- [ ] `npx vitest run` completo en verde, sin regresiones vs. la base previa (185 tests al cierre de la Fase 5C).
- [ ] Prueba manual guiada: cargar un familiar y una sanción reales desde la ficha de un legajo de prueba, confirmar que aparecen tras recargar la página (persistencia real, no solo estado local). Dar de baja un legajo de prueba y confirmar que `LegajosPage` con filtro "Inactivo" lo muestra.
- [ ] Nota para el usuario: Task 17 del plan maestro (documentación configurable por cliente, con checklist de tipos requeridos y upload propio) queda explícitamente fuera de esta sub-fase — ver la decisión de alcance al inicio de este documento.
