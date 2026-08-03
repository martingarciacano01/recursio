# Aprobaciones con detalle por recibo y rechazo individual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En la pantalla de Aprobaciones, mostrar el detalle de cada recibo del período (bruto, descuentos, neto, horas) y permitir aprobar/rechazar el pago de cada persona individualmente (con motivo obligatorio en rechazo) o en lote, sin afectar el resto del período.

**Architecture:** Nueva columna de estado (`estado_revision`) en `nom_liquidaciones` + RPC `revisar_liquidacion` (mismo patrón `SECURITY DEFINER` que `avanzar_flujo`, migración 0015) para no exponer `UPDATE` directo. El store `aprobacionesStore.js` trae los recibos de cada período junto con las instancias y calcula agregados en cliente. `AprobacionesPage.jsx` agrega una tabla de recibos por período con selección y acciones. El flujo de instancia de período (`nom_flujo_instancias`/`avanzar_flujo`) no se modifica.

**Tech Stack:** React + Zustand + Supabase (Postgres/RLS/RPC) + Vitest + React Testing Library. Sin dependencias nuevas.

**Constraint de workflow:** este agente no puede correr `npm`/`vitest` de forma confiable en la carpeta real del usuario, ni aplicar migraciones SQL contra la base real. Cada tarea que requiera correr tests o aplicar SQL termina con instrucciones exactas para que el usuario las corra en su terminal / Supabase dashboard y pegue el resultado.

---

## File Structure

- Create: `supabase/migrations/0054_revision_liquidaciones.sql` — columnas + RPC `revisar_liquidacion`.
- Modify: `src/store/aprobacionesStore.js` — mapper de recibo, fetch de recibos + personal, agregados, acción `revisarLiquidacion`.
- Modify: `src/store/__tests__/aprobacionesStore.test.js` — tests nuevos.
- Modify: `src/pages/AprobacionesPage.jsx` — tabla de recibos, selección, acciones, paginación, recarga al foco, link a detalle.
- Create: `src/pages/__tests__/AprobacionesPage.test.jsx` — tests de la página (no existe hoy).
- Modify: `src/pages/LiquidacionPage.jsx` — leer `?periodo=` de la URL para preseleccionar período.

---

### Task 1: Migración SQL — columnas de revisión + RPC `revisar_liquidacion`

**Files:**
- Create: `supabase/migrations/0054_revision_liquidaciones.sql`

- [ ] **Step 1: Escribir la migración completa**

```sql
-- 0054_revision_liquidaciones.sql — Fase 4, Task 4.1: revisión de pago
-- por recibo individual, independiente del flujo de instancia de período
-- (nom_flujo_instancias/avanzar_flujo, migración 0015, que NO se toca).
--
-- Decisión (spec 2026-08-03-aprobaciones-detalle-rechazo-individual):
-- rechazar el pago de UNA persona no debe frenar el resto del período.
-- estado_revision vive en nom_liquidaciones, es el estado actual (no hay
-- tabla de auditoría histórica aparte — YAGNI, ver spec).
ALTER TABLE nom_liquidaciones
  ADD COLUMN IF NOT EXISTS estado_revision TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado_revision IN ('pendiente','aprobado','rechazado')),
  ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT,
  ADD COLUMN IF NOT EXISTS revisado_por UUID,
  ADD COLUMN IF NOT EXISTS revisado_en TIMESTAMPTZ;

-- revisar_liquidacion(liquidacion_id, accion, comentario): única vía para
-- cambiar estado_revision. No se otorga UPDATE directo de estas columnas
-- a `authenticated` — mismo motivo que avanzar_flujo: si el cliente
-- pudiera hacer UPDATE directo, se saltearía la validación de rol+paso de
-- acá abajo.
CREATE OR REPLACE FUNCTION revisar_liquidacion(p_liquidacion_id UUID, p_accion TEXT, p_comentario TEXT DEFAULT NULL)
RETURNS TABLE(estado_revision TEXT, motivo_rechazo TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_liquidacion   nom_liquidaciones%ROWTYPE;
  v_empresa       UUID;
  v_instancia     nom_flujo_instancias%ROWTYPE;
  v_paso_actual   nom_flujo_pasos%ROWTYPE;
  v_autorizado    BOOLEAN := false;
BEGIN
  IF p_accion NOT IN ('aprobado', 'rechazado') THEN
    RAISE EXCEPTION 'accion invalida: %', p_accion;
  END IF;

  IF p_accion = 'rechazado' AND (p_comentario IS NULL OR btrim(p_comentario) = '') THEN
    RAISE EXCEPTION 'motivo de rechazo obligatorio';
  END IF;

  SELECT * INTO v_liquidacion FROM nom_liquidaciones WHERE id = p_liquidacion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'liquidacion no encontrada';
  END IF;
  v_empresa := v_liquidacion.empresa_id;

  SELECT * INTO v_instancia FROM nom_flujo_instancias WHERE periodo_id = v_liquidacion.periodo_id;

  IF FOUND AND v_instancia.paso_actual_id IS NOT NULL THEN
    SELECT * INTO v_paso_actual FROM nom_flujo_pasos WHERE id = v_instancia.paso_actual_id;
  END IF;

  -- Autorización: mismo criterio que avanzar_flujo. Si el período nunca
  -- entró a un circuito (sin instancia o sin paso actual), solo
  -- dueño/admin/superadmin puede revisar recibos individuales.
  IF is_superadmin() THEN
    v_autorizado := true;
  ELSIF v_empresa = auth_empresa_id() AND (v_paso_actual.rol_requerido IS NULL OR v_paso_actual.rol_requerido IN ('admin','revisor_interno')) THEN
    v_autorizado := true;
  ELSIF v_paso_actual.rol_requerido IS NOT NULL AND EXISTS (
    SELECT 1 FROM nom_usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid() AND ue.empresa_id = v_empresa AND ue.rol = v_paso_actual.rol_requerido
  ) THEN
    v_autorizado := true;
  END IF;

  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'no autorizado para revisar esta liquidacion';
  END IF;

  UPDATE nom_liquidaciones
    SET estado_revision = p_accion, motivo_rechazo = p_comentario, revisado_por = auth.uid(), revisado_en = now()
    WHERE id = p_liquidacion_id;

  RETURN QUERY SELECT nl.estado_revision, nl.motivo_rechazo FROM nom_liquidaciones nl WHERE nl.id = p_liquidacion_id;
END $$;
REVOKE ALL ON FUNCTION revisar_liquidacion(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION revisar_liquidacion(UUID, TEXT, TEXT) TO authenticated;
```

