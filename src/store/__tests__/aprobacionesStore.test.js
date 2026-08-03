import { describe, it, expect, vi, beforeEach } from 'vitest'
import { instanciaFromDB } from '../aprobacionesStore'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve) => resolve({ data: [], error: null }),
    })),
    rpc: vi.fn(),
  },
}))

describe('instanciaFromDB', () => {
  it('mapea snake_case y anida período/paso actual', () => {
    const row = {
      id: 'i1', empresa_id: 'e1', periodo_id: 'p1', flujo_id: 'f1', paso_actual_id: 'pa1', estado: 'en_progreso',
      nom_periodos: { id: 'p1', tipo: 'mensual', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-31' },
      paso_actual: { id: 'pa1', nombre: 'Revisión interna', orden: 1, rol_requerido: 'revisor_interno' },
    }
    expect(instanciaFromDB(row)).toEqual({
      id: 'i1', empresaId: 'e1', periodoId: 'p1', flujoId: 'f1', pasoActualId: 'pa1', estado: 'en_progreso',
      periodo: { id: 'p1', tipo: 'mensual', fechaDesde: '2026-07-01', fechaHasta: '2026-07-31' },
      pasoActual: { id: 'pa1', nombre: 'Revisión interna', orden: 1, rolRequerido: 'revisor_interno' },
    })
  })

  it('periodo/pasoActual son null si no vienen incluidos', () => {
    const r = instanciaFromDB({ id: 'i2', empresa_id: 'e1', periodo_id: 'p2', flujo_id: 'f1', paso_actual_id: null, estado: 'aprobado' })
    expect(r.periodo).toBeNull()
    expect(r.pasoActual).toBeNull()
  })
})

describe('cargarInstancias — filtro por empresa (Task 3.4, M9)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { useAprobacionesStore } = await import('../aprobacionesStore')
    useAprobacionesStore.setState({ instancias: [], cargando: false, error: null })
  })

  it('sin empresaId no consulta la base y deja instancias vacío', async () => {
    const { supabase } = await import('../../lib/supabase')
    const { useAprobacionesStore } = await import('../aprobacionesStore')
    await useAprobacionesStore.getState().cargarInstancias(undefined)
    expect(supabase.from).not.toHaveBeenCalled()
    expect(useAprobacionesStore.getState().instancias).toEqual([])
  })

  it('filtra por empresa_id = empresaId (no mezcla instancias de otra empresa con acceso puente)', async () => {
    const { supabase } = await import('../../lib/supabase')
    const { useAprobacionesStore } = await import('../aprobacionesStore')
    const eqMock = vi.fn().mockReturnThis()
    supabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: eqMock,
      then: (resolve) => resolve({ data: [], error: null }),
    })
    await useAprobacionesStore.getState().cargarInstancias('empresa-1')
    expect(eqMock).toHaveBeenCalledWith('estado', 'en_progreso')
    expect(eqMock).toHaveBeenCalledWith('empresa_id', 'empresa-1')
  })
})

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
