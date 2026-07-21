# Fase 1 — Legajo digital — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Legajo digital completo por empleado (datos, familiares, sanciones, documentación, ausencias en lectura) con semáforo de completitud y exportación a PDF, sobre el esquema `nom_*` de Recursio.

**Architecture:** Tablas nuevas `nom_familiares` y `nom_sanciones_personal` (mismo patrón RLS + GRANT que Fase 0 — **lección de Fase 0: RLS sola no alcanza, hace falta `GRANT` explícito para `authenticated`, o la fila queda invisible con "permission denied"**). Un store Zustand (`legajoStore.js`) con mappers `fromDB`/`toDB` testeados por separado del componente. UI reutiliza clases CSS globales (`.card`, `.table`, `.badge-*`, `.btn-*`) ya copiadas de Presencio en `src/index.css`.

**Tech Stack:** React 19, Supabase JS, Zustand (sin persist), Vitest, jsPDF.

---

## Antes de empezar — una migración necesita tu aprobación explícita

Este plan agrega `ambito TEXT DEFAULT 'general'` a `tipos_documento`, que es una tabla de **Presencio**, no de Recursio. Es la única excepción autorizada por el plan madre (`Recursio_Plan_Ejecucion_Sonnet5.md`, instrucción 7) pero igual requiere tu confirmación explícita antes de aplicarla — está aislada en su propio archivo (`0006_tipos_documento_ambito.sql`, Task 11) para que puedas revisarla y aprobarla por separado del resto.

---

### Task 7: Migración legajo completo + RLS + GRANT + tests

**Files:**
- Create: `supabase/migrations/0004_legajo_completo.sql`
- Test: `tests/rls/legajo.rls.test.js`

- [ ] **Step 1: Escribir la migración** con las dos tablas nuevas, RLS y GRANT en el mismo archivo (no repetir el error de Fase 0 de olvidar el GRANT):

```sql
-- 0004_legajo_completo.sql — Fase 1, Task 7
-- nom_familiares: cargas de familia (asignaciones familiares, ganancias).
CREATE TABLE IF NOT EXISTS nom_familiares (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id       UUID NOT NULL,
  vinculo           TEXT NOT NULL CHECK (vinculo IN ('conyuge','conviviente','hijo','otro')),
  nombre            TEXT NOT NULL,
  cuil              TEXT,
  fecha_nacimiento  DATE,
  doc_path          TEXT,
  doc_nombre        TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_familiares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_familiares_all ON nom_familiares;
CREATE POLICY nom_familiares_all ON nom_familiares FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id())
  WITH CHECK (empresa_id = auth_empresa_id());
CREATE INDEX IF NOT EXISTS nom_familiares_empresa_idx ON nom_familiares(empresa_id);
CREATE INDEX IF NOT EXISTS nom_familiares_personal_idx ON nom_familiares(personal_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_familiares TO authenticated;

-- nom_sanciones_personal: calco de la propuesta sanciones_personal de
-- fichaobra/PROPUESTA_legajo_digital.md, con prefijo nom_ (Recursio no
-- crea tablas sin prefijo propio, Recursio_Diseno.md 2.1).
CREATE TABLE IF NOT EXISTS nom_sanciones_personal (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id       UUID NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('apercibimiento','suspension','llamado_atencion','otra')),
  motivo            TEXT NOT NULL,
  fecha             DATE NOT NULL,
  dias_suspension   INTEGER,
  doc_path          TEXT,
  doc_nombre        TEXT,
  aplicada_por      UUID,
  created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_sanciones_personal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_sanciones_personal_all ON nom_sanciones_personal;
CREATE POLICY nom_sanciones_personal_all ON nom_sanciones_personal FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id())
  WITH CHECK (empresa_id = auth_empresa_id());
CREATE INDEX IF NOT EXISTS nom_sanciones_empresa_idx ON nom_sanciones_personal(empresa_id);
CREATE INDEX IF NOT EXISTS nom_sanciones_personal_idx ON nom_sanciones_personal(personal_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_sanciones_personal TO authenticated;
```

- [ ] **Step 2: Test de RLS que falla** (mismo patrón que `tests/rls/nomina_core.rls.test.js` de Fase 0, `skipIf` sin credenciales):