- [ ] **Step 2: Pedirle al usuario que la aplique**

Este agente no tiene acceso a la base real. Avisar al usuario:

> "Migración lista en `supabase/migrations/0054_revision_liquidaciones.sql`. Aplicala con `supabase db push` (o pegando el contenido en el SQL Editor del dashboard de Supabase) y confirmame cuando esté corrida antes de seguir con el store."

No continuar con Task 2 hasta tener esa confirmación (el store y los tests de integración manual dependen de que las columnas y el RPC existan).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0054_revision_liquidaciones.sql
git commit -m "feat(db): estado de revision por recibo + rpc revisar_liquidacion"
```

---

### Task 2: Store — mapper de recibo y fetch de recibos por período

**Files:**
- Modify: `src/store/aprobacionesStore.js`
- Modify: `src/store/__tests__/aprobacionesStore.test.js`

- [ ] **Step 1: Escribir el test del mapper `reciboFromDB` (falla: no existe todavía)**

Agregar al final de `src/store/__tests__/aprobacionesStore.test.js`:

```javascript
describe('reciboFromDB', () => {
  it('mapea snake_case de un recibo (nom_liquidaciones)', async () => {
    const { reciboFromDB } = await import('../aprobacionesStore')
    const row = {
      id: 'l1', periodo_id: 'p1', personal_id: 'per1',
      bruto: 100000, total_aportes: 17000, neto: 83000,
      detalle_horas: { horasNormales: 176 },
      estado_revision: 'pendiente', motivo_rechazo: null,
    }
    expect(reciboFromDB(row)).toEqual({
      id: 'l1', periodoId: 'p1', personalId: 'per1',
      bruto: 100000, totalAportes: 17000, neto: 83000,
      detalleHoras: { horasNormales: 176 },
      estadoRevision: 'pendiente', motivoRechazo: null,
    })
  })

  it('bruto/totalAportes/neto en 0 si vienen null (fila inesperada)', async () => {
    const { reciboFromDB } = await import('../aprobacionesStore')
    const r = reciboFromDB({ id: 'l2', periodo_id: 'p1', personal_id: 'per2', bruto: null, total_aportes: null, neto: null, detalle_horas: null, estado_revision: 'pendiente', motivo_rechazo: null })
    expect(r.bruto).toBe(0)
    expect(r.totalAportes).toBe(0)
    expect(r.neto).toBe(0)
    expect(r.detalleHoras).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Pedirle al usuario que corra, en su terminal, dentro de la carpeta del proyecto:

```bash
npx vitest run src/store/__tests__/aprobacionesStore.test.js -t "reciboFromDB"
```

Expected: FAIL (`reciboFromDB` no exportado / undefined).

- [ ] **Step 3: Implementar `reciboFromDB` en el store**

En `src/store/aprobacionesStore.js`, después de `instanciaFromDB`:

```javascript
// reciboFromDB (Task 4.1): un recibo individual (fila de nom_liquidaciones)
// dentro de un período en revisión. estado_revision/motivo_rechazo son
// independientes del estado del período (nom_flujo_instancias) — ver
// spec docs/superpowers/specs/2026-08-03-aprobaciones-detalle-rechazo-individual-design.md.
export const reciboFromDB = (r) => ({
  id: r.id, periodoId: r.periodo_id, personalId: r.personal_id,
  bruto: r.bruto ?? 0, totalAportes: r.total_aportes ?? 0, neto: r.neto ?? 0,
  detalleHoras: r.detalle_horas || null,
  estadoRevision: r.estado_revision, motivoRechazo: r.motivo_rechazo ?? null,
})
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

```bash
npx vitest run src/store/__tests__/aprobacionesStore.test.js -t "reciboFromDB"
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/aprobacionesStore.js src/store/__tests__/aprobacionesStore.test.js
git commit -m "feat(store): mapper reciboFromDB para detalle de aprobaciones"
```

---

### Task 3: Store — `cargarInstancias` trae recibos + nombres y calcula agregados

**Files:**
- Modify: `src/store/aprobacionesStore.js`
- Modify: `src/store/__tests__/aprobacionesStore.test.js`

- [ ] **Step 1: Escribir el test (falla: `recibosPorPeriodo`/`agregadosPorPeriodo` no existen)**

Agregar a `src/store/__tests__/aprobacionesStore.test.js`:

```javascript
describe('cargarInstancias — recibos y agregados por período (Task 4.1)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { useAprobacionesStore } = await import('../aprobacionesStore')
    useAprobacionesStore.setState({ instancias: [], recibosPorPeriodo: {}, agregadosPorPeriodo: {}, personalPorId: {}, cargando: false, error: null })
  })

  it('agrupa recibos por periodoId y calcula agregados (sum bruto/aportes/neto, count)', async () => {
    const { supabase } = await import('../../lib/supabase')
    const { useAprobacionesStore } = await import('../aprobacionesStore')

    const instanciasRow = [{ id: 'i1', empresa_id: 'e1', periodo_id: 'p1', flujo_id: 'f1', paso_actual_id: 'pa1', estado: 'en_progreso' }]
    const recibosRow = [
      { id: 'l1', periodo_id: 'p1', personal_id: 'per1', bruto: 100000, total_aportes: 17000, neto: 83000, detalle_horas: null, estado_revision: 'pendiente', motivo_rechazo: null },
      { id: 'l2', periodo_id: 'p1', personal_id: 'per2', bruto: 50000, total_aportes: 8500, neto: 41500, detalle_horas: null, estado_revision: 'pendiente', motivo_rechazo: null },
    ]
    const personalRow = [{ id: 'per1', nombre: 'Juan Pérez' }, { id: 'per2', nombre: 'Ana Gómez' }]

    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_flujo_instancias') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), then: (resolve) => resolve({ data: instanciasRow, error: null }) }
      }
      if (tabla === 'nom_liquidaciones') {
        return { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), then: (resolve) => resolve({ data: recibosRow, error: null }) }
      }
      if (tabla === 'nom_v_personal') {
        return { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), then: (resolve) => resolve({ data: personalRow, error: null }) }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    await useAprobacionesStore.getState().cargarInstancias('e1')

    const { recibosPorPeriodo, agregadosPorPeriodo, personalPorId } = useAprobacionesStore.getState()
    expect(recibosPorPeriodo.p1).toHaveLength(2)
    expect(agregadosPorPeriodo.p1).toEqual({ bruto: 150000, totalAportes: 25500, neto: 124500, cantidad: 2 })
    expect(personalPorId.per1).toBe('Juan Pérez')
  })

  it('período sin recibos deja agregados en 0', async () => {
    const { supabase } = await import('../../lib/supabase')
    const { useAprobacionesStore } = await import('../aprobacionesStore')
    const instanciasRow = [{ id: 'i2', empresa_id: 'e1', periodo_id: 'p2', flujo_id: 'f1', paso_actual_id: 'pa1', estado: 'en_progreso' }]

    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_flujo_instancias') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), then: (resolve) => resolve({ data: instanciasRow, error: null }) }
      }
      if (tabla === 'nom_liquidaciones') {
        return { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), then: (resolve) => resolve({ data: [], error: null }) }
      }
      if (tabla === 'nom_v_personal') {
        return { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), then: (resolve) => resolve({ data: [], error: null }) }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    })

    await useAprobacionesStore.getState().cargarInstancias('e1')
    expect(useAprobacionesStore.getState().agregadosPorPeriodo.p2).toEqual({ bruto: 0, totalAportes: 0, neto: 0, cantidad: 0 })
  })
})
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run src/store/__tests__/aprobacionesStore.test.js -t "recibos y agregados"
```

Expected: FAIL (`recibosPorPeriodo`/`agregadosPorPeriodo` quedan `undefined` en el estado).

- [ ] **Step 3: Implementar en el store**

Reemplazar por completo `src/store/aprobacionesStore.js`:

```javascript
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const instanciaFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, periodoId: r.periodo_id, flujoId: r.flujo_id,
  pasoActualId: r.paso_actual_id, estado: r.estado,
  periodo: r.nom_periodos ? { id: r.nom_periodos.id, tipo: r.nom_periodos.tipo, fechaDesde: r.nom_periodos.fecha_desde, fechaHasta: r.nom_periodos.fecha_hasta } : null,
  pasoActual: r.paso_actual ? { id: r.paso_actual.id, nombre: r.paso_actual.nombre, orden: r.paso_actual.orden, rolRequerido: r.paso_actual.rol_requerido } : null,
})

