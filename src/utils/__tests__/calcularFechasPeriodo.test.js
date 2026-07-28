import { describe, it, expect } from 'vitest'
import { calcularFechasPeriodo } from '../calcularFechasPeriodo'

const convenioQuincenal = {
  modalidad: 'quincenal',
  corteQ1Desde: 1, corteQ1Hasta: 15,
  corteQ2Desde: 16, corteQ2Hasta: null,
  corteMensualDesde: 1, corteMensualHasta: null,
}

const convenioMensual = {
  modalidad: 'mensual',
  corteQ1Desde: 1, corteQ1Hasta: 15,
  corteQ2Desde: 16, corteQ2Hasta: null,
  corteMensualDesde: 1, corteMensualHasta: null,
}

describe('calcularFechasPeriodo', () => {
  it('quincena_1: usa corte_q1 del convenio', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 7, tipo: 'quincena_1', convenio: convenioQuincenal })
    expect(r).toEqual({ fechaDesde: '2026-07-01', fechaHasta: '2026-07-15' })
  })

  it('quincena_2 en mes de 31 días: hasta = 31 (corte_q2_hasta null = fin de mes real)', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 7, tipo: 'quincena_2', convenio: convenioQuincenal })
    expect(r).toEqual({ fechaDesde: '2026-07-16', fechaHasta: '2026-07-31' })
  })

  it('quincena_2 en mes de 30 días: hasta = 30', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 6, tipo: 'quincena_2', convenio: convenioQuincenal })
    expect(r).toEqual({ fechaDesde: '2026-06-16', fechaHasta: '2026-06-30' })
  })

  it('mensual en febrero no bisiesto (2026): hasta = 28', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 2, tipo: 'mensual', convenio: convenioMensual })
    expect(r).toEqual({ fechaDesde: '2026-02-01', fechaHasta: '2026-02-28' })
  })

  it('mensual en febrero bisiesto (2028): hasta = 29', () => {
    const r = calcularFechasPeriodo({ anio: 2028, mes: 2, tipo: 'mensual', convenio: convenioMensual })
    expect(r).toEqual({ fechaDesde: '2028-02-01', fechaHasta: '2028-02-29' })
  })

  it('corte custom: q1 de 6 a 20', () => {
    const convenioCustom = { ...convenioQuincenal, corteQ1Desde: 6, corteQ1Hasta: 20 }
    const r = calcularFechasPeriodo({ anio: 2026, mes: 7, tipo: 'quincena_1', convenio: convenioCustom })
    expect(r).toEqual({ fechaDesde: '2026-07-06', fechaHasta: '2026-07-20' })
  })

  it('corte_hasta mayor al último día real del mes se recorta (ej. 31 en un mes de 30)', () => {
    const convenioCustom = { ...convenioQuincenal, corteQ2Hasta: 31 }
    const r = calcularFechasPeriodo({ anio: 2026, mes: 6, tipo: 'quincena_2', convenio: convenioCustom })
    expect(r.fechaHasta).toBe('2026-06-30')
  })

  it('mensual_fc: ignora el convenio (o null), siempre 1 a fin de mes real', () => {
    const r = calcularFechasPeriodo({ anio: 2026, mes: 2, tipo: 'mensual_fc', convenio: null })
    expect(r).toEqual({ fechaDesde: '2026-02-01', fechaHasta: '2026-02-28' })
  })

  it('quincena_1: corte_hasta mayor al último día real del mes se recorta (ej. 31 en un mes de 30)', () => {
    const convenioCustom = { ...convenioQuincenal, corteQ1Hasta: 31 }
    const r = calcularFechasPeriodo({ anio: 2026, mes: 6, tipo: 'quincena_1', convenio: convenioCustom })
    expect(r.fechaHasta).toBe('2026-06-30')
  })

  it('tipo desconocido (ej. legado "quincenal" o typo) lanza error en vez de caer silenciosamente en mensual', () => {
    expect(() => calcularFechasPeriodo({ anio: 2026, mes: 7, tipo: 'quincenal', convenio: convenioQuincenal })).toThrow()
    expect(() => calcularFechasPeriodo({ anio: 2026, mes: 7, tipo: 'bogus', convenio: convenioQuincenal })).toThrow()
  })

  it('convenio null con tipo distinto de mensual_fc lanza error claro', () => {
    expect(() => calcularFechasPeriodo({ anio: 2026, mes: 7, tipo: 'mensual', convenio: null })).toThrow()
  })
})
