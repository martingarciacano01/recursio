import { describe, it, expect } from 'vitest'
import { validarYGenerarFormula } from '../FormularioConcepto'

describe('validarYGenerarFormula', () => {
  it('devuelve la fórmula para un config válido', () => {
    const r = validarYGenerarFormula({ modo: 'porcentaje', porcentaje: 11, base: 'remunerativo', tope: 'tope_sipa' })
    expect(r).toEqual({ ok: true, formula: 'min(remunerativo_acumulado, tope_sipa) * 0.11' })
  })
  it('devuelve error para un config inválido', () => {
    const r = validarYGenerarFormula({ modo: 'porcentaje', base: 'remunerativo' })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
