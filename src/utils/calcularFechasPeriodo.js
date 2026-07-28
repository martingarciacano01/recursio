// Deriva fecha_desde/fecha_hasta de un período a partir de año, mes, tipo y
// el convenio al que pertenece (o null para mensual_fc, que no depende de
// ningún convenio — fuera de convenio siempre es 1 a fin de mes real).
// Función pura: sin Supabase, testeable sola. Fase "períodos por convenio".

const pad2 = (n) => String(n).padStart(2, '0')
const fmt = (anio, mes, dia) => `${anio}-${pad2(mes)}-${pad2(dia)}`

// Último día real del mes (resuelve automáticamente febrero 28/29 y los
// meses de 30 días, sin fechas hardcodeadas).
function ultimoDiaDelMes(anio, mes) {
  return new Date(anio, mes, 0).getDate()
}

// `hasta` NULL o mayor al último día real se recorta a ese último día.
function resolverDia(dia, ultimoDia) {
  if (dia == null) return ultimoDia
  return Math.min(dia, ultimoDia)
}

export function calcularFechasPeriodo({ anio, mes, tipo, convenio }) {
  const ultimoDia = ultimoDiaDelMes(anio, mes)

  if (tipo === 'mensual_fc') {
    return { fechaDesde: fmt(anio, mes, 1), fechaHasta: fmt(anio, mes, ultimoDia) }
  }

  if (!['quincena_1', 'quincena_2', 'mensual'].includes(tipo)) {
    throw new Error(`calcularFechasPeriodo: tipo desconocido '${tipo}'`)
  }

  if (convenio == null) {
    throw new Error(`calcularFechasPeriodo: falta convenio para tipo '${tipo}'`)
  }

  if (tipo === 'quincena_1') {
    return {
      fechaDesde: fmt(anio, mes, resolverDia(convenio.corteQ1Desde, ultimoDia)),
      fechaHasta: fmt(anio, mes, resolverDia(convenio.corteQ1Hasta, ultimoDia)),
    }
  }

  if (tipo === 'quincena_2') {
    return {
      fechaDesde: fmt(anio, mes, resolverDia(convenio.corteQ2Desde, ultimoDia)),
      fechaHasta: fmt(anio, mes, resolverDia(convenio.corteQ2Hasta, ultimoDia)),
    }
  }

  // 'mensual'
  return {
    fechaDesde: fmt(anio, mes, resolverDia(convenio.corteMensualDesde, ultimoDia)),
    fechaHasta: fmt(anio, mes, resolverDia(convenio.corteMensualHasta, ultimoDia)),
  }
}