```js
// tests/rls/legajo.rls.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_TEST_URL = process.env.SUPABASE_TEST_URL
const SUPABASE_TEST_SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY
const tieneCredenciales = Boolean(SUPABASE_TEST_URL && SUPABASE_TEST_SERVICE_KEY)

describe.skipIf(!tieneCredenciales)('RLS nom_familiares / nom_sanciones_personal', () => {
  let admin, empresaX, empresaY, clienteA, clienteB, personalIdFake

  beforeAll(async () => {
    admin = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)
    const { data: eX } = await admin.from('empresas').insert({ nombre: 'Legajo Test X' }).select().single()
    const { data: eY } = await admin.from('empresas').insert({ nombre: 'Legajo Test Y' }).select().single()
    empresaX = eX; empresaY = eY
    personalIdFake = crypto.randomUUID()

    const { data: userA } = await admin.auth.admin.createUser({
      email: `legajo-a-${Date.now()}@recursio.test`, password: 'testpass123', email_confirm: true,
      user_metadata: { empresa_id: empresaX.id, rol: 'admin' },
    })
    const { data: userB } = await admin.auth.admin.createUser({
      email: `legajo-b-${Date.now()}@recursio.test`, password: 'testpass123', email_confirm: true,
      user_metadata: { empresa_id: empresaY.id, rol: 'admin' },
    })
    clienteA = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)
    await clienteA.auth.signInWithPassword({ email: userA.user.email, password: 'testpass123' })
    clienteB = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)
    await clienteB.auth.signInWithPassword({ email: userB.user.email, password: 'testpass123' })
  })

  afterAll(async () => {
    await admin.from('nom_familiares').delete().in('empresa_id', [empresaX?.id, empresaY?.id].filter(Boolean))
    await admin.from('nom_sanciones_personal').delete().in('empresa_id', [empresaX?.id, empresaY?.id].filter(Boolean))
    await admin.from('empresas').delete().in('id', [empresaX?.id, empresaY?.id].filter(Boolean))
  })

  it('usuario B no ve familiares de la empresa X', async () => {
    await clienteA.from('nom_familiares').insert({ empresa_id: empresaX.id, personal_id: personalIdFake, vinculo: 'hijo', nombre: 'Test Hijo' })
    const { data, error } = await clienteB.from('nom_familiares').select('*').eq('personal_id', personalIdFake)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('usuario B no ve sanciones de la empresa X', async () => {
    await clienteA.from('nom_sanciones_personal').insert({ empresa_id: empresaX.id, personal_id: personalIdFake, tipo: 'llamado_atencion', motivo: 'test', fecha: '2026-01-01' })
    const { data, error } = await clienteB.from('nom_sanciones_personal').select('*').eq('personal_id', personalIdFake)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('usuario B no puede insertar con empresa_id ajeno', async () => {
    const { error } = await clienteB.from('nom_familiares').insert({ empresa_id: empresaX.id, personal_id: crypto.randomUUID(), vinculo: 'hijo', nombre: 'Ajeno' })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_legajo_completo.sql tests/rls/legajo.rls.test.js
git commit -m "feat: tablas nom_familiares y nom_sanciones_personal con rls + grant + tests"
```

- [ ] **Step 4: Aplicar la migración en el proyecto Supabase dev y correr el chequeo cruzado a mano** (mismo procedimiento manual que Fase 0, Task 3-4: usuario de empresa A vs usuario de empresa B). Documentar el resultado antes de seguir a Task 8.

---

### Task 8: Store de legajos (mappers testeados)

**Files:**
- Create: `src/store/legajoStore.js`
- Test: `src/store/__tests__/legajoStore.test.js`

- [ ] **Step 1: Test que falla** para los mappers `fromDB`/`toDB` (sin tocar Supabase — mappers puros):

