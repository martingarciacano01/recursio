// Orden del desplegable de períodos: año descendente (los más nuevos primero)
// y, dentro del mismo año, MES ASCENDENTE (Enero → Diciembre) y por tipo en el
// orden natural de liquidación (1ra quincena → 2da quincena → mensual → SAC →
// vacaciones → final).
//
// Antes los meses también venían descendentes, así que un año con varios
// períodos arrancaba por Diciembre y el usuario tenía que buscar Enero al
// final — contra el sentido de lectura cronológica de los períodos.
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
    // año: más nuevo primero
    const anioA = da.slice(0, 4)
    const anioB = db.slice(0, 4)
    if (anioA !== anioB) return anioB.localeCompare(anioA)
    // mismo año: mes ascendente (Enero → Diciembre)
    const ma = da.slice(5, 7)
    const mb = db.slice(5, 7)
    if (ma !== mb) return ma.localeCompare(mb)
    // mismo mes: por tipo
    const pa = pesoTipo(a.tipo)
    const pb = pesoTipo(b.tipo)
    if (pa !== pb) return pa - pb
    // desempate estable por fecha exacta
    return da.localeCompare(db)
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
