import { describe, it, expect } from 'vitest'
import { instanciaFromDB } from '../aprobacionesStore'

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
