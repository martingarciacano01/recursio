import { describe, it, expect } from 'vitest'
import { agruparAusencias } from '../agruparAusencias'

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
      { id: '1', fecha_desde: '2026-01-01', fecha_hasta: '2026-01-03', estado: 'aprobada' },
      { id: '2', fecha_desde: '2026-02-01', fecha_hasta: '2026-02-01', estado: 'aprobada' },
      { id: '3', fecha_desde: '2026-03-01', fecha_hasta: '2026-03-02', estado: 'pendiente' },
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