// reciboFromDB (Task 4.1): un recibo individual (fila de nom_liquidaciones)
// dentro de un período en revisión. estado_revision/motivo_rechazo son
// independientes del estado del período (nom_flujo_instancias) — ver
// spec docs/superpowers/specs/2026-08-03-aprobaciones-detalle-rechazo-individual-design.md.
export const reciboFromDB = (r) => ({
  id: r.id, periodoId: r.periodo_id, personalId: r.personal_id,
  bruto: r.bruto ?? 0, totalAportes: r.total_aportes ?? 0, neto: r.neto ?? 0,
  detalleHoras: r.detalle_horas || null,
  estadoRevision: r.estado_revision, motivoRechazo: r.motivo_rechazo ?? null,
})

const agregadosVacios = { bruto: 0, totalAportes: 0, neto: 0, cantidad: 0 }

// No filtra por empresa_id: RLS ya devuelve solo las instancias visibles
// para el usuario (dueño/admin de su empresa, o revisor_externo/
// aprobador_pagos con acceso puente a varias empresas — nom_usuarios_empresas).
export const useAprobacionesStore = create((set) => ({
  instancias: [], recibosPorPeriodo: {}, agregadosPorPeriodo: {}, personalPorId: {},
  cargando: false, error: null,

  // empresaId (Task 3.4, M9): sin este filtro, un usuario con acceso puente
  // a varias empresas (revisor_externo/aprobador_pagos vía
  // nom_usuarios_empresas) veía en una sola lista las instancias
  // pendientes de TODAS las empresas a las que tiene acceso, mezcladas —
  // acá filtramos por la empresa activa en pantalla (empresa fija o
  // empresaVista si es Superadmin operando "como" otra empresa).
  cargarInstancias: async (empresaId) => {
    if (!empresaId) { set({ instancias: [], recibosPorPeriodo: {}, agregadosPorPeriodo: {}, personalPorId: {} }); return }
    set({ cargando: true, error: null })
    try {
      const { data, error } = await supabase.from('nom_flujo_instancias')
        .select('*, nom_periodos(id, tipo, fecha_desde, fecha_hasta), paso_actual:nom_flujo_pasos!nom_flujo_instancias_paso_actual_id_fkey(id, nombre, orden, rol_requerido)')
        .eq('estado', 'en_progreso')
        .eq('empresa_id', empresaId)
      if (error) { set({ error: error.message, cargando: false }); return }
      const instancias = (data || []).map(instanciaFromDB)

      // Task 4.1: además de las instancias, traer el detalle de recibos de
      // cada período (bruto/descuentos/neto/horas) para mostrar y para
      // poder revisar/rechazar por persona sin frenar el resto del
      // período — ver spec 2026-08-03. Agregados (sum/count) se calculan
      // acá en JS: son PyMEs, un período tiene a lo sumo unos cientos de
      // legajos, no se justifica un RPC de agregación (más superficie,
      // sin ganancia real de performance ni seguridad — RLS ya protege
      // esta misma query).
      const periodoIds = instancias.map((i) => i.periodoId)
      let recibosPorPeriodo = {}
      let agregadosPorPeriodo = {}
      let personalPorId = {}
      if (periodoIds.length > 0) {
        const { data: recibosData, error: errRecibos } = await supabase.from('nom_liquidaciones')
          .select('id, periodo_id, personal_id, bruto, total_aportes, neto, detalle_horas, estado_revision, motivo_rechazo')
          .in('periodo_id', periodoIds)
        if (errRecibos) { set({ error: errRecibos.message, cargando: false }); return }
        const recibos = (recibosData || []).map(reciboFromDB)

        for (const periodoId of periodoIds) { recibosPorPeriodo[periodoId] = []; agregadosPorPeriodo[periodoId] = { ...agregadosVacios } }
        for (const r of recibos) {
          recibosPorPeriodo[r.periodoId].push(r)
          const ag = agregadosPorPeriodo[r.periodoId]
          ag.bruto += r.bruto; ag.totalAportes += r.totalAportes; ag.neto += r.neto; ag.cantidad += 1
        }

        const personalIds = [...new Set(recibos.map((r) => r.personalId))]
        if (personalIds.length > 0) {
          const { data: personalData } = await supabase.from('nom_v_personal').select('id, nombre').in('id', personalIds)
          for (const p of (personalData || [])) personalPorId[p.id] = p.nombre
        }
      }

      set({ instancias, recibosPorPeriodo, agregadosPorPeriodo, personalPorId, cargando: false })
    } catch {
      // Caída de red (Task 3.3).
      set({ error: 'no se pudo contactar el servidor', cargando: false })
    }
  },

  actuar: async (instanciaId, accion, comentario) => {
    const { error } = await supabase.rpc('avanzar_flujo', {
      p_instancia_id: instanciaId, p_accion: accion, p_comentario: comentario || null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },

  // revisarLiquidacion (Task 4.1): aprueba/rechaza el pago de UN recibo
  // sin tocar el resto del período. Sin refetch automático a propósito
  // (igual que `actuar`): la página decide cuándo recargar, para poder
  // encadenar varias revisiones en lote sin refrescar entre medio.
  revisarLiquidacion: async (liquidacionId, accion, comentario) => {
    const { error } = await supabase.rpc('revisar_liquidacion', {
      p_liquidacion_id: liquidacionId, p_accion: accion, p_comentario: comentario || null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

```bash
npx vitest run src/store/__tests__/aprobacionesStore.test.js
```

Expected: todos PASS (incluye los tests viejos del filtro por empresa, que no deberían romperse).

- [ ] **Step 5: Commit**

```bash
git add src/store/aprobacionesStore.js src/store/__tests__/aprobacionesStore.test.js
git commit -m "feat(store): recibos por periodo, agregados y revisarLiquidacion"
```

---

### Task 4: Store — acción `revisarLiquidacion`, tests de éxito/error

**Files:**
- Modify: `src/store/__tests__/aprobacionesStore.test.js`

(La implementación de `revisarLiquidacion` ya se agregó en la Task 3; acá solo se testea aparte porque es una acción independiente de `cargarInstancias`.)

- [ ] **Step 1: Escribir los tests (fallan si `revisarLiquidacion` no llama al RPC esperado)**

```javascript
describe('revisarLiquidacion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('llama al RPC revisar_liquidacion con los params correctos y devuelve ok', async () => {
    const { supabase } = await import('../../lib/supabase')
    const { useAprobacionesStore } = await import('../aprobacionesStore')
    supabase.rpc.mockResolvedValue({ error: null })

    const r = await useAprobacionesStore.getState().revisarLiquidacion('l1', 'rechazado', 'legajo con error')
    expect(supabase.rpc).toHaveBeenCalledWith('revisar_liquidacion', { p_liquidacion_id: 'l1', p_accion: 'rechazado', p_comentario: 'legajo con error' })
    expect(r).toEqual({ ok: true })
  })

  it('devuelve el error del RPC (por ej. motivo obligatorio) sin tirar', async () => {
    const { supabase } = await import('../../lib/supabase')
    const { useAprobacionesStore } = await import('../aprobacionesStore')
    supabase.rpc.mockResolvedValue({ error: { message: 'motivo de rechazo obligatorio' } })

    const r = await useAprobacionesStore.getState().revisarLiquidacion('l1', 'rechazado', null)
    expect(r).toEqual({ ok: false, error: 'motivo de rechazo obligatorio' })
  })
})
```

- [ ] **Step 2: Correr y confirmar (ya debería pasar, porque la implementación viene de la Task 3)**

```bash
npx vitest run src/store/__tests__/aprobacionesStore.test.js -t "revisarLiquidacion"
```

Expected: PASS. Si falla, revisar que `supabase.rpc` esté mockeado como `vi.fn()` en el bloque `vi.mock` del tope del archivo (ya lo está, línea 11 del archivo original).

- [ ] **Step 3: Commit**

```bash
git add src/store/__tests__/aprobacionesStore.test.js
git commit -m "test(store): revisarLiquidacion exito y error de rpc"
```

---

### Task 5: Página — tabla de recibos por período con selección y acciones

**Files:**
- Modify: `src/pages/AprobacionesPage.jsx`
- Create: `src/pages/__tests__/AprobacionesPage.test.jsx`

- [ ] **Step 1: Escribir los tests de la página (fallan: el componente todavía no renderiza la tabla)**

Crear `src/pages/__tests__/AprobacionesPage.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AprobacionesPage from '../AprobacionesPage'
import { useAprobacionesStore } from '../../store/aprobacionesStore'
import { useAuthStore } from '../../store/authStore'

vi.mock('../../store/aprobacionesStore')
vi.mock('../../store/authStore')

function setupStore({ revisarLiquidacion = vi.fn().mockResolvedValue({ ok: true }) } = {}) {
  const instancias = [{ id: 'i1', periodoId: 'p1', estado: 'en_progreso', periodo: { tipo: 'mensual', fechaDesde: '2026-07-01', fechaHasta: '2026-07-31' }, pasoActual: { orden: 1, nombre: 'Revisión' } }]
  const recibosPorPeriodo = { p1: [
    { id: 'l1', periodoId: 'p1', personalId: 'per1', bruto: 100000, totalAportes: 17000, neto: 83000, detalleHoras: { horasNormales: 176 }, estadoRevision: 'pendiente', motivoRechazo: null },
    { id: 'l2', periodoId: 'p1', personalId: 'per2', bruto: 50000, totalAportes: 8500, neto: 41500, detalleHoras: { horasNormales: 88 }, estadoRevision: 'pendiente', motivoRechazo: null },
  ] }
  const agregadosPorPeriodo = { p1: { bruto: 150000, totalAportes: 25500, neto: 124500, cantidad: 2 } }
  const personalPorId = { per1: 'Juan Pérez', per2: 'Ana Gómez' }
  useAprobacionesStore.mockReturnValue({
    instancias, recibosPorPeriodo, agregadosPorPeriodo, personalPorId,
    cargando: false, error: null,
    cargarInstancias: vi.fn(), actuar: vi.fn().mockResolvedValue({ ok: true }), revisarLiquidacion,
  })
  useAuthStore.mockImplementation((sel) => sel({ empresa: { id: 'e1' }, empresaVista: null }))
  return { revisarLiquidacion }
}

describe('AprobacionesPage — detalle de recibos y rechazo individual', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra el detalle de cada recibo (bruto, descuentos, neto, horas)', () => {
    setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Ana Gómez')).toBeInTheDocument()
    expect(screen.getAllByText(/100.000,00/).length).toBeGreaterThan(0)
  })

  it('el botón Rechazar de una fila individual está deshabilitado sin motivo', () => {
    setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    const botonesRechazar = screen.getAllByRole('button', { name: 'Rechazar' })
    expect(botonesRechazar[0]).toBeDisabled()
  })

  it('rechazo individual llama a revisarLiquidacion con el motivo cargado', async () => {
    const { revisarLiquidacion } = setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    const [textareaMotivo] = screen.getAllByPlaceholderText('motivo del rechazo')
    fireEvent.change(textareaMotivo, { target: { value: 'legajo incompleto' } })
    const [botonRechazar] = screen.getAllByRole('button', { name: 'Rechazar' })
    fireEvent.click(botonRechazar)
    expect(revisarLiquidacion).toHaveBeenCalledWith('l1', 'rechazado', 'legajo incompleto')
  })

  it('aprobar seleccionados llama a revisarLiquidacion para cada recibo tildado', async () => {
    const { revisarLiquidacion } = setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    const checkboxes = screen.getAllByRole('checkbox', { name: /seleccionar recibo/i })
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar seleccionados' }))
    expect(revisarLiquidacion).toHaveBeenCalledWith('l1', 'aprobado', null)
    expect(revisarLiquidacion).toHaveBeenCalledWith('l2', 'aprobado', null)
  })

  it('el link Ver detalle apunta a /liquidacion?periodo=<id>', () => {
    setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Ver detalle' })).toHaveAttribute('href', '/liquidacion?periodo=p1')
  })
})
```

- [ ] **Step 2: Correr y confirmar que falla**

```bash
npx vitest run src/pages/__tests__/AprobacionesPage.test.jsx
```

Expected: FAIL (no existen los textos/roles todavía, el componente actual no tiene tabla de recibos).

- [ ] **Step 3: Reescribir `AprobacionesPage.jsx`**

Reemplazar por completo `src/pages/AprobacionesPage.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAprobacionesStore } from '../store/aprobacionesStore'
import { useAuthStore } from '../store/authStore'
import { usePaginado } from '../hooks/usePaginado'

const fmt = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtHs = (detalleHoras) => {
  if (!detalleHoras) return '—'
  const total = Object.values(detalleHoras).reduce((acc, v) => acc + (Number(v) || 0), 0)
  return `${total.toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`
}

const TAMANO_PAGINA = 10

export default function AprobacionesPage() {
  const { instancias, recibosPorPeriodo, agregadosPorPeriodo, personalPorId, cargando, error, cargarInstancias, actuar, revisarLiquidacion } = useAprobacionesStore()
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const empresaActiva = empresa || empresaVista
  const [comentarios, setComentarios] = useState({})
  const [seleccion, setSeleccion] = useState([])
  const [seleccionPorPeriodo, setSeleccionPorPeriodo] = useState({})
  const [motivoPorRecibo, setMotivoPorRecibo] = useState({})
  const [errorAccion, setErrorAccion] = useState(null)
  const [procesando, setProcesando] = useState(false)
  const { pagina, rango, siguientePagina, reset, hayMasPaginas } = usePaginado(TAMANO_PAGINA)

  useEffect(() => { if (empresaActiva?.id) cargarInstancias(empresaActiva.id) }, [empresaActiva?.id])
  useEffect(() => { reset() }, [empresaActiva?.id])

  // Recarga al recuperar el foco de la ventana (Task 4.1, plan 4.1 Step 3):
  // otra persona puede haber revisado recibos de este mismo período en
  // otra pestaña/dispositivo mientras esta pantalla estaba de fondo.
  useEffect(() => {
    if (!empresaActiva?.id) return
    const onFocus = () => cargarInstancias(empresaActiva.id)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [empresaActiva?.id])

  if (!empresaActiva) return <div className="page"><div className="card">Elegí una empresa en Superadmin → "Entrar" para ver sus aprobaciones.</div></div>
  if (cargando) return <div className="page"><div className="card">Cargando…</div></div>
  if (error) return <div className="page"><div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div></div>

  const toggleSeleccion = (id) => setSeleccion((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])
  const toggleSeleccionRecibo = (periodoId, reciboId) => setSeleccionPorPeriodo((s) => {
    const actual = s[periodoId] || []
    const nueva = actual.includes(reciboId) ? actual.filter((x) => x !== reciboId) : [...actual, reciboId]
    return { ...s, [periodoId]: nueva }
  })

  const accionar = async (ids, accion) => {
    setProcesando(true); setErrorAccion(null)
    for (const id of ids) {
      const r = await actuar(id, accion, comentarios[id] || null)
      if (!r.ok) { setErrorAccion(`${id}: ${r.error}`); setProcesando(false); return }
    }
    setProcesando(false); setSeleccion([])
    await cargarInstancias(empresaActiva?.id)
  }

  const revisarRecibos = async (periodoId, ids, accion, comentario) => {
    setProcesando(true); setErrorAccion(null)
    for (const id of ids) {
      const r = await revisarLiquidacion(id, accion, comentario ?? null)
      if (!r.ok) { setErrorAccion(`${id}: ${r.error}`); setProcesando(false); return }
    }
    setProcesando(false)
    setSeleccionPorPeriodo((s) => ({ ...s, [periodoId]: [] }))
    await cargarInstancias(empresaActiva?.id)
  }

  const instanciasPagina = instancias.slice(rango[0], rango[1] + 1)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Aprobaciones</h1>
        <p className="page-subtitle">Períodos pendientes del paso que te corresponde en el flujo</p>
      </div>

      {errorAccion && <div className="card" style={{ color: 'var(--danger)' }}>Error: {errorAccion}</div>}

      {seleccion.length > 0 && (
        <div className="card card-compacta" style={{ marginBottom: '1rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{seleccion.length} períodos seleccionados</span>
          <button className="btn btn-primary btn-sm" disabled={procesando} onClick={() => accionar(seleccion, 'aprobado')}>Aprobar seleccionados</button>
          <button className="btn btn-ghost btn-sm" disabled={procesando} onClick={() => accionar(seleccion, 'rechazado')}>Rechazar seleccionados</button>
        </div>
      )}

      {instancias.length === 0 && <div className="card">No tenés períodos pendientes de aprobación.</div>}

      {instanciasPagina.map((i) => {
        const recibos = recibosPorPeriodo[i.periodoId] || []
        const agregados = agregadosPorPeriodo[i.periodoId] || { bruto: 0, totalAportes: 0, neto: 0, cantidad: 0 }
        const seleccionRecibos = seleccionPorPeriodo[i.periodoId] || []
        const motivoLote = motivoPorRecibo[`lote-${i.periodoId}`] || ''

        return (
          <div key={i.id} className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <input type="checkbox" checked={seleccion.includes(i.id)} onChange={() => toggleSeleccion(i.id)} />
              <h3 style={{ margin: 0 }}>
                Período {i.periodo?.tipo} {i.periodo?.fechaDesde} → {i.periodo?.fechaHasta}
              </h3>
              <span className="badge badge-neutral">paso {i.pasoActual?.orden}: {i.pasoActual?.nombre}</span>
              <Link to={`/liquidacion?periodo=${i.periodoId}`}>Ver detalle</Link>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap', color: 'var(--texto-secundario)' }}>
              <span>Bruto total: ${fmt(agregados.bruto)}</span>
              <span>Descuentos: ${fmt(agregados.totalAportes)}</span>
              <span>Neto total: ${fmt(agregados.neto)}</span>
              <span>{agregados.cantidad} recibos</span>
            </div>

            <textarea className="input" placeholder="comentario (opcional)" style={{ width: '100%', marginBottom: 8 }}
              value={comentarios[i.id] || ''} onChange={(e) => setComentarios((c) => ({ ...c, [i.id]: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button className="btn btn-primary btn-sm" disabled={procesando} onClick={() => accionar([i.id], 'aprobado')}>Aprobar período</button>
              <button className="btn btn-ghost btn-sm" disabled={procesando} onClick={() => accionar([i.id], 'rechazado')}>Rechazar período</button>
            </div>

            {seleccionRecibos.length > 0 && (
              <div className="card card-compacta" style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{seleccionRecibos.length} recibos seleccionados</span>
                <button className="btn btn-primary btn-sm" disabled={procesando}
                  onClick={() => revisarRecibos(i.periodoId, seleccionRecibos, 'aprobado')}>Aprobar seleccionados</button>
                <textarea className="input" placeholder="motivo del rechazo" style={{ minWidth: 220 }}
                  value={motivoLote} onChange={(e) => setMotivoPorRecibo((m) => ({ ...m, [`lote-${i.periodoId}`]: e.target.value }))} />
                <button className="btn btn-ghost btn-sm" disabled={procesando || !motivoLote.trim()}
                  onClick={() => revisarRecibos(i.periodoId, seleccionRecibos, 'rechazado', motivoLote)}>Rechazar seleccionados</button>
              </div>
            )}

            <table className="tabla">
              <thead>
                <tr><th></th><th>Persona</th><th>Bruto</th><th>Descuentos</th><th>Neto</th><th>Horas</th><th>Estado</th><th>Motivo</th><th></th></tr>
              </thead>
              <tbody>
                {recibos.map((r) => {
                  const motivo = motivoPorRecibo[r.id] || ''
                  return (
                    <tr key={r.id}>
                      <td><input type="checkbox" aria-label={`seleccionar recibo de ${personalPorId[r.personalId] || r.personalId}`}
                        checked={seleccionRecibos.includes(r.id)} onChange={() => toggleSeleccionRecibo(i.periodoId, r.id)} /></td>
                      <td>{personalPorId[r.personalId] || r.personalId}</td>
                      <td>${fmt(r.bruto)}</td>
                      <td>${fmt(r.totalAportes)}</td>
                      <td>${fmt(r.neto)}</td>
                      <td>{fmtHs(r.detalleHoras)}</td>
                      <td><span className={`badge badge-${r.estadoRevision === 'aprobado' ? 'success' : r.estadoRevision === 'rechazado' ? 'danger' : 'neutral'}`}>{r.estadoRevision}</span></td>
                      <td>{r.motivoRechazo || '—'}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-primary btn-sm" disabled={procesando}
                          onClick={() => revisarRecibos(i.periodoId, [r.id], 'aprobado')}>Aprobar</button>
                        <textarea className="input" placeholder="motivo del rechazo" style={{ minWidth: 160 }}
                          value={motivo} onChange={(e) => setMotivoPorRecibo((m) => ({ ...m, [r.id]: e.target.value }))} />
                        <button className="btn btn-ghost btn-sm" disabled={procesando || !motivo.trim()}
                          onClick={() => revisarRecibos(i.periodoId, [r.id], 'rechazado', motivo)}>Rechazar</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}

      {(pagina > 0 || hayMasPaginas(instancias.length)) && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          {hayMasPaginas(instancias.length) && <button className="btn btn-ghost btn-sm" onClick={siguientePagina}>Ver más períodos</button>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

```bash
npx vitest run src/pages/__tests__/AprobacionesPage.test.jsx
```

Expected: todos PASS. Si el test de `fmt` con miles falla por separador de miles (`.` en `es-AR`), ajustar el `getAllByText` del test a una porción del número sin separador (por ejemplo `/83.000,00/` para el neto) — no cambiar el formateo de la página, que ya sigue la convención `fmt` usada en el resto del proyecto (`LiquidacionPage.jsx:82`).

- [ ] **Step 5: Correr toda la suite para asegurar que no se rompió nada**

```bash
npx vitest run
```

Expected: mismo total que la última corrida confirmada (462 passed + los nuevos de esta feature, 0 failed).

- [ ] **Step 6: Commit**

```bash
git add src/pages/AprobacionesPage.jsx src/pages/__tests__/AprobacionesPage.test.jsx
git commit -m "feat(ui): detalle de recibos, rechazo individual con motivo y aprobacion/rechazo masivo"
```

---

### Task 6: `LiquidacionPage` — preseleccionar período desde `?periodo=`

**Files:**
- Modify: `src/pages/LiquidacionPage.jsx`

- [ ] **Step 1: Escribir el test**

Buscar el archivo de test existente de esta página (si no existe uno, crear `src/pages/__tests__/LiquidacionPage.test.jsx` mínimo). Antes de escribir, correr:

```bash
find /ruta/al/proyecto/src/pages/__tests__ -iname "LiquidacionPage*"
```

Si existe, agregar el caso ahí; si no existe, es aceptable saltar el test automatizado de esta task puntual (la página ya tiene lógica de negocio pesada sin cobertura previa de routing) y hacer solo verificación manual: confirmar con el usuario que entrar a `/liquidacion?periodo=<id-real>` deja ese período seleccionado en el `SelectorPeriodo`. Documentar en el commit que la verificación fue manual.

- [ ] **Step 2: Implementar la lectura del query param**

En `src/pages/LiquidacionPage.jsx`, agregar el import (línea 1, junto a los demás de `react-router-dom` si los hubiera — no hay ninguno hoy en este archivo salvo los que se agregan acá):

```javascript
import { useSearchParams } from 'react-router-dom'
```

Dentro del componente, junto a la declaración de `periodoSeleccionado` (línea 53), agregar:

```javascript
const [searchParams] = useSearchParams()
```

Y después del `useEffect` que carga `periodos` (el que depende de `[empresaId]`, línea 112-121), agregar un nuevo `useEffect`:

```javascript
// Preselección desde /liquidacion?periodo=<id> (link "Ver detalle" en
// AprobacionesPage, Task 4.1). Espera a que `periodos` tenga datos antes
// de intentar el match — si se corre en el mismo render que el cambio de
// empresa, `periodos` todavía puede estar vacío.
useEffect(() => {
  const periodoParam = searchParams.get('periodo')
  if (periodoParam && periodos.some((p) => p.id === periodoParam)) {
    setPeriodoSeleccionado(periodoParam)
  }
}, [searchParams, periodos])
```

- [ ] **Step 3: Verificación manual (pedirle al usuario)**

> "Cambio de LiquidacionPage listo. Para verificar: iniciá el server local (`npm run dev`), entrá a `/aprobaciones`, clickeá 'Ver detalle' en algún período, y confirmame que en `/liquidacion` aparece ese período ya seleccionado en el selector."

- [ ] **Step 4: Correr la suite completa**

```bash
npx vitest run
```

Expected: mismo total que antes (ningún test debería romperse; este cambio es aditivo y no toca lógica de cálculo/estado existente).

- [ ] **Step 5: Commit**

```bash
git add src/pages/LiquidacionPage.jsx
git commit -m "feat(ui): preseleccionar periodo en LiquidacionPage via query param"
```

---

## Self-Review (completado por quien escribió el plan)

**Spec coverage:**
- Migración + RPC con motivo obligatorio → Task 1. ✓
- Detalle por recibo (bruto/descuento/neto/horas) en la store y la UI → Tasks 2, 3, 5. ✓
- Agregados en cliente (no RPC) → Task 3. ✓
- Aprobar/rechazar individual y masivo por recibo → Task 5. ✓
- Selección por período independiente de la selección de períodos completos → Task 5 (`seleccionPorPeriodo` separado de `seleccion`). ✓
- Link "Ver detalle" + preselección en LiquidacionPage → Tasks 5 y 6. ✓
- Paginación de períodos → Task 5 (`usePaginado`). ✓
- Recarga al foco → Task 5. ✓
- El flujo de instancia de período no se toca → confirmado, Task 5 mantiene `actuar`/"Aprobar período" sin cambios de comportamiento. ✓

**Placeholder scan:** sin TBD/TODO; todos los pasos de código tienen el código completo, no resúmenes.

**Type/naming consistency:** `reciboFromDB` devuelve `{periodoId, personalId, bruto, totalAportes, neto, detalleHoras, estadoRevision, motivoRechazo}` — mismos nombres usados en Task 3 (store), Task 5 (página) y sus tests. `revisarLiquidacion(id, accion, comentario)` firma consistente entre store (Task 3), página (Task 5) y tests (Task 4, 5).
