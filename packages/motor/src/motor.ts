import { evaluar } from './interprete.ts'

export interface Concepto {
  codigo: string
  nombre: string
  tipo: 'remunerativo' | 'no_remunerativo' | 'descuento' | 'aporte_patronal' | 'informativo'
  orden: number
  formula: string
  reglas?: Array<{ orden: number; condicion: string; formula: string }>
  imprimible: boolean
  categorias?: string[] | null
}

export interface ItemLiquidado {
  codigo: string
  nombre: string
  tipo: Concepto['tipo']
  monto: number
  reglaAplicada: number | 'base' // índice en `reglas` (0-based tras ordenar por `orden`), o 'base' si no aplicó ninguna
}

export interface ResultadoLiquidacion {
  items: ItemLiquidado[]
  remunerativoAcumulado: number
  bruto: number
  totalDescuentos: number
  neto: number
}

export function liquidarConceptos(
  conceptos: Concepto[],
  variablesBase: Record<string, number>
): ResultadoLiquidacion {
  const ordenados = [...conceptos].sort((a, b) => a.orden - b.orden)

  const items: ItemLiquidado[] = []
  let remunerativoAcumulado = 0
  let noRemunerativoAcumulado = 0
  let bruto = 0
  let totalDescuentos = 0

  for (const concepto of ordenados) {
    const vars: Record<string, number> = {
      ...variablesBase,
      remunerativo_acumulado: remunerativoAcumulado,
      no_remunerativo_acumulado: noRemunerativoAcumulado,
    }

    let formula = concepto.formula
    let reglaAplicada: number | 'base' = 'base'

    if (concepto.reglas && concepto.reglas.length > 0) {
      const reglasOrdenadas = [...concepto.reglas].sort((a, b) => a.orden - b.orden)
      for (let i = 0; i < reglasOrdenadas.length; i++) {
        const regla = reglasOrdenadas[i]
        const condicionCumple = evaluar(regla.condicion, vars)
        if (condicionCumple === true) {
          formula = regla.formula
          reglaAplicada = i
          break
        }
      }
    }

    const monto = evaluar(formula, vars) as number

    items.push({
      codigo: concepto.codigo,
      nombre: concepto.nombre,
      tipo: concepto.tipo,
      monto,
      reglaAplicada,
    })

    switch (concepto.tipo) {
      case 'remunerativo':
        remunerativoAcumulado += monto
        bruto += monto
        break
      case 'no_remunerativo':
        noRemunerativoAcumulado += monto
        bruto += monto
        break
      case 'descuento':
        totalDescuentos += monto
        break
      case 'aporte_patronal':
      case 'informativo':
        break
    }
  }

  return {
    items,
    remunerativoAcumulado,
    bruto,
    totalDescuentos,
    neto: bruto - totalDescuentos,
  }
}

// Conceptos aplicables a una categoría: sin `categorias` (null/undefined/[])
// el concepto aplica a todas; con valores, solo si incluye la categoría.
export function filtrarPorCategoria<T extends { categorias?: string[] | null }>(
  conceptos: T[],
  categoriaNombre: string
): T[] {
  return conceptos.filter(
    (c) => !c.categorias || c.categorias.length === 0 || c.categorias.includes(categoriaNombre)
  )
}
