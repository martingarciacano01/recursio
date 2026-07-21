import { describe, it, expect } from 'vitest'
import { calcularAsistencia } from './asistencia'

describe('calcularAsistencia', () => {
  it('cuenta tardanza cuando la entrada real supera la tolerancia', () => {
    const dias = [
      { fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:20', ausenciaAprobada: false },
    ]
    const r = calcularAsistencia(dias, 15) // tolerancia 15 min
    expect(r.tardanzas).toBe(1)
  })

  it('no cuenta tardanza si la diferencia está dentro de la tolerancia', () => {
    const dias = [
      { fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:10', ausenciaAprobada: false },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.tardanzas).toBe(0)
  })

  it('falta sin ausencia aprobada cuenta como injustificada', () => {
    const dias = [
      { fecha: '2026-02-03', horaEntradaEsperada: '08:00', horaEntradaReal: null, ausenciaAprobada: false },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.faltasInjustificadas).toBe(1)
  })

  it('falta con ausencia aprobada NO cuenta como injustificada', () => {
    const dias = [
      { fecha: '2026-02-03', horaEntradaEsperada: '08:00', horaEntradaReal: null, ausenciaAprobada: true },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.faltasInjustificadas).toBe(0)
  })

  it('días no laborables (sin horaEntradaEsperada) no suman ni tardanza ni falta', () => {
    const dias = [
      { fecha: '2026-02-07', horaEntradaEsperada: null, horaEntradaReal: null, ausenciaAprobada: false },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.tardanzas).toBe(0)
    expect(r.faltasInjustificadas).toBe(0)
  })

  it('suma horas extra 50 y 100 de todos los días', () => {
    const dias = [
      { fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasExtra50: 2, horasExtra100: 0 },
      { fecha: '2026-02-03', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasExtra50: 1, horasExtra100: 3 },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.horasExtra50).toBe(3)
    expect(r.horasExtra100).toBe(3)
  })
})
