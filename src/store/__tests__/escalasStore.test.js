import { describe, it, expect } from 'vitest'
import { agruparVigencias, categoriaFromDB } from '../escalasStore'

describe('agruparVigencias', () => {
  it('agrupa por nombre con el valor vigente (mayor vigencia <= hoy) y el historial ordenado', () => {
    const filas = [
      { nombre: 'Oficial', valor: 100, vigenciaDesde: '2026-01-01' },
      { nombre: 'Oficial', valor: 120, vigenciaDesde: '2026-06-01' },
      { nombre: 'Oficial', valor: 990, vigenciaDesde: '2099-01-01' }, // futura: no es la vigente
      { nombre: 'Ayudante', valor: 80, vigenciaDesde: '2026-01-01' },
    ]
    const g = agruparVigencias(filas, '2026-07-21')
    expect(g).toEqual([
      {
        nombre: 'Ayudante', vigente: { valor: 80, vigenciaDesde: '2026-01-01' },
        historial: [{ valor: 80, vigenciaDesde: '2026-01-01' }],
      },
      {
        nombre: 'Oficial', vigente: { valor: 120, vigenciaDesde: '2026-06-01' },
        historial: [
          { valor: 990, vigenciaDesde: '2099-01-01' },
          { valor: 120, vigenciaDesde: '2026-06-01' },
          { valor: 100, vigenciaDesde: '2026-01-01' },
        ],
      },
    ])
  })

  it('sin vigencia aplicable, vigente es null', () => {
    const g = agruparVigencias([{ nombre: 'X', valor: 1, vigenciaDesde: '2099-01-01' }], '2026-07-21')
    expect(g[0].vigente).toBeNull()
  })
})

describe('categoriaFromDB', () => {
  it('mapea basico numérico', () => {
    expect(categoriaFromDB({ id: 'k1', convenio_id: 'cv1', nombre: 'Oficial', basico: '123.45', vigencia_desde: '2026-06-01' }))
      .toEqual({ id: 'k1', convenioId: 'cv1', nombre: 'Oficial', valor: 123.45, vigenciaDesde: '2026-06-01' })
  })

  it('categoriaFromDB incluye la modalidad', () => {
    const row = { id: 'c1', convenio_id: 'v1', nombre: 'Oficial', basico: 1000, vigencia_desde: '2026-01-01', modalidad: 'mensual' }
    expect(categoriaFromDB(row).modalidad).toBe('mensual')
  })
})
