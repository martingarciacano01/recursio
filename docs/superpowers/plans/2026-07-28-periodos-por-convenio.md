# Períodos por convenio (modalidad mensual/quincenal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la carga manual de fechas al crear un período de liquidación por un cálculo automático basado en Año/Mes/Tipo/Convenio, donde cada convenio define su propia modalidad (mensual o quincenal) y sus propias fechas de corte.

**Architecture:** `nom_convenios` gana `modalidad` + fechas de corte configurables; `nom_periodos` gana `convenio_id` (nullable). Una función pura nueva (`calcularFechasPeriodo`) deriva `fecha_desde`/`fecha_hasta` a partir de año/mes/tipo/convenio. El edge function `liquidar-periodo` filtra el personal a liquidar por `convenio_id` del período (en vez del flag binario `fuera_convenio` que usaba antes para decidir quincenal vs. no-quincenal). Nueva pestaña "Convenios" en Configuración para dar de alta convenios propios. `ReportesPage` reutiliza el `<SelectorPeriodo>` ya existente en vez de su `<select>` crudo.

**Tech Stack:** React 19 + Zustand + Supabase (Postgres + Edge Functions Deno) + vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-periodos-por-convenio-design.md`

---

## Task 1: Migración — modalidad/corte en convenios, convenio_id en períodos

**Files:**
- Create: `supabase/migrations/0035_periodos_por_convenio.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0035_periodos_por_convenio.sql
-- Modalidad (mensual/quincenal) y fechas de corte configurables por convenio,
-- + convenio_id en los períodos (un período quincenal/mensual pertenece a UN
-- convenio puntual, con sus propias fechas de corte). "Fuera de convenio"
-- (nom_legajo.fuera_convenio) sigue siendo un caso aparte, sin convenio_id:
-- su período (mensual_fc) no cambia.

ALTER TABLE nom_convenios
  ADD COLUMN IF NOT EXISTS modalidad TEXT NOT NULL DEFAULT 'quincenal'
    CHECK (modalidad IN ('mensual','quincenal')),
  ADD COLUMN IF NOT EXISTS corte_q1_desde INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS corte_q1_hasta INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS corte_q2_desde INT NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS corte_q2_hasta INT,       -- NULL = último día real del mes
  ADD COLUMN IF NOT EXISTS corte_mensual_desde INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS corte_mensual_hasta INT;  -- NULL = último día real del mes

COMMENT ON COLUMN nom_convenios.modalidad IS 'mensual: un solo período por mes. quincenal: quincena_1 + quincena_2.';
COMMENT ON COLUMN nom_convenios.corte_q2_hasta IS 'NULL = último día real del mes (resuelve automáticamente febrero 28/29).';
COMMENT ON COLUMN nom_convenios.corte_mensual_hasta IS 'NULL = último día real del mes.';

ALTER TABLE nom_periodos ADD COLUMN IF NOT EXISTS convenio_id UUID REFERENCES nom_convenios(id);
COMMENT ON COLUMN nom_periodos.convenio_id IS
  'A qué convenio pertenece un período mensual/quincena_1/quincena_2 (sus fechas se calcularon con el corte de ESE convenio). NULL en mensual_fc (fuera de convenio, no depende de ningún convenio), sac_1/sac_2, y períodos legado.';
```

- [ ] **Step 2: Avisar al usuario**

No se aplica desde este entorno — agregar a la lista de migraciones pendientes que el usuario aplica manualmente en Supabase SQL Editor (junto con la 0034 si todavía no la aplicó).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0035_periodos_por_convenio.sql
git commit -m "feat(db): modalidad/corte por convenio + convenio_id en periodos (migracion 0035, pendiente de aplicar)"
```

---

## Task 2: `calcularFechasPeriodo` — función pura de cálculo de fechas

**Files:**
- Create: `src/utils/calcularFechasPeriodo.js`
- Test: `src/utils/__tests__/calcularFechasPeriodo.test.js`

- [ ] **Step 1: Escribir los tests (deben fallar — el módulo no existe todavía)**

