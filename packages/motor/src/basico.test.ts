import { describe, it, expect } from 'vitest'
import { calcularBasicoPeriodo } from './basico'

describe('calcularBasicoPeriodo', () => {
  it('hora: basico * ceil(horas trabajadas) — horas fraccionarias suben al entero', () => {
    // 71,26 h → se liquidan 72 h completas (redondeo hacia arriba AFECTA el
    // cálculo, no solo el texto impreso — ver plan 2026-07-29 §2)
    const r = calcularBasicoPeriodo({ modalidad: 'hora', basico: 1500, tipoPeriodo: 'mensual', horasTrabajadas: 71.26, faltasInjustificadas: 0 })
    expect(r.horasLiquidadas).toBe(72)
    expect(r.valorHora).toBe(1500)
    expect(r.monto).toBeCloseTo(1500 * 72, 2)
  })

  it('hora: 78,00 h exactas no suben a 79 (ceil de un entero es el mismo entero)', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'hora', basico: 1500, tipoPeriodo: 'mensual', horasTrabajadas: 78, faltasInjustificadas: 0 })
    expect(r.horasLiquidadas).toBe(78)
    expect(r.monto).toBeCloseTo(1500 * 78, 2)
  })

  it('hora: 0 horas trabajadas da 0', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'hora', basico: 1500, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r.horasLiquidadas).toBe(0)
    expect(r.monto).toBe(0)
  })

  it('mensual, período mensual, sin faltas: paga el basico completo', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'mensual', basico: 600000, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r.monto).toBeCloseTo(600000, 2)
    expect(r.horasLiquidadas).toBe(0) // no aplica para modalidad mensual
  })

  it('mensual, período quincenal: la mitad del basico', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'mensual', basico: 600000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r.monto).toBeCloseTo(300000, 2)
  })

  it('mensual, período quincenal, 2 faltas injustificadas: descuenta basico/30 por dia', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'mensual', basico: 600000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 2 })
    expect(r.monto).toBeCloseTo(600000 / 2 - 2 * (600000 / 30), 2) // 260000
  })

  it('quincenal, período quincenal, sin faltas: paga el basico completo', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'quincenal', basico: 300000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r.monto).toBeCloseTo(300000, 2)
  })

  it('quincenal, período mensual: el doble del basico', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'quincenal', basico: 300000, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r.monto).toBeCloseTo(600000, 2)
  })

  it('quincenal, período quincenal, 1 falta injustificada: descuenta basico/15', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'quincenal', basico: 300000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 1 })
    expect(r.monto).toBeCloseTo(300000 - 300000 / 15, 2) // 280000
  })

  it('modalidad desconocida: lanza error explicito (nunca $0 silencioso)', () => {
    expect(() => calcularBasicoPeriodo({ modalidad: 'semanal' as any, basico: 100, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 }))
      .toThrow(/modalidad desconocida/)
  })
})
