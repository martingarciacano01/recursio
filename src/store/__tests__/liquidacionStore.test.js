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
    })),
  },
}))

describe('mappers de liquidacion', () => {
  it('liquidacionFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'l1', empresa_id: 'e1', periodo_id: 'p1', personal_id: 'per1', bruto: 1000, neto: 800, estado: 'preliminar' }
    expect(liquidacionFromDB(row)).toEqual({
      id: 'l1', empresaId: 'e1', periodoId: 'p1', personalId: 'per1', bruto: 1000, neto: 800, estado: 'preliminar',
      totalAportes: 0, totalContribuciones: 0, detalleHoras: null,
      numeroRecibo: null, hashPdf: null, version: 1, anulado: false, motivoAnulacion: null,
    })
  })

  it('itemFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'i1', liquidacion_id: 'l1', concepto_codigo: 'basico', concepto_nombre: 'Básico', tipo: 'remunerativo', monto: 500, regla_aplicada: 'base' }
    expect(itemFromDB(row)).toEqual({
      id: 'i1', liquidacionId: 'l1', conceptoCodigo: 'basico', conceptoNombre: 'Básico', tipo: 'remunerativo', monto: 500, reglaAplicada: 'base',
    })
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
})
