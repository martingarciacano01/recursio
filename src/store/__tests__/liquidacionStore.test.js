import { describe, it, expect, vi } from 'vitest'
import { liquidacionFromDB, itemFromDB } from '../liquidacionStore'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn().mockResolvedValue({
        data: {
          liquidadas: 1,
          omitidos: [{ personal_id: 'p1', nombre: 'Juan Pérez', motivo: 'legajo incompleto: falta CUIL' }],
          advertencias: [{ personal_id: 'p2', mensaje: 'sin escala vigente para "Oficial" al 2026-07-31 (convenio c1)' }],
        },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'periodo-final-1' }, error: null }),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}))

describe('mappers de liquidacion', () => {
  it('liquidacionFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'l1', empresa_id: 'e1', periodo_id: 'p1', personal_id: 'per1', bruto: 1000, neto: 800, estado: 'preliminar' }
    expect(liquidacionFromDB(row)).toEqual({
      id: 'l1', empresaId: 'e1', periodoId: 'p1', personalId: 'per1', obraId: null, bruto: 1000, neto: 800, estado: 'preliminar',
      totalAportes: 0, totalContribuciones: 0, detalleHoras: null,
      numeroRecibo: null, hashPdf: null, version: 1, anulado: false, motivoAnulacion: null,
    })
  })

  it('liquidacionFromDB mapea obra_id a obraId', () => {
    const row = { id: 'l2', empresa_id: 'e1', periodo_id: 'p1', personal_id: 'per2', obra_id: 'obra-1', bruto: 2000, neto: 1600, estado: 'preliminar' }
    expect(liquidacionFromDB(row).obraId).toBe('obra-1')
  })

  it('itemFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'i1', liquidacion_id: 'l1', concepto_codigo: 'basico', concepto_nombre: 'Básico', tipo: 'remunerativo', monto: 500, regla_aplicada: 'base' }
    expect(itemFromDB(row)).toEqual({
      id: 'i1', liquidacionId: 'l1', conceptoCodigo: 'basico', conceptoNombre: 'Básico', tipo: 'remunerativo', monto: 500, reglaAplicada: 'base',
    })
  })

  it('liquidacionFromDB defiende bruto/neto/monto ausentes con 0 en vez de undefined (Task 3.2)', () => {
    // Una fila con bruto/neto undefined no debe filtrar undefined al store:
    // río abajo hay .toFixed()/formateos de moneda que tiran si reciben
    // undefined en vez de un número, tumbando el render entero.
    const row = { id: 'l1', empresa_id: 'e1', periodo_id: 'p1', personal_id: 'per1', estado: 'preliminar' }
    const mapeada = liquidacionFromDB(row)
    expect(mapeada.bruto).toBe(0)
    expect(mapeada.neto).toBe(0)
  })

  it('itemFromDB defiende monto ausente con 0 (Task 3.2)', () => {
    const row = { id: 'i1', liquidacion_id: 'l1', concepto_codigo: 'basico', concepto_nombre: 'Básico', tipo: 'remunerativo', regla_aplicada: 'base' }
    expect(itemFromDB(row).monto).toBe(0)
  })
})

describe('calcularPeriodo', () => {
  it('guarda omitidos y advertencias devueltos por la Edge Function', async () => {
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().calcularPeriodo('periodo-1')
    expect(r.ok).toBe(true)
    const estado = useLiquidacionStore.getState()
    expect(estado.omitidos).toEqual([{ personal_id: 'p1', nombre: 'Juan Pérez', motivo: 'legajo incompleto: falta CUIL' }])
    expect(estado.advertencias).toEqual([{ personal_id: 'p2', mensaje: 'sin escala vigente para "Oficial" al 2026-07-31 (convenio c1)' }])
  })

  it('reintenta con reanudar:true hasta que la respuesta indica completo', async () => {
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: { liquidadas: 50, omitidos: [], advertencias: [], completo: false, procesados: 50, total: 120 }, error: null })
      .mockResolvedValueOnce({ data: { liquidadas: 70, omitidos: [], advertencias: [], completo: true, procesados: 120, total: 120 }, error: null })
    supabase.functions.invoke = invoke
    await useLiquidacionStore.getState().calcularPeriodo('periodo-1')
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1][1].body.reanudar).toBe(true)
  })
})

