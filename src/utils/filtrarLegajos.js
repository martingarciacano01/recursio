// Filtro puro client-side (Task 13, Fase 5D). Documento: matcheo parcial
// ignorando guiones y espacios (el DNI/CUIL puede venir formateado o no).
const limpiarDoc = (s) => String(s || '').replace(/[-\s]/g, '')

export function filtrarLegajos(filas, busqueda, estado) {
  const q = busqueda.trim().toLowerCase()
  const qDoc = limpiarDoc(busqueda)
  return filas.filter((f) => {
    const pasaEstado = estado === 'todos' || f.estado === estado
    if (!pasaEstado) return false
    if (!q) return true
    const nombreMatch = (f.nombre || '').toLowerCase().includes(q)
    const dniMatch = qDoc.length > 0 && limpiarDoc(f.dni).includes(qDoc)
    return nombreMatch || dniMatch
  })
}
