// Generador de fórmulas para el formulario estructurado de conceptos.
// Es la ÚNICA vía por la que la UI produce fórmulas: el usuario nunca
// tipea una fórmula libre (spec 2026-07-21, sección 5). Módulo puro y
// autocontenido para que el bundle del cliente no arrastre el motor.

export interface ConfigConcepto {
  modo: 'porcentaje' | 'nominal'
  porcentaje?: number
  base?: 'remunerativo' | 'no_remunerativo' | 'ambos'
  tope?: string | null
  monto?: number
}

const BASES: Record<string, string> = {
  remunerativo: 'remunerativo_acumulado',
  no_remunerativo: 'no_remunerativo_acumulado',
  ambos: '(remunerativo_acumulado + no_remunerativo_acumulado)',
}

export function generarFormula(config: ConfigConcepto): string {
  if (config.modo === 'nominal') {
    if (typeof config.monto !== 'number' || !Number.isFinite(config.monto)) {
      throw new Error('config nominal requiere monto numérico')
    }
    return String(config.monto)
  }
  if (typeof config.porcentaje !== 'number' || !Number.isFinite(config.porcentaje)) {
    throw new Error('config porcentual requiere porcentaje numérico')
  }
  const base = BASES[config.base ?? 'remunerativo']
  if (!base) throw new Error(`base desconocida: ${config.base}`)
  const baseConTope = config.tope ? `min(${base}, ${config.tope})` : base
  return `${baseConTope} * ${config.porcentaje / 100}`
}
