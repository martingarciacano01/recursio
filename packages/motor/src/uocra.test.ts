import { describe, it, expect } from 'vitest'
import {
  porcentajeFondoDesempleo, calcularFondoDesempleo, calcularSAC, calcularSACProporcional,
  diasVacacionesPorAntiguedad, calcularVacacionesNoGozadas, calcularLiquidacionFinal,
} from './uocra'

describe('fondo de desempleo (Ley 22.250)', () => {
  it('12% durante el primer año', () => {
    expect(porcentajeFondoDesempleo(0.5)).toBe(0.12)
    expect(calcularFondoDesempleo(100000, 0.5)).toBe(12000)
  })
  it('8% a partir del segundo año', () => {
    expect(porcentajeFondoDesempleo(2)).toBe(0.08)
    expect(calcularFondoDesempleo(100000, 2)).toBe(8000)
  })
  it('exactamente 1 año ya es 8%', () => {
    expect(porcentajeFondoDesempleo(1)).toBe(0.08)
  })
})

describe('SAC', () => {
  it('50% de la mejor remuneracion del semestre', () => {
    expect(calcularSAC([100000, 150000, 120000])).toBe(75000)
  })
  it('semestre vacio da 0', () => {
    expect(calcularSAC([])).toBe(0)
  })
  it('SAC proporcional por dias trabajados', () => {
    expect(calcularSACProporcional(150000, 91, 182)).toBeCloseTo(37500, 0)
  })
  it('calcularSACProporcional recibe bruto MENSUAL: la mejor quincena ya fue consolidada por el llamador (Task 2.1)', () => {
    // Se pasa el máximo mensual (750000), no cada quincena (375000).
    expect(calcularSACProporcional(750000, 182, 182)).toBeCloseTo(375000, 2)
  })
})

describe('vacaciones', () => {
  it('escala de dias por antiguedad', () => {
    expect(diasVacacionesPorAntiguedad(2)).toBe(14)
    expect(diasVacacionesPorAntiguedad(7)).toBe(21)
    expect(diasVacacionesPorAntiguedad(15)).toBe(28)
    expect(diasVacacionesPorAntiguedad(25)).toBe(35)
  })
  it('vacaciones no gozadas = salario diario * dias', () => {
    expect(calcularVacacionesNoGozadas(250000, 10, 25)).toBe(100000)
  })
})

describe('liquidacion final 22.250', () => {
  it('suma vacaciones no gozadas + SAC proporcional, sin indemnizacion', () => {
    const r = calcularLiquidacionFinal({
      remuneracionMensual: 250000, antiguedadAnios: 3, diasVacacionesNoGozados: 10,
      mejorRemuneracionSemestre: 250000, diasTrabajadosSemestre: 91,
    })
    expect(r.vacacionesNoGozadas).toBe(100000)
    expect(r.sacProporcional).toBeCloseTo(62500, 0)
    expect(r.total).toBeCloseTo(162500, 0)
  })
})
