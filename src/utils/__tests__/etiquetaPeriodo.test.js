import { describe, it, expect } from 'vitest'
import { etiquetaPeriodo, etiquetaTipoPeriodo } from '../etiquetaPeriodo'

describe('etiquetaPeriodo', () => {
  it('quincena 1', () => {
    expect(etiquetaPeriodo({ tipo: 'quincena_1', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-15' }))
      .toBe('Junio 2026 · 1ra quincena')
  })

  it('quincena 2', () => {
    expect(etiquetaPeriodo({ tipo: 'quincena_2', fecha_desde: '2026-06-16', fecha_hasta: '2026-06-30' }))
      .toBe('Junio 2026 · 2da quincena')
  })

  it('mensual fuera de convenio', () => {
    expect(etiquetaPeriodo({ tipo: 'mensual_fc', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-30' }))
      .toBe('Junio 2026 · Fuera de convenio')
  })

  it('primer SAC', () => {
    expect(etiquetaPeriodo({ tipo: 'sac_1', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-30' }))
      .toBe('Junio 2026 · 1er SAC')
  })

  it('segundo SAC', () => {
    expect(etiquetaPeriodo({ tipo: 'sac_2', fecha_desde: '2026-12-01', fecha_hasta: '2026-12-31' }))
      .toBe('Diciembre 2026 · 2do SAC')
  })

  it('mensual comun', () => {
    expect(etiquetaPeriodo({ tipo: 'mensual', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-31' }))
      .toBe('Julio 2026 · Mensual')
  })

  it('acepta camelCase (nom_periodos anidado en otras consultas)', () => {
    expect(etiquetaPeriodo({ tipo: 'final', fechaDesde: '2026-07-10' }))
      .toBe('Julio 2026 · Liquidación final')
  })

  it('periodo nulo devuelve un guion', () => {
    expect(etiquetaPeriodo(null)).toBe('—')
  })

  it('etiquetaTipoPeriodo devuelve solo el tipo, sin mes', () => {
    expect(etiquetaTipoPeriodo('quincena_1')).toBe('1ra quincena')
    expect(etiquetaTipoPeriodo('tipo_desconocido')).toBe('tipo_desconocido')
  })
})
