export interface ParamsBasicoPeriodo {
  modalidad: 'hora' | 'mensual' | 'quincenal'
  basico: number
  tipoPeriodo: 'mensual' | 'quincenal' | string
  horasTrabajadas: number
  faltasInjustificadas: number
}

// horasLiquidadas / valorHora solo tienen sentido para modalidad 'hora'
// (BASE × UNIDAD = MONTO en el recibo, ver motor.ts config.recibo.
// unidadFormula/baseFormula); en mensual/quincenal quedan en 0 — esas
// modalidades exponen su propia unidad/base genéricas
// (unidad_basico/base_basico) desde la Edge Function, no desde acá.
export interface ResultadoBasicoPeriodo {
  monto: number
  horasLiquidadas: number
  valorHora: number
}

// Base del concepto "básico" según cómo se pactó el sueldo en la escala
// (jornal por hora, mensual fijo, o quincenal fijo) versus el tipo de
// período que se está liquidando. Nunca devuelve 0 en silencio ante una
// modalidad no contemplada: lanza para que el llamador lo reporte.
//
// Firma cambiada a propósito (antes devolvía un escalar): ahora devuelve
// también horasLiquidadas y valorHora para que BASE × UNIDAD = MONTO sea
// verificable en el recibo (antes UNIDAD y BASE del básico salían vacías
// en el PDF, ver plan 2026-07-29 §2). El redondeo hacia arriba de las horas
// (Math.ceil) AFECTA el cálculo, no solo el texto impreso: un jornalizado
// que trabajó 71,26 h cobra 72 h completas.
export function calcularBasicoPeriodo(p: ParamsBasicoPeriodo): ResultadoBasicoPeriodo {
  if (p.modalidad === 'hora') {
    const horasLiquidadas = Math.ceil(p.horasTrabajadas)
    return { monto: p.basico * horasLiquidadas, horasLiquidadas, valorHora: p.basico }
  }
  if (p.modalidad === 'mensual') {
    const base = p.tipoPeriodo === 'quincenal' ? p.basico / 2 : p.basico
    const monto = base - p.faltasInjustificadas * (p.basico / 30)
    return { monto, horasLiquidadas: 0, valorHora: 0 }
  }
  if (p.modalidad === 'quincenal') {
    const base = p.tipoPeriodo === 'mensual' ? p.basico * 2 : p.basico
    const monto = base - p.faltasInjustificadas * (p.basico / 15)
    return { monto, horasLiquidadas: 0, valorHora: 0 }
  }
  throw new Error(`modalidad desconocida: ${p.modalidad}`)
}
