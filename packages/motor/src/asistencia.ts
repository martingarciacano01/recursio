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