describe('calcularPeriodo — red caída (Task 3.3)', () => {
  it('no deja "calculando" trabado si invoke rechaza (caída de red)', async () => {
    supabase.functions.invoke = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().calcularPeriodo('periodo-1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no se pudo contactar el servidor')
    expect(useLiquidacionStore.getState().calculando).toBe(false)
    expect(useLiquidacionStore.getState().error).toBe('no se pudo contactar el servidor')
  })
})

describe('crearPeriodoFinal', () => {
  it('devuelve ok:false con el motivo cuando la persona queda en omitidos aunque el invoke no reporte error', async () => {
    supabase.functions.invoke = vi.fn().mockResolvedValue({
      data: {
        liquidadas: 0,
        omitidos: [{ personal_id: 'p1', nombre: 'Juan Pérez', motivo: 'legajo incompleto: falta motivo_baja' }],
        advertencias: [],
      },
      error: null,
    })
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().crearPeriodoFinal('p1', '2026-07-27', 'empresa-1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('legajo incompleto: falta motivo_baja')
  })

  it('devuelve ok:true cuando no hay omitidos', async () => {
    supabase.functions.invoke = vi.fn().mockResolvedValue({
      data: { liquidadas: 1, omitidos: [], advertencias: [] },
      error: null,
    })
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().crearPeriodoFinal('p1', '2026-07-27', 'empresa-1')
    expect(r.ok).toBe(true)
  })

  it('envia personalIds (camelCase) en el body para acotar la liquidacion a la persona dada de baja', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { liquidadas: 1, omitidos: [], advertencias: [] },
      error: null,
    })
    supabase.functions.invoke = invoke
    const { useLiquidacionStore } = await import('../liquidacionStore')
    await useLiquidacionStore.getState().crearPeriodoFinal('p1', '2026-07-27', 'empresa-1')
    expect(invoke).toHaveBeenCalledTimes(1)
    const body = invoke.mock.calls[0][1].body
    expect(body.personalIds).toEqual(['p1'])
    expect(body.personal_ids).toBeUndefined()
  })

  it('no revienta y borra el periodo huerfano si invoke rechaza (caída de red, Task 3.3)', async () => {
    supabase.functions.invoke = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const deleteFn = vi.fn().mockReturnThis()
    const eqFn = vi.fn().mockResolvedValue({ data: null, error: null })
    supabase.from = vi.fn(() => ({
      insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'periodo-final-1' }, error: null }),
      delete: deleteFn, eq: eqFn,
    }))
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().crearPeriodoFinal('p1', '2026-07-27', 'empresa-1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no se pudo contactar el servidor')
    expect(deleteFn).toHaveBeenCalled()
  })

  it('borra el nom_periodos recien creado si la Edge Function devuelve error (evita huerfanos)', async () => {
    supabase.functions.invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const deleteFn = vi.fn().mockReturnThis()
    const eqFn = vi.fn().mockResolvedValue({ data: null, error: null })
    supabase.from = vi.fn(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'periodo-final-1' }, error: null }),
      delete: deleteFn,
      eq: eqFn,
    }))
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().crearPeriodoFinal('p1', '2026-07-27', 'empresa-1')
    expect(r.ok).toBe(false)
    expect(deleteFn).toHaveBeenCalled()
    expect(eqFn).toHaveBeenCalledWith('id', 'periodo-final-1')
  })
})

