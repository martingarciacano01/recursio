// Orden del desplegable de períodos: año descendente, mes descendente y,
// dentro del mismo mes, por tipo en el orden natural de liquidación
// (1ra quincena → 2da quincena → mensual → SAC → vacaciones → final).
//
// Antes venían en el orden crudo de la consulta (fecha_desde desc), que
// mezclaba tipos del mismo mes y hacía difícil encontrar uno concreto.
const ORDEN_TIPO = [
  'quincena_1', 'quincena_2', 'quincenal',
  'mensual', 'mensual_fc',
  'sac_1', 'sac_2', 'sac',
  'vacaciones', 'final',
]

function pesoTipo(tipo) {
  const i = ORDEN_TIPO.indexOf(tipo)
  return i === -1 ? ORDEN_TIPO.length : i
}

export function ordenarPeriodos(periodos) {
  return [...(periodos || [])].sort((a, b) => {
    const da = String(a.fecha_desde || '')
    const db = String(b.fecha_desde || '')
    // año + mes, más nuevo primero
    const ma = da.slice(0, 7)
    const mb = db.slice(0, 7)
    if (ma !== mb) return mb.localeCompare(ma)
    // mismo mes: por tipo
    const pa = pesoTipo(a.tipo)
    const pb = pesoTipo(b.tipo)
    if (pa !== pb) return pa - pb
    // desempate estable por fecha exacta
    return db.localeCompare(da)
  })
}

// Agrupa por año (ya ordenado) para los <optgroup> del selector.
export function agruparPorAnio(periodos) {
  const grupos = new Map()
  for (const p of ordenarPeriodos(periodos)) {
    const anio = String(p.fecha_desde || '').slice(0, 4) || '—'
    if (!grupos.has(anio)) grupos.set(anio, [])
    grupos.get(anio).push(p)
  }
  return [...grupos.entries()]
}