```js
// src/utils/__tests__/calcularFechasPeriodo.test.js
import { describe, it, expect } from 'vitest'
import { calcularFechasPeriodo } from '../calcularFechasPeriodo'

const convenioQuincenal = {
  modalidad: 'quincenal',
  corteQ1Desde: 1, corteQ1Hasta: 15,
  corteQ2Desde: 16, corteQ2Hasta: null,
  corteMensualDesde: 1, corteMensualHasta: null,
}

const convenioMensual = {
  modalidad: 'mensual',
  corteQ1Desde: 1, corteQ1Hasta: 15,
  corteQ2Desde: 16, corteQ2Hasta: null,
  corteMensualDesde: 1, corteMensualHasta: null,
}

describe('calcularFechasPeriodo', () => {
  it('quincena_1: usa corte_q1 del convenio', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 7, tipo: 'quincena_1', convenio: convenioQuincenal })
    expect(r).toEqual({ fechaDesde: '2026-07-01', fechaHasta: '2026-07-15' })
  })

  it('quincena_2 en mes de 31 días: hasta = 31 (corte_q2_hasta null = fin de mes real)', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 7, tipo: 'quincena_2', convenio: convenioQuincenal })
    expect(r).toEqual({ fechaDesde: '2026-07-16', fechaHasta: '2026-07-31' })
  })

  it('quincena_2 en mes de 30 días: hasta = 30', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 6, tipo: 'quincena_2', convenio: convenioQuincenal })
    expect(r).toEqual({ fechaDesde: '2026-06-16', fechaHasta: '2026-06-30' })
  })

  it('mensual en febrero no bisiesto (2026): hasta = 28', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 2, tipo: 'mensual', convenio: convenioMensual })
    expect(r).toEqual({ fechaDesde: '2026-02-01', fechaHasta: '2026-02-28' })
  })

  it('mensual en febrero bisiesto (2028): hasta = 29', () => {
    const r = calcularFechasPeriodo({ anio: 2028, mes: 2, tipo: 'mensual', convenio: convenioMensual })
    expect(r).toEqual({ fechaDesde: '2028-02-01', fechaHasta: '2028-02-29' })
  })

  it('corte custom: q1 de 6 a 20', () => {
    const convenioCustom = { ...convenioQuincenal, corteQ1Desde: 6, corteQ1Hasta: 20 }
    const r = calcularFechasPeriodo({ anio: 2026, mes: 7, tipo: 'quincena_1', convenio: convenioCustom })
    expect(r).toEqual({ fechaDesde: '2026-07-06', fechaHasta: '2026-07-20' })
  })

  it('corte_hasta mayor al último día real del mes se recorta (ej. 31 en un mes de 30)', () => {
    const convenioCustom = { ...convenioQuincenal, corteQ2Hasta: 31 }
    const r = calcularFechasPeriodo({ anio: 2026, mes: 6, tipo: 'quincena_2', convenio: convenioCustom })
    expect(r.fechaHasta).toBe('2026-06-30')
  })

  it('mensual_fc: ignora el convenio (o null), siempre 1 a fin de mes real', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 2, tipo: 'mensual_fc', convenio: null })
    expect(r).toEqual({ fechaDesde: '2026-02-01', fechaHasta: '2026-02-28' })
  })
})
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd /tmp/recursio-test && npx vitest run src/utils/__tests__/calcularFechasPeriodo.test.js`
Expected: FAIL — `Cannot find module '../calcularFechasPeriodo'`

- [ ] **Step 3: Implementar**

```js
// src/utils/calcularFechasPeriodo.js
// Deriva fecha_desde/fecha_hasta de un período a partir de año, mes, tipo y
// el convenio al que pertenece (o null para mensual_fc, que no depende de
// ningún convenio — fuera de convenio siempre es 1 a fin de mes real).
// Función pura: sin Supabase, testeable sola. Fase "períodos por convenio".

const pad2 = (n) => String(n).padStart(2, '0')
const fmt = (anio, mes, dia) => `${anio}-${pad2(mes)}-${pad2(dia)}`

// Último día real del mes (resuelve automáticamente febrero 28/29 y los
// meses de 30 días, sin fechas hardcodeadas).
function ultimoDiaDelMes(anio, mes) {
  return new Date(anio, mes, 0).getDate()
}

// `hasta` NULL o mayor al último día real se recorta a ese último día.
function resolverDia(dia, ultimoDia) {
  if (dia == null) return ultimoDia
  return Math.min(dia, ultimoDia)
}

export function calcularFechasPeriodo({ anio, mes, tipo, convenio }) {
  const ultimoDia = ultimoDiaDelMes(anio, mes)

  if (tipo === 'mensual_fc') {
    return { fechaDesde: fmt(anio, mes, 1), fechaHasta: fmt(anio, mes, ultimoDia) }
  }

  if (tipo === 'quincena_1') {
    return {
      fechaDesde: fmt(anio, mes, resolverDia(convenio.corteQ1Desde, ultimoDia)),
      fechaHasta: fmt(anio, mes, resolverDia(convenio.corteQ1Hasta, ultimoDia)),
    }
  }

  if (tipo === 'quincena_2') {
    return {
      fechaDesde: fmt(anio, mes, resolverDia(convenio.corteQ2Desde, ultimoDia)),
      fechaHasta: fmt(anio, mes, resolverDia(convenio.corteQ2Hasta, ultimoDia)),
    }
  }

  // 'mensual'
  return {
    fechaDesde: fmt(anio, mes, resolverDia(convenio.corteMensualDesde, ultimoDia)),
    fechaHasta: fmt(anio, mes, resolverDia(convenio.corteMensualHasta, ultimoDia)),
  }
}
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `cd /tmp/recursio-test && npx vitest run src/utils/__tests__/calcularFechasPeriodo.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/calcularFechasPeriodo.js src/utils/__tests__/calcularFechasPeriodo.test.js
git commit -m "feat: calcularFechasPeriodo — fechas de periodo derivadas de anio/mes/tipo/convenio"
```

---

## Task 3: `conveniosStore` — mapear nuevos campos + `crearConvenio`/`actualizarConvenio`

**Files:**
- Modify: `src/store/conveniosStore.js`
- Test: `src/store/__tests__/conveniosStore.test.js` (nuevo — hoy no existe ningún test de este store)

- [ ] **Step 1: Escribir los tests (deben fallar)**

```js
// src/store/__tests__/conveniosStore.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useConveniosStore, convenioFromDB } from '../conveniosStore'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

import { supabase } from '../../lib/supabase'

