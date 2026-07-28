// Exportada para reutilizar el mismo criterio (inclusive de ambos extremos)
// al calcular los días de una liquidación de vacaciones gozadas
// (liquidacionStore.crearPeriodoVacaciones, Liquidaciones individuales).
export function diasEnRango(desde, hasta) {
  return Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1
}

// Agrupa ausencias (nom_v_ausencias, vista de solo lectura de Presencio) en
// justificadas/injustificadas para un año dado. La vista no expone un campo
// "justificada": se usa la misma regla que ya aplica liquidar-periodo/index.ts
// (estado === 'aprobada' => justificada; cualquier otro estado => injustificada).
// El año se determina por fecha_desde: una ausencia que cruza el límite de año
// se atribuye entera al año de inicio, sin dividir los días.
export function agruparAusencias(ausencias, anio) {
  const delAnio = ausencias.filter((a) => a.fecha_desde.slice(0, 4) === String(anio))
  const justificadas = delAnio.filter((a) => a.estado === 'aprobada')
  const injustificadas = delAnio.filter((a) => a.estado !== 'aprobada')
  const sumar = (lista) => lista.reduce((acc, a) => acc + diasEnRango(a.fecha_desde, a.fecha_hasta), 0)
  return {
    justificadas,
    injustificadas,
    totalDiasJustificadas: sumar(justificadas),
    totalDiasInjustificadas: sumar(injustificadas),
  }
}