describe('crearPeriodoVacaciones', () => {
  function mockFrom({ liqId = 'liq-vac-1' } = {}) {
    return vi.fn((tabla) => {
      if (tabla === 'nom_periodos') {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'periodo-vac-1' }, error: null }),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (tabla === 'nom_liquidaciones') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: liqId }, error: null }),
        }
      }
      if (tabla === 'nom_vacaciones_liquidadas') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
      }
      return { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })
  }

  it('crea el periodo, invoca con personalIds y registra la traza con origen presencio cuando hay ausenciaId', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { liquidadas: 1, omitidos: [], advertencias: [] }, error: null })
    supabase.functions.invoke = invoke
    const fromMock = mockFrom()
    supabase.from = fromMock
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().crearPeriodoVacaciones('p1', '2026-07-01', '2026-07-10', 'empresa-1', 'ausencia-1')
    expect(r.ok).toBe(true)
    expect(invoke).toHaveBeenCalledTimes(1)
    const body = invoke.mock.calls[0][1].body
    expect(body.personalIds).toEqual(['p1'])
    expect(fromMock.mock.calls.some((c) => c[0] === 'nom_vacaciones_liquidadas')).toBe(true)
  })

  it('registra origen manual cuando no se pasa ausenciaId', async () => {
    supabase.functions.invoke = vi.fn().mockResolvedValue({ data: { liquidadas: 1, omitidos: [], advertencias: [] }, error: null })
    const insertVacaciones = vi.fn().mockResolvedValue({ data: null, error: null })
    supabase.from = vi.fn((tabla) => {
      if (tabla === 'nom_periodos') {
        return {
          insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'periodo-vac-1' }, error: null }),
          delete: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (tabla === 'nom_liquidaciones') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'liq-1' }, error: null }) }
      }
      if (tabla === 'nom_vacaciones_liquidadas') return { insert: insertVacaciones }
      return {}
    })
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().crearPeriodoVacaciones('p1', '2026-07-01', '2026-07-10', 'empresa-1', null)
    expect(r.ok).toBe(true)
    expect(insertVacaciones).toHaveBeenCalledWith(expect.objectContaining({
      ausencia_id: null, origen: 'manual', dias: 10, liquidacion_id: 'liq-1',
    }))
  })

  it('borra el periodo huerfano si la Edge Function devuelve error', async () => {
    supabase.functions.invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const deleteFn = vi.fn().mockReturnThis()
    const eqFn = vi.fn().mockResolvedValue({ data: null, error: null })
    supabase.from = vi.fn(() => ({
      insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'periodo-vac-1' }, error: null }),
      delete: deleteFn, eq: eqFn,
    }))
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().crearPeriodoVacaciones('p1', '2026-07-01', '2026-07-10', 'empresa-1', null)
    expect(r.ok).toBe(false)
    expect(deleteFn).toHaveBeenCalled()
    expect(eqFn).toHaveBeenCalledWith('id', 'periodo-vac-1')
  })

  it('no revienta si invoke rechaza (caída de red, Task 3.3)', async () => {
    supabase.functions.invoke = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const deleteFn = vi.fn().mockReturnThis()
    const eqFn = vi.fn().mockResolvedValue({ data: null, error: null })
    supabase.from = vi.fn(() => ({
      insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'periodo-vac-1' }, error: null }),
      delete: deleteFn, eq: eqFn,
    }))
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const r = await useLiquidacionStore.getState().crearPeriodoVacaciones('p1', '2026-07-01', '2026-07-10', 'empresa-1', null)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no se pudo contactar el servidor')
    expect(deleteFn).toHaveBeenCalled()
  })
})

describe('cargarLiquidaciones — guardia de secuencia (Task 3.1, race condition C1)', () => {
  it('descarta la respuesta de un pedido viejo si llega despues de uno mas nuevo', async () => {
    // periodo A tarda, periodo B es rapido: A llega DESPUES de B en el
    // tiempo real, pero fue pedido ANTES. Sin guardia, ganaba "el que
    // responde ultimo" (A) y pisaba los datos correctos de B.
    let resolverA
    const promesaA = new Promise((resolve) => { resolverA = resolve })
    supabase.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((_col, periodoId) => (periodoId === 'periodo-A' ? promesaA : Promise.resolve({ data: [{ id: 'liq-B', periodo_id: 'periodo-B' }], error: null }))),
    }))
    const { useLiquidacionStore } = await import('../liquidacionStore')
    const pA = useLiquidacionStore.getState().cargarLiquidaciones('periodo-A')
    await useLiquidacionStore.getState().cargarLiquidaciones('periodo-B')
    expect(useLiquidacionStore.getState().liquidaciones.map((l) => l.id)).toEqual(['liq-B'])
    resolverA({ data: [{ id: 'liq-A', periodo_id: 'periodo-A' }], error: null })
    await pA
    // la respuesta tardia de A no debe pisar los datos de B
    expect(useLiquidacionStore.getState().liquidaciones.map((l) => l.id)).toEqual(['liq-B'])
  })
})

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
