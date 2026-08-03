// Task 4.6: unificar el cierre de período. Antes esta lógica vivía SOLO en
// ReportesPage.jsx (verificarEscalaVigente, inline) — LiquidacionPage tenía
// su propio "Cerrar período" que cerraba sin ningún chequeo. Se extrae acá
// para que ambos puntos de cierre usen la misma regla.
//
// `categoriasConEscalaVencida` es la parte PURA (sin I/O), fácil de
// testear a fondo: para cada categoría usada por los legajos del período,
// si la última vigencia cargada es anterior a `diasTope` días antes del
// cierre (o no hay ninguna), se considera vencida.
export function categoriasConEscalaVencida(categorias, fechaHasta, diasTope = 90) {
  if (!fechaHasta || !categorias || categorias.length === 0) return null
  const vencidas = []
  for (const cat of categorias) {
    if (!cat.ultimaVigencia) { vencidas.push(cat.nombre); continue }
    const dias = (new Date(fechaHasta) - new Date(cat.ultimaVigencia)) / (1000 * 60 * 60 * 24)
    if (dias > diasTope) vencidas.push(cat.nombre)
  }
  return vencidas.length > 0 ? vencidas : null
}

// Wrapper con I/O: dado un cliente supabase y los `categoriaIds` usados por
// los legajos del período, busca la última `vigencia_desde` cargada para
// cada una (por convenio_id + nombre, igual que antes en ReportesPage) y
// delega la decisión en la función pura de arriba.
export async function verificarEscalaVigente(supabase, { categoriaIds, fechaHasta, diasTope = 90 }) {
  if (!categoriaIds || categoriaIds.length === 0) return null
  const { data: cats } = await supabase.from('nom_categorias').select('id, convenio_id, nombre').in('id', categoriaIds)
  const categorias = []
  for (const cat of cats || []) {
    const { data: vig } = await supabase.from('nom_categorias').select('vigencia_desde')
      .eq('convenio_id', cat.convenio_id).eq('nombre', cat.nombre)
      .order('vigencia_desde', { ascending: false }).limit(1)
    categorias.push({ nombre: cat.nombre, ultimaVigencia: vig?.[0]?.vigencia_desde || null })
  }
  return categoriasConEscalaVencida(categorias, fechaHasta, diasTope)
}
