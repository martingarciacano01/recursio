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

// Cuenta los días "falta sin fichaje" que devuelve construirDiasPeriodo
// (packages/motor/src/asistencia.ts): día laborable, sin entrada registrada
// y sin ninguna ausencia (licencia) que lo cubra. Es la MISMA regla que usa
// calcularAsistencia para descontar faltasInjustificadas en la liquidación,
// y coincide con lo que Presencio llama "FALTA NO JUSTIFICADA"/"faltas no
// justificadas" en su pantalla de Reportes — a diferencia de
// agruparAusencias (arriba), que solo mira licencias explícitas cargadas en
// la tabla `ausencias` (casi siempre 0, porque una falta sin aviso nunca se
// carga como licencia). "Injustificadas" en la pestaña Ausencias del legajo
// usa esto, no la tabla `ausencias`, para coincidir con el número que
// Martin ve en Presencio (2026-07-30: "fijate que no dan lo mismo" — el
// motivo era justamente que antes se usaba la tabla, casi siempre vacía).
export function contarFaltasSinFichaje(dias) {
  return dias.filter(
    (d) => d.horaEntradaEsperada !== null && d.horaEntradaReal === null && !d.ausenciaAprobada
  ).length
}
