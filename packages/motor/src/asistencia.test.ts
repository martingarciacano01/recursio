import { describe, it, expect } from 'vitest'
import { calcularAsistencia, construirDiasPeriodo } from './asistencia'

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

describe('construirDiasPeriodo', () => {
  // Task 2.7: timestamps en UTC real (los fichajes se guardan como
  // timestamptz UTC). Los horarios "documentados" en los comentarios/tests
  // (08:33, 18:33, 09:00) son la hora de Buenos Aires (UTC-3) — de ahí el
  // +3h al escribirlos acá.
  const fichajes = [
    { tipo: 'entrada', timestamp: '2026-06-15T11:33:00Z' }, // 08:33 AR
    { tipo: 'salida', timestamp: '2026-06-15T21:33:00Z' }, // 18:33 AR
    { tipo: 'entrada', timestamp: '2026-06-17T12:00:00Z' }, // 09:00 AR, sin salida
  ]

  it('enumera todos los días del rango y aparea entrada/salida', () => {
    // 2026-06-15 es lunes; rango lunes a viernes
    const dias = construirDiasPeriodo(fichajes, [], '2026-06-15', '2026-06-19')
    expect(dias).toHaveLength(5)
    expect(dias[0]).toMatchObject({ fecha: '2026-06-15', horaEntradaReal: '08:33', horasTrabajadas: 10, horaEntradaEsperada: '08:00' })
    expect(dias[1]).toMatchObject({ fecha: '2026-06-16', horaEntradaReal: null, horaEntradaEsperada: '08:00' })
    expect(dias[2]).toMatchObject({ fecha: '2026-06-17', horaEntradaReal: '09:00', horasTrabajadas: 0 })
  })

  it('marca fin de semana como no esperado y domingo con esDomingo', () => {
    const dias = construirDiasPeriodo([], [], '2026-06-20', '2026-06-21') // sáb y dom
    expect(dias[0].horaEntradaEsperada).toBeNull()
    expect(dias[0].esDomingo).toBe(false)
    expect(dias[1].horaEntradaEsperada).toBeNull()
    expect(dias[1].esDomingo).toBe(true)
  })

  it('marca ausencia aprobada en el rango', () => {
    const dias = construirDiasPeriodo([], [{ fecha_desde: '2026-06-16', fecha_hasta: '2026-06-16' }], '2026-06-15', '2026-06-17')
    expect(dias.map((d) => d.ausenciaAprobada)).toEqual([false, true, false])
  })

  it('ausencia parcial: cubre solo algunos días del rango de días consultado', () => {
    // rango de días 15 al 19, ausencia solo el 16 y 17 (parcial dentro del período)
    const dias = construirDiasPeriodo([], [{ fecha_desde: '2026-06-16', fecha_hasta: '2026-06-17' }], '2026-06-15', '2026-06-19')
    expect(dias.map((d) => d.ausenciaAprobada)).toEqual([false, true, true, false, false])
  })

  it('ausencia que empieza antes del período y termina adentro sigue contando los días dentro del rango', () => {
    // la ausencia arrancó el 06-10 (antes del período) y termina el 06-16 (adentro)
    const dias = construirDiasPeriodo([], [{ fecha_desde: '2026-06-10', fecha_hasta: '2026-06-16' }], '2026-06-15', '2026-06-17')
    expect(dias.map((d) => d.ausenciaAprobada)).toEqual([true, true, false])
  })

  it('integración: faltas y extras del período con calcularAsistencia', () => {
    const dias = construirDiasPeriodo(fichajes, [{ fecha_desde: '2026-06-16', fecha_hasta: '2026-06-16' }], '2026-06-15', '2026-06-19')
    const r = calcularAsistencia(dias, 15)
    expect(r.horasTrabajadas).toBe(10)
    expect(r.horasExtra50).toBe(2)
    expect(r.faltasJustificadas).toBe(1) // 16/06
    expect(r.faltasInjustificadas).toBe(2) // 18 y 19/06 (el 17 tiene entrada)
    expect(r.tardanzas).toBe(2) // 08:33 y 09:00
  })

  it('persona sin ningún fichaje ni ausencia aprobada: 0 horas y 0 días con ausencia aprobada', () => {
    const dias = construirDiasPeriodo([], [], '2026-06-01', '2026-06-05')
    const r = calcularAsistencia(dias, 15)
    const diasConAusenciaAprobada = dias.filter((d) => d.ausenciaAprobada).length
    expect(r.horasTrabajadas).toBe(0)
    expect(diasConAusenciaAprobada).toBe(0)
  })

  it('persona de vacaciones todo el período: 0 horas pero SÍ tiene días con ausencia aprobada', () => {
    const dias = construirDiasPeriodo([], [{ fecha_desde: '2026-06-01', fecha_hasta: '2026-06-05' }], '2026-06-01', '2026-06-05')
    const r = calcularAsistencia(dias, 15)
    const diasConAusenciaAprobada = dias.filter((d) => d.ausenciaAprobada).length
    expect(r.horasTrabajadas).toBe(0)
    expect(diasConAusenciaAprobada).toBeGreaterThan(0)
  })

  it('días anteriores a fechaIngreso no son laborables (no cuentan como falta)', () => {
    const dias = construirDiasPeriodo([], [], '2026-06-01', '2026-06-10', { fechaIngreso: '2026-06-05' })
    const antesDeIngresar = dias.filter((d) => d.fecha < '2026-06-05')
    const desdeIngreso = dias.filter((d) => d.fecha >= '2026-06-05')
    expect(antesDeIngresar.every((d) => d.horaEntradaEsperada === null)).toBe(true)
    // Desde el ingreso, los días de semana siguen siendo laborables (esto no cambia).
    expect(desdeIngreso.some((d) => d.horaEntradaEsperada !== null)).toBe(true)
  })

  it('días posteriores a fechaBaja no son laborables', () => {
    const dias = construirDiasPeriodo([], [], '2026-06-01', '2026-06-10', { fechaBaja: '2026-06-05' })
    const despuesDeBaja = dias.filter((d) => d.fecha > '2026-06-05')
    expect(despuesDeBaja.every((d) => d.horaEntradaEsperada === null)).toBe(true)
  })

  it('sin fechaIngreso/fechaBaja, se comporta exactamente igual que antes', () => {
    const dias = construirDiasPeriodo([], [], '2026-06-01', '2026-06-05')
    expect(dias.every((d) => d.fecha < '2026-06-06')).toBe(true)
    expect(dias.filter((d) => d.horaEntradaEsperada !== null).length).toBeGreaterThan(0)
  })
})

