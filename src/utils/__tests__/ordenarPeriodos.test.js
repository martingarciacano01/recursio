import { describe, it, expect } from 'vitest'
import { ordenarPeriodos, agruparPorAnio } from '../ordenarPeriodos'

const p = (id, fecha_desde, tipo) => ({ id, fecha_desde, fecha_hasta: fecha_desde, tipo })

describe('ordenarPeriodos', () => {
  it('ordena por mes descendente', () => {
    const orden = ordenarPeriodos([
      p('a', '2026-05-01', 'mensual'),
      p('b', '2026-07-01', 'mensual'),
      p('c', '2026-06-01', 'mensual'),
    ]).map((x) => x.id)
    expect(orden).toEqual(['b', 'c', 'a'])
  })

  it('dentro del mismo mes ordena por tipo, no por fecha', () => {
    const orden = ordenarPeriodos([
      p('mensual', '2026-06-01', 'mensual'),
      p('q2', '2026-06-16', 'quincena_2'),
      p('sac', '2026-06-01', 'sac_1'),
      p('q1', '2026-06-01', 'quincena_1'),
    ]).map((x) => x.id)
    expect(orden).toEqual(['q1', 'q2', 'mensual', 'sac'])
  })

  it('los años más nuevos van primero', () => {
    const orden = ordenarPeriodos([
      p('viejo', '2025-12-01', 'mensual'),
      p('nuevo', '2026-01-01', 'mensual'),
    ]).map((x) => x.id)
    expect(orden).toEqual(['nuevo', 'viejo'])
  })

  it('no muta el array original', () => {
    const entrada = [p('a', '2026-05-01', 'mensual'), p('b', '2026-07-01', 'mensual')]
    ordenarPeriodos(entrada)
    expect(entrada.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('tolera una lista vacía o nula', () => {
    expect(ordenarPeriodos([])).toEqual([])
    expect(ordenarPeriodos(null)).toEqual([])
  })
})

describe('agruparPorAnio', () => {
  it('agrupa manteniendo el orden y con los años nuevos primero', () => {
    const grupos = agruparPorAnio([
      p('a', '2025-03-01', 'mensual'),
      p('b', '2026-07-01', 'mensual'),
      p('c', '2026-06-01', 'mensual'),
    ])
    expect(grupos.map(([anio]) => anio)).toEqual(['2026', '2025'])
    expect(grupos[0][1].map((x) => x.id)).toEqual(['b', 'c'])
  })
})
