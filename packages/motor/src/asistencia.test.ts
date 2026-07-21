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

describe('horas trabajadas, faltas justificadas y extras derivadas', () => {
  it('suma horas trabajadas y deriva extra 50 sobre la jornada', () => {
    const r = calcularAsistencia(
      [
        { fecha: '2026-06-15', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', horasTrabajadas: 10, ausenciaAprobada: false },
        { fecha: '2026-06-16', horaEntradaEsperada: '08:00', horaEntradaReal: '08:05', horasTrabajadas: 8, ausenciaAprobada: false },
      ],
      15
    )
    expect(r.horasTrabajadas).toBe(18)
    expect(r.horasExtra50).toBe(2)
    expect(r.horasExtra100).toBe(0)
  })

  it('las horas de domingo van todas al 100%', () => {
    const r = calcularAsistencia(
      [{ fecha: '2026-06-21', horaEntradaEsperada: null, horaEntradaReal: '09:00', horasTrabajadas: 5, esDomingo: true, ausenciaAprobada: false }],
      15
    )
    expect(r.horasExtra100).toBe(5)
    expect(r.horasExtra50).toBe(0)
  })

  it('falta con ausencia aprobada cuenta como justificada, sin ausencia como injustificada', () => {
    const r = calcularAsistencia(
      [
        { fecha: '2026-06-15', horaEntradaEsperada: '08:00', horaEntradaReal: null, ausenciaAprobada: true },
        { fecha: '2026-06-16', horaEntradaEsperada: '08:00', horaEntradaReal: null, ausenciaAprobada: false },
      ],
      15
    )
    expect(r.faltasJustificadas).toBe(1)
    expect(r.faltasInjustificadas).toBe(1)
  })

  it('jornada parcial (4h) genera extra 50 sobre 4 horas', () => {
    const r = calcularAsistencia(
      [{ fecha: '2026-06-15', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', horasTrabajadas: 6, ausenciaAprobada: false }],
      15,
      4
    )
    expect(r.horasExtra50).toBe(2)
  })
})
