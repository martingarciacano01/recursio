// packages/motor/golden/conceptos-fuera-convenio.ts
import type { Concepto } from '../src/motor'

export const CONCEPTOS_FUERA_CONVENIO: Concepto[] = [
  { codigo: 'basico', nombre: 'Sueldo básico', tipo: 'remunerativo', orden: 1, formula: 'basico_convenio', imprimible: true },
  {
    codigo: 'presentismo', nombre: 'Presentismo', tipo: 'remunerativo', orden: 2,
    formula: 'remunerativo_acumulado * 0.0833', imprimible: true,
    reglas: [
      { orden: 1, condicion: 'tardanzas > 3 or faltas_injustificadas > 0', formula: '0' },
      { orden: 2, condicion: 'tardanzas > 1', formula: 'remunerativo_acumulado * 0.0833 * 0.5' },
    ],
  },
  { codigo: 'hora_extra_50', nombre: 'Hora extra 50%', tipo: 'remunerativo', orden: 3, formula: '(basico_convenio / 200) * 1.5 * horas_extra_50', imprimible: true },
  { codigo: 'hora_extra_100', nombre: 'Hora extra 100%', tipo: 'remunerativo', orden: 4, formula: '(basico_convenio / 200) * 2 * horas_extra_100', imprimible: true },
  { codigo: 'adelanto', nombre: 'Adelanto de sueldo', tipo: 'descuento', orden: 5, formula: 'adelanto_monto', imprimible: true },
  { codigo: 'jubilacion', nombre: 'Jubilación', tipo: 'descuento', orden: 6, formula: 'round(min(remunerativo_acumulado, tope_sipa) * 0.11)', imprimible: true },
  { codigo: 'ley_19032', nombre: 'Ley 19.032 (INSSJP/PAMI)', tipo: 'descuento', orden: 7, formula: 'round(remunerativo_acumulado * 0.03)', imprimible: true },
  { codigo: 'obra_social', nombre: 'Obra social', tipo: 'descuento', orden: 8, formula: 'round(remunerativo_acumulado * 0.03)', imprimible: true },
]

// Recibos como los de "SAC", "Vacaciones" o un mes de "Sueldo" fuera de
// convenio se liquidan como un ÚNICO concepto remunerativo (no desglosan
// básico + presentismo + horas extra por separado) — así son los 3 recibos
// reales de Asset usados como casos dorados 01-03. Usar el set completo de
// conceptos ahí sumaría presentismo indebidamente sobre un básico que ya
// es el remunerativo total del recibo. Este subconjunto (básico + las 3
// deducciones) es el que corresponde a esos 3 fixtures reales.
export const CONCEPTOS_SOLO_BASICO_Y_DEDUCCIONES: Concepto[] = CONCEPTOS_FUERA_CONVENIO.filter((c) =>
  ['basico', 'jubilacion', 'ley_19032', 'obra_social'].includes(c.codigo)
)
