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
  base?: 'remunerativo' | 'no_remunerativo' | 'ambos' | 'acumulado_mensual' | 'basico'
  tope?: string | null
  monto?: number
  recibo?: ConfigRecibo
}

export interface Concepto {
  codigo: string
  nombre: string
  // 'bono': no remunerativo AISLADO (bonos superadmin/empresa, plan
  // convenios-por-obra 2026-08-07). Se paga y suma a bruto/neto, pero NO
  // alimenta remunerativo_acumulado ni no_remunerativo_acumulado (no
  // integra base de ningún aporte/descuento) y NUNCA se imprime en el
  // recibo (grupoRecibo forzado a null más abajo).
  tipo: 'remunerativo' | 'no_remunerativo' | 'descuento' | 'aporte_patronal' | 'informativo' | 'bono'
  orden: number
  formula: string
  reglas?: Array<{ orden: number; condicion: string; formula: string }>
  imprimible: boolean
  categorias?: string[] | null
  config?: ConfigConceptoMotor | null
  // 'categoria' (default): se filtra por categoría, como siempre
  // (filtrarPorCategoria). 'legajo': el concepto NO se aplica por categoría
  // — solo a las personas que lo tengan asignado explícitamente en su
  // legajo (nom_legajo_adicionales, ver migración 0040 y filtrarAsignados
  // más abajo). Ej.: adicional por trabajo en altura, asignado persona por
  // persona en vez de inventar una categoría por combinación.
  asignacion?: 'categoria' | 'legajo'
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
  // "% del básico" (Fase adicionales por legajo, plan 2026-07-29 §3): un
  // adicional como "trabajo en altura" suele pactarse como % del básico del
  // convenio, no del acumulado remunerativo (que ya incluiría otros
  // adicionales previos y distorsionaría el %). basico_periodo ya viene
  // resuelto en variablesBase por liquidar-periodo/index.ts.
  basico: 'basico_periodo',
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

// Redondeo a centavos (2 decimales) evitando errores de punto flotante
// (0.1 + 0.2 !== 0.3). Se usa al cerrar el monto de cada concepto.
function redondearCentavos(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
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

  // ── Pasada 1: totales del período (Task 2.11, bug reportado por el
  // usuario). El motor exponía `remunerativo_acumulado` como el acumulado
  // PARCIAL hasta cada concepto, así que un adicional creado desde la UI
  // con orden max+1 (TabAdicionales.jsx:25) quedaba DESPUÉS de
  // jubilación/OS/contribuciones y no entraba en su base. Acá se evalúan
  // primero TODOS los remunerativos/no remunerativos (en orden, para
  // respetar encadenamientos tipo presentismo % del acumulado) y se deja
  // el total del período listo para la pasada 2.
  let remunerativoTotal = 0
  let noRemunerativoTotal = 0
  for (const c of ordenados) {
    if (c.tipo !== 'remunerativo' && c.tipo !== 'no_remunerativo') continue
    const vars0: Record<string, number> = {
      ...variablesBase,
      remunerativo_acumulado: remunerativoTotal,
      no_remunerativo_acumulado: noRemunerativoTotal,
    }
    let formula = c.formula
    if (c.reglas && c.reglas.length > 0) {
      const reglasOrdenadas = [...c.reglas].sort((a, b) => a.orden - b.orden)
      for (const regla of reglasOrdenadas) {
        if (evaluar(regla.condicion, vars0) === true) { formula = regla.formula; break }
      }
    }
    const monto = redondearCentavos(evaluar(formula, vars0) as number)
    if (c.tipo === 'remunerativo') remunerativoTotal += monto
    else noRemunerativoTotal += monto
  }

  const items: ItemLiquidado[] = []
  let remunerativoAcumulado = 0
  let noRemunerativoAcumulado = 0
  let bruto = 0
  let totalDescuentos = 0

  for (const concepto of ordenados) {
    // Descuentos y aportes patronales calculan sobre el TOTAL del período;
    // el resto ve el acumulado parcial (comportamiento histórico).
    const esDescuentoOAporte = concepto.tipo === 'descuento' || concepto.tipo === 'aporte_patronal'
    const vars: Record<string, number> = {
      ...variablesBase,
      remunerativo_acumulado: esDescuentoOAporte ? remunerativoTotal : remunerativoAcumulado,
      no_remunerativo_acumulado: esDescuentoOAporte ? noRemunerativoTotal : noRemunerativoAcumulado,
      remunerativo_total: remunerativoTotal,
      no_remunerativo_total: noRemunerativoTotal,
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

    const monto = redondearCentavos(evaluar(formula, vars) as number)

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
    // El bono NUNCA se imprime en el recibo (decisión del usuario, plan
    // convenios-por-obra): reciboLayout.js filtra por grupoRecibo, así que
    // forzarlo a null lo excluye del PDF sin tocar ese archivo.
    if (concepto.tipo === 'bono') grupoRecibo = null

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
      case 'bono':
        // Se paga (suma a bruto/neto) pero queda fuera de
        // remunerativoAcumulado/noRemunerativoAcumulado: no integra base.
        bruto += monto
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

// Igual que filtrarPorCategoria, pero además soporta conceptos con
// `asignacion: 'legajo'` (adicionales por empleado, migración 0040): esos
// NUNCA se filtran por categoría — solo entran si `asignadosPorLegajo`
// (los códigos de concepto que este legajo puntual tiene asignados vigentes,
// resuelto por el llamador contra nom_legajo_adicionales) los incluye. El
// resto de los conceptos (asignacion 'categoria' o sin especificar) siguen
// exactamente la lógica de siempre.
export function filtrarAsignados<T extends { codigo: string; categorias?: string[] | null; asignacion?: 'categoria' | 'legajo' }>(
  conceptos: T[],
  categoriaNombre: string,
  asignadosPorLegajo: Set<string>
): T[] {
  return conceptos.filter((c) => {
    if (c.asignacion === 'legajo') return asignadosPorLegajo.has(c.codigo)
    return !c.categorias || c.categorias.length === 0 || c.categorias.includes(categoriaNombre)
  })
}

// Códigos de los conceptos de horas extra con recargo. Cuando la empresa
// decide NO contabilizar horas extra (nom_config_horas.contabilizar_horas_extras
// = false, Task 2.12), estos conceptos se excluyen de la liquidación: las
// horas trabajadas de más se pagan como horas normales vía el básico (el
// acumulado de horas siempre incluye el exceso) y NO aparecen como línea de
// recargo en el recibo. `hs_feriado` NO va acá: es recargo por trabajar un
// feriado, un concepto distinto de la hora extra.
export const CODIGOS_HORAS_EXTRA = ['hora_extra_50', 'hora_extra_100']

export function excluirHorasExtra<T extends { codigo: string }>(
  conceptos: T[],
  contabilizarHorasExtras: boolean
): T[] {
  if (contabilizarHorasExtras) return conceptos
  return conceptos.filter((c) => !CODIGOS_HORAS_EXTRA.includes(c.codigo))
}