describe('convenioFromDB', () => {
  it('mapea modalidad y fechas de corte', () => {
    const r = convenioFromDB({
      id: 'c1', empresa_id: 'e1', nombre: 'UOCRA', regimen: '22250', descripcion: null,
      modalidad: 'quincenal',
      corte_q1_desde: 1, corte_q1_hasta: 15, corte_q2_desde: 16, corte_q2_hasta: null,
      corte_mensual_desde: 1, corte_mensual_hasta: null,
    })
    expect(r.modalidad).toBe('quincenal')
    expect(r.corteQ1Desde).toBe(1)
    expect(r.corteQ1Hasta).toBe(15)
    expect(r.corteQ2Desde).toBe(16)
    expect(r.corteQ2Hasta).toBeNull()
    expect(r.corteMensualDesde).toBe(1)
    expect(r.corteMensualHasta).toBeNull()
  })
})

describe('crearConvenio', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('inserta el convenio con los campos de modalidad/corte y recarga la lista', async () => {
    const insertado = {
      id: 'c2', empresa_id: 'e1', nombre: 'Nuevo', regimen: 'lct', descripcion: null,
      modalidad: 'mensual', corte_q1_desde: 1, corte_q1_hasta: 15, corte_q2_desde: 16, corte_q2_hasta: null,
      corte_mensual_desde: 1, corte_mensual_hasta: null,
    }
    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_convenios') {
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: insertado, error: null }) }) }),
        }
      }
      return { select: () => ({ or: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }
    })
    const r = await useConveniosStore.getState().crearConvenio('e1', {
      nombre: 'Nuevo', regimen: 'lct', modalidad: 'mensual',
    })
    expect(r.ok).toBe(true)
    expect(r.convenioId).toBe('c2')
  })

  it('propaga el error si falla el insert', async () => {
    supabase.from.mockReturnValue({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }),
    })
    const r = await useConveniosStore.getState().crearConvenio('e1', { nombre: 'X', regimen: 'lct', modalidad: 'mensual' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('boom')
  })
})

