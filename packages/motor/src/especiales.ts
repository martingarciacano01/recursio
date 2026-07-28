// Reglas del régimen LCT (Ley 20.744) generalizadas a cualquier convenio
// que NO sea 22.250 (ver packages/motor/src/uocra.ts para ese régimen).
// Funciones puras: no leen DB, reciben todo resuelto (mismo patrón que
// uocra.ts y asistencia.ts).

// Días de vacaciones por antigüedad (art. 150 LCT): reexportado directo de
// uocra.ts porque la escala es idéntica en ambos regímenes — no duplicar
// la tabla de tramos en dos archivos (DRY).
export { diasVacacionesPorAntiguedad } from './uocra.ts'
import { diasVacacionesPorAntiguedad } from './uocra.ts'

export interface SACInput {
  mejoresBrutosPorMes: number[] // bruto (remunerativo + no remunerativo) de cada mes liquidado en el semestre
  diasTrabajadosSemestre: number
  diasSemestre?: number // normalmente 182 o 183
}

// Art. 121 LCT: 50% de la mejor remuneración mensual, normal y habitual,
// devengada en el semestre, proporcional a los días trabajados si el
// semestre no se trabajó completo (ingreso/egreso a mitad de semestre).
export function calcularSAC(input: SACInput): number {
  const { mejoresBrutosPorMes, diasTrabajadosSemestre, diasSemestre = 182 } = input
  if (mejoresBrutosPorMes.length === 0) return 0
  const mejorBruto = Math.max(...mejoresBrutosPorMes)
  return (mejorBruto / 2) * (diasTrabajadosSemestre / diasSemestre)
}

export interface VacacionesInput {
  antiguedadAnios: number
  diasTrabajadosAnio: number
  modalidad: 'mensual' | 'quincenal' | 'hora'
  sueldoMensual?: number // requerido si modalidad !== 'hora'
  valorHora?: number // requerido si modalidad === 'hora'
}

export interface VacacionesResultado {
  dias: number
  montoDia: number
  total: number
}

export interface ValorDiaVacacionesInput {
  modalidad: 'mensual' | 'quincenal' | 'hora'
  sueldoMensual?: number // requerido si modalidad !== 'hora'
  valorHora?: number // requerido si modalidad === 'hora'
}

// Valor de un día de vacaciones, sin antigüedad — se usa tanto para el
// total "no gozadas" (calcularVacaciones, multiplicado por los días que
// corresponden por antigüedad) como para "gozadas" (montoVacacionesGozadas,
// multiplicado por los días reales de la ausencia — Liquidaciones
// individuales, Fase 6b).
export function valorDiaVacaciones(input: ValorDiaVacacionesInput): number {
  return input.modalidad === 'hora'
    ? (input.valorHora ?? 0) * 8
    : (input.sueldoMensual ?? 0) / 25
}

export function calcularVacaciones(input: VacacionesInput): VacacionesResultado {
  // Art. 153 LCT: con menos de 6 meses de antigüedad, 1 día de descanso
  // cada 20 trabajados, en vez de la escala fija del art. 150.
  const dias = input.antiguedadAnios < 0.5
    ? Math.floor(input.diasTrabajadosAnio / 20)
    : diasVacacionesPorAntiguedad(input.antiguedadAnios)
  const montoDia = valorDiaVacaciones(input)
  return { dias, montoDia, total: dias * montoDia }
}

// Días inclusive de ambos extremos — mismo criterio que agruparAusencias.js
// (src/utils/agruparAusencias.js) del lado del cliente.
export function diasEnRango(fechaDesde: string, fechaHasta: string): number {
  return Math.round((new Date(fechaHasta).getTime() - new Date(fechaDesde).getTime()) / 86400000) + 1
}

export interface VacacionesGozadasInput extends ValorDiaVacacionesInput {
  fechaDesde: string
  fechaHasta: string
}

// Vacaciones GOZADAS (Liquidaciones individuales, Fase 6b): a diferencia de
// calcularVacaciones (que paga el total de días que corresponden por
// antigüedad, para "no gozadas" en la liquidación final), acá el monto sale
// de los días REALES de la ausencia tipo 'vacaciones' aprobada en Presencio
// (o de un rango cargado a mano si no hay ausencia) — no de una fórmula de
// antigüedad. La liquidación final no usa esta función.
export function montoVacacionesGozadas(input: VacacionesGozadasInput): number {
  const dias = diasEnRango(input.fechaDesde, input.fechaHasta)
  return dias * valorDiaVacaciones(input)
}

export type MotivoBaja = 'renuncia' | 'despido_sin_causa' | 'despido_con_causa' | 'fin_obra' | 'mutuo_acuerdo' | 'fallecimiento'

export interface LiquidacionFinalInputLCT {
  motivoBaja: MotivoBaja
  diasTrabajadosMes: number
  sueldoMensual: number
  sacProporcional: number
  vacacionesNoGozadas: number
  antiguedadAnios: number
  mejorRemuneracionMensualNormal: number // base del art. 245 LCT
}

export interface LiquidacionFinalResultadoLCT {
  diasTrabajadosMes: number
  montoDiasTrabajadosMes: number
  sacProporcional: number
  vacacionesNoGozadas: number
  indemnizacionAntiguedad: number
  preaviso: number
  total: number
}

// Régimen LCT (Ley 20.744), a diferencia de 22.250 (uocra.ts):
// - despido_sin_causa: indemnización por antigüedad (art. 245, 1 sueldo
//   por año o fracción > 3 meses, base = mejor remuneración mensual
//   normal y habitual) + preaviso (art. 231: 1 mes si antigüedad < 5
//   años, 2 meses si >= 5 años).
// - renuncia / despido_con_causa / fin_obra / mutuo_acuerdo / fallecimiento:
//   sin indemnización ni preaviso — solo los rubros comunes.
export function calcularLiquidacionFinal(input: LiquidacionFinalInputLCT): LiquidacionFinalResultadoLCT {
  const montoDiasTrabajadosMes = (input.sueldoMensual / 30) * input.diasTrabajadosMes
  let indemnizacionAntiguedad = 0
  let preaviso = 0

  if (input.motivoBaja === 'despido_sin_causa') {
    const aniosEnteros = Math.floor(input.antiguedadAnios)
    const fraccion = input.antiguedadAnios - aniosEnteros
    const aniosIndemnizables = fraccion > 0.25 ? aniosEnteros + 1 : Math.max(aniosEnteros, 1)
    indemnizacionAntiguedad = aniosIndemnizables * input.mejorRemuneracionMensualNormal
    preaviso = input.antiguedadAnios >= 5 ? input.mejorRemuneracionMensualNormal * 2 : input.mejorRemuneracionMensualNormal
  }

  const total = montoDiasTrabajadosMes + input.sacProporcional + input.vacacionesNoGozadas + indemnizacionAntiguedad + preaviso
  return {
    diasTrabajadosMes: input.diasTrabajadosMes, montoDiasTrabajadosMes,
    sacProporcional: input.sacProporcional, vacacionesNoGozadas: input.vacacionesNoGozadas,
    indemnizacionAntiguedad, preaviso, total,
  }
}
