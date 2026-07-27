// Reglas del régimen LCT (Ley 20.744) generalizadas a cualquier convenio
// que NO sea 22.250 (ver packages/motor/src/uocra.ts para ese régimen).
// Funciones puras: no leen DB, reciben todo resuelto (mismo patrón que
// uocra.ts y asistencia.ts).

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

// Días de vacaciones por antigüedad (art. 150 LCT). Reexportado desde
// uocra.ts porque la escala es idéntica en ambos regímenes — no duplicar
// la tabla de tramos en dos archivos (DRY).
export { diasVacacionesPorAntiguedad }

export function calcularVacaciones(input: VacacionesInput): VacacionesResultado {
  const dias = input.antiguedadAnios < 0.5
    ? Math.floor(input.diasTrabajadosAnio / 20)
    : diasVacacionesPorAntiguedad(input.antiguedadAnios)
  const montoDia = input.modalidad === 'hora'
    ? (input.valorHora ?? 0) * 8
    : (input.sueldoMensual ?? 0) / 25
  return { dias, montoDia, total: dias * montoDia }
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
