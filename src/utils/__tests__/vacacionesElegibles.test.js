import { describe, it, expect } from 'vitest'
import { ausenciasVacacionesElegibles } from '../vacacionesElegibles'

describe('ausenciasVacacionesElegibles', () => {
  const ausencias = [
    { id: 'a1', tipo: 'vacaciones', estado: 'aprobada', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-10' },
    { id: 'a2', tipo: 'vacaciones', estado: 'pendiente', fecha_desde: '2026-08-01', fecha_hasta: '2026-08-05' },
    { id: 'a3', tipo: 'enfermedad', estado: 'aprobada', fecha_desde: '2026-05-01', fecha_hasta: '2026-05-03' },
    { id: 'a4', tipo: 'vacaciones', estado: 'aprobada', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-10' },
  ]

  it('filtra solo vacaciones aprobadas', () => {
    expect(ausenciasVacacionesElegibles(ausencias, []).map((a) => a.id)).toEqual(['a1', 'a4'])
  })

  it('excluye las que ya tienen liquidacion asociada', () => {
    expect(ausenciasVacacionesElegibles(ausencias, ['a1']).map((a) => a.id)).toEqual(['a4'])
  })

  it('sin ausencias devuelve vacio', () => {
    expect(ausenciasVacacionesElegibles([], [])).toEqual([])
    expect(ausenciasVacacionesElegibles(null, null)).toEqual([])
  })
})
