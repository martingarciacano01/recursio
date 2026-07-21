export interface DiaAsistencia {
  fecha: string
  horaEntradaEsperada: string | null // null = día no laborable (sáb/dom)
  horaEntradaReal: string | null
  ausenciaAprobada: boolean
  horasTrabajadas?: number
  esDomingo?: boolean
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
}

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

export function calcularAsistencia(
  dias: DiaAsistencia[],
  toleranciaMinutos: number,
  jornadaHoras = 8
): ResultadoAsistencia {
  const resultado: ResultadoAsistencia = {
    horasTrabajadas: 0,
    tardanzas: 0,
    faltasInjustificadas: 0,
    faltasJustificadas: 0,
    horasExtra50: 0,
    horasExtra100: 0,
  }

  for (const dia of dias) {
    const horas = dia.horasTrabajadas ?? 0
    resultado.horasTrabajadas += horas

    if (dia.horasExtra50 !== undefined || dia.horasExtra100 !== undefined) {
      // Precalculadas (corrección manual futura): tienen prioridad.
      resultado.horasExtra50 += dia.horasExtra50 ?? 0
      resultado.horasExtra100 += dia.horasExtra100 ?? 0
    } else if (dia.esDomingo) {
      resultado.horasExtra100 += horas
    } else if (horas > jornadaHoras) {
      resultado.horasExtra50 += horas - jornadaHoras
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
  fechaHasta: string
): DiaAsistencia[] {
  const porFecha = new Map<string, { entrada: string | null; salida: string | null }>()
  for (const f of fichajes) {
    const fecha = f.timestamp.slice(0, 10)
    const hora = f.timestamp.slice(11, 16)
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
    const dow = d.getUTCDay() // 0 = domingo, 6 = sábado
    const laborable = dow >= 1 && dow <= 5
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
      ausenciaAprobada: ausencias.some((a) => fecha >= a.fecha_desde && fecha <= a.fecha_hasta),
    })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dias
}
