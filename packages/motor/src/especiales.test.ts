import { describe, it, expect } from 'vitest'
import { calcularSAC, calcularVacaciones, calcularLiquidacionFinal } from './especiales.ts'

describe('calcularSAC (LCT, art. 121)', () => {
  it('semestre completo: mejor bruto / 2', () => {
    const r = calcularSAC({ mejoresBrutosPorMes: [500000, 620000, 480000, 600000, 610000, 590000], diasTrabajadosSemestre: 182, diasSemestre: 182 })
    expect(r).toBe(310000) // 620000 / 2
  })
  it('proporcional a dias trabajados del semestre (ingreso a mitad de semestre)', () => {
    const r = calcularSAC({ mejoresBrutosPorMes: [600000, 650000, 600000], diasTrabajadosSemestre: 91, diasSemestre: 182 })
    expect(r).toBeCloseTo(650000 / 2 * (91 / 182), 2) // 162500
  })
  it('sin meses liquidados en el semestre da 0', () => {
    expect(calcularSAC({ mejoresBrutosPorMes: [], diasTrabajadosSemestre: 91, diasSemestre: 182 })).toBe(0)
  })
})

describe('calcularVacaciones (LCT, art. 150)', () => {
  it('menos de 5 años: 14 dias, modalidad mensual', () => {
    const r = calcularVacaciones({ antiguedadAnios: 3, diasTrabajadosAnio: 365, sueldoMensual: 500000, modalidad: 'mensual' })
    expect(r.dias).toBe(14)
    expect(r.montoDia).toBe(20000) // 500000 / 25
    expect(r.total).toBe(280000) // 14 * 20000
  })
  it('5 a 9 años: 21 dias', () => {
    expect(calcularVacaciones({ antiguedadAnios: 7, diasTrabajadosAnio: 365, sueldoMensual: 500000, modalidad: 'mensual' }).dias).toBe(21)
  })
  it('10 a 19 años: 28 dias', () => {
    expect(calcularVacaciones({ antiguedadAnios: 15, diasTrabajadosAnio: 365, sueldoMensual: 500000, modalidad: 'mensual' }).dias).toBe(28)
  })
  it('20 años o mas: 35 dias', () => {
    expect(calcularVacaciones({ antiguedadAnios: 25, diasTrabajadosAnio: 365, sueldoMensual: 500000, modalidad: 'mensual' }).dias).toBe(35)
  })
  it('menos de 6 meses de antiguedad: 1 dia cada 20 trabajados', () => {
    const r = calcularVacaciones({ antiguedadAnios: 0.3, diasTrabajadosAnio: 100, sueldoMensual: 500000, modalidad: 'mensual' })
    expect(r.dias).toBe(5) // floor(100 / 20)
  })
  it('modalidad jornalizada usa valorHora * 8 como valor dia', () => {
    const r = calcularVacaciones({ antiguedadAnios: 3, diasTrabajadosAnio: 365, modalidad: 'hora', valorHora: 2500 })
    expect(r.montoDia).toBe(20000) // 2500 * 8
    expect(r.total).toBe(280000) // 14 * 20000
  })
})

describe('calcularLiquidacionFinal (LCT)', () => {
  const base = {
    diasTrabajadosMes: 15, sueldoMensual: 600000,
    sacProporcional: 50000, vacacionesNoGozadas: 84000,
    antiguedadAnios: 3, mejorRemuneracionMensualNormal: 600000,
  }

  it('renuncia: solo rubros comunes, sin indemnizacion ni preaviso', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'renuncia' })
    expect(r.indemnizacionAntiguedad).toBe(0)
    expect(r.preaviso).toBe(0)
    expect(r.total).toBe(base.sacProporcional + base.vacacionesNoGozadas + (base.sueldoMensual / 30 * base.diasTrabajadosMes))
  })

  it('despido sin causa, antiguedad 3 anios: 3 sueldos de indemnizacion + 1 mes de preaviso (< 5 anios)', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'despido_sin_causa' })
    expect(r.indemnizacionAntiguedad).toBe(1800000) // 3 * 600000
    expect(r.preaviso).toBe(600000) // 1 mes, antiguedad < 5 anios
  })

  it('despido sin causa, antiguedad 6 anios: preaviso de 2 meses (>= 5 anios)', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'despido_sin_causa', antiguedadAnios: 6, mejorRemuneracionMensualNormal: 600000 })
    expect(r.indemnizacionAntiguedad).toBe(3600000) // 6 * 600000
    expect(r.preaviso).toBe(1200000) // 2 meses
  })

  it('fraccion de antiguedad mayor a 3 meses redondea el anio hacia arriba para la indemnizacion', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'despido_sin_causa', antiguedadAnios: 3.4, mejorRemuneracionMensualNormal: 600000 })
    expect(r.indemnizacionAntiguedad).toBe(2400000) // ceil(3.4) = 4 * 600000
  })

  it('despido con causa: igual que renuncia, sin indemnizacion ni preaviso', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'despido_con_causa' })
    expect(r.indemnizacionAntiguedad).toBe(0)
    expect(r.preaviso).toBe(0)
  })
})