describe('opciones de horas extra (Task 2.12, config por empresa)', () => {
  it('contabilizarHorasExtras=false: el exceso sobre la jornada no se paga con recargo', () => {
    const dias = [{ fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasTrabajadas: 10 }]
    const r = calcularAsistencia(dias, 15, 8, { contabilizarHorasExtras: false })
    expect(r.horasExtra50).toBe(0)
    expect(r.horasTrabajadas).toBe(10) // las horas trabajadas se siguen contando, solo no llevan recargo
  })

  it('con contabilizarHorasExtras=true (default) el exceso sigue pagando extra 50', () => {
    const dias = [{ fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasTrabajadas: 10 }]
    const r = calcularAsistencia(dias, 15, 8)
    expect(r.horasExtra50).toBe(2)
  })

  it('topeHorasDiarias: el excedente sobre el tope no cuenta como extra', () => {
    const dias = [{ fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasTrabajadas: 14 }]
    const r = calcularAsistencia(dias, 15, 8, { topeHorasDiarias: 12 })
    expect(r.horasExtra50).toBe(4) // 12 (tope) - 8 (jornada) = 4, no 6
  })

  it('topeHorasDiarias también recorta horasTrabajadas (Item 2, plan convenios-por-obra)', () => {
    const dias = [{ fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasTrabajadas: 14 }]
    const r = calcularAsistencia(dias, 15, 8, { topeHorasDiarias: 12 })
    // El excedente sobre el tope queda fuera de las horas trabajadas del
    // período (ni normal ni extra): no se paga en silencio vía el básico.
    expect(r.horasTrabajadas).toBe(12)
  })

  it('topeHorasDiarias por debajo de la jornada: las horas trabajadas se cortan en el tope', () => {
    const dias = [{ fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasTrabajadas: 10 }]
    const r = calcularAsistencia(dias, 15, 8, { topeHorasDiarias: 8 })
    expect(r.horasTrabajadas).toBe(8)
    expect(r.horasExtra50).toBe(0) // nada por encima del tope: ni normal ni recargo
  })

  it('jornada UOCRA de 9h: 9h trabajadas no generan extra', () => {
    const dias = [{ fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasTrabajadas: 9 }]
    const r = calcularAsistencia(dias, 15, 9)
    expect(r.horasExtra50).toBe(0)
  })
})

describe('zona horaria Argentina (Task 2.7)', () => {
  it('fichaje UTC 11:05 se interpreta como 08:05 en Buenos Aires, dentro de tolerancia (no tardanza espuria)', () => {
    // Sin el fix (slice crudo del ISO UTC), la hora quedaría "11:05" — muy
    // por encima de la tolerancia de 15 min sobre 08:00 — y marcaría una
    // tardanza que en la realidad (hora AR) no existió.
    const dias = construirDiasPeriodo(
      [{ tipo: 'entrada', timestamp: '2026-06-15T11:05:00Z' }, { tipo: 'salida', timestamp: '2026-06-15T20:00:00Z' }],
      [], '2026-06-15', '2026-06-15'
    )
    expect(dias[0].fecha).toBe('2026-06-15')
    expect(dias[0].horaEntradaReal).toBe('08:05')
    const r = calcularAsistencia(dias, 15)
    expect(r.tardanzas).toBe(0)
  })
})

describe('feriados (Task 2.5, desde Presencio)', () => {
  it('feriado entre semana NO cuenta falta si no se trabajó', () => {
    const dias = construirDiasPeriodo([], [], '2026-05-25', '2026-05-25', { feriados: new Set(['2026-05-25']) })
    expect(dias[0].horaEntradaEsperada).toBeNull()
    const r = calcularAsistencia(dias, 15)
    expect(r.faltasInjustificadas).toBe(0)
  })

  it('feriado trabajado suma horasFeriado (recargo 100%) y no extra 50', () => {
    const dias = construirDiasPeriodo([{ tipo: 'entrada', timestamp: '2026-05-25T08:00:00+00:00' },
      { tipo: 'salida', timestamp: '2026-05-25T17:00:00+00:00' }], [], '2026-05-25', '2026-05-25',
      { feriados: new Set(['2026-05-25']) })
    const r = calcularAsistencia(dias, 15)
    expect(r.horasFeriado).toBe(9)
    expect(r.horasExtra50).toBe(0)
  })

  it('empresa sin feriados configurados: se comporta como hoy', () => {
    const dias = construirDiasPeriodo([], [], '2026-05-25', '2026-05-25')
    expect(dias[0].horaEntradaEsperada).toBe('08:00') // día normal
  })
})
