// Criterio compartido de "incompleto para liquidar": falta cuil, cbu,
// convenioId o categoriaId en el legajo. Usado tanto en el Dashboard
// (conteo) como en la página de Legajos (semáforo por fila).
export function legajoIncompleto(legajo) {
  if (!legajo) return true
  return !legajo.cuil || !legajo.cbu || !legajo.convenioId || !legajo.categoriaId
}
