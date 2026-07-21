import { describe, it, expect } from 'vitest'
import { generarFormula, type ConfigConcepto } from './formulas'
import { evaluar } from './interprete'

describe('generarFormula', () => {
  it('nominal devuelve el monto como literal', () => {
    expect(generarFormula({ modo: 'nominal', monto: 15000 })).toBe('15000')
  })

  it('porcentaje sobre remunerativo', () => {
    expect(generarFormula({ modo: 'porcentaje', porcentaje: 11, base: 'remunerativo' }))
      .toBe('remunerativo_acumulado * 0.11')
  })

  it('porcentaje sobre no remunerativo', () => {
    expect(generarFormula({ modo: 'porcentaje', porcentaje: 3, base: 'no_remunerativo' }))
      .toBe('no_remunerativo_acumulado * 0.03')
  })

  it('porcentaje sobre ambos', () => {
    expect(generarFormula({ modo: 'porcentaje', porcentaje: 9, base: 'ambos' }))
      .toBe('(remunerativo_acumulado + no_remunerativo_acumulado) * 0.09')
  })

  it('porcentaje con tope aplica min(base, tope)', () => {
    expect(generarFormula({ modo: 'porcentaje', porcentaje: 11, base: 'remunerativo', tope: 'tope_sipa' }))
      .toBe('min(remunerativo_acumulado, tope_sipa) * 0.11')
  })

  it('las fórmulas generadas son evaluables por el intérprete', () => {
    const configs: ConfigConcepto[] = [
      { modo: 'nominal', monto: 500.5 },
      { modo: 'porcentaje', porcentaje: 11, base: 'remunerativo', tope: 'tope_sipa' },
      { modo: 'porcentaje', porcentaje: 9, base: 'ambos' },
    ]
    const vars = { remunerativo_acumulado: 1000000, no_remunerativo_acumulado: 100000, tope_sipa: 800000 }
    for (const c of configs) {
      expect(typeof evaluar(generarFormula(c), vars)).toBe('number')
    }
  })

  it('rechaza configs incompletas', () => {
    expect(() => generarFormula({ modo: 'nominal' } as ConfigConcepto)).toThrow()
    expect(() => generarFormula({ modo: 'porcentaje', base: 'remunerativo' } as ConfigConcepto)).toThrow()
  })
})
