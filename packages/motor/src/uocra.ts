// Reglas propias del régimen UOCRA (Ley 22.250) — Fase 4, Task 27/29.
// Funciones puras, testeables sin Supabase (mismo patrón que asistencia.ts
// y formulas.ts): fondo de desempleo por antigüedad, SAC (mejor
// remuneración del semestre) y liquidación final (sin indemnización —
// el régimen 22.250 no tiene indemnización por despido como la LCT, el
// "Fondo de Cese Laboral" ya se constituyó mes a mes vía el fondo de
// desempleo, ver Task 27).

// Fondo de desempleo: 12% durante el primer año de la relación laboral,
// 8% a partir del segundo año (Ley 22.250, art. 15/16).
export function porcentajeFondoDesempleo(antiguedadAnios: number): number {
  return antiguedadAnios < 1 ? 0.12 : 0.08
}

export function calcularFondoDesempleo(remuneracion: number, antiguedadAnios: number): number {
  return remuneracion * porcentajeFondoDesempleo(antiguedadAnios)
}

// SAC (aguinaldo): 50% de la mejor remuneración mensual, remunerativa +
// no remunerativa, del semestre (art. 1, Ley 23.041). `remuneracionesSemestre`
// son los brutos remunerativos+no remunerativos de cada mes liquidado en
// el semestre correspondiente (hasta 6 valores).
export function calcularSAC(remuneracionesSemestre: number[]): number {
  if (remuneracionesSemestre.length === 0) return 0
  const mejor = Math.max(...remuneracionesSemestre)
  return mejor / 2
}

// SAC proporcional: para liquidación final, si no se trabajó el semestre
// completo. diasTrabajadosSemestre / diasDelSemestre (normalmente 182 o
// 183) * SAC completo calculado sobre la mejor remuneración disponible.
export function calcularSACProporcional(mejorRemuneracion: number, diasTrabajadosSemestre: number, diasDelSemestre = 182): number {
  const sacCompleto = mejorRemuneracion / 2
  return sacCompleto * (diasTrabajadosSemestre / diasDelSemestre)
}

// Vacaciones no gozadas (liquidación final): días proporcionales según
// antigüedad (misma escala que LCT art. 150, usada también en 22.250) por
// el salario diario (remuneración mensual / 25, divisor convencional
// construcción).
export function diasVacacionesPorAntiguedad(antiguedadAnios: number): number {
  if (antiguedadAnios < 5) return 14
  if (antiguedadAnios < 10) return 21
  if (antiguedadAnios < 20) return 28
  return 35
}

export function calcularVacacionesNoGozadas(remuneracionMensual: number, diasNoGozados: number, divisorDiario = 25): number {
  const salarioDiario = remuneracionMensual / divisorDiario
  return salarioDiario * diasNoGozados
}

export interface LiquidacionFinalInput {
  remuneracionMensual: number
  antiguedadAnios: number
  diasVacacionesNoGozados: number
  mejorRemuneracionSemestre: number
  diasTrabajadosSemestre: number
}

export interface LiquidacionFinalResultado {
  vacacionesNoGozadas: number
  sacProporcional: number
  total: number
}

// Liquidación final régimen 22.250: SIN indemnización por despido (el
// Fondo de Cese Laboral cubre esa función y se retira aparte, no es un
// cálculo de esta liquidación) — solo vacaciones no gozadas + SAC
// proporcional (Task 29).
export function calcularLiquidacionFinal(input: LiquidacionFinalInput): LiquidacionFinalResultado {
  const vacacionesNoGozadas = calcularVacacionesNoGozadas(input.remuneracionMensual, input.diasVacacionesNoGozados)
  const sacProporcional = calcularSACProporcional(input.mejorRemuneracionSemestre, input.diasTrabajadosSemestre)
  return { vacacionesNoGozadas, sacProporcional, total: vacacionesNoGozadas + sacProporcional }
}