```js
// src/store/__tests__/legajoStore.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { legajoFromDB, legajoToDB, familiarFromDB, sancionFromDB } from '../legajoStore'

describe('mappers de legajo', () => {
  it('legajoFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'l1', empresa_id: 'e1', personal_id: 'p1', cuil: '20-1-9', fecha_nacimiento: '1990-01-01', domicilio: 'Calle 1', fecha_ingreso: '2020-01-01', convenio_id: 'c1', categoria_id: 'cat1', cbu: '0000', banco: 'BNA', obra_social: 'OSDE', jornada: 'completa' }
    expect(legajoFromDB(row)).toEqual({
      id: 'l1', empresaId: 'e1', personalId: 'p1', cuil: '20-1-9',
      fechaNacimiento: '1990-01-01', domicilio: 'Calle 1', fechaIngreso: '2020-01-01',
      convenioId: 'c1', categoriaId: 'cat1', cbu: '0000', banco: 'BNA',
      obraSocial: 'OSDE', jornada: 'completa',
    })
  })

  it('legajoToDB mapea camelCase a snake_case incluyendo empresa_id', () => {
    const legajo = { personalId: 'p1', cuil: '20-1-9', cbu: '0000', convenioId: 'c1', categoriaId: 'cat1' }
    expect(legajoToDB(legajo, 'e1')).toEqual({
      empresa_id: 'e1', personal_id: 'p1', cuil: '20-1-9', cbu: '0000',
      convenio_id: 'c1', categoria_id: 'cat1',
    })
  })

  it('familiarFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'f1', empresa_id: 'e1', personal_id: 'p1', vinculo: 'hijo', nombre: 'Juan', cuil: null, fecha_nacimiento: '2015-01-01', doc_path: null }
    expect(familiarFromDB(row)).toEqual({
      id: 'f1', empresaId: 'e1', personalId: 'p1', vinculo: 'hijo',
      nombre: 'Juan', cuil: null, fechaNacimiento: '2015-01-01', docPath: null,
    })
  })

  it('sancionFromDB mapea snake_case a camelCase', () => {
    const row = { id: 's1', empresa_id: 'e1', personal_id: 'p1', tipo: 'suspension', motivo: 'llegadas tarde', fecha: '2026-01-01', dias_suspension: 3, doc_path: null }
    expect(sancionFromDB(row)).toEqual({
      id: 's1', empresaId: 'e1', personalId: 'p1', tipo: 'suspension',
      motivo: 'llegadas tarde', fecha: '2026-01-01', diasSuspension: 3, docPath: null,
    })
  })
})
```

- [ ] **Step 2: Run test para verificar que falla**

Run: `npx vitest run src/store/__tests__/legajoStore.test.js`
Expected: FAIL (módulo `legajoStore.js` no existe)

- [ ] **Step 3: Implementar el store con mappers + acciones CRUD**

```js
// src/store/legajoStore.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Mappers puros (sin red) — testeados por separado del resto del store.
export const legajoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, cuil: r.cuil,
  fechaNacimiento: r.fecha_nacimiento, domicilio: r.domicilio, fechaIngreso: r.fecha_ingreso,
  convenioId: r.convenio_id, categoriaId: r.categoria_id, cbu: r.cbu, banco: r.banco,
  obraSocial: r.obra_social, jornada: r.jornada,
})

export const legajoToDB = (l, empresaId) => ({
  empresa_id: empresaId, personal_id: l.personalId, cuil: l.cuil ?? null,
  fecha_nacimiento: l.fechaNacimiento ?? null, domicilio: l.domicilio ?? null,
  fecha_ingreso: l.fechaIngreso ?? null, convenio_id: l.convenioId ?? null,
  categoria_id: l.categoriaId ?? null, cbu: l.cbu ?? null, banco: l.banco ?? null,
  obra_social: l.obraSocial ?? null, jornada: l.jornada || 'completa',
})

export const familiarFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, vinculo: r.vinculo,
  nombre: r.nombre, cuil: r.cuil, fechaNacimiento: r.fecha_nacimiento, docPath: r.doc_path,
})

export const sancionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, tipo: r.tipo,
  motivo: r.motivo, fecha: r.fecha, diasSuspension: r.dias_suspension, docPath: r.doc_path,
})

export const useLegajoStore = create((set, get) => ({
  legajos: [], familiares: [], sanciones: [], cargando: false, error: null,

  cargarLegajos: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_legajo').select('*').eq('empresa_id', empresaId)
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ legajos: (data || []).map(legajoFromDB), cargando: false })
  },

  guardarLegajo: async (legajo, empresaId) => {
    const row = legajoToDB(legajo, empresaId)
    const query = legajo.id
      ? supabase.from('nom_legajo').update(row).eq('id', legajo.id).select().single()
      : supabase.from('nom_legajo').insert(row).select().single()
    const { data, error } = await query
    if (error) return { ok: false, error: error.message }
    const nuevo = legajoFromDB(data)
    set((s) => ({ legajos: legajo.id ? s.legajos.map((l) => (l.id === nuevo.id ? nuevo : l)) : [...s.legajos, nuevo] }))
    return { ok: true, legajo: nuevo }
  },

  cargarFamiliares: async (personalId) => {
    const { data, error } = await supabase.from('nom_familiares').select('*').eq('personal_id', personalId)
    if (error) { set({ error: error.message }); return }
    set({ familiares: (data || []).map(familiarFromDB) })
  },

  cargarSanciones: async (personalId) => {
    const { data, error } = await supabase.from('nom_sanciones_personal').select('*').eq('personal_id', personalId).order('fecha', { ascending: false })
    if (error) { set({ error: error.message }); return }
    set({ sanciones: (data || []).map(sancionFromDB) })
  },
}))
```

