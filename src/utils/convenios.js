// El convenio personalizado de la empresa "pisa" al global homónimo.
export function filtrarConveniosVisibles(convenios) {
  const nombresPropios = new Set(
    convenios.filter((c) => c.empresa_id).map((c) => c.nombre)
  )
  return convenios.filter((c) => c.empresa_id || !nombresPropios.has(c.nombre))
}

// nom_categorias versiona por (convenio, nombre, vigencia_desde): para un
// selector debe quedar UNA fila por nombre — la vigente más reciente <= hoy,
// o la futura más próxima si todavía no hay ninguna vigente.
export function categoriasVigentes(categorias, hoy = new Date().toISOString().slice(0, 10)) {
  const porNombre = new Map()
  for (const c of categorias) {
    const prev = porNombre.get(c.nombre)
    if (!prev) { porNombre.set(c.nombre, c); continue }
    const cVig = c.vigencia_desde <= hoy
    const prevVig = prev.vigencia_desde <= hoy
    const gana =
      (cVig && !prevVig) ||
      (cVig && prevVig && c.vigencia_desde > prev.vigencia_desde) ||
      (!cVig && !prevVig && c.vigencia_desde < prev.vigencia_desde)
    if (gana) porNombre.set(c.nombre, c)
  }
  return [...porNombre.values()]
}
