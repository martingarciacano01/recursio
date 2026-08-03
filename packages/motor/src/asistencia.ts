export interface DiaAsistencia {
  fecha: string
  horaEntradaEsperada: string | null // null = día no laborable (sáb/dom/feriado)
  horaEntradaReal: string | null
  ausenciaAprobada: boolean
  horasTrabajadas?: number
  esDomingo?: boolean
  esFeriado?: boolean // Task 2.5: feriados desde Presencio (config_json)
  horasExtra50?: number // si vienen precalculadas, tienen prioridad
  horasExtra100?: number
}

export interface ResultadoAsistencia {
  horasTrabajadas: number
  tardanzas: number
  faltasInjustificadas: number
  faltasJustificadas: number
  horasExtra50: number
  horasExtra100: number
  horasFeriado: number
}

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

// Task 2.7: los fichajes se guardan como timestamptz UTC. Antes se extraía
// fecha/hora con `slice` del ISO crudo, así que un fichaje real de 08:30 en
// Buenos Aires (11:30 UTC) aparecía como 11:30 → tardanza espuria (o incluso
// cambio de día, cerca de medianoche). Se convierte explícitamente a
// America/Argentina/Buenos_Aires (UTC-3, sin horario de verano).
const FMT_AR = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
function descomponerTimestamp(timestamp: string): { fecha: string; hora: string } {
  const parts = FMT_AR.formatToParts(new Date(timestamp)).reduce<Record<string, string>>(
    (acc, p) => (p.type !== 'literal' ? { ...acc, [p.type]: p.value } : acc), {})
  const hh = parts.hour === '24' ? '00' : parts.hour
  return { fecha: `${parts.year}-${parts.month}-${parts.day}`, hora: `${hh}:${parts.minute}` }
}

// Task 2.12: si contabiliza HE o no, y topes horarios (diario por ahora —
// semanal/quincena/mes quedan para cuando haya un caso real que los
// necesite, la tabla nom_config_horas ya los contempla).
export interface OpcionesAsistencia {
  contabilizarHorasExtras?: boolean
  topeHorasDiarias?: number
  topeHorasQuincena?: number
  topeHorasMes?: number
}

export function calcularAsistencia(
  dias: DiaAsistencia[],
  toleranciaMinutos: number,
  jornadaHoras = 8,
  opciones: OpcionesAsistencia = {}
): ResultadoAsistencia {
  const resultado: ResultadoAsistencia = {
    horasTrabajadas: 0,
    tardanzas: 0,
    faltasInjustificadas: 0,
    faltasJustificadas: 0,
    horasExtra50: 0,
    horasExtra100: 0,
    horasFeriado: 0,
  }
  const contabilizarHorasExtras = opciones.contabilizarHorasExtras ?? true

  for (const dia of dias) {
    const horas = dia.horasTrabajadas ?? 0
    resultado.horasTrabajadas += horas

    if (dia.horasExtra50 !== undefined || dia.horasExtra100 !== undefined) {
      // Precalculadas (corrección manual futura): tienen prioridad.
      resultado.horasExtra50 += dia.horasExtra50 ?? 0
      resultado.horasExtra100 += dia.horasExtra100 ?? 0
    } else if (dia.esFeriado) {
      // Feriado trabajado (Task 2.5): recargo 100%, no cuenta como extra 50.
      resultado.horasFeriado += horas
    } else if (dia.esDomingo) {
      resultado.horasExtra100 += horas
    } else if (contabilizarHorasExtras && horas > jornadaHoras) {
      // topeHorasDiarias: el excedente por encima del tope no se paga con
      // recargo (queda directamente sin contar, ni como normal ni como
      // extra) — el tope existe para que un exceso desmedido (error de
      // fichaje, jornada mal cerrada) no dispare una hora extra gigante.
      const horasHastaTope = opciones.topeHorasDiarias != null ? Math.min(horas, opciones.topeHorasDiarias) : horas
      resultado.horasExtra50 += horasHastaTope - jornadaHoras
    }

    if (dia.horaEntradaEsperada === null) continue // día no laborable: no hay falta ni tardanza

    if (dia.horaEntradaReal === null) {
      if (dia.ausenciaAprobada) resultado.faltasJustificadas += 1
      else resultado.faltasInjustificadas += 1
      continue
    }

    const esperado = aMinutos(dia.horaEntradaEsperada)
    const real = aMinutos(dia.horaEntradaReal)
    if (real > esperado + toleranciaMinutos) {
      resultado.tardanzas += 1
    }
  }

  return resultado
}

export interface FichajeCrudo {
  tipo: string // 'entrada' | 'salida'
  timestamp: string // ISO
}

export interface AusenciaRango {
  fecha_desde: string
  fecha_hasta: string
}

// Snapshot diario del período: enumera TODOS los días del rango (los días
// sin fichaje también existen — si no, las faltas nunca se cuentan),
// aparea primera entrada / última salida y marca ausencias aprobadas.
export function construirDiasPeriodo(
  fichajes: FichajeCrudo[],
  ausencias: AusenciaRango[],
  fechaDesde: string,
  fechaHasta: string,
  opciones: { fechaIngreso?: string | null; fechaBaja?: string | null; feriados?: Set<string> } = {}
): DiaAsistencia[] {
  const porFecha = new Map<string, { entrada: string | null; salida: string | null }>()
  for (const f of fichajes) {
    const { fecha, hora } = descomponerTimestamp(f.timestamp)
    const dia = porFecha.get(fecha) ?? { entrada: null, salida: null }
    if (f.tipo === 'entrada' && (dia.entrada === null || hora < dia.entrada)) dia.entrada = hora
    if (f.tipo === 'salida' && (dia.salida === null || hora > dia.salida)) dia.salida = hora
    porFecha.set(fecha, dia)
  }

  const dias: DiaAsistencia[] = []
  const d = new Date(fechaDesde + 'T00:00:00Z')
  const fin = new Date(fechaHasta + 'T00:00:00Z')
  while (d <= fin) {
    const fecha = d.toISOString().slice(0, 10)
    // Fuera de la relación laboral (antes de ingresar o después de la
    // baja): no es "falta", es que la persona todavía no era/ya no era
    // personal de la empresa — sin esto, un alta a mitad de mes computaba
    // faltas injustificadas por los días previos al ingreso.
    const dentroDeRelacionLaboral =
      (!opciones.fechaIngreso || fecha >= opciones.fechaIngreso) &&
      (!opciones.fechaBaja || fecha <= opciones.fechaBaja)
    const dow = d.getUTCDay() // 0 = domingo, 6 = sábado
    const esFeriado = Boolean(opciones.feriados?.has(fecha))
    const laborable = dentroDeRelacionLaboral && dow >= 1 && dow <= 5 && !esFeriado
    const reg = porFecha.get(fecha)
    const horas = reg?.entrada && reg?.salida
      ? Math.max(0, (aMinutos(reg.salida) - aMinutos(reg.entrada)) / 60)
      : 0
    dias.push({
      fecha,
      horaEntradaEsperada: laborable ? '08:00' : null,
      horaEntradaReal: reg?.entrada ?? null,
      horasTrabajadas: Math.round(horas * 100) / 100,
      esDomingo: dow === 0,
      esFeriado,
      ausenciaAprobada: ausencias.some((a) => fecha >= a.fecha_desde && fecha <= a.fecha_hasta),
    })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dias
}