- [ ] **Step 4: Run test para verificar que pasa**

Run: `npx vitest run src/store/__tests__/legajoStore.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/legajoStore.js src/store/__tests__/legajoStore.test.js
git commit -m "feat: legajoStore con mappers testeados y crud de legajo/familiares/sanciones"
```

---

### Task 9: Página Legajos — listado con semáforo de completitud

**Files:**
- Create: `src/components/legajo/SemaforoLegajo.jsx`
- Create: `src/pages/LegajosPage.jsx`
- Test: `src/components/legajo/__tests__/SemaforoLegajo.test.jsx`
- Modify: `src/App.jsx` (reemplazar la ruta placeholder `/legajos`)

**Criterio de "incompleto para liquidar":** falta `cuil`, `cbu`, `convenioId` o `categoriaId` en el legajo (mismo criterio que ya usa `DashboardPage.jsx` de Fase 0 — no duplicar el criterio, extraerlo a una función compartida).

- [ ] **Step 1: Extraer el criterio a una función compartida** (hoy vive inline en `DashboardPage.jsx`):

```js
// src/utils/legajoCompletitud.js
export function legajoIncompleto(legajo) {
  if (!legajo) return true
  return !legajo.cuil || !legajo.cbu || !legajo.convenioId || !legajo.categoriaId
}
```

- [ ] **Step 2: Actualizar `DashboardPage.jsx` para usar la función compartida** (reemplazar el filtro inline):

```js
// src/pages/DashboardPage.jsx — reemplazar el bloque de cálculo de `faltantes`
import { legajoIncompleto } from '../utils/legajoCompletitud'
// ...
const legajoPorPersonal = new Map((legajos || []).map((l) => [l.personal_id, {
  cuil: l.cuil, cbu: l.cbu, convenioId: l.convenio_id, categoriaId: l.categoria_id,
}]))
const faltantes = (personal || []).filter((p) => legajoIncompleto(legajoPorPersonal.get(p.id))).length
```

- [ ] **Step 3: Test que falla para `SemaforoLegajo`**

```jsx
// src/components/legajo/__tests__/SemaforoLegajo.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SemaforoLegajo from '../SemaforoLegajo'

describe('SemaforoLegajo', () => {
  it('muestra badge verde "Completo" cuando el legajo tiene todo', () => {
    render(<SemaforoLegajo legajo={{ cuil: '20-1-9', cbu: '000', convenioId: 'c1', categoriaId: 'cat1' }} />)
    expect(screen.getByText('Completo')).toBeInTheDocument()
  })

  it('muestra badge de alerta "Incompleto" cuando falta un dato', () => {
    render(<SemaforoLegajo legajo={{ cuil: '20-1-9', cbu: null, convenioId: 'c1', categoriaId: 'cat1' }} />)
    expect(screen.getByText('Incompleto')).toBeInTheDocument()
  })

  it('muestra "Incompleto" cuando no hay legajo todavía', () => {
    render(<SemaforoLegajo legajo={null} />)
    expect(screen.getByText('Incompleto')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run test para verificar que falla**

Run: `npx vitest run src/components/legajo/__tests__/SemaforoLegajo.test.jsx`
Expected: FAIL (módulo no existe)

- [ ] **Step 5: Implementar `SemaforoLegajo.jsx`**

```jsx
// src/components/legajo/SemaforoLegajo.jsx
import { legajoIncompleto } from '../../utils/legajoCompletitud'

export default function SemaforoLegajo({ legajo }) {
  const incompleto = legajoIncompleto(legajo)
  return (
    <span className={`badge ${incompleto ? 'badge-warning' : 'badge-success'}`}>
      {incompleto ? 'Incompleto' : 'Completo'}
    </span>
  )
}
```

- [ ] **Step 6: Run test para verificar que pasa**

Run: `npx vitest run src/components/legajo/__tests__/SemaforoLegajo.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 7: Implementar `LegajosPage.jsx`** (listado real, cruza `nom_v_personal` con `nom_legajo`):

