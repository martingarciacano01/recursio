export interface DiaAsistencia {
  fecha: string
  horaEntradaEsperada: string | null
  horaEntradaReal: string | null
  ausenciaAprobada: boolean
  horasExtra50?: number
  horasExtra100?: number
}

export interface ResultadoAsistencia {
  tardanzas: number
  faltasInjustificadas: number
  horasExtra50: number
  horasExtra100: number
}

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

export function calcularAsistencia(
  dias: DiaAsistencia[],
  toleranciaMinutos: number
): ResultadoAsistencia {
  const resultado: ResultadoAsistencia = {
    tardanzas: 0,
    faltasInjustificadas: 0,
    horasExtra50: 0,
    horasExtra100: 0,
  }

  for (const dia of dias) {
    resultado.horasExtra50 += dia.horasExtra50 ?? 0
    resultado.horasExtra100 += dia.horasExtra100 ?? 0

    if (dia.horaEntradaEsperada === null) {
      continue
    }

    if (dia.horaEntradaReal === null) {
      if (!dia.ausenciaAprobada) {
        resultado.faltasInjustificadas += 1
      }
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
