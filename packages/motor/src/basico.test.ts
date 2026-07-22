import { describe, it, expect } from 'vitest'
import { calcularBasicoPeriodo } from './basico'

describe('calcularBasicoPeriodo', () => {
  it('hora: basico * horas trabajadas (sin cambios de comportamiento)', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'hora', basico: 1500, tipoPeriodo: 'mensual', horasTrabajadas: 176, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(264000, 2)
  })

  it('mensual, período mensual, sin faltas: paga el basico completo', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'mensual', basico: 600000, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(600000, 2)
  })

  it('mensual, período quincenal: la mitad del basico', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'mensual', basico: 600000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(300000, 2)
  })

  it('mensual, período quincenal, 2 faltas injustificadas: descuenta basico/30 por dia', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'mensual', basico: 600000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 2 })
    expect(r).toBeCloseTo(600000 / 2 - 2 * (600000 / 30), 2) // 260000
  })

  it('quincenal, período quincenal, sin faltas: paga el basico completo', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'quincenal', basico: 300000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(300000, 2)
  })

  it('quincenal, período mensual: el doble del basico', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'quincenal', basico: 300000, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(600000, 2)
  })

  it('quincenal, período quincenal, 1 falta injustificada: descuenta basico/15', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'quincenal', basico: 300000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 1 })
    expect(r).toBeCloseTo(300000 - 300000 / 15, 2) // 280000
  })

  it('modalidad desconocida: lanza error explicito (nunca $0 silencioso)', () => {
    expect(() => calcularBasicoPeriodo({ modalidad: 'semanal', basico: 100, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 }))
      .toThrow(/modalidad desconocida/)
  })
})