```jsx
// src/pages/LegajosPage.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SemaforoLegajo from '../components/legajo/SemaforoLegajo'

export default function LegajosPage() {
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const [{ data: personal, error: e1 }, { data: legajos, error: e2 }] = await Promise.all([
        supabase.from('nom_v_personal').select('id, nombre, dni, puesto, estado').eq('estado', 'activo').order('nombre'),
        supabase.from('nom_legajo').select('personal_id, cuil, cbu, convenio_id, categoria_id'),
      ])
      if (cancelado) return
      if (e1 || e2) { setError((e1 || e2).message); setCargando(false); return }
      const porPersonal = new Map((legajos || []).map((l) => [l.personal_id, {
        cuil: l.cuil, cbu: l.cbu, convenioId: l.convenio_id, categoriaId: l.categoria_id,
      }]))
      setFilas((personal || []).map((p) => ({ ...p, legajo: porPersonal.get(p.id) || null })))
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Legajos</h1>
        <p className="page-subtitle">Personal activo y estado del legajo</p>
      </div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}
      {!error && (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>DNI</th><th>Puesto</th><th>Legajo</th><th></th></tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={5}>Cargando…</td></tr>}
              {!cargando && filas.length === 0 && <tr><td colSpan={5}>No hay personal activo.</td></tr>}
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{f.nombre}</td>
                  <td>{f.dni || '—'}</td>
                  <td>{f.puesto || '—'}</td>
                  <td><SemaforoLegajo legajo={f.legajo} /></td>
                  <td><Link to={`/legajos/${f.id}`} className="btn btn-ghost btn-sm">Ver ficha</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8: Reemplazar la ruta placeholder en `App.jsx`**

```jsx
// src/App.jsx — agregar import y reemplazar la Route existente
import LegajosPage from './pages/LegajosPage'
import FichaLegajoPage from './pages/FichaLegajoPage'
// ...
<Route path="legajos" element={<LegajosPage />} />
<Route path="legajos/:personalId" element={<FichaLegajoPage />} />
```

(`FichaLegajoPage` se crea en el Task 10 — hasta entonces este import rompe el build; hacer los Tasks 9 y 10 en la misma sesión de trabajo, o comentar la línea de la ruta `legajos/:personalId` hasta llegar al Task 10.)

- [ ] **Step 9: Commit**

```bash
git add src/utils/legajoCompletitud.js src/pages/DashboardPage.jsx \
        src/components/legajo/SemaforoLegajo.jsx src/components/legajo/__tests__/SemaforoLegajo.test.jsx \
        src/pages/LegajosPage.jsx
git commit -m "feat: pagina legajos con semaforo de completitud"
```

---

### Task 10: Ficha de legajo (datos, familiares, sanciones, ausencias en lectura)

**Files:**
- Create: `src/pages/FichaLegajoPage.jsx`
- Create: `src/components/legajo/SeccionColapsable.jsx`
- Test: `src/components/legajo/__tests__/SeccionColapsable.test.jsx`

- [ ] **Step 1: Test que falla para `SeccionColapsable`**

```jsx
// src/components/legajo/__tests__/SeccionColapsable.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SeccionColapsable from '../SeccionColapsable'

