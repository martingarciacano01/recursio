// packages/motor/src/lotes.ts
// Helpers puros para procesar la liquidación de un período en lotes (Fase
// 5I): partir los personal_ids en grupos manejables por la Edge Function
// (chunks para .in(), lotes de escritura) y agrupar filas ya traídas de una
// sola query batched (fichajes, ausencias) por persona, sin volver a pegarle
// a la base dentro de un loop.

export function partirEnLotes<T>(items: T[], tamano: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < items.length; i += tamano) {
    lotes.push(items.slice(i, i + tamano))
  }
  return lotes
}

export function agruparPorPersonalId<T extends { personal_id: string }>(filas: T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const fila of filas) {
    const lista = mapa.get(fila.personal_id)
    if (lista) lista.push(fila)
    else mapa.set(fila.personal_id, [fila])
  }
  return mapa
}
