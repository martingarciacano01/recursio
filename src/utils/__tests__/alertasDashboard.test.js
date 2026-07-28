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