describe('SeccionColapsable', () => {
  it('arranca expandida por defecto y muestra el contenido', () => {
    render(<SeccionColapsable titulo="Datos"><p>contenido</p></SeccionColapsable>)
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('al hacer click en el título colapsa el contenido', () => {
    render(<SeccionColapsable titulo="Datos"><p>contenido</p></SeccionColapsable>)
    fireEvent.click(screen.getByText('Datos'))
    expect(screen.queryByText('contenido')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test para verificar que falla**

Run: `npx vitest run src/components/legajo/__tests__/SeccionColapsable.test.jsx`
Expected: FAIL (módulo no existe)

- [ ] **Step 3: Implementar `SeccionColapsable.jsx`**

```jsx
// src/components/legajo/SeccionColapsable.jsx
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export default function SeccionColapsable({ titulo, children, defaultAbierta = true }) {
  const [abierta, setAbierta] = useState(defaultAbierta)
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <button
        onClick={() => setAbierta((a) => !a)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-primary)' }}
      >
        <h3 style={{ fontSize: '1rem' }}>{titulo}</h3>
        {abierta ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {abierta && <div style={{ marginTop: '1rem' }}>{children}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run test para verificar que pasa**

Run: `npx vitest run src/components/legajo/__tests__/SeccionColapsable.test.jsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Implementar `FichaLegajoPage.jsx`** (datos + familiares + sanciones vía `legajoStore`, ausencias en lectura directa vía `nom_v_ausencias`):

```jsx
// src/pages/FichaLegajoPage.jsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLegajoStore } from '../store/legajoStore'
import { useAuthStore } from '../store/authStore'
import SeccionColapsable from '../components/legajo/SeccionColapsable'
import SemaforoLegajo from '../components/legajo/SemaforoLegajo'

export default function FichaLegajoPage() {
  const { personalId } = useParams()
  const empresa = useAuthStore((s) => s.empresa)
  const { legajos, familiares, sanciones, cargarLegajos, cargarFamiliares, cargarSanciones } = useLegajoStore()
  const [persona, setPersona] = useState(null)
  const [ausencias, setAusencias] = useState([])

  useEffect(() => {
    if (!empresa?.id) return
    cargarLegajos(empresa.id)
    cargarFamiliares(personalId)
    cargarSanciones(personalId)
    supabase.from('nom_v_personal').select('*').eq('id', personalId).single().then(({ data }) => setPersona(data))
    supabase.from('nom_v_ausencias').select('*').eq('personal_id', personalId).order('fecha_desde', { ascending: false }).then(({ data }) => setAusencias(data || []))
  }, [personalId, empresa?.id])

  const legajo = legajos.find((l) => l.personalId === personalId) || null

  if (!persona) return <div className="page">Cargando…</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{persona.nombre}</h1>
        <p className="page-subtitle">DNI {persona.dni || '—'} · {persona.puesto || '—'}</p>
        <div style={{ marginTop: 8 }}><SemaforoLegajo legajo={legajo} /></div>
      </div>

      <SeccionColapsable titulo="Datos y estado">
        <p>CUIL: {legajo?.cuil || '—'}</p>
        <p>CBU: {legajo?.cbu || '—'}</p>
        <p>Banco: {legajo?.banco || '—'}</p>
        <p>Obra social: {legajo?.obraSocial || '—'}</p>
        <p>Jornada: {legajo?.jornada || '—'}</p>
      </SeccionColapsable>

      <SeccionColapsable titulo="Familiares">
        {familiares.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin familiares cargados.</p>}
        {familiares.map((f) => (
          <p key={f.id}>{f.nombre} — {f.vinculo}{f.fechaNacimiento ? ` (${f.fechaNacimiento})` : ''}</p>
        ))}
      </SeccionColapsable>

      <SeccionColapsable titulo="Sanciones">
        {sanciones.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin sanciones registradas.</p>}
        {sanciones.map((s) => (
          <p key={s.id}>{s.fecha} — {s.tipo}: {s.motivo}{s.diasSuspension ? ` (${s.diasSuspension} días)` : ''}</p>
        ))}
      </SeccionColapsable>

      <SeccionColapsable titulo="Ausencias" defaultAbierta={false}>
        {ausencias.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin ausencias registradas.</p>}
        {ausencias.map((a) => (
          <p key={a.id}>{a.fecha_desde} a {a.fecha_hasta} — {a.tipo} ({a.estado})</p>
        ))}
      </SeccionColapsable>
    </div>
  )
}
```

- [ ] **Step 6: Descomentar/confirmar la ruta `legajos/:personalId`** en `src/App.jsx` (agregada en Task 9, Step 8).

- [ ] **Step 7: Commit**

```bash
git add src/components/legajo/SeccionColapsable.jsx src/components/legajo/__tests__/SeccionColapsable.test.jsx \
        src/pages/FichaLegajoPage.jsx src/App.jsx
git commit -m "feat: ficha de legajo con datos, familiares, sanciones y ausencias en lectura"
```

---

### Task 11: Carga de documentación (reutiliza `documentos_personal`, requiere aprobación)

**Files:**
- Create: `supabase/migrations/0006_tipos_documento_ambito.sql` — **NO aplicar sin que el usuario lo confirme explícitamente**
- Create: `src/components/legajo/DocumentosLegajo.jsx`
- Test: `src/components/legajo/__tests__/DocumentosLegajo.test.jsx`

- [ ] **Step 1: Escribir (sin aplicar) la migración sobre `tipos_documento`**

```sql
-- 0006_tipos_documento_ambito.sql — ÚNICA excepción autorizada por el
-- plan madre para modificar una tabla de Presencio. NO aplicar sin
-- confirmación explícita del usuario (Recursio_Plan_Ejecucion_Sonnet5.md,
-- instrucción 7 y Fase 1 header de este plan).
ALTER TABLE tipos_documento ADD COLUMN IF NOT EXISTS ambito TEXT DEFAULT 'general';
```

- [ ] **Step 2: Pedirle al usuario que confirme y aplique esta migración él mismo** en el SQL Editor del proyecto Supabase de dev, antes de seguir con el Step 3. No continuar sin esa confirmación explícita.

- [ ] **Step 3: Test que falla para `DocumentosLegajo`** (mock de `supabase.from`):

```jsx
// src/components/legajo/__tests__/DocumentosLegajo.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import DocumentosLegajo from '../DocumentosLegajo'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'd1', nombre: 'DNI', fecha_vencimiento: '2099-01-01', archivo_url: 'x' }],
        error: null,
      }),
    })),
  },
}))

describe('DocumentosLegajo', () => {
  it('lista los documentos del personal y su badge de vigencia', async () => {
    render(<DocumentosLegajo personalId="p1" />)
    await waitFor(() => expect(screen.getByText('DNI')).toBeInTheDocument())
    expect(screen.getByText('Vigente')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run test para verificar que falla**

Run: `npx vitest run src/components/legajo/__tests__/DocumentosLegajo.test.jsx`
Expected: FAIL (módulo no existe)

- [ ] **Step 5: Implementar `DocumentosLegajo.jsx`** (lee `documentos_personal`, badge por vencimiento; la carga/upload reutiliza el mismo bucket privado de Presencio, sin duplicar lógica de subida):

```jsx
// src/components/legajo/DocumentosLegajo.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

function estadoVencimiento(fechaVencimiento) {
  if (!fechaVencimiento) return { label: 'Sin vencimiento', clase: 'badge-neutral' }
  const dias = (new Date(fechaVencimiento) - new Date()) / (1000 * 60 * 60 * 24)
  if (dias < 0) return { label: 'Vencido', clase: 'badge-danger' }
  if (dias <= 30) return { label: 'Por vencer', clase: 'badge-warning' }
  return { label: 'Vigente', clase: 'badge-success' }
}

export default function DocumentosLegajo({ personalId }) {
  const [documentos, setDocumentos] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let cancelado = false
    supabase.from('documentos_personal').select('*').eq('personal_id', personalId).order('fecha_vencimiento')
      .then(({ data }) => { if (!cancelado) { setDocumentos(data || []); setCargando(false) } })
    return () => { cancelado = true }
  }, [personalId])

  if (cargando) return <p style={{ color: 'var(--text-secondary)' }}>Cargando documentos…</p>
  if (documentos.length === 0) return <p style={{ color: 'var(--text-secondary)' }}>Sin documentos cargados.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {documentos.map((d) => {
        const est = estadoVencimiento(d.fecha_vencimiento)
        return (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{d.nombre}</span>
            <span className={`badge ${est.clase}`}>{est.label}</span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: Run test para verificar que pasa**

Run: `npx vitest run src/components/legajo/__tests__/DocumentosLegajo.test.jsx`
Expected: PASS (1 test)

- [ ] **Step 7: Embeber `DocumentosLegajo` en `FichaLegajoPage.jsx`** dentro de una nueva `SeccionColapsable titulo="Documentación"`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0006_tipos_documento_ambito.sql \
        src/components/legajo/DocumentosLegajo.jsx src/components/legajo/__tests__/DocumentosLegajo.test.jsx \
        src/pages/FichaLegajoPage.jsx
git commit -m "feat: seccion de documentacion en la ficha de legajo"
```

---

### Task 12: Export legajo a PDF

**Files:**
- Create: `src/utils/legajoPdf.js`
- Test: `src/utils/__tests__/legajoPdf.test.js`
- Modify: `src/pages/FichaLegajoPage.jsx` (botón "Exportar PDF")

- [ ] **Step 1: Test que falla** (verifica que el generador arma un documento con las 5 secciones, sin abrir el diálogo de descarga del navegador — se testea el objeto `jsPDF` devuelto, no el archivo):

```js
// src/utils/__tests__/legajoPdf.test.js
import { describe, it, expect } from 'vitest'
import { generarLegajoPdf } from '../legajoPdf'

const datosFake = {
  persona: { nombre: 'Ana Test', dni: '30111222', puesto: 'Oficial' },
  legajo: { cuil: '27-30111222-4', cbu: '000', banco: 'BNA', obraSocial: 'OSDE', jornada: 'completa' },
  familiares: [{ nombre: 'Juan Test', vinculo: 'hijo', fechaNacimiento: '2015-01-01' }],
  sanciones: [{ fecha: '2026-01-01', tipo: 'llamado_atencion', motivo: 'test', diasSuspension: null }],
  ausencias: [{ fecha_desde: '2026-02-01', fecha_hasta: '2026-02-05', tipo: 'vacaciones', estado: 'aprobada' }],
}

describe('generarLegajoPdf', () => {
  it('genera un documento jsPDF con contenido en al menos 1 página', () => {
    const doc = generarLegajoPdf(datosFake)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })

  it('incluye el nombre de la persona en el texto del documento', () => {
    const doc = generarLegajoPdf(datosFake)
    const texto = doc.internal.pages.map((p) => (Array.isArray(p) ? p.join(' ') : '')).join(' ')
    expect(texto).toContain('Ana Test')
  })
})
```

- [ ] **Step 2: Run test para verificar que falla**

Run: `npx vitest run src/utils/__tests__/legajoPdf.test.js`
Expected: FAIL (módulo no existe)

- [ ] **Step 3: Implementar `legajoPdf.js`** (las 5 secciones del diseño: datos, familiares, sanciones, documentación —resumen textual, no se re-descargan los archivos— y ausencias):

```js
// src/utils/legajoPdf.js
import { jsPDF } from 'jspdf'

export function generarLegajoPdf({ persona, legajo, familiares = [], sanciones = [], ausencias = [], documentos = [] }) {
  const doc = new jsPDF()
  let y = 15

  const titulo = (t) => { doc.setFontSize(14); doc.text(t, 14, y); y += 8; doc.setFontSize(10) }
  const linea = (t) => { doc.text(t, 14, y); y += 6 }
  const salto = () => { y += 4 }

  titulo(`Legajo — ${persona.nombre}`)
  linea(`DNI: ${persona.dni || '—'}   Puesto: ${persona.puesto || '—'}`)
  salto()

  titulo('1. Datos y estado')
  linea(`CUIL: ${legajo?.cuil || '—'}`)
  linea(`CBU: ${legajo?.cbu || '—'}   Banco: ${legajo?.banco || '—'}`)
  linea(`Obra social: ${legajo?.obraSocial || '—'}   Jornada: ${legajo?.jornada || '—'}`)
  salto()

  titulo('2. Documentación')
  if (documentos.length === 0) linea('Sin documentos cargados.')
  documentos.forEach((d) => linea(`${d.nombre} — vence ${d.fecha_vencimiento || 'sin vencimiento'}`))
  salto()

  titulo('3. Licencias y vacaciones')
  if (ausencias.length === 0) linea('Sin ausencias registradas.')
  ausencias.forEach((a) => linea(`${a.fecha_desde} a ${a.fecha_hasta} — ${a.tipo} (${a.estado})`))
  salto()

  titulo('4. Sanciones')
  if (sanciones.length === 0) linea('Sin sanciones registradas.')
  sanciones.forEach((s) => linea(`${s.fecha} — ${s.tipo}: ${s.motivo}`))
  salto()

  titulo('5. Familiares')
  if (familiares.length === 0) linea('Sin familiares cargados.')
  familiares.forEach((f) => linea(`${f.nombre} — ${f.vinculo}`))

  return doc
}
```

- [ ] **Step 4: Run test para verificar que pasa**

Run: `npx vitest run src/utils/__tests__/legajoPdf.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Agregar el botón "Exportar legajo (PDF)" en `FichaLegajoPage.jsx`**

```jsx
// src/pages/FichaLegajoPage.jsx — agregar import y botón en el header
import { generarLegajoPdf } from '../utils/legajoPdf'
// ...
const handleExportar = () => {
  const doc = generarLegajoPdf({ persona, legajo, familiares, sanciones, ausencias })
  doc.save(`legajo-${persona.dni || persona.id}.pdf`)
}
// en el JSX del page-header:
<button onClick={handleExportar} className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>Exportar legajo (PDF)</button>
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/legajoPdf.js src/utils/__tests__/legajoPdf.test.js src/pages/FichaLegajoPage.jsx
git commit -m "feat: exportar legajo completo a pdf"
```

---

## CHECKPOINT FASE 1

Legajo completo de un empleado real de Asset cargado de punta a punta (datos, al menos 1 familiar, al menos 1 sanción de prueba) y exportado a PDF. Frenar acá y pedir revisión del usuario antes de escribir el detalle de Fase 2 (motor de liquidación).
