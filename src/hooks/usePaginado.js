import { useCallback, useState } from 'react'

// Paginación server-side genérica con .range() de Supabase: pagina es el
// índice de la página actualmente cargada (arranca en 0), rango es la
// ventana [desde, hasta] de ESA página (no acumulada). El consumidor
// (p. ej. LegajosPage) es responsable de concatenar los resultados de cada
// página al pedir "cargar más" — este hook solo calcula qué ventana pedir.
export function usePaginado(tamanoPagina) {
  const [pagina, setPagina] = useState(0)

  const rango = [pagina * tamanoPagina, (pagina + 1) * tamanoPagina - 1]

  const siguientePagina = useCallback(() => setPagina((p) => p + 1), [])
  const reset = useCallback(() => setPagina(0), [])
  const hayMasPaginas = useCallback((total) => rango[1] + 1 < total, [rango])

  return { pagina, rango, siguientePagina, reset, hayMasPaginas }
}
