import { evaluar } from './interprete.ts'

export interface ConfigRecibo {
  grupo?: 'contribucion' | 'cct' | 'remunerativo' | 'no_remunerativo' | 'descuento'
  detalle?: 'sindical' | 'seguridad_social' | 'obra_social' | 'inssjp' | 'art' | 'scvo' | null
  unidadFormula?: string | null
  baseFormula?: string | null
}

export interface ConfigConceptoMotor {
  modo?: 'porcentaje' | 'nominal'
  porcentaje?: number
  base?: 'remunerativo' | 'no_remunerativo' | 'ambos' | 'acumulado_mensual'
  tope?: string | null
  monto?: number
  recibo?: ConfigRecibo
}

export interface Concepto {
  codigo: string
  nombre: string
  tipo: 'remunerativo' | 'no_remunerativo' | 'descuento' | 'aporte_patronal' | 'informativo'
  orden: number
  formula: string
  reglas?: Array<{ orden: number; condicion: string; formula: string }>
  imprimible: boolean
  categorias?: string[] | null
  config?: ConfigConceptoMotor | null
}

export interface ItemLiquidado {
  codigo: string
  nombre: string
  tipo: Concepto['tipo']
  monto: number
  reglaAplicada: number | 'base' // índice en `reglas` (0-based tras ordenar por `orden`), o 'base' si no aplicó ninguna
  unidadTexto: string | null
  baseCalculo: number | null
  grupoRecibo: ConfigRecibo['grupo'] | null
  detalleRecibo: ConfigRecibo['detalle'] | null
}

// Mismas claves que packages/motor/src/formulas.ts BASES — repetidas acá para
// no crear una dependencia del motor hacia el generador de fórmulas de la UI.
const BASES_EXPR: Record<string, string> = {
  remunerativo: 'remunerativo_acumulado',
  no_remunerativo: 'no_remunerativo_acumulado',
  ambos: '(remunerativo_acumulado + no_remunerativo_acumulado)',
  acumulado_mensual: '(remunerativo_acumulado + remunerativo_quincena1)',
}

// "10,77 %" — dos decimales, coma decimal (es-AR).
function formatPorcentaje(pct: number): string {
  return `${pct.toFixed(2).replace('.', ',')} %`
}

// Formatea una cantidad (unidad no porcentual): entero sin decimales si es
// entero, si no dos decimales con coma. Ej.: 30 → "30"; 36541.6 → "36541,60".
function formatCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
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

    const cfg = concepto.config ?? undefined
    const recibo = cfg?.recibo ?? undefined
    let unidadTexto: string | null = null
    let baseCalculo: number | null = null

    if (recibo?.baseFormula) {
      baseCalculo = evaluar(recibo.baseFormula, vars) as number
    } else if (cfg?.modo === 'porcentaje') {
      const baseExpr = BASES_EXPR[cfg.base ?? 'remunerativo'] ?? 'remunerativo_acumulado'
      const conTope = cfg.tope ? `min(${baseExpr}, ${cfg.tope})` : baseExpr
      baseCalculo = evaluar(conTope, vars) as number
    } else if (cfg?.modo === 'nominal') {
      baseCalculo = typeof cfg.monto === 'number' ? cfg.monto : monto
    }

    if (recibo?.unidadFormula) {
      unidadTexto = formatCantidad(evaluar(recibo.unidadFormula, vars) as number)
    } else if (cfg?.modo === 'porcentaje' && typeof cfg.porcentaje === 'number') {
      unidadTexto = formatPorcentaje(cfg.porcentaje)
    } else if (cfg?.modo === 'nominal') {
      unidadTexto = '1'
    }

    // `tipo` es la única fuente de verdad para bruto/neto (switch de abajo);
    // `config.recibo.grupo` es un campo editable aparte, pensado solo para
    // separar 'contribucion' vs 'cct' dentro de aporte_patronal. Si alguien
    // configura mal un concepto remunerativo/no_remunerativo/descuento con un
    // grupo de recibo que no coincide con su tipo, el PDF terminaba sumando o
    // restando de más sin que el bruto/neto en pantalla se moviera un peso
    // (bug real: Jubilación tipo=descuento configurada con grupo=remunerativo
    // inflaba el bruto y el neto del recibo). Se corrige forzando el grupo a
    // coincidir con el tipo para esos tres casos; aporte_patronal/informativo
    // siguen respetando la configuración libre.
    let grupoRecibo = recibo?.grupo ?? null
    if (
      grupoRecibo != null &&
      (concepto.tipo === 'remunerativo' || concepto.tipo === 'no_remunerativo' || concepto.tipo === 'descuento')
    ) {
      grupoRecibo = concepto.tipo
    }

    items.push({
      codigo: concepto.codigo,
      nombre: concepto.nombre,
      tipo: concepto.tipo,
      monto,
      reglaAplicada,
      unidadTexto,
      baseCalculo,
      grupoRecibo,
      detalleRecibo: recibo?.detalle ?? null,
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