describe('actualizarConvenio', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('actualiza modalidad y fechas de corte de un convenio existente', async () => {
    supabase.from.mockReturnValue({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    })
    const r = await useConveniosStore.getState().actualizarConvenio('c1', { modalidad: 'mensual', corteMensualDesde: 5 })
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd /tmp/recursio-test && npx vitest run src/store/__tests__/conveniosStore.test.js`
Expected: FAIL — `crearConvenio is not a function` (y `actualizarConvenio`)

- [ ] **Step 3: Implementar**

Reemplazar todo el archivo `src/store/conveniosStore.js`:

```js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const convenioFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, nombre: r.nombre, regimen: r.regimen, descripcion: r.descripcion,
  modalidad: r.modalidad,
  corteQ1Desde: r.corte_q1_desde, corteQ1Hasta: r.corte_q1_hasta,
  corteQ2Desde: r.corte_q2_desde, corteQ2Hasta: r.corte_q2_hasta,
  corteMensualDesde: r.corte_mensual_desde, corteMensualHasta: r.corte_mensual_hasta,
})

export const useConveniosStore = create((set, get) => ({
  convenios: [], cargando: false, error: null,

  cargarConvenios: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_convenios').select('*')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('nombre')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ convenios: (data || []).map(convenioFromDB), cargando: false })
  },

  // Clona un convenio global a la empresa (función SQL SECURITY DEFINER,
  // migración 0012/0013). Devuelve el id del convenio propio. empresaId es
  // necesario cuando lo ejecuta un Superadmin "viendo como" una empresa
  // (auth_empresa_id() da NULL para él); para un usuario normal se ignora
  // del lado del servidor.
  clonarConvenio: async (convenioGlobalId, empresaId) => {
    const { data, error } = await supabase.rpc('clonar_convenio', {
      convenio_global_id: convenioGlobalId, p_empresa_id: empresaId ?? null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, convenioId: data }
  },

  // Alta de un convenio propio desde cero (Configuración → Convenios),
  // sin depender de clonar un template global. Fechas de corte con default
  // 1-15/16-fin/1-fin si no se pasan explícitas.
  crearConvenio: async (empresaId, { nombre, regimen, modalidad, descripcion, corteQ1Desde, corteQ1Hasta, corteQ2Desde, corteQ2Hasta, corteMensualDesde, corteMensualHasta }) => {
    const { data, error } = await supabase.from('nom_convenios').insert({
      empresa_id: empresaId, nombre, regimen, modalidad: modalidad || 'quincenal', descripcion: descripcion ?? null,
      corte_q1_desde: corteQ1Desde ?? 1, corte_q1_hasta: corteQ1Hasta ?? 15,
      corte_q2_desde: corteQ2Desde ?? 16, corte_q2_hasta: corteQ2Hasta ?? null,
      corte_mensual_desde: corteMensualDesde ?? 1, corte_mensual_hasta: corteMensualHasta ?? null,
    }).select().single()
    if (error) return { ok: false, error: error.message }
    await get().cargarConvenios(empresaId)
    return { ok: true, convenioId: data.id }
  },

  // Edita modalidad y/o fechas de corte de un convenio existente.
  actualizarConvenio: async (convenioId, cambios) => {
    const columnas = {
      ...(cambios.modalidad !== undefined && { modalidad: cambios.modalidad }),
      ...(cambios.corteQ1Desde !== undefined && { corte_q1_desde: cambios.corteQ1Desde }),
      ...(cambios.corteQ1Hasta !== undefined && { corte_q1_hasta: cambios.corteQ1Hasta }),
      ...(cambios.corteQ2Desde !== undefined && { corte_q2_desde: cambios.corteQ2Desde }),
      ...(cambios.corteQ2Hasta !== undefined && { corte_q2_hasta: cambios.corteQ2Hasta }),
      ...(cambios.corteMensualDesde !== undefined && { corte_mensual_desde: cambios.corteMensualDesde }),
      ...(cambios.corteMensualHasta !== undefined && { corte_mensual_hasta: cambios.corteMensualHasta }),
    }
    const { error } = await supabase.from('nom_convenios').update(columnas).eq('id', convenioId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `cd /tmp/recursio-test && npx vitest run src/store/__tests__/conveniosStore.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/conveniosStore.js src/store/__tests__/conveniosStore.test.js
git commit -m "feat: conveniosStore — modalidad/corte + crearConvenio/actualizarConvenio"
```

---

## Task 4: `TabConvenios` — alta y edición de convenios en Configuración

**Files:**
- Create: `src/components/config/TabConvenios.jsx`
- Test: `src/components/config/__tests__/TabConvenios.test.jsx`
- Modify: `src/pages/ConfiguracionPage.jsx`

- [ ] **Step 1: Escribir los tests (deben fallar)**

```jsx
// src/components/config/__tests__/TabConvenios.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabConvenios from '../TabConvenios'

const crearConvenioMock = vi.fn().mockResolvedValue({ ok: true, convenioId: 'c2' })
const actualizarConvenioMock = vi.fn().mockResolvedValue({ ok: true })
const cargarConveniosMock = vi.fn()

let convenios = [
  { id: 'c1', empresaId: 'e1', nombre: 'UOCRA', regimen: '22250', modalidad: 'quincenal', corteQ1Desde: 1, corteQ1Hasta: 15, corteQ2Desde: 16, corteQ2Hasta: null, corteMensualDesde: 1, corteMensualHasta: null },
]

vi.mock('../../../store/conveniosStore', () => ({
  useConveniosStore: () => ({
    convenios, cargarConvenios: cargarConveniosMock,
    crearConvenio: crearConvenioMock, actualizarConvenio: actualizarConvenioMock,
  }),
}))

describe('TabConvenios', () => {
  beforeEach(() => { crearConvenioMock.mockClear(); actualizarConvenioMock.mockClear() })

  it('lista los convenios propios con su modalidad', () => {
    render(<TabConvenios empresaId="e1" />)
    expect(screen.getByText('UOCRA')).toBeInTheDocument()
    expect(screen.getByText(/quincenal/i)).toBeInTheDocument()
  })

  it('alta de convenio nuevo llama a crearConvenio con los datos del formulario', async () => {
    render(<TabConvenios empresaId="e1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo convenio' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Convenio B' } })
    fireEvent.change(screen.getByLabelText('Modalidad'), { target: { value: 'mensual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar convenio' }))
    await waitFor(() => {
      expect(crearConvenioMock).toHaveBeenCalledWith('e1', expect.objectContaining({ nombre: 'Convenio B', modalidad: 'mensual' }))
    })
  })

  it('editar fechas de corte de un convenio existente llama a actualizarConvenio', async () => {
    render(<TabConvenios empresaId="e1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('1ra quincena — hasta'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(actualizarConvenioMock).toHaveBeenCalledWith('c1', expect.objectContaining({ corteQ1Hasta: 20 }))
    })
  })
})
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd /tmp/recursio-test && npx vitest run src/components/config/__tests__/TabConvenios.test.jsx`
Expected: FAIL — no se puede importar `../TabConvenios`

- [ ] **Step 3: Implementar**

```jsx
// src/components/config/TabConvenios.jsx
import { useState } from 'react'
import { useConveniosStore } from '../../store/conveniosStore'

// Alta y edición de convenios propios de la empresa (modalidad mensual vs.
// quincenal + fechas de corte). Antes la única forma de tener un convenio
// era "clonar" uno global (personalizar); esto agrega un alta genuina desde
// cero, y la edición de modalidad/corte que hoy no existía en ningún lado.
export default function TabConvenios({ empresaId }) {
  const { convenios, crearConvenio, actualizarConvenio } = useConveniosStore()
  const propios = convenios.filter((c) => c.empresaId === empresaId)

  const [creando, setCreando] = useState(false)
  const [nuevo, setNuevo] = useState({ nombre: '', regimen: 'lct', modalidad: 'quincenal' })
  const [errorCrear, setErrorCrear] = useState('')

  const [editandoId, setEditandoId] = useState(null)
  const [edicion, setEdicion] = useState({})
  const [errorEditar, setErrorEditar] = useState('')

  const handleCrear = async () => {
    setErrorCrear('')
    const r = await crearConvenio(empresaId, nuevo)
    if (!r.ok) { setErrorCrear(r.error); return }
    setCreando(false)
    setNuevo({ nombre: '', regimen: 'lct', modalidad: 'quincenal' })
  }

  const empezarEdicion = (c) => {
    setEditandoId(c.id)
    setEdicion({
      modalidad: c.modalidad,
      corteQ1Desde: c.corteQ1Desde, corteQ1Hasta: c.corteQ1Hasta,
      corteQ2Desde: c.corteQ2Desde, corteQ2Hasta: c.corteQ2Hasta,
      corteMensualDesde: c.corteMensualDesde, corteMensualHasta: c.corteMensualHasta,
    })
  }

  const guardarEdicion = async () => {
    setErrorEditar('')
    const r = await actualizarConvenio(editandoId, edicion)
    if (!r.ok) { setErrorEditar(r.error); return }
    setEditandoId(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {propios.map((c) => (
        <div key={c.id} className="card">
          <strong>{c.nombre}</strong> <span className="badge badge-neutral">{c.modalidad}</span>
          {editandoId !== c.id && (
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => empezarEdicion(c)}>Editar</button>
          )}
          {editandoId === c.id && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label htmlFor={`modalidad-${c.id}`}>Modalidad</label>
              <select id={`modalidad-${c.id}`} className="input" style={{ maxWidth: 200 }}
                value={edicion.modalidad} onChange={(e) => setEdicion((v) => ({ ...v, modalidad: e.target.value }))}>
                <option value="quincenal">Quincenal</option>
                <option value="mensual">Mensual</option>
              </select>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label htmlFor={`q1d-${c.id}`}>1ra quincena — desde</label>
                <input id={`q1d-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteQ1Desde} onChange={(e) => setEdicion((v) => ({ ...v, corteQ1Desde: Number(e.target.value) }))} />
                <label htmlFor={`q1h-${c.id}`}>1ra quincena — hasta</label>
                <input id={`q1h-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteQ1Hasta} onChange={(e) => setEdicion((v) => ({ ...v, corteQ1Hasta: Number(e.target.value) }))} />
                <label htmlFor={`q2d-${c.id}`}>2da quincena — desde</label>
                <input id={`q2d-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteQ2Desde} onChange={(e) => setEdicion((v) => ({ ...v, corteQ2Desde: Number(e.target.value) }))} />
                <label htmlFor={`q2h-${c.id}`}>2da quincena — hasta (vacío = fin de mes)</label>
                <input id={`q2h-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteQ2Hasta ?? ''} onChange={(e) => setEdicion((v) => ({ ...v, corteQ2Hasta: e.target.value ? Number(e.target.value) : null }))} />
                <label htmlFor={`mesd-${c.id}`}>Mensual — desde</label>
                <input id={`mesd-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteMensualDesde} onChange={(e) => setEdicion((v) => ({ ...v, corteMensualDesde: Number(e.target.value) }))} />
                <label htmlFor={`mesh-${c.id}`}>Mensual — hasta (vacío = fin de mes)</label>
                <input id={`mesh-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteMensualHasta ?? ''} onChange={(e) => setEdicion((v) => ({ ...v, corteMensualHasta: e.target.value ? Number(e.target.value) : null }))} />
              </div>
              {errorEditar && <p style={{ color: 'var(--danger)' }}>{errorEditar}</p>}
              <div>
                <button className="btn btn-primary btn-sm" onClick={guardarEdicion}>Guardar cambios</button>
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setEditandoId(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {!creando && <button className="btn btn-primary btn-sm" onClick={() => setCreando(true)}>Nuevo convenio</button>}
      {creando && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="nc-nombre">Nombre</label>
          <input id="nc-nombre" className="input" value={nuevo.nombre} onChange={(e) => setNuevo((v) => ({ ...v, nombre: e.target.value }))} />
          <label htmlFor="nc-regimen">Régimen</label>
          <select id="nc-regimen" className="input" style={{ maxWidth: 200 }}
            value={nuevo.regimen} onChange={(e) => setNuevo((v) => ({ ...v, regimen: e.target.value }))}>
            <option value="lct">LCT (Ley 20.744)</option>
            <option value="22250">Construcción (Ley 22.250)</option>
          </select>
          <label htmlFor="nc-modalidad">Modalidad</label>
          <select id="nc-modalidad" className="input" style={{ maxWidth: 200 }}
            value={nuevo.modalidad} onChange={(e) => setNuevo((v) => ({ ...v, modalidad: e.target.value }))}>
            <option value="quincenal">Quincenal</option>
            <option value="mensual">Mensual</option>
          </select>
          {errorCrear && <p style={{ color: 'var(--danger)' }}>{errorCrear}</p>}
          <div>
            <button className="btn btn-primary btn-sm" onClick={handleCrear} disabled={!nuevo.nombre.trim()}>Guardar convenio</button>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setCreando(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `cd /tmp/recursio-test && npx vitest run src/components/config/__tests__/TabConvenios.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Agregar la pestaña a ConfiguracionPage**

En `src/pages/ConfiguracionPage.jsx`:

Modificar el import (línea 13):
```jsx
import TabAlertas from '../components/config/TabAlertas'
import TabConvenios from '../components/config/TabConvenios'
```

Modificar `PESTANAS` (línea 15) agregando `'Convenios'` al final:
```jsx
const PESTANAS = ['Escalas salariales', 'No remunerativos', 'Aportes y contribuciones', 'Adicionales', 'Parámetros', 'Documentación', 'Alertas', 'Flujo de aprobación', 'Empresa', 'Convenios']
```

Agregar el render (después de la línea 101, `{pestana === 'Empresa' && ...}`):
```jsx
{pestana === 'Convenios' && <TabConvenios empresaId={empresaActiva.id} />}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/config/TabConvenios.jsx src/components/config/__tests__/TabConvenios.test.jsx src/pages/ConfiguracionPage.jsx
git commit -m "feat: TabConvenios — alta y edicion de convenios (modalidad + fechas de corte)"
```

---

## Task 5: `liquidar-periodo` — filtrar por `convenio_id` del período

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts:142-154`

Nota: este edge function (Deno) no tiene tests unitarios hoy (no existe ningún `.test.ts` en `supabase/functions/`) — no se agrega un test nuevo acá, se sigue el patrón existente del archivo. La verificación de este paso es lectura cuidadosa + build/lint del resto del repo, igual que los cambios anteriores a este mismo archivo en la Fase 6.

- [ ] **Step 1: Reemplazar el filtro**

Ubicar en `supabase/functions/liquidar-periodo/index.ts` (línea 142-154):

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

Reemplazar por:

```ts
  // Un período 'mensual_fc' liquida SOLO al personal fuera de convenio
  // (cobra mensual mientras su convenio real, si tuviera, cobraría por
  // quincena — nunca lo hace porque fuera_convenio no tiene convenio_id).
  // Un período mensual/quincena_1/quincena_2 pertenece a UN convenio
  // puntual (migración 0035, "períodos por convenio"): liquida solo al
  // personal de ESE convenio, nunca al fuera de convenio. Períodos legado
  // sin convenio_id (sac_1/sac_2, datos previos a la 0035) no discriminan
  // — comportamiento idéntico al de antes de esta migración.
  const esPeriodoFueraConvenio = periodo.tipo === 'mensual_fc'
  let personalAProcesar = (personal || []).filter((p: any) => {
    const l = legajoPorPersonal.get(p.id)
    if (esPeriodoFueraConvenio) return l?.fuera_convenio === true
    if (periodo.convenio_id) return l?.convenio_id === periodo.convenio_id && l?.fuera_convenio !== true
    return l?.fuera_convenio !== true
  })
```

- [ ] **Step 2: Verificar que no rompe la suite existente**

Run: `cd /tmp/recursio-test && npx vitest run`
Expected: PASS (misma cantidad de tests que antes de este task — este archivo no tiene tests propios, así que el número no debería cambiar respecto al Task 4)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/liquidar-periodo/index.ts
git commit -m "feat: liquidar-periodo filtra personal por convenio_id del periodo"
```

---

## Task 6: `LiquidacionPage` — formulario "Nuevo período" por Año/Mes/Tipo/Convenio

**Files:**
- Modify: `src/pages/LiquidacionPage.jsx`
- Test: `src/pages/__tests__/LiquidacionPage.test.jsx` (si no existe, crear uno enfocado en el formulario; si existe, extenderlo con este caso)

- [ ] **Step 1: Comprobar si ya existe un test de LiquidacionPage**

Run: `ls /tmp/recursio-test/src/pages/__tests__/LiquidacionPage.test.jsx 2>&1`

Si NO existe, crear el archivo con el siguiente contenido (test enfocado solo en el formulario de creación, para no tener que mockear toda la página):

```jsx
// src/pages/__tests__/LiquidacionPage.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LiquidacionPage from '../LiquidacionPage'

function chain(data, error = null) {
  const obj = {
    select: () => obj, eq: () => obj, order: () => obj, in: () => obj, or: () => obj,
    insert: () => obj, single: () => Promise.resolve({ data, error }),
    then: (resolve) => resolve({ data, error }),
  }
  return obj
}

vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel) => sel({ empresa: { id: 'e1' }, empresaVista: null }),
}))
vi.mock('../../store/liquidacionStore', () => ({
  useLiquidacionStore: () => ({
    liquidaciones: [], calculando: false, error: null, omitidos: [], advertencias: [],
    calcularPeriodo: vi.fn(), cargarLiquidaciones: vi.fn(), emitirRecibo: vi.fn(),
  }),
}))
vi.mock('../../store/flujosStore', () => ({
  useFlujosStore: () => ({ flujos: [], cargarFlujos: vi.fn(), iniciarFlujo: vi.fn() }),
}))
vi.mock('../../store/conveniosStore', () => ({
  useConveniosStore: () => ({
    convenios: [
      { id: 'conv-uocra', empresaId: 'e1', nombre: 'UOCRA', modalidad: 'quincenal' },
    ],
    cargarConvenios: vi.fn(),
  }),
}))

let insertPayload = null
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabla) => {
      if (tabla === 'nom_periodos') {
        return {
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
          insert: (payload) => { insertPayload = payload; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'p1', ...payload }, error: null }) }) } },
        }
      }
      return chain([])
    }),
  },
}))

describe('LiquidacionPage — Nuevo período', () => {
  beforeEach(() => { insertPayload = null })

  it('crear un período mensual/quincenal calcula las fechas y las manda con convenio_id', async () => {
    render(<LiquidacionPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo período' }))
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'quincena_1' } })
    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Convenio'), { target: { value: 'conv-uocra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear período' }))
    await waitFor(() => {
      expect(insertPayload).toMatchObject({
        tipo: 'quincena_1', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-15', convenio_id: 'conv-uocra',
      })
    })
  })

  it('crear un SAC sigue usando fechas manuales (sin convenio)', async () => {
    render(<LiquidacionPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo período' }))
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'sac_1' } })
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear período' }))
    await waitFor(() => {
      expect(insertPayload).toMatchObject({ tipo: 'sac_1', fecha_desde: '2026-01-01', fecha_hasta: '2026-06-30' })
      expect(insertPayload.convenio_id).toBeUndefined()
    })
  })
})
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd /tmp/recursio-test && npx vitest run src/pages/__tests__/LiquidacionPage.test.jsx`
Expected: FAIL — no existen los labels "Año"/"Mes"/"Convenio" (el formulario actual solo tiene "Tipo"/"Desde"/"Hasta")

- [ ] **Step 3: Implementar — reemplazar el estado y el formulario**

En `src/pages/LiquidacionPage.jsx`, agregar el import de `calcularFechasPeriodo` y `useConveniosStore` (junto a los imports existentes, línea 1-12):

```jsx
import { useConveniosStore } from '../store/conveniosStore'
import { calcularFechasPeriodo } from '../utils/calcularFechasPeriodo'
```

Reemplazar el bloque de estado del formulario (líneas 38-43):

```jsx
  const [mostrarFormNuevo, setMostrarFormNuevo] = useState(false)
  const [nuevoTipo, setNuevoTipo] = useState('quincena_1')
  const [nuevoAnio, setNuevoAnio] = useState(new Date().getFullYear())
  const [nuevoMes, setNuevoMes] = useState(new Date().getMonth() + 1)
  const [nuevoConvenioId, setNuevoConvenioId] = useState('')
  const [nuevoDesde, setNuevoDesde] = useState('')
  const [nuevoHasta, setNuevoHasta] = useState('')
  const [creandoPeriodo, setCreandoPeriodo] = useState(false)
  const [errorCrearPeriodo, setErrorCrearPeriodo] = useState('')
  const { convenios, cargarConvenios } = useConveniosStore()
```

Agregar, junto a los otros `useEffect` de carga (buscar el `useEffect` que carga `flujos`/`periodos` con `empresaId` como dependencia y agregar uno análogo):

```jsx
  useEffect(() => { if (empresaId) cargarConvenios(empresaId) }, [empresaId])
```

Los tipos mensual/quincena_1/quincena_2/mensual_fc requieren cálculo automático; sac_1/sac_2 siguen con fechas manuales. Agregar, antes del `return` de la página:

```jsx
  const REQUIERE_CONVENIO = new Set(['quincena_1', 'quincena_2', 'mensual'])
  const ES_MANUAL = new Set(['sac_1', 'sac_2'])
  const conveniosDeLaModalidad = (modalidad) => convenios.filter((c) => c.empresaId === empresaId && c.modalidad === modalidad)
  const conveniosDisponibles = nuevoTipo === 'mensual' ? conveniosDeLaModalidad('mensual')
    : (nuevoTipo === 'quincena_1' || nuevoTipo === 'quincena_2') ? conveniosDeLaModalidad('quincenal')
    : []
  const convenioElegido = conveniosDisponibles.find((c) => c.id === nuevoConvenioId) || null
  const fechasCalculadas = (REQUIERE_CONVENIO.has(nuevoTipo) || nuevoTipo === 'mensual_fc')
    ? (convenioElegido || nuevoTipo === 'mensual_fc'
        ? calcularFechasPeriodo({ anio: Number(nuevoAnio), mes: Number(nuevoMes), tipo: nuevoTipo, convenio: convenioElegido })
        : null)
    : null
```

Reemplazar `handleCrearPeriodo` (líneas 143-172):

```jsx
  const handleCrearPeriodo = async () => {
    setErrorCrearPeriodo('')
    if (!empresaId) {
      setErrorCrearPeriodo('Elegí primero una empresa en Superadmin.')
      return
    }
    let fechaDesde, fechaHasta
    if (ES_MANUAL.has(nuevoTipo)) {
      if (!nuevoDesde || !nuevoHasta) { setErrorCrearPeriodo('Completá fecha desde y hasta.'); return }
      if (nuevoHasta < nuevoDesde) { setErrorCrearPeriodo('La fecha hasta no puede ser anterior a la fecha desde.'); return }
      fechaDesde = nuevoDesde; fechaHasta = nuevoHasta
    } else {
      if (REQUIERE_CONVENIO.has(nuevoTipo) && !convenioElegido) {
        setErrorCrearPeriodo(`No hay ningún convenio con modalidad "${nuevoTipo === 'mensual' ? 'mensual' : 'quincenal'}" configurado.`)
        return
      }
      const f = calcularFechasPeriodo({ anio: Number(nuevoAnio), mes: Number(nuevoMes), tipo: nuevoTipo, convenio: convenioElegido })
      fechaDesde = f.fechaDesde; fechaHasta = f.fechaHasta
    }
    setCreandoPeriodo(true)
    const { data, error } = await supabase.from('nom_periodos').insert({
      empresa_id: empresaId,
      tipo: nuevoTipo,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      estado: 'abierto',
      ...(convenioElegido && { convenio_id: convenioElegido.id }),
    }).select().single()
    setCreandoPeriodo(false)
    if (error) { setErrorCrearPeriodo(error.message); return }
    setPeriodos((prev) => [data, ...prev])
    setPeriodoSeleccionado(data.id)
    setMostrarFormNuevo(false)
    setNuevoDesde('')
    setNuevoHasta('')
    setNuevoConvenioId('')
  }
```

Reemplazar el bloque del formulario `{mostrarFormNuevo && (...)}` (líneas 231-257) por:

```jsx
      {mostrarFormNuevo && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label htmlFor="np-tipo" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Tipo</label>
            <select id="np-tipo" className="input" value={nuevoTipo} onChange={(e) => { setNuevoTipo(e.target.value); setNuevoConvenioId('') }}>
              <option value="quincena_1">1ra quincena</option>
              <option value="quincena_2">2da quincena</option>
              <option value="mensual">Mensual</option>
              <option value="mensual_fc">Fuera de convenio (mensual)</option>
              <option value="sac_1">1er SAC</option>
              <option value="sac_2">2do SAC</option>
            </select>
          </div>

          {!ES_MANUAL.has(nuevoTipo) && (
            <>
              <div>
                <label htmlFor="np-anio" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Año</label>
                <input id="np-anio" className="input" type="number" style={{ width: 90 }} value={nuevoAnio} onChange={(e) => setNuevoAnio(e.target.value)} />
              </div>
              <div>
                <label htmlFor="np-mes" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Mes</label>
                <select id="np-mes" className="input" value={nuevoMes} onChange={(e) => setNuevoMes(e.target.value)}>
                  {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              {REQUIERE_CONVENIO.has(nuevoTipo) && (
                <div>
                  <label htmlFor="np-convenio" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Convenio</label>
                  <select id="np-convenio" className="input" value={nuevoConvenioId} onChange={(e) => setNuevoConvenioId(e.target.value)}>
                    <option value="">Elegir convenio…</option>
                    {conveniosDisponibles.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              )}
              {fechasCalculadas && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {fechasCalculadas.fechaDesde} a {fechasCalculadas.fechaHasta}
                </div>
              )}
            </>
          )}

          {ES_MANUAL.has(nuevoTipo) && (
            <>
              <div>
                <label htmlFor="np-desde" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Desde</label>
                <input id="np-desde" type="date" className="input" value={nuevoDesde} onChange={(e) => setNuevoDesde(e.target.value)} />
              </div>
              <div>
                <label htmlFor="np-hasta" style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Hasta</label>
                <input id="np-hasta" type="date" className="input" value={nuevoHasta} onChange={(e) => setNuevoHasta(e.target.value)} />
              </div>
            </>
          )}

          <button className="btn btn-primary btn-sm" onClick={handleCrearPeriodo} disabled={creandoPeriodo}>
            {creandoPeriodo ? 'Creando…' : 'Crear período'}
          </button>
          {errorCrearPeriodo && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorCrearPeriodo}</span>}
        </div>
      )}
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `cd /tmp/recursio-test && npx vitest run src/pages/__tests__/LiquidacionPage.test.jsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Correr la suite completa (regresión)**

Run: `cd /tmp/recursio-test && npx vitest run`
Expected: todos los tests existentes siguen en verde, más los nuevos de este plan.

- [ ] **Step 6: Commit**

```bash
git add src/pages/LiquidacionPage.jsx src/pages/__tests__/LiquidacionPage.test.jsx
git commit -m "feat: Nuevo periodo por Anio/Mes/Tipo/Convenio con fechas auto-calculadas"
```

---

## Task 7: `ReportesPage` — reutilizar `<SelectorPeriodo>`

**Files:**
- Modify: `src/pages/ReportesPage.jsx:1-4,153-160`

- [ ] **Step 1: Agregar el import**

En `src/pages/ReportesPage.jsx`, línea 4, agregar:
```jsx
import SelectorPeriodo from '../components/SelectorPeriodo'
```

- [ ] **Step 2: Reemplazar el selector crudo**

Reemplazar (líneas 153-160):
```jsx
          <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'center' }}>
            <select className="input" style={{ maxWidth: 320 }} value={periodoId} onChange={(e) => { setPeriodoId(e.target.value); setAlertaEscala(null) }}>
              <option value="">Elegir período…</option>
              {periodos.map((p) => (
                <option key={p.id} value={p.id}>{p.tipo} — {p.fecha_desde} a {p.fecha_hasta} ({p.estado})</option>
              ))}
            </select>
          </div>
```

por:
```jsx
          <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'center' }}>
            <SelectorPeriodo periodos={periodos} value={periodoId} onChange={(v) => { setPeriodoId(v); setAlertaEscala(null) }} />
          </div>
```

- [ ] **Step 3: Correr la suite completa para confirmar que no rompe nada**

Run: `cd /tmp/recursio-test && npx vitest run`
Expected: PASS (no había tests de `ReportesPage` que dependieran del `<select>` viejo — confirmar buscando `ReportesPage.test` antes de este paso; si existiera y fallara por este cambio, actualizar sus selectors de `screen.getByRole('combobox')`/`getByText` al nuevo formato de `<SelectorPeriodo>`, igual que se hizo con `SelectorPeriodo.test.jsx` en la Fase 6).

- [ ] **Step 4: Commit**

```bash
git add src/pages/ReportesPage.jsx
git commit -m "feat: ReportesPage reutiliza SelectorPeriodo (antes select crudo con formato distinto)"
```

---

## Task 8: Verificación final

**Files:** ninguno (solo comandos)

- [ ] **Step 1: Suite completa**

Run: `cd /tmp/recursio-test && npx vitest run`
Expected: 0 fallos, todos los tests nuevos de este plan incluidos.

- [ ] **Step 2: Lint**

Run: `cd /tmp/recursio-test && npm run lint`
Expected: sin errores nuevos respecto al baseline (los mismos ~10 errores/24 warnings preexistentes documentados en `docs/2026-07-28-handoff-liquidacion-individuales.md`, ninguno en los archivos tocados por este plan).

- [ ] **Step 3: Build**

Run: `cd /tmp/recursio-test && npm run build`
Expected: build limpio.

- [ ] **Step 4: Handoff**

Escribir/actualizar `docs/2026-07-28-handoff-periodos-por-convenio.md` con: la migración 0035 pendiente de aplicar, y el/los comandos de git para que el usuario haga commit+push (git no puede correr desde este sandbox).
